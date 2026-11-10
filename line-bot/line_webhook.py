# -*- coding: utf-8 -*-
"""私享家 LINE webhook：店員對話 + Flex + 預約 postback + LINE Pay confirm。"""
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file

import conversation as conv
import line_pay
import staff_notify
import quote_flow
import line_event_log as event_log
import line_reply_state as reply_state

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


@event_log.timed("storage")
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


@event_log.timed("storage")
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


def _card_id(prefix: str) -> str:
    """A-WEBHOOK-3: staff card id. set_status()/release_handoff() key on it, so it must never
    repeat (the old prefix+HHMMSS repeated daily and for two customers in the same second)."""
    return prefix + datetime.now().strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:6]


def _line_error_detail(exc) -> str:
    """LINE's own reason for a refused call (e.g. 'Invalid reply token'), logged next to
    'reply error'. Only LINE's wording and the offending field path are kept: never our
    message text, the reply token or the channel token."""
    try:
        body = json.loads(exc.read(4096).decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        return ""
    if not isinstance(body, dict):
        return ""
    parts = []
    if isinstance(body.get("message"), str):
        parts.append(body["message"][:120])
    details = body.get("details")
    if isinstance(details, list):
        for d in details[:3]:
            if isinstance(d, dict):
                parts.append("%s: %s" % (str(d.get("property") or "")[:60], str(d.get("message") or "")[:80]))
    return ("[" + " | ".join(parts)[:300] + "]") if parts else ""


def reply(reply_token: str, messages: list):
    if not messages or not reply_token:
        return False
    sent = False
    try:
        req = urllib.request.Request(
            "https://api.line.me/v2/bot/message/reply",
            data=json.dumps({"replyToken": reply_token, "messages": messages[:5]}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token()}"},
        )
        sent = True
        urllib.request.urlopen(req, timeout=10)
        event_log.reply_result("accepted")
        return True
    except Exception as e:  # noqa: BLE001
        reason = e.reason if isinstance(e, urllib.error.URLError) else e
        if isinstance(e, urllib.error.HTTPError):
            failure = "line_5xx" if 500 <= e.code < 600 else "line_4xx" if 400 <= e.code < 500 else "other"
        elif not sent:
            failure = "local"
        elif isinstance(reason, (TimeoutError, ConnectionResetError, ConnectionAbortedError, BrokenPipeError)) or (
                isinstance(e, urllib.error.URLError) and any(t in str(reason).lower() for t in ("timed out", "timeout"))):
            failure = "unknown"
        elif isinstance(e, (urllib.error.URLError, ConnectionRefusedError)):
            failure = "network"
        else:
            failure = "unknown"
        event_log.reply_result("unknown" if failure == "unknown" else "failed", failure)
        detail = _line_error_detail(e)
        print("reply error:", e, *([detail] if detail else []), file=sys.stderr)
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


def _skip_uncertain_reply(span):
    try:
        if not reply_state.pending(span.trace.repo, span.event_ref):
            return False
        span.reply_result = "unknown"
        span.reply_failure = "unknown"
        span.dedup = "unknown_skipped"
    except OSError as exc:
        span.reply_result = "failed"
        span.reply_failure = "state_unavailable"
        print("reply state error:", type(exc).__name__, file=sys.stderr)
    return True


def _finish_event_reply(span):
    eligible = (span.reply_result == "failed" and span.reply_failure in ("network", "line_5xx")
                and not span.redelivered)
    if eligible:
        try:
            span.retry_requested = reply_state.claim_retry(span.trace.repo, span.event_ref)
        except OSError as exc:
            # No durable allowance, no retry. Optional telemetry failures still
            # never affect delivery; this guard is separate control state.
            print("reply state error:", type(exc).__name__, file=sys.stderr)
    span.reply_lost = span.reply_result in ("failed", "unknown") and not span.retry_requested


def _event_error(span, exc):
    # Event failure is separate from transport success: a post-send storage
    # failure must not erase an accepted/unknown send or authorize a resend.
    span.event_failed = True
    if span.reply_result == "not_needed":
        span.reply_result = "failed"
        span.reply_failure = "unexpected"
    elif span.reply_result == "failed" and span.reply_failure in ("", "other"):
        span.reply_failure = "unexpected"
    print("event error:", type(exc).__name__, file=sys.stderr)


def _handle_event(ev, span):
    def respond(reply_token, messages, *, remember=True, customer=True):
        # Every customer branch passes here, including empty/early-return replies.
        # Cache before attempting LINE; only an actual accepted send clears it.
        remember_reply = getattr(quote_flow, "_remember", None)
        if customer and remember and callable(remember_reply):
            remember_reply(conv, uid, event_id, messages)
        if not messages:
            span.reply_result = "not_needed"
            return
        if not reply_token:
            span.reply_result = "failed"
            span.reply_failure = "missing_token"
            return
        span.reply_result = "failed"
        span.reply_failure = "other"
        try:
            claimed = reply_state.begin(span.trace.repo, span.event_ref)
        except OSError as exc:
            span.reply_failure = "state_unavailable"
            print("reply state error:", type(exc).__name__, file=sys.stderr)
            return
        if not claimed:
            span.reply_result = "unknown"
            span.reply_failure = "unknown"
            span.dedup = "unknown_skipped"
            return
        attempted = False

        def send(outgoing):
            nonlocal attempted
            attempted = True
            accepted = reply(reply_token, outgoing)
            # Capture LINE's outcome before deliver persists hint state.
            if accepted is True:
                span.reply_result = "accepted"
                span.reply_failure = ""
            return accepted

        try:
            with event_log.measure("reply"):
                deliver = getattr(conv, "reply_with_hints", None)
                if customer and callable(deliver):
                    incoming = (ev.get("message") or {}).get("text") or ""
                    deliver(uid, incoming, messages, send)
                else:
                    send(messages)
        except Exception:
            if attempted and span.reply_result not in ("accepted", "unknown"):
                span.reply_result = "unknown"
                span.reply_failure = "unknown"
            raise
        finally:
            if span.reply_result == "accepted" and customer and quote_flow.seen_event(conv, uid, event_id):
                quote_flow.mark_reply_accepted(conv, uid, event_id)
            if span.reply_result != "unknown":
                try:
                    reply_state.finish(span.trace.repo, span.event_ref)
                except OSError as exc:
                    if span.reply_result != "accepted":
                        span.reply_failure = "state_unavailable"
                    print("reply state error:", type(exc).__name__, file=sys.stderr)

    src = ev.get("source") or {}
    uid = src.get("userId") or "?"
    rt = ev.get("replyToken") or ""
    et = ev.get("type")
    event_id = ev.get("webhookEventId") or (ev.get("message") or {}).get("id") or ""
    if not (src.get("type") != "group" and quote_flow.reply_accepted(conv, uid, event_id)) and _skip_uncertain_reply(span):
        return
    if (ev.get("deliveryContext") or {}).get("isRedelivery"):
        # LINE re-sent an event it did not see us accept; its reply token may already be spent.
        print("redelivery:", span.event_type, file=sys.stderr)
    if src.get("type") == "group":
        span.dedup = "not_applicable"
        gid = src.get("groupId") or ""
        # G1: join never binds and does not reply
        if et == "join":
            return
        text = ""
        if et == "message" and ev.get("message", {}).get("type") == "text":
            text = (ev["message"].get("text") or "").strip()
        expect = _read_staff_bind_token()
        if expect is None:
            return
        if gid and text == expect:
            staff_notify.bind_group(gid)
            respond(rt, [{"type": "text", "text": "好，之後預約會打到這個群。"}], customer=False)
        return
    # Human handoff is a hard stop at the webhook boundary.  We still
    # persist every customer event (and download photos), but never call
    # conversation/AI or reply to the customer until staff releases it.
    handoff_event_seen = getattr(staff_notify, "handoff_event_seen", None)
    if callable(handoff_event_seen) and handoff_event_seen(uid, event_id):
        span.dedup = "handoff_skipped"
        span.to_staff = True
        return
    handoff_active = getattr(staff_notify, "handoff_active", None)
    if callable(handoff_active) and handoff_active(uid):
        span.to_staff = True
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
        return
    if quote_flow.seen_event(conv, uid, event_id):
        if quote_flow.reply_accepted(conv, uid, event_id):
            span.dedup = "accepted_skipped"
        else:
            cached = quote_flow.cached_reply(conv, uid, event_id)
            has_cache = getattr(quote_flow, "has_cached_reply", lambda *args: bool(cached))
            if not has_cache(conv, uid, event_id):
                span.dedup = "cache_missing"
                span.reply_result = "failed"
                span.reply_failure = "cache_missing"
            else:
                span.dedup = "retry_cached" if cached else "not_needed_skipped"
                respond(rt, cached, remember=False)
        return
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
        # A-WEBHOOK-1: reply first; staff side effects below do network I/O.
        event_log.note_staff(meta)
        respond(rt, msgs)
        if unanswered:
            try:
                log_unanswered(uid, text)
                if not meta.get("staff_pushed"):
                    ask_text = text
                    try:
                        prefix = conv.recent_staff_ask_prefix(uid)
                    except Exception:
                        prefix = ""
                    if prefix:
                        ask_text = prefix + (text or "")
                    ask_row = {
                        "id": _card_id("Q"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": ask_text,
                    }
                    if event_id:
                        ask_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", ask_row)
            except Exception as e:  # noqa: BLE001
                # A-WEBHOOK-4: a staff-side failure must not 500 the batch
                print("staff notify error:", type(e).__name__, file=sys.stderr)
    elif et == "message" and ev.get("message", {}).get("type") == "sticker":
        # M8: sticker 走 handle_ex，notify 時一併進看板
        handle_ex = getattr(conv, "handle_ex", None)
        if handle_ex:
            msgs, meta = handle_ex(uid, "", "sticker")
            event_log.note_staff(meta)
            respond(rt, msgs)
            if meta.get("notify_staff") and not meta.get("staff_pushed"):
                try:
                    sticker_row = {
                        "id": _card_id("Q"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": "[客人傳了貼圖]",
                    }
                    if event_id:
                        sticker_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", sticker_row)
                except Exception as e:  # noqa: BLE001
                    print("staff notify error:", type(e).__name__, file=sys.stderr)
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
            event_log.note_staff(meta)
            respond(rt, msgs)
            if rel and meta.get("notify_staff") and not meta.get("staff_pushed"):
                try:
                    photo_row = {
                        "id": _card_id("P"),
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
                    print("photo inbox error:", type(e).__name__, file=sys.stderr)
            if (not rel) and meta.get("notify_staff") and not meta.get("staff_pushed"):
                try:
                    miss_row = {
                        "id": _card_id("Q"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": "客人傳了照片（存檔失敗）",
                        "note": "[客人傳了照片]",
                    }
                    if event_id:
                        miss_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", miss_row)
                except Exception as e:  # noqa: BLE001
                    print("staff notify error:", type(e).__name__, file=sys.stderr)
        else:
            respond(rt, conv.handle(uid, "", "image"))
            if rel:
                try:
                    legacy_photo = {
                        "id": _card_id("P"),
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
                    print("photo inbox error:", type(e).__name__, file=sys.stderr)
    elif et == "message" and ev.get("message", {}).get("type") == "location":
        loc = ev.get("message") or {}
        addr = (loc.get("address") or loc.get("title") or "").strip()
        handle_ex = getattr(conv, "handle_ex", None)
        if handle_ex:
            msgs, meta = handle_ex(uid, addr, "location")
            event_log.note_staff(meta)
            respond(rt, msgs)
            try:
                if meta.get("notify_staff"):
                    log_unanswered(uid, addr or "[location]")
                if meta.get("notify_staff") and not meta.get("staff_pushed"):
                    loc_row = {
                        "id": _card_id("Q"),
                        "uid": uid,
                        "when": datetime.now().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "text": addr or "[location]",
                    }
                    if event_id:
                        loc_row["event_id"] = event_id
                    staff_notify.push_inbox("ask", loc_row)
            except Exception as e:  # noqa: BLE001
                print("staff notify error:", type(e).__name__, file=sys.stderr)
        else:
            respond(rt, conv.handle(uid, addr, "location"))


@app.post("/line/webhook")
def line_webhook():
    trace = event_log.RequestTrace(SECRET, REPO)
    http_status = 500
    try:
        sig = request.headers.get("X-Line-Signature", "")
        body = request.get_data()
        if not verify_signature(body, sig):
            http_status = 403
            return "bad signature", http_status
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict) or not isinstance(payload.get("events", []), list):
            http_status = 400
            return "bad payload", http_status
        retry_requested = False
        for ev in payload.get("events", []):
            if not isinstance(ev, dict):
                http_status = 400
                return "bad event", http_status
            delivery = ev.get("deliveryContext")
            redelivered = delivery.get("isRedelivery") if isinstance(delivery, dict) else False
            with trace.event(ev.get("webhookEventId"), ev.get("type"), redelivered) as span:
                try:
                    _handle_event(ev, span)
                except Exception as exc:
                    _event_error(span, exc)
                try:
                    _finish_event_reply(span)
                except Exception as exc:
                    _event_error(span, exc)
                    span.retry_requested = False
                    span.reply_lost = span.reply_result in ("failed", "unknown")
            retry_requested |= span.retry_requested
        http_status = 503 if retry_requested else 200
        return (jsonify({"retry": True}), http_status) if retry_requested else jsonify({})
    except Exception as exc:
        with trace.event(None, "other") as span:
            _event_error(span, exc)
            span.reply_lost = True
        http_status = 503 if any(row["retry_requested"] for row in trace.events) else 200
        return (jsonify({"retry": True}), http_status) if http_status == 503 else jsonify({})
    finally:
        trace.finish(http_status)


@app.get("/healthz")
def healthz():
    # G6: plain text pid so Probe can tell this process from a foreign listener
    return f"ok {os.getpid()}", 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.get("/readyz")
def readyz():
    # The public tunnel reaches this same loopback listener. Reject its Host and
    # forwarding headers as well as non-loopback peers; never trust proxy headers.
    if (request.remote_addr != "127.0.0.1"
            or request.host not in {"127.0.0.1", "127.0.0.1:8791"}
            or any(name.lower().startswith(("x-forwarded-", "cf-"))
                   or name.lower() == "forwarded" for name in request.headers.keys())):
        abort(403)
    import ai_chat
    import photo_estimate

    vision_configured = bool(photo_estimate.configured())
    chat_enabled = ai_chat.mode() == "on" and ai_chat.available()
    missing = []
    if not os.environ.get("GEMINI_API_KEY"):
        missing.append("GEMINI_API_KEY")
    if os.environ.get("LAUNDRY_PHOTO_ESTIMATE", "1") == "0":
        missing.append("LAUNDRY_PHOTO_ESTIMATE")
    if ai_chat.mode() != "on":
        missing.append("LAUNDRY_AI_CHAT")
    return jsonify(pid=os.getpid(), vision_configured=vision_configured,
                   ai_chat=bool(chat_enabled), missing=missing,
                   chat_claude=bool(os.environ.get("CLAUDE_API_CREDIT_KEY")))


if __name__ == "__main__":
    # 只有真正啟動服務才輪詢。import 這個模組不得啟動執行緒。
    def _start_background_jobs():
        try:
            import arrival_notify

            arrival_notify.start_poller()
        except Exception as exc:
            sys.stderr.write(type(exc).__name__ + "\n")

    _start_background_jobs()
    # 只有正式啟動的 bot 記 LINE 用量；import 這個模組的測試不記（見 conversation.handle_ex）。
    os.environ.setdefault("LAUNDRY_LINE_USAGE", "on")
    os.environ.setdefault("LAUNDRY_LINE_EVENTS", "on")
    app.run(host="127.0.0.1", port=8791)
