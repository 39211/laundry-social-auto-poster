"""Task-local test isolation; no credentials, production files, or real HTTP."""
from __future__ import annotations

import functools
import json
import shutil
import tempfile
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import tunnel_manager as tm

TAIPEI = timezone(timedelta(hours=8))
DEFAULT_CONFIG = {
    "day_start": "10:00",
    "day_end": "20:00",
    "night_takeover_delay_min": 5,
    "tz": "Asia/Taipei",
}


@contextmanager
def isolated_tunnel_case():
    # Python 3.14's tempfile 0700 DACL excludes this restricted Windows token.
    # Inherit the worktree ACL instead; every generated path stays in line-bot.
    parent = Path(__file__).resolve().parent
    root = parent / (".a43-test-" + uuid4().hex)
    root.mkdir()
    config = root / "handover.json"
    config.write_text(json.dumps(DEFAULT_CONFIG), encoding="utf-8")

    def mkdtemp(suffix=None, prefix=None, dir=None):
        location = Path(dir) if dir is not None else root
        if not location.resolve().is_relative_to(root):
            raise AssertionError("test temp path escaped its case directory")
        path = location / ((prefix or "tmp") + uuid4().hex + (suffix or ""))
        path.mkdir()
        return str(path)

    try:
        with ExitStack() as stack:
            for name, value in {
                "LOG_PATH": root / "tunnel.log",
                "EVENTS_PATH": root / "tunnel_events.jsonl",
                "PUBLIC_BASE": root / "public_base.txt",
                "HANDOVER_CONFIG": config,
                "PENDING_WEBHOOK": {"base_url": ""},
            }.items():
                stack.enter_context(patch.object(tm, name, value, create=True))
            stack.enter_context(patch.object(
                tm, "_now", return_value=datetime(2026, 10, 30, 21, tzinfo=TAIPEI),
                create=True,
            ))
            stack.enter_context(patch.object(tempfile, "mkdtemp", side_effect=mkdtemp))
            stack.enter_context(patch("socket.create_connection", side_effect=AssertionError(
                "real network is forbidden in A4-3 tests"
            )))
            yield root
    finally:
        # Only our newly created, non-junction case directory can be removed.
        if root.resolve().parent != parent or root.is_symlink() or root.is_junction():
            raise AssertionError("unsafe test cleanup target")
        shutil.rmtree(root)


def isolated_legacy_test(function):
    @functools.wraps(function)
    def run():
        with isolated_tunnel_case():
            function()
    return run
