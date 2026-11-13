#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read-only Level-1 checklist (OPS-L1-12), with the legacy three metrics.

Evaluates twelve gates for one completed Taipei date (default: yesterday).
Writes output/operations/level1-gates-<date>.json and reports/level1-gates.md.
--out-root separates all output from read-only live sources. Missing evidence
is no_data; item 11 stays not_ready. Three full calendar days plus complete
zero-customer-impact incident receipts are required. Legacy APIs below keep
their old seven-day semantics for existing consumers, not release acceptance.

  1. freshness: max gap between successful MDB pulls inside that day's opening
     hours (opening -> first pull, pull -> pull, last pull -> closing) <= 60 min.
     Opening hours come from line-bot/handover.json through the tunnel_manager
     helpers (_validate_config / day_window_for); hours are not re-implemented.
  2. notify: data/gates/notify-<date>.json reported by the shop PC. A missing
     file on a business day is no_data (never 0, never pass).
  3. posts: every scheduled slot/platform in data/publishing-policy.json has at
     least one non-dry-run row with status "success" in data/posted-log/<date>.json.

Iron rule: null / no data is never a pass and never 0. Inputs are read only.
Stdlib only. Exit 0 when the evaluation was written (even if gates fail),
2 for a bad/unfinished date.
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import math
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from publish_recovery_report import recovery_summary
import level1_shop as shop
from slot_retirements import retired_slots

RULES_VERSION = 8
CHECKLIST_TARGET = 3
SERVICE_GAP_SECONDS = 5 * 60
CHECKLIST_STATUSES = ("pass", "fail", "no_data", "not_ready", "not_applicable")
CHECKLIST_TITLES = {
    "1": "夜間 AI 準時接手、交還與持續運作", "2": "客人訊息都有回覆或轉真人",
    "3": "對客事實與黃金對話", "4": "估價、照片與寢具流程",
    "5": "轉真人送到店員", "6": "到件通知送出與綁定改善",
    "7": "到件通知零重發與零誤發", "8": "營業時間資料間隔不超過 60 分",
    "9": "當天排程貼文全部發出", "10": "貼文失敗已重試成功或通知送達",
    "11": "重開機自動恢復與停機通知", "12": "22:00 至隔日 01:00 有當晚新報告",
}
STREAK_TARGET = 7
REPORT_DAYS = 30
MAX_STREAK_WALK = 3660
FRESHNESS_LIMIT_SECONDS = 60 * 60
SUCCESS_PULL_RESULTS = frozenset({"REPLACED", "UNCHANGED"})
CONDITIONS = ("freshness", "notify", "posts")
STATUSES = ("pass", "fail", "no_data", "not_required")
PLATFORM_LABELS = {"facebook": "FB", "instagram": "IG"}
# Condition 1 counts calendar days (a closed day with nothing required counts as
# a pass); conditions 2 and 3 skip not_required days (no break, no count).
NOT_REQUIRED_COUNTS = {"freshness": True, "notify": False, "posts": False}
CONDITION_TITLES = {
    "freshness": "1. LINE 資料新鮮度(營業時間內最大資料間隔 ≤ 60 分)",
    "notify": "2. 到店通知連續營業日 0 誤發",
    "posts": "3. 每日發文全部準時",
}
COLUMN_TITLES = {"freshness": "1. 資料新鮮度", "notify": "2. 到店通知", "posts": "3. 每日發文"}
STREAK_UNITS = {"freshness": "天", "notify": "個營業日", "posts": "天"}
TAIPEI_FALLBACK = timezone(timedelta(hours=8), "Asia/Taipei")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DEFAULT_ROOT = Path(__file__).resolve().parent.parent


class PolicyError(ValueError):
    """publishing-policy.json has a shape this tracker cannot interpret."""


class Paths:
    def __init__(self, root, mdb_log=None, hours_module=None, out_root=None, service_logs=None,
                 heartbeat_log_dir=None, day_cover_log=None, shop_root=None, checks_root=None):
        root = Path(root)
        self.root = root
        self.policy = root / "data" / "publishing-policy.json"
        self.posted_log_dir = root / "data" / "posted-log"
        self.gates_dir = root / "data" / "gates"
        self.handover = root / "line-bot" / "handover.json"
        self.hours_module = Path(hours_module) if hours_module else root / "line-bot" / "tunnel_manager.py"
        base = os.environ.get("LOCALAPPDATA")
        if mdb_log:
            self.mdb_log = Path(mdb_log)
        else:
            self.mdb_log = Path(base) / "line-bot" / "mdb_pull.jsonl" if base else None
        # Explicit paths also keep synthetic tests away from the live runtime.
        runtime = self.mdb_log.parent if self.mdb_log else None
        self.day_cover_log = Path(day_cover_log) if day_cover_log else runtime / 'day_cover.jsonl' if runtime else None
        # Injected test inputs must never fall through to real customer logs.
        self.shop_root = Path(shop_root) if shop_root else root / 'missing-shop-runtime' if mdb_log else shop.LIVE
        self.checks_root = Path(checks_root) if checks_root else root
        self.service_logs = ([Path(p) for p in service_logs] if service_logs is not None else
                             [runtime / "tunnel_events.jsonl"]
                             if runtime else [])
        # An injected MDB source must not cause tests to read live heartbeats.
        heartbeat_base = root if mdb_log else Path(base) if base else None
        self.heartbeat_log_dir = (Path(heartbeat_log_dir) if heartbeat_log_dir is not None else
                                  heartbeat_base / "sxj-heartbeat" / "log" if heartbeat_base else None)
        self.out_root = Path(out_root) if out_root else root
        self.ops_dir = self.out_root / "output" / "operations"
        self.report = self.out_root / "reports" / "level1-gates.md"


# ---------------------------------------------------------------- io helpers

def load_json(path):
    """Return ("ok", value), ("missing", None) or ("invalid", None)."""
    try:
        with io.open(str(path), encoding="utf-8-sig") as handle:
            return "ok", json.load(handle)
    except FileNotFoundError:
        return "missing", None
    except (OSError, ValueError):
        return "invalid", None


def atomic_write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path("{0}.tmp-{1}-{2}".format(path, os.getpid(), int(datetime.now().timestamp() * 1000)))
    try:
        with io.open(str(tmp), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(str(tmp), str(path))
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise


def load_hours_module(path):
    """Load line-bot/tunnel_manager.py (opening-hours helpers) without touching sys.path."""
    spec = importlib.util.spec_from_file_location("_level1_tunnel_manager", str(path))
    if spec is None or spec.loader is None:
        raise ImportError("cannot load hours helpers")
    module = importlib.util.module_from_spec(spec)
    # exec_module may write __pycache__ beside a read-only/live input module.
    exec(compile(Path(path).read_text(encoding="utf-8-sig"), str(path), "exec"), module.__dict__)
    return module


def load_handover(path, hours):
    """Validated handover config via tunnel_manager._validate_config, or None."""
    if hours is None:
        return None
    state, value = load_json(path)
    if state != "ok":
        return None
    try:
        return hours._validate_config(value)
    except (ValueError, TypeError, KeyError):
        return None


def local_tz(hours, config):
    if hours is not None:
        try:
            return hours._timezone(config["tz"] if config else "Asia/Taipei")
        except (ValueError, KeyError, TypeError):
            pass
    return TAIPEI_FALLBACK


def _result(status, reason, **details):
    return {"status": status, "reason": reason, "details": details}


# ------------------------------------------------------ condition 1: freshness

def parse_ts(text, tz):
    if not isinstance(text, str) or not text.strip():
        return None
    value = text.strip()
    if value[-1:] in ("Z", "z"):
        value = value[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(tz)


def read_pull_log(path):
    """(rows, bad_line_count) from mdb_pull.jsonl, or None when it cannot be read."""
    if path is None:
        return None
    try:
        with io.open(str(path), encoding="utf-8-sig", errors="replace") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return None
    rows = []
    bad = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            bad += 1
            continue
        if isinstance(row, dict):
            rows.append(row)
        else:
            bad += 1
    return rows, bad


def is_successful_pull(row):
    code = row.get("exit")
    return type(code) is int and code == 0 and row.get("result") in SUCCESS_PULL_RESULTS


def evaluate_freshness(day, config, hours, pull_log):
    if config is None or hours is None:
        return _result("no_data", "營業時間設定讀不到(line-bot/handover.json),無法判斷")
    window = hours.day_window_for(day, config)
    if window is None:
        return _result("not_required", "公休日,營業時間內不需要資料", closed=True)
    opened, closed = window
    span = "{0:%H:%M}-{1:%H:%M}".format(opened, closed)
    if pull_log is None:
        return _result("no_data", "找不到 MDB 拉取紀錄(mdb_pull.jsonl)", window=span)
    rows, bad_lines = pull_log
    tz = opened.tzinfo
    covered = False
    attempts = 0
    successes = []
    for row in rows:
        ts = parse_ts(row.get("ts"), tz)
        if ts is None:
            continue
        if ts >= opened:
            covered = True
        if opened <= ts <= closed:
            attempts += 1
            if is_successful_pull(row):
                successes.append(ts)
    if not covered:
        return _result("no_data", "MDB 拉取紀錄沒有涵蓋到這一天的營業時間",
                       window=span, bad_lines=bad_lines)
    successes.sort()
    points = [opened] + successes + [closed]
    max_gap = -1.0
    gap_from = gap_to = opened
    for earlier, later in zip(points, points[1:]):
        gap = (later - earlier).total_seconds()
        if gap > max_gap:
            max_gap, gap_from, gap_to = gap, earlier, later
    minutes = int(math.ceil(max_gap / 60.0))
    details = {
        "window": span,
        "successful_pulls": len(successes),
        "attempts_in_window": attempts,
        "max_gap_minutes": minutes,
        "max_gap_from": gap_from.isoformat(timespec="seconds"),
        "max_gap_to": gap_to.isoformat(timespec="seconds"),
        "bad_lines": bad_lines,
    }
    if max_gap <= FRESHNESS_LIMIT_SECONDS:
        return _result("pass", "營業時間內最大資料間隔 {0} 分".format(minutes), **details)
    if not successes:
        reason = "營業時間內({0})沒有一次成功的 MDB 拉取,最大資料間隔 {1} 分".format(span, minutes)
    else:
        reason = "營業時間內最大資料間隔 {0} 分({1:%H:%M}-{2:%H:%M})".format(minutes, gap_from, gap_to)
    return _result("fail", reason, **details)


# --------------------------------------------------------- condition 2: notify

def _valid_count(value):
    return type(value) is int and value >= 0


def evaluate_notify(day, config, hours, notify_path):
    iso = day.isoformat()
    business = None
    if config is not None and hours is not None:
        business = hours.day_window_for(day, config) is not None
    state, data = load_json(notify_path)
    if state == "missing":
        if business is False:
            return _result("not_required", "公休日,不需要到店通知")
        if business is None:
            return _result("no_data", "營業時間設定讀不到,且店裡電腦還沒回報到店通知數字")
        return _result("no_data", "店裡電腦還沒回報到店通知數字(data/gates/notify-{0}.json)".format(iso))
    if state == "invalid":
        return _result("no_data", "到店通知回報檔讀不到或不是 JSON")
    reported_by = data.get("reported_by") if isinstance(data, dict) else None
    if not (isinstance(data, dict) and data.get("date") == iso
            and _valid_count(data.get("sent")) and _valid_count(data.get("wrong_sends"))
            and isinstance(reported_by, str) and reported_by.strip()):
        return _result("no_data", "到店通知回報檔格式不對(需要 date、sent、wrong_sends、reported_by)")
    sent = data["sent"]
    wrong = data["wrong_sends"]
    if wrong > sent:
        return _result("no_data", "到店通知回報數字矛盾(誤發比已發多)")
    details = {"sent": sent, "wrong_sends": wrong, "reported_by": reported_by.strip()}
    if wrong > 0:
        return _result("fail", "誤發 {0} 則(共發 {1} 則)".format(wrong, sent), **details)
    if business is False:
        return _result("not_required", "公休日(已發 {0} 則、誤發 0),不算天數".format(sent), **details)
    if business is None:
        return _result("no_data", "營業時間設定讀不到,無法判斷是不是營業日", **details)
    reason = "已發 {0} 則、誤發 0".format(sent)
    if sent == 0:
        reason += "(當天發 0 則,請確認通知有在跑)"
    return _result("pass", reason, **details)


# ---------------------------------------------------------- condition 3: posts

def _is_int(value):
    return type(value) is int


def _parse_date(value, field):
    if not isinstance(value, str) or not DATE_RE.fullmatch(value.strip()):
        raise PolicyError(field)
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise PolicyError(field) from None


def _platform_list(value, field):
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise PolicyError(field)
    return [v.strip().lower() for v in value]


def _validated_pauses(policy):
    pauses = policy.get("pauses", [])
    if not isinstance(pauses, list):
        raise PolicyError("pauses")
    out = []
    for entry in pauses:
        if not isinstance(entry, dict):
            raise PolicyError("pauses")
        slot = entry.get("slot")
        if "slot" in entry and not _is_int(slot):
            raise PolicyError("pauses.slot")
        platform = entry.get("platform")
        if "platform" in entry and not (isinstance(platform, str) and platform.strip()):
            raise PolicyError("pauses.platform")
        out.append({
            "slot": slot if "slot" in entry else None,
            "platform": platform.strip().lower() if "platform" in entry else None,
            "from": _parse_date(entry["from"], "pauses.from") if "from" in entry else None,
            "to": _parse_date(entry["to"], "pauses.to") if "to" in entry else None,
        })
    return out


def _paused(pauses, slot, platform, day):
    for entry in pauses:
        if entry["slot"] is not None and entry["slot"] != slot:
            continue
        if entry["platform"] is not None and entry["platform"] != platform:
            continue
        if entry["from"] is not None and day < entry["from"]:
            continue
        if entry["to"] is not None and day > entry["to"]:
            continue
        return True
    return False


def scheduled_pairs(policy, day):
    """(sorted [(slot, platform)], note). Raises PolicyError on an unreadable shape."""
    if not isinstance(policy, dict):
        raise PolicyError("policy")
    status = policy.get("status")
    if not isinstance(status, str):
        raise PolicyError("status")
    if status.strip().lower() != "active":
        return [], "發文計畫狀態不是 active({0})".format(status)
    if "start_date" in policy and day < _parse_date(policy["start_date"], "start_date"):
        return [], "發文計畫尚未開始"
    if "end_date" in policy and day > _parse_date(policy["end_date"], "end_date"):
        return [], "發文計畫已結束"
    platforms = _platform_list(policy.get("platforms"), "platforms")
    slots = policy.get("slots")
    if not isinstance(slots, list):
        raise PolicyError("slots")
    pauses = _validated_pauses(policy)
    pairs = set()
    for entry in slots:
        if not isinstance(entry, dict) or not _is_int(entry.get("slot")):
            raise PolicyError("slots")
        number = entry["slot"]
        if entry.get("paused") is True or entry.get("enabled") is False or entry.get("active") is False:
            continue
        if "start_date" in entry and day < _parse_date(entry["start_date"], "slot.start_date"):
            continue
        if "end_date" in entry and day > _parse_date(entry["end_date"], "slot.end_date"):
            continue
        weekdays = entry.get("weekdays")
        if weekdays is not None:
            if not isinstance(weekdays, list) or not all(_is_int(w) and 0 <= w <= 6 for w in weekdays):
                raise PolicyError("slot.weekdays")
            if day.weekday() not in weekdays:
                continue
        slot_platforms = _platform_list(entry["platforms"], "slot.platforms") if "platforms" in entry else platforms
        paused_platforms = (_platform_list(entry["paused_platforms"], "slot.paused_platforms")
                            if "paused_platforms" in entry else [])
        for platform in slot_platforms:
            if platform in paused_platforms or _paused(pauses, number, platform, day):
                continue
            pairs.add((number, platform))
    return sorted(pairs), ""


def _row_slot(value):
    if _is_int(value):
        return value
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        return int(value.strip())
    return None


def _pair_label(slot, platform):
    return "slot {0} {1}".format(slot, PLATFORM_LABELS.get(platform, platform))


def planned_slots(assets_root, day):
    """Slots whose content was produced for `day` (docs/assets/<date>/slot-0N.*), or None
    when that day's assets folder does not exist (then the policy alone decides)."""
    if assets_root is None:
        return None
    folder = Path(assets_root) / day.isoformat()
    if not folder.is_dir():
        return None
    found = set()
    for item in folder.iterdir():
        name = item.name.lower()
        if name.startswith("slot-") and len(name) > 7 and name[5:7].isdigit():
            found.add(int(name[5:7]))
    return found


def _evaluate_posts(day, policy, posted_log_path, assets_root=None):
    iso = day.isoformat()
    if policy is None:
        return _result("no_data", "發文計畫檔讀不到(data/publishing-policy.json)")
    try:
        pairs, note = scheduled_pairs(policy, day)
    except PolicyError as exc:
        return _result("no_data", "發文計畫檔格式看不懂({0})".format(exc))
    planned = planned_slots(assets_root, day)
    if planned is not None:
        pairs = [p for p in pairs if p[0] in planned]
        if not pairs:
            note = note or "當天沒有產出任何排程內容(暫停的時段不算)"
    root = Path(posted_log_path).parent.parent.parent
    _, calendar = load_json(root / "data" / "content-calendar" / (iso + ".json"))
    if isinstance(calendar, dict) and isinstance(calendar.get("slots"), list):
        retired = set(retired_slots(root, iso))
        present = {s.get("slot") for s in calendar["slots"] if isinstance(s, dict)}
        saved = calendar.get("retired_slots", [])
        if not isinstance(saved, list):
            saved = []
        retired.update(s for s in saved if type(s) is int and s > 0 and s not in present)
        # Saved omissions survive policy removal; actual as-aired rows are not
        # changed, only the checklist's expected publications.
        pairs = [p for p in pairs if p[0] not in retired]
    if not pairs:
        return _result("not_required", note or "當天沒有排程的發文")
    state, rows = load_json(posted_log_path)
    if state == "missing":
        return _result("no_data", "當天沒有發文紀錄檔(data/posted-log/{0}.json)".format(iso),
                       scheduled=len(pairs))
    if state == "invalid" or not isinstance(rows, list):
        return _result("no_data", "發文紀錄檔格式不對", scheduled=len(pairs))
    seen = set()
    ok = set()
    for row in rows:
        if not isinstance(row, dict) or row.get("date", iso) != iso:
            continue
        if row.get("dry_run") is not False:
            continue  # dry runs (and rows without an explicit dry_run=false) never count
        slot = _row_slot(row.get("slot"))
        platform = row.get("platform")
        if slot is None or not isinstance(platform, str):
            continue
        pair = (slot, platform.strip().lower())
        seen.add(pair)
        status = row.get("status")
        if isinstance(status, str) and status.strip().lower() == "success":
            ok.add(pair)
    problems = []
    for pair in pairs:
        if pair in ok:
            continue
        problems.append(_pair_label(*pair) + (" 沒成功" if pair in seen else " 沒有紀錄"))
    details = {"scheduled": len(pairs), "succeeded": sum(1 for p in pairs if p in ok),
               "missing": [_pair_label(*p) for p in pairs if p not in ok]}
    if problems:
        return _result("fail", "、".join(problems), **details)
    return _result("pass", "排程 {0} 個(slot/平台)全部成功".format(len(pairs)), **details)


def evaluate_posts(day, policy, posted_log_path, assets_root=None):
    result = _evaluate_posts(day, policy, posted_log_path, assets_root)
    recovery = recovery_summary(posted_log_path.parent.parent / "gates", [day])
    if recovery["text"]:
        result["reason"] += "；" + recovery["text"]
        result["status"] = "no_data" if recovery["unverified"] else "fail"
        result["details"]["recovery_needs_manual"] = recovery["manual"]
        result["details"]["notification_pending"] = recovery["pending"]
    return result


# ----------------------------------------------------------- 12-item checklist

def _gate(status, reason, evidence, **details):
    return {**_result(status, reason, **details), "evidence": [str(p) for p in evidence]}


def _daily(path, day):
    state, value = load_json(path)
    return value if state == "ok" and isinstance(value, dict) and value.get("date") == str(day) else None


def read_service_records(paths):
    """State changes prove transitions only, never periodic service coverage."""
    records, bad, available = [], 0, False
    ai_events = {"night_reclaim", "webhook_update"}
    shop_events = {"day_handover", "handover_to_shop", "handover_return", "handover"}
    for path in paths:
        try:
            with Path(path).open(encoding="utf-8-sig") as handle:
                available = True
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        bad += 1
                        continue
                    if not isinstance(row, dict):
                        bad += 1
                        continue
                    event = row.get("event")
                    if not isinstance(event, str) or event not in ai_events | shop_events:
                        continue
                    stamp = parse_ts(row.get("ts"), TAIPEI_FALLBACK)
                    if stamp is None:
                        bad += 1
                        continue
                    owner = row.get("registered_owner", row.get("owner"))
                    verified = row.get("verify_status") == "match"
                    if event in shop_events and owner == "shop" and verified:
                        records.append((stamp, "shop"))
                    elif event in ai_events and verified and owner in (None, "ai"):
                        records.append((stamp, "ai"))
        except FileNotFoundError:
            continue
        except (OSError, UnicodeError):
            bad += 1
    return sorted(set(records)), bad, available


def _service_transition(records, bad, available, expected, owner, evidence):
    label = "接手" if owner == "ai" else "交還"
    actual = next((stamp for stamp, kind in records
                   if expected <= stamp < expected + timedelta(days=1) and kind == owner), None)
    details = {"expected_at": expected.isoformat(), "actual_at": actual.isoformat() if actual else None}
    if not available or bad:
        return _gate("no_data", label + "事件檔缺失或有無法核對的行", evidence, **details)
    on_time = actual is not None and (actual - expected).total_seconds() <= SERVICE_GAP_SECONDS
    reason = label + ("於指定時間後 5 分內驗證相符" if on_time else "缺指定時間後 5 分內驗證相符的事件")
    return _gate("pass" if on_time else "fail", reason, evidence, **details)


def evaluate_heartbeat(opening, closing, folder):
    """Only the sampler's minute-by-minute LIVE channel checks prove coverage.

    Filenames are UTC dates, as in heartbeat_sampler._write_log. Ping delivery
    and the aggregate exit code do not measure the customer service channel.
    """
    first, last = (stamp.astimezone(timezone.utc).date() for stamp in (opening, closing))
    evidence = ([Path(folder) / f"{first + timedelta(days=n)}.jsonl"
                 for n in range((last - first).days + 1)] if folder is not None else [])
    records, bad, available = {}, 0, False
    channels = ("bot", "local", "public", "line")
    unmeasured = {"OK", "BLOCKED", "SKIPPED_OUTSIDE_AI", "UNMEASURED_DRY_RUN"}
    priority = {"healthy": 0, "unknown": 1, "failed": 2}
    for path in evidence:
        try:
            with path.open(encoding="utf-8-sig") as handle:
                available = True
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        bad += 1
                        continue
                    stamp = parse_ts(row.get("time"), TAIPEI_FALLBACK) if isinstance(row, dict) else None
                    if stamp is None:
                        bad += 1
                        continue
                    if not opening <= stamp <= closing:
                        continue
                    checks = row.get("checks")
                    values = [checks.get(key) for key in channels] if isinstance(checks, dict) else []
                    state = "unknown"
                    if row.get("mode") == "LIVE" and values:
                        if all(value == "OK" for value in values):
                            state = "healthy"
                        elif any(isinstance(value, str) and value not in unmeasured for value in values):
                            state = "failed"
                    # A duplicate success cannot erase a failed/unmeasured sample.
                    records[stamp] = max((records.get(stamp, state), state), key=priority.get)
        except FileNotFoundError:
            continue
        except (OSError, UnicodeError):
            bad += 1
    evidence = evidence or ["%LOCALAPPDATA%/sxj-heartbeat/log/"]
    if not available:
        return _gate("no_data", "缺固定週期心跳日誌，無法判定中間沒停機", evidence,
                     coverage_start=opening.isoformat(), coverage_end=closing.isoformat())
    times = sorted(records)
    maximum = max(((b - a).total_seconds() for a, b in zip(times, times[1:])), default=None)
    failure_start, longest_failure = None, 0
    for stamp in times:
        state = records[stamp]
        if state == "failed":
            failure_start = stamp if failure_start is None else failure_start
        if failure_start is not None:
            if state != "unknown":
                longest_failure = max(longest_failure, (stamp - failure_start).total_seconds())
            if state != "failed":
                failure_start = None
    failures, missing = [], []
    if maximum is not None and maximum > SERVICE_GAP_SECONDS:
        failures.append("固定週期心跳相鄰紀錄間隔 {0:.3f} 秒，超過 300 秒".format(maximum))
    if longest_failure > SERVICE_GAP_SECONDS:
        failures.append("客服通路連續失敗 {0:.3f} 秒，超過 300 秒".format(longest_failure))
    if len(times) < 2:
        missing.append("AI 主責區間心跳紀錄不足")
    elif ((times[0] - opening).total_seconds() > SERVICE_GAP_SECONDS
          or (closing - times[-1]).total_seconds() > SERVICE_GAP_SECONDS):
        missing.append("AI 主責區間邊界缺心跳紀錄")
    if bad or "unknown" in records.values():
        missing.append("心跳有損毀或未實測客服通路的紀錄")
    status = "fail" if failures else "no_data" if missing else "pass"
    reason = "；".join(failures + missing) if failures or missing else "固定週期心跳間隔與客服通路連續失敗均未超過 5 分"
    return _gate(status, reason, evidence, max_observed_gap_seconds=maximum,
                 max_channel_failure_seconds=longest_failure, observations=len(times),
                 coverage_start=opening.isoformat(), coverage_end=closing.isoformat())


def evaluate_service(day, paths, hours, config):
    """One night: tonight's takeover through the following 09:50.

    Sunday/closed dates start at 00:00 (AI all day). State-change logs are
    used only for a/b; c exclusively reads the fixed-period heartbeat sampler.
    """
    records, bad, available = read_service_records(paths.service_logs)
    evidence = paths.service_logs or ["tunnel_events.jsonl"]
    midnight = datetime.combine(day, datetime.min.time(), TAIPEI_FALLBACK)
    tomorrow = day + timedelta(days=1)
    opening = midnight.replace(hour=18 if day.weekday() == 5 else 20, minute=5)
    closing = (midnight + timedelta(days=1)).replace(hour=9, minute=50)
    def closed(when):
        if when.weekday() == 6:
            return True
        if hours is None or config is None:
            return None
        return hours.day_window_for(when, config) is None
    if closed(day) is True:
        opening = midnight
        takeover = _gate("not_applicable", "週日或店休日全天 AI，無當晚接手切換", [paths.handover])
    else:
        takeover = _service_transition(records, bad, available, opening, "ai", evidence)
    if closed(tomorrow) is True:
        handover = _gate("not_applicable", "隔天週日或店休日，不交還店家", [paths.handover])
    elif closed(tomorrow) is None:
        handover = _gate("no_data", "缺營業設定，無法確認隔天是否需要交還", [paths.handover])
    else:
        handover = _service_transition(records, bad, available, closing, "shop", evidence)
    if day >= shop.CUTOVER and closed(tomorrow) is False:
        window = hours.day_window_for(tomorrow, config)
        handover = shop.day_ownership(tomorrow, paths.day_cover_log,
                                      window[0].hour, window[1].hour)
    subchecks = {"a": takeover, "b": handover,
                 "c": evaluate_heartbeat(opening, closing, paths.heartbeat_log_dir)}
    if day >= shop.CUTOVER:
        # The old sampler probes the retired repo bot. Sparse webhook activity
        # and ownership polls cannot certify continuous availability of 18791.
        subchecks['c'] = _gate('no_data', '缺現役 shop runtime 的固定週期客服通路心跳，無法判定中間沒停機',
                               [paths.shop_root / 'logs', paths.heartbeat_log_dir or 'sxj-heartbeat/log'])
    statuses = [item["status"] for item in subchecks.values()]
    status = "fail" if "fail" in statuses else "no_data" if "no_data" in statuses else "pass"
    reason = "；".join(key + " " + label + "：" + subchecks[key]["status"]
                       for key, label in (("a", "接手"), ("b", "交還"), ("c", "中間沒停機")))
    result = _gate(status, reason, dict.fromkeys(p for item in subchecks.values() for p in item["evidence"]))
    result["subchecks"] = subchecks
    return result


def evaluate_accounting(day, path, usage_path=None):
    # Deliberately never open line-unanswered, sessions, inbox, webhook logs or
    # by_intent. line-usage counts decisions, not received/delivered events.
    state, data = load_json(path)
    evidence = [path]
    counts = {"received", "replied_ok", "reply_failed", "to_staff", "no_reply_needed"}
    allowed = counts | {"date", "schema", "generated_at", "complete"}
    if (state != "ok" or not isinstance(data, dict) or not set(data) <= allowed
            or data.get("date", str(day)) != str(day) or data.get("complete", True) is not True
            or not all(_valid_count(data.get(k)) for k in counts)):
        return _gate("no_data", "缺完整收訊、回覆送達與轉真人的互斥筆數；usage 分類不能代替送達證據", evidence)
    received, replied, staff = (data[k] for k in ("received", "replied_ok", "to_staff"))
    answered = replied + staff
    answered += data["no_reply_needed"]
    if answered > received:
        return _gate("no_data", "回覆與轉真人筆數超過收訊，統計互相矛盾", evidence)
    unanswered = received - answered
    return _gate("pass" if unanswered == 0 and data["reply_failed"] == 0 else "fail",
                 "收訊 {0}、回覆 {1}、轉真人 {2}、免回 {3}、沒回 {4}、回覆失敗 {5} 筆".format(
                     received, replied, staff, data["no_reply_needed"], unanswered, data["reply_failed"]),
                 evidence, **{k: data[k] for k in counts}, unanswered=unanswered)


def evaluate_test_evidence(day, path, keys, now):
    data = _daily(path, day)
    if (data is None or data.get("schema") != "level1-offline-checks/v1"
            or data.get("offline") is not True or not isinstance(data.get("checks"), dict)):
        return _gate("no_data", "缺暫存複本離線測試結果，不能用 runner 退出碼當全綠", [path])
    generated = parse_ts(data.get("generated_at"), TAIPEI_FALLBACK)
    if generated is None or generated.date() != day or generated > now:
        return _gate("no_data", "測試證據不是該日產生或時間無法核對，不能回填歷史通過", [path])
    states = []
    total = 0
    for key in keys:
        row = data["checks"].get(key)
        if (not isinstance(row, dict) or row.get("status") not in ("pass", "fail", "no_data")
                or not all(_valid_count(row.get(k)) for k in ("tests", "failures", "errors", "skipped"))):
            states.append("no_data")
            continue
        total += row["tests"]
        if row["failures"] or row["errors"] or row["status"] == "fail":
            states.append("fail")
        elif row["tests"] == 0 or row["skipped"] or row["status"] != "pass":
            states.append("no_data")
        else:
            states.append("pass")
    status = "fail" if "fail" in states else "no_data" if "no_data" in states else "pass"
    reason = {"pass": "離線測試全部通過，共 {0} 例".format(total),
              "fail": "離線測試有失敗或錯誤，已保留結果檔", "no_data": "測試結果有缺漏、跳過或沒有實際案例"}[status]
    return _gate(status, reason, [path], tests=total, suites=list(keys))


def _business(day, config, hours):
    return None if config is None or hours is None else hours.day_window_for(day, config) is not None


def evaluate_notify_delivery(day, paths, config, hours):
    path = paths.gates_dir / "notify-{0}.json".format(day)
    business = _business(day, config, hours)
    data = _daily(path, day)
    if business is False and (data is None or data.get("sent") == 0):
        return _gate("not_applicable", "公休日沒有到件通知需求", [path, paths.handover])
    if business is None or data is None or not all(_valid_count(data.get(k)) for k in ("sent", "no_binding", "abandoned")):
        return _gate("no_data", "缺店機每日 sent、no_binding、abandoned 或營業時間", [path, paths.handover])
    if data.get("outbox") == "missing" or data.get("corrupt_lines", 0) != 0:
        return _gate("no_data", "店機通知來源缺漏或有損毀行，不能當零", [path])
    if data["sent"] == 0:
        return _gate("fail", "營業日沒有發出到件通知；未綁定 {0} 筆".format(data["no_binding"]), [path])
    previous = day - timedelta(days=1)
    for _ in range(14):
        if _business(previous, config, hours):
            break
        previous -= timedelta(days=1)
    prior_path = paths.gates_dir / "notify-{0}.json".format(previous)
    prior = _daily(prior_path, previous)
    evidence = [path, prior_path]
    if (prior is None or not all(_valid_count(prior.get(k)) for k in ("sent", "no_binding", "abandoned"))
            or prior.get("outbox") == "missing" or prior.get("corrupt_lines", 0) != 0):
        return _gate("no_data", "缺前一營業日未綁定比例，無法判斷有沒有下降", evidence)
    denominator = sum(data[k] for k in ("sent", "no_binding", "abandoned"))
    prior_denominator = sum(prior[k] for k in ("sent", "no_binding", "abandoned"))
    if prior_denominator == 0:
        return _gate("no_data", "前一營業日沒有通知樣本，不能用零當比較基準", evidence)
    improved = data["no_binding"] == 0 or data["no_binding"] * prior_denominator < prior["no_binding"] * denominator
    return _gate("pass" if improved else "fail",
                 "已發 {0} 則；未綁定 {1}/{2}，前一營業日 {3}/{4}{5}".format(
                     data["sent"], data["no_binding"], denominator, prior["no_binding"], prior_denominator,
                     "（下降或維持零）" if improved else "（沒有下降）"), evidence)


def evaluate_notify_safety(day, path, config, hours):
    data = _daily(path, day)
    if data is None:
        if _business(day, config, hours) is False and not path.exists():
            return _gate("not_applicable", "公休日沒有到件通知需求", [path])
        return _gate("no_data", "缺店機重發與誤發統計", [path])
    for key in ("duplicates", "wrong_sends"):
        if _valid_count(data.get(key)) and data[key] > 0:
            return _gate("fail", "到件通知{0} {1} 筆".format("重發" if key == "duplicates" else "誤發", data[key]), [path])
    if data.get("wrong_sends_basis") == "auto_duplicate_deliveries":
        return _gate("no_data", "目前 wrong_sends 只量重發；缺寄錯對象的獨立核對與完整性證據", [path])
    if (not all(_valid_count(data.get(k)) for k in ("sent", "duplicates", "wrong_sends"))
            or data.get("outbox") == "missing" or data.get("corrupt_lines") != 0):
        return _gate("no_data", "通知來源完整性或零重發、零誤發數字缺漏", [path])
    if data.get("wrong_sends_basis") != "reviewed_all_deliveries":
        return _gate("no_data", "目前 wrong_sends 只量重發；缺寄錯對象的獨立核對", [path], duplicates=data["duplicates"])
    return _gate("pass", "已核對零重發、零誤發", [path])


def evaluate_recovery(day, paths):
    iso = str(day)
    receipt_paths = sorted(paths.gates_dir.glob("publish-recovery-{0}-slot*-*.json".format(iso)))
    posted = paths.posted_log_dir / (iso + ".json")
    evidence = [posted] + (receipt_paths or [paths.gates_dir / ("publish-recovery-" + iso + "-slot*-*.json")])
    unresolved = set()
    state, rows = load_json(posted)
    if state != "ok" or not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        return _gate("no_data", "缺當日完整 posted-log，無法確認是否有貼文失敗", [posted])
    invalid_log = False
    for row in rows:
        if row.get("dry_run") is True:
            continue
        slot, platform = _row_slot(row.get("slot")), row.get("platform")
        if (row.get("dry_run") is not False or row.get("date", iso) != iso or slot is None
                or platform not in ("facebook", "instagram")
                or row.get("status") not in ("success", "posted", "failed", "uncertain", "skipped")):
            invalid_log = True
            continue
        if row["status"] in ("failed", "uncertain"):
            unresolved.add((slot, platform))
    if not unresolved:
        if invalid_log:
            return _gate("no_data", "posted-log 有無法核對的列，不能推定沒有貼文失敗", evidence)
        return _gate("not_applicable", "當日 posted-log 沒有貼文失敗，沒有需要補發的事", [posted])
    # A later success does not erase the fact that failure handling was needed.
    handled = set()
    invalid = invalid_log
    failed = False
    for path in receipt_paths:
        match = re.fullmatch(r"publish-recovery-(\d{4}-\d{2}-\d{2})-slot([1-3])-(facebook|instagram)\.json", path.name)
        data = _daily(path, day)
        if (match is None or data is None or data.get("slot") != int(match[2]) or data.get("platform") != match[3]
                or data.get("status") not in ("needs_manual", "retry_pending", "retry_claimed", "resolved")
                or not _valid_count(data.get("retry_attempts")) or data["retry_attempts"] > 1):
            invalid = True
            continue
        if ((data["status"] == "resolved" and data["retry_attempts"] == 1)
                or data.get("notification") == "delivered"):
            handled.add((int(match[2]), match[3]))
        else:
            failed = True
    if failed or unresolved - handled:
        return _gate("fail", "貼文失敗尚未重試成功，也沒有通知送達證據", evidence)
    if invalid:
        return _gate("no_data", "補發結果檔無法核對身分、次數或狀態", evidence)
    if not handled:
        return _gate("no_data", "當天沒有補發或通知送達結果，尚未驗證失敗處理", evidence)
    return _gate("pass", "{0} 筆失敗處理已重試成功或通知送達".format(len(handled)), evidence)


def evaluate_restart(day, path):
    # OPS-L1-12: deployment is explicitly not ready. No file or test can override this.
    return _gate("not_ready", "尚未上線：重開機自動恢復與停機通知還沒完成", [path])


def evaluate_nightly(day, path):
    state, data = load_json(path)
    if state == "missing":
        return _gate("fail", "當晚日結報告沒有產出", [path])
    if (state != "ok" or not isinstance(data, dict) or data.get("date") != str(day)
            or not isinstance(data.get("generated_at"), str)):
        return _gate("no_data", "缺當晚日結報告或產出時間", [path])
    value = data["generated_at"]
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        stamp = stamp.replace(tzinfo=TAIPEI_FALLBACK) if stamp.tzinfo is None else stamp.astimezone(TAIPEI_FALLBACK)
    except ValueError:
        return _gate("no_data", "日結報告產出時間無法核對", [path])
    opening = datetime.combine(day, datetime.min.time(), TAIPEI_FALLBACK).replace(hour=22)
    closing = (opening + timedelta(days=1)).replace(hour=1)
    on_time = opening <= stamp <= closing
    return _gate("pass" if on_time else "fail", "當晚報告於 {0:%H:%M} 產出{1}".format(
        stamp, "" if on_time else "，超出當日 22:00 至隔日 01:00"), [path], generated_at=stamp.isoformat())


def evaluate_incidents(day, path):
    data = _daily(path, day)
    if data is None or data.get("complete") is not True or not _valid_count(data.get("customer_affected")):
        return _gate("no_data", "缺完整客人受影響事故統計，不能宣稱上線無事故", [path])
    count = data["customer_affected"]
    return _gate("pass" if count == 0 else "fail", "客人受影響事故 {0} 件".format(count), [path], customer_affected=count)


def evaluate_checklist(day, paths, hours, config, now, conditions=None):
    iso = str(day)
    gate = lambda name: paths.gates_dir / (name + "-" + iso + ".json")
    check_path = paths.checks_root / "output" / "operations" / ("level1-checks-" + iso + ".json")
    state, policy = load_json(paths.policy)
    freshness = (conditions or {}).get("freshness") or evaluate_freshness(day, config, hours, read_pull_log(paths.mdb_log))
    freshness = {**freshness, "evidence": [str(paths.mdb_log or "mdb_pull.jsonl"), str(paths.handover)]}
    if freshness["status"] == "not_required":
        freshness["status"] = "not_applicable"
    # Preserve the existing commander-defined produced-slot schedule and OPS-L1-10
    # recovery override; this card extends acceptance, not publishing policy.
    posts = dict((conditions or {}).get("posts") or evaluate_posts(
        day, policy if state == "ok" else None, paths.posted_log_dir / (iso + ".json"),
        assets_root=paths.root / "docs" / "assets"))
    posts["evidence"] = [str(paths.policy), str(paths.posted_log_dir / (iso + ".json")),
                         str(paths.root / "docs" / "assets" / iso)]
    if posts["status"] == "not_required":
        posts["status"] = "not_applicable"
    current = day >= shop.CUTOVER
    return {
        "1": evaluate_service(day, paths, hours, config),
        "2": (shop.accounting(day, paths.shop_root / 'logs', gate('shop-replies'), now,
                              tunnel_logs=paths.service_logs, day_cover_log=paths.day_cover_log) if current else
              evaluate_accounting(day, paths.root / "data" / "line-events" / (iso + ".json"))),
        "3": (shop.test_evidence(day, check_path, 'facts', now, paths.shop_root) if current else
              evaluate_test_evidence(day, check_path, ("copy_audit", "golden"), now)),
        "4": (shop.test_evidence(day, check_path, 'flows', now, paths.shop_root) if current else
              evaluate_test_evidence(day, check_path, ("line_full",), now)),
        "5": (shop.test_evidence(day, check_path, 'handoff', now, paths.shop_root) if current else
              evaluate_test_evidence(day, check_path, ("handoff",), now)),
        "6": evaluate_notify_delivery(day, paths, config, hours),
        "7": evaluate_notify_safety(day, gate("notify"), config, hours),
        "8": freshness, "9": posts, "10": evaluate_recovery(day, paths),
        "11": evaluate_restart(day, gate("restart")),
        "12": evaluate_nightly(day, paths.root / "output" / "day-reports" / (iso + ".json")),
    }


def _check_status(evaluation, key):
    checklist = evaluation.get("checklist")
    item = checklist.get(key) if isinstance(checklist, dict) else None
    return item.get("status", "no_data") if isinstance(item, dict) else "no_data"


def _day_passed(evaluation):
    return (isinstance(evaluation, dict) and evaluation.get("rules_version") == RULES_VERSION
            and not evaluation.get('partial_day')
            and all(_check_status(evaluation, key) in ("pass", "not_applicable") for key in CHECKLIST_TITLES)
            and (evaluation.get("incidents") or {}).get("status") == "pass")


def checklist_summary(evaluations, newest=None):
    newest = newest if newest is not None else max(evaluations, default=None)
    latest = evaluations.get(newest, {})
    passed = sum(_check_status(latest, key) in ("pass", "not_applicable") for key in CHECKLIST_TITLES)
    count, cursor = 0, newest
    while cursor is not None and count < MAX_STREAK_WALK:
        if not _day_passed(evaluations.get(cursor)):
            break
        count += 1
        cursor -= timedelta(days=1)
    return {"newest": newest, "passed": passed, "day_passed": _day_passed(latest),
            "consecutive_days": count, "met": count >= CHECKLIST_TARGET,
            "blocked": [key for key in CHECKLIST_TITLES if _check_status(latest, key) not in ("pass", "not_applicable")]}


# ------------------------------------------------------------ day + streaks

def evaluate_day(day, paths, hours, config, now):
    iso = day.isoformat()
    policy_state, policy = load_json(paths.policy)
    evaluation = {
        "date": iso,
        "rules_version": RULES_VERSION,
        "generated_at": now.isoformat(timespec="seconds"),
        "inputs": {
            "posted_log": "data/posted-log/{0}.json".format(iso),
            "policy": "data/publishing-policy.json",
            "notify": "data/gates/notify-{0}.json".format(iso),
            "mdb_log": "mdb_pull.jsonl" if paths.mdb_log else None,
            "handover": "line-bot/handover.json",
        },
        "conditions": {
            "freshness": evaluate_freshness(day, config, hours, read_pull_log(paths.mdb_log)),
            "notify": evaluate_notify(day, config, hours, paths.gates_dir / "notify-{0}.json".format(iso)),
            "posts": evaluate_posts(day, policy if policy_state == "ok" else None,
                                    paths.posted_log_dir / "{0}.json".format(iso),
                                    assets_root=Path(paths.root) / "docs" / "assets"),
        },
    }
    evaluation["checklist"] = evaluate_checklist(day, paths, hours, config, now, evaluation["conditions"])
    evaluation["incidents"] = evaluate_incidents(day, paths.gates_dir / ("incidents-" + iso + ".json"))
    return evaluation


def load_evaluations(ops_dir):
    out = {}
    ops_dir = Path(ops_dir)
    if not ops_dir.is_dir():
        return out
    prefix = "level1-gates-"
    for path in ops_dir.glob(prefix + "*.json"):
        stem = path.stem[len(prefix):]
        if not DATE_RE.fullmatch(stem):
            continue
        try:
            day = date.fromisoformat(stem)
        except ValueError:
            continue
        state, data = load_json(path)
        if state == "ok" and isinstance(data, dict) and data.get("date") == stem \
                and isinstance(data.get("conditions"), dict):
            checklist = data.get("checklist")
            if isinstance(checklist, dict):
                # Cached/self-reported green cannot enable a feature explicitly
                # declared not deployed. Keep the disk receipt untouched.
                checklist["11"] = evaluate_restart(day, "data/gates/restart-{0}.json".format(stem))
            elif "checklist" in data:
                data["checklist"] = {}
            out[day] = data
    return out


def _status(evaluation, condition):
    result = (evaluation.get("conditions") or {}).get(condition)
    if not isinstance(result, dict) or result.get("status") not in STATUSES:
        return "no_data"
    return result["status"]


def streak(evaluations, condition, newest=None):
    """Consecutive days ending at `newest`; a missing evaluation breaks the streak."""
    if not evaluations:
        return 0
    day = max(evaluations) if newest is None else newest
    count = 0
    for _ in range(MAX_STREAK_WALK):
        evaluation = evaluations.get(day)
        if evaluation is None:
            break
        status = _status(evaluation, condition)
        if status == "pass":
            count += 1
        elif status == "not_required":
            if NOT_REQUIRED_COUNTS[condition]:
                count += 1
        else:
            break
        day -= timedelta(days=1)
    return count


def level1_summary(evaluations):
    if not evaluations:
        return {"newest": None, "streaks": {c: 0 for c in CONDITIONS}, "met": False}
    newest = max(evaluations)
    streaks = {c: streak(evaluations, c, newest) for c in CONDITIONS}
    return {"newest": newest, "streaks": streaks,
            "met": all(streaks[c] >= STREAK_TARGET for c in CONDITIONS)}


def _cell(evaluation, condition):
    status = _status(evaluation, condition)
    result = (evaluation.get("conditions") or {}).get(condition)
    reason = result.get("reason") if isinstance(result, dict) else "檢查結果缺這一項"
    reason = str(reason or "").replace("|", "/").replace("\r", " ").replace("\n", " ").strip()
    return "{0}:{1}".format(status, reason) if reason else status


def _render_legacy_report(evaluations, now):
    summary = level1_summary(evaluations)
    newest = summary["newest"]
    lines = [
        "# Level 1 每日檢查:單店每天用得起來",
        "",
        "更新:{0};最新檢查日:{1}".format(now.isoformat(timespec="seconds"),
                                       newest.isoformat() if newest else "無"),
        "",
        "## Level 1:{0}".format("已達成" if summary["met"] else "未達成"),
        "",
        "三個條件都要連續 {0} 天以上才算達成。".format(STREAK_TARGET),
        "",
        "| 條件 | 目前連續 | 門檻 | 狀態 |",
        "|---|---|---|---|",
    ]
    for condition in CONDITIONS:
        count = summary["streaks"][condition]
        unit = STREAK_UNITS[condition]
        lines.append("| {0} | {1} {2} | {3} {2} | {4} |".format(
            CONDITION_TITLES[condition], count, unit, STREAK_TARGET,
            "達標" if count >= STREAK_TARGET else "未達標"))
    lines += [
        "",
        "怎麼算:",
        "- pass=過;fail=沒過;no_data=沒有資料(不算過,也不算 0);not_required=當天不需要。",
        "- 條件 1 算日曆天;公休日營業時間內不需要資料,算過。",
        "- 條件 2 只算營業日;公休日不中斷也不加天數;店裡電腦還沒回報的日子是 no_data。",
        "- 條件 3 沒有排程的日子不中斷也不加天數。",
        "- 中間有日期沒跑檢查,連續天數就從那天斷掉。",
        "- 條件 1 只量 MDB 資料間隔;「LINE 回覆帶資料時間」這一半本表量不到。",
        "",
        "## 每日明細(最新在上,最近 {0} 天)".format(REPORT_DAYS),
        "",
        "| 日期 | {0} | {1} | {2} |".format(*(COLUMN_TITLES[c] for c in CONDITIONS)),
        "|---|---|---|---|",
    ]
    if newest is not None:
        cutoff = newest - timedelta(days=REPORT_DAYS - 1)
        for day in sorted((d for d in evaluations if d >= cutoff), reverse=True):
            cells = [_cell(evaluations[day], c) for c in CONDITIONS]
            lines.append("| {0} | {1} | {2} | {3} |".format(day.isoformat(), *cells))
    return "\n".join(lines) + "\n"


def _plain(value):
    return str(value).replace("|", "/").replace("\r", " ").replace("\n", " ")


def render_report(evaluations, now, newest=None):
    summary = checklist_summary(evaluations, newest)
    day = summary["newest"]
    latest = evaluations.get(day, {})
    lines = ["# Level 1 每日 12 項驗收", "",
             "截至 {0}：12 項有 {1} 項算過，{2} 項未過。連續全過 {3} 天（目標 3 天）。".format(
                 day or "尚無已結束日期", summary["passed"], 12-summary["passed"], summary["consecutive_days"]), ""]
    if latest.get('partial_day'):
        lines += ['當日尚未結束：這是截至產生時間的暫看結果，不計全天通過或連續天數。', '']
    for key in summary["blocked"]:
        item = (latest.get("checklist") or {}).get(key, {})
        lines.append("- 第 {0} 項：{1}。".format(key, _plain(item.get("reason", "缺該日檢查資料"))))
    incident = latest.get("incidents") or {"status": "no_data", "reason": "缺完整客人受影響事故統計"}
    if incident.get("status") != "pass":
        lines.append("- 無事故條件：{0}。".format(_plain(incident.get("reason", "無法確認"))))
    lines += ["", "## Level 1:{0}".format("已達成" if summary["met"] else "未達成"), "",
              "12 項全部 pass / not_applicable，且有完整零客人受影響事故統計，才算當天過。",
              "fail、no_data、not_ready、漏日期或舊版三項紀錄都會中斷連續天數；未提供資料不等於零。",
              "第 11 項尚未上線，固定未就緒；目前不能達成連 3 天。", "",
              "更新：{0}".format(now.isoformat(timespec="seconds")), "",
              "| 項目 | 結果 | 白話原因 | 證據路徑 |", "|---|---|---|---|"]
    for key, title in CHECKLIST_TITLES.items():
        item = (latest.get("checklist") or {}).get(key, {})
        lines.append("| {0}. {1} | {2} | {3} | {4} |".format(
            key, title, _check_status(latest, key), _plain(item.get("reason", "缺該日檢查資料")),
            "；".join(_plain(p) for p in item.get("evidence", []))))
        if key == "1":
            for subkey, label in (("a", "接手"), ("b", "交還"), ("c", "中間沒停機")):
                sub = (item.get("subchecks") or {}).get(subkey, {})
                lines.append("| 1{0}. {1} | {2} | {3} | {4} |".format(
                    subkey, label, sub.get("status", "no_data"), _plain(sub.get("reason", "缺子判定資料")),
                    "；".join(_plain(p) for p in sub.get("evidence", []))))
    lines += ["", "## 最近每日驗收", "", "| 日期 | 算過項目 | 當天全過且無事故 |", "|---|---|---|"]
    if day is not None:
        for when in sorted((d for d in evaluations if day-timedelta(days=REPORT_DAYS-1) <= d <= day), reverse=True):
            daily = checklist_summary({when: evaluations[when]}, when)
            lines.append("| {0} | {1}/12 | {2} |".format(when, daily["passed"], "是" if daily["day_passed"] else "否"))
    return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------- main

def main(argv=None, now=None):
    parser = argparse.ArgumentParser(description="Level-1 gate tracker (task card L1-1)")
    parser.add_argument("date", nargs="?", help="YYYY-MM-DD (default: yesterday in Asia/Taipei)")
    parser.add_argument("--root", help="repo root holding data/, line-bot/, output/, reports/")
    parser.add_argument("--out-root", help="separate output root; --root remains read-only")
    parser.add_argument("--mdb-log", help="override path of mdb_pull.jsonl")
    parser.add_argument("--heartbeat-log-dir", help="override fixed-period sxj-heartbeat/log directory")
    parser.add_argument("--hours-module", help="override path of line-bot/tunnel_manager.py")
    parser.add_argument('--day-cover-log', help='override count-only day_cover.jsonl source')
    parser.add_argument('--shop-root', help='current shop runtime (default: nightrun/live)')
    parser.add_argument('--checks-root', help='read isolated test receipt from a separate root')
    parser.add_argument('--partial-day', action='store_true', help='allow today as an explicitly incomplete preview')
    args = parser.parse_args(argv)

    root = Path(args.root or os.environ.get("LEVEL1_GATES_ROOT") or DEFAULT_ROOT)
    paths = Paths(root, mdb_log=args.mdb_log, hours_module=args.hours_module, out_root=args.out_root,
                  heartbeat_log_dir=args.heartbeat_log_dir, day_cover_log=args.day_cover_log,
                  shop_root=args.shop_root, checks_root=args.checks_root)
    hours = None
    try:
        hours = load_hours_module(paths.hours_module)
    except Exception as exc:  # noqa: BLE001 - conditions 1/2 become no_data, 3 still runs
        print("WARN opening-hours helpers unavailable: " + type(exc).__name__, file=sys.stderr)
    config = load_handover(paths.handover, hours)
    if hours is not None and config is None:
        print("WARN line-bot/handover.json missing or invalid", file=sys.stderr)
    tz = local_tz(hours, config)
    now = datetime.now(tz) if now is None else now
    today = now.astimezone(tz).date()
    if args.date:
        if not DATE_RE.fullmatch(args.date):
            parser.error("date must be YYYY-MM-DD")
        try:
            target = date.fromisoformat(args.date)
        except ValueError:
            parser.error("date must be a real calendar date")
    else:
        target = today - timedelta(days=1)
    if target > today or target == today and not args.partial_day:
        print("ERROR {0} has not finished yet in Asia/Taipei; evaluate a past date".format(target),
              file=sys.stderr)
        return 2

    evaluation = evaluate_day(target, paths, hours, config, now)
    if target == today:
        evaluation['partial_day'] = True
    out_path = paths.ops_dir / "level1-gates-{0}.json".format(target.isoformat())
    atomic_write(out_path, json.dumps(evaluation, ensure_ascii=False, indent=1) + "\n")
    evaluations = load_evaluations(paths.ops_dir)
    atomic_write(paths.report, render_report(evaluations, now, target))

    summary = checklist_summary(evaluations, target)
    print("level1-gates {0} (generated {1})".format(target.isoformat(), now.isoformat(timespec="seconds")))
    for key in CHECKLIST_TITLES:
        result = evaluation["checklist"][key]
        print("  {0}: {1} - {2}".format(key, result["status"], result["reason"]))
    print("  consecutive_days: {0}; incidents: {1}".format(summary["consecutive_days"], evaluation["incidents"]["status"]))
    print("  level1_met: {0}".format(summary["met"]))
    return 0


if __name__ == "__main__":
    # The scheduler console decodes cp950; Chinese reasons must not kill print.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
