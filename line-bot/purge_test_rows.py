# -*- coding: utf-8 -*-
"""Move test-uid rows out of live LINE data files. Default is dry-run (no --apply)."""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import socket
import string
import sys
from datetime import datetime
from pathlib import Path

DATA = (
    Path(os.environ["LAUNDRY_REPO_ROOT"]) / "data"
    if os.environ.get("LAUNDRY_REPO_ROOT")
    else Path(r"C:/Users/cyc39/laundry-repo/data")
)
# F13: real LINE userId is U + 32 hex (either case)
REAL_UID = re.compile(r"^U[0-9a-fA-F]{32}$")
JSONL_FILES = ("line-bookings.jsonl", "staff-inbox.jsonl")
JSON_FILES = ("line-sessions.json", "line-customer-bind.json")
BOT_PORTS = (8791, 8792)
_BACKUP_RAND_ALPH = string.ascii_lowercase + string.digits


class UnreadableFile(Exception):
    def __init__(self, name: str):
        self.name = name
        super().__init__("unreadable " + name)


def is_test_uid(uid: str) -> bool:
    return not bool(REAL_UID.match(uid or ""))


def _port_listening(port: int, host: str = "127.0.0.1") -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0
    finally:
        s.close()


def bot_ports_busy() -> bool:
    # F11: refuse --apply while the bot is listening
    return any(_port_listening(p) for p in BOT_PORTS)


def _load_jsonl(path: Path):
    keep = []
    move = []
    no_uid = []
    if not path.exists():
        return keep, move, no_uid
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            keep.append(line)
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            # G11: parse failure is not an empty-keep success
            raise UnreadableFile(path.name) from e
        if not isinstance(row, dict):
            raise UnreadableFile(path.name)
        # F13: rows without a uid field are never moved
        if "uid" not in row:
            no_uid.append(row)
            keep.append(line)
            continue
        uid = str(row.get("uid") or "")
        if is_test_uid(uid):
            move.append(row)
        else:
            keep.append(line)
    return keep, move, no_uid


def _load_json_map(path: Path):
    keep = {}
    move = {}
    no_uid = {}
    suspect = {}
    if not path.exists():
        return keep, move, no_uid, suspect
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        # G11: parse failure is not an empty-keep success
        raise UnreadableFile(path.name) from e
    if not isinstance(data, dict):
        raise UnreadableFile(path.name)
    for uid, val in data.items():
        key = str(uid)
        if REAL_UID.match(key):
            keep[uid] = val
        elif key.startswith("U"):
            # G7: U-prefix but not a real uid -> no_uid, do not move
            no_uid[uid] = val
            keep[uid] = val
        else:
            # G7: does not look like a uid -> suspect, still move
            suspect[uid] = val
            move[uid] = val
    return keep, move, no_uid, suspect


def plan(data: Path | None = None):
    root = data or DATA
    out = {"jsonl": {}, "json": {}, "no_uid": {}, "suspect": {}, "unreadable": []}
    for name in JSONL_FILES:
        try:
            keep, move, no_uid = _load_jsonl(root / name)
            out["jsonl"][name] = {"keep": keep, "move": move}
            out["no_uid"][name] = no_uid
        except UnreadableFile:
            out["unreadable"].append(name)
            out["jsonl"][name] = {"keep": [], "move": []}
            out["no_uid"][name] = []
    for name in JSON_FILES:
        try:
            keep, move, no_uid, suspect = _load_json_map(root / name)
            out["json"][name] = {"keep": keep, "move": move}
            out["no_uid"][name] = no_uid
            out["suspect"][name] = suspect
        except UnreadableFile:
            out["unreadable"].append(name)
            out["json"][name] = {"keep": {}, "move": {}}
            out["no_uid"][name] = {}
            out["suspect"][name] = {}
    return out


def report(p) -> None:
    unread = set(p.get("unreadable") or [])
    for name in JSONL_FILES:
        rows = p["jsonl"][name]["move"]
        print(f"{name}: {len(rows)}")
        for row in rows:
            print("  uid=" + str(row.get("uid") or "") + " id=" + str(row.get("id") or ""))
    for name in JSON_FILES:
        moved = p["json"][name]["move"]
        print(f"{name}: {len(moved)}")
        for uid in moved:
            print("  uid=" + str(uid))
    # F13: rows missing uid, for human review
    # G7: JSON-map U-prefix wrong length listed here too; they are not moved
    print("no_uid:")
    for name in JSONL_FILES:
        rows = (p.get("no_uid") or {}).get(name) or []
        print(f"  {name}: {len(rows)}")
        for row in rows:
            print("    id=" + str(row.get("id") or "") + " keys=" + ",".join(str(k) for k in row.keys()))
    for name in JSON_FILES:
        rows = (p.get("no_uid") or {}).get(name) or {}
        print(f"  {name}: {len(rows)}")
        if isinstance(rows, dict):
            for uid in rows:
                print("    key=" + str(uid))
    print("suspect:")
    for name in JSON_FILES:
        rows = (p.get("suspect") or {}).get(name) or {}
        print(f"  {name}: {len(rows)}")
        for uid in rows:
            print("    key=" + str(uid))
    print("unreadable:")
    if unread:
        for name in list(JSONL_FILES) + list(JSON_FILES):
            if name in unread:
                print("  " + name)
    else:
        print("  (none)")


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _new_backup_path(root: Path) -> Path:
    # G10: second + 4-char random; open("x") so a collision cannot overwrite
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    rand = "".join(random.choice(_BACKUP_RAND_ALPH) for _ in range(4))
    return root / f"line-test-rows-backup-{stamp}-{rand}.json"


def apply(p, data: Path | None = None) -> Path:
    root = data or DATA
    if p.get("unreadable"):
        # G11: do not touch any file when a source was unreadable
        raise UnreadableFile(",".join(p["unreadable"]))
    backup = _new_backup_path(root)
    payload = {
        "moved_at": backup.name,
        "files": {},
        "no_uid": p.get("no_uid") or {},
        "suspect": p.get("suspect") or {},
    }
    for name in JSONL_FILES:
        payload["files"][name] = p["jsonl"][name]["move"]
    for name in JSON_FILES:
        payload["files"][name] = p["json"][name]["move"]
    # F10: write + fsync backup first; only then replace live files
    raw = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with backup.open("x", encoding="utf-8") as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    if not backup.exists():
        raise RuntimeError("backup missing after write")
    json.loads(backup.read_text(encoding="utf-8"))
    for name in JSONL_FILES:
        keep = p["jsonl"][name]["keep"]
        text = "\n".join(keep)
        if keep:
            text += "\n"
        _atomic_write(root / name, text)
    for name in JSON_FILES:
        keep = p["json"][name]["keep"]
        _atomic_write(
            root / name,
            json.dumps(keep, ensure_ascii=False, indent=2) + ("\n" if keep else ""),
        )
    return backup


def main(argv=None, data: Path | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    # F12: --dry-run and --apply together is an error; omitting --apply is dry-run
    if args.apply and args.dry_run:
        print("error: --apply and --dry-run cannot be used together")
        return 2
    p = plan(data)
    report(p)
    if args.apply:
        if p.get("unreadable"):
            print("error: unreadable files, abort")
            return 2
        if not args.force and bot_ports_busy():
            print("請先停止 bot 再跑")
            return 2
        try:
            path = apply(p, data)
        except FileExistsError:
            print("error: backup already exists, abort")
            return 2
        except UnreadableFile as e:
            print("error: " + str(e))
            return 2
        print("backup " + str(path))
    else:
        print("dry-run (no write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
