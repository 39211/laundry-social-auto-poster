"""Offline tests for the B2 attribution hook in webhook_server.py.

No network, no LINE, no MDB, no live log files: the module is loaded the same way
test_webhook_log_ts.py loads it, the routing functions are replaced with fakes and
every shop file lives in a temporary directory.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib.util
import io
import json
import re
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "runtime"
for _p in (ROOT, RUNTIME):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import attribution_service  # noqa: E402  (top-level module, runtime dir on sys.path)

CHANNEL_SECRET = "test-channel-secret-not-real"
ACCESS_TOKEN = "test-access-token-not-real"
USER_ID = "U" + "a" * 32
HMAC_HEX = "5a" * 32  # 32-byte test key, hex encoded
REG_CODE = "SXJ-261030-S1"
UNREG_CODE = "SXJ-261031-S2"
PLAIN = "wash my coat please"
PHONE = "0912345678"
ON_CFG = {
    "enabled": True,
    "secret_path": "secrets/attribution_hmac.key",
    "registry_path": "data/attribution/source-codes.json",
}
REQUEST_LOG = "[Webhook] POST /line/webhook HTTP/1.1 - 200\n"
_MISSING = object()
_ATTR_KEYS = ("attribution_service", "runtime.attribution_service")


def load_webhook(name, block_attribution=False):
    """Load webhook_server.py without starting a server or writing live logs."""
    spec = importlib.util.spec_from_file_location(name, RUNTIME / "webhook_server.py")
    module = importlib.util.module_from_spec(spec)
    saved = {k: sys.modules.get(k, _MISSING) for k in _ATTR_KEYS}
    try:
        if block_attribution:
            for key in _ATTR_KEYS:
                sys.modules[key] = None  # makes "import key" raise ImportError
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "stdout", io.StringIO()))
            stack.enter_context(patch.object(sys, "stderr", io.StringIO()))
            stack.enter_context(patch("pathlib.Path.mkdir"))
            stack.enter_context(patch("builtins.open", return_value=io.StringIO()))
            server = stack.enter_context(patch("http.server.ThreadingHTTPServer"))
            spec.loader.exec_module(module)
            server.assert_not_called()
    finally:
        if block_attribution:
            for key, value in saved.items():
                if value is _MISSING:
                    sys.modules.pop(key, None)
                else:
                    sys.modules[key] = value
    return module


def sign(body, secret=CHANNEL_SECRET):
    return base64.b64encode(hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()).decode("ascii")


def status_line(resp):
    return resp.split(b"\r\n", 1)[0]


def without_date(resp):
    return b"\r\n".join(line for line in resp.split(b"\r\n") if not line.startswith(b"Date:"))


class WebhookAttributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_webhook("b2_5_webhook_under_test")

    def setUp(self):
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.data_dir = self.root / "data"
        self.calls = []
        self.n = 0
        self.cid_result = "34"
        self.ledger = None
        self.startup_err = ""
        self.install_fakes(self.module)

    # -- fakes ------------------------------------------------------------------

    def install_fakes(self, module):
        fakes = {
            "ROOT": self.root,
            "extract_phone": self.fake_extract_phone,
            "lookup_by_phone": self.fake_lookup_by_phone,
            "lookup_by_customer_id": self.fake_lookup_by_customer_id,
            "format_screenshot3_text": self.fake_format,
            "generate_chat_reply": self.fake_chat,
            "reply_message": self.fake_reply,
            "download_line_image": self.fake_download,
            "build_photo_quote_reply": self.fake_photo,
        }
        for name, value in fakes.items():
            patcher = patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def fake_extract_phone(self, text):
        self.calls.append(("extract_phone", text))
        return text if re.fullmatch(r"09[0-9]{8}", text) else None

    def fake_lookup_by_phone(self, connector, phone):
        self.calls.append(("lookup_by_phone", phone))
        return {"customer_id": self.cid_result, "customer_name": "Test Name", "customer_phone": phone}

    def fake_lookup_by_customer_id(self, connector, cid):
        self.calls.append(("lookup_by_customer_id", cid))
        return {"customer_id": self.cid_result, "customer_name": "Test Name", "customer_phone": ""}

    def fake_format(self, lookup_res, label):
        return "formatted:" + label

    def fake_chat(self, text, root, user_id):
        self.calls.append(("chat", text))
        return "chat-reply"

    def fake_reply(self, reply_token, messages, token):
        self.calls.append(("reply", reply_token, messages))
        return True

    def fake_download(self, msg_id, token):
        self.calls.append(("download", msg_id))
        return None

    def fake_photo(self, image_bytes, root, user_id=""):
        return [{"type": "text", "text": "photo-reply"}]

    # -- setup helpers ----------------------------------------------------------

    def configure(self, attribution=_MISSING, secret=None, registry=True):
        cfg = {"shop_name": "offline-test"}
        if attribution is not _MISSING:
            cfg["attribution"] = attribution
        (self.root / "shop.json").write_text(json.dumps(cfg), encoding="utf-8")
        if secret is not None:
            key = self.root / "secrets" / "attribution_hmac.key"
            key.parent.mkdir(parents=True, exist_ok=True)
            key.write_text(secret, encoding="ascii")
        if registry:
            reg = self.root / "data" / "attribution" / "source-codes.json"
            reg.parent.mkdir(parents=True, exist_ok=True)
            doc = {"schema_version": 1, "registry_version": "r1",
                   "entries": [{"source_code": REG_CODE, "content_id": "c1", "kind": "daily"}]}
            reg.write_text(json.dumps(doc), encoding="utf-8")

    def build(self, module=None):
        module = module or self.module
        shop = types.SimpleNamespace(root=self.root)
        creds = {"secret": CHANNEL_SECRET, "token": ACCESS_TOKEN}
        out, err = io.StringIO(), io.StringIO()
        captured = {}
        real_init = module.init_attribution
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "stdout", out))
            stack.enter_context(patch.object(sys, "stderr", err))
            if real_init is not None:
                def spy(root, cfg):
                    ledger, registry = real_init(root, cfg)
                    captured["ledger"] = ledger
                    return ledger, registry
                stack.enter_context(patch.object(module, "init_attribution", spy))
            handler_cls = module.make_request_handler(shop, object(), creds)
        self.ledger = captured.get("ledger")
        self.startup_err = err.getvalue()
        self.assertEqual("", out.getvalue())
        return handler_cls

    def build_on(self):
        self.configure(attribution=ON_CFG, secret=HMAC_HEX)
        handler_cls = self.build()
        self.assertIsNotNone(self.ledger)
        self.assertEqual("", self.startup_err)
        return handler_cls

    def text_event(self, text, source=None, msg_type="text"):
        self.n += 1
        message = {"type": msg_type, "id": "46878957789826%04d" % self.n}
        if msg_type == "text":
            message["text"] = text
            message["quoteToken"] = "q-test"
        return {
            "type": "message",
            "mode": "active",
            "webhookEventId": "01TESTEVENT%04d" % self.n,
            "timestamp": 1793000000000 + self.n,
            "replyToken": "rt%030d" % self.n,
            "source": source or {"type": "user", "userId": USER_ID},
            "deliveryContext": {"isRedelivery": False},
            "message": message,
        }

    def body(self, events):
        return json.dumps({"destination": "Udestination", "events": events}, ensure_ascii=False).encode("utf-8")

    def new_request(self, handler_cls, body, signature=None):
        h = handler_cls.__new__(handler_cls)
        h.headers = {"Content-Length": str(len(body)),
                     "X-Line-Signature": sign(body) if signature is None else signature}
        h.rfile = io.BytesIO(body)
        h.wfile = io.BytesIO()
        h.request_version = "HTTP/1.1"
        h.requestline = "POST /line/webhook HTTP/1.1"
        h.command = "POST"
        h.path = "/line/webhook"
        h.client_address = ("127.0.0.1", 50000)
        h.close_connection = True
        return h

    def run_request(self, h):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(sys, "stdout", out), patch.object(sys, "stderr", err):
            h.do_POST()
        return h.wfile.getvalue(), out.getvalue(), err.getvalue()

    def post(self, handler_cls, events, signature=None):
        return self.run_request(self.new_request(handler_cls, self.body(events), signature))

    def ledger_path(self):
        return self.data_dir / "inquiries.jsonl"

    def rows(self):
        path = self.ledger_path()
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def chat_texts(self):
        return [c[1] for c in self.calls if c[0] == "chat"]

    def assert_ok_200(self, resp):
        self.assertEqual(b"HTTP/1.0 200 OK", status_line(resp))
        self.assertTrue(resp.endswith(b"\r\n\r\nOK"))

    def assert_off_unchanged(self, handler_cls):
        text = REG_CODE + " " + PLAIN
        resp, out, err = self.post(handler_cls, [self.text_event("  " + text + "  ")])
        self.assert_ok_200(resp)
        self.assertEqual("[Webhook Text] User %s...: '%s'\n" % (USER_ID[:8], text), out)
        self.assertEqual(REQUEST_LOG, err)
        self.assertEqual([text], self.chat_texts())
        self.assertEqual([("extract_phone", text)], [c for c in self.calls if c[0] == "extract_phone"])
        self.assertFalse(self.ledger_path().exists())
        self.assertFalse((self.data_dir / "inquiries.jsonl.lock").exists())

    # -- OFF ----------------------------------------------------------------------

    def test_guard_imported_real_service(self):
        self.assertIsNotNone(self.module.init_attribution)
        self.assertIsNotNone(self.module.extract_source)
        self.assertTrue(callable(attribution_service.init_attribution))

    def test_off_no_attribution_key(self):
        self.configure(secret=HMAC_HEX)
        handler_cls = self.build()
        self.assertIsNone(self.ledger)
        self.assertEqual("[ATTRIBUTION_DISABLED] not configured\n", self.startup_err)
        self.assert_off_unchanged(handler_cls)

    def test_off_enabled_not_true(self):
        self.configure(attribution=dict(ON_CFG, enabled="true"), secret=HMAC_HEX)
        handler_cls = self.build()
        self.assertIsNone(self.ledger)
        self.assertEqual("[ATTRIBUTION_DISABLED] not configured\n", self.startup_err)
        self.assert_off_unchanged(handler_cls)

    def test_off_missing_secret(self):
        self.configure(attribution=ON_CFG)
        handler_cls = self.build()
        self.assertIsNone(self.ledger)
        self.assertEqual("[ATTRIBUTION_DISABLED] no hmac secret\n", self.startup_err)
        self.assert_off_unchanged(handler_cls)

    def test_off_short_secret(self):
        self.configure(attribution=ON_CFG, secret="abcd")
        handler_cls = self.build()
        self.assertIsNone(self.ledger)
        self.assertEqual("[ATTRIBUTION_DISABLED] invalid hmac secret\n", self.startup_err)
        self.assert_off_unchanged(handler_cls)

    def test_off_guard_patched_to_none(self):
        self.configure(attribution=ON_CFG, secret=HMAC_HEX)
        with patch.object(self.module, "init_attribution", None), patch.object(self.module, "extract_source", None):
            handler_cls = self.build()
            self.assertEqual("[ATTRIBUTION_DISABLED] module unavailable\n", self.startup_err)
            self.assert_off_unchanged(handler_cls)

    def test_off_real_import_failure(self):
        blocked = load_webhook("b2_5_webhook_blocked", block_attribution=True)
        self.assertIsNone(blocked.init_attribution)
        self.assertIsNone(blocked.extract_source)
        self.install_fakes(blocked)
        self.configure(attribution=ON_CFG, secret=HMAC_HEX)
        handler_cls = self.build(blocked)
        self.assertEqual("[ATTRIBUTION_DISABLED] module unavailable\n", self.startup_err)
        self.assert_off_unchanged(handler_cls)

    # -- ON -----------------------------------------------------------------------

    def test_on_registered_code_recorded_and_stripped(self):
        handler_cls = self.build_on()
        resp, out, err = self.post(handler_cls, [self.text_event(REG_CODE + " " + PLAIN)])
        self.assert_ok_200(resp)
        self.assertEqual([PLAIN], self.chat_texts())
        self.assertEqual(REQUEST_LOG, err)
        rows = self.rows()
        self.assertEqual(1, len(rows))
        row = rows[0]
        self.assertEqual("message_observed", row["event_kind"])
        self.assertEqual("ok", row["source_status"])
        self.assertEqual(REG_CODE, row["source_code"])
        self.assertEqual("r1", row["source_registry_version"])
        self.assertEqual("fxwash-line-oa:01TESTEVENT0001", row["event_id"])

    def test_on_unregistered_code_keeps_text(self):
        handler_cls = self.build_on()
        text = UNREG_CODE + " " + PLAIN
        resp, _, _ = self.post(handler_cls, [self.text_event(text)])
        self.assert_ok_200(resp)
        self.assertEqual([text], self.chat_texts())
        rows = self.rows()
        self.assertEqual(1, len(rows))
        self.assertEqual("unknown_unregistered_code", rows[0]["source_status"])
        self.assertIsNone(rows[0]["source_code"])

    def test_on_code_only_message_keeps_raw_text(self):
        handler_cls = self.build_on()
        self.post(handler_cls, [self.text_event(REG_CODE)])
        self.assertEqual([REG_CODE], self.chat_texts())
        self.assertEqual("ok", self.rows()[0]["source_status"])

    def test_on_plain_message_identical_to_off(self):
        event = self.text_event(PLAIN)
        self.configure()
        off = self.post(self.build(), [event])
        off_calls = list(self.calls)
        self.calls.clear()
        on = self.post(self.build_on(), [event])
        self.assertEqual(without_date(off[0]), without_date(on[0]))
        self.assertEqual(off[1:], on[1:])
        self.assertEqual(off_calls, self.calls)
        self.assertEqual("unknown_no_code", self.rows()[0]["source_status"])

    def test_on_only_the_coded_event_is_stripped(self):
        handler_cls = self.build_on()
        self.post(handler_cls, [self.text_event(REG_CODE + " " + PLAIN), self.text_event(PLAIN + " again")])
        self.assertEqual([PLAIN, PLAIN + " again"], self.chat_texts())
        self.assertEqual(["ok", "unknown_no_code"], [r["source_status"] for r in self.rows()])

    def test_on_ledger_raises_still_200_and_routing_unchanged(self):
        handler_cls = self.build_on()
        with patch.object(self.ledger, "record_message", side_effect=RuntimeError("boom secret text")):
            resp, _, err = self.post(handler_cls, [self.text_event(PLAIN)])
        self.assert_ok_200(resp)
        self.assertEqual([PLAIN], self.chat_texts())
        self.assertEqual("[ATTRIBUTION_ERROR] RuntimeError\n" + REQUEST_LOG, err)
        self.assertEqual([], self.rows())

    def test_on_extract_source_raises_keeps_raw_text(self):
        handler_cls = self.build_on()
        text = REG_CODE + " " + PLAIN
        with patch.object(self.module, "extract_source", side_effect=ValueError("x")):
            resp, _, err = self.post(handler_cls, [self.text_event(text)])
        self.assert_ok_200(resp)
        self.assertEqual([text], self.chat_texts())
        self.assertIn("[ATTRIBUTION_ERROR] ValueError\n", err)

    def test_on_recorded_before_200_is_written(self):
        handler_cls = self.build_on()
        h = self.new_request(handler_cls, self.body([self.text_event(REG_CODE + " " + PLAIN)]))
        real = self.ledger.record_message
        seen = []

        def spy(*args, **kwargs):
            seen.append(h.wfile.getvalue())
            return real(*args, **kwargs)

        with patch.object(self.ledger, "record_message", spy):
            resp, _, _ = self.run_request(h)
        self.assertEqual([b""], seen)
        self.assert_ok_200(resp)
        self.assertEqual(1, len(self.rows()))

    def test_invalid_signature_no_row_no_routing(self):
        handler_cls = self.build_on()
        resp, out, _ = self.post(handler_cls, [self.text_event(REG_CODE + " " + PLAIN)], signature="bad")
        self.assertEqual(b"HTTP/1.0 400 Bad Request", status_line(resp))
        self.assertTrue(resp.endswith(b"Invalid signature"))
        self.assertEqual("", out)
        self.assertEqual([], self.calls)
        self.assertFalse(self.ledger_path().exists())

    def test_group_event_no_row(self):
        handler_cls = self.build_on()
        source = {"type": "group", "groupId": "C" + "b" * 32, "userId": USER_ID}
        resp, _, _ = self.post(handler_cls, [self.text_event(REG_CODE + " " + PLAIN, source=source)])
        self.assert_ok_200(resp)
        self.assertEqual(1, len([c for c in self.calls if c[0] == "reply"]))
        self.assertFalse(self.ledger_path().exists())

    def test_image_event_recorded_without_code(self):
        handler_cls = self.build_on()
        resp, _, _ = self.post(handler_cls, [self.text_event("", msg_type="image")])
        self.assert_ok_200(resp)
        rows = self.rows()
        self.assertEqual(["image"], [r["message_type"] for r in rows])
        self.assertEqual("unknown_no_code", rows[0]["source_status"])

    def test_binding_phone_lookup_row(self):
        handler_cls = self.build_on()
        self.post(handler_cls, [self.text_event(PHONE)])
        rows = self.rows()
        self.assertEqual(["message_observed", "binding_observed"], [r["event_kind"] for r in rows])
        binding = rows[1]
        self.assertEqual("phone_lookup", binding["binding_basis"])
        self.assertEqual("single", binding["identity_status"])
        expected = hmac.new(bytes.fromhex(HMAC_HEX), b"34", hashlib.sha256).hexdigest()
        self.assertEqual(expected, binding["cid_key"])
        self.assertEqual(rows[0]["user_key"], binding["user_key"])
        self.assertIn(USER_ID, json.loads((self.data_dir / "customer_bindings.json").read_text(encoding="utf-8")))

    def test_binding_cid_lookup_row(self):
        handler_cls = self.build_on()
        self.post(handler_cls, [self.text_event("#34")])
        binding = [r for r in self.rows() if r["event_kind"] == "binding_observed"]
        self.assertEqual(1, len(binding))
        self.assertEqual("cid_lookup", binding[0]["binding_basis"])

    def test_binding_composite_cid_is_ambiguous(self):
        self.cid_result = "12/34"
        handler_cls = self.build_on()
        self.post(handler_cls, [self.text_event("#12")])
        binding = [r for r in self.rows() if r["event_kind"] == "binding_observed"][0]
        self.assertEqual("identity_ambiguous", binding["identity_status"])
        self.assertIsNone(binding["cid_key"])

    def test_binding_hook_raises_reply_unchanged(self):
        handler_cls = self.build_on()
        with patch.object(self.ledger, "record_binding_observed", side_effect=OSError("disk")):
            resp, _, err = self.post(handler_cls, [self.text_event(PHONE)])
        self.assert_ok_200(resp)
        replies = [c for c in self.calls if c[0] == "reply"]
        self.assertEqual([[{"type": "text", "text": "formatted:" + PHONE}]], [c[2] for c in replies])
        self.assertIn("[ATTRIBUTION_ERROR] OSError\n", err)
        self.assertEqual(["message_observed"], [r["event_kind"] for r in self.rows()])

    def test_no_raw_identifiers_or_text_in_ledger(self):
        handler_cls = self.build_on()
        self.post(handler_cls, [self.text_event(REG_CODE + " " + PLAIN), self.text_event(PHONE)])
        raw = self.ledger_path().read_text(encoding="utf-8")
        self.assertEqual(3, len(self.rows()))
        for secret in (USER_ID, PLAIN, PHONE, "Test Name", "468789577898260001", HMAC_HEX, CHANNEL_SECRET):
            self.assertNotIn(secret, raw)


if __name__ == "__main__":
    unittest.main()