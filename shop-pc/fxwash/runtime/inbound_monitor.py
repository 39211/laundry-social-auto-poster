"""Real-time Inbound & Completion Monitor for eHank Laundry POS.

Continuously monitors C:\\FXwash\\eHank.mdb for:
1. New customer garment check-ins (收件入庫)
2. Garment washing/finishing completions (完工入庫)

Automatically pushes natural LINE notifications to bound customers.
Runs strictly read-only against the Access MDB.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

try:
    sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
    sys.stderr.reconfigure(line_buffering=True, encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.line_api import channel_credentials
from shop_config import load_shop

LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"


def push_message(user_id: str, messages: list[dict], token: str) -> bool:
    """Send proactive push message to a bound LINE customer."""
    if not user_id or not messages or not token:
        return False
    payload = {
        "to": user_id,
        "messages": messages,
    }
    req = Request(
        LINE_PUSH_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as resp:
            print(f"[Push Notification Success] To user {user_id[:8]}...: HTTP {resp.status}")
            return True
    except Exception as exc:
        err_detail = ""
        if hasattr(exc, "read"):
            err_detail = exc.read().decode("utf-8", errors="ignore")
        print(f"[Push Notification Error] Failed to push to {user_id}: {exc} | {err_detail}", file=sys.stderr)
        return False


def load_bindings(data_dir: Path) -> dict[str, dict]:
    path = data_dir / "customer_bindings.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def find_user_ids_for_customer(bindings: dict[str, dict], customer_id: str) -> list[str]:
    clean_id = str(customer_id or "").strip()
    target_ids = {clean_id, clean_id.zfill(4), clean_id.lstrip("0") or "0"}
    matched_uids = []
    for uid, info in bindings.items():
        bound_cid = str(info.get("customer_id") or "").strip()
        if bound_cid in target_ids:
            matched_uids.append(uid)
    return matched_uids


RETRY_DELAYS = (6, 30, 120, 600, 3600)
READY_QUERY = (
    "SELECT Did, Dno, Cid, State, Dname, Price, Datei, Loc FROM Det "
    "WHERE (Dater IS NULL OR Trim(Dater) = '') AND "
    "((Datei IS NOT NULL AND Trim(Datei) <> '') OR Trim(State) = '完工')"
)


class StateCorrupt(ValueError):
    """Persistent notification state requires operator repair, never rebaselining."""


def load_state(state_file: Path) -> dict:
    if not state_file.exists():
        return {}
    raw = state_file.read_bytes()
    try:
        state = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(state, dict) or not isinstance(state.get("last_did", ""), str):
            raise ValueError("invalid state shape")
        legacy = state.get("completed_dnos", [])
        keys = state.get("completed_keys", [])
        if not isinstance(legacy, list) or not all(isinstance(x, str) for x in legacy):
            raise ValueError("invalid legacy keys")
        if not isinstance(keys, list) or not all(
            isinstance(x, list) and len(x) == 2 and all(isinstance(v, str) for v in x) for x in keys
        ):
            raise ValueError("invalid completion keys")
        if "baseline_initialized" in state and not isinstance(state["baseline_initialized"], bool):
            raise ValueError("invalid baseline flag")
        return state
    except (ValueError, UnicodeError) as exc:
        # Keep the original in place too: removing it would allow the next
        # watchdog restart to mistake corruption for a first installation.
        backup = state_file.with_name(state_file.name + f".corrupt-{time.time_ns()}")
        print("[STATE_CORRUPT] Pushes stopped; operator repair required.", file=sys.stderr)
        backup.write_bytes(raw)
        raise StateCorrupt("STATE_CORRUPT") from exc


def save_state(state_file: Path, state: dict) -> None:
    tmp = state_file.with_name(state_file.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(state, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, state_file)


class InboundMonitor:
    """Single-writer durable event/recipient receipts around the read-only MDB."""

    def __init__(self, data_dir: Path, mdb_path: Path, run_query, token: str):
        self.data_dir = data_dir
        self.mdb_path = mdb_path
        self.run_query = run_query
        self.token = token
        self.state_file = data_dir / "monitor_state.json"
        self.outbox_file = data_dir / "notify_outbox.jsonl"
        self.state = load_state(self.state_file)
        self.last_did = self.state.get("last_did", "")
        self.initialized = self.state.get("baseline_initialized", bool(self.last_did))
        self.completed_keys = {tuple(key) for key in self.state.get("completed_keys", [])}
        self.legacy_dnos = set(self.state.get("completed_dnos", []))
        self.events = {}
        self.last_mtime = None
        self.scan_due = True
        self.query_failures = 0
        if self.outbox_file.exists():
            try:
                with self.outbox_file.open(encoding="utf-8") as stream:
                    for line in stream:
                        record = json.loads(line)
                        if (
                            record["kind"] not in ("intake", "completion")
                            or record["status"] not in ("pending", "done", "abandoned")
                            or type(record["attempts"]) is not int
                            or not 0 <= record["attempts"] <= len(RETRY_DELAYS)
                            or not isinstance(record["ts"], (int, float))
                            or not isinstance(record["recipients"], list)
                            or record["uid"] not in record["recipients"]
                            or not isinstance(record["messages"], list)
                            or not isinstance(record["last_error_type"], str)
                            or not all(isinstance(record[k], str) for k in ("dno", "did", "uid"))
                        ):
                            raise ValueError("invalid outbox record")
                        self._remember(record)
            except (ValueError, KeyError, TypeError) as exc:
                print("[OUTBOX_CORRUPT] Pushes stopped; operator repair required.", file=sys.stderr)
                raise StateCorrupt("OUTBOX_CORRUPT") from exc
        if self.events and not self.initialized:
            raise StateCorrupt("STATE_MISSING_WITH_OUTBOX")

    def _remember(self, record: dict) -> None:
        key = (record["kind"], record["dno"], record["did"])
        self.events.setdefault(key, {})[record["uid"]] = record

    def _append(self, record: dict) -> None:
        # Both pending intent and terminal receipt are append-only and durable.
        raw = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        with self.outbox_file.open("ab") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        self._remember(record)

    def _save(self) -> None:
        state = dict(self.state)
        state.pop("completed_dnos", None)
        state.update(
            last_did=self.last_did,
            completed_keys=[list(key) for key in sorted(self.completed_keys)],
            baseline_initialized=self.initialized,
        )
        save_state(self.state_file, state)
        self.state = state

    def _query_failed(self, exc: Exception) -> None:
        self.query_failures += 1
        if self.query_failures % 10 == 0:
            print(
                f"[MDB_QUERY_FAILED] consecutive_rounds={self.query_failures} error_type={type(exc).__name__}",
                file=sys.stderr,
            )

    def initialize(self) -> bool:
        if self.initialized:
            return True
        try:
            rows = self.run_query("SELECT MAX(Did) FROM Det")
            ready = self.run_query(READY_QUERY)
        except Exception as exc:
            self._query_failed(exc)
            return False
        # Commit neither half until both baseline reads have succeeded.
        self.last_did = str(rows[0][0] or "").strip() if rows else ""
        self.completed_keys = {(str(r[1]).strip(), str(r[0]).strip()) for r in ready if r[0] and r[1]}
        self.legacy_dnos.clear()
        self.initialized = True
        try:
            self._save()
        except OSError:
            self.initialized = False
            raise
        self.query_failures = 0
        return True

    def _send(self, record: dict) -> None:
        updated = dict(record)
        try:
            delivered = push_message(record["uid"], record["messages"], self.token)
            error_type = "" if delivered else "PushReturnedFalse"
        except Exception as exc:
            delivered = False
            error_type = type(exc).__name__
        updated["ts"] = time.time()
        updated["last_error_type"] = error_type
        updated["status"] = "done" if delivered else (
            "abandoned" if updated["attempts"] >= len(RETRY_DELAYS) else "pending"
        )
        self._append(updated)
        if updated["status"] == "abandoned":
            print(f"[NOTIFY_ABANDONED] retries={updated['attempts']} error_type={error_type}", file=sys.stderr)

    def _retry_outbox(self) -> None:
        for recipients in list(self.events.values()):
            for record in list(recipients.values()):
                if record["status"] != "pending":
                    continue
                attempts = record["attempts"]
                if attempts < len(RETRY_DELAYS) and time.time() - record["ts"] < RETRY_DELAYS[attempts]:
                    continue
                updated = dict(record)
                updated["ts"] = time.time()
                self.scan_due = True
                if attempts >= len(RETRY_DELAYS):
                    # Restart after the last durable attempt, before its result.
                    updated.update(status="abandoned", last_error_type="RetryLimitAfterRestart")
                    self._append(updated)
                    continue
                updated["attempts"] += 1
                # Persist the attempt before calling the external boundary, so
                # restarts cannot reset the retry budget or backoff.
                self._append(updated)
                self._send(updated)

    def _notify(self, kind: str, row, bindings: dict) -> bool:
        did, dno, cid, state, dname, price = (str(v or "").strip() for v in row[:6])
        key = (kind, dno, did)
        known = self.events.get(key, {})
        if known:
            sample = next(iter(known.values()))
            uids = sample["recipients"]
            messages = sample["messages"]
        else:
            cust_id = cid if cid and not cid.startswith("@") else state
            uids = find_user_ids_for_customer(bindings, cust_id) or [""]
            if kind == "intake":
                pdate = str(row[7] or "").strip()
                msg = (
                    f"您好，已收到您的送洗衣物：\n"
                    f"• {dname}（單號：{dno}）｜ {price} 元\n"
                )
                if pdate:
                    msg += f"預計取件日期：{pdate}\n"
                msg += "衣物處理完成後會再第一時間主動發訊通知您！"
            else:
                msg = (
                    f"您好，您的送洗衣物已經處理完工囉！\n"
                    f"• {dname}（單號：{dno}）｜ {price} 元\n\n"
                    f"歡迎於門市營業時間前來取件。\n"
                    f"我們在至善國中對面，407 臺中市西屯區至善里青海路二段365號。\n"
                    f"週一至週五 10:00-20:00；週六 12:00-18:00；週日公休"
                )
            messages = [{"type": "text", "text": msg}]
        fresh = []
        for uid in uids:
            if uid not in known:
                record = dict(
                    ts=time.time(), kind=kind, dno=dno, did=did, uid=uid,
                    attempts=0, last_error_type="" if uid else "NoBinding",
                    status="pending" if uid else "abandoned",
                    recipients=uids, messages=messages,
                )
                self._append(record)
                if uid:
                    fresh.append(record)
        # All intended recipients must be on disk before the first send. A
        # partial append cannot make an event appear completely delivered.
        for record in fresh:
            self._send(record)
        records = self.events[key]
        return all(uid in records and records[uid]["status"] in ("done", "abandoned") for uid in uids)

    def poll(self) -> None:
        if not self.initialized:
            self.initialize()
            return
        # Retries must run even without an MDB change or a successful MDB read.
        self._retry_outbox()
        if not self.mdb_path.exists():
            return
        current_mtime = self.mdb_path.stat().st_mtime
        if current_mtime == self.last_mtime and not self.scan_due:
            return
        escaped_did = self.last_did.replace("'", "''")
        try:
            new_intakes = self.run_query(
                "SELECT Did, Dno, Cid, State, Dname, Price, Indate, Pdate FROM Det "
                f"WHERE Did > '{escaped_did}' ORDER BY Did ASC"
            )
            current_ready = self.run_query(READY_QUERY)
        except Exception as exc:
            self._query_failed(exc)
            return
        self.query_failures = 0

        # The old format lacks Did. Only map legacy Dnos already at/below the
        # old intake cursor; a reused Dno with a new Did must still notify.
        for row in current_ready:
            did, dno = str(row[0] or "").strip(), str(row[1] or "").strip()
            if dno in self.legacy_dnos and did and did <= self.last_did:
                self.completed_keys.add((dno, did))
        self.legacy_dnos.clear()

        bindings = load_bindings(self.data_dir)
        blocked = False
        for row in new_intakes:
            settled = self._notify("intake", row, bindings)
            blocked = blocked or not settled
            did = str(row[0] or "").strip()
            if not blocked and did > self.last_did:
                self.last_did = did
        for row in current_ready:
            did, dno = str(row[0] or "").strip(), str(row[1] or "").strip()
            if did and dno and (dno, did) not in self.completed_keys:
                if self._notify("completion", row, bindings):
                    self.completed_keys.add((dno, did))
        self._save()
        self.last_mtime = current_mtime
        self.scan_due = False


def run_monitor(shop_root: Path, interval: float = 6.0):
    shop = load_shop(shop_root / "shop.json")
    token = channel_credentials(shop).get("token", "")
    bridge_root = shop_root / "bridge"
    if str(bridge_root) not in sys.path:
        sys.path.insert(0, str(bridge_root))
    from ai_engine import db_manager

    mdb_path = Path(r"C:\FXwash\eHank.mdb")
    if not mdb_path.exists():
        mdb_path = Path(r"c:\Users\AN\Desktop\備份0904\eHank.mdb")
    data_dir = shop_root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    try:
        # Loading state precedes opening the MDB and all possible pushes.
        con = None

        def run_query(sql):
            nonlocal con
            if con is None:
                con = db_manager.get_conn()
            return con.execute(sql).fetchall()

        worker = InboundMonitor(data_dir, mdb_path, run_query, token)
        worker.initialize()
    except (StateCorrupt, OSError) as exc:
        print(f"[MONITOR_STOPPED] error_type={type(exc).__name__}", file=sys.stderr)
        return
    print(f"[Inbound Monitor Started] Monitoring: {mdb_path}")
    while True:
        try:
            time.sleep(interval)
            worker.poll()
        except Exception as exc:
            print(f"[Monitor Loop Exception] error_type={type(exc).__name__}", file=sys.stderr)


if __name__ == "__main__":
    shop_dir = Path(__file__).resolve().parent.parent
    run_monitor(shop_dir)
