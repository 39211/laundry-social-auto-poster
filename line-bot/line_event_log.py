# -*- coding: utf-8 -*-
"""LINE-ACK r1: allowlisted webhook telemetry; no payloads or raw identifiers.

Only the real entry point enables LAUNDRY_LINE_EVENTS=on. Tests must explicitly
enable it and supply both *_DIR overrides. Importing this module does no I/O.
Durations exclude telemetry itself. Daily percentiles use nearest rank over
ceil(milliseconds); a numeric .state histogram preserves them across restarts.
The public daily JSON contains only the requested flat numeric counters.
"""
from __future__ import annotations

import contextvars
import functools
import hashlib
import hmac
import json
import logging
import math
import os
import re
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

TAIPEI = timezone(timedelta(hours=8))
COUNTERS = ("received", "replied_ok", "reply_failed", "reply_unknown", "to_staff",
            "no_reply_needed", "redelivered", "duplicate_skipped")
STAGES = ("processing", "reply", "staff_notify", "storage")
EVENT_TYPES = {"message", "postback", "follow", "unfollow", "join", "leave",
               "memberJoined", "memberLeft", "unsend", "videoPlayComplete", "beacon", "accountLink"}
SKIPPED = {"accepted_skipped", "not_needed_skipped", "handoff_skipped"}
_CURRENT = contextvars.ContextVar("line_event_span", default=None)
_LOCK = threading.Lock()
_WARNED = False


def now_taipei():
    return datetime.now(TAIPEI)


def _stamp(moment):
    return moment.astimezone(TAIPEI).isoformat(timespec="milliseconds")


@contextmanager
def measure(stage, *, to_staff=False):
    """Exclusive nested timings, scoped to this event/thread/context only."""
    span = _CURRENT.get()
    if span is None:
        yield
        return
    if to_staff:
        span.to_staff = True
    frame = [stage, time.perf_counter(), 0.0]
    span.stack.append(frame)
    try:
        yield
    finally:
        elapsed = max(0.0, time.perf_counter() - frame[1])
        span.stack.pop()
        span.timings[stage] += max(0.0, elapsed - frame[2]) * 1000
        if span.stack:
            span.stack[-1][2] += elapsed


def timed(stage, *, to_staff=False):
    def decorate(fn):
        @functools.wraps(fn)
        def wrapped(*args, **kwargs):
            with measure(stage, to_staff=to_staff):
                return fn(*args, **kwargs)
        return wrapped
    return decorate


def reply_result(value):
    span = _CURRENT.get()
    if span is not None:
        span.reply_result = value


def note_staff(meta):
    span = _CURRENT.get()
    if span is not None and isinstance(meta, dict):
        span.to_staff |= any(bool(meta.get(k)) for k in ("notify_staff", "staff_pushed"))


class EventSpan:
    def __init__(self, request_trace, event_id, event_type, redelivered):
        self.trace = request_trace
        # A domain-separated HMAC using the existing local secret, never its value.
        raw = event_id.encode("utf-8") if isinstance(event_id, str) else b""
        self.event_ref = hmac.new(request_trace.key, raw, hashlib.sha256).hexdigest() if raw else ""
        self.event_type = event_type if isinstance(event_type, str) and event_type in EVENT_TYPES else "other"
        self.redelivered = bool(redelivered)
        self.reply_result = "not_needed"
        self.dedup = "new"
        self.to_staff = False
        self.timings = dict.fromkeys(STAGES, 0.0)
        self.stack = []

    def __enter__(self):
        self.started_at = now_taipei()
        self.started = time.perf_counter()
        self.context_token = _CURRENT.set(self)
        self.processing = measure("processing")
        self.processing.__enter__()
        return self

    def __exit__(self, kind, value, traceback):
        try:
            self.processing.__exit__(kind, value, traceback)
            if kind is not None and self.reply_result == "not_needed":
                self.reply_result = "failed"
            # Constructed explicitly: never merge event/request/meta dictionaries.
            self.trace.events.append({
                "schema": "line-events/v1", "kind": "event",
                "request_ref": self.trace.request_ref, "event_ref": self.event_ref,
                "event_type": self.event_type, "received_at": _stamp(self.trace.received_at),
                "started_at": _stamp(self.started_at), "finished_at": _stamp(now_taipei()),
                "duration_ms": round(max(0.0, time.perf_counter() - self.started) * 1000, 3),
                "stages_ms": {k: round(v, 3) for k, v in self.timings.items()},
                "reply_result": self.reply_result, "redelivered": self.redelivered,
                "dedup": self.dedup, "to_staff": self.to_staff,
            })
        finally:
            _CURRENT.reset(self.context_token)


class RequestTrace:
    def __init__(self, secret, repo):
        self.received_at = now_taipei().astimezone(TAIPEI)
        self.started = time.perf_counter()
        self.request_ref = uuid.uuid4().hex
        self.key = hmac.new(secret, b"line-events/correlation/v1", hashlib.sha256).digest()
        self.repo = repo
        self.events = []

    def event(self, event_id, event_type, redelivered=False):
        return EventSpan(self, event_id, event_type, redelivered)

    def finish(self, http_status):
        if os.environ.get("LAUNDRY_LINE_EVENTS", "").strip().lower() != "on":
            return
        try:
            for row in self.events:
                row["http_status"] = int(http_status)
            outcomes = {row["reply_result"] for row in self.events}
            request_row = {
                "schema": "line-events/v1", "kind": "request", "request_ref": self.request_ref,
                "event_ref": "", "event_type": "request", "received_at": _stamp(self.received_at),
                "started_at": _stamp(self.received_at), "finished_at": _stamp(now_taipei()),
                "duration_ms": round(max(0.0, time.perf_counter() - self.started) * 1000, 3),
                "stages_ms": {k: round(sum(r["stages_ms"][k] for r in self.events), 3) for k in STAGES},
                "reply_result": next((s for s in ("unknown", "failed", "accepted") if s in outcomes), "not_needed"),
                "redelivered": any(r["redelivered"] for r in self.events), "dedup": "not_applicable",
                "to_staff": any(r["to_staff"] for r in self.events), "http_status": int(http_status),
                "event_count": len(self.events),
            }
            records = self.events + [request_row]
        except Exception as exc:
            _warn(exc)
            return
        # Independent sinks: a broken JSONL must not disable the numeric counter,
        # and neither sink may affect the already-decided customer response.
        try:
            _append_records(log_dir(), self.received_at.date(), records)
        except Exception as exc:
            _warn(exc)
        try:
            _count_events(count_dir(self.repo), self.received_at.date(), self.events)
        except Exception as exc:
            _warn(exc)


def log_dir():
    override = os.environ.get("LAUNDRY_LINE_EVENT_LOG_DIR", "").strip()
    return Path(override) if override else Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "line-bot"


def count_dir(repo):
    override = os.environ.get("LAUNDRY_LINE_EVENTS_DIR", "").strip()
    return Path(override) if override else Path(repo) / "data" / "line-events"


def _warn(exc):
    global _WARNED
    if not _WARNED:
        _WARNED = True
        try:
            logging.getLogger(__name__).warning("LINE event telemetry skipped (%s)", type(exc).__name__)
        except Exception:
            pass


def _append_records(directory, day, records):
    if not _LOCK.acquire(timeout=0.5):
        raise TimeoutError("event log lock busy")
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / f"line-events-{day.isoformat()}.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
            for row in records:
                handle.write(json.dumps(row, ensure_ascii=True, separators=(",", ":")) + "\n")
        cutoff = day - timedelta(days=13)  # today plus the previous 13 Taipei days
        for path in directory.glob("line-events-????-??-??.jsonl"):
            if not re.fullmatch(r"line-events-\d{4}-\d{2}-\d{2}\.jsonl", path.name):
                continue
            try:
                old_day = date.fromisoformat(path.name[12:-6])
                attrs = getattr(path.lstat(), "st_file_attributes", 0)
                if old_day < cutoff and not path.is_symlink() and not attrs & 0x400:
                    path.unlink()
            except (OSError, ValueError):
                continue
    finally:
        _LOCK.release()


def _atomic_write(path, data):
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=True, indent=1)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def _count_events(directory, day, events):
    if not events:
        return
    if not _LOCK.acquire(timeout=0.5):
        raise TimeoutError("event counter lock busy")
    try:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{day.isoformat()}.json"
        state = directory / ".state" / path.name
        state.parent.mkdir(exist_ok=True)
        keys = (*COUNTERS, "processing_ms_p50", "processing_ms_p95", "processing_ms_max", "processing_ms_histogram")
        if state.exists():
            data = json.loads(state.read_text(encoding="utf-8"))
            if set(data) != set(keys) or any(type(data[k]) is not int or data[k] < 0 for k in keys[:-1]):
                raise ValueError("invalid event counter")
        else:
            if path.exists():
                raise ValueError("event counter state missing; preserving daily file")
            data = dict.fromkeys(keys[:-1], 0)
            data["processing_ms_histogram"] = {}
        histogram = data["processing_ms_histogram"]
        if not isinstance(histogram, dict) or any(not re.fullmatch(r"0|[1-9][0-9]*", k) or type(v) is not int or v < 1 for k, v in histogram.items()):
            raise ValueError("invalid event histogram")
        if sum(histogram.values()) != data["received"]:
            raise ValueError("event histogram count mismatch")
        outcome_key = {"accepted": "replied_ok", "failed": "reply_failed", "unknown": "reply_unknown", "not_needed": "no_reply_needed"}
        for row in events:
            data["received"] += 1
            data[outcome_key[row["reply_result"]]] += 1
            data["redelivered"] += int(row["redelivered"])
            data["duplicate_skipped"] += int(row["dedup"] in SKIPPED)
            data["to_staff"] += int(row["to_staff"])
            bucket = str(math.ceil(max(0, row["duration_ms"])))
            histogram[bucket] = histogram.get(bucket, 0) + 1
        ordered = sorted((int(k), v) for k, v in histogram.items())
        for percent in (50, 95):
            rank = math.ceil(data["received"] * percent / 100)
            cumulative = 0
            for duration, count in ordered:
                cumulative += count
                if cumulative >= rank:
                    data[f"processing_ms_p{percent}"] = duration
                    break
        data["processing_ms_max"] = ordered[-1][0]
        # State is authoritative. If publishing the numeric view fails, the next
        # event rebuilds it from state rather than losing already counted work.
        _atomic_write(state, data)
        _atomic_write(path, {k: data[k] for k in keys[:-1]})
    finally:
        _LOCK.release()
