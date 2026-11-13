"""R7 count-only evidence contracts. Never probe or change a live runtime."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

TAIPEI = timezone(timedelta(hours=8))
NIGHT_GAP_SECONDS = 20 * 60
TAKEOVER_GRACE_SECONDS = 5 * 60
NIGHT_SCHEMA = 'night-service-observation/v1'
RECIPIENT_SCHEMA = 'notify-recipient-consistency/v1'
RECIPIENT_BASIS = 'order-customer-vs-recipient-binding/v1'
NIGHT_FIELDS = frozenset(('schema', 'event', 'ts', 'runtime', 'probe',
                          'registration_match', 'night_copy_answered'))
RECIPIENT_COUNTS = ('sent', 'duplicates', 'checked', 'customer_id_matches',
                    'phone_unique_matches', 'wrong_recipient', 'unverifiable', 'corrupt_lines')
RECIPIENT_FIELDS = frozenset((*RECIPIENT_COUNTS, 'schema', 'date', 'timezone', 'reported_by',
                              'basis', 'generated_at', 'coverage_start', 'coverage_end',
                              'complete', 'snapshot', 'outbox', 'orders', 'bindings'))


def count(value):
    return type(value) is int and value >= 0


def stamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(TAIPEI) if parsed.utcoffset() is not None else None
    except (ValueError, OverflowError):
        return None


def gate(status, reason, evidence, **details):
    return dict(status=status, reason=reason, evidence=list(map(str, evidence)), details=details)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate field')
        result[key] = value
    return result


def _json(text):
    def invalid_constant(value):
        raise ValueError('non-finite number')
    return json.loads(text, object_pairs_hook=_object, parse_constant=invalid_constant)


def _read(path):
    """A changing or unreadable source cannot certify a complete window."""
    path = Path(path)
    before = path.stat()
    text = path.read_text(encoding='utf-8-sig')
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise OSError('source changed')
    return text


def night_continuity(day, sources, now=None):
    """20:00--10:00 Taipei. Legacy registration polls alone never pass.

    The proposed v1 observation additionally attests a no-send reply-path probe
    on the current shop copy. No producer is installed by this module.
    """
    opening = datetime.combine(day, datetime.min.time(), TAIPEI).replace(hour=20)
    closing = opening + timedelta(hours=14)
    now = now or datetime.now(TAIPEI)
    if now.utcoffset() is None:
        return gate('no_data', '缺帶時區的評估時間', sources)
    until = min(now.astimezone(TAIPEI), closing)
    healthy = set()
    registered, unhealthy, unknown, bad, source_errors = 0, 0, 0, 0, int(not sources)
    answer_observations = 0
    polls = {'handover_noop', 'webhook_update', 'night_reclaim'}
    failures = {'handover_error', 'tunnel_unhealthy_restart', 'configuration_error',
                'origin_down', 'supervisor_error'}
    neutral = {'tunnel_url', 'skipped_day'}
    for path in sources:
        try:
            text = _read(path)
        except (OSError, UnicodeError):
            source_errors += 1
            continue
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                row = _json(line)
            except (ValueError, RecursionError):
                bad += 1
                continue
            ts = stamp(row.get('ts')) if isinstance(row, dict) else None
            if ts is None or not isinstance(row.get('event'), str):
                bad += 1
                continue
            if not opening <= ts < closing or ts > until:
                continue
            event = row['event']
            if (event == 'night_service_observation' or row.get('schema') == NIGHT_SCHEMA
                    or 'night_copy_answered' in row or 'registration_match' in row):
                answer_observations += 1
                if (set(row) != NIGHT_FIELDS or row.get('schema') != NIGHT_SCHEMA
                        or event != 'night_service_observation'
                        or row.get('runtime') != 'shop-18791'
                        or row.get('probe') != 'reply-path-no-send/v1'
                        or type(row.get('registration_match')) is not bool
                        or type(row.get('night_copy_answered')) is not bool):
                    unknown += 1
                elif row['registration_match'] and row['night_copy_answered']:
                    healthy.add(ts)
                else:
                    unhealthy += 1
            elif event in failures:
                unhealthy += 1
            elif event in polls:
                # The actual writer only checks LINE's endpoint GET/PUT. Even
                # a match contains no measurement of a reply from port 18791.
                if row.get('verify_status') == 'match':
                    registered += 1
                else:
                    unhealthy += 1
            elif event not in neutral:
                unknown += 1
    times = sorted(healthy)
    maximum = max(((b - a).total_seconds() for a, b in zip(times, times[1:])), default=None)
    first_delay = (times[0] - opening).total_seconds() if times else None
    tail_gap = (until - times[-1]).total_seconds() if times else None
    details = dict(registration_observations=registered, answer_observations=answer_observations,
                   healthy_observations=len(times), unhealthy_observations=unhealthy,
                   unmeasured_observations=unknown, corrupt_rows=bad, source_errors=source_errors,
                   max_observed_gap_seconds=maximum, first_delay_seconds=first_delay,
                   tail_gap_seconds=tail_gap, gap_limit_seconds=NIGHT_GAP_SECONDS,
                   coverage_start=opening.isoformat(), coverage_end=closing.isoformat(),
                   evaluated_until=until.isoformat(), partial_window=until < closing)
    evidence = sources or ['tunnel_events.jsonl']
    if source_errors or bad:
        return gate('no_data', '夜間來源缺失、損毀或讀取中變動，不能當通過', evidence, **details)
    if until < opening:
        return gate('no_data', '當晚尚未開始，僅為部分日期預覽', evidence, **details)
    if unhealthy:
        return gate('fail', '夜間有登記、通道或夜間副本檢查失敗', evidence, **details)
    if not times:
        return gate('no_data', '既有 tunnel 週期列只證明登記；缺夜間副本回答的實測', evidence, **details)
    if (first_delay > TAKEOVER_GRACE_SECONDS
            or maximum is not None and maximum > NIGHT_GAP_SECONDS
            or tail_gap > NIGHT_GAP_SECONDS):
        return gate('fail', '首筆超過接手後 5 分、相鄰健康觀察或尾端缺口超過 20 分', evidence, **details)
    if unknown or until < closing:
        return gate('no_data', '有未實測列或整個夜間區間尚未結束', evidence, **details)
    return gate('pass', '夜間副本已實測回答，首筆及全夜健康觀察間隔符合門檻', evidence, **details)


def recipient_consistency(day, notify, path, now=None):
    """Verify a shop-produced, full-day counts-only receipt against notify totals."""
    evidence = [path]
    try:
        receipt = _json(_read(path))
    except (OSError, UnicodeError, ValueError, RecursionError):
        return gate('no_data', '缺獨立收件人一致性回條或來源損毀', evidence)
    if (not isinstance(receipt, dict) or set(receipt) != RECIPIENT_FIELDS
            or receipt.get('schema') != RECIPIENT_SCHEMA or receipt.get('date') != str(day)
            or receipt.get('timezone') != 'Asia/Taipei'
            or receipt.get('reported_by') != 'shop-recipient-consistency'
            or receipt.get('basis') != RECIPIENT_BASIS
            or type(receipt.get('complete')) is not bool
            or not all(count(receipt.get(k)) for k in RECIPIENT_COUNTS)):
        return gate('no_data', '收件人回條格式、日期、核對基礎或計數不符', evidence)
    details = {key: receipt[key] for key in RECIPIENT_COUNTS}
    now = now or datetime.now(TAIPEI)
    opening = datetime.combine(day, datetime.min.time(), TAIPEI)
    closing = opening + timedelta(days=1)
    generated, start, end = (stamp(receipt[key]) for key in
                             ('generated_at', 'coverage_start', 'coverage_end'))
    if (now.utcoffset() is None or None in (generated, start, end) or start != opening
            or not opening <= end <= closing or not end <= generated <= now):
        return gate('no_data', '收件人回條的區間、產生時間或評估時間不符', evidence, **details)
    if receipt['wrong_recipient'] > 0:
        return gate('fail', '獨立核對發現寄錯收件人', evidence, **details)
    if receipt['duplicates'] > 0:
        return gate('fail', '獨立回條發現重發', evidence, **details)
    if (receipt['sent'] != notify.get('sent') or receipt['duplicates'] != notify.get('duplicates')
            or receipt['checked'] + receipt['unverifiable'] != receipt['sent']
            or receipt['customer_id_matches'] + receipt['phone_unique_matches']
               + receipt['wrong_recipient'] != receipt['checked']):
        return gate('no_data', '收件人回條未涵蓋當日全部發送或分項計數不一致', evidence, **details)
    if (not receipt['complete'] or end != closing or receipt['snapshot'] != 'at_send'
            or any(receipt[k] != 'ok' for k in ('outbox', 'orders', 'bindings'))
            or receipt['corrupt_lines'] or receipt['unverifiable']):
        return gate('no_data', '收件人回條尚未完整、缺送出時快照或有無法核對資料', evidence, **details)
    return gate('pass', '完整核對當日全部收件人：零重發、零寄錯對象', evidence, **details)
