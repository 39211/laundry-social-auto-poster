# -*- coding: utf-8 -*-
"""Daily counts of how the ai PC LINE bot handled each customer event (task card L2-1).

File: data/line-usage/<YYYY-MM-DD>.json (Asia/Taipei date, fixed UTC+8), schema line-usage/v1:
  {"schema": "line-usage/v1", "date": "YYYY-MM-DD", "messages": int,
   "by_outcome": {"auto": int, "ai": int, "to_staff": int, "not_understood": int, "other": int},
   "by_intent": {"<intent>": int}}

Only integers and intent names are stored. Intent names must be lower-case letters and "_"
(no digits at all), so a uid, customer text, name, phone, address, price or event id can never
reach the file. Anything else is stored as "invalid".

Counting is best effort: every failure is swallowed and logged once, the lock wait is bounded,
and the reply that was already decided is never touched.

CLI: python line-bot/line_usage.py report --days 7
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import tempfile
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

LOG = logging.getLogger("line_usage")

TAIPEI = timezone(timedelta(hours=8))  # fixed UTC+8, same as photo_estimate.TAIPEI
SCHEMA = "line-usage/v1"
KEYS = ("schema", "date", "messages", "by_outcome", "by_intent")
OUTCOMES = ("auto", "ai", "to_staff", "not_understood", "other")
TEXT_OUTCOMES = ("auto", "ai", "to_staff", "not_understood")
TEXT_EVENT = "message"
INTENT_RE = re.compile(r"[a-z][a-z_]{0,39}")
NO_INTENT = "none"
BAD_INTENT = "invalid"
OVERFLOW_INTENT = "overflow"
MAX_INTENTS = 200
LOCK_SECONDS = 0.5
# Meta flags meaning "staff was told about this message" (conversation._pack / ai_chat).
STAFF_FLAGS = ("notify_staff", "staff_pushed", "notify")

# Intent -> outcome for TEXT messages. Unknown intents count as "auto" (still listed in by_intent).
# Order of rules in outcome_for(): non-text -> other; not_understood/to_staff from this table;
# staff flag in meta -> to_staff; otherwise this table or "auto".
OUTCOME_BY_INTENT = {
    # The bot could not tell what the customer wanted.
    "fallback": "not_understood",        # V4/V5 stages 1-2, and stage 3 (staff ping) too
    "meta_feedback": "not_understood",   # customer says the bot's answer missed
    # Staff takes over / must confirm.
    "human": "to_staff",
    "complaint": "to_staff",
    "shop_question": "to_staff",
    "payment_check": "to_staff",
    "photo_need": "to_staff",
    "in_store": "to_staff",
    "unknown_item": "to_staff",
    "pickup_policy": "to_staff",
    "ai_staff": "to_staff",
    # Answered by the AI chat layer.
    "ai_answer": "ai",
    "ai_side_question": "ai",
    "ai_resolved": "ai",
    # Answered by the bot's own rules (to_staff when meta says staff was notified).
    "query": "auto",
    "pickup": "auto",
    "pickup_info": "auto",
    "pickup_address_question": "auto",
    "concern": "auto",
    "cancel": "auto",
    "quote": "auto",
    "prices": "auto",
    "clarify": "auto",
    "clarify_item": "auto",
    "clarify_pickup": "auto",
    "ask_price": "auto",
    "faq": "auto",
    "hours_day": "auto",
    "location": "auto",
    "phone": "auto",
    "pre_wash": "auto",
    "pay": "auto",
    "photo_quote": "auto",
    "photo_ask": "auto",
    "booking": "auto",
    "my_booking": "auto",
    "wash_ask": "auto",
    "wash_type": "auto",
    "works": "auto",
    "courtesy": "auto",
    "welcome": "auto",
    "ack": "auto",
    "who_am_i": "auto",
    # Only produced by non-text events (always "other" there).
    "image": "other",
    "image_error": "other",
}

_LOCK = threading.Lock()
_WARN_LOCK = threading.Lock()
_WARNED = False


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------
def intent_key(intent) -> str:
    """The name stored in by_intent: a safe intent name, 'none' or 'invalid'."""
    if intent is None or intent == "":
        return NO_INTENT
    if isinstance(intent, str) and INTENT_RE.fullmatch(intent):
        return intent
    return BAD_INTENT


def staff_notified(meta) -> bool:
    return isinstance(meta, dict) and any(bool(meta.get(key)) for key in STAFF_FLAGS)


def outcome_for(intent, event_type: str = TEXT_EVENT, meta=None) -> str:
    if event_type != TEXT_EVENT:
        return "other"
    fixed = OUTCOME_BY_INTENT.get(intent) if isinstance(intent, str) else None
    if fixed in ("not_understood", "to_staff"):
        return fixed
    if staff_notified(meta):
        return "to_staff"
    if fixed in ("auto", "ai"):
        return fixed
    return "auto"


# ---------------------------------------------------------------------------
# Paths and dates
# ---------------------------------------------------------------------------
def usage_dir(repo=None) -> Path:
    raw = os.environ.get("LAUNDRY_LINE_USAGE_DIR", "").strip()
    if raw:
        return Path(raw)
    if repo:
        return Path(repo) / "data" / "line-usage"
    env_repo = os.environ.get("LAUNDRY_REPO_ROOT", "").strip()
    if env_repo:
        return Path(env_repo) / "data" / "line-usage"
    return Path(__file__).resolve().parent.parent / "data" / "line-usage"


def today_taipei(now: datetime | None = None) -> date:
    moment = now or datetime.now(TAIPEI)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=TAIPEI)
    return moment.astimezone(TAIPEI).date()


# ---------------------------------------------------------------------------
# File format
# ---------------------------------------------------------------------------
def _count(value) -> bool:
    return type(value) is int and value >= 0


def valid(data, day: str) -> bool:
    if not isinstance(data, dict) or set(data) != set(KEYS):
        return False
    if data["schema"] != SCHEMA or data["date"] != day or not _count(data["messages"]):
        return False
    outcomes, intents = data["by_outcome"], data["by_intent"]
    if not isinstance(outcomes, dict) or not isinstance(intents, dict):
        return False
    if any(key not in OUTCOMES or not _count(value) for key, value in outcomes.items()):
        return False
    if len(intents) > MAX_INTENTS + 1:
        return False
    for key, value in intents.items():
        if not isinstance(key, str) or not INTENT_RE.fullmatch(key) or not _count(value):
            return False
    return sum(outcomes.values()) == data["messages"]


def _empty(day: str) -> dict:
    return {"schema": SCHEMA, "date": day, "messages": 0,
            "by_outcome": {key: 0 for key in OUTCOMES}, "by_intent": {}}


def _normalized(data: dict) -> dict:
    return {"schema": SCHEMA, "date": data["date"], "messages": data["messages"],
            "by_outcome": {key: data["by_outcome"].get(key, 0) for key in OUTCOMES},
            "by_intent": {key: data["by_intent"][key] for key in sorted(data["by_intent"])}}


def _render(data: dict) -> str:
    return json.dumps(_normalized(data), ensure_ascii=True, indent=1) + "\n"


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _store(directory: Path, day: str, outcome: str, intent: str) -> None:
    if not _LOCK.acquire(timeout=LOCK_SECONDS):
        raise TimeoutError("line usage lock busy")
    try:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{day}.json"
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            raw = None
        # Any other read error propagates: never overwrite what we could not read.
        data = None
        if raw is not None:
            try:
                data = json.loads(raw.decode("utf-8"))
            except (ValueError, RecursionError):
                data = None
            if not valid(data, day):
                os.replace(path, path.with_name(path.name + ".bad"))
                data = None
        data = _normalized(data) if data is not None else _empty(day)
        data["messages"] += 1
        data["by_outcome"][outcome] += 1
        intents = data["by_intent"]
        if intent not in intents and len(intents) >= MAX_INTENTS:
            intent = OVERFLOW_INTENT
        intents[intent] = intents.get(intent, 0) + 1
        _atomic_write(path, _render(data))
    finally:
        _LOCK.release()


def _warn_once(exc: BaseException) -> None:
    global _WARNED
    with _WARN_LOCK:
        if _WARNED:
            return
        _WARNED = True
    try:
        LOG.warning("line usage count skipped (%s); later failures stay silent", type(exc).__name__)
    except Exception:
        pass


def count_reply(result, event_type: str = TEXT_EVENT, *, repo=None, now: datetime | None = None) -> None:
    """Count one handled event from handle_ex's (messages, meta). Never raises."""
    try:
        meta = result[1] if isinstance(result, tuple) and len(result) >= 2 else None
        if not isinstance(meta, dict):
            meta = {}
        intent = meta.get("intent")
        key = intent_key(intent)
        outcome = outcome_for(key if key == intent else None, event_type, meta)
        _store(usage_dir(repo), today_taipei(now).isoformat(), outcome, key)
    except Exception as exc:
        _warn_once(exc)


# ---------------------------------------------------------------------------
# Reading and summaries (also used by scripts/daily_progress.py and scripts/weekly-report.py)
# ---------------------------------------------------------------------------
def load_day(directory, day) -> tuple[str, dict | None]:
    """('ok', data) / ('missing', None) / ('invalid', None)."""
    day = str(day)
    path = Path(directory) / f"{day}.json"
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return "missing", None
    except OSError:
        return "invalid", None
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError):
        return "invalid", None
    if not valid(data, day):
        return "invalid", None
    return "ok", _normalized(data)


def summarize(directory, days) -> dict:
    out = {"days": 0, "have": 0, "invalid": 0, "messages": 0, **{key: 0 for key in OUTCOMES}}
    for day in days:
        out["days"] += 1
        state, data = load_day(directory, day)
        if state == "ok":
            out["have"] += 1
            out["messages"] += data["messages"]
            for key in OUTCOMES:
                out[key] += data["by_outcome"][key]
        elif state == "invalid":
            out["invalid"] += 1
    out["text"] = sum(out[key] for key in TEXT_OUTCOMES)
    return out


def _pct_int(part: int, whole: int) -> str:
    return f"{(part * 200 + whole) // (2 * whole)}%"


def describe(summary: dict) -> str:
    """One Chinese line for the owner reports. Missing data is never shown as 0%."""
    s = summary
    if s["days"] == 0:
        return "還沒有已結束的日期"
    if s["have"] == 0:
        if s["invalid"]:
            return f"未知（{s['invalid']} 天的檔案無法讀取，不補 0）"
        return "還沒有資料"
    if s["text"] == 0:
        body = f"有紀錄但沒有文字訊息（其他事件 {s['other']} 則），算不出比例"
    else:
        handled = s["auto"] + s["ai"]
        body = (f"bot 自己處理 {_pct_int(handled, s['text'])}"
                f"（自動 {s['auto']} + AI {s['ai']}，共 {s['text']} 則文字訊息）；"
                f"轉店員 {s['to_staff']}、沒聽懂 {s['not_understood']}")
    if s["have"] < s["days"]:
        note = f"（{s['days']} 天中只有 {s['have']} 天有資料"
        if s["invalid"]:
            note += f"，{s['invalid']} 天檔案無法讀取"
        body = "推測：" + body + note + "）"
    return body


def _rates(s: dict) -> str:
    text = s["text"]
    if text == 0:
        return f"messages={s['messages']} text=0  (no text messages; rates n/a)"
    pct = {key: f"{100 * s[key] / text:.1f}%" for key in TEXT_OUTCOMES}
    return (f"messages={s['messages']} text={text}  auto={pct['auto']} ai={pct['ai']} "
            f"to_staff={pct['to_staff']} not_understood={pct['not_understood']}")


def report_lines(days: int = 7, directory=None, end: date | None = None) -> list[str]:
    folder = Path(directory) if directory else usage_dir()
    last = end or today_taipei()
    window = [last - timedelta(days=offset) for offset in range(days)]
    lines = ["LINE bot usage (percentages over text messages only)"]
    for day in window:
        one = summarize(folder, [day])
        if one["have"]:
            lines.append(f"{day.isoformat()}  {_rates(one)}")
        elif one["invalid"]:
            lines.append(f"{day.isoformat()}  unreadable")
        else:
            lines.append(f"{day.isoformat()}  no data")
    total = summarize(folder, window)
    label = f"{days}-day total"
    if total["have"] == 0:
        extra = f" ({total['invalid']} unreadable)" if total["invalid"] else ""
        lines.append(f"{label}  no data{extra}")
    else:
        partial = f"  (partial: {total['have']}/{days} days with data)" if total["have"] < days else ""
        lines.append(f"{label}  {_rates(total)}{partial}")
    return lines


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="line_usage.py", description="LINE bot usage counts (counts only).")
    sub = parser.add_subparsers(dest="command", required=True)
    report = sub.add_parser("report", help="per-day handled-by-bot rates")
    report.add_argument("--days", type=int, default=7)
    report.add_argument("--dir", type=Path, default=None, help="usage folder (default data/line-usage)")
    report.add_argument("--date", default=None, help="last day YYYY-MM-DD (Taipei); default today")
    args = parser.parse_args(argv)
    end = None
    if args.date:
        try:
            end = date.fromisoformat(args.date)
        except ValueError:
            parser.error("--date must be YYYY-MM-DD")
    for line in report_lines(max(1, min(args.days, 366)), args.dir, end):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
