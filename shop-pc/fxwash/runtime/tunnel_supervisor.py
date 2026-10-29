"""Automated, self-healing Tunnel Supervisor for FXwash LINE Webhook.

Launches OpenSSH tunnel to localhost.run with keepalive, automatically detects
the assigned HTTPS URL, updates shop.json, and registers the webhook endpoint
directly with the LINE platform. If the connection drops or reconnects, it
seamlessly updates the LINE webhook URL with zero downtime.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
    sys.stderr.reconfigure(line_buffering=True, encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.line_api import set_webhook, test_webhook
from shop_config import load_shop

URL_REGEX = re.compile(r"https://[a-zA-Z0-9-]+\.lhr\.life")
SHOP_PATH = ROOT / "shop.json"


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
                            set_webhook(shop, new_webhook)
                            print(f"[Tunnel Supervisor] LINE platform webhook updated to {new_webhook}!")
                            test_res = test_webhook(shop, new_webhook)
                            print(f"[Tunnel Supervisor] Webhook test result: {test_res.get('statusCode')} ({test_res.get('reason')})")
                        except Exception as e:
                            print(f"[Tunnel Supervisor] Failed to register webhook on LINE: {e}")

        except Exception as exc:
            print(f"[Tunnel Supervisor] Error reading tunnel output: {exc}")
        finally:
            proc.poll()
            if proc.returncode is None:
                proc.terminate()
            print("[Tunnel Supervisor] Tunnel process exited. Reconnecting in 3 seconds...")
            time.sleep(3)


if __name__ == "__main__":
    port = 18791
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run_supervisor(port)
