"""PHOTO-FIX r3: customer-facing item identity and follow-up structure, offline."""
import re
import unittest

import estimate
from test_photo_fix_r1 import draft, row


# Match all customer heading-shaped lines, independently of renderer internals.
HEADING = re.compile(r"^[^\n：:，,。？?]+(?:（[^\n）]*）)?[：:]", re.M)
OLD_NUMBER = re.compile(r"^第[0-9一二三四五六七八九十百、–－-]+件", re.M)


def question_lines(text):
    return [line for line in text.splitlines() if "？" in line or "?" in line]


def detail_headings(text):
    # Price lines carry a quantity / currency, unlike diagnostic item titles.
    return [line for line in text.splitlines() if HEADING.match(line)
            and not re.search(r"元|費用待|數量待確認：", line)]


class NaturalReplyTests(unittest.TestCase):
    def text(self, *items):
        return estimate.render(draft(*items))

    def assert_structure(self, text, groups):
        self.assertLessEqual(len(detail_headings(text)), groups, text)
        for line in question_lines(text):
            self.assertIsNone(HEADING.match(line), line)
            self.assertIsNone(OLD_NUMBER.match(line), line)
        self.assertNotRegex(text, r"約\s*[\d,]+\s*元，約\s*\d")

    def test_single_item_title_names_item_brand_and_material_without_number(self):
        text = self.text(row(label="白襯衫", brand="Uniqlo", material="棉", stain="領口黃漬"))
        self.assertIn("白襯衫（Uniqlo，棉）：照片看到領口黃漬。", text)
        self.assertNotRegex(text, r"第[一1]件")
        self.assert_structure(text, 1)

    def test_brandless_title_and_empty_metadata_are_natural(self):
        self.assertIn("襯衫（棉）：照片看到黃漬。", self.text(row(material="棉", stain="黃漬")))
        self.assertIn("襯衫：照片看到黃漬。", self.text(row(stain="黃漬")))

    def test_two_different_items_have_two_titles_and_named_question(self):
        text = self.text(row(brand="Uniqlo", material="棉", stain="黃漬", question="這處黃漬多久了"),
                         row("一般運動鞋", brand="ASICS", material="網布", stain="泥漬"))
        self.assertEqual(len(detail_headings(text)), 2, text)
        self.assertIn("Uniqlo 襯衫", question_lines(text)[0])
        self.assert_structure(text, 2)

    def test_same_name_distinct_brands_do_not_need_ordinals(self):
        text = self.text(row(brand="Uniqlo", material="棉", stain="袖口灰漬"),
                         row(brand="MUJI", material="麻", stain="黃漬", question="黃漬多久了"))
        self.assertIn("襯衫（Uniqlo，棉）：", text)
        self.assertIn("襯衫（MUJI，麻）：", text)
        self.assertNotRegex(text, r"第[一二12]件")
        self.assertIn("MUJI 襯衫", question_lines(text)[0])
        self.assert_structure(text, 2)

    def test_same_name_same_brand_uses_distinct_ordinals_in_titles_and_question(self):
        text = self.text(row(brand="Uniqlo", material="棉", stain="袖口灰漬"),
                         row(brand="Uniqlo", material="棉", stain="黃漬", question="黃漬多久了"))
        self.assertIn("第一件襯衫（Uniqlo，棉）：", text)
        self.assertIn("第二件襯衫（Uniqlo，棉）：", text)
        self.assertIn("第二件襯衫", question_lines(text)[0])
        self.assert_structure(text, 2)

    def test_merged_thirty_items_use_one_title_and_batch_question(self):
        text = self.text(*[row(brand="品牌"+str(i), material="棉", stain="黃漬",
                              question="這件有自行使用過去漬劑或漂白水嗎") for i in range(30)])
        self.assertEqual(len(detail_headings(text)), 1, text)
        self.assertIn("這批襯衫", question_lines(text)[0])
        self.assertNotIn("這件", question_lines(text)[0])
        self.assertIn("2,100", text)
        self.assert_structure(text, 1)

    def test_single_inventory_row_with_quantity_thirty_also_uses_batch_question(self):
        text = self.text(row(quantity=30, material="棉", stain="黃漬", question="這件曾自行刷洗嗎"))
        self.assertIn("30 件", text)
        self.assertIn("這批襯衫", question_lines(text)[0])
        self.assertNotIn("這件", question_lines(text)[0])
        self.assert_structure(text, 1)

    def test_noncontiguous_merged_group_question_follows_its_group(self):
        text = self.text(row(material="棉", stain="灰漬", question="曾刷洗嗎"),
                         row(material="麻", stain="黃漬"),
                         row(material="棉", stain="灰漬", question="這件污漬多久了"))
        self.assertEqual(len(detail_headings(text)), 2, text)
        self.assertIn("第一批襯衫", question_lines(text)[0])
        self.assertNotIn("這件", question_lines(text)[0])
        self.assert_structure(text, 2)

    def test_question_about_omitted_group_is_named_without_a_sixth_detail_title(self):
        value = draft(*[row(brand="品牌"+chr(0x4e00+i), stain="污況"+chr(0x4e00+i),
                            question="污漬多久了" if i == 6 else "曾刷洗嗎") for i in range(7)])
        text = estimate.render(value)
        self.assertEqual(len(detail_headings(text)), 5, text)
        self.assertIn("品牌丆 襯衫", question_lines(text)[0])
        asked = [x["question"] for x in estimate.photo_followup_items(value) if x["question"]]
        self.assertEqual(asked, question_lines(text))
        self.assert_structure(text, 7)

    def test_merged_different_labels_use_shared_item_name(self):
        text = self.text(row(label="白襯衫", stain="灰漬", question="這件曾自行刷洗嗎"),
                         row(label="藍襯衫", stain="灰漬"))
        self.assertIn("襯衫（2 件）：", text)
        self.assertIn("這批襯衫", question_lines(text)[0])
        self.assertNotIn("這批白襯衫", text)
        self.assert_structure(text, 1)

    def test_compact_titles_still_distinguish_same_name_by_brand(self):
        value = draft(row(brand="Uniqlo", model="款"*40, material="棉"*40, stain="灰漬"*15, craft="局部處理"*9),
                      row(brand="MUJI", model="款"*40, material="麻"*40, stain="黃漬"*15, craft="局部測試"*9))
        messages = estimate.render_messages(value, max_messages=1,
            notice="這份清單共有兩件襯衫，以下分別說明照片裡的狀況與處理方式，實際仍需看件確認。")
        self.assertEqual(len(messages), 1)
        self.assertLessEqual(len(messages[0]), 400)
        headings = detail_headings(messages[0])
        self.assertEqual(len(headings), 2)
        self.assertTrue(headings[0].startswith("襯衫（Uniqlo）："), headings)
        self.assertTrue(headings[1].startswith("襯衫（MUJI）："), headings)

    def test_equal_range_fee_is_estimated_and_turnaround_keeps_approximation(self):
        text = self.text(row("一般運動鞋", certainty="uncertain", reason="看不到洗標", stain="鞋緣灰痕"))
        self.assertIn("預估 250 元，約 7 天", text)
        self.assertNotIn("250–250", text)
        self.assert_structure(text, 1)

    def test_low_confidence_title_and_question_do_not_assert_unknown_brand_or_tariff(self):
        text = self.text(row("一般運動鞋", certainty="uncertain", reason="看不到洗標", brand="疑似 Nike",
                             stain="灰痕", question="可以補拍洗標嗎"))
        self.assertIn("照片中的鞋子：", text)
        self.assertNotIn("Nike", text)
        self.assertNotIn("一般運動鞋", text)
        self.assert_structure(text, 1)

    def test_all_six_original_fixtures_obey_actual_group_count(self):
        # Import the unchanged fixture definitions, not copies tailored to r3.
        import sys
        from pathlib import Path
        from unittest.mock import patch
        with patch.object(sys, "path", [str(Path(__file__).parent / "test-assets")] + sys.path):
            from photo_fix_r2_checks import sample_cases
        from test_photo_fix_r1 import PRICES
        expected = (2, 1, 2, 1, 4, 1)
        for (title, items, extra), groups in zip(sample_cases(), expected, strict=True):
            with self.subTest(title=title):
                value = draft(*items)
                if extra:
                    value = estimate.update(extra, value, PRICES)
                messages = estimate.render_messages(value)
                text = "\n".join(messages)
                self.assert_structure(text, groups)
                self.assertEqual(len(detail_headings(text)), groups, text)
                self.assertLessEqual(len(messages), 3)
                self.assertTrue(all(len(m) <= 400 for m in messages))
                self.assertLessEqual(len(question_lines(text)), 1)
                if groups == 1 and len(items) > 1:
                    self.assertNotIn("這件", "\n".join(question_lines(text)))


if __name__ == "__main__":
    unittest.main()
