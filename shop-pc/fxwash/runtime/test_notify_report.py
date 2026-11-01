"""Offline N1 tests for runtime/notify_report.py; fixtures only, never real shop data."""

from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import notify_report

SCRIPT = ROOT / "runtime" / "notify_report.py"
TZ8 = timezone(timedelta(hours=8))
UID_A = "U" + "0123456789abcdef" * 2
UID_B = "U" + "fedcba9876543210" * 2
DNO = "ZX9817"
DID = "QW5521"
SECRET_TEXT = "PRIVATE-MESSAGE-TEXT"
NOW = datetime(2026, 11, 3, 9, 0, tzinfo=TZ8)
DAY_KEYS = {"date", "sent", "wrong_sends", "wrong_sends_basis", "duplicates", "abandoned",
            "no_binding", "pending", "first_ts", "last_ts", "reported_by"}


def ts(month, day, hour, minute, second=0):
    return datetime(2026, month, day, hour, minute, second, tzinfo=TZ8).timestamp()


def rec(status, at, uid=UID_A, kind="completion", dno=DNO, did=DID, attempts=0):
    return {"ts": at, "kind": kind, "dno": dno, "did": did, "uid": uid, "attempts": attempts,
            "last_error_type": "" if uid else "NoBinding", "status": status, "recipients": [uid],
            "messages": [{"type": "text", "text": SECRET_TEXT}]}


class NotifyReportTests(unittest.TestCase):
    def setUp(self):
        # Ordinary, uniquely owned fixture dir (see test_tunnel_events.py).
        self.work = ROOT / "runtime" / (".n1-" + uuid4().hex)
        (self.work / "data").mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.work)
        self.outbox = self.work / "data" / "notify_outbox.jsonl"

    def write(self, records, extra=b""):
        raw = b"".join((json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
                       for r in records)
        self.outbox.write_bytes(raw + extra)

    def run_report(self, *dates, now=NOW):
        argv = ["--root", str(self.work)]
        for value in dates:
            argv += ["--date", value]
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = notify_report.main(argv, now=now)
        self.assertEqual(0, code)
        text = out.getvalue()
        self.assertEqual(1, len(text.splitlines()))
        report = json.loads(text)
        self.assertEqual("notify-report/v1", report["schema"])
        for day in report["days"]:
            self.assertEqual(DAY_KEYS, set(day))
            self.assertEqual("shop-notify-report", day["reported_by"])
            self.assertEqual("auto_duplicate_deliveries", day["wrong_sends_basis"])
        return report, text

    @staticmethod
    def day(report, iso):
        return next(d for d in report["days"] if d["date"] == iso)

    def test_done_once_is_sent_once(self):
        self.write([rec("pending", ts(11, 2, 10, 0)), rec("done", ts(11, 2, 10, 5))])
        report, _ = self.run_report("2026-11-02")
        day = self.day(report, "2026-11-02")
        self.assertEqual((1, 0, 0, 0), (day["sent"], day["duplicates"], day["wrong_sends"], day["pending"]))
        self.assertEqual(("10:05", "10:05"), (day["first_ts"], day["last_ts"]))
        self.assertEqual("ok", report["outbox"])
        self.assertEqual(0, report["corrupt_lines"])

    def test_done_twice_is_a_duplicate_wrong_send(self):
        self.write([rec("done", ts(11, 2, 10, 5)), rec("done", ts(11, 2, 10, 6))])
        day = self.day(self.run_report("2026-11-02")[0], "2026-11-02")
        self.assertEqual((1, 1, 1), (day["sent"], day["duplicates"], day["wrong_sends"]))
        self.assertEqual(("10:05", "10:06"), (day["first_ts"], day["last_ts"]))

    def test_duplicate_on_later_day_counts_on_that_day(self):
        self.write([rec("done", ts(11, 1, 15, 0)), rec("done", ts(11, 2, 11, 0))])
        report, _ = self.run_report("2026-11-01", "2026-11-02")
        self.assertEqual((1, 0), (self.day(report, "2026-11-01")["sent"], self.day(report, "2026-11-01")["duplicates"]))
        self.assertEqual((0, 1), (self.day(report, "2026-11-02")["sent"], self.day(report, "2026-11-02")["duplicates"]))

    def test_distinct_recipients_are_distinct_sends(self):
        self.write([rec("done", ts(11, 2, 10, 5)), rec("done", ts(11, 2, 10, 5), uid=UID_B),
                    rec("done", ts(11, 2, 12, 0), kind="intake")])
        day = self.day(self.run_report("2026-11-02")[0], "2026-11-02")
        self.assertEqual((3, 0), (day["sent"], day["duplicates"]))

    def test_pending_then_done_next_day(self):
        self.write([rec("pending", ts(11, 1, 19, 50)),
                    rec("pending", ts(11, 1, 19, 51), attempts=1),
                    rec("done", ts(11, 2, 10, 0), attempts=1)])
        report, _ = self.run_report("2026-11-01", "2026-11-02")
        first, second = self.day(report, "2026-11-01"), self.day(report, "2026-11-02")
        self.assertEqual((0, 1, None), (first["sent"], first["pending"], first["first_ts"]))
        self.assertEqual((1, 0), (second["sent"], second["pending"]))

    def test_abandoned_counts_on_the_day_it_became_abandoned(self):
        self.write([rec("pending", ts(11, 1, 18, 0)),
                    rec("pending", ts(11, 1, 18, 1), attempts=1),
                    rec("abandoned", ts(11, 2, 9, 0), attempts=5)])
        report, _ = self.run_report("2026-11-01", "2026-11-02")
        first, second = self.day(report, "2026-11-01"), self.day(report, "2026-11-02")
        self.assertEqual((0, 1, 0), (first["abandoned"], first["pending"], first["sent"]))
        self.assertEqual((1, 0, 0, 0), (second["abandoned"], second["pending"], second["sent"], second["no_binding"]))

    def test_empty_uid_is_no_binding(self):
        self.write([rec("abandoned", ts(11, 2, 11, 0), uid="")])
        day = self.day(self.run_report("2026-11-02")[0], "2026-11-02")
        self.assertEqual((1, 0, 0), (day["no_binding"], day["abandoned"], day["sent"]))

    def test_day_boundary_at_midnight_taipei(self):
        self.write([rec("done", ts(11, 1, 23, 59, 59)),
                    rec("done", ts(11, 2, 0, 0, 0), dno="ZX9818")])
        report, _ = self.run_report("2026-11-01", "2026-11-02")
        self.assertEqual(1, self.day(report, "2026-11-01")["sent"])
        self.assertEqual("23:59", self.day(report, "2026-11-01")["last_ts"])
        self.assertEqual(1, self.day(report, "2026-11-02")["sent"])
        self.assertEqual("00:00", self.day(report, "2026-11-02")["first_ts"])
        # 2026-11-01T16:00Z is already 11-02 in Taipei.
        self.assertEqual(datetime(2026, 11, 1, 16, 0, tzinfo=timezone.utc).timestamp(), ts(11, 2, 0, 0))

    def test_corrupt_lines_are_skipped_and_counted(self):
        self.write([rec("done", ts(11, 2, 10, 5))],
                   extra=b"{not json\n" + b'{"kind":"completion"}\n' + b"\xff\xfe\n"
                         + json.dumps(rec("done", float("nan"))).encode("ascii") + b"\n\n")
        report, _ = self.run_report("2026-11-02")
        self.assertEqual(4, report["corrupt_lines"])
        self.assertEqual(1, self.day(report, "2026-11-02")["sent"])

    def test_missing_outbox_gives_zero_days(self):
        report, _ = self.run_report("2026-11-01", "2026-11-02")
        self.assertEqual("missing", report["outbox"])
        self.assertEqual(0, report["corrupt_lines"])
        for day in report["days"]:
            self.assertEqual((0, 0, 0, 0, 0, 0), (day["sent"], day["wrong_sends"], day["duplicates"],
                                                  day["abandoned"], day["no_binding"], day["pending"]))
            self.assertIsNone(day["first_ts"])
            self.assertIsNone(day["last_ts"])

    def test_output_has_no_identifiers_or_text(self):
        self.write([rec("pending", ts(11, 2, 10, 0)), rec("done", ts(11, 2, 10, 5)),
                    rec("done", ts(11, 2, 10, 6)), rec("abandoned", ts(11, 2, 11, 0), uid="")])
        report, text = self.run_report("2026-11-02")
        for needle in (UID_A, DNO, DID, SECRET_TEXT, '"uid"', '"dno"', '"did"', '"messages"', '"text"'):
            self.assertNotIn(needle, text)
        self.assertIsNone(re.search(r"U[0-9a-f]{32}", text))

        def keys(node):
            if isinstance(node, dict):
                for key, value in node.items():
                    yield key
                    yield from keys(value)
            elif isinstance(node, list):
                for value in node:
                    yield from keys(value)

        self.assertFalse({"uid", "dno", "did", "messages", "text"} & set(keys(report)))

    def snapshot(self):
        return sorted((str(p.relative_to(self.work)), p.is_dir(), p.stat().st_size, p.stat().st_mtime_ns)
                      for p in self.work.rglob("*"))

    def test_writes_nothing(self):
        self.write([rec("pending", ts(11, 2, 10, 0)), rec("done", ts(11, 2, 10, 5))], extra=b"{bad\n")
        before = self.snapshot()
        self.run_report("2026-11-01", "2026-11-02")
        self.run_report()
        self.assertEqual(before, self.snapshot())
        self.outbox.unlink()
        before = self.snapshot()
        self.run_report("2026-11-02")
        self.assertEqual(before, self.snapshot())

    def test_default_dates_are_yesterday_and_today_taipei(self):
        report, _ = self.run_report(now=datetime(2026, 11, 2, 16, 30, tzinfo=timezone.utc))
        self.assertEqual(["2026-11-02", "2026-11-03"], [d["date"] for d in report["days"]])

    def test_backfill_dates_in_order(self):
        report, _ = self.run_report("2026-11-02", "2026-10-31")
        self.assertEqual(["2026-10-31", "2026-11-02"], [d["date"] for d in report["days"]])

    def test_bad_date_is_usage_error(self):
        for bad in ("2026-13-01", "2026/11/02", "20261102"):
            with self.subTest(bad=bad), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                notify_report.main(["--root", str(self.work), "--date", bad], now=NOW)
            self.assertEqual(2, caught.exception.code)

    def test_cli_runs_isolated(self):
        self.write([rec("done", ts(11, 2, 10, 5))])
        before = self.snapshot()
        proc = subprocess.run([sys.executable, "-I", "-S", "-B", str(SCRIPT), "--root", str(self.work),
                               "--date", "2026-11-02"], capture_output=True, timeout=120)
        self.assertEqual(0, proc.returncode)
        report = json.loads(proc.stdout.decode("ascii"))
        self.assertEqual(1, report["days"][0]["sent"])
        self.assertEqual(before, self.snapshot())


if __name__ == "__main__":
    unittest.main()
