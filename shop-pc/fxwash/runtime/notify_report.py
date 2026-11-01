r"""N1: daily arrival-notify counts from the notification outbox (READ-ONLY).

Reads data/notify_outbox.jsonl (written by runtime/inbound_monitor.py) and
prints ONE JSON object (schema notify-report/v1) to stdout. It never writes
anything and never prints uid, dno, did, messages or any other record text:
only counts and HH:MM times.

Usage (from the shop root):
  python -I -S -B runtime\notify_report.py --root . --date 2026-11-02 [--date ...]
Default dates: today and yesterday (Asia/Taipei).

Counting is per Asia/Taipei calendar day of a record's ts. A delivery key is
(kind, dno, did, uid). Records are processed in file (append) order.
  sent         keys whose FIRST "done" record falls on the day
  duplicates   further "done" records for an already-done key (a resend; the
               outbox exists to prevent this)
  wrong_sends  = duplicates: the only automatically detectable wrong send.
               Sending to the wrong person is not detectable from the outbox.
  abandoned    keys whose final status is abandoned, counted on the day they
               became abandoned; uid "" (no LINE binding) counts as no_binding
  pending      keys whose latest status at the end of the day is pending
  first_ts / last_ts  HH:MM of the first / last "done" record on the day

A corrupt line is skipped and counted in "corrupt_lines". A missing outbox
gives all-zero days with "outbox": "missing".
Exit: 0 report printed, 2 bad arguments, 3 outbox present but unreadable.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SCHEMA = "notify-report/v1"
REPORTED_BY = "shop-notify-report"
WRONG_SENDS_BASIS = "auto_duplicate_deliveries"
STATUSES = ("pending", "done", "abandoned")
# Taiwan has observed no DST since 1979; a fixed offset needs no tzdata, which
# the embedded runtime may not have.
TAIPEI = timezone(timedelta(hours=8), "Asia/Taipei")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DEFAULT_ROOT = Path(__file__).resolve().parent.parent


def outbox_path(root) -> Path:
    return Path(root) / "data" / "notify_outbox.jsonl"


def parse_record(raw: bytes):
    """(key, status, Taipei datetime) for a valid line, None for a corrupt one."""
    try:
        record = json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError):  # includes UnicodeDecodeError
        return None
    if not isinstance(record, dict):
        return None
    kind, dno, did, uid = (record.get(name) for name in ("kind", "dno", "did", "uid"))
    if not all(isinstance(value, str) for value in (kind, dno, did, uid)):
        return None
    status = record.get("status")
    if not isinstance(status, str) or status not in STATUSES:
        return None
    ts = record.get("ts")
    if isinstance(ts, bool) or not isinstance(ts, (int, float)) or not math.isfinite(ts):
        return None
    try:
        moment = datetime.fromtimestamp(ts, TAIPEI)
    except (OverflowError, OSError, ValueError):
        return None
    return (kind, dno, did, uid), status, moment


def read_outbox(path: Path):
    """(records, corrupt_count). Opens the file read-only; raises OSError."""
    records = []
    corrupt = 0
    with open(path, "rb") as stream:
        for raw in stream:
            if not raw.strip():
                continue
            parsed = parse_record(raw)
            if parsed is None:
                corrupt += 1
            else:
                records.append(parsed)
    return records, corrupt


def summarize(records, days) -> dict:
    stats = {day: {"sent": 0, "duplicates": 0, "abandoned": 0, "no_binding": 0, "pending": 0,
                   "first": None, "last": None} for day in days}
    done_keys = set()
    history = {}         # key -> [(day, status)], same-day runs collapsed
    abandoned_from = {}  # key -> day the current abandoned run started
    for key, status, moment in records:
        day = moment.date()
        entry = stats.get(day)
        if status == "done":
            if key in done_keys:
                if entry is not None:
                    entry["duplicates"] += 1
            else:
                done_keys.add(key)
                if entry is not None:
                    entry["sent"] += 1
            if entry is not None:
                if entry["first"] is None or moment < entry["first"]:
                    entry["first"] = moment
                if entry["last"] is None or moment > entry["last"]:
                    entry["last"] = moment
        steps = history.setdefault(key, [])
        previous = steps[-1][1] if steps else None
        if steps and steps[-1][0] == day:
            steps[-1] = (day, status)
        else:
            steps.append((day, status))
        if status == "abandoned":
            if previous != "abandoned":
                abandoned_from[key] = day
        else:
            abandoned_from.pop(key, None)
    for key, steps in history.items():
        if steps[-1][1] == "abandoned":
            entry = stats.get(abandoned_from[key])
            if entry is not None:
                entry["no_binding" if key[3] == "" else "abandoned"] += 1
        for day, entry in stats.items():
            status_at_end = None
            for when, value in steps:
                if when <= day:
                    status_at_end = value
            if status_at_end == "pending":
                entry["pending"] += 1
    return stats


def _hhmm(moment):
    return moment.strftime("%H:%M") if moment is not None else None


def build_report(root, days, now) -> dict:
    try:
        records, corrupt = read_outbox(outbox_path(root))
        outbox = "ok"
    except FileNotFoundError:
        records, corrupt, outbox = [], 0, "missing"
    stats = summarize(records, days)
    out_days = []
    for day in days:
        entry = stats[day]
        out_days.append({
            "date": day.isoformat(),
            "sent": entry["sent"],
            "wrong_sends": entry["duplicates"],
            "wrong_sends_basis": WRONG_SENDS_BASIS,
            "duplicates": entry["duplicates"],
            "abandoned": entry["abandoned"],
            "no_binding": entry["no_binding"],
            "pending": entry["pending"],
            "first_ts": _hhmm(entry["first"]),
            "last_ts": _hhmm(entry["last"]),
            "reported_by": REPORTED_BY,
        })
    return {
        "schema": SCHEMA,
        "generated_at": now.isoformat(timespec="seconds"),
        "outbox": outbox,
        "corrupt_lines": corrupt,
        "days": out_days,
    }


def _parse_date(text):
    if not DATE_RE.fullmatch(text):
        raise argparse.ArgumentTypeError("date must be YYYY-MM-DD")
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError("date must be a real calendar date") from None


def main(argv=None, now=None) -> int:
    parser = argparse.ArgumentParser(description="Read-only daily arrival-notify counts (N1)")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="shop root holding data/")
    parser.add_argument("--date", action="append", type=_parse_date, dest="dates",
                        help="YYYY-MM-DD (repeatable; default: yesterday and today, Asia/Taipei)")
    args = parser.parse_args(argv)
    if now is None:
        now = datetime.now(TAIPEI)
    elif now.tzinfo is None or now.utcoffset() is None:
        now = now.replace(tzinfo=TAIPEI)
    now = now.astimezone(TAIPEI)
    today = now.date()
    days = sorted(set(args.dates)) if args.dates else [today - timedelta(days=1), today]
    try:
        report = build_report(args.root, days, now)
    except OSError as exc:
        print(f"ERROR outbox unreadable ({type(exc).__name__})", file=sys.stderr)
        return 3
    sys.stdout.write(json.dumps(report, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
