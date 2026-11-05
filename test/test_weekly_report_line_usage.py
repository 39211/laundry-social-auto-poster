"""L2-2: 「LINE 晚上自動處理率」 in the Monday weekly report; synthetic files only, stdlib."""

from datetime import date, datetime, timedelta
import json
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock
import uuid


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "weekly-report.py"


def load_weekly_report():
    """Load scripts/weekly-report.py as a module (no bytecode written) so MAX_LINES can be patched."""
    module = types.ModuleType("weekly_report_line_usage_under_test")
    module.__file__ = str(SCRIPT)
    sys.modules[module.__name__] = module  # the script's dataclass looks its module up
    exec(compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec"), module.__dict__)
    return module


WR = load_weekly_report()
WEEK = "2026-W45"
MONDAY = date.fromisocalendar(2026, 45, 1)          # 2026-11-02
NOW = datetime(2026, 11, 10, 12, 0, tzinfo=WR.TAIPEI)     # W45 fully completed
MIDWEEK = datetime(2026, 11, 5, 10, 0, tzinfo=WR.TAIPEI)  # 3 completed days: 11-02..11-04
PREFIX = WR.LINE_USAGE_TITLE + "："
PERIOD = "本週已結束 7 日（2026-11-02～2026-11-08）"
MISSING_CONVERSIONS = "來源→收件：尚無資料（exporter 未產出）"
ANOMALY_HEADER = "| 異常 | 次數／筆數 | 最後一次時間 |"


class WeeklyReportLineUsageTests(unittest.TestCase):
    def setUp(self):
        # Same fixture location rule as test_weekly_report.py (inherit the Windows temp ACL).
        self.root = Path(tempfile.gettempdir()) / ("l22-weekly-fixture-" + uuid.uuid4().hex)
        self.root.mkdir()
        self.addCleanup(self.cleanup_fixture)
        self.data = self.root / "data"
        self.data.mkdir()

    def cleanup_fixture(self):
        target = self.root.resolve()
        if target.parent != Path(tempfile.gettempdir()).resolve() or not target.name.startswith("l22-weekly-fixture-"):
            raise RuntimeError("Refusing cleanup outside task-owned temporary directory")
        shutil.rmtree(target)

    def write_day(self, day, auto=8, ai=1, staff=1, unknown=0, other=2):
        folder = self.data / "line-usage"
        folder.mkdir(exist_ok=True)
        by = {"auto": auto, "ai": ai, "to_staff": staff, "not_understood": unknown, "other": other}
        doc = {"schema": "line-usage/v1", "date": day.isoformat(), "messages": sum(by.values()),
               "by_outcome": by,
               "by_intent": {"quote": auto, "ai_answer": ai, "human": staff, "fallback": unknown, "welcome": other}}
        (folder / f"{day.isoformat()}.json").write_text(json.dumps(doc), encoding="utf-8")

    def report(self, week=WEEK, now=NOW):
        text = WR.build_report(self.data, self.root / "reports", self.root / "line-bot", week, now)
        lines = text.splitlines()
        self.assertLessEqual(len(lines), WR.MAX_LINES)
        return lines

    def usage_line(self, lines):
        found = [i for i, line in enumerate(lines) if line.startswith(PREFIX)]
        self.assertEqual(len(found), 1, "\n".join(lines))
        return found[0], lines[found[0]]

    def assert_placement(self, lines, index):
        # Blank + one line, after the metrics tables and directly before 來源→收件.
        self.assertEqual(lines[index - 1], "")
        self.assertTrue(lines[index - 2].startswith("| 來源前 5"), lines[index - 2])
        self.assertEqual(lines[index + 1:index + 3], ["", MISSING_CONVERSIONS])

    def test_no_data(self):
        for name, prepare in (("no folder", lambda: None),
                              ("empty folder", lambda: (self.data / "line-usage").mkdir(exist_ok=True))):
            with self.subTest(name=name):
                prepare()
                lines = self.report()
                index, line = self.usage_line(lines)
                self.assertEqual(line, f"{PREFIX}最近一天 2026-11-08：還沒有資料。{PERIOD}：還沒有資料。")
                self.assertNotIn("%", line)
                self.assert_placement(lines, index)
        # A week with no completed day yet (future week).
        _, line = self.usage_line(self.report(week="2026-W47"))
        self.assertEqual(line, f"{PREFIX}本週還沒有已結束的日期")
        self.assertNotIn("%", line)

    def test_partial_week(self):
        for offset in (0, 1, 6):
            self.write_day(MONDAY + timedelta(days=offset))
        lines = self.report()
        index, line = self.usage_line(lines)
        self.assertEqual(line, f"{PREFIX}最近一天 2026-11-08：bot 自己處理 90%（自動 8 + AI 1，共 10 則文字訊息）；"
                               f"轉店員 1、沒聽懂 0。{PERIOD}：推測：bot 自己處理 90%（自動 24 + AI 3，共 30 則文字訊息）；"
                               f"轉店員 3、沒聽懂 0（7 天中只有 3 天有資料）。")
        self.assert_placement(lines, index)
        # Mid-week: only completed days count; the Sunday file (future at that time) is ignored,
        # and a missing last day is 還沒有資料, not 0%.
        _, line = self.usage_line(self.report(now=MIDWEEK))
        self.assertEqual(line, f"{PREFIX}最近一天 2026-11-04：還沒有資料。本週已結束 3 日（2026-11-02～2026-11-04）："
                               f"推測：bot 自己處理 90%（自動 16 + AI 2，共 20 則文字訊息）；"
                               f"轉店員 2、沒聽懂 0（3 天中只有 2 天有資料）。")
        self.assertNotIn("0%（", line.replace("90%（", ""))

    def test_normal_week(self):
        for offset in range(6):
            self.write_day(MONDAY + timedelta(days=offset))
        self.write_day(MONDAY + timedelta(days=6), auto=5, ai=2, staff=2, unknown=1, other=0)
        lines = self.report()
        index, line = self.usage_line(lines)
        self.assertEqual(line, f"{PREFIX}最近一天 2026-11-08：bot 自己處理 70%（自動 5 + AI 2，共 10 則文字訊息）；"
                               f"轉店員 2、沒聽懂 1。{PERIOD}：bot 自己處理 87%（自動 53 + AI 8，共 70 則文字訊息）；"
                               f"轉店員 8、沒聽懂 1。")
        self.assertNotIn("推測", line)
        self.assert_placement(lines, index)

    def test_adding_line_usage_files_changes_only_the_line_usage_line(self):
        before = self.report()
        index, _ = self.usage_line(before)
        for offset in range(7):
            self.write_day(MONDAY + timedelta(days=offset))
        after = self.report()
        self.assertEqual(len(after), len(before))
        self.assertEqual([i for i, (a, b) in enumerate(zip(before, after)) if a != b], [index])
        self.assertIn("bot 自己處理 90%", after[index])
        # An unreadable day file is 未知, never 0%, and still changes nothing else.
        shutil.rmtree(self.data / "line-usage")
        (self.data / "line-usage").mkdir()
        (self.data / "line-usage" / "2026-11-08.json").write_text("{broken", encoding="utf-8")
        broken = self.report()
        self.assertEqual(len(broken), len(before))
        self.assertEqual([i for i, (a, b) in enumerate(zip(before, broken)) if a != b], [index])
        self.assertIn("未知（1 天的檔案無法讀取，不補 0）", broken[index])
        self.assertNotIn("%", broken[index])

    def test_no_room_moves_the_line_to_the_warnings_line(self):
        self.write_day(MONDAY)
        normal = self.report()
        index, _ = self.usage_line(normal)
        head = normal[:index - 1]
        tail_size = len(normal) - (normal.index(ANOMALY_HEADER) - 1)
        limit = len(head) + 2 + tail_size  # metrics + 來源→收件 one-liner + tail: nothing left
        with mock.patch.object(WR, "MAX_LINES", limit):
            squeezed = self.report()
        self.assertFalse(any(line.startswith(PREFIX) for line in squeezed))
        self.assertEqual(squeezed[:len(head)], head)
        self.assertEqual(squeezed[len(head):len(head) + 2], ["", MISSING_CONVERSIONS])
        warnings = next(line for line in squeezed if line.startswith("讀取問題："))
        self.assertIn(PREFIX + PERIOD + "：推測：bot 自己處理 90%", warnings)
        view = WR.line_usage_view(self.data, [MONDAY])
        self.assertEqual(WR.fit_line_usage(view, 1), [])
        self.assertEqual(WR.fit_line_usage(view, 2), ["", view["line"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
