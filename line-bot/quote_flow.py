# -*- coding: utf-8 -*-
"""Estimate conversation and photo batch ownership; all data uses the existing session/inbox."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import uuid
from pathlib import Path
from urllib.parse import parse_qs

import estimate
import photo_estimate

PHOTOS_ROOT = (
    Path(os.environ["LAUNDRY_REPO_ROOT"]) / "data" / "photos"
    if os.environ.get("LAUNDRY_REPO_ROOT")
    else Path(r"C:/Users/cyc39/laundry-repo/data/photos")
)
# Separate customers do not wait behind one slow photo request.
LOCKS = [threading.RLock() for _ in range(64)]


def _lock(uid):
    return LOCKS[int(hashlib.sha256(uid.encode()).hexdigest(), 16) % len(LOCKS)]


def seen_event(conv, uid: str, event_id: str) -> bool:
    return bool(event_id and event_id in ((conv._load_sess().get(uid) or {}).get("estimate_events") or []))


def cached_reply(conv, uid, event_id):
    return ((conv._load_sess().get(uid) or {}).get("estimate_replies") or {}).get(event_id, [])


def reply_accepted(conv, uid, event_id):
    return event_id in ((conv._load_sess().get(uid) or {}).get("estimate_reply_accepted") or [])


def mark_reply_accepted(conv, uid, event_id):
    row = conv._load_sess().get(uid) or {}
    accepted = list(row.get("estimate_reply_accepted") or [])
    replies = row.get("estimate_replies") or {}
    replies.pop(event_id, None)
    conv.set_sess(uid, estimate_reply_accepted=(accepted + [event_id])[-100:], estimate_replies=replies)


def _remember(conv, uid, event_id, messages=None):
    if event_id:
        row = conv._load_sess().get(uid) or {}
        events = list(row.get("estimate_events") or [])
        replies = row.get("estimate_replies") or {}
        if messages is not None:
            replies[event_id] = messages
        conv.set_sess(uid, estimate_events=(events + [event_id])[-100:], estimate_replies=dict(list(replies.items())[-100:]))


def _result(messages, staff_pushed=False):
    """Return estimate messages with the actual group-push result.

    Saving a reply/session is deliberately separate from notifying the shop.
    The webhook uses ``staff_pushed`` to prevent duplicate notifications, so
    it must never be set merely because a reply was remembered.
    """
    return messages, {"intent": "estimate", "notify_staff": False, "staff_pushed": bool(staff_pushed)}


def _case(conv, uid):
    cid = conv.get_sess(uid).get("estimate_case")
    if not cid:
        cid = "EST-" + uuid.uuid4().hex[:12]
        conv.set_sess(uid, estimate_case=cid)
    return cid


def _actions(draft):
    revision = draft.get("revision", 0)
    case = draft.get("case_id", "")
    return estimate.clarification_actions(draft) + [
        {"type": "message", "label": "改品項／數量", "text": "修改估價"},
        {"type": "postback", "label": "請店員確認", "data": f"action=estimate_send&revision={revision}&case={case}", "displayText": "請店員確認這份估價"},
        {"type": "postback", "label": "安排收送", "data": f"action=estimate_pickup&revision={revision}&case={case}", "displayText": "用這份清單安排收送"},
        {"type": "cameraRoll", "label": "繼續傳照片"},
    ]


def _show(conv, draft):
    return [conv.text_msg(estimate.render(draft), actions=_actions(draft))]


def _notify(conv, uid, kind, *, text="", draft=None):
    import staff_notify
    sess = conv.get_sess(uid)
    revision = draft.get("revision", 0) if draft else 0
    cid = _case(conv, uid)
    row = {"id": cid, "case_id": cid, "event_id": f"{cid}:{kind}:{revision}" if draft else f"{cid}:{kind}:{uuid.uuid4().hex[:8]}",
           "uid": uid, "name": staff_notify.guest_name(uid), "when": conv.now_tw().isoformat(timespec="seconds"),
           "photo": sess.get("photo_path", ""), "photos": sess.get("estimate_photos", []),
           "need": sess.get("photo_need", ""), "text": text}
    if draft:
        row.update(estimate=draft, estimate_revision=revision, text=estimate.render(draft))
    result = staff_notify.push_inbox(kind, row)
    # Saved/queued is enough to avoid a second identical event. It is not proof of human receipt.
    if draft:
        conv.set_sess(uid, estimate_sent_revision=revision)
    return result


def photo_received(conv, uid, relative, event_id=""):
    with _lock(uid):
        if seen_event(conv, uid, event_id):
            return _result(cached_reply(conv, uid, event_id))
        sess = conv.get_sess(uid)
        if not relative or not relative.startswith("photos/"):
            return None  # Existing webhook fallback handles a failed download.
        path = (PHOTOS_ROOT / relative.removeprefix("photos/")).resolve()
        if not path.is_relative_to(PHOTOS_ROOT.resolve()) or not path.is_file():
            return None
        paths = list(sess.get("estimate_photos") or [])
        hashes = list(sess.get("estimate_photo_hashes") or [])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if relative in paths or digest in hashes:
            messages = [conv.text_msg("這張已經收到了，會放在同一批，不重複算。")]
            _remember(conv, uid, event_id, messages)
            return _result(messages)
        first = not paths
        paths.append(relative)
        hashes.append(digest)
        conv.set_sess(uid, estimate_photos=paths, estimate_photo_hashes=hashes, photo_path=relative,
                      photo_ts=conv.now_tw().isoformat(), wait=conv._PHOTO_NEED_WAIT,
                      photo_need=sess.get("photo_need", ""), estimate_photo_cache="")
        _case(conv, uid)
        staff_pushed = False
        if first:
            result = _notify(conv, uid, "photo", text="客人傳了照片，等待需求或整批估價")
            staff_pushed = bool((result or {}).get("notified"))
        else:
            # Update the same dashboard case without buzzing the group for every photo.
            import staff_notify
            staff_notify.push_inbox("photo", {"id": _case(conv, uid), "case_id": _case(conv, uid),
                "event_id": f"{_case(conv, uid)}:photo:{digest[:16]}", "uid": uid,
                "when": conv.now_tw().isoformat(timespec="seconds"), "photo": relative,
                "photos": paths, "need": sess.get("photo_need", ""), "text": "照片有補充"}, notify=False)
        actions = [{"type": "postback", "label": "幫我估這批", "data": "action=estimate_photos", "displayText": "幫我估這批照片"},
                   {"type": "camera", "label": "再拍一張"}, {"type": "cameraRoll", "label": "選照片"},
                   {"type": "message", "label": "只請店員看", "text": "請店員看照片"}]
        copy = "照片收到了。傳完按「幫我估這批」，我先看款式和件數，幫你抓預算。哪裡想加強清潔，也可以一起說。\n\n按估價會使用 Google AI 辨識照片；不想使用也可以按「只請店員看」。" if first else f"收到，這批目前有{len(paths)}張照片；同件不同角度不會按照片張數計費。傳完按「幫我估這批」就好。"
        messages = [conv.text_msg(copy, actions=actions)]
        _remember(conv, uid, event_id, messages)
        return _result(messages, staff_pushed=staff_pushed)


def _analyse(conv, uid):
    sess = conv.get_sess(uid)
    relative_paths = sess.get("estimate_photos") or []
    if not relative_paths:
        return [conv.text_msg("先傳照片給我，整件拍進去。有污漬再補一張近照。", actions=[{"type": "camera", "label": "拍照"}, {"type": "cameraRoll", "label": "選照片"}])]
    if len(relative_paths) > photo_estimate.MAX_PHOTOS:
        return [conv.text_msg("這批照片比較多，先請店員整批核對，避免漏算。也可以直接打品項和件數，我先幫你加總。")]
    key = hashlib.sha256(json.dumps(sess.get("estimate_photo_hashes", [])).encode()).hexdigest()
    if sess.get("estimate_photo_cache") == key and sess.get("estimate_draft"):
        return _show(conv, sess["estimate_draft"])
    paths = [(PHOTOS_ROOT / p.removeprefix("photos/")).resolve() for p in relative_paths]
    if not all(p.is_relative_to(PHOTOS_ROOT.resolve()) and p.is_file() for p in paths):
        return [conv.text_msg("有照片目前讀不到，先請店員看件。也可以補傳一次。")]
    conv.set_sess(uid,estimate_vision_request={"provider":"Google Gemini","purpose":"photo_quote",
                  "requested_at":conv.now_tw().isoformat(),"photo_batch_hash":key})
    result = photo_estimate.inventory(paths, list(estimate.catalog(conv.PRICES)))
    if not result.get("ok"):
        conv.set_sess(uid, estimate_vision_status=result.get("error", "unavailable"))
        queued = sess.get('estimate_vision_help_requested') == key
        if sess.get('estimate_vision_help_requested') != key:
            # A retryable provider failure is a task, not a customer request to
            # switch to a human. Explicit handover still stops the bot.
            try:
                notice = _notify(conv,uid,'ask',text='照片自動估價暫時未完成，請店員協助看件報價')
                queued = bool((notice or {}).get('saved'))
            except Exception:
                queued = False
            if queued:
                conv.set_sess(uid,estimate_vision_help_requested=key)
        body = "這次照片沒辨識成功。" + ("這批已留在店員待辦。" if queued else "")
        return [conv.text_msg(body + "照片不用重傳，可以再試一次，也可以請店員看。",
                actions=[{"type":"message","label":"再試一次估價","text":"重新辨識照片"},
                         {"type":"message","label":"請店員看","text":"請店員看照片"}])]
    draft = estimate.from_photo(result["items"], sess.get("estimate_draft"), conv.PRICES)
    draft["case_id"] = _case(conv, uid)
    # A successful provider response is not automatically a useful quote. If
    # every row is unknown/unpriced, keep the photos for the shop and say so
    # plainly instead of presenting a fake zero-total estimate.
    has_quote_line = any(
        line.get("subtotal") is not None or line.get("range_min_subtotal") is not None
        for line in draft.get("lines", [])
    )
    if not has_quote_line:
        conv.set_sess(uid, estimate_vision_status="manual_required", wait=None)
        if sess.get("estimate_vision_help_requested") != key:
            _notify(conv, uid, "photo_need", text="照片辨識沒有足夠把握，請店員看件報價")
            conv.set_sess(uid, estimate_vision_help_requested=key)
        return [conv.text_msg(
            "照片我有收到，但這次我不敢硬猜價格，先交店員看比較準。\n\n"
            "如果方便，可以補一張整件照或洗標；也可以直接打品項和數量，我先幫你加總。",
            actions=[
                {"type": "camera", "label": "補拍整件"},
                {"type": "cameraRoll", "label": "補傳洗標"},
                {"type": "message", "label": "請店員看", "text": "請店員看照片"},
            ],
        )]
    conv.set_sess(uid, estimate_draft=draft, estimate_photo_cache=key, estimate_vision_status="ok", wait=None)
    _notify(conv, uid, "estimate", draft=draft)
    return _show(conv, draft)


def handle_text(conv, uid, text, event_id=""):
    with _lock(uid):
        if seen_event(conv, uid, event_id):
            return _result(cached_reply(conv, uid, event_id))
        sess = conv.get_sess(uid)
        staff_pushed = False
        draft = sess.get("estimate_draft")
        text = text.strip()
        if text in ("幫我估這批", "幫我估這批照片", "照片估價", "照片幫我報價", "重新辨識照片"):
            messages = _analyse(conv, uid)
        elif text == "修改估價":
            messages = [conv.text_msg("直接說要改哪一項就好，例如「襯衫改成2件」「再加1雙一般運動鞋」或「鞋子先不用」。")]
        elif draft and re.fullmatch(r"(?:可以|請|麻煩)?(?:你)?(?:幫我|幫忙)?(?:再)?(?:加總|算一下|算總價|算一算|合計|全部多少|總共多少錢|總共多少)(?:一下|嗎|錢|元)?[？?！!。\s]*", text):
            messages = _show(conv, draft)
        elif draft and re.search(r"先付|先付款|付這個|付預估|付\s*\d|付款", text) and not re.search(r"已付|付了|付過|重複|付錯|退款", text):
            messages = [conv.text_msg("這筆還是預估，先不用急著付。等店裡看件確認金額，再用LINE Pay付款就好。")]
        elif text == "請店員看照片":
            if sess.get("estimate_photos"):
                result = _notify(conv, uid, "photo_need", text="客人請店員看照片")
                staff_pushed = bool((result or {}).get("notified"))
                messages = [conv.text_msg("好，照片和需求放在同一筆，讓店員接著看。")]
            else:
                return None
        elif text in ("重新估價", "清空估價"):
            conv.set_sess(uid, estimate_draft=None, estimate_photos=[], estimate_photo_hashes=[], estimate_photo_cache="", estimate_case="", estimate_sent_revision=None, estimate_for_pickup=None, photo_need="", photo_path="", wait=None)
            messages = [conv.text_msg("好，重新列一份。把這批品項和數量告訴我，或傳照片就可以。")]
        else:
            # An explicit price question can leave lookup mode. Pickup addresses
            # and bare lookup item names retain their own state machine.
            if conv._is_rush_text(text):
                return None
            wait = sess.get("wait") or ""
            lookup_price = wait in ("query", "query_phone", "query_item") and bool(
                re.search(r"多少|價錢|價格|報價|估價|加總|總價|怎麼算", text))
            if wait and wait not in ("photo", "photo_need") and not lookup_price:
                return None
            if re.search(r"洗好|進度|查件|查詢|少件|洗壞|賠償|縮水|褪色|破損|沒洗乾淨|已付|退款", text):
                return None
            updated = estimate.update(text, draft, conv.PRICES)
            if updated is None:
                return None
            updated["case_id"] = _case(conv, uid)
            conv.set_sess(uid, estimate_draft=updated, wait=None)
            if sess.get("estimate_photos") or sess.get("estimate_sent_revision") is not None:
                result = _notify(conv, uid, "estimate", draft=updated)
                staff_pushed = bool((result or {}).get("notified"))
            messages = _show(conv, updated)
        _remember(conv, uid, event_id, messages)
        return _result(messages, staff_pushed=staff_pushed)


def handle_postback(conv, uid, data, event_id=""):
    values = parse_qs(data)
    action = values.get("action", [""])[0]
    if not action.startswith("estimate_"):
        return None
    with _lock(uid):
        if seen_event(conv, uid, event_id):
            return cached_reply(conv, uid, event_id)
        if action == "estimate_photos":
            messages = _analyse(conv, uid)
        else:
            draft = conv.get_sess(uid).get("estimate_draft")
            if not draft or not draft.get("lines"):
                return [conv.text_msg("這份估價已經沒有內容，請重新傳品項或照片。")]
            if values.get("revision", [""])[0] != str(draft["revision"]) or values.get("case", [""])[0] != draft.get("case_id"):
                return [conv.text_msg("清單有更新，先看這份最新的。確認後再按下方按鈕。"), *_show(conv, draft)]
            if action == "estimate_send":
                if conv.get_sess(uid).get("estimate_sent_revision") != draft["revision"]:
                    _notify(conv, uid, "estimate", draft=draft)
                messages = [conv.text_msg("這份估價已記在同一筆待辦，請店員核對。需要另外處理的部分，再確認報價。")]
            elif action == "estimate_pickup":
                messages = conv.start_pickup(uid)
                items = "、".join(f"{x['name']} {x['quantity'] if x['quantity'] is not None else '待確認'}{x['unit']}" for x in draft["lines"])
                conv.set_sess(uid, pickup_item=items, estimate_for_pickup={"case": _case(conv, uid), "revision": draft["revision"]})
            else:
                return [conv.text_msg("這個選項已更新，請用最新估價下方的按鈕。")]
        _remember(conv, uid, event_id, messages)
        return messages
