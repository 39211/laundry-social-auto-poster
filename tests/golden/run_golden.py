# -*- coding: utf-8 -*-
"""LINE bot golden comparison harness (task card D1-2; tests only, no product change).

    python tests/golden/run_golden.py record              # writes tests/golden/linebot.golden.json
    python tests/golden/run_golden.py check               # exit 1 on any byte difference
    python tests/golden/run_golden.py check --env-matrix  # SXJ_SHOP_ID unset and =sxj; both must match
    python tests/golden/run_golden.py guard-selftest      # proves production paths are refused
Options: --cases PATH and --golden PATH (the 60-90 case rule applies to the default case file only).

Exit codes: 0 pass; 1 golden difference, nondeterminism, or a guard probe that was not refused;
2 harness or input error (nothing was compared). Sandbox, guard and Flask shim follow
line-bot/run_a2b_tests.py without importing it. Standard library only; no network.
"""
from __future__ import annotations

import argparse
import ast
import datetime as _dtmod
import email.message
import hashlib
import importlib
import io
import json
import math
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import types
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

SCRIPT = Path(__file__).resolve()
HERE = SCRIPT.parent
REPO_ROOT = HERE.parent.parent
BOT_DIR = REPO_ROOT / "line-bot"
RUN_A2B = BOT_DIR / "run_a2b_tests.py"
FLASK_SHIM_FILE = BOT_DIR / "test_linebot_fix_20260926.py"
DEFAULT_CASES = HERE / "linebot_cases.json"
DEFAULT_GOLDEN = HERE / "linebot.golden.json"

CASES_FORMAT = "linebot-golden-cases/1"
TRANSCRIPT_FORMAT = "linebot-golden/1"
EXIT_OK, EXIT_DIFF, EXIT_HARNESS = 0, 1, 2
CLOCK_STEP_SECONDS = 30
DEFAULT_JOIN_SECONDS = 10.0
MIN_CASES, MAX_CASES, MAX_TURNS = 60, 90, 12
TAIPEI = _dtmod.timezone(_dtmod.timedelta(hours=8))
GUARD_MARK = "golden-guard"
TMP_PREFIX = ".golden-tmp-"
MATRIX_PREFIX = ".golden-matrix-"
WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MATRIX = (("SXJ_SHOP_ID unset", None), ("SXJ_SHOP_ID=sxj", "sxj"))

REQUIRED_TOPICS = (
    "greeting", "hours", "address", "pickup", "price", "turnaround",
    "photo", "lookup", "handover", "complaint", "richmenu", "unknown",
)
ALLOWED_TOPICS = frozenset(REQUIRED_TOPICS + ("booking",))
# turn type -> (required keys besides "type", optional keys)
TURN_SPEC: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "message": (("text",), ()),
    "location": (("text",), ()),
    "image": (("text",), ()),
    "follow": ((), ()),
    "sticker": ((), ()),
    "image_error": ((), ()),
    "postback": (("data",), ("params",)),
}
PRISTINE_DATA_FILES = ("prices.json", "business-profile.json")
# Machine-local, untracked switches read from line-bot/; treated as absent so the golden
# does not depend on which PC records it.
MASKED_LOCAL_FILES = (".env", "coupon-name.txt", "coupon-url.txt", "merchant-pay-url.txt", "public_base.txt")
SCRUBBED_ENV = frozenset({
    "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY",
    "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET",
})
SYNTHETIC_FIXTURE = {
    "customers": [
        {"no": "0028", "name": "Synthetic A", "phone": "0900000001"},
        {"no": "1947", "name": "Synthetic B", "phone": "0900000002"},
    ],
    "garments": [
        {"id": "1", "customer_no": "0028", "wash_no": "W1001", "name": "shirt", "status": "stock"},
        {"id": "2", "customer_no": "0028", "wash_no": "W1002", "name": "coat", "status": "wash"},
        {"id": "3", "customer_no": "1947", "wash_no": "W2001", "name": "coat", "status": "wash"},
    ],
}
SYNTHETIC_CHANNEL = {
    "channel_secret": "synthetic-offline", "channel_access_token": "synthetic-offline",
    "channelSecret": "synthetic-offline", "channelAccessToken": "synthetic-offline",
}

_REAL_DATETIME = _dtmod.datetime
_REAL_TIME = time.time
_REAL_TIME_NS = time.time_ns
_REAL_URANDOM = os.urandom
_REAL_UUID4 = uuid.uuid4
_REAL_THREAD_START = threading.Thread.start
_REAL_OPENER_OPEN = urllib.request.OpenerDirector.open


class HarnessError(Exception):
    """Setup or input problem (exit 2); never a golden difference."""


# ------------------------------------------------------------------ canonical JSON

def canonical_bytes(obj: Any) -> bytes:
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2, separators=(",", ": "), allow_nan=False)
    return (text + "\n").encode("utf-8")


def canonical_text(obj: Any) -> str:
    return canonical_bytes(obj).decode("utf-8")


_SURROGATE_RE = re.compile("[\ud800-\udfff]")


def jsonable(value: Any, depth: int = 0) -> Any:
    """Deep copy into plain JSON types; unknown objects become their type name."""
    if depth > 60:
        return "<DEPTH-LIMIT>"
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else repr(value)
    if isinstance(value, str):
        return _SURROGATE_RE.sub(lambda m: "\\u%04x" % ord(m.group(0)), value)
    if isinstance(value, (bytes, bytearray)):
        return {"bytes": len(value)}
    if isinstance(value, dict):
        return {jsonable(k if isinstance(k, str) else str(k)): jsonable(v, depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v, depth + 1) for v in value]
    if isinstance(value, (set, frozenset)):
        items = [jsonable(v, depth + 1) for v in value]
        return sorted(items, key=lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True))
    if isinstance(value, (_dtmod.date, _dtmod.time)):
        return value.isoformat()
    if isinstance(value, (_dtmod.timedelta, Path)):
        return str(value)
    return {"__type__": type(value).__name__}


# ------------------------------------------------------------------ forbidden-root guard

def load_forbidden_roots(source: Path = RUN_A2B) -> tuple[str, ...]:
    """Read the `forbidden = (...)` tuple from line-bot/run_a2b_tests.py (same guard, no import)."""
    try:
        tree = ast.parse(source.read_text(encoding="utf-8-sig"), filename=str(source))
    except (OSError, SyntaxError) as exc:
        raise HarnessError(f"cannot read {source.name} to copy its forbidden-root guard ({exc})") from exc
    found = [n.value for n in ast.walk(tree) if isinstance(n, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == "forbidden" for t in n.targets)]
    if len(found) != 1:
        raise HarnessError(f"expected exactly one `forbidden = (...)` in {source.name}, found {len(found)}")
    try:
        value = ast.literal_eval(found[0])
    except (ValueError, TypeError, SyntaxError) as exc:
        raise HarnessError(f"`forbidden` in {source.name} is not a literal") from exc
    if not isinstance(value, (tuple, list)) or not value or not all(isinstance(v, str) and v.strip() for v in value):
        raise HarnessError(f"`forbidden` in {source.name} must be a non-empty tuple of path strings")
    roots = tuple(dict.fromkeys(v.strip().replace("\\", "/").lower().rstrip("/") for v in value))
    if "c:/fxwash" not in roots:
        raise HarnessError(f"`forbidden` in {source.name} no longer contains c:/fxwash; refusing to run")
    return roots


def norm_path(value: Any) -> str | None:
    """Absolute, lower-case, forward-slash form (Windows paths are case-insensitive)."""
    if value is None or isinstance(value, (bool, int)):
        return None
    try:
        text = os.fsdecode(value)
    except TypeError:
        return None
    if not text or "\x00" in text:
        return None
    try:
        text = os.path.abspath(text)
    except (OSError, ValueError):
        return None
    text = text.replace("\\", "/")
    if text.startswith("//?/"):
        text = text[4:]
    text = text.lower()
    return text.rstrip("/") if len(text) > 3 else text


def _under(value: str, root: str) -> bool:
    return value == root or value.startswith(root + "/")


def is_blocked(path: Any, roots: tuple[str, ...]) -> bool:
    value = norm_path(path)
    return value is not None and any(_under(value, r) for r in roots)


def protected_roots() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(run_a2b forbidden roots, those plus this checkout's own data/ and secrets/)."""
    forbidden = load_forbidden_roots()
    if is_blocked(REPO_ROOT, forbidden):
        raise HarnessError("this checkout is inside a protected production path (same guard as "
                           "line-bot/run_a2b_tests.py); run the harness from a branch worktree")
    private = tuple(r for r in (norm_path(REPO_ROOT / "data"), norm_path(REPO_ROOT / "secrets")) if r)
    return forbidden, forbidden + private


class Guard:
    def __init__(self, forbidden: tuple[str, ...], masked: list[Path]) -> None:
        self.forbidden = tuple(forbidden)
        self.masked = frozenset(m for m in (norm_path(p) for p in masked) if m)

    def classify(self, path: Any) -> str | None:
        value = norm_path(path)
        if value is None:
            return None
        if any(_under(value, r) for r in self.forbidden):
            return "forbidden"
        return "masked" if value in self.masked else None

    @staticmethod
    def refusal(kind: str, what: str) -> OSError:
        if kind == "forbidden":
            return PermissionError(f"{GUARD_MARK}: production path isolated ({what})")
        return FileNotFoundError(f"{GUARD_MARK}: machine-local file treated as absent ({what})")


_FILE_EVENTS: dict[str, tuple[int, ...]] = {
    "open": (0,), "os.listdir": (0,), "os.scandir": (0,), "os.mkdir": (0,), "os.rmdir": (0,),
    "os.remove": (0,), "os.rename": (0, 1), "os.chmod": (0,), "os.truncate": (0,), "os.utime": (0,),
    "os.link": (0, 1), "os.symlink": (0, 1), "shutil.copyfile": (0, 1), "shutil.copytree": (0, 1),
    "shutil.rmtree": (0,), "shutil.move": (0, 1), "os.startfile": (0,),
}
_NET_EVENTS = frozenset({
    "socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.gethostbyname",
    "socket.gethostbyaddr", "http.client.connect",
})
_INSTALLED: set[str] = set()


# ------------------------------------------------------------------ recorder

def _qualname(fn: Any) -> str:
    if fn is None:
        return "None"
    return f"{getattr(fn, '__module__', '?')}.{getattr(fn, '__qualname__', type(fn).__name__)}"


def _sort_key(effect: Any) -> str:
    return json.dumps(effect, ensure_ascii=False, sort_keys=True)


class Recorder:
    """Side effects of one turn. Main-thread effects keep their order; background-thread effects
    are sorted so thread interleaving cannot change the transcript."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.active = False
        self.main: list[Any] = []
        self.background: list[Any] = []
        self.threads: list[threading.Thread] = []

    def begin(self) -> None:
        with self.lock:
            self.active, self.main, self.background, self.threads = True, [], [], []

    def add(self, effect: dict) -> None:
        item = jsonable(effect)
        with self.lock:
            if self.active:
                main = threading.current_thread() is threading.main_thread()
                (self.main if main else self.background).append(item)

    def track(self, thread: threading.Thread) -> None:
        with self.lock:
            if self.active:
                self.threads.append(thread)

    def end(self, join_seconds: float) -> list[Any]:
        deadline = time.monotonic() + join_seconds
        joined: set[int] = set()
        while True:
            with self.lock:
                pending = [t for t in self.threads if id(t) not in joined]
            if not pending:
                break
            for thread in pending:
                joined.add(id(thread))
                if thread.is_alive():
                    thread.join(max(0.0, deadline - time.monotonic()))
        with self.lock:
            effects = self.main + sorted(self.background, key=_sort_key)
            stuck = sorted(_qualname(getattr(t, "_target", None)) for t in self.threads if t.is_alive())
            self.active, self.main, self.background, self.threads = False, [], [], []
        return effects + [{"effect": "thread_still_running", "target": name} for name in stuck]


RECORDER = Recorder()


def install_guard(guard: Guard) -> None:
    """Same shape as run_a2b_tests.py: probes report absence before any OS stat, and an audit
    hook refuses file access under the forbidden roots and all network access (recorded)."""
    if "guard" in _INSTALLED:
        return
    real_stat = os.stat

    def safe_stat(path: Any, *args: Any, **kwargs: Any) -> Any:
        if guard.classify(path):
            raise FileNotFoundError(f"{GUARD_MARK}: path isolated (stat)")
        return real_stat(path, *args, **kwargs)

    os.stat = safe_stat
    for name in ("exists", "isfile", "isdir"):
        def os_probe(path: Any, _original: Any = getattr(os.path, name)) -> bool:
            return False if guard.classify(path) else _original(path)
        setattr(os.path, name, os_probe)
    for name in ("exists", "is_file", "is_dir"):
        def path_probe(path: Any, *args: Any, _original: Any = getattr(Path, name), **kwargs: Any) -> bool:
            return False if guard.classify(path) else _original(path, *args, **kwargs)
        setattr(Path, name, path_probe)

    def audit(event: str, args: tuple) -> None:
        indexes = _FILE_EVENTS.get(event)
        if indexes is not None:
            for index in indexes:
                kind = guard.classify(args[index]) if index < len(args) else None
                if kind:
                    raise Guard.refusal(kind, event)
            return
        if event in _NET_EVENTS:
            if event in ("socket.connect", "socket.sendto"):
                target = args[1] if len(args) > 1 else None
            else:
                target = args[1:3] if event == "http.client.connect" else args[:2]
            RECORDER.add({"effect": "network_refused", "event": event, "target": target})
            raise PermissionError(f"{GUARD_MARK}: network forbidden ({event})")

    sys.addaudithook(audit)
    _INSTALLED.add("guard")


# ------------------------------------------------------------------ determinism

_DET_LOCK = threading.Lock()
_STATE: dict[str, Any] = {"clock": None, "seed": None, "counter": 0, "time_calls": 0}


def _set_clock(value: _dtmod.datetime | None) -> None:
    with _DET_LOCK:
        _STATE.update(clock=value, time_calls=0)


def _set_seed(seed: str | None) -> None:
    with _DET_LOCK:
        _STATE.update(seed=seed, counter=0, time_calls=0)


class _FrozenDateTime(_REAL_DATETIME):
    """datetime.datetime whose now()/today()/utcnow() follow the harness clock."""

    @classmethod
    def _golden_from(cls, v: _dtmod.datetime) -> "_FrozenDateTime":
        return cls(v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond, v.tzinfo, fold=v.fold)

    @classmethod
    def now(cls, tz: Any = None) -> "_FrozenDateTime":
        base = _STATE["clock"]
        if base is None:
            return cls._golden_from(_REAL_DATETIME.now(tz))
        return cls._golden_from(base.astimezone(tz) if tz is not None else base.replace(tzinfo=None))

    @classmethod
    def today(cls) -> "_FrozenDateTime":
        return cls.now()

    @classmethod
    def utcnow(cls) -> "_FrozenDateTime":
        return cls._golden_from(cls.now(_dtmod.timezone.utc).replace(tzinfo=None))


def _tick() -> int:
    with _DET_LOCK:
        _STATE["time_calls"] += 1
        return _STATE["time_calls"]


def _fake_time() -> float:
    base = _STATE["clock"]
    # +1 ms per call so polling loops cannot spin forever; deterministic per turn.
    return _REAL_TIME() if base is None else base.timestamp() + _tick() / 1000.0


def _fake_time_ns() -> int:
    base = _STATE["clock"]
    return _REAL_TIME_NS() if base is None else int(base.timestamp()) * 1_000_000_000 + _tick() * 1_000_000


def _det_bytes(label: str, size: int) -> bytes:
    with _DET_LOCK:
        _STATE["counter"] += 1
        seed, counter = _STATE["seed"], _STATE["counter"]
    out = bytearray()
    block = 0
    while len(out) < size:
        out += hashlib.sha256(f"{seed}|{label}|{counter}|{block}".encode("utf-8")).digest()
        block += 1
    return bytes(out[:size])


def _fake_urandom(size: int) -> bytes:
    return _REAL_URANDOM(size) if _STATE["seed"] is None else _det_bytes("urandom", int(size))


def _fake_uuid4() -> uuid.UUID:
    return _REAL_UUID4() if _STATE["seed"] is None else uuid.UUID(bytes=_det_bytes("uuid4", 16), version=4)


def _tracked_start(self: threading.Thread) -> None:
    if RECORDER.active:
        if isinstance(self, threading.Timer):
            RECORDER.add({"effect": "timer_not_started", "interval": self.interval,
                          "target": _qualname(getattr(self, "function", None))})
            return None
        RECORDER.track(self)
    return _REAL_THREAD_START(self)


class _FakeHTTPResponse(io.BytesIO):
    """Answer for every recorded urllib request: HTTP 200 with body {}."""

    def __init__(self, url: str) -> None:
        super().__init__(b"{}")
        self.url, self.status, self.code, self.reason = url, 200, 200, "OK"
        self.headers = self.msg = email.message.Message()
        self.headers["Content-Type"] = "application/json"

    def getcode(self) -> int:
        return 200

    def geturl(self) -> str:
        return self.url

    def info(self) -> email.message.Message:
        return self.headers

    def getheader(self, name: str, default: Any = None) -> Any:
        return self.headers.get(name, default)


def _body_summary(body: Any) -> Any:
    if body is None:
        return None
    if isinstance(body, str):
        body = body.encode("utf-8", "replace")
    if not isinstance(body, (bytes, bytearray)):
        return {"non_bytes_body": type(body).__name__}
    try:
        text = bytes(body).decode("utf-8")
    except UnicodeDecodeError:
        return {"bytes": len(body)}
    try:
        return {"json": json.loads(text)}
    except ValueError:
        return {"text": text[:4000]}


def _fake_opener_open(self: Any, fullurl: Any, data: Any = None, *args: Any, **kwargs: Any) -> Any:
    url = fullurl if isinstance(fullurl, str) else getattr(fullurl, "full_url", "")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme.lower() not in ("http", "https"):
        return _REAL_OPENER_OPEN(self, fullurl, data, *args, **kwargs)
    if isinstance(fullurl, str):
        body, method = data, ("POST" if data is not None else "GET")
    else:
        body = data if data is not None else getattr(fullurl, "data", None)
        method = "POST" if data is not None else fullurl.get_method()
    port = f":{parts.port}" if parts.port else ""
    RECORDER.add({"effect": "http_request_stubbed", "method": method, "body": _body_summary(body),
                  "url": f"{parts.scheme.lower()}://{parts.hostname or ''}{port}{parts.path}"})
    return _FakeHTTPResponse(url)


def install_determinism() -> None:
    if "determinism" in _INSTALLED:
        return
    _dtmod.datetime = _FrozenDateTime
    time.time, time.time_ns = _fake_time, _fake_time_ns
    os.urandom, uuid.uuid4 = _fake_urandom, _fake_uuid4
    threading.Thread.start = _tracked_start
    urllib.request.OpenerDirector.open = _fake_opener_open
    _INSTALLED.add("determinism")


def _inherited_mkdtemp(suffix: Any = None, prefix: Any = None, dir: Any = None) -> str:
    # Same as run_a2b_tests.py: Python 3.14's Windows mode=0o700 temp ACL excludes the sandbox
    # identity; a normal mkdir inherits this worktree's usable ACL.
    base = Path(dir or tempfile.gettempdir())
    for _attempt in range(100):
        path = base / ((prefix or "tmp") + _REAL_UUID4().hex + (suffix or ""))
        try:
            path.mkdir(mode=0o755)
        except FileExistsError:
            continue
        return str(path)
    raise FileExistsError("golden: could not create a unique temporary directory")


# ------------------------------------------------------------------ stubs and shim

def _stub_push_inbox(kind: Any, payload: Any = None, *args: Any, **kwargs: Any) -> dict:
    effect: dict[str, Any] = {"effect": "staff_notify.push_inbox", "kind": kind, "payload": payload}
    if args:
        effect["extra_args"] = list(args)
    if kwargs:
        effect["kwargs"] = dict(kwargs)
    RECORDER.add(effect)
    return {"saved": True, "notified": bool(kwargs.get("notify", True))}


def _stub_guest_name(*_args: Any, **_kwargs: Any) -> str:
    return "客人"


def _install_staff_notify_stub() -> str:
    try:
        module = importlib.import_module("staff_notify")
        mode = "real module; push_inbox and guest_name replaced by record-only stubs"
    except Exception as exc:
        module = types.ModuleType("staff_notify")
        module.__golden_stub__ = True  # type: ignore[attr-defined]
        sys.modules["staff_notify"] = module
        mode = f"stub module (real import failed: {type(exc).__name__})"
    module.push_inbox = _stub_push_inbox  # type: ignore[attr-defined]
    module.guest_name = _stub_guest_name  # type: ignore[attr-defined]
    return mode


def _install_flask_shim() -> None:
    """Reuse only the offline Flask shim function, exactly as run_a2b_tests.py does."""
    if "flask" in _INSTALLED:
        return
    try:
        tree = ast.parse(FLASK_SHIM_FILE.read_text(encoding="utf-8-sig"), filename=str(FLASK_SHIM_FILE))
    except OSError as exc:
        raise HarnessError(f"cannot read {FLASK_SHIM_FILE.name} for the offline Flask shim ({exc})") from exc
    function = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_install_flask_shim"), None)
    if function is None:
        raise HarnessError(f"{FLASK_SHIM_FILE.name} no longer defines _install_flask_shim")
    namespace: dict[str, Any] = {"sys": sys, "json": json}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(FLASK_SHIM_FILE), "exec"), namespace)
    namespace["_install_flask_shim"]()
    flask = importlib.import_module("flask")
    if not hasattr(flask.Flask, "run"):
        def no_server(*_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("golden: starting a server is forbidden")
        flask.Flask.run = no_server
    _INSTALLED.add("flask")


# ------------------------------------------------------------------ normalisation

_UUID_RE = re.compile(
    r"(?<![0-9A-Fa-f])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![0-9A-Fa-f])")
_TS_RE = re.compile(r"(?<!\d)\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}"
                    r"(?::\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?|(?:Z|[+-]\d{2}:\d{2}))")
_ADDR_RE = re.compile(r"0x[0-9a-fA-F]{6,}")
_HEX_RE = re.compile(r"(?<![0-9A-Za-z])[0-9a-f]{16,}(?![0-9A-Za-z])")
_TMPNAME_RE = re.compile(r"(?<![0-9A-Za-z_])tmp[a-z0-9_]{8}(?![0-9A-Za-z_])")


def _path_pattern(path: str) -> re.Pattern[str]:
    parts = [re.escape(p) for p in re.split(r"[\\/]+", path.rstrip("\\/")) if p]
    return re.compile(r"[\\/]+".join(parts) + r"(?![A-Za-z0-9_.\-])", re.IGNORECASE)


class Normalizer:
    """Replaces volatile values with stable placeholders, numbered per case in output order."""

    def __init__(self, literal_paths: list[tuple[str, str]], event_ids: list[str], real_dates: tuple[str, ...]) -> None:
        seen: set[str] = set()
        self._paths: list[tuple[re.Pattern[str], str]] = []
        for value, label in sorted(literal_paths, key=lambda item: -len(item[0])):
            key = value.lower().replace("\\", "/").rstrip("/")
            if value and key not in seen and len(key) >= 4:
                seen.add(key)
                self._paths.append((_path_pattern(value), label))
        self._events = {eid: f"<EVENT#{i}>" for i, eid in enumerate(event_ids, 1)}
        self._real_dates = real_dates
        self._labels: dict[tuple[str, str], str] = {}
        self._counts: dict[str, int] = {}

    def _number(self, kind: str, value: str) -> str:
        if (kind, value) not in self._labels:
            self._counts[kind] = self._counts.get(kind, 0) + 1
            self._labels[(kind, value)] = f"<{kind}#{self._counts[kind]}>"
        return self._labels[(kind, value)]

    def text(self, s: str) -> str:
        for pattern, label in self._paths:
            s = pattern.sub(label, s)
        for eid, label in self._events.items():
            s = s.replace(eid, label)
        s = _ADDR_RE.sub("<ADDR>", s)
        s = _UUID_RE.sub(lambda m: self._number("UUID", m.group(0).lower()), s)
        s = _TS_RE.sub(lambda m: self._number("TS", m.group(0)), s)
        for real in self._real_dates:
            s = s.replace(real, "<REAL_DATE>")
        s = _HEX_RE.sub(lambda m: self._number("HEX", m.group(0)), s)
        return _TMPNAME_RE.sub(lambda m: self._number("TMPNAME", m.group(0)), s)

    def apply(self, obj: Any) -> Any:
        if isinstance(obj, dict):
            return {self.text(k): self.apply(obj[k]) for k in sorted(obj)}
        if isinstance(obj, list):
            return [self.apply(v) for v in obj]
        return self.text(obj) if isinstance(obj, str) else obj


# ------------------------------------------------------------------ case file

_CASE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
_PHONE_LIKE_RE = re.compile(r"(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)")
_FAKE_PHONE_RE = re.compile(r"09000000\d\d")
_LINE_UID_RE = re.compile(r"(?<![0-9A-Za-z])U[0-9a-f]{32}(?![0-9A-Za-z])")


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise HarnessError(f"duplicate key {key!r} in the case file")
        out[key] = value
    return out


def _check_synthetic(value: Any, where: str = "$") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _check_synthetic(key, where)
            _check_synthetic(item, f"{where}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _check_synthetic(item, f"{where}[{index}]")
    elif isinstance(value, str):
        for match in _PHONE_LIKE_RE.finditer(value):
            if not _FAKE_PHONE_RE.fullmatch(re.sub(r"\D", "", match.group(0))):
                raise HarnessError(f"non-synthetic phone number at {where}: cases must use fake phones 09000000xx")
        if _LINE_UID_RE.search(value):
            raise HarnessError(f"LINE user id at {where}: uids are derived by the harness; keep cases synthetic")


def parse_clock(text: Any) -> _dtmod.datetime:
    if not isinstance(text, str):
        raise HarnessError("clock values must be ISO strings such as 2030-01-09T14:00:00+08:00")
    try:
        value = _REAL_DATETIME.fromisoformat(text)
    except ValueError as exc:
        raise HarnessError(f"bad clock {text!r}") from exc
    if value.utcoffset() != _dtmod.timedelta(hours=8):
        raise HarnessError(f"clock {text!r} must carry the +08:00 (Asia/Taipei) offset")
    return value.astimezone(TAIPEI)


def _check_turn(turn: Any, where: str) -> None:
    if not isinstance(turn, dict) or not isinstance(turn.get("type"), str):
        raise HarnessError(f"{where}: each turn must be an object with a string 'type'")
    kind = turn["type"]
    if kind not in TURN_SPEC:
        raise HarnessError(f"{where}: unknown turn type {kind!r}; allowed: {', '.join(sorted(TURN_SPEC))}")
    required, optional = TURN_SPEC[kind]
    extra = sorted(set(turn) - {"type", *required, *optional})
    if extra:
        raise HarnessError(f"{where}: unknown keys {extra} for a {kind} turn")
    for key in required:
        if not isinstance(turn.get(key), str) or not turn[key].strip():
            raise HarnessError(f"{where}: {kind} turn needs a non-empty string {key!r}")
    if kind == "image" and not turn["text"].startswith("photos/"):
        raise HarnessError(f"{where}: image text must be a synthetic photos/... path")
    params = turn.get("params", {})
    if not isinstance(params, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in params.items()):
        raise HarnessError(f"{where}: postback params must map strings to strings")


def load_cases(path: Path, *, require_full: bool) -> dict:
    try:
        doc = json.loads(path.read_bytes().decode("utf-8"), object_pairs_hook=_no_duplicate_keys)
    except OSError as exc:
        raise HarnessError(f"cannot read case file {path.name} ({exc})") from exc
    except UnicodeDecodeError as exc:
        raise HarnessError(f"case file {path.name} is not UTF-8") from exc
    except ValueError as exc:
        raise HarnessError(f"case file {path.name} is not valid JSON ({exc})") from exc
    if not isinstance(doc, dict):
        raise HarnessError("case file must be a JSON object")
    _check_synthetic(doc)
    extra = sorted(set(doc) - {"format", "default_clock", "cases", "notes"})
    if extra:
        raise HarnessError(f"case file has unknown top-level keys {extra}")
    if doc.get("format") != CASES_FORMAT:
        raise HarnessError(f"case file format must be {CASES_FORMAT!r}")
    parse_clock(doc.get("default_clock"))
    if "notes" in doc and not (isinstance(doc["notes"], list) and all(isinstance(n, str) for n in doc["notes"])):
        raise HarnessError("notes must be a list of strings")
    cases = doc.get("cases")
    if not isinstance(cases, list) or not cases:
        raise HarnessError("case file needs a non-empty 'cases' list")
    seen: set[str] = set()
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise HarnessError(f"cases[{index}] must be an object")
        extra = sorted(set(case) - {"id", "topic", "title", "clock", "turns"})
        if extra:
            raise HarnessError(f"cases[{index}]: unknown keys {extra}")
        cid = case.get("id")
        if not isinstance(cid, str) or not _CASE_ID_RE.fullmatch(cid):
            raise HarnessError(f"cases[{index}]: id must match {_CASE_ID_RE.pattern}")
        if cid in seen:
            raise HarnessError(f"duplicate case id {cid}")
        seen.add(cid)
        if case.get("topic") not in ALLOWED_TOPICS:
            raise HarnessError(f"case {cid}: topic must be one of {sorted(ALLOWED_TOPICS)}")
        if not isinstance(case.get("title"), str) or not case["title"].strip():
            raise HarnessError(f"case {cid}: title is required")
        if "clock" in case:
            parse_clock(case["clock"])
        turns = case.get("turns")
        if not isinstance(turns, list) or not 1 <= len(turns) <= MAX_TURNS:
            raise HarnessError(f"case {cid}: turns must be a list of 1..{MAX_TURNS} turns")
        for t_index, turn in enumerate(turns):
            _check_turn(turn, f"case {cid} turn {t_index}")
    if require_full:
        if not MIN_CASES <= len(cases) <= MAX_CASES:
            raise HarnessError(f"the default case file must hold {MIN_CASES}-{MAX_CASES} cases, found {len(cases)}")
        missing = sorted(set(REQUIRED_TOPICS) - {c["topic"] for c in cases})
        if missing:
            raise HarnessError(f"the default case file misses required topics {missing}")
    return doc


def case_uid(case_id: str) -> str:
    return "U" + hashlib.sha256(("golden-uid:" + case_id).encode("utf-8")).hexdigest()[:32]


def case_event_id(case_id: str, turn_index: int) -> str:
    return "GOLDENEV" + hashlib.sha256(f"golden-event:{case_id}:{turn_index}".encode("utf-8")).hexdigest()[:18].upper()


# ------------------------------------------------------------------ harness

def _zoneinfo_available() -> bool:
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo("Asia/Taipei")
        return True
    except Exception:
        return False


def _safe_rmtree(path: Path | None, prefix: str) -> None:
    if path is None or not path.exists():
        return
    if path.parent != HERE or not path.name.startswith(prefix):
        print(f"WARNING: refusing to delete unexpected path {path}", file=sys.stderr)
        return
    try:
        shutil.rmtree(path)
    except OSError as exc:
        print(f"WARNING: could not remove {path} ({type(exc).__name__}); delete it by hand", file=sys.stderr)


class Harness:
    def __init__(self, forbidden: tuple[str, ...], roots: tuple[str, ...]) -> None:
        self.forbidden, self.roots = forbidden, roots
        self.tmp_root: Path | None = None
        self.header: dict[str, Any] = {}

    def setup(self) -> None:
        """Once per process (audit hooks cannot be removed)."""
        if not (BOT_DIR / "conversation.py").is_file():
            raise HarnessError(f"line-bot/conversation.py not found under {REPO_ROOT}")
        for name in PRISTINE_DATA_FILES:
            if not (REPO_ROOT / "data" / name).is_file():
                raise HarnessError(f"data/{name} is missing; it is the only real file the sandbox copies")
        sys.dont_write_bytecode = True
        self.tmp_root = HERE / (TMP_PREFIX + _REAL_UUID4().hex)
        self.tmp_root.mkdir()
        self.case_tmp = self.tmp_root / "t"
        self.case_tmp.mkdir()
        tempfile.tempdir = str(self.case_tmp)
        os.environ.update(TMP=str(self.case_tmp), TEMP=str(self.case_tmp), PYTHONDONTWRITEBYTECODE="1")
        tempfile.mkdtemp = _inherited_mkdtemp
        self.pristine = self.tmp_root / "pristine"
        (self.pristine / "data").mkdir(parents=True)
        (self.pristine / "secrets").mkdir()
        for name in PRISTINE_DATA_FILES:
            shutil.copyfile(REPO_ROOT / "data" / name, self.pristine / "data" / name)
        (self.pristine / "data" / "laundry-fixture.json").write_text(json.dumps(SYNTHETIC_FIXTURE), encoding="utf-8")
        (self.pristine / "secrets" / "line-channel.json").write_text(json.dumps(SYNTHETIC_CHANNEL), encoding="utf-8")
        self.pristine_bytes = {p.relative_to(self.pristine).as_posix(): p.read_bytes()
                               for p in sorted(self.pristine.rglob("*")) if p.is_file()}
        self.sandbox = self.tmp_root / "repo"
        zoneinfo_ok = _zoneinfo_available()  # before the clock patch, so zoneinfo binds the real datetime
        # From here on the checkout's own data/ and secrets/ are blocked as well.
        install_guard(Guard(self.roots, [BOT_DIR / n for n in MASKED_LOCAL_FILES]))
        install_determinism()
        _install_flask_shim()
        if str(BOT_DIR) not in sys.path:
            sys.path.insert(0, str(BOT_DIR))
        real_now = _REAL_DATETIME.now(TAIPEI)
        self.real_dates = (real_now.strftime("%Y-%m-%d"), real_now.strftime("%Y/%m/%d"))
        self.header = {
            "ai_chat_env": "LAUNDRY_AI_CHAT=off",
            "clock": {"frozen": ["datetime.datetime.now/today/utcnow", "time.time", "time.time_ns"],
                      "step_seconds_per_turn": CLOCK_STEP_SECONDS, "utc_offset": "+08:00"},
            "determinism": ["random.seed per case id", "os.urandom and uuid.uuid4 derived from the case id",
                            "PYTHONHASHSEED=0, UTF-8 mode, no bytecode",
                            "line-bot modules re-imported and sandbox reset for every case"],
            "lookup_fixture_customers": [c["no"] for c in SYNTHETIC_FIXTURE["customers"]],
            "masked_local_files": [f"line-bot/{n}" for n in MASKED_LOCAL_FILES],
            "network": "sockets refused and recorded; urllib requests recorded and answered with {} (no network)",
            "postback_entry": "conversation.handle_postback",
            "staff_notify": "push_inbox and guest_name replaced by record-only stubs",
            "zoneinfo_asia_taipei": zoneinfo_ok,
        }

    def cleanup(self) -> None:
        _set_clock(None)
        _set_seed(None)
        _safe_rmtree(self.tmp_root, TMP_PREFIX)

    def _apply_env(self) -> None:
        for key in list(os.environ):
            if key.upper().startswith("LAUNDRY_") or key.upper() in SCRUBBED_ENV:
                os.environ.pop(key, None)
        os.environ.update(LAUNDRY_REPO_ROOT=str(self.sandbox), LAUNDRY_EHANK_ROOT=str(self.sandbox / "no-pos"),
                          LAUNDRY_LOOKUP_FIXTURE="1", LAUNDRY_AI_CHAT="off",
                          TMP=str(self.case_tmp), TEMP=str(self.case_tmp))
        tempfile.tempdir = str(self.case_tmp)

    def reset_sandbox(self) -> None:
        try:
            for path in (self.sandbox, self.case_tmp):
                if path.exists():
                    shutil.rmtree(path)
            shutil.copytree(self.pristine, self.sandbox)
            self.case_tmp.mkdir()
        except OSError as exc:
            raise HarnessError(f"could not reset the sandbox ({type(exc).__name__}: {exc})") from exc

    @staticmethod
    def _purge_bot_modules() -> None:
        prefix = (norm_path(BOT_DIR) or "") + "/"
        for name, module in list(sys.modules.items()):
            if module is None:
                continue
            try:
                stub = getattr(module, "__golden_stub__", False)
                file = getattr(module, "__file__", None)
            except Exception:
                continue
            normalized = norm_path(file) if isinstance(file, str) else None
            if stub or (normalized and normalized.startswith(prefix)):
                del sys.modules[name]
        importlib.invalidate_caches()

    @staticmethod
    def _call_turn(conversation: Any, uid: str, turn: dict, event_id: str) -> dict:
        if turn["type"] == "postback":
            # The webhook routes postbacks here; handle_ex has no postback branch.
            return {"messages": conversation.handle_postback(uid, turn["data"], dict(turn.get("params") or {}), event_id)}
        messages, meta = conversation.handle_ex(uid, turn.get("text", ""), turn["type"], event_id)
        return {"messages": messages, "meta": meta}

    def _final_state(self, uid: str) -> dict:
        data_dir = self.sandbox / "data"
        session: Any = None
        if (data_dir / "line-sessions.json").is_file():
            try:
                loaded = json.loads((data_dir / "line-sessions.json").read_text(encoding="utf-8"))
                session = loaded.get(uid) if isinstance(loaded, dict) else {"__unexpected__": type(loaded).__name__}
            except (OSError, ValueError) as exc:
                session = {"__unreadable__": type(exc).__name__}
        bookings: list[Any] = []
        if (data_dir / "line-bookings.jsonl").is_file():
            for line in (data_dir / "line-bookings.jsonl").read_text(encoding="utf-8").splitlines():
                if line.strip():
                    try:
                        bookings.append(json.loads(line))
                    except ValueError:
                        bookings.append({"__unparsable_line__": len(line)})
        created, changed, present = [], [], set()
        for path in sorted(self.sandbox.rglob("*")):
            if path.is_file():
                rel = path.relative_to(self.sandbox).as_posix()
                present.add(rel)
                original = self.pristine_bytes.get(rel)
                if original is None:
                    created.append(rel)
                elif path.read_bytes() != original:
                    changed.append(rel)
        return {"bookings": bookings, "changed_inputs": changed, "created_files": created,
                "removed_inputs": sorted(set(self.pristine_bytes) - present), "session": session}

    def _literal_paths(self) -> list[tuple[str, str]]:
        pairs = [(str(self.sandbox), "<SANDBOX>"), (str(self.tmp_root), "<TMP>"), (str(REPO_ROOT), "<REPO>"),
                 (sys.prefix, "<PYTHON>"), (sys.base_prefix, "<PYTHON>"), (sys.exec_prefix, "<PYTHON>")]
        try:
            pairs.append((str(Path.home()), "<HOME>"))
        except (RuntimeError, KeyError, OSError):
            pass
        return pairs

    def run_case(self, case: dict, default_clock: str) -> dict:
        cid = case["id"]
        base = parse_clock(case.get("clock") or default_clock)
        uid = case_uid(cid)
        event_ids = [case_event_id(cid, i) for i in range(len(case["turns"]))]
        self.reset_sandbox()
        self._apply_env()
        self._purge_bot_modules()
        random.seed("golden:" + cid)
        _set_seed(cid)
        _set_clock(base)
        turns: list[dict] = []
        try:
            RECORDER.begin()
            try:
                staff_mode = _install_staff_notify_stub()
                conversation = importlib.import_module("conversation")
            except Exception as exc:
                RECORDER.end(1.0)
                raise HarnessError(f"case {cid}: importing line-bot/conversation.py in the sandbox failed: "
                                   f"{type(exc).__name__}: {exc}") from exc
            setup_effects = RECORDER.end(2.0)
            for index, turn in enumerate(case["turns"]):
                _set_clock(base + _dtmod.timedelta(seconds=CLOCK_STEP_SECONDS * index))
                RECORDER.begin()
                try:
                    output: Any = self._call_turn(conversation, uid, turn, event_ids[index])
                except Exception as exc:
                    output = {"error": {"type": type(exc).__name__, "message": str(exc)[:500]}}
                effects = RECORDER.end(DEFAULT_JOIN_SECONDS)
                turns.append({"effects": effects, "input": {**turn, "event_id": event_ids[index]},
                              "output": jsonable(output)})
            final_state = jsonable(self._final_state(uid))
        finally:
            _set_clock(None)
            _set_seed(None)
        record = {
            "clock_taipei": f"{base.strftime('%Y-%m-%d %H:%M')} {WEEKDAY_NAMES[base.weekday()]}",
            "final_state": final_state, "id": cid, "title": case["title"], "topic": case["topic"],
            "setup": {"effects": setup_effects, "staff_notify": staff_mode}, "turns": turns, "uid": uid,
        }
        base_dates = {base.strftime("%Y-%m-%d"), base.strftime("%Y/%m/%d")}
        real_dates = tuple(d for d in self.real_dates if d not in base_dates)
        return Normalizer(self._literal_paths(), event_ids, real_dates).apply(record)

    def run(self, cases_doc: dict) -> dict:
        cases = [self.run_case(case, cases_doc["default_clock"]) for case in cases_doc["cases"]]
        return {"format": TRANSCRIPT_FORMAT, "harness": dict(self.header), "cases": cases}

    def probe_guards(self) -> list[tuple[str, bool, str]]:
        results: list[tuple[str, bool, str]] = []

        def attempt(label: str, action: Any, expected: type | None) -> None:
            try:
                value = action()
            except OSError as exc:
                ok = GUARD_MARK in str(exc) and (expected is None or isinstance(exc, expected))
                results.append((label, ok, type(exc).__name__))
                return
            results.append((label, value is False, repr(value) if isinstance(value, bool) else type(value).__name__))

        for index, root in enumerate(self.forbidden):
            name = root if root == "c:/fxwash" else f"forbidden root #{index}"
            attempt(f"open {name}/data/prices.json",
                    lambda r=root: open(r + "/data/prices.json", "rb").close(), PermissionError)
            attempt(f"os.listdir {name}", lambda r=root: os.listdir(r), PermissionError)
            attempt(f"os.stat {name}", lambda r=root: os.stat(r), FileNotFoundError)
            attempt(f"Path.exists {name}", lambda r=root: Path(r).exists(), None)
        attempt("open checkout data/prices.json",
                lambda: open(REPO_ROOT / "data" / "prices.json", "rb").close(), PermissionError)
        attempt("open checkout secrets/line-channel.json",
                lambda: open(REPO_ROOT / "secrets" / "line-channel.json", "rb").close(), PermissionError)
        attempt("Path.is_file line-bot/coupon-url.txt (machine-local, masked)",
                lambda: (BOT_DIR / "coupon-url.txt").is_file(), None)
        attempt("socket.getaddrinfo api.line.me", lambda: socket.getaddrinfo("api.line.me", 443), PermissionError)
        RECORDER.begin()
        try:
            request = urllib.request.Request("https://api.line.me/v2/bot/message/push", data=b"{}", method="POST")
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read()
        except Exception:
            body = None
        effects = RECORDER.end(1.0)
        stubbed = body == b"{}" and any(e.get("effect") == "http_request_stubbed" for e in effects)
        results.append(("urllib POST api.line.me (record-only stub)", stubbed,
                        "recorded-and-stubbed" if stubbed else "NOT stubbed"))
        return results


# ------------------------------------------------------------------ comparison

def _first_path(a: Any, e: Any, path: str) -> str | None:
    if type(a) is not type(e):
        return path
    if isinstance(a, dict):
        for key in sorted(set(a) | set(e)):
            if key not in a or key not in e:
                return f"{path}.{key}"
            found = _first_path(a[key], e[key], f"{path}.{key}")
            if found:
                return found
        return None
    if isinstance(a, list):
        for index, (x, y) in enumerate(zip(a, e)):
            found = _first_path(x, y, f"{path}[{index}]")
            if found:
                return found
        return f"{path}[{min(len(a), len(e))}]" if len(a) != len(e) else None
    return None if a == e else path


def _first_line_diff(actual: str, expected: str, a_label: str, e_label: str) -> list[str]:
    a_lines, e_lines = actual.splitlines(), expected.splitlines()
    for i in range(max(len(a_lines), len(e_lines))):
        x = a_lines[i] if i < len(a_lines) else "<end of file>"
        y = e_lines[i] if i < len(e_lines) else "<end of file>"
        if x != y:
            return [f"    first differing line {i + 1}:", f"      {e_label}: {y.strip()[:300]}",
                    f"      {a_label}: {x.strip()[:300]}"]
    return ["    (difference is in line endings or trailing bytes only)"]


def first_difference(actual: bytes, expected: bytes, a_label: str, e_label: str) -> str:
    out = [f"DIFFERENCE between {a_label} and {e_label}:"]
    try:
        a_doc, e_doc = json.loads(actual.decode("utf-8")), json.loads(expected.decode("utf-8"))
    except ValueError as exc:  # includes UnicodeDecodeError
        out.append(f"  not both readable JSON ({type(exc).__name__}); byte comparison only")
        a_doc = e_doc = None
    if isinstance(a_doc, dict) and isinstance(e_doc, dict):
        a_cases = {str(c.get("id")): c for c in a_doc.get("cases") or [] if isinstance(c, dict)}
        e_cases = {str(c.get("id")): c for c in e_doc.get("cases") or [] if isinstance(c, dict)}
        out += [f"  extra case (in {a_label}, not in {e_label}): {cid}" for cid in a_cases if cid not in e_cases]
        out += [f"  missing case (in {e_label}, not in {a_label}): {cid}" for cid in e_cases if cid not in a_cases]
        if [c for c in a_cases if c in e_cases] != [c for c in e_cases if c in a_cases]:
            out.append("  case order differs")
        for key in sorted((set(a_doc) | set(e_doc)) - {"cases"}):
            if a_doc.get(key) != e_doc.get(key):
                out.append(f"  top-level {key!r} differs at {_first_path(a_doc.get(key), e_doc.get(key), key)}")
        for cid, case in a_cases.items():
            if cid in e_cases and case != e_cases[cid]:
                out.append(f"  first differing case: {cid} at {_first_path(case, e_cases[cid], '$')}")
                out += _first_line_diff(canonical_text(case), canonical_text(e_cases[cid]), a_label, e_label)
                break
    out.append("  whole file:")
    out += _first_line_diff(actual.decode("utf-8", "replace"), expected.decode("utf-8", "replace"), a_label, e_label)
    return "\n".join(out)


# ------------------------------------------------------------------ modes

def _abs(path: Path) -> Path:
    return Path(os.path.abspath(path))  # no filesystem access, unlike resolve()


def _check_paths(roots: tuple[str, ...], *pairs: tuple[str, Path | None]) -> None:
    for option, path in pairs:
        if path is not None and is_blocked(path, roots):
            raise HarnessError(f"{option} points into a protected path (production root, or this checkout's "
                               "data/ or secrets/); refused")


def _read_golden(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except FileNotFoundError as exc:
        raise HarnessError(f"golden file {path.name} not found; run `record` first") from exc
    except OSError as exc:
        raise HarnessError(f"cannot read golden file {path.name} ({exc})") from exc


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_bytes(data)
    os.replace(partial, path)


def cmd_run(args: argparse.Namespace) -> int:
    forbidden, roots = protected_roots()
    cases, golden = _abs(args.cases), _abs(args.golden)
    out = _abs(args.out) if args.out else None
    _check_paths(roots, ("--cases", cases), ("--golden", golden), ("--out", out))
    doc = load_cases(cases, require_full=os.path.normcase(str(cases)) == os.path.normcase(str(DEFAULT_CASES)))
    expected = _read_golden(golden) if args.mode == "check" else None
    harness = Harness(forbidden, roots)
    try:
        harness.setup()
        first = canonical_bytes(harness.run(doc))
        second = canonical_bytes(harness.run(doc))
    finally:
        harness.cleanup()
    if out is not None:
        _write_bytes(out, first)
    if first != second:
        print("NONDETERMINISTIC: the two in-process runs differ; fix the normaliser, never drop the case.")
        print(first_difference(second, first, "run 2", "run 1"))
        return EXIT_DIFF
    count = len(doc["cases"])
    if expected is None:
        _write_bytes(golden, first)
        print(f"RECORDED: {count} cases, double run byte-identical -> {golden.name} ({len(first)} bytes)")
        return EXIT_OK
    if first == expected:
        print(f"OK: {count} cases byte-identical to {golden.name} (double run identical)")
        return EXIT_OK
    print(first_difference(first, expected, "this run", "golden"))
    return EXIT_DIFF


def cmd_matrix(args: argparse.Namespace) -> int:
    _forbidden, roots = protected_roots()
    cases, golden = _abs(args.cases), _abs(args.golden)
    _check_paths(roots, ("--cases", cases), ("--golden", golden))
    expected = _read_golden(golden)
    work = HERE / (MATRIX_PREFIX + uuid.uuid4().hex)
    work.mkdir()
    status = EXIT_OK
    try:
        for index, (label, value) in enumerate(MATRIX):
            env = {k: v for k, v in os.environ.items() if k.upper() not in ("SXJ_SHOP_ID", "GOLDEN_REEXEC")}
            env.update(PYTHONHASHSEED="0", PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1")
            if value is not None:
                env["SXJ_SHOP_ID"] = value
            out = work / f"run-{index}.json"
            print(f"== env matrix: {label} ==", flush=True)
            rc = subprocess.run([sys.executable, "-X", "utf8", "-B", str(SCRIPT), "check", "--cases", str(cases),
                                 "--golden", str(golden), "--out", str(out)], env=env).returncode
            if rc == EXIT_HARNESS or not out.is_file():
                print(f"HARNESS ERROR in the {label} subprocess (exit {rc})", file=sys.stderr)
                return EXIT_HARNESS
            actual = out.read_bytes()
            if actual == expected and rc == EXIT_OK:
                print(f"[OK] {label}: transcript byte-identical to {golden.name}", flush=True)
                continue
            status = EXIT_DIFF
            print(f"[DIFF] {label}: subprocess exit {rc}", flush=True)
            if actual != expected:
                print(first_difference(actual, expected, label, "golden"), flush=True)
    finally:
        _safe_rmtree(work, MATRIX_PREFIX)
    print("ENV MATRIX: " + ("PASS" if status == EXIT_OK else "FAIL"))
    return status


def cmd_guard() -> int:
    forbidden, roots = protected_roots()
    harness = Harness(forbidden, roots)
    try:
        harness.setup()
        results = harness.probe_guards()
    finally:
        harness.cleanup()
    for label, refused, outcome in results:
        print(f"[{'refused' if refused else 'NOT REFUSED'}] {label} -> {outcome}")
    ok = all(r[1] for r in results)
    print("GUARD SELFTEST: " + ("PASS" if ok else "FAIL"))
    return EXIT_OK if ok else EXIT_DIFF


def _needs_reexec() -> bool:
    return (os.environ.get("PYTHONHASHSEED") != "0" or not sys.flags.utf8_mode
            or not sys.flags.dont_write_bytecode)


def _reexec(argv: list[str]) -> int:
    if os.environ.get("GOLDEN_REEXEC") == "1":
        print("HARNESS ERROR: re-exec with PYTHONHASHSEED=0 -X utf8 -B did not take effect", file=sys.stderr)
        return EXIT_HARNESS
    env = dict(os.environ, PYTHONHASHSEED="0", PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", GOLDEN_REEXEC="1")
    return subprocess.run([sys.executable, "-X", "utf8", "-B", str(SCRIPT), *argv], env=env).returncode


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if _needs_reexec():
        return _reexec(argv)
    parser = argparse.ArgumentParser(description="LINE bot golden comparison harness (task card D1-2).")
    parser.add_argument("mode", choices=("record", "check", "guard-selftest"))
    parser.add_argument("--env-matrix", action="store_true", help="check only: SXJ_SHOP_ID unset and =sxj")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN)
    parser.add_argument("--out", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)  # argparse usage errors exit 2 (harness/input error)
    try:
        if args.env_matrix and args.mode != "check":
            raise HarnessError("--env-matrix only works with check")
        if args.mode == "guard-selftest":
            return cmd_guard()
        return cmd_matrix(args) if args.env_matrix else cmd_run(args)
    except HarnessError as exc:
        print(f"HARNESS ERROR: {exc}", file=sys.stderr)
    except Exception:
        traceback.print_exc()
        print("HARNESS ERROR: unexpected exception (nothing was compared)", file=sys.stderr)
    return EXIT_HARNESS


if __name__ == "__main__":
    raise SystemExit(main())
