#!/usr/bin/env python3
"""Unit tests for C5 (synthetic data only; no MDB)."""
from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import c5_assign as A  # noqa: E402
import c5_evaluate as E  # noqa: E402

try:
    import repurchase_backtest  # noqa: F401,E402
    C4_AVAILABLE = True
except Exception:  # noqa: BLE001
    C4_AVAILABLE = False

N = 20
NAMES = [f"測試客{i:02d}號" for i in range(N)]
PHONES = [f"0987{i:06d}" for i in range(N)]
CLASSES = ["襯衫", "西裝", "寢具"]
ASSIGN_DATE = dt.date(2026, 11, 2)


def _stub_c4():
    def check_private_dir(private_dir, repo_root):
        A.local_private_dir_check(Path(private_dir), Path(repo_root))
    return types.SimpleNamespace(check_private_dir=check_private_dir,
                                 normalize_id=lambda v: str(v).strip())


def make_cand(i: int, visits: int | None = None, days: int | None = None) -> A.Candidate:
    return A.Candidate(cid=f"S{1000 + i}", name=NAMES[i % N], phone=PHONES[i % N],
                       main_class=CLASSES[i % 3], visits=visits if visits is not None else 3 + i % 5,
                       last_visit="2026-08-01", days_since_last=days if days is not None else 40 + (i * 7) % 50,
                       cycle_days=30.0 + (i * 5) % 30, rule="multi_lapsing")


def write_candidates_csv(path: Path) -> None:
    lines = ["# 警告：本檔含個資，勿外傳",
             "cid,name,phone,segment,main_class,visits,last_visit,days_since_last,cycle_days,due_score,reason,rule"]
    for i in range(N):
        c = make_cand(i)
        lines.append(f"{c.cid},{c.name},{c.phone},loyal,{c.main_class},{c.visits},{c.last_visit},"
                     f"{c.days_since_last},{c.cycle_days},1.2,測試,multi_lapsing")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")


class C4Patch(unittest.TestCase):
    def setUp(self):
        self._p = None
        if not C4_AVAILABLE:
            self._p = mock.patch.object(A, "_load_c4", _stub_c4)
            self._p.start()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        (self.repo / "data" / "crm").mkdir(parents=True)
        self.private = self.repo / "data" / "crm"
        self.cand_csv = self.root / "cands.csv"
        write_candidates_csv(self.cand_csv)

    def tearDown(self):
        if self._p:
            self._p.stop()
        self.tmp.cleanup()

    def run_assign(self, extra=(), private=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = A.main(["--candidates", str(self.cand_csv), "--test-id", "C5-2026-11",
                         "--private-dir", str(private or self.private), "--repo-root", str(self.repo),
                         "--assign-date", ASSIGN_DATE.isoformat(), *extra])
        return rc, out.getvalue()


class TestAssignment(unittest.TestCase):
    def test_determinism(self):
        cands = [make_cand(i) for i in range(N)]
        self.assertEqual(A.draw_groups(cands, "C5-2026-11", 0), A.draw_groups(cands, "C5-2026-11", 0))
        self.assertEqual(A.draw(cands, "C5-2026-11"), A.draw(list(cands), "C5-2026-11"))
        h = int(hashlib.sha256(b"C5-2026-11#3:S1000").hexdigest(), 16)
        self.assertEqual(A.assign_group("C5-2026-11", "S1000", 3), "contact" if h % 2 == 0 else "control")

    def test_balance_redraw(self):
        cands = [make_cand(i) for i in range(12)]
        found = None
        for j in range(500):
            tid = f"T-{j}"
            if A.balance_check(cands, A.draw_groups(cands, tid, 0))[0]:
                continue
            try:
                k, groups = A.draw(cands, tid)
            except A.Refused:
                continue
            found = (tid, k, groups)
            break
        self.assertIsNotNone(found)
        tid, k, groups = found
        self.assertGreaterEqual(k, 1)
        self.assertEqual(groups, A.draw_groups(cands, tid, k))
        self.assertTrue(A.balance_check(cands, groups)[0])
        for j in range(k):
            self.assertFalse(A.balance_check(cands, A.draw_groups(cands, tid, j))[0])

    def test_balance_rules(self):
        cands = [make_cand(0, visits=3, days=50), make_cand(1, visits=10, days=50)]
        groups = {cands[0].cid: "contact", cands[1].cid: "control"}
        ok, info = A.balance_check(cands, groups)
        self.assertFalse(ok)
        self.assertGreater(info.visits_rel_diff, 0.25)
        with self.assertRaises(A.Refused):
            A.draw([make_cand(0)], "X")


class TestGuardAndFiles(C4Patch):
    def test_local_guard(self):
        with self.assertRaises(A.Refused):
            A.local_private_dir_check(self.repo / "reports", self.repo)
        A.local_private_dir_check(self.repo / "data" / "crm", self.repo)
        A.local_private_dir_check(self.root / "outside", self.repo)

    def test_main_refuses_private_dir_inside_repo(self):
        bad = self.repo / "reports" / "crm"
        bad.mkdir(parents=True)
        rc, _ = self.run_assign(private=bad)
        self.assertEqual(rc, A.EXIT_REFUSED)
        self.assertEqual(list(bad.iterdir()), [])

    def test_staff_header_and_no_pii_in_public(self):
        rc, stdout = self.run_assign()
        self.assertEqual(rc, A.EXIT_OK)
        staff = self.private / "c5-C5-2026-11-staff-contact-list.csv"
        lines = staff.read_text(encoding="utf-8-sig").splitlines()
        # Literal, not the module constant: a changed warning line must turn this red (commander fix).
        self.assertEqual(lines[0], "# 只供店員手動問候用;未經店主核准問候文字前不要傳任何訊息;本檔含個資,勿外傳")
        self.assertEqual(lines[1], ",".join(A.STAFF_COLUMNS))
        summary = (self.repo / "reports" / "crm" / "c5-C5-2026-11-assignment-summary.md").read_text("utf-8")
        assign = (self.private / "c5-C5-2026-11-assignment.csv").read_text(encoding="utf-8-sig")
        self.assertTrue(summary.startswith("結論："))
        for secret in NAMES + PHONES:
            self.assertNotIn(secret, summary)
            self.assertNotIn(secret, stdout)
            self.assertNotIn(secret, assign)
        rc2, _ = self.run_assign()
        self.assertEqual(rc2, A.EXIT_REFUSED)   # never overwrite

    def test_dry_run_writes_nothing(self):
        rc, _ = self.run_assign(extra=["--dry-run"])
        self.assertEqual(rc, A.EXIT_OK)
        self.assertEqual(list(self.private.iterdir()), [])
        self.assertFalse((self.repo / "reports").exists())

    def test_evaluate_end_to_end(self):
        self.assertEqual(self.run_assign()[0], A.EXIT_OK)
        staff = self.private / "c5-C5-2026-11-staff-contact-list.csv"
        lines = staff.read_text(encoding="utf-8-sig").splitlines()
        filled = [lines[0], lines[1]] + [ln + "2026-11-05 10:00" if i < 3 else ln
                                         for i, ln in enumerate(lines[2:])]
        staff.write_text("\n".join(filled) + "\n", encoding="utf-8-sig")
        rows = A.read_assignment(self.private / "c5-C5-2026-11-assignment.csv")
        dates = {r.cid: [dt.date(2026, 6, 1), ASSIGN_DATE + dt.timedelta(days=20)] for r in rows[::2]}
        fake = E.VisitData(dates, dt.date(2027, 3, 1), lambda v: str(v).strip())
        out = io.StringIO()
        with mock.patch.object(E, "load_visit_dates", return_value=fake), contextlib.redirect_stdout(out):
            rc = E.main(["--assignment", str(self.private / "c5-C5-2026-11-assignment.csv"),
                         "--test-id", "C5-2026-11", "--as-of", "2027-03-01",
                         "--staff-list", str(staff), "--repo-root", str(self.repo)])
        self.assertEqual(rc, E.EXIT_OK)
        report = (self.repo / "reports" / "crm" / "c5-C5-2026-11-result-2027-03-01.md").read_text("utf-8")
        self.assertTrue(report.startswith("結論："))
        self.assertIn("有填的問候組人數：3／", report)
        for secret in NAMES + PHONES:
            self.assertNotIn(secret, report)
            self.assertNotIn(secret, out.getvalue())
        for r in rows:
            self.assertNotIn(r.cid, report)


class TestStats(unittest.TestCase):
    def test_fisher(self):
        self.assertAlmostEqual(E.fisher_exact_two_sided(3, 1, 1, 3), 0.4857, places=4)
        self.assertAlmostEqual(E.fisher_exact_two_sided(1, 9, 11, 3), 0.002759, places=5)
        self.assertEqual(E.fisher_exact_two_sided(0, 0, 0, 0), 1.0)

    def test_wilson(self):
        lo, hi = E.wilson_interval(5, 10)
        self.assertAlmostEqual(lo, 0.2366, places=3)
        self.assertAlmostEqual(hi, 0.7634, places=3)
        self.assertAlmostEqual(E.wilson_interval(0, 10)[1], 0.2775, places=3)
        self.assertIsNone(E.wilson_interval(0, 0))

    def test_newcombe(self):
        lo, hi = E.newcombe_interval(56, 70, 48, 80)   # Newcombe 1998 example
        self.assertAlmostEqual(lo, 0.0524, places=3)
        self.assertAlmostEqual(hi, 0.3339, places=3)

    def test_power(self):
        d = E.detectable_difference(38, 38)
        self.assertTrue(0.2 < d < 0.4)
        self.assertGreater(E.required_n_per_arm(), 200)


class TestEvaluate(unittest.TestCase):
    def setUp(self):
        self.rows = ([A.AssignmentRow("T", f"C{i}", "contact", ASSIGN_DATE, 0) for i in range(10)]
                     + [A.AssignmentRow("T", f"K{i}", "control", ASSIGN_DATE, 0) for i in range(10)])
        d10 = ASSIGN_DATE + dt.timedelta(days=10)
        d60 = ASSIGN_DATE + dt.timedelta(days=60)
        self.dates = {f"C{i}": [dt.date(2026, 5, 1), d10] for i in range(6)}
        self.dates.update({f"K{i}": [dt.date(2026, 5, 1), d10] for i in range(3)})
        self.dates["K9"] = [dt.date(2026, 5, 1), d60]
        self.dates["C9"] = [dt.date(2026, 5, 1), ASSIGN_DATE]   # same-day visit does not count

    def test_itt_vs_pp(self):
        contacted = {"C0", "C1", "C2", "C7", "K5"}
        res = E.analyze(self.rows, self.dates, dt.date(2027, 3, 1), dt.date(2027, 3, 1), contacted)
        self.assertEqual((res.itt[28].contact.n, res.itt[28].contact.returned), (10, 6))
        self.assertEqual((res.itt[28].control.n, res.itt[28].control.returned), (10, 3))
        self.assertEqual(res.itt[90].control.returned, 4)
        self.assertEqual((res.pp[28].contact.n, res.pp[28].contact.returned), (4, 3))
        self.assertEqual(res.n_contacted, 4)
        self.assertEqual(res.n_staff_outside, 1)
        self.assertIsNotNone(res.itt[90].p)

    def test_not_elapsed(self):
        res = E.analyze(self.rows, self.dates, ASSIGN_DATE + dt.timedelta(days=30), dt.date(2027, 3, 1))
        self.assertTrue(res.itt[28].elapsed)
        self.assertFalse(res.itt[56].elapsed)
        self.assertFalse(res.itt[90].elapsed)
        self.assertIsNone(res.itt[90].p)
        text = E.render_report("T", res)
        self.assertIn("未滿期", text.splitlines()[0])
        res2 = E.analyze(self.rows, self.dates, dt.date(2027, 3, 1), ASSIGN_DATE + dt.timedelta(days=20))
        self.assertFalse(res2.itt[28].elapsed)   # data ends before the window does

    def test_not_significant_wording(self):
        res = E.analyze(self.rows, self.dates, dt.date(2027, 3, 1), dt.date(2027, 3, 1))
        first = E.render_report("T", res).splitlines()[0]
        self.assertIn("差異不顯著／樣本太小", first)


if __name__ == "__main__":
    unittest.main()