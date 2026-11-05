# -*- coding: utf-8 -*-
"""A-TUNNEL audit regressions for tunnel_manager (H1 origin probe, H2 supervisor survives,
H3 broken handover config is reported). No network: _http_read is faked and
socket.create_connection is forbidden by the shared isolation helper."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

LINE_BOT = Path(__file__).resolve().parents[1]
if str(LINE_BOT) not in sys.path:
    sys.path.insert(0, str(LINE_BOT))

import tunnel_manager as tm  # noqa: E402
from a43_test_support import isolated_tunnel_case  # noqa: E402

# isolated_tunnel_case() replaces tm._origin_listening with a stub; keep the real one for probe tests
REAL_ORIGIN_PROBE = getattr(tm, "_origin_listening", None)

URL = "https://quiet-river-1234.trycloudflare.com"
ENDPOINT = URL + "/line/webhook"
SHOP_ENDPOINT = "https://shop.example.com/line/webhook"


class _Base(unittest.TestCase):
    def setUp(self):
        self.root = self.enterContext(isolated_tunnel_case())  # night, 21:00 Taipei
        self.methods = []
        self.line_endpoint = SHOP_ENDPOINT  # what LINE currently points at

        def fake_read(request, http=None):
            method = request.get_method()
            self.methods.append(method)
            if method == "PUT":
                self.line_endpoint = json.loads(request.data.decode())["endpoint"]
                return b"{}", 200
            return json.dumps({"endpoint": self.line_endpoint, "active": True}).encode(), 200

        self.enterContext(mock.patch.object(tm, "_http_read", fake_read))

    def events(self):
        path = tm.EVENTS_PATH
        if not Path(path).is_file():
            return []
        return [json.loads(x) for x in Path(path).read_text(encoding="utf-8").splitlines() if x.strip()]


class OriginProbeTest(_Base):
    def test_probe_targets_configured_origin(self):
        with mock.patch("socket.create_connection") as cc:
            self.assertTrue(REAL_ORIGIN_PROBE(timeout=1.5))
        cc.assert_called_once_with((tm.ORIGIN_HOST, tm.ORIGIN_PORT), timeout=1.5)
        self.assertEqual((tm.ORIGIN_HOST, tm.ORIGIN_PORT), ("127.0.0.1", 8791))

    def test_probe_false_when_connection_refused(self):
        with mock.patch("socket.create_connection", side_effect=ConnectionRefusedError()):
            self.assertFalse(REAL_ORIGIN_PROBE())
        with mock.patch("socket.create_connection", side_effect=TimeoutError()):
            self.assertFalse(REAL_ORIGIN_PROBE())

    def test_cloudflared_is_pointed_at_the_same_origin(self):
        with mock.patch.object(tm.subprocess, "Popen") as popen, mock.patch.object(tm, "_spawn_reader"):
            tm._start_cloudflared()
        args = popen.call_args[0][0]
        self.assertIn("http://127.0.0.1:8791", args)

    def test_no_put_when_local_bot_is_down(self):
        result = {}
        with mock.patch.object(tm, "_origin_listening", return_value=False):
            ok = tm._attempt_webhook(URL, "token", result=result, old_url=SHOP_ENDPOINT)
        self.assertFalse(ok)
        self.assertNotIn("PUT", self.methods)
        self.assertEqual(result.get("status"), "origin_down")
        self.assertEqual(self.line_endpoint, SHOP_ENDPOINT)
        self.assertTrue(any(e["event"] == "origin_down" for e in self.events()))

    def test_put_still_happens_when_local_bot_is_up(self):
        result = {}
        ok = tm._attempt_webhook(URL, "token", result=result)
        self.assertTrue(ok)
        self.assertEqual(self.methods, ["PUT", "GET"])
        self.assertEqual(self.line_endpoint, ENDPOINT)
        self.assertEqual(result.get("status"), "updated")

    def test_publish_keeps_url_pending_when_bot_down(self):
        with mock.patch.object(tm, "_origin_listening", return_value=False):
            tm._publish(URL, "token", sleep=lambda s: None)
        self.assertNotIn("PUT", self.methods)
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], URL)
        self.assertEqual(Path(tm.PUBLIC_BASE).read_text(encoding="utf-8").strip(), URL)

    def test_pending_retry_registers_once_bot_is_back(self):
        tm.PENDING_WEBHOOK["base_url"] = URL
        with mock.patch.object(tm, "_origin_listening", return_value=False):
            tm._retry_pending_webhook("token")
        self.assertNotIn("PUT", self.methods)
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], URL)
        tm._retry_pending_webhook("token")  # bot is back (isolation default: listening)
        self.assertEqual(self.methods, ["PUT", "GET"])
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], "")

    def test_night_reclaim_does_not_take_slot_for_dead_bot(self):
        state = {"last_check_at": None}
        with mock.patch.object(tm, "_origin_listening", return_value=False):
            status = tm._night_reclaim(URL, "token", state, 5000.0, sleep=lambda s: None)
        self.assertEqual(status, "failed")
        self.assertNotIn("PUT", self.methods)
        self.assertEqual(self.line_endpoint, SHOP_ENDPOINT)
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], URL)


class SupervisorSurvivesTest(_Base):
    def test_main_survives_cloudflared_start_failure(self):
        self.enterContext(mock.patch.object(tm, "_load_token", return_value="token"))
        starts = []

        def start():
            starts.append(1)
            if len(starts) == 1:
                raise PermissionError("cloudflared.exe is locked")
            raise KeyboardInterrupt

        self.enterContext(mock.patch.object(tm, "_start_cloudflared", start))
        sleeps = []
        self.assertEqual(tm.main(sleep=sleeps.append, clock=lambda: 0.0), 0)
        self.assertEqual(len(starts), 2)
        self.assertEqual(sleeps, [10])
        self.assertTrue(any(e["event"] == "supervisor_error" and e["error"] == "PermissionError"
                            for e in self.events()))

    def test_crash_backoff_grows_and_is_capped(self):
        self.enterContext(mock.patch.object(tm, "_load_token", return_value="token"))
        starts = []

        def start():
            starts.append(1)
            if len(starts) <= 4:
                raise OSError("boom")
            raise KeyboardInterrupt

        self.enterContext(mock.patch.object(tm, "_start_cloudflared", start))
        sleeps = []
        tm.main(sleep=sleeps.append, clock=lambda: 0.0)
        self.assertEqual(sleeps, [10, 60, 300, 300])

    def test_crash_backoff_resets_after_a_clean_cycle(self):
        self.enterContext(mock.patch.object(tm, "_load_token", return_value="token"))
        self.enterContext(mock.patch.object(tm, "_wait_for_url", return_value=URL))

        class FakeProc:
            returncode = 0

            def __init__(self):
                self.polls = [None, 0]  # first loop pass: running; second: exited

            def poll(self):
                return self.polls.pop(0) if self.polls else 0

            def kill(self):
                pass

            def wait(self, timeout=None):
                return 0

        starts = []

        def start():
            starts.append(1)
            n = len(starts)
            if n == 1 or n == 3:
                raise OSError("boom")
            if n == 2:
                return FakeProc()
            raise KeyboardInterrupt

        self.enterContext(mock.patch.object(tm, "_start_cloudflared", start))
        sleeps = []
        tm.main(sleep=sleeps.append, clock=lambda: 0.0)
        # crash(10) -> clean cycle: 60, 60 -> crash again must start from 10, not 60
        self.assertEqual(sleeps, [10, 60, 60, 10])

    def test_unwritable_event_log_does_not_block_night_publish(self):
        events_dir = self.root / "events_as_dir"
        events_dir.mkdir()
        self.enterContext(mock.patch.object(tm, "EVENTS_PATH", events_dir))  # opening a dir -> OSError
        tm._publish(URL, "token", sleep=lambda s: None)
        self.assertEqual(self.methods, ["PUT", "GET"])
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], "")
        self.assertEqual(Path(tm.PUBLIC_BASE).read_text(encoding="utf-8").strip(), URL)

    def test_unwritable_text_log_does_not_raise(self):
        log_dir = self.root / "log_as_dir"
        log_dir.mkdir()
        self.enterContext(mock.patch.object(tm, "LOG_PATH", log_dir))
        tm._log("hello")  # must not raise


class ConfigErrorReportedTest(_Base):
    def test_broken_config_at_night_is_reported_and_rate_limited(self):
        self.enterContext(mock.patch.object(tm, "registration_window", return_value="configuration_error"))
        self.enterContext(mock.patch.object(
            tm, "get_webhook_info", side_effect=AssertionError("no LINE HTTP on a broken configuration")))
        state = {"last_check_at": None}
        self.assertEqual(tm._night_reclaim(URL, "token", state, 0.0), "configuration_error")
        self.assertEqual(tm._night_reclaim(URL, "token", state, 60.0), "configuration_error")
        self.assertEqual(tm._night_reclaim(URL, "token", state, 960.0), "configuration_error")
        blocked = [e for e in self.events() if e["event"] == "configuration_error"]
        self.assertEqual(len(blocked), 2)
        self.assertEqual(blocked[0]["status"], "takeover_blocked")
        self.assertNotIn("PUT", self.methods)

    def test_day_window_stays_silent(self):
        self.enterContext(mock.patch.object(tm, "registration_window", return_value="day"))
        state = {"last_check_at": None}
        self.assertEqual(tm._night_reclaim(URL, "token", state, 0.0), "day")
        self.assertEqual(self.events(), [])
        self.assertEqual(self.methods, [])


if __name__ == "__main__":
    unittest.main()
