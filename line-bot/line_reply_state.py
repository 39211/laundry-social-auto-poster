# -*- coding: utf-8 -*-
"""Durable reply guards, keyed only by the event's domain-separated HMAC.

An exclusive pending marker survives a timeout/crash and suppresses another
send. Known outcomes remove it. Retry markers are permanent: even a restart
or an unflagged duplicate cannot grant the same event another HTTP 503.
These are control state, independent of the optional telemetry sinks.
"""
from __future__ import annotations

import os
from pathlib import Path
import re


def _marker(repo, event_ref, kind):
    if not re.fullmatch(r"[0-9a-f]{64}", event_ref):
        raise ValueError("invalid event correlation")
    return Path(repo) / "data" / "line-reply-state" / f"{event_ref}.{kind}"


def _create_once(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(b"1")
            handle.flush()
            os.fsync(handle.fileno())
        return True
    except FileExistsError:
        return False


def pending(repo, event_ref):
    if not event_ref:
        return False
    try:
        _marker(repo, event_ref, "pending").lstat()
        return True
    except FileNotFoundError:
        return False


def begin(repo, event_ref):
    # Without webhookEventId we cannot correlate a send across deliveries.
    # Preserve the normal first send, but claim_retry will refuse HTTP 503.
    return not event_ref or _create_once(_marker(repo, event_ref, "pending"))


def finish(repo, event_ref):
    if event_ref:
        _marker(repo, event_ref, "pending").unlink(missing_ok=True)


def claim_retry(repo, event_ref):
    return bool(event_ref) and _create_once(_marker(repo, event_ref, "retry"))
