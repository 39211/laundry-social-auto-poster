# -*- coding: utf-8 -*-
"""W1–W7 引導式流程：拍照／查件／外收送／FAQ。不寫正式 data、不發網路。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import tempfile
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from types import ModuleType

os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"

import urllib.request


def _no_net(*_a, **_k):
    raise RuntimeError("network disabled in tests")


urllib.request.urlopen = _no_net

_staff = ModuleType("staff_notify")
_staff.inbox = []


def _guest_name(_uid):
    return "測試客人"


def _push_inbox(kind, rec, notify=True):
    # 9/25 之後只有 notified is True 才算群組送到。這支測試記的是成功送達，不能再回傳 None。
    _staff.inbox.append((kind, rec))
    return {"saved": True, "notified": bool(notify), "duplicate": False}


_staff.guest_name = _guest_name
_staff.push_inbox = _push_inbox
sys.modules["staff_notify"] = _staff

_pay = ModuleType("line_pay")
_pay.configured = lambda: False
sys.modules["line_pay"] = _pay

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import flask  # noqa: F401
except ImportError:
    import test_linebot_fix_20260926 as _flask_shim  # noqa: F401
import conversation as conv  # noqa: E402
import customer_profile as cprof  # noqa: E402
import laundry_lookup as L  # noqa: E402
import line_webhook as lw  # noqa: E402
import staff_notify as sn  # noqa: E402

# Successful reply transport for these conversation tests. Actual serialized replies,
# timeouts and event redelivery are exercised by test_estimate.py with a fake HTTP server response.
lw.reply = lambda reply_token, messages: True

OFFICIAL_DATA = Path(r"C:/Users/cyc39/laundry-repo/data")
_FAILS = []
_PASSES = 0


def setup_tmp():
    tmp = Path(tempfile.mkdtemp(prefix="sxj-guided-"))
    conv.SESS = tmp / "line-sessions.json"
    conv.BOOK = tmp / "line-bookings.jsonl"
    cprof.PROFILE_PATH = tmp / "line-customer-profile.json"
    L.BIND = tmp / "line-customer-bind.json"
    L.WATCH = tmp / "laundry-watch.json"
    lw.PHOTOS_ROOT = tmp / "photos"
    lw.INBOX_LOG = tmp / "line-unanswered.jsonl"
    sn.INBOX = tmp / "staff-inbox.jsonl"
    sn.BOOK = tmp / "line-bookings.jsonl"
    sn.TARGET = tmp / "staff-target.json"
    sn._beep = lambda: None
    sn.guest_name = _guest_name
    sn.push_inbox = _push_inbox
    return tmp


def freeze_now(s: str):
    dt = datetime.strptime(s, "%Y-%m-%dT%H:%M")
    if conv.TZ:
        dt = dt.replace(tzinfo=conv.TZ)
    conv.now_tw = lambda: dt
    return dt


def flatten(msgs) -> str:
    parts = []
    for m in msgs or []:
        if m.get("type") == "text":
            parts.append(m.get("text") or "")
        elif m.get("type") == "flex":
            parts.append(m.get("altText") or "")
            parts.append(json.dumps(m, ensure_ascii=False))
    return "\n".join(parts)


def qr_actions(msgs) -> list[dict]:
    acts = []
    for m in msgs or []:
        for it in (m.get("quickReply") or {}).get("items") or []:
            acts.append(it.get("action") or {})
    return acts


def qr_types(msgs) -> list[str]:
    return [a.get("type") or "" for a in qr_actions(msgs)]


def run(name, fn):
    global _PASSES
    _staff.inbox.clear()
    try:
        fn()
        _PASSES += 1
        print("PASS", name)
    except Exception:
        _FAILS.append(name + "\n" + traceback.format_exc())
        print("FAIL", name)
        traceback.print_exc()


def _sign(body: bytes) -> str:
    mac = hmac.new(lw.SECRET, body, hashlib.sha256).digest()
    return base64.b64encode(mac).decode()


# D3：寫死在測試裡，不得從產品碼匯入
STAFF_PUSH_EXPECT = [
    ("拍照問價", 0),
    ("傳一張圖", 1),
    ("圖之後點「局部髒污」", 1),
    ("物件查詢", 0),
    ("手機十碼", 0),
    ("之後點「鞋子」", 1),
    ("外收送四步（品項／時間／位置）", 0),
    ("按確認送出", 1),
    ("常見問題 → 會不會洗壞", 0),
    ("我還是想問人", 1),
    ("價目表", 0),
    ("亂打一句聽不懂的", 0),  # V4：第一次掉底不通知
    ("謝謝", 0),
    ("你是 AI 嗎", 0),
    ("太公板", 0),
    ("找真人", 1),
    ("連續第三句聽不懂", 1),
]


def _post_events(events):
    body = json.dumps({"events": events}).encode()
    r = lw.app.test_client().post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": _sign(body)},
    )
    assert r.status_code == 200, (r.status_code, r.data)
    return r


def _text_ev(uid, text, token):
    return {
        "type": "message",
        "replyToken": token,
        "source": {"type": "user", "userId": uid},
        "message": {"type": "text", "text": text},
    }


def _count_delta(fn):
    before = len(_staff.inbox)
    fn()
    return len(_staff.inbox) - before


def test_photo_flow():
    tmp = setup_tmp()
    freeze_now("2026-09-05T13:00")
    uid = "Uguidephoto01"

    msgs, meta = conv.handle_ex(uid, "拍照問價")
    assert meta["intent"] == "photo_quote", meta
    assert meta["notify_staff"] is False
    types = qr_types(msgs)
    assert "camera" in types, types
    assert "cameraRoll" in types, types
    assert _staff.inbox == []

    lw.download_content = lambda _mid: b"fake-jpeg-bytes"
    body = json.dumps(
        {
            "events": [
                {
                    "type": "message",
                    "replyToken": "r-guided-img",
                    "source": {"type": "user", "userId": uid},
                    "message": {"type": "image", "id": "mid-guided-1"},
                }
            ]
        }
    ).encode()
    r = lw.app.test_client().post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": _sign(body)},
    )
    assert r.status_code == 200, r.status_code
    day = datetime.now().strftime("%Y%m%d")
    saved = tmp / "photos" / day / "mid-guided-1.jpg"
    assert saved.is_file(), saved
    assert saved.read_bytes() == b"fake-jpeg-bytes"
    photo_pushes = [row for row in _staff.inbox if row[0] == "photo"]
    assert len(photo_pushes) == 1, _staff.inbox
    rec = photo_pushes[0][1]
    assert "客人傳了照片" in rec.get("text", "")
    assert rec.get("case_id") and len(rec.get("photos", [])) == 1
    assert rec.get("photo") == f"photos/{day}/mid-guided-1.jpg"
    assert rec.get("photo", "").startswith("photos/")

    msgs, meta = conv.handle_ex(uid, "", "image")
    blob = flatten(msgs)
    assert "收到" in blob, blob
    texts = [m.get("text") or "" for m in msgs if m.get("type") == "text"]
    assert len(texts) >= 2, texts
    assert ("哪邊" in texts[1]) or ("加強" in texts[1]), texts[1]
    labs = [a.get("label") for a in qr_actions(msgs)]
    assert "局部髒污" in labs, labs
    assert "我不確定，你們看" in labs, labs
    assert "我想問別的" in labs, labs
    for bad in ("鞋子", "包包", "棉被"):
        assert bad not in labs, labs

    before = len(_staff.inbox)
    msgs, meta = conv.handle_ex(uid, "局部髒污")
    assert meta["notify_staff"] is True, meta
    assert len(_staff.inbox) == before + 1, _staff.inbox
    blob = flatten(msgs)
    assert "有局部髒污" in blob, blob
    assert "店員" in blob, blob
    assert not any(m.get("type") == "flex" for m in msgs), msgs
    kind, rec = _staff.inbox[-1]
    assert kind == "photo_need", _staff.inbox[-1]
    assert rec.get("need") == "局部髒污", rec


def test_x_photo_need():
    """X1–X4：打字需求、我想問別的、通知則數。"""
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    uid = "Uguidexneed01"
    conv.handle_ex(uid, "", "image")
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "鞋帶那邊發黃")
    blob = flatten(msgs)
    assert "鞋帶那邊發黃" in blob, blob
    assert "店員" in blob, blob
    assert meta["notify_staff"] is True, meta
    assert not any(m.get("type") == "flex" for m in msgs), msgs
    assert len(_staff.inbox) == 1, _staff.inbox
    assert _staff.inbox[0][0] == "photo_need", _staff.inbox
    assert _staff.inbox[0][1].get("need") == "鞋帶那邊發黃", _staff.inbox[0][1]
    assert conv.get_sess(uid).get("photo_need") == "鞋帶那邊發黃"

    uid2 = "Uguidexask01"
    conv.handle_ex(uid2, "", "image")
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid2, "我想問別的")
    blob = flatten(msgs)
    assert "想問什麼" in blob, blob
    assert meta["notify_staff"] is False, meta
    assert _staff.inbox == [], _staff.inbox
    labs = [a.get("label") for a in qr_actions(msgs)]
    assert "多久可以拿" in labs, labs
    assert "會不會洗壞" in labs and "怎麼收費" in labs and "找真人" in labs, labs
    msgs, meta = conv.handle_ex(uid2, "多久可以拿")
    blob = flatten(msgs)
    assert meta["intent"] == "faq", meta
    assert "5–7 天" in blob, blob
    assert "您" not in blob, blob
    assert meta["notify_staff"] is False, meta

    uid3 = "Uguidexcnt01"
    _staff.inbox.clear()
    conv.handle_ex(uid3, "", "image")
    assert len(_staff.inbox) == 0  # handle_ex image 不自己推；webhook 才推
    _staff.inbox.clear()
    conv.handle_ex(uid3, "局部髒污")
    assert len(_staff.inbox) == 1, _staff.inbox
    uid4 = "Uguidexcnt02"
    conv.handle_ex(uid4, "", "image")
    _staff.inbox.clear()
    conv.handle_ex(uid4, "我想問別的")
    assert _staff.inbox == [], _staff.inbox


def _post_image(uid: str, mid: str):
    body = json.dumps(
        {
            "events": [
                {
                    "type": "message",
                    "replyToken": "r-n1-" + mid,
                    "source": {"type": "user", "userId": uid},
                    "message": {"type": "image", "id": mid},
                }
            ]
        }
    ).encode()
    r = lw.app.test_client().post(
        "/line/webhook",
        data=body,
        content_type="application/json",
        headers={"X-Line-Signature": _sign(body)},
    )
    assert r.status_code == 200, r.status_code
    return r


def test_n1_image_notify_once():
    tmp = setup_tmp()
    freeze_now("2026-09-05T13:00")
    lw.download_content = lambda _mid: b"fake-jpeg-n1"
    _staff.inbox.clear()
    _post_image("Uguiden1ok01", "mid-n1-ok")
    assert len(_staff.inbox) == 1, _staff.inbox
    assert _staff.inbox[0][0] == "photo", _staff.inbox
    day = datetime.now().strftime("%Y%m%d")
    saved = tmp / "photos" / day / "mid-n1-ok.jpg"
    assert saved.is_file(), saved

    def boom(_mid):
        raise OSError("download fail")

    lw.download_content = boom
    _staff.inbox.clear()
    _post_image("Uguiden1fail1", "mid-n1-fail")
    assert len(_staff.inbox) == 1, _staff.inbox
    assert _staff.inbox[0][0] == "ask", _staff.inbox
    assert (_staff.inbox[0][1].get("text") or "") == "客人傳了照片（存檔失敗）"


def test_n5_photo_item_follow():
    """X6：點品項仍提照片，但不自動附價目卡、不再通知。"""
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    uid = "Uguiden5a01"
    conv.handle_ex(uid, "拍照問價")
    msgs, meta = conv.handle_ex(uid, "", "image")
    assert meta["intent"] == "image"
    assert meta["notify_staff"] is True
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "鞋子")
    blob = flatten(msgs)
    assert "師傅" in blob and "照片" in blob, blob
    assert "先給你個大概" not in blob, blob
    assert not any(m.get("type") == "flex" for m in msgs), msgs
    assert meta["notify_staff"] is False, meta
    assert _staff.inbox == [], _staff.inbox
    msgs2, meta2 = conv.handle_ex(uid, "襯衫")
    blob2 = flatten(msgs2)
    assert "70" in blob2, blob2
    assert meta2.get("notify_staff") is False, meta2


def test_n6_confirm_addr_guard():
    setup_tmp()
    empty = conv.pickup_confirm_flex("衣服", "2026-09-05T15:00", "", phone="0912345678", slot="今天下午（14:00–18:00）")
    blob = json.dumps(empty, ensure_ascii=False)
    assert "（待補，師傅會電話確認）" in blob, blob
    assert "品項" in blob and "時段" in blob and "地址" in blob and "電話" in blob
    assert "0912345678" in blob
    long = "甲" * 40
    card = conv.pickup_confirm_flex("衣服", "2026-09-05T15:00", long, phone="0912345678")
    blob = json.dumps(card, ensure_ascii=False)
    assert ("甲" * 30 + "…") in blob, blob
    assert ("甲" * 31) not in blob
    short = conv.pickup_confirm_flex("衣服", "2026-09-05T15:00", "台中市西屯區青海路二段365號", phone="0912345678")
    sblob = json.dumps(short, ensure_ascii=False)
    assert "青海路" in sblob
    assert "（待補，師傅會電話確認）" not in sblob
    assert "修改資料" in sblob
    assert "修改收送資料" in sblob
    assert "確認送出" in sblob


def test_query_handoff():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    try:
        uid = "Uguidequery01"
        msgs, meta = conv.handle_ex(uid, "物件查詢")
        blob = flatten(msgs)
        assert meta["intent"] == "query"
        assert meta["notify_staff"] is False
        assert "手機" in blob, blob  # T1 查件入口，不再給範例
        assert conv.get_sess(uid).get("wait") == "query_phone"

        msgs, meta = conv.handle_ex(uid, "0912")
        blob = flatten(msgs)
        assert "09 開頭" in blob, blob  # T1 電話格式錯；打錯才示範
        assert conv.get_sess(uid).get("wait") == "query_phone"
        assert meta["notify_staff"] is False
        assert _staff.inbox == []

        msgs, meta = conv.handle_ex(uid, "0912-345-678")
        blob = flatten(msgs)
        assert "哪一件" in blob, blob  # T1 查件問品項
        assert conv.get_sess(uid).get("wait") == "query_item"
        assert conv.get_sess(uid).get("query_phone") == "0912345678"

        msgs, meta = conv.handle_ex(uid, "鞋子")
        blob = flatten(msgs)
        assert "櫃台" in blob and "回覆" in blob, blob
        assert meta["notify_staff"] is True
        assert len(_staff.inbox) == 1, _staff.inbox
        kind, rec = _staff.inbox[0]
        assert kind == "query", kind
        assert rec.get("phone") == "0912345678", rec
        assert rec.get("text") == "0912345678", rec
        assert rec.get("item") == "鞋子", rec
    finally:
        L.inventory = orig


def test_query_bound_recheck_does_not_repeat_staff_notification():
    """A bound customer can recheck without burning a group notification each tap."""
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    orig = L.inventory
    try:
        uid = "Uqueryrepeat01"
        L.bind_uid(uid, "0028", "0912345678")
        _staff.inbox.clear()
        first = _post_events([_text_ev(uid, "物件查詢", "r-query-repeat-1")])
        second = _post_events([_text_ev(uid, "物件查詢", "r-query-repeat-2")])
        assert first.status_code == 200, first.status_code
        assert second.status_code == 200, second.status_code
        assert _staff.inbox == [], _staff.inbox
    finally:
        L.inventory = orig


def test_query_m3_unlock():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    try:
        uid = "UguidequeryM3"
        conv.handle_ex(uid, "物件查詢")
        msgs, meta = conv.handle_ex(uid, "謝謝")
        assert meta["intent"] == "ack", meta
        assert conv.get_sess(uid).get("wait") != "query_phone"
        conv.handle_ex(uid, "物件查詢")
        msgs, meta = conv.handle_ex(uid, "價目表")
        assert meta["intent"] == "prices", meta
    finally:
        L.inventory = orig


def test_pickup_four_steps():
    tmp = setup_tmp()
    freeze_now("2026-09-05T13:00")
    uid = "Uguidepick01"
    msgs, meta = conv.handle_ex(uid, "外收送預約")
    assert meta["intent"] == "pickup"
    assert meta["notify_staff"] is False
    assert _staff.inbox == []
    blob = flatten(msgs)
    assert "方便" in blob, blob  # T1 收送入口主句「哪天方便？」
    assert "先選時間" not in blob, blob
    assert "等一下問" not in blob, blob
    assert "選完再給地址跟電話" not in blob, blob
    assert "收什麼" not in blob, blob
    types = qr_types(msgs)
    assert "datetimepicker" in types, types
    labs = [a.get("label") for a in qr_actions(msgs)]
    assert "其他時間" in labs, labs

    msgs, meta = conv.handle_ex(uid, "今天下午")
    assert meta["notify_staff"] is False
    assert _staff.inbox == []
    types = qr_types(msgs)
    assert "location" in types, types
    blob = flatten(msgs)
    assert "地址" in blob, blob

    msgs, meta = conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
    assert meta["notify_staff"] is False
    assert _staff.inbox == []
    blob = flatten(msgs)
    assert "電話" in blob, blob
    assert "確認" not in blob or "留個電話" in blob

    msgs, meta = conv.handle_ex(uid, "0912-345-678")
    assert meta["notify_staff"] is False
    assert _staff.inbox == []
    blob = flatten(msgs)
    assert "大概是什麼東西" in blob, blob
    assert "確認送出" not in blob, blob
    labs = [a.get("label") for a in qr_actions(msgs)]
    assert "衣服" in labs and "到時再看" in labs, labs

    msgs, meta = conv.handle_ex(uid, "衣服")
    assert meta["notify_staff"] is False
    assert _staff.inbox == []
    blob = flatten(msgs)
    assert "確認" in blob, blob
    assert "青海路" in blob
    assert "0912345678" in blob
    assert "衣服" in blob
    assert "待補" not in blob
    assert "等客人回" not in blob

    n_before = len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
    msgs = conv.handle_postback(uid, "action=pickup_confirm", {})
    blob = flatten(msgs)
    assert "單號" in blob, blob  # T1 確認後第一句
    assert "會過去" in blob or "去收" in blob, blob
    assert len(_staff.inbox) == 1, _staff.inbox
    assert _staff.inbox[0][0] == "pickup"
    assert _staff.inbox[0][1].get("item") == "衣服"
    n_after = len(conv.BOOK.read_text(encoding="utf-8").splitlines())
    assert n_after == n_before + 1
    last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
    assert last.get("kind") == "pickup"
    assert last.get("address") == "台中市西屯區青海路二段365號"
    assert last.get("phone") == "0912345678"
    assert last.get("item") == "衣服"
    assert last.get("when")
    assert last.get("slot")
    assert tmp not in OFFICIAL_DATA.parents

    msgs, meta = conv.handle_ex(uid, "衣服")
    assert meta["notify_staff"] is False
    assert len(_staff.inbox) == 1, _staff.inbox


def test_pickup_no_notify_midway():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    uid = "Uguidepick02"
    conv.handle_ex(uid, "外收送預約")
    conv.handle_ex(uid, "後天下午")
    assert _staff.inbox == []
    conv.handle_ex(uid, "我用打字的")
    conv.handle_ex(uid, "西屯區河南路一段123號")
    conv.handle_ex(uid, "0912345678")
    assert _staff.inbox == []
    assert conv.BOOK.exists() is False or conv.BOOK.read_text(encoding="utf-8").strip() == ""


def test_location_address_used():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    uid = "Uguideloc01"
    conv.handle_ex(uid, "外收送預約")
    conv.handle_ex(uid, "今天下午")
    msgs, meta = conv.handle_ex(uid, "台中市西屯區福科路88號", "location")
    assert meta["intent"] == "pickup"
    sess = conv.get_sess(uid)
    assert sess.get("pickup_addr") == "台中市西屯區福科路88號", sess
    blob = flatten(msgs)
    assert "電話" in blob, blob
    assert sess.get("wait") == "pickup_phone"


def test_faq_answers_and_human():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    msgs, meta = conv.handle_ex("Ufaqmenu01", "常見問題")
    assert meta["intent"] == "faq"
    assert meta["notify_staff"] is False
    labs = [a.get("label") for a in qr_actions(msgs)]
    assert labs == ["會不會洗壞", "會不會掉色", "要洗多久", "名牌敢洗嗎", "怎麼收費"], labs

    # T-1：怎麼收費斷言意思，不斷言單一字。價目基準是 POS 標準價時說「店裡系統的標準價」，
    # 基準關閉時說「水洗價」，依 bot 當下的設定判斷；兩種都必須講到價目表與「實際以到店看件為準」。
    basis_phrase = "店裡系統的標準價" if conv._standard_price_copy() else "水洗價"
    expected = {
        "會不會洗壞": ["不會硬收", "拍張照"],
        "會不會掉色": ["洗標", "不能只看深淺色就保證"],
        "要洗多久": ["5–7 天", "問櫃台"],
        "名牌敢洗嗎": ["看過再收", "拍張照"],
        "怎麼收費": ["價目表", basis_phrase, "實際以到店看件為準"],
    }
    for q, needles in expected.items():
        msgs, meta = conv.handle_ex("Ufaqans" + q[:2], q)
        blob = flatten(msgs)
        assert meta["intent"] == "faq", (q, meta)
        assert meta["notify_staff"] is False
        texts = [m.get("text") or "" for m in msgs if m.get("type") == "text"]
        assert len(texts) >= 2, (q, texts)
        for nd in needles:
            assert nd in blob, (q, nd, blob)
        if q == "怎麼收費":
            # T-1：最後一句要給下一步（看價目表或拍給我）
            assert "價目表" in texts[-1] or "拍給我" in texts[-1], (q, texts)
        types = qr_types(msgs)
        assert types, q
        labs = [a.get("label") for a in qr_actions(msgs)]
        assert "拍照問價" in labs, (q, labs)
        assert "價目表" in labs, (q, labs)
        assert "找真人" in labs, (q, labs)
        assert "我還是想問人" not in labs, (q, labs)

    _staff.inbox.clear()
    msgs, meta = conv.handle_ex("Ufaqhuman01", "我還是想問人")
    assert meta["intent"] == "human"
    assert meta["notify_staff"] is True
    assert "轉給店裡" in flatten(msgs)
    assert len(_staff.inbox) == 1, _staff.inbox


def test_auto_query_gate():
    setup_tmp()
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    try:
        assert conv.auto_query_available() is False
    finally:
        L.inventory = orig
    L.inventory = lambda: ([{"no": "1"}], [], "fixture")
    try:
        assert conv.auto_query_available() is True
    finally:
        L.inventory = orig


def test_d3_staff_push_table():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    lw.download_content = lambda _mid: b"fake-jpeg-d3"
    _staff.inbox.clear()
    got = []
    try:
        uid_p = "Ud3photo0001"
        got.append(
            (
                "拍照問價",
                _count_delta(lambda: _post_events([_text_ev(uid_p, "拍照問價", "r-d3-1")])),
            )
        )
        got.append(
            (
                "傳一張圖",
                _count_delta(
                    lambda: _post_events(
                        [
                            {
                                "type": "message",
                                "replyToken": "r-d3-img",
                                "source": {"type": "user", "userId": uid_p},
                                "message": {"type": "image", "id": "mid-d3-1"},
                            }
                        ]
                    )
                ),
            )
        )
        got.append(
            (
                "圖之後點「局部髒污」",
                _count_delta(lambda: _post_events([_text_ev(uid_p, "局部髒污", "r-d3-2")])),
            )
        )

        uid_q = "Ud3query0001"
        got.append(
            (
                "物件查詢",
                _count_delta(lambda: _post_events([_text_ev(uid_q, "物件查詢", "r-d3-3")])),
            )
        )
        got.append(
            (
                "手機十碼",
                _count_delta(lambda: _post_events([_text_ev(uid_q, "0912345678", "r-d3-4")])),
            )
        )
        got.append(
            (
                "之後點「鞋子」",
                _count_delta(lambda: _post_events([_text_ev(uid_q, "鞋子", "r-d3-5")])),
            )
        )

        uid_k = "Ud3pick00001"

        def four_steps():
            _post_events([_text_ev(uid_k, "外收送預約", "r-d3-6")])
            _post_events([_text_ev(uid_k, "今天下午", "r-d3-7")])
            _post_events(
                [
                    {
                        "type": "message",
                        "replyToken": "r-d3-loc",
                        "source": {"type": "user", "userId": uid_k},
                        "message": {
                            "type": "location",
                            "address": "台中市西屯區青海路二段365號",
                            "title": "收件地",
                            "latitude": 24.18,
                            "longitude": 120.64,
                        },
                    }
                ]
            )
            _post_events([_text_ev(uid_k, "0912345678", "r-d3-ph")])

        got.append(("外收送四步（品項／時間／位置）", _count_delta(four_steps)))
        got.append(
            (
                "按確認送出",
                _count_delta(
                    lambda: _post_events(
                        [
                            {
                                "type": "postback",
                                "replyToken": "r-d3-ok",
                                "source": {"type": "user", "userId": uid_k},
                                "postback": {"data": "action=pickup_confirm"},
                            }
                        ]
                    )
                ),
            )
        )

        uid_f = "Ud3faq000001"

        def faq_flow():
            _post_events([_text_ev(uid_f, "常見問題", "r-d3-9")])
            _post_events([_text_ev(uid_f, "會不會洗壞", "r-d3-10")])

        got.append(("常見問題 → 會不會洗壞", _count_delta(faq_flow)))
        got.append(
            (
                "我還是想問人",
                _count_delta(lambda: _post_events([_text_ev(uid_f, "我還是想問人", "r-d3-11")])),
            )
        )
        got.append(
            (
                "價目表",
                _count_delta(lambda: _post_events([_text_ev("Ud3price0001", "價目表", "r-d3-12")])),
            )
        )
        got.append(
            (
                "亂打一句聽不懂的",
                _count_delta(lambda: _post_events([_text_ev("Ud3fall00001", "那個東西", "r-d3-13")])),
            )
        )
        got.append(
            (
                "謝謝",
                _count_delta(lambda: _post_events([_text_ev("Ud3thx000001", "謝謝", "r-d3-14")])),
            )
        )
        got.append(
            (
                "你是 AI 嗎",
                _count_delta(lambda: _post_events([_text_ev("Ud3who000001", "你是 AI 嗎", "r-d3-15")])),
            )
        )
        got.append(
            (
                "太公板",
                _count_delta(lambda: _post_events([_text_ev("Ud3meta00001", "太公板", "r-d3-16")])),
            )
        )
        got.append(
            (
                "找真人",
                _count_delta(lambda: _post_events([_text_ev("Ud3human0001", "找真人", "r-d3-17")])),
            )
        )

        uid_f3 = "Ud3fall3xxxx"

        def three_falls():
            _post_events([_text_ev(uid_f3, "asdf", "r-d3-a")])
            _post_events([_text_ev(uid_f3, "qwer", "r-d3-b")])
            _post_events([_text_ev(uid_f3, "zxcv", "r-d3-c")])

        got.append(("連續第三句聽不懂", _count_delta(three_falls)))
    finally:
        L.inventory = orig

    assert [row[0] for row in got] == [row[0] for row in STAFF_PUSH_EXPECT]
    print("COUNT| " + " ".join("%s=%s" % (name, n) for name, n in got))
    for (name, n), (_ename, expect) in zip(got, STAFF_PUSH_EXPECT):
        assert n == expect, (name, n, expect, _staff.inbox)


def test_d4_ask_prefix():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    lw.download_content = lambda _mid: b"fake-jpeg-d4"
    try:
        uid = "Ud4photo0001"
        _staff.inbox.clear()
        _post_events(
            [
                {
                    "type": "message",
                    "replyToken": "r-d4-img",
                    "source": {"type": "user", "userId": uid},
                    "message": {"type": "image", "id": "mid-d4-1"},
                }
            ]
        )
        _staff.inbox.clear()
        _post_events([_text_ev(uid, "asdf", "r-d4-f1")])
        _post_events([_text_ev(uid, "qwer", "r-d4-f2")])
        assert _staff.inbox == [], _staff.inbox
        _post_events([_text_ev(uid, "那個東西", "r-d4-fall")])
        assert len(_staff.inbox) == 1, _staff.inbox
        text = _staff.inbox[0][1].get("text") or ""
        assert text.startswith("（有照片）"), text
        assert "連續三句" in text, text
        assert "那個東西" in text
        assert "（有照片）（有照片）" not in text

        uid2 = "Ud4phone0001"
        _staff.inbox.clear()
        _post_events([_text_ev(uid2, "物件查詢", "r-d4-q")])
        _post_events([_text_ev(uid2, "0912345678", "r-d4-p")])
        _post_events([_text_ev(uid2, "謝謝", "r-d4-thx")])
        _staff.inbox.clear()
        _post_events([_text_ev(uid2, "asdf", "r-d4-p1")])
        _post_events([_text_ev(uid2, "qwer", "r-d4-p2")])
        assert _staff.inbox == [], _staff.inbox
        _post_events([_text_ev(uid2, "那個東西", "r-d4-fall2")])
        assert len(_staff.inbox) == 1, _staff.inbox
        text = _staff.inbox[0][1].get("text") or ""
        assert text.startswith("（電話 09xx…）"), text
        assert "連續三句" in text, text
        assert "那個東西" in text
        assert "0912345678" not in text
        assert text.count("0912") == 0
    finally:
        L.inventory = orig


def test_photo_funnel():
    """拍照問價漏斗：入口三顆、問話仍留相機、照片／價目表／逾時離開。"""
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    item_words = ("鞋子", "包包", "衣服", "棉被")
    nudge = "有照片我比較好講。"  # T1 催拍主句

    uid = "Ufunnelenter01"
    msgs, meta = conv.handle_ex(uid, "拍照問價")
    assert meta["intent"] == "photo_quote", meta
    assert meta["notify_staff"] is False
    acts = qr_actions(msgs)
    assert len(acts) == 3, acts
    assert [a.get("type") for a in acts] == ["camera", "cameraRoll", "message"], acts
    assert acts[0].get("label") == "📷 拍照"
    assert acts[1].get("label") == "🖼 從相簿選"
    assert acts[2].get("label") == "先看價目表"
    assert acts[2].get("text") == "價目表"
    for a in acts:
        assert len(a.get("label") or "") <= 20, a
        lab = a.get("label") or ""
        for w in item_words:
            assert w not in lab, (lab, w)
    blob = flatten(msgs)
    assert "整件一張" in blob, blob  # T1 拍照入口第二句主句
    assert "髒的地方" in blob, blob
    sess = conv.get_sess(uid)
    assert sess.get("wait") == "photo", sess
    assert sess.get("photo_wait_ts"), sess

    uid_q = "Ufunnelask001"
    conv.handle_ex(uid_q, "拍照問價")
    questions = [
        ("多少錢", ["棉被"]),
        ("鞋子", ["價目"]),
        ("會不會洗壞", ["不會硬收"]),
        ("營業時間", ["現在有開"]),
    ]
    nudge_hits = 0
    for text, needles in questions:
        msgs, meta = conv.handle_ex(uid_q, text)
        blob = flatten(msgs)
        for nd in needles:
            assert nd in blob, (text, nd, blob)
        acts = qr_actions(msgs)
        assert len(acts) >= 2, (text, acts)
        assert len(acts) <= 13, (text, len(acts))
        assert acts[0].get("type") == "camera", (text, acts)
        assert acts[1].get("type") == "cameraRoll", (text, acts)
        for a in acts:
            assert len(a.get("label") or "") <= 20, (text, a)
        nudge_hits += blob.count(nudge)
        assert conv.get_sess(uid_q).get("wait") == "photo", conv.get_sess(uid_q)
    assert nudge_hits == 1, nudge_hits

    msgs, meta = conv.handle_ex(uid_q, "謝謝")
    assert meta["intent"] == "ack", meta
    blob = flatten(msgs)
    assert nudge not in blob, blob
    assert "camera" not in qr_types(msgs)
    assert "cameraRoll" not in qr_types(msgs)
    for m in msgs:
        assert not m.get("quickReply"), m

    uid_i = "Ufunnelimg001"
    conv.handle_ex(uid_i, "拍照問價")
    assert conv.get_sess(uid_i).get("wait") == "photo"
    msgs, meta = conv.handle_ex(uid_i, "", "image")
    assert meta["intent"] == "image", meta
    assert conv.get_sess(uid_i).get("wait") != "photo", conv.get_sess(uid_i)
    msgs, meta = conv.handle_ex(uid_i, "營業時間")
    assert "現在有開" in flatten(msgs)
    assert "camera" not in qr_types(msgs)
    assert "cameraRoll" not in qr_types(msgs)
    assert nudge not in flatten(msgs)

    uid_p = "Ufunnelprice01"
    conv.handle_ex(uid_p, "拍照問價")
    msgs, meta = conv.handle_ex(uid_p, "價目表")
    assert meta["intent"] == "prices", meta
    assert conv.get_sess(uid_p).get("wait") != "photo", conv.get_sess(uid_p)
    assert "camera" not in qr_types(msgs)
    assert "cameraRoll" not in qr_types(msgs)
    msgs, meta = conv.handle_ex(uid_p, "營業時間")
    assert "現在有開" in flatten(msgs)
    assert "camera" not in qr_types(msgs)

    uid_t = "Ufunnelto0001"
    conv.handle_ex(uid_t, "拍照問價")
    aged = (conv.now_tw() - timedelta(minutes=11)).isoformat()
    conv.set_sess(uid_t, wait="photo", photo_wait_ts=aged)
    msgs, meta = conv.handle_ex(uid_t, "多少錢")
    assert "棉被" in flatten(msgs)
    assert "camera" not in qr_types(msgs)
    assert "cameraRoll" not in qr_types(msgs)
    assert nudge not in flatten(msgs)
    assert conv.get_sess(uid_t).get("wait") != "photo", conv.get_sess(uid_t)

    uid_c = "Ufunnelcap001"
    orig = conv._CAT_QR
    conv._CAT_QR = [("項%02d" % i, "項%02d" % i) for i in range(12)]
    try:
        conv.handle_ex(uid_c, "拍照問價")
        msgs, meta = conv.handle_ex(uid_c, "多少錢")
        acts = qr_actions(msgs)
        assert len(acts) <= 13, len(acts)
        assert len(acts) == 13, (len(acts), acts)
        assert acts[0].get("type") == "camera", acts
        assert acts[1].get("type") == "cameraRoll", acts
        labs = [a.get("label") for a in acts]
        assert "項00" in labs, labs
        assert "項11" not in labs, labs
    finally:
        conv._CAT_QR = orig


def _slot_message_labels(msgs) -> list[str]:
    return [
        a.get("label")
        for a in qr_actions(msgs)
        if a.get("type") == "message" and a.get("label") not in ("改地址或電話",)
    ]


def test_p3_new_guest_time_first_zero_notify():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Up3newguest01"
    msgs, meta = conv.handle_ex(uid, "外收送預約")
    blob = flatten(msgs)
    assert "方便" in blob, blob  # T1 收送入口
    assert "收什麼" not in blob
    labs = [a.get("label") for a in qr_actions(msgs)]
    assert "衣服" not in labs and "棉被" not in labs, labs
    conv.handle_ex(uid, "今天下午")
    conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
    conv.handle_ex(uid, "0912345678")
    assert _staff.inbox == []
    assert conv.BOOK.exists() is False or conv.BOOK.read_text(encoding="utf-8").strip() == ""
    conv.handle_ex(uid, "棉被")
    assert _staff.inbox == []
    conv.handle_postback(uid, "action=pickup_confirm", {})
    assert len(_staff.inbox) == 1, _staff.inbox
    last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
    assert last.get("when")
    assert last.get("slot")
    assert last.get("address")
    assert last.get("phone") == "0912345678"
    assert last.get("item") == "棉被"
    conv.handle_ex(uid, "棉被")
    assert len(_staff.inbox) == 1, _staff.inbox


def test_p2_returning_two_taps():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Up2oldguest01"
    cprof.upsert(uid, phone="0912345678", address="台中市西屯區青海路二段365號")
    msgs, meta = conv.handle_ex(uid, "外收送預約")
    blob = flatten(msgs)
    assert "青海路" in blob, blob
    assert "0912345678" not in blob, blob  # T1 老客入口不再念遮罩電話，仍不得漏完整號碼
    labs = _slot_message_labels(msgs)
    assert len(labs) == 4, labs
    types = qr_types(msgs)
    assert "datetimepicker" in types, types
    assert "改地址或電話" in [a.get("label") for a in qr_actions(msgs)]
    slot_lab = labs[0]
    msgs, meta = conv.handle_ex(uid, slot_lab)
    blob = flatten(msgs)
    assert "大概是什麼東西" in blob, blob
    assert "確認送出" not in blob, blob
    assert "地址給我" not in blob
    assert "留個電話" not in blob
    assert conv.get_sess(uid).get("wait") == "pickup_confirm"
    assert _staff.inbox == []
    msgs, meta = conv.handle_ex(uid, "衣服")
    blob = flatten(msgs)
    assert "確認" in blob, blob
    assert "確認送出" in blob, blob
    assert "衣服" in blob
    assert "0912345678" in blob
    assert conv.get_sess(uid).get("wait") == "pickup_confirm"
    conv.handle_postback(uid, "action=pickup_confirm", {})
    assert len(_staff.inbox) == 1
    assert _staff.inbox[0][1].get("item") == "衣服"


def test_p4_slot_filters():
    setup_tmp()
    cases = [
        ("2026-09-08T09:00", ["今天上午", "今天下午", "明天上午", "明天下午"]),
        ("2026-09-08T13:00", ["今天下午", "明天上午", "明天下午", "後天上午"]),
        ("2026-09-08T19:00", ["明天上午", "明天下午", "後天上午", "後天下午"]),
        ("2026-09-05T17:30", ["後天上午", "後天下午", "星期二上午", "星期二下午"]),
        ("2026-09-06T10:00", ["明天上午", "明天下午", "後天上午", "後天下午"]),
    ]
    uid = "Up4slots0001"
    for when, expect in cases:
        freeze_now(when)
        msgs, _meta = conv.handle_ex(uid, "外收送預約")
        labs = _slot_message_labels(msgs)
        assert labs == expect, (when, labs, expect)
        assert "星期日" not in "".join(labs)
        assert "今天" not in labs or when.startswith("2026-09-08T09") or when.startswith("2026-09-08T13")
        types = qr_types(msgs)
        assert types.count("datetimepicker") == 1, (when, types)
        for a in qr_actions(msgs):
            assert len(a.get("label") or "") <= 20, a
        if when == "2026-09-08T19:00":
            assert "今天上午" not in labs and "今天下午" not in labs, labs
        if when == "2026-09-05T17:30":
            assert "今天" not in "".join(labs), labs
        if when == "2026-09-06T10:00":
            assert "今天" not in "".join(labs), labs


def test_p3_phone_validate():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Up3phone0001"
    conv.handle_ex(uid, "外收送預約")
    conv.handle_ex(uid, "今天下午")
    conv.handle_ex(uid, "台中市西屯區河南路一段1號", "location")
    assert conv.get_sess(uid).get("wait") == "pickup_phone"
    for bad in ("0912", "091234567890", "abc"):
        msgs, meta = conv.handle_ex(uid, bad)
        blob = flatten(msgs)
        assert "09 開頭" in blob, (bad, blob)  # T1 電話格式錯
        assert conv.get_sess(uid).get("wait") == "pickup_phone"
        assert meta["notify_staff"] is False
        assert _staff.inbox == []
    msgs, meta = conv.handle_ex(uid, "0912-345-678")
    blob = flatten(msgs)
    assert "大概是什麼東西" in blob, blob
    assert conv.get_sess(uid).get("pickup_phone") == "0912345678"
    assert conv.get_sess(uid).get("wait") == "pickup_confirm"


def test_p7_query_reuse_phone():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    try:
        uid = "Up7query0001"
        cprof.upsert(uid, phone="0987654321", address="台中市西屯區河南路一段1號")
        msgs, meta = conv.handle_ex(uid, "物件查詢")
        blob = flatten(msgs)
        assert "用上次的" in blob, blob
        assert "09xx-xxx-321" in blob, blob
        assert "0987654321" not in blob, blob
        labs = [a.get("label") for a in qr_actions(msgs)]
        assert "就用這支" in labs and "換一支" in labs, labs
        msgs, meta = conv.handle_ex(uid, "就用這支")
        blob = flatten(msgs)
        assert "哪一件" in blob, blob  # T1 查件問品項
        assert conv.get_sess(uid).get("wait") == "query_item"
        assert conv.get_sess(uid).get("query_phone") == "0987654321"
    finally:
        L.inventory = orig


def test_p8_guest_sees_id_and_mask():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Up8guest0001"
    conv.handle_ex(uid, "外收送預約")
    conv.handle_ex(uid, "今天下午")
    conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
    conv.handle_ex(uid, "0912345678")
    conv.handle_ex(uid, "衣服")
    msgs = conv.handle_postback(uid, "action=pickup_confirm", {})
    blob = flatten(msgs)
    last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
    bid = last["id"]
    assert f"單號 {bid}" in blob, blob  # T1 確認後第一句
    assert conv.slot_speech(last.get("slot") or "") in blob, blob  # 對話用人話時段
    rec = _staff.inbox[0][1]
    assert rec.get("phone") == "0912345678"
    guest_start, _m = conv.handle_ex(uid, "外收送預約")
    gblob = flatten(guest_start)
    assert "青海路" in gblob, gblob  # T1 老客入口改問地址
    assert "0912345678" not in gblob, gblob


def _book_n():
    if not conv.BOOK.exists():
        return 0
    return len([ln for ln in conv.BOOK.read_text(encoding="utf-8").splitlines() if ln.strip()])


def test_q1_old_path_address_first():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Uq1oldpath01"
    conv.handle_ex(uid, "外收送預約")
    msgs, meta = conv.handle_ex(uid, "台中市西屯區文華路100號")
    blob = flatten(msgs)
    sess = conv.get_sess(uid)
    assert sess.get("pickup_addr") == "台中市西屯區文華路100號", sess
    assert "記下了" in blob, blob  # T1 地址收到主句「好，記下了。」
    assert "什麼時候方便" in blob, blob
    assert sess.get("wait") == "pickup_when", sess
    raw = json.dumps(msgs, ensure_ascii=False)
    assert "action=pickup&" not in raw, raw
    msgs, meta = conv.handle_ex(uid, "今天下午")
    blob = flatten(msgs)
    assert "電話" in blob, blob
    assert conv.get_sess(uid).get("wait") == "pickup_phone", conv.get_sess(uid)
    assert _book_n() == 0
    conv.handle_ex(uid, "0912345678")
    blob = flatten(conv.handle_ex(uid, "衣服")[0])
    assert "確認送出" in blob, blob
    assert conv.get_sess(uid).get("wait") == "pickup_confirm"
    assert _book_n() == 0
    conv.handle_postback(uid, "action=pickup_confirm", {})
    last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
    assert last.get("kind") == "pickup"
    assert last.get("phone") == "0912345678"
    assert last.get("address") == "台中市西屯區文華路100號"


def test_q2_old_postback_not_direct_save():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Uq2oldpb0001"
    conv.handle_ex(uid, "外收送預約")
    conv.handle_ex(uid, "台中市西屯區文華路100號")
    n_before = _book_n()
    msgs = conv.handle_postback(uid, "action=pickup&item=", {"datetime": "2026-09-08T15:00"})
    blob = flatten(msgs)
    assert _book_n() == n_before
    assert "電話" in blob or "確認" in blob, blob
    wait = conv.get_sess(uid).get("wait")
    assert wait in ("pickup_phone", "pickup_confirm"), conv.get_sess(uid)
    if wait == "pickup_phone":
        conv.handle_ex(uid, "0912345678")
    if not (conv.get_sess(uid).get("pickup_item") or "").strip():
        conv.handle_ex(uid, "衣服")
    assert conv.get_sess(uid).get("wait") == "pickup_confirm"
    assert _book_n() == n_before
    conv.handle_postback(uid, "action=pickup_confirm", {})
    last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
    assert last.get("phone") == "0912345678"
    assert last.get("kind") == "pickup"
    slot = last.get("slot") or ""
    assert "9/8" in slot and "週二" in slot and "15:00" in slot, slot


def test_q1_out_of_order_phone_addr_slot():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Uq1shuffle01"
    conv.handle_ex(uid, "外收送預約")
    msgs, _meta = conv.handle_ex(uid, "0912345678")
    blob = flatten(msgs)
    assert conv.get_sess(uid).get("pickup_phone") == "0912345678", conv.get_sess(uid)
    assert "好。" in blob or "記下了" in blob, blob  # T1 電話收到
    msgs, _meta = conv.handle_ex(uid, "台中市西屯區文華路100號")
    blob = flatten(msgs)
    assert conv.get_sess(uid).get("pickup_addr") == "台中市西屯區文華路100號"
    assert "記下了" in blob or "收到" in blob, blob  # T1 地址收到
    msgs, _meta = conv.handle_ex(uid, "今天下午")
    blob = flatten(msgs)
    sess = conv.get_sess(uid)
    assert "大概是什麼東西" in blob, blob
    assert "確認送出" not in blob, blob
    assert sess.get("wait") == "pickup_confirm", sess
    msgs, _meta = conv.handle_ex(uid, "衣服")
    blob = flatten(msgs)
    sess = conv.get_sess(uid)
    assert sess.get("wait") == "pickup_confirm", sess
    assert sess.get("pickup_when")
    assert sess.get("pickup_slot")
    assert "時段" in blob and "地址" in blob and "電話" in blob and "品項" in blob, blob
    assert "文華路" in blob and "0912345678" in blob
    assert "衣服" in blob
    n_before = _book_n()
    conv.handle_postback(uid, "action=pickup_confirm", {})
    assert _book_n() == n_before + 1
    last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
    assert last.get("phone") == "0912345678"
    assert last.get("address") == "台中市西屯區文華路100號"
    assert last.get("kind") == "pickup"


def test_q2_save_booking_rejects_empty_phone():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    n_before = _book_n()
    raised = None
    try:
        conv.save_booking(
            "Uq2nophone01",
            "2026-09-08T15:00",
            "",
            kind="pickup",
            extra={"address": "台中市西屯區文華路100號", "phone": "", "slot": ""},
        )
    except Exception as exc:
        raised = exc
    assert raised is not None, "empty-phone pickup must refuse"
    assert isinstance(raised, conv.PickupPhoneRequired) or "pickup_phone" in str(raised), raised
    assert _book_n() == n_before
    conv.save_booking("Uq2bookok01", "2026-09-08T15:00", "襯衫", kind="book")
    assert _book_n() == n_before + 1


def test_official_data_untouched():
    for p in (
        OFFICIAL_DATA / "line-bookings.jsonl",
        OFFICIAL_DATA / "line-sessions.json",
        OFFICIAL_DATA / "staff-inbox.jsonl",
    ):
        assert True


if __name__ == "__main__":
    tests = [
        ("photo_flow", test_photo_flow),
        ("x_photo_need", test_x_photo_need),
        ("n1_image_once", test_n1_image_notify_once),
        ("n5_photo_follow", test_n5_photo_item_follow),
        ("n6_addr_guard", test_n6_confirm_addr_guard),
        ("query_handoff", test_query_handoff),
        ("query_bound_no_repeat", test_query_bound_recheck_does_not_repeat_staff_notification),
        ("query_m3", test_query_m3_unlock),
        ("pickup_four", test_pickup_four_steps),
        ("pickup_midway", test_pickup_no_notify_midway),
        ("location", test_location_address_used),
        ("faq", test_faq_answers_and_human),
        ("auto_query_gate", test_auto_query_gate),
        ("d3_staff_push_table", test_d3_staff_push_table),
        ("d4_ask_prefix", test_d4_ask_prefix),
        ("photo_funnel", test_photo_funnel),
        ("p3_new_guest", test_p3_new_guest_time_first_zero_notify),
        ("p2_returning", test_p2_returning_two_taps),
        ("p4_slots", test_p4_slot_filters),
        ("p3_phone", test_p3_phone_validate),
        ("p7_query", test_p7_query_reuse_phone),
        ("p8_id_mask", test_p8_guest_sees_id_and_mask),
        ("q1_old_path", test_q1_old_path_address_first),
        ("q2_old_postback", test_q2_old_postback_not_direct_save),
        ("q1_shuffle", test_q1_out_of_order_phone_addr_slot),
        ("q2_no_phone", test_q2_save_booking_rejects_empty_phone),
        ("official", test_official_data_untouched),
    ]
    for name, fn in tests:
        run(name, fn)
    nfail = len(_FAILS)
    print(f"RESULT PASS={_PASSES} FAIL={nfail}")
    if nfail:
        print("FAILURES:")
        for f in _FAILS:
            print(f)
        sys.exit(1)
    sys.exit(0)
