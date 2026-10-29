# -*- coding: utf-8 -*-
"""新預約／未答題：寫入看板、本機發出聲音。員工開 http://127.0.0.1:8791/staff"""
from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
import threading
import urllib.request
import urllib.error
import uuid
from datetime import datetime
from pathlib import Path

REPO = Path(os.environ.get("LAUNDRY_REPO_ROOT", r"C:/Users/cyc39/laundry-repo"))
SECRETS = REPO / "secrets/line-channel.json"
INBOX = REPO / "data" / "staff-inbox.jsonl"
BOOK = REPO / "data" / "line-bookings.jsonl"
TARGET = REPO / "data" / "staff-target.json"
_IO_LOCK = threading.RLock()

# Handoff is deliberately append-only, just like the existing status events.
# The customer-facing bot must stop before it can create a second answer, and
# the state must survive a webhook reload.  A staff action is the only way back
# to BOT_ACTIVE; there is no time-based auto-resume.
HANDOFF_STATES = {"BOT_ACTIVE", "HANDOFF_PENDING", "HUMAN_ACTIVE"}
_HANDOFF_ACTIVE = {"HANDOFF_PENDING", "HUMAN_ACTIVE"}
_AUTO_HANDOFF_KINDS = {"photo_need", "human"}


def _iter_handoff_rows_unlocked():
    if not INBOX.exists():
        return
    for raw in INBOX.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            yield row


def _latest_handoff_unlocked(uid: str = "", case_id: str = "") -> dict | None:
    latest = None
    for row in _iter_handoff_rows_unlocked() or ():
        if row.get("kind") != "handoff":
            continue
        if uid and row.get("uid") != uid:
            continue
        if case_id and row.get("case_id") != case_id:
            continue
        latest = row
    return latest


def handoff_state(uid: str, case_id: str = "") -> dict:
    """Return the latest handoff record; old sessions default to BOT_ACTIVE."""
    if not uid:
        return {"state": "BOT_ACTIVE", "uid": uid, "case_id": case_id}
    with _IO_LOCK:
        row = _latest_handoff_unlocked(uid, case_id)
        if row is None and case_id:
            row = _latest_handoff_unlocked(uid)
        if row is None:
            return {"state": "BOT_ACTIVE", "uid": uid, "case_id": case_id}
        return dict(row)


def handoff_active(uid: str) -> bool:
    return handoff_state(uid).get("state") in _HANDOFF_ACTIVE


def handoff_event_seen(uid: str, event_id: str) -> bool:
    """Redelivery guard for events captured while a human owned the case."""
    if not uid or not event_id:
        return False
    wanted = "handoff:" + event_id
    with _IO_LOCK:
        return any(
            row.get("kind") == "human_message"
            and row.get("uid") == uid
            and row.get("event_id") == wanted
            for row in (_iter_handoff_rows_unlocked() or ())
        )


def _append_handoff_unlocked(
    uid: str,
    case_id: str,
    state: str,
    *,
    reason: str = "",
    actor: str = "",
) -> dict:
    if state not in HANDOFF_STATES or not uid:
        return {}
    event = {
        "kind": "handoff",
        "uid": uid,
        "case_id": case_id or "",
        "state": state,
        "reason": str(reason or "")[:240],
        "actor": str(actor or "")[:80],
        "ts": datetime.now().isoformat(timespec="seconds"),
    }
    INBOX.parent.mkdir(parents=True, exist_ok=True)
    with INBOX.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def _begin_handoff_unlocked(row: dict) -> dict | None:
    uid = str(row.get("uid") or "")
    if not uid:
        return None
    current = _latest_handoff_unlocked(uid)
    if current and current.get("state") in _HANDOFF_ACTIVE:
        return current
    return _append_handoff_unlocked(
        uid,
        str(row.get("case_id") or row.get("id") or ""),
        "HANDOFF_PENDING",
        reason=row.get("reason") or row.get("text") or row.get("need") or row.get("kind"),
        actor="bot",
    )


def _resolve_handoff_identifier_unlocked(identifier: str) -> tuple[str, str]:
    ident = str(identifier or "")
    if not ident:
        return "", ""
    for row in reversed(list(_iter_handoff_rows_unlocked() or ())):
        if not row.get("uid"):
            continue
        if row.get("id") == ident or row.get("case_id") == ident:
            return str(row.get("uid") or ""), str(row.get("case_id") or row.get("id") or ident)
    return "", ""


def claim_handoff(identifier: str, actor: str = "staff") -> bool:
    with _IO_LOCK:
        uid, case_id = _resolve_handoff_identifier_unlocked(identifier)
        if not uid:
            return False
        _append_handoff_unlocked(uid, case_id, "HUMAN_ACTIVE", reason="店員接手", actor=actor)
        return True


def release_handoff(identifier: str, actor: str = "staff") -> bool:
    with _IO_LOCK:
        uid, case_id = _resolve_handoff_identifier_unlocked(identifier)
        if not uid:
            return False
        _append_handoff_unlocked(uid, case_id, "BOT_ACTIVE", reason="店員解除接手／案件處理完成", actor=actor)
        return True


def record_handoff_message(
    uid: str,
    case_id: str,
    event_id: str,
    event_type: str,
    *,
    text: str = "",
    photo: str = "",
    address: str = "",
    data: str = "",
) -> dict:
    """Save customer activity while human-owned without sending another alert."""
    stable_event = "handoff:" + (event_id or uuid.uuid4().hex)
    row = {
        "id": case_id or "H" + uuid.uuid4().hex[:10],
        "case_id": case_id or "",
        "event_id": stable_event,
        "uid": uid,
        "name": "客人",
        "when": datetime.now().isoformat(timespec="minutes"),
        "text": text or "",
        "event_type": event_type or "message",
        "handoff_state": handoff_state(uid, case_id).get("state", "BOT_ACTIVE"),
    }
    if photo:
        row["photo"] = photo
        row["photos"] = [photo]
    if address:
        row["address"] = address
    if data:
        row["data"] = str(data)[:500]
    return push_inbox("human_message", row, notify=False)


def _token() -> str:
    return json.loads(SECRETS.read_text(encoding="utf-8")).get("line_channel_token", "")


def guest_name(uid: str) -> str:
    if not uid or uid == "?":
        return "客人"
    try:
        req = urllib.request.Request(f"https://api.line.me/v2/bot/profile/{uid}")
        req.add_header("Authorization", "Bearer " + _token())
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read()).get("displayName") or "客人"
    except Exception:
        return "客人"


def _append_group_notified(event_id: str, kind: str) -> None:
    """群組真的送到之後才留下紀錄，重送才知道不用再推。"""
    if not event_id:
        return
    rec = {"kind": "group_notified", "event_id": event_id, "ref_kind": kind}
    with _IO_LOCK:
        with INBOX.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def push_inbox(kind: str, payload: dict, *, notify: bool = True) -> dict:
    INBOX.parent.mkdir(parents=True, exist_ok=True)
    row = {"kind": kind, **payload, "status": "new"}
    row.setdefault("event_id", str(uuid.uuid4()))
    duplicate = False
    already_notified = False
    handoff = None
    with _IO_LOCK:
        notified_ids = set()
        if INBOX.exists():
            for raw in INBOX.read_text(encoding="utf-8").splitlines():
                try:
                    prior = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(prior, dict):
                    continue
                if prior.get("kind") == "group_notified" and prior.get("event_id"):
                    notified_ids.add(prior["event_id"])
                    continue
                if prior.get("event_id") == row["event_id"] and prior.get("kind") == kind:
                    duplicate = True
        if duplicate:
            already_notified = row["event_id"] in notified_ids
        else:
            with INBOX.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            if kind in _AUTO_HANDOFF_KINDS or row.get("handoff"):
                handoff = _begin_handoff_unlocked(row)
    if duplicate:
        # 這次事件已經送到：不要再推。還沒送到：沿用同一列補推一次。
        if already_notified or not notify:
            return {"saved": True, "notified": True if already_notified else False, "duplicate": True}
        ok = bool(push_group(row))
        if ok:
            _append_group_notified(row["event_id"], kind)
        return {"saved": True, "notified": ok, "duplicate": True}
    if notify:
        _beep()
    notified = bool(push_group(row)) if notify else False
    if notified:
        _append_group_notified(row["event_id"], kind)
    result = {"saved": True, "notified": notified}
    if handoff:
        result["handoff_state"] = handoff.get("state")
        result["case_id"] = handoff.get("case_id")
    return result


def _beep() -> None:
    # 店裡電腦發出系統音，不依賴瀏覽器有沒有開
    try:
        subprocess.Popen(
            [
                "powershell.exe",
                "-NoProfile",
                "-Command",
                "[console]::Beep(880,400); [console]::Beep(1175,400)",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def list_inbox() -> list[dict]:
    if not INBOX.exists():
        return []
    cards = []
    status_by_id = {}
    case_positions = {}
    for line in INBOX.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        if row.get("kind") in {"delivery_payload", "group_notified"}:
            continue
        # G12: status and handoff events are append-only control records, not cards.
        if row.get("kind") in {"status", "handoff"}:
            if row.get("kind") == "status":
                bid = row.get("id")
                if bid:
                    status_by_id[bid] = row.get("status")
            continue
        cid = row.get("case_id")
        if cid:
            status_by_id.pop(cid, None)
        if cid and cid in case_positions:
            index = case_positions[cid]
            previous = cards.pop(index)
            merged = {**previous, **row}
            merged["message_count"] = int(previous.get("message_count") or 1) + int(row.get("message_count") or 1)
            case_positions = {key: pos - (pos > index) for key, pos in case_positions.items()}
            case_positions[cid] = len(cards)
            cards.append(merged)
        else:
            if cid:
                case_positions[cid] = len(cards)
            cards.append(row)
    pending_ids = {r.get("id") for r in _load_undelivered() if r.get("kind") != "user"}
    for row in cards:
        bid = row.get("id")
        if bid in status_by_id:
            row["status"] = status_by_id[bid]
        row["notification_pending"] = bid in pending_ids
        state = handoff_state(str(row.get("uid") or ""), str(row.get("case_id") or bid or ""))
        row["handoff_state"] = state.get("state", "BOT_ACTIVE")
        row["message_count"] = int(row.get("message_count") or 1)
    cards.reverse()
    return cards[:80]


def bind_group(group_id: str) -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps({"groupId": group_id}, ensure_ascii=False), encoding="utf-8")


def group_id() -> str:
    if not TARGET.exists():
        return ""
    try:
        return json.loads(TARGET.read_text(encoding="utf-8")).get("groupId") or ""
    except json.JSONDecodeError:
        return ""


_PHONE_RE = re.compile(r"09\d{8}")
_QUOTA_URL = "https://api.line.me/v2/bot/message/quota"
_QUOTA_USED_URL = "https://api.line.me/v2/bot/message/quota/consumption"
_QUOTA_WARN_LEFT = 30


def _data_dir() -> Path:
    return INBOX.parent


def _undelivered_path() -> Path:
    return _data_dir() / "undelivered.jsonl"


def _quota_warned_path() -> Path:
    return _data_dir() / "quota-warned.json"


def _exc_label(exc: BaseException) -> str:
    name = type(exc).__name__
    code = getattr(exc, "code", None)
    if code is None:
        return name
    return f"{name} {code}"


def _safe_notice_text(text: str) -> str:
    first = ((text or "").split("\n", 1)[0] or "").strip()[:80]
    return _PHONE_RE.sub("", first)


def _load_undelivered() -> list[dict]:
    path = _undelivered_path()
    if not path.exists():
        return []
    rows = []
    accepted = set()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            if row.get("kind") == "delivery_ack":
                accepted.add(row.get("delivery_key"))
            else:
                rows.append(row)
    return [row for row in rows if not row.get("delivery_key") or row["delivery_key"] not in accepted]


def _clear_undelivered() -> None:
    path = _undelivered_path()
    try:
        if path.exists():
            path.unlink()
    except OSError:
        try:
            path.write_text("", encoding="utf-8")
        except OSError:
            pass


def _record_undelivered(row: dict, text: str, error: str, *, delivery_key: str = "", gid: str = "") -> None:
    rec = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "kind": row.get("kind") or "",
        "id": row.get("id") or "",
        "text": _safe_notice_text(text),
        "error": error or "Error",
        "delivery_key": delivery_key,
        "group_fingerprint": hashlib.sha256(gid.encode()).hexdigest() if gid else "",
    }
    _data_dir().mkdir(parents=True, exist_ok=True)
    # Keep the exact retry payload in the existing private inbox, not in the redacted error log.
    if delivery_key and row.get("kind") != "user":
        with INBOX.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "delivery_payload", "delivery_key": delivery_key, "message": text}, ensure_ascii=False) + "\n")
    with _undelivered_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _post_to_group(gid: str, text: str, retry_key: str = "") -> tuple[bool, str]:
    if not gid or not text:
        return False, "Error"
    body = json.dumps(
        {"to": gid, "messages": [{"type": "text", "text": text}]},
        ensure_ascii=False,
    ).encode()
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/push",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + _token()},
    )
    if retry_key:
        req.add_header("X-Line-Retry-Key", retry_key)
    try:
        urllib.request.urlopen(req, timeout=10)
        return True, ""
    except urllib.error.HTTPError as exc:
        if retry_key and exc.code == 409 and exc.headers and exc.headers.get("x-line-accepted-request-id"):
            return True, ""
        return False, _exc_label(exc)
    except Exception as exc:
        return False, _exc_label(exc)


def _flush_undelivered(gid: str) -> None:
    rows = _load_undelivered()
    if not rows:
        return
    payloads = {}
    if INBOX.exists():
        for raw in INBOX.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("kind") == "delivery_payload":
                payloads[row.get("delivery_key")] = row.get("message")
    attempted = 0
    for rec in rows:
        key = rec.get("delivery_key")
        if not key or rec.get("kind") == "user" or rec.get("group_fingerprint") != hashlib.sha256(gid.encode()).hexdigest():
            continue
        # LINE retry keys expire after 24h; unresolved old or 4xx events remain visible for manual review.
        try:
            age = (datetime.now() - datetime.fromisoformat(rec["ts"])).total_seconds()
        except (ValueError, KeyError, TypeError):
            continue
        if age >= 24 * 3600 or re.search(r"HTTPError 4\d\d", rec.get("error", "")):
            continue
        text = payloads.get(key)
        if not text:
            continue
        ok, _err = _post_to_group(gid, text, key)
        attempted += 1
        if ok:
            with _undelivered_path().open("a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "delivery_ack", "delivery_key": key}) + "\n")
        else:
            break
        if attempted >= 10:
            break


def quota_left():
    """回 (limit, used, left)；任何失敗回 (None, None, None)，不拋例外。"""
    try:
        tok = _token()

        def _get(url: str) -> dict:
            req = urllib.request.Request(url)
            req.add_header("Authorization", "Bearer " + tok)
            with urllib.request.urlopen(req, timeout=8) as r:
                data = json.loads(r.read())
            if not isinstance(data, dict):
                raise ValueError("quota json")
            return data

        q = _get(_QUOTA_URL)
        c = _get(_QUOTA_USED_URL)
        if q.get("type") == "none":
            return (None, None, None)
        limit = q.get("value")
        used = c.get("totalUsage")
        if limit is None or used is None:
            return (None, None, None)
        limit_i = int(limit)
        used_i = int(used)
        return (limit_i, used_i, limit_i - used_i)
    except Exception:
        return (None, None, None)


def _quota_month() -> str:
    return datetime.now().strftime("%Y-%m")


def _quota_warned_this_month() -> bool:
    path = _quota_warned_path()
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return isinstance(data, dict) and data.get("month") == _quota_month()


def _mark_quota_warned() -> None:
    _data_dir().mkdir(parents=True, exist_ok=True)
    payload = {
        "month": _quota_month(),
        "at": datetime.now().isoformat(timespec="seconds"),
    }
    _quota_warned_path().write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _maybe_quota_warn(gid: str) -> None:
    _limit, _used, left = quota_left()
    if left is None:
        return
    try:
        left_i = int(left)
    except (TypeError, ValueError):
        return
    if left_i > _QUOTA_WARN_LEFT:
        return
    if _quota_warned_this_month():
        return
    text = (
        f"提醒：這個月的 LINE 訊息額度剩 {left_i} 則\n"
        "額度用完之後，這裡就收不到新的通知了\n"
        "請在門市電腦開啟櫃台看板，確認是否有待處理案件。"
    )
    ok, _err = _post_to_group(gid, text)
    if ok:
        _mark_quota_warned()


def _compose_group_text(row: dict) -> str:
    def clean(value, limit=180):
        return re.sub(r"[\r\n\t]+", " ", str(value or "")).strip()[:limit]

    kind = row.get("kind") or "ask"
    name = clean(row.get("name")) or "客人"
    cid = clean(row.get("case_id") or row.get("id")) or "待對單"
    when = clean(row.get("when"))
    phone = re.sub(r"[-\s]", "", str(row.get("phone") or ""))
    if not re.fullmatch(r"09[0-9]{8}", phone):
        phone = ""
    who = "客人：" + name + ("｜電話：" + phone if phone else "")
    footer = "案件：" + cid + ("｜" + when.replace("T", " ") if when else "")
    need = clean(row.get("need"))
    photos = row.get("photos") or ([row["photo"]] if row.get("photo") else [])
    photo_line = f"照片：已收{len(set(photos))}張，門市電腦看板查看" if photos else "照片：請從原對話核對"
    if kind == "estimate":
        import estimate
        draft = row.get("estimate") or {}
        summary = estimate.render(draft) if draft else clean(row.get("text"), 2500)
        return "\n".join(["🧾 預估價｜待店員確認", "待辦：看件核對品項、數量與特殊處理費用", who,
                          summary, photo_line, "付款：尚未查核，不以預估金額認定應收或已入帳", footer + f"｜估價版本{row.get('estimate_revision', '?')}"])
    if kind == "pickup":
        slot = clean(row.get("slot") or row.get("when"))
        addr = clean(row.get("address"))
        missing = not (slot and addr and phone)
        lines = ["🚚 收送申請｜" + ("待補資料" if missing else "待安排"),
                 "待辦：請從官方LINE補齊資料，再安排收件" if missing else "待辦：確認時段能否安排，再回覆客人",
                 who, "時段：" + (slot or "待補"), "地址：" + (addr or "待補"),
                 "電話：" + (phone or "待補，請在官方LINE詢問"), "品項：" + (clean(row.get("item")) or "待補")]
        if row.get("estimate_summary"):
            lines.append("隨單估價（現場看件確認）：\n" + str(row["estimate_summary"]))
        return "\n".join([*lines, footer])
    if kind in ("photo", "photo_need"):
        return "\n".join(["📷 照片詢問｜" + ("需求有補充" if kind == "photo_need" else "待回覆"),
                          "待辦：依客人需求評估做法與價格，不重問照片是什麼物件", who,
                          "需求：" + (need or clean(row.get("text")) or "客人還沒說，請從官方LINE接話"), photo_line, footer])
    if kind == "pickup_item":
        return "\n".join(["📝 收送品項有補充｜同一案件", "待辦：依新清單確認收件安排", who,
                          "品項：" + (clean(row.get("item")) or "待補"), footer])
    if kind == "query":
        if row.get("auto_replied"):
            return "\n".join(["🔎 客人查件｜已自動回覆", "待辦：資料有異常再人工確認，不需重複查詢",
                              who, "電話：" + (phone or "待補"), "品項：" + (clean(row.get("item")) or "尚未提供"), footer])
        return "\n".join(["🔎 客人查件｜待查詢", "待辦：查核進度後回覆" if phone else "待辦：請從官方LINE補問完整手機",
                          who, "電話：" + (phone or "待補"), "品項：" + (clean(row.get("item")) or "尚未提供"), footer])
    if kind == "payment_check":
        return "\n".join([
            "💳 付款訊息｜待核對",
            "待辦：查商家交易紀錄、核對金額；確認前不要標記已付款，也不要請客人重付",
            who,
            "客人說：「" + (clean(row.get("text"), 1000) or "客人表示已付款") + "」",
            photo_line,
            footer,
        ])
    titles = {
        "pickup_change": ("🗓 收送異動｜待確認", "確認原安排及新需求，再回覆能否更改"),
        "cancel": ("⚠️ 取消／停洗需求｜優先確認", "先查是否出車或已開始處理，不能直接當作已取消"),
        "complaint": ("⚠️ 客人反映問題｜優先回覆", "查原單與照片，確認客人希望的處理方式"),
        "missing": ("⚠️ 少件／錯件反映｜優先查對", "查原單、包裝與交付紀錄，再聯絡客人"),
        "payment_check": ("💳 客人表示已付款｜待核對", "查商家交易紀錄，不把客人截圖當作已入帳"),
        "payment_issue": ("⚠️ 付款異常｜待核對", "先查交易狀態，不請客人重複付款"),
        "human": ("🙋 客人需要店員｜待接話", "從官方LINE接續原問題，已給過的資料不重問"),
        "book": ("📅 到店需求｜待確認", "確認客人需求與時間，再回覆"),
        "ask": ("💬 客人詢問｜待回覆", "從官方LINE接話，回覆這個問題"),
    }
    title, action = titles.get(kind, ("💬 客人有新需求｜待回覆", "請從官方LINE確認需求"))
    return "\n".join([title, "待辦：" + action, who,
                      "客人說：「" + (clean(row.get("text") or row.get("item"), 1000) or "待確認") + "」", footer])


def push_group(row: dict) -> bool:
    gid = group_id()
    text = _compose_group_text(row)
    key = str(uuid.uuid5(uuid.NAMESPACE_URL, gid + ":" + str(row.get("event_id") or uuid.uuid4())))
    if not gid:
        _record_undelivered(row, text, "GroupNotBound", delivery_key=key)
        return False
    with _IO_LOCK:
        _flush_undelivered(gid)
        ok, err = _post_to_group(gid, text, key)
    if not ok:
        _record_undelivered(row, text, err, delivery_key=key, gid=gid)
        return False
    _maybe_quota_warn(gid)
    return True


def push_user(uid: str, text: str) -> bool:
    if not uid or not text:
        return False
    body = json.dumps({"to": uid, "messages": [{"type": "text", "text": text}]}, ensure_ascii=False).encode()
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/push",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + _token()},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as exc:
        _record_undelivered({"kind": "user", "id": ""}, text, _exc_label(exc))
        return False


def notify_guest(uid: str = "", customer_no: str = "", mode: str = "auto") -> dict:
    import laundry_lookup
    if not uid and customer_no:
        uid = laundry_lookup.uid_for_customer(customer_no)
    if not customer_no and uid:
        customer_no = laundry_lookup.bound_customer(uid)
    if mode == "ready":
        text = "可以取了。您方便過來，或跟我說要外送。"
    elif mode == "not_ready":
        text = "還沒好，還在處理。好了我會再跟您說。"
    else:
        if not customer_no:
            return {"ok": False, "error": "no_customer"}
        text = laundry_lookup.guest_copy(laundry_lookup.lookup(customer_no))
    if not uid:
        return {"ok": False, "error": "no_line", "text": text}
    ok = push_user(uid, text)
    return {"ok": ok, "text": text, "uid": uid}


def set_status(bid: str, status: str) -> bool:
    # G12: append a status event; never rewrite the whole file
    if not bid:
        return False
    INBOX.parent.mkdir(parents=True, exist_ok=True)
    event = {
        "kind": "status",
        "id": bid,
        "status": status,
        "ts": datetime.now().isoformat(timespec="seconds"),
    }
    with _IO_LOCK:
        with INBOX.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        if status == "done":
            # Existing "已處理／已接待" is the staff-facing release action.
            release_handoff(bid, actor="staff")
    return True
