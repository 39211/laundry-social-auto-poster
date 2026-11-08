"""N1A：固定表、營業邊界、真實 respond 路徑與並行送出，全程合成資料／假時鐘。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime
import importlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest import mock

import test_guided_flows as g
import reply_hints as hints

conv, lw = g.conv, g.lw
PHOTO_INVITE = "方便的話，接著傳衣物照片，店員比較好安排。"


def blob(messages):
    return "\n".join(m.get("text") or "" for m in messages if m.get("type") == "text")


class HintTests(unittest.TestCase):
    def setUp(self):
        self.folder = g.setup_tmp()
        self.time = datetime.fromisoformat("2026-09-08T10:00").replace(tzinfo=conv.TZ)
        self.sent = []
        self.accepted = True
        self.counter = 0
        self.counter_lock = threading.Lock()
        case = self

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return case.time.astimezone(tz) if tz else case.time.replace(tzinfo=None)

        for patcher in (
            mock.patch.object(conv, "now_tw", lambda: self.time),
            mock.patch.object(conv, "datetime", Clock),
            mock.patch.object(lw, "reply", self.send),
            mock.patch.object(g._staff, "handoff_active", return_value=False, create=True),
            mock.patch.object(g._staff, "handoff_event_seen", return_value=False, create=True),
            mock.patch.dict("os.environ", {"LAUNDRY_AI_CHAT": "off"}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        g._staff.inbox.clear()

    def at(self, value):
        self.time = datetime.fromisoformat(value).replace(tzinfo=conv.TZ)

    def send(self, token, messages):
        self.sent.append((token, deepcopy(messages)))
        return self.accepted

    def post(self, text="你好", uid="Uhint-customer", *, token=True, kind="message", data=""):
        with self.counter_lock:
            self.counter += 1
            eid = f"hint-{self.counter}"
        event = {"type": kind, "webhookEventId": eid, "replyToken": eid if token else "",
                 "source": {"type": "user", "userId": uid},
                 "message": {"type": "text", "text": text, "id": eid}}
        if kind == "postback":
            event["postback"] = {"data": data, "params": {}}
        raw = json.dumps({"events": [event]}).encode()
        response = lw.app.test_client().post("/line/webhook", data=raw,
            headers={"X-Line-Signature": g._sign(raw), "Content-Type": "application/json"})
        self.assertIn(response.status_code, (200, 503))
        return eid

    def reply_to(self, text="你好", uid="Uhint-customer", **kw):
        eid = self.post(text, uid, **kw)
        return next(messages for token, messages in self.sent if token == eid)

    def card_count(self, messages):
        return sum(m == conv.shop_card() for m in messages)

    def state(self):
        path = hints.state_path(conv)
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def test_n607_greeting_fixed_table_and_session_expiry(self):
        for when, expected in (("2026-09-08T10:00", 1), ("2026-09-08T11:00", 0),
                               ("2026-09-08T14:00", 0), ("2026-09-09T10:00", 1)):
            with self.subTest(when=when):
                self.at(when)
                self.assertEqual(expected, self.card_count(self.reply_to()))

    def test_n607_hours_address_reservation_price_fixed_table(self):
        self.assertIn("送洗不用預約", blob(self.reply_to("今天有開嗎")))
        self.at("2026-09-08T10:05")
        repeated = blob(self.reply_to("今天有開嗎"))
        self.assertIn(conv.HOURS, repeated)
        self.assertNotIn("不用預約", repeated)
        self.at("2026-09-08T10:10")
        address = blob(self.reply_to("地址在哪"))
        self.assertIn(conv.ADDR, address)
        self.assertIn(conv.MAP, address)
        self.assertNotIn("不用預約", address)
        self.at("2026-09-08T10:15")
        self.assertIn("可以，送洗不用預約，營業時間直接帶來就好。", blob(self.reply_to("不用預約嗎")))
        for minute in (20, 21, 22):
            self.at(f"2026-09-08T10:{minute}")
            price = blob(self.reply_to("襯衫多少？"))
            self.assertNotIn(conv.ADDR, price)
            self.assertNotIn("不用預約", price)

    def test_business_day_crosses_midnight_until_next_open(self):
        for when, expected in (("2026-09-08T21:00", 1), ("2026-09-09T00:01", 0),
                               ("2026-09-09T09:59", 0), ("2026-09-09T10:00", 1)):
            self.at(when)
            self.assertEqual(expected, self.card_count(self.reply_to()), when)

    def test_saturday_and_sunday_business_day_reset_at_monday_open(self):
        for when, expected in (("2026-09-12T12:00", 1), ("2026-09-12T18:00", 0),
                               ("2026-09-13T15:00", 0), ("2026-09-14T09:59", 0),
                               ("2026-09-14T10:00", 1)):
            self.at(when)
            self.assertEqual(expected, self.card_count(self.reply_to()), when)

    def test_n608_fixed_rest_table_uses_current_2000_close(self):
        for when, expected in (("2026-09-08T20:30", 1), ("2026-09-08T20:40", 0),
                               ("2026-09-09T01:00", 0), ("2026-09-09T10:00", 0),
                               ("2026-09-09T19:00", 0), ("2026-09-09T20:00", 1)):
            self.at(when)
            self.assertEqual(expected, blob(self.reply_to("襯衫多少？")).count(hints.OFF_HOURS), when)

    def test_saturday_early_close_and_sunday_share_one_rest(self):
        for when, expected in (("2026-09-12T17:59", 0), ("2026-09-12T18:00", 1),
                               ("2026-09-13T00:01", 0), ("2026-09-13T18:00", 0),
                               ("2026-09-14T09:59", 0), ("2026-09-14T10:00", 0)):
            self.at(when)
            self.assertEqual(expected, blob(self.reply_to("襯衫多少？")).count(hints.OFF_HOURS), when)

    def test_friday_rest_ends_at_saturday_noon(self):
        self.at("2026-09-11T20:00")
        self.assertIn(hints.OFF_HOURS, blob(self.reply_to("襯衫多少？")))
        self.at("2026-09-12T10:00")
        self.assertNotIn(hints.OFF_HOURS, blob(self.reply_to("襯衫多少？")))
        self.at("2026-09-12T12:00")
        self.assertNotIn(hints.OFF_HOURS, blob(self.reply_to("襯衫多少？")))
        self.at("2026-09-12T18:00")
        self.assertIn(hints.OFF_HOURS, blob(self.reply_to("襯衫多少？")))

    def test_failed_send_does_not_record_and_next_reply_retries_both_hints(self):
        self.at("2026-09-08T21:00")
        self.accepted = False
        failed = self.reply_to()
        self.assertEqual({}, self.state())
        self.assertIn(hints.OFF_HOURS, blob(failed))
        self.accepted = True
        success = self.reply_to()
        self.assertIn(hints.OFF_HOURS, blob(success))
        self.assertEqual(1, self.card_count(success))
        self.assertEqual(0, self.card_count(self.reply_to()))

    def test_missing_reply_token_does_not_record(self):
        self.at("2026-09-08T21:00")
        self.post(token=False)
        self.assertEqual({}, self.state())
        self.assertIn(hints.OFF_HOURS, blob(self.reply_to()))

    def test_unknown_transport_result_does_not_record(self):
        self.accepted = None
        self.reply_to()
        self.assertEqual({}, self.state())

    def test_send_exception_does_not_record(self):
        with self.assertRaises(OSError):
            conv.reply_with_hints("Uerror", "你好", conv.welcome("Uerror"), mock.Mock(side_effect=OSError("failed")))
        self.assertEqual({}, self.state())

    def test_explicit_address_hours_and_reservation_always_answer(self):
        self.reply_to()
        for _ in range(2):
            for text in ("地址在哪", "你們店在哪裡", "店址"):
                self.assertIn(conv.ADDR, blob(self.reply_to(text)))
                self.assertIn(conv.MAP, blob(self.reply_to(text)))
            self.assertIn(conv.HOURS, blob(self.reply_to("營業時間")))
            for text in ("不用預約嗎", "送洗要預約嗎", "要不要預約"):
                self.assertIn("送洗不用預約", blob(self.reply_to(text)))
                # 回覆另有實質內容時，也須靠主動詢問例外保留免預約答覆。
                messages = [conv.text_msg(conv.HOURS + "\n" + hints.WALK_IN[0])]
                result, _ = hints.prepare(conv, messages, text, self.state()["Uhint-customer"], self.time)
                self.assertEqual(messages, result)

    def test_explicit_question_never_loses_requested_card(self):
        now = self.time
        row = {"business_day": hints.periods(conv, now)[0]}
        messages = [conv.text_msg("門市資訊如下。"), conv.shop_card()]
        result, _ = hints.prepare(conv, messages, "地址在哪", row, now)
        self.assertEqual(messages, result)

    def test_direct_walk_in_phrases_keep_complete_reply_after_notice(self):
        for text in ("直接到店", "直接拿去", "直接送去"):
            with self.subTest(text=text):
                uid = "Uwalkin-" + text
                self.reply_to("今天有開嗎", uid=uid)
                self.reply_to(uid=uid)
                for _ in range(2):
                    result = self.reply_to(text, uid=uid)
                    self.assertEqual("可以，送洗不用預約，營業時間直接帶來就好。", result[0]["text"])
                    self.assertIn(conv.HOURS, blob(result))
                    self.assertTrue(all(m["text"].strip(" ，。！？\n") not in ("", "可以", "好")
                                        for m in result if m.get("type") == "text"))

    def test_explicit_walk_in_phrases_keep_full_contextual_answer(self):
        day = hints.periods(conv, self.time)[0]
        row = {"business_day": day, "card_day": day, "walkin_day": day}
        messages = [conv.text_msg("可以，" + hints.WALK_IN[0] + "請帶好衣物。"), conv.text_msg(conv.HOURS)]
        for text in ("直接到店", "直接拿去", "直接送去"):
            with self.subTest(text=text):
                result, _ = hints.prepare(conv, messages, text, row, self.time)
                self.assertEqual(messages, result)

    def test_deduplication_preserves_nonempty_shell_remainders(self):
        day = hints.periods(conv, self.time)[0]
        row = {"business_day": day, "card_day": day, "walkin_day": day}
        for shell in ("可以，", "好。", "好的，", "。！？", "所以，", "可以，所以，", "還有："):
            with self.subTest(shell=shell):
                messages = [conv.text_msg(shell + hints.WALK_IN[0]), conv.text_msg(conv.HOURS)]
                original = deepcopy(messages)
                result, _ = hints.prepare(conv, messages, "今天有開嗎", row, self.time)
                self.assertEqual(original, result)
                self.assertEqual(original, messages)
        # 保留空殼原句的保護不能停用正常去重。
        result, _ = hints.prepare(conv, [conv.text_msg(conv.HOURS + "\n" + hints.WALK_IN[0])],
                                  "今天有開嗎", row, self.time)
        self.assertEqual([conv.text_msg(conv.HOURS)], result)

    def test_greeting_then_hours_each_hint_once(self):
        day = hints.periods(conv, self.time)[0]
        self.assertEqual(1, self.card_count(self.reply_to()))
        self.assertEqual({"card_day": day}, self.state()["Uhint-customer"])
        hours = self.reply_to("今天有開嗎")
        self.assertIn(conv.HOURS + "\n" + hints.WALK_IN[1], blob(hours))
        self.assertEqual({"card_day": day, "walkin_day": day}, self.state()["Uhint-customer"])
        self.assertEqual(0, self.card_count(self.reply_to()))
        self.assertNotIn("不用預約", blob(self.reply_to("今天有開嗎")))

    def test_walk_in_then_greeting_each_hint_once(self):
        day = hints.periods(conv, self.time)[0]
        self.assertIn(hints.WALK_IN[0], blob(self.reply_to("直接到店")))
        self.assertEqual({"walkin_day": day}, self.state()["Uhint-customer"])
        self.assertEqual(1, self.card_count(self.reply_to()))
        self.assertEqual({"card_day": day, "walkin_day": day}, self.state()["Uhint-customer"])
        self.assertEqual(0, self.card_count(self.reply_to()))
        self.assertNotIn("不用預約", blob(self.reply_to("今天有開嗎")))

    def test_independent_markers_reset_at_next_open(self):
        for when, expected in (("2026-09-08T21:00", True), ("2026-09-09T00:01", False),
                               ("2026-09-09T09:59", False), ("2026-09-09T10:00", True)):
            with self.subTest(when=when):
                self.at(when)
                self.assertEqual(int(expected), self.card_count(self.reply_to()))
                self.assertEqual(expected, "不用預約" in blob(self.reply_to("今天有開嗎")))

    def test_legacy_business_day_suppresses_both_hints_until_next_open(self):
        day = hints.periods(conv, self.time)[0]
        hints.state_path(conv).write_text(json.dumps({"Uhint-customer": {"business_day": day}}), encoding="utf-8")
        self.assertEqual(0, self.card_count(self.reply_to()))
        self.assertNotIn("不用預約", blob(self.reply_to("今天有開嗎")))
        self.assertIn(hints.WALK_IN[0], blob(self.reply_to("直接到店")))
        self.assertIn(hints.WALK_IN[0], blob(self.reply_to("要不要預約")))
        self.at("2026-09-09T10:00")
        self.assertEqual(1, self.card_count(self.reply_to()))
        self.assertIn(hints.WALK_IN[1], blob(self.reply_to("今天有開嗎")))
        # 新欄位優先於仍保留的舊欄位，次營業日也各只主動提示一次。
        self.assertEqual(0, self.card_count(self.reply_to()))
        self.assertNotIn("不用預約", blob(self.reply_to("今天有開嗎")))

    def test_failed_walk_in_send_does_not_consume_card_or_walk_in(self):
        self.accepted = False
        self.reply_to("直接到店")
        self.assertEqual({}, self.state())
        self.accepted = True
        self.assertEqual(1, self.card_count(self.reply_to()))
        importlib.reload(hints)
        self.assertIn(hints.WALK_IN[1], blob(self.reply_to("今天有開嗎")))
        self.assertNotIn("不用預約", blob(self.reply_to("今天有開嗎")))

    def test_repeated_card_only_falls_back_without_recording(self):
        self.at("2026-09-08T21:00")
        state = {"Uhint-customer": {"business_day": "2026-09-08T10:00:00+08:00"}}
        hints.state_path(conv).write_text(json.dumps(state), encoding="utf-8")
        messages = [conv.shop_card()]
        original = deepcopy(messages)
        with mock.patch.object(conv, "handle_ex", return_value=(messages, {})):
            eid = self.post()
        result = next((outgoing for token, outgoing in self.sent if token == eid), [])
        self.assertTrue(result)
        self.assertEqual(original, result)
        self.assertTrue(all(m.get("text", "").strip() for m in result if m.get("type") == "text"))
        self.assertEqual(state, self.state())
        self.assertEqual(original, messages)

    def test_repeated_walk_in_only_falls_back_without_recording(self):
        self.at("2026-09-08T21:00")
        state = {"Uhint-customer": {"business_day": "2026-09-08T10:00:00+08:00"}}
        hints.state_path(conv).write_text(json.dumps(state), encoding="utf-8")
        for line in hints.WALK_IN:
            with self.subTest(line=line):
                messages = [conv.text_msg(line)]
                original = deepcopy(messages)
                with mock.patch.object(conv, "handle_ex", return_value=(messages, {})):
                    result = self.reply_to()
                self.assertEqual(original, result)
                self.assertTrue(result)
                self.assertTrue(all(m["text"].strip() for m in result))
                self.assertEqual(state, self.state())
                self.assertEqual(original, messages)

    def test_deduplication_drops_empty_text_and_keeps_real_reply(self):
        state = {"Uhint-customer": {"business_day": "2026-09-08T10:00:00+08:00"}}
        hints.state_path(conv).write_text(json.dumps(state), encoding="utf-8")
        answer = conv.text_msg("已收到你的問題。")
        messages = [conv.text_msg(" \n" + line + "\n ") for line in hints.WALK_IN]
        messages += [answer, conv.shop_card()]
        original = deepcopy(messages)
        with mock.patch.object(conv, "handle_ex", return_value=(messages, {})):
            result = self.reply_to()
        self.assertEqual([answer], result)
        self.assertTrue(all(m["text"].strip() for m in result))
        self.assertEqual(state, self.state())
        self.assertEqual(original, messages)

    def test_successful_write_prunes_only_records_older_than_fourteen_days(self):
        self.at("2026-09-08T21:00")
        old = "2026-08-25T20:59:59+08:00"
        cutoff = "2026-08-25T21:00:00+08:00"
        expired = {
            "Uold-both": {"business_day": old, "rest": old},
            "Uold-business-only": {"business_day": old},
            "Uold-rest-only": {"rest": old},
            "Uold-offset": {"business_day": "2026-08-25T14:00:00+02:00", "rest": old},
            "Uold-card-only": {"card_day": old},
            "Uold-walkin-only": {"walkin_day": old},
            "Uold-all": {"business_day": old, "card_day": old, "walkin_day": old, "rest": old},
        }
        retained = {
            "Urecent-business": {"business_day": "2026-09-08T10:00:00+08:00", "rest": old},
            "Urecent-rest": {"business_day": old, "rest": "2026-09-09T10:00:00+08:00"},
            "Ucutoff-business": {"business_day": cutoff, "rest": old},
            "Ucutoff-rest": {"business_day": old, "rest": cutoff},
            "Urecent-offset": {"business_day": "2026-08-25T13:00:01+00:00"},
            "Urecent-card": {"business_day": old, "card_day": "2026-09-08T10:00:00+08:00", "rest": old},
            "Urecent-walkin": {"card_day": old, "walkin_day": "2026-09-08T10:00:00+08:00"},
            "Ucutoff-card": {"card_day": cutoff, "walkin_day": old},
            "Ucutoff-walkin": {"card_day": old, "walkin_day": cutoff},
        }
        hints.state_path(conv).write_text(json.dumps({**expired, **retained}), encoding="utf-8")
        self.reply_to()
        self.assertEqual({**retained, "Uhint-customer": {
            "card_day": "2026-09-08T10:00:00+08:00",
            "rest": "2026-09-09T10:00:00+08:00",
        }}, self.state())

    def test_pruning_preserves_unknown_timestamps_without_blocking_reply(self):
        state = {
            "Uinvalid": {"business_day": "unknown", "rest": "2026-08-01T10:00:00+08:00"},
            "Unaive": {"business_day": "2026-08-01T10:00:00"},
            "Uwrong-type": {"rest": 123},
            "Uinvalid-card": {"card_day": "unknown"},
            "Uinvalid-walkin": {"walkin_day": "unknown"},
        }
        hints.state_path(conv).write_text(json.dumps(state), encoding="utf-8")
        self.assertTrue(self.reply_to())
        for uid, row in state.items():
            self.assertEqual(row, self.state()[uid])

    def test_failed_send_does_not_prune_existing_records(self):
        state = {"Uold": {"business_day": "2026-08-01T10:00:00+08:00"}}
        hints.state_path(conv).write_text(json.dumps(state), encoding="utf-8")
        self.accepted = False
        self.assertTrue(self.reply_to())
        self.assertEqual(state, self.state())

    def test_human_handoff_does_not_send_or_mark(self):
        self.at("2026-09-08T21:00")
        for state in ("HANDOFF_PENDING", "HUMAN_ACTIVE"):
            with self.subTest(state=state), mock.patch.object(g._staff, "handoff_active", return_value=True):
                self.post()
                self.assertEqual([], self.sent)
                self.assertEqual({}, self.state())
        # 解除接手後，前面被攔下的回覆沒有消耗兩項提示。
        resumed = self.reply_to()
        self.assertEqual(1, self.card_count(resumed))
        self.assertIn(hints.OFF_HOURS, blob(resumed))

    def test_human_request_explains_rest_once_without_duplicate_f26(self):
        self.at("2026-09-08T21:00")
        reply = blob(self.reply_to("我想找真人客服"))
        self.assertIn("營業時間處理", reply)
        self.assertNotIn(hints.OFF_HOURS, reply)
        self.assertIn("rest", self.state()["Uhint-customer"])
        self.assertNotIn(hints.OFF_HOURS, blob(self.reply_to("襯衫多少？")))

    def test_five_messages_keep_last_quick_reply(self):
        self.at("2026-09-08T21:00")
        messages = [conv.text_msg(f"測試回覆 {i}") for i in range(5)]
        messages[-1]["quickReply"] = {"items": [{"type": "action", "action": {"type": "message", "label": "繼續", "text": "繼續"}}]}
        original = deepcopy(messages)
        with mock.patch.object(conv, "handle_ex", return_value=(messages, {})):
            result = self.reply_to("測試")
        self.assertEqual(5, len(result))
        self.assertEqual(original[-1], result[-1])
        self.assertTrue(result[0]["text"].startswith(hints.OFF_HOURS + "\n"))
        self.assertEqual(original, messages)

    def test_unsent_sixth_hint_is_not_recorded(self):
        messages = [conv.text_msg("測試回覆。") for _ in range(5)] + [conv.shop_card()]
        conv.reply_with_hints("Uhint-customer", "你好", messages, lambda outgoing: True)
        self.assertEqual({}, self.state())
        self.assertEqual(1, self.card_count(self.reply_to()))

    def test_flex_only_reply_does_not_record_unspoken_rest(self):
        self.at("2026-09-08T21:00")
        conv.reply_with_hints("Uhint-customer", "你好", [conv.shop_card()], lambda outgoing: True)
        self.assertNotIn("rest", self.state()["Uhint-customer"])
        self.assertIn(hints.OFF_HOURS, blob(self.reply_to("襯衫多少？")))

    def test_record_survives_module_restart_and_only_contains_uid_and_times(self):
        self.at("2026-09-08T21:00")
        self.reply_to()
        state = self.state()
        self.assertEqual({"Uhint-customer"}, set(state))
        self.assertEqual({"card_day", "rest"}, set(state["Uhint-customer"]))
        for value in state["Uhint-customer"].values():
            datetime.fromisoformat(value)
        importlib.reload(hints)
        conv.SESS.write_text("{}", encoding="utf-8")
        self.at("2026-09-09T01:00")
        result = self.reply_to()
        self.assertEqual(0, self.card_count(result))
        self.assertNotIn(hints.OFF_HOURS, blob(result))

    def test_record_survives_fresh_python_process(self):
        self.at("2026-09-08T21:00")
        self.reply_to()
        child = '''import json, sys
from pathlib import Path
from datetime import datetime
import conversation as conv
import reply_hints as hints
conv.SESS = Path(sys.argv[1])
conv.now_tw = lambda: datetime.fromisoformat("2026-09-09T01:00:00+08:00")
sent = []
ok = conv.reply_with_hints("Uhint-customer", "你好", [conv.text_msg("你好。"), conv.shop_card()], lambda messages: sent.extend(messages) or True)
print(json.dumps({"accepted":ok, "cards":sum(m == conv.shop_card() for m in sent), "off_hours":any(hints.OFF_HOURS in m.get("text", "") for m in sent)}))
'''
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", "-c", child, str(conv.SESS)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual({"accepted": True, "cards": 0, "off_hours": False}, json.loads(result.stdout))

    def test_simultaneous_same_customer_only_one_of_each_hint(self):
        self.at("2026-09-08T21:00")
        first_entered, release_first, second_started = threading.Event(), threading.Event(), threading.Event()
        replies = []
        replies_lock = threading.Lock()

        def send(messages):
            with replies_lock:
                is_first = not replies
                replies.append(deepcopy(messages))
            if is_first:
                first_entered.set()
                if not release_first.wait(5):
                    raise AssertionError("first send never released")
            return True

        def deliver(second=False):
            if second:
                second_started.set()
            return conv.reply_with_hints("Uconcurrent", "你好", [conv.text_msg("你好。"), conv.shop_card()], send)

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(deliver)
            self.assertTrue(first_entered.wait(5))
            second = pool.submit(deliver, True)
            self.assertTrue(second_started.wait(5))
            # 無鎖的破壞版本會在第一個送出尚未成功時讀到空標記並送出第二份。
            try:
                second.result(timeout=0.3)
            except TimeoutError:
                pass
            finally:
                release_first.set()
            self.assertTrue(first.result(timeout=5))
            self.assertTrue(second.result(timeout=5))
        self.assertEqual(1, sum(self.card_count(m) for m in replies))
        self.assertEqual(1, sum(blob(m).count(hints.OFF_HOURS) for m in replies))

    def test_simultaneous_signed_webhooks_only_one_of_each_hint(self):
        self.at("2026-09-08T21:00")
        first_entered, release_first = threading.Event(), threading.Event()
        send_lock = threading.Lock()

        def send(token, messages):
            with send_lock:
                first = not self.sent
                self.sent.append((token, deepcopy(messages)))
            if first:
                first_entered.set()
                if not release_first.wait(5):
                    raise AssertionError("first webhook send never released")
            return True

        with mock.patch.object(lw, "reply", send), ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.post)
            self.assertTrue(first_entered.wait(5))
            second = pool.submit(self.post)
            try:
                second.result(timeout=0.3)
            except TimeoutError:
                pass
            finally:
                release_first.set()
            first.result(timeout=5)
            second.result(timeout=5)
        self.assertEqual(2, len(self.sent))
        self.assertEqual(1, sum(self.card_count(m) for _, m in self.sent))
        self.assertEqual(1, sum(blob(m).count(hints.OFF_HOURS) for _, m in self.sent))

    def test_two_customers_simultaneous_writes_preserve_both(self):
        self.at("2026-09-08T21:00")
        expired = {"Uexpired": {"business_day": "2026-08-01T10:00:00+08:00",
                                 "rest": "2026-08-02T10:00:00+08:00"}}
        hints.state_path(conv).write_text(json.dumps(expired), encoding="utf-8")
        barrier = threading.Barrier(2)
        uids = ["Uparallel-A", "Uparallel-B"]
        self.assertIsNot(conv.quote_flow._lock(uids[0]), conv.quote_flow._lock(uids[1]))

        def send(messages):
            barrier.wait(timeout=5)
            return True

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(conv.reply_with_hints, uid, "你好", [conv.text_msg("你好。"), conv.shop_card()], send) for uid in uids]
            self.assertTrue(all(f.result(timeout=5) for f in futures))
        self.assertEqual(set(uids), set(self.state()))
        self.assertTrue(all(set(row) == {"card_day", "rest"} for row in self.state().values()))

    def test_simultaneous_card_and_walk_in_preserve_both_markers(self):
        messages = ([conv.text_msg("你好。"), conv.shop_card()],
                    [conv.text_msg(conv.HOURS + "\n" + hints.WALK_IN[0])])
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(conv.reply_with_hints, "Uparallel-hints", "測試", reply, lambda outgoing: True)
                       for reply in messages]
            self.assertTrue(all(f.result(timeout=5) for f in futures))
        day = hints.periods(conv, self.time)[0]
        self.assertEqual({"card_day": day, "walkin_day": day}, self.state()["Uparallel-hints"])
        result, _ = hints.prepare(conv, messages[0] + messages[1], "測試", self.state()["Uparallel-hints"], self.time)
        self.assertEqual([conv.text_msg("你好。"), conv.text_msg(conv.HOURS)], result)

    def test_hours_configuration_is_shared_by_replies_and_periods(self):
        biz = deepcopy(conv.BIZ)
        biz["opening_hours_specification"] = [{"dayOfWeek": "Tuesday", "opens": "11:30", "closes": "17:30"}]
        with mock.patch.object(conv, "BIZ", biz):
            self.at("2026-09-08T11:29")
            self.assertIsNotNone(conv._closed_reason(self.time))
            self.assertIn("11:30", blob(conv.hours_reply("今天有開嗎")))
            self.assertTrue(hints.periods(conv, self.time)[1].endswith("11:30:00+08:00"))
            self.at("2026-09-08T11:30")
            self.assertIsNone(conv._closed_reason(self.time))
            self.assertEqual("", hints.periods(conv, self.time)[1])
            self.assertTrue(hints.periods(conv, self.time)[0].endswith("11:30:00+08:00"))
            self.at("2026-09-08T17:30")
            self.assertIsNotNone(conv._closed_reason(self.time))

    def test_pickup_confirmation_invites_photo_only_after_success(self):
        self.at("2026-09-09T14:00")
        uid = "Uhint-pickup"
        for text in ("外收送預約", "明天下午", "台中市西屯區測試路1號", "0912345678", "襯衫"):
            messages, _ = conv.handle_ex(uid, text)
            self.assertNotIn(PHOTO_INVITE, blob(messages))
        self.assertEqual("pickup_confirm", conv.get_sess(uid).get("wait"))
        result = self.reply_to(uid=uid, kind="postback", data="action=pickup_confirm")
        self.assertIn(PHOTO_INVITE, blob(result))
        self.assertLessEqual(len(result), 5)
        self.assertTrue(conv.get_sess(uid).get("pickup_id"))
        self.assertEqual(1, len(conv.BOOK.read_text(encoding="utf-8").splitlines()))
        self.assertNotIn(PHOTO_INVITE, blob(conv.handle_postback(uid, "action=pickup_confirm", {})))

    def test_pickup_failure_does_not_invite_photo(self):
        self.at("2026-09-09T14:00")
        conv.set_sess("Uhint-pickup", wait="pickup_confirm")
        result = conv.handle_postback("Uhint-pickup", "action=pickup_confirm", {})
        self.assertNotIn(PHOTO_INVITE, blob(result))


if __name__ == "__main__":
    unittest.main()
