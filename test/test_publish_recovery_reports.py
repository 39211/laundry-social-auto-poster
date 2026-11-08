"""Synthetic recovery evidence must reach both operator reports."""
import json
from datetime import date
from pathlib import Path
import tempfile
import unittest
import level1_gates as lg
from test_level1_gates import POLICY
import test_weekly_report as weekly_fixture


class RecoveryReports(unittest.TestCase):
    def test_nightly_names_manual_pair_and_pending_notification(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            posted = root / "data" / "posted-log" / "2026-11-01.json"
            posted.parent.mkdir(parents=True)
            posted.write_text(json.dumps([{"slot": 1, "platform": "facebook", "status": "uncertain", "dry_run": False}]), encoding="utf-8")
            gates = root / "data" / "gates"
            gates.mkdir()
            (gates / "publish-recovery-2026-11-01-slot1-facebook.json").write_text(json.dumps({
                "date": "2026-11-01", "slot": 1, "platform": "facebook", "status": "needs_manual",
                "retry_attempts": 0, "reason": "readback_unknown", "notification": "pending"
            }), encoding="utf-8")
            result = lg.evaluate_posts(date(2026, 11, 1), POLICY, posted)
            self.assertEqual(result["status"], "fail")
            self.assertIn("需要人處理", result["reason"])
            self.assertIn("通知送達未驗", result["reason"])

    def test_weekly_names_manual_pair_even_if_no_schedule_row_exists(self):
        fixture = weekly_fixture.WeeklyReportTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.write("gates/publish-recovery-2026-11-01-slot1-facebook.json", {
            "date": "2026-11-01", "slot": 1, "platform": "facebook", "status": "needs_manual",
            "retry_attempts": 1, "reason": "retry_failed", "notification": "delivered"
        })
        text = fixture.report()
        self.assertIn("需要人處理 1 筆", text)
        self.assertIn("11-01 slot1 FB", text)

    def test_weekly_does_not_hide_unreadable_recovery_evidence(self):
        fixture = weekly_fixture.WeeklyReportTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        path = fixture.data / "gates" / "publish-recovery-2026-11-01-slot1-facebook.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text("{", encoding="utf-8")
        self.assertIn("補發紀錄未驗", fixture.report())

    def test_weekly_includes_live_uncertainty_without_a_recovery_receipt(self):
        fixture = weekly_fixture.WeeklyReportTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.write("posted-log/2026-11-01.json", [{"date": "2026-11-01", "slot": 1,
            "platform": "facebook", "status": "uncertain", "dry_run": False, "created_at": "2026-11-01T03:30:00Z"}])
        self.assertIn("排程狀態未確認 1", fixture.report())
