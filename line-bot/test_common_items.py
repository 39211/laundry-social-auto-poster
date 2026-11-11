# -*- coding: utf-8 -*-
"""Common-item answers and narrow guarantee hedges; fake models, isolated data, no network."""
from __future__ import annotations

import os
import unittest
from unittest import mock

from test_ai_chat import Fake, _staff, ai_chat, conv, new_uid, sandbox, texts


HEDGES = ("無法保證", "不能保證", "沒辦法保證", "沒有辦法保證", "難以保證", "不敢保證", "不一定保證")
MOLD_REPLY = "包包發霉通常需除霉並處理內襯，無法保證完全恢復。方便拍張照片讓師傅評估嗎？"


class CommonItemsTests(unittest.TestCase):
    def setUp(self):
        ai_chat.set_model(None)
        self.addCleanup(ai_chat.set_model, None)
        _staff.inbox.clear()
        env = mock.patch.dict(os.environ, {
            "LAUNDRY_AI_CHAT": "on", "LAUNDRY_CHAT_MODELS": "gemini-3.5-flash",
            "OPENAI_API_KEY": "", "CLAUDE_API_CREDIT_KEY": "",
        })
        env.start()
        self.addCleanup(env.stop)
        knowledge = mock.patch.object(ai_chat, "_knowledge", return_value="")
        knowledge.start()
        self.addCleanup(knowledge.stop)
        self.facts = ai_chat.facts_text(conv)

    def _assert_hedge_allowed(self, hedge):
        reply = f"要先看材質與狀況，{hedge}完全恢復。"
        self.assertEqual(ai_chat.check_reply(reply, self.facts), reply)

    def test_allows_wufa_baozheng(self):
        self._assert_hedge_allowed("無法保證")

    def test_allows_buneng_baozheng(self):
        self._assert_hedge_allowed("不能保證")

    def test_allows_meibanfa_baozheng(self):
        self._assert_hedge_allowed("沒辦法保證")

    def test_allows_meiyoubanfa_baozheng(self):
        self._assert_hedge_allowed("沒有辦法保證")

    def test_allows_nanyi_baozheng(self):
        self._assert_hedge_allowed("難以保證")

    def test_allows_bugan_baozheng(self):
        self._assert_hedge_allowed("不敢保證")

    def test_allows_buyiding_baozheng(self):
        self._assert_hedge_allowed("不一定保證")

    def test_existing_hedge_and_absolute_warning_exceptions_still_work(self):
        for reply in ("清洗不保證能完全恢復。", "洗標不清楚時絕對不要自行漂白。", "不明材質絕對不能自行漂白。"):
            with self.subTest(reply=reply):
                self.assertEqual(ai_chat.check_reply(reply, self.facts), reply)

    def test_positive_guarantees_still_blocked(self):
        for reply in (
            "清潔結果有保證。", "保證洗得掉。", "可以保證。", "一定保證。", "包您乾淨。", "包你乾淨。",
            "這個絕對洗得乾淨。", "百分之百洗得乾淨。", "100%洗得乾淨。",
        ):
            with self.subTest(reply=reply):
                self.assertIsNone(ai_chat.check_reply(reply, self.facts))

    def test_a_hedge_does_not_hide_another_guarantee(self):
        for hedge in HEDGES:
            reply = f"{hedge}完全恢復，但可以保證洗得乾淨。"
            with self.subTest(hedge=hedge):
                self.assertIsNone(ai_chat.check_reply(reply, self.facts))

    def test_mold_reply_no_longer_rejected_for_its_hedge(self):
        self.assertEqual(ai_chat.check_reply(MOLD_REPLY, self.facts), MOLD_REPLY)

    def test_hedges_do_not_bypass_other_guards(self):
        violations = (
            "費用二百元。", "編號是999。", "娃娃 3 天。", "娃娃三天。", "明天就能取件。",
            "請看https://example.com。", "我是AI。", "店旁邊有停車位。", "已幫您轉交店員。",
        )
        for hedge in HEDGES:
            for violation in violations:
                with self.subTest(hedge=hedge, violation=violation):
                    self.assertIsNone(ai_chat.check_reply(f"{hedge}完全恢復。{violation}", self.facts))

    def test_common_item_prompt_uses_answer_and_grounded_care(self):
        prompt = ai_chat.build_prompt(conv, "絨毛娃娃可以洗嗎")
        for guidance in (
            "常見衣物、鞋、包、寢具、窗簾地毯、娃娃、嬰兒衣物", "能不能洗、怎麼處理、要多久",
            "用 answer", "材質、洗標", "狀況評估", "一個居家注意事項", "拍照或帶來讓師傅看",
            "交期只照【可以說的事實】", "事實沒寫的品項不寫天數",
        ):
            with self.subTest(guidance=guidance):
                self.assertIn(guidance, prompt)

    def test_prompt_does_not_invent_intake_and_limits_staff_cases(self):
        prompt = ai_chat.build_prompt(conv, "嬰兒衣服可以洗嗎")
        for guidance in (
            "事實沒寫店裡有沒有收的品項", "不說「可以收」「可以送洗」", "請拍照讓師傅評估",
            "staff 只留給要保證結果、賠償或客訴、急件、特殊安排", "事實與知識都沒有的服務問題",
            "不寫「現在是非營業時間」",
        ):
            with self.subTest(guidance=guidance):
                self.assertIn(guidance, prompt)

    def test_existing_kind_order_and_handoff_price_resolve_rules_unchanged(self):
        expected_rules = (
            "- handoff：客人想找真人、店員、老闆、客服，或要店裡打電話給他。reply 留空。",
            "- price：客人在問價錢、費用、收費、報價。reply 留空，價錢由店裡的估價系統處理。",
            "- answer：只靠下面【可以說的事實】和【洗護知識】就能回答（包含寒暄、閒聊）。reply 寫回覆。",
            "- staff：問題合理，但事實和知識裡沒有答案，或需要店裡判斷、保證、賠償、急件或特殊安排。reply 留空。",
            "- resolve：要查已送洗品項進度，或同句另有已付款／疑似重複扣款。"
            "輸出 actions，值只可為 order_status、payment_review；item 是客人原話中的品項，或已知品項，reply 留空。"
            '例：{"kind":"resolve","actions":["payment_review","order_status"],"item":"鞋"}。'
            "估價、未送洗的交期詢問、約時段都不是查件。",
            "- unsure：看不懂客人要什麼（單字、語意不清）。reply 留空。",
        )
        for wait in ("", "pickup_when"):
            with self.subTest(wait=wait):
                prompt = ai_chat.build_prompt(conv, "毛衣起毛球可以處理嗎", wait)
                kind_lines = tuple(line for line in prompt.splitlines() if line.startswith("- "))
                self.assertEqual(kind_lines[:6], expected_rules)
                self.assertEqual(len(kind_lines), 8 if wait else 6)

    def test_fake_model_common_item_answers_reach_customer(self):
        cases = (
            ("毛衣起毛球可以處理嗎", "毛衣起毛球可先依材質與洗標評估修整方式。先別自行拉扯毛球，請拍照讓師傅評估。"),
            ("絨毛娃娃可以洗嗎", "娃娃要先依材質、填充物與洗標評估清洗方式。請拍照讓師傅評估。"),
            ("嬰兒衣服可以洗嗎", "嬰兒衣物要先依材質與洗標評估清洗方式。請拍洗標讓師傅評估。"),
            ("包包發霉還有救嗎", MOLD_REPLY),
        )
        for question, reply in cases:
            with self.subTest(question=question), sandbox():
                fake = Fake(reply)
                ai_chat.set_model(fake)
                result = ai_chat.no_flow_answer(conv, new_uid("common"), question, ai_chat._compact(question))
                self.assertIsNotNone(result)
                messages, meta = result
                self.assertEqual(meta["intent"], "ai_answer")
                self.assertFalse(meta["notify_staff"])
                self.assertIn(reply, texts(messages))
                self.assertEqual(fake.calls, 1)
                self.assertEqual(_staff.inbox, [])

    def test_fake_model_staff_still_transfers_to_staff(self):
        question = "毛衣起毛球可以處理嗎"
        fake = Fake(kind="staff")
        ai_chat.set_model(fake)
        with sandbox():
            messages, meta = ai_chat.no_flow_answer(conv, new_uid("staff"), question, ai_chat._compact(question))
        self.assertEqual(meta["intent"], "ai_staff")
        self.assertTrue(meta["notify_staff"])
        self.assertIn(ai_chat.STAFF_LINE, texts(messages))
        self.assertEqual(len(_staff.inbox), 1)
        self.assertEqual(fake.calls, 1)

    def test_fake_model_unapproved_days_never_reach_customer(self):
        ai_chat.set_model(Fake("娃娃 3 天可以取件。"))
        with sandbox():
            question = "娃娃要洗多久"
            result = ai_chat.no_flow_answer(conv, new_uid("days"), question, ai_chat._compact(question))
        self.assertIsNone(result)
        self.assertEqual(_staff.inbox, [])


if __name__ == "__main__":
    unittest.main()
