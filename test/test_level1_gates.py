# -*- coding: utf-8 -*-
"""Unit tests for scripts/level1_gates.py. Temp dirs, injected paths and clock; no real data.

Uses the real opening-hours helpers (line-bot/tunnel_manager.py, code only) with a
test handover config written into the temp dir.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
import level1_gates as lg  # noqa: E402

TPE = timezone(timedelta(hours=8))
FRIDAY = date(2026, 10, 30)    # default hours 10:00-20:00
SATURDAY = date(2026, 10, 31)  # override 12:00-18:00
SUNDAY = date(2026, 11, 1)     # closed (null)
NOW = datetime(2026, 11, 2, 1, 0, tzinfo=TPE)

HANDOVER = {
    "day_start": "10:00",
    "day_end": "20:00",
    "days": {"5": ["12:00", "18:00"], "6": None},
    "night_takeover_delay_min": 5,
    "tz": "Asia/Taipei",
}
POLICY = {
    "status": "active",
    "start_date": "2026-07-18",
    "end_date": "2027-01-06",
    "timezone": "Asia/Taipei",
    "platforms": ["facebook", "instagram"],
    "slots": [{"slot": 1, "time": "11:30"}, {"slot": 2, "time": "20:30"}],
}


def find_hours_module():
    candidates = [REPO / "line-bot" / "tunnel_manager.py"]
    env = os.environ.get("LEVEL1_GATES_ROOT")
    if env:
        candidates.append(Path(env) / "line-bot" / "tunnel_manager.py")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError("line-bot/tunnel_manager.py not found; run from the laundry repo "
                       "or set LEVEL1_GATES_ROOT")


def at(day, hhmm):
    hour, minute = map(int, hhmm.split(":"))
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TPE)


def post_row(day, slot, platform, status="success", dry_run=False):
    return {"date": day.isoformat(), "slot": slot, "platform": platform,
            "status": status, "dry_run": dry_run, "attempts": 1}


def all_success_rows(day, slots=(1, 2)):
    return [post_row(day, s, p) for s in slots for p in ("facebook", "instagram")]


def pull_row(when, result="REPLACED", exit_code=0):
    return {"ts": when.isoformat(), "result": result, "bytes": 1,
            "source_mtime": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "exit": exit_code}


def times_with_gap(day, gap_start, gap_minutes, open_="10:00", close="20:00"):
    times = []
    step = timedelta(minutes=30)
    current = at(day, open_)
    while current <= gap_start:
        times.append(current)
        current += step
    current = gap_start + timedelta(minutes=gap_minutes)
    end = at(day, close)
    while current <= end:
        times.append(current)
        current += step
    return times


def ev(day, freshness="pass", notify="pass", posts="pass"):
    statuses = dict(zip(lg.CONDITIONS, (freshness, notify, posts)))
    return {"date": day.isoformat(),
            "conditions": {c: {"status": s, "reason": "x", "details": {}} for c, s in statuses.items()}}


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hours_path = find_hours_module()
        cls.hours = lg.load_hours_module(cls.hours_path)
        cls.config = cls.hours._validate_config(json.loads(json.dumps(HANDOVER)))

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="level1-gates-test-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)

    def write_json(self, rel, obj):
        path = self.tmp / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        return path

    def write_pulls(self, rows, rel="localappdata/line-bot/mdb_pull.jsonl"):
        path = self.tmp / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        return path

    def posts(self, day, rows, policy=None):
        path = self.write_json("data/posted-log/{0}.json".format(day.isoformat()), rows)
        return lg.evaluate_posts(day, POLICY if policy is None else policy, path)

    def freshness(self, day, pull_rows):
        path = self.write_pulls(pull_rows)
        return lg.evaluate_freshness(day, self.config, self.hours, lg.read_pull_log(path))


class PostsTests(Base):
    def test_all_success_passes(self):
        result = self.posts(FRIDAY, all_success_rows(FRIDAY))
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["details"]["scheduled"], 4)

    def test_one_slot_failed_fails_with_reason(self):
        rows = [r for r in all_success_rows(FRIDAY) if not (r["slot"] == 2 and r["platform"] == "instagram")]
        rows.append(post_row(FRIDAY, 2, "instagram", status="failed"))
        result = self.posts(FRIDAY, rows)
        self.assertEqual(result["status"], "fail")
        self.assertIn("slot 2 IG 沒成功", result["reason"])

    def test_missing_slot_reported(self):
        rows = [r for r in all_success_rows(FRIDAY) if r["slot"] != 1 or r["platform"] != "facebook"]
        result = self.posts(FRIDAY, rows)
        self.assertEqual(result["status"], "fail")
        self.assertIn("slot 1 FB 沒有紀錄", result["reason"])

    def test_retry_success_counts(self):
        rows = [r for r in all_success_rows(FRIDAY) if not (r["slot"] == 2 and r["platform"] == "instagram")]
        rows.append(post_row(FRIDAY, 2, "instagram", status="failed"))
        rows.append(post_row(FRIDAY, 2, "instagram", status="success"))
        self.assertEqual(self.posts(FRIDAY, rows)["status"], "pass")

    def test_dry_run_rows_ignored(self):
        rows = [r for r in all_success_rows(FRIDAY) if not (r["slot"] == 2 and r["platform"] == "instagram")]
        rows.append(post_row(FRIDAY, 2, "instagram", status="success", dry_run=True))
        result = self.posts(FRIDAY, rows)
        self.assertEqual(result["status"], "fail")
        self.assertIn("slot 2 IG 沒有紀錄", result["reason"])

    def test_paused_slot_not_required(self):
        policy = json.loads(json.dumps(POLICY))
        policy["slots"].append({"slot": 3, "time": "12:00", "paused": True})
        self.assertEqual(self.posts(FRIDAY, all_success_rows(FRIDAY), policy)["status"], "pass")

    def test_unpaused_extra_slot_is_required(self):
        policy = json.loads(json.dumps(POLICY))
        policy["slots"].append({"slot": 3, "time": "12:00"})
        result = self.posts(FRIDAY, all_success_rows(FRIDAY), policy)
        self.assertEqual(result["status"], "fail")
        self.assertIn("slot 3 FB 沒有紀錄", result["reason"])

    def test_pause_window(self):
        policy = json.loads(json.dumps(POLICY))
        policy["pauses"] = [{"slot": 2, "platform": "instagram", "from": "2026-10-29", "to": "2026-10-30"}]
        rows = [r for r in all_success_rows(FRIDAY) if not (r["slot"] == 2 and r["platform"] == "instagram")]
        self.assertEqual(self.posts(FRIDAY, rows, policy)["status"], "pass")

    def test_no_scheduled_slot_is_not_required(self):
        policy = json.loads(json.dumps(POLICY))
        policy["end_date"] = "2026-10-01"
        self.assertEqual(self.posts(FRIDAY, [], policy)["status"], "not_required")

    def test_missing_log_is_no_data(self):
        result = lg.evaluate_posts(FRIDAY, POLICY, self.tmp / "nope.json")
        self.assertEqual(result["status"], "no_data")

    def test_unreadable_policy_is_no_data(self):
        path = self.write_json("data/posted-log/x.json", all_success_rows(FRIDAY))
        self.assertEqual(lg.evaluate_posts(FRIDAY, None, path)["status"], "no_data")
        self.assertEqual(lg.evaluate_posts(FRIDAY, {"platforms": []}, path)["status"], "no_data")


class PlannedSlotTests(Base):
    """Commander fix: a paused policy slot (no content produced that day) is not required."""
    def _assets(self, *slots):
        folder = self.tmp / "assets" / FRIDAY.isoformat()
        folder.mkdir(parents=True, exist_ok=True)
        for s in slots:
            (folder / "slot-{0:02d}.png".format(s)).write_bytes(b"x")
        return self.tmp / "assets"

    def test_unproduced_slot_not_required(self):
        pairs, _ = lg.scheduled_pairs(POLICY, FRIDAY)
        produced = sorted({p[0] for p in pairs})
        keep = produced[:1]
        rows = [{"date": FRIDAY.isoformat(), "slot": s, "platform": pl, "status": "success", "dry_run": False}
                for (s, pl) in pairs if s in keep]
        path = self.tmp / "log.json"
        path.write_text(json.dumps(rows), encoding="utf-8")
        result = lg.evaluate_posts(FRIDAY, POLICY, path, assets_root=self._assets(*keep))
        self.assertEqual(result["status"], "pass", result)

    def test_produced_but_unposted_slot_still_fails(self):
        pairs, _ = lg.scheduled_pairs(POLICY, FRIDAY)
        produced = sorted({p[0] for p in pairs})
        path = self.tmp / "log.json"
        path.write_text(json.dumps([]), encoding="utf-8")
        result = lg.evaluate_posts(FRIDAY, POLICY, path, assets_root=self._assets(*produced))
        self.assertEqual(result["status"], "fail", result)

    def test_no_assets_folder_keeps_policy(self):
        path = self.tmp / "log.json"
        path.write_text(json.dumps([]), encoding="utf-8")
        result = lg.evaluate_posts(FRIDAY, POLICY, path, assets_root=self.tmp / "no-assets")
        self.assertEqual(result["status"], "fail", result)


class FreshnessTests(Base):
    def test_gap_59_minutes_passes(self):
        times = times_with_gap(FRIDAY, at(FRIDAY, "13:00"), 59)
        result = self.freshness(FRIDAY, [pull_row(t, "UNCHANGED") for t in times])
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["details"]["max_gap_minutes"], 59)

    def test_gap_61_minutes_fails(self):
        times = times_with_gap(FRIDAY, at(FRIDAY, "13:00"), 61)
        rows = [pull_row(t) for t in times]
        rows.append(pull_row(at(FRIDAY, "13:30"), "SOURCE_CHANGED", 3))  # not a success
        rows.append(pull_row(at(FRIDAY, "13:40"), "ERROR", 1))
        result = self.freshness(FRIDAY, rows)
        self.assertEqual(result["status"], "fail")
        self.assertIn("營業時間內最大資料間隔 61 分", result["reason"])

    def test_gap_from_opening_counts(self):
        times = [at(FRIDAY, "11:05")] + times_with_gap(FRIDAY, at(FRIDAY, "11:05"), 30, open_="11:35")[1:]
        result = self.freshness(FRIDAY, [pull_row(t) for t in times])
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["details"]["max_gap_minutes"], 65)

    def test_saturday_override_hours_used(self):
        times = times_with_gap(SATURDAY, at(SATURDAY, "12:00"), 30, open_="12:00", close="18:00")
        self.assertEqual(self.freshness(SATURDAY, [pull_row(t) for t in times])["status"], "pass")

    def test_closed_sunday_not_required(self):
        result = lg.evaluate_freshness(SUNDAY, self.config, self.hours, None)
        self.assertEqual(result["status"], "not_required")

    def test_no_log_is_no_data(self):
        result = lg.evaluate_freshness(FRIDAY, self.config, self.hours, None)
        self.assertEqual(result["status"], "no_data")

    def test_log_not_covering_day_is_no_data(self):
        result = self.freshness(FRIDAY, [pull_row(at(FRIDAY, "09:00"))])
        self.assertEqual(result["status"], "no_data")

    def test_no_success_in_window_fails(self):
        rows = [pull_row(at(FRIDAY, "12:00"), "SOURCE_CHANGED", 3), pull_row(at(SATURDAY, "12:00"))]
        result = self.freshness(FRIDAY, rows)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["details"]["max_gap_minutes"], 600)


class NotifyTests(Base):
    def notify(self, day, payload=None):
        path = self.tmp / "data" / "gates" / "notify-{0}.json".format(day.isoformat())
        if payload is not None:
            self.write_json("data/gates/notify-{0}.json".format(day.isoformat()), payload)
        return lg.evaluate_notify(day, self.config, self.hours, path)

    def test_no_file_is_no_data_never_pass(self):
        result = self.notify(FRIDAY)
        self.assertEqual(result["status"], "no_data")
        self.assertNotEqual(result["status"], "pass")
        self.assertNotIn("sent", result["details"])
        self.assertNotIn("wrong_sends", result["details"])

    def test_report_zero_wrong_passes(self):
        result = self.notify(FRIDAY, {"date": "2026-10-30", "sent": 5, "wrong_sends": 0, "reported_by": "shop-pc"})
        self.assertEqual(result["status"], "pass")

    def test_report_wrong_send_fails(self):
        result = self.notify(FRIDAY, {"date": "2026-10-30", "sent": 5, "wrong_sends": 2, "reported_by": "shop-pc"})
        self.assertEqual(result["status"], "fail")
        self.assertIn("誤發 2 則", result["reason"])

    def test_bad_report_is_no_data(self):
        for payload in ({"date": "2026-10-29", "sent": 5, "wrong_sends": 0, "reported_by": "x"},
                        {"date": "2026-10-30", "sent": True, "wrong_sends": 0, "reported_by": "x"},
                        {"date": "2026-10-30", "sent": 5, "wrong_sends": None, "reported_by": "x"},
                        {"date": "2026-10-30", "sent": 5, "wrong_sends": 0}):
            self.assertEqual(self.notify(FRIDAY, payload)["status"], "no_data", payload)

    def test_closed_day_not_required(self):
        self.assertEqual(self.notify(SUNDAY)["status"], "not_required")


class StreakTests(unittest.TestCase):
    def test_streak_across_not_required_day(self):
        d3, d2, d1, d0 = FRIDAY, FRIDAY - timedelta(days=1), FRIDAY - timedelta(days=2), FRIDAY - timedelta(days=3)
        evaluations = {
            d0: ev(d0, "fail", "fail", "fail"),
            d1: ev(d1),
            d2: ev(d2, "not_required", "not_required", "not_required"),
            d3: ev(d3),
        }
        self.assertEqual(lg.streak(evaluations, "posts"), 2)
        self.assertEqual(lg.streak(evaluations, "notify"), 2)
        self.assertEqual(lg.streak(evaluations, "freshness"), 3)  # calendar days

    def test_no_data_and_missing_day_break(self):
        evaluations = {FRIDAY: ev(FRIDAY, notify="no_data"), FRIDAY - timedelta(days=1): ev(FRIDAY - timedelta(days=1))}
        self.assertEqual(lg.streak(evaluations, "notify"), 0)
        gap = {FRIDAY: ev(FRIDAY), FRIDAY - timedelta(days=2): ev(FRIDAY - timedelta(days=2))}
        self.assertEqual(lg.streak(gap, "posts"), 1)

    def test_level1_met_only_when_all_three_reach_7(self):
        days = [FRIDAY - timedelta(days=i) for i in range(7)]
        evaluations = {d: ev(d) for d in days}
        summary = lg.level1_summary(evaluations)
        self.assertTrue(summary["met"])
        self.assertEqual(summary["streaks"], {"freshness": 7, "notify": 7, "posts": 7})

        evaluations[FRIDAY] = ev(FRIDAY, notify="no_data")
        self.assertFalse(lg.level1_summary(evaluations)["met"])

        six = {d: ev(d) for d in days[:6]}
        self.assertFalse(lg.level1_summary(six)["met"])

        sunday_in = {d: ev(d) for d in days}
        sunday_in[days[3]] = ev(days[3], "not_required", "not_required", "pass")
        summary = lg.level1_summary(sunday_in)
        self.assertEqual(summary["streaks"]["freshness"], 7)
        self.assertEqual(summary["streaks"]["notify"], 6)
        self.assertFalse(summary["met"])
        extra = FRIDAY - timedelta(days=7)
        sunday_in[extra] = ev(extra)
        self.assertTrue(lg.level1_summary(sunday_in)["met"])

    def test_empty_is_not_met(self):
        self.assertFalse(lg.level1_summary({})["met"])


class MainTests(Base):
    def setUp(self):
        super().setUp()
        self.write_json("data/publishing-policy.json", POLICY)
        self.write_json("line-bot/handover.json", HANDOVER)
        self.write_json("data/posted-log/2026-10-30.json", all_success_rows(FRIDAY))
        self.write_json("data/gates/notify-2026-10-30.json",
                        {"date": "2026-10-30", "sent": 3, "wrong_sends": 0, "reported_by": "shop-pc"})
        times = times_with_gap(FRIDAY, at(FRIDAY, "13:00"), 30)
        self.mdb = self.write_pulls([pull_row(t) for t in times])

    def run_main(self, *args):
        argv = list(args) + ["--root", str(self.tmp), "--mdb-log", str(self.mdb),
                             "--hours-module", str(self.hours_path)]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return lg.main(argv, now=NOW)

    def test_end_to_end_writes_json_and_report(self):
        policy_before = (self.tmp / "data" / "publishing-policy.json").read_bytes()
        self.assertEqual(self.run_main("2026-10-29"), 0)
        self.assertEqual(self.run_main("2026-10-30"), 0)
        data = json.loads((self.tmp / "output/operations/level1-gates-2026-10-30.json").read_text(encoding="utf-8"))
        self.assertEqual(data["conditions"]["posts"]["status"], "pass")
        self.assertEqual(data["conditions"]["freshness"]["status"], "pass")
        self.assertEqual(data["conditions"]["notify"]["status"], "pass")
        older = json.loads((self.tmp / "output/operations/level1-gates-2026-10-29.json").read_text(encoding="utf-8"))
        self.assertEqual(older["conditions"]["notify"]["status"], "no_data")
        report = (self.tmp / "reports/level1-gates.md").read_text(encoding="utf-8")
        self.assertIn("Level 1:未達成", report)
        self.assertLess(report.index("| 2026-10-30 |"), report.index("| 2026-10-29 |"))
        self.assertEqual(policy_before, (self.tmp / "data" / "publishing-policy.json").read_bytes())

    def test_default_is_yesterday_taipei(self):
        self.assertEqual(self.run_main(), 0)
        data = json.loads((self.tmp / "output/operations/level1-gates-2026-11-01.json").read_text(encoding="utf-8"))
        self.assertEqual(data["conditions"]["freshness"]["status"], "not_required")  # closed Sunday

    def test_refuses_unfinished_day(self):
        self.assertEqual(self.run_main("2026-11-02"), 2)
        self.assertFalse((self.tmp / "output/operations/level1-gates-2026-11-02.json").exists())


if __name__ == "__main__":
    unittest.main()
