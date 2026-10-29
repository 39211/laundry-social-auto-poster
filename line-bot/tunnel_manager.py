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
from datetime import datetime
from pathlib import Path

CLOUDFLARED = Path(r"C:/Users/cyc39/AppData/Local/hermes/jarvis-lab/bin/cloudflared.exe")
PUBLIC_BASE = Path(__file__).resolve().parent / "public_base.txt"
SECRETS = Path(r"C:/Users/cyc39/laundry-repo/secrets/line-channel.json")
LOG_PATH = Path(os.environ.get("LOCALAPPDATA") or ".") / "line-bot" / "tunnel.log"
TUNNEL_RE = re.compile(r"https://[A-Za-z0-9-]+\.trycloudflare\.com")
WEBHOOK_API = "https://api.line.me/v2/bot/channel/webhook/endpoint"
LOG_ROTATE_BYTES = 2 * 1024 * 1024  # F15
WEBHOOK_RETRY_DELAYS = (2, 5, 10)  # F4
START_BACKOFFS = (10, 30, 60)  # F5
_LOG_LOCK = threading.Lock()
# F4: base_url that still needs set_webhook_endpoint after immediate retries failed
PENDING_WEBHOOK = {"base_url": ""}


def parse_tunnel_url(text: str) -> str:
    """Return the first https://<sub>.trycloudflare.com in text, else ''."""
    if not text:
        return ""
    m = TUNNEL_RE.search(text)
    return m.group(0) if m else ""


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


def set_webhook_endpoint(base_url: str, token: str, http=urllib) -> str:
    """PUT webhook endpoint, then GET to confirm it matches. http is injectable."""
    endpoint = (base_url or "").rstrip("/") + "/line/webhook"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
    }
    body = json.dumps({"endpoint": endpoint}).encode()
    put_req = http.request.Request(WEBHOOK_API, data=body, headers=headers, method="PUT")
    http.request.urlopen(put_req, timeout=15).read()
    get_req = http.request.Request(
        WEBHOOK_API,
        headers={"Authorization": "Bearer " + token},
        method="GET",
    )
    raw = http.request.urlopen(get_req, timeout=15).read()
    if isinstance(raw, str):
        raw = raw.encode()
    data = json.loads(raw.decode() or "{}")
    got = (data.get("endpoint") or "").rstrip("/")
    want = endpoint.rstrip("/")
    if got != want:
        raise RuntimeError("webhook endpoint mismatch")
    return endpoint


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


def _attempt_webhook(url: str, token: str) -> bool:
    try:
        set_webhook_endpoint(url, token)
        _log("webhook endpoint updated")
        return True
    except Exception as e:  # noqa: BLE001
        _log_webhook_error(e)
        return False


def _set_webhook_with_retries(url: str, token: str, sleep=time.sleep) -> bool:
    # F4: try now, then 3 retries at 2/5/10 seconds
    if _attempt_webhook(url, token):
        return True
    for delay in WEBHOOK_RETRY_DELAYS:
        sleep(delay)
        if _attempt_webhook(url, token):
            return True
    return False


def _publish(url: str, token: str, sleep=time.sleep) -> None:
    PUBLIC_BASE.write_text(url + "\n", encoding="utf-8")
    _log("public_base " + url)
    if _set_webhook_with_retries(url, token, sleep=sleep):
        PENDING_WEBHOOK["base_url"] = ""
    else:
        PENDING_WEBHOOK["base_url"] = url


def _retry_pending_webhook(token: str) -> None:
    # F4: keep retrying on the 60s loop until LINE accepts the new URL
    url = PENDING_WEBHOOK.get("base_url") or ""
    if not url:
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


def main() -> int:
    token = _load_token()
    proc = None
    backoff_i = 0
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
                time.sleep(delay)
                continue
            backoff_i = 0
            _publish(url, token)
            while True:
                time.sleep(60)
                _retry_pending_webhook(token)
                if proc.poll() is not None:
                    _log("cloudflared exited rc=" + str(proc.returncode))
                    break
    except KeyboardInterrupt:
        _log("interrupted")
        return 0
    finally:
        _kill_proc(proc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
