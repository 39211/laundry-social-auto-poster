"""Photo Session Context Manager for FXwash LINE Bot.

Tracks the last analyzed item, diagnosis, estimated price, observed stains/flaws,
and guiding follow-up questions per user, allowing multi-turn conversational AI
to seamlessly maintain context when the user responds with text.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


def _get_session_file(shop_root: Path) -> Path:
    data_dir = shop_root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "photo_sessions.json"


def load_all_sessions(shop_root: Path) -> dict[str, Any]:
    f = _get_session_file(shop_root)
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_photo_session(shop_root: Path, user_id: str, session_data: dict[str, Any]) -> None:
    """Save or update user's photo diagnosis session."""
    if not user_id:
        return
    sessions = load_all_sessions(shop_root)
    session_data["timestamp"] = time.time()
    sessions[user_id] = session_data

    # Cleanup old sessions older than 24 hours
    now = time.time()
    filtered = {uid: data for uid, data in sessions.items() if (now - data.get("timestamp", 0)) < 86400}

    f = _get_session_file(shop_root)
    try:
        f.write_text(json.dumps(filtered, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[PhotoSession] Failed to persist session: {e}")


def get_photo_session(shop_root: Path, user_id: str, max_age_seconds: int = 3600) -> dict[str, Any] | None:
    """Retrieve user's active photo session if within valid time window (default 1 hour)."""
    if not user_id:
        return None
    sessions = load_all_sessions(shop_root)
    session = sessions.get(user_id)
    if not session:
        return None
    ts = session.get("timestamp", 0)
    if time.time() - ts > max_age_seconds:
        return None
    return session


def clear_photo_session(shop_root: Path, user_id: str) -> None:
    """Remove user's photo session after completion or drop-off."""
    if not user_id:
        return
    sessions = load_all_sessions(shop_root)
    if user_id in sessions:
        sessions.pop(user_id, None)
        f = _get_session_file(shop_root)
        try:
            f.write_text(json.dumps(sessions, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass
