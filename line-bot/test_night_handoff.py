"""NIGHTHANDOFF: real webhook, durable synthetic inbox/session, no network."""
from __future__ import annotations

import base64
from copy import deepcopy
from datetime import datetime
import hashlib
import hmac
import importlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import ai_chat
import line_event_log
import line_webhook as lw
import staff_notify as sn
import tunnel_manager


NOTICE = "店員上班後也會看到您的訊息，先由我幫您。"


class NightHandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp_ctx = tempfile.TemporaryDirectory(prefix="night-handoff-")
        self.addCleanup(self.tmp_ctx.cleanup)
        self.root = Path(self.tmp_ctx.name)
        self.uid, self.case = "U-night-handoff", "NIGHT-CASE-1"
        self.sent, self.handled, self.downloads = [], [], []
        self.answer = [{"type": "text", "text": "我可以先幫您處理這個問題。"}]
        self.handle_error = False
        for obj, key, value in (
            (sn, "INBOX", self.root / "data/staff-inbox.jsonl"),
            (sn, "TARGET", self.root / "data/staff-target.json"),
            (sn, "_beep", lambda: None),
            (sn, "push_group", lambda row: True),
            (sn, "guest_name", lambda uid: "測試客人"),
            (lw, "REPO", self.root),
            (lw, "INBOX_LOG", self.root / "data/line-unanswered.jsonl"),
            (lw, "PHOTOS_ROOT", self.root / "data/photos"),
            (lw, "download_content", self.download),
            (lw, "reply", self.accept),
            (lw.conv, "SESS", self.root / "data/line-sessions.json"),
            (lw.conv, "now_tw", lambda: datetime(2026, 11, 10, 22, 30, tzinfo=lw.conv.TZ)),
            (lw.conv, "handle_ex", self.handle),
            (tunnel_manager, "is_night_window", lambda: True),
        ):
            p = mock.patch.object(obj, key, value)
            p.start()
            self.addCleanup(p.stop)
        self.open_case(self.case)

    def open_case(self, case):
        sn.push_inbox("human", {"id": case, "case_id": case, "uid": self.uid,
                               "event_id": "open-" + case, "text": "需要店員協助"}, notify=False)

    def rows(self, kind=None):
        rows = [json.loads(s) for s in sn.INBOX.read_text(encoding="utf-8").splitlines()]
        return rows if kind is None else [r for r in rows if r.get("kind") == kind]

    def handle(self, uid, text, kind="message", event_id=""):
        self.handled.append((uid, text, kind, event_id))
        if self.handle_error:
            raise RuntimeError("synthetic pre-reply failure")
        return deepcopy(self.answer), {"intent": "ack", "notify_staff": False}

    def accept(self, reply_token, messages):
        self.sent.append(deepcopy(messages))
        return True

    def download(self, mid):
        self.downloads.append(mid)
        return b"synthetic-photo"

    def event(self, eid="event-1", text="可以先幫我嗎", message=None):
        return {"type": "message", "webhookEventId": eid, "replyToken": "rt-" + eid,
                "source": {"type": "user", "userId": self.uid},
                "message": message or {"type": "text", "id": "m-" + eid, "text": text}}

    def post(self, ev):
        body = json.dumps({"events": [ev]}, ensure_ascii=False).encode("utf-8")
        sig = base64.b64encode(hmac.new(lw.SECRET, body, hashlib.sha256).digest()).decode()
        return lw.app.test_client().post("/line/webhook", data=body, content_type="application/json",
                                         headers={"X-Line-Signature": sig})

    def redeliver(self, ev):
        ev = deepcopy(ev)
        ev["deliveryContext"] = {"isRedelivery": True}
        return self.post(ev)

    def assert_silent_recorded(self):
        self.assertEqual(self.post(self.event()).status_code, 200)
        self.assertEqual(self.handled, [])
        self.assertEqual(self.sent, [])
        self.assertEqual(len(self.rows("human_message")), 1)
        self.assertEqual(self.rows("human_message")[0]["text"], "可以先幫我嗎")

    def test_pending_night_replies_records_and_adds_notice_only_once(self):
        self.assertEqual(self.post(self.event()).status_code, 200)
        self.assertEqual(self.handled, [(self.uid, "可以先幫我嗎", "message", "event-1")])
        self.assertEqual(self.sent, [[{"type": "text", "text": "我可以先幫您處理這個問題。\n" + NOTICE}]])
        self.assertEqual(self.rows("human_message")[0]["case_id"], self.case)
        self.assertEqual(sn.handoff_state(self.uid)["state"], "HANDOFF_PENDING")
        self.assertEqual(self.post(self.event("event-2")).status_code, 200)
        self.assertEqual(self.sent[1], self.answer)
        self.assertEqual(len(self.rows("human_message")), 2)
        self.assertEqual(len(sn.list_inbox()), 1, "notice control row must not become a staff card")
        self.assertEqual(sn.list_inbox()[0]["message_count"], 3)

    def test_notice_survives_reload_and_expired_conversation_session(self):
        self.post(self.event())
        self.assertEqual(len(self.sent), 1)
        self.assertIn(NOTICE, self.sent[0][0]["text"])
        # Reload the actual reader, and make conversation state absent as on a cold/expired session.
        inbox, target = sn.INBOX, sn.TARGET
        importlib.reload(sn)
        sn.INBOX, sn.TARGET = inbox, target
        sn._beep, sn.push_group, sn.guest_name = lambda: None, lambda row: True, lambda uid: "測試客人"
        lw.conv.SESS.unlink(missing_ok=True)
        self.post(self.event("after-reload"))
        self.assertEqual(len(self.sent), 2)
        self.assertEqual(self.sent[1], self.answer)
        self.assertEqual(len(self.rows("human_message")), 2)

    def test_new_case_gets_its_own_first_notice(self):
        self.post(self.event())
        self.assertEqual(len(self.sent), 1)
        self.assertTrue(sn.release_handoff(self.case))
        self.open_case("NIGHT-CASE-2")
        self.post(self.event("case-2"))
        self.assertEqual(len(self.sent), 2)
        self.assertIn(NOTICE, self.sent[1][0]["text"])

    def test_human_active_night_stays_silent_and_records(self):
        self.assertTrue(sn.claim_handoff(self.case))
        self.assert_silent_recorded()

    def test_pending_day_stays_silent_and_records(self):
        with mock.patch.object(tunnel_manager, "is_night_window", return_value=False):
            self.assert_silent_recorded()

    def test_human_active_day_stays_silent_and_records(self):
        self.assertTrue(sn.claim_handoff(self.case))
        with mock.patch.object(tunnel_manager, "is_night_window", return_value=False):
            self.assert_silent_recorded()

    def test_window_error_is_day_logs_one_safe_line_and_records(self):
        err = io.StringIO()
        with mock.patch.object(tunnel_manager, "is_night_window", side_effect=ValueError("private-test-value")), \
                mock.patch("sys.stderr", err):
            self.assert_silent_recorded()
        self.assertEqual(len(err.getvalue().strip().splitlines()), 1)
        self.assertIn("ValueError", err.getvalue())
        self.assertNotIn("private-test-value", err.getvalue())

    def test_redelivery_after_accepted_reply_sends_once(self):
        ev = self.event()
        self.post(ev)
        self.assertEqual(len(self.sent), 1)
        self.redeliver(ev)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.handled), 1)
        self.assertEqual(len(self.rows("human_message")), 1)

    def test_accepted_redelivery_stays_suppressed_after_session_cache_is_gone(self):
        ev = self.event()
        self.post(ev)
        self.assertEqual(len(self.sent), 1)
        lw.conv.SESS.unlink()
        self.redeliver(ev)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.handled), 1)
        self.assertEqual(len(self.rows("human_message")), 1)

    def test_redelivery_after_record_before_conversation_failure_does_not_go_silent(self):
        ev = self.event()
        self.handle_error = True
        self.post(ev)
        self.assertEqual(len(self.rows("human_message")), 1)
        self.assertEqual(self.sent, [])
        self.handle_error = False
        self.redeliver(ev)
        self.assertEqual(len(self.sent), 1)
        self.assertIn(NOTICE, self.sent[0][0]["text"])
        self.redeliver(ev)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.rows("human_message")), 1)

    def test_failed_send_retries_cache_without_losing_first_notice(self):
        ev = self.event()

        def failed(token, messages):
            line_event_log.reply_result("failed", "network")
            return False

        with mock.patch.object(lw, "reply", failed):
            self.assertEqual(self.post(ev).status_code, 503)
        self.assertEqual(self.sent, [])
        self.redeliver(ev)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.handled), 1, "retry must reuse the normal reply cache")
        self.assertIn(NOTICE, self.sent[0][0]["text"])
        self.redeliver(ev)
        self.assertEqual(len(self.sent), 1)

    def test_uncertain_send_does_not_resend(self):
        def unknown(token, messages):
            self.sent.append(deepcopy(messages))
            line_event_log.reply_result("unknown", "unknown")
            return False

        with mock.patch.object(lw, "reply", unknown):
            self.post(self.event())
        self.redeliver(self.event())
        self.assertEqual(len(self.sent), 1)

    def test_first_text_gets_final_line_and_other_payload_is_unchanged(self):
        self.answer = [{"type": "image", "originalContentUrl": "https://example.invalid/1",
                        "previewImageUrl": "https://example.invalid/1"},
                       {"type": "text", "text": "第一行\n第二行", "quickReply": {"items": []}},
                       {"type": "text", "text": "後面的文字維持原樣"}]
        before = deepcopy(self.answer)
        self.post(self.event())
        expected = deepcopy(before)
        expected[1]["text"] += "\n" + NOTICE
        self.assertEqual(self.sent, [expected])
        self.assertEqual(self.answer, before)
        self.assertNotIn("非營業", NOTICE)
        self.assertNotIn("打烊", NOTICE)

    def test_five_text_messages_stay_five(self):
        self.answer = [{"type": "text", "text": f"答覆 {i}"} for i in range(5)]
        self.post(self.event())
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.sent[0]), 5)
        self.assertEqual(self.sent[0][0]["text"], "答覆 0\n" + NOTICE)
        self.assertEqual(self.sent[0][1:], self.answer[1:])

    def test_nontext_reply_reserves_a_slot_for_notice_within_five(self):
        for count in (1, 5):
            with self.subTest(count=count):
                uid = self.uid
                self.uid = f"U-nontext-{count}"
                self.open_case(f"NON-TEXT-{count}")
                self.answer = [{"type": "image", "originalContentUrl": f"https://example.invalid/{i}",
                                "previewImageUrl": f"https://example.invalid/{i}"} for i in range(count)]
                self.post(self.event(f"nontext-{count}"))
                self.assertTrue(self.sent)
                self.assertEqual(self.sent[-1], self.answer[:4] + [{"type": "text", "text": NOTICE}])
                self.assertLessEqual(len(self.sent[-1]), 5)
                self.uid = uid

    def test_photo_is_retained_for_staff_and_normal_conversation(self):
        ev = self.event(message={"type": "image", "id": "photo-1"})
        self.post(ev)
        self.assertEqual(len(self.handled), 1)
        relative = self.rows("human_message")[0]["photo"]
        self.assertEqual((self.root / "data" / relative).read_bytes(), b"synthetic-photo")
        self.assertEqual(self.handled[0], (self.uid, relative, "image", "event-1"))
        self.assertEqual(self.downloads, ["photo-1"])
        self.assertEqual(len(self.sent), 1)
        self.redeliver(ev)
        self.assertEqual(self.downloads, ["photo-1"])
        self.assertEqual(len(self.rows("human_message")), 1)

    def test_real_human_and_complaint_flow_reuses_the_open_case(self):
        # Run the real conversation/AI handoff rules, replacing only external I/O.
        original_handle = self.handle_patch_target
        with mock.patch.object(lw.conv, "handle_ex", original_handle), \
                mock.patch.dict("os.environ", {"LAUNDRY_AI_CHAT": "on"}), \
                mock.patch.object(ai_chat, "_decide", side_effect=AssertionError("must not call a model")):
            self.post(self.event("human-again", "我要找真人"))
            self.post(self.event("complaint-again", "我要客訴"))
        self.assertEqual(len(self.sent), 2)
        self.assertEqual(sn.handoff_state(self.uid)["case_id"], self.case)
        self.assertEqual(sum(r.get("state") == "HANDOFF_PENDING" for r in self.rows("handoff")), 1)
        self.assertEqual({r.get("case_id") for r in sn.list_inbox()}, {self.case})
        self.assertEqual(sum(NOTICE in m.get("text", "") for batch in self.sent for m in batch), 1)

    def test_photo_need_keeps_its_estimate_case_identifier(self):
        sn.push_inbox("photo_need", {"id": "EST-KEEP", "case_id": "EST-KEEP", "uid": self.uid,
                                     "event_id": "estimate-needs-review", "text": "照片需要店員確認"}, notify=False)
        self.assertEqual(self.rows("photo_need")[0]["case_id"], "EST-KEEP")
        self.assertEqual(sn.handoff_state(self.uid)["case_id"], self.case)

    handle_patch_target = staticmethod(lw.conv.handle_ex)
