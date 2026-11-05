# -*- coding: utf-8 -*-
"""A-CONV audit regressions: C1 hours, H1 cancel, H2 per-thread _pack, H3 pickup copy.

No network, no real data: fixture repo + temp session/booking files + fake staff modules.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import types
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

BOT_DIR = Path(__file__).resolve().parents[1]
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

if "conversation" not in sys.modules:
    _fixture = Path(tempfile.mkdtemp(prefix="aconv-fixture-"))
    (_fixture / "data").mkdir(parents=True, exist_ok=True)
    (_fixture / "data" / "prices.json").write_text(
        json.dumps({"衣物": {"測試品項": 1}}, ensure_ascii=False), encoding="utf-8"
    )
    (_fixture / "data" / "business-profile.json").write_text(
        json.dumps(
            {
                "telephone_local": "04-0000-0000",
                "map_url": "",
                "address_text": "測試地址",
                "opening_hours_text": "週一至週五 10:00-20:00；週六 12:00-18:00；週日公休",
                "landmark": "測試地標",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    _old_root = os.environ.get("LAUNDRY_REPO_ROOT")
    os.environ["LAUNDRY_REPO_ROOT"] = str(_fixture)
    try:
        import conversation  # noqa: F401
    finally:
        if _old_root is None:
            os.environ.pop("LAUNDRY_REPO_ROOT", None)
        else:
            os.environ["LAUNDRY_REPO_ROOT"] = _old_root

import conversation as conv  # noqa: E402


def _module(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    return mod


class _Isolated(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="aconv-"))
        (self.tmp / "data").mkdir()
        self.book = self.tmp / "data" / "line-bookings.jsonl"
        fakes = {
            "staff_notify": _module(
                "staff_notify",
                push_inbox=lambda kind, payload, notify=True: {"saved": True, "notified": False},
                guest_name=lambda uid: "客人",
            ),
            "line_usage": _module("line_usage", count_reply=lambda *a, **k: None),
            "line_pay": _module("line_pay", configured=lambda: False),
        }
        patches = [
            mock.patch.object(conv, "REPO", self.tmp),
            mock.patch.object(conv, "SESS", self.tmp / "data" / "line-sessions.json"),
            mock.patch.object(conv, "BOOK", self.book),
            mock.patch.object(conv, "_profile_get", return_value={}),
            mock.patch.object(conv, "_profile_save", return_value=None),
            mock.patch.dict(sys.modules, fakes),
        ]
        for target, name in (
            (conv.ai_chat, "handoff_first"),
            (conv.ai_chat, "compound_payment_question"),
            (conv.ai_chat, "mid_flow"),
            (conv.ai_chat, "no_flow_answer"),
            (conv.journey_ux, "handle"),
            (conv.quote_flow, "handle_text"),
            (conv.quote_flow, "photo_received"),
        ):
            patches.append(mock.patch.object(target, name, return_value=None, create=True))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    @staticmethod
    def texts(msgs) -> str:
        return "\n".join(m.get("text") or "" for m in msgs if m.get("type") == "text")


class HoursOpenNowTest(unittest.TestCase):
    """C1: a real clock advances between calls; the bot must not say 打烊 while open."""

    @staticmethod
    def _ticking(start: datetime):
        state = {"n": 0}

        def clock():
            state["n"] += 1
            return start + timedelta(microseconds=state["n"])

        return clock

    def _first(self, start: datetime, text: str) -> str:
        with mock.patch.object(conv, "now_tw", self._ticking(start)):
            return conv.hours_reply(text)[0]["text"]

    def test_weekday_afternoon_is_open(self):
        start = datetime(2026, 7, 1, 15, 0, tzinfo=conv.TZ)  # Wednesday
        first = self._first(start, "今天有開嗎")
        self.assertTrue(first.startswith("現在有開"), first)
        self.assertNotIn("打烊", first)

    def test_saturday_afternoon_is_open(self):
        start = datetime(2026, 7, 4, 13, 0, tzinfo=conv.TZ)  # Saturday
        self.assertTrue(self._first(start, "現在有開嗎").startswith("現在有開"))

    def test_weekday_night_is_closed(self):
        start = datetime(2026, 7, 1, 21, 0, tzinfo=conv.TZ)
        self.assertIn("打烊", self._first(start, "今天有開嗎"))

    def test_booking_guard_still_rejects_past(self):
        past = conv.now_tw() - timedelta(days=1)
        self.assertEqual(conv.booking_guard(past), "已經過了")


class CancelNeedsClearCommandTest(_Isolated):
    """H1: questions / 改期 / negations must not cancel a real booking."""

    UID = "Utest000000000000000000000000cncl"

    def setUp(self):
        super().setUp()
        when = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%dT15:00")
        row = {"id": "PTEST0001", "uid": self.UID, "when": when, "item": "", "kind": "book", "ts": "x"}
        self.book.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")

    def cancel_rows(self):
        rows = [json.loads(x) for x in self.book.read_text(encoding="utf-8").splitlines() if x.strip()]
        return [r for r in rows if r.get("kind") == "cancel"]

    def test_reschedule_question_keeps_booking(self):
        msgs, meta = conv.handle_ex(self.UID, "可以改期嗎")
        self.assertEqual(self.cancel_rows(), [])
        self.assertNotEqual(meta["intent"], "cancel")
        self.assertNotIn("取消了", self.texts(msgs))

    def test_negated_cancel_keeps_booking(self):
        msgs, meta = conv.handle_ex(self.UID, "先不要取消，我會到")
        self.assertEqual(self.cancel_rows(), [])
        self.assertNotIn("取消了", self.texts(msgs))

    def test_clear_command_still_cancels(self):
        msgs, meta = conv.handle_ex(self.UID, "取消預約")
        self.assertEqual(len(self.cancel_rows()), 1)
        self.assertEqual(meta["intent"], "cancel")






if __name__ == "__main__":
    unittest.main()
