"""Standalone Watchdog & Auto-Healer for FXwash LINE Bot services.

Checks every 5 minutes (or on-demand via Task Scheduler):
1. Webhook Server (Port 18791)
2. Self-Healing Tunnel Supervisor (SSH to localhost.run)
3. POS Inbound Check-in Monitor (eHank.mdb)

If any service is down or dead, revives it immediately.
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON_PORTABLE = Path(r"C:\LaundryStores\python-portable")
PYTHON_EXE = str(PYTHON_PORTABLE / "python.exe")
EXEC_PYTHON = PYTHON_EXE
LOG_FILE = ROOT / "logs" / "watchdog.log"


def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    try:
        print(line)
    except Exception:
        pass
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def is_port_listening(port: int = 18791) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def get_running_scripts() -> set[str]:
    # Use PowerShell to find running python scripts (hidden with zero window)
    ps_cmd = [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name LIKE 'python%'\" | Select-Object -ExpandProperty CommandLine",
    ]
    try:
        res = subprocess.run(
            ps_cmd,
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        lines = (res.stdout or "").lower()
        running = set()
        if "webhook_server.py" in lines:
            running.add("webhook_server")
        if "tunnel_supervisor.py" in lines:
            running.add("tunnel_supervisor")
        if "inbound_monitor.py" in lines:
            running.add("inbound_monitor")
        return running
    except Exception as e:
        log(f"Failed to query running processes: {e}")
        return set()


def start_service(script_name: str, args: list[str] | None = None):
    script_path = str(ROOT / "runtime" / script_name)
    cmd = [EXEC_PYTHON, "-u", script_path]
    if args:
        cmd.extend(args)
    log(f"Starting {script_name} via {Path(EXEC_PYTHON).name} (silent background)...")
    try:
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=flags,
        )
        log(f"Started {script_name} successfully.")
    except Exception as e:
        log(f"Failed to start {script_name}: {e}")



def check_and_heal():
    running = get_running_scripts()
    port_open = is_port_listening(18791)

    # 1. Webhook Server
    if not port_open or "webhook_server" not in running:
        log("Webhook server is DOWN. Restarting...")
        start_service("webhook_server.py", ["18791"])
        time.sleep(2)
    else:
        log("Webhook server is healthy (port 18791 open).")

    # 2. Tunnel Supervisor
    if "tunnel_supervisor" not in running:
        log("Tunnel supervisor is DOWN. Restarting...")
        start_service("tunnel_supervisor.py", ["18791"])
    else:
        log("Tunnel supervisor is running.")

    # 3. Inbound Monitor
    if "inbound_monitor" not in running:
        log("Inbound monitor is DOWN. Restarting...")
        start_service("inbound_monitor.py")
    else:
        log("Inbound monitor is running.")


if __name__ == "__main__":
    check_and_heal()
