"""A4-3: real decisions and file effects, fake clock and urlopen only."""
from __future__ import annotations

import importlib
import io
import json
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from unittest.mock import patch

import tunnel_manager as tm
from a43_test_support import DEFAULT_CONFIG, TAIPEI, isolated_tunnel_case

AI_BASE = "https://ai-night-test.trycloudflare.com"
AI_ENDPOINT = AI_BASE + "/line/webhook"
SHOP_ENDPOINT = "https://shop-test.lhr.life/line/webhook"


class Response:
    status = 200

    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def close(self):
        pass


class FakeLine:
    def __init__(self):
        self.endpoint = SHOP_ENDPOINT
        self.active = True
        self.calls = []
        self.keep_mismatching = False
        self.put_error = None
        self.get_error = None
        self.on_get = lambda: None

    def urlopen(self, request, timeout=None):
        method = request.get_method()
        if request.full_url != tm.WEBHOOK_API:
            raise AssertionError("unexpected HTTP destination")
        if request.get_header("Authorization") != "Bearer test-token":
            raise AssertionError("wrong or absent test authorization")
        self.calls.append(method)
        if method == "PUT":
            if self.put_error:
                raise self.put_error
            payload = json.loads(request.data)
            if payload != {"endpoint": AI_ENDPOINT}:
                raise AssertionError("wrong webhook payload")
            if not self.keep_mismatching:
                self.endpoint = payload["endpoint"]
            return Response({})
        if method != "GET":
            raise AssertionError("unexpected HTTP method")
        if self.get_error:
            raise self.get_error
        self.on_get()
        return Response({"endpoint": self.endpoint, "active": self.active})


class ParserTests(unittest.TestCase):
    def test_accepts_success_table_url(self):
        self.assertEqual(tm.parse_tunnel_url(
            "2026-10-30T12:00:00Z INF | " + AI_BASE + "    |\n"
        ), AI_BASE)

    def test_rejects_api_even_in_table(self):
        self.assertEqual(tm.parse_tunnel_url("| https://api.trycloudflare.com |"), "")

    def test_rejects_historical_api_error(self):
        self.assertEqual(tm.parse_tunnel_url(
            'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": '
            "dial tcp: lookup api.trycloudflare.com: no such host"
        ), "")

    def test_rejects_tenant_in_error_line(self):
        self.assertEqual(tm.parse_tunnel_url(
            "2026-10-30T12:00:00Z ERR connection failed for " + AI_BASE
        ), "")

    def test_rejects_error_line_containing_a_table(self):
        self.assertEqual(tm.parse_tunnel_url("ERR failed | " + AI_BASE + " |"), "")

    def test_rejects_arbitrary_url_mentions(self):
        self.assertEqual(tm.parse_tunnel_url("visit " + AI_BASE + " now"), "")
        self.assertEqual(tm.parse_tunnel_url(AI_BASE), "")

    def test_rejects_suffix_and_path_after_hostname(self):
        self.assertEqual(tm.parse_tunnel_url("| " + AI_BASE + ".evil.example |"), "")
        self.assertEqual(tm.parse_tunnel_url("| " + AI_BASE + "/tunnel |"), "")


class IsolatedCase(unittest.TestCase):
    def setUp(self):
        self.root = self.enterContext(isolated_tunnel_case())
        self.http = FakeLine()
        self.enterContext(patch.object(tm.urllib.request, "urlopen", self.http.urlopen))
        self.token_loader = self.enterContext(patch.object(
            tm, "_load_token", return_value="test-token"
        ))
        self.sleeps = []

    def clock(self, hour, minute=0):
        tm._now.return_value = datetime(2026, 10, 30, hour, minute, tzinfo=TAIPEI)

    def events(self):
        self.assertTrue(tm.EVENTS_PATH.exists(), "structured tunnel events are missing")
        return [json.loads(line) for line in tm.EVENTS_PATH.read_text(
            encoding="utf-8"
        ).splitlines()]

    def write_base(self, value=AI_BASE):
        tm.PUBLIC_BASE.write_text(value + "\n", encoding="utf-8")

    def night_main(self, arguments):
        try:
            module = importlib.import_module("night_handover")
        except ModuleNotFoundError as exc:
            if exc.name != "night_handover":
                raise
            self.fail("night_handover.py is missing")
        output, error = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(error):
            code = module.main(arguments, sleep=self.sleeps.append)
        return code, json.loads(output.getvalue()), error.getvalue()


class WindowTests(IsolatedCase):
    def assert_window(self, moment, want, config=None):
        function = getattr(tm, "is_night_window", None)
        self.assertIsNotNone(function, "is_night_window is missing")
        self.assertEqual(function(moment, config=config or DEFAULT_CONFIG), want)

    def test_0959_is_night(self):
        self.assert_window(datetime(2026, 10, 30, 9, 59, tzinfo=TAIPEI), True)

    def test_1000_is_day(self):
        self.assert_window(datetime(2026, 10, 30, 10, tzinfo=TAIPEI), False)

    def test_1959_is_day(self):
        self.assert_window(datetime(2026, 10, 30, 19, 59, tzinfo=TAIPEI), False)

    def test_2000_is_night(self):
        self.assert_window(datetime(2026, 10, 30, 20, tzinfo=TAIPEI), True)

    def test_midnight_is_night(self):
        self.assert_window(datetime(2026, 10, 31, 0, tzinfo=TAIPEI), True)

    def test_utc_clock_is_converted_to_taipei(self):
        self.assert_window(datetime(2026, 10, 30, 2, tzinfo=timezone.utc), False)
        self.assert_window(datetime(2026, 10, 30, 12, tzinfo=timezone.utc), True)

    def test_configured_day_window_can_cross_midnight(self):
        config = dict(DEFAULT_CONFIG, day_start="22:00", day_end="06:00")
        for hour, night in [(22, False), (2, False), (6, True), (21, True)]:
            with self.subTest(hour=hour):
                self.assert_window(datetime(2026, 10, 30, hour, tzinfo=TAIPEI), night, config)

    def test_taipei_works_without_external_tzdata(self):
        from zoneinfo import ZoneInfoNotFoundError
        with patch.object(tm, "ZoneInfo", side_effect=ZoneInfoNotFoundError, create=True):
            self.assert_window(datetime(2026, 10, 30, 20, tzinfo=TAIPEI), True)


class PublishingTests(IsolatedCase):
    def test_day_captures_base_without_line_requests(self):
        self.clock(10)
        tm._publish(AI_BASE, "test-token", sleep=self.sleeps.append)
        self.assertEqual(tm.PUBLIC_BASE.read_text(encoding="utf-8"), AI_BASE + "\n")
        self.assertEqual(self.http.calls, [])
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], "")
        self.assertIn("day window: shop is primary, not registering",
                      tm.LOG_PATH.read_text(encoding="utf-8"))
        self.assertEqual(self.events()[-1]["event"], "skipped_day")

    def test_night_captures_base_puts_and_verifies(self):
        self.clock(20)
        tm._publish(AI_BASE, "test-token", sleep=self.sleeps.append)
        self.assertEqual(self.http.calls, ["PUT", "GET"])
        self.assertEqual(self.http.endpoint, AI_ENDPOINT)
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], "")
        last = self.events()[-1]
        self.assertEqual(last["put_status"], 200)
        self.assertEqual(last["verify_status"], "match")

    def test_pending_retry_is_blocked_and_cleared_during_day(self):
        self.clock(10)
        tm.PENDING_WEBHOOK["base_url"] = AI_BASE
        tm._retry_pending_webhook("test-token")
        self.assertEqual(self.http.calls, [])
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], "")

    def test_pending_retry_can_succeed_at_night(self):
        tm.PENDING_WEBHOOK["base_url"] = AI_BASE
        tm._retry_pending_webhook("test-token")
        self.assertEqual(self.http.calls, ["PUT", "GET"])
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], "")

    def test_retry_stops_if_delay_crosses_into_day(self):
        self.clock(9, 59)
        self.http.keep_mismatching = True

        def sleep(delay):
            self.sleeps.append(delay)
            self.clock(10)

        tm._publish(AI_BASE, "test-token", sleep=sleep)
        self.assertEqual(self.http.calls, ["PUT", "GET"])
        self.assertEqual(self.sleeps, [2])

    def test_invalid_configuration_fails_closed_but_keeps_new_base(self):
        tm.HANDOVER_CONFIG.write_text('{"day_start":"oops"}', encoding="utf-8")
        tm._publish(AI_BASE, "test-token", sleep=self.sleeps.append)
        self.assertEqual(self.http.calls, [])
        self.assertEqual(tm.PUBLIC_BASE.read_text(encoding="utf-8").strip(), AI_BASE)
        self.assertEqual(self.events()[-1]["event"], "configuration_error")

    def test_mismatch_has_one_initial_try_and_three_delayed_retries(self):
        self.http.keep_mismatching = True
        tm._publish(AI_BASE, "test-token", sleep=self.sleeps.append)
        self.assertEqual(self.http.calls, ["PUT", "GET"] * 4)
        self.assertEqual(self.sleeps, [2, 5, 10])
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], AI_BASE)
        attempts = [row for row in self.events() if row["event"] == "webhook_update"]
        self.assertEqual(len(attempts), 4)
        self.assertTrue(all(row["verify_status"] == "mismatch" for row in attempts))

    def test_put_failure_records_status_without_exposing_token(self):
        self.http.put_error = urllib.error.HTTPError(
            tm.WEBHOOK_API, 503, "bad", None, io.BytesIO()
        )
        tm._publish(AI_BASE, "test-token", sleep=self.sleeps.append)
        self.assertEqual(self.http.calls, ["PUT"] * 4)
        for row in self.events():
            self.assertTrue({"ts", "event", "old_url", "new_url", "put_status",
                             "verify_status"}.issubset(row))
        attempts = [row for row in self.events() if row["event"] == "webhook_update"]
        self.assertEqual([row["put_status"] for row in attempts], [503] * 4)
        self.assertNotIn("test-token", tm.EVENTS_PATH.read_text(encoding="utf-8"))


class NightHandoverTests(IsolatedCase):
    def test_already_ai_is_a_get_only_noop(self):
        self.write_base()
        self.http.endpoint = AI_ENDPOINT
        code, result, _ = self.night_main([])
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "already_ai")
        self.assertEqual(self.http.calls, ["GET"])
        self.assertEqual(self.events()[-1]["event"], "handover_noop")

    def test_other_endpoint_is_updated_and_verified(self):
        self.write_base()
        code, result, _ = self.night_main([])
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "updated")
        self.assertEqual(self.http.calls, ["GET", "PUT", "GET"])
        attempt = self.events()[-1]
        self.assertEqual(attempt["old_url"], SHOP_ENDPOINT)
        self.assertEqual(attempt["new_url"], AI_ENDPOINT)

    def test_persistent_readback_mismatch_exits_nonzero(self):
        self.write_base()
        self.http.keep_mismatching = True
        code, result, _ = self.night_main([])
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "mismatch")
        self.assertEqual(self.http.calls, ["GET"] + ["PUT", "GET"] * 4)
        self.assertEqual(self.sleeps, [2, 5, 10])

    def test_dry_run_is_offline_and_does_not_load_credentials(self):
        self.write_base()
        code, result, _ = self.night_main(["--dry-run"])
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(result["ai_endpoint"], AI_ENDPOINT)
        self.assertEqual(self.http.calls, [])
        self.token_loader.assert_not_called()
        self.assertFalse(tm.EVENTS_PATH.exists())

    def test_status_prints_registered_owner_and_urls_without_writes(self):
        self.write_base()
        self.clock(10)
        code, result, _ = self.night_main(["--status"])
        self.assertEqual(code, 0)
        self.assertEqual(result["ai_endpoint"], AI_ENDPOINT)
        self.assertEqual(result["line_endpoint"], SHOP_ENDPOINT)
        self.assertEqual(result["registered_owner"], "shop_or_other")
        self.assertIs(result["active"], True)
        self.assertEqual(self.http.calls, ["GET"])
        self.assertFalse(tm.EVENTS_PATH.exists())

    def test_status_identifies_ai_endpoint(self):
        self.write_base()
        self.http.endpoint = AI_ENDPOINT
        code, result, _ = self.night_main(["--status"])
        self.assertEqual(code, 0)
        self.assertEqual(result["registered_owner"], "ai")
        self.assertEqual(self.http.calls, ["GET"])

    def test_unconfigured_status_does_not_claim_the_shop_is_registered(self):
        self.write_base()
        self.http.endpoint = ""
        self.http.active = False
        code, result, _ = self.night_main(["--status"])
        self.assertEqual(code, 0)
        self.assertEqual(result["line_endpoint"], "")
        self.assertEqual(result["registered_owner"], "unknown")
        self.assertIs(result["active"], False)
        self.assertEqual(self.http.calls, ["GET"])

    def test_daytime_handover_does_not_load_credentials_or_call_line(self):
        self.write_base()
        self.clock(10)
        code, result, _ = self.night_main([])
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "day_window")
        self.assertEqual(self.http.calls, [])
        self.token_loader.assert_not_called()

    def test_get_failure_cannot_trigger_a_blind_put(self):
        self.write_base()
        self.http.get_error = urllib.error.URLError("offline")
        code, result, _ = self.night_main([])
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "error")
        self.assertEqual(self.http.calls, ["GET"])

    def test_get_finishes_in_daytime_without_put(self):
        self.write_base()
        self.clock(9, 59)
        self.http.on_get = lambda: self.clock(10)
        code, result, _ = self.night_main([])
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "day_window")
        self.assertEqual(self.http.calls, ["GET"])

    def test_missing_base_fails_before_loading_credentials(self):
        code, result, _ = self.night_main([])
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "error")
        self.assertEqual(self.http.calls, [])
        self.token_loader.assert_not_called()

    def test_invalid_base_cannot_be_registered(self):
        for base in ["https://api.trycloudflare.com", "http://wrong.trycloudflare.com",
                     AI_BASE + ".evil.example", AI_BASE + "/tunnel"]:
            with self.subTest(base=base):
                self.write_base(base)
                code, result, _ = self.night_main([])
                self.assertEqual(code, 1)
                self.assertEqual(result["status"], "error")
        self.assertEqual(self.http.calls, [])
        self.token_loader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
