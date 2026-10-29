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


def run_monitor(shop_root: Path, interval: float = 6.0):
    shop = load_shop(shop_root / "shop.json")
    creds = channel_credentials(shop)
    token = creds.get("token", "")

    bridge_root = shop_root / "bridge"
    if str(bridge_root) not in sys.path:
        sys.path.insert(0, str(bridge_root))
    from ai_engine import db_manager

    mdb_path = Path(r"C:\FXwash\eHank.mdb")
    if not mdb_path.exists():
        mdb_path = Path(r"c:\Users\AN\Desktop\備份0904\eHank.mdb")

    data_dir = shop_root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    state_file = data_dir / "monitor_state.json"

    # Initialize or restore state
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            state = {}

    last_did = state.get("last_did", "")
    completed_dnos = set(state.get("completed_dnos", []))

    con = db_manager.get_conn()

    # If first run, initialize baseline from current database state
    if not last_did:
        try:
            rows = con.execute("SELECT MAX(Did) FROM Det").fetchall()
            if rows and rows[0][0]:
                last_did = str(rows[0][0]).strip()
        except Exception as exc:
            print(f"[Monitor Init] Failed to query MAX(Did): {exc}", file=sys.stderr)
            last_did = "000000"

    if not completed_dnos:
        try:
            rows = con.execute(
                "SELECT Dno FROM Det WHERE Datei IS NOT NULL AND Datei <> '' AND (Dater IS NULL OR Dater = '')"
            ).fetchall()
            completed_dnos = {str(r[0]).strip() for r in rows if r and r[0]}
        except Exception as exc:
            print(f"[Monitor Init] Failed to query existing completed Dnos: {exc}", file=sys.stderr)

    print(f"[Inbound Monitor Started] Monitoring: {mdb_path}")
    print(f"[Baseline] Last Did: {last_did}, Ready pieces in store: {len(completed_dnos)}")

    # Save initial state
    state["last_did"] = last_did
    state["completed_dnos"] = list(completed_dnos)
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    last_mtime = 0.0

    while True:
        try:
            time.sleep(interval)
            if not mdb_path.exists():
                continue

            current_mtime = mdb_path.stat().st_mtime
            if current_mtime == last_mtime:
                continue

            # File has changed, check for new intakes or completions
            bindings = load_bindings(data_dir)

            # 1. Check for new garment check-in intakes (收件入庫)
            intake_query = (
                f"SELECT Did, Dno, Cid, State, Dname, Price, Indate, Pdate FROM Det "
                f"WHERE Did > '{last_did}' ORDER BY Did ASC"
            )
            try:
                new_intakes = con.execute(intake_query).fetchall()
            except Exception as exc:
                print(f"[Monitor Query Error] Intake check: {exc}", file=sys.stderr)
                new_intakes = []

            for row in new_intakes:
                did = str(row[0] or "").strip()
                dno = str(row[1] or "").strip()
                cid_val = str(row[2] or "").strip()
                state_val = str(row[3] or "").strip()
                dname = str(row[4] or "").strip()
                price = str(row[5] or "").strip()
                indate = str(row[6] or "").strip()
                pdate = str(row[7] or "").strip()

                if did > last_did:
                    last_did = did

                cust_id = cid_val if cid_val and not cid_val.startswith("@") else state_val
                print(f"[New Intake Detected] Did:{did} Dno:{dno} Item:{dname} Price:{price} Cid:{cust_id}")

                # Notify bound customers
                uids = find_user_ids_for_customer(bindings, cust_id)
                for uid in uids:
                    msg = (
                        f"您好，已收到您的送洗衣物：\n"
                        f"• {dname}（單號：{dno}）｜ {price} 元\n"
                    )
                    if pdate:
                        msg += f"預計取件日期：{pdate}\n"
                    msg += "衣物處理完成後會再第一時間主動發訊通知您！"
                    push_message(uid, [{"type": "text", "text": msg}], token)

            # 2. Check for newly finished garment completions (完工入庫)
            ready_query = (
                "SELECT Did, Dno, Cid, State, Dname, Price, Datei, Loc FROM Det "
                "WHERE Datei IS NOT NULL AND Datei <> '' AND (Dater IS NULL OR Dater = '')"
            )
            try:
                current_ready = con.execute(ready_query).fetchall()
            except Exception as exc:
                print(f"[Monitor Query Error] Completion check: {exc}", file=sys.stderr)
                current_ready = []

            for row in current_ready:
                dno = str(row[1] or "").strip()
                if not dno or dno in completed_dnos:
                    continue

                # Found newly finished piece
                completed_dnos.add(dno)
                cid_val = str(row[2] or "").strip()
                state_val = str(row[3] or "").strip()
                dname = str(row[4] or "").strip()
                price = str(row[5] or "").strip()
                datei = str(row[6] or "").strip()
                loc = str(row[7] or "").strip()

                cust_id = cid_val if cid_val and not cid_val.startswith("@") else state_val
                print(f"[New Completion Detected] Dno:{dno} Item:{dname} Price:{price} Datei:{datei} Loc:{loc} Cid:{cust_id}")

                uids = find_user_ids_for_customer(bindings, cust_id)
                for uid in uids:
                    msg = (
                        f"您好，您的送洗衣物已經處理完工囉！\n"
                        f"• {dname}（單號：{dno}）｜ {price} 元\n\n"
                        f"歡迎於門市營業時間前來取件。\n"
                        f"我們在至善國中對面，407 臺中市西屯區至善里青海路二段365號。\n"
                        f"週一至週五 10:00-20:00；週六 12:00-18:00；週日公休"
                    )
                    push_message(uid, [{"type": "text", "text": msg}], token)

            # Save state
            state["last_did"] = last_did
            state["completed_dnos"] = list(completed_dnos)
            state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            last_mtime = current_mtime

        except Exception as loop_exc:
            print(f"[Monitor Loop Exception] {loop_exc}", file=sys.stderr)
            time.sleep(5)


if __name__ == "__main__":
    shop_dir = Path(__file__).resolve().parent.parent
    run_monitor(shop_dir)
