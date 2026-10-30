# -*- coding: utf-8 -*-
"""Offline unit tests for repurchase_backtest (synthetic data only; never touches the MDB)."""
from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import repurchase_backtest as rb  # noqa: E402


def roc(d: date) -> str:
    return f"{d.year - 1911:03d}.{d.month:02d}.{d.day:02d}"


def visits_from(spec, classes=None):
    """spec: {cid: [iso dates]}; classes: {cid: dclass}."""
    classes = classes or {}
    pieces, n = [], 0
    for cid, ds in spec.items():
        for d in ds:
            n += 1
            pieces.append(rb.Piece(did=str(n), cid=cid, date=date.fromisoformat(d),
                                   dclass=classes.get(cid, "衣物"), value=100.0))
    return rb.group_visits(pieces)


def make_state(cid="QZ1001", **kw):
    base = dict(cid=cid, n_visits=3, first_visit=date(2025, 1, 1), last_visit=date(2025, 3, 1),
                days_since=30, segment="repeat", activity="active_6m", main_class="衣物",
                is_bedding=False, cycle=30.0, cycle_source="personal", score=1.0,
                due_now=True, coming_due=False, total_value=300.0)
    base.update(kw)
    return rb.CustomerState(**base)


def summ(n_cutoffs=5, **lifts):
    """Hand-made backtest summary: lifts per selector name (None = empty lists)."""
    s = {"n_cutoffs": n_cutoffs, "mean_base_rate": 0.35, "pooled_base_rate": 0.35}
    for name in rb.SELECTOR_NAMES:
        lift = lifts.get(name, 1.0 if name == "baseline" else None)
        prec = None if lift is None else 0.35 * lift
        s[name] = rb.SelectorSummary(10.0, 3.0, prec, 0.2, lift, prec, lift)
    return s


def synthetic_dataset():
    pieces, det, customers = [], [], []
    end = date(2025, 3, 31)
    order, pno = 0, 0

    def add(cid, d, dclass, tpay, price):
        nonlocal pno
        pno += 1
        pieces.append({"did": f"P{order:06d}", "dno": f"N{pno:07d}", "cid": cid, "indate": d,
                       "dclass": dclass, "tpay": tpay, "price": price, "qty": 1})

    for i in range(30):
        cid = f"QZ{1000 + i}"
        customers.append({"cid": cid, "name": f"虛構客{i:02d}號",
                          "mtel": f"09770{i:05d}" if i % 3 else "",
                          "tel": f"0423{i:06d}"})
        dclass = "寢具" if i % 5 == 0 else "衣物"
        start = date(2023, 1, 5) + timedelta(days=9 * i)
        if i % 4 == 3:
            dates = [date(2023, 3, 1) + timedelta(days=20 * i)]
        else:
            gap = 25 + 5 * (i % 10)
            dates, d = [], start
            while d <= end - timedelta(days=1):
                dates.append(d)
                d += timedelta(days=gap)
        for k, d in enumerate(dates):
            order += 1                       # one order (Did) per visit, many pieces (Dno)
            for j in range(1 + k % 2):
                add(cid, roc(d), dclass, 0 if j else 120, 100)
    for k in range(366):  # house / walk-in account
        order += 1
        add("0000", roc(date(2024, 1, 1) + timedelta(days=k)), "衣物", 50, 50)
    order += 1
    add("QZ1000", roc(end), "寢具", 300, 300)
    pieces.append({"did": "BAD1", "dno": "B1", "cid": "QZ1001", "indate": "         ",
                   "dclass": "衣物", "tpay": 1, "price": 1, "qty": 1})
    pieces.append({"did": "BAD2", "dno": "B2", "cid": "QZ1001", "indate": "115.13.40",
                   "dclass": "衣物", "tpay": 1, "price": 1, "qty": 1})
    det.append(dict(pieces[0], dclass="鞋類"))  # same (Did, Dno) as a Deh row
    return {"pieces": pieces, "det_pieces": det, "customers": customers}


class TestDates(unittest.TestCase):
    def test_roc_basic(self):
        self.assertEqual(rb.parse_roc_date("115.10.28"), date(2026, 10, 28))
        self.assertEqual(rb.parse_roc_date("111.3.17"), date(2022, 3, 17))

    def test_roc_blank_and_none(self):
        self.assertIsNone(rb.parse_roc_date("         "))
        self.assertIsNone(rb.parse_roc_date(""))
        self.assertIsNone(rb.parse_roc_date(None))

    def test_roc_malformed(self):
        for s in ("115.13.01", "115.02.30", "abc", "115/10/28", "115.10", "0.01.01", "x.1.2"):
            self.assertIsNone(rb.parse_roc_date(s), s)

    def test_parse_any_date_iso(self):
        self.assertEqual(rb.parse_any_date("2024-04-30"), date(2024, 4, 30))
        self.assertEqual(rb.parse_any_date("113.04.30"), date(2024, 4, 30))
        self.assertIsNone(rb.parse_any_date("2024-02-30"))


class TestPiecesVisits(unittest.TestCase):
    def test_piece_value_fallback(self):
        self.assertEqual(rb.piece_value(250, 100, 2), 250)
        self.assertEqual(rb.piece_value(0, 100, 2), 200)
        self.assertEqual(rb.piece_value("", "80", ""), 80)
        self.assertEqual(rb.piece_value(None, None, None), 0)

    def test_dedupe_prefers_deh(self):
        det = [{"did": "1", "dno": "11", "dclass": "A"}, {"did": "3", "dno": "31", "dclass": "C"}]
        deh = [{"did": "1", "dno": "11", "dclass": "B"}, {"did": "2", "dno": "21", "dclass": "D"}]
        rows, removed = rb.dedupe_pieces(deh, det)
        self.assertEqual(removed, 1)
        self.assertEqual(len(rows), 3)
        self.assertEqual({r["did"]: r["dclass"] for r in rows}["1"], "B")

    def test_same_did_different_dno_both_kept_and_valued(self):
        deh = [{"did": "D1", "dno": "1", "cid": "A", "indate": "113.01.02", "dclass": "衣物", "tpay": 100},
               {"did": "D1", "dno": "2", "cid": "A", "indate": "113.01.02", "dclass": "寢具", "tpay": 250}]
        pieces, stats = rb.build_pieces(deh, [])
        self.assertEqual(len(pieces), 2)
        self.assertEqual(stats["duplicates_removed"], 0)
        v = rb.group_visits(pieces)
        self.assertEqual(len(v["A"]), 1)
        self.assertEqual(v["A"][0].value, 350)
        self.assertEqual(v["A"][0].classes["寢具"], 1)

    def test_same_key_in_det_and_deh_keeps_deh(self):
        det = [{"did": " D1 ", "dno": "7 ", "cid": "A", "indate": "113.01.02", "dclass": "鞋類", "tpay": 9}]
        deh = [{"did": "D1", "dno": "7", "cid": "A", "indate": "113.01.02", "dclass": "衣物", "tpay": 120}]
        pieces, stats = rb.build_pieces(deh, det)
        self.assertEqual(len(pieces), 1)
        self.assertEqual(stats["duplicates_removed"], 1)
        self.assertEqual(pieces[0].dclass, "衣物")
        self.assertEqual(pieces[0].value, 120)
        self.assertEqual(pieces[0].dno, "7")

    def test_exact_duplicate_in_deh_collapses(self):
        row = {"did": "D1", "dno": "5", "cid": "A", "indate": "113.01.02", "dclass": "衣物", "tpay": 80}
        pieces, stats = rb.build_pieces([dict(row), dict(row)], [])
        self.assertEqual(len(pieces), 1)
        self.assertEqual(stats["duplicates_removed"], 1)
        self.assertEqual(rb.group_visits(pieces)["A"][0].value, 80)

    def test_blank_dno_keeps_rows(self):
        deh = [{"did": "D1", "dno": "", "cid": "A", "indate": "113.01.02", "tpay": 10},
               {"did": "D1", "dno": "   ", "cid": "A", "indate": "113.01.02", "tpay": 20},
               {"did": "D1", "cid": "A", "indate": "113.01.02", "tpay": 30}]
        det = [{"did": "D1", "dno": None, "cid": "A", "indate": "113.01.02", "tpay": 40}]
        rows, removed = rb.dedupe_pieces(deh, det)
        self.assertEqual((len(rows), removed), (4, 0))
        pieces, _ = rb.build_pieces(deh, det)
        self.assertEqual(rb.group_visits(pieces)["A"][0].value, 100)

    def test_build_pieces_counts_bad_dates(self):
        deh = [{"did": "1", "cid": "A", "indate": "113.01.02", "tpay": 0, "price": 50, "qty": 2},
               {"did": "2", "cid": "A", "indate": "         "}]
        pieces, stats = rb.build_pieces(deh, [])
        self.assertEqual(len(pieces), 1)
        self.assertEqual(stats["bad_dates"], 1)
        self.assertEqual(pieces[0].value, 100)

    def test_group_visits(self):
        p = [rb.Piece("1", "A", date(2024, 1, 1), "衣物", 100),
             rb.Piece("2", "A", date(2024, 1, 1), "寢具", 50),
             rb.Piece("3", "A", date(2024, 2, 1), "衣物", 70),
             rb.Piece("4", "B", date(2024, 1, 1), "衣物", 10)]
        v = rb.group_visits(p)
        self.assertEqual(len(v["A"]), 2)
        self.assertEqual(v["A"][0].value, 150)
        self.assertEqual(v["A"][0].classes["寢具"], 1)
        self.assertEqual(len(rb.group_visits(p, as_of=date(2024, 1, 15))["A"]), 1)

    def test_main_class_tie_break(self):
        v = rb.Visit(date(2024, 1, 1))
        v.classes.update({"衣物": 2, "寢具": 2})
        self.assertEqual(rb.main_class([v]), "寢具")

    def test_norm_piece_row_has_dno(self):
        r = rb._norm_piece_row({"Did": "D1", "Dno": "9", "Cid": "A"})
        self.assertEqual(r["dno"], "9")
        self.assertIn("Dno", rb._PIECE_SQL_COLS)


class TestGuards(unittest.TestCase):
    class FakeCursor:
        def __init__(self):
            self.calls = []
            self.description = [("Did",), ("Dno",)]

        def execute(self, sql):
            self.calls.append(sql)

        def fetchall(self):
            return [("D1", "1")]

    def test_csv_safe(self):
        self.assertEqual(rb._csv_safe("=1+1"), "'=1+1")
        self.assertEqual(rb._csv_safe("+886912"), "'+886912")
        self.assertEqual(rb._csv_safe("-5"), "'-5")
        self.assertEqual(rb._csv_safe("@cmd"), "'@cmd")
        self.assertEqual(rb._csv_safe("王小明"), "王小明")
        self.assertEqual(rb._csv_safe("0912000000"), "0912000000")
        self.assertEqual(rb._csv_safe(""), "")
        self.assertEqual(rb._csv_safe(None), "")
        self.assertEqual(rb._csv_safe(12), "12")

    def test_run_select_rejects_non_select(self):
        for sql in ("  delete from Deh", "UPDATE Cus SET x=1", "DROP TABLE Deh",
                    "SELECT 1; DELETE FROM Deh", "select 1 ;drop table Deh", "SELECTX FROM Deh",
                    "", "INSERT INTO Deh SELECT * FROM Det"):
            cur = self.FakeCursor()
            with self.assertRaises(RuntimeError, msg=sql):
                rb._run_select(cur, sql)
            self.assertEqual(cur.calls, [], sql)

    def test_run_select_allows_select(self):
        cur = self.FakeCursor()
        rows = rb._run_select(cur, "SELECT Did, Dno FROM Deh")
        self.assertEqual(cur.calls, ["SELECT Did, Dno FROM Deh"])
        self.assertEqual(rows, [{"did": "D1", "dno": "1"}])
        cur2 = self.FakeCursor()
        rb._run_select(cur2, "  select Did, Dno from Deh;")
        self.assertEqual(len(cur2.calls), 1)
        self.assertTrue(cur2.calls[0].lower().startswith("select"))

    def test_write_csv_prefixes_formula_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.csv"
            rb.write_contact_csv(p, [make_state()], {"QZ1001": {"name": "=虛構惡意名", "mtel": "+886", "tel": ""}},
                                 rule="recent_30_90", note=rb.NOTE_NO_RULE_BETTER)
            text = p.read_text(encoding="utf-8-sig")
            lines = text.splitlines()
            self.assertIn("do not send without owner approval", lines[0])
            self.assertIn(rb.NOTE_NO_RULE_BETTER, lines[0])
            rows = list(csv.reader(lines[1:]))
            self.assertEqual(rows[0], rb.CSV_COLUMNS)
            self.assertEqual(rows[1][1], "'=虛構惡意名")
            self.assertEqual(rows[1][2], "'+886")
            self.assertEqual(rows[1][-1], "recent_30_90")


class TestHouse(unittest.TestCase):
    def test_placeholder_ids(self):
        spec = {"": ["2024-01-01"], "0": ["2024-01-01"], "0000": ["2024-01-01"],
                "A1": ["2024-01-01"]}
        house = rb.detect_house_accounts(visits_from(spec))
        self.assertEqual(house, {"", "0", "0000"})

    def test_heavy_user_flagged(self):
        spec = {"HEAVY": [(date(2024, 1, 1) + timedelta(days=k)).isoformat() for k in range(200)]}
        for i in range(20):
            spec[f"N{i}"] = ["2024-01-01", "2024-02-01", "2024-03-01"]
        self.assertEqual(rb.detect_house_accounts(visits_from(spec)), {"HEAVY"})

    def test_frequent_but_slow_not_flagged(self):
        spec = {"BUSY": [(date(2021, 1, 1) + timedelta(days=7 * k)).isoformat() for k in range(200)]}
        for i in range(20):
            spec[f"N{i}"] = ["2024-01-01", "2024-02-01"]
        self.assertEqual(rb.detect_house_accounts(visits_from(spec)), set())


class TestCycleAndDue(unittest.TestCase):
    def test_cycle_one_visit_default(self):
        self.assertEqual(rb.personal_cycle([date(2024, 1, 1)], 42.0), 42.0)
        self.assertIsNone(rb.personal_cycle([], 42.0))

    def test_cycle_two_visits(self):
        self.assertEqual(rb.personal_cycle([date(2024, 1, 1), date(2024, 1, 31)], 99), 30.0)

    def test_cycle_three_plus_median(self):
        ds = [date(2024, 1, 1), date(2024, 1, 11), date(2024, 2, 10), date(2024, 2, 20)]
        self.assertEqual(rb.personal_cycle(ds, 99), 10.0)  # gaps 10, 30, 10
        ds2 = [date(2024, 1, 1), date(2024, 1, 11), date(2024, 2, 10)]
        self.assertEqual(rb.personal_cycle(ds2, 99), 20.0)  # median(10, 30)

    def test_cycle_cap(self):
        self.assertEqual(rb.personal_cycle([date(2020, 1, 1), date(2021, 6, 1)], 99), 365.0)
        ds = [date(2018, 1, 1), date(2019, 3, 1), date(2020, 7, 1), date(2022, 2, 1)]
        self.assertEqual(rb.personal_cycle(ds, 99), 365.0)

    def test_due_boundaries(self):
        self.assertFalse(rb.is_due_now(0.999, 30))
        self.assertTrue(rb.is_due_now(1.0, 30))
        self.assertTrue(rb.is_due_now(2.999, 30))
        self.assertFalse(rb.is_due_now(3.0, 30))
        self.assertFalse(rb.is_due_now(None, 30))
        self.assertEqual(rb.due_score(30, 30.0), 1.0)
        self.assertIsNone(rb.due_score(30, 0))

    def test_due_over_365_days(self):
        self.assertTrue(rb.is_due_now(1.5, 365))
        self.assertFalse(rb.is_due_now(1.5, 366))

    def test_coming_due(self):
        self.assertTrue(rb.is_coming_due(20, 30.0))    # 34/30 >= 1
        self.assertTrue(rb.is_coming_due(16, 30.0))    # exactly 30/30
        self.assertFalse(rb.is_coming_due(15, 30.0))   # 29/30
        self.assertFalse(rb.is_coming_due(30, 30.0))   # already due

    def test_recent_30_90_boundaries(self):
        self.assertEqual([rb.is_recent_30_90(d) for d in (29, 30, 60, 90, 91)],
                         [False, True, True, True, False])

    def test_multi_lapsing_boundaries(self):
        self.assertTrue(rb.is_multi_lapsing(3, 24, 30.0))    # exactly 0.8x
        self.assertFalse(rb.is_multi_lapsing(3, 23, 30.0))
        self.assertTrue(rb.is_multi_lapsing(3, 60, 30.0))    # exactly 2.0x
        self.assertFalse(rb.is_multi_lapsing(3, 61, 30.0))
        self.assertFalse(rb.is_multi_lapsing(2, 30, 30.0))   # needs >= 3 visits
        self.assertFalse(rb.is_multi_lapsing(5, 400, 365.0))  # 365-day cap
        self.assertFalse(rb.is_multi_lapsing(3, 30, None))

    def test_segments_and_activity(self):
        self.assertIsNone(rb.segment_for_count(0))
        self.assertEqual([rb.segment_for_count(n) for n in (1, 2, 4, 5)],
                         ["new", "repeat", "repeat", "loyal"])
        self.assertEqual([rb.activity_for_days(d) for d in (0, 182, 183, 364, 365)],
                         ["active_6m", "active_6m", "lapsed_6_12m", "lapsed_6_12m", "dormant_12m+"])

    def test_bedding_default(self):
        spec = {"B1": ["2023-01-01", "2023-06-30"],   # gap 180
                "B2": ["2023-01-01", "2023-07-20"],   # gap 200
                "C1": ["2023-01-01", "2023-01-31"],   # gap 30
                "C2": ["2023-01-01", "2023-02-10"],   # gap 40
                "BS": ["2023-08-01"], "CS": ["2023-08-01"]}
        cls = {"B1": "寢具", "B2": "寢具", "BS": "寢具"}
        snap = rb.build_snapshot(visits_from(spec, cls), date(2023, 9, 1))
        st = {s.cid: s for s in snap.states}
        self.assertEqual(snap.bedding_cycle, 190.0)
        self.assertEqual(snap.default_cycle, 110.0)
        self.assertEqual(st["BS"].cycle, 190.0)
        self.assertEqual(st["BS"].cycle_source, "bedding_default")
        self.assertEqual(st["CS"].cycle, 110.0)


class TestBacktest(unittest.TestCase):
    T = date(2024, 4, 30)
    SPEC = {
        "A": ["2024-03-01", "2024-03-31", "2024-05-10"],   # due (1.0), returns
        "B": ["2024-04-01", "2024-04-21", "2024-06-01"],   # 0.45, returns
        "C": ["2024-01-01", "2024-02-01"],                 # 89/31=2.87 due, no return
        "D": ["2023-08-01", "2024-05-05"],                 # not active -> not in P
        "E": ["2024-04-15"],                               # default 30 -> 0.5
        "F": ["2023-11-01", "2023-12-01", "2024-07-01"],   # 151/30=5.03, returns
    }

    def test_cutoffs_complete_window(self):
        self.assertEqual(rb.month_end_cutoffs(self.T, date(2024, 7, 29)), [self.T])
        self.assertEqual(rb.month_end_cutoffs(self.T, date(2024, 7, 28)), [])
        self.assertEqual(rb.month_end_cutoffs(self.T, date(2024, 8, 29)),
                         [self.T, date(2024, 5, 31)])
        for t in rb.month_end_cutoffs(self.T, date(2026, 1, 15)):
            self.assertLessEqual(t + timedelta(days=90), date(2026, 1, 15))

    def test_evaluate_cutoff_hand_computed(self):
        r = rb.evaluate_cutoff(visits_from(self.SPEC), self.T)
        self.assertEqual(r.population, 5)
        self.assertEqual(r.returners, 3)
        self.assertAlmostEqual(r.base_rate, 0.6)
        self.assertEqual((r.due.size, r.due.hits), (2, 1))
        self.assertAlmostEqual(r.due.precision, 0.5)
        self.assertAlmostEqual(r.due.recall, 1 / 3)
        self.assertAlmostEqual(r.due.lift, 0.5 / 0.6)
        self.assertEqual((r.topk.size, r.topk.hits), (2, 1))
        self.assertAlmostEqual(r.baseline.precision, 0.6)
        self.assertAlmostEqual(r.baseline.recall, 1.0)
        self.assertAlmostEqual(r.baseline.lift, 1.0)
        # recent_30_90: A (30 days, returns) and C (89 days, no return)
        self.assertEqual((r.recent_30_90.size, r.recent_30_90.hits), (2, 1))
        # multi_lapsing: nobody has >= 3 visits by T
        self.assertEqual(r.multi_lapsing.size, 0)
        self.assertIsNone(r.multi_lapsing.precision)

    def test_multi_lapsing_selector(self):
        spec = {"G": ["2024-01-01", "2024-02-01", "2024-03-02", "2024-05-15"],  # 59 / 30.5 = 1.93
                "H": ["2024-03-01", "2024-03-11", "2024-03-21"]}                # 40 / 10 = 4.0
        r = rb.evaluate_cutoff(visits_from(spec), self.T)
        self.assertEqual(r.population, 2)
        self.assertEqual((r.multi_lapsing.size, r.multi_lapsing.hits), (1, 1))
        self.assertAlmostEqual(r.multi_lapsing.lift, 2.0)

    def test_top_k_selection(self):
        snap = rb.build_snapshot(visits_from(self.SPEC), self.T)
        pop = [s for s in snap.states if s.days_since < rb.ACTIVE_DAYS]
        self.assertEqual([s.cid for s in rb.select_top_k(pop, 2)], ["F", "C"])
        self.assertEqual(rb.select_top_k(pop, 0), [])

    def test_summarize(self):
        r = rb.evaluate_cutoff(visits_from(self.SPEC), self.T)
        s = rb.summarize_backtest([r, r])
        self.assertEqual(s["n_cutoffs"], 2)
        self.assertAlmostEqual(s["due"].mean_precision, 0.5)
        self.assertAlmostEqual(s["due"].pooled_precision, 0.5)
        self.assertAlmostEqual(s["recent_30_90"].mean_precision, 0.5)
        self.assertIsNone(s["multi_lapsing"].mean_lift)
        self.assertIsNone(rb.summarize_backtest([])["due"].mean_precision)

    def test_choose_best_selector(self):
        s = summ(due=0.9, topk=0.8, recent_30_90=1.1, multi_lapsing=1.5)
        self.assertEqual(rb.choose_best_selector(s), ("multi_lapsing", 1.5))
        self.assertEqual(rb.choose_best_selector(summ(due=0.5, topk=0.7))[0], "topk")
        # baseline (always 1.0) is never chosen
        self.assertEqual(rb.choose_best_selector(summ(due=0.5))[0], "due")

    def test_choose_tie_goes_to_due(self):
        s = summ(due=1.2, topk=1.2, recent_30_90=1.2, multi_lapsing=1.1)
        self.assertEqual(rb.choose_best_selector(s)[0], "due")
        self.assertEqual(rb.choose_best_selector(summ())[0], "due")  # no data at all

    def test_conclusion_below_one_wording(self):
        text = rb.backtest_conclusion(summ(due=0.88, topk=0.73, recent_30_90=0.95,
                                           multi_lapsing=0.9), 3, 4)
        self.assertTrue(text.startswith("結論："))
        self.assertIn("回測最好的規則是「" + rb.SELECTOR_LABELS["recent_30_90"] + "」", text)
        self.assertIn("並沒有比直接聯絡「近 6 個月有來店的全部客人」更準", text)
        self.assertIn(rb.NOTE_NO_RULE_BETTER, text)
        self.assertIn("聯絡名單採用「" + rb.SELECTOR_LABELS["recent_30_90"] + "」", text)

    def test_conclusion_other_rule_beats_baseline(self):
        text = rb.backtest_conclusion(summ(due=0.88, multi_lapsing=1.3), 0, 0)
        self.assertIn("回測最好的規則是「" + rb.SELECTOR_LABELS["multi_lapsing"] + "」", text)
        self.assertIn("並沒有比直接聯絡", text)
        self.assertNotIn(rb.NOTE_NO_RULE_BETTER, text)

    def test_conclusion_due_best(self):
        text = rb.backtest_conclusion(summ(due=1.4, topk=1.2), 0, 0)
        self.assertIn("回測最好的規則是「" + rb.SELECTOR_LABELS["due"] + "」", text)
        self.assertNotIn("並沒有比直接聯絡", text)
        self.assertNotIn(rb.NOTE_NO_RULE_BETTER, text)

    def test_first_timer_return(self):
        spec = {"X": ["2024-01-01", "2024-03-15"], "Y": ["2024-01-10", "2024-05-01"],
                "Z": ["2024-02-01"], "V": ["2024-02-10", "2024-05-10"],  # exactly day 90
                "W": ["2024-06-01"]}                                   # incomplete window
        res = rb.first_timer_return(visits_from(spec), date(2024, 7, 1),
                                    data_start=date(2024, 1, 1), burn_in_days=0)
        self.assertEqual([(c.month, c.n, c.returned) for c in res.cohorts],
                         [("2024-01", 2, 1), ("2024-02", 2, 1)])
        self.assertEqual((res.overall_n, res.overall_returned), (4, 2))
        self.assertAlmostEqual(res.overall_rate, 0.5)
        burn = rb.first_timer_return(visits_from(spec), date(2024, 7, 1),
                                     data_start=date(2024, 1, 1), burn_in_days=183)
        self.assertEqual(burn.overall_n, 0)
        self.assertTrue(all(c.early for c in burn.cohorts))


class TestCli(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.repo = base / "repo"
        self.repo.mkdir()
        self.private = base / "private"
        self.data = synthetic_dataset()
        self.json_path = base / "input" / "data.json"
        self.json_path.parent.mkdir()
        self._write_json()

    def _write_json(self):
        self.json_path.write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def _run(self, *extra, private=None):
        out, err = io.StringIO(), io.StringIO()
        argv = ["--source", "json", "--json", str(self.json_path), "--repo-root", str(self.repo),
                "--private-dir", str(private if private is not None else self.private), *extra]
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = rb.main(argv)
        return code, out.getvalue(), err.getvalue()

    def _pii(self):
        vals = []
        for c in self.data["customers"]:
            vals += [c["cid"], c["name"]] + [v for v in (c["mtel"], c["tel"]) if v]
        return vals

    def _assert_no_pii(self, text):
        for v in self._pii():
            self.assertNotIn(v, text)

    def test_dry_run_writes_nothing(self):
        code, out, _ = self._run("--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(list(self.repo.iterdir()), [])
        self.assertFalse(self.private.exists())
        self.assertIn("dry-run", out)
        self.assertTrue(out.splitlines()[0].startswith("[C4] 結論："))
        self._assert_no_pii(out)

    def test_writes_report_and_private_csv(self):
        code, out, _ = self._run()
        self.assertEqual(code, 0)
        report = self.repo / "reports" / "crm" / "crm-backtest-2025-03-31.md"
        self.assertTrue(report.exists())
        csvs = list(self.private.glob("*.csv"))
        self.assertEqual(len(csvs), 1)
        self.assertEqual([p for p in self.repo.rglob("*.csv")], [])
        lines = csvs[0].read_text(encoding="utf-8-sig").splitlines()
        self.assertTrue(lines[0].startswith("#"))
        self.assertIn("do not send without owner approval", lines[0])
        self.assertEqual(lines[1].split(","), rb.CSV_COLUMNS)
        a = rb.run_analysis(rb.load_from_json(self.json_path))
        rows = list(csv.reader(lines[2:]))
        self.assertEqual(len(rows), len(a.contact_list))
        for row in rows:
            self.assertEqual(row[-1], a.contact_rule)
        if not a.contact_beats_baseline:
            self.assertIn(rb.NOTE_NO_RULE_BETTER, lines[0])
        self._assert_no_pii(out)

    def test_formula_name_prefixed_end_to_end(self):
        for c in self.data["customers"]:
            if c["cid"] == "QZ1001":
                c["name"] = "=虛構惡意名"
        self._write_json()
        fixed = [make_state("QZ1001")]
        with mock.patch.object(rb, "contact_list_for", return_value=fixed):
            code, _, _ = self._run()
        self.assertEqual(code, 0)
        csv_path = next(self.private.glob("*.csv"))
        lines = csv_path.read_text(encoding="utf-8-sig").splitlines()
        rows = list(csv.reader(lines[1:]))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1][0], "QZ1001")
        self.assertEqual(rows[1][1], "'=虛構惡意名")

    def test_report_has_no_pii_and_conclusion_first(self):
        self._run()
        text = (self.repo / "reports" / "crm" / "crm-backtest-2025-03-31.md").read_text(encoding="utf-8")
        self.assertTrue(text.splitlines()[0].startswith("結論："))
        self.assertIn("回測最好的規則", text.splitlines()[0])
        self.assertIn("未傳送任何訊息", text)
        self.assertIn("不代表因果", text)
        for name in rb.SELECTOR_NAMES:
            self.assertIn(rb.SELECTOR_LABELS[name], text)
        self._assert_no_pii(text)
        self.assertNotIn("0000", text.replace("0000%", ""))  # house id never listed

    def test_analysis_on_synthetic(self):
        raw = rb.load_from_json(self.json_path)
        a = rb.run_analysis(raw)
        self.assertEqual(a.as_of, date(2025, 3, 31))
        self.assertEqual(a.house_count, 1)
        self.assertEqual(a.piece_stats["duplicates_removed"], 1)
        self.assertEqual(a.piece_stats["bad_dates"], 2)
        # every piece of a multi-piece order is kept (only the 2 bad dates drop)
        self.assertEqual(a.piece_stats["pieces"], len(self.data["pieces"]) - 2)
        self.assertGreater(a.summary["n_cutoffs"], 0)
        for r in a.cutoff_results:
            self.assertLessEqual(r.cutoff + timedelta(days=90), a.data_last)
        self.assertEqual(a.n_customers, 30)
        self.assertEqual(a.contact_rule, rb.choose_best_selector(a.summary)[0])

    def test_error_exit_codes(self):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            code = rb.main(["--source", "json", "--repo-root", str(self.repo),
                            "--private-dir", str(self.private)])
        self.assertEqual(code, 1)
        code2, _, _ = self._run("--as-of", "not-a-date")
        self.assertEqual(code2, 1)

    def test_private_dir_inside_reports_rejected(self):
        bad = self.repo / "reports" / "crm" / "private"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = rb.main(["--source", "json", "--json", str(self.json_path),
                            "--repo-root", str(self.repo), "--private-dir", str(bad)])
        self.assertEqual(code, 1)
        self.assertEqual(list(self.repo.iterdir()), [])

    def test_private_dir_docs_rejected(self):
        code, _, err = self._run(private=self.repo / "docs" / "crm")
        self.assertEqual(code, 1)
        self.assertIn("data", err)
        self.assertEqual(list(self.repo.iterdir()), [])

    def test_private_dir_repo_root_rejected(self):
        code, _, _ = self._run(private=self.repo)
        self.assertEqual(code, 1)
        self.assertEqual(list(self.repo.iterdir()), [])

    def test_private_dir_data_allowed(self):
        target = self.repo / "data" / "crm"
        code, _, _ = self._run(private=target)
        self.assertEqual(code, 0)
        self.assertEqual(len(list(target.glob("*.csv"))), 1)

    def test_private_dir_outside_repo_allowed(self):
        with tempfile.TemporaryDirectory() as other:
            target = Path(other) / "crm"
            code, _, _ = self._run(private=target)
            self.assertEqual(code, 0)
            self.assertEqual(len(list(target.glob("*.csv"))), 1)
        self.assertEqual([p for p in self.repo.rglob("*.csv")], [])


if __name__ == "__main__":
    unittest.main()