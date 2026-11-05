# -*- coding: utf-8 -*-
"""Audit A-QUOTE regressions (H1-H4). No network, no files, no real data."""
import copy
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import estimate  # noqa: E402
import photo_estimate  # noqa: E402
import quote_flow  # noqa: E402


def _stub_modules(pushed):
    conversation = types.ModuleType("conversation")
    conversation.PRICE_LABELS = {}
    conversation.PRICE_BASIS = "off"
    conversation.lookup_item = lambda name: None
    staff_notify = types.ModuleType("staff_notify")
    staff_notify.guest_name = lambda uid: "客人"

    def push_inbox(kind, row, notify=True):
        pushed.append((kind, row, notify))
        return {"saved": True, "notified": notify}

    staff_notify.push_inbox = push_inbox
    return {"conversation": conversation, "staff_notify": staff_notify}


class FakeConv:
    _PHOTO_NEED_WAIT = "photo_need"

    def __init__(self, prices):
        self.PRICES = prices
        self.sessions = {}

    def _load_sess(self):
        return self.sessions

    def get_sess(self, uid):
        return copy.deepcopy(self.sessions.get(uid) or {})

    def set_sess(self, uid, **values):
        self.sessions.setdefault(uid, {}).update(copy.deepcopy(values))

    def text_msg(self, text, actions=None):
        return {"type": "text", "text": text, "actions": actions or []}

    def now_tw(self):
        return datetime(2025, 1, 6, 10, 0, tzinfo=timezone(timedelta(hours=8)))

    def _is_rush_text(self, text):
        return False

    def start_pickup(self, uid):
        return [self.text_msg("pickup")]


class _Stubbed(unittest.TestCase):
    def setUp(self):
        self.pushed = []
        patcher = mock.patch.dict(sys.modules, _stub_modules(self.pushed))
        patcher.start()
        self.addCleanup(patcher.stop)




class SizeIsNotQuantity(_Stubbed):
    """H2: 27號 / 30腰 are sizes, not counts."""

    PRICES = {"鞋子": {"一般運動鞋": 350}, "衣物": {"牛仔褲": 120}}

    def test_shoe_size(self):
        draft = estimate.update("一般運動鞋27號1雙", None, self.PRICES)
        self.assertEqual([x["name"] for x in draft["lines"]], ["一般運動鞋"])
        self.assertEqual(draft["lines"][0]["quantity"], 1)
        self.assertEqual(draft["total"], 350)

    def test_waist_size(self):
        draft = estimate.update("牛仔褲 30腰 2件", None, self.PRICES)
        self.assertEqual([x["name"] for x in draft["lines"]], ["牛仔褲"])
        self.assertEqual(draft["lines"][0]["quantity"], 2)
        self.assertEqual(draft["total"], 240)


def _photo_item(name, certainty):
    item = {"name": name, "label": "白色球鞋", "quantity": 1, "certainty": certainty, "reason": ""}
    item.update({field: "" for field in photo_estimate.PHOTO_TEXT_FIELDS})
    return item




class ModelTextNoPromises(unittest.TestCase):
    """H4: model text never states a promise or a turnaround."""

    def test_promise_and_days_dropped(self):
        row = {"name": "襯衫", "label": "白襯衫", "quantity": 1, "certainty": "clear",
               "reason": "看得到領口", "brand": "", "model": "", "material": "棉", "color": "白",
               "stain": "領口黃斑", "craft": "會先局部去漬，保證洗乾淨", "question": "大約3天可以拿嗎"}
        item = photo_estimate.validate_result({"items": [row]}, {"襯衫"})[0]
        self.assertEqual(item["craft"], "會先局部去漬")
        self.assertEqual(item["question"], "")
        self.assertEqual(item["stain"], "領口黃斑")

    def test_honest_hedge_kept(self):
        row = {"name": "襯衫", "label": "白襯衫", "quantity": 1, "certainty": "clear",
               "reason": "", "brand": "", "model": "", "material": "", "color": "",
               "stain": "", "craft": "黃斑不一定能去除", "question": ""}
        item = photo_estimate.validate_result({"items": [row]}, {"襯衫"})[0]
        self.assertEqual(item["craft"], "黃斑不一定能去除")


if __name__ == "__main__":
    unittest.main()
