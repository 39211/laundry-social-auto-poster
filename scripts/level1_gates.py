#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Level-1 gate tracker (task card L1-1: single shop usable every day).

Evaluates one Asia/Taipei calendar date (default: yesterday) against the owner's
three Level-1 conditions, writes output/operations/level1-gates-<date>.json and
rebuilds reports/level1-gates.md (newest first, last 30 days, current streaks).

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

RULES_VERSION = 1
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
    def __init__(self, root, mdb_log=None, hours_module=None):
        root = Path(root)
        self.root = root
        self.policy = root / "data" / "publishing-policy.json"
        self.posted_log_dir = root / "data" / "posted-log"
        self.gates_dir = root / "data" / "gates"
        self.handover = root / "line-bot" / "handover.json"
        self.hours_module = Path(hours_module) if hours_module else root / "line-bot" / "tunnel_manager.py"
        if mdb_log:
            self.mdb_log = Path(mdb_log)
        else:
            base = os.environ.get("LOCALAPPDATA")
            self.mdb_log = Path(base) / "line-bot" / "mdb_pull.jsonl" if base else None
        self.ops_dir = root / "output" / "operations"
        self.report = root / "reports" / "level1-gates.md"


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
    spec.loader.exec_module(module)
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


def evaluate_posts(day, policy, posted_log_path, assets_root=None):
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


# ------------------------------------------------------------ day + streaks

def evaluate_day(day, paths, hours, config, now):
    iso = day.isoformat()
    policy_state, policy = load_json(paths.policy)
    return {
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


def render_report(evaluations, now):
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


# ----------------------------------------------------------------------- main

def main(argv=None, now=None):
    parser = argparse.ArgumentParser(description="Level-1 gate tracker (task card L1-1)")
    parser.add_argument("date", nargs="?", help="YYYY-MM-DD (default: yesterday in Asia/Taipei)")
    parser.add_argument("--root", help="repo root holding data/, line-bot/, output/, reports/")
    parser.add_argument("--mdb-log", help="override path of mdb_pull.jsonl")
    parser.add_argument("--hours-module", help="override path of line-bot/tunnel_manager.py")
    args = parser.parse_args(argv)

    root = Path(args.root or os.environ.get("LEVEL1_GATES_ROOT") or DEFAULT_ROOT)
    paths = Paths(root, mdb_log=args.mdb_log, hours_module=args.hours_module)
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
    if target >= today:
        print("ERROR {0} has not finished yet in Asia/Taipei; evaluate a past date".format(target),
              file=sys.stderr)
        return 2

    evaluation = evaluate_day(target, paths, hours, config, now)
    out_path = paths.ops_dir / "level1-gates-{0}.json".format(target.isoformat())
    atomic_write(out_path, json.dumps(evaluation, ensure_ascii=False, indent=1) + "\n")
    evaluations = load_evaluations(paths.ops_dir)
    atomic_write(paths.report, render_report(evaluations, now))

    summary = level1_summary(evaluations)
    print("level1-gates {0} (generated {1})".format(target.isoformat(), now.isoformat(timespec="seconds")))
    for condition in CONDITIONS:
        result = evaluation["conditions"][condition]
        print("  {0}: {1} - {2} (streak {3})".format(condition, result["status"], result["reason"],
                                                     summary["streaks"][condition]))
    print("  level1_met: {0}".format(summary["met"]))
    return 0


if __name__ == "__main__":
    # The scheduler console decodes cp950; Chinese reasons must not kill print.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
