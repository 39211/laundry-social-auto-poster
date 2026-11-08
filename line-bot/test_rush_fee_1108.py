# -*- coding: utf-8 -*-
"""RUSH r1: customer-visible fee notice, route coverage and unchanged wording.

Run through run_a2b_tests.py (synthetic data, isolated writes, no external HTTP).
"""
from __future__ import annotations

import copy
import json
import unittest
from unittest import mock

from test_review_r1105a import _Isolated, conv
import quote_flow


NOTICE = "急件可能另計費用，由店員報價。"
ORIGINAL_RUSH = "你趕著要用，這個得請店裡看件量，現在還不能答應一定來得及。"
SAVED = "需求已留給店員。最晚幾點要拿，也一起告訴店員，方便核對。"
UNSAVED = "這次需求沒能存下來，麻煩直接打給店裡，才不會耽誤你。"


def body(messages):
    return "\n".join(m.get("text", "") for m in messages if m.get("type") == "text")


class RushFeeTests(_Isolated):
    @classmethod
    def setUpClass(cls):
        cls.observed = []

    @classmethod
    def tearDownClass(cls):
        print("RUSH_METRICS|" + json.dumps({
            "replies_checked": len(cls.observed),
            "max_messages": max((row["messages"] for row in cls.observed), default=0),
            "max_text_length": max((row["max_text_length"] for row in cls.observed), default=0),
        }))

    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(conv, "_push_ask", return_value=True)
        self.ask = patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(conv, "_push_photo_need", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def check_notice(self, messages, count=1):
        text = body(messages)
        self.observed.append({"messages": len(messages), "max_text_length": max(
            (len(m.get("text", "")) for m in messages if m.get("type") == "text"), default=0)})
        self.assertEqual(text.count(NOTICE), count, text)
        self.assertLessEqual(len(messages), 5, messages)
        for message in messages:
            if message.get("type") == "text":
                self.assertLessEqual(len(message["text"]), 500, message)
        if count:
            self.assertNotIn("保證", text)
            self.assertNotRegex(text, r"(?:NT\$|\$)\s*\d|\d[\d,]*(?:\s*(?:元|塊))")
            # Existing negative wording contains 一定; do not rewrite the owner's
            # other sentences. Only the added notice must contain no such word.
            self.assertNotIn("一定", NOTICE)
            self.assertNotRegex(NOTICE, r"\d")
        return text

    def test_saved_and_unsaved_wording_is_only_appended(self):
        for saved, original in ((True, SAVED), (False, UNSAVED)):
            with self.subTest(saved=saved):
                self.ask.return_value = saved
                messages = conv.concern("急件", self.uid("direct"))
                self.check_notice(messages)
                self.assertEqual([m["text"].replace(NOTICE, "") for m in messages],
                                 [ORIGINAL_RUSH, original])
                self.assertEqual(messages[-1]["quickReply"]["items"][0]["action"],
                                 {"type": "uri", "label": "打給店裡", "uri": "tel:" + conv.PHONE})

    def test_legacy_today_tomorrow_reply(self):
        for request in ("今天取", "明天取"):
            with self.subTest(request=request):
                messages = conv.concern(request, self.uid("legacy"))
                self.check_notice(messages)
                self.assertEqual([m["text"].replace(NOTICE, "") for m in messages], [
                    "我先幫您問店裡，不一定留得住。",
                    f"您也可以直接打 {conv.PHONE}，比較快。要我先幫您留一個到店時間嗎？",
                ])

    def test_rush_routes_once(self):
        for request in ("急件", "趕時間", "可以快一點嗎", "明天要出國", "襯衫明天要穿",
                        "照片估價，急件", "襯衫兩件多少錢，急件", "今天取", "明天取"):
            with self.subTest(request=request):
                messages, _ = conv.handle_ex(self.uid("route"), request)
                self.check_notice(messages)

    def test_pickup_start_and_every_wait_step(self):
        messages, _ = conv.handle_ex(self.uid("start"), "急件，到府收送")
        self.check_notice(messages)
        for wait in ("pickup_item", "pickup_when", "pickup_loc", "pickup_addr", "pickup_phone", "pickup_confirm"):
            with self.subTest(wait=wait):
                uid = self.uid("pickup")
                conv.set_sess(uid, wait=wait, pickup_item="襯衫", pickup_addr="合成測試路一號")
                before = conv.get_sess(uid)
                messages, meta = conv.handle_ex(uid, "急件，明天要穿")
                text = self.check_notice(messages)
                self.assertIn("原本的收送資料已保留，可以接著填寫。", text)
                self.assertTrue(meta["notify_staff"])
                after = conv.get_sess(uid)
                for key in ("wait", "pickup_item", "pickup_addr"):
                    self.assertEqual(after[key], before[key])

    def test_query_wait_steps(self):
        for wait in ("query", "query_phone", "query_item"):
            with self.subTest(wait=wait):
                uid = self.uid("query")
                conv.set_sess(uid, wait=wait)
                messages, _ = conv.handle_ex(uid, "急件，明天要穿")
                self.check_notice(messages)

    def test_photo_wait_and_photo_need_ack(self):
        for wait in ("photo", "photo_need"):
            for request in ("急件", "這件襯衫明天要穿"):
                with self.subTest(wait=wait, request=request):
                    uid = self.uid("photo")
                    conv.set_sess(uid, wait=wait, photo_wait_ts=conv.now_tw().isoformat(),
                                  photo_ts=conv.now_tw().isoformat(), photo_path="photos/synthetic.jpg")
                    messages, _ = conv.handle_ex(uid, request)
                    self.check_notice(messages)

    def test_photo_ack_keeps_original_and_does_not_duplicate_echoed_notice(self):
        for request in ("這件襯衫明天要穿", NOTICE):
            with self.subTest(request=request):
                messages = conv._ack_photo_need_msgs(self.uid("ack"), request, request)
                text = self.check_notice(messages)
                original = f"好，{request}，和照片放在同一筆，讓店員接著評估。"
                if NOTICE in request:
                    self.assertEqual(text, original)
                else:
                    self.assertEqual(text.replace(NOTICE, ""), original)

    def test_photo_quote_variants_only_append_for_rush(self):
        for variant in (0, 1):
            with self.subTest(variant=variant), mock.patch.object(
                conv, "_pick_variant", side_effect=lambda uid, key, variants: variants[variant]
            ):
                normal = conv.photo_quote_reply()
                rush = conv.photo_quote_reply(rush=True)
                self.check_notice(normal, count=0)
                self.check_notice(rush)
                stripped = copy.deepcopy(rush)
                for message in stripped:
                    message["text"] = message["text"].replace(NOTICE, "")
                self.assertEqual(stripped, normal)

    def test_quote_draft_and_photo_quote_yield_to_rush(self):
        for photos in ([], ["photos/synthetic.jpg"]):
            with self.subTest(photos=photos):
                uid = self.uid("quote")
                conv.handle_ex(uid, "襯衫兩件")
                draft = copy.deepcopy(conv.get_sess(uid).get("estimate_draft"))
                self.assertIsNotNone(draft)
                conv.set_sess(uid, estimate_photos=photos)
                self.assertIsNone(quote_flow.handle_text(conv, uid, "急件，明天要穿"))
                messages, _ = conv.handle_ex(uid, "急件，明天要穿")
                self.check_notice(messages)
                self.assertEqual(conv.get_sess(uid)["estimate_draft"], draft)

    def test_non_rush_replies_have_no_notice(self):
        for request in ("不急", "不用急", "不是急件", "不趕時間", "襯衫兩件多少錢", "照片估價",
                        "要洗多久", "送洗前必看", "我要洗東西", "外收送預約", "今天可以來拿嗎"):
            with self.subTest(request=request):
                messages, _ = conv.handle_ex(self.uid("normal"), request)
                self.check_notice(messages, count=0)
        for request in ("領口黃黃的", "不急，先看這件襯衫"):
            self.check_notice(conv._ack_photo_need_msgs(self.uid("normalphoto"), request, request), count=0)
        self.check_notice(conv.wash_ask(), count=0)


if __name__ == "__main__":
    unittest.main()
