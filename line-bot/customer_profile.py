# -*- coding: utf-8 -*-
"""客人主動給過的地址／電話。路徑可被測試 monkeypatch。"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

REPO = Path(os.environ.get("LAUNDRY_REPO_ROOT", r"C:/Users/cyc39/laundry-repo"))
PROFILE_PATH = REPO / "data" / "line-customer-profile.json"


def _path(path: Path | None = None) -> Path:
    return path if path is not None else PROFILE_PATH


def load(path: Path | None = None) -> dict:
    p = _path(path)
    try:
        if not p.exists():
            return {}
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def get(uid: str, path: Path | None = None) -> dict:
    if not uid:
        return {}
    row = load(path).get(uid)
    if not isinstance(row, dict):
        return {}
    return row


def mask_phone(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) >= 3:
        return f"09xx-xxx-{digits[-3:]}"
    return "09xx-xxx-xxx"


def upsert(uid: str, *, phone: str | None = None, address: str | None = None, path: Path | None = None) -> None:
    if not uid:
        return
    phone = (phone or "").strip()
    address = (address or "").strip()
    if not phone and not address:
        return
    p = _path(path)
    data = load(p)
    row = data.get(uid)
    if not isinstance(row, dict):
        row = {}
    if phone:
        row["phone"] = phone
    if address:
        row["address"] = address
    row["updated"] = datetime.now().isoformat(timespec="seconds")
    data[uid] = row
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass
