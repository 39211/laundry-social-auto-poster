# -*- coding: utf-8 -*-
"""Regression tests for review card R-1105a (merge 1aec0ed6).

Each test fails on 1aec0ed6 and passes with the card's EDIT blocks, except the guard
test_real_complaints_still_route_and_apologise, which must pass before and after.
Isolated temp data, no network, LAUNDRY_AI_CHAT=off for conversation tests.
Run: cd line-bot && python -m unittest test_review_r1105a -v
"""
from __future__ import annotations

import atexit
import os
import shutil
import sys
import tempfile
import unittest
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from types import ModuleType
from unittest import mock

HERE = Path(__file__).resolve().parent
_TMP = Path(tempfile.mkdtemp(prefix="review-r1105a-"))
atexit.register(shutil.rmtree, _TMP, True)
(_TMP / "data").mkdir(parents=True, exist_ok=True)

_FRESH = "conversation" not in sys.modules
if _FRESH:
    _src = Path(os.environ.get("LAUNDRY_REPO_ROOT") or HERE.parent).resolve()
    for _name in ("prices.json", "business-profile.json"):
        if (_src / "data" / _name).is_file():
            shutil.copy2(_src / "data" / _name, _TMP / "data" / _name)
    os.environ.update(
        LAUNDRY_REPO_ROOT=str(_TMP),
        LAUNDRY_LOOKUP_FIXTURE="1",
        LAUNDRY_CHAT_USAGE_DIR=str(_TMP / "data" / "chat-usage"),
        LAUNDRY_VISION_USAGE_DIR=str(_TMP / "data" / "vision-usage"),
    )
    os.environ.pop("GEMINI_API_KEY", None)
sys.path.insert(0, str(HERE))


def _no_network(*_a, **_k):
    raise RuntimeError("network disabled in tests")


urllib.request.urlopen = _no_network

_existing_staff = sys.modules.get("staff_notify")
if _existing_staff is not None and hasattr(_existing_staff, "inbox"):
    STAFF = _existing_staff
else:
    STAFF = ModuleType("staff_notify")
    STAFF.inbox = []
    STAFF.guest_name = lambda _uid: "測試客人"
    STAFF.push_inbox = lambda kind, rec, **_k: (STAFF.inbox.append((kind, rec)) or {"saved": True, "notified": True})
    sys.modules["staff_notify"] = STAFF
if not hasattr(sys.modules.get("line_pay"), "configured"):
    _pay = ModuleType("line_pay")
    _pay.configured = lambda: False
    sys.modules["line_pay"] = _pay

import conversation as conv  # noqa: E402
import ai_chat  # noqa: E402

if _FRESH and hasattr(conv, "cprof") and hasattr(conv.cprof, "PROFILE_PATH"):
    conv.cprof.PROFILE_PATH = _TMP / "data" / "line-customer-profile.json"

_TZ = getattr(conv, "TZ", None)
FIXED_NOW = datetime(2026, 11, 4, 14, 0, tzinfo=_TZ) if _TZ else datetime(2026, 11, 4, 14, 0)  # Wednesday


class _Isolated(unittest.TestCase):
    def setUp(self):
        folder = Path(tempfile.mkdtemp(dir=_TMP))
        for patcher in (
            mock.patch.dict(os.environ, {"LAUNDRY_AI_CHAT": "off"}),
            mock.patch.object(conv, "SESS", folder / "line-sessions.json"),
            mock.patch.object(conv, "BOOK", folder / "line-bookings.jsonl"),
            mock.patch.object(conv, "now_tw", lambda: FIXED_NOW),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def uid(tag: str) -> str:
        return "Urv" + tag + uuid.uuid4().hex[:12]

    @staticmethod
    def say(uid: str, text: str):
        msgs, meta = conv.handle_ex(uid, text)
        body = "\n".join(m.get("text") or "" for m in msgs or [] if m.get("type") == "text")
        return body, meta


class ComplaintScopeTests(_Isolated):
    def test_pre_service_damage_is_not_apologised_as_a_wash_result(self):
        body, _ = self.say(self.uid("tear"), "外套袖口破掉了，可以補嗎")
        self.assertNotIn("抱歉這次洗護結果", body)
        self.assertIn("先別急", body)

    def test_lost_ticket_is_not_apologised_as_a_wash_result(self):
        body, _ = self.say(self.uid("ticket"), "洗衣單不見了怎麼辦")
        self.assertNotIn("抱歉這次洗護結果", body)

    def test_normal_questions_are_not_complaints(self):
        for text in (
            "收送有最少件數嗎",
            "衣服上的油漬自己洗不乾淨，你們可以處理嗎",
            "上次送洗很滿意，這次還有一件襯衫領口黃黃的想送洗",
        ):
            with self.subTest(text=text):
                self.assertFalse(conv._is_complaint(text))

    def test_real_complaints_still_route_and_apologise(self):
        # Guard: must pass before and after the fix.
        for text in ("上次洗的襯衫領口還是黃黃的", "昨天拿回來的外套油漬還在", "你們洗完的大衣縮水了"):
            with self.subTest(text=text):
                self.assertTrue(conv._is_complaint(text))
                body, meta = self.say(self.uid("real"), text)
                self.assertEqual(meta["intent"], "complaint")
                self.assertIn("抱歉這次洗護結果讓你困擾", body)


class PickupStepTests(_Isolated):
    def test_slot_answer_phrased_as_question_is_not_answered_with_store_hours(self):
        uid = self.uid("slot")
        self.say(uid, "外收送預約")
        self.assertEqual((conv.get_sess(uid) or {}).get("wait"), "pickup_when")
        body, meta = self.say(uid, "明天下午可以來拿嗎")
        self.assertNotEqual(meta["intent"], "hours_day")
        self.assertNotIn("門市時段", body)

    def test_typed_address_with_building_note_is_not_swallowed(self):
        uid = self.uid("addr")
        self.say(uid, "外收送預約")
        conv.set_sess(uid, wait="pickup_addr")
        _body, meta = self.say(uid, "台中市北區測試路1號5樓，放管理室就好")
        self.assertNotEqual(meta["intent"], "pickup_policy")


class TurnaroundTests(_Isolated):
    def test_bulky_bedding_is_not_quoted_general_clothing_turnaround(self):
        uid = self.uid("bulky")
        real_lookup = conv.lookup_item
        fake_row = ("羽絨被", 0, "衣物")

        def lookup(name, *a, **k):
            return fake_row if name == "羽絨被" else real_lookup(name, *a, **k)

        conv.set_sess(uid, care_item="羽絨被", care_item_at=FIXED_NOW.isoformat())
        with mock.patch.object(conv, "lookup_item", side_effect=lookup):
            body, _ = self.say(uid, "那這件幾天能拿")
        self.assertNotIn("5–7", body)
        self.assertIn("10–14", body)


class StainScopeTests(_Isolated):
    def test_either_or_question_is_not_an_unknown_stain(self):
        self.assertIsNone(conv._UNKNOWN_STAIN.search("不知道要用收送還是自己拿過去"))
        self.assertIsNone(conv._UNKNOWN_STAIN.search("不知道要乾洗還是水洗"))
        self.assertIsNotNone(conv._UNKNOWN_STAIN.search("不知道是咖啡還是醬油"))
        body, _ = self.say(self.uid("either"), "不知道要用收送還是自己拿過去")
        self.assertNotIn("分不出是咖啡", body)
        self.assertNotIn("是沾在什麼物件上", body)

    def test_bag_of_dirty_laundry_is_not_a_stain_intake(self):
        body, _ = self.say(self.uid("dirty"), "我有一袋髒衣服可以洗嗎")
        self.assertNotIn("污漬可以先評估", body)
        self.assertNotIn("近拍污漬", body)


class AiReplyGuardTests(unittest.TestCase):
    def test_check_reply_rejects_unapproved_turnaround(self):
        facts = ai_chat.facts_text(conv)
        for bad in ("襯衫明天就可以拿喔。", "羽絨衣 5 小時就能洗好。", "皮包大概 5 週。", "這件隔天就好。"):
            with self.subTest(reply=bad):
                self.assertIsNone(ai_chat.check_reply(bad, facts))
        ok = "一般衣物 5–7 天，鞋 7 天。有趕時間再跟我說。"
        self.assertEqual(ai_chat.check_reply(ok, facts), ok)

    def test_arrival_instruction_is_not_a_handoff(self):
        self.assertFalse(ai_chat.is_handoff_text("到了打電話給我"))
        self.assertFalse(ai_chat.is_handoff_text("到樓下撥電話給我就好"))
        for text in ("找真人", "可以打電話給我嗎", "老闆在嗎"):
            with self.subTest(text=text):
                self.assertTrue(ai_chat.is_handoff_text(text))


if __name__ == "__main__":
    unittest.main(verbosity=2)
