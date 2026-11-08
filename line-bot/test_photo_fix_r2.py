# -*- coding: utf-8 -*-
"""PHOTO-FIX r2: real customer replies from synthetic offline inventories."""
import json
import re
import unittest
from unittest.mock import patch

import conversation as conv
import estimate
import quote_flow
import photo_estimate as pe
import test_photo_fix_r1 as r1

PRICES, draft, row = r1.PRICES, r1.draft, r1.row


def many_tariffs():
    names = ["合成衣物" + chr(0x4e00 + i) for i in range(30)]
    prices = {"衣物": dict.fromkeys(names, 70)}
    items = [row(name, brand="牌" * 40, model="款" * 40, material="棉" * 40,
                 stain="袖口灰漬，" + "需要核對洗標及近照" * 8,
                 craft="先測色牢度，" + "依洗標分區清潔" * 8,
                 question="曾自行使用去漬劑嗎") for name in names]
    value = estimate.from_photo(pe.validate_result({"items": items}, set(names)), None, prices)
    return names, prices, value


class MobileReplyTests(unittest.TestCase):
    def text(self, *items):
        return "\n".join(estimate.render_messages(draft(*items)))

    def test_thirty_repeated_diagnoses_are_one_line_with_full_quantity_and_fee(self):
        value = draft(*[row(brand="合成品牌" + chr(0x4e00+i), material="棉", stain="袖口灰漬",
                           craft="局部預處理", question="曾自行刷洗嗎") for i in range(30)])
        text = estimate.render(value)
        self.assertEqual(text.count("照片看到袖口灰漬"), 1)
        self.assertEqual(text.count("局部預處理"), 1)
        self.assertIn("襯衫（合成品牌一等 30 件，棉）：", text)
        self.assertIn("2,100", text)
        self.assertIn("30", text)
        self.assertNotIn("另外", text)

    def test_punctuation_variants_merge_without_merging_opposite_evidence(self):
        text = self.text(row(material="棉", stain="袖口灰漬，領口泛黃", craft="先測色牢度，再局部處理"),
                         row(material="棉", stain="袖口灰漬, 領口泛黃。", craft="先測色牢度,再局部處理。"),
                         row(material="棉", stain="袖口無灰漬，領口未泛黃", craft="先測色牢度，再局部處理"))
        self.assertEqual(text.count("照片看到袖口灰漬"), 1)
        self.assertIn("袖口無灰漬", text)
        self.assertIn("領口未泛黃", text)

    def test_different_material_or_later_evidence_remains_separate(self):
        text = self.text(row(brand="Uniqlo", material="棉", stain="袖口灰漬", craft="局部處理"),
                         row(brand="MUJI", material="麻", stain="袖口灰漬", craft="局部處理"))
        for token in ("Uniqlo", "MUJI", "棉", "麻"):
            self.assertIn(token, text)
        self.assertEqual(text.count("照片看到袖口灰漬"), 2)

    def test_only_five_distinct_diagnoses_then_remaining_physical_count(self):
        text = self.text(*[row(stain="袖口污況" + chr(0x4e00+i), craft="局部處理",
                               quantity=3 if i == 6 else 1) for i in range(7)])
        self.assertEqual(text.count("照片看到"), 5)
        self.assertIn("另外 4 件到店一起看", text)
        self.assertNotIn("袖口污況丅", text)
        self.assertIn("630", text)
        self.assertIn("9", text)
        self.assertIn("5–7 天", text)

    def test_evidence_and_craft_stop_at_clause_boundaries_within_forty_chars(self):
        text = self.text(row(stain="袖口灰漬，" + "領口附近有深淺不一的泛黃需要比對洗標及近照" * 3,
                             craft="先測試色牢度，再依洗標局部處理，" + "細節較多需到店檢查接縫鈕扣" * 4))
        self.assertIn("照片看到袖口灰漬。", text)
        self.assertIn("先測試色牢度，再依洗標局部處理。", text)
        self.assertNotIn("領口附近", text)
        self.assertNotIn("細節較多", text)
        for phrase in re.findall(r"照片看到[^。]*|處理重點：[^。]*", text):
            self.assertLessEqual(len(phrase), 45)

    def test_long_unpunctuated_clause_uses_complete_fallback_not_midword_slice(self):
        text = self.text(row(stain="污況" + "灰" * 70, craft="處理" + "柔" * 70))
        self.assertNotRegex(text, r"灰{10}|柔{10}")
        self.assertIn("污況", text)
        self.assertIn("到店", text)

    def test_one_question_per_reply_prefers_missing_evidence(self):
        text = self.text(row(stain="領口黃漬", question="污漬多久了"),
                         row("背包", question="曾自行刷洗嗎"),
                         row("一般運動鞋", certainty="uncertain", reason="看不到洗標，看不出材質",
                             question="可以補拍洗標嗎"))
        self.assertEqual(text.count("？"), 1)
        self.assertIn("可以補拍洗標嗎？", text)
        self.assertNotIn("污漬多久了", text)
        self.assertNotIn("曾自行刷洗嗎", text)

    def test_question_prefers_stain_time_over_previous_self_treatment(self):
        text = self.text(row(question="曾自行使用去漬劑嗎"),
                         row("背包", stain="底部灰漬", question="這處灰漬多久了"))
        self.assertEqual(text.count("？"), 1)
        self.assertIn("這處灰漬多久了？", text)
        self.assertNotIn("曾自行使用", text)

    def test_question_priority_uses_only_the_question_that_will_be_displayed(self):
        text = self.text(row(question="曾自行刷洗嗎？污漬多久了？"),
                         row("背包", stain="底部灰漬", question="這處灰漬多久了"))
        self.assertIn("這處灰漬多久了？", text)
        self.assertNotIn("曾自行刷洗嗎", text)

    def test_actual_missing_evidence_outranks_estimated_but_visible_item(self):
        text = self.text(row(certainty="estimated", reason="看得到款式", question="污漬多久了"),
                         row("一般運動鞋", certainty="uncertain", reason="看不到洗標", question="可以補拍洗標嗎"))
        self.assertIn("可以補拍洗標嗎？", text)
        self.assertNotIn("污漬多久了", text)

    def test_question_clauses_in_descriptive_fields_do_not_add_requests(self):
        text = self.text(row(stain="領口黃漬。多久了？", craft="先測色牢度。曾經刷洗嗎？", question="可以補拍洗標嗎"))
        self.assertEqual(text.count("？"), 1)
        self.assertIn("照片看到領口黃漬。", text)
        self.assertIn("先測色牢度。", text)
        self.assertNotIn("多久了", text)
        self.assertNotIn("曾經刷洗嗎", text)

    def test_missing_label_gets_evidence_question_instead_of_self_treatment(self):
        text = self.text(row("一般運動鞋", certainty="uncertain", reason="看不到洗標，看不出材質",
                             question="曾自行刷洗嗎"))
        self.assertEqual(text.count("？"), 1)
        self.assertIn("洗標", text.split("。")[-2])
        self.assertNotIn("曾自行刷洗嗎", text)

    def test_every_tariff_count_fee_turnaround_survives_three_four_hundred_char_messages(self):
        names, _, value = many_tariffs()
        messages = quote_flow._show(conv, value, max_messages=5)
        self.assertLessEqual(len(messages), 3)
        self.assertTrue(all(0 < len(m["text"]) <= 400 for m in messages))
        text = "\n".join(m["text"] for m in messages)
        for name in names:
            self.assertIn(name, text)
        self.assertIn("2,100", text)
        self.assertIn("5–7 天", text)
        self.assertEqual(value["total"], 2100)
        self.assertTrue(messages[-1].get("quickReply"))
        self.assertTrue(all(not m.get("quickReply") for m in messages[:-1]))

    def test_same_range_endpoints_are_one_approximate_amount(self):
        text = self.text(row("一般運動鞋", certainty="uncertain", reason="看不到洗標"))
        self.assertIn("預估 250 元", text)  # r3 avoids repeating 約 before money and time.
        self.assertNotIn("250–250", text)

    def test_compact_budget_keeps_low_confidence_display_label(self):
        names, prices, _ = many_tariffs()
        prices["鞋子"] = {"一般運動鞋": 250}
        items = [row(name, brand="牌"*40, model="款"*40, material="棉"*40, stain="袖口灰漬") for name in names[:20]]
        items.append(row("一般運動鞋", certainty="uncertain", reason="看不到洗標", question="可以補拍洗標嗎"))
        value = estimate.from_photo(pe.validate_result({"items": items}, set(estimate.catalog(prices))), None, prices)
        messages = estimate.render_messages(value)
        text = "\n".join(messages)
        self.assertLessEqual(len(messages), 3)
        self.assertTrue(all(len(t) <= 400 for t in messages))
        self.assertIn("照片中的鞋子", text)
        self.assertNotIn("一般運動鞋", text)

    def test_all_followup_observations_remain_but_only_displayed_question_is_asked(self):
        value = draft(*[row(brand="品牌" + chr(0x4e00+i), stain="袖口污況" + chr(0x4e00+i),
                            question="曾自行刷洗嗎" if i != 6 else "污漬多久了") for i in range(7)])
        context = estimate.photo_followup_items(value)
        self.assertEqual(len(context), 7)
        asked = [x for x in context if x["question"]]
        self.assertEqual(len(asked), 1)
        self.assertEqual(asked[0]["brand"], "品牌丆")
        self.assertIn(asked[0]["question"], estimate.render(value))
        self.assertIn("關於 品牌丆 襯衫，污漬多久了？", estimate.render(value))


class FlowBudgetTests(unittest.TestCase):
    setUp = r1.FollowupTests.setUp
    answer = r1.FollowupTests.answer
    analyse = r1.FollowupTests.analyse

    def test_unpriced_batch_including_manual_notice_stays_within_total_budget(self):
        messages = self.analyse("synthetic-r2", *[row("", label="物件" + chr(0x4e00+i), quantity=None,
            certainty="uncertain", reason="看不到洗標與尺寸", stain="邊角黃痕", question="可以補拍洗標嗎") for i in range(30)])
        self.assertLessEqual(len(messages), 3)
        self.assertTrue(all(0 < len(m["text"]) <= 400 for m in messages))
        self.assertLessEqual(sum(m["text"].count("？") for m in messages), 1)
        self.assertEqual(len(conv.get_sess("synthetic-r2")["estimate_photo_context"]["items"]), 30)

    def test_stale_revision_notice_reserves_one_message(self):
        names, prices, value = many_tariffs()
        value["case_id"] = "synthetic-case"
        conv.set_sess("synthetic-r2", estimate_draft=value)
        with patch.object(conv, "PRICES", prices):
            messages = quote_flow.handle_postback(conv, "synthetic-r2", "action=estimate_send&revision=0&case=old")
        self.assertLessEqual(len(messages), 3)
        self.assertTrue(all(len(m["text"]) <= 400 for m in messages))
        text = "\n".join(m["text"] for m in messages)
        for name in names:
            self.assertIn(name, text)
        self.assertIn("2,100", text)


if __name__ == "__main__":
    unittest.main()
