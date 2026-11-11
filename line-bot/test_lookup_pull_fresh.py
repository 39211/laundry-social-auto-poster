"""Customer-only pull confirmation; synthetic MDB/logs and fake LINE transport."""
from datetime import datetime, timedelta
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import laundry_lookup as L
import test_arrival_notify as T
import test_mdb_freshness as F
import tunnel_manager as tm


OLD = "2026-11-10T10:24:00+08:00"
CONFIRMED = "2026-11-10T12:30:00+08:00"


def pull_record(mdb, **changes):
    row = {
        "ts": "2026-11-10T12:30:00.0000000+08:00",
        "result": "REPLACED", "exit": 0, "bytes": mdb.stat().st_size,
        "source_mtime": "2026-11-10T02:24:00.0000000Z",
    }
    row.update(changes)
    return row


class LookupPullFreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.mdb = self.root / "eHank.mdb"
        self.mdb.write_bytes(b"synthetic source metadata")
        stamp = datetime.fromisoformat(OLD).timestamp()
        os.utime(self.mdb, (stamp, stamp))
        self.log = self.root / "custom-pull.jsonl"
        self.default_log = self.root / "local-app-data/line-bot/mdb_pull.jsonl"
        self.default_log.parent.mkdir(parents=True)
        self.config = self.root / "handover.json"
        self.config.write_text(json.dumps(F.SHOP_HOURS), encoding="utf-8")
        self.now = datetime.fromisoformat("2026-11-10T13:00:00+08:00")
        self.customers = [{"no": "0028", "phone": "0912345678"}]
        self.pieces = [{"customer_no": "0028", "wash_no": "W1", "status": "stock"}]
        for patcher in (
            patch.dict(os.environ, {
                "LAUNDRY_LOOKUP_FIXTURE": "0", "LAUNDRY_FRESH_MINUTES": "120",
                "LAUNDRY_MDB_PULL_LOG": str(self.log),
                "LOCALAPPDATA": str(self.default_log.parent.parent),
            }),
            patch.object(L, "EHANK_ROOT", self.root),
            patch.object(L, "inventory", return_value=(self.customers, self.pieces, L.EHANK_SOURCE)),
            patch.object(L, "_now_taipei", side_effect=lambda: self.now),
            patch.object(tm, "HANDOVER_CONFIG", self.config),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_rows(self, *rows):
        self.log.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

    def valid_log(self, **changes):
        self.write_rows(pull_record(self.mdb, **changes))

    def assert_lookup(self, stale, data_as_of=CONFIRMED, query="0028"):
        row = L.lookup(query)
        self.assertEqual((row.stale, row.data_as_of), (stale, data_as_of))
        return row

    def assert_legacy(self):
        snap = L.inventory_snapshot()
        self.assert_lookup(snap.stale, snap.data_as_of)

    def test_matching_pull_is_customer_fresh_but_inventory_stays_stale(self):
        self.valid_log()
        row = self.assert_lookup(False)
        self.assertTrue(row.found)
        snap = L.inventory_snapshot()
        self.assertEqual((snap.stale, snap.data_as_of), (True, OLD))

    def test_inventory_snapshot_does_not_read_pull_confirmation(self):
        self.valid_log()
        with patch.object(L, "_pull_confirmed_at") as confirm:
            snap = L.inventory_snapshot()
        confirm.assert_not_called()
        self.assertEqual((snap.stale, snap.data_as_of), (True, OLD))

    def test_no_log_preserves_old_timestamp_and_stale(self):
        self.assert_legacy()

    def test_empty_log_preserves_legacy(self):
        self.log.write_bytes(b"")
        self.assert_legacy()

    def test_no_confirmation_preserves_fresh_mtime_too(self):
        self.now = datetime.fromisoformat("2026-11-10T10:30:00+08:00")
        self.assert_lookup(False, OLD)

    def test_last_failed_pull_does_not_search_back_for_success(self):
        for result, code in (("REMOTE_UNAVAILABLE", 3), ("LOCKED", 2),
                             ("SOURCE_CHANGED", 3), ("REPLACED", 1)):
            with self.subTest(result=result, code=code):
                self.write_rows(pull_record(self.mdb), pull_record(self.mdb, result=result, exit=code))
                self.assert_lookup(True, OLD)

    def test_new_success_after_failure_is_used(self):
        self.write_rows(pull_record(self.mdb, result="LOCKED", exit=2), pull_record(self.mdb))
        self.assert_lookup(False)

    def test_last_pull_version_mismatch_does_not_search_back(self):
        self.write_rows(pull_record(self.mdb), pull_record(self.mdb, source_mtime="2026-11-10T01:00:00Z"))
        self.assert_lookup(True, OLD)

    def test_source_mtime_tolerance_is_inclusive_in_both_directions(self):
        for delta in (-2, 2):
            with self.subTest(delta=delta):
                source_time = datetime.fromisoformat(OLD) + timedelta(seconds=delta)
                self.valid_log(source_mtime=source_time.isoformat())
                self.assert_lookup(False)

    def test_source_mtime_outside_tolerance_rejects_confirmation(self):
        for delta in (-2.001, 2.001, 600):
            with self.subTest(delta=delta):
                source_time = datetime.fromisoformat(OLD) + timedelta(seconds=delta)
                self.valid_log(source_mtime=source_time.isoformat())
                self.assert_lookup(True, OLD)

    def test_seven_digit_source_time_keeps_the_exact_two_second_boundary(self):
        for source, valid in (("2026-11-10T02:24:02.0000000Z", True),
                              ("2026-11-10T02:24:02.0000001Z", False),
                              ("2026-11-10T02:23:57.9999999Z", False)):
            with self.subTest(source=source):
                self.valid_log(source_mtime=source)
                self.assert_lookup(not valid, CONFIRMED if valid else OLD)

    def test_byte_count_must_match_and_be_an_integer(self):
        for size in (self.mdb.stat().st_size + 1, -1, None, True, "25", 25.0):
            with self.subTest(size=size):
                self.valid_log(bytes=size)
                self.assert_lookup(True, OLD)

    def test_exit_must_be_integer_zero(self):
        for code in (None, False, "0", 0.0, 3):
            with self.subTest(code=code):
                self.valid_log(exit=code)
                self.assert_lookup(True, OLD)

    def test_seven_fractional_digits_and_both_timezone_forms(self):
        for ts, source in (
            ("2026-11-10T12:30:00.1234567+08:00", "2026-11-10T02:24:00.0000000Z"),
            ("2026-11-10T04:30:00.1234567Z", "2026-11-10T10:24:00.0000000+08:00"),
        ):
            with self.subTest(ts=ts):
                self.valid_log(ts=ts, source_mtime=source)
                self.assert_lookup(False)

    def test_invalid_naive_or_missing_times_fall_back(self):
        for field in ("ts", "source_mtime"):
            for value in (None, "", "oops", "2026-11-10T12:30:00", [], 0):
                with self.subTest(field=field, value=value):
                    self.valid_log(**{field: value})
                    self.assert_lookup(True, OLD)

    def test_missing_required_pull_fields_fall_back(self):
        for key in ("result", "bytes", "source_mtime", "exit", "ts"):
            with self.subTest(key=key):
                row = pull_record(self.mdb)
                del row[key]
                self.write_rows(row)
                self.assert_lookup(True, OLD)

    def test_more_than_two_minutes_in_future_is_not_a_confirmation(self):
        self.valid_log(ts="2026-11-10T13:02:00.0010000+08:00")
        self.assert_lookup(True, OLD)

    def test_seven_digit_future_time_keeps_the_exact_two_minute_boundary(self):
        self.valid_log(ts="2026-11-10T13:02:00.0000001+08:00")
        self.assert_lookup(True, OLD)

    def test_up_to_two_minutes_future_uses_original_negative_age_rule(self):
        for ts in ("2026-11-10T13:00:01+08:00", "2026-11-10T13:02:00+08:00"):
            with self.subTest(ts=ts):
                self.valid_log(ts=ts)
                self.assert_lookup(True, ts)

    def test_customer_age_uses_confirmation_at_exact_limit(self):
        self.valid_log()
        self.now = datetime.fromisoformat("2026-11-10T14:30:00+08:00")
        self.assert_lookup(False)

    def test_confirmation_older_than_age_limit_is_stale(self):
        self.valid_log()
        self.now = datetime.fromisoformat("2026-11-10T14:30:01+08:00")
        self.assert_lookup(True)

    def test_customer_fresh_minutes_environment_is_honored(self):
        self.valid_log()
        self.now += timedelta(seconds=1)
        with patch.dict(os.environ, {"LAUNDRY_FRESH_MINUTES": "30"}):
            self.assert_lookup(True)

    def test_invalid_age_setting_retains_default(self):
        self.valid_log()
        for value in ("oops", "nan", "inf", "-1"):
            with self.subTest(value=value), patch.dict(os.environ, {"LAUNDRY_FRESH_MINUTES": value}):
                self.assert_lookup(False)

    def test_closing_rule_uses_confirmation_not_old_mtime(self):
        for confirmed, now, stale in (
            ("2026-11-10T19:00:00+08:00", "2026-11-10T23:59:00+08:00", False),
            ("2026-11-10T18:59:00+08:00", "2026-11-10T23:59:00+08:00", True),
            ("2026-11-10T19:00:00+08:00", "2026-11-11T09:59:00+08:00", False),
            ("2026-11-10T19:00:00+08:00", "2026-11-11T10:00:00+08:00", True),
            ("2026-11-14T17:00:00+08:00", "2026-11-15T15:00:00+08:00", False),
            ("2026-11-14T16:59:00+08:00", "2026-11-15T15:00:00+08:00", True),
        ):
            with self.subTest(confirmed=confirmed, now=now):
                self.now = datetime.fromisoformat(now)
                self.valid_log(ts=confirmed)
                self.assert_lookup(stale, confirmed)

    def test_broken_closing_config_keeps_age_rule(self):
        self.valid_log(ts="2026-11-10T19:00:00+08:00")
        self.now = datetime.fromisoformat("2026-11-10T23:59:00+08:00")
        self.config.write_text('{"day_start":"oops"}', encoding="utf-8")
        self.assert_lookup(True, "2026-11-10T19:00:00+08:00")

    def test_mdb_replaced_during_read_is_stale_despite_matching_confirmation(self):
        self.valid_log()
        before = (self.mdb.stat().st_mtime_ns, self.mdb.stat().st_size)
        for after in ((before[0] + 1_000_000_000, before[1]), (before[0], before[1] + 1), None):
            with self.subTest(after=after), patch.object(L, "_mdb_stamp", side_effect=[before, after]):
                self.assert_lookup(True)

    def test_missing_before_stamp_cannot_be_made_fresh_by_confirmation(self):
        self.valid_log()
        after = (self.mdb.stat().st_mtime_ns, self.mdb.stat().st_size)
        with patch.object(L, "_mdb_stamp", side_effect=[None, after]):
            self.assert_lookup(True)

    def test_missing_mdb_metadata_keeps_legacy_behavior(self):
        self.valid_log()
        self.mdb.unlink()
        self.assert_lookup(True, "")

    def test_non_sync_notify_rows_and_dry_runs_are_skipped(self):
        self.write_rows(pull_record(self.mdb), {"logged_at": "2026-11-10T12:31:00+08:00", "notify_report": "FAILED"},
                        ["non-sync"], pull_record(self.mdb, result="DRY_RUN", ts="bad", exit=3))
        with self.log.open("a", encoding="utf-8") as stream:
            stream.write("\n  \n")
        self.assert_lookup(False)

    def test_only_dry_run_or_non_sync_rows_do_not_confirm(self):
        self.write_rows({"logged_at": "2026-11-10T12:30:00+08:00", "notify_report": "OK"},
                        pull_record(self.mdb, result="DRY_RUN"))
        self.assert_lookup(True, OLD)

    def test_last_pull_is_by_file_order_not_timestamp_sort(self):
        self.write_rows(pull_record(self.mdb), pull_record(self.mdb, ts="2026-11-10T11:00:00+08:00"))
        self.assert_lookup(False, "2026-11-10T11:00:00+08:00")

    def test_malformed_tail_cannot_resurrect_old_success(self):
        self.valid_log()
        with self.log.open("ab") as stream:
            stream.write(b'{"ts":')
        self.assert_lookup(True, OLD)

    def test_bad_utf8_fails_closed_without_raising(self):
        self.valid_log()
        with self.log.open("ab") as stream:
            stream.write(b"\xff\n")
        self.assert_lookup(True, OLD)

    def test_log_io_errors_fail_closed_without_raising(self):
        original_open = Path.open
        for error in (PermissionError("synthetic denied"), OSError("synthetic IO")):
            def failing_open(path, *args, **kwargs):
                if path == self.log:
                    raise error
                return original_open(path, *args, **kwargs)
            with self.subTest(error=type(error).__name__), patch.object(Path, "open", failing_open):
                self.assert_lookup(True, OLD)

    def test_tail_is_bounded_to_64_kib_and_drops_partial_first_line(self):
        self.valid_log()
        payload = (b"prefix" * 12000) + b"\n" + self.log.read_bytes()
        reads = []
        seeks = []
        original_open = Path.open
        test = self

        class TailOnly(io.BytesIO):
            def read(self, size=-1):
                test.assertGreaterEqual(size, 0)
                test.assertLessEqual(size, 64 * 1024)
                reads.append(size)
                return super().read(size)

            def seek(self, offset, whence=0):
                seeks.append((offset, whence))
                return super().seek(offset, whence)

        def guarded_open(path, *args, **kwargs):
            if path == self.log:
                test.assertEqual(args[0] if args else kwargs.get("mode"), "rb")
                return TailOnly(payload)
            return original_open(path, *args, **kwargs)

        with patch.object(Path, "open", guarded_open):
            self.assert_lookup(False)
        self.assertEqual(sum(reads), 64 * 1024)
        self.assertTrue(seeks)

    def test_success_outside_tail_is_not_used(self):
        self.valid_log()
        with self.log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"notify_report": "x" * (65 * 1024)}) + "\n")
        self.assert_lookup(True, OLD)

    def test_partial_multibyte_prefix_does_not_break_valid_tail(self):
        self.valid_log()
        self.log.write_bytes(("資料" * 12000).encode("utf-8") + b"\n" + self.log.read_bytes())
        self.assert_lookup(False)

    def test_localappdata_default_is_used_without_override(self):
        self.default_log.write_text(json.dumps(pull_record(self.mdb)) + "\n", encoding="utf-8")
        os.environ.pop("LAUNDRY_MDB_PULL_LOG")
        self.assert_lookup(False)

    def test_explicit_override_has_priority_over_default(self):
        self.default_log.write_text(json.dumps(pull_record(self.mdb, result="LOCKED", exit=2)) + "\n", encoding="utf-8")
        self.valid_log()
        self.assert_lookup(False)

    def test_broken_override_does_not_fall_back_to_default_success(self):
        self.default_log.write_text(json.dumps(pull_record(self.mdb)) + "\n", encoding="utf-8")
        self.assert_lookup(True, OLD)

    def test_missing_localappdata_without_override_preserves_legacy(self):
        os.environ.pop("LAUNDRY_MDB_PULL_LOG")
        os.environ.pop("LOCALAPPDATA")
        self.assert_lookup(True, OLD)

    def test_other_sources_keep_existing_freshness(self):
        self.valid_log()
        for source in ("fixture", "sqlite:synthetic.db", "none"):
            with self.subTest(source=source), patch.object(L, "inventory", return_value=(self.customers, self.pieces, source)):
                self.assert_lookup(False, "")

    def test_confirmation_reaches_phone_wash_number_and_not_found_results(self):
        self.valid_log()
        for query in ("0912345678", "W1", "missing"):
            with self.subTest(query=query):
                row = self.assert_lookup(False, query=query)
                self.assertEqual(row.found, query != "missing")

    def test_ambiguous_result_keeps_customer_freshness(self):
        self.valid_log()
        self.customers.append({"no": "0029", "phone": "0912345678"})
        self.assertTrue(self.assert_lookup(False, query="0912345678").ambiguous)

    def test_blank_query_still_returns_empty_lookup(self):
        self.valid_log()
        with patch.object(L, "inventory_snapshot") as snapshot:
            row = L.lookup(" ")
        snapshot.assert_not_called()
        self.assertEqual((row.stale, row.data_as_of, row.source), (False, "", "none"))


class ArrivalUnchangedTests(T.Isolated):
    """r1's three probes, now asserting the original notification behavior."""
    def setUp(self):
        super().setUp()
        self.arm(datei="115.11.10")
        self.shop.now = datetime.fromisoformat("2026-11-10T13:00:00+08:00")
        mdb = self.shop.root / "eHank.mdb"
        stamp = datetime.fromisoformat(OLD).timestamp()
        os.utime(mdb, (stamp, stamp))
        log = self.shop.root / "mdb_pull.jsonl"
        log.write_text(json.dumps(pull_record(mdb)) + "\n", encoding="utf-8")
        for patcher in (
            patch.dict(os.environ, {"LAUNDRY_MDB_PULL_LOG": str(log), "LAUNDRY_FRESH_MINUTES": "120"}),
            patch.object(L, "_now_taipei", side_effect=lambda: self.shop.now),
            patch.object(L, "_evening_threshold", return_value=None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def assert_customer_only_fresh(self):
        snap = L.inventory_snapshot()
        row = L.lookup("0028")
        self.assertEqual((snap.stale, snap.data_as_of), (True, OLD))
        self.assertEqual((row.stale, row.data_as_of), (False, CONFIRMED))

    def test_mature_pending_at_1300_stays_held_and_seen_unchanged(self):
        self.shop.now = datetime.fromisoformat("2026-11-10T10:30:00+08:00")
        self.assertEqual(self.shop.run()["code"], "SETTLE_HOLD")
        state_before = T.A.state_path().read_bytes()
        seen_before = T.A._load_state()["seen"]
        self.shop.now = datetime.fromisoformat("2026-11-10T13:00:00+08:00")
        held = self.shop.run()
        self.assertEqual((held["code"], held["http"], len(self.shop.calls)), ("STALE_HOLD", 0, 0))
        self.assertEqual(T.A._load_state()["seen"], seen_before)
        self.assertEqual(T.A.state_path().read_bytes(), state_before)
        self.assert_customer_only_fresh()

    def test_unseen_ready_at_1300_and_1315_stays_held(self):
        state_before = T.A.state_path().read_bytes()
        first, second = self.shop.open_and_wait()
        self.assertEqual([first["code"], second["code"]], ["STALE_HOLD", "STALE_HOLD"])
        self.assertEqual((first["http"], second["http"], len(self.shop.calls)), (0, 0, 0))
        self.assertEqual(T.A._load_state()["seen"], ["BASE"])
        self.assertEqual(T.A.state_path().read_bytes(), state_before)
        self.assert_customer_only_fresh()

    def test_rebaseline_stays_held_and_seen_unchanged(self):
        state_before = T.A.state_path().read_bytes()
        held = T.A.rebaseline(clock=lambda: self.shop.now)
        self.assertEqual(held["code"], "STALE_HOLD")
        self.assertEqual(T.A._load_state()["seen"], ["BASE"])
        self.assertEqual(T.A.state_path().read_bytes(), state_before)
        self.assertEqual(len(self.shop.calls), 0)
        self.assert_customer_only_fresh()
