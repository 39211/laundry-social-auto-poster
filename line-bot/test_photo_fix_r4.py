"""PHOTO-FIX r4: spacing, honest batch brands and mid-sentence plural guard."""
import unittest

import estimate
from test_photo_fix_r1 import draft, row
from test_photo_fix_r3 import detail_headings, question_lines


class FinalCopyTests(unittest.TestCase):
    def test_chinese_question_subject_has_no_space_after_about(self):
        cases = (
            ([row("一般運動鞋", certainty="uncertain", reason="看不到洗標",
                  question="可以補拍洗標嗎")], "關於照片中的鞋子，"),
            ([row("棉被雙人", question="可以補拍洗標嗎")], "關於棉被雙人，"),
            ([row(quantity=30, question="這件曾自行刷洗嗎")], "關於這批襯衫，"),
            ([row(brand="無印良品", question="曾自行刷洗嗎")], "關於無印良品 襯衫，"),
        )
        for items, prefix in cases:
            with self.subTest(prefix=prefix):
                text = estimate.render(draft(*items))
                questions = question_lines(text)
                self.assertEqual(len(questions), 1, text)
                self.assertTrue(questions[0].startswith(prefix), questions)
                self.assertNotIn("關於 ", questions[0])

    def test_english_and_numeric_question_subject_keep_one_space(self):
        for brand in ("Uniqlo", "3M"):
            with self.subTest(brand=brand):
                text = estimate.render(draft(row(brand=brand, question="曾自行刷洗嗎")))
                self.assertEqual(question_lines(text), [f"關於 {brand} 襯衫，曾自行刷洗嗎？"])

    def test_mixed_brand_batch_does_not_attribute_every_item_to_first_brand(self):
        value = draft(*[row(brand="合成品牌" + str(i), material="棉", stain="黃漬")
                        for i in range(30)])
        text = estimate.render(value)
        self.assertEqual(detail_headings(text), ["襯衫（30 件，棉，品牌不一）：照片看到黃漬。"])
        self.assertNotIn("合成品牌", text)
        self.assertIn("2,100", text)
        self.assertIn("5–7 天", text)

    def test_same_brand_batch_names_shared_brand_without_etc(self):
        text = estimate.render(draft(*[row(brand="Uniqlo", material="棉", stain="灰漬") for _ in range(3)]))
        self.assertEqual(detail_headings(text), ["襯衫（Uniqlo，3 件，棉）：照片看到灰漬。"])
        self.assertNotIn("等", "\n".join(detail_headings(text)))
        self.assertNotIn("品牌不一", text)
        self.assertIn("210", text)

    def test_brandless_batch_does_not_invent_a_shared_brand(self):
        text = estimate.render(draft(row(material="棉", stain="灰漬"), row(material="棉", stain="灰漬")))
        self.assertEqual(detail_headings(text), ["襯衫（2 件，棉）：照片看到灰漬。"])
        self.assertNotIn("品牌不一", text)

    def test_group_question_replaces_mid_sentence_singular_and_retains_followup_context(self):
        for items in (
            [row(quantity=30, stain="灰漬", question="請問這件曾自行刷洗嗎")],
            [row(brand="Uniqlo", stain="灰漬", question="請問這件曾自行刷洗嗎"),
             row(brand="MUJI", stain="灰漬")],
        ):
            with self.subTest(rows=len(items)):
                value = draft(*items)
                text = estimate.render(value)
                questions = question_lines(text)
                self.assertEqual(len(questions), 1, text)
                self.assertIn("請問這批物品曾自行刷洗嗎？", questions[0])
                self.assertNotIn("這件", questions[0])
                asked = [item["question"] for item in estimate.photo_followup_items(value) if item["question"]]
                self.assertEqual(asked, questions)

    def test_single_item_mid_sentence_singular_remains_singular(self):
        text = estimate.render(draft(row(question="請問這件曾自行刷洗嗎")))
        self.assertIn("請問這件曾自行刷洗嗎？", question_lines(text)[0])
        self.assertNotIn("這批物品", text)


if __name__ == "__main__":
    unittest.main()
