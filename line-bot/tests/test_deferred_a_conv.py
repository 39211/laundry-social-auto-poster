# -*- coding: utf-8 -*-
"""Deferred A-CONV fixes: H2 (per-thread _pack context) and H3 (pickup copy = owner facts only).

No network, no real data: fixture repo, temp session/booking files, fake staff modules.
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
from pathlib import Path
from unittest import mock

BOT_DIR = Path(__file__).resolve().parents[1]
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

if "conversation" not in sys.modules:
    _fixture = Path(tempfile.mkdtemp(prefix="aconv-deferred-fixture-"))
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


def texts(msgs) -> str:
    return "\n".join(m.get("text") or "" for m in msgs if m.get("type") == "text")


def start_turn(uid, npush=0):
    """Exactly what handle_ex does at the start of every turn."""
    conv._pack.uid = uid
    conv._pack.text = ""
    conv._pack._npush = npush
    conv._pack.photo_funnel = False


class _Isolated(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="aconv-deferred-"))
        (self.tmp / "data").mkdir()
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
            mock.patch.object(conv, "BOOK", self.tmp / "data" / "line-bookings.jsonl"),
            mock.patch.object(conv, "_profile_get", return_value={}),
            mock.patch.object(conv, "_profile_save", return_value=None),
            mock.patch.dict(sys.modules, fakes),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(start_turn, None)


class PackContextPerThreadTest(_Isolated):
    """H2: another customer's turn on another real thread must not leak into this turn."""

    A = "Utest_thread_A"
    B = "Utest_thread_B"

    def test_parallel_turns_do_not_share_context(self):
        # B just sent a photo (and B's turn already notified staff).
        conv.set_sess(self.B, photo_ts=conv.now_tw().isoformat(), wait="photo_need")
        a_started, b_started = threading.Event(), threading.Event()
        out, errors = {}, []

        def turn_a():
            try:
                start_turn(self.A)
                a_started.set()
                if not b_started.wait(5):
                    raise TimeoutError("turn B never started")
                out["a"] = conv._pack([conv.text_msg("A 的答案")], "quote")
            except BaseException as exc:  # surfaced below
                errors.append(exc)

        def turn_b():
            try:
                if not a_started.wait(5):
                    raise TimeoutError("turn A never started")
                start_turn(self.B, npush=1)
            except BaseException as exc:
                errors.append(exc)
            finally:
                b_started.set()

        threads = [threading.Thread(target=turn_a), threading.Thread(target=turn_b)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(10)
        self.assertEqual(errors, [])
        msgs, meta = out["a"]
        self.assertEqual([m.get("text") for m in msgs], ["A 的答案"])
        self.assertFalse(meta["staff_pushed"])
        sess_b = conv.get_sess(self.B)
        self.assertTrue(sess_b.get("photo_ts"), "A's turn cleared B's photo")
        self.assertEqual(sess_b.get("wait"), "photo_need")

    def test_postback_does_not_inherit_previous_event_context(self):
        result = {}

        def worker():
            try:
                start_turn("Utest_previous_event", npush=2)  # earlier event on this worker thread
                conv.handle_postback("Utest_postback", "tab=menu", {})
                result["uid"] = getattr(conv._pack, "uid", None)
                result["npush"] = getattr(conv._pack, "_npush", None)
            except BaseException as exc:
                result["error"] = repr(exc)

        t = threading.Thread(target=worker)
        t.start()
        t.join(10)
        self.assertEqual(result, {"uid": "Utest_postback", "npush": 0})


class PickupCopyFactsTest(_Isolated):
    """H3: keep the owner fact 台中市免費到府收送; drop minimum-order claims; do not deny the fact."""

    UID = "Utest_pickup_copy"

    def test_new_pickup_copy_keeps_fact_drops_minimum_order_claims(self):
        variants = [texts(conv.start_pickup(self.UID)) for _ in range(2)]
        self.assertNotEqual(variants[0], variants[1])  # both variants covered
        for copy in variants:
            self.assertIn("台中市免費到府收送", copy)
            self.assertIn("一件也收", copy)  # owner-confirmed 2026-11-05
            self.assertNotIn("低消", copy)  # minimum-order claim is not an owner fact

    def test_free_pickup_question_states_owner_fact(self):
        for question in ("收送免費嗎", "收送要錢嗎"):
            msgs, intent, _notify = conv._natural_customer_question(self.UID, question, question)
            text = texts(msgs)
            self.assertEqual(intent, "pickup_info")
            self.assertIn("台中市免費到府收送", text)
            self.assertNotIn("亂報費用", text)
            self.assertNotIn("低消", text)


if __name__ == "__main__":
    unittest.main()
