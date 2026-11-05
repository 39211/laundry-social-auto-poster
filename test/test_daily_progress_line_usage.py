import json
import os
from datetime import date, timedelta
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "daily_progress.py"
TITLE = "### LINE 晚上自動處理率"
TARGET = "2026-11-10"


def write_day(root, day, auto=8, ai=1, staff=1, unknown=0, other=2):
    folder = root / "data" / "line-usage"
    folder.mkdir(parents=True, exist_ok=True)
    by = {"auto": auto, "ai": ai, "to_staff": staff, "not_understood": unknown, "other": other}
    data = {"schema": "line-usage/v1", "date": day, "messages": sum(by.values()), "by_outcome": by,
            "by_intent": {"quote": auto, "ai_answer": ai, "human": staff, "fallback": unknown, "welcome": other}}
    (folder / f"{day}.json").write_text(json.dumps(data), encoding="utf-8")


class DailyLineUsage(unittest.TestCase):
    def run_report(self, days):
        with tempfile.TemporaryDirectory(prefix="l21-daily-") as folder:
            root = Path(folder)
            for day in days:
                write_day(root, day)
            env = os.environ.copy(); env["DAILY_PROGRESS_ROOT"] = str(root)
            run = subprocess.run([sys.executable, "-B", str(SCRIPT), TARGET], env=env,
                                 capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(run.returncode, 0, run.stderr)
            return (root / "reports/daily-progress.md").read_text(encoding="utf-8")

    def section(self, report):
        lines = report.splitlines()
        out = []
        for line in lines[lines.index(TITLE) + 1:]:
            if not line.strip():
                break
            out.append(line)
        return out

    def assert_existing_sections(self, report):
        self.assertIn("| LINE 點擊(GA4) |", report)
        self.assertIn("**結論:", report)

    def test_no_data_says_no_data_never_zero(self):
        report = self.run_report([])
        section = self.section(report)
        self.assertEqual(len(section), 2)
        self.assertTrue(all("還沒有資料" in line for line in section), section)
        self.assertNotIn("%", "\n".join(section))
        self.assert_existing_sections(report)

    def test_partial_week_is_marked_guess(self):
        report = self.run_report([TARGET])
        day_line, week_line = self.section(report)
        self.assertIn("bot 自己處理 90%", day_line)
        self.assertIn("轉店員 1、沒聽懂 0", day_line)
        self.assertNotIn("推測", day_line)
        self.assertIn("推測", week_line)
        self.assertIn("7 天中只有 1 天有資料", week_line)
        self.assert_existing_sections(report)

    def test_full_week(self):
        end = date.fromisoformat(TARGET)
        report = self.run_report([(end - timedelta(days=i)).isoformat() for i in range(7)])
        day_line, week_line = self.section(report)
        self.assertIn("bot 自己處理 90%（自動 56 + AI 7，共 70 則文字訊息）", week_line)
        self.assertIn("轉店員 7、沒聽懂 0", week_line)
        self.assertNotIn("推測", day_line + week_line)
        self.assert_existing_sections(report)


if __name__ == "__main__": unittest.main()
