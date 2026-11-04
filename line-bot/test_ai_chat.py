# -*- coding: utf-8 -*-
"""Tests for the V2 AI chat layer. Isolated temp data dir, no network, fake model injected."""
from __future__ import annotations

import atexit
import itertools
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unittest
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from types import ModuleType
from unittest import mock
import urllib.request

HERE = Path(__file__).resolve().parent
SRC_REPO = Path(os.environ.get("LAUNDRY_REPO_ROOT") or HERE.parent).resolve()
TMP = Path(tempfile.mkdtemp(prefix="ai-chat-test-"))
atexit.register(shutil.rmtree, TMP, True)


def _copy_public_data(src_repo: Path, dst_repo: Path) -> None:
    """Copy only the two approved public configuration files, never customer data."""
    src, dst = src_repo / "data", dst_repo / "data"
    dst.mkdir(parents=True, exist_ok=True)
    for name in ("prices.json", "business-profile.json"):
        path = src / name
        if path.is_file():
            shutil.copy2(path, dst / name)


_copy_public_data(SRC_REPO, TMP)
USAGE_DIR = TMP / "data" / "chat-usage"
os.environ["LAUNDRY_REPO_ROOT"] = str(TMP)
os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
os.environ["LAUNDRY_CHAT_USAGE_DIR"] = str(USAGE_DIR)
os.environ["LAUNDRY_VISION_USAGE_DIR"] = str(TMP / "data" / "vision-usage")
for _key in ("GEMINI_API_KEY", "LAUNDRY_VISION_MODEL", "LAUNDRY_VISION_FALLBACK_MODEL", "LAUNDRY_AI_CHAT"):
    os.environ.pop(_key, None)
sys.path.insert(0, str(HERE))


def _no_net(*_a, **_k):
    raise RuntimeError("network disabled in tests")


urllib.request.urlopen = _no_net
_staff = ModuleType("staff_notify")
_staff.inbox = []
_staff.guest_name = lambda _uid: "測試客人"
_staff.push_inbox = lambda kind, rec, **_k: (_staff.inbox.append((kind, rec)) or {"saved": True, "notified": True})
sys.modules["staff_notify"] = _staff
_pay = ModuleType("line_pay")
_pay.configured = lambda: False
sys.modules["line_pay"] = _pay

import conversation as conv  # noqa: E402
import ai_chat  # noqa: E402

if hasattr(conv.cprof, "PROFILE_PATH"):
    conv.cprof.PROFILE_PATH = TMP / "data" / "line-customer-profile.json"
FIXED_NOW = datetime(2026, 11, 4, 14, 0, tzinfo=conv.TZ) if conv.TZ else datetime(2026, 11, 4, 14, 0)
conv.now_tw = lambda: FIXED_NOW  # Wednesday 14:00, so slots and pickers are stable

PARKING = "開車去店門口好停嗎"
SIDE_REPLY = "羽絨衣多數可以水洗，但要看洗標和填充狀況。方便的話拍洗標給我們看看。"

SCRIPTS = {
    "greeting": [("text", "你好")],
    "prices": [("text", "價目表")],
    "pickup_side": [("text", "外收送預約"), ("text", "羽絨衣可以水洗嗎"), ("text", "明天下午"), ("text", "找真人")],
    "booking": [("text", "預約到店"), ("postback", "action=reserve&item=", {"datetime": "2026-11-05T15:00"})],
    "lookup": [("text", "物件查詢"), ("text", "0912345678")],
    "fallback": [("text", "這是什麼東西啦"), ("text", "嗯哼"), ("text", "你們收費會很貴嗎")],
    "handoff": [("text", "可以請老闆打電話給我嗎")],
}


class Fake:
    def __init__(self, reply="", kind="answer", delay=0.0, error=None):
        self.payload = {"kind": kind, "reply": reply}
        self.delay = delay
        self.error = error
        self.calls = 0

    def __call__(self, _model, _prompt, _timeout):
        self.calls += 1
        if self.delay:
            time.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return json.dumps(self.payload, ensure_ascii=False)


def new_uid(tag: str) -> str:
    return "U" + tag + uuid.uuid4().hex[:10] + "0001"  # same tail -> same booking ids


@contextmanager
def sandbox():
    """Fresh session/booking/profile files and deterministic random ids for one run."""
    folder = Path(tempfile.mkdtemp(dir=TMP))
    old = (conv.SESS, conv.BOOK)
    conv.SESS = folder / "line-sessions.json"
    conv.BOOK = folder / "line-bookings.jsonl"
    counter = itertools.count(1)
    real_uuid4 = uuid.uuid4
    try:
        with mock.patch("uuid.uuid4", lambda: uuid.UUID(int=next(counter))), \
                mock.patch("os.urandom", lambda n: bytes((next(counter) + i) % 256 for i in range(n))):
            yield
    finally:
        conv.SESS, conv.BOOK = old
        uuid.uuid4 = real_uuid4


def mode(value: str):
    return mock.patch.dict(os.environ, {"LAUNDRY_AI_CHAT": value})


def run_script(steps, uid):
    out = []
    for step in steps:
        if step[0] == "text":
            msgs, _meta = conv.handle_ex(uid, step[1])
        else:
            msgs = conv.handle_postback(uid, step[1], step[2])
        out.append(json.dumps(msgs, ensure_ascii=False, sort_keys=True))
    return out


def texts(msgs):
    return [m.get("text", "") for m in msgs if m.get("type") == "text"]


def usage_today() -> dict:
    path = USAGE_DIR / (ai_chat._PE.usage_day() + ".json")
    if not path.exists():
        return {"counts": {}, "models": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def baseline(steps):
    """Today's code path: every AI hook bypassed."""
    with mock.patch.object(ai_chat, "handoff_first", lambda *a, **k: None), \
            mock.patch.object(ai_chat, "mid_flow", lambda *a, **k: None), \
            mock.patch.object(ai_chat, "no_flow_answer", lambda *a, **k: None), sandbox():
        return run_script(steps, new_uid("b"))


def single_off(text):
    with mode("off"), sandbox():
        msgs, meta = conv.handle_ex(new_uid("r"), text)
    return msgs, meta


@unittest.skipIf(ai_chat._PE is None, "photo_estimate (Pillow) not importable; AI layer stays off")
class AiChatTests(unittest.TestCase):
    def setUp(self):
        ai_chat.set_model(None)

    def tearDown(self):
        ai_chat.set_model(None)

    # --- switch -------------------------------------------------------------
    def test_default_mode_is_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LAUNDRY_AI_CHAT", None)
            self.assertEqual(ai_chat.mode(), "off")
        with mode("nonsense"):
            self.assertEqual(ai_chat.mode(), "off")

    def test_off_is_byte_identical_to_today(self):
        fake = Fake(SIDE_REPLY)
        ai_chat.set_model(fake)
        for name, steps in SCRIPTS.items():
            expected = baseline(steps)
            with mode("off"), sandbox():
                got = run_script(steps, new_uid("o"))
            self.assertEqual(got, expected, name)
        self.assertEqual(fake.calls, 0)

    def test_shadow_replies_equal_off(self):
        fake = Fake("好的，這個我幫您看一下。")
        ai_chat.set_model(fake)
        for name, steps in SCRIPTS.items():
            n0 = len(_staff.inbox)
            with mode("off"), sandbox():
                off = run_script(steps, new_uid("o"))
            n_off = len(_staff.inbox) - n0
            n1 = len(_staff.inbox)
            with mode("shadow"), sandbox():
                shadow = run_script(steps, new_uid("s"))
            self.assertEqual(shadow, off, name)
            self.assertEqual(len(_staff.inbox) - n1, n_off, name)
        self.assertGreaterEqual(fake.calls, 1)
        counts = usage_today()["counts"]
        self.assertTrue(any(k.startswith("shadow_") for k in counts), counts)

    # --- hand-off -------------------------------------------------------------
    def test_handoff_detection(self):
        for text in ("找真人", "真人", "我要找客服", "老闆在嗎", "可以打電話給我嗎", "轉人工", "請店員回我"):
            self.assertTrue(ai_chat.is_handoff_text(text), text)
        for text in ("你是真人嗎", "電話幾號", "客服電話幾號", "找店員安排收送", "不用找真人了", "羽絨衣可以水洗嗎"):
            self.assertFalse(ai_chat.is_handoff_text(text), text)

    def test_handoff_mid_booking_keeps_state(self):
        fake = Fake(SIDE_REPLY)
        ai_chat.set_model(fake)
        with mode("on"), sandbox():
            uid = new_uid("h")
            conv.handle_ex(uid, "外收送預約")
            before = conv.get_sess(uid)
            self.assertEqual(before.get("wait"), "pickup_when")
            n0 = len(_staff.inbox)
            msgs, meta = conv.handle_ex(uid, "找真人")
            self.assertEqual(meta["intent"], "human")
            self.assertTrue(meta["notify_staff"])
            self.assertTrue(meta["staff_pushed"])
            self.assertEqual(len(_staff.inbox), n0 + 1)
            self.assertEqual(_staff.inbox[-1][0], "ask")
            self.assertIn(conv._HUMAN_REPLY, texts(msgs))
            after = conv.get_sess(uid)
            self.assertEqual(after.get("wait"), "pickup_when")
            self.assertEqual(after.get("pickup_form_id"), before.get("pickup_form_id"))
            conv.handle_ex(uid, "明天下午")
            self.assertTrue(conv.get_sess(uid).get("pickup_slot"))
        self.assertEqual(fake.calls, 0)

    def test_handoff_variants_no_flow(self):
        with mode("on"):
            for text in ("我要找客服", "老闆在嗎", "可以打電話給我嗎", "真人"):
                with sandbox():
                    _msgs, meta = conv.handle_ex(new_uid("v"), text)
                self.assertEqual(meta["intent"], "human", text)
            with sandbox():
                _msgs, meta = conv.handle_ex(new_uid("w"), "你是真人嗎")
            self.assertNotEqual(meta["intent"], "human")

    # --- mid-flow --------------------------------------------------------------
    def test_past_wash_complaints_route_to_staff_with_ai_off(self):
        fake = Fake(SIDE_REPLY)
        ai_chat.set_model(fake)
        cases = (
            "上次洗的襯衫領口還是黃黃的",
            "昨天拿回來的外套油漬還在",
            "你們洗完的大衣縮水了",
            "上次洗的白鞋還有味道，重洗要多少錢",
        )
        for active_booking in (False, True):
            for complaint in cases:
                with self.subTest(booking=active_booking, text=complaint), mode("off"), sandbox():
                    uid = new_uid("complaint")
                    if active_booking:
                        conv.handle_ex(uid, "外收送預約")
                    before = len(_staff.inbox)
                    msgs, meta = conv.handle_ex(uid, complaint)
                    self.assertEqual(meta["intent"], "complaint")
                    self.assertEqual(len(_staff.inbox), before + 1)
                    self.assertIn("店裡", "\n".join(texts(msgs)))
                    if active_booking:
                        self.assertEqual(conv.get_sess(uid)["wait"], "pickup_when")
                        conv.handle_ex(uid, "明天下午")
                        self.assertTrue(conv.get_sess(uid).get("pickup_slot"))
        self.assertEqual(fake.calls, 0)

    def test_new_price_and_booking_stay_available_with_ai_off(self):
        with mode("off"), sandbox():
            before = len(_staff.inbox)
            for question in ("洗一件羽絨外套大概多少", "上次洗的襯衫這次洗要多少"):
                msgs, meta = conv.handle_ex(new_uid("quote"), question)
                self.assertNotEqual(meta["intent"], "complaint")
                self.assertIn(meta["intent"], {"quote", "estimate"})
            _msgs, meta = conv.handle_ex(new_uid("care"), "你們洗完還是會有味道嗎")
            self.assertNotEqual(meta["intent"], "complaint")
            uid = new_uid("book")
            conv.handle_ex(uid, "外收送預約")
            self.assertEqual(conv.get_sess(uid)["wait"], "pickup_when")
            conv.handle_ex(uid, "明天下午")
            self.assertTrue(conv.get_sess(uid).get("pickup_slot"))
            self.assertEqual(len(_staff.inbox), before)

    def test_care_questions_use_known_item_and_give_photo_next_step(self):
        with mode("off"), sandbox():
            for question, subject in (
                ("這件襯衫領口黃黃的，還沒送洗，洗得掉嗎", "領口泛黃"),
                ("皮包有霉味，能處理嗎？費用怎麼算", "皮包霉味"),
            ):
                with self.subTest(subject=subject):
                    uid = new_uid("care")
                    msgs, meta = conv.handle_ex(uid, question)
                    reply = "\n".join(texts(msgs))
                    self.assertEqual(meta["intent"], "photo_quote")
                    self.assertIn(subject, reply)
                    self.assertIn("近拍", reply)
                    self.assertNotIn("您是包、皮衣", reply)
                    self.assertEqual(conv.get_sess(uid)["wait"], "photo")
                    if subject == "皮包霉味":
                        self.assertIn("費用", reply)

    def test_pickup_deadline_is_answered_and_preserves_booking(self):
        with mode("off"), sandbox():
            uid = new_uid("deadline")
            before = len(_staff.inbox)
            msgs, meta = conv.handle_ex(uid, "可以來收嗎？禮拜五要穿，來得及嗎")
            reply = "\n".join(texts(msgs))
            self.assertIn("到府收送", reply)
            self.assertIn("還不能答應", reply)
            self.assertTrue(meta["staff_pushed"])
            self.assertEqual(len(_staff.inbox), before + 1)
            self.assertIn("禮拜五要穿", _staff.inbox[-1][1]["text"])
            self.assertEqual(conv.get_sess(uid)["wait"], "pickup_when")
            conv.handle_ex(uid, "明天下午")
            state = conv.get_sess(uid).copy()
            msgs, meta = conv.handle_ex(uid, "可是我週五就要穿")
            self.assertIn("還不能答應", "\n".join(texts(msgs)))
            self.assertTrue(meta["staff_pushed"])
            self.assertEqual(len(_staff.inbox), before + 2)
            self.assertIn("週五就要穿", _staff.inbox[-1][1]["text"])
            for field in ("wait", "pickup_form_id", "pickup_slot", "pickup_when"):
                self.assertEqual(conv.get_sess(uid)[field], state[field])

    def test_contextual_care_followups_use_the_known_item(self):
        with mode("off"), sandbox():
            uid = new_uid("context")
            conv.handle_ex(uid, "這件襯衫有油漬，能洗掉嗎")
            msgs, _ = conv.handle_ex(uid, "那件這樣還可以嗎")
            self.assertIn("襯衫", "\n".join(texts(msgs)))
            msgs, _ = conv.handle_ex(uid, "那這件幾天能拿")
            self.assertIn("5–7 天", "\n".join(texts(msgs)))
            msgs, meta = conv.handle_ex(uid, "那這件多少錢")
            self.assertIn(meta["intent"], {"estimate", "quote", "ask_price"})
            self.assertIn("襯衫", "\n".join(texts(msgs)))
            conv.set_sess(uid, care_item_at="2000-01-01T00:00:00+08:00", wait=None)
            msgs, _ = conv.handle_ex(uid, "那件幾天能拿")
            self.assertIn("哪一件", "\n".join(texts(msgs)))
            self.assertNotIn("襯衫", "\n".join(texts(msgs)))

    def test_new_care_wordings_and_ambiguous_item(self):
        with mode("off"), sandbox():
            for question, cue in (
                ("這雙靴子鞋底開口還能洗嗎", "鞋底接縫"),
                ("蠶絲被可以水洗嗎", "洗標"),
                ("家裡的娃娃可以送洗嗎", "尺寸"),
                ("羊毛西裝可以水洗嗎", "洗標"),
            ):
                with self.subTest(question=question):
                    msgs, meta = conv.handle_ex(new_uid("newcare"), question)
                    self.assertEqual(meta["intent"], "photo_quote")
                    self.assertIn(cue, "\n".join(texts(msgs)))
            msgs, meta = conv.handle_ex(new_uid("unknown"), "那件這樣還可以嗎")
            self.assertEqual(meta["intent"], "clarify_item")
            self.assertIn("哪一件", "\n".join(texts(msgs)))

    def test_research_questions_preserve_meaning_across_routes(self):
        with mode("off"), sandbox():
            for question, intent, cue in (
                ("白鞋送洗會不會變黃？", "photo_quote", "鞋面"),
                ("皮包發霉，清完要多少錢？", "photo_quote", "費用"),
                ("鞋子洗完標誌掉了。", "complaint", "店裡"),
                ("拿回來發現少一條腰帶。", "complaint", "店裡"),
                ("這好像不是我送洗的那件。", "complaint", "店裡"),
                ("好像刷了兩次。", "payment_check", "核對"),
                ("娃娃裡面有音樂盒，能洗嗎？", "photo_quote", "拆下來"),
                ("這週沒空，能放到下週嗎？", "clarify_pickup", "單號"),
            ):
                with self.subTest(question=question):
                    msgs, meta = conv.handle_ex(new_uid("research_" + cue), question)
                    self.assertEqual(meta["intent"], intent)
                    self.assertIn(cue, "\n".join(texts(msgs)))
            _msgs, meta = conv.handle_ex(new_uid("paid"), "皮包有霉味那筆我已付款，麻煩查一下")
            self.assertEqual(meta["intent"], "payment_check")
            uid = new_uid("correct")
            conv.handle_ex(uid, "羽絨外套可以水洗嗎")
            msgs, meta = conv.handle_ex(uid, "不是羽絨外套，我說的是羽絨被。")
            self.assertEqual(meta["intent"], "photo_quote")
            self.assertEqual(conv.get_sess(uid)["care_item"], "羽絨被")
            self.assertIn("是羽絨被", "\n".join(texts(msgs)))
            uid = new_uid("addr")
            conv.handle_ex(uid, "外收送預約")
            conv.set_sess(uid, pickup_addr="測試地址")
            msgs, meta = conv.handle_ex(uid, "地址我剛給了，還要再傳嗎？")
            self.assertEqual(meta["intent"], "pickup_address_question")
            self.assertIn("不用再傳", "\n".join(texts(msgs)))
            self.assertNotIn("測試地址", "\n".join(texts(msgs)))

    def test_compound_reply_uses_each_real_result_and_keeps_booking(self):
        import laundry_lookup
        fake = Fake(kind="resolve")
        fake.payload.update(actions=["order_status", "payment_review"], item="鞋")
        ai_chat.set_model(fake)
        ready = laundry_lookup.Lookup(query="fixture", customer_no="fixture", source="fixture", pieces=[
            laundry_lookup.Piece("fixture", "運動鞋", "stock", "fixture"),
            laundry_lookup.Piece("fixture2", "襯衫", "wash", "fixture"),
        ])
        question = "我好像刷了兩次，那雙鞋好了沒？"
        with mode("on"), sandbox(), mock.patch.object(conv, "auto_query_available", return_value=True), \
                mock.patch.object(laundry_lookup, "bound_customer", return_value="fixture"):
            uid = new_uid("compound")
            conv.handle_ex(uid, "外收送預約")
            state = conv.get_sess(uid).copy()
            with mock.patch.object(laundry_lookup, "lookup", return_value=ready), \
                    mock.patch.object(conv, "_push_payment_check", return_value=False) as payment:
                msgs, meta = conv.handle_ex(uid, question, event_id="fixture-e1")
                reply = "\n".join(texts(msgs))
                self.assertEqual(meta["intent"], "ai_resolved")
                self.assertIn("洗好了，可以取件", reply)
                self.assertIn("沒能留下核對資料", reply)
                self.assertNotIn("已留下核對資料", reply)
                payment.assert_called_once_with(uid, question, "fixture-e1")
            with mock.patch.object(laundry_lookup, "lookup", side_effect=TimeoutError), \
                    mock.patch.object(conv, "_push_payment_check", return_value=True):
                msgs, _ = conv.handle_ex(uid, question, event_id="fixture-e2")
                reply = "\n".join(texts(msgs))
                self.assertIn("逾時", reply)
                self.assertIn("已留下核對資料", reply)
                self.assertNotIn("查不到這筆", reply)
                self.assertNotIn("洗好了", reply)
            for field in ("wait", "pickup_form_id"):
                self.assertEqual(conv.get_sess(uid)[field], state[field])
            with mock.patch.object(ai_chat, "_decide", return_value=None), \
                    mock.patch.object(laundry_lookup, "lookup", return_value=ready), \
                    mock.patch.object(conv, "_push_payment_check", return_value=True):
                msgs, _ = conv.handle_ex(uid, question, event_id="fixture-e3")
                reply = "\n".join(texts(msgs))
                self.assertIn("哪一件", reply)
                self.assertIn("已留下核對資料", reply)
                self.assertNotIn("洗好了", reply)

    def test_unverified_actions_and_ambiguous_items_are_not_confirmed(self):
        import laundry_lookup
        self.assertIsNone(ai_chat.check_reply("我已經轉交店員了。", ""))
        self.assertIsNone(ai_chat.parse_decision('{"kind":"resolve","actions":["refund"],"item":"鞋"}'))
        row = laundry_lookup.Lookup(query="fixture", customer_no="fixture", source="fixture", pieces=[
            laundry_lookup.Piece("fixture1", "運動鞋", "stock", "fixture"),
            laundry_lookup.Piece("fixture2", "皮鞋", "wash", "fixture"),
        ])
        with mock.patch.object(conv, "auto_query_available", return_value=True), \
                mock.patch.object(laundry_lookup, "bound_customer", return_value="fixture"), \
                mock.patch.object(laundry_lookup, "lookup", return_value=row):
            reply = ai_chat._order_answer(conv, "fixture", "鞋")
            self.assertIn("哪一件", reply)
            self.assertNotIn("可以取件", reply)

    def test_store_policy_questions_get_one_relevant_next_step(self):
        with mode("off"), sandbox():
            cases = (
                ("我不在家，可以把袋子放管理室嗎？", "管理室方便代交"),
                ("可以叫家人幫我拿嗎？", "洗衣單號"),
                ("收到完成通知但只想拿其中一件。", "想先拿哪一件"),
                ("油漬很久了，還能弄嗎？", "污漬"),
            )
            for index, (question, cue) in enumerate(cases):
                msgs, _ = conv.handle_ex(new_uid(f"policy{index}"), question)
                self.assertIn(cue, "\n".join(texts(msgs)))

    def test_failed_handoff_says_it_did_not_reach_staff(self):
        with mode("on"), sandbox(), mock.patch.object(_staff, "push_inbox", return_value={"saved": False}):
            uid = new_uid("nohandoff")
            msgs, meta = conv.handle_ex(uid, "找真人")
            self.assertEqual(meta["intent"], "human")
            self.assertFalse(meta["staff_pushed"])
            self.assertIn("沒能轉到", "\n".join(texts(msgs)))

    def test_prewash_stains_answer_the_reported_condition(self):
        with mode("off"), sandbox():
            before = len(_staff.inbox)
            cases = (
                ("羊毛西裝的油污洗不洗得起來？", ("羊毛西裝", "油污", "洗標")),
                ("白襯衫上有黃斑，有沒有辦法洗掉？", ("襯衫", "黃斑", "近拍")),
                ("皮包的黴斑可以處理嗎？", ("皮包", "霉斑", "拍整個包")),
                ("帆布鞋上有髒污，可以清掉嗎？", ("帆布鞋", "整雙鞋", "近拍")),
                ("還沒送洗，這塊油污會不會洗不乾淨？", ("油污", "什麼物件")),
                ("不方便拍，昨天發現棉質外套有油污，可以處理嗎？",
                 ("棉質外套", "之前有自己洗過或擦過嗎")),
                ("鞋面這是咖啡嗎，還是顏料？", ("鞋面", "還分不出來源")),
            )
            for index, (question, cues) in enumerate(cases):
                with self.subTest(question=question):
                    msgs, meta = conv.handle_ex(new_uid(f"stain{index}"), question)
                    reply = "\n".join(texts(msgs))
                    self.assertEqual(meta["intent"], "photo_quote")
                    for cue in cues:
                        self.assertIn(cue, reply)
                    self.assertNotIn("一定洗得掉", reply)
            self.assertEqual(len(_staff.inbox), before)

    def test_unknown_stain_can_continue_after_one_item_question(self):
        with mode("off"), sandbox():
            uid = new_uid("unknownstain")
            msgs, meta = conv.handle_ex(uid, "我不知道沾到什麼東西，可以處理嗎？")
            self.assertEqual(meta["intent"], "photo_quote")
            self.assertIn("什麼物件", "\n".join(texts(msgs)))
            msgs, meta = conv.handle_ex(uid, "羊毛西裝")
            reply = "\n".join(texts(msgs))
            self.assertEqual(meta["intent"], "photo_quote")
            self.assertIn("羊毛西裝", reply)
            self.assertIn("還分不出來源", reply)
            self.assertNotIn("什麼物件", reply)
            self.assertFalse(conv.get_sess(uid)["prewash_stain"])
            uid = new_uid("yellowstain")
            conv.handle_ex(uid, "黃斑有沒有辦法洗掉？")
            msgs, meta = conv.handle_ex(uid, "白襯衫")
            self.assertEqual(meta["intent"], "photo_quote")
            self.assertIn("白襯衫的黃斑", "\n".join(texts(msgs)))

    def test_no_photo_intake_keeps_item_time_and_treatment(self):
        with mode("off"), sandbox():
            uid = new_uid("nophotointake")
            steps = (
                ("我沒照片，不知道沾到什麼，洗得掉嗎？", "什麼物件"),
                ("羊毛西裝", "什麼時候"),
                ("昨天發現的", "之前有自己洗過或擦過嗎"),
                ("有用水擦過", "把物件帶來"),
            )
            for question, cue in steps:
                msgs, meta = conv.handle_ex(uid, question)
                reply = "\n".join(texts(msgs))
                self.assertEqual(meta["intent"], "photo_quote")
                self.assertIn(cue, reply)
                self.assertNotIn("近拍", reply)
            self.assertFalse(conv.get_sess(uid)["prewash_stain"])

    def test_off_mid_booking_never_calls_model(self):
        fake = Fake(SIDE_REPLY)
        ai_chat.set_model(fake)
        with mode("off"), sandbox():
            uid = new_uid("offflow")
            conv.handle_ex(uid, "外收送預約")
            before = conv.get_sess(uid).get("pickup_form_id")
            _msgs, meta = conv.handle_ex(uid, "羽絨衣可以水洗嗎")
            self.assertNotEqual(meta["intent"], "ai_side_question")
            self.assertEqual(conv.get_sess(uid).get("pickup_form_id"), before)
        self.assertEqual(fake.calls, 0)

    def test_side_question_mid_booking(self):
        fake = Fake(SIDE_REPLY)
        ai_chat.set_model(fake)
        with mode("on"), sandbox():
            uid = new_uid("q")
            first = conv.handle_ex(uid, "外收送預約")[0]
            form = conv.get_sess(uid).get("pickup_form_id")
            msgs, meta = conv.handle_ex(uid, "羽絨衣可以水洗嗎")
            self.assertEqual(meta["intent"], "ai_side_question")
            self.assertEqual(len(msgs), 2)
            self.assertEqual(msgs[0]["text"], SIDE_REPLY)
            self.assertIn("回到剛剛", msgs[1]["text"])
            self.assertEqual(msgs[1]["quickReply"], first[-1]["quickReply"])
            sess = conv.get_sess(uid)
            self.assertEqual(sess.get("wait"), "pickup_when")
            self.assertEqual(sess.get("pickup_form_id"), form)
            conv.handle_ex(uid, "明天下午")
            self.assertTrue(conv.get_sess(uid).get("pickup_slot"))
        self.assertEqual(fake.calls, 1)
        self.assertGreaterEqual(usage_today()["counts"].get("side_answered", 0), 1)

    def test_known_new_intent_mid_flow_uses_existing_router(self):
        fake = Fake(kind="new_intent")
        ai_chat.set_model(fake)
        with mode("on"), sandbox():
            uid = new_uid("n")
            conv.handle_ex(uid, "外收送預約")
            form = conv.get_sess(uid).get("pickup_form_id")
            _msgs, meta = conv.handle_ex(uid, "改成拍照問價好了")
            self.assertNotIn(meta["intent"], ("pickup", "fallback"))
            self.assertEqual(conv.get_sess(uid).get("pickup_form_id"), form)
        self.assertEqual(fake.calls, 0)  # Known price intent must bypass the model.

    def test_price_mid_flow_goes_to_router_without_model(self):
        fake = Fake("西裝外套大概三百塊。")
        ai_chat.set_model(fake)
        with mode("on"), sandbox():
            uid = new_uid("p")
            conv.handle_ex(uid, "外收送預約")
            msgs, meta = conv.handle_ex(uid, "西裝外套洗一件多少錢")
            self.assertNotIn(meta["intent"], ("pickup", "fallback"))
            self.assertNotIn("三百塊", json.dumps(msgs, ensure_ascii=False))
        self.assertEqual(fake.calls, 0)

    # --- reply rules -------------------------------------------------------------
    def test_knowledge_excludes_history_prices_and_identifiers(self):
        with tempfile.TemporaryDirectory(prefix="v2-kb-") as folder:
            path = Path(folder)
            (path / "Memory.md").write_text("一般清洗規則。\n價格200元。\nAPI_KEY=synthetic-only\n## 📝 歷史\nHISTORY_SENTINEL\n", encoding="utf-8")
            (path / "Clothing_Memory.md").write_text("鞋款先看材質。\n", encoding="utf-8")
            with mock.patch.object(ai_chat._PE, "knowledge_dir", return_value=path):
                text = ai_chat._knowledge()
            self.assertIn("一般清洗規則", text)
            self.assertIn("鞋款先看材質", text)
            self.assertNotIn("200", text)
            self.assertNotIn("synthetic-only", text)
            self.assertNotIn("HISTORY_SENTINEL", text)

    def test_private_customer_input_never_reaches_model(self):
        fake = Fake(SIDE_REPLY)
        ai_chat.set_model(fake)
        with mode("on"), sandbox():
            for text in ("我住測試路123號，可以收嗎", "請寄到 synthetic@example.test", "密碼=synthetic-only"):
                self.assertIsNone(ai_chat._decide(conv, text, "pickup_when"))
        self.assertEqual(fake.calls, 0)

    def test_turnaround_is_tied_to_the_item_category(self):
        facts = ai_chat.facts_text(conv)
        for text in ("一般衣物 14 天。", "鞋 5–7 天。", "皮包 7 天。"):
            self.assertIsNone(ai_chat.check_reply(text, facts), text)
        self.assertEqual(ai_chat.check_reply("鞋 7 天。", facts), "鞋 7 天。")

    def test_check_reply_rules(self):
        facts = ai_chat.facts_text(conv)
        for bad in ("洗一件大概250元喔。", "大概 NT$300 左右。", "價錢約 300，看件再說。", "大約三百塊。",
                    "羽絨衣大概兩百五。", "鞋子三天就好。", "鞋 9 天可以好。", "我是AI小幫手。",
                    "我是真人店員喔。", "这个可以洗。", "請看 https://example.com 喔。", "保證洗得乾淨。"):
            self.assertIsNone(ai_chat.check_reply(bad, facts), bad)
        ok = ai_chat.check_reply("一般衣物 5–7 天，鞋 7 天。有趕時間再跟我說。", facts)
        self.assertEqual(ok, "一般衣物 5–7 天，鞋 7 天。有趕時間再跟我說。")

    def test_price_reply_rejected_falls_back(self):
        expected, _ = single_off(PARKING)
        fake = Fake("停車大概 NT$50，旁邊有停車場。")
        ai_chat.set_model(fake)
        with mode("on"), sandbox():
            msgs, meta = conv.handle_ex(new_uid("x"), PARKING)
        self.assertEqual(fake.calls, 1)
        self.assertEqual(meta["intent"], "fallback")
        self.assertEqual(msgs, expected)
        self.assertGreaterEqual(usage_today()["counts"].get("rejected", 0), 1)

    def test_reply_length_bounded(self):
        long_reply = ("羽絨衣多數可以水洗但要先看洗標和填充狀況。" "店裡會用低溫慢慢烘透讓羽絨回到蓬鬆。"
                      "洗前師傅會先檢查有沒有破洞或鑽毛的地方。" "方便的話先拍洗標給我們看看我們再跟您說怎麼處理比較好。"
                      "也可以直接帶來門市讓師傅摸摸材質。")
        ai_chat.set_model(Fake(long_reply))
        with mode("on"), sandbox():
            msgs, meta = conv.handle_ex(new_uid("l"), PARKING)
        self.assertEqual(meta["intent"], "ai_answer")
        for text in texts(msgs):
            self.assertLessEqual(len(text), ai_chat.MAX_REPLY_CHARS)
        ai_chat.set_model(Fake("羽" * 120 + "。"))
        with mode("on"), sandbox():
            _msgs, meta = conv.handle_ex(new_uid("m"), PARKING)
        self.assertEqual(meta["intent"], "fallback")

    # --- failures ----------------------------------------------------------------
    def test_timeout_keeps_today(self):
        expected, _ = single_off(PARKING)
        fake = Fake(SIDE_REPLY, delay=3.0)
        ai_chat.set_model(fake)
        with mock.patch.object(ai_chat, "TOTAL_SECONDS", 0.6), \
                mock.patch.object(ai_chat, "MIN_CALL_SECONDS", 0.1), \
                mock.patch.object(ai_chat, "PER_CALL_SECONDS", 0.5), mode("on"), sandbox():
            started = time.monotonic()
            msgs, meta = conv.handle_ex(new_uid("t"), PARKING)
            elapsed = time.monotonic() - started
        self.assertLess(elapsed, 2.5)
        self.assertGreaterEqual(fake.calls, 1)
        self.assertEqual(meta["intent"], "fallback")
        self.assertEqual(msgs, expected)

    def test_429_keeps_today(self):
        expected, _ = single_off(PARKING)
        ai_chat.set_model(Fake(error=ai_chat.ModelError("http_429")))
        with mode("on"), sandbox():
            msgs, meta = conv.handle_ex(new_uid("z"), PARKING)
        self.assertEqual(meta["intent"], "fallback")
        self.assertEqual(msgs, expected)
        models = usage_today()["models"]
        self.assertTrue(any(slot.get("http_429") for slot in models.values()), models)

    # --- counting ----------------------------------------------------------------
    def test_usage_counts_contain_no_text(self):
        secret = "我家阿嬤的貓咪很可愛嗎"
        uid = new_uid("secret")
        ai_chat.set_model(Fake("真的很可愛，有需要送洗再跟我說。"))
        with mode("on"), sandbox():
            conv.handle_ex(uid, secret)
            conv.handle_ex(uid, PARKING)
        files = list(USAGE_DIR.glob("*.json"))
        self.assertTrue(files)
        allowed = set(ai_chat.COUNT_KEYS)
        model_keys = set(ai_chat._PE._USAGE_KEYS)
        for path in files:
            raw = path.read_text(encoding="utf-8")
            self.assertNotIn(uid, raw)
            data = json.loads(raw)
            self.assertNotIn(secret, json.dumps(data, ensure_ascii=False))
            self.assertEqual(set(data), {"schema", "date", "counts", "models"})
            self.assertEqual(data["schema"], ai_chat.CHAT_SCHEMA)
            self.assertRegex(data["date"], r"^\d{4}-\d{2}-\d{2}$")
            for key, value in data["counts"].items():
                self.assertIn(key, allowed)
                self.assertIs(type(value), int)
            for model, slot in data["models"].items():
                self.assertTrue(re.fullmatch(r"gemini-[a-zA-Z0-9.-]+", model))
                for key, value in slot.items():
                    self.assertIn(key, model_keys)
                    self.assertIs(type(value), int)


if __name__ == "__main__":
    unittest.main(verbosity=2)
