"""Inquiry event ledger for LINE source attribution (B2 design, sections 2.2, 3, 4).

Records minimal, privacy-safe `message_observed` / `binding_observed` rows to a
local append-only JSONL (`<data_dir>/inquiries.jsonl`) so an offline job can
later count inquiries per public content source code and match them against
POS intake.

Hard rules implemented here:
  * stdlib only, no network, no POS access, no replies.
  * Never stores raw userId, message text, raw message id, raw Cid or the key.
  * Every public `record_*` call is bounded (lock wait <= 2 s) and never raises.
  * Single writer per file: `.lock` created with O_CREAT|O_EXCL, full UTF-8 JSON
    line per event, os.fsync after each append.
  * Dedupe by event_id (oa_scope + ":" + webhookEventId); the index is rebuilt by
    replaying the file at startup and caught up incrementally under the lock.
  * Corrupt / truncated lines are reported in `coverage_gaps`, never silently
    treated as complete data.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

__all__ = [
    "LedgerBusy",
    "Registry",
    "RegistryEntry",
    "SourceResult",
    "AttributionLedger",
    "load_source_registry",
    "registry_from_document",
    "extract_source",
    "classify_intent",
    "normalize_cid",
    "init_attribution",
]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1
POLICY_VERSION = "v1"
INTENT_BASIS = "rule_v1"
SOURCE_METHOD = "keyword"
LEDGER_FILENAME = "inquiries.jsonl"
MAX_TOKEN_LEN = 40
LOCK_TIMEOUT_MAX = 2.0
STALE_LOCK_SECONDS = 30.0
BUSY_COOLDOWN_SECONDS = 5.0
MAX_GAPS = 1000
MIN_SECRET_BYTES = 32
TZ_TAIPEI = timezone(timedelta(hours=8))

DEFAULT_SECRET_REL = "secrets/attribution_hmac.key"
DEFAULT_REGISTRY_REL = "data/attribution/source-codes.json"
DEFAULT_SHOP_ID = "fxwash"
DEFAULT_OA_SCOPE = "fxwash-line-oa"
DEFAULT_RUNTIME_ID = "shop-pc"

STATUS_OK = "ok"
STATUS_NO_CODE = "unknown_no_code"
STATUS_UNREGISTERED = "unknown_unregistered_code"
STATUS_MULTIPLE = "unknown_multiple_codes"
SOURCE_STATUSES = frozenset({STATUS_OK, STATUS_NO_CODE, STATUS_UNREGISTERED, STATUS_MULTIPLE})

_O_BINARY = getattr(os, "O_BINARY", 0)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MAX_TS_MS = 4102444800000  # 2100-01-01T00:00:00Z

# Token grammar: SXJ-<6 digits>-(S1..S3 | F<2 digits>), ASCII, case-insensitive.
_CODE_RE = re.compile(r"SXJ-[0-9]{6}-(?:S[1-3]|F[0-9]{2})", re.ASCII | re.IGNORECASE)
# A "word" for full-token matching: maximal run of ASCII letters, digits, '_' or '-'.
# Anything else (spaces, CJK, punctuation) is a boundary.
_RUN_RE = re.compile(r"[A-Za-z0-9_\-]+", re.ASCII)
# Quote / bracket pairs that directly enclose the token are removed with it.
_QUOTE_PAIRS = frozenset({
    "\u300e\u300f",  # corner brackets (white)
    "\u300c\u300d",  # corner brackets
    "\u201c\u201d",  # curly double quotes
    "\u2018\u2019",  # curly single quotes
    "\uff08\uff09",  # fullwidth parentheses
    "\u3010\u3011",  # lenticular brackets
    "\u300a\u300b",  # double angle brackets
    "\"\"", "''", "()", "[]", "<>",
})
_HSPACE_RE = re.compile(r"[ \t\f\v\u00a0\u3000]+")

_ID_RE = re.compile(r"[A-Za-z0-9._\-]{1,64}")
_EVENT_ID_RE = re.compile(r"[A-Za-z0-9_\-]{1,64}")
_LABEL_BAD_RE = re.compile(r"[^A-Za-z0-9._:+\-]")
_BASIS_RE = re.compile(r"[a-z][a-z0-9_]{0,31}")
_HEX_RE = re.compile(rb"[0-9A-Fa-f]+")
_CID_COMPOSITE_RE = re.compile(r"[/\uff0f,\uff0c\u3001;\uff1b|\s]")

_DUMMY_REPLY_TOKENS = frozenset({
    "00000000000000000000000000000000",
    "ffffffffffffffffffffffffffffffff",
})
_MESSAGE_TYPES = frozenset({"text", "image", "video", "audio", "file", "location"})
_CORRUPT_KINDS = frozenset({"corrupt_line", "corrupt_last_line"})

_FULLWIDTH_DIGITS = str.maketrans(
    "\uff10\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19", "0123456789"
)
_PHONE_RE = re.compile(r"(?<![0-9])[0-9](?:[ \-]?[0-9]){9}(?![0-9])")
_LOOKUP_KW = ("客號", "單號", "查件", "進度")
_QUOTE_KW = ("估價", "多少錢", "價格", "費用", "洗這個")
_PICKUP_KW = ("收件", "到府", "收送", "取件", "來收")


class LedgerBusy(Exception):
    """The ledger lock could not be acquired within the bounded wait."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _stderr(line: str) -> None:
    stream = sys.stderr
    if stream is None:  # pythonw / service without console
        return
    try:
        print(line, file=stream, flush=True)
    except Exception:
        pass


def _report_error(exc: BaseException) -> None:
    # Only the exception type name: never the message (it may contain content).
    _stderr("[ATTRIBUTION_ERROR] " + type(exc).__name__)


def _now_iso() -> str:
    return datetime.now(TZ_TAIPEI).isoformat(timespec="milliseconds")


def _ms_to_iso(ts_ms: Any) -> Optional[str]:
    if isinstance(ts_ms, bool) or not isinstance(ts_ms, int):
        return None
    if ts_ms <= 0 or ts_ms >= _MAX_TS_MS:
        return None
    dt = (_EPOCH + timedelta(milliseconds=ts_ms)).astimezone(TZ_TAIPEI)
    return dt.isoformat(timespec="milliseconds")


def _safe_label(value: Any, max_len: int = 80, default: str = "none") -> str:
    if not isinstance(value, str) or not value.strip():
        return default
    return _LABEL_BAD_RE.sub("_", value.strip())[:max_len]


def _require_id(name: str, value: Any) -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise ValueError("invalid " + name)
    return value


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("short write")
        view = view[written:]


def _read_secret(secret_path: Any) -> tuple:
    """Return (key_bytes, None) or (None, reason). Never logs key material."""
    if secret_path is None:
        return None, "no hmac secret"
    try:
        data = Path(secret_path).read_bytes()
    except FileNotFoundError:
        return None, "no hmac secret"
    except OSError:
        return None, "unreadable hmac secret"
    stripped = data.strip()
    if stripped and _HEX_RE.fullmatch(stripped) and len(stripped) % 2 == 0:
        key = bytes.fromhex(stripped.decode("ascii"))
        if len(key) >= MIN_SECRET_BYTES:
            return key, None
        return None, "invalid hmac secret"
    if len(data) >= MIN_SECRET_BYTES:
        return data, None
    return None, "invalid hmac secret"


# ---------------------------------------------------------------------------
# Source registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RegistryEntry:
    source_code: str
    content_id: str
    kind: str
    date: Optional[str]
    slot: Optional[int]
    feature_slug: Optional[str]
    placements: tuple
    valid_from: Optional[str]
    retired_at: Optional[str]


@dataclass(frozen=True, eq=False)
class Registry:
    registry_version: str
    entries: dict = field(default_factory=dict)  # canonical code -> RegistryEntry
    load_status: str = "ok"  # ok | missing | invalid | unreadable
    skipped_entries: int = 0

    def is_registered(self, code: Any) -> bool:
        return isinstance(code, str) and code.upper() in self.entries

    @property
    def codes(self) -> frozenset:
        return frozenset(self.entries)


def _parse_entry(item: Any) -> Optional[RegistryEntry]:
    if not isinstance(item, dict):
        return None
    code = item.get("source_code")
    if not isinstance(code, str):
        return None
    code = code.strip().upper()
    if len(code) > MAX_TOKEN_LEN or not _CODE_RE.fullmatch(code):
        return None

    def opt_str(key: str) -> Optional[str]:
        value = item.get(key)
        return value if isinstance(value, str) and value else None

    slot = item.get("slot")
    if isinstance(slot, bool) or not isinstance(slot, int):
        slot = None
    raw_placements = item.get("placements")
    placements = tuple(p for p in raw_placements if isinstance(p, str)) if isinstance(raw_placements, list) else ()
    return RegistryEntry(
        source_code=code,
        content_id=opt_str("content_id") or "",
        kind=opt_str("kind") or "",
        date=opt_str("date"),
        slot=slot,
        feature_slug=opt_str("feature_slug"),
        placements=placements,
        valid_from=opt_str("valid_from"),
        retired_at=opt_str("retired_at"),
    )


def registry_from_document(doc: Any) -> Registry:
    """Build a Registry from a parsed source-codes.json document (raises ValueError)."""
    if not isinstance(doc, dict):
        raise ValueError("registry document is not an object")
    schema = doc.get("schema_version")
    if isinstance(schema, bool) or schema != 1 or not isinstance(doc.get("entries"), list):
        raise ValueError("unsupported registry document")
    version = _safe_label(doc.get("registry_version"), 80, default="unversioned")
    entries: dict = {}
    skipped = 0
    for item in doc["entries"]:
        entry = _parse_entry(item)
        if entry is None or entry.source_code in entries:
            skipped += 1
            continue
        entries[entry.source_code] = entry
    return Registry(registry_version=version, entries=entries, load_status="ok", skipped_entries=skipped)


def load_source_registry(path: Any) -> Registry:
    """Load data/attribution/source-codes.json. Never raises.

    Missing file -> empty registry with registry_version "none".
    Unreadable or invalid file -> empty registry with registry_version "invalid".
    """
    p = Path(path)
    try:
        raw = p.read_bytes()
    except FileNotFoundError:
        return Registry(registry_version="none", entries={}, load_status="missing")
    except OSError:
        _stderr("[ATTRIBUTION_ERROR] RegistryUnreadable")
        return Registry(registry_version="invalid", entries={}, load_status="unreadable")
    try:
        return registry_from_document(json.loads(raw.decode("utf-8-sig")))
    except Exception:
        _stderr("[ATTRIBUTION_ERROR] RegistryInvalid")
        return Registry(registry_version="invalid", entries={}, load_status="invalid")


# ---------------------------------------------------------------------------
# Source extraction and intent rules
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SourceResult:
    source_code: Optional[str]
    source_status: str
    # repr=False so an accidental log of the result never prints customer text.
    stripped_text: str = field(default="", repr=False)


def _find_code_spans(text: str) -> list:
    """Return [(start, end, CANONICAL_CODE)] for grammar-valid full tokens."""
    spans = []
    for match in _RUN_RE.finditer(text):
        run = match.group(0)
        if len(run) > MAX_TOKEN_LEN:
            continue
        if _CODE_RE.fullmatch(run):
            spans.append((match.start(), match.end(), run.upper()))
    return spans


def _norm_ws(line: str) -> str:
    return _HSPACE_RE.sub(" ", line).strip()


def _strip_code(text: str, code: str) -> str:
    """Remove every occurrence of `code` (plus directly enclosing quotes).

    Whitespace is normalized per line (runs of horizontal whitespace -> one
    space, line trimmed). Lines that become empty only because the token was
    removed are dropped; leading/trailing empty lines are dropped. Everything
    else is kept as typed.
    """
    out_lines = []
    for line in text.splitlines():
        spans = [(s, e) for s, e, c in _find_code_spans(line) if c == code]
        if not spans:
            out_lines.append(_norm_ws(line))
            continue
        pieces = []
        pos = 0
        for s, e in spans:
            if s - 1 >= pos and e < len(line) and (line[s - 1] + line[e]) in _QUOTE_PAIRS:
                s, e = s - 1, e + 1
            pieces.append(line[pos:s])
            pos = e
        pieces.append(line[pos:])
        new_line = _norm_ws("".join(pieces))
        if new_line:
            out_lines.append(new_line)
    while out_lines and not out_lines[0]:
        out_lines.pop(0)
    while out_lines and not out_lines[-1]:
        out_lines.pop()
    return "\n".join(out_lines)


def extract_source(text: Any, registry: Optional[Registry]) -> SourceResult:
    """Find a public source code in customer text.

    ok                         exactly one distinct registered code (may repeat);
                               stripped_text has it removed.
    unknown_multiple_codes     two or more distinct registered codes; no stripping.
    unknown_unregistered_code  grammar-valid code(s) but none registered.
    unknown_no_code            nothing that matches the grammar.
    For every non-ok status stripped_text is the original text, unchanged.
    """
    if not isinstance(text, str) or not text:
        return SourceResult(None, STATUS_NO_CODE, text if isinstance(text, str) else "")
    spans = _find_code_spans(text)
    if not spans:
        return SourceResult(None, STATUS_NO_CODE, text)
    reg = registry if isinstance(registry, Registry) else None
    registered = {c for _, _, c in spans if reg is not None and reg.is_registered(c)}
    if len(registered) > 1:
        return SourceResult(None, STATUS_MULTIPLE, text)
    if len(registered) == 1:
        code = next(iter(registered))
        return SourceResult(code, STATUS_OK, _strip_code(text, code))
    return SourceResult(None, STATUS_UNREGISTERED, text)


def _remove_code_tokens(text: str) -> str:
    spans = _find_code_spans(text)
    if not spans:
        return text
    pieces = []
    pos = 0
    for s, e, _ in spans:
        pieces.append(text[pos:s])
        pieces.append(" ")
        pos = e
    pieces.append(text[pos:])
    return "".join(pieces)


def classify_intent(text: Any, message_type: Any) -> str:
    """rule_v1: lookup > quote > pickup > other. Source-code digits are ignored."""
    t = text if isinstance(text, str) else ""
    t = _remove_code_tokens(t).translate(_FULLWIDTH_DIGITS)
    if _PHONE_RE.search(t) or any(k in t for k in _LOOKUP_KW):
        return "lookup"
    if message_type == "image" or any(k in t for k in _QUOTE_KW):
        return "quote"
    if any(k in t for k in _PICKUP_KW):
        return "pickup"
    return "other"


def normalize_cid(cid: Any) -> tuple:
    """Return (normalized_cid or None, identity_status).

    identity_status: single | identity_ambiguous | missing | invalid.
    Leading zeros are kept; the value is never converted to int.
    """
    if cid is None or isinstance(cid, bool):
        return None, "missing"
    if isinstance(cid, int):
        cid = str(cid)
    if not isinstance(cid, str):
        return None, "invalid"
    value = cid.strip()
    if not value:
        return None, "missing"
    if _CID_COMPOSITE_RE.search(value):
        return None, "identity_ambiguous"
    if len(value) > 32 or not value.isprintable():
        return None, "invalid"
    return value, "single"


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------

class AttributionLedger:
    """Single-writer append-only event ledger at <data_dir>/inquiries.jsonl."""

    def __init__(self, data_dir: Any, secret_path: Any, shop_id: str, oa_scope: str,
                 runtime_id: str, *, pos_source_id: Optional[str] = None,
                 lock_timeout: float = LOCK_TIMEOUT_MAX,
                 stale_lock_seconds: float = STALE_LOCK_SECONDS,
                 busy_cooldown: float = BUSY_COOLDOWN_SECONDS) -> None:
        self.shop_id = _require_id("shop_id", shop_id)
        self.oa_scope = _require_id("oa_scope", oa_scope)
        self.runtime_id = _require_id("runtime_id", runtime_id)
        self.pos_source_id = _require_id("pos_source_id", pos_source_id) if pos_source_id is not None else None
        self.data_dir = Path(data_dir)
        self.path = self.data_dir / LEDGER_FILENAME
        self.lock_path = self.data_dir / (LEDGER_FILENAME + ".lock")
        self.lock_timeout = min(max(float(lock_timeout), 0.0), LOCK_TIMEOUT_MAX)
        self.stale_lock_seconds = max(float(stale_lock_seconds), 1.0)
        self.busy_cooldown = max(float(busy_cooldown), 0.0)

        self.coverage_gaps: list = []
        self.coverage_gaps_dropped = 0
        self.enabled = False
        self.disabled_reason: Optional[str] = None
        self.hash_key_version: Optional[str] = None

        self._key: Optional[bytes] = None
        self._mutex = threading.Lock()
        self._seen: set = set()
        self._offset = 0  # bytes of complete lines already indexed
        self._line_no = 0  # number of complete lines already indexed
        self._gap_offsets: set = set()
        self._busy_until = 0.0

        key, reason = _read_secret(secret_path)
        if key is None:
            self.disabled_reason = reason
            _stderr("[ATTRIBUTION_DISABLED] " + str(reason))
            return
        self._key = key
        # Non-reversible key fingerprint so offline jobs never join rows hashed
        # with different keys.
        fingerprint = hmac.new(key, b"fxwash-attribution-key-fingerprint-v1", hashlib.sha256).hexdigest()
        self.hash_key_version = "hk1-" + fingerprint[:16]
        self.enabled = True
        try:
            self.replay()
        except Exception as exc:
            _report_error(exc)
            self._add_gap("replay_failed")

    # -- public -----------------------------------------------------------

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "disabled_reason": self.disabled_reason,
            "indexed_event_ids": len(self._seen),
            "coverage_gaps": len(self.coverage_gaps),
            "coverage_gaps_dropped": self.coverage_gaps_dropped,
            "hash_key_version": self.hash_key_version,
        }

    def replay(self) -> dict:
        """Rebuild the event_id index from the file. Corrupt lines -> coverage_gaps."""
        if not self.enabled:
            return self.status()
        deadline = time.monotonic() + self.lock_timeout
        if not self._mutex.acquire(timeout=self.lock_timeout):
            raise LedgerBusy("ledger thread lock busy")
        try:
            fd = None
            try:
                fd = self._acquire_file_lock(deadline)
            except LedgerBusy:
                # Read anyway; a writer in progress may show up as a partial last line.
                self._add_gap("replay_without_lock")
            try:
                self.coverage_gaps = [g for g in self.coverage_gaps if g.get("kind") not in _CORRUPT_KINDS]
                self._reset_index()
                self._catch_up()
            finally:
                if fd is not None:
                    self._release_file_lock(fd)
            return self.status()
        finally:
            self._mutex.release()

    def record_message(self, event: Any, source: Optional[SourceResult], registry_version: Any) -> Optional[dict]:
        """Append a message_observed row. Returns the row, or None if not recorded."""
        if not self.enabled:
            return None
        try:
            row = self._build_message_row(event, source, registry_version)
            if row is None:
                return None
            return self._append(row)
        except Exception as exc:
            _report_error(exc)
            return None

    def record_binding_observed(self, user_id: Any, cid: Any, basis: Any) -> Optional[dict]:
        """Append a binding_observed row (trust=observed). Composite cids -> identity_ambiguous."""
        if not self.enabled:
            return None
        try:
            if not isinstance(user_id, str) or not user_id:
                return None
            norm, identity_status = normalize_cid(cid)
            now = _now_iso()
            row = {
                "schema_version": SCHEMA_VERSION,
                "policy_version": POLICY_VERSION,
                "event_kind": "binding_observed",
                "event_id": self.oa_scope + ":local-" + uuid.uuid4().hex,
                "event_id_basis": "local",
                "ts": now,
                "ts_basis": "local",
                "recorded_at": now,
                "shop_id": self.shop_id,
                "oa_scope": self.oa_scope,
                "runtime_id": self.runtime_id,
                "user_key": self._user_key(user_id),
                "hash_key_version": self.hash_key_version,
                "cid_key": self._hmac(norm) if identity_status == "single" else None,
                "identity_status": identity_status,
                "pos_source_id": self.pos_source_id,
                "binding_trust": "observed",
                "binding_basis": basis if isinstance(basis, str) and _BASIS_RE.fullmatch(basis) else "other",
            }
            return self._append(row)
        except Exception as exc:
            _report_error(exc)
            return None

    # -- row building -------------------------------------------------------

    def _hmac(self, value: str) -> str:
        return hmac.new(self._key, value.encode("utf-8"), hashlib.sha256).hexdigest()

    def _user_key(self, user_id: str) -> str:
        return self._hmac(self.shop_id + "|" + self.oa_scope + "|" + user_id)

    def _build_message_row(self, event: Any, source: Any, registry_version: Any) -> Optional[dict]:
        if not isinstance(event, dict):
            raise TypeError("event must be a dict")
        if event.get("type") != "message":
            return None
        src = event.get("source")
        if not isinstance(src, dict) or src.get("type") != "user":
            return None  # group / room / unknown source: not an attributable inquiry
        user_id = src.get("userId")
        if not isinstance(user_id, str) or not user_id:
            return None
        if event.get("replyToken") in _DUMMY_REPLY_TOKENS:
            return None  # LINE verification ping
        msg = event.get("message")
        if not isinstance(msg, dict):
            return None
        mtype = msg.get("type")
        if not isinstance(mtype, str) or mtype == "sticker":
            return None
        message_type = mtype if mtype in _MESSAGE_TYPES else "other"

        if source is None:
            source = SourceResult(None, STATUS_NO_CODE, "")
        if not isinstance(source, SourceResult):
            raise TypeError("source must be a SourceResult")
        status = source.source_status
        if status not in SOURCE_STATUSES:
            raise ValueError("invalid source_status")
        code = None
        if status == STATUS_OK:
            code = source.source_code
            if not isinstance(code, str) or code != code.upper() or not _CODE_RE.fullmatch(code):
                raise ValueError("invalid source_code")

        text = msg.get("text") if message_type == "text" else ""
        first_intent = classify_intent(text if isinstance(text, str) else "", message_type)

        webhook_event_id = event.get("webhookEventId")
        if isinstance(webhook_event_id, str) and _EVENT_ID_RE.fullmatch(webhook_event_id):
            event_id = self.oa_scope + ":" + webhook_event_id
            event_id_basis = "line"
        else:
            event_id = self.oa_scope + ":local-" + uuid.uuid4().hex
            event_id_basis = "local"

        recorded_at = _now_iso()
        ts = _ms_to_iso(event.get("timestamp"))
        ts_basis = "line"
        if ts is None:
            ts = recorded_at
            ts_basis = "local"

        msg_id = msg.get("id")
        if isinstance(msg_id, int) and not isinstance(msg_id, bool):
            msg_id = str(msg_id)
        message_key = self._hmac(msg_id) if isinstance(msg_id, str) and msg_id else None

        return {
            "schema_version": SCHEMA_VERSION,
            "policy_version": POLICY_VERSION,
            "event_kind": "message_observed",
            "event_id": event_id,
            "event_id_basis": event_id_basis,
            "ts": ts,
            "ts_basis": ts_basis,
            "recorded_at": recorded_at,
            "shop_id": self.shop_id,
            "oa_scope": self.oa_scope,
            "runtime_id": self.runtime_id,
            "user_key": self._user_key(user_id),
            "hash_key_version": self.hash_key_version,
            "message_key": message_key,
            "message_type": message_type,
            "first_intent": first_intent,
            "intent_basis": INTENT_BASIS,
            "source_code": code,
            "source_method": SOURCE_METHOD,
            "source_status": status,
            "source_registry_version": _safe_label(registry_version, 80, default="none"),
        }

    # -- gaps ---------------------------------------------------------------

    def _add_gap(self, kind: str, **fields: Any) -> None:
        if kind in _CORRUPT_KINDS:
            offset = fields.get("byte_offset")
            if offset in self._gap_offsets:
                return
            self._gap_offsets.add(offset)
        if len(self.coverage_gaps) >= MAX_GAPS:
            self.coverage_gaps_dropped += 1
            return
        gap = {"kind": kind, "detected_at": _now_iso()}
        for name, value in fields.items():
            if value is not None:
                gap[name] = value
        self.coverage_gaps.append(gap)

    def _mark_busy(self) -> None:
        self._busy_until = time.monotonic() + self.busy_cooldown
        self._add_gap("event_not_recorded", reason="ledger_busy")

    # -- index / replay -----------------------------------------------------

    def _reset_index(self) -> None:
        self._seen.clear()
        self._offset = 0
        self._line_no = 0
        self._gap_offsets.clear()

    def _catch_up(self) -> int:
        """Index lines appended since the last scan. Returns current file size."""
        try:
            size = os.path.getsize(self.path)
        except FileNotFoundError:
            size = 0
        if size < self._offset:
            self._add_gap("ledger_shrunk", byte_offset=size)
            self._reset_index()
        if size > self._offset:
            self._offset = self._scan(self._offset)
        return size

    def _scan(self, start: int) -> int:
        pos = start
        with open(self.path, "rb") as handle:
            handle.seek(start)
            for raw in iter(handle.readline, b""):
                line_start = pos
                if not raw.endswith(b"\n"):
                    # Unterminated tail: index it if it parses, but do not consume it,
                    # so the next append terminates it and the next scan sees it again.
                    self._ingest(raw, line_start, self._line_no + 1, last=True)
                    return line_start
                pos += len(raw)
                self._line_no += 1
                self._ingest(raw[:-1], line_start, self._line_no, last=False)
        return pos

    def _ingest(self, body: bytes, offset: int, line_no: int, last: bool) -> None:
        body = body.rstrip(b"\r")
        if not body.strip():
            return
        event_id = None
        try:
            obj = json.loads(body.decode("utf-8"))
            if isinstance(obj, dict) and isinstance(obj.get("event_id"), str) and obj["event_id"]:
                event_id = obj["event_id"]
        except Exception:
            event_id = None
        if event_id is None:
            self._add_gap("corrupt_last_line" if last else "corrupt_line",
                          byte_offset=offset, line_no=line_no, length=len(body))
            return
        self._seen.add(event_id)

    # -- locking and append ---------------------------------------------------

    def _lock_is_stale(self) -> bool:
        try:
            age = time.time() - os.stat(self.lock_path).st_mtime
        except OSError:
            return False
        return age > self.stale_lock_seconds

    def _acquire_file_lock(self, deadline: float) -> int:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        lock = str(self.lock_path)
        broke_stale = False
        while True:
            try:
                fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY | _O_BINARY, 0o600)
            except (FileExistsError, PermissionError):
                # PermissionError: Windows reports a lock file pending deletion this way.
                if not broke_stale and self._lock_is_stale():
                    broke_stale = True
                    try:
                        os.remove(lock)
                        self._add_gap("stale_lock_broken")
                    except OSError:
                        pass
                    continue
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise LedgerBusy("ledger lock busy")
                time.sleep(min(0.02, remaining))
                continue
            try:
                os.write(fd, ("pid=%d at=%s\n" % (os.getpid(), _now_iso())).encode("ascii"))
            except OSError:
                pass
            return fd

    def _release_file_lock(self, fd: int) -> None:
        try:
            os.close(fd)
        except OSError:
            pass
        for _ in range(3):
            try:
                os.remove(str(self.lock_path))
                return
            except FileNotFoundError:
                return
            except OSError:
                time.sleep(0.01)

    def _append(self, row: dict) -> Optional[dict]:
        start = time.monotonic()
        if start < self._busy_until:
            self._add_gap("event_not_recorded", reason="busy_cooldown")
            raise LedgerBusy("ledger busy (cooldown)")
        deadline = start + self.lock_timeout
        if not self._mutex.acquire(timeout=self.lock_timeout):
            self._mark_busy()
            raise LedgerBusy("ledger thread lock busy")
        try:
            try:
                fd = self._acquire_file_lock(deadline)
            except LedgerBusy:
                self._mark_busy()
                raise
            try:
                try:
                    return self._append_locked(row)
                except OSError:
                    self._add_gap("event_not_recorded", reason="write_failed")
                    raise
            finally:
                self._release_file_lock(fd)
        finally:
            self._mutex.release()

    def _append_locked(self, row: dict) -> Optional[dict]:
        size = self._catch_up()  # pick up rows written by other ledger instances
        if row["event_id"] in self._seen:
            return None
        data = (json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        if size > self._offset:
            # An unterminated (possibly truncated) last line exists: terminate it so
            # our row stays a complete, parseable line.
            data = b"\n" + data
        fd = os.open(str(self.path), os.O_WRONLY | os.O_APPEND | os.O_CREAT | _O_BINARY, 0o600)
        try:
            _write_all(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
        self._seen.add(row["event_id"])
        return row


# ---------------------------------------------------------------------------
# Wiring helper for webhook_server.py
# ---------------------------------------------------------------------------

def init_attribution(shop_root: Any, config: Any) -> tuple:
    """Return (ledger or None, registry). Never raises.

    `config` is the `attribution` object from shop.json. Missing, non-dict or
    enabled != true -> (None, empty registry). Missing/invalid secret ->
    (None, registry) after one [ATTRIBUTION_DISABLED] line. Relative paths are
    resolved against shop_root; the ledger lives in <shop_root>/data.
    """
    empty = Registry(registry_version="none", entries={}, load_status="missing")
    try:
        if not isinstance(config, dict) or config.get("enabled") is not True:
            _stderr("[ATTRIBUTION_DISABLED] not configured")
            return None, empty
        root = Path(shop_root)

        def resolve(value: Any, default: str) -> Path:
            p = Path(value) if isinstance(value, str) and value.strip() else Path(default)
            return p if p.is_absolute() else root / p

        registry = load_source_registry(resolve(config.get("registry_path"), DEFAULT_REGISTRY_REL))
        lock_timeout = config.get("lock_timeout_seconds", LOCK_TIMEOUT_MAX)
        if isinstance(lock_timeout, bool) or not isinstance(lock_timeout, (int, float)):
            lock_timeout = LOCK_TIMEOUT_MAX
        ledger = AttributionLedger(
            root / "data",
            resolve(config.get("secret_path"), DEFAULT_SECRET_REL),
            config.get("shop_id") or DEFAULT_SHOP_ID,
            config.get("oa_scope") or DEFAULT_OA_SCOPE,
            config.get("runtime_id") or DEFAULT_RUNTIME_ID,
            pos_source_id=config.get("pos_source_id") or None,
            lock_timeout=lock_timeout,
        )
        if not ledger.enabled:
            return None, registry
        return ledger, registry
    except Exception as exc:
        _report_error(exc)
        return None, empty