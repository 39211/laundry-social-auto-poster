"""A2b freshness, customer copy and notification gates; no real MDB or network."""
from datetime import datetime, timedelta
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import arrival_notify as A
import conversation as C
import laundry_lookup as L


class FreshnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.mdb = self.root / "eHank.mdb"
        self.mdb.write_bytes(b"synthetic metadata only")
        self.customers = [{"no": "0028", "phone": "0912345678"}]
        self.pieces = [{"customer_no": "0028", "wash_no": "W1", "status": "stock", "name": "shirt"}]
        for patcher in (
            patch.object(L, "EHANK_ROOT", self.root),
            patch.object(L, "inventory", return_value=(self.customers, self.pieces, L.EHANK_SOURCE)),
            patch.dict(os.environ, {"LAUNDRY_FRESH_MINUTES": "120", "LAUNDRY_LOOKUP_FIXTURE": "0"}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def row(self, modified, now):
        stamp = datetime.fromisoformat(modified).timestamp()
        os.utime(self.mdb, (stamp, stamp))
        with patch.object(L, "_now_taipei", create=True, return_value=datetime.fromisoformat(now)):
            return L.lookup("0028")

    def test_data_as_of_is_source_mtime_in_taipei(self):
        row = self.row("2026-10-30T04:00:00+00:00", "2026-10-30T12:30:00+08:00")
        self.assertEqual(row.data_as_of, "2026-10-30T12:00:00+08:00")

    def test_day_over_120_minutes_is_stale(self):
        self.assertTrue(self.row("2026-10-30T10:00:00+08:00", "2026-10-30T12:01:00+08:00").stale)

    def test_day_exactly_120_minutes_is_fresh(self):
        self.assertFalse(self.row("2026-10-30T10:00:00+08:00", "2026-10-30T12:00:00+08:00").stale)

    def test_fresh_minutes_env_is_honored(self):
        with patch.dict(os.environ, {"LAUNDRY_FRESH_MINUTES": "30"}):
            self.assertTrue(self.row("2026-10-30T11:00:00+08:00", "2026-10-30T12:00:00+08:00").stale)

    def test_night_after_19_is_fresh(self):
        self.assertFalse(self.row("2026-10-30T19:00:00+08:00", "2026-10-30T23:59:00+08:00").stale)

    def test_night_older_copy_is_stale(self):
        self.assertTrue(self.row("2026-10-30T18:59:00+08:00", "2026-10-30T23:00:00+08:00").stale)

    def test_after_midnight_previous_evening_is_fresh(self):
        self.assertFalse(self.row("2026-10-31T19:30:00+08:00", "2026-11-01T09:59:00+08:00").stale)

    def test_day_at_10_ends_night_exception(self):
        self.assertTrue(self.row("2026-10-30T19:30:00+08:00", "2026-10-31T10:00:00+08:00").stale)

    def test_missing_mtime_holds_and_future_timestamp_is_stale(self):
        self.assertTrue(self.row("2026-10-30T13:00:00+08:00", "2026-10-30T12:00:00+08:00").stale)
        self.mdb.unlink()
        row = L.lookup("0028")
        self.assertTrue(row.stale)
        self.assertEqual(row.data_as_of, "")

    def customer_copy(self, stale):
        row = self.row("2026-10-30T12:00:00+08:00", "2026-10-30T12:10:00+08:00")
        row.stale = stale
        with patch.object(L, "lookup", return_value=row), patch.object(L, "bind_uid"), patch.object(C, "set_sess"):
            messages, _ = C.tell_status_ex("Ua2b", "0028")
        return "\n".join(m["text"] for m in messages if m["type"] == "text")

    def test_fresh_reply_ends_with_data_time(self):
        self.assertEqual(self.customer_copy(False).splitlines()[-1], "資料時間 10/30 12:00")

    def test_stale_reply_ends_with_business_hours_confirmation(self):
        self.assertEqual(self.customer_copy(True).splitlines()[-1], "以上是 10/30 12:00 的資料,最新狀態請於營業時間再確認")

    def test_mdb_changed_during_read_is_held(self):
        stamp = datetime.fromisoformat("2026-10-30T12:00:00+08:00").timestamp()
        before = (int(stamp * 1_000_000_000), 100)
        after = (before[0] + 1_000_000_000, 100)
        with patch.object(L, "_mdb_stamp", side_effect=[before, after]), \
                patch.object(L, "_now_taipei", return_value=datetime.fromisoformat("2026-10-30T12:10:00+08:00")):
            row = L.lookup("0028")
        self.assertTrue(row.stale)
        self.assertEqual(row.data_as_of, "2026-10-30T12:00:00+08:00")

    def test_invalid_fresh_minutes_falls_back_to_120(self):
        for value in ("garbage", "nan", "-1"):
            with self.subTest(value=value), patch.dict(os.environ, {"LAUNDRY_FRESH_MINUTES": value}):
                self.assertTrue(self.row("2026-10-30T10:00:00+08:00", "2026-10-30T12:01:00+08:00").stale)

    def test_rebaseline_stale_snapshot_does_not_write_state(self):
        snap = A.Snapshot(self.customers, self.pieces, L.EHANK_SOURCE)
        snap.stale = True
        with patch.object(A, "load_shop_snapshot", return_value=snap), patch.object(A, "_save_state") as save:
            result = A.rebaseline()
        self.assertEqual(result["code"], "STALE_HOLD")
        save.assert_not_called()

    def test_arrival_snapshot_carries_metadata(self):
        row = self.row("2026-10-30T10:00:00+08:00", "2026-10-30T14:00:00+08:00")
        with patch.object(L, "_now_taipei", create=True, return_value=datetime.fromisoformat("2026-10-30T14:00:00+08:00")):
            snap = A.load_shop_snapshot()
        self.assertEqual(snap.data_as_of, row.data_as_of)
        self.assertTrue(snap.stale)

    def test_stale_arrival_holds_before_baseline_or_send_in_both_modes(self):
        snap = A.Snapshot(self.customers, self.pieces, L.EHANK_SOURCE)
        snap.stale = True
        for mode in ("dry_run", "on"):
            with self.subTest(mode=mode), patch.object(A, "load_config", return_value={**A._DEFAULTS, "mode": mode}), \
                    patch.object(A, "_load_state", return_value={"baselined": True}), \
                    patch.object(A, "load_shop_snapshot", return_value=snap), \
                    patch.object(A, "_save_state") as save, patch.object(A, "_append_outbox") as outbox, \
                    patch.object(A, "_dispatch") as send:
                result = A.run_cycle()
                self.assertEqual(result["code"], "STALE_HOLD")
                self.assertEqual(result["http"], 0)
                self.assertEqual(result["cursor"], "unchanged")
                save.assert_not_called()
                outbox.assert_not_called()
                send.assert_not_called()
