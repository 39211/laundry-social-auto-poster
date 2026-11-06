# -*- coding: utf-8 -*-
"""Regression tests for review card R-1105c (merge 85c4f601).

Each test fails on 85c4f601 and passes with the card's EDIT blocks, except tests named
test_guard_*, which must pass before and after. Reuses the isolated harness from
test_review_r1105a (temp data dir, no network, LAUNDRY_AI_CHAT=off for conversation tests).
Run: cd line-bot && python -m unittest test_review_r1105c -v
"""
from __future__ import annotations

import unittest
from unittest import mock

from test_review_r1105a import FIXED_NOW, _Isolated, ai_chat, conv  # noqa: F401  (harness setup)


class HandoffArrivalTests(unittest.TestCase):
    def test_real_human_request_with_arrival_words_still_hands_off(self):
        for text in ("我已經到門口了，老闆在嗎",
                     "收件時間過了都沒人來，請老闆打給我",
                     "說好下午來收，時間到了還沒人來，打電話給我"):
            with self.subTest(text=text):
                self.assertTrue(ai_chat.is_handoff_text(text))

    def test_guard_arrival_contact_note_is_not_a_handoff(self):
        for text in ("到了打電話給我", "到樓下撥電話給我就好", "送到時再打電話給我"):
            with self.subTest(text=text):
                self.assertFalse(ai_chat.is_handoff_text(text))






class ComplaintTests(_Isolated):
    def test_real_complaints_are_not_dropped(self):
        for text in ("你們洗不乾淨，我自己再洗還比較乾淨",
                     "昨天拿回來的外套還有別的污漬",
                     "你們洗過的襯衫還有其他地方黃黃的"):
            with self.subTest(text=text):
                self.assertTrue(conv._is_complaint(text))

    def test_guard_r1105a_non_complaints_stay_non_complaints(self):
        for text in ("衣服上的油漬自己洗不乾淨，你們可以處理嗎",
                     "上次送洗很滿意，這次還有一件襯衫領口黃黃的想送洗",
                     "收送有最少件數嗎"):
            with self.subTest(text=text):
                self.assertFalse(conv._is_complaint(text))

    def test_minimum_order_question_is_not_a_complaint(self):
        for text in ("最少一件就能收送嗎", "至少一件就可以收嗎"):
            with self.subTest(text=text):
                self.assertFalse(conv._is_complaint(text))

    def test_missing_or_wrong_item_gets_the_apology(self):
        for text in ("我送洗五件只回來四件，少一件", "你們給我的衣服拿錯了"):
            with self.subTest(text=text):
                body, meta = self.say(self.uid("miss"), text)
                self.assertEqual(meta["intent"], "complaint")
                self.assertIn("抱歉這次洗護結果讓你困擾", body)


class PickupStepTests(_Isolated):
    def test_status_question_in_pickup_step_is_not_saved_as_the_item(self):
        uid = self.uid("stat")
        self.say(uid, "外收送預約")
        conv.set_sess(uid, wait="pickup_confirm", pickup_item="")
        self.say(uid, "我上次送洗的外套洗好了沒")
        item = str((conv.get_sess(uid) or {}).get("pickup_item") or "")
        self.assertNotIn("洗好了沒", item)


class TurnaroundTests(_Isolated):
    def ask_days(self, item: str) -> str:
        uid = self.uid("days")
        real_lookup = conv.lookup_item

        def lookup(name, *a, **k):
            return (item, 0, "衣物") if name == item else real_lookup(name, *a, **k)

        conv.set_sess(uid, care_item=item, care_item_at=FIXED_NOW.isoformat())
        with mock.patch.object(conv, "lookup_item", side_effect=lookup):
            body, _ = self.say(uid, "那這件幾天能拿")
        return body

    def test_items_without_an_owner_turnaround_get_no_day_range(self):
        # 11/06: the owner put 毛毯、窗簾、沙發套 (and, per his C03 list, 地毯) into 難乾的大件 10–14 天; 睡袋 still has none.
        for item in ("睡袋",):
            with self.subTest(item=item):
                body = self.ask_days(item)
                self.assertNotIn("10–14", body)
                self.assertNotIn("5–7", body)

    def test_owner_bulky_items_get_the_bulky_range(self):
        for item in ("毛毯", "窗簾", "沙發套", "地毯"):
            with self.subTest(item=item):
                body = self.ask_days(item)
                self.assertIn("10–14", body)
                self.assertNotIn("5–7", body)

    def test_quilt_called_bei_zi_gets_bulky_turnaround(self):
        body = self.ask_days("被子")
        self.assertIn("10–14", body)
        self.assertNotIn("5–7", body)

    def test_guard_down_quilt_still_bulky(self):
        self.assertIn("10–14", self.ask_days("羽絨被"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
