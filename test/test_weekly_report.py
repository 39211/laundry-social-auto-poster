"""B3 integration tests: synthetic files only; Python 3.14 standard library."""

import hashlib
from contextlib import redirect_stderr
import io
import json
import os
from pathlib import Path
import shutil
import runpy
import subprocess
import sys
import tempfile
import unittest
import uuid


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "weekly-report.py"
AS_OF = "2026-11-02T08:00:00+08:00"
EVENTS = {
    "view_knowledge_hub": 1, "view_search_answer": 2, "view_service": 3,
    "click_answer_from_hub": 1, "click_service_from_hub": 1,
    "click_service_from_answer": 1, "click_phone": 1, "click_line_cta": 2,
    "view_article": 4, "click_service_from_article": 1, "line_click": 3,
}


class WeeklyReportTests(unittest.TestCase):
    def setUp(self):
        # Inherit the Windows temp ACL: Python's mode=0o700 temporary directory
        # excludes this managed sandbox's restricted token on this machine.
        self.root = Path(tempfile.gettempdir()) / ("b3-weekly-fixture-" + uuid.uuid4().hex)
        self.root.mkdir()
        self.addCleanup(self.cleanup_fixture)
        self.data = self.root / "data"
        self.bot = self.root / "line-bot"
        self.reports = self.root / "reports"
        self.bot.mkdir()
        self.reports.mkdir()
        for name in ("posted-log", "scheduled-log", "approved-log",
                     "feature-posted-log", "youtube-log", "leads", "insights",
                     "conversions", "ga4-exports", "run-locks", "publish-locks"):
            (self.data / name).mkdir(parents=True)
        days = {}
        for n in range(19, 33):
            day = f"2026-10-{n:02}" if n <= 31 else "2026-11-01"
            current = n >= 26
            days[day] = {
                "line_clicks_total": 3 if current else 2,
                "line_clicks_recorded_at": f"{day}T23:00:00+08:00",
                "source_clicks_status": "measured",
                "search_funnel_status": "measured",
                "source_clicks": {"yt": 2, "home-cta": 1} if current else {"yt": 1, "home-cta": 1},
                "search_funnel_events": EVENTS if current else {k: 1 for k in EVENTS},
            }
        self.write("leads/2026-10.json", {"month": "2026-10", "days": {k: v for k, v in days.items() if k.startswith("2026-10")}})
        self.write("leads/2026-11.json", {"month": "2026-11", "days": {"2026-11-01": days["2026-11-01"]}})
        self.write("posted-log/2026-10-26.json", [
            {"date": "2026-10-26", "slot": 1, "platform": "facebook", "status": "success", "dry_run": False, "post_id": "fb1", "created_at": "2026-10-26T03:30:00Z"},
            {"date": "2026-10-26", "slot": 1, "platform": "facebook", "status": "success", "dry_run": False, "post_id": "fb1", "created_at": "2026-10-26T03:30:00Z"},
            {"date": "2026-10-26", "slot": 1, "platform": "instagram", "status": "success", "dry_run": True, "post_id": "preview", "created_at": "2026-10-26T03:30:00Z"},
            {"date": "2026-10-26", "slot": 2, "platform": "instagram", "status": "failed", "dry_run": False, "created_at": "2026-10-26T12:30:00Z"},
        ])
        self.write("posted-log/2026-10-27.json", [
            {"date": "2026-10-27", "slot": 1, "platform": "instagram", "status": "success", "dry_run": False, "post_id": "ig1", "created_at": "2026-10-27T03:30:00Z"},
        ])
        self.write("scheduled-log/2026-10-26.json", [
            {"date": "2026-10-26", "slot": 1, "platform": "facebook", "scheduled_post_id": "fb1", "scheduled_publish_time": 1792985400, "created_at": "2026-10-23T13:40:00Z"},
        ])
        self.write("scheduled-log/2026-10-27.json", [
            {"date": "2026-10-27", "slot": 2, "platform": "instagram", "status": "failed", "error": "synthetic", "created_at": "2026-10-27T12:00:00Z"},
        ])
        feature = {"platform": "facebook", "slug": "feature-a", "status": "scheduled", "post_id": "feature-fb", "scheduled_publish_at": "2026-10-28T06:00:00Z", "at": "2026-10-23T10:00:00Z"}
        self.write("feature-posted-log/2026-10-28.json", [feature, feature, {"platform": "instagram", "slug": "feature-a", "status": "success", "post_id": "feature-ig", "at": "2026-10-28T06:00:30Z"}])
        self.write("youtube-log/2026-10-29.json", [{"date": "2026-10-29", "slot": 2, "video_id": "yt-live", "uploaded_at": "2026-10-29T13:00:00Z"}])
        self.write("youtube-log/2026-10-30.json", [{"date": "2026-10-30", "slot": 2, "video_id": "yt-scheduled", "uploaded_at": "2026-10-27T13:00:00Z", "scheduled_publish_at": "2026-10-30T13:15:00Z", "video_status": "scheduled"}])
        self.write("approved-log/2026-10-31.json", [{"date": "2026-10-31", "slot": 1, "platform": "facebook", "status": "approved"}])
        (self.bot / "line_webhook.err").write_text("", encoding="utf-8")

    def write(self, name, value):
        path = self.data / name
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def invoke(self, *extra, week="2026-W44", as_of=AS_OF):
        cmd = [sys.executable, "-B", "-X", "utf8", str(SCRIPT), "--data-root", str(self.data),
               "--reports-root", str(self.reports), "--line-bot-dir", str(self.bot), "--as-of", as_of]
        if week is not None:
            cmd.extend(["--week", week])
        return subprocess.run(cmd + list(extra), capture_output=True, text=True, encoding="utf-8", timeout=15)

    def report(self, *extra, **kwargs):
        result = self.invoke("--dry-run", *extra, **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_publication_tables_deduplicate_and_separate_scheduled_live_failed(self):
        report = self.report()
        self.assertIn("| FB | 2 | 1 | 0 |", report)
        self.assertIn("| IG | 0 | 2 | 2 |", report)
        self.assertIn("| YT | 1 | 1 | 0 |", report)
        self.assertRegex(report, r"\| TikTok \| 未知")

    def test_month_boundary_metrics_and_week_over_week_delta(self):
        report = self.report()
        self.assertIn("| LINE 點擊 | 21（+7） |", report)
        self.assertIn("| 搜尋：答案頁瀏覽 | 14（+7） |", report)
        self.assertIn("| 搜尋：服務頁瀏覽 | 21（+14） |", report)
        self.assertIn("| 搜尋：文章瀏覽 | 28（+21） |", report)
        self.assertIn("| 來源：yt | 14（+7） |", report)

    def test_missing_day_is_unknown_and_not_a_padded_zero(self):
        obj = json.loads((self.data / "leads/2026-11.json").read_text(encoding="utf-8"))
        obj["days"].clear()
        self.write("leads/2026-11.json", obj)
        report = self.report()
        self.assertRegex(report, r"\| LINE 點擊 \| 未知[^\n]*6/7[^\n]*18")
        self.assertNotIn("| LINE 點擊 | 18（", report)
        self.assertNotIn("| 來源：yt | 12（", report)

    def test_unmeasured_status_overrides_existing_numbers(self):
        obj = json.loads((self.data / "leads/2026-10.json").read_text(encoding="utf-8"))
        for date, day in obj["days"].items():
            if date >= "2026-10-26":
                day["source_clicks_status"] = "unmeasured"
                day["search_funnel_status"] = "unmeasured"
        self.write("leads/2026-10.json", obj)
        self.assertRegex(self.report(), r"\| LINE 點擊 \| 未知")

    def test_measured_zero_is_distinct_from_unknown(self):
        for filename in ("2026-10.json", "2026-11.json"):
            obj = json.loads((self.data / "leads" / filename).read_text(encoding="utf-8"))
            for day in obj["days"].values():
                day["line_clicks_total"] = 0
                day["source_clicks"] = {}
                day["search_funnel_events"] = {k: 0 for k in EVENTS}
            self.write("leads/" + filename, obj)
        self.assertIn("| LINE 點擊 | 0（+0） |", self.report())

    def test_current_week_compares_matching_completed_days(self):
        report = self.report(as_of="2026-10-30T10:00:00+08:00")
        self.assertIn("本週未結束", report)
        self.assertIn("4/7", report)
        self.assertIn("| LINE 點擊 | 12（+4） |", report)

    def test_utc_timestamp_uses_taipei_week_boundary(self):
        self.write("posted-log/2026-11-01.json", [{"date": "2026-11-01", "slot": 2, "platform": "facebook", "status": "success", "post_id": "late", "created_at": "2026-11-01T16:05:00Z"}])
        self.assertIn("| FB | 2 | 1 | 0 |", self.report())

    def test_uncertain_schedule_is_neither_success_nor_failure(self):
        self.write("scheduled-log/2026-10-28.json", [{"date": "2026-10-28", "slot": 1, "platform": "facebook", "scheduled_post_id": "", "status": "uncertain", "error": "timeout", "scheduled_publish_time": 1793158200, "created_at": "2026-10-25T13:00:00Z"}])
        report = self.report()
        self.assertIn("| FB | 2（另 1 未確認） | 1 | 0 |", report)
        self.assertIn("排程狀態未確認 1", report)

    def test_anomalies_count_timestamped_events_and_do_not_use_log_mtime(self):
        (self.bot / "line_webhook.err").write_text("2026-10-27 09:00:00 ERROR webhook failed\nTraceback (most recent call last):\nValueError: secret-customer-data\n2026-10-27 09:01:00 INFO healthy\n2026-10-28T10:00:00+08:00 ERROR webhook failed\n2026-10-18 10:00:00 ERROR old\n", encoding="utf-8")
        self.write("publish-locks/old.lock", {"started_at": "2026-10-26T01:00:00+08:00"})
        self.write("run-locks/active.lock", {"started_at": "2026-11-02T07:55:00+08:00"})
        report = self.report()
        self.assertIn("| 失敗排程 | 1 | 2026-10-27 20:00 +08:00 |", report)
        self.assertIn("| 鎖檔殘留（目前快照） | 1 | 2026-10-26 01:00 +08:00 |", report)
        self.assertIn("| webhook 錯誤 | 2 | 2026-10-28 10:00 +08:00 |", report)
        self.assertNotIn("secret-customer-data", report)

    def test_undated_error_log_is_unknown_not_zero(self):
        (self.bot / "line_webhook.err").write_text("Traceback (most recent call last):\nValueError: private\n", encoding="utf-8")
        self.assertRegex(self.report(), r"\| webhook 錯誤 \| 未知[^\n]*無時間")

    def test_dry_run_does_not_create_output_or_modify_inputs(self):
        before = self.fingerprints()
        out = self.root / "not-created"
        self.report("--out", str(out))
        self.assertFalse(out.exists())
        self.assertEqual(self.fingerprints(), before)

    def test_out_writes_week_filename_and_matches_dry_run(self):
        out = self.root / "weekly"
        expected = self.report()
        result = self.invoke("--out", str(out))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((out / "2026-W44.md").read_text(encoding="utf-8"), expected)

    def test_rejects_output_inside_read_only_source(self):
        result = self.invoke("--out", str(self.data / "generated"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("唯讀資料", result.stderr)
        self.assertFalse((self.data / "generated").exists())

    def test_invalid_iso_week_is_rejected(self):
        result = self.invoke("--dry-run", week="2026-W54")
        self.assertEqual(result.returncode, 2)
        self.assertIn("ISO 週", result.stderr)

    def test_default_week_is_last_complete_week_across_year(self):
        report = self.report(week=None, as_of="2027-01-04T08:00:00+08:00")
        self.assertIn("2026-W53", report)
        self.assertIn("2026-12-28", report)
        self.assertIn("2027-01-03", report)

    def test_llm_is_a_reserved_switch_and_report_at_most_60_lines(self):
        report = self.report("--llm")
        self.assertIn("未呼叫 API", report)
        self.assertIn("工時:見 B4 工時表", report)
        self.assertLessEqual(len(report.splitlines()), 60)
        self.assertIn("下週建議三件事", report)
        self.assertEqual(sum(line.startswith(("1. ", "2. ", "3. ")) for line in report.splitlines()), 3)

    def test_malformed_source_is_reported_as_unknown_without_traceback(self):
        (self.data / "leads/2026-11.json").write_text("{broken", encoding="utf-8")
        report = self.report()
        self.assertRegex(report, r"\| LINE 點擊 \| 未知")
        self.assertIn("JSON", report)
        self.assertNotIn("Traceback", report)

    def test_missing_publication_ledgers_does_not_claim_zero_in_conclusion(self):
        for name in ("posted-log", "scheduled-log", "feature-posted-log", "youtube-log"):
            shutil.rmtree(self.data / name)
        report = self.report()
        self.assertIn("一句話結論：發文未知", report)
        self.assertNotIn("本機成功發文紀錄 0 篇", report)
        self.assertRegex(report, r"\| FB \| 未知[^\n]*\| 未知")

    def test_cancelled_schedule_is_not_counted_as_an_accepted_schedule(self):
        self.write("scheduled-log/2026-10-29.json", [{"date": "2026-10-29", "slot": 2, "platform": "facebook", "status": "cancelled", "scheduled_post_id": "cancelled-post", "scheduled_publish_at": "2026-10-29T12:30:00Z", "created_at": "2026-10-26T10:00:00Z"}])
        self.assertIn("| FB | 2 | 1 | 0 |", self.report())

    def test_failed_exclusive_output_creation_preserves_preexisting_file(self):
        out = self.root / "weekly"
        out.mkdir()
        occupied = out / f"2026-W44.md.tmp-{os.getpid()}"
        occupied.write_text("pre-existing unrelated content", encoding="utf-8")
        main = runpy.run_path(str(SCRIPT))["main"]
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            main(["--week", "2026-W44", "--data-root", str(self.data), "--reports-root", str(self.reports), "--line-bot-dir", str(self.bot), "--as-of", AS_OF, "--out", str(out)])
        self.assertEqual(raised.exception.code, 2)
        self.assertTrue(occupied.exists(), "A failed exclusive create must not delete somebody else's file")
        self.assertEqual(occupied.read_text(encoding="utf-8"), "pre-existing unrelated content")

    def fingerprints(self):
        return {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.root.rglob("*") if p.is_file()}

    def cleanup_fixture(self):
        target = self.root.resolve()
        if target.parent != Path(tempfile.gettempdir()).resolve() or not target.name.startswith("b3-weekly-fixture-"):
            raise RuntimeError("Refusing cleanup outside task-owned temporary directory")
        shutil.rmtree(target)


if __name__ == "__main__":
    unittest.main(verbosity=2)
