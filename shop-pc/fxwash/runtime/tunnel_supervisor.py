"""Automated, self-healing Tunnel Supervisor for FXwash LINE Webhook.

Launches OpenSSH tunnel to localhost.run with keepalive, automatically detects
the assigned HTTPS URL, updates shop.json, and registers the webhook endpoint
directly with the LINE platform. Records URL changes and verifies the registered
endpoint after PUT; reconnections can still interrupt webhook delivery.

A4-4: the shop PC owns the LINE endpoint only inside its day window (default
10:00-20:00 Asia/Taipei). Outside it the URL is still tracked in shop.json but
the PUT is skipped (skipped_night) and repeated once when the day window starts
(day_start_register).
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # Defensive: a stripped embedded runtime without zoneinfo.
    ZoneInfo = None

    class ZoneInfoNotFoundError(KeyError):
        pass

try:
    sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
    sys.stderr.reconfigure(line_buffering=True, encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.line_api import get_webhook, set_webhook, test_webhook
from shop_config import load_shop

URL_REGEX = re.compile(r"https://[a-zA-Z0-9-]+\.lhr\.life")
SHOP_PATH = ROOT / "shop.json"
EVENTS_PATH = ROOT / "logs" / "tunnel_events.jsonl"
RETRY_DELAYS = (2, 5, 10)

# Handover between the shop PC (day) and the ai PC (night).
DEFAULT_HANDOVER = {"day_start": "10:00", "day_end": "20:00", "tz": "Asia/Taipei"}
# Seconds between background night->day checks. The tunnel loop blocks on ssh
# output, which can be silent for many minutes, so a small daemon timer makes
# sure the 10:00 registration is not delayed until the next URL rotation.
DAY_CHECK_INTERVAL = 30


def write_event(event: str, old_url: str, new_url: str, *, put_status=None,
                verify_status: str = "pending", **details):
    record = {
        "ts": datetime.now().astimezone().isoformat(timespec="seconds"),
        "event": event,
        "old_url": old_url,
        "new_url": new_url,
        "put_status": put_status,
        "verify_status": verify_status,
        **details,
    }
    try:
        EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS_PATH.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:
        # Observability must not take the existing tunnel down. Never log tokens
        # or arbitrary API response/error bodies.
        print(f"{record['ts']} [Tunnel Supervisor] Event log unavailable ({type(exc).__name__})",
              file=sys.stderr)


def register_webhook(shop, old_url: str, new_url: str) -> bool:
    """PUT then GET the endpoint; allow three retries after the initial PUT."""
    for attempt, delay in enumerate((0, *RETRY_DELAYS), start=1):
        if delay:
            time.sleep(delay)
        put_status = None
        write_event("put_start", old_url, new_url, attempt=attempt)

        def put_opener(request, **kwargs):
            nonlocal put_status
            response = urlopen(request, **kwargs)
            put_status = response.status
            return response

        try:
            set_webhook(shop, new_url, opener=put_opener)
        except Exception as exc:
            put_status = getattr(exc, "code", None) or put_status or "error"
            write_event("put_result", old_url, new_url, put_status=put_status,
                        verify_status="not_run", attempt=attempt, error_type=type(exc).__name__)
            if isinstance(exc, HTTPError):
                exc.close()
            continue
        write_event("put_result", old_url, new_url, put_status=put_status, attempt=attempt)

        try:
            readback = get_webhook(shop, opener=urlopen)
        except Exception as exc:
            write_event("verify_result", old_url, new_url, put_status=put_status,
                        verify_status="error", attempt=attempt, error_type=type(exc).__name__)
            if isinstance(exc, HTTPError):
                exc.close()
            continue
        verify_status = "match" if readback.get("endpoint") == new_url else "mismatch"
        write_event("verify_result", old_url, new_url, put_status=put_status,
                    verify_status=verify_status, attempt=attempt)
        if verify_status == "match":
            return True
    return False


# ---------------------------------------------------------------------------
# Day/night handover (A4-4)
# ---------------------------------------------------------------------------

def _minute_of_day(value) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("handover times must use HH:MM")
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def _timezone(name):
    if not isinstance(name, str) or not name:
        raise ValueError("handover timezone is required")
    try:
        if ZoneInfo is None:
            raise ZoneInfoNotFoundError(name)
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        # Embedded Windows Python may have no IANA tzdata. Taipei is a fixed
        # UTC+08:00 zone; never substitute this offset for any other zone.
        if name == "Asia/Taipei":
            return timezone(timedelta(hours=8), name)
        raise ValueError("handover timezone is unavailable") from None


def _validate_handover(raw) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("handover configuration must be an object")
    start = _minute_of_day(raw.get("day_start"))
    end = _minute_of_day(raw.get("day_end"))
    if start == end:
        raise ValueError("day_start and day_end must differ")
    _timezone(raw.get("tz"))
    return {"day_start": raw["day_start"], "day_end": raw["day_end"], "tz": raw["tz"]}


def load_handover_config(path=None, *, log: bool = True) -> dict:
    """Return the optional shop.json "handover" object or the defaults."""
    path = SHOP_PATH if path is None else Path(path)
    reason = ""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        raw = data.get("handover") if isinstance(data, dict) else None
        if raw is None:
            reason = "missing"
        else:
            config = _validate_handover(raw)
    except (OSError, ValueError, TypeError) as exc:
        reason = f"invalid ({type(exc).__name__})"
    if reason:
        config = dict(DEFAULT_HANDOVER)
        if log:
            print(f"[Tunnel Supervisor] handover config {reason}; using defaults "
                  f"{config['day_start']}-{config['day_end']} {config['tz']}")
    elif log:
        print(f"[Tunnel Supervisor] handover window {config['day_start']}-{config['day_end']} {config['tz']}")
    return config


def is_day_window(now=None, config=None) -> bool:
    """True when the shop PC owns the endpoint: local time in [day_start, day_end).

    A naive `now` is interpreted as wall time in the configured zone. A window
    with day_start > day_end crosses midnight.
    """
    config = load_handover_config(log=False) if config is None else _validate_handover(config)
    tz = _timezone(config["tz"])
    if now is None:
        now = datetime.now(tz)
    elif now.tzinfo is None or now.utcoffset() is None:
        now = now.replace(tzinfo=tz)
    local = now.astimezone(tz)
    minute = local.hour * 60 + local.minute
    start = _minute_of_day(config["day_start"])
    end = _minute_of_day(config["day_end"])
    return (minute - start) % 1440 < (end - start) % 1440


class HandoverState:
    """URL/registration state shared by the tunnel loop and the day watcher."""

    def __init__(self, config: dict):
        self.config = config
        self.lock = threading.Lock()
        self.current_url = ""
        self.previous_url = ""
        self.registered_url = ""      # verified "match" in the current day window
        self.pending_day_url = None   # skipped at night, register at day start
        self.last_day = None


def _observe_window(state: HandoverState, day: bool) -> bool:
    """Record the window; return True on a night->day flip."""
    previous = state.last_day
    state.last_day = day
    if not day and previous is not False:
        # Night started: a fresh day window must register again.
        state.registered_url = ""
    return day and previous is False


def check_day_start(state: HandoverState, now=None) -> bool:
    """On a night->day flip, run the PUT/verify once. Returns True if attempted."""
    with state.lock:
        day = is_day_window(now, state.config)
        if not _observe_window(state, day) or not state.current_url:
            return False
        if state.pending_day_url is None and state.registered_url == state.current_url:
            return False
        url = state.current_url
        old_url = state.previous_url
        reason = "pending_day_url" if state.pending_day_url else "not_registered_this_window"
        write_event("day_start_register", old_url, url, reason=reason)
        try:
            shop = load_shop(SHOP_PATH)
            ok = register_webhook(shop, old_url, url)
        except Exception as exc:
            print(f"[Tunnel Supervisor] Day-start registration failed ({type(exc).__name__})")
            return True
        if ok:
            state.registered_url = url
            state.pending_day_url = None
            print(f"[Tunnel Supervisor] Day window started; LINE platform webhook updated to {url}!")
        else:
            print("[Tunnel Supervisor] Day-start registration was not verified; see tunnel_events.jsonl.")
        return True


def _safe_day_check(state: HandoverState, now=None) -> bool:
    try:
        return check_day_start(state, now)
    except Exception as exc:
        print(f"[Tunnel Supervisor] Day window check failed ({type(exc).__name__})")
        return False


def _start_day_watcher(state: HandoverState, interval: float) -> threading.Event:
    stop = threading.Event()

    def loop():
        while not stop.wait(interval):
            _safe_day_check(state)

    threading.Thread(target=loop, name="day-window-check", daemon=True).start()
    return stop


def find_ssh() -> str:
    candidates = [
        r"C:\Windows\Sysnative\OpenSSH\ssh.exe",
        r"C:\Windows\System32\OpenSSH\ssh.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return "ssh"


def run_supervisor(port: int = 18791):
    state = HandoverState(load_handover_config())
    state.last_day = is_day_window(config=state.config)
    ssh_exe = find_ssh()
    ssh_cmd = [
        ssh_exe,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=10",
        "-o", "ServerAliveCountMax=3",
        "-R", f"80:127.0.0.1:{port}",
        "nokey@localhost.run",
    ]
    if DAY_CHECK_INTERVAL > 0:
        _start_day_watcher(state, DAY_CHECK_INTERVAL)

    while True:
        _safe_day_check(state)
        print(f"[Tunnel Supervisor] Launching SSH tunnel to localhost.run (port {port})...")
        proc = subprocess.Popen(
            ssh_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="ignore",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        started_at = time.monotonic()

        try:
            for line in proc.stdout:
                line_str = line.strip()
                if not line_str:
                    continue
                match = URL_REGEX.search(line_str)
                if not match or f"{match.group(0)}/line/webhook" == state.current_url:
                    # No new URL on this line: cheap night->day flip check.
                    _safe_day_check(state)
                if match:
                    new_base = match.group(0)
                    new_webhook = f"{new_base}/line/webhook"
                    if new_webhook != state.current_url:
                        with state.lock:
                            print(f"[Tunnel Supervisor] New tunnel detected: {new_webhook}")
                            old_url = state.current_url
                            write_event("url_detected", old_url, new_webhook)
                            state.previous_url = old_url
                            state.current_url = new_webhook
                            # 1. Update shop.json
                            try:
                                shop_data = json.loads(SHOP_PATH.read_text(encoding="utf-8"))
                                shop_data.setdefault("server", {})
                                shop_data["server"]["public_base"] = new_base
                                shop_data["server"]["webhook_url"] = new_webhook
                                SHOP_PATH.write_text(json.dumps(shop_data, indent=2, ensure_ascii=False), encoding="utf-8")
                            except Exception as e:
                                print(f"[Tunnel Supervisor] Failed to update shop.json: {e}")

                            # 2. Update LINE Webhook URL (only inside the shop's day window)
                            day = is_day_window(config=state.config)
                            _observe_window(state, day)
                            if not day:
                                write_event("skipped_night", old_url, new_webhook,
                                            put_status="not_attempted", verify_status="not_attempted")
                                state.pending_day_url = new_webhook
                                print("[Tunnel Supervisor] Night window: ai PC owns the webhook; LINE registration skipped.")
                                continue
                            try:
                                shop = load_shop(SHOP_PATH)
                                if not register_webhook(shop, old_url, new_webhook):
                                    print("[Tunnel Supervisor] LINE endpoint registration was not verified; see tunnel_events.jsonl.")
                                    continue
                                state.registered_url = new_webhook
                                state.pending_day_url = None
                                print(f"[Tunnel Supervisor] LINE platform webhook updated to {new_webhook}!")
                                test_res = test_webhook(shop, new_webhook)
                                print(f"[Tunnel Supervisor] Webhook test result: {test_res.get('statusCode')} ({test_res.get('reason')})")
                            except Exception as e:
                                print(f"[Tunnel Supervisor] Failed to register webhook on LINE: {e}")

        except Exception as exc:
            print(f"[Tunnel Supervisor] Error reading tunnel output: {exc}")
        finally:
            if proc.poll() is None:
                proc.terminate()
            try:
                rc = proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                rc = proc.wait(timeout=5)
            with state.lock:
                write_event("tunnel_exit", state.current_url, state.current_url, verify_status="not_run",
                            rc=rc, alive_seconds=round(time.monotonic() - started_at, 3))
            print("[Tunnel Supervisor] Tunnel process exited. Reconnecting in 3 seconds...")
            time.sleep(3)


if __name__ == "__main__":
    port = 18791
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run_supervisor(port)