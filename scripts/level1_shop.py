"""Current shop runtime evidence. Never emit customer text or raw test output."""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import uuid

TAIPEI = timezone(timedelta(hours=8))
CUTOVER = date(2026, 11, 11)
LIVE = Path('D:/AI-Lanes-work/nightrun/live')
ACCEPTED = Path('D:/AI-Lanes-work/shopfix15/r4-verify/work')
BUDGET = 300
GROUPS = {
    'facts': ('runtime/test_sp1_chat_guards.py', 'runtime/test_bulky_days_1106.py',
              'tests/test_q50_guard.py', 'tests/test_real_replay.py', 'tests/test_fact_answers.py',
              'tests/test_shopfix15_strings.py', 'tests/test_shopfix15_prices.py',
              'tests/test_shopfix15_days.py', 'tests/test_shopfix15_store.py',
              'tests/test_shopfix15_prompt.py', 'tests/test_shopfix15_r4.py'),
    'flows': ('runtime/test_instore_summary_service.py', 'runtime/test_instore_summary_e2e.py',
              'runtime/test_webhook_instore.py', 'runtime/test_onboarding_semantic_switching.py',
              'tests/test_shopfix15_photo.py', 'tests/test_shopfix15_booking.py',
              'tests/test_shopfix15_parts.py', 'tests/test_shopfix15_phones.py'),
    'handoff': ('tests/test_shopfix15_r3.py', 'tests/test_shopfix15_complaints.py'),
}
# Frozen accepted baseline, not a blanket filename exclusion. Both test bytes
# and the exact failure shape must match; changed failures block the item.
BASE_RED = {
    'runtime/test_b1_facts.py': ('c376b453156cd8868f526c4e37a6a817965061189341b3c78eb27c32f57a1017',
                              7, 0, 1, ('test_builders_have_no_banned_facts',), 'missing_builder'),
    'runtime/test_webhook_attribution.py': ('87881692d1fd429dcb8a1f4e32b6a447772e7b4e30ce02eea4b9d16db95f34c2',
                              27, 4, 1, ('test_binding_composite_cid_is_ambiguous', 'test_binding_cid_lookup_row',
                              'test_binding_hook_raises_reply_unchanged', 'test_binding_phone_lookup_row',
                              'test_no_raw_identifiers_or_text_in_ledger'), 'old_attribution'),
    'tests/test_product_catalog.py': ('e532b89f24000e2864a2aba8354dfec2f47252253258f659d05bc06be754ad42',
                              0, 0, 1, (), 'missing_patch_shop_json'),
    'tests/test_product_kit.py': ('cb65e07eea417ec8ad9d9109d39f10e5b45d5e857d4e28b9fc9ee5a9f1d70098',
                              0, 0, 1, (), 'missing_patch_shop_json'),
}
BUSINESS_FILES = ('shop.json', 'config/prices.json', 'config/Memory.md', 'config/Clothing_Memory.md',
                  'config/Dialog_Phrases.json')
REPLAY_FILES = ('q50.json', 'real_r1.json', 'real_r2.json', 'real_r3.json', 'real_morning.jsonl')


def gate(status, reason, evidence=(), **details):
    return dict(status=status, reason=reason, evidence=list(map(str, evidence)), details=details)


def stamp(value):
    try:
        ts = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return ts.astimezone(TAIPEI) if ts.utcoffset() is not None else None
    except (ValueError, TypeError, AttributeError):
        return None


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


def day_ownership(day, path, start_hour=10, end_hour=20):
    """A timely shop observation proves handback, not uptime; any AI cover is visible."""
    rows, bad = [], 0
    if path is None:
        return gate('no_data', '缺 day_cover 日間所有權紀錄', ['day_cover.jsonl'])
    try:
        with Path(path).open(encoding='utf-8-sig') as stream:
            for line in stream:
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    bad += 1
                    continue
                ts = stamp(row.get('ts')) if isinstance(row, dict) else None
                if ts is None:
                    bad += 1
                elif ts.date() == day and start_hour <= ts.hour < end_hour:
                    action = row.get('action')
                    # check_error also produces shop_fixed_no_cover in the producer.
                    shop = ((action == 'shop_fixed_no_cover' and not row.get('check_error'))
                            or (action == 'handed_back_to_shop' and row.get('verify') == 'match'))
                    ai = action in ('switched_to_ai', 'already_ai')
                    rows.append((ts, shop, ai))
    except (OSError, UnicodeError):
        return gate('no_data', '缺 day_cover 日間所有權紀錄', [path])
    ai_count = sum(r[2] for r in rows)
    first = min((r[0] for r in rows if r[1]), default=None)
    expected = datetime.combine(day, datetime.min.time(), TAIPEI).replace(hour=start_hour)
    details = dict(observations=len(rows), ai_cover_checks=ai_count,
                   expected_at=expected.isoformat(), actual_at=first.isoformat() if first else None)
    if ai_count:
        return gate('fail', '日間仍由 AI PC 代班，未完整交還店機', [path], **details)
    if bad or not rows:
        return gate('no_data', 'day_cover 缺該日日間紀錄或有損毀行', [path], **details)
    if first is None:
        return gate('no_data', '日間紀錄未驗證店機持有 LINE', [path], **details)
    timely = (first - expected).total_seconds() <= 300
    return gate('pass' if timely else 'fail',
                'day_cover 確認店機於開店後 5 分內持有 LINE' if timely else '首筆店機持有紀錄晚於開店後 5 分',
                [path], **details)


# SafeWriter timestamps are local. Matching is anchored: message text that
# happens to contain a log marker cannot turn into delivery evidence.
LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (.*)$')
# Real runtime: log_message prints f"[Webhook] {args[0]} - {args[1]}" where args[0] is the bare
# requestline (no quotes), e.g. `[Webhook] POST /line/webhook HTTP/1.1 - 200`. Quotes stay optional.
POST = re.compile(r'^\[Webhook\] "?POST /line/webhook HTTP/1\.[01]"? - (\d{3})$')
SUCCESS = re.compile(r'^\[Webhook Reply Success\] HTTP 2\d\d$')
COUNTS = ('received', 'replied_ok', 'reply_failed', 'to_staff', 'no_reply_needed')


def night_counts(day, log_dir):
    """Parse event boundaries; use canonical tee log, err only as a fallback.

    received counts text/image/paused-image events, NOT HTTP requests. A
    handoff with a successful customer reply counts once as replied_ok.
    Paused-only turns cannot prove an earlier owner push and stay unmeasured.
    """
    paths = [Path(log_dir) / n for n in ('webhook_server.log', 'webhook_server.err.log')]
    source = next((p for p in paths if p.is_file()), None)
    if source is None:
        return gate('no_data', '缺夜間 shop webhook 日誌', paths)
    counts = Counter({k: 0 for k in COUNTS})
    stats = Counter(inbound_posts=0, rejected_posts=0, handoff_push_ok=0,
                    handoff_push_failed=0, paused=0, chat_guard=0,
                    ambiguous=0, observed_lines=0, verification_pings=0, duplicate_tokens=0)
    pending = None

    def finish():
        nonlocal pending
        if pending is None:
            return
        if pending['reply']:
            counts['replied_ok'] += 1
        elif pending['push'] and not pending['push_failed']:
            counts['to_staff'] += 1
        elif pending['paused']:
            stats['ambiguous'] += 1
        pending = None

    try:
        with source.open(encoding='utf-8-sig', errors='replace') as stream:
            for line in stream:
                m = LINE.match(line.rstrip('\r\n'))
                if not m:
                    continue  # multiline bodies and old un-timestamped lines are not evidence
                try:
                    ts = datetime.strptime(m[1], '%Y-%m-%d %H:%M:%S').replace(tzinfo=TAIPEI)
                except ValueError:
                    continue
                if ts.date() != day:
                    continue
                stats['observed_lines'] += 1
                text = m[2]
                post = POST.fullmatch(text)
                if post:
                    finish()
                    stats['inbound_posts' if post[1] == '200' else 'rejected_posts'] += 1
                elif text.startswith(('[Webhook Text] User ', '[Webhook Image] Received image ')):
                    finish()
                    counts['received'] += 1
                    pending = dict(reply=False, push=False, push_failed=False, paused=False)
                elif SUCCESS.fullmatch(text):
                    if pending is None or pending['reply']:
                        stats['ambiguous'] += 1  # postback or missing event boundary
                    else:
                        pending['reply'] = True
                elif text.startswith('[ERROR] Failed to send LINE reply:'):
                    counts['reply_failed'] += 1
                elif text.startswith('[Handoff] push owner='):
                    ok = text.endswith(' success=True')
                    stats['handoff_push_ok' if ok else 'handoff_push_failed'] += 1
                    if pending is None:
                        stats['ambiguous'] += 1
                    else:
                        pending['push'] |= ok
                        pending['push_failed'] |= not ok
                elif text.startswith(('[Handoff] push failed:', '[Handoff] notification failed:')):
                    stats['handoff_push_failed'] += 1
                    if pending is not None:
                        pending['push_failed'] = True
                elif text.startswith('[Handoff] paused user='):
                    stats['paused'] += 1
                    if pending is not None and pending['reply']:
                        finish()
                    if pending is None:  # paused image has no Webhook Image line
                        counts['received'] += 1
                        pending = dict(reply=False, push=False, push_failed=False, paused=True)
                    else:
                        pending['paused'] = True
                elif text.startswith('[Chat Guard]'):
                    stats['chat_guard'] += 1
                elif text == '[Webhook] Received LINE test webhook verification ping. Skipping dummy token.':
                    stats['verification_pings'] += 1
                elif text.startswith('[Webhook] Duplicate replyToken received:'):
                    stats['duplicate_tokens'] += 1
        finish()
    except OSError:
        return gate('no_data', '夜間日誌無法讀取', [source])
    details = dict(counts)
    details.update(stats)
    details['unanswered'] = counts['received'] - counts['replied_ok'] - counts['to_staff']
    details['complete'] = False  # a sparse log never certifies a full calendar day
    if not stats['observed_lines'] or not counts['received'] or not stats['inbound_posts']:
        status, reason = 'no_data', '夜間日誌沒有可核對的該日客戶事件；不能填零'
        details.update({k: None for k in (*COUNTS, 'unanswered')})
    elif counts['reply_failed'] or stats['handoff_push_failed']:
        status, reason = 'fail', '夜間有回覆或店員推播失敗'
    elif details['unanswered'] > stats['ambiguous']:
        status, reason = 'fail', '夜間有收訊但未見回覆或店員推播'
    elif stats['ambiguous'] or source.name.endswith('.err.log'):
        status, reason = 'no_data', '夜間事件無法完整對帳，或只有 stderr 副本'
    else:
        status, reason = 'pass', '夜間已觀測事件均見回覆或店員推播（非全天完整性證明）'
    return gate(status, reason, [source], **details)


def shop_counts(day, path, now):
    data = load(path)
    allowed = set(COUNTS) | {'schema', 'date', 'generated_at', 'complete', 'window'}
    generated = stamp(data.get('generated_at')) if isinstance(data, dict) else None
    valid = (isinstance(data, dict) and set(data) <= allowed and data.get('schema') == 'shop-replies/v1'
             and data.get('date') == str(day) and data.get('complete') is True
             and data.get('window') == 'shop_day' and generated is not None
             and generated.date() >= day and generated <= now
             and all(type(data.get(k)) is int and data[k] >= 0 for k in COUNTS))
    if not valid:
        return gate('no_data', '缺完整 shop-replies/v1 店機日間計數收據', [path])
    answered = sum(data[k] for k in ('replied_ok', 'to_staff', 'no_reply_needed'))
    if answered > data['received'] or data['reply_failed'] > data['received']:
        return gate('no_data', '店機收據計數互相矛盾', [path])
    details = {k: data[k] for k in COUNTS}
    details['unanswered'] = data['received'] - answered
    return gate('fail' if details['unanswered'] or data['reply_failed'] else 'pass',
                '店機日間收訊、送達與轉真人互斥計數', [path], **details)


def accounting(day, log_dir, shop_path, now):
    halves = {'night': night_counts(day, log_dir), 'shop_day': shop_counts(day, shop_path, now)}
    states = [r['status'] for r in halves.values()]
    status = 'fail' if 'fail' in states else 'no_data' if 'no_data' in states else 'pass'
    # Never add a missing half as zero. Detail summaries contain only counts.
    totals = {k: sum(r['details'][k] for r in halves.values())
              if all(type(r['details'].get(k)) is int for r in halves.values()) else None for k in COUNTS}
    summaries = []
    for name, row in halves.items():
        text = name + '：' + row['status']
        if type(row['details'].get('received')) is int:
            text += '（收訊 {received}、回覆 {replied_ok}、轉真人 {to_staff}、失敗 {reply_failed}）'.format(**row['details'])
        summaries.append(text)
    result = gate(status, '；'.join(summaries),
                  [p for r in halves.values() for p in r['evidence']], **totals)
    result['subchecks'] = halves
    return result


def test_evidence(day, path, group, now, live=LIVE):
    data = load(path)
    generated = stamp(data.get('generated_at')) if isinstance(data, dict) else None
    if (not isinstance(data, dict) or data.get('schema') != 'level1-shop-checks/v2'
            or data.get('date') != str(day) or generated is None or generated.date() != day or generated > now
            or data.get('offline') is not True or data.get('mode') != 'full'
            or data.get('source_runtime') != str(Path(live).resolve())
            or data.get('budget_seconds') != BUDGET or data.get('snapshot_error')
            or type(data.get('elapsed_seconds')) not in (int, float)
            or not 0 <= data['elapsed_seconds'] <= BUDGET):
        return gate('no_data', '缺當日現役 shop runtime 隔離測試證據（300 秒內）', [path])
    manifest = data.get('source_manifest')
    try:
        current = (isinstance(manifest, dict) and 'runtime/webhook_server.py' in manifest
                   and all(source_allowed(n)
                           and (Path(live) / n).is_file() and digest(Path(live) / n) == sha for n, sha in manifest.items()))
    except OSError:
        current = False
    if not current:
        return gate('no_data', '現役程式已變更或缺可核對的來源雜湊', [path])
    checks = data.get('checks')
    row = checks.get(group) if isinstance(checks, dict) else None
    if not isinstance(row, dict) or not isinstance(row.get('suites'), list):
        return gate('no_data', '缺 shop 測試組', [path])
    suites = row['suites']
    expected = set(GROUPS[group]) | set(BASE_RED)
    if len(suites) != len(expected) or {s.get('suite') for s in suites if isinstance(s, dict)} != expected:
        return gate('no_data', 'shop 測試檔清單有缺漏或重複', [path])
    states, total, existing = [], 0, []
    for suite in suites:
        if suite.get('status') == 'pre_existing' and suite['suite'] in BASE_RED and baseline_matches(suite):
            existing.append(suite['suite'])
            continue
        valid = all(type(suite.get(k)) is int and suite[k] >= 0 for k in ('tests', 'failures', 'errors', 'skipped'))
        if not valid:
            states.append('no_data')
        elif suite.get('status') == 'fail' or suite['failures'] or suite['errors']:
            states.append('fail')
        elif suite.get('status') != 'pass' or suite['tests'] == 0 or suite['skipped']:
            states.append('no_data')
        else:
            states.append('pass')
            total += suite['tests']
    status = 'fail' if 'fail' in states else 'no_data' if 'no_data' in states else 'pass'
    reason = '現役 shop 隔離測試 ' + status + '，通過案例 ' + str(total)
    if existing:
        reason += '；既有缺檔/舊斷言（不算通過）：' + '、'.join(existing)
    return gate(status, reason, [path], tests=total, pre_existing=existing)


def baseline_matches(row):
    spec = BASE_RED.get(row.get('suite'))
    return bool(spec and row.get('test_sha256') == spec[0]
                and tuple(row.get(k) for k in ('tests', 'failures', 'errors')) == spec[1:4]
                and row.get('skipped') == 0 and tuple(sorted(row.get('failed_tests', []))) == tuple(sorted(spec[4]))
                and row.get('diagnostic') == spec[5] and row.get('exit_code') == 1)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_allowed(name):
    if not isinstance(name, str):
        return False
    p = Path(name)
    return (not p.is_absolute() and '..' not in p.parts and bool(p.parts)
            and not set(p.parts) & {'data', 'logs', 'secrets', '__pycache__'}
            and (name in BUSINESS_FILES or p.suffix == '.py' and
                 (len(p.parts) == 1 or p.parts[0] in ('runtime', 'connectors', 'config'))))


def copy_file(source, target, deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError('copy budget')
    # Check every ancestor, not just the leaf, to avoid following a data junction.
    if any(p.is_symlink() or p.is_junction() for p in (source, *source.parents)):
        raise ValueError('source link')
    before = digest(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    if before != digest(source) or before != digest(target):
        raise ValueError('source changed during copy')
    return before


def snapshot_shop(live, accepted, target, deadline):
    """Code and allowlisted business facts only; no data/logs/secrets, no git archive."""
    manifest = {}
    wanted = []
    for folder in ('runtime', 'connectors', 'config'):
        wanted.extend(p for p in (live / folder).rglob('*.py')
                      if not any(part in ('__pycache__', 'tests', 'secrets', 'data', 'logs') for part in p.relative_to(live).parts)
                      and not p.name.startswith('test_'))
    wanted.extend(p for p in live.glob('*.py') if not p.name.startswith('test_'))
    wanted.extend(live / n for n in BUSINESS_FILES if (live / n).is_file())
    for p in wanted:
        rel = p.relative_to(live).as_posix()
        manifest[rel] = copy_file(p, target / rel, deadline)
    if 'runtime/webhook_server.py' not in manifest:
        raise FileNotFoundError('runtime/webhook_server.py')
    tests = sorted(set(n for names in GROUPS.values() for n in names) | set(BASE_RED))
    test_manifest = {}
    for rel in [*tests, 'tests/shopfix15_support.py', 'runtime/test_webhook_log_ts.py',
                'tests/fixtures/q_r4.json']:
        # Live runtime tests are authoritative; the accepted corpus supplies tests/.
        src = live / rel if rel.startswith('runtime/') else accepted / rel
        if src.is_file():
            test_manifest[rel] = copy_file(src, target / rel, deadline)
    for name in REPLAY_FILES:
        src = accepted.parent / 'ref' / name
        if src.is_file():
            test_manifest['ref/' + name] = copy_file(src, target / 'ref' / name, deadline)
    return manifest, test_manifest


# The accepted shopfix15 runner's per-file runpy flow with stricter filesystem
# guards. Test output stays in memory; only numeric summaries and safe IDs escape.
BOOT = r'''
import os, pathlib, runpy, socket, sys, types, unittest
sys.dont_write_bytecode = True
root = pathlib.Path.cwd().resolve()
sys.path[:0] = [str(root), str(root / 'runtime'), str(root / 'tests')]
libraries = [pathlib.Path(sys.base_prefix).resolve(), pathlib.Path(sys.prefix).resolve()]
def local(value):
    p = pathlib.Path(os.fsdecode(value)).resolve()
    return p, p.is_relative_to(root)
def audit(event, args):
    if event in {'socket.connect', 'socket.getaddrinfo', 'socket.bind', 'subprocess.Popen', 'os.system'}:
        raise PermissionError('L1SHOP: external execution/network forbidden')
    if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
        p, inside = local(args[0])
        mode, flags = args[1], args[2]
        write = (isinstance(mode, str) and any(c in mode for c in 'wax+')) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)
        if not inside and (write or not any(p.is_relative_to(lib) for lib in libraries)):
            raise PermissionError('L1SHOP: file outside isolation')
    for name, indexes in {'os.mkdir': (0,), 'os.remove': (0,), 'os.rmdir': (0,), 'os.rename': (0, 1), 'shutil.rmtree': (0,)}.items():
        if event == name:
            for i in indexes:
                if isinstance(args[i], (str, bytes, os.PathLike)) and not local(args[i])[1]:
                    raise PermissionError('L1SHOP: mutation outside isolation')
sys.addaudithook(audit)
sys.argv = [sys.argv[1], '-v']
# Some runtime test files have no __main__ block; run actual TestCases rather
# than trusting the accepted runner's exit-zero-only treatment of those files.
module = types.ModuleType('__l1_suite__')
sys.modules[module.__name__] = module
module.__dict__.update(runpy.run_path(sys.argv[0], run_name=module.__name__))
result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(module))
raise SystemExit(0 if result.wasSuccessful() else 1)
'''


def run_suite(tree, relative, timeout):
    from level1_offline_checks import no_data, parse_result, run_process
    path = tree / relative
    if not path.is_file():
        return {**no_data('MissingSuite'), 'suite': relative}
    tmp = tree / 'tests/_tmp'
    tmp.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if not any(s in k.upper() for s in
           ('KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'COOKIE', 'LAUNDRY', 'SXJ_', 'SHOPFIX', 'PYTHON'))}
    env.update(PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1', TEMP=str(tmp), TMP=str(tmp),
               LOCALAPPDATA=str(tmp), SHOPFIX15_REF=str(tree / 'ref'))
    try:
        result = run_process([sys.executable, '-B', '-X', 'utf8', '-c', BOOT, relative],
                             cwd=tree, env=env, timeout=timeout, kill_tree=False)
        output = result.stdout + result.stderr
        row = parse_result(output, result.returncode)
        row['failed_tests'] = sorted(set(re.findall(r'^(?:FAIL|ERROR): (test_\w+)', output, re.M)))
        row['exit_code'] = result.returncode
        row['exception_types'] = sorted(set(re.findall(r'^([A-Za-z]+Error):', output, re.M)))
        row['diagnostic'] = ('missing_patch_shop_json' if "No module named 'patch_shop_json'" in output else
                             'missing_builder' if 'FileNotFoundError:' in output and 'build_expanded_corpus_v5.py' in output else
                             'old_attribution' if relative == 'runtime/test_webhook_attribution.py' and 'AssertionError: 3 != 2' in output else None)
        # Skips cannot pass even if the native runner exits zero.
        if row['status'] == 'pass' and row['skipped']:
            row['status'] = 'no_data'
    except Exception as exc:
        reason = 'ProcessTreeCleanupFailed' if isinstance(exc, RuntimeError) and str(exc).startswith('ProcessTreeCleanupFailed') else type(exc).__name__
        row = no_data(reason)
    row.update(suite=relative, test_sha256=digest(path))
    if baseline_matches(row):
        row['status'] = 'pre_existing'
        row['label'] = '既有缺檔/舊斷言'
    return row


def produce_shop(root, out_root, now=None, work_root=Path('D:/AI-Lanes-work/l1gate/checks'),
                 smoke=False, live=LIVE, accepted=ACCEPTED):
    from level1_offline_checks import check_paths, combine, no_data
    started_at = now or datetime.now(TAIPEI)
    started = time.monotonic()
    deadline = started + (25 if smoke else BUDGET) - 2  # reserve receipt time
    root, out_root, work_root, live, accepted = map(lambda p: Path(p).resolve(), (root, out_root, work_root, live, accepted))
    day = started_at.astimezone(TAIPEI).date()
    path = out_root / 'output/operations' / (('level1-smoke-' if smoke else 'level1-checks-') + str(day) + '.json')
    check_paths(root, out_root, work_root, path)
    if any(work_root.is_relative_to(p) or out_root.is_relative_to(p) for p in (live, accepted)):
        raise ValueError('output cannot touch runtime or accepted source')
    work = work_root / ('shop-' + uuid.uuid4().hex)
    snapshot = work / 'snapshot'
    manifest, tests, error = {}, {}, None
    try:
        manifest, tests = snapshot_shop(live, accepted, snapshot, deadline)
    except (OSError, ValueError) as exc:
        error = 'SnapshotUnavailable:' + type(exc).__name__
    files = sorted(set(n for names in GROUPS.values() for n in names) | set(BASE_RED))
    records = {}
    halted = False
    for index, relative in enumerate(files):
        if error or halted or time.monotonic() >= deadline or smoke and index > 0:
            row = {**no_data(error or 'DailyBudgetExceeded' if not smoke else 'SmokeOnly'), 'suite': relative}
        else:
            tree = work / ('run-' + str(index))
            try:
                shutil.copytree(snapshot, tree)
                remaining = deadline - time.monotonic()
                row = run_suite(tree, relative, min(30, remaining)) if remaining > 0 else {**no_data('DailyBudgetExceeded'), 'suite': relative}
            except OSError as exc:
                row = {**no_data(type(exc).__name__), 'suite': relative}
        records[relative] = row
        halted |= row.get('runner_error') == 'ProcessTreeCleanupFailed'
        print(relative + ': ' + row['status'], flush=True)
    checks = {}
    for group, names in GROUPS.items():
        rows = [records[n] for n in (*names, *BASE_RED)]
        checks[group] = combine([r for r in rows if r['status'] != 'pre_existing'])
        checks[group]['suites'] = rows  # pre-existing rows stay visible, never pass counts
    receipt = dict(schema='level1-shop-checks/v2', mode='smoke' if smoke else 'full', date=str(day),
                   generated_at=(now or datetime.now(TAIPEI)).isoformat(timespec='seconds'),
                   started_at=started_at.isoformat(timespec='seconds'), offline=True,
                   budget_seconds=BUDGET, elapsed_seconds=round(time.monotonic() - started, 3),
                   source_runtime=str(live), accepted_tests=str(accepted), source_manifest=manifest,
                   test_manifest=tests, snapshot=str(snapshot), snapshot_error=error, checks=checks,
                   scope='shutil copy of live code; accepted offline per-file flow; no customer data or network')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return path
