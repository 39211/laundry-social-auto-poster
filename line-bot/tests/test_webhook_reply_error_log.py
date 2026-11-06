# -*- coding: utf-8 -*-
"""A-WEBHOOK-5: a refused LINE reply logs LINE's own reason (not our text, not tokens), and a
redelivered event is marked in the log. Reply behaviour (True/False) is unchanged. No network."""
import importlib.util
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_webhook_reply_first import LINE_BOT, _HookBase, _text_event  # noqa: E402

SECRET_TOKEN = "test-token"  # the channel token _HookBase writes into secrets/
REPLY_TOKEN = "rt-SECRET-REPLY-TOKEN-123"


def _http_error(code, body):
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    return urllib.error.HTTPError("https://api.line.me/v2/bot/message/reply", code, "Bad Request", {}, io.BytesIO(raw))


class ReplyErrorLogTest(_HookBase):
    def real_module(self):
        spec = importlib.util.spec_from_file_location("line_webhook_real", LINE_BOT / "line_webhook.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["line_webhook_real"] = mod
        self.addCleanup(sys.modules.pop, "line_webhook_real", None)
        spec.loader.exec_module(mod)
        return mod

    def call_reply(self, exc):
        mod = self.real_module()
        err = io.StringIO()
        with mock.patch.object(mod.urllib.request, "urlopen", side_effect=exc), mock.patch.object(sys, "stderr", err):
            ok = mod.reply(REPLY_TOKEN, [{"type": "text", "text": "private customer wording"}])
        return ok, err.getvalue()

    def test_logs_line_reason_for_invalid_reply_token(self):
        ok, log = self.call_reply(_http_error(400, {"message": "Invalid reply token"}))
        self.assertIs(ok, False)
        self.assertIn("reply error:", log)
        self.assertIn("HTTP Error 400", log)
        self.assertIn("Invalid reply token", log)

    def test_logs_field_path_and_reason_for_payload_errors_only_three(self):
        details = [{"message": "Length must be between 1 and 5000", "property": "messages[%d].text" % i} for i in range(5)]
        ok, log = self.call_reply(_http_error(400, {"message": "The request body has 5 error(s)", "details": details}))
        self.assertIs(ok, False)
        self.assertIn("messages[0].text: Length must be between 1 and 5000", log)
        self.assertIn("messages[2].text", log)
        self.assertNotIn("messages[3].text", log)

    def test_never_logs_our_text_tokens_or_unknown_body_fields(self):
        body = {"message": "Invalid reply token", "echo": "private customer wording", "token": SECRET_TOKEN + REPLY_TOKEN}
        ok, log = self.call_reply(_http_error(400, body))
        self.assertIs(ok, False)
        self.assertNotIn("private customer wording", log)
        self.assertNotIn(REPLY_TOKEN, log)
        self.assertNotIn(SECRET_TOKEN, log)

    def test_long_reason_is_truncated(self):
        ok, log = self.call_reply(_http_error(400, {"message": "x" * 3000}))
        self.assertIs(ok, False)
        self.assertLess(len(log), 400)
        self.assertIn("x" * 120, log)
        self.assertNotIn("x" * 121, log)

    def test_unreadable_body_keeps_the_old_line(self):
        ok, log = self.call_reply(_http_error(400, b"<html>not json</html>"))
        self.assertIs(ok, False)
        self.assertEqual(log.strip(), "reply error: HTTP Error 400: Bad Request")

    def test_non_json_object_body_keeps_the_old_line(self):
        ok, log = self.call_reply(_http_error(400, [1, 2, 3]))
        self.assertIs(ok, False)
        self.assertEqual(log.strip(), "reply error: HTTP Error 400: Bad Request")

    def test_network_error_keeps_the_old_line(self):
        ok, log = self.call_reply(urllib.error.URLError("timed out"))
        self.assertIs(ok, False)
        self.assertEqual(log.strip(), "reply error: <urlopen error timed out>")

    def test_success_is_still_true_and_silent(self):
        mod = self.real_module()
        err = io.StringIO()
        with mock.patch.object(mod.urllib.request, "urlopen", return_value=mock.MagicMock()), mock.patch.object(sys, "stderr", err):
            ok = mod.reply(REPLY_TOKEN, [{"type": "text", "text": "hi"}])
        self.assertIs(ok, True)
        self.assertEqual(err.getvalue(), "")

    def test_empty_token_or_messages_do_not_call_line(self):
        mod = self.real_module()
        with mock.patch.object(mod.urllib.request, "urlopen") as op:
            self.assertTrue(mod.reply("", [{"type": "text", "text": "x"}]))
            self.assertTrue(mod.reply(REPLY_TOKEN, []))
        op.assert_not_called()


class RedeliveryLogTest(_HookBase):
    def post_logged(self, events):
        err = io.StringIO()
        with mock.patch.object(sys, "stderr", err):
            resp = self.post(events)
        return resp, err.getvalue()

    def test_redelivered_event_is_marked(self):
        ev = _text_event("Utest0001", "ev1", "hello")
        ev["deliveryContext"] = {"isRedelivery": True}
        resp, log = self.post_logged([ev])
        self.assertEqual(resp.status_code, 200)
        self.assertIn("redelivery: message", log)
        self.assertNotIn("hello", log)

    def test_normal_event_is_not_marked(self):
        ev = _text_event("Utest0001", "ev1", "hello")
        ev["deliveryContext"] = {"isRedelivery": False}
        resp, log = self.post_logged([ev, _text_event("Utest0002", "ev2", "hi")])
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("redelivery", log)

    def test_redelivered_event_is_still_answered(self):
        ev = _text_event("Utest0001", "ev1", "hello")
        ev["deliveryContext"] = {"isRedelivery": True}
        self.post_logged([ev])
        self.assertEqual([c[1] for c in self.calls if c[0] == "reply"], ["rt-ev1"])


if __name__ == "__main__":
    unittest.main()
