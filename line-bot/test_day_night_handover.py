"""A4-3: real decisions and file effects, fake clock and urlopen only."""
from __future__ import annotations

import importlib
import io
import json
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import tunnel_manager as tm
from a43_test_support import DEFAULT_CONFIG, TAIPEI, isolated_tunnel_case

AI_BASE = "https://ai-night-test.trycloudflare.com"
AI_ENDPOINT = AI_BASE + "/line/webhook"
SHOP_ENDPOINT = "https://shop-test.lhr.life/line/webhook"
SHOP_WEEK = dict(DEFAULT_CONFIG, days={"5": ["12:00", "18:00"], "6": None})


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

    # ---- A4-6: weekly hours (2026-10-30 Fri, 10-31 Sat, 11-01 Sun, 11-02 Mon) ----

    def test_saturday_1830_is_night(self):
        self.assert_window(datetime(2026, 10, 31, 18, 30, tzinfo=TAIPEI), True, SHOP_WEEK)

    def test_saturday_1300_is_day(self):
        self.assert_window(datetime(2026, 10, 31, 13, 0, tzinfo=TAIPEI), False, SHOP_WEEK)

    def test_sunday_1400_is_night(self):
        self.assert_window(datetime(2026, 11, 1, 14, 0, tzinfo=TAIPEI), True, SHOP_WEEK)

    def test_monday_1400_is_day(self):
        self.assert_window(datetime(2026, 11, 2, 14, 0, tzinfo=TAIPEI), False, SHOP_WEEK)

    def test_friday_2030_is_night(self):
        self.assert_window(datetime(2026, 10, 30, 20, 30, tzinfo=TAIPEI), True, SHOP_WEEK)

    def test_weekly_boundaries(self):
        cases = [
            (datetime(2026, 10, 31, 11, 59), True),
            (datetime(2026, 10, 31, 12, 0), False),
            (datetime(2026, 10, 31, 17, 59), False),
            (datetime(2026, 10, 31, 18, 0), True),
            (datetime(2026, 11, 1, 10, 0), True),
            (datetime(2026, 11, 2, 9, 59), True),
            (datetime(2026, 11, 2, 10, 0), False),
            (datetime(2026, 10, 30, 19, 59), False),
        ]
        for moment, night in cases:
            with self.subTest(moment=moment):
                self.assert_window(moment.replace(tzinfo=TAIPEI), night, SHOP_WEEK)
        empty = dict(DEFAULT_CONFIG, days={"6": []})
        self.assert_window(datetime(2026, 11, 1, 14, 0, tzinfo=TAIPEI), True, empty)

    def test_registration_window_uses_weekday_from_file(self):
        tm.HANDOVER_CONFIG.write_text(json.dumps(SHOP_WEEK), encoding="utf-8")
        tm._now.return_value = datetime(2026, 10, 31, 18, 30, tzinfo=TAIPEI)
        self.assertEqual(tm.registration_window(), "night")
        tm._now.return_value = datetime(2026, 10, 31, 13, 0, tzinfo=TAIPEI)
        self.assertEqual(tm.registration_window(), "day")

    def test_invalid_days_value_is_configuration_error(self):
        bad_values = [None, [], "x", {"7": None}, {"05": None}, {"5": "12:00-18:00"},
                      {"5": ["12:00"]}, {"5": ["18:00", "12:00"]}, {"5": ["12:00", "12:00"]},
                      {"5": ["12:00", "24:00"]}, {"5": [12, 18]}, {"5": False},
                      {"5": ["12:00", "18:00", "19:00"]}]
        for days in bad_values:
            with self.subTest(days=days):
                config = dict(DEFAULT_CONFIG, days=days)
                tm.HANDOVER_CONFIG.write_text(json.dumps(config), encoding="utf-8")
                self.assertEqual(tm.registration_window(), "configuration_error")
                with self.assertRaises(ValueError):
                    tm.is_night_window(datetime(2026, 10, 31, 13, tzinfo=TAIPEI), config=config)

    def test_shipped_handover_json_has_weekly_overrides(self):
        path = Path(tm.__file__).resolve().parent / "handover.json"
        shipped = json.loads(path.read_text(encoding="utf-8-sig"))
        tm._validate_config(shipped)
        self.assertEqual(shipped["days"], {"5": ["12:00", "18:00"], "6": None})
        self.assertEqual((shipped["day_start"], shipped["day_end"]), ("10:00", "20:00"))


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


class NightReclaimTests(IsolatedCase):
    """A4-6: _night_reclaim with fake clock and fake LINE; no network."""

    def setUp(self):
        super().setUp()
        self.state = {}
        tm.HANDOVER_CONFIG.write_text(
            json.dumps(dict(DEFAULT_CONFIG, night_takeover_delay_min=5)), encoding="utf-8")

    def reclaim(self, now):
        return tm._night_reclaim(AI_BASE, "test-token", self.state, now, sleep=self.sleeps.append)

    def reclaim_events(self):
        if not tm.EVENTS_PATH.exists():
            return []
        return [row for row in self.events() if row["event"] == "night_reclaim"]

    def test_night_shop_endpoint_gets_one_put_verify_and_event(self):
        self.clock(21)
        self.assertEqual(self.reclaim(5000.0), "reclaimed")
        self.assertEqual(self.http.calls, ["GET", "PUT", "GET"])
        self.assertEqual(self.http.endpoint, AI_ENDPOINT)
        events = self.reclaim_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["old_url"], SHOP_ENDPOINT)
        self.assertEqual(events[0]["new_url"], AI_ENDPOINT)
        self.assertEqual(events[0]["status"], "updated")
        self.assertEqual(tm.PENDING_WEBHOOK["base_url"], "")

    def test_night_already_ai_does_not_put(self):
        self.clock(21)
        self.http.endpoint = AI_ENDPOINT
        self.assertEqual(self.reclaim(5000.0), "already_ai")
        self.assertEqual(self.http.calls, ["GET"])
        self.assertEqual(self.reclaim_events(), [])

    def test_day_makes_no_get_or_put(self):
        self.clock(14)
        self.assertEqual(self.reclaim(5000.0), "day")
        self.assertEqual(self.http.calls, [])
        self.token_loader.assert_not_called()
        self.assertFalse(tm.EVENTS_PATH.exists())

    def test_second_check_inside_900s_is_skipped(self):
        self.clock(21)
        self.assertEqual(self.reclaim(5000.0), "reclaimed")
        self.http.endpoint = SHOP_ENDPOINT
        calls = list(self.http.calls)
        self.assertEqual(self.reclaim(5899.0), "skipped")
        self.assertEqual(self.http.calls, calls)
        self.assertEqual(self.reclaim(5900.0), "reclaimed")
        self.assertEqual(self.http.calls, calls + ["GET", "PUT", "GET"])

    def test_waits_takeover_delay_after_closing(self):
        self.clock(20, 3)
        self.assertEqual(self.reclaim(5000.0), "takeover_delay")
        self.assertEqual(self.http.calls, [])
        self.clock(20, 5)
        self.assertEqual(self.reclaim(5001.0), "reclaimed")

    def test_saturday_evening_is_reclaimed_and_saturday_noon_is_not(self):
        tm.HANDOVER_CONFIG.write_text(json.dumps(SHOP_WEEK), encoding="utf-8")
        tm._now.return_value = datetime(2026, 10, 31, 13, 0, tzinfo=TAIPEI)
        self.assertEqual(self.reclaim(5000.0), "day")
        self.assertEqual(self.http.calls, [])
        tm._now.return_value = datetime(2026, 10, 31, 18, 30, tzinfo=TAIPEI)
        self.assertEqual(self.reclaim(5001.0), "reclaimed")
        self.assertEqual(self.http.calls, ["GET", "PUT", "GET"])


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
