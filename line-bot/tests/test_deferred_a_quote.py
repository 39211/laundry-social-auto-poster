# -*- coding: utf-8 -*-
"""Deferred A-QUOTE fix H1 (stored drafts re-priced). H3 (estimated photo rows = range) is held for the owner.

No network, no files, no real data.
"""
import copy
import hashlib
import json
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import estimate  # noqa: E402
import quote_flow  # noqa: E402


def _stub_modules(pushed):
    conversation = types.ModuleType("conversation")
    conversation.PRICE_LABELS = {}
    conversation.PRICE_BASIS = "off"
    conversation.lookup_item = lambda name: None
    staff_notify = types.ModuleType("staff_notify")
    staff_notify.guest_name = lambda uid: "客人"

    def push_inbox(kind, row, notify=True):
        pushed.append((kind, copy.deepcopy(row), notify))
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


def _photo_item(name, certainty):
    item = {"name": name, "label": "照片物件", "quantity": 1, "certainty": certainty, "reason": ""}
    item.update({f: "" for f in ("brand", "model", "material", "stain", "craft", "question")})
    return item


class _Stubbed(unittest.TestCase):
    def setUp(self):
        self.pushed = []
        patcher = mock.patch.dict(sys.modules, _stub_modules(self.pushed))
        patcher.start()
        self.addCleanup(patcher.stop)


class StoredDraftIsRepriced(_Stubbed):
    """H1: a draft stored before a price sync is re-priced before it is shown or sent."""

    OLD = {"衣物": {"襯衫": 60}}
    NEW = {"衣物": {"襯衫": 70}}

    def _conv_with_old_text_draft(self):
        draft = estimate.price({
            "lines": [{"name": "襯衫", "quantity": 2, "max_quantity": 2, "unit": "件",
                       "reason": "", "source": "text"}],
            "special": [], "revision": 1, "source": "text", "case_id": "EST-test",
        }, self.OLD)
        conv = FakeConv(self.NEW)
        conv.sessions["U1"] = {"estimate_draft": draft, "estimate_case": "EST-test"}
        return conv

    def test_total_question_uses_current_prices(self):
        conv = self._conv_with_old_text_draft()
        messages, _meta = quote_flow.handle_text(conv, "U1", "加總")
        text = messages[0]["text"]
        self.assertIn("140", text)
        self.assertNotIn("120", text)
        self.assertEqual(conv.sessions["U1"]["estimate_draft"]["revision"], 2)
        quote_flow.handle_text(conv, "U1", "加總")  # unchanged prices: no second bump
        self.assertEqual(conv.sessions["U1"]["estimate_draft"]["revision"], 2)

    def test_old_button_cannot_send_stale_draft(self):
        conv = self._conv_with_old_text_draft()
        messages = quote_flow.handle_postback(conv, "U1", "action=estimate_send&revision=1&case=EST-test")
        self.assertTrue(messages[0]["text"].startswith("清單有更新"))
        self.assertEqual(self.pushed, [])
        quote_flow.handle_postback(conv, "U1", "action=estimate_send&revision=2&case=EST-test")
        self.assertEqual(len(self.pushed), 1)
        sent = self.pushed[0][1]
        self.assertEqual(sent["estimate_revision"], 2)
        self.assertEqual(sent["estimate"]["lines"][0]["unit_price"], 70)

    def test_photo_cache_hit_uses_current_prices(self):
        draft = estimate.from_photo([_photo_item("襯衫", "clear")], None, self.OLD)
        draft["case_id"] = "EST-test"
        hashes = ["h1"]
        key = hashlib.sha256(json.dumps(hashes).encode()).hexdigest()
        conv = FakeConv(self.NEW)
        conv.sessions["U1"] = {"estimate_draft": draft, "estimate_case": "EST-test",
                               "estimate_photos": ["photos/x.jpg"], "estimate_photo_hashes": hashes,
                               "estimate_photo_cache": key}
        messages, _meta = quote_flow.handle_text(conv, "U1", "幫我估這批")
        text = messages[0]["text"]
        self.assertIn("70 元", text)
        self.assertNotIn("60 元", text)


if __name__ == "__main__":
    unittest.main()
