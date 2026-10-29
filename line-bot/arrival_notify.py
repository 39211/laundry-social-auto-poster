# -*- coding: utf-8 -*-
"""到件主動通知。路徑只從 laundry_lookup.REPO 長出來；預設不發送。"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import laundry_lookup
import staff_notify

TAIPEI = timezone(timedelta(hours=8))
DISCLAIMER = "金額依洗衣系統單據，最後以門市實際結帳為準。"
_UID_RE = re.compile(r"^U[0-9a-f]{32}$")
_DEFAULTS = {
    "poll_seconds": 300,
    "max_new_per_cycle": 80,
    "settle_minutes": 10,
    "min_interval_minutes": 60,
    "send_window": "09:00-21:00",
    "quota_reserve": 50,
}
_LOCK_FD = None
# 測試把這個換成假推送器。正式路徑才會打到 LINE。
push_opener = urllib.request.urlopen


def _default_mode() -> str:
    return "off"


def _data_dir() -> Path:
    return Path(laundry_lookup.REPO) / "data"


def config_path() -> Path:
    return _data_dir() / "arrival-notify.json"


def state_path() -> Path:
    return _data_dir() / "arrival-state.json"


def outbox_path() -> Path:
    return _data_dir() / "arrival-outbox.jsonl"


def lock_path() -> Path:
    return _data_dir() / "arrival-notify.lock"


def log_path() -> Path:
    return _data_dir() / "arrival-notify.log"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_taipei(moment: datetime) -> datetime:
    if moment.tzinfo is None or moment.tzinfo.utcoffset(moment) is None:
        raise ValueError("naive datetime refused")
    return moment.astimezone(TAIPEI)


def _iso(moment: datetime) -> str:
    return _to_taipei(moment).isoformat(timespec="seconds")


def _parse_iso(text: str) -> datetime:
    moment = datetime.fromisoformat(str(text))
    if moment.tzinfo is None or moment.tzinfo.utcoffset(moment) is None:
        raise ValueError("naive datetime refused")
    return moment.astimezone(TAIPEI)


def _s(value) -> str:
    return str(value or "").strip()


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _window_bounds(window: str) -> tuple[int, int]:
    start_s, end_s = str(window).split("-", 1)
    sh, sm = start_s.split(":")
    eh, em = end_s.split(":")
    return int(sh) * 60 + int(sm), int(eh) * 60 + int(em)


def _valid_window(window: str) -> bool:
    try:
        start_m, end_m = _window_bounds(window)
    except (ValueError, AttributeError):
        return False
    return 0 <= start_m < end_m <= 24 * 60


def load_config(mode_override: str | None = None) -> dict:
    cfg = dict(_DEFAULTS)
    cfg["mode"] = _default_mode()
    path = config_path()
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = None
        if isinstance(raw, dict):
            mode = raw.get("mode")
            if mode in ("off", "dry_run", "on"):
                cfg["mode"] = mode
            else:
                cfg["mode"] = _default_mode()
            for key in (
                "poll_seconds",
                "max_new_per_cycle",
                "settle_minutes",
                "min_interval_minutes",
                "quota_reserve",
            ):
                if key in raw:
                    try:
                        cfg[key] = int(raw[key])
                    except (TypeError, ValueError):
                        pass
            window = raw.get("send_window")
            if isinstance(window, str) and _valid_window(window):
                cfg["send_window"] = window
    if mode_override in ("off", "dry_run", "on"):
        cfg["mode"] = mode_override
    return cfg


def _poll_seconds() -> int:
    try:
        return max(1, int(load_config()["poll_seconds"]))
    except (TypeError, ValueError):
        return 300


@dataclass
class Snapshot:
    customers: list
    garments: list
    source: str
    data_as_of: str = ""
    stale: bool = False


def load_shop_snapshot() -> Snapshot:
    snap = laundry_lookup.inventory_snapshot()
    return Snapshot(list(snap.customers or []), list(snap.garments or []), str(snap.source or ""),
                    data_as_of=snap.data_as_of, stale=snap.stale)


def _empty_snapshot_untrusted(n_customers: int, n_pieces: int) -> bool:
    return n_customers == 0 or n_pieces == 0


def _known_keys(customers: list) -> set[str]:
    keys = set()
    for row in customers:
        no = _s(row.get("no"))
        if not no or no.startswith("@@@"):
            continue
        key = laundry_lookup._cid_key(no)
        if key and key != "0":
            keys.add(key)
    return keys


def _same_customer(left, right) -> bool:
    return laundry_lookup._cid_key(_s(left)) == laundry_lookup._cid_key(_s(right))


def _loc_present(loc: str) -> bool:
    return bool(str(loc or "").strip())


def _unpicked(dater: str) -> bool:
    return not str(dater or "").strip()


def _owner_known(cid: str, known_keys: set[str]) -> bool:
    text = str(cid or "").strip()
    if text.startswith("@@@"):
        return False
    key = laundry_lookup._cid_key(text)
    return bool(key) and key != "0" and key in known_keys


def _classify(garment: dict, known_keys: set[str]) -> str:
    if not _s(garment.get("datei")):
        return "not_ready"
    if not _loc_present(_s(garment.get("loc"))):
        return "not_ready"
    if not _unpicked(_s(garment.get("dater"))):
        return "not_ready"
    if not _owner_known(_s(garment.get("customer_no")), known_keys):
        return "owner_unknown"
    return "ready"


def _still_listable(garment: dict, known_keys: set[str]) -> bool:
    return _classify(garment, known_keys) == "ready"


def _is_picked(garment: dict) -> bool:
    return not _unpicked(_s(garment.get("dater")))


def _is_unbaselined(state) -> bool:
    return state is None


def _anomaly_tripped(new_count: int, limit: int) -> bool:
    return new_count > limit


def _anomaly_active(state: dict) -> bool:
    anomaly = state.get("anomaly") or {}
    return bool(isinstance(anomaly, dict) and anomaly.get("active"))


def _empty_state() -> dict:
    return {
        "baselined": True,
        "seen": [],
        "anomaly": None,
        "pending": {},
        "deliveries": {},
        "last_sent": {},
    }


def _baseline_state(ready: list, now: datetime) -> dict:
    state = _empty_state()
    state["seen"] = sorted({_s(g.get("donly")) for g in ready if _s(g.get("donly"))})
    state["baselined"] = True
    return state


def _load_state():
    path = state_path()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"_corrupt": True}
    if not isinstance(data, dict) or not data.get("baselined"):
        return {"_corrupt": True}
    data.setdefault("seen", [])
    data.setdefault("pending", {})
    data.setdefault("deliveries", {})
    data.setdefault("last_sent", {})
    data.setdefault("anomaly", None)
    return data


def _save_state(state: dict) -> None:
    payload = {k: v for k, v in state.items() if not str(k).startswith("_")}
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    _atomic_write(state_path(), text)


def _hold_after_read_exception(prior_state) -> dict:
    return {
        "code": "READ_FAIL_HOLD",
        "http": 0,
        "cursor": "unchanged",
        "ehank_reads": 1,
    }


def _append_outbox(obj: dict) -> None:
    path = outbox_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, ensure_ascii=False, sort_keys=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _outbox_rows() -> list[dict]:
    path = outbox_path()
    rows = []
    if not path.is_file():
        return rows
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _outbox_keys() -> set[str]:
    return {str(row.get("event_key")) for row in _outbox_rows() if row.get("event_key")}


def _event_already_recorded(keys: set[str], key: str) -> bool:
    return key in keys


def _outbox_time(key: str) -> str:
    for row in _outbox_rows():
        if str(row.get("event_key") or "") == key and row.get("at"):
            return str(row["at"])
    return ""


def _inside_window(now_taipei: datetime, window: str) -> bool:
    start_m, end_m = _window_bounds(window)
    minute = now_taipei.hour * 60 + now_taipei.minute
    return start_m <= minute < end_m


def _method_ok(method: str) -> bool:
    return str(method or "") == "phone"


def _uid_ok(uid: str) -> bool:
    return bool(_UID_RE.fullmatch(str(uid or "")))


def _read_bind_records():
    """綁定檔要分得出讀不懂與沒人綁。不改 _load_json 的既有回傳。"""
    path = laundry_lookup.BIND
    if not path.exists():
        return {}, "ok"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError, ValueError):
        return None, "unreadable"
    if not isinstance(data, dict):
        return None, "unreadable"
    return data, "ok"


def _recipients(customer_no: str, records=None) -> list[str]:
    want = laundry_lookup._cid_key(_s(customer_no))
    found = []
    data = laundry_lookup._load_json(laundry_lookup.BIND) if records is None else records
    for uid, row in data.items():
        if not isinstance(row, dict):
            continue
        method = row.get("method") or "unknown"
        if not _method_ok(method):
            continue
        if not _uid_ok(str(uid)):
            continue
        if laundry_lookup._cid_key(_s(row.get("customer_no"))) != want:
            continue
        found.append(str(uid))
    return found


def _customer_balance(customers: list, customer_no: str):
    for row in customers:
        if _same_customer(row.get("no"), customer_no):
            return laundry_lookup._money(row.get("balance"), signed=True)
    return None


def _compose(customer_no: str, garments: list, customers: list, known_keys: set[str]) -> tuple[str, int]:
    mine = [g for g in garments if _same_customer(g.get("customer_no"), customer_no)]
    ready = [g for g in mine if _still_listable(g, known_keys)]
    ready.sort(key=lambda g: (_s(g.get("wash_no")), _s(g.get("donly"))))
    ready_ids = {_s(g.get("donly")) for g in ready}
    waiting = []
    for garment in mine:
        if _s(garment.get("donly")) in ready_ids or _is_picked(garment):
            continue
        if _classify(garment, known_keys) == "owner_unknown":
            continue
        waiting.append(garment)
    lines = ["可以來取了："]
    shown = ready[:20]
    for garment in shown:
        price = garment.get("price")
        if isinstance(price, bool) or not isinstance(price, int):
            price = None
        piece = laundry_lookup.Piece(
            wash_no=_s(garment.get("wash_no")),
            name=_s(garment.get("name")) or "衣物",
            status="stock",
            customer_no="",
            price=price,
        )
        lines.append(laundry_lookup._piece_copy(piece))
    if len(ready) > 20:
        lines.append(f"共 {len(ready)} 件可取，這裡先列 20 件。")
    prices = []
    priced = True
    for garment in ready:
        price = garment.get("price")
        if isinstance(price, bool) or not isinstance(price, int):
            priced = False
            break
        prices.append(price)
    if ready and priced:
        lines.append(f"品項合計：{sum(prices):,} 元。")
    if waiting:
        lines.append(f"還有 {len(waiting)} 件在處理中。")
    balance_line = laundry_lookup._balance_copy(_customer_balance(customers, customer_no))
    if balance_line:
        lines.append(balance_line)
    lines.append(DISCLAIMER)
    return "\n".join(lines), len(shown)


def _quota_left_value():
    try:
        _limit, _used, left = staff_notify.quota_left()
    except Exception:
        return None
    return left


def _quota_allows(left, reserve) -> bool:
    if left is None:
        return False
    return int(left) >= int(reserve)


def _token_ok() -> bool:
    try:
        return bool(staff_notify._token())
    except Exception:
        return False


def _retry_key(existing: str) -> str:
    if existing:
        return existing
    return str(uuid.uuid4())


def _retry_expired(age_seconds: float) -> bool:
    return age_seconds >= 24 * 3600


def _push_message(uid: str, text: str, retry_key: str) -> str:
    try:
        token = staff_notify._token()
    except Exception:
        return "no_token"
    if not token:
        return "no_token"
    body = json.dumps(
        {"to": uid, "messages": [{"type": "text", "text": text}]},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/push",
        data=body,
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("X-Line-Retry-Key", retry_key)
    try:
        with push_opener(req, timeout=10) as resp:
            resp.read()
            code = int(getattr(resp, "status", None) or getattr(resp, "code", 200) or 200)
    except urllib.error.HTTPError as exc:
        header_id = ""
        if exc.headers is not None:
            header_id = exc.headers.get("x-line-accepted-request-id") or ""
        if int(exc.code) == 409 and header_id:
            return "accepted"
        if int(exc.code) == 429:
            return "uncertain"
        if 400 <= int(exc.code) < 500:
            return "rejected"
        return "uncertain"
    except Exception:
        return "uncertain"
    if 200 <= code < 300:
        return "accepted"
    if code == 429:
        return "uncertain"
    if 400 <= code < 500:
        return "rejected"
    return "uncertain"


def _set_piece_status(state: dict, donly: str, status: str) -> None:
    """件一旦 accepted，之後的拒絕、到期、作廢都不得把它降級。"""
    row = (state.get("pending") or {}).get(donly)
    if not isinstance(row, dict):
        return
    if row.get("status") == "accepted" and status != "accepted":
        return
    row["status"] = status


def _mark_pieces(state: dict, delivery: dict, status: str) -> None:
    for donly in delivery.get("donlies") or []:
        _set_piece_status(state, donly, status)


def _split_listed(delivery: dict, snap: Snapshot, known: set[str]) -> tuple[list, list]:
    """原推播列出的件，分成本輪仍可取與已經不可取。"""
    by_id = {}
    for garment in snap.garments:
        key = _s(garment.get("donly"))
        if key and key not in by_id:
            by_id[key] = garment
    still, gone = [], []
    for raw in delivery.get("donlies") or []:
        key = _s(raw)
        if not key:
            continue
        garment = by_id.get(key)
        if garment is not None and _still_listable(garment, known):
            still.append(key)
        else:
            gone.append(key)
    return still, gone


def _retry_content_outcome(listed_count: int, still_count: int, stored_text: str, fresh_text: str) -> str:
    """重送前先看本輪快照：全部不可取、文字變了，或逐字相同。"""
    if listed_count > 0 and still_count == 0:
        return "all_gone"
    if stored_text != fresh_text:
        return "changed"
    return "same"


def _remember_delivery(state: dict, delivery: dict) -> None:
    state.setdefault("deliveries", {})[delivery["id"]] = delivery
    _save_state(state)


def _supersede_all_gone(state: dict, delivery: dict, gone: list) -> None:
    delivery["status"] = "superseded"
    for donly in gone:
        _set_piece_status(state, donly, "suppressed")
    _remember_delivery(state, delivery)


def _requeue_listable_pieces(state: dict, donlies: list, now: datetime) -> None:
    """仍可取、且還沒被接受的件放回待送，保留原來的 first_seen。"""
    for donly in donlies:
        row = (state.get("pending") or {}).get(donly)
        if not isinstance(row, dict):
            continue
        if row.get("status") == "accepted":
            continue
        row["status"] = "pending"
        row["first_seen"] = row.get("first_seen") or ""


def _supersede_because_content_changed(state: dict, delivery: dict, still: list, gone: list, now: datetime) -> None:
    delivery["status"] = "superseded"
    _requeue_listable_pieces(state, still, now)
    for donly in gone:
        _set_piece_status(state, donly, "suppressed")
    _remember_delivery(state, delivery)


def _absorb_new_pieces(delivery: dict, pending_ids, content_changed: bool) -> bool:
    """內容變了就作廢這則，不把新件併進舊 donlies。回傳 True 表示應作廢。"""
    if content_changed:
        return True
    delivery["donlies"] = _donlies_for_open_delivery(delivery, pending_ids)
    return False


def _aggregate_recipient_outcomes(outcomes: list[str]) -> str:
    """多個帳號時，只要有一個接受，件就是 accepted。"""
    if any(item == "accepted" for item in outcomes):
        return "accepted"
    if any(item == "uncertain" for item in outcomes):
        return "inflight"
    return "rejected"


def _delivery_slot(state: dict, cid_key: str, uid: str) -> str:
    """已 superseded 的紀錄留在原位，新的一則用別的 id，避免蓋掉舊鍵。"""
    base = cid_key + ":" + uid
    current = (state.get("deliveries") or {}).get(base)
    if isinstance(current, dict) and current.get("status") == "superseded":
        seq = 2
        while f"{base}:{seq}" in (state.get("deliveries") or {}):
            seq += 1
        return f"{base}:{seq}"
    return base


def _key_for_new_delivery(state, customer_no) -> str:
    """新的一則用新鍵，而且不得挑到這位客人已經 superseded 的鍵。"""
    banned = set()
    want = laundry_lookup._cid_key(_s(customer_no))
    for row in (state.get("deliveries") or {}).values():
        if not isinstance(row, dict) or row.get("status") != "superseded":
            continue
        if laundry_lookup._cid_key(_s(row.get("customer_no"))) != want:
            continue
        if row.get("retry_key"):
            banned.add(str(row["retry_key"]))
    while True:
        key = str(uuid.uuid4())
        if key not in banned:
            return key


def _ensure_pending(state: dict, key: str, garment: dict, status: str, now: datetime) -> None:
    pending = state.setdefault("pending", {})
    if key in pending:
        return
    pending[key] = {
        "donly": key,
        "customer_no": _s(garment.get("customer_no")),
        "first_seen": _outbox_time(key) or _iso(now),
        "status": status,
    }


def _binding_still_matches(uid: str, customer_no: str, records: dict) -> bool:
    row = records.get(str(uid))
    if not isinstance(row, dict):
        return False
    if not _method_ok(str(row.get("method") or "")):
        return False
    if not _uid_ok(str(uid)):
        return False
    return laundry_lookup._cid_key(_s(row.get("customer_no"))) == laundry_lookup._cid_key(_s(customer_no))


def _donlies_for_open_delivery(delivery: dict, pending_ids) -> list:
    """未結推播只保留原來那一則裡的件，不把後來才好的件併進去。"""
    return list(delivery.get("donlies") or [])


def _pending_ids_for(state: dict, customer_no: str) -> list:
    want = laundry_lookup._cid_key(_s(customer_no))
    found = []
    for row in (state.get("pending") or {}).values():
        if not isinstance(row, dict) or row.get("status") != "pending":
            continue
        if laundry_lookup._cid_key(_s(row.get("customer_no"))) == want and _s(row.get("donly")):
            found.append(_s(row.get("donly")))
    return found


def _customer_blocked_by_open(state: dict, customer_no: str) -> bool:
    want = laundry_lookup._cid_key(_s(customer_no))
    for row in (state.get("deliveries") or {}).values():
        if not isinstance(row, dict) or row.get("status") not in ("inflight", "uncertain"):
            continue
        if laundry_lookup._cid_key(_s(row.get("customer_no"))) == want:
            return True
    return False


def _retry_deliveries(state: dict, now: datetime, cfg: dict, snap: Snapshot, known: set[str]) -> dict | None:
    deliveries = [
        row
        for row in (state.get("deliveries") or {}).values()
        if isinstance(row, dict) and row.get("status") in ("inflight", "uncertain")
    ]
    if not deliveries:
        return None
    records, bind_kind = _read_bind_records()
    http = 0
    codes = []
    reused_same = False
    still_open = []
    for delivery in deliveries:
        first = delivery.get("first_attempt") or ""
        age = (now - _parse_iso(first)).total_seconds() if first else 0
        if first and _retry_expired(age):
            delivery["status"] = "uncertain_expired"
            _mark_pieces(state, delivery, "uncertain_expired")
            state["deliveries"][delivery["id"]] = delivery
            _save_state(state)
            codes.append("UNCERTAIN_EXPIRED")
            continue
        if bind_kind == "unreadable" or not isinstance(records, dict):
            codes.append("BIND_UNREADABLE")
            continue
        if not _binding_still_matches(str(delivery.get("uid") or ""), str(delivery.get("customer_no") or ""), records):
            delivery["status"] = "binding_changed"
            _mark_pieces(state, delivery, "binding_changed")
            state["deliveries"][delivery["id"]] = delivery
            _save_state(state)
            codes.append("BINDING_CHANGED")
            continue
        still, gone = _split_listed(delivery, snap, known)
        fresh_text, _shown = _compose(
            str(delivery.get("customer_no") or ""),
            snap.garments,
            snap.customers,
            known,
        )
        outcome = _retry_content_outcome(
            len(still) + len(gone),
            len(still),
            str(delivery.get("text") or ""),
            fresh_text,
        )
        if outcome == "all_gone":
            _supersede_all_gone(state, delivery, gone)
            codes.append("SUPERSEDED")
            continue
        pending_ids = _pending_ids_for(state, delivery.get("customer_no") or "")
        if outcome == "changed":
            if _absorb_new_pieces(delivery, pending_ids, True):
                _supersede_because_content_changed(state, delivery, still, gone, now)
                codes.append("SUPERSEDED")
                continue
            still_open.append(delivery)
            continue
        if _absorb_new_pieces(delivery, pending_ids, False):
            _supersede_because_content_changed(state, delivery, still, gone, now)
            codes.append("SUPERSEDED")
            continue
        still_open.append(delivery)
    for delivery in still_open:
        if not _inside_window(now, cfg["send_window"]):
            codes.append("WINDOW_HOLD")
            continue
        if cfg["mode"] != "on":
            codes.append("DRY_RUN" if cfg["mode"] == "dry_run" else "MODE_OFF")
            continue
        if not _quota_allows(_quota_left_value(), cfg["quota_reserve"]):
            codes.append("QUOTA_HOLD")
            continue
        if not _token_ok():
            codes.append("TOKEN_HOLD")
            continue
        pending_ids = _pending_ids_for(state, delivery.get("customer_no") or "")
        delivery["donlies"] = _donlies_for_open_delivery(delivery, pending_ids)
        previous = str(delivery.get("retry_key") or "")
        delivery["retry_key"] = _retry_key(previous)
        if previous and delivery["retry_key"] == previous:
            reused_same = True
        delivery["attempts"] = int(delivery.get("attempts") or 0) + 1
        state["deliveries"][delivery["id"]] = delivery
        _save_state(state)
        outcome = _push_message(delivery.get("uid") or "", delivery.get("text") or "", delivery["retry_key"])
        http += 1
        if outcome == "accepted":
            delivery["status"] = "accepted"
            _mark_pieces(state, delivery, "accepted")
            cid_key = laundry_lookup._cid_key(_s(delivery.get("customer_no")))
            state.setdefault("last_sent", {})[cid_key] = _iso(now)
            codes.append("ACCEPTED")
        elif outcome == "rejected":
            delivery["status"] = "rejected"
            _mark_pieces(state, delivery, "rejected")
            codes.append("REJECTED")
        else:
            delivery["status"] = "uncertain"
            codes.append("UNCERTAIN")
        state["deliveries"][delivery["id"]] = delivery
        _save_state(state)
    if not codes:
        return None
    result = {"code": codes[0], "http": http, "cursor": "unchanged"}
    if reused_same and result["code"] == "UNCERTAIN":
        result["retry_key"] = "same_on_retry"
    if result["code"] == "REJECTED":
        result["retries"] = 0
    return result


def _dispatch_customer(state, snap: Snapshot, cfg: dict, now: datetime, known: set[str], rows: list, records=None) -> dict:
    customer_no = rows[0].get("customer_no") or ""
    pending_ids = {_s(row.get("donly")) for row in rows}
    listable = [g for g in snap.garments if _same_customer(g.get("customer_no"), customer_no) and _still_listable(g, known)]
    still = [g for g in listable if _s(g.get("donly")) in pending_ids]
    if not still:
        for row in rows:
            state["pending"][_s(row.get("donly"))]["status"] = "suppressed"
        _save_state(state)
        return {"code": "SUPPRESSED", "http": 0}
    if _customer_blocked_by_open(state, customer_no):
        return {"code": "OPEN_DELIVERY_HOLD", "http": 0}
    newest = max(_parse_iso(row["first_seen"]) for row in rows)
    age_min = (now - newest).total_seconds() / 60.0
    if age_min < float(cfg["settle_minutes"]):
        return {"code": "SETTLE_HOLD", "http": 0}
    cid_key = laundry_lookup._cid_key(_s(customer_no))
    last = (state.get("last_sent") or {}).get(cid_key)
    if last:
        gap = (now - _parse_iso(last)).total_seconds() / 60.0
        if gap < float(cfg["min_interval_minutes"]):
            return {"code": "INTERVAL_HOLD", "http": 0}
    if not _inside_window(now, cfg["send_window"]):
        return {"code": "WINDOW_HOLD", "http": 0}
    text, pieces_listed = _compose(customer_no, snap.garments, snap.customers, known)
    if records is None:
        records, kind = _read_bind_records()
        if kind == "unreadable":
            return {"code": "BIND_UNREADABLE", "http": 0, "pieces_listed": pieces_listed}
    recipients = _recipients(customer_no, records)
    if not recipients:
        for row in rows:
            slot = state["pending"][_s(row.get("donly"))]
            slot["status"] = "need_bind"
            slot["text"] = text
        preview_key = "need-bind:" + cid_key
        if not _event_already_recorded(_outbox_keys(), preview_key):
            _append_outbox({"event_key": preview_key, "kind": "need_bind", "text": text, "at": _iso(now)})
        _save_state(state)
        return {"code": "NEED_BIND", "http": 0, "pieces_listed": pieces_listed}
    if cfg["mode"] == "dry_run":
        preview_key = "dry-run:" + cid_key
        if not _event_already_recorded(_outbox_keys(), preview_key):
            _append_outbox(
                {
                    "event_key": preview_key,
                    "kind": "dry_run",
                    "text": text,
                    "recipient_count": len(recipients),
                    "at": _iso(now),
                }
            )
        return {"code": "DRY_RUN", "http": 0, "pieces_listed": pieces_listed}
    if not _quota_allows(_quota_left_value(), cfg["quota_reserve"]):
        return {"code": "QUOTA_HOLD", "http": 0, "pieces_listed": pieces_listed}
    if not _token_ok():
        return {"code": "TOKEN_HOLD", "http": 0, "pieces_listed": pieces_listed}
    http = 0
    outcomes = []
    for uid in recipients:
        delivery_id = _delivery_slot(state, cid_key, uid)
        delivery = {
            "id": delivery_id,
            "uid": uid,
            "customer_no": customer_no,
            "text": text,
            "retry_key": "",
            "attempts": 0,
            "first_attempt": "",
            "status": "pending",
            "donlies": sorted(pending_ids),
        }
        delivery["retry_key"] = _key_for_new_delivery(state, customer_no)
        delivery["attempts"] = int(delivery.get("attempts") or 0) + 1
        if not delivery.get("first_attempt"):
            delivery["first_attempt"] = _iso(now)
        delivery["status"] = "inflight"
        state.setdefault("deliveries", {})[delivery_id] = delivery
        _save_state(state)
        outcome = _push_message(uid, delivery["text"], delivery["retry_key"])
        http += 1
        outcomes.append(outcome)
        if outcome == "accepted":
            delivery["status"] = "accepted"
        elif outcome == "rejected":
            delivery["status"] = "rejected"
        else:
            delivery["status"] = "uncertain"
        state["deliveries"][delivery_id] = delivery
        _save_state(state)
    piece_status = _aggregate_recipient_outcomes(outcomes)
    if piece_status == "accepted":
        for donly in pending_ids:
            state["pending"][donly]["status"] = "accepted"
        state.setdefault("last_sent", {})[cid_key] = _iso(now)
        final = "ACCEPTED"
    elif piece_status == "inflight":
        for donly in pending_ids:
            state["pending"][donly]["status"] = "inflight"
        final = "UNCERTAIN"
    else:
        for donly in pending_ids:
            state["pending"][donly]["status"] = "rejected"
        final = "REJECTED"
    _save_state(state)
    result = {"code": final, "http": http, "pieces_listed": pieces_listed, "cursor": "unchanged"}
    if final == "REJECTED":
        result["retries"] = 0
    return result


def _dispatch_pending(state: dict, snap: Snapshot, cfg: dict, now: datetime, known: set[str]) -> dict | None:
    grouped: dict[str, list] = {}
    for row in (state.get("pending") or {}).values():
        if not isinstance(row, dict) or row.get("status") != "pending":
            continue
        grouped.setdefault(laundry_lookup._cid_key(_s(row.get("customer_no"))), []).append(row)
    if not grouped:
        return None
    records, kind = _read_bind_records()
    if kind == "unreadable":
        return {"code": "BIND_UNREADABLE", "http": 0, "cursor": "unchanged"}
    http = 0
    codes = []
    pieces_listed = 0
    extra = {}
    for rows in grouped.values():
        if _customer_blocked_by_open(state, rows[0].get("customer_no") or ""):
            continue
        decision = _dispatch_customer(state, snap, cfg, now, known, rows, records)
        codes.append(decision["code"])
        http += int(decision.get("http") or 0)
        pieces_listed = int(decision.get("pieces_listed") or pieces_listed)
        if decision.get("retries") is not None:
            extra["retries"] = decision["retries"]
        if decision.get("retry_key"):
            extra["retry_key"] = decision["retry_key"]
    if not codes:
        return None
    result = {"code": codes[0], "http": http, "cursor": "unchanged"}
    if pieces_listed:
        result["pieces_listed"] = pieces_listed
    result.update(extra)
    return result


def _combine_dispatch(retry, fresh):
    if fresh is None:
        return retry
    if retry is None:
        return fresh
    result = {
        "code": fresh.get("code") or retry.get("code"),
        "http": int(retry.get("http") or 0) + int(fresh.get("http") or 0),
        "cursor": "unchanged",
    }
    if fresh.get("pieces_listed"):
        result["pieces_listed"] = fresh["pieces_listed"]
    if fresh.get("retries") is not None:
        result["retries"] = fresh["retries"]
    elif retry.get("retries") is not None:
        result["retries"] = retry["retries"]
    if retry.get("retry_key"):
        result["retry_key"] = retry["retry_key"]
    if fresh.get("retry_key"):
        result["retry_key"] = fresh["retry_key"]
    return result


def _dispatch(state: dict, snap: Snapshot, cfg: dict, now: datetime, known: set[str]) -> dict | None:
    retry = _retry_deliveries(state, now, cfg, snap, known)
    fresh = _dispatch_pending(state, snap, cfg, now, known)
    return _combine_dispatch(retry, fresh)


def run_cycle(mode_override: str | None = None, clock=None) -> dict:
    moment = clock() if clock is not None else _now_utc()
    now = _to_taipei(moment)
    cfg = load_config(mode_override)
    if cfg["mode"] == "off":
        return {"code": "MODE_OFF", "http": 0, "ehank_reads": 0, "cursor": "unchanged"}
    state = _load_state()
    try:
        snap = load_shop_snapshot()
    except Exception:
        return _hold_after_read_exception(state)
    reads = 1
    if snap.stale:
        return {"code": "STALE_HOLD", "http": 0, "ehank_reads": reads, "cursor": "unchanged"}
    if isinstance(state, dict) and state.get("_corrupt"):
        return {"code": "READ_FAIL_HOLD", "http": 0, "ehank_reads": reads, "cursor": "unchanged"}
    if snap.source != laundry_lookup.EHANK_SOURCE or _empty_snapshot_untrusted(len(snap.customers), len(snap.garments)):
        return {"code": "READ_FAIL_HOLD", "http": 0, "ehank_reads": reads, "cursor": "unchanged"}
    known = _known_keys(snap.customers)
    ready = []
    unknown = []
    for garment in snap.garments:
        if not _s(garment.get("donly")):
            continue
        kind = _classify(garment, known)
        if kind == "ready":
            ready.append(garment)
        elif kind == "owner_unknown":
            unknown.append(garment)
    if _is_unbaselined(state):
        _save_state(_baseline_state(ready, now))
        return {"code": "BASELINE_ONLY", "http": 0, "ehank_reads": reads, "cursor": "advanced"}
    prior_seen = set(state.get("seen") or [])
    if _anomaly_active(state):
        return {"code": "ANOMALY_HOLD", "http": 0, "ehank_reads": reads, "cursor": "unchanged"}
    seen = set(prior_seen)
    new_ready = [g for g in ready if _s(g.get("donly")) not in seen]
    new_unknown = [g for g in unknown if _s(g.get("donly")) not in seen]
    if _anomaly_tripped(len(new_ready), int(cfg["max_new_per_cycle"])):
        state["anomaly"] = {"active": True, "at": _iso(now), "new_count": len(new_ready)}
        _save_state(state)
        return {"code": "ANOMALY_HOLD", "http": 0, "ehank_reads": reads, "cursor": "unchanged"}
    existing_keys = _outbox_keys()
    recovered = False
    appended = False
    for garment in new_ready:
        key = _s(garment.get("donly"))
        if _event_already_recorded(existing_keys, key):
            recovered = True
            _ensure_pending(state, key, garment, "pending", now)
            continue
        # 先留下事件，才推進游標。中間崩潰時靠 event_key 去重。
        _append_outbox({"event_key": key, "kind": "ready", "at": _iso(now)})
        existing_keys.add(key)
        appended = True
        state.setdefault("pending", {})[key] = {
            "donly": key,
            "customer_no": _s(garment.get("customer_no")),
            "first_seen": _iso(now),
            "status": "pending",
        }
    for garment in new_unknown:
        key = _s(garment.get("donly"))
        if _event_already_recorded(existing_keys, key):
            recovered = True
            _ensure_pending(state, key, garment, "owner_unknown", now)
            continue
        _append_outbox({"event_key": key, "kind": "owner_unknown", "at": _iso(now)})
        existing_keys.add(key)
        appended = True
        state.setdefault("pending", {})[key] = {
            "donly": key,
            "customer_no": _s(garment.get("customer_no")),
            "first_seen": _iso(now),
            "status": "owner_unknown",
        }
    if new_ready or new_unknown:
        for garment in new_ready + new_unknown:
            seen.add(_s(garment.get("donly")))
        state["seen"] = sorted(seen)
        _save_state(state)
    if recovered and not appended:
        return {
            "code": "NO_DUPLICATE",
            "http": 0,
            "ehank_reads": reads,
            "cursor": "advanced",
            "events_for_piece": 1,
        }
    outcome = _dispatch(state, snap, cfg, now, known)
    if outcome is not None:
        outcome["ehank_reads"] = reads
        if seen != prior_seen:
            outcome["cursor"] = "advanced"
        return outcome
    if new_unknown and not new_ready:
        return {"code": "OWNER_UNKNOWN", "http": 0, "ehank_reads": reads, "cursor": "advanced"}
    for garment in snap.garments:
        if _classify(garment, known) == "not_ready" and _s(garment.get("donly")) not in prior_seen:
            return {"code": "NOT_READY", "http": 0, "ehank_reads": reads, "cursor": "unchanged"}
    return {
        "code": "QUIET",
        "http": 0,
        "ehank_reads": reads,
        "cursor": "unchanged" if seen == prior_seen else "advanced",
    }


def rebaseline(clock=None) -> dict:
    moment = clock() if clock is not None else _now_utc()
    now = _to_taipei(moment)
    try:
        snap = load_shop_snapshot()
    except Exception:
        return {"code": "READ_FAIL_HOLD", "http": 0, "cursor": "unchanged"}
    if snap.stale:
        return {"code": "STALE_HOLD", "http": 0, "cursor": "unchanged"}
    if snap.source != laundry_lookup.EHANK_SOURCE or _empty_snapshot_untrusted(len(snap.customers), len(snap.garments)):
        return {"code": "READ_FAIL_HOLD", "http": 0, "cursor": "unchanged"}
    known = _known_keys(snap.customers)
    ready = [g for g in snap.garments if _classify(g, known) == "ready" and _s(g.get("donly"))]
    state = _baseline_state(ready, now)
    state["anomaly"] = None
    _save_state(state)
    return {"code": "REBASELINED", "http": 0, "cursor": "advanced"}


def status_summary() -> str:
    cfg = load_config()
    state = _load_state()
    if not isinstance(state, dict) or state.get("_corrupt"):
        baselined = "no"
        seen_n = 0
        anomaly = "no"
        pending = 0
        accepted = 0
    else:
        baselined = "yes" if state.get("baselined") else "no"
        seen_n = len(state.get("seen") or [])
        anomaly = "yes" if _anomaly_active(state) else "no"
        pending = sum(
            1
            for row in (state.get("pending") or {}).values()
            if isinstance(row, dict) and row.get("status") in ("pending", "inflight")
        )
        accepted = sum(
            1
            for row in (state.get("deliveries") or {}).values()
            if isinstance(row, dict) and row.get("status") == "accepted"
        )
    return "\n".join(
        [
            f"mode={cfg['mode']}",
            f"baselined={baselined}",
            f"seen={seen_n}",
            f"anomaly={anomaly}",
            f"pending={pending}",
            f"accepted={accepted}",
        ]
    )


def _log_cycle_error(exc: BaseException) -> None:
    path = log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps({"code": "CYCLE_ERROR", "error_type": type(exc).__name__}, ensure_ascii=False)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def run_supervised(cycles=None, cycle_fn=None, sleeper=None) -> int:
    step = sleeper or time.sleep
    fn = cycle_fn or run_cycle
    done = 0
    while cycles is None or done < cycles:
        try:
            fn()
        except Exception as exc:
            _log_cycle_error(exc)
        done += 1
        if cycles is not None and done >= cycles:
            break
        step(_poll_seconds())
    return done


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, 0, int(pid))
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _lock_is_stale(path: Path) -> bool:
    try:
        pid = int(path.read_text(encoding="ascii").strip() or "0")
    except (OSError, ValueError):
        return True
    return not _pid_alive(pid)


def _acquire_lock() -> bool:
    global _LOCK_FD
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    for _attempt in range(2):
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
        except FileExistsError:
            if not _lock_is_stale(path):
                return False
            try:
                path.unlink()
            except OSError:
                return False
            continue
        os.write(fd, str(os.getpid()).encode("ascii"))
        _LOCK_FD = fd
        return True
    return False


def _release_lock() -> None:
    global _LOCK_FD
    if _LOCK_FD is not None:
        try:
            os.close(_LOCK_FD)
        except OSError:
            pass
        _LOCK_FD = None
    try:
        lock_path().unlink()
    except OSError:
        pass


def _poller_main() -> None:
    if not _acquire_lock():
        return
    try:
        run_supervised()
    finally:
        _release_lock()


def start_poller() -> threading.Thread:
    thread = threading.Thread(target=_poller_main, name="arrival-notify", daemon=True)
    thread.start()
    return thread


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--status" in args:
        print(status_summary())
        return 0
    if "--rebaseline" in args:
        print(rebaseline().get("code", ""))
        return 0
    if "--once" in args:
        mode = None
        if "--mode" in args:
            index = args.index("--mode")
            if index + 1 < len(args):
                mode = args[index + 1]
        result = run_cycle(mode_override=mode)
        public = {
            key: result.get(key)
            for key in ("code", "http", "ehank_reads", "cursor")
            if key in result
        }
        print(json.dumps(public, ensure_ascii=False))
        return 0
    print("usage: python arrival_notify.py --once [--mode dry_run|on] | --status | --rebaseline")
    return 2


if __name__ == "__main__":
    sys.exit(main())
