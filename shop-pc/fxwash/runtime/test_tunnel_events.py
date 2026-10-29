"""Offline A4-2 regression tests; never read channel secrets or open a tunnel."""

from __future__ import annotations

import io
import json
import shutil
import sys
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import line_api, tunnel_supervisor as supervisor

OLD_URL = "https://old-test.lhr.life/line/webhook"
NEW_URL = "https://new-test.lhr.life/line/webhook"
API_URL = "https://api.line.me/v2/bot/channel/webhook/endpoint"


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class StopSupervisor(Exception):
    """End the otherwise infinite loop after one fake child process."""


class FakeProcess:
    def __init__(self, lines, rc=7):
        self.stdout = iter(lines)
        self.returncode = None
        self.rc = rc

    def poll(self):
        self.returncode = self.rc
        return self.rc

    def wait(self, timeout=None):
        self.returncode = self.rc
        return self.rc

    def terminate(self):
        self.returncode = self.rc

    def kill(self):
        self.returncode = self.rc


class TunnelEventsTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        # Python 3.14's Windows mode=0o700 temp directories are inaccessible to
        # this restricted runner. Use an ordinary, uniquely owned fixture dir.
        self.work = ROOT / "runtime" / (".a4-2-" + uuid4().hex)
        self.work.mkdir()
        self.stack.callback(shutil.rmtree, self.work)
        self.events_path = self.work / "logs" / "tunnel_events.jsonl"
        self.shop_path = self.work / "shop.json"
        self.shop_path.write_text('{"server": {}}', encoding="utf-8")
        self.shop = SimpleNamespace(root=self.work)
        self.calls = []
        self.put_urls = []
        self.expected_put_urls = []
        self.responses = []
        self.stack.enter_context(patch.object(supervisor, "EVENTS_PATH", self.events_path, create=True))
        self.stack.enter_context(patch.object(supervisor, "SHOP_PATH", self.shop_path))
        self.stack.enter_context(patch.object(supervisor, "load_shop", return_value=self.shop))
        self.stack.enter_context(patch.object(line_api, "channel_credentials", return_value={"token": "offline-token", "secret": "offline-secret"}))
        self.stack.enter_context(patch.object(supervisor, "urlopen", side_effect=self.open_url, create=True))
        # Guard the old implementation's default-bound openers during RED too.
        for helper in (line_api.set_webhook, line_api.get_webhook, line_api.test_webhook):
            self.stack.enter_context(patch.dict(helper.__kwdefaults__, {"opener": self.open_url}))
        self.sleep = self.stack.enter_context(patch.object(supervisor.time, "sleep"))
        self.stack.enter_context(redirect_stdout(io.StringIO()))

    def open_url(self, request, timeout):
        method = request.get_method()
        if request.full_url.endswith("/test"):
            self.assertEqual("POST", method)
            return FakeResponse({"success": True, "statusCode": 200, "reason": "OK"})
        self.assertEqual(API_URL, request.full_url)
        self.calls.append(method)
        if method == "PUT":
            endpoint = self.expected_put_urls.pop(0) if self.expected_put_urls else NEW_URL
            self.assertEqual({"endpoint": endpoint}, json.loads(request.data))
            self.put_urls.append(endpoint)
            # The pre-PUT audit must already be on disk, not buffered until success.
            self.assertEqual("put_start", self.read_events()[-1]["event"])
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def read_events(self):
        if not self.events_path.exists():
            return []
        return [json.loads(line) for line in self.events_path.read_text(encoding="utf-8").splitlines()]

    def register(self):
        register = getattr(supervisor, "register_webhook", None)
        self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
        return register(self.shop, OLD_URL, NEW_URL)

    def test_success_audits_put_before_after_and_get_match(self):
        self.responses = [FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.assertTrue(self.register())
        self.assertEqual(["PUT", "GET"], self.calls)
        records = self.read_events()
        self.assertEqual(["put_start", "put_result", "verify_result"], [r["event"] for r in records])
        self.assertEqual(200, records[1]["put_status"])
        self.assertEqual("match", records[-1]["verify_status"])
        for record in records:
            self.assertTrue({"ts", "old_url", "new_url", "put_status", "verify_status"} <= record.keys())
            self.assertIsNotNone(datetime.fromisoformat(record["ts"]).utcoffset())
            self.assertEqual((OLD_URL, NEW_URL), (record["old_url"], record["new_url"]))
        self.assertEqual([], self.sleep.call_args_list)

    def test_mismatch_retries_put_and_recovers(self):
        self.responses = [FakeResponse({}), FakeResponse({"endpoint": OLD_URL, "active": True}),
                          FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.assertTrue(self.register())
        self.assertEqual(["PUT", "GET", "PUT", "GET"], self.calls)
        self.assertEqual([2], [c.args[0] for c in self.sleep.call_args_list])
        checks = [r["verify_status"] for r in self.read_events() if r["event"] == "verify_result"]
        self.assertEqual(["mismatch", "match"], checks)

    def test_persistent_mismatch_stops_after_three_retries(self):
        self.responses = [response for _ in range(4) for response in
                          (FakeResponse({}), FakeResponse({"endpoint": OLD_URL, "active": True}))]
        self.assertFalse(self.register())
        self.assertEqual(["PUT", "GET"] * 4, self.calls)
        self.assertEqual([2, 5, 10], [c.args[0] for c in self.sleep.call_args_list])
        self.assertEqual("mismatch", self.read_events()[-1]["verify_status"])
        self.assertEqual(4, self.read_events()[-1]["attempt"])

    def test_get_http_error_is_not_match_and_can_recover(self):
        error = HTTPError(API_URL, 503, "unavailable", {}, io.BytesIO(b"private response"))
        self.responses = [FakeResponse({}), error, FakeResponse({}),
                          FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.assertTrue(self.register())
        records = self.read_events()
        self.assertEqual("error", records[2]["verify_status"])
        self.assertEqual("match", records[-1]["verify_status"])
        self.assertNotIn("private response", self.events_path.read_text(encoding="utf-8"))

    def test_http_error_response_streams_are_closed(self):
        body = io.BytesIO(b"private response")
        self.responses = [FakeResponse({}), HTTPError(API_URL, 503, "unavailable", {}, body),
                          FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.assertTrue(self.register())
        self.assertTrue(body.closed, "Failed GET response must not leak an open stream")

    def test_put_http_failure_records_response_code_without_get(self):
        self.responses = [HTTPError(API_URL, 403, "forbidden", {}, None) for _ in range(4)]
        self.assertFalse(self.register())
        self.assertEqual(["PUT"] * 4, self.calls)
        results = [r for r in self.read_events() if r["event"] == "put_result"]
        self.assertEqual([403] * 4, [r["put_status"] for r in results])
        self.assertEqual("not_run", results[-1]["verify_status"])

    def test_transport_failure_does_not_invent_http_status(self):
        self.responses = [URLError("offline-token must not leak") for _ in range(4)]
        self.assertFalse(self.register())
        self.assertEqual("error", self.read_events()[-1]["put_status"])
        self.assertNotIn("offline-token", self.events_path.read_text(encoding="utf-8"))

    def test_missing_endpoint_is_mismatch(self):
        self.responses = [response for _ in range(4) for response in
                          (FakeResponse({}), FakeResponse({"active": False}))]
        self.assertFalse(self.register())
        self.assertEqual("mismatch", self.read_events()[-1]["verify_status"])

    def run_one_tunnel(self, lines, rc=7):
        def stop_after_exit(seconds):
            if seconds == 3:
                raise StopSupervisor()
        self.sleep.side_effect = stop_after_exit
        with patch.object(supervisor, "find_ssh", return_value="offline-ssh"), \
             patch.object(supervisor.subprocess, "Popen", return_value=FakeProcess(lines, rc)), \
             patch.object(supervisor.time, "monotonic", side_effect=[100.0, 112.5]):
            with self.assertRaises(StopSupervisor):
                supervisor.run_supervisor()

    def test_detected_url_is_recorded_and_duplicate_is_not_registered_again(self):
        self.responses = [FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.run_one_tunnel([NEW_URL + "\n", NEW_URL + "\n"])
        records = self.read_events()
        detected = [r for r in records if r["event"] == "url_detected"]
        self.assertEqual(1, len(detected))
        self.assertEqual("", detected[0]["old_url"])
        self.assertEqual(NEW_URL, detected[0]["new_url"])
        self.assertEqual(["PUT", "GET"], self.calls)

    def test_second_detected_url_keeps_the_previous_url(self):
        self.expected_put_urls = [OLD_URL, NEW_URL]
        self.responses = [FakeResponse({}), FakeResponse({"endpoint": OLD_URL, "active": True}),
                          FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.run_one_tunnel([OLD_URL + "\n", NEW_URL + "\n"])
        detected = [r for r in self.read_events() if r["event"] == "url_detected"]
        self.assertEqual([("", OLD_URL), (OLD_URL, NEW_URL)],
                         [(r["old_url"], r["new_url"]) for r in detected])
        self.assertEqual([OLD_URL, NEW_URL], self.put_urls)

    def test_tunnel_exit_records_return_code_and_elapsed_seconds(self):
        self.run_one_tunnel([], rc=23)
        records = self.read_events()
        self.assertEqual(1, len(records), "Child exit must leave a JSONL event")
        self.assertEqual("tunnel_exit", records[0]["event"])
        self.assertEqual(23, records[0]["rc"])
        self.assertEqual(12.5, records[0]["alive_seconds"])


if __name__ == "__main__":
    unittest.main()
