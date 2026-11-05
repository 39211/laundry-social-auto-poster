# -*- coding: utf-8 -*-
"""A-WEBHOOK-1/3/4: reply before staff side effects; staff errors do not 500 the batch;
staff card ids never collide. No network: conv/quote_flow/staff_notify/line_pay are stubs."""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

LINE_BOT = Path(__file__).resolve().parents[1]
CHANNEL_SECRET = "test-secret-not-real"


class FrozenDT(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 11, 5, 21, 30, 0)


def _text_event(uid, eid, text):
    return {
        "type": "message",
        "webhookEventId": eid,
        "replyToken": "rt-" + eid,
        "source": {"type": "user", "userId": uid},
        "message": {"type": "text", "id": "m-" + eid, "text": text},
    }


class _HookBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="wh-reply-first-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        secrets = self.tmp / "secrets"
        secrets.mkdir()
        (secrets / "line-channel.json").write_text(
            json.dumps({"channel_secret": CHANNEL_SECRET, "line_channel_token": "test-token"}),
            encoding="utf-8",
        )
        env = mock.patch.dict(os.environ, {"LAUNDRY_REPO_ROOT": str(self.tmp)})
        env.start()
        self.addCleanup(env.stop)

        self.calls = []
        self.push_error_for = set()
        calls, push_error_for = self.calls, self.push_error_for

        conv = types.ModuleType("conversation")
        conv.handle_ex = lambda uid, text, kind, event_id="": (
            [{"type": "text", "text": "ok"}],
            {"notify_staff": True},
        )
        conv.handle = lambda uid, text, kind: [{"type": "text", "text": "ok"}]
        conv.recent_staff_ask_prefix = lambda uid: ""
        self.conv = conv

        qf = types.ModuleType("quote_flow")
        qf.seen_event = lambda conv_mod, uid, event_id: False
        qf.reply_accepted = lambda conv_mod, uid, event_id: False
        qf.cached_reply = lambda conv_mod, uid, event_id: []
        qf.mark_reply_accepted = lambda conv_mod, uid, event_id: None
        qf.PHOTOS_ROOT = None

        sn = types.ModuleType("staff_notify")

        def guest_name(uid):
            calls.append(("guest_name", uid))
            return "guest"

        def push_inbox(kind, row, notify=True):
            calls.append(("push", kind, row))
            if row.get("uid") in push_error_for:
                raise OSError("inbox locked")
            return {"saved": True, "notified": True}

        sn.guest_name = guest_name
        sn.push_inbox = push_inbox
        sn.bind_group = lambda gid: None

        lp = types.ModuleType("line_pay")
        lp.confirm = lambda tid, amt: {"ok": False}

        mods = mock.patch.dict(
            sys.modules,
            {"conversation": conv, "quote_flow": qf, "staff_notify": sn, "line_pay": lp},
        )
        mods.start()
        self.addCleanup(mods.stop)

        spec = importlib.util.spec_from_file_location("line_webhook_under_test", LINE_BOT / "line_webhook.py")
        self.mod = importlib.util.module_from_spec(spec)
        sys.modules["line_webhook_under_test"] = self.mod
        self.addCleanup(sys.modules.pop, "line_webhook_under_test", None)
        spec.loader.exec_module(self.mod)

        def fake_reply(reply_token, messages):
            calls.append(("reply", reply_token))
            return True

        patcher = mock.patch.object(self.mod, "reply", fake_reply)
        patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, events):
        body = json.dumps({"destination": "Utestdest", "events": events}).encode()
        sig = base64.b64encode(hmac.new(CHANNEL_SECRET.encode(), body, hashlib.sha256).digest()).decode()
        return self.mod.app.test_client().post(
            "/line/webhook",
            data=body,
            headers={"X-Line-Signature": sig, "Content-Type": "application/json"},
        )


class ReplyFirstTest(_HookBase):
    def test_reply_is_sent_before_staff_side_effects(self):
        resp = self.post([_text_event("Utest0001", "ev1", "can you wash curtains")])
        self.assertEqual(resp.status_code, 200)
        names = [c[0] for c in self.calls]
        self.assertIn("reply", names)
        self.assertIn("push", names)
        self.assertIn("guest_name", names)
        self.assertLess(names.index("reply"), names.index("guest_name"))
        self.assertLess(names.index("reply"), names.index("push"))

    def test_staff_write_error_does_not_drop_later_replies(self):
        self.push_error_for.add("Utest0001")
        resp = self.post([_text_event("Utest0001", "ev1", "q1"), _text_event("Utest0002", "ev2", "q2")])
        self.assertEqual(resp.status_code, 200)
        replied = [c[1] for c in self.calls if c[0] == "reply"]
        self.assertEqual(replied, ["rt-ev1", "rt-ev2"])

    def test_staff_card_ids_do_not_collide(self):
        with mock.patch.object(self.mod, "datetime", FrozenDT):
            self.post([_text_event("Utest0001", "ev1", "q1"), _text_event("Utest0002", "ev2", "q2")])
        ids = [c[2]["id"] for c in self.calls if c[0] == "push"]
        self.assertEqual(len(ids), 2)
        self.assertNotEqual(ids[0], ids[1])
        self.assertTrue(all(i.startswith("Q") for i in ids))
        self.assertNotIn("Q213000", ids)  # old format repeated every day at the same second


def _msg_event(uid, eid, message):
    return {
        "type": "message",
        "webhookEventId": eid,
        "replyToken": "rt-" + eid,
        "source": {"type": "user", "userId": uid},
        "message": dict(message, id="m-" + eid),
    }


class OtherMessageKindsTest(_HookBase):
    """Same guarantees for sticker / image / location, which have their own code paths."""

    def _assert_reply_first(self):
        names = [c[0] for c in self.calls]
        self.assertIn("reply", names)
        self.assertIn("push", names)
        self.assertLess(names.index("reply"), names.index("guest_name"))
        self.assertLess(names.index("reply"), names.index("push"))

    def _assert_error_does_not_drop_next_reply(self, first_message):
        self.push_error_for.add("Utest0001")
        resp = self.post([
            _msg_event("Utest0001", "ev1", first_message),
            _text_event("Utest0002", "ev2", "q2"),
        ])
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([c[1] for c in self.calls if c[0] == "reply"], ["rt-ev1", "rt-ev2"])

    def test_sticker_reply_first_and_card_says_sticker(self):
        resp = self.post([_msg_event("Utest0001", "ev1", {"type": "sticker", "packageId": "1", "stickerId": "1"})])
        self.assertEqual(resp.status_code, 200)
        self._assert_reply_first()
        row = [c[2] for c in self.calls if c[0] == "push"][0]
        self.assertIn("貼圖", row["text"])  # sticker, not "photo"
        self.assertNotIn("照片", row["text"])

    def test_sticker_staff_error_does_not_drop_next_reply(self):
        self._assert_error_does_not_drop_next_reply({"type": "sticker", "packageId": "1", "stickerId": "1"})

    def test_location_reply_first(self):
        resp = self.post([_msg_event("Utest0001", "ev1", {"type": "location", "address": "Taichung", "latitude": 1, "longitude": 2})])
        self.assertEqual(resp.status_code, 200)
        self._assert_reply_first()

    def test_location_staff_error_does_not_drop_next_reply(self):
        self._assert_error_does_not_drop_next_reply({"type": "location", "address": "Taichung", "latitude": 1, "longitude": 2})

    def test_image_saved_reply_first_and_unique_id(self):
        with mock.patch.object(self.mod, "_handle_image_save", lambda uid, mid: "photos/x.jpg"), \
                mock.patch.object(self.mod, "datetime", FrozenDT):
            resp = self.post([
                _msg_event("Utest0001", "ev1", {"type": "image"}),
                _msg_event("Utest0002", "ev2", {"type": "image"}),
            ])
        self.assertEqual(resp.status_code, 200)
        self._assert_reply_first()
        ids = [c[2]["id"] for c in self.calls if c[0] == "push"]
        self.assertEqual(len(ids), 2)
        self.assertNotEqual(ids[0], ids[1])
        self.assertTrue(all(i.startswith("P") for i in ids))

    def test_image_save_failed_reply_first(self):
        with mock.patch.object(self.mod, "_handle_image_save", lambda uid, mid: ""):
            resp = self.post([_msg_event("Utest0001", "ev1", {"type": "image"})])
        self.assertEqual(resp.status_code, 200)
        self._assert_reply_first()

    def test_image_staff_error_does_not_drop_next_reply(self):
        with mock.patch.object(self.mod, "_handle_image_save", lambda uid, mid: "photos/x.jpg"):
            self._assert_error_does_not_drop_next_reply({"type": "image"})

    def _assert_two_events_get_distinct_ids(self, message, prefix, image_save=None):
        patches = [mock.patch.object(self.mod, "datetime", FrozenDT)]
        if image_save is not None:
            patches.append(mock.patch.object(self.mod, "_handle_image_save", lambda uid, mid: image_save))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        resp = self.post([_msg_event("Utest0001", "ev1", message), _msg_event("Utest0002", "ev2", message)])
        self.assertEqual(resp.status_code, 200)
        ids = [c[2]["id"] for c in self.calls if c[0] == "push"]
        self.assertEqual(len(ids), 2)
        self.assertNotEqual(ids[0], ids[1])
        self.assertTrue(all(i.startswith(prefix) and len(i) > 10 for i in ids))

    def test_sticker_card_ids_do_not_collide(self):
        self._assert_two_events_get_distinct_ids({"type": "sticker", "packageId": "1", "stickerId": "1"}, "Q")

    def test_location_card_ids_do_not_collide(self):
        self._assert_two_events_get_distinct_ids({"type": "location", "address": "Taichung", "latitude": 1, "longitude": 2}, "Q")

    def test_image_save_failed_card_ids_do_not_collide(self):
        self._assert_two_events_get_distinct_ids({"type": "image"}, "Q", image_save="")

    def test_legacy_image_card_ids_do_not_collide(self):
        del self.conv.handle_ex
        self._assert_two_events_get_distinct_ids({"type": "image"}, "P", image_save="photos/x.jpg")

    def test_legacy_image_path_reply_first(self):
        del self.conv.handle_ex  # old conversation module without handle_ex
        with mock.patch.object(self.mod, "_handle_image_save", lambda uid, mid: "photos/x.jpg"):
            resp = self.post([_msg_event("Utest0001", "ev1", {"type": "image"})])
        self.assertEqual(resp.status_code, 200)
        self._assert_reply_first()


if __name__ == "__main__":
    unittest.main()
