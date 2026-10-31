"""Offline weekly exporter: inquiry ledger + bindings + POS intake -> per-source summary.

Implements B2 design sections 4.2, 5 and 6.2 (policy v1):

  * Replays data/inquiries.jsonl (read-only). Rows are deduped by event_id and
    sorted by (ts, event_id). Corrupt or truncated lines become coverage gaps.
  * Inquiry = first qualifying message_observed per (shop, OA, user_key, Taipei day).
  * The identity timeline comes from binding_observed / binding_confirmed /
    binding_revoked. Only confirmed bindings feed the main numbers.
  * POS pieces come from an injectable iterable of dicts. Each piece is allocated
    at most once per policy (I7 and B7) to the nearest preceding eligible inquiry.
  * Output is data/conversions/source-to-order-<ISO week>.json. It holds
    aggregates only: no user_key, cid_key, event ids, names, phones or text.

stdlib only. Never writes to the ledger, the registry or the POS.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

try:
    import attribution_service as asvc
except ImportError:  # run as a script under -I: the script dir is not on sys.path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import attribution_service as asvc

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1
POLICY_VERSION = "v1"
TIMEZONE_NAME = "Asia/Taipei"
TZ = asvc.TZ_TAIPEI
UTC = timezone.utc
WINDOW = timedelta(hours=168)
# Longest attribution horizon after an inquiry. B7 accepts a binding that starts
# before t_i + WINDOW (setup_policy: chosen.start < deadline), then opens its own
# WINDOW from t_b. So every maturity_end <= t_i + 2 * WINDOW (14 days). I7 and
# identity_ambiguous end earlier.
MATURITY_HORIZON = 2 * WINDOW
FAR_PAST = datetime(1970, 1, 1, tzinfo=UTC)
FAR_FUTURE = datetime(2100, 1, 1, tzinfo=UTC)
FINGERPRINT_LABEL = b"fxwash-attribution-key-fingerprint-v1"

NO, MAYBE, YES = 0, 1, 2  # tri-state for "is this receipt inside that interval"

INTENTS = ("quote", "lookup", "pickup", "other")
UNKNOWN_SOURCE = "unknown"
POLICIES = ("I7", "B7")
BINDING_KINDS = frozenset({"binding_observed", "binding_confirmed", "binding_revoked"})
BOOKING_KINDS = frozenset({"booking_confirmed", "booking_cancelled"})

ST_RECEIVED = "received"
ST_PENDING = "pending"
ST_UNKNOWN = "unknown"
ST_NO_RECEIPT = "matured_no_receipt"
STATUS_FIELDS = {
    ST_RECEIVED: "received_inquiries",
    ST_PENDING: "pending_window",
    ST_UNKNOWN: "unknown_inquiries",
    ST_NO_RECEIPT: "matured_no_receipt",
}

# Identity / source / allocation undecidable: beats "received".
HARD_UNKNOWN = frozenset({
    "identity_ambiguous", "shared_cid_conflict", "source_after_receipt",
    "date_boundary_unknown", "allocation_undecidable",
    "pre_binding_receipt_candidate", "late_binding",
})
# Coverage / POS gaps: only matter when nothing was received.
GAP_UNKNOWN = frozenset({"ledger_gap", "pos_conflict", "received_at_unparseable"})

POS_VERIFIED = "verified"
POS_DET_UNVERIFIED = "det_snapshot_unverified"
POS_OFFLINE_UNVERIFIED = "offline_json_unverified"

_WEEK_RE = re.compile(r"^([0-9]{4})-W([0-9]{2})$")
_POS_DATE_RE = re.compile(r"^([0-9]{2,4})[/\-.]([0-9]{1,2})[/\-.]([0-9]{1,2})(?:[ T]+(.+))?$")
_MARKERS = r"AM|PM|\u4e0a\u5348|\u4e0b\u5348"
_POS_TIME_RE = re.compile(
    r"^(?:(" + _MARKERS + r")\s*)?([0-9]{1,2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,6})?)?"
    r"(?:\s*(" + _MARKERS + r"))?$",
    re.IGNORECASE,
)
_PM_MARKERS = frozenset({"PM", "\u4e0b\u5348"})
_AM_MARKERS = frozenset({"AM", "\u4e0a\u5348"})


class ExportError(Exception):
    """Fatal, user-facing error. Messages never contain customer data."""


# ---------------------------------------------------------------------------
# Time helpers (pure)
# ---------------------------------------------------------------------------

def parse_ts(value: Any) -> Optional[datetime]:
    """ISO timestamp -> aware UTC datetime. Naive values are taken as Asia/Taipei."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value.strip():
        try:
            dt = datetime.fromisoformat(value.strip())
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(UTC)


def fmt(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(TZ).isoformat(timespec="seconds") if dt is not None else None


def taipei_day(dt: datetime) -> date:
    return dt.astimezone(TZ).date()


def day_start(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=TZ).astimezone(UTC)


def iso_week_bounds(week: str) -> tuple:
    """'2026-W44' -> (Monday 00:00 Taipei, next Monday 00:00 Taipei) in UTC."""
    m = _WEEK_RE.match(week or "")
    if m is None:
        raise ExportError("invalid --week (expected e.g. 2026-W44)")
    try:
        monday = date.fromisocalendar(int(m.group(1)), int(m.group(2)), 1)
    except ValueError:
        raise ExportError("invalid --week (no such ISO week)") from None
    start = day_start(monday)
    return start, start + timedelta(days=7)


def week_label(dt: datetime) -> str:
    year, week, _ = dt.astimezone(TZ).isocalendar()
    return "%04d-W%02d" % (year, week)


def last_completed_week(as_of: datetime) -> str:
    return week_label(as_of - timedelta(days=7))


# ---------------------------------------------------------------------------
# POS receipt time (pure)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Received:
    """Receipt time. exact: lo == hi. date-only: [Taipei 00:00, next 00:00)."""
    lo: datetime
    hi: datetime

    @property
    def exact(self) -> bool:
        return self.lo == self.hi


def _date_interval(d: date) -> Received:
    return Received(day_start(d), day_start(d + timedelta(days=1)))


def _received_from_datetime(dt: datetime) -> Received:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    local = dt.astimezone(TZ)
    if (local.hour, local.minute, local.second, local.microsecond) == (0, 0, 0, 0):
        # Access stores date-only Indate as midnight: never treat it as a precise time.
        return _date_interval(local.date())
    utc = local.astimezone(UTC)
    return Received(utc, utc)


def parse_received_at(value: Any) -> Optional[Received]:
    """Parse eHank Indate: YYYY/MM/DD, YYYY-MM-DD, optional time, AM/PM or the
    Chinese AM/PM markers, ROC years (2-3 digits, +1911). None if unparseable."""
    if isinstance(value, datetime):
        return _received_from_datetime(value)
    if isinstance(value, date):
        return _date_interval(value)
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    m = _POS_DATE_RE.match(text)
    if m is None:
        return None
    year, month, day_ = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if len(m.group(1)) < 4:
        year += 1911  # ROC calendar
    try:
        day = date(year, month, day_)
    except ValueError:
        return None
    rest = m.group(4)
    if rest is None or not rest.strip():
        return _date_interval(day)
    tm = _POS_TIME_RE.match(rest.strip())
    if tm is None:
        dt = parse_ts(text)  # e.g. ISO with offset
        return _received_from_datetime(dt) if dt is not None else None
    hour, minute, sec = int(tm.group(2)), int(tm.group(3)), int(tm.group(4) or 0)
    marker = (tm.group(1) or tm.group(5) or "").upper()
    if marker and hour > 12:
        return None
    if marker in _PM_MARKERS and hour < 12:
        hour += 12
    elif marker in _AM_MARKERS and hour == 12:
        hour = 0
    if hour > 23 or minute > 59 or sec > 59:
        return None
    return _received_from_datetime(datetime(day.year, day.month, day.day, hour, minute, sec, tzinfo=TZ))


def in_window(w0: datetime, w1: datetime, rec: Received) -> int:
    """Is the receipt inside [w0, w1)? YES / NO / MAYBE (date-only straddle)."""
    if rec.exact:
        return YES if w0 <= rec.lo < w1 else NO
    if rec.lo >= w0 and rec.hi <= w1:
        return YES
    if rec.hi <= w0 or rec.lo >= w1:
        return NO
    return MAYBE


# ---------------------------------------------------------------------------
# Keys (identical to attribution_service)
# ---------------------------------------------------------------------------

def hash_key_version(key: bytes) -> str:
    return "hk1-" + hmac.new(key, FINGERPRINT_LABEL, hashlib.sha256).hexdigest()[:16]


def cid_key(key: bytes, cid: Any) -> tuple:
    """Return (cid_key or None, identity_status), exactly like the ledger's binding rows."""
    norm, status = asvc.normalize_cid(cid)
    if status != "single":
        return None, status
    return hmac.new(key, norm.encode("utf-8"), hashlib.sha256).hexdigest(), status


def make_inquiry_id(shop_id: str, oa_scope: str, user_key: str, day: date) -> str:
    """Stable local inquiry id: 'inq1-' + sha256(shop|oa|user_key|YYYY-MM-DD)[:32].

    Manual events (source_corrected, booking_*) must use this same id. It is
    never written to the export."""
    raw = "%s|%s|%s|%s" % (shop_id, oa_scope, user_key, day.isoformat())
    return "inq1-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _valid_code(code: Any) -> bool:
    return isinstance(code, str) and code == code.upper() and asvc._CODE_RE.fullmatch(code) is not None


# ---------------------------------------------------------------------------
# Ledger replay
# ---------------------------------------------------------------------------

@dataclass
class Gap:
    kind: str
    start: datetime  # FAR_PAST when unknown
    end: datetime    # inclusive
    line_no: Optional[int] = None


@dataclass
class LedgerData:
    rows: list
    gaps: list
    stats: dict
    runtime_ids: set


def _decode_row(body: bytes) -> Optional[dict]:
    try:
        obj = json.loads(body.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    if not isinstance(obj.get("event_id"), str) or not obj["event_id"]:
        return None
    if not isinstance(obj.get("event_kind"), str):
        return None
    return obj


def _split_lines(data: bytes, stats: dict) -> list:
    """[(line_no, obj or None, is_unterminated_last)] for non-blank lines."""
    terminated = data.endswith(b"\n")
    parts = data.split(b"\n")
    if terminated:
        parts = parts[:-1]
    out = []
    for idx, raw in enumerate(parts):
        body = raw.rstrip(b"\r")
        if not body.strip():
            continue
        stats["lines"] += 1
        last = idx == len(parts) - 1 and not terminated
        out.append((idx + 1, _decode_row(body), last))
    return out


def _row_anchor(obj: Optional[dict]) -> Optional[datetime]:
    if obj is None:
        return None
    return parse_ts(obj.get("recorded_at")) or parse_ts(obj.get("ts"))


def _next_anchors(anchors: list) -> list:
    out = [None] * len(anchors)
    nxt = None
    for i in range(len(anchors) - 1, -1, -1):
        out[i] = nxt
        if anchors[i] is not None:
            nxt = anchors[i]
    return out


def _accept_row(obj, line_no, ledger, seen, ctx) -> None:
    as_of, shop_id, oa_scope, hkv, prev, nxt = ctx
    stats = ledger.stats
    recorded = parse_ts(obj.get("recorded_at"))
    ts = parse_ts(obj.get("ts"))
    when = recorded or ts
    if when is not None and when > as_of:
        stats["future_rows_excluded"] += 1
        return
    if obj.get("shop_id") != shop_id or obj.get("oa_scope") != oa_scope:
        stats["foreign_scope_rows"] += 1
        return
    if isinstance(obj.get("runtime_id"), str):
        ledger.runtime_ids.add(asvc._safe_label(obj["runtime_id"], 40))
    lo, hi = when or prev or FAR_PAST, when or nxt or as_of
    sv = obj.get("schema_version")
    if isinstance(sv, bool) or sv != SCHEMA_VERSION:
        stats["unsupported_schema_rows"] += 1
        ledger.gaps.append(Gap("unsupported_schema", lo, hi, line_no))
        return
    if ts is None:
        stats["bad_timestamp_rows"] += 1
        ledger.gaps.append(Gap("bad_timestamp", lo, hi, line_no))
        return
    if obj.get("user_key") is not None and obj.get("hash_key_version") != hkv:
        stats["hash_key_mismatch_rows"] += 1
        ledger.gaps.append(Gap("hash_key_mismatch", ts, ts, line_no))
        return
    if obj["event_id"] in seen:
        stats["duplicates"] += 1
        return
    seen.add(obj["event_id"])
    row = dict(obj)
    row["_ts"] = ts
    ledger.rows.append(row)
    stats["accepted"] += 1


def parse_ledger(data: bytes, *, as_of: datetime, shop_id: str, oa_scope: str,
                 hash_key_version: str) -> LedgerData:
    """Pure replay of ledger bytes. Only rows with recorded_at <= as_of are used."""
    stats = {k: 0 for k in (
        "lines", "accepted", "duplicates", "corrupt_lines", "future_rows_excluded",
        "foreign_scope_rows", "hash_key_mismatch_rows", "bad_timestamp_rows",
        "unsupported_schema_rows")}
    entries = _split_lines(data, stats)
    anchors = [_row_anchor(obj) for _, obj, _ in entries]
    nexts = _next_anchors(anchors)
    ledger = LedgerData([], [], stats, set())
    seen: set = set()
    prev = None
    for i, (line_no, obj, last) in enumerate(entries):
        if obj is None:
            stats["corrupt_lines"] += 1
            end = as_of if (last or nexts[i] is None) else nexts[i]
            kind = "corrupt_last_line" if last else "corrupt_line"
            ledger.gaps.append(Gap(kind, prev or FAR_PAST, end, line_no))
            continue
        if anchors[i] is not None:
            prev = anchors[i]
        _accept_row(obj, line_no, ledger, seen, (as_of, shop_id, oa_scope, hash_key_version, prev, nexts[i]))
    ledger.rows.sort(key=lambda r: (r["_ts"], r["event_id"]))
    return ledger


# ---------------------------------------------------------------------------
# Inquiries
# ---------------------------------------------------------------------------

@dataclass
class Inquiry:
    inquiry_id: str
    user_key: str
    day: date
    t_i: datetime
    first_intent: str
    source_code: Optional[str] = None
    source_effective_at: Optional[datetime] = None
    flags: set = field(default_factory=set)
    booking_confirmed: int = 0
    booking_cancelled: int = 0


def _apply_message_source(inq: Inquiry, row: dict) -> None:
    status, code = row.get("source_status"), row.get("source_code")
    if status == asvc.STATUS_OK and _valid_code(code):
        if inq.source_code is None and "source_corrected" not in inq.flags:
            inq.source_code = code
            inq.source_effective_at = row["_ts"]
        elif code != inq.source_code:
            inq.flags.add("source_conflict")  # later different code: no override
    elif status == asvc.STATUS_MULTIPLE:
        inq.flags.add("source_multiple_codes")


def _apply_corrections(inqs: dict, rows: list) -> None:
    for r in rows:
        if r["event_kind"] != "source_corrected":
            continue
        inq = inqs.get(r.get("inquiry_id"))
        if inq is None:
            continue
        code = r.get("source_code")
        if code is None:
            inq.source_code, inq.source_effective_at = None, None
        elif _valid_code(code):
            inq.source_code = code
            inq.source_effective_at = (parse_ts(r.get("source_effective_at"))
                                       or parse_ts(r.get("effective_at")) or inq.t_i)
        else:
            continue
        inq.flags.discard("source_conflict")
        inq.flags.add("source_corrected")


def _apply_bookings(inqs: dict, rows: list, shop_id: str, oa_scope: str) -> None:
    sets: dict = {}
    for r in rows:
        if r["event_kind"] not in BOOKING_KINDS:
            continue
        iid = r.get("inquiry_id")
        if iid not in inqs and isinstance(r.get("user_key"), str):
            iid = make_inquiry_id(shop_id, oa_scope, r["user_key"], taipei_day(r["_ts"]))
        if iid not in inqs:
            continue
        bid = r.get("booking_id") if isinstance(r.get("booking_id"), str) else r["event_id"]
        sets.setdefault((iid, r["event_kind"]), set()).add(bid)
    for (iid, kind), ids in sets.items():
        if kind == "booking_confirmed":
            inqs[iid].booking_confirmed = len(ids)
        else:
            inqs[iid].booking_cancelled = len(ids)


def build_inquiries(rows: list, shop_id: str, oa_scope: str) -> dict:
    """Aggregate message_observed rows into inquiry-days. rows: sorted, deduped."""
    tomb = {r.get("message_key") for r in rows
            if r["event_kind"] == "unsend_tombstone" and isinstance(r.get("message_key"), str)}
    inqs: dict = {}
    for r in rows:
        if r["event_kind"] != "message_observed" or not isinstance(r.get("user_key"), str):
            continue
        if r.get("message_type") == "sticker" or r.get("message_key") in tomb:
            continue
        day = taipei_day(r["_ts"])
        iid = make_inquiry_id(shop_id, oa_scope, r["user_key"], day)
        inq = inqs.get(iid)
        if inq is None:
            intent = r.get("first_intent") if r.get("first_intent") in INTENTS else "other"
            inq = Inquiry(iid, r["user_key"], day, r["_ts"], intent)
            inqs[iid] = inq
        _apply_message_source(inq, r)
    _apply_corrections(inqs, rows)
    _apply_bookings(inqs, rows, shop_id, oa_scope)
    return inqs


# ---------------------------------------------------------------------------
# Identity timeline
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Interval:
    start: datetime
    end: datetime                # exclusive, FAR_FUTURE when open
    cid_key: Optional[str]       # None -> identity_ambiguous / invalid binding


def _close(open_map: dict, store: dict, user: str, at: datetime) -> None:
    cur = open_map.pop(user, None)
    if cur is not None and at > cur[0]:
        store.setdefault(user, []).append(Interval(cur[0], at, cur[1]))


def _open(open_map: dict, store: dict, user: str, at: datetime, ck: Optional[str]) -> None:
    cur = open_map.get(user)
    if cur is not None and ck is not None and cur[1] == ck:
        return  # re-confirmation of the same cid keeps the original start
    _close(open_map, store, user, at)
    open_map[user] = (at, ck)


def build_timelines(rows: list) -> tuple:
    """Return (confirmed, observed, identity_status_counts); dicts user_key -> [Interval]."""
    confirmed: dict = {}
    observed: dict = {}
    open_c: dict = {}
    open_o: dict = {}
    id_counts: dict = {}
    brows = [r for r in rows if r["event_kind"] in BINDING_KINDS and isinstance(r.get("user_key"), str)]
    brows.sort(key=lambda r: (parse_ts(r.get("effective_at")) or r["_ts"], r["event_id"]))
    for r in brows:
        user, kind = r["user_key"], r["event_kind"]
        at = parse_ts(r.get("effective_at")) or r["_ts"]
        if kind == "binding_revoked":
            rk = r.get("cid_key")
            for open_map, store in ((open_c, confirmed), (open_o, observed)):
                cur = open_map.get(user)
                if cur is not None and (rk is None or rk == cur[1]):
                    _close(open_map, store, user, at)
            continue
        status = r.get("identity_status") if isinstance(r.get("identity_status"), str) else "invalid"
        id_counts[status] = id_counts.get(status, 0) + 1
        ck = r.get("cid_key") if status == "single" and isinstance(r.get("cid_key"), str) else None
        if kind == "binding_confirmed":
            _open(open_c, confirmed, user, at, ck)
        else:
            _open(open_o, observed, user, at, ck)
    for open_map, store in ((open_c, confirmed), (open_o, observed)):
        for user in list(open_map):
            _close(open_map, store, user, FAR_FUTURE)
    for store in (confirmed, observed):
        for ivs in store.values():
            ivs.sort(key=lambda iv: iv.start)
    return confirmed, observed, id_counts


def index_by_cid(timelines: dict) -> dict:
    out: dict = {}
    for user, ivs in timelines.items():
        for iv in ivs:
            if iv.cid_key is not None:
                out.setdefault(iv.cid_key, []).append((user, iv))
    return out


def binding_state(intervals: list, cid: str, rec: Received) -> int:
    return max((in_window(iv.start, iv.end, rec) for iv in intervals if iv.cid_key == cid), default=NO)


# ---------------------------------------------------------------------------
# POS pieces
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Piece:
    piece_id: str
    cid_key: str
    received: Received


@dataclass
class PosData:
    pieces: list
    issues: dict  # cid_key -> set of reasons (pos_conflict, received_at_unparseable)
    stats: dict


def _piece_entry(row: Any, key: bytes) -> Optional[tuple]:
    if not isinstance(row, dict):
        return None
    pid = row.get("piece_id")
    pid = str(pid).strip() if pid is not None else ""
    if not pid:
        return None
    ck, status = cid_key(key, row.get("customer_id"))
    if row.get("identity_hint") == "identity_ambiguous":
        ck, status = None, "identity_ambiguous"
    rec = parse_received_at(row.get("received_at"))
    raw = None if rec is not None else str(row.get("received_at"))
    sig = (ck, status, rec.lo if rec else None, rec.hi if rec else None, raw)
    return pid, sig, ck, status, rec


def prepare_pieces(rows: Iterable[dict], key: bytes) -> PosData:
    """Dedupe by piece_id. Contradicting duplicates -> pos_conflict (never merged)."""
    stats = {k: 0 for k in ("rows", "pieces", "duplicates", "conflicts", "invalid",
                            "unlinkable_cid", "exact", "date_only", "unparseable")}
    groups: dict = {}
    for row in rows:
        stats["rows"] += 1
        entry = _piece_entry(row, key)
        if entry is None:
            stats["invalid"] += 1
            continue
        groups.setdefault(entry[0], []).append(entry)
    pieces, issues = [], {}
    for pid, items in groups.items():
        stats["duplicates"] += len(items) - 1
        if len({it[1] for it in items}) > 1:
            stats["conflicts"] += 1
            for it in items:
                if it[2]:
                    issues.setdefault(it[2], set()).add("pos_conflict")
            continue
        _, _, ck, _, rec = items[0]
        if rec is None:
            stats["unparseable"] += 1
            if ck:
                issues.setdefault(ck, set()).add("received_at_unparseable")
            continue
        stats["exact" if rec.exact else "date_only"] += 1
        if ck is None:
            stats["unlinkable_cid"] += 1
            continue
        pieces.append(Piece(pid, ck, rec))
    pieces.sort(key=lambda p: (p.received.lo, p.piece_id))
    stats["pieces"] = len(pieces)
    return PosData(pieces, issues, stats)


# ---------------------------------------------------------------------------
# Policy windows and allocation
# ---------------------------------------------------------------------------

@dataclass
class PolicyState:
    w0: Optional[datetime]
    w1: Optional[datetime]
    maturity_end: datetime
    has_binding: bool
    reasons: set
    pieces: set = field(default_factory=set)
    candidate_only: bool = False
    status: str = ""


def setup_policy(inq: Inquiry, intervals: list, policy: str) -> PolicyState:
    """Window per policy. I7: [t_i, t_i+168h). B7: [t_b, t_b+168h)."""
    reasons = set(inq.flags)
    t_i = inq.t_i
    deadline = t_i + WINDOW
    if policy == "I7":
        overlap = [iv for iv in intervals if iv.start < deadline and iv.end > t_i]
        if any(iv.cid_key is None for iv in overlap):
            reasons.add("identity_ambiguous")
        return PolicyState(t_i, deadline, deadline, any(iv.cid_key for iv in overlap), reasons)
    chosen = next((iv for iv in intervals if iv.start <= t_i < iv.end), None)
    t_b = t_i
    if chosen is None:
        chosen = next((iv for iv in intervals if iv.start > t_i), None)
        if chosen is None:
            return PolicyState(None, None, deadline, False, reasons)
        if chosen.start >= deadline:
            reasons.add("late_binding")
            return PolicyState(None, None, deadline, False, reasons)
        t_b = chosen.start
    if chosen.cid_key is None:
        reasons.add("identity_ambiguous")
        return PolicyState(None, None, t_b + WINDOW, False, reasons)
    return PolicyState(t_b, t_b + WINDOW, t_b + WINDOW, True, reasons)


def source_state(inq: Inquiry, rec: Received) -> int:
    if inq.source_code is None or inq.source_effective_at is None:
        return YES  # unknown-source inquiries take part, bucket "unknown"
    return in_window(inq.source_effective_at, FAR_FUTURE, rec)


def _flag_pre_binding(inq: Inquiry, st: PolicyState, intervals: list, piece: Piece) -> None:
    end = st.w1 if st.w1 is not None else inq.t_i + WINDOW
    rec = piece.received
    if in_window(inq.t_i, end, rec) == NO or binding_state(intervals, piece.cid_key, rec) == YES:
        return
    if any(iv.cid_key == piece.cid_key and iv.start > rec.lo for iv in intervals):
        st.reasons.add("pre_binding_receipt_candidate")


def _flag_observed(piece: Piece, o_by_cid: dict, confirmed: dict, by_user: dict, states: dict) -> None:
    rec = piece.received
    for user, iv in o_by_cid.get(piece.cid_key, ()):
        if in_window(iv.start, iv.end, rec) == NO:
            continue
        if binding_state(confirmed.get(user, []), piece.cid_key, rec) != NO:
            continue
        for inq in by_user.get(user, ()):
            if in_window(inq.t_i, inq.t_i + WINDOW, rec) != NO:
                st = states[inq.inquiry_id]
                st.candidate_only = True
                st.reasons.add("observed_only")


def _candidates(piece: Piece, c_by_cid: dict, confirmed: dict, by_user: dict, states: dict) -> tuple:
    rec, cid = piece.received, piece.cid_key
    users = sorted({u for u, _ in c_by_cid.get(cid, ())})
    mapped = [u for u in users if binding_state(confirmed[u], cid, rec) != NO]
    cands = []
    for user in users:
        intervals = confirmed[user]
        b = binding_state(intervals, cid, rec)
        for inq in by_user.get(user, ()):
            st = states[inq.inquiry_id]
            wb = NO
            if b != NO and st.w0 is not None:
                wb = min(in_window(st.w0, st.w1, rec), b)
            if wb != NO:
                cands.append((inq, wb, source_state(inq, rec)))
            else:
                _flag_pre_binding(inq, st, intervals, piece)
    return cands, mapped


def _resolve(piece: Piece, cands: list, mapped: list, states: dict) -> None:
    if len(mapped) > 1:
        for inq, _, _ in cands:
            states[inq.inquiry_id].reasons.add("shared_cid_conflict")
        return
    cands.sort(key=lambda c: (-c[0].t_i.timestamp(), c[0].inquiry_id))
    nearest, wb, src = cands[0]
    st = states[nearest.inquiry_id]
    if wb == YES and src == YES:
        st.pieces.add(piece.piece_id)
        return
    if wb == YES and src == NO:
        st.reasons.add("source_after_receipt")  # the piece stays unallocated
        return
    st.reasons.add("date_boundary_unknown")
    for inq, _, _ in cands[1:]:
        states[inq.inquiry_id].reasons.add("allocation_undecidable")


def allocate(inquiries: list, pieces: list, confirmed: dict, observed: dict, policy: str) -> dict:
    """Allocate each piece at most once for `policy`. Returns inquiry_id -> PolicyState."""
    states = {i.inquiry_id: setup_policy(i, confirmed.get(i.user_key, []), policy) for i in inquiries}
    by_user: dict = {}
    for inq in inquiries:
        by_user.setdefault(inq.user_key, []).append(inq)
    c_by_cid, o_by_cid = index_by_cid(confirmed), index_by_cid(observed)
    for piece in pieces:
        _flag_observed(piece, o_by_cid, confirmed, by_user, states)
        cands, mapped = _candidates(piece, c_by_cid, confirmed, by_user, states)
        if cands:
            _resolve(piece, cands, mapped, states)
    return states


def _add_coverage_reasons(inq: Inquiry, st: PolicyState, intervals: list, issues: dict, gaps: list) -> None:
    start, end = day_start(inq.day), st.maturity_end
    if any(g.start <= end and g.end >= start for g in gaps):
        st.reasons.add("ledger_gap")
    for cid, reasons in issues.items():
        if any(iv.cid_key == cid and iv.start < end and iv.end > inq.t_i for iv in intervals):
            st.reasons |= reasons


def decide_status(st: PolicyState, as_of: datetime, pos_through: datetime) -> str:
    """Priority: unknown(identity/source/alloc) > received > unknown(observed-only,
    coverage gap) > pending > unknown(no binding) > matured_no_receipt."""
    r = st.reasons
    if r & HARD_UNKNOWN:
        return ST_UNKNOWN
    if st.pieces:
        return ST_RECEIVED
    if "observed_only" in r or r & GAP_UNKNOWN:
        return ST_UNKNOWN
    if as_of < st.maturity_end or pos_through < st.maturity_end:
        r.add("window_open" if as_of < st.maturity_end else "pos_not_through_window")
        if not st.has_binding:
            r.add("awaiting_binding")
        return ST_PENDING
    if not st.has_binding:
        r.add("no_confirmed_binding")
        return ST_UNKNOWN
    return ST_NO_RECEIPT


def finalize_states(states: dict, inquiries: list, confirmed: dict, pos: PosData,
                    gaps: list, as_of: datetime, pos_through: datetime) -> None:
    for inq in inquiries:
        st = states[inq.inquiry_id]
        _add_coverage_reasons(inq, st, confirmed.get(inq.user_key, []), pos.issues, gaps)
        st.status = decide_status(st, as_of, pos_through)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def summarize_policy(items: list, states: dict, file_complete: bool) -> dict:
    out = {name: 0 for name in STATUS_FIELDS.values()}
    pieces: set = set()
    candidate_only = 0
    reasons: dict = {}
    for inq in items:
        st = states[inq.inquiry_id]
        out[STATUS_FIELDS[st.status]] += 1
        if st.status == ST_RECEIVED:
            pieces |= st.pieces
        if st.candidate_only and st.status == ST_UNKNOWN:
            candidate_only += 1
        for reason in st.reasons:
            reasons[reason] = reasons.get(reason, 0) + 1
    out["matched_received_pieces"] = len(pieces)
    out["candidate_only"] = candidate_only
    clean = out["pending_window"] == 0 and out["unknown_inquiries"] == 0
    out["status"] = "complete" if file_complete and clean else "lower_bound"
    out["reason_counts"] = dict(sorted(reasons.items()))
    return out


def summarize_rows(cohort: list, states_by_policy: dict, file_complete: bool) -> list:
    groups: dict = {UNKNOWN_SOURCE: []}
    for inq in cohort:
        groups.setdefault(inq.source_code or UNKNOWN_SOURCE, []).append(inq)
    rows = []
    for code in sorted(groups, key=lambda c: (c == UNKNOWN_SOURCE, c)):
        items = groups[code]
        row = {
            "source_code": code,
            "inquiries": len(items),
            "unique_line_users": len({i.user_key for i in items}),
            "first_intent_counts": {k: sum(1 for i in items if i.first_intent == k) for k in INTENTS},
            "booking_confirmed": sum(i.booking_confirmed for i in items),
            "booking_cancelled": sum(i.booking_cancelled for i in items),
        }
        for policy in POLICIES:
            row[policy] = summarize_policy(items, states_by_policy[policy], file_complete)
        rows.append(row)
    return rows


def _span(times: list) -> tuple:
    return (fmt(min(times)), fmt(max(times))) if times else (None, None)


def _coverage(ledger: LedgerData, pos: PosData, id_counts: dict, pos_through: datetime,
              pos_completeness: str, registry_status: str, exported_at: datetime) -> dict:
    msgs = [r["_ts"] for r in ledger.rows if r["event_kind"] == "message_observed"]
    binds = [r["_ts"] for r in ledger.rows if r["event_kind"] in BINDING_KINDS]
    i_from, i_through = _span(msgs)
    b_from, b_through = _span(binds)
    p_from, _ = _span([p.received.lo for p in pos.pieces])
    gaps = [{"kind": g.kind, "from": fmt(g.start) if g.start != FAR_PAST else None,
             "through": fmt(g.end), "line_no": g.line_no} for g in ledger.gaps]
    return {
        "inquiries_from": i_from, "inquiries_through": i_through,
        "bindings_from": b_from, "bindings_through": b_through,
        "pos_from": p_from, "pos_through": fmt(pos_through),
        "runtime_ids": sorted(ledger.runtime_ids),
        "gap_intervals": gaps,
        "identity_status": dict(sorted(id_counts.items())),
        "pos_completeness": pos_completeness,
        "date_precision": {"exact": pos.stats["exact"], "date_only": pos.stats["date_only"],
                           "unparseable": pos.stats["unparseable"]},
        "registry_load_status": registry_status,
        "ledger": dict(ledger.stats),
        "pos": dict(pos.stats),
        "exported_at": fmt(exported_at),
    }


def compute_export(ledger: LedgerData, pos_rows: Iterable[dict], *, key: bytes, week: str,
                   as_of: datetime, shop_id: str, oa_scope: str, pos_source_id: Optional[str],
                   registry_version: str, registry_status: str = "ok",
                   pos_through: Optional[datetime] = None,
                   pos_completeness: str = POS_DET_UNVERIFIED,
                   exported_at: Optional[datetime] = None) -> dict:
    """Pure core: build the export document (revision fields filled in later)."""
    week_start, week_end = iso_week_bounds(week)
    pos_through = min(pos_through or as_of, as_of)
    inqs = sorted(build_inquiries(ledger.rows, shop_id, oa_scope).values(),
                  key=lambda i: (i.t_i, i.inquiry_id))
    confirmed, observed, id_counts = build_timelines(ledger.rows)
    pos = prepare_pieces(pos_rows, key)
    states = {}
    for policy in POLICIES:  # allocate over all weeks first, then cut the cohort
        states[policy] = allocate(inqs, pos.pieces, confirmed, observed, policy)
        finalize_states(states[policy], inqs, confirmed, pos, ledger.gaps, as_of, pos_through)
    cohort = [i for i in inqs if week_start <= i.t_i < week_end]
    latest_end = max((states[p][i.inquiry_id].maturity_end for p in POLICIES for i in cohort),
                     default=week_end)
    file_complete = (not ledger.gaps and pos_completeness == POS_VERIFIED
                     and pos_through >= latest_end and as_of >= latest_end)
    return {
        "schema_version": SCHEMA_VERSION,
        "policy_version": POLICY_VERSION,
        "registry_version": registry_version,
        "cohort_week": week,
        "timezone": TIMEZONE_NAME,
        "as_of": fmt(as_of),
        "revision": 1,
        "supersedes": None,
        "shop_id": shop_id,
        "oa_scope": oa_scope,
        "pos_source_id": pos_source_id,
        "status": "complete" if file_complete else "lower_bound",
        "window_hours": 168,
        "coverage": _coverage(ledger, pos, id_counts, pos_through, pos_completeness,
                              registry_status, exported_at or datetime.now(UTC)),
        "rows": summarize_rows(cohort, states, file_complete),
    }


# ---------------------------------------------------------------------------
# Settings, POS adapters, output
# ---------------------------------------------------------------------------

@dataclass
class Settings:
    shop_id: str
    oa_scope: str
    pos_source_id: Optional[str]
    registry_path: Path
    secret_path: Path


def load_settings(root: Path) -> Settings:
    cfg: dict = {}
    path = root / "shop.json"
    if path.exists():
        try:
            doc = json.loads(path.read_bytes().decode("utf-8-sig"))
        except Exception:
            raise ExportError("shop.json unreadable") from None
        if isinstance(doc, dict) and isinstance(doc.get("attribution"), dict):
            cfg = doc["attribution"]

    def resolve(value: Any, default: str) -> Path:
        p = Path(value) if isinstance(value, str) and value.strip() else Path(default)
        return p if p.is_absolute() else root / p

    return Settings(
        shop_id=cfg.get("shop_id") or asvc.DEFAULT_SHOP_ID,
        oa_scope=cfg.get("oa_scope") or asvc.DEFAULT_OA_SCOPE,
        pos_source_id=cfg.get("pos_source_id") or None,
        registry_path=resolve(cfg.get("registry_path"), asvc.DEFAULT_REGISTRY_REL),
        secret_path=resolve(cfg.get("secret_path"), asvc.DEFAULT_SECRET_REL),
    )


def load_pos_rows_from_connector(snapshot: Any) -> list:
    """Production adapter: ConnectorSnapshot -> [{piece_id, order_no, customer_id,
    received_at, state, identity_hint}]. Cids that are not in Cus, or that equal the
    State column (the connector's silent fallback), become identity_ambiguous."""
    if snapshot is None or getattr(snapshot, "state", None) == "unknown":
        raise ExportError("POS snapshot unavailable (connector reported unknown state)")
    known = set()
    for c in getattr(snapshot, "customers", None) or []:
        if isinstance(c, dict):
            known.add(str(c.get("customer_id") or "").strip())
    known.discard("")
    raw = getattr(snapshot, "pieces", None)
    if raw is None:
        raw = getattr(snapshot, "garments", None) or []
    out = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        cid = str(p.get("customer_id") or "").strip()
        state = str(p.get("state_raw") or p.get("state") or "").strip()
        hint = None
        if not cid or (known and cid not in known) or (state and state == cid):
            hint = "identity_ambiguous"
        out.append({"piece_id": p.get("piece_id"), "order_no": p.get("order_no"),
                    "customer_id": cid, "received_at": p.get("received_at"),
                    "state": state, "identity_hint": hint})
    return out


def snapshot_through(snapshot: Any) -> Optional[datetime]:
    value = getattr(snapshot, "read_at", None)
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=UTC)).astimezone(UTC)
    return parse_ts(value)


def _import_connector_api() -> tuple:
    candidates = (("connectors.base", "connectors.base"), ("connectors", "connectors"),
                  ("connectors", "shop_config"), ("connectors.base", "shop_config"))
    last: Optional[BaseException] = None
    for factory_mod, config_mod in candidates:
        try:
            factory = getattr(__import__(factory_mod, fromlist=["x"]), "connector_from_shop")
            shop_config = getattr(__import__(config_mod, fromlist=["x"]), "ShopConfig")
            return factory, shop_config
        except Exception as exc:
            last = exc
    raise ExportError("POS connector unavailable (%s); rerun with --pos-json"
                      % type(last).__name__)


def read_connector_snapshot(root: Path) -> Any:
    for p in (root, root / "runtime"):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
    factory, shop_config = _import_connector_api()
    try:
        return factory(shop_config.load(root / "shop.json")).read_snapshot()
    except Exception as exc:
        raise ExportError("POS connector failed (%s)" % type(exc).__name__) from None


def load_pos_json(path: Path) -> tuple:
    """Either a JSON list of piece dicts, or {"pieces": [...], "through": ISO,
    "completeness": "verified"|...}. Returns (rows, through, completeness)."""
    try:
        doc = json.loads(Path(path).read_bytes().decode("utf-8-sig"))
    except Exception:
        raise ExportError("--pos-json unreadable or not JSON") from None
    if isinstance(doc, list):
        return doc, None, POS_OFFLINE_UNVERIFIED
    if isinstance(doc, dict) and isinstance(doc.get("pieces"), list):
        through = parse_ts(doc.get("through") or doc.get("read_at"))
        comp = POS_VERIFIED if doc.get("completeness") == POS_VERIFIED else POS_OFFLINE_UNVERIFIED
        return doc["pieces"], through, comp
    raise ExportError("--pos-json must be a list of pieces or an object with 'pieces'")


def output_path(root: Path, week: str) -> Path:
    return root / "data" / "conversions" / ("source-to-order-%s.json" % week)


def next_revision(path: Path) -> tuple:
    if not path.exists():
        return 1, None
    try:
        prev = json.loads(path.read_text(encoding="utf-8"))
        rev = prev["revision"]
        if isinstance(rev, bool) or not isinstance(rev, int) or rev < 1:
            raise ValueError
    except Exception:
        raise ExportError("existing export is unreadable; move it aside: " + path.name) from None
    return rev + 1, rev


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(".%s.tmp-%d" % (path.name, os.getpid()))
    try:
        with open(tmp, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def write_export(path: Path, doc: dict) -> None:
    """Archive the previous revision under history/, then replace atomically."""
    if path.exists() and isinstance(doc.get("supersedes"), int):
        hist = path.parent / "history" / ("%s.r%d.json" % (path.stem, doc["supersedes"]))
        atomic_write_bytes(hist, path.read_bytes())
    data = (json.dumps(doc, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("ascii")
    atomic_write_bytes(path, data)


def summary_line(doc: dict, path: Optional[Path], dry_run: bool) -> str:
    def tot(policy: str, name: str) -> int:
        return sum(r[policy][name] for r in doc["rows"])
    where = "dry-run (not written)" if dry_run else str(path)
    return ("[ATTRIBUTION_EXPORT] week=%s revision=%d status=%s sources=%d inquiries=%d "
            "I7 received=%d pending=%d unknown=%d | B7 received=%d pending=%d unknown=%d -> %s" % (
                doc["cohort_week"], doc["revision"], doc["status"], len(doc["rows"]),
                sum(r["inquiries"] for r in doc["rows"]),
                tot("I7", "received_inquiries"), tot("I7", "pending_window"), tot("I7", "unknown_inquiries"),
                tot("B7", "received_inquiries"), tot("B7", "pending_window"), tot("B7", "unknown_inquiries"),
                where))


@dataclass
class ExportResult:
    code: int
    doc: Optional[dict]
    path: Optional[Path]
    message: str


def export_week(root: Any, week: str, as_of: datetime, pos_rows: Iterable[dict], *,
                pos_through: Optional[datetime] = None,
                pos_completeness: str = POS_DET_UNVERIFIED,
                dry_run: bool = False) -> ExportResult:
    """Read ledger + registry + secret under `root`, compute, and write (unless dry_run)."""
    root = Path(root)
    iso_week_bounds(week)  # validate early
    settings = load_settings(root)
    ledger_path = root / "data" / asvc.LEDGER_FILENAME
    if not ledger_path.exists():
        return ExportResult(2, None, None, "[ATTRIBUTION_EXPORT] nothing to export: no ledger")
    key, reason = asvc._read_secret(settings.secret_path)
    if key is None:
        raise ExportError("HMAC secret unavailable (%s)" % reason)
    ledger = parse_ledger(ledger_path.read_bytes(), as_of=as_of, shop_id=settings.shop_id,
                          oa_scope=settings.oa_scope, hash_key_version=hash_key_version(key))
    registry = asvc.load_source_registry(settings.registry_path)
    doc = compute_export(ledger, pos_rows, key=key, week=week, as_of=as_of,
                         shop_id=settings.shop_id, oa_scope=settings.oa_scope,
                         pos_source_id=settings.pos_source_id,
                         registry_version=registry.registry_version,
                         registry_status=registry.load_status, pos_through=pos_through,
                         pos_completeness=pos_completeness)
    if sum(r["inquiries"] for r in doc["rows"]) == 0:
        return ExportResult(2, doc, None, "[ATTRIBUTION_EXPORT] nothing to export: no inquiries in " + week)
    path = output_path(root, week)
    doc["revision"], doc["supersedes"] = next_revision(path)
    if not dry_run:
        write_export(path, doc)
    return ExportResult(0, doc, path, summary_line(doc, path, dry_run))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parser() -> argparse.ArgumentParser:
    default_root = str(Path(__file__).resolve().parent.parent)
    p = argparse.ArgumentParser(description="Weekly LINE source -> POS intake summary (offline).")
    p.add_argument("--root", default=default_root, help="fxwash root (default: parent of runtime/)")
    p.add_argument("--week", default=None, help="ISO week, e.g. 2026-W44 (default: last completed week)")
    p.add_argument("--as-of", dest="as_of", default=None, help="ISO time (default: now; naive = Asia/Taipei)")
    p.add_argument("--pos-json", dest="pos_json", default=None, help="offline JSON list of piece dicts")
    p.add_argument("--dry-run", dest="dry_run", action="store_true", help="compute and print, do not write")
    return p


def main(argv: Optional[list] = None) -> int:
    args = _parser().parse_args(argv)
    try:
        as_of = parse_ts(args.as_of) if args.as_of else datetime.now(UTC)
        if as_of is None:
            raise ExportError("invalid --as-of")
        week = args.week or last_completed_week(as_of)
        iso_week_bounds(week)
        root = Path(args.root)
        if not (root / "data" / asvc.LEDGER_FILENAME).exists():
            print("[ATTRIBUTION_EXPORT] nothing to export: no ledger")
            return 2
        if args.pos_json:
            rows, through, completeness = load_pos_json(Path(args.pos_json))
        else:
            snapshot = read_connector_snapshot(root)
            rows = load_pos_rows_from_connector(snapshot)
            through, completeness = snapshot_through(snapshot), POS_DET_UNVERIFIED
        result = export_week(root, week, as_of, rows, pos_through=through,
                             pos_completeness=completeness, dry_run=args.dry_run)
    except ExportError as exc:
        print("[ATTRIBUTION_EXPORT_ERROR] " + str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # never print exception text: it may carry data
        print("[ATTRIBUTION_EXPORT_ERROR] " + type(exc).__name__, file=sys.stderr)
        return 1
    print(result.message)
    return result.code


if __name__ == "__main__":
    sys.exit(main())