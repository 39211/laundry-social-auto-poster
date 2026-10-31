"""B2-8b time-match tests: synthetic files only, stdlib unittest."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import uuid


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "attribution_timematch.py"
_SPEC = importlib.util.spec_from_file_location("attribution_timematch", SCRIPT)
MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(MODULE)

WEEK = "2026-W44"
DAYS = [f"2026-10-{d}" for d in range(26, 32)] + ["2026-11-01"]
TOP_KEYS = {"schema", "week", "generated_at", "label", "method", "timeline_status", "timeline_revision",
            "clicks_coverage", "sources", "totals"}
SOURCE_KEYS = {"source", "clicks", "matched", "matched_new_friend", "matched_returning", "matched_follow_only",
               "matched_I7_received", "matched_I7_pending", "chance_expected", "excess"}
TOTAL_KEYS = {"clicks", "matched", "chance_expected", "inquiries", "unmatched_inquiries", "follows_without_inquiry"}


def stamp(day, hhmm):
    return f"{day}T{hhmm}+08:00"


def entry(first, follow=None, returning=False, i7="received"):
    return {"first_minute": first, "follow_minute": follow, "returning": returning,
            "source_code": "unknown", "I7": i7, "B7": i7}


class TimematchTests(unittest.TestCase):
    def setUp(self):
        # Same pattern as test_weekly_report: inherit the temp dir ACL on Windows.
        self.root = Path(tempfile.gettempdir()) / ("b2-8b-timematch-fixture-" + uuid.uuid4().hex)
        self.root.mkdir()
        self.addCleanup(self.cleanup_fixture)
        self.output = self.root / "data" / "conversions" / f"timematch-{WEEK}.json"

    def cleanup_fixture(self):
        target = self.root.resolve()
        if target.parent != Path(tempfile.gettempdir()).resolve() or not target.name.startswith("b2-8b-timematch-fixture-"):
            raise RuntimeError("Refusing cleanup outside task-owned temporary directory")
        shutil.rmtree(target)

    def write_json(self, rel, value):
        path = self.root / "data" / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def write_clicks(self, rows_by_day=None, skip=(), statuses=None):
        rows_by_day, statuses = rows_by_day or {}, statuses or {}
        for day in DAYS:
            if day in skip:
                continue
            rows = rows_by_day.get(day, [])
            self.write_json(f"leads/clicks/{day}.json", {
                "schema": "line-click-minutes/v1", "date": day, "time_zone": "Asia/Taipei",
                "fetched_at": "2026-11-02T01:00:00.000Z", "status": statuses.get(day, "measured"),
                "rows": [{"minute": m, "source": s, "count": c} for m, s, c in rows],
                "total": sum(c for _, _, c in rows), "daily_ledger_total": None})

    def write_timeline(self, entries=(), follows=(), **overrides):
        doc = {"schema": "inquiry-timeline/v1", "week": WEEK, "tz": "Asia/Taipei",
               "as_of": "2026-11-02T06:00:00+08:00", "revision": 3, "status": "complete",
               "entries": list(entries), "follows_without_inquiry": list(follows)}
        doc.update(overrides)
        self.write_json(f"conversions/inquiry-timeline-{WEEK}.json", doc)

    def run_match(self):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = MODULE.main(["--root", str(self.root), "--week", WEEK])
        doc = json.loads(self.output.read_text(encoding="utf-8")) if self.output.exists() else None
        return code, doc

    @staticmethod
    def source(doc, name):
        return next(row for row in doc["sources"] if row["source"] == name)

    def test_exact_minute_match(self):
        self.write_clicks({"2026-10-27": [(stamp("2026-10-27", "14:03"), "reel-a", 1)]})
        self.write_timeline([entry(stamp("2026-10-27", "14:03"))])
        code, doc = self.run_match()
        self.assertEqual(code, 0)
        row = self.source(doc, "reel-a")
        self.assertEqual((row["clicks"], row["matched"], row["matched_I7_received"]), (1, 1, 1))
        self.assertEqual(doc["totals"]["unmatched_inquiries"], 0)
        self.assertEqual(doc["label"], "推測")

    def test_outside_window_not_matched_and_bounds_inclusive(self):
        self.write_clicks({"2026-10-27": [(stamp("2026-10-27", "14:03"), "reel-a", 1)]})
        self.write_timeline([entry(stamp("2026-10-27", "14:24")), entry(stamp("2026-10-27", "14:00"))])
        _, doc = self.run_match()
        self.assertEqual(self.source(doc, "reel-a")["matched"], 0)
        self.assertEqual(doc["totals"]["unmatched_inquiries"], 2)
        self.write_timeline([entry(stamp("2026-10-27", "14:23"))])
        _, doc = self.run_match()
        self.assertEqual(self.source(doc, "reel-a")["matched"], 1)
        self.write_timeline([entry(stamp("2026-10-27", "14:01"))])
        _, doc = self.run_match()
        self.assertEqual(self.source(doc, "reel-a")["matched"], 1)

    def test_two_clicks_one_inquiry_is_one_match(self):
        self.write_clicks({"2026-10-27": [(stamp("2026-10-27", "14:03"), "reel-a", 2)]})
        self.write_timeline([entry(stamp("2026-10-27", "14:05"))])
        _, doc = self.run_match()
        row = self.source(doc, "reel-a")
        self.assertEqual((row["clicks"], row["matched"]), (2, 1))
        self.assertEqual(doc["totals"]["matched"], 1)

    def test_follow_minute_used_over_first_minute(self):
        self.write_clicks({"2026-10-27": [(stamp("2026-10-27", "14:03"), "reel-a", 1)]})
        self.write_timeline([entry(stamp("2026-10-27", "16:00"), follow=stamp("2026-10-27", "14:05"), i7="pending_window")])
        _, doc = self.run_match()
        row = self.source(doc, "reel-a")
        self.assertEqual(row["matched"], 1)
        self.assertEqual(row["matched_new_friend"], 1)
        self.assertEqual(row["matched_returning"], 0)
        self.assertEqual(row["matched_I7_pending"], 1)

    def test_follow_only_events_matched_and_counted(self):
        self.write_clicks({"2026-10-28": [(stamp("2026-10-28", "11:18"), "ig-a", 1)]})
        self.write_timeline([], follows=[stamp("2026-10-28", "11:20")])
        _, doc = self.run_match()
        row = self.source(doc, "ig-a")
        self.assertEqual((row["matched"], row["matched_follow_only"]), (1, 1))
        self.assertEqual(doc["totals"]["follows_without_inquiry"], 1)
        self.assertEqual(doc["totals"]["inquiries"], 0)
        self.assertEqual(doc["totals"]["unmatched_inquiries"], 0)

    def test_chance_baseline_is_deterministic(self):
        # Only the +120 shift lands on an event (14:00): 1 of 8 shifts -> 0.1.
        self.write_clicks({"2026-10-27": [(stamp("2026-10-27", "12:00"), "reel-a", 1)]})
        self.write_timeline([entry(stamp("2026-10-27", "12:00")), entry(stamp("2026-10-27", "14:00"))])
        _, first = self.run_match()
        _, second = self.run_match()
        row = self.source(first, "reel-a")
        self.assertEqual((row["matched"], row["chance_expected"], row["excess"]), (1, 0.1, 0.9))
        self.assertEqual(first["totals"]["chance_expected"], 0.1)
        first.pop("generated_at")
        second.pop("generated_at")
        self.assertEqual(first, second)

    def test_missing_click_day_is_listed(self):
        self.write_clicks(skip=("2026-10-29",), statuses={"2026-10-30": "timezone_mismatch"})
        self.write_timeline([entry(stamp("2026-10-27", "14:03"))])
        code, doc = self.run_match()
        self.assertEqual(code, 0)
        self.assertEqual(doc["clicks_coverage"], {"days_measured": 5, "missing_days": ["2026-10-29", "2026-10-30"]})

    def test_bad_schema_and_missing_timeline_exit_2(self):
        self.write_clicks()
        code, doc = self.run_match()
        self.assertEqual(code, 2)
        self.assertIsNone(doc)
        self.write_timeline([], schema="inquiry-timeline/v2")
        code, doc = self.run_match()
        self.assertEqual(code, 2)
        self.assertIsNone(doc)

    def test_output_has_only_contract_keys(self):
        self.write_clicks({"2026-10-27": [(stamp("2026-10-27", "14:03"), "reel-a", 1),
                                          (stamp("2026-10-27", "18:00"), "unknown", 1)]})
        self.write_timeline([entry(stamp("2026-10-27", "14:03"))], follows=[stamp("2026-10-28", "09:00")])
        _, doc = self.run_match()
        self.assertEqual(set(doc), TOP_KEYS)
        self.assertEqual(set(doc["method"]), {"before_min", "after_min", "shifts_min"})
        self.assertEqual(set(doc["clicks_coverage"]), {"days_measured", "missing_days"})
        self.assertEqual(set(doc["totals"]), TOTAL_KEYS)
        self.assertEqual(len(doc["sources"]), 2)
        for row in doc["sources"]:
            self.assertEqual(set(row), SOURCE_KEYS)
        self.assertEqual(doc["method"]["shifts_min"], [-180, -120, -90, -60, 60, 90, 120, 180])


if __name__ == "__main__":
    unittest.main(verbosity=2)
