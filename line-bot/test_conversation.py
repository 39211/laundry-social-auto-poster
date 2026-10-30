# -*- coding: utf-8 -*-
"""conversation.py 規格測試。隔離暫存目錄，不碰正式 data、不發網路。R7"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
import urllib.request
from datetime import datetime
from pathlib import Path
from types import ModuleType

os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"

# 網路鎖：任何 urlopen 都失敗
def _no_net(*_a, **_k):
    raise RuntimeError("network disabled in tests")


urllib.request.urlopen = _no_net

# staff_notify stub（guest_name 固定、push_inbox 只記錄）
_staff = ModuleType("staff_notify")
_staff.inbox = []


def _guest_name(_uid):
    return "測試客人"


def _push_inbox(kind, rec, **_k):
    _staff.inbox.append((kind, rec))
    return {"saved": True, "notified": True}


_staff.guest_name = _guest_name
_staff.push_inbox = _push_inbox
sys.modules["staff_notify"] = _staff

# line_pay stub：未設定，避免讀 secrets、QR 不出現 LINE Pay
_pay = ModuleType("line_pay")
_pay.configured = lambda: False
sys.modules["line_pay"] = _pay

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conversation as conv  # noqa: E402
import customer_profile as cprof  # noqa: E402
import intents  # noqa: E402
import laundry_lookup as L  # noqa: E402

OFFICIAL_BOOK = Path(r"C:/Users/cyc39/laundry-repo/data/line-bookings.jsonl")
OFFICIAL_SESS = Path(r"C:/Users/cyc39/laundry-repo/data/line-sessions.json")

_FAILS = []
_PASSES = 0
_ALL_MSGS = []


def _meta_path(p: Path):
    if not p.exists():
        return None
    st = p.stat()
    return (st.st_size, int(st.st_mtime))


_OFFICIAL_BEFORE = (_meta_path(OFFICIAL_BOOK), _meta_path(OFFICIAL_SESS))


def setup_tmp():
    tmp = tempfile.mkdtemp(prefix="sxj-conv-")
    conv.SESS = Path(tmp) / "line-sessions.json"
    conv.BOOK = Path(tmp) / "line-bookings.jsonl"
    L.BIND = Path(tmp) / "line-customer-bind.json"
    L.WATCH = Path(tmp) / "laundry-watch.json"
    cprof.PROFILE_PATH = Path(tmp) / "line-customer-profile.json"
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
    return "\n".join(parts)


def check_struct(msgs, where: str):
    assert isinstance(msgs, list), f"{where}: not list {type(msgs)}"
    assert len(msgs) <= 5, f"{where}: {len(msgs)} msgs"
    for m in msgs:
        if m.get("type") == "text":
            t = m.get("text")
            assert t, f"{where}: empty text"
            assert len(t) <= 5000, f"{where}: text too long"
        qr = m.get("quickReply") or {}
        items = qr.get("items") or []
        assert len(items) <= 13, f"{where}: QR {len(items)}"
        for it in items:
            lab = ((it.get("action") or {}).get("label")) or ""
            assert len(lab) <= 20, f"{where}: label {lab!r}"


def check(name, cond, detail=""):
    global _PASSES
    if cond:
        _PASSES += 1
        return True
    _FAILS.append(f"{name}: {detail}")
    print("FAIL", name, detail)
    return False


def run(name, fn):
    global _PASSES
    try:
        fn()
        _PASSES += 1
        print("PASS", name)
    except Exception:
        _FAILS.append(name + "\n" + traceback.format_exc())
        print("FAIL", name)
        traceback.print_exc()


setup_tmp()
freeze_now("2026-09-05T13:00")  # 週六下午，店有開

# 客人句表：13 掉底 + 既有分支 + R1 新品名
CASES = [
    # 掉底 13 列（含列內多句）
    ("羽絨外套多少", "message", "quote", False, ["羽絨外套", "280"]),
    ("西裝", "message", "clarify", False, ["西裝外套"]),
    ("床單", "message", "clarify", False, ["薄"]),
    ("枕頭", "message", "unknown_item", True, ["常規價目", "看件"]),
    ("多少錢", "message", "ask_price", False, ["棉被"]),
    ("可以到府收件嗎", "message", "pickup", False, ["方便"]),  # T1 收送入口改問時間，不再旁白地址
    ("洗好了嗎", "message", "query", False, ["完整手機號碼"]),
    ("我要取消預約", "message", "cancel", False, ["沒有"]),
    ("今天有開嗎", "message", "hours_day", False, ["現在有開"]),
    ("星期日有開嗎", "message", "hours_day", False, ["公休"]),
    ("LV包", "message", "quote", False, ["名牌包", "1500"]),
    ("我在店裡", "message", "in_store", True, ["櫃台"]),
    ("謝謝", "message", "ack", False, ["不客氣"]),
    ("好", "message", "ack", False, ["有需要"]),
    ("ok", "message", "ack", False, ["有需要"]),
    ("😊", "message", "ack", False, ["有需要"]),
    ("窗簾可以洗嗎", "message", "unknown_item", True, ["常規價目"]),
    ("娃娃", "message", "unknown_item", True, ["常規價目"]),
    ("安全帽", "message", "unknown_item", True, ["常規價目"]),
    # 既有能接的分支
    ("你好", "message", "welcome", False, ["私享家"]),
    ("價目表", "message", "prices", False, ["價目"]),
    ("棉被", "message", "clarify", False, ["單人"]),
    ("鞋子", "message", "prices", False, ["價目"]),
    ("包包", "message", "prices", False, ["價目"]),
    ("衣服", "message", "clarify", False, ["襯衫"]),
    ("洗鞋", "message", "clarify", False, ["運動鞋"]),
    ("預約到店", "message", "booking", False, ["時間"]),
    ("外收送預約", "message", "pickup", False, ["方便"]),  # T1 同上
    ("物件查詢", "message", "query", False, ["完整手機號碼"]),
    ("LINE Pay", "message", "pay", False, ["LINE Pay"]),
    ("位置", "message", "location", False, ["至善"]),
    ("電話", "message", "phone", False, ["04-2452-7411"]),
    ("作品案例", "message", "works", False, ["作品"]),
    ("到店禮遇", "message", "courtesy", False, ["禮遇"]),
    ("我想洗", "message", "wash_ask", False, ["棉被"]),
    ("皮衣", "message", "quote", False, ["皮衣", "1200"]),
    ("運動鞋", "message", "quote", False, ["一般運動鞋", "250"]),
    ("營業時間", "message", "hours_day", False, ["現在有開"]),
    ("掉色", "message", "concern", False, ["掉色"]),
    ("趕時間", "message", "concern", True, ["趕"]),  # 現有 urgent 路徑會通知店員
    ("發霉", "message", "concern", False, ["發霉"]),
    ("要洗多久", "message", "faq", False, ["5–7 天"]),
    ("襯衫", "message", "quote", False, ["襯衫", "70"]),
    ("名牌包", "message", "quote", False, ["名牌包", "1500"]),
    # R1 新品名
    ("涼被", "message", "quote", False, ["涼被", "180"]),
    ("睡袋", "message", "quote", False, ["睡袋", "250"]),
    ("皮鞋", "message", "quote", False, ["皮鞋", "400"]),
    ("名牌鞋", "message", "quote", False, ["名牌鞋", "600"]),
    ("背包", "message", "quote", False, ["背包", "500"]),
    ("帽T", "message", "quote", False, ["帽T", "80"]),
    ("牛仔褲", "message", "quote", False, ["牛仔褲", "80"]),
    ("短洋裝", "message", "quote", False, ["短洋裝", "120"]),
    ("羽絨衣", "message", "quote", False, ["羽絨外套", "280"]),
    ("Gucci包", "message", "quote", False, ["名牌包", "1500"]),
    ("被套", "message", "clarify", False, ["薄"]),
    # r3 K1–K7（既有 55 句全留）
    ("包包多少", "message", "clarify", False, ["一般包", "皮包", "名牌"]),
    ("外套", "message", "clarify", False, ["150", "180", "280"]),
    ("外套多少", "message", "clarify", False, ["150", "180", "280"]),
    ("洋裝", "message", "clarify", False, ["短"]),
    ("大衣", "message", "clarify", False, ["大衣"]),
    ("裙子", "message", "clarify", False, ["裙子"]),
    ("褲子", "message", "clarify", False, ["褲"]),
    ("羽絨", "message", "clarify", False, ["羽絨外套"]),
    ("羽絨多少", "message", "clarify", False, ["羽絨外套"]),
    ("乾洗", "message", "wash_type", False, ["另計"]),
    ("水洗", "message", "wash_type", False, ["另計"]),
    ("柔洗", "message", "wash_type", False, ["另計"]),
    ("送洗", "message", "wash_type", False, ["另計"]),
    ("謝謝你", "message", "ack", False, ["不客氣"]),
    ("謝謝您", "message", "ack", False, ["不客氣"]),
    ("感謝你", "message", "ack", False, ["不客氣"]),
    ("感謝您", "message", "ack", False, ["不客氣"]),
    ("thanks", "message", "ack", False, ["有需要"]),
    ("thank you", "message", "ack", False, ["有需要"]),
    ("3Q", "message", "ack", False, ["有需要"]),
    ("感恩", "message", "ack", False, ["不客氣"]),
    ("到了", "message", "in_store", True, ["櫃台"]),
    ("到囉", "message", "in_store", True, ["櫃台"]),
    ("我人到了", "message", "in_store", True, ["櫃台"]),
    ("到店了", "message", "in_store", True, ["櫃台"]),
    # r4 M2–M7
    ("西裝外套", "message", "clarify", False, ["西裝外套"]),
    ("西裝褲", "message", "clarify", False, ["西裝褲"]),
    ("西裝背心", "message", "quote", False, ["西裝背心", "80"]),
    # V4：第一次掉底不通知、文案不再「轉店裡」；T-shirt 不含洗衣字走通用句
    ("T-shirt", "message", "fallback", False, ["不太確定"]),
    ("洗特殊類名牌包多少錢", "message", "quote", False, ["特殊類名牌包", "2500"]),
    ("到門口了", "message", "in_store", True, ["櫃台"]),
    ("你們幾點收件", "message", "hours_day", False, ["營業時間內約"]),
    ("拍照問價", "message", "photo_quote", False, ["拍給我看", "髒的地方"]),  # T1 主句
]


def test_cases():
    assert len(CASES) >= 88, len(CASES)
    for i, (text, et, intent, notify, needles) in enumerate(CASES):
        uid = f"Ucase{i:03d}zzzz"
        _staff.inbox.clear()
        msgs, meta = conv.handle_ex(uid, text, et)
        _ALL_MSGS.append((f"case:{text}", msgs))
        blob = flatten(msgs)
        check_struct(msgs, text)
        assert meta["intent"] == intent, f"{text}: intent {meta['intent']!r} != {intent!r} blob={blob!r}"
        assert bool(meta["notify_staff"]) is bool(notify), (
            f"{text}: notify {meta['notify_staff']!r} != {notify!r} blob={blob!r}"
        )
        assert "staff_pushed" in meta, f"{text}: missing staff_pushed {meta!r}"
        assert bool(meta["staff_pushed"]) is (len(_staff.inbox) > 0), (
            f"{text}: staff_pushed {meta['staff_pushed']!r} inbox={_staff.inbox!r}"
        )
        for nd in needles:
            assert nd in blob, f"{text}: missing {nd!r} in {blob!r}"
        # ack 不得帶 Quick Reply
        if intent == "ack":
            for m in msgs:
                assert not m.get("quickReply"), f"{text}: ack has QR"


def test_sticker_ack():
    msgs, meta = conv.handle_ex("Ustickerzzzz", "", "sticker")
    _ALL_MSGS.append(("sticker", msgs))
    check_struct(msgs, "sticker")
    assert meta["intent"] == "ack"
    assert meta["notify_staff"] is False
    assert "有需要" in flatten(msgs)
    for m in msgs:
        assert not m.get("quickReply")


def test_handle_returns_list():
    r = conv.handle("Ulistzzzzzz", "謝謝")
    assert isinstance(r, list), type(r)
    assert not isinstance(r, tuple)
    assert r and r[0].get("type") == "text"


def test_can_wash_luxury_vs_curtain():
    msgs, meta = conv.handle_ex("Uwasha", "皮衣可以洗嗎")
    _ALL_MSGS.append(("皮衣可以洗嗎", msgs))
    assert meta["intent"] == "concern"
    assert "名牌" in flatten(msgs) or "皮革" in flatten(msgs)
    msgs, meta = conv.handle_ex("Uwashb", "羽絨外套可以洗嗎")
    _ALL_MSGS.append(("羽絨外套可以洗嗎", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "quote"
    assert "280" in blob
    assert "可以，一般都能洗" in blob


def test_catalog_all_exact():
    cat = {}
    for items in conv.CATS.values():
        cat.update(items)
    assert len(cat) >= 109, len(cat)
    for name in cat:
        got = intents.match_item(name, cat)
        assert got == [name], f"{name} -> {got}"


def test_r4_guards():
    uid = "Uguardr4abcd"

    def rejected(when, tag):
        n_before = (
            len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
        )
        msgs = conv.handle_postback(uid, "action=reserve&item=襯衫", {"datetime": when})
        _ALL_MSGS.append((f"r4:{tag}", msgs))
        blob = flatten(msgs)
        assert "沒開" in blob, blob
        n_after = len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
        assert n_after == n_before, f"{tag} wrote booking"

    rejected("2026-09-06T15:00", "sunday")
    rejected("2026-09-08T22:30", "tue-late")
    rejected("2026-09-12T11:00", "sat-early")
    rejected("2026-09-04T15:00", "past")
    # M9：整點邊界（週六 18:00、平日 20:00）
    rejected("2026-09-12T18:00", "sat-close")
    rejected("2026-09-08T20:00", "tue-close")

    # 週二 15:00 應存檔，編號新格式
    msgs = conv.handle_postback(uid, "action=reserve&item=襯衫", {"datetime": "2026-09-08T15:00"})
    _ALL_MSGS.append(("r4:tue-ok", msgs))
    blob = flatten(msgs)
    assert "記下" in blob, blob
    lines = [json.loads(x) for x in conv.BOOK.read_text(encoding="utf-8").splitlines() if x.strip()]
    mine = [r for r in lines if r.get("uid") == uid and r.get("kind") != "cancel"]
    assert mine, "no booking saved"
    bid = mine[-1]["id"]
    assert bid.startswith("P09081500"), bid
    assert bid.endswith("abcd") or bid.endswith("abcd-2"), bid
    assert bid == "P09081500abcd" or bid.startswith("P09081500abcd"), bid

    # 同分鐘第二筆
    msgs2 = conv.handle_postback(uid, "action=reserve&item=襯衫", {"datetime": "2026-09-08T15:00"})
    _ALL_MSGS.append(("r4:dup", msgs2))
    lines = [json.loads(x) for x in conv.BOOK.read_text(encoding="utf-8").splitlines() if x.strip()]
    mine = [r for r in lines if r.get("uid") == uid and r.get("kind") != "cancel"]
    ids = [r["id"] for r in mine]
    assert len(set(ids)) >= 2, ids
    assert any(i != ids[0] for i in ids), ids
    assert "P09081500abcd-2" in ids or any(i.endswith("-2") for i in ids), ids

    # 外收同樣守衛
    uidp = "Upickr4wxyz"
    conv.handle_ex(uidp, "外收送預約")
    conv.handle_ex(uidp, "台中市西屯區青海路二段365號")
    n_before = len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
    msgs = conv.handle_postback(uidp, "action=pickup&item=", {"datetime": "2026-09-06T15:00"})
    _ALL_MSGS.append(("r4:pickup-sun", msgs))
    assert "沒開" in flatten(msgs)
    n_after = len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
    assert n_after == n_before


def test_cancel_flow():
    uid = "Ucancel99mnop"
    conv.handle_postback(uid, "action=reserve&item=襯衫", {"datetime": "2026-09-08T16:00"})
    last = conv.last_active_booking(uid)
    assert last, "need a booking"
    msgs, meta = conv.handle_ex(uid, "我要取消預約")
    _ALL_MSGS.append(("cancel-yes", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "cancel"
    assert meta["notify_staff"] is True
    assert "取消" in blob
    assert conv.last_active_booking(uid) is None
    mine = conv.my_booking(uid)
    _ALL_MSGS.append(("my_booking-after-cancel", mine))
    assert "沒有" in flatten(mine)


def test_fallback_notify_and_copy():
    # V4／V5：第一次掉底不通知、不塞電話、不走舊公板句
    msgs, meta = conv.handle_ex("Ufallaa", "那個東西")
    _ALL_MSGS.append(("fallback", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "fallback"
    assert meta["notify_staff"] is False
    assert "不太確定" in blob
    assert "04-2452-7411" not in blob
    assert "方便說一下" not in blob
    assert "這個我幫您轉店裡問一下" not in blob
    # M9：短輸入必須真的走 fallback（「？」會被判 ack）；V4 前兩次都不通知
    msgs, meta = conv.handle_ex("Ufallab", "z")
    assert meta["intent"] == "fallback", meta
    assert meta["notify_staff"] is False
    msgs, meta = conv.handle_ex("Ufallac", "zz")
    assert meta["intent"] == "fallback", meta
    assert meta["notify_staff"] is False
    assert "04-2452-7411" not in flatten(msgs)


def test_no_line_pay_in_qr():
    msgs, _meta = conv.handle_ex("Upayqr", "襯衫")
    _ALL_MSGS.append(("shirt-qr", msgs))
    for m in msgs:
        qr = m.get("quickReply") or {}
        for it in qr.get("items") or []:
            lab = ((it.get("action") or {}).get("label") or "")
            txt = ((it.get("action") or {}).get("text") or "")
            assert "LINE Pay" not in lab and "LINE Pay" not in txt, lab
    done = conv.handle_postback("Upayqr", "action=reserve&item=襯衫", {"datetime": "2026-09-08T15:00"})
    _ALL_MSGS.append(("booking-ok-footer", done))
    blob = json.dumps(done, ensure_ascii=False)
    assert "LINE Pay" not in blob, "booking_ok still has LINE Pay"
    assert "看位置" in blob or "打電話" in blob


def test_copy_r5():
    msgs, _ = conv.handle_ex("Ucopya", "襯衫")
    blob = flatten(msgs)
    assert "線上我不會跟您說死" not in blob
    assert "實際以到店看件為準" in blob
    msgs, _ = conv.handle_ex("Ucopyb", "", "follow")
    blob = flatten(msgs)
    assert "這裡是私享家" in blob
    assert "拍張照給我就好" in blob


def test_mainland_scan():
    banned = [
        "视" + "频",
        "软" + "件",
        "信" + "息",
        "网" + "络",
        "服" + "务" + "器",
        "用" + "户",
        "质" + "量",
        "默" + "认",
        "打" + "印",
        "鼠" + "标",
        "激" + "活",
        "立" + "马",
        "估" + "计",
        "挺好",
        "靠" + "谱",
        "搞" + "定",
    ]
    root = Path(__file__).resolve().parent
    hits = []
    for fn in ("conversation.py", "intents.py"):
        text = (root / fn).read_text(encoding="utf-8")
        for w in banned:
            if w in text:
                hits.append(f"{fn}:{w}")
    assert not hits, hits
    return banned, hits


def test_official_untouched():
    after = (_meta_path(OFFICIAL_BOOK), _meta_path(OFFICIAL_SESS))
    assert after == _OFFICIAL_BEFORE, f"official data changed { _OFFICIAL_BEFORE} -> {after}"


def _qr_labels(msgs) -> list[str]:
    labs = []
    for m in msgs or []:
        for it in (m.get("quickReply") or {}).get("items") or []:
            labs.append(((it.get("action") or {}).get("label")) or "")
    return labs


def _qr_texts(msgs) -> list[str]:
    texts = []
    for m in msgs or []:
        for it in (m.get("quickReply") or {}).get("items") or []:
            texts.append(((it.get("action") or {}).get("text")) or "")
    return texts


def test_f1_qr_unique_no_pay():
    items = conv.next_qr_items()
    labels = [lab for lab, _txt in items]
    assert len(labels) == len(set(labels)), labels
    assert "LINE Pay" not in labels
    assert all("LINE Pay" not in (txt or "") for _lab, txt in items)
    assert labels == ["這週到店", "先看位置", "先看價目", "打電話"], labels
    msgs, _meta = conv.handle_ex("Uf1qrzzzzzz", "襯衫")
    _ALL_MSGS.append(("f1-shirt-qr", msgs))
    labs = _qr_labels(msgs)
    assert labs, "quote should have QR"
    assert len(labs) == len(set(labs)), labs
    assert "LINE Pay" not in labs
    assert "看位置" not in labs
    assert "打電話" in labs
    assert "門市資訊" in labs


def test_f2_cancel_without_booking():
    uid = "Uf2nobookxx"
    msgs, meta = conv.handle_ex(uid, "我要取消預約")
    _ALL_MSGS.append(("f2-cancel-empty", msgs))
    assert meta["intent"] == "cancel"
    assert meta["notify_staff"] is False
    labs = _qr_labels(msgs)
    texts = []
    for m in msgs:
        for it in (m.get("quickReply") or {}).get("items") or []:
            texts.append(((it.get("action") or {}).get("text")) or "")
    assert "約時間" in labs
    assert "預約到店" in texts


def _enter_pickup_addr(uid: str) -> None:
    conv.handle_ex(uid, "可以到府收件嗎")
    conv.handle_ex(uid, "今天下午")
    conv.handle_ex(uid, "我用打字的")


def test_f3_pickup_addr_ack():
    uid = "Uf3ackaddrxx"
    _enter_pickup_addr(uid)
    sess = conv.get_sess(uid)
    assert sess.get("wait") == "pickup_addr"
    msgs, meta = conv.handle_ex(uid, "謝謝")
    _ALL_MSGS.append(("f3-thanks-as-addr", msgs))
    sess = conv.get_sess(uid)
    assert sess.get("wait") == "pickup_addr", sess
    assert not sess.get("pickup_addr"), sess
    assert meta["notify_staff"] is False
    blob = flatten(msgs)
    assert "地址方便的時候再給我" in blob, blob
    assert "門牌號碼" in blob, blob
    assert not sess.get("pickup_addr"), sess


def test_f4_in_store():
    msgs, meta = conv.handle_ex("Uf4gotitxxx", "拿到了")
    _ALL_MSGS.append(("f4-拿到了", msgs))
    assert meta["intent"] != "in_store", meta
    msgs, meta = conv.handle_ex("Uf4arrivedx", "我到了")
    _ALL_MSGS.append(("f4-我到了", msgs))
    assert meta["intent"] == "in_store"
    assert meta["notify_staff"] is True
    assert "櫃台" in flatten(msgs)


def test_all_struct():
    for where, msgs in _ALL_MSGS:
        check_struct(msgs, where)


def test_r3_quote_guards():
    msgs, meta = conv.handle_ex("Ur3bagxxxxx", "包包多少")
    _ALL_MSGS.append(("r3-包包多少", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "clarify"
    assert meta["notify_staff"] is False
    assert "1000" not in blob, blob
    assert "一般包" in blob and "皮包" in blob and "名牌" in blob

    msgs, meta = conv.handle_ex("Ur3coatxxxx", "外套")
    _ALL_MSGS.append(("r3-外套", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "clarify"
    assert meta["notify_staff"] is False
    assert "450" not in blob, blob
    assert "150" in blob and "180" in blob and "280" in blob

    msgs, meta = conv.handle_ex("Ur3dressxxx", "洋裝")
    _ALL_MSGS.append(("r3-洋裝", msgs))
    assert meta["intent"] == "clarify"
    assert meta["notify_staff"] is False
    labs = _qr_labels(msgs)
    texts = _qr_texts(msgs)
    joined = labs + texts
    assert any("短洋裝" in x for x in joined), joined
    assert any("中洋裝" in x for x in joined), joined
    assert any("長洋裝" in x for x in joined), joined
    assert not any(x.startswith("精品") for x in labs), labs
    assert not any(x.startswith("精品") for x in texts), texts

    msgs, meta = conv.handle_ex("Ur3downxxxx", "羽絨")
    _ALL_MSGS.append(("r3-羽絨", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "clarify"
    assert meta["notify_staff"] is False
    assert "水洗大概 800" not in blob, blob
    assert "羽絨外套" in blob or any("羽絨外套" in x for x in _qr_texts(msgs))

    msgs, meta = conv.handle_ex("Ur3dryxxxxx", "乾洗")
    _ALL_MSGS.append(("r3-乾洗", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "wash_type"
    assert meta["notify_staff"] is False
    assert "另計" in blob

    msgs, meta = conv.handle_ex("Ur3tyxxxxxx", "謝謝你")
    _ALL_MSGS.append(("r3-謝謝你", msgs))
    assert meta["intent"] == "ack"
    assert meta["notify_staff"] is False
    for m in msgs:
        assert not m.get("quickReply")

    msgs, meta = conv.handle_ex("Ur3herexxxx", "到了")
    _ALL_MSGS.append(("r3-到了", msgs))
    assert meta["intent"] == "in_store"
    assert meta["notify_staff"] is True
    assert "櫃台" in flatten(msgs)


def test_r3_normalize_match_ack():
    assert intents.normalize("乾洗") == "乾洗"
    assert intents.normalize("水洗") == "水洗"
    assert intents.normalize("柔洗") == "柔洗"
    cat = {}
    for items in conv.CATS.values():
        cat.update(items)
    names, kind = intents.match_item_ex("外套", cat)
    assert kind == "prefix", kind
    assert "薄外套" in names
    assert "G-T兩件式外套" in names
    names, kind = intents.match_item_ex("我要洗羽絨外套", cat)
    assert kind == "contains", kind
    assert names == ["羽絨外套"], names
    # M9：品名 ⊂ 客人的話取最長（名牌包 ⊂ 特殊類名牌包）
    names, kind = intents.match_item_ex("洗特殊類名牌包", cat)
    assert kind == "contains", kind
    assert names == ["特殊類名牌包"], names
    names, kind = intents.match_item_ex("薄外套", cat)
    assert kind == "exact"
    assert names == ["薄外套"]
    assert intents.is_ack("謝謝你")
    assert intents.is_ack("謝謝您")
    assert intents.is_ack("3Q")
    assert intents.is_ack("thank you")
    assert intents.is_ack("感恩")
    assert not intents.is_ack("拿到了")


def test_r3_hello_pay_hours_booking():
    try:
        freeze_now("2026-09-05T18:30")
        assert conv.hello() == "晚安"
        assert "晚上好" not in conv.hello()
        msgs, meta = conv.handle_ex("Uhoursclose", "今天有開嗎")
        _ALL_MSGS.append(("r3-打烊", msgs))
        blob = flatten(msgs)
        assert meta["intent"] == "hours_day"
        assert "今天已經打烊了" in blob, blob

        freeze_now("2026-09-07T08:00")
        msgs, meta = conv.handle_ex("Uhoursopenx", "今天有開嗎")
        _ALL_MSGS.append(("r3-未開", msgs))
        blob = flatten(msgs)
        assert "今天還沒開" in blob, blob
        assert "10:00" in blob
    finally:
        freeze_now("2026-09-05T13:00")

    msgs, _meta = conv.handle_ex("Upaycopyxxx", "LINE Pay")
    _ALL_MSGS.append(("r3-pay", msgs))
    blob = flatten(msgs)
    assert "商戶" not in blob, blob
    assert "後台" not in blob, blob
    assert "自行輸入" in blob and "店員核對" in blob
    assert "還在開通" not in blob

    uid = "Uk9pastxxxx"
    conv.append_book(
        {"id": "P01011000xxxx", "uid": uid, "when": "2026-01-01T10:00", "kind": "book", "item": "襯衫"}
    )
    conv.append_book(
        {"id": "P09081600xxxx", "uid": uid, "when": "2026-09-08T16:00", "kind": "book", "item": "襯衫"}
    )
    conv.append_book({"id": "P09081600xxxx", "uid": uid, "kind": "cancel"})
    last = conv.last_active_booking(uid)
    assert last is None, last
    mine = conv.my_booking(uid)
    _ALL_MSGS.append(("r3-k9-my", mine))
    assert "沒有" in flatten(mine)


def test_m2_suit_not_vest():
    for text in ("西裝外套", "西裝外套多少", "西裝褲", "西裝褲多少錢"):
        msgs, meta = conv.handle_ex("Um2suitxxxx", text)
        _ALL_MSGS.append((f"m2:{text}", msgs))
        blob = flatten(msgs)
        assert meta["intent"] == "clarify", (text, meta, blob)
        assert "80" not in blob, blob
        assert "西裝背心水洗" not in blob, blob
        assert "到店看件" in blob, blob
    msgs, meta = conv.handle_ex("Um2vestxxxx", "西裝背心")
    blob = flatten(msgs)
    assert meta["intent"] == "quote"
    assert "80" in blob


def test_m3_query_unlock_and_accounts():
    uid = "Um3thxqueryx"
    conv.handle_ex(uid, "洗好了嗎")
    assert conv.get_sess(uid).get("wait") == "query"
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "謝謝")
    _ALL_MSGS.append(("m3-query-thanks", msgs))
    assert meta["intent"] == "ack", meta
    assert "還沒對到" not in flatten(msgs)
    assert conv.get_sess(uid).get("wait") != "query"
    assert bool(meta["notify_staff"]) is False
    assert _staff.inbox == []
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)

    uid = "Um3priceqryx"
    conv.handle_ex(uid, "洗好了嗎")
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "羽絨外套多少")
    _ALL_MSGS.append(("m3-query-price", msgs))
    assert meta["intent"] == "quote", meta
    assert "280" in flatten(msgs)
    assert conv.get_sess(uid).get("wait") != "query"
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)

    uid = "Um3hoursqryx"
    conv.handle_ex(uid, "洗好了嗎")
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "星期日有開嗎")
    assert meta["intent"] == "hours_day", meta
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)

    uid = "Um3bookqryxx"
    conv.handle_ex(uid, "洗好了嗎")
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "我要預約")
    assert meta["intent"] == "booking", meta
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)

    uid = "Um3miss2xxxx"
    conv.handle_ex(uid, "物件查詢")
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "0000")
    _ALL_MSGS.append(("m3-miss1", msgs))
    assert "還沒對到" in flatten(msgs)
    assert bool(meta["notify_staff"]) is False
    assert _staff.inbox == []
    assert conv.get_sess(uid).get("wait") == "query"
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)
    msgs, meta = conv.handle_ex(uid, "9999")
    _ALL_MSGS.append(("m3-miss2", msgs))
    assert "把收據拍給我" in flatten(msgs)
    assert bool(meta["notify_staff"]) is True
    assert len(_staff.inbox) == 1
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)
    assert conv.get_sess(uid).get("wait") in (None, "")

    uid = "Um3hitqueryx"
    conv.handle_ex(uid, "物件查詢")
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "0028")
    _ALL_MSGS.append(("m3-hit", msgs))
    assert "可以取了" in flatten(msgs) or "還沒好" in flatten(msgs)
    # 自動查到並已回覆客人的案件不建立店員待辦，避免客人重按查件時重複推播。
    assert bool(meta["notify_staff"]) is False
    assert len(_staff.inbox) == 0
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)

    # 對每一個意圖：若該次 handle_ex 觸發了 push_inbox，meta 必須為真
    for i, (text, et, _intent, _notify, _needles) in enumerate(CASES):
        uid = f"Um3iff{i:03d}zzz"
        _staff.inbox.clear()
        _msgs, meta = conv.handle_ex(uid, text, et)
        pushed = len(_staff.inbox) > 0
        if pushed:
            assert bool(meta["notify_staff"]) is True, (text, meta, _staff.inbox)
        assert bool(meta.get("staff_pushed")) is pushed, (text, meta, _staff.inbox)
        # query 內部通知路徑必須帳目雙向一致（此迴圈多為進場句，進場不推播）
        if meta.get("intent") == "query":
            assert bool(meta["notify_staff"]) is pushed, (text, meta, _staff.inbox)


def test_q2_save_booking_rejects_empty_phone():
    n_before = (
        len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
    )
    raised = None
    try:
        conv.save_booking(
            "Uq2convnophn",
            "2026-09-08T15:00",
            "",
            kind="pickup",
            extra={"address": "台中市西屯區文華路100號", "phone": ""},
        )
    except Exception as exc:
        raised = exc
    assert raised is not None, "empty-phone pickup must refuse"
    assert isinstance(raised, conv.PickupPhoneRequired) or "pickup_phone" in str(raised), raised
    n_after = (
        len(conv.BOOK.read_text(encoding="utf-8").splitlines()) if conv.BOOK.exists() else 0
    )
    assert n_after == n_before


def test_m4_addr_not_junk():
    uid = "Um4canceladr"
    _enter_pickup_addr(uid)
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "我要取消")
    _ALL_MSGS.append(("m4-cancel-as-addr", msgs))
    sess = conv.get_sess(uid)
    blob = flatten(msgs)
    assert sess.get("wait") is None, sess  # Cancelling must actually leave the draft.
    assert not sess.get("pickup_addr"), sess
    assert "先不安排收送" in blob, blob
    assert "地址我記下了" not in blob
    assert bool(meta["notify_staff"]) is (len(_staff.inbox) > 0)

    uid = "Um4instoread"
    _enter_pickup_addr(uid)
    msgs, _meta = conv.handle_ex(uid, "我在店裡")
    _ALL_MSGS.append(("m4-instore-as-addr", msgs))
    sess = conv.get_sess(uid)
    assert sess.get("wait") == "pickup_addr", sess
    assert not sess.get("pickup_addr"), sess

    uid = "Um4hoursaddr"
    _enter_pickup_addr(uid)
    msgs, _meta = conv.handle_ex(uid, "你們幾點有開")
    _ALL_MSGS.append(("m4-hours-as-addr", msgs))
    sess = conv.get_sess(uid)
    assert sess.get("wait") == "pickup_addr", sess
    assert not sess.get("pickup_addr"), sess

    uid = "Um4badaddrxx"
    _enter_pickup_addr(uid)
    msgs, meta = conv.handle_ex(uid, "我家附近")
    _ALL_MSGS.append(("m4-bad-addr", msgs))
    assert "門牌號碼" in flatten(msgs)
    assert conv.get_sess(uid).get("wait") == "pickup_addr"
    assert not conv.get_sess(uid).get("pickup_addr")
    assert meta["notify_staff"] is False


def test_m5_english_hi_not_substring():
    for text in ("T-shirt", "polo shirt", "washing", "chino"):
        msgs, meta = conv.handle_ex("Um5en" + text[:4], text)
        _ALL_MSGS.append((f"m5:{text}", msgs))
        blob = flatten(msgs)
        assert meta["intent"] != "welcome", (text, meta, blob)
        assert "直接打品名問價" not in blob, blob
        assert "這裡是私享家" not in blob, blob
    msgs, meta = conv.handle_ex("Um5hihello", "hi")
    assert meta["intent"] == "welcome"
    msgs, meta = conv.handle_ex("Um5helloxx", "hello")
    assert meta["intent"] == "welcome"


def test_m6_special_brand_bag():
    msgs, meta = conv.handle_ex("Um6bagxxxxx", "洗特殊類名牌包多少錢")
    _ALL_MSGS.append(("m6-special-bag", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "quote", (meta, blob)
    assert "2500" in blob, blob
    assert "1500" not in blob, blob
    assert "特殊類名牌包" in blob, blob
    msgs, meta = conv.handle_ex("Um6plainbag", "特殊類名牌包")
    assert "2500" in flatten(msgs)


def test_m7_arrived_and_pickup_hours():
    msgs, meta = conv.handle_ex("Um7doorxxxx", "到門口了")
    _ALL_MSGS.append(("m7-到門口了", msgs))
    assert meta["intent"] == "in_store", meta
    assert "櫃台" in flatten(msgs)
    msgs, meta = conv.handle_ex("Um7door2xxx", "到門口")
    assert meta["intent"] == "in_store"
    msgs, meta = conv.handle_ex("Um7personxx", "人到了")
    assert meta["intent"] == "in_store"
    for text in ("你們幾點收件", "幾點可以收件"):
        msgs, meta = conv.handle_ex("Um7hrs" + text[-2:], text)
        _ALL_MSGS.append((f"m7:{text}", msgs))
        blob = flatten(msgs)
        assert meta["intent"] == "hours_day", (text, meta, blob)
        assert "營業時間內約" in blob, blob
        assert "地址" not in blob


def test_m8_image_meta():
    msgs, meta = conv.handle_ex("Um8imgxxxxx", "", "image")
    _ALL_MSGS.append(("m8-image", msgs))
    assert meta["intent"] == "image"
    assert meta["notify_staff"] is True
    assert meta["staff_pushed"] is False
    assert "收到" in flatten(msgs)  # T1 照片收到 主句「收到，我看看。」


def test_x_photo_need_buttons():
    uid = "Uxphotobtn01"
    msgs, meta = conv.handle_ex(uid, "", "image")
    _ALL_MSGS.append(("x1-image", msgs))
    assert meta["intent"] == "image"
    assert meta["notify_staff"] is True
    texts = [m.get("text") or "" for m in msgs if m.get("type") == "text"]
    assert len(texts) >= 2, texts
    assert "收到" in texts[0]
    assert ("哪邊" in texts[1]) or ("加強" in texts[1]), texts[1]
    labs = _qr_labels(msgs)
    assert "局部髒污" in labs and "我不確定，你們看" in labs, labs
    assert "我想問別的" in labs, labs
    for bad in ("鞋子", "包包", "棉被"):
        assert bad not in labs, labs
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex(uid, "局部髒污")
    _ALL_MSGS.append(("x2-need", msgs))
    blob = flatten(msgs)
    assert "有局部髒污" in blob and "店員" in blob, blob
    assert not any(m.get("type") == "flex" for m in msgs), msgs
    assert meta["notify_staff"] is True
    assert _staff.inbox and _staff.inbox[-1][1].get("need") == "局部髒污"


def test_u5_photo_quote():
    uid = "Uphotoquotex"
    msgs, meta = conv.handle_ex(uid, "拍照問價")
    _ALL_MSGS.append(("u5-拍照問價", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "photo_quote", meta
    assert meta["notify_staff"] is False
    assert "拍給我看" in blob, blob  # T1 拍照入口主句
    assert "髒的地方" in blob, blob
    labs = _qr_labels(msgs)
    assert labs == ["📷 拍照", "🖼 從相簿選", "先看價目表"], labs
    types = []
    for m in msgs:
        for it in (m.get("quickReply") or {}).get("items") or []:
            types.append(((it.get("action") or {}).get("type")) or "")
    assert types == ["camera", "cameraRoll", "message"], types
    assert conv.get_sess(uid).get("wait") == "photo", conv.get_sess(uid)
    for bad in ("鞋子", "包包", "衣服", "棉被"):
        assert bad not in labs, labs
    for text in ("拍照問一下", "我傳照片", "拍給你看"):
        msgs, meta = conv.handle_ex(uid + text[-2:], text)
        assert meta["intent"] == "photo_quote", (text, meta)
        assert meta["notify_staff"] is False
    msgs, meta = conv.handle_ex("Uphotoimgxx", "", "image")
    assert meta["intent"] == "image"
    assert meta["notify_staff"] is True
    assert "收到" in flatten(msgs)  # T1 照片收到 主句「收到，我看看。」


def test_l4_l5_welcome():
    assert not conv.COUPON_URL_PATH.is_file(), conv.COUPON_URL_PATH
    assert not conv.COUPON_NAME_PATH.is_file(), conv.COUPON_NAME_PATH
    msgs = conv.welcome()
    assert len(msgs) == 2, len(msgs)
    assert msgs[0]["type"] == "text"
    assert msgs[0]["text"] == (
        f"{conv.hello()}，這裡是私享家。不確定能不能洗、洗多少錢，拍張照給我就好。"
    )
    assert msgs[1]["type"] == "flex"
    assert msgs[1]["altText"] == "私享家精品洗護"
    assert not msgs[0].get("quickReply")
    assert not msgs[1].get("quickReply")

    injected = "https://liff.line.me/example-coupon"
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "coupon-url.txt"
        p.write_text(injected + "\n", encoding="utf-8")
        orig_u = conv.COUPON_URL_PATH
        orig_n = conv.COUPON_NAME_PATH
        try:
            conv.COUPON_URL_PATH = p
            conv.COUPON_NAME_PATH = Path(td) / "coupon-name.txt"
            msgs = conv.welcome()
            assert len(msgs) == 3, len(msgs)
            third = msgs[2].get("text") or ""
            assert "加好友禮" in third, third
            assert injected in third, third
            assert "新朋友優惠" in third, third
            assert "第一次送洗時出示就可以。" in third, third
            labs = _qr_labels([msgs[2]])
            texts = _qr_texts([msgs[2]])
            assert labs == ["先看價目"], labs
            assert texts == ["價目表"], texts
        finally:
            conv.COUPON_URL_PATH = orig_u
            conv.COUPON_NAME_PATH = orig_n
    assert not conv.COUPON_URL_PATH.is_file()
    assert not conv.COUPON_NAME_PATH.is_file()


def test_d1_staff_pushed():
    _staff.inbox.clear()
    _msgs, meta = conv.handle_ex("Ud1imgxxxxx", "", "image")
    assert meta["notify_staff"] is True
    assert meta["staff_pushed"] is False
    _staff.inbox.clear()
    _msgs, meta = conv.handle_ex("Ud1fallxxxx", "那個東西")
    assert meta["intent"] == "fallback"
    assert meta["notify_staff"] is False
    assert meta["staff_pushed"] is False
    uid3 = "Ud1fall3xxx"
    conv.handle_ex(uid3, "asdf")
    conv.handle_ex(uid3, "qwer")
    _staff.inbox.clear()
    _msgs, meta = conv.handle_ex(uid3, "zxcv")
    assert meta["intent"] == "fallback"
    assert meta["notify_staff"] is True
    assert meta["staff_pushed"] is True
    _staff.inbox.clear()
    _msgs, meta = conv.handle_ex("Ud1faqxxxxx", "我還是想問人")
    assert meta["notify_staff"] is True
    assert meta["staff_pushed"] is True
    assert _staff.inbox


def test_v1_who_am_i():
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex("Uv1ai000001", "你是 AI 嗎")
    _ALL_MSGS.append(("v1-你是AI嗎", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "who_am_i", meta
    assert "小幫手" in blob, blob
    assert "衣服" not in blob
    assert "棉被" not in blob
    assert "我是真人" not in blob
    assert meta["notify_staff"] is False
    assert _staff.inbox == []
    labs = _qr_labels(msgs)
    assert "找真人" in labs and "我要洗東西" in labs and "看價目表" in labs, labs
    for trig in ("你是ai", "是機器人", "機器人嗎", "真人嗎", "是人嗎", "你是誰", "你是真的嗎", "有人在嗎"):
        msgs, meta = conv.handle_ex("Uv1t" + trig[:6], trig)
        assert meta["intent"] == "who_am_i", (trig, meta)
        assert meta["notify_staff"] is False


def test_v2_meta_feedback():
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex("Uv2fb000001", "你回話太公板 不像是人類的回話")
    _ALL_MSGS.append(("v2-太公板", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "meta_feedback", meta
    assert meta["notify_staff"] is False
    assert _staff.inbox == []
    assert "這個我幫您轉店裡問一下" not in blob
    assert "方便說一下" not in blob
    assert "04-2452-7411" not in blob
    assert "抱歉" in blob and "店員" in blob, blob
    labs = _qr_labels(msgs)
    assert "拍照問價" in labs and "找真人" in labs, labs


def test_v3_human():
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex("Uv3human001", "找真人")
    _ALL_MSGS.append(("v3-找真人", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "human", meta
    assert meta["notify_staff"] is True
    assert "轉給店裡" in blob, blob
    assert "我是真人" not in blob
    assert _staff.inbox, _staff.inbox
    assert (_staff.inbox[-1][1].get("text") or "") == "客人要找真人"


def test_v_replay_user_chat():
    uid = "Uvreplay0001"
    m1, meta1 = conv.handle_ex(uid, "你是 AI 嗎")
    m2, meta2 = conv.handle_ex(uid, "你回話太公板 不像是人類的回話")
    b1, b2 = flatten(m1), flatten(m2)
    _ALL_MSGS.append(("v-replay-1", m1))
    _ALL_MSGS.append(("v-replay-2", m2))
    assert b1 != b2, (b1, b2)
    for blob in (b1, b2):
        assert "這個我幫您轉店裡問一下" not in blob
        assert "方便說一下" not in blob
        assert "04-2452-7411" not in blob
    assert meta1["intent"] == "who_am_i"
    assert meta2["intent"] == "meta_feedback"
    assert meta1["notify_staff"] is False
    assert meta2["notify_staff"] is False


def test_v4_three_gibberish():
    uid = "Uv4gib00001"
    _staff.inbox.clear()
    blobs = []
    metas = []
    for t in ("asdf", "qwer", "zxcv"):
        msgs, meta = conv.handle_ex(uid, t)
        _ALL_MSGS.append((f"v4-{t}", msgs))
        blobs.append(flatten(msgs))
        metas.append(meta)
        assert meta["intent"] == "fallback", (t, meta)
        assert "04-2452-7411" not in blobs[-1]
    assert blobs[0] != blobs[1], blobs
    assert blobs[1] != blobs[2], blobs
    assert blobs[0] != blobs[2], blobs
    assert metas[0]["notify_staff"] is False
    assert metas[1]["notify_staff"] is False
    assert metas[2]["notify_staff"] is True
    assert _staff.inbox, _staff.inbox
    staff_text = _staff.inbox[-1][1].get("text") or ""
    assert "連續三句" in staff_text, staff_text
    assert "zxcv" in staff_text, staff_text


def test_v5_laundry_marks_and_no_phone():
    msgs, meta = conv.handle_ex("Uv5aaaa0001", "aaaa")
    blob = flatten(msgs)
    assert meta["intent"] == "fallback", meta
    assert "衣服、棉被、鞋子還是包包" not in blob, blob
    assert "04-2452-7411" not in blob
    msgs, meta = conv.handle_ex("Uv5jian0001", "這件可以嗎")
    blob = flatten(msgs)
    assert meta["intent"] == "fallback", (meta, blob)
    assert "衣服" in blob and "棉被" in blob, blob
    assert "04-2452-7411" not in blob
    uid = "Uv5ph3rd001"
    for t in ("aa1", "aa2", "aa3"):
        msgs, meta = conv.handle_ex(uid, t)
        assert "04-2452-7411" not in flatten(msgs)


def test_v6_ack_variants():
    uid = "Uv6ack00001"
    m1, meta1 = conv.handle_ex(uid, "謝謝")
    m2, meta2 = conv.handle_ex(uid, "謝謝")
    b1, b2 = flatten(m1), flatten(m2)
    _ALL_MSGS.append(("v6-ack-1", m1))
    _ALL_MSGS.append(("v6-ack-2", m2))
    assert meta1["intent"] == "ack" and meta2["intent"] == "ack"
    assert b1 != b2, (b1, b2)
    for m in m1 + m2:
        assert not m.get("quickReply")


def _all_copy(msgs) -> str:
    return json.dumps(msgs, ensure_ascii=False)


_VOICE_FORBIDDEN = (
    "您",
    "等一下問",
    "先選",
    "接下來",
    "下一步",
    "（例如",
    "請確認一下",
    "馬上回覆",
    "方便說一下",
)


def test_voice_three_flows_no_machine_talk():
    """人味：三條流程走到底，回覆不含機器口吻。"""
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    blobs = []
    try:
        uid = "Uvoicephoto01"
        m, meta = conv.handle_ex(uid, "拍照問價")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m, meta = conv.handle_ex(uid, "", "image")
        assert meta["notify_staff"] is True
        blobs.append(_all_copy(m))
        m, meta = conv.handle_ex(uid, "局部髒污")
        assert meta["notify_staff"] is True
        blobs.append(_all_copy(m))

        uid = "Uvoicepickn01"
        m, meta = conv.handle_ex(uid, "外收送預約")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m, meta = conv.handle_ex(uid, "今天下午")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m, meta = conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m, meta = conv.handle_ex(uid, "0912345678")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        assert "大概是什麼東西" in _all_copy(m), _all_copy(m)
        m, meta = conv.handle_ex(uid, "衣服")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m = conv.handle_postback(uid, "action=pickup_confirm", {})
        blobs.append(_all_copy(m))
        first = ""
        for msg in m:
            if msg.get("type") == "text":
                first = msg.get("text") or ""
                break
        assert "點到" in first or "左右" in first, first
        assert "（14:00" not in first, first

        uid = "Uvoicepicko01"
        cprof.upsert(uid, phone="0912345678", address="台中市西屯區青海路二段365號")
        m, meta = conv.handle_ex(uid, "外收送預約")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        labs = []
        for msg in m:
            for it in (msg.get("quickReply") or {}).get("items") or []:
                act = it.get("action") or {}
                if act.get("type") == "message" and act.get("label") not in ("改地址或電話",):
                    labs.append(act.get("text") or act.get("label") or "")
        slot_lab = labs[0]
        m, meta = conv.handle_ex(uid, slot_lab)
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        assert "大概是什麼東西" in _all_copy(m), _all_copy(m)
        m, meta = conv.handle_ex(uid, "衣服")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m = conv.handle_postback(uid, "action=pickup_confirm", {})
        blobs.append(_all_copy(m))

        uid = "Uvoicequery01"
        m, meta = conv.handle_ex(uid, "物件查詢")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m, meta = conv.handle_ex(uid, "0912345678")
        assert meta["notify_staff"] is False
        blobs.append(_all_copy(m))
        m, meta = conv.handle_ex(uid, "鞋子")
        assert meta["notify_staff"] is True
        blobs.append(_all_copy(m))
    finally:
        L.inventory = orig

    allb = "\n".join(blobs)
    for w in _VOICE_FORBIDDEN:
        assert w not in allb, (w, allb)


def test_voice_photo_quote_rotates():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    uid = "Uvoicephotorot"
    m1, _ = conv.handle_ex(uid, "拍照問價")
    m2, _ = conv.handle_ex(uid, "拍照問價")
    t1 = next((x.get("text") or "" for x in m1 if x.get("type") == "text"), "")
    t2 = next((x.get("text") or "" for x in m2 if x.get("type") == "text"), "")
    assert t1 != t2, (t1, t2)
    assert t1 in ("好啊，拍給我看。", "可以，直接拍。")
    assert t2 in ("好啊，拍給我看。", "可以，直接拍。")


def test_voice_phone_example_only_on_error():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    try:
        uid = "Uvoicephok01"
        m1, _ = conv.handle_ex(uid, "物件查詢")
        m2, _ = conv.handle_ex(uid, "0912345678")
        good = _all_copy(m1) + "\n" + _all_copy(m2)
        assert "09 開頭" not in good, good
        assert "（例如" not in good, good

        uid = "Uvoicephbad1"
        conv.handle_ex(uid, "物件查詢")
        bad, _ = conv.handle_ex(uid, "0912")
        bblob = _all_copy(bad)
        assert "09 開頭" in bblob, bblob
        ok, _ = conv.handle_ex(uid, "0912345678")
        assert "09 開頭" not in _all_copy(ok), _all_copy(ok)
    finally:
        L.inventory = orig


def test_voice_d3_notify_timing_unchanged():
    """D3：只改字，通知時機不變。"""
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    _staff.inbox.clear()
    try:
        uid = "Uvoiced3pho1"
        _, meta = conv.handle_ex(uid, "拍照問價")
        assert meta["notify_staff"] is False
        assert _staff.inbox == []
        _, meta = conv.handle_ex(uid, "", "image")
        assert meta["notify_staff"] is True
        before = len(_staff.inbox)
        _, meta = conv.handle_ex(uid, "局部髒污")
        assert meta["notify_staff"] is True
        assert len(_staff.inbox) == before + 1

        uid = "Uvoiced3qry1"
        _staff.inbox.clear()
        _, meta = conv.handle_ex(uid, "物件查詢")
        assert meta["notify_staff"] is False
        _, meta = conv.handle_ex(uid, "0912345678")
        assert meta["notify_staff"] is False
        assert _staff.inbox == []
        _, meta = conv.handle_ex(uid, "鞋子")
        assert meta["notify_staff"] is True
        assert len(_staff.inbox) == 1

        uid = "Uvoiced3pk01"
        _staff.inbox.clear()
        conv.handle_ex(uid, "外收送預約")
        conv.handle_ex(uid, "今天下午")
        conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
        conv.handle_ex(uid, "0912345678")
        conv.handle_ex(uid, "衣服")
        assert _staff.inbox == []
        conv.handle_postback(uid, "action=pickup_confirm", {})
        assert len(_staff.inbox) == 1
        assert _staff.inbox[0][0] == "pickup"
    finally:
        L.inventory = orig


def test_voice_mutation_a_narration_turns_red():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = conv.start_pickup

    def bad(uid, force_new=False):
        msgs = orig(uid, force_new=force_new)
        return [conv.text_msg("先選時間，地址跟電話我等一下問。")] + list(msgs)

    conv.start_pickup = bad
    try:
        msgs, _ = conv.handle_ex("Umuta000001", "外收送預約")
        blob = _all_copy(msgs)
        red = False
        try:
            assert "等一下問" not in blob
            assert "先選" not in blob
        except AssertionError:
            red = True
        assert red, blob
    finally:
        conv.start_pickup = orig


def test_voice_mutation_b_slot_speech_turns_red():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = conv.slot_speech
    conv.slot_speech = lambda slot: slot
    try:
        uid = "Umutb000001"
        conv.handle_ex(uid, "外收送預約")
        conv.handle_ex(uid, "今天下午")
        conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
        conv.handle_ex(uid, "0912345678")
        msgs = conv.handle_postback(uid, "action=pickup_confirm", {})
        first = next((x.get("text") or "" for x in msgs if x.get("type") == "text"), "")
        red = False
        try:
            assert "點到" in first or "左右" in first
            assert "（14:00" not in first
        except AssertionError:
            red = True
        assert red, first
    finally:
        conv.slot_speech = orig


def test_voice_mutation_c_example_turns_red():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = L.inventory
    orig_q = conv.start_query
    L.inventory = lambda: ([], [], "none")

    def bad(uid):
        msgs, n = orig_q(uid)
        extra = "（例如 0912345678）"
        if msgs and msgs[0].get("type") == "text":
            cloned = dict(msgs[0])
            cloned["text"] = (cloned.get("text") or "") + extra
            msgs = [cloned] + list(msgs[1:])
        return msgs, n

    conv.start_query = bad
    try:
        uid = "Umutc000001"
        m1, _ = conv.handle_ex(uid, "物件查詢")
        m2, _ = conv.handle_ex(uid, "0912345678")
        good = _all_copy(m1) + "\n" + _all_copy(m2)
        red = False
        try:
            assert "（例如" not in good
        except AssertionError:
            red = True
        assert red, good
    finally:
        conv.start_query = orig_q
        L.inventory = orig


def test_slot_speech_examples():
    assert conv.slot_speech("明天下午（14:00–18:00）") == "明天下午兩點到六點"
    assert conv.slot_speech("明天上午（10:00–12:00）") == "明天早上十點到十二點"
    assert conv.slot_speech("後天下午（14:00–18:00）") == "後天下午兩點到六點"
    assert conv.slot_speech("週六上午（12:00–14:00）") == "週六中午十二點到兩點"
    assert conv.slot_speech("9/8（週二）15:00 前後") == "9/8 週二三點左右"


def test_z1_faq_no_nin_welcome_price_keep():
    """Z1：FAQ 五題不含「您」；歡迎詞／價目卡／店家資訊仍含「您」。"""
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    for key, pair in conv._FAQ_ANSWERS.items():
        for part in pair:
            assert "您" not in part, (key, part)
        blob = json.dumps(conv.faq_answer(key), ensure_ascii=False)
        assert "您" not in blob, (key, blob)

    uid = "Uz1photoask1"
    m1, _ = conv.handle_ex(uid, "", "image")
    m2, _ = conv.handle_ex(uid, "我想問別的")
    m3, _ = conv.handle_ex(uid, "多久可以拿")
    flow = json.dumps(m1 + m2 + m3, ensure_ascii=False)
    assert "您" not in flow, flow
    assert "5–7 天" in flow, flow

    freeze_now("2026-09-05T23:00")
    try:
        wblob = json.dumps(conv.welcome("Uz1welcom01"), ensure_ascii=False)
        assert "您" in wblob, wblob
        assert "私享家精品洗護" in wblob, wblob
    finally:
        freeze_now("2026-09-05T13:00")
    price, _ = conv.handle_ex("Uz1price001", "價目表")
    assert "您" in flatten(price), flatten(price)
    loc, _ = conv.handle_ex("Uz1shop0001", "位置")
    assert conv.ADDR in flatten(loc) and "不用預約" in flatten(loc), flatten(loc)


def test_z2_human_button_label_and_old_trigger():
    """Z2：新按鈕 label 是找真人；打字「我還是想問人」仍走 human。"""
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    src = Path(conv.__file__).read_text(encoding="utf-8")
    assert '("我還是想問人"' not in src
    assert '"label": "我還是想問人"' not in src
    assert "我還是想問人" in src
    for key in conv._FAQ_ANSWERS:
        labs = _qr_labels(conv.faq_answer(key))
        assert "找真人" in labs, (key, labs)
        assert "我還是想問人" not in labs, (key, labs)
    _staff.inbox.clear()
    msgs, meta = conv.handle_ex("Uz2oldtrig01", "我還是想問人")
    assert meta["intent"] == "human", meta
    assert meta["notify_staff"] is True
    assert "轉給店裡" in flatten(msgs)
    assert _staff.inbox, _staff.inbox
    msgs2, meta2 = conv.handle_ex("Uz2newbtn01", "找真人")
    assert meta2["intent"] == "human", meta2


def test_z3_photo_eta_statement():
    """Z3：照片說完需求的第二句是直述，含「回你」，沒有問號。"""
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    expected = (
        "通常一個小時內回你，看師傅在不在。",
        "師傅在的話一個小時內回你。",
    )
    uid = "Uz3eta00001"
    conv.handle_ex(uid, "", "image")
    m1, _ = conv.handle_ex(uid, "局部髒污")
    conv.handle_ex(uid, "", "image")
    m2, _ = conv.handle_ex(uid, "有味道")
    t1 = [m.get("text") or "" for m in m1 if m.get("type") == "text"]
    t2 = [m.get("text") or "" for m in m2 if m.get("type") == "text"]
    assert len(t1) == len(t2) == 1, (t1, t2)
    assert "局部髒污" in t1[0] and "味道" in t2[0]
    for messages, texts in ((m1, t1), (m2, t2)):
        assert "一個小時" not in texts[0], texts
        assert "店員" in texts[0] and "同一筆" in texts[0], texts
        assert any(q["action"].get("data") == "action=estimate_photos" for m in messages for q in m.get("quickReply", {}).get("items", []))


def test_z1_mutation_faq_nin_turns_red():
    setup_tmp()
    orig = conv._FAQ_ANSWERS
    patched = dict(orig)
    a, b = orig["要洗多久"]
    patched["要洗多久"] = (a, "有趕著用的日子跟我說，我幫您問櫃台。")
    conv._FAQ_ANSWERS = patched
    try:
        red = False
        try:
            blob = json.dumps(conv.faq_answer("要洗多久"), ensure_ascii=False)
            assert "您" not in blob
        except AssertionError:
            red = True
        assert red, blob
    finally:
        conv._FAQ_ANSWERS = orig


def test_z2_mutation_old_label_turns_red():
    setup_tmp()
    orig = list(conv._FAQ_NEXT)
    conv._FAQ_NEXT = [
        ("拍照問價", "拍照問價"),
        ("價目表", "價目表"),
        ("我還是想問人", "我還是想問人"),
    ]
    try:
        red = False
        try:
            labs = _qr_labels(conv.faq_answer("要洗多久"))
            assert "我還是想問人" not in labs
            assert "找真人" in labs
        except AssertionError:
            red = True
        assert red, labs
    finally:
        conv._FAQ_NEXT = orig


def test_z3_mutation_question_turns_red():
    setup_tmp()
    freeze_now("2026-09-05T13:00")
    orig = conv._ack_photo_need_msgs

    def bad(uid, raw, n):
        msgs = orig(uid, raw, n)
        out = []
        for i, m in enumerate(msgs):
            cloned = dict(m)
            if i == 1 and cloned.get("type") == "text":
                cloned["text"] = "大概多久回你？看師傅在不在，通常一個小時內。"
            out.append(cloned)
        return out

    conv._ack_photo_need_msgs = bad
    try:
        uid = "Uz3mut00001"
        conv.handle_ex(uid, "", "image")
        msgs, _ = conv.handle_ex(uid, "局部髒污")
        texts = [m.get("text") or "" for m in msgs if m.get("type") == "text"]
        second = texts[1] if len(texts) > 1 else ""
        red = False
        try:
            assert "?" not in second and "？" not in second
            assert "回你" in second
        except AssertionError:
            red = True
        assert red, second
    finally:
        conv._ack_photo_need_msgs = orig


def test_m9_longest_item_quote():
    msgs, meta = conv.handle_ex("Um9downxxxx", "我要洗羽絨外套")
    _ALL_MSGS.append(("m9-羽絨外套", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "quote", (meta, blob)
    assert "羽絨外套" in blob, blob
    assert "280" in blob, blob
    msgs, meta = conv.handle_ex("Um9bagxxxxx", "我要洗特殊類名牌包")
    _ALL_MSGS.append(("m9-特殊類名牌包", msgs))
    blob = flatten(msgs)
    assert meta["intent"] == "quote", (meta, blob)
    assert "特殊類名牌包" in blob, blob
    assert "2500" in blob, blob
    assert "1500" not in blob, blob


def test_c3_pickup_item_before_confirm():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    _staff.inbox.clear()
    uid = "Uc3newitem01"
    asked_before = False
    conv.handle_ex(uid, "外收送預約")
    conv.handle_ex(uid, "今天下午")
    conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
    msgs, meta = conv.handle_ex(uid, "0912345678")
    phone_blob = _all_copy(msgs)
    asked_before = True
    msgs, meta = conv.handle_ex(uid, "衣服")
    item_blob = _all_copy(msgs)
    assert _staff.inbox == []
    conv.handle_postback(uid, "action=pickup_confirm", {})
    conv.handle_ex(uid, "棉被")
    assert len(_staff.inbox) == 1, _staff.inbox
    rec = _staff.inbox[0][1]
    assert _staff.inbox[0][0] == "pickup"
    assert rec.get("item") == "衣服", rec
    assert rec.get("item") != "等客人回", rec
    assert asked_before
    assert "大概是什麼東西" in phone_blob, phone_blob
    assert "確認送出" not in phone_blob, phone_blob
    assert "確認送出" in item_blob, item_blob
    assert "衣服" in item_blob, item_blob


def test_c3_later_see_no_warn_flag():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    _staff.inbox.clear()
    uid = "Uc3latersee1"
    conv.handle_ex(uid, "外收送預約")
    conv.handle_ex(uid, "今天下午")
    conv.handle_ex(uid, "台中市西屯區青海路二段365號", "location")
    conv.handle_ex(uid, "0912345678")
    conv.handle_ex(uid, "到時再看")
    conv.handle_postback(uid, "action=pickup_confirm", {})
    assert len(_staff.inbox) == 1, _staff.inbox
    rec = _staff.inbox[0][1]
    assert rec.get("item") == "到時再看"
    assert rec.get("item") != "等客人回"


def test_c3_returning_asks_item():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    _staff.inbox.clear()
    uid = "Uc3olditem01"
    cprof.upsert(uid, phone="0912345678", address="台中市西屯區青海路二段365號")
    labs = []
    m, _ = conv.handle_ex(uid, "外收送預約")
    for msg in m:
        for it in (msg.get("quickReply") or {}).get("items") or []:
            act = it.get("action") or {}
            if act.get("type") == "message" and act.get("label") not in ("改地址或電話",):
                labs.append(act.get("text") or act.get("label") or "")
    slot_lab = labs[0]
    msgs, _ = conv.handle_ex(uid, slot_lab)
    blob = _all_copy(msgs)
    assert "大概是什麼東西" in blob, blob
    assert "確認送出" not in blob, blob
    conv.handle_ex(uid, "衣服")
    conv.handle_postback(uid, "action=pickup_confirm", {})
    assert len(_staff.inbox) == 1
    assert _staff.inbox[0][1].get("item") == "衣服"


def test_c3_mutation_item_after_confirm_turns_red():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig_next = conv._pickup_next_missing
    orig_commit = conv._pickup_commit
    orig_accept = conv._accept_preconfirm_item

    def next_old(uid):
        sess = conv.get_sess(uid)
        if not (sess.get("pickup_when") or "").strip():
            conv.set_sess(uid, wait="pickup_when")
            return conv.say("什麼時候方便？", actions=conv._pickup_when_actions(uid))
        if not (sess.get("pickup_addr") or "").strip():
            return conv._ask_pickup_address(uid)
        if not (sess.get("pickup_phone") or "").strip():
            return conv._ask_pickup_phone(uid)
        return conv._pickup_confirm_msgs(uid)

    def commit_old(uid):
        msgs = orig_commit(uid)
        sess = conv.get_sess(uid)
        bid = sess.get("pickup_id") or sess.get("last_booking") or ""
        conv.set_sess(uid, wait="pickup_item", pickup_id=bid)
        extra = conv.say("大概是什麼東西？", buttons=conv._PICKUP_ITEM_QR)
        return list(msgs) + list(extra)

    conv._pickup_next_missing = next_old
    conv._pickup_commit = commit_old
    conv._accept_preconfirm_item = lambda uid, n: None
    try:
        red = False
        try:
            test_c3_pickup_item_before_confirm()
        except AssertionError:
            red = True
        assert red
    finally:
        conv._pickup_next_missing = orig_next
        conv._pickup_commit = orig_commit
        conv._accept_preconfirm_item = orig_accept


def test_c4_query_aliases_and_pre_wash():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = L.inventory
    L.inventory = lambda: ([], [], "none")
    try:
        for phrase in ("進度查詢", "查件進度", "進度"):
            uid = "Uc4q" + phrase
            msgs, meta = conv.handle_ex(uid, phrase)
            blob = flatten(msgs)
            assert meta["intent"] == "query", (phrase, meta, blob)
            assert "手機" in blob, (phrase, blob)
            assert meta["notify_staff"] is False
        uid = "Uc4prewash01"
        msgs, meta = conv.handle_ex(uid, "送洗前必看")
        blob = flatten(msgs)
        assert meta["intent"] == "pre_wash", meta
        assert meta["notify_staff"] is False
        assert "您要洗的是什麼" not in blob, blob
        assert "乾洗" in blob, blob
        assert "現場報價" in blob, blob
        labs = []
        for m in msgs:
            for it in (m.get("quickReply") or {}).get("items") or []:
                labs.append(((it.get("action") or {}).get("label")) or "")
        assert "拍照問價" in labs and "價目表" in labs and "找真人" in labs, labs
    finally:
        L.inventory = orig


def test_c4_mutation_drop_query_alias_turns_red():
    setup_tmp()
    freeze_now("2026-09-08T13:00")
    orig = set(conv._QUERY_MENU)
    conv._QUERY_MENU = orig - {"進度查詢"}
    try:
        red = False
        try:
            orig_inv = L.inventory
            L.inventory = lambda: ([], [], "none")
            try:
                msgs, meta = conv.handle_ex("Uc4mutq001", "進度查詢")
                blob = flatten(msgs)
                assert meta["intent"] == "query", meta
                assert "手機" in blob, blob
            finally:
                L.inventory = orig_inv
        except AssertionError:
            red = True
        assert red
    finally:
        conv._QUERY_MENU = orig


SAMPLE_INPUTS = [
    "謝謝",
    "窗簾可以洗嗎",
    "羽絨外套多少",
    "星期日有開嗎",
    "我要取消預約",
    "LV包",
    "我在店裡",
    "可以到府收件嗎",
    "多少錢",
    "西裝",
]


def collect_sample():
    rows = []
    for i, text in enumerate(SAMPLE_INPUTS):
        uid = f"Usamp{i:02d}qqqq"
        msgs, meta = conv.handle_ex(uid, text)
        blob = flatten(msgs).replace("\n", " / ")
        rows.append(f"{text}→[{meta['intent']}] {blob}")
    return rows


if __name__ == "__main__":
    tests = [
        ("cases", test_cases),
        ("sticker", test_sticker_ack),
        ("handle_list", test_handle_returns_list),
        ("can_wash", test_can_wash_luxury_vs_curtain),
        ("catalog", test_catalog_all_exact),
        ("r4", test_r4_guards),
        ("cancel", test_cancel_flow),
        ("fallback", test_fallback_notify_and_copy),
        ("no_line_pay", test_no_line_pay_in_qr),
        ("copy_r5", test_copy_r5),
        ("mainland", test_mainland_scan),
        ("f1_qr", test_f1_qr_unique_no_pay),
        ("f2_cancel_empty", test_f2_cancel_without_booking),
        ("f3_addr_ack", test_f3_pickup_addr_ack),
        ("f4_in_store", test_f4_in_store),
        ("r3_guards", test_r3_quote_guards),
        ("r3_norm", test_r3_normalize_match_ack),
        ("r3_hours_pay_k9", test_r3_hello_pay_hours_booking),
        ("m2_suit", test_m2_suit_not_vest),
        ("m3_query", test_m3_query_unlock_and_accounts),
        ("q2_no_phone", test_q2_save_booking_rejects_empty_phone),
        ("m4_addr", test_m4_addr_not_junk),
        ("m5_hi", test_m5_english_hi_not_substring),
        ("m6_bag", test_m6_special_brand_bag),
        ("m7_door", test_m7_arrived_and_pickup_hours),
        ("m8_image", test_m8_image_meta),
        ("x_photo_need", test_x_photo_need_buttons),
        ("u5_photo_quote", test_u5_photo_quote),
        ("l4_l5_welcome", test_l4_l5_welcome),
        ("d1_staff_pushed", test_d1_staff_pushed),
        ("v1_who_am_i", test_v1_who_am_i),
        ("v2_meta_feedback", test_v2_meta_feedback),
        ("v3_human", test_v3_human),
        ("v_replay", test_v_replay_user_chat),
        ("v4_three", test_v4_three_gibberish),
        ("v5_marks", test_v5_laundry_marks_and_no_phone),
        ("v6_ack", test_v6_ack_variants),
        ("voice_flows", test_voice_three_flows_no_machine_talk),
        ("voice_rotate", test_voice_photo_quote_rotates),
        ("voice_phone_ex", test_voice_phone_example_only_on_error),
        ("voice_d3", test_voice_d3_notify_timing_unchanged),
        ("voice_mut_a", test_voice_mutation_a_narration_turns_red),
        ("voice_mut_b", test_voice_mutation_b_slot_speech_turns_red),
        ("voice_mut_c", test_voice_mutation_c_example_turns_red),
        ("slot_speech", test_slot_speech_examples),
        ("m9_longest", test_m9_longest_item_quote),
        ("z1_faq_nin", test_z1_faq_no_nin_welcome_price_keep),
        ("z2_human_btn", test_z2_human_button_label_and_old_trigger),
        ("z3_photo_eta", test_z3_photo_eta_statement),
        ("z1_mut", test_z1_mutation_faq_nin_turns_red),
        ("z2_mut", test_z2_mutation_old_label_turns_red),
        ("z3_mut", test_z3_mutation_question_turns_red),
        ("c3_item_before", test_c3_pickup_item_before_confirm),
        ("c3_later_see", test_c3_later_see_no_warn_flag),
        ("c3_returning", test_c3_returning_asks_item),
        ("c3_mut", test_c3_mutation_item_after_confirm_turns_red),
        ("c4_menu", test_c4_query_aliases_and_pre_wash),
        ("c4_mut", test_c4_mutation_drop_query_alias_turns_red),
        ("struct", test_all_struct),
        ("official", test_official_untouched),
    ]
    for name, fn in tests:
        run(name, fn)
    print("---SAMPLE---")
    for row in collect_sample():
        print(row)
    print("---END---")
    nfail = len(_FAILS)
    print(f"RESULT PASS={_PASSES} FAIL={nfail} CASES={len(CASES)}")
    if nfail:
        print("FAILURES:")
        for f in _FAILS:
            print(f)
        sys.exit(1)
    sys.exit(0)
