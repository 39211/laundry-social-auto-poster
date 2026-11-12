"""Offline bridge to the same TypeScript retirement reader; no policy dates here."""
from functools import lru_cache
import json
from pathlib import Path
import shutil
import subprocess
import warnings


@lru_cache(maxsize=256)
def _retired_slots(root, date, revision):
    origin = Path(__file__).resolve().parent.parent
    try:
        node = shutil.which("node.exe") or shutil.which("node")
        if not node:
            raise ValueError("node unavailable")
        result = subprocess.run(
            [node, "--import", (origin / "node_modules/tsx/dist/loader.mjs").as_uri(),
             str(origin / "src/slotRetirements.ts"), "--root", root, "--date", date],
            cwd=origin, capture_output=True, text=True, encoding="utf-8", timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
        value = json.loads(result.stdout)
        slots = value.get("retiredSlots")
        if value.get("date") != date or not isinstance(slots, list) or any(type(s) is not int or s < 1 for s in slots):
            raise ValueError("invalid retirement reader output")
        if value.get("error"):
            warnings.warn(str(value["error"]), RuntimeWarning)
        return tuple(slots)
    except (OSError, ValueError, subprocess.SubprocessError):
        warnings.warn("slot-retirements reader unavailable; slot 2 blocked (fail closed)", RuntimeWarning)
        return (2,)


def active_calendar(calendar, root, date):
    """Project expected work only. Actual published/performance ledgers are unchanged."""
    if not isinstance(calendar, dict) or not isinstance(calendar.get("slots"), list):
        return calendar
    path = Path(root) / "src/slot-retirements.json"
    try:
        info = path.stat()
        revision = (info.st_mtime_ns, info.st_size)
    except OSError:
        revision = None
    retired = _retired_slots(str(Path(root).resolve()), date, revision)
    return {**calendar, "slots": [s for s in calendar["slots"] if not isinstance(s, dict) or s.get("slot") not in retired]}
