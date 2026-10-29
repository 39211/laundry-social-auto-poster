# -*- coding: utf-8 -*-
import importlib
import json
import os
import sys
import tempfile
import time
import urllib.request
from datetime import timedelta
from pathlib import Path

os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent))

import conversation as conv
import laundry_lookup as L
import staff_notify as sn

# R5
URLOPEN_CALLS = []


def _req_url(args, kwargs):
    req = args[0] if args else kwargs.get("url")
    if req is None:
        return ""
    if isinstance(req, str):
        return req
    url = getattr(req, "full_url", None)
    if url:
        return url
    getter = getattr(req, "get_full_url", None)
    if callable(getter):
        return getter()
    return ""


def fake_urlopen(*args, **kwargs):
    # F8: record the URL so isolation tests can prove the interceptor ran
    URLOPEN_CALLS.append({"url": _req_url(args, kwargs), "args": args, "kwargs": kwargs})
    raise OSError("test isolation: network forbidden")


_OFFICIAL_DATA = Path(r"C:/Users/cyc39/laundry-repo/data")


def _path_under_data(p) -> bool:
    """比對路徑字串，避免對正式 data 目錄做 resolve。"""
    if p is None:
        return True
    try:
        rp = os.path.normcase(os.path.normpath(str(p)))
        data = os.path.normcase(os.path.normpath(str(_OFFICIAL_DATA)))
    except Exception:
        return True
    return rp == data or rp.startswith(data + os.sep)


def _assert_isolated(*paths):
    leaked = [str(p) for p in paths if _path_under_data(p)]
    if leaked:
        raise RuntimeError("isolation leaked to data/: " + ", ".join(leaked))


def install_isolation(*, fixture=True):
    """Redirect writable data paths to a temp dir; block network and beep."""
    URLOPEN_CALLS.clear()
    tmp = Path(tempfile.mkdtemp(prefix="linebot-test-"))
    conv.SESS = tmp / "line-sessions.json"
    conv.BOOK = tmp / "line-bookings.jsonl"
    sn.INBOX = tmp / "staff-inbox.jsonl"
    sn.BOOK = tmp / "line-bookings.jsonl"
    sn.TARGET = tmp / "staff-target.json"
    L.BIND = tmp / "line-customer-bind.json"
    L.WATCH = tmp / "laundry-watch.json"
    # L.FIXTURE stays on the official fixture (read-only)
    # F8: plant a fake groupId so push_group actually reaches urlopen
    sn.TARGET.write_text(json.dumps({"groupId": "Cfakeisolationgroupid00000000000001"}), encoding="utf-8")
    sn._beep = lambda: None
    sn.guest_name = lambda uid: "客人"
    urllib.request.urlopen = fake_urlopen
    sn.urllib.request.urlopen = fake_urlopen
    # F9: redirect unanswered log away from the official file
    lw = importlib.import_module("line_webhook")
    lw.INBOX_LOG = tmp / "line-unanswered.jsonl"
    # F14: line_pay bound urlopen at import time; patch the module attribute
    lp = importlib.import_module("line_pay")
    lp.urlopen = fake_urlopen
    if fixture is True:
        os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
    elif fixture is False:
        os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
    # M1：安裝完六個路徑都不得落在正式 data\
    _assert_isolated(conv.BOOK, conv.SESS, sn.INBOX, sn.TARGET, L.BIND, lw.INBOX_LOG)
    return tmp


# M1 fail-safe：不論 BOOK 是否已指向沙箱，都把可寫路徑改到暫存並擋網路。
try:
    import flask  # noqa: F401
except ImportError:
    import test_linebot_fix_20260926 as _flask_shim  # noqa: F401

install_isolation(fixture=True)


def texts(msgs):
    out = []
    for m in msgs:
        if m.get("type") == "text":
            out.append(m.get("text") or "")
        elif m.get("type") == "flex":
            out.append(m.get("altText") or "")
    return "\n".join(out)


def picker_data(msgs):
    for m in msgs:
        if m.get("type") != "flex":
            continue
        footer = ((m.get("contents") or {}).get("footer") or {}).get("contents") or []
        for btn in footer:
            act = btn.get("action") or {}
            if act.get("type") == "datetimepicker":
                return act.get("data") or ""
    return ""


def test_lookup_ready_and_not_ready():
    mixed = L.lookup("0028")
    assert mixed.found, mixed
    copy = L.guest_copy(mixed)
    assert "可以取了" in copy, copy
    assert "還沒好" in copy, copy
    assert L.guest_ready_flag(mixed) == "mixed"
    waiting = L.lookup("1947")
    assert "還沒好" in L.guest_copy(waiting)
    assert "可以取了" not in L.guest_copy(waiting)
    assert L.guest_ready_flag(waiting) == "not_ready"
    phone = L.lookup("0912345678")
    assert phone.customer_no == "0028"
    assert not L.lookup("5678").found
    wash = L.lookup("W2001")
    assert wash.customer_no == "1947"


def test_missing_customer():
    row = L.lookup("9999")
    assert not row.found
    assert "還沒對到" in L.guest_copy(row)


def test_menu_pickup_then_address():
    # SXJ-LINE-PICKUP3：舊斷言釘住「打地址 → action=pickup 選時間卡 → 直接成立」。
    # 那條路會存出沒電話的單，已堵。改為收下地址、問還缺的，舊 postback 不得直接存檔。
    uid = "Uflowpickupxxxx"
    msgs = conv.handle(uid, "外收送預約")
    blob = texts(msgs)
    assert "方便" in blob, blob  # T1 收送入口改問時間，不再旁白地址
    msgs2 = conv.handle(uid, "台中市西屯區青海路二段365號")
    blob2 = texts(msgs2)
    assert conv.get_sess(uid).get("pickup_addr"), conv.get_sess(uid)
    assert "記下了" in blob2 or "收到" in blob2, blob2  # T1 地址收到「好，記下了。」
    pdata = picker_data(msgs2)
    # startswith("action=pickup") 會把新流程的 action=pickup_when 也算進去，所以改釘精確前綴。
    assert pdata.startswith("action=pickup_when") or pdata == "", pdata
    assert not (pdata == "action=pickup" or pdata.startswith("action=pickup&")), pdata
    n_before = len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
    future = conv.now_tw() + timedelta(days=1)
    while future.weekday() == 6:
        future += timedelta(days=1)
    future = future.replace(hour=15, minute=0, second=0, microsecond=0)
    done = conv.handle_postback(uid, "action=pickup&item=", {"datetime": future.strftime("%Y-%m-%dT%H:%M")})
    blob = texts(done)
    n_mid = len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
    assert n_mid == n_before, "old action=pickup postback must not save"
    assert "電話" in blob or "確認" in blob, blob
    if conv.get_sess(uid).get("wait") == "pickup_phone":
        conv.handle(uid, "0912345678")
    assert conv.get_sess(uid).get("wait") == "pickup_confirm", conv.get_sess(uid)
    conv.handle_postback(uid, "action=pickup_confirm", {})
    last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
    assert last.get("kind") == "pickup"
    assert "青海路" in (last.get("address") or "")
    assert last.get("phone")


def test_menu_store_booking():
    uid = "Uflowstorexxxxx"
    msgs = conv.handle(uid, "預約到店")
    assert picker_data(msgs).startswith("action=reserve")
    future = conv.now_tw() + timedelta(days=1)
    while future.weekday() == 6:
        future += timedelta(days=1)
    future = future.replace(hour=11, minute=0, second=0, microsecond=0)
    done = conv.handle_postback(
        uid,
        "action=reserve&item=棉被單人",
        {"datetime": future.strftime("%Y-%m-%dT%H:%M")},
    )
    assert "記下" in texts(done)


def test_query_ready_and_not():
    uid = "UflowqueryA" + str(int(time.time() * 1000))[-8:]
    ask = conv.handle(uid, "物件查詢")
    assert "客號" in texts(ask) or "洗號" in texts(ask)
    mixed = conv.handle(uid, "0028")
    blob = texts(mixed)
    assert "可以取了" in blob, blob
    assert "還沒好" in blob, blob
    uid2 = "UflowqueryB" + str(int(time.time() * 1000))[-8:]
    conv.handle(uid2, "物件查詢")
    waiting = conv.handle(uid2, "1947")
    assert "還沒好" in texts(waiting)
    assert "可以取了" not in texts(waiting)


def test_query_unknown():
    uid = "Uflownone" + str(int(time.time() * 1000))[-8:]
    conv.handle(uid, "物件查詢")
    miss = conv.handle(uid, "0000")
    assert "還沒對到" in texts(miss)


def test_payment_claim_is_manual_and_idempotent():
    uid = "Upaymentclaim01"
    sn.INBOX.write_text("", encoding="utf-8")
    # 隔離會讓真的群組推播失敗。staff_pushed 只代表送到，所以這裡模擬送達成功，不斷言改成假。
    orig_push = sn.push_group
    sn.push_group = lambda row: True
    try:
        _payment_claim_body(uid)
    finally:
        sn.push_group = orig_push


def _payment_claim_body(uid):
    msgs, meta = conv.handle_ex(uid, "我已付款", event_id="evt-payment-claim")
    blob = texts(msgs)
    assert meta["intent"] == "payment_check", meta
    assert meta["notify_staff"] is True, meta
    assert meta["staff_pushed"] is True, meta
    assert "交給櫃台核對" in blob, blob
    assert "以店裡交易紀錄為準" in blob, blob
    assert "傳付款畫面" in json.dumps(msgs, ensure_ascii=False), msgs
    rows = [json.loads(raw) for raw in sn.INBOX.read_text(encoding="utf-8").splitlines() if raw.strip()]
    rows = [row for row in rows if row.get("kind") == "payment_check"]
    assert len(rows) == 1, rows
    assert rows[0]["kind"] == "payment_check", rows[0]
    assert rows[0]["event_id"] == "evt-payment-claim", rows[0]
    assert "已付款" not in rows[0].get("status", ""), rows[0]

    conv.handle_ex(uid, "我已付款", event_id="evt-payment-claim")
    rows2 = [json.loads(raw) for raw in sn.INBOX.read_text(encoding="utf-8").splitlines() if raw.strip()]
    rows2 = [row for row in rows2 if row.get("kind") == "payment_check"]
    assert len(rows2) == 1, rows2


def test_payment_way_is_not_payment_claim():
    uid = "Upaymentway01"
    sn.INBOX.write_text("", encoding="utf-8")
    _msgs, meta = conv.handle_ex(uid, "付款方式")
    assert meta["intent"] != "payment_check", meta
    assert not sn.INBOX.read_text(encoding="utf-8").strip()


def test_payment_proof_photo_stays_manual():
    uid = "Upaymentphoto1"
    sn.INBOX.write_text("", encoding="utf-8")
    conv.handle_ex(uid, "我付好了", event_id="evt-payment-text")
    msgs, meta = conv.handle_ex(uid, "photos/payment-proof.jpg", "image", event_id="evt-payment-photo")
    blob = texts(msgs)
    assert meta["intent"] == "payment_check", meta
    assert meta["notify_staff"] is True, meta
    assert "先不用重複付款" in blob, blob
    rows = [json.loads(raw) for raw in sn.INBOX.read_text(encoding="utf-8").splitlines() if raw.strip()]
    rows = [row for row in rows if row.get("kind") == "payment_check"]
    assert len(rows) == 2, rows
    assert rows[-1]["kind"] == "payment_check", rows[-1]
    assert rows[-1]["photo"] == "photos/payment-proof.jpg", rows[-1]
    assert rows[-1]["case_id"] == rows[0]["case_id"], rows


def test_image_event_notifies_staff():
    """M8：image 事件走 handle_ex 且看板收到 [客人傳了照片]。"""
    import base64
    import hashlib
    import hmac

    lw = importlib.import_module("line_webhook")
    body = json.dumps(
        {
            "events": [
                {
                    "type": "message",
                    "replyToken": "r-img-m8",
                    "source": {"type": "user", "userId": "Uimgm8testxxxx"},
                    "message": {"type": "image", "id": "1"},
                }
            ]
        }
    ).encode()
    sig = base64.b64encode(hmac.new(lw.SECRET, body, hashlib.sha256).digest()).decode()
    before = sn.INBOX.read_text(encoding="utf-8") if sn.INBOX.exists() else ""
    r = lw.app.test_client().post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": sig},
    )
    assert r.status_code == 200, r.status_code
    after = sn.INBOX.read_text(encoding="utf-8") if sn.INBOX.exists() else ""
    assert "[客人傳了照片]" in after, after
    assert after != before


if __name__ == "__main__":
    install_isolation(fixture=True)
    test_lookup_ready_and_not_ready()
    test_missing_customer()
    test_menu_pickup_then_address()
    test_menu_store_booking()
    test_query_ready_and_not()
    test_query_unknown()
    test_payment_claim_is_manual_and_idempotent()
    test_payment_way_is_not_payment_claim()
    test_payment_proof_photo_stays_manual()
    test_image_event_notifies_staff()
    print("PASS", 10)
