# -*- coding: utf-8 -*-
"""Owner decision 11/06: 毛毯、窗簾、沙發套 are 難乾的大件, 10–14 天 (睡袋 and other unlisted items still get no days).

Covers the generic turnaround answers, the AI night-chat fact and the AI night-chat day guard.
Run this file in its own Python process. No real network, no production writes.
"""
from __future__ import annotations

import sys
import unittest

sys.dont_write_bytecode = True
from test_review_r1105a import _Isolated, ai_chat, conv  # noqa: F401  (harness setup)


class GenericAnswerTests(_Isolated):
    def test_how_long_answer_names_the_bulky_items(self):
        uid = self.uid("gen1")
        body, _ = self.say(uid, "要洗多久")
        for word in ("厚棉被", "毛毯", "窗簾", "沙發套", "10–14"):
            self.assertIn(word, body)
        self.assertNotIn("睡袋", body)

    def test_both_wordings_of_the_generic_answer_name_the_bulky_items(self):
        # "你" wording: 要洗多久 / 通常幾天拿得到;  "您" wording: 鞋子多久可以拿 / 棉被要洗幾天 (see tests/golden cases).
        for index, text in enumerate(("要洗多久", "通常幾天拿得到", "鞋子多久可以拿", "棉被要洗幾天")):
            with self.subTest(text=text):
                body, _ = self.say(self.uid(f"gen{index}"), text)
                self.assertIn("厚棉被、毛毯、窗簾、沙發套這類難乾的大件 10–14 天", body)

    def test_the_two_wordings_are_both_reached(self):
        you, _ = self.say(self.uid("w1"), "要洗多久")
        you_polite, _ = self.say(self.uid("w2"), "鞋子多久可以拿")
        self.assertIn("跟你說交期", you)
        self.assertIn("跟您說交期", you_polite)


class AiChatFactTests(unittest.TestCase):
    def test_fact_lists_the_owner_items_and_not_sleeping_bags(self):
        fact = ai_chat.TURNAROUND_FACT
        for word in ("毛毯", "窗簾", "沙發套", "10–14"):
            self.assertIn(word, fact)
        self.assertNotIn("睡袋", fact)

    def test_day_guard_accepts_ten_to_fourteen_for_the_bulky_items(self):
        for text in ("毛毯約 10–14 天", "窗簾大概 10–14 天", "沙發套 10–14 天", "地毯約 10–14 天"):
            self.assertTrue(ai_chat._duration_is_grounded(text), text)

    def test_day_guard_rejects_other_day_counts_for_the_bulky_items(self):
        for text in ("毛毯約 5–7 天", "窗簾約 7 天", "沙發套 14 天", "地毯約 3 天"):
            self.assertFalse(ai_chat._duration_is_grounded(text), text)

    def test_day_guard_keeps_the_other_categories(self):
        self.assertTrue(ai_chat._duration_is_grounded("鞋約 7 天"))
        self.assertTrue(ai_chat._duration_is_grounded("皮件和包 14 天"))
        self.assertFalse(ai_chat._duration_is_grounded("鞋約 10–14 天"))


if __name__ == "__main__":
    unittest.main()
