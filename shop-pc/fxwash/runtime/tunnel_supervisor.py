"""Automated, self-healing Tunnel Supervisor for FXwash LINE Webhook.

Launches OpenSSH tunnel to localhost.run with keepalive, automatically detects
the assigned HTTPS URL, updates shop.json, and registers the webhook endpoint
directly with the LINE platform. Records URL changes and verifies the registered
endpoint after PUT; reconnections can still interrupt webhook delivery.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

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
    current_url = ""
    ssh_exe = find_ssh()
    ssh_cmd = [
        ssh_exe,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=10",
        "-o", "ServerAliveCountMax=3",
        "-R", f"80:127.0.0.1:{port}",
        "nokey@localhost.run",
    ]

    while True:
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
                if match:
                    new_base = match.group(0)
                    new_webhook = f"{new_base}/line/webhook"
                    if new_webhook != current_url:
                        print(f"[Tunnel Supervisor] New tunnel detected: {new_webhook}")
                        old_url = current_url
                        write_event("url_detected", old_url, new_webhook)
                        current_url = new_webhook
                        # 1. Update shop.json
                        try:
                            shop_data = json.loads(SHOP_PATH.read_text(encoding="utf-8"))
                            shop_data.setdefault("server", {})
                            shop_data["server"]["public_base"] = new_base
                            shop_data["server"]["webhook_url"] = new_webhook
                            SHOP_PATH.write_text(json.dumps(shop_data, indent=2, ensure_ascii=False), encoding="utf-8")
                        except Exception as e:
                            print(f"[Tunnel Supervisor] Failed to update shop.json: {e}")

                        # 2. Update LINE Webhook URL
                        try:
                            shop = load_shop(SHOP_PATH)
                            if not register_webhook(shop, old_url, new_webhook):
                                print("[Tunnel Supervisor] LINE endpoint registration was not verified; see tunnel_events.jsonl.")
                                continue
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
            write_event("tunnel_exit", current_url, current_url, verify_status="not_run",
                        rc=rc, alive_seconds=round(time.monotonic() - started_at, 3))
            print("[Tunnel Supervisor] Tunnel process exited. Reconnecting in 3 seconds...")
            time.sleep(3)


if __name__ == "__main__":
    port = 18791
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run_supervisor(port)
