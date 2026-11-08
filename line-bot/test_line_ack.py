# -*- coding: utf-8 -*-
"""LINE-ACK r1: signed webhook, synthetic repo, fake HTTP, isolated telemetry.

Run with run_a2b_tests.py test_line_ack (or unittest in a synthetic environment).
Never enables telemetry for any other test process or touches a live data path.
"""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "test-assets"))
import sandbox_repo

_ROOT = sandbox_repo.shared_sandbox(prefix="line-ack-import-")
os.environ.update(LAUNDRY_REPO_ROOT=str(_ROOT), LAUNDRY_EHANK_ROOT=str(_ROOT / "no-pos"),
                  LAUNDRY_LOOKUP_FIXTURE="1", LAUNDRY_AI_CHAT="off", LAUNDRY_LINE_USAGE="off")

import conversation as conv
import estimate
import line_event_log as telemetry
import line_webhook as hook
import quote_flow as flow
import staff_notify as staff

UID = "Uprivate-raw-user-13579"
EID = "private-webhook-event-24680"
TOKEN = "private-reply-token-97531"
TEXT = "private customer text 0901234567"
MESSAGES = [{"type": "text", "text": "synthetic response"}]


def event(eid=EID, uid=UID, token=TOKEN, kind="message", message=None, data="", redelivered=False):
    row = {"webhookEventId": eid, "type": kind, "replyToken": token,
           "source": {"type": "user", "userId": uid},
           "deliveryContext": {"isRedelivery": redelivered}}
    if kind == "message":
        row["message"] = message or {"type": "text", "text": TEXT, "id": "private-message-id-86420"}
    if kind == "postback":
        row["postback"] = {"data": data, "params": {}}
    return row


class HttpResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, *args):
        return b'{"displayName":"synthetic guest","type":"none","totalUsage":0}'


class WebhookTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp(prefix="line-ack-case-"))
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.log_dir = self.folder / "safe-logs"
        self.count_dir = self.folder / "data" / "line-events"
        self.sent = []
        self.reply_attempts = 0
        self.reply_error = None
        self.time = datetime(2026, 11, 8, 10, tzinfo=telemetry.TAIPEI)
        self.handler_calls = []

        def handle_ex(uid, text, kind, event_id=""):
            self.handler_calls.append((uid, kind))
            return copy.deepcopy(MESSAGES), {"notify_staff": False}

        patches = [
            mock.patch.dict(os.environ, {"LAUNDRY_LINE_EVENTS": "on",
                "LAUNDRY_LINE_EVENT_LOG_DIR": str(self.log_dir), "LAUNDRY_LINE_EVENTS_DIR": str(self.count_dir),
                "LAUNDRY_LINE_USAGE": "off", "LAUNDRY_AI_CHAT": "off",
                "LAUNDRY_CHAT_USAGE_DIR": str(self.folder / "chat-usage"),
                "LAUNDRY_VISION_USAGE_DIR": str(self.folder / "vision-usage")}),
            mock.patch.object(conv, "SESS", self.folder / "sessions.json"),
            mock.patch.object(conv, "BOOK", self.folder / "bookings.jsonl"),
            mock.patch.object(conv, "REPO", self.folder),
            mock.patch.object(hook, "REPO", self.folder),
            mock.patch.object(hook, "INBOX_LOG", self.folder / "unanswered.jsonl"),
            mock.patch.object(hook, "PHOTOS_ROOT", self.folder / "photos"),
            mock.patch.object(conv, "handle_ex", handle_ex),
            mock.patch.object(staff, "INBOX", self.folder / "inbox.jsonl"),
            mock.patch.object(staff, "BOOK", self.folder / "bookings.jsonl"),
            mock.patch.object(staff, "TARGET", self.folder / "target.json"),
            mock.patch.object(staff, "_beep", lambda: None),
            mock.patch.object(staff, "guest_name", lambda uid: "synthetic guest"),
            mock.patch.object(staff, "handoff_active", return_value=False),
            mock.patch.object(staff, "handoff_event_seen", return_value=False),
            mock.patch.object(hook, "token", lambda: "synthetic-channel-token"),
            mock.patch.object(telemetry, "now_taipei", lambda: self.time),
            mock.patch.object(telemetry, "_WARNED", False),
            mock.patch.object(hook.urllib.request, "urlopen", self.http),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def http(self, req, **kwargs):
        if req.full_url.endswith("/message/reply"):
            self.reply_attempts += 1
            error = self.reply_error.pop(0) if isinstance(self.reply_error, list) else self.reply_error
            if error:
                raise error
            self.sent.append(json.loads(req.data))
        return HttpResponse()

    def post(self, events, *, valid=True):
        body = json.dumps({"events": events}).encode()
        signature = base64.b64encode(hmac.new(hook.SECRET, body, hashlib.sha256).digest()).decode()
        return hook.app.test_client().post("/line/webhook", data=body,
            headers={"Content-Type": "application/json", "X-Line-Signature": signature if valid else "invalid"})

    def rows(self, kind="event"):
        return [json.loads(line) for path in sorted(self.log_dir.glob("*.jsonl"))
                for line in path.read_text(encoding="utf-8").splitlines() if json.loads(line)["kind"] == kind]

    def counts(self):
        return json.loads((self.count_dir / "2026-11-08.json").read_text(encoding="utf-8"))

    def test_five_deliveries_are_three_correlated_events(self):
        for ev in (event(), event(redelivered=True), event(redelivered=True),
                   event(eid="private-second-event"), event(eid="private-third-event")):
            self.assertEqual(200, self.post([ev]).status_code)
        rows = self.rows()
        self.assertEqual(5, len(rows))
        self.assertEqual(5, len(self.rows("request")))
        self.assertEqual(3, len({r["event_ref"] for r in rows if r.get("event_ref")}))
        key = hmac.new(hook.SECRET, b"line-events/correlation/v1", hashlib.sha256).digest()
        self.assertEqual(hmac.new(key, EID.encode(), hashlib.sha256).hexdigest(), rows[0]["event_ref"])
        self.assertEqual(["new", "accepted_skipped", "accepted_skipped", "new", "new"], [r["dedup"] for r in rows])
        self.assertEqual(3, len(self.sent))
        self.assertEqual(3, len(self.handler_calls))
        counts = self.counts()
        self.assertEqual([5, 3, 0, 0, 0, 2, 2, 2, 0], [counts[k] for k in telemetry.COUNTERS])

    def test_empty_token_is_not_accepted_and_keeps_cache(self):
        with mock.patch.object(hook.urllib.request, "urlopen") as send:
            self.assertIs(False, hook.reply("", MESSAGES))
            send.assert_not_called()
        self.assertEqual(200, self.post([event(token="")]).status_code)
        self.assertFalse(flow.reply_accepted(conv, UID, EID))
        self.assertEqual(MESSAGES, flow.cached_reply(conv, UID, EID))
        self.assertEqual("failed", self.rows()[0]["reply_result"])
        self.assertEqual(1, self.counts()["reply_failed"])
        self.assertTrue(self.rows()[0]["reply_lost"])
        self.assertEqual(1, self.counts()["reply_lost"])
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(1, len(self.sent))

    def test_empty_messages_are_not_needed_and_never_clear_cache(self):
        with mock.patch.object(hook.urllib.request, "urlopen") as send:
            self.assertIs(False, hook.reply(TOKEN, []))
            send.assert_not_called()
        ev = event(kind="postback", data="tab=prices")
        self.assertEqual(200, self.post([ev]).status_code)
        self.assertFalse(flow.reply_accepted(conv, UID, EID))
        self.assertTrue(flow.has_cached_reply(conv, UID, EID))
        self.assertEqual([], flow.cached_reply(conv, UID, EID))
        self.assertEqual(200, self.post([ev]).status_code)
        self.assertEqual([], self.sent)
        self.assertEqual("not_needed_skipped", self.rows()[-1]["dedup"])

    def test_missing_cache_is_failed_and_not_accepted(self):
        conv.set_sess(UID, estimate_events=[EID], estimate_replies={})
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertFalse(flow.reply_accepted(conv, UID, EID))
        self.assertFalse(flow.has_cached_reply(conv, UID, EID))
        self.assertEqual("cache_missing", self.rows()[0]["dedup"])
        self.assertTrue(self.rows()[0]["reply_lost"])
        self.assertEqual([], self.sent)

    def test_safe_log_contains_no_original_identifiers_or_payload(self):
        ev = event()
        ev["extra"] = {"phone": "0901234567", "photo": "private-photo.jpg", "text": TEXT}
        self.post([ev])
        self.post([event(eid="private-other-id", kind=TEXT)])
        raw = "\n".join(p.read_text(encoding="utf-8") for p in self.log_dir.glob("*.jsonl"))
        for sensitive in (UID, EID, TOKEN, TEXT, "0901234567", "private-message-id-86420",
                          "private-photo.jpg", "private-other-id", "synthetic-channel-token"):
            self.assertNotIn(sensitive, raw)
        allowed = {"schema", "kind", "request_ref", "event_ref", "event_type", "received_at", "started_at",
                   "finished_at", "duration_ms", "stages_ms", "reply_result", "redelivered", "dedup", "to_staff", "http_status",
                   "reply_failure", "reply_lost", "retry_requested", "event_failed"}
        for row in self.rows():
            self.assertEqual(allowed, set(row))
            self.assertRegex(row["event_ref"], r"^[0-9a-f]{64}$")
            self.assertEqual(set(telemetry.STAGES), set(row["stages_ms"]))

    def test_log_write_failure_does_not_break_customer_reply(self):
        with mock.patch.object(telemetry, "_append_records", side_effect=PermissionError(TEXT)):
            response = self.post([event()])
        self.assertEqual(200, response.status_code)
        self.assertEqual(1, len(self.sent))
        self.assertTrue(flow.reply_accepted(conv, UID, EID))
        self.assertEqual(1, self.counts()["replied_ok"])

    def test_counter_write_failure_does_not_break_reply_or_safe_log(self):
        with mock.patch.object(telemetry, "_atomic_write", side_effect=OSError(TEXT)):
            response = self.post([event()])
        self.assertEqual(200, response.status_code)
        self.assertEqual(1, len(self.sent))
        self.assertEqual("accepted", self.rows()[0]["reply_result"])

    def test_counter_view_write_failure_recovers_from_saved_numeric_state(self):
        write = telemetry._atomic_write

        def fail_view(path, data):
            if path.parent == self.count_dir:
                raise OSError("synthetic view write failure")
            write(path, data)

        with mock.patch.object(telemetry, "_atomic_write", fail_view):
            self.assertEqual(200, self.post([event()]).status_code)
        self.assertEqual(1, len(self.sent))
        self.assertFalse((self.count_dir / "2026-11-08.json").exists())
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(2, self.counts()["received"])
        self.assertEqual(1, self.counts()["replied_ok"])
        self.assertEqual(1, self.counts()["duplicate_skipped"])

    def test_staff_notification_and_storage_are_measured(self):
        with mock.patch.object(conv, "handle_ex", return_value=(copy.deepcopy(MESSAGES), {"notify_staff": True})):
            self.assertEqual(200, self.post([event()]).status_code)
        row = self.rows()[0]
        self.assertTrue(row["to_staff"])
        self.assertGreater(row["stages_ms"]["reply"], 0)
        self.assertGreater(row["stages_ms"]["staff_notify"], 0)
        self.assertGreater(row["stages_ms"]["storage"], 0)
        self.assertEqual(1, self.counts()["to_staff"])

    def test_http_rejection_is_failed_and_timeout_is_unknown(self):
        errors = [urllib.error.HTTPError("https://example.invalid", 400, "rejected", {}, io.BytesIO(b'{}')),
                  urllib.error.URLError(TimeoutError("synthetic timeout"))]
        for i, exc in enumerate(errors):
            self.reply_error = exc
            self.assertEqual(200, self.post([event(eid=f"error-{i}")]).status_code)
        self.assertEqual(["failed", "unknown"], [r["reply_result"] for r in self.rows()])
        self.assertEqual([1, 1], [self.counts()[k] for k in ("reply_failed", "reply_unknown")])
        self.assertEqual(2, self.counts()["reply_lost"])

    def test_failed_event_makes_whole_batch_retry_and_other_events_finish(self):
        self.reply_error = [urllib.error.URLError(ConnectionRefusedError("synthetic refusal")), None]
        self.assertEqual(503, self.post([event(), event(eid="second-event")]).status_code)
        self.assertEqual(1, len(self.sent))
        self.assertEqual([503, 503], [r["http_status"] for r in self.rows()])

    def test_all_message_branches_remember_replies_and_retry_consistently(self):
        inputs = [event(eid="text"), event(eid="follow", kind="follow"),
                  event(eid="sticker", message={"type": "sticker"}),
                  event(eid="location", message={"type": "location", "address": TEXT}),
                  event(eid="image", message={"type": "image", "id": "fake-photo-id"})]
        with mock.patch.object(hook, "_handle_image_save", return_value=""):
            for ev in inputs:
                eid = ev["webhookEventId"]
                ev["replyToken"] = ""
                self.assertEqual(200, self.post([ev]).status_code, eid)
                self.assertTrue(self.rows()[-1]["reply_lost"])
                self.assertTrue(flow.seen_event(conv, UID, eid))
                self.assertTrue(flow.has_cached_reply(conv, UID, eid))
                ev["replyToken"] = TOKEN
                self.assertEqual(200, self.post([ev]).status_code, eid)
                self.assertTrue(flow.reply_accepted(conv, UID, eid))
        self.assertEqual(5, len(self.handler_calls))
        self.assertEqual(10, len(self.rows()))

    def test_booking_and_pickup_and_expired_quote_postbacks_share_finalizer(self):
        inputs = ["action=reserve", "action=pickup_when", "action=pickup_confirm", "action=estimate_send&revision=0&case=expired"]
        for i, data in enumerate(inputs):
            ev = event(eid=f"postback-{i}", kind="postback", data=data, token="")
            ev["postback"]["params"] = {"datetime": "2026-11-12T15:00"} if i == 0 else {}
            self.assertEqual(200, self.post([ev]).status_code)
            self.assertTrue(self.rows()[-1]["reply_lost"])
            self.assertTrue(flow.seen_event(conv, UID, ev["webhookEventId"]))
            ev["replyToken"] = TOKEN
            self.assertEqual(200, self.post([ev]).status_code)
            self.assertEqual(200, self.post([ev]).status_code)
        bookings = (self.folder / "bookings.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(1, len(bookings))
        self.assertEqual(4, len(self.sent))
        self.assertEqual(4, self.counts()["duplicate_skipped"])

    def test_quote_early_returns_are_remembered_even_without_webhook(self):
        messages = flow.handle_postback(conv, UID, "action=estimate_send", "empty-quote")
        self.assertTrue(messages)
        self.assertTrue(flow.has_cached_reply(conv, UID, "empty-quote"))
        draft = estimate.update("襯衫1件", None, conv.PRICES)
        draft["case_id"] = "synthetic-case"
        conv.set_sess(UID, estimate_draft=draft)
        for eid, data in (("stale", "action=estimate_send&revision=old&case=old"),
                          ("retired", f"action=estimate_retired&revision={draft['revision']}&case=synthetic-case")):
            self.assertTrue(flow.handle_postback(conv, UID, data, eid))
            self.assertTrue(flow.has_cached_reply(conv, UID, eid))

    def test_handoff_and_group_and_ignored_events_are_still_logged(self):
        with mock.patch.object(staff, "handoff_active", return_value=True), \
                mock.patch.object(staff, "handoff_state", return_value={"case_id": "synthetic-case"}), \
                mock.patch.object(staff, "record_handoff_message"):
            self.assertEqual(200, self.post([event()]).status_code)
        group = event(eid="join", kind="join")
        group["source"] = {"type": "group", "groupId": "private-group-id"}
        self.assertEqual(200, self.post([group, event(eid="ignored", kind="unfollow")]).status_code)
        self.assertEqual(3, len(self.rows()))
        self.assertEqual([], self.sent)
        self.assertEqual(1, self.counts()["to_staff"])

    def test_group_bind_uses_original_reply_without_customer_hints(self):
        ev = event()
        ev["source"] = {"type": "group", "groupId": "synthetic-group"}
        with mock.patch.object(hook, "_read_staff_bind_token", return_value=TEXT), \
                mock.patch.object(staff, "bind_group"), \
                mock.patch.object(conv, "reply_with_hints", side_effect=AssertionError("customer hints in group")):
            self.assertEqual(200, self.post([ev]).status_code)
        self.assertEqual([{"type": "text", "text": "好，之後預約會打到這個群。"}], self.sent[0]["messages"])
        self.assertEqual("accepted", self.rows()[0]["reply_result"])
        self.assertFalse(conv.SESS.exists())

    def test_invalid_signature_is_logged_without_counting_untrusted_events(self):
        self.assertEqual(403, self.post([event()], valid=False).status_code)
        self.assertEqual([], self.rows())
        self.assertEqual(403, self.rows("request")[0]["http_status"])
        self.assertFalse(self.count_dir.exists())

    def test_unexpected_handler_error_is_logged_acked_and_batch_continues(self):
        with mock.patch.object(conv, "handle_ex", side_effect=[RuntimeError(TEXT), (MESSAGES, {})]), \
                mock.patch("sys.stderr", new_callable=io.StringIO) as errors:
            response = self.post([event(), event(eid="later-event")])
        self.assertEqual(200, response.status_code)
        self.assertEqual(["failed", "accepted"], [r["reply_result"] for r in self.rows()])
        self.assertEqual([True, False], [r["event_failed"] for r in self.rows()])
        self.assertEqual("unexpected", self.rows()[0]["reply_failure"])
        self.assertTrue(self.rows()[0]["reply_lost"])
        self.assertFalse(self.rows()[0]["retry_requested"])
        self.assertTrue(self.rows("request")[0]["event_failed"])
        self.assertEqual(2, self.counts()["received"])
        self.assertEqual(1, self.counts()["reply_failed"])
        self.assertEqual(1, self.counts()["replied_ok"])
        self.assertNotIn(TEXT, errors.getvalue())
        self.assertIn("RuntimeError", errors.getvalue())
        raw = "".join(p.read_text(encoding="utf-8") for p in self.log_dir.glob("*.jsonl"))
        for private in (UID, EID, TOKEN, TEXT):
            self.assertNotIn(private, raw)

    def test_hint_preparation_error_releases_unsent_pending_without_marking_hints(self):
        import reply_hints
        import line_reply_state
        with mock.patch.object(reply_hints, "prepare", side_effect=ValueError(TEXT)):
            response = self.post([event()])
        self.assertEqual(200, response.status_code)
        row = self.rows()[0]
        self.assertTrue(row["event_failed"])
        self.assertEqual("failed", row["reply_result"])
        self.assertTrue(row["reply_lost"])
        self.assertFalse(row["retry_requested"])
        self.assertFalse(line_reply_state.pending(self.folder, row["event_ref"]))
        self.assertEqual(0, self.reply_attempts)
        self.assertFalse(reply_hints.state_path(conv).exists())
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(1, self.reply_attempts)

    def test_unexpected_transport_error_keeps_pending_and_never_replays(self):
        with mock.patch.object(hook, "reply", side_effect=RuntimeError(TEXT)) as send:
            self.assertEqual(200, self.post([event()]).status_code)
            self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
            self.assertEqual(200, self.post([event()]).status_code)
        self.assertEqual(1, send.call_count)
        self.assertEqual(["unknown"] * 3, [r["reply_result"] for r in self.rows()])
        self.assertEqual([True, False, False], [r["event_failed"] for r in self.rows()])
        self.assertTrue(all(r["reply_lost"] and not r["retry_requested"] for r in self.rows()))
        self.assertFalse(flow.reply_accepted(conv, UID, EID))
        self.assertEqual(MESSAGES, flow.cached_reply(conv, UID, EID))

    def test_hint_write_error_after_acceptance_does_not_resend_or_claim_hint(self):
        import reply_hints
        messages = [{"type": "text", "text": "synthetic response"}, conv.shop_card()]
        with mock.patch.object(conv, "handle_ex", return_value=(messages, {})), \
                mock.patch.object(reply_hints, "_write", side_effect=OSError(TEXT)):
            response = self.post([event()])
        self.assertEqual(200, response.status_code)
        row = self.rows()[0]
        self.assertTrue(row["event_failed"])
        self.assertEqual("accepted", row["reply_result"])
        self.assertFalse(row["reply_lost"])
        self.assertTrue(flow.reply_accepted(conv, UID, EID))
        self.assertFalse(reply_hints.state_path(conv).exists())
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(1, self.reply_attempts)
        self.assertEqual("accepted_skipped", self.rows()[-1]["dedup"])

    def test_acceptance_storage_error_keeps_pending_to_prevent_duplicate(self):
        with mock.patch.object(flow, "mark_reply_accepted", side_effect=RuntimeError(TEXT)):
            self.assertEqual(200, self.post([event()]).status_code)
        self.assertTrue(self.rows()[0]["event_failed"])
        self.assertEqual("accepted", self.rows()[0]["reply_result"])
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(1, self.reply_attempts)
        self.assertEqual("unknown_skipped", self.rows()[-1]["dedup"])

    def test_unexpected_retry_budget_error_acks_lost_and_is_logged(self):
        import line_reply_state
        self.reply_error = urllib.error.URLError(ConnectionRefusedError("synthetic refusal"))
        with mock.patch.object(line_reply_state, "claim_retry", side_effect=RuntimeError(TEXT)):
            self.assertEqual(200, self.post([event()]).status_code)
        row = self.rows()[0]
        self.assertTrue(row["event_failed"])
        self.assertEqual("network", row["reply_failure"])
        self.assertTrue(row["reply_lost"])
        self.assertFalse(row["retry_requested"])

    def test_malformed_delivery_context_is_logged_without_losing_other_events(self):
        broken = event()
        broken["deliveryContext"] = [TEXT]
        self.assertEqual(200, self.post([broken, event(eid="valid-after-malformed")]).status_code)
        self.assertEqual(2, self.counts()["received"])
        self.assertEqual([True, False], [r["event_failed"] for r in self.rows()])
        self.assertEqual(1, self.reply_attempts)

    def test_handler_error_does_not_erase_another_events_bounded_retry(self):
        self.reply_error = urllib.error.URLError(ConnectionRefusedError("synthetic refusal"))
        with mock.patch.object(conv, "handle_ex", side_effect=[(MESSAGES, {}), RuntimeError(TEXT)]):
            self.assertEqual(503, self.post([event(), event(eid="broken-handler")]).status_code)
        self.assertEqual([True, False], [r["retry_requested"] for r in self.rows()])
        self.assertEqual([False, True], [r["event_failed"] for r in self.rows()])
        self.assertEqual([False, True], [r["reply_lost"] for r in self.rows()])
        self.assertTrue(all(r["http_status"] == 503 for r in self.rows()))
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertFalse(self.rows()[-1]["retry_requested"])

    def test_import_style_calls_do_not_write_without_explicit_switch(self):
        for value in ("", "off", "true", "1"):
            with mock.patch.dict(os.environ, {"LAUNDRY_LINE_EVENTS": value}):
                self.assertEqual(200, self.post([event(eid="switch-" + value)]).status_code)
        self.assertFalse(self.count_dir.exists())
        self.assertFalse(self.log_dir.exists())

    def test_unknown_is_acked_and_never_resends_cached_reply(self):
        for error in (TimeoutError("synthetic timeout"), urllib.error.URLError(TimeoutError("wrapped timeout"))):
            eid = type(error).__name__
            self.reply_error = error
            self.assertEqual(200, self.post([event(eid=eid)]).status_code)
            self.reply_error = None
            self.assertEqual(200, self.post([event(eid=eid, redelivered=True)]).status_code)
            self.assertEqual(200, self.post([event(eid=eid)]).status_code)
            self.assertFalse(flow.reply_accepted(conv, UID, eid))
            self.assertEqual(MESSAGES, flow.cached_reply(conv, UID, eid))
        self.assertEqual(2, self.reply_attempts)
        self.assertEqual([], self.sent)
        self.assertEqual(2, len(self.handler_calls))
        self.assertEqual(["new", "unknown_skipped", "unknown_skipped"] * 2, [r["dedup"] for r in self.rows()])
        self.assertTrue(all(r["reply_lost"] and r["reply_result"] == "unknown" for r in self.rows()))
        self.assertEqual(6, self.counts()["reply_lost"])
        self.assertEqual(4, self.counts()["duplicate_skipped"])
        markers = list((self.folder / "data" / "line-reply-state").iterdir())
        self.assertEqual(2, len(markers))
        for path in markers:
            self.assertRegex(path.name, r"^[0-9a-f]{64}\.pending$")
            self.assertEqual(b"1", path.read_bytes())

    def test_all_4xx_and_redelivery_failures_are_acked_and_lost(self):
        cases = [(False, code) for code in (400, 401, 403, 408, 409, 429)]
        cases += [(True, code) for code in (400, 429, 500, 503)]
        cases += [(True, None)]
        for i, (redelivered, code) in enumerate(cases):
            self.reply_error = (urllib.error.HTTPError("https://example.invalid", code, "synthetic refusal", {}, io.BytesIO(b'{}'))
                                if code else urllib.error.URLError(ConnectionRefusedError("synthetic refusal")))
            self.assertEqual(200, self.post([event(eid=f"terminal-{i}", redelivered=redelivered)]).status_code)
            row = self.rows()[-1]
            self.assertEqual("failed", row["reply_result"])
            self.assertTrue(row["reply_lost"])
            self.assertFalse(row["retry_requested"])
        self.assertEqual(len(cases), self.counts()["reply_lost"])

    def test_reset_after_send_is_unknown_and_never_retried(self):
        # A broken/reset connection can follow LINE accepting the request. It
        # cannot be classified like a definite pre-send connection refusal.
        for i, error in enumerate((ConnectionResetError("synthetic reset"),
                                    urllib.error.URLError(ConnectionResetError("wrapped reset")))):
            self.reply_error = error
            self.assertEqual(200, self.post([event(eid=f"reset-{i}")]).status_code)
            self.reply_error = None
            self.assertEqual(200, self.post([event(eid=f"reset-{i}", redelivered=True)]).status_code)
        self.assertEqual(2, self.reply_attempts)
        self.assertTrue(all(r["reply_result"] == "unknown" and r["reply_lost"] for r in self.rows()))

    def test_first_network_failure_requests_one_retry_then_acks_even_without_redelivery_flag(self):
        self.reply_error = urllib.error.URLError(ConnectionRefusedError("synthetic refusal"))
        self.assertEqual(503, self.post([event()]).status_code)
        self.assertTrue(self.rows()[0]["retry_requested"])
        self.assertFalse(self.rows()[0]["reply_lost"])
        self.assertEqual(0, self.counts()["reply_lost"])
        # Recreate module state: the allowance must survive a new process/import,
        # not merely a flag attached to the previous request.
        import importlib
        import line_reply_state
        importlib.reload(line_reply_state)
        for _ in range(2):
            self.assertEqual(200, self.post([event()]).status_code)
        self.assertEqual([False, True, True], [r["reply_lost"] for r in self.rows()])
        self.assertEqual(2, self.counts()["reply_lost"])
        self.assertEqual(1, len(self.handler_calls))
        self.assertEqual(3, self.reply_attempts)
        self.assertFalse(flow.reply_accepted(conv, UID, EID))
        self.assertEqual(MESSAGES, flow.cached_reply(conv, UID, EID))
        markers = list((self.folder / "data" / "line-reply-state").iterdir())
        self.assertEqual([self.rows()[0]["event_ref"] + ".retry"], [p.name for p in markers])
        self.assertEqual(b"1", markers[0].read_bytes())

    def test_first_line_5xx_retries_but_redelivery_400_is_lost(self):
        self.reply_error = urllib.error.HTTPError("https://example.invalid", 503, "synthetic outage", {}, io.BytesIO(b'{}'))
        self.assertEqual(503, self.post([event()]).status_code)
        self.reply_error = urllib.error.HTTPError("https://example.invalid", 400, "synthetic used token", {}, io.BytesIO(b'{}'))
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(["line_5xx", "line_4xx"], [r["reply_failure"] for r in self.rows()])
        self.assertEqual([False, True], [r["reply_lost"] for r in self.rows()])
        self.assertEqual(1, self.counts()["reply_lost"])
        self.assertFalse(flow.reply_accepted(conv, UID, EID))

    def test_retry_can_deliver_cached_reply_once_then_skips_accepted(self):
        self.reply_error = urllib.error.URLError(ConnectionRefusedError("synthetic refusal"))
        self.assertEqual(503, self.post([event()]).status_code)
        self.reply_error = None
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(200, self.post([event(redelivered=True)]).status_code)
        self.assertEqual(2, self.reply_attempts)
        self.assertEqual(1, len(self.sent))
        self.assertTrue(flow.reply_accepted(conv, UID, EID))
        self.assertEqual(0, self.counts()["reply_lost"])

    def test_empty_token_and_empty_messages_is_not_needed(self):
        self.assertEqual(200, self.post([event(token="", kind="postback", data="tab=prices")]).status_code)
        self.assertEqual("not_needed", self.rows()[0]["reply_result"])
        self.assertFalse(self.rows()[0]["reply_lost"])
        self.assertEqual(0, self.counts()["reply_lost"])
        self.assertEqual(1, self.counts()["no_reply_needed"])
        self.assertEqual(0, self.reply_attempts)

    def test_uncorrelated_failure_never_requests_unbounded_retry(self):
        self.reply_error = urllib.error.URLError(ConnectionRefusedError("synthetic refusal"))
        self.assertEqual(200, self.post([event(eid="")]).status_code)
        self.assertEqual("", self.rows()[0]["event_ref"])
        self.assertTrue(self.rows()[0]["reply_lost"])
        self.assertEqual(1, self.reply_attempts)

    def test_unknown_in_retrying_batch_is_not_resent_on_batch_redelivery(self):
        self.reply_error = [TimeoutError("synthetic timeout"), urllib.error.URLError(ConnectionRefusedError("synthetic refusal"))]
        self.assertEqual(503, self.post([event(), event(eid="retryable")]).status_code)
        self.reply_error = urllib.error.HTTPError("https://example.invalid", 400, "synthetic used token", {}, io.BytesIO(b'{}'))
        self.assertEqual(200, self.post([event(redelivered=True), event(eid="retryable", redelivered=True)]).status_code)
        self.assertEqual(3, self.reply_attempts)
        self.assertEqual([True, False, True, True], [r["reply_lost"] for r in self.rows()])
        self.assertEqual(3, self.counts()["reply_lost"])

    def test_r1_counter_state_adds_lost_without_resetting_previous_counts(self):
        self.assertEqual(200, self.post([event()]).status_code)
        for path in (self.count_dir / "2026-11-08.json", self.count_dir / ".state" / "2026-11-08.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            data.pop("reply_lost", None)
            path.write_text(json.dumps(data), encoding="utf-8")
        self.reply_error = urllib.error.HTTPError("https://example.invalid", 400, "synthetic refusal", {}, io.BytesIO(b'{}'))
        self.assertEqual(200, self.post([event(eid="after-upgrade")]).status_code)
        self.assertEqual(2, self.counts()["received"])
        self.assertEqual(1, self.counts()["replied_ok"])
        self.assertEqual(1, self.counts()["reply_lost"])

    def test_unavailable_reply_guard_acks_lost_without_sending(self):
        import line_reply_state
        with mock.patch.object(line_reply_state, "begin", side_effect=PermissionError("synthetic ACL")):
            self.assertEqual(200, self.post([event()]).status_code)
        self.assertEqual(0, self.reply_attempts)
        self.assertTrue(self.rows()[0]["reply_lost"])
        self.assertEqual("state_unavailable", self.rows()[0]["reply_failure"])
        self.assertFalse(flow.reply_accepted(conv, UID, EID))
        self.assertEqual(MESSAGES, flow.cached_reply(conv, UID, EID))

    def test_unavailable_retry_budget_acks_lost_instead_of_issuing_503(self):
        import line_reply_state
        self.reply_error = urllib.error.URLError(ConnectionRefusedError("synthetic refusal"))
        with mock.patch.object(line_reply_state, "claim_retry", side_effect=PermissionError("synthetic ACL")):
            self.assertEqual(200, self.post([event()]).status_code)
        self.assertEqual(1, self.reply_attempts)
        self.assertTrue(self.rows()[0]["reply_lost"])
        self.assertFalse(self.rows()[0]["retry_requested"])
        self.assertEqual(1, self.counts()["reply_lost"])


class AtomicMarkTests(unittest.TestCase):
    def test_parallel_marks_preserve_both_acceptances_and_remove_both_caches(self):
        barrier = threading.Barrier(2)

        class Sessions:
            _SESSION_LOCK = threading.RLock()

            def __init__(self):
                self.rows = {UID: {"estimate_replies": {"a": MESSAGES, "b": MESSAGES}}}
                self.readers = threading.local()

            def _load_sess(self):
                snapshot = copy.deepcopy(self.rows)
                if not getattr(self.readers, "seen", False):
                    self.readers.seen = True
                    # With the guard, the second read must wait for the first
                    # transaction. Without it, both reads meet and lose an update.
                    try:
                        barrier.wait(timeout=0.2)
                    except threading.BrokenBarrierError:
                        pass
                return snapshot

            def set_sess(self, uid, **values):
                with self._SESSION_LOCK:
                    self.rows.setdefault(uid, {}).update(copy.deepcopy(values))

        sessions = Sessions()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(flow.mark_reply_accepted, sessions, UID, eid) for eid in ("a", "b")]
            for future in futures:
                future.result(timeout=3)
        self.assertEqual({"a", "b"}, set(sessions.rows[UID]["estimate_reply_accepted"]))
        self.assertEqual({}, sessions.rows[UID]["estimate_replies"])


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp(prefix="line-ack-telemetry-"))
        self.addCleanup(shutil.rmtree, self.folder, True)

    def test_numeric_counts_and_exact_percentiles_survive_reload(self):
        rows = [{"reply_result": outcome, "duration_ms": duration, "redelivered": duration in (20, 30),
                 "dedup": "accepted_skipped" if duration == 50 else "new", "to_staff": duration == 40}
                for duration, outcome in zip((10, 20, 30, 40, 50), ("accepted", "failed", "unknown", "not_needed", "not_needed"))]
        day = datetime(2026, 11, 8, tzinfo=telemetry.TAIPEI).date()
        telemetry._count_events(self.folder, day, rows[:3])
        telemetry._count_events(self.folder, day, rows[3:])
        data = json.loads((self.folder / "2026-11-08.json").read_text(encoding="utf-8"))
        self.assertEqual([5, 1, 1, 1, 1, 2, 2, 1, 0], [data[k] for k in telemetry.COUNTERS])
        self.assertEqual([30, 50, 50], [data[k] for k in ("processing_ms_p50", "processing_ms_p95", "processing_ms_max")])
        self.assertEqual(set(telemetry.COUNTERS) | {"processing_ms_p50", "processing_ms_p95", "processing_ms_max"}, set(data))
        self.assertTrue(all(type(v) is int for v in data.values()))
        state = json.loads((self.folder / ".state" / "2026-11-08.json").read_text(encoding="utf-8"))
        self.assertEqual({str(n): 1 for n in (10, 20, 30, 40, 50)}, state["processing_ms_histogram"])

    def test_nested_stage_times_are_exclusive_and_context_is_reset(self):
        clock = [0.0]
        with mock.patch.object(telemetry.time, "perf_counter", lambda: clock[0]):
            trace = telemetry.RequestTrace(b"synthetic-key", self.folder)
            with trace.event(EID, "message"):
                clock[0] += 0.1
                with telemetry.measure("reply"):
                    clock[0] += 0.2
                    with telemetry.measure("storage"):
                        clock[0] += 0.3
                with telemetry.measure("staff_notify", to_staff=True):
                    clock[0] += 0.4
        row = trace.events[0]
        self.assertEqual(1000, row["duration_ms"])
        self.assertEqual(dict(processing=100, reply=200, storage=300, staff_notify=400), row["stages_ms"])
        self.assertTrue(row["to_staff"])
        self.assertIsNone(telemetry._CURRENT.get())

    def test_retention_keeps_fourteen_taipei_days_and_other_files(self):
        day = datetime(2026, 11, 8, tzinfo=telemetry.TAIPEI).date()
        for offset in range(16):
            (self.folder / f"line-events-{day-timedelta(days=offset)}.jsonl").write_text("", encoding="utf-8")
        unrelated = self.folder / "unrelated.jsonl"
        unrelated.write_text("keep", encoding="utf-8")
        telemetry._append_records(self.folder, day, [])
        self.assertEqual(14, len(list(self.folder.glob("line-events-*.jsonl"))))
        self.assertEqual("keep", unrelated.read_text(encoding="utf-8"))

    def test_receive_date_is_taipei_even_when_clock_is_utc(self):
        # Receive just before midnight UTC = next Taipei day. The wall clock may
        # be injected in UTC; the count/log filename must still use Taipei.
        moment = datetime(2026, 11, 8, 23, 30, tzinfo=timezone.utc)
        with mock.patch.object(telemetry, "now_taipei", return_value=moment), \
                mock.patch.dict(os.environ, {"LAUNDRY_LINE_EVENTS": "on", "LAUNDRY_LINE_EVENT_LOG_DIR": str(self.folder / "logs"),
                                            "LAUNDRY_LINE_EVENTS_DIR": str(self.folder / "counts")}):
            trace = telemetry.RequestTrace(b"synthetic-key", self.folder)
            with trace.event(EID, "message"):
                pass
            trace.finish(200)
        self.assertTrue((self.folder / "counts" / "2026-11-09.json").is_file())
        self.assertTrue((self.folder / "logs" / "line-events-2026-11-09.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
