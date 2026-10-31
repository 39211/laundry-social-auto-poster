#!/usr/bin/env python3
"""Invisible source matching: LINE clicks per minute vs the shop's inquiry timeline.

Stdlib only, Python 3.11+. Every number written here is an inference (label
"推測"): a click and an inquiry close in time are probably, not certainly, the
same person. Because volume is tiny, the same matching is re-run with all
clicks shifted by hours; the mean of those runs is how many matches pure
chance gives (chance_expected), and only the excess over it means anything.

Inputs (read-only):
  data/conversions/inquiry-timeline-<week>.json   (shop PC, inquiry-timeline/v1)
  data/leads/clicks/<date>.json                    (line-click-minutes/v1)
Output:
  data/conversions/timematch-<week>.json           (timematch/v1, atomic write)
Exit: 0 ok, 2 timeline missing/invalid or bad arguments.
"""

import argparse
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys


TAIPEI = timezone(timedelta(hours=8))
TIMELINE_SCHEMA = "inquiry-timeline/v1"
CLICKS_SCHEMA = "line-click-minutes/v1"
OUTPUT_SCHEMA = "timematch/v1"
LABEL = "推測"
SHIFTS_MIN = (-180, -120, -90, -60, 60, 90, 120, 180)
LABELS = ("received", "pending_window", "unknown", "matured_no_receipt")
WEEK_RE = re.compile(r"(\d{4})-W(\d{2})")


class InputError(Exception):
    pass


def week_days(week):
    match = WEEK_RE.fullmatch(week or "")
    if not match:
        raise ValueError("week must look like 2026-W44")
    monday = date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
    return [monday + timedelta(days=i) for i in range(7)]


def default_week(now=None):
    today = (now or datetime.now(TAIPEI)).astimezone(TAIPEI).date()
    monday = today - timedelta(days=today.weekday() + 7)
    year, week, _ = monday.isocalendar()
    return f"{year}-W{week:02}"


def minute_of(value, where):
    """ISO minute with offset -> integer minutes since the epoch."""
    if not isinstance(value, str):
        raise InputError(f"{where}: not a time string")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise InputError(f"{where}: invalid time {value!r}") from exc
    if parsed.tzinfo is None:
        raise InputError(f"{where}: time without offset {value!r}")
    return int(parsed.timestamp()) // 60


def load_timeline(path, week):
    if not path.is_file():
        raise InputError(f"timeline missing: {path}")
    try:
        obj = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise InputError(f"timeline unreadable: {path} ({type(exc).__name__})") from exc
    if not isinstance(obj, dict) or obj.get("schema") != TIMELINE_SCHEMA:
        raise InputError(f"timeline schema is not {TIMELINE_SCHEMA}: {path}")
    if obj.get("week") != week:
        raise InputError(f"timeline week {obj.get('week')!r} does not match {week}")
    if obj.get("status") not in ("complete", "lower_bound"):
        raise InputError("timeline status must be complete or lower_bound")
    revision = obj.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise InputError("timeline revision must be a positive integer")
    entries = obj.get("entries")
    follows = obj.get("follows_without_inquiry")
    if not isinstance(entries, list) or not isinstance(follows, list):
        raise InputError("timeline entries / follows_without_inquiry must be lists")
    parsed = []
    for index, entry in enumerate(entries):
        where = f"entries[{index}]"
        if not isinstance(entry, dict):
            raise InputError(f"{where}: not an object")
        first = minute_of(entry.get("first_minute"), where + ".first_minute")
        raw_follow = entry.get("follow_minute")
        follow = None if raw_follow is None else minute_of(raw_follow, where + ".follow_minute")
        if not isinstance(entry.get("returning"), bool):
            raise InputError(f"{where}.returning must be true or false")
        for policy in ("I7", "B7"):
            if entry.get(policy) not in LABELS:
                raise InputError(f"{where}.{policy} must be one of {', '.join(LABELS)}")
        parsed.append({"first": first, "follow": follow, "returning": entry["returning"], "I7": entry["I7"]})
    follow_minutes = [minute_of(value, f"follows_without_inquiry[{i}]") for i, value in enumerate(follows)]
    return {"status": obj["status"], "revision": revision, "entries": parsed, "follows": follow_minutes}


def load_day_clicks(path, day):
    """List of (minute, source) units, or None when the day is not measured/usable."""
    if not path.is_file():
        return None
    try:
        obj = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, ValueError):
        return None
    if (not isinstance(obj, dict) or obj.get("schema") != CLICKS_SCHEMA or obj.get("status") != "measured"
            or obj.get("date") != day.isoformat() or not isinstance(obj.get("rows"), list)):
        return None
    units = []
    for row in obj["rows"]:
        if not isinstance(row, dict):
            return None
        source, count = row.get("source"), row.get("count")
        if not isinstance(source, str) or not source.strip():
            return None
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            return None
        try:
            minute = minute_of(row.get("minute"), "minute")
        except InputError:
            return None
        units.extend((minute, source.strip()) for _ in range(count))
    return units


def match(clicks, events, before, after, shift=0):
    """Greedy one-to-one by (abs(delta), click_time, event_time, source); returns (click_idx, event_idx)."""
    candidates = []
    for ci, (click_minute, source) in enumerate(clicks):
        click_time = click_minute + shift
        for ei, event in enumerate(events):
            delta = event[0] - click_time
            if -before <= delta <= after:
                candidates.append((abs(delta), click_time, event[0], source, ci, ei))
    candidates.sort()
    used_clicks, used_events, pairs = set(), set(), []
    for *_, ci, ei in candidates:
        if ci in used_clicks or ei in used_events:
            continue
        used_clicks.add(ci)
        used_events.add(ei)
        pairs.append((ci, ei))
    return pairs


def round1(value):
    rounded = round(value, 1)
    return 0.0 if rounded == 0 else float(rounded)


def compute(timeline, clicks, before, after):
    clicks = sorted(clicks)
    events = [(entry["follow"] if entry["follow"] is not None else entry["first"], "entry", entry)
              for entry in timeline["entries"]]
    events += [(minute, "follow_only", None) for minute in timeline["follows"]]

    stats = {}
    for _, source in clicks:
        row = stats.setdefault(source, {
            "source": source, "clicks": 0, "matched": 0, "matched_new_friend": 0, "matched_returning": 0,
            "matched_follow_only": 0, "matched_I7_received": 0, "matched_I7_pending": 0,
            "chance_expected": 0.0, "excess": 0.0})
        row["clicks"] += 1

    pairs = match(clicks, events, before, after)
    matched_events = set()
    for ci, ei in pairs:
        row = stats[clicks[ci][1]]
        row["matched"] += 1
        matched_events.add(ei)
        _, kind, entry = events[ei]
        if kind == "follow_only":
            row["matched_follow_only"] += 1
            continue
        if entry["returning"]:
            row["matched_returning"] += 1
        elif entry["follow"] is not None:
            row["matched_new_friend"] += 1
        if entry["I7"] == "received":
            row["matched_I7_received"] += 1
        elif entry["I7"] == "pending_window":
            row["matched_I7_pending"] += 1

    chance = Counter()
    chance_total = 0
    for shift in SHIFTS_MIN:
        shifted = match(clicks, events, before, after, shift)
        chance_total += len(shifted)
        for ci, _ in shifted:
            chance[clicks[ci][1]] += 1
    for source, row in stats.items():
        row["chance_expected"] = round1(chance[source] / len(SHIFTS_MIN))
        row["excess"] = round1(row["matched"] - row["chance_expected"])

    sources = sorted(stats.values(), key=lambda row: (-row["clicks"], row["source"]))
    entry_count = len(timeline["entries"])
    unmatched = sum(1 for ei in range(entry_count) if ei not in matched_events)
    totals = {"clicks": len(clicks), "matched": len(pairs),
              "chance_expected": round1(chance_total / len(SHIFTS_MIN)),
              "inquiries": entry_count, "unmatched_inquiries": unmatched,
              "follows_without_inquiry": len(timeline["follows"])}
    return sources, totals


def write_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".tmp-{os.getpid()}")
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Time-match LINE clicks to the inquiry timeline (inference only).")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--week", help="ISO week, e.g. 2026-W44; default: last completed week in Asia/Taipei")
    parser.add_argument("--before", type=int, default=2, help="minutes an inquiry may precede a click")
    parser.add_argument("--after", type=int, default=20, help="minutes an inquiry may follow a click")
    args = parser.parse_args(argv)
    if args.before < 0 or args.after < 0:
        parser.error("--before and --after must be >= 0")
    week = args.week or default_week()
    try:
        days = week_days(week)
    except ValueError as exc:
        parser.error(str(exc))
    root = args.root.resolve()

    try:
        timeline = load_timeline(root / "data" / "conversions" / f"inquiry-timeline-{week}.json", week)
    except InputError as exc:
        print(str(exc))
        return 2

    clicks, missing = [], []
    for day in days:
        units = load_day_clicks(root / "data" / "leads" / "clicks" / f"{day.isoformat()}.json", day)
        if units is None:
            missing.append(day.isoformat())
        else:
            clicks.extend(units)

    sources, totals = compute(timeline, clicks, args.before, args.after)
    output = {
        "schema": OUTPUT_SCHEMA,
        "week": week,
        "generated_at": datetime.now(TAIPEI).isoformat(timespec="seconds"),
        "label": LABEL,
        "method": {"before_min": args.before, "after_min": args.after, "shifts_min": list(SHIFTS_MIN)},
        "timeline_status": timeline["status"],
        "timeline_revision": timeline["revision"],
        "clicks_coverage": {"days_measured": 7 - len(missing), "missing_days": missing},
        "sources": sources,
        "totals": totals,
    }
    target = root / "data" / "conversions" / f"timematch-{week}.json"
    write_atomic(target, output)
    print(f"timematch {week} (inference only): clicks {totals['clicks']}, matched {totals['matched']}, "
          f"chance_expected {totals['chance_expected']}, inquiries {totals['inquiries']}, "
          f"unmatched {totals['unmatched_inquiries']}, click days {7 - len(missing)}/7 -> {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
