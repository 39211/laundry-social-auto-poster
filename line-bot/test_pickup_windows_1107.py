# -*- coding: utf-8 -*-
"""Owner's pickup windows (11/07): Wed 18:00–20:00, Thu/Fri 12:00–20:00, Sat 12:00–18:00; no pickup on
Sun, Mon, Tue. Night bot must offer only these, refuse other times with the reason, and say them."""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_guided_flows as g  # noqa: E402  (offline harness: no network, temp data, staff stub)

conv = g.conv
WINDOWS = {2: (18, 20), 3: (12, 20), 4: (12, 20), 5: (12, 18)}


def labels(msgs):
    return [a.get("label") for a in g.qr_actions(msgs) if a.get("type") == "message" and a.get("label") != "改地址或電話"]


class PickupWindowTests(unittest.TestCase):
    def setUp(self):
        g.setup_tmp()
        g._staff.inbox.clear()

    def start(self, uid, when):
        g.freeze_now(when)
        return conv.handle_ex(uid, "外收送預約")[0]

    def test_offered_slots_are_only_inside_the_windows(self):
        for when in ("2026-09-05T13:00", "2026-09-06T10:00", "2026-09-07T09:00", "2026-09-08T19:00",
                     "2026-09-09T19:30", "2026-09-10T08:00", "2026-09-11T21:00"):
            g.freeze_now(when)
            opts = conv.iter_pickup_slots(limit=12)
            self.assertTrue(opts, when)
            for o in opts:
                wd = o["start"].weekday()
                self.assertIn(wd, WINDOWS, (when, o["slot"]))
                self.assertEqual((o["start"].hour, o["end"].hour), WINDOWS[wd], (when, o["slot"]))

    def test_saturday_same_day_closes_at_1700(self):
        g.freeze_now("2026-09-05T16:59")
        self.assertEqual("今天中午過後", conv.iter_pickup_slots()[0]["label"])
        g.freeze_now("2026-09-05T17:00")
        self.assertEqual("星期三晚上", conv.iter_pickup_slots()[0]["label"])

    def test_wednesday_evening_is_still_bookable_until_2000(self):
        g.freeze_now("2026-09-09T19:30")
        self.assertEqual("今天晚上", conv.iter_pickup_slots()[0]["label"])

    def test_window_reason(self):
        r = conv.pickup_window_reason
        self.assertEqual("週二不收件", r(datetime(2026, 9, 8, 15)))
        self.assertEqual("週一不收件", r(datetime(2026, 9, 7, 15)))
        self.assertEqual("週日不收件", r(datetime(2026, 9, 6, 15)))
        self.assertEqual("週三外收是 18:00–20:00", r(datetime(2026, 9, 9, 15)))
        self.assertIsNone(r(datetime(2026, 9, 9, 18)))
        self.assertEqual("週三外收是 18:00–20:00", r(datetime(2026, 9, 9, 20)))
        self.assertIsNone(r(datetime(2026, 9, 10, 12)))
        self.assertEqual("週四外收是 12:00–20:00", r(datetime(2026, 9, 10, 11, 59)))
        self.assertIsNone(r(datetime(2026, 9, 12, 17, 59)))
        self.assertEqual("週六外收是 12:00–18:00", r(datetime(2026, 9, 12, 18)))

    def test_typed_no_pickup_day_is_refused_with_the_windows(self):
        uid = "Upw0000000001"
        self.start(uid, "2026-09-08T13:00")  # Tuesday
        msgs, _ = conv.handle_ex(uid, "今天下午")
        blob = g.flatten(msgs)
        self.assertIn("週二不收件", blob)
        self.assertIn(conv.PICKUP_WINDOWS_TEXT, blob)
        sess = conv.get_sess(uid)
        self.assertEqual("pickup_when", sess.get("wait"))
        self.assertFalse(sess.get("pickup_when"))

    def test_typed_day_and_part_inside_a_window_is_taken(self):
        uid = "Upw0000000002"
        self.start(uid, "2026-09-08T13:00")  # Tuesday → Wednesday evening
        conv.handle_ex(uid, "明天晚上")
        self.assertEqual("明天晚上（18:00–20:00）", conv.get_sess(uid).get("pickup_slot"))
        uid = "Upw0000000003"
        self.start(uid, "2026-09-09T14:00")  # Wednesday → Thursday afternoon
        conv.handle_ex(uid, "明天下午")
        self.assertEqual("明天中午過後（12:00–20:00）", conv.get_sess(uid).get("pickup_slot"))
        uid = "Upw0000000004"
        self.start(uid, "2026-09-09T14:00")
        conv.handle_ex(uid, "週六下午")
        self.assertEqual("2026-09-12T12:00", conv.get_sess(uid).get("pickup_when"))

    def test_typed_part_outside_the_window_is_refused(self):
        uid = "Upw0000000005"
        self.start(uid, "2026-09-09T14:00")
        msgs, _ = conv.handle_ex(uid, "明天上午")
        self.assertIn("週四外收是 12:00–20:00", g.flatten(msgs))
        self.assertFalse(conv.get_sess(uid).get("pickup_when"))

    def test_spoken_clock_time_outside_the_window_is_refused(self):
        uid = "Upw0000000006"
        self.start(uid, "2026-09-08T10:00")  # Tuesday; tomorrow 15:00 is Wednesday afternoon
        msgs, _ = conv.handle_ex(uid, "明天下午三點可以嗎")
        self.assertIn("週三外收是 18:00–20:00", g.flatten(msgs))
        self.assertFalse(conv.get_sess(uid).get("pickup_when"))
        conv.handle_ex(uid, "明天晚上七點可以嗎")
        self.assertEqual("2026-09-09T19:00", conv.get_sess(uid).get("pickup_when"))

    def test_datetimepicker_is_checked_against_the_windows(self):
        uid = "Upw0000000007"
        self.start(uid, "2026-09-08T10:00")
        msgs = conv.handle_postback(uid, "action=pickup_when", {"datetime": "2026-09-08T15:00"})
        self.assertIn("週二不收件", g.flatten(msgs))
        self.assertFalse(conv.get_sess(uid).get("pickup_when"))
        conv.handle_postback(uid, "action=pickup_when", {"datetime": "2026-09-10T15:30"})
        sess = conv.get_sess(uid)
        self.assertEqual("2026-09-10T15:30", sess.get("pickup_when"))
        self.assertIn("15:30", sess.get("pickup_slot") or "")  # the customer's own time is kept for staff

    def test_old_pickup_postback_is_checked_too(self):
        uid = "Upw0000000008"
        self.start(uid, "2026-09-08T10:00")
        msgs = conv.handle_postback(uid, "action=pickup&item=", {"datetime": "2026-09-14T15:00"})  # Monday
        self.assertIn("週一不收件", g.flatten(msgs))
        self.assertFalse(conv.get_sess(uid).get("pickup_when"))

    def test_day_postback_for_a_no_pickup_day_says_so(self):
        uid = "Upw0000000009"
        self.start(uid, "2026-09-08T10:00")  # offset 0 = Tuesday
        msgs = conv.handle_postback(uid, "action=pickup_day&offset=0", {})
        blob = g.flatten(msgs)
        self.assertIn("那天沒有外收", blob)
        self.assertIn(conv.PICKUP_WINDOWS_TEXT, blob)

    def test_customer_facing_lines_keep_owner_phrases_and_say_the_windows(self):
        msgs = self.start("Upw0000000010", "2026-09-09T14:00")
        blob = g.flatten(msgs)
        for must in ("台中市免費到府收送", "一件也收", "週三晚上", "中午過後"):
            self.assertIn(must, blob)
        self.assertNotIn("營業時間內約", blob)
        blob = g.flatten(conv.handle_ex("Upw0000000011", "你們幾點收件")[0])
        self.assertIn(conv.PICKUP_WINDOWS_TEXT, blob)
        blob = g.flatten(conv.handle_ex("Upw0000000012", "收送要錢嗎")[0])
        self.assertIn("台中市免費到府收送", blob)
        self.assertIn(conv.PICKUP_WINDOWS_SHORT, blob)

    def test_slot_speech_for_new_labels(self):
        self.assertEqual("星期三晚上六點到八點", conv.slot_speech("星期三晚上（18:00–20:00）"))
        self.assertEqual("今天中午十二點到晚上八點", conv.slot_speech("今天中午過後（12:00–20:00）"))
        self.assertEqual("星期六中午十二點到傍晚六點", conv.slot_speech("星期六中午過後（12:00–18:00）"))
        self.assertEqual("明天下午兩點到六點", conv.slot_speech("明天下午（14:00–18:00）"))  # old bookings still read

    def test_ai_fact_names_the_windows(self):
        import ai_chat
        for must in ("台中市免費到府收送", "週三晚上 18:00–20:00", "週四週五 12:00–20:00", "週六 12:00–18:00", "週二不收件"):
            self.assertIn(must, ai_chat.PICKUP_FACT)

    def test_full_booking_inside_a_window_is_saved(self):
        uid = "Upw0000000013"
        self.start(uid, "2026-09-10T13:00")  # Thursday
        conv.handle_ex(uid, "今天下午")
        conv.handle_ex(uid, "台中市西屯區測試路100號", "location")
        conv.handle_ex(uid, "0912345678")
        conv.handle_ex(uid, "衣服")
        conv.handle_postback(uid, "action=pickup_confirm", {})
        import json
        last = json.loads(conv.BOOK.read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual("pickup", last.get("kind"))
        self.assertEqual("今天中午過後（12:00–20:00）", last.get("slot"))
        self.assertEqual(1, len(g._staff.inbox))


if __name__ == "__main__":
    unittest.main()
