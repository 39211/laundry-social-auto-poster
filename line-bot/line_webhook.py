# -*- coding: utf-8 -*-
"""私享家 LINE webhook：店員對話 + Flex + 預約 postback + LINE Pay confirm。"""
import json
import math
import os
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file

import conversation as conv
import line_pay
import staff_notify
import quote_flow

REPO = Path(os.environ.get("LAUNDRY_REPO_ROOT", r"C:/Users/cyc39/laundry-repo"))
SECRETS = json.loads((REPO / "secrets/line-channel.json").read_text(encoding="utf-8"))
SECRET = SECRETS["channel_secret"].encode()
INBOX_LOG = REPO / "data" / "line-unanswered.jsonl"
PHOTOS_ROOT = REPO / "data" / "photos"
STATIC = Path(__file__).resolve().parent / "static"
# G1: one-shot staff-group bind token; commander creates this file, we never do
BIND_TOKEN_FILE = REPO / "secrets" / "staff-bind-token.txt"
# G13: LINE Pay transactionId must be digits only before it is signed into a path
TID_RE = re.compile(r"^[0-9]{1,32}$")

app = Flask(__name__, static_folder=None)  # R1: no default /static


def verify_signature(body: bytes, signature: str) -> bool:
    import base64
    import hashlib
    import hmac
    mac = hmac.new(SECRET, body, hashlib.sha256).digest()
    expect = base64.b64encode(mac).decode()
    return hmac.compare_digest(expect, signature or "")


def token() -> str:
    return json.loads((REPO / "secrets/line-channel.json").read_text(encoding="utf-8")).get(
        "line_channel_token", ""
    )


def download_content(message_id: str) -> bytes:
    """下載 LINE 原始訊息內容。測試可 monkeypatch 此函式，不得在測試打真實 API。"""
    url = f"https://api-data.line.me/v2/bot/message/{message_id}/content"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token()}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def save_photo_bytes(message_id: str, content: bytes, when: datetime | None = None) -> str:
    """存成 data/photos/<YYYYMMDD>/<messageId>.jpg，回相對 data 的路徑。"""
    day = (when or datetime.now()).strftime("%Y%m%d")
    folder = PHOTOS_ROOT / day
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{message_id}.jpg"
    dest.write_bytes(content)
    return f"photos/{day}/{message_id}.jpg"


def _handle_image_save(uid: str, message_id: str) -> str:
    """下載並存檔；失敗記 log、回空字串，不得整包當掉。"""
    if not message_id:
        return ""
    try:
        content = download_content(message_id)
        return save_photo_bytes(message_id, content)
    except Exception as e:  # noqa: BLE001
        print("image download error:", e, file=sys.stderr)
        return ""


def log_unanswered(user_id: str, text: str):
    INBOX_LOG.parent.mkdir(parents=True, exist_ok=True)
    with INBOX_LOG.open("a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {"ts": datetime.now().isoformat(timespec="seconds"), "user": user_id, "text": text},
                ensure_ascii=False,
            )
            + "\n"
        )


def reply(reply_token: str, messages: list):
    if not messages or not reply_token:
        return True
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/reply",
        data=json.dumps({"replyToken": reply_token, "messages": messages[:5]}).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token()}",
        },
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:  # noqa: BLE001
        print("reply error:", e, file=sys.stderr)
        return False


def _read_staff_bind_token() -> str | None:
    # G1: missing/empty file -> refuse bind, log one line, never log the token
    try:
        raw = BIND_TOKEN_FILE.read_text(encoding="utf-8")
    except OSError:
        print("staff bind refused: token file missing", file=sys.stderr)
        return None
    token_text = raw.strip()
    if not token_text:
        print("staff bind refused: token file empty", file=sys.stderr)
        return None
    return token_text


# R1: public app keeps only /img, /pay/*, /line/webhook, /healthz
@app.get("/img/<name>")
def img(name: str):
    safe = Path(name).name
    p = STATIC / safe
    if not p.exists() or not p.is_file() or p.resolve().parent != STATIC.resolve():
        abort(404)
    mime = "image/jpeg" if p.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    return send_file(p, mimetype=mime)


@app.get("/pay/confirm")
def pay_confirm():
    tid = request.args.get("transactionId") or ""
    amount = request.args.get("amount") or "0"
    # G13: reject non-digit transactionId before line_pay.confirm interpolates it
    if not TID_RE.fullmatch(tid):
        return "bad transactionId", 400
    try:
        val = float(amount)
        # F16: OverflowError on inf; reject negatives and non-finite
        if not math.isfinite(val) or val < 0:
            amt = 0
        else:
            amt = int(val)
    except (ValueError, OverflowError):
        amt = 0
    result = line_pay.confirm(tid, amt)
    if result.get("ok"):
        # R8: bot never called itself 小安
        return "付款完成，謝謝。回 LINE 跟我們說一聲就好。"
    return f"付款還沒完成：{result.get('error') or '請回 LINE 找我們'}", 400


@app.get("/pay/cancel")
def pay_cancel():
    return "已取消付款。回 LINE 可以改約或改用到店付。"


@app.post("/line/webhook")
def line_webhook():
    sig = request.headers.get("X-Line-Signature", "")
    body = request.get_data()
    if not verify_signature(body, sig):
        return "bad signature", 403
    payload = request.get_json(silent=True) or {}
    failed_estimate_replies = []

    def respond(reply_token, messages):
        accepted = reply(reply_token, messages)
        if quote_flow.seen_event(conv, uid, event_id):
            if accepted is False:
                failed_estimate_replies.append(event_id)
            elif accepted is True:
                quote_flow.mark_reply_accepted(conv, uid, event_id)

    for ev in payload.get("events", []):
        src = ev.get("source") or {}
        uid = src.get("userId") or "?"
        rt = ev.get("replyToken") or ""
        et = ev.get("type")
        if src.get("type") == "group":
            gid = src.get("groupId") or ""
            # G1: join never binds and does not reply
            if et == "join":
                continue
            text = ""
            if et == "message" and ev.get("message", {}).get("type") == "text":
                text = (ev["message"].get("text") or "").strip()
            expect = _read_staff_bind_token()
            if expect is None:
                continue
            if gid and text == expect:
                staff_notify.bind_group(gid)
                reply(rt, [{"type": "text", "text": "好，之後預約會打到這個群。"}])
            continue
        event_id = ev.get("webhookEventId") or (ev.get("message") or {}).get("id") or ""
        # Human handoff is a hard stop at the webhook boundary.  We still
        # persist every customer event (and download photos), but never call
        # conversation/AI or reply to the customer until staff releases it.
        handoff_event_seen = getattr(staff_notify, "handoff_event_seen", None)
        if callable(handoff_event_seen) and handoff_event_seen(uid, event_id):
            continue
        handoff_active = getattr(staff_notify, "handoff_active", None)
        if callable(handoff_active) and handoff_active(uid):
            saved_photo = ""
            message = ev.get("message") or {}
            if et == "message" and message.get("type") == "image":
                saved_photo = _handle_image_save(uid, str(message.get("id") or ""))
            handoff_text = ""
            handoff_address = ""
            handoff_data = ""
            if et == "message" and message.get("type") == "text":
                handoff_text = (message.get("text") or "").strip()
            elif et == "message" and message.get("type") == "location":
                handoff_address = (message.get("address") or message.get("title") or "").strip()
                handoff_text = handoff_address or "[location]"
            elif et == "message" and message.get("type") == "image":
                handoff_text = "[客人傳了照片]"
            elif et == "message" and message.get("type") == "sticker":
                handoff_text = "[客人傳了貼圖]"
            elif et == "postback":
                handoff_data = str((ev.get("postback") or {}).get("data") or "")
                handoff_text = "[客人點選了選單]"
            elif et == "follow":
                handoff_text = "[客人重新加入]"
            record_handoff = getattr(staff_notify, "record_handoff_message", None)
            handoff_state = getattr(staff_notify, "handoff_state", None)
            if callable(record_handoff) and callable(handoff_state):
                record_handoff(
                    uid,
                    handoff_state(uid).get("case_id") or "",
                    event_id,
                    et or "message",
                    text=handoff_text,
                    photo=saved_photo,
                    address=handoff_address,
                    data=handoff_data,
                )
            continue
        if quote_flow.seen_event(conv, uid, event_id):
            if not quote_flow.reply_accepted(conv, uid, event_id):
                respond(rt, quote_flow.cached_reply(conv, uid, event_id))
            continue
        if et == "follow":
            respond(rt, conv.handle(uid, "", "follow"))
        elif et == "postback":
            pb = ev.get("postback") or {}
            respond(rt, conv.handle_postback(uid, pb.get("data") or "", pb.get("params") or {}, event_id=event_id))
        elif et == "message" and ev.get("message", {}).get("type") == "text":
            text = ev["message"]["text"]
            # IF-1: prefer handle_ex when the conversation line has landed
            handle_ex = getattr(conv, "handle_ex", None)
            if handle_ex:
                msgs, meta = handle_ex(uid, text, "message", event_id=event_id)
                unanswered = bool(meta.get("notify_staff"))
            else:
                msgs = conv.handle(uid, text, "message")
                unanswered = any("再說一次我聽一下" in (m.get("text") or "") for m in msgs)
                meta = {}
            if unanswered:
                log_unanswered(uid, text)
                if unanswered and not meta.get("staff_pushed"):
                    ask_text = text
                    try:
                        prefix = conv.recent_staff_ask_prefix(uid)
                    except Exception:
                        prefix = ""
                    if prefix:
                        ask_text = prefix + (text or "")
                    ask_row = {
                        "id": "Q" + datetime.now().strftime("%H%M%S"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": ask_text,
                    }
                    if event_id:
                        ask_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", ask_row)
            respond(rt, msgs)
        elif et == "message" and ev.get("message", {}).get("type") == "sticker":
            # M8: sticker 走 handle_ex，notify 時一併進看板
            handle_ex = getattr(conv, "handle_ex", None)
            if handle_ex:
                msgs, meta = handle_ex(uid, "", "sticker")
                if meta.get("notify_staff") and not meta.get("staff_pushed"):
                    sticker_row = {
                        "id": "Q" + datetime.now().strftime("%H%M%S"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": "[客人傳了照片]",
                    }
                    if event_id:
                        sticker_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", sticker_row)
                respond(rt, msgs)
            else:
                respond(rt, conv.handle(uid, "", "sticker"))
        elif et == "message" and ev.get("message", {}).get("type") == "image":
            # W2 / N1: 只發一次。存檔成功發 photo；失敗才退路 ask
            msg = ev.get("message") or {}
            mid = str(msg.get("id") or "")
            rel = _handle_image_save(uid, mid)
            handle_ex = getattr(conv, "handle_ex", None)
            if handle_ex:
                quote_flow.PHOTOS_ROOT = PHOTOS_ROOT
                msgs, meta = handle_ex(uid, rel or "", "image" if rel else "image_error", event_id=event_id)
                if rel and meta.get("notify_staff") and not meta.get("staff_pushed"):
                    try:
                        photo_row = {
                            "id": "P" + datetime.now().strftime("%H%M%S"),
                            "uid": uid,
                            "when": datetime.now().isoformat(timespec="minutes"),
                            "name": staff_notify.guest_name(uid),
                            "text": "客人傳了照片",
                            "note": "[客人傳了照片]",
                            "photo": rel,
                            "need": "",
                        }
                        if event_id:
                            photo_row["event_id"] = event_id
                        staff_notify.push_inbox("photo", photo_row)
                    except Exception as e:  # noqa: BLE001
                        print("photo inbox error:", e, file=sys.stderr)
                if (not rel) and meta.get("notify_staff") and not meta.get("staff_pushed"):
                    miss_row = {
                        "id": "Q" + datetime.now().strftime("%H%M%S"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": "客人傳了照片（存檔失敗）",
                        "note": "[客人傳了照片]",
                    }
                    if event_id:
                        miss_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", miss_row)
                respond(rt, msgs)
            else:
                if rel:
                    try:
                        legacy_photo = {
                            "id": "P" + datetime.now().strftime("%H%M%S"),
                            "uid": uid,
                            "when": datetime.now().isoformat(timespec="minutes"),
                            "name": staff_notify.guest_name(uid),
                            "text": "客人傳了照片",
                            "note": "[客人傳了照片]",
                            "photo": rel,
                        }
                        if event_id:
                            legacy_photo["event_id"] = event_id
                        staff_notify.push_inbox("photo", legacy_photo)
                    except Exception as e:  # noqa: BLE001
                        print("photo inbox error:", e, file=sys.stderr)
                respond(rt, conv.handle(uid, "", "image"))
        elif et == "message" and ev.get("message", {}).get("type") == "location":
            loc = ev.get("message") or {}
            addr = (loc.get("address") or loc.get("title") or "").strip()
            handle_ex = getattr(conv, "handle_ex", None)
            if handle_ex:
                msgs, meta = handle_ex(uid, addr, "location")
                if meta.get("notify_staff"):
                    log_unanswered(uid, addr or "[location]")
                if meta.get("notify_staff") and not meta.get("staff_pushed"):
                    loc_row = {
                        "id": "Q" + datetime.now().strftime("%H%M%S"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": addr or "[location]",
                    }
                    if event_id:
                        loc_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", loc_row)
                respond(rt, msgs)
            else:
                respond(rt, conv.handle(uid, addr, "location"))
    return (jsonify({"retry": True}), 503) if failed_estimate_replies else jsonify({})


@app.get("/healthz")
def healthz():
    # G6: plain text pid so Probe can tell this process from a foreign listener
    return f"ok {os.getpid()}", 200, {"Content-Type": "text/plain; charset=utf-8"}


if __name__ == "__main__":
    # 只有真正啟動服務才輪詢。import 這個模組不得啟動執行緒。
    def _start_background_jobs():
        try:
            import arrival_notify

            arrival_notify.start_poller()
        except Exception as exc:
            sys.stderr.write(type(exc).__name__ + "\n")

    _start_background_jobs()
    app.run(host="127.0.0.1", port=8791)
