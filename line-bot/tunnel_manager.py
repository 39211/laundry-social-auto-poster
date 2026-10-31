# -*- coding: utf-8 -*-
"""cloudflared quick tunnel keep-alive + LINE webhook endpoint updater. Stdlib only."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CLOUDFLARED = Path(r"C:/Users/cyc39/AppData/Local/hermes/jarvis-lab/bin/cloudflared.exe")
PUBLIC_BASE = Path(__file__).resolve().parent / "public_base.txt"
SECRETS = Path(r"C:/Users/cyc39/laundry-repo/secrets/line-channel.json")
LOG_PATH = Path(os.environ.get("LOCALAPPDATA") or ".") / "line-bot" / "tunnel.log"
EVENTS_PATH = LOG_PATH.with_name("tunnel_events.jsonl")
HANDOVER_CONFIG = Path(__file__).resolve().parent / "handover.json"
TUNNEL_RE = re.compile(
    r"https://(?!api\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.trycloudflare\.com",
    re.IGNORECASE,
)
SUCCESS_URL_LINE = re.compile(
    r"^(?:\d{4}-\d{2}-\d{2}T\S+\s+INF\s+)?\|\s*(https://[^\s|]+)\s*\|\s*$"
)
WEBHOOK_API = "https://api.line.me/v2/bot/channel/webhook/endpoint"
LOG_ROTATE_BYTES = 2 * 1024 * 1024  # F15
WEBHOOK_RETRY_DELAYS = (2, 5, 10)  # F4
START_BACKOFFS = (10, 30, 60)  # F5
# A4-5: restart a live-but-dead cloudflared (control stream failing, never re-registered)
UNHEALTHY_RESTART_SECONDS = 180
UNHEALTHY_RESTART_MIN_GAP_SECONDS = 600
# A4-6: in the night window, check (GET) the registered LINE endpoint at most this often
NIGHT_RECLAIM_SECONDS = 900
TUNNEL_HEALTHY_MARK = "Registered tunnel connection"
TUNNEL_FAILURE_MARKS = (
    "control stream encountered a failure",
    "Serve tunnel error",
    "failed to serve tunnel connection",
)
_LOG_LOCK = threading.Lock()
# F4: base_url that still needs set_webhook_endpoint after immediate retries failed
PENDING_WEBHOOK = {"base_url": ""}


def parse_tunnel_url(text: str) -> str:
    """Accept only cloudflared's success-table URL row, never error prose."""
    for line in (text or "").splitlines():
        match = SUCCESS_URL_LINE.fullmatch(line.strip())
        if match and TUNNEL_RE.fullmatch(match[1]):
            return match[1]
    return ""


def validate_tunnel_base(value: str) -> str:
    """Validate the file/registration input separately from console parsing."""
    value = value.strip()
    if not TUNNEL_RE.fullmatch(value):
        raise ValueError("invalid AI quick-tunnel base URL")
    return value


def _minute_of_day(value: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("handover times must use HH:MM")
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def _timezone(name: str):
    if not isinstance(name, str) or not name:
        raise ValueError("handover timezone is required")
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        # Windows may have no IANA tzdata. Current Taipei is fixed UTC+08:00;
        # do not silently substitute this offset for any other configured zone.
        if name == "Asia/Taipei":
            return timezone(timedelta(hours=8), name)
        raise ValueError("handover timezone is unavailable") from None


def _validate_config(config: dict) -> dict:
    if not isinstance(config, dict):
        raise ValueError("handover configuration must be an object")
    start = _minute_of_day(config.get("day_start"))
    end = _minute_of_day(config.get("day_end"))
    delay = config.get("night_takeover_delay_min")
    if start == end:
        raise ValueError("day_start and day_end must differ")
    if type(delay) is not int or not 0 <= delay < (start - end) % 1440:
        raise ValueError("takeover delay must fit inside the night window")
    _validate_days(config, delay)
    _timezone(config.get("tz"))
    return config


_WEEKDAY_KEYS = frozenset(str(day) for day in range(7))


def _validate_days(config: dict, delay: int) -> None:
    """A4-6: optional per-weekday overrides, Python weekday keys "0" (Mon) .. "6" (Sun).

    null or [] = shop closed all day (night window all day); ["HH:MM", "HH:MM"] =
    same-day opening hours. Anything else is a configuration error.
    """
    if "days" not in config:
        return
    days = config["days"]
    if not isinstance(days, dict):
        raise ValueError("handover days must be an object")
    for key, value in days.items():
        if not isinstance(key, str) or key not in _WEEKDAY_KEYS:
            raise ValueError("handover days keys must be weekday numbers 0-6")
        if value is None or (isinstance(value, (list, tuple)) and len(value) == 0):
            continue
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise ValueError("handover day override must be null, [] or [open, close]")
        opened = _minute_of_day(value[0])
        closed = _minute_of_day(value[1])
        if opened >= closed:
            raise ValueError("handover day override must open before it closes")
        if not delay < 1440 - (closed - opened):
            raise ValueError("takeover delay must fit inside the night window")


def load_handover_config() -> dict:
    # Reload for each decision so a commander's configuration edit takes effect.
    return _validate_config(json.loads(HANDOVER_CONFIG.read_text(encoding="utf-8-sig")))


def _now(config: dict) -> datetime:
    return datetime.now(_timezone(config["tz"]))


def is_night_window(now: datetime | None = None, *, config: dict | None = None) -> bool:
    config = load_handover_config() if config is None else _validate_config(config)
    now = _now(config) if now is None else now
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("handover clock must be timezone-aware")
    local = now.astimezone(_timezone(config["tz"])).replace(second=0, microsecond=0)
    # The shop owns [open, close) of each weekday, including a configured midnight span.
    return not _in_day_window(local, config)


def _day_span(config: dict, weekday: int):
    """(open_minute, close_minute) for a weekday, or None when the shop is closed."""
    days = config.get("days") or {}
    key = str(weekday)
    if key in days:
        value = days[key]
        if not value:
            return None
        return _minute_of_day(value[0]), _minute_of_day(value[1])
    return _minute_of_day(config["day_start"]), _minute_of_day(config["day_end"])


def day_window_for(day, config: dict):
    """Shop-open interval (aware datetimes) that starts on local date `day`, or None.

    `config` must already be validated. A default span that crosses midnight closes
    on the next calendar day.
    """
    span = _day_span(config, day.weekday())
    if span is None:
        return None
    start, end = span
    tz = _timezone(config["tz"])
    opened = datetime(day.year, day.month, day.day, start // 60, start % 60, tzinfo=tz)
    closed = datetime(day.year, day.month, day.day, end // 60, end % 60, tzinfo=tz)
    if end <= start:
        closed += timedelta(days=1)
    return opened, closed


def _in_day_window(local: datetime, config: dict) -> bool:
    for back in (1, 0):
        span = day_window_for(local.date() - timedelta(days=back), config)
        if span is not None and span[0] <= local < span[1]:
            return True
    return False


def last_shop_closing(now: datetime, *, config: dict | None = None):
    """A4-6 shared helper: closing time of the latest open period that has ended.

    Returns None during the day window or if no weekday is open. Used by the LINE
    handover and by laundry_lookup freshness so both read the same weekly hours.
    """
    config = load_handover_config() if config is None else _validate_config(config)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("handover clock must be timezone-aware")
    local = now.astimezone(_timezone(config["tz"])).replace(second=0, microsecond=0)
    if _in_day_window(local, config):
        return None
    for back in range(9):
        span = day_window_for(local.date() - timedelta(days=back), config)
        if span is not None and span[1] <= local:
            return span[1]
    return None


def registration_window() -> str:
    try:
        return "night" if is_night_window() else "day"
    except (OSError, ValueError, TypeError):
        return "configuration_error"


def _event(event: str, old_url: str = "", new_url: str = "",
           put_status="not_attempted", verify_status="not_attempted", **details) -> None:
    row = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "event": event,
        "old_url": old_url,
        "new_url": new_url,
        "put_status": put_status,
        "verify_status": verify_status,
        **details,
    }
    with _LOG_LOCK:
        EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS_PATH.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row, ensure_ascii=True) + "\n")


def _registration_allowed(url: str) -> bool:
    window = registration_window()
    if window == "night":
        return True
    if window == "day":
        _log("day window: shop is primary, not registering")
        _event("skipped_day", new_url=url + "/line/webhook")
    else:
        _log("handover configuration invalid: not registering")
        _event("configuration_error", new_url=url + "/line/webhook")
    return False


def _log(msg: str) -> None:
    # F15: rotate tunnel.log to tunnel.log.1 when larger than 2 MB
    with _LOG_LOCK:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            if LOG_PATH.exists() and LOG_PATH.stat().st_size > LOG_ROTATE_BYTES:
                rotated = Path(str(LOG_PATH) + ".1")
                if rotated.exists():
                    rotated.unlink()
                LOG_PATH.replace(rotated)
        except OSError:
            pass
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"{ts} {msg}\n"
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line)


def _load_token() -> str:
    data = json.loads(SECRETS.read_text(encoding="utf-8"))
    return data.get("line_channel_token") or data.get("channel_access_token") or ""


def _http_read(request, http=urllib):
    try:
        response = http.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as exc:
        exc.close()
        raise
    try:
        status = getattr(response, "status", None)
        if status is None:
            status = response.getcode() if hasattr(response, "getcode") else 200
        return response.read(), status
    finally:
        if hasattr(response, "close"):
            response.close()


def get_webhook_info(token: str, http=urllib) -> dict:
    request = http.request.Request(
        WEBHOOK_API, headers={"Authorization": "Bearer " + token}, method="GET",
    )
    raw, status = _http_read(request, http)
    data = json.loads(raw or "{}")
    if not isinstance(data, dict) or not isinstance(data.get("endpoint"), str):
        raise ValueError("invalid webhook endpoint response")
    return {"endpoint": data["endpoint"], "active": data.get("active"), "http_status": status}


class WebhookMismatchError(RuntimeError):
    def __init__(self, endpoint: str):
        super().__init__("webhook endpoint mismatch")
        self.endpoint = endpoint


def set_webhook_endpoint(base_url: str, token: str, http=urllib, *, old_url: str = "") -> str:
    """PUT webhook endpoint, then GET to confirm it matches. http is injectable."""
    endpoint = validate_tunnel_base(base_url) + "/line/webhook"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
    }
    body = json.dumps({"endpoint": endpoint}).encode()
    put_req = http.request.Request(WEBHOOK_API, data=body, headers=headers, method="PUT")
    put_status = verify_status = "not_attempted"
    readback = ""
    try:
        _, put_status = _http_read(put_req, http)
        info = get_webhook_info(token, http)
        readback = info["endpoint"]
        verify_status = "match" if readback == endpoint else "mismatch"
        if readback != endpoint:
            raise WebhookMismatchError(readback)
        return endpoint
    except Exception as exc:
        status = exc.code if isinstance(exc, urllib.error.HTTPError) else type(exc).__name__
        if put_status == "not_attempted":
            put_status = status
        elif verify_status == "not_attempted":
            verify_status = status
        raise
    finally:
        _event("webhook_update", old_url, endpoint, put_status, verify_status,
               readback_url=readback)


def _start_cloudflared() -> subprocess.Popen:
    proc = subprocess.Popen(
        [
            str(CLOUDFLARED),
            "tunnel",
            "--url",
            "http://127.0.0.1:8791",
            "--no-autoupdate",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    _spawn_reader(proc)
    return proc


def _spawn_reader(proc: subprocess.Popen) -> threading.Event:
    """F2: resident reader -- drain stdout for the child's whole lifetime."""
    found = {"url": ""}
    got = threading.Event()
    health = TunnelHealth()  # A4-5

    def reader() -> None:
        # G3: never let a decode/log error kill the reader before EOF
        stream = proc.stdout
        if stream is None:
            got.set()
            return
        try:
            while True:
                try:
                    line = stream.readline()
                except Exception as e:  # noqa: BLE001
                    _log("reader error: " + type(e).__name__)
                    if proc.poll() is not None:
                        break
                    time.sleep(0.05)
                    continue
                if line == "":
                    break
                try:
                    _log("cloudflared: " + line.rstrip())
                    health.observe(line, time.monotonic())  # A4-5
                    url = parse_tunnel_url(line)
                    if url and not found["url"]:
                        found["url"] = url
                        got.set()
                        # F2: do not return; keep reading until EOF
                except Exception as e:  # noqa: BLE001
                    _log("reader error: " + type(e).__name__)
        finally:
            got.set()

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    proc._reader_thread = t  # type: ignore[attr-defined]
    proc._found_url = found  # type: ignore[attr-defined]
    proc._url_event = got  # type: ignore[attr-defined]
    proc._health = health  # type: ignore[attr-defined]
    return got


def _wait_for_url(proc: subprocess.Popen, timeout: float = 90.0) -> str:
    # F2: wait on Event; reader thread stays resident
    ev = getattr(proc, "_url_event", None)
    if ev is None:
        ev = _spawn_reader(proc)
    ev.wait(timeout)
    found = getattr(proc, "_found_url", None) or {}
    return found.get("url") or ""


def _log_webhook_error(exc: BaseException) -> None:
    # F4: log HTTP status; never log token
    if isinstance(exc, urllib.error.HTTPError):
        _log("webhook endpoint failed: HTTPError status=" + str(exc.code))
    else:
        _log("webhook endpoint failed: " + type(exc).__name__)


def _attempt_webhook(url: str, token: str, http=urllib, *, old_url="", result=None) -> bool:
    try:
        endpoint = set_webhook_endpoint(url, token, http=http, old_url=old_url)
        if result is not None:
            result.update(status="updated", line_endpoint=endpoint)
        _log("webhook endpoint updated")
        return True
    except Exception as e:  # noqa: BLE001
        if result is not None:
            result.update(status="mismatch" if isinstance(e, WebhookMismatchError) else "error",
                          line_endpoint=e.endpoint if isinstance(e, WebhookMismatchError) else None)
        _log_webhook_error(e)
        if isinstance(e, urllib.error.HTTPError):
            e.close()
        return False


def _set_webhook_with_retries(
    url: str, token: str, sleep=time.sleep, http=urllib, *, old_url="", result=None,
) -> bool:
    # F4: try now, then 3 retries at 2/5/10 seconds
    for delay in (0, *WEBHOOK_RETRY_DELAYS):
        if delay:
            sleep(delay)
        # Recheck after every delay; a retry must never take the shop's day slot.
        if not _registration_allowed(url):
            return False
        if _attempt_webhook(url, token, http=http, old_url=old_url, result=result):
            return True
    return False


def _publish(url: str, token: str, sleep=time.sleep) -> None:
    url = validate_tunnel_base(url)
    old_url = PUBLIC_BASE.read_text(encoding="utf-8").strip() if PUBLIC_BASE.exists() else ""
    PUBLIC_BASE.write_text(url + "\n", encoding="utf-8")
    _log("public_base " + url)
    _event("tunnel_url", old_url, url)
    if _set_webhook_with_retries(url, token, sleep=sleep):
        PENDING_WEBHOOK["base_url"] = ""
    else:
        PENDING_WEBHOOK["base_url"] = url if registration_window() == "night" else ""


def _retry_pending_webhook(token: str) -> None:
    # F4: keep retrying on the 60s loop until LINE accepts the new URL
    url = PENDING_WEBHOOK.get("base_url") or ""
    if not url:
        return
    if not _registration_allowed(url):
        PENDING_WEBHOOK["base_url"] = ""
        return
    if _attempt_webhook(url, token):
        PENDING_WEBHOOK["base_url"] = ""


def _kill_proc(proc: subprocess.Popen | None) -> None:
    if proc is None:
        return
    if proc.poll() is None:
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass


def classify_tunnel_line(line: str) -> str:
    """A4-5: 'healthy', 'failing', or '' (line does not affect tunnel health)."""
    text = line or ""
    if TUNNEL_HEALTHY_MARK in text:
        return "healthy"
    if any(mark in text for mark in TUNNEL_FAILURE_MARKS):
        return "failing"
    return ""


class TunnelHealth:
    """A4-5: tunnel health from cloudflared lines. The caller supplies the clock."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.last_registered_at = None
        self.failing_since = None

    def observe(self, line: str, now: float) -> None:
        kind = classify_tunnel_line(line)
        with self._lock:
            if kind == "healthy":
                self.last_registered_at = now
                self.failing_since = None
            elif kind == "failing" and self.failing_since is None:
                self.failing_since = now

    def failing_seconds(self, now: float) -> float:
        with self._lock:
            if self.failing_since is None:
                return 0.0
            return max(0.0, now - self.failing_since)


def should_restart_unhealthy(health: TunnelHealth, now: float, last_restart_at=None) -> bool:
    """A4-5: pure decision; failing >= 180 s and no health restart in the last 600 s."""
    if health.failing_seconds(now) < UNHEALTHY_RESTART_SECONDS:
        return False
    if last_restart_at is not None and now - last_restart_at < UNHEALTHY_RESTART_MIN_GAP_SECONDS:
        return False
    return True


def _restart_if_unhealthy(proc, url: str, state: dict, now: float) -> bool:
    """A4-5: kill a failing cloudflared; the caller then runs the normal start path."""
    health = getattr(proc, "_health", None)
    if health is None:
        return False
    if not should_restart_unhealthy(health, now, state.get("last_restart_at")):
        return False
    failing = int(health.failing_seconds(now))
    state["last_restart_at"] = now
    _log("tunnel unhealthy for " + str(failing) + "s without registration: restarting cloudflared")
    _event("tunnel_unhealthy_restart", url, "", failing_seconds=failing)
    _kill_proc(proc)
    return True


def _within_takeover_delay() -> bool:
    """A4-6: True during the first night_takeover_delay_min minutes after closing."""
    try:
        config = load_handover_config()
        now = _now(config)
        closing = last_shop_closing(now, config=config)
    except (OSError, ValueError, TypeError):
        return True  # fail closed: no reclaim on a broken configuration
    if closing is None:
        return False
    return now < closing + timedelta(minutes=config["night_takeover_delay_min"])


def _night_reclaim(url: str, token: str, state: dict, now: float, *,
                   sleep=time.sleep, http=urllib) -> str:
    """A4-6: in the night window, at most every NIGHT_RECLAIM_SECONDS, GET the LINE
    endpoint and take it back if it is not this ai endpoint. No HTTP in the day
    window; every PUT still goes through _registration_allowed."""
    window = registration_window()
    if window != "night":
        return window
    last = state.get("last_check_at")
    if last is not None and now - last < NIGHT_RECLAIM_SECONDS:
        return "skipped"
    if _within_takeover_delay():
        return "takeover_delay"
    state["last_check_at"] = now
    try:
        base = validate_tunnel_base(url)
        current = get_webhook_info(token, http)["endpoint"]
    except Exception as exc:  # noqa: BLE001
        _log("night reclaim check failed")
        _log_webhook_error(exc)
        return "error"
    endpoint = base + "/line/webhook"
    if current == endpoint:
        return "already_ai"
    attempt = {}
    updated = _set_webhook_with_retries(
        base, token, sleep=sleep, http=http, old_url=current, result=attempt,
    )
    if updated:
        status = "updated"
        PENDING_WEBHOOK["base_url"] = ""
    elif registration_window() == "night":
        status = attempt.get("status") or "error"
        PENDING_WEBHOOK["base_url"] = base
    else:
        status = "not_night"
    _event("night_reclaim", current, endpoint,
           put_status="attempted" if attempt else "not_attempted",
           verify_status="match" if updated else attempt.get("status", "not_attempted"),
           status=status)
    _log("night reclaim: " + status)
    return "reclaimed" if updated else "failed"


def main(*, sleep=time.sleep, clock=time.monotonic) -> int:
    token = _load_token()
    proc = None
    backoff_i = 0
    restart_state = {"last_restart_at": None}  # A4-5
    reclaim_state = {"last_check_at": None}  # A4-6
    try:
        while True:
            _log("starting cloudflared")
            proc = _start_cloudflared()
            url = _wait_for_url(proc, 90.0)
            if not url:
                # G17: distinguish child-exited from a real 90s wait
                if proc.poll() is not None:
                    _log("cloudflared exited before publishing a url rc=" + str(proc.returncode))
                else:
                    _log("no tunnel url within 90s")
                _kill_proc(proc)
                delay = START_BACKOFFS[min(backoff_i, len(START_BACKOFFS) - 1)]
                backoff_i += 1
                _log("retry cloudflared after " + str(delay) + "s")
                sleep(delay)
                continue
            backoff_i = 0
            _publish(url, token)
            # A4-6: a night publish just PUT+verified; next reclaim check in 900 s.
            reclaim_state["last_check_at"] = clock() if registration_window() == "night" else None
            while True:
                sleep(60)
                _retry_pending_webhook(token)
                if proc.poll() is not None:
                    _log("cloudflared exited rc=" + str(proc.returncode))
                    break
                if _restart_if_unhealthy(proc, url, restart_state, clock()):
                    break  # A4-5: outer loop restarts and republishes via _publish
                _night_reclaim(url, token, reclaim_state, clock(), sleep=sleep)  # A4-6
    except KeyboardInterrupt:
        _log("interrupted")
        return 0
    finally:
        _kill_proc(proc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
