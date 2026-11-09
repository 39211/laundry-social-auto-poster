"""Approved backfill is visible without claiming a missing staff notification."""
import json
from datetime import date
from pathlib import Path
import tempfile
import unittest
from publish_recovery_report import recovery_summary
import level1_gates as lg
from test_level1_gates import POLICY
import test_weekly_report as weekly_fixture


class BackfillRecoveryReports(unittest.TestCase):
    def test_suppressed_notice_keeps_manual_pair_and_resolved_clears_it(self):
        with tempfile.TemporaryDirectory() as temp:
            gates = Path(temp)
            path = gates / "publish-recovery-2026-10-28-slot1-facebook.json"
            record = {"date": "2026-10-28", "slot": 1, "platform": "facebook",
                      "status": "needs_manual", "notification": "suppressed", "backfill_attempts": 1}
            path.write_text(json.dumps(record), encoding="utf-8")
            result = recovery_summary(gates, [date(2026, 10, 28)])
            self.assertEqual(result["manual"], ["10-28 slot1 FB"])
            self.assertEqual(result["pending"], 0)
            self.assertFalse(result["unverified"])
            record["status"] = "resolved"
            path.write_text(json.dumps(record), encoding="utf-8")
            self.assertEqual(recovery_summary(gates, [date(2026, 10, 28)])["text"], "")

    def test_both_operator_reports_include_suppressed_backfill_failure(self):
        fixture = weekly_fixture.WeeklyReportTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.write("gates/publish-recovery-2026-11-01-slot1-facebook.json", {
            "date": "2026-11-01", "slot": 1, "platform": "facebook", "status": "needs_manual",
            "retry_attempts": 0, "backfill_attempts": 1, "reason": "backfill_failed", "notification": "suppressed"
        })
        fixture.write("posted-log/2026-11-01.json", [{"date": "2026-11-01", "slot": 1,
            "platform": "facebook", "status": "uncertain", "dry_run": False}])
        weekly = fixture.report()
        nightly = lg.evaluate_posts(date(2026, 11, 1), POLICY, fixture.data / "posted-log/2026-11-01.json")["reason"]
        for text in (weekly, nightly):
            self.assertIn("需要人處理 1 筆", text)
            self.assertIn("11-01 slot1 FB", text)
            self.assertNotIn("通知送達未驗", text)


if __name__ == "__main__":
    unittest.main()
