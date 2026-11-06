# -*- coding: utf-8 -*-
"""Owner decision 11/06 on the shop PC: 毛毯、窗簾、沙發套 are 難乾的大件, 10–14 天 (睡袋、娃娃、皮衣 still no days).

Stdlib only; no network. Run from shop-pc/fxwash:
  python -I -S -B -m unittest discover -s runtime -p "test_bulky_days_1106.py"
"""
from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import dialog_corpus  # noqa: E402
from runtime import chat_guards  # noqa: E402

CHAT_SERVICE = (ROOT / "runtime" / "chat_service.py").read_text(encoding="utf-8")
PHRASES = json.loads((ROOT / "config" / "Dialog_Phrases.json").read_text(encoding="utf-8-sig"))
BUILDER = (ROOT / "build_expanded_corpus.py").read_text(encoding="utf-8")
CORPUS_SOURCE = (ROOT / "config" / "dialog_corpus.py").read_text(encoding="utf-8")


def all_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from all_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from all_strings(value)


class DayGuardTests(unittest.TestCase):
    def test_ten_to_fourteen_is_grounded_for_the_bulky_items(self):
        for text in ("毛毯約 10–14 天", "窗簾大概 10–14 天", "沙發套 10–14 天", "地毯約 10–14 天"):
            self.assertTrue(chat_guards._duration_is_grounded(text), text)

    def test_other_day_counts_are_not_grounded_for_the_bulky_items(self):
        for text in ("毛毯約 5–7 天", "窗簾約 7 天", "沙發套 14 天"):
            self.assertFalse(chat_guards._duration_is_grounded(text), text)

    def test_other_categories_unchanged(self):
        self.assertTrue(chat_guards._duration_is_grounded("鞋約 7 天"))
        self.assertTrue(chat_guards._duration_is_grounded("皮件和包 14 天"))
        self.assertFalse(chat_guards._duration_is_grounded("鞋約 10–14 天"))


class ChatTextTests(unittest.TestCase):
    def test_system_prompt_lists_the_owner_items_in_the_bulky_group(self):
        self.assertIn("厚棉被、羽絨被、毛毯（含羊毛毯）、地毯、窗簾、沙發套這類難乾的大件 10–14 天", CHAT_SERVICE)

    def test_items_without_days_no_longer_include_curtains(self):
        self.assertIn("皮衣、娃娃、睡袋等其他品項不報天數", CHAT_SERVICE)
        self.assertNotIn("皮衣、窗簾", CHAT_SERVICE)

    def test_turnaround_template_names_the_bulky_items(self):
        self.assertIn("厚棉被、毛毯、窗簾、沙發套這類難乾的大件 10–14 天", CHAT_SERVICE)


class CannedPhraseTests(unittest.TestCase):
    CURTAIN = "窗簾與大布簾因拆洗晾乾程序較長，屬難乾的大件，約 10–14 天，建議可先拍照傳送評估。"
    SMOKE = "交期屬難乾的大件約 10–14 天；氣味能改善多少，則是看件後店裡跟您說。"

    def test_curtain_phrases_state_ten_to_fourteen_in_every_copy(self):
        for name, blob in (("Dialog_Phrases.json", "\n".join(all_strings(PHRASES))), ("dialog_corpus.py", CORPUS_SOURCE)):
            with self.subTest(file=name):
                self.assertIn(self.CURTAIN, blob)
                self.assertIn(self.SMOKE, blob)
        self.assertIn(self.SMOKE, BUILDER)

    def test_old_see_the_item_first_curtain_wording_is_gone(self):
        for blob in ("\n".join(all_strings(PHRASES)), CORPUS_SOURCE, BUILDER):
            self.assertNotIn("交期看件後店裡跟您說，建議可先拍照傳送評估", blob)
            self.assertNotIn("交期多久，都是看件後店裡跟您說", blob)

    def test_every_curtain_phrase_with_days_says_ten_to_fourteen(self):
        phrases = [s for s in all_strings(PHRASES) if "窗簾" in s]
        self.assertTrue(phrases)
        for s in phrases:
            for days in re.findall(r"(\d+)\s*[–\-~]?\s*(\d+)?\s*天", s):
                self.assertEqual(days, ("10", "14"), s)

    def test_corpus_module_and_json_agree_on_curtain_phrases(self):
        json_curtain = sorted(s for s in all_strings(PHRASES) if "窗簾" in s)
        module_strings = [s for s in all_strings(
            {k: v for k, v in vars(dialog_corpus).items() if not k.startswith("_") and isinstance(v, (list, dict, str))}) if "窗簾" in s]
        self.assertEqual(sorted(set(json_curtain)), sorted(set(module_strings)))


if __name__ == "__main__":
    unittest.main()
