"""NIGHT24: synthetic lookup, AI bypass, waiting-step priority and delivery loop guard."""
from copy import deepcopy
from datetime import datetime, timedelta
import json
import unittest
from unittest import mock

import test_guided_flows as g
import ai_chat
import reply_hints

conv, lookup = g.conv, g.L
OFF_HOURS = "現在是非營業時間，店員上班後會回覆你。"


def text(messages):
    return "\n".join(m.get("text", "") for m in messages if m.get("type") == "text")


class Night24Tests(unittest.TestCase):
    def setUp(self):
        self.folder = g.setup_tmp()
        conv._RECENT_QUERY_BLOCKS.clear()
        fixture = self.folder / "laundry-fixture.json"
        fixture.write_text(json.dumps({
            "customers": [{"no": "0028", "name": "Synthetic A", "phone": "0912345678"}],
            "garments": [
                {"id": "1", "customer_no": "0028", "wash_no": "W1001", "name": "shirt", "status": "stock"},
                {"id": "2", "customer_no": "0028", "wash_no": "1234567", "name": "coat", "status": "wash"},
                {"id": "3", "customer_no": "0028", "wash_no": "AB-1002", "name": "coat", "status": "wash"},
            ],
        }), encoding="utf-8")
        for patcher in (
            mock.patch.object(lookup, "FIXTURE", fixture),
            mock.patch.object(conv, "now_tw", return_value=datetime(2026, 11, 10, 0, 54, tzinfo=conv.TZ)),
            mock.patch.dict("os.environ", {"LAUNDRY_AI_CHAT": "on", "LAUNDRY_LOOKUP_FIXTURE": "1"}),
            mock.patch.object(ai_chat, "_decide", side_effect=AssertionError("lookup must bypass model")),
            mock.patch.object(g._staff, "handoff_active", return_value=False, create=True),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        g._staff.inbox.clear()

    def assert_status(self, messages, meta, uid):
        self.assertEqual("query", meta["intent"])
        self.assertIn("W1001", text(messages))
        self.assertEqual("0028", conv.get_sess(uid).get("customer_no"))
        self.assertIsNone(conv.get_sess(uid).get("wait"))

    def test_idle_phone_or_wash_number_looks_up_immediately(self):
        for i, code in enumerate(("0912345678", "0912 345 678", "0912-345-678", "1234567")):
            with self.subTest(code=code):
                uid = f"Ubare-{i}"
                with mock.patch.object(conv, "tell_status_ex", wraps=conv.tell_status_ex) as tell:
                    messages, meta = conv.handle_ex(uid, code)
                tell.assert_called_once_with(uid, code)
                self.assert_status(messages, meta, uid)

    def test_explicit_query_then_wash_number_reaches_result(self):
        for i, phrase in enumerate(("查詢目前清洗狀態", "洗好了沒", "查詢洗滌狀態", "查詢進度")):
            with self.subTest(phrase=phrase):
                uid = f"Uexplicit-{i}"
                messages, meta = conv.handle_ex(uid, phrase)
                self.assertEqual("query", meta["intent"])
                self.assertIn(conv.QUERY_CODE_PROMPT, text(messages))
                self.assertEqual("query", conv.get_sess(uid).get("wait"))
                self.assertEqual(0, conv.get_sess(uid).get("query_misses"))
                messages, meta = conv.handle_ex(uid, "1234567")
                self.assert_status(messages, meta, uid)

    def test_order_answer_sets_wait_and_resets_misses(self):
        uid = "Uai-query"
        conv.set_sess(uid, query_misses=1)
        self.assertEqual(conv.QUERY_CODE_PROMPT, ai_chat._order_answer(conv, uid, ""))
        self.assertEqual("query", conv.get_sess(uid).get("wait"))
        self.assertEqual(0, conv.get_sess(uid).get("query_misses"))
        self.assert_status(*conv.handle_ex(uid, "1234567"), uid)

    def test_pickup_phone_step_keeps_phone(self):
        uid = "Upickup"
        conv.set_sess(uid, wait="pickup_phone", pickup_addr="台中市合成路1號", pickup_item="襯衫",
                      pickup_when="2026-11-12T14:00:00+08:00")
        with mock.patch.object(conv, "tell_status_ex", side_effect=AssertionError("stole pickup phone")):
            messages, meta = conv.handle_ex(uid, "0912-345-678")
        self.assertEqual("pickup", meta["intent"])
        self.assertEqual("0912345678", conv.get_sess(uid).get("pickup_phone"))
        self.assertTrue(messages)

    def test_other_waits_are_not_stolen_by_idle_lookup(self):
        for wait in ("photo", "photo_need", "payment_check", "estimate_phone", "query_phone"):
            with self.subTest(wait=wait), mock.patch.dict("os.environ", {"LAUNDRY_AI_CHAT": "off"}):
                uid = "Uwait-" + wait
                conv.set_sess(uid, wait=wait)
                with mock.patch.object(conv, "tell_status_ex", side_effect=AssertionError("stole waiting step")):
                    conv.handle_ex(uid, "0912345678")

    def test_only_codes_not_sentences_or_english_are_idle_lookup(self):
        for value in ("hello", "hi", "LINEPay", "3Q", "W1001", "AB-1002", "123456", "12345678", "我電話0912345678", "0912345678 襯衫", "2件", "10:00"):
            with self.subTest(value=value):
                self.assertFalse(conv._is_standalone_query_code(value))

    def test_complaint_wrong_item_then_phone_keeps_golden_behavior(self):
        uid = "Ucomplaint"
        with mock.patch.dict("os.environ", {"LAUNDRY_AI_CHAT": "off"}):
            _, meta = conv.handle_ex(uid, "拿錯了，這件不是我送洗的")
            self.assertEqual("complaint", meta["intent"])
            with mock.patch.object(conv, "tell_status_ex", side_effect=AssertionError("stole complaint")):
                messages, meta = conv.handle_ex(uid, "0900000002")
            self.assertEqual("fallback", meta["intent"])
            self.assertIn("這個我不太確定。您是要洗東西嗎？", text(messages))
            self.assertFalse(lookup.BIND.exists())

    def test_recent_topics_and_thirty_minute_window(self):
        for topic in ("complaint", "human", "pickup", "quote", "estimate", "photo_quote"):
            with self.subTest(topic=topic):
                uid = "Utopic-" + topic
                conv._remember_query_context(uid, topic, False)
                self.assertFalse(conv._idle_query_allowed(uid, {}))
                with mock.patch.object(conv, "tell_status_ex", side_effect=AssertionError("stole topic")), \
                        mock.patch.dict("os.environ", {"LAUNDRY_AI_CHAT": "off"}):
                    conv.handle_ex(uid, "0912345678")
                conv._remember_query_context(uid, topic, False)
                later = conv.now_tw() + timedelta(minutes=31)
                with mock.patch.object(conv, "now_tw", return_value=later):
                    self.assertTrue(conv._idle_query_allowed(uid, {}))
        conv._remember_query_context("Unew-topic", "complaint", False)
        conv._remember_query_context("Unew-topic", "welcome", False)
        self.assertTrue(conv._idle_query_allowed("Unew-topic", {}))

    def test_existing_session_context_is_protected(self):
        for state in ({"wait": "anything"}, {"topic": "complaint", "ts": datetime.now().isoformat()},
                      {"care_item_at": conv.now_tw().isoformat()}, {"photo_ts": conv.now_tw().isoformat()}):
            self.assertFalse(conv._idle_query_allowed("Usession", state))

    def test_two_misses_use_existing_staff_handoff(self):
        uid = "Umiss"
        first, _ = conv.handle_ex(uid, "7654321")
        self.assertEqual(1, conv.get_sess(uid).get("query_misses"))
        second, meta = conv.handle_ex(uid, "7654321")
        self.assertNotEqual(text(first), text(second))
        self.assertIn("這樣我先幫你轉店裡", text(second))
        self.assertTrue(meta["notify_staff"])
        self.assertIsNone(conv.get_sess(uid).get("wait"))
        self.assertEqual(1, len(g._staff.inbox))

    def test_follow_never_adds_off_hours_or_records_rest(self):
        sent = []
        messages = conv.handle("Ufollow", "", "follow")
        conv.reply_with_hints("Ufollow", "", messages, lambda ms: sent.extend(ms) or True)
        self.assertNotIn(OFF_HOURS, text(sent))
        row = json.loads(reply_hints.state_path(conv).read_text(encoding="utf-8"))["Ufollow"]
        self.assertNotIn("rest", row)

    def test_legacy_rest_is_ignored_even_with_invalid_value(self):
        for old in ("2026-11-10T10:00:00+08:00", 42, {"old": True}):
            with self.subTest(old=old):
                messages = conv.say("您好。")
                outgoing, marks = reply_hints.prepare(conv, messages, "你好", {"rest": old}, conv.now_tw())
                self.assertEqual(messages, outgoing)
                self.assertEqual({}, marks)

    def test_repeated_question_is_replaced_and_handed_to_staff(self):
        sent = []
        messages = conv.say("請問是哪一件？")
        deliver = lambda uid: conv.reply_with_hints(uid, "合成問題", messages, lambda ms: sent.append(deepcopy(ms)) or True)
        deliver("Urepeat")
        deliver("Urepeat")
        self.assertEqual(text(messages), text(sent[0]))
        self.assertEqual(reply_hints.REPEAT_HANDOFF, text(sent[1]))
        self.assertEqual(1, len(g._staff.inbox))
        deliver("Uother")
        self.assertEqual(text(messages), text(sent[2]))

    def test_failed_question_send_does_not_consume_guard(self):
        messages = conv.say("請問是哪一件？")
        conv.reply_with_hints("Uretry", "", messages, lambda ms: False)
        sent = []
        conv.reply_with_hints("Uretry", "", messages, lambda ms: sent.extend(ms) or True)
        self.assertEqual(messages, sent)
        self.assertEqual([], g._staff.inbox)

    def test_nonquestion_breaks_consecutive_question_guard(self):
        uid = "Uinterleave"
        question = conv.say("請問是哪一件？")
        conv.reply_with_hints(uid, "", question, lambda ms: True)
        conv.reply_with_hints(uid, "", conv.say("收到。"), lambda ms: True)
        sent = []
        conv.reply_with_hints(uid, "", question, lambda ms: sent.extend(ms) or True)
        self.assertEqual(question, sent)

    def test_repeated_query_prompt_survives_expired_session(self):
        uid = "Uquery-repeat"
        messages, _ = conv.start_query(uid)
        conv.reply_with_hints(uid, "查詢進度", messages, lambda ms: True)
        conv.SESS.write_text("{}", encoding="utf-8")
        messages, _ = conv.start_query(uid)
        sent = []
        conv.reply_with_hints(uid, "查詢進度", messages, lambda ms: sent.extend(ms) or True)
        self.assertNotIn(conv.QUERY_CODE_PROMPT, text(sent))
        self.assertIn(reply_hints.REPEAT_HANDOFF, text(sent))


if __name__ == "__main__":
    unittest.main()
