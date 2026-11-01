"""Offline A4-2/A4-4 regression tests; never read channel secrets or open a tunnel."""

from __future__ import annotations

import io
import json
import shutil
import sys
import threading
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import datetime, timedelta, timezone
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
DEFAULTS = {"day_start": "10:00", "day_end": "20:00", "tz": "Asia/Taipei"}
TZ8 = timezone(timedelta(hours=8))


def at(hour, minute, day=1, second=0):
    return datetime(2025, 6, day, hour, minute, second, tzinfo=TZ8)


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
        self.http = []
        self.put_urls = []
        self.expected_put_urls = []
        self.responses = []
        self.day = True
        self.stack.enter_context(patch.object(supervisor, "EVENTS_PATH", self.events_path, create=True))
        self.stack.enter_context(patch.object(supervisor, "SHOP_PATH", self.shop_path))
        self.stack.enter_context(patch.object(supervisor, "load_shop", return_value=self.shop))
        self.stack.enter_context(patch.object(supervisor, "DAY_CHECK_INTERVAL", 0))
        self.stack.enter_context(patch.object(line_api, "channel_credentials", return_value={"token": "offline-token", "secret": "offline-secret"}))
        self.stack.enter_context(patch.object(supervisor, "urlopen", side_effect=self.open_url, create=True))
        # Guard the old implementation's default-bound openers during RED too.
        for helper in (line_api.set_webhook, line_api.get_webhook, line_api.test_webhook):
            self.stack.enter_context(patch.dict(helper.__kwdefaults__, {"opener": self.open_url}))
        self.sleep = self.stack.enter_context(patch.object(supervisor.time, "sleep"))
        self.stack.enter_context(redirect_stdout(io.StringIO()))

    def open_url(self, request, timeout):
        method = request.get_method()
        self.http.append((method, request.full_url))
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

        def fake_window(now=None, config=None):
            # Deterministic window regardless of the wall clock running the tests.
            return self.day

        self.sleep.side_effect = stop_after_exit
        with patch.object(supervisor, "find_ssh", return_value="offline-ssh"), \
             patch.object(supervisor, "is_day_window", side_effect=fake_window), \
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

    # ------------------------------------------------------------------ A4-4

    def test_day_night_boundaries(self):
        window = supervisor.is_day_window
        self.assertFalse(window(at(9, 59, second=59), DEFAULTS))
        self.assertTrue(window(at(10, 0), DEFAULTS))
        self.assertTrue(window(at(19, 59, second=59), DEFAULTS))
        self.assertFalse(window(at(20, 0), DEFAULTS))
        self.assertFalse(window(at(0, 0), DEFAULTS))
        # Aware times in other zones are converted: 02:00 UTC == 10:00 Taipei.
        self.assertTrue(window(datetime(2025, 6, 1, 2, 0, tzinfo=timezone.utc), DEFAULTS))
        self.assertFalse(window(datetime(2025, 6, 1, 1, 59, tzinfo=timezone.utc), DEFAULTS))
        # Naive times are wall time in the configured zone.
        self.assertTrue(window(datetime(2025, 6, 1, 10, 0), DEFAULTS))

    def test_midnight_crossing_window(self):
        config = {"day_start": "22:00", "day_end": "06:00", "tz": "Asia/Taipei"}
        window = supervisor.is_day_window
        self.assertFalse(window(at(21, 59), config))
        self.assertTrue(window(at(22, 0), config))
        self.assertTrue(window(at(0, 30), config))
        self.assertTrue(window(at(5, 59), config))
        self.assertFalse(window(at(6, 0), config))
        self.assertFalse(window(at(12, 0), config))

    def test_invalid_handover_config_falls_back_to_defaults(self):
        variants = [
            {"day_start": "25:00", "day_end": "20:00", "tz": "Asia/Taipei"},
            "10:00-20:00",
            {},
            {"day_start": "10:00", "day_end": "10:00", "tz": "Asia/Taipei"},
            {"day_start": "10:00", "day_end": "20:00"},
            {"day_start": 10, "day_end": 20, "tz": "Asia/Taipei"},
            {"day_start": "10:00", "day_end": "20:00", "tz": "Mars/Olympus_Mons"},
        ]
        for raw in variants:
            with self.subTest(raw=raw):
                self.shop_path.write_text(json.dumps({"server": {}, "handover": raw}), encoding="utf-8")
                out = io.StringIO()
                with redirect_stdout(out):
                    config = supervisor.load_handover_config()
                self.assertEqual(DEFAULTS, config)
                self.assertEqual(1, len(out.getvalue().splitlines()))
        for text in ('{"server": {}}', "{not json"):
            with self.subTest(text=text):
                self.shop_path.write_text(text, encoding="utf-8")
                out = io.StringIO()
                with redirect_stdout(out):
                    self.assertEqual(DEFAULTS, supervisor.load_handover_config())
                self.assertEqual(1, len(out.getvalue().splitlines()))
        custom = {"day_start": "09:30", "day_end": "21:00", "tz": "Asia/Taipei"}
        self.shop_path.write_text(json.dumps({"server": {}, "handover": custom}), encoding="utf-8")
        self.assertEqual(custom, supervisor.load_handover_config(log=False))

    def test_timezone_fallback_without_tzdata(self):
        missing = supervisor.ZoneInfoNotFoundError("no tzdata")
        with patch.object(supervisor, "ZoneInfo", side_effect=missing):
            tz = supervisor._timezone("Asia/Taipei")
            self.assertEqual(timedelta(hours=8), tz.utcoffset(None))
            utc_ten = datetime(2025, 6, 1, 2, 0, tzinfo=timezone.utc)
            self.assertTrue(supervisor.is_day_window(utc_ten, DEFAULTS))
            self.assertIsInstance(supervisor.is_day_window(config=DEFAULTS), bool)
            with self.assertRaises(ValueError):
                supervisor._timezone("Europe/Berlin")
            self.shop_path.write_text(json.dumps({"server": {}, "handover": {
                "day_start": "10:00", "day_end": "20:00", "tz": "Europe/Berlin"}}), encoding="utf-8")
            self.assertEqual(DEFAULTS, supervisor.load_handover_config(log=False))

    def test_night_url_is_tracked_but_not_registered(self):
        self.day = False
        self.run_one_tunnel([NEW_URL + "\n"])
        self.assertEqual([], self.http, "Night window must not make any HTTP call")
        records = self.read_events()
        self.assertEqual(["url_detected", "skipped_night", "tunnel_exit"], [r["event"] for r in records])
        skipped = records[1]
        self.assertEqual({"ts", "event", "old_url", "new_url", "put_status", "verify_status"},
                         set(skipped))
        self.assertEqual(("", NEW_URL), (skipped["old_url"], skipped["new_url"]))
        self.assertEqual("not_attempted", skipped["put_status"])
        self.assertEqual("not_attempted", skipped["verify_status"])
        self.assertIsNotNone(datetime.fromisoformat(skipped["ts"]).utcoffset())
        server = json.loads(self.shop_path.read_text(encoding="utf-8"))["server"]
        self.assertEqual(NEW_URL, server["webhook_url"])
        self.assertEqual("https://new-test.lhr.life", server["public_base"])

    def test_flip_to_day_registers_once_with_day_start_event(self):
        self.day = False
        self.responses = [FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]

        def lines():
            yield NEW_URL + "\n"
            self.day = True
            yield "keepalive noise\n"
            yield "more noise\n"

        self.run_one_tunnel(lines())
        self.assertEqual(["PUT", "GET"], self.calls)
        records = self.read_events()
        self.assertEqual(["url_detected", "skipped_night", "day_start_register", "put_start",
                          "put_result", "verify_result", "tunnel_exit"], [r["event"] for r in records])
        self.assertEqual(NEW_URL, records[2]["new_url"])
        self.assertEqual("pending_day_url", records[2]["reason"])
        self.assertEqual("match", records[5]["verify_status"])

    def test_day_start_check_registers_and_clears_pending(self):
        state = supervisor.HandoverState(dict(DEFAULTS))
        state.last_day = False
        state.previous_url = OLD_URL
        state.current_url = NEW_URL
        state.pending_day_url = NEW_URL
        self.assertFalse(supervisor.check_day_start(state, at(9, 59)))
        self.assertEqual([], self.http)
        self.responses = [FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.assertTrue(supervisor.check_day_start(state, at(10, 0)))
        self.assertIsNone(state.pending_day_url)
        self.assertFalse(supervisor.check_day_start(state, at(10, 1)))
        self.assertEqual(["PUT", "GET"], self.calls)
        start = [r for r in self.read_events() if r["event"] == "day_start_register"]
        self.assertEqual([(OLD_URL, NEW_URL)], [(r["old_url"], r["new_url"]) for r in start])

    def test_failed_day_start_keeps_pending_and_does_not_loop(self):
        state = supervisor.HandoverState(dict(DEFAULTS))
        state.last_day = False
        state.current_url = NEW_URL
        state.pending_day_url = NEW_URL
        self.responses = [response for _ in range(4) for response in
                          (FakeResponse({}), FakeResponse({"endpoint": OLD_URL, "active": True}))]
        self.assertTrue(supervisor.check_day_start(state, at(10, 0)))
        self.assertEqual(NEW_URL, state.pending_day_url)
        self.assertFalse(supervisor.check_day_start(state, at(10, 1)))
        self.assertEqual(["PUT", "GET"] * 4, self.calls)

    def test_url_registered_yesterday_is_registered_again_next_day(self):
        state = supervisor.HandoverState(dict(DEFAULTS))
        state.last_day = True
        state.current_url = NEW_URL
        state.registered_url = NEW_URL
        self.assertFalse(supervisor.check_day_start(state, at(19, 59)))
        self.assertFalse(supervisor.check_day_start(state, at(20, 0)))
        self.assertEqual("", state.registered_url)
        self.assertEqual([], self.http)
        self.responses = [FakeResponse({}), FakeResponse({"endpoint": NEW_URL, "active": True})]
        self.assertTrue(supervisor.check_day_start(state, at(10, 0, day=2)))
        self.assertEqual(["PUT", "GET"], self.calls)
        start = [r for r in self.read_events() if r["event"] == "day_start_register"]
        self.assertEqual(["not_registered_this_window"], [r["reason"] for r in start])

    def test_flip_without_any_url_does_nothing(self):
        state = supervisor.HandoverState(dict(DEFAULTS))
        state.last_day = False
        self.assertFalse(supervisor.check_day_start(state, at(10, 0)))
        self.assertEqual([], self.http)
        self.assertEqual([], self.read_events())

    def test_day_watcher_thread_runs_periodic_check(self):
        fired = threading.Event()
        state = supervisor.HandoverState(dict(DEFAULTS))
        with patch.object(supervisor, "check_day_start", side_effect=lambda s, now=None: fired.set()):
            stop = supervisor._start_day_watcher(state, 0.01)
            try:
                self.assertTrue(fired.wait(2))
            finally:
                stop.set()


if __name__ == "__main__":
    unittest.main()