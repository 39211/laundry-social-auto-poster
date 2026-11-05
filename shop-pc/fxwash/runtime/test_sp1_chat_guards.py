# -*- coding: utf-8 -*-
"""SP-1 chat guard regression for the shop PC (stdlib only; no network, no LINE, no Gemini).

Every test fails on the pre-SP-1 files and passes with the patch.
Run from shop-pc/fxwash with the interpreter that runs the webhook:
  python -X utf8 -I -S -B -m unittest discover -s runtime -p "test_sp1_chat_guards.py" -v
"""
from __future__ import annotations

import ast
import contextlib
import io
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import chat_service  # noqa: E402

try:
    from test_b1_facts import banned_hits  # noqa: E402
except ImportError:  # imported as runtime.test_sp1_chat_guards
    from runtime.test_b1_facts import banned_hits  # noqa: E402

CHAT_SERVICE = ROOT / "runtime" / "chat_service.py"
WEBHOOK = ROOT / "runtime" / "webhook_server.py"

USER = "Utest00000000000000000000000000000"  # fake LINE id
CORPUS_REPLY = "CORPUS_REPLY_SENTINEL"
CLEAN_REPLY = "羽絨外套結塊可以送來門市用大滾筒低溫拍散，方便的話先拍張照片傳過來讓師傅看看。"
PRICE_REPLY = "襯衫一件 70 元，營業時間直接帶過來就可以。"
PARKING_RE = re.compile(r"停車|好停|臨停")
FORWARD_CLAIM_RE = re.compile(r"轉給|轉交|轉達|已通知|確認後回覆")


class _ChatCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.shop_root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def run_chat(self, user_text, ai_text, api_key="test-key-not-real", session=None):
        gemini = mock.Mock(return_value=ai_text)
        corpus = mock.Mock(return_value=CORPUS_REPLY)
        err = io.StringIO()
        with mock.patch.object(chat_service, "get_gemini_api_key", return_value=api_key), \
                mock.patch.object(chat_service, "call_gemini_chat", gemini), \
                mock.patch.object(chat_service, "get_photo_session", return_value=session), \
                mock.patch.object(chat_service, "dialog_corpus", types.SimpleNamespace(get_human_reply=corpus)), \
                contextlib.redirect_stderr(err):
            reply = chat_service.generate_chat_reply(user_text, self.shop_root, USER)
        return reply, gemini, corpus, err.getvalue()

    def assert_falls_back(self, user_text, ai_text, reason):
        reply, gemini, corpus, log = self.run_chat(user_text, ai_text)
        self.assertEqual(reply, CORPUS_REPLY, ai_text)
        gemini.assert_called_once()
        corpus.assert_called_once()
        self.assertIn(f"[Chat Guard] AI reply rejected ({reason})", log, ai_text)

    def assert_staff_line(self, reply, ai_text):
        self.assertNotIn(reply, (ai_text, CORPUS_REPLY))
        self.assertIn("打給店裡", reply)
        self.assertNotRegex(reply, FORWARD_CLAIM_RE)  # no staff push exists on this PC
        self.assertEqual(banned_hits(reply), [])


class AiReplyGuardTest(_ChatCase):
    def test_price_answer_is_not_sent(self) -> None:
        for ai in (PRICE_REPLY, "大概三百塊左右，看件再確認。", "NT$250 起，看材質。"):
            self.assert_falls_back("襯衫多少錢", ai, "price")

    def test_wrong_turnaround_is_not_sent(self) -> None:
        cases = (
            ("鞋子大約 5–7 天就可以取件。", "day_count"),   # shoes are 7
            ("鞋子 7 個工作天可以取件喔。", "day_count"),   # 工作天 is not the owner unit
            ("明天下午就可以來拿了喔。", "day_count"),
            ("大概兩天就好，很快的喔。", "day_count"),
            ("一般衣物大約 7 週可以拿喔。", "day_count"),
            ("羽絨外套大概 3 天可以拿喔。", "number"),
        )
        for ai, reason in cases:
            self.assert_falls_back("要洗多久", ai, reason)

    def test_promise_is_not_sent(self) -> None:
        for ai in ("交給我們一定洗得乾淨，請放心。", "保證不縮水，請放心送過來。",
                   "絕對沒問題，請放心送過來喔。", "送來時說一聲，我們幫您安排急件插單。",
                   "百分之百可以恢復全新的樣子喔。"):
            self.assert_falls_back("洗得乾淨嗎", ai, "promise")
        self.assert_falls_back("可以幫我留嗎", "好的，已幫您轉給師傅安排好了。", "action_claim")

    def test_url_is_not_sent(self) -> None:
        self.assert_falls_back("店在哪", "地圖在 https://maps.app.goo.gl/abc 可以看喔。", "url")

    def test_owner_facts_and_hedges_still_reach_customer(self) -> None:
        good = (
            "一般衣物 5–7 天，鞋 7 天，皮件包 14 天，台中市免費到府收送。",
            "能改善多少要師傅看件後說明，不保證。",
            "效果不一定，師傅看件後跟您說明。",
            "台中市免費到府收送，一件也收，營業時間內約就可以。",
            "絕對不要自己用熱水洗，先帶來給師傅看看。",
            CLEAN_REPLY,
        )
        for ai in good:
            reply, _g, corpus, _l = self.run_chat("想問一下", ai)
            self.assertEqual(reply, ai)
            corpus.assert_not_called()
        self.assert_falls_back("想問一下", "一般衣物 5–7 天，鞋 5–7 天，皮件包 14 天。", "day_count")

    def test_unconfirmed_store_facts_go_to_staff(self) -> None:
        cases = (
            ("好停車嗎", "門口路面寬敞超好停車，直接開過來就可以。"),
            ("好停車嗎", "門口路面寬敞好臨停，直接開過來就可以。"),
            ("怎麼過去", "附近有捷運站，走路過來很方便喔。"),
            ("可以怎麼付", "店裡收現金、LINE Pay、轉帳，都可以喔。"),
            ("收送有低消嗎", "到府收送沒有低消，一件也收喔。"),
            ("哪天休息", "週日固定公休，其他時間都歡迎過來。"),
            ("可以先放你們那邊嗎", "出國前跟我們說一聲，可以免費幫您保管。"),
            ("放你們那邊安全嗎", "非人為洗損我們有完善的理賠保障制度。"),
        )
        for user_text, ai in cases:
            reply, gemini, corpus, log = self.run_chat(user_text, ai)
            gemini.assert_called_once()
            corpus.assert_not_called()
            self.assert_staff_line(reply, ai)
            self.assertIn("[Chat Guard] STAFF reason=store_claim user=Utest000...", log)

    def test_guard_error_never_delivers_unchecked_text(self) -> None:
        guards = getattr(chat_service, "chat_guards", None)
        self.assertIsNotNone(guards, "chat_service.chat_guards missing")
        with mock.patch.object(guards, "guard_ai_reply", side_effect=RuntimeError("boom")):
            reply, _g, corpus, log = self.run_chat("襯衫多少錢", PRICE_REPLY)
        self.assertEqual(reply, CORPUS_REPLY)
        corpus.assert_called_once()
        self.assertIn("check failed (RuntimeError)", log)

    def test_guard_module_is_a_required_import(self) -> None:
        tree = ast.parse(CHAT_SERVICE.read_text(encoding="utf-8"), filename=str(CHAT_SERVICE))
        top = [n for n in tree.body if isinstance(n, ast.ImportFrom) and n.module == "runtime"
               and any(a.name == "chat_guards" for a in n.names)]
        self.assertEqual(len(top), 1, "chat_guards must be a plain top-level import (no try/except)")


class ComplaintTest(_ChatCase):
    COMPLAINTS = ("上次送洗的毛衣洗壞了，怎麼辦", "我的衣服縮水了", "客號 34 的外套洗完變形了",
                  "如果洗壞了會賠嗎", "拿回來發現少了一件", "白襯衫被染色了")

    def test_complaint_never_reaches_model_or_corpus(self) -> None:
        for text in self.COMPLAINTS:
            for key in ("test-key-not-real", ""):
                reply, gemini, corpus, log = self.run_chat(text, CLEAN_REPLY, api_key=key)
                gemini.assert_not_called()
                corpus.assert_not_called()
                self.assertIn("[Chat Guard] STAFF reason=complaint user=Utest000...", log)
                self.assert_staff_line(reply, CLEAN_REPLY)

    def test_first_text_reply_for_webhook(self) -> None:
        fn = getattr(chat_service, "first_text_reply", None)
        self.assertTrue(callable(fn), "chat_service.first_text_reply missing")
        with contextlib.redirect_stderr(io.StringIO()):
            for text in self.COMPLAINTS:
                self.assertIsNotNone(fn(text, USER), text)
            for text in ("羽絨外套怎麼洗", "查進度", "我的衣服", "物件查詢", "襯衫多少錢",
                         "鞋子要洗幾天", "可以到府收送嗎", "我想問衣物"):
                self.assertIsNone(fn(text, USER), text)


class PhotoFallbackTest(_ChatCase):
    def test_photo_fallback_makes_no_parking_claim(self) -> None:
        session = {"category": "外套", "price": ""}
        for text in ("洗得掉嗎", "好，等下拿去"):
            reply, _g, _c, _l = self.run_chat(text, None, api_key="", session=session)
            self.assertNotEqual(reply, CORPUS_REPLY, text)
            self.assertNotRegex(reply, PARKING_RE)


class WebhookRoutingTest(unittest.TestCase):
    def test_complaint_checked_before_lookup_and_menus(self) -> None:
        src = WEBHOOK.read_text(encoding="utf-8")
        text_log = src.find("[Webhook Text]")
        guard = src.find("first_text_reply(user_text, user_id)")
        lookup = src.find("extract_phone(user_text)")
        self.assertNotEqual(guard, -1, "webhook does not call first_text_reply")
        self.assertLess(text_log, guard)
        self.assertLess(guard, lookup)
        self.assertIn("from runtime.chat_service import first_text_reply, generate_chat_reply", src)
        block = src[guard:lookup]
        self.assertEqual(block.count("reply_message("), 1)
        self.assertIn("continue", block)

    def test_fixed_texts_make_no_parking_or_booking_claim(self) -> None:
        tree = ast.parse(WEBHOOK.read_text(encoding="utf-8"), filename=str(WEBHOOK))
        joined = "\n".join(n.value for n in ast.walk(tree)
                           if isinstance(n, ast.Constant) and isinstance(n.value, str))
        self.assertNotRegex(joined, PARKING_RE)
        self.assertNotIn("已為您記下", joined)


if __name__ == "__main__":
    unittest.main()
