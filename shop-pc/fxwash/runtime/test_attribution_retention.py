"""Offline tests for attribution_retention (B2-6)."""

import io
import json
import os
import shutil
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path

import attribution_export as ax
import attribution_retention as ar
import attribution_service as asvc
import test_attribution_export as tx
import test_attribution_service as tsvc

TZ = asvc.TZ_TAIPEI
DAY = timedelta(days=1)
NOW = datetime(2027, 3, 1, 10, 0, tzinfo=TZ)
CUTOFF = datetime(2026, 11, 30, tzinfo=TZ)  # Monday; 2027-03-01 - 90 d = 2026-12-01


def at(month, day, hour=10, year=2026):
    return datetime(year, month, day, hour, 0, tzinfo=TZ)


PIECES = [
    tx.piece("P1", "K1", at(12, 11)),
    tx.piece("P2", "K6", at(12, 3)),
    tx.piece("P3", "K3", at(12, 12)),
    tx.piece("P4", "K5", at(12, 4)),
    tx.piece("P5", "K2", at(12, 12)),
    tx.piece("P6", "K4", "2026/12/12"),
]


def pos_loader():
    return list(PIECES), None, ax.POS_DET_UNVERIFIED


def failing_loader():
    raise ax.ExportError("POS connector unavailable (test)")


def build_scenario():
    L = tx.Ledger()
    named = {}
    L.bind("alice", "K1", at(10, 1))                                  # open at cutoff -> keep
    L.bind("bob", "O1", at(10, 2), kind="binding_observed")           # open at cutoff -> keep
    L.bind("bob", "K2", at(10, 5))                                    # superseded -> remove
    L.bind("bob", "K3", at(10, 20))                                   # open at cutoff -> keep
    L.bind("carol", "K4", at(10, 3))                                  # revoked -> remove
    L.bind("carol", "K4", at(10, 10), kind="binding_revoked")         # remove
    old = L.msg("alice", at(10, 26), tx.CODE1)                        # W44 -> remove
    L.copy(old)                                                       # duplicate -> remove
    L.event("booking_confirmed", "alice", at(10, 26, 12), booking_id="b-1")  # remove
    L.corrupt()                                                       # gap ends before cutoff -> remove
    t = L.msg("bob", at(11, 2), tx.CODE2)                             # W45 -> remove
    L.event("unsend_tombstone", "bob", at(11, 2, 11), message_key=t["message_key"])  # remove
    L.bind("dave", "K5", at(11, 25))                                  # open at cutoff -> keep
    L.msg("erin", at(11, 27), tx.CODE3)                               # W48 -> remove
    # ---- after the cutoff: everything kept
    L.bind("erin", "K6", at(12, 1))
    L.msg("dave", at(12, 2), tx.CODE1)
    L.msg("erin", at(12, 5), tx.CODE2)
    L.msg("alice", at(12, 10), tx.CODE1)
    L.msg("bob", at(12, 10, 11), tx.CODE2)
    L.corrupt(b"{broken after cutoff")
    named["carol_new"] = L.msg("carol", at(12, 11))
    L.bind("bob", "K7", at(12, 15))
    return L, named


EXPECTED_KEPT = {"binding_confirmed": 5, "binding_observed": 1, "corrupt_line": 1, "message_observed": 5}
EXPECTED_REMOVED = {"binding_confirmed": 2, "binding_revoked": 1, "booking_confirmed": 1,
                    "corrupt_line": 1, "message_observed": 4, "unsend_tombstone": 1}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="attr-ret-")
        self.root = Path(self.tmp)
        (self.root / "secrets").mkdir()
        (self.root / "secrets" / "attribution_hmac.key").write_text(tx.KEY.hex(), encoding="ascii")
        reg = self.root / "data" / "attribution"
        reg.mkdir(parents=True)
        entries = [{"source_code": c, "content_id": "c" + c[-2:], "kind": "post"}
                   for c in (tx.CODE1, tx.CODE2, tx.CODE3)]
        (reg / "source-codes.json").write_text(
            json.dumps({"schema_version": 1, "registry_version": "reg-1", "entries": entries}),
            encoding="utf-8")
        self.L, self.named = build_scenario()
        self.full = self.L.dump()
        self.ledger_path.write_bytes(self.full)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @property
    def ledger_path(self):
        return self.root / "data" / "inquiries.jsonl"

    @property
    def gen_path(self):
        return self.root / "data" / "inquiries.jsonl.gen"

    def run_ret(self, **kw):
        kw.setdefault("now", NOW)
        kw.setdefault("pos_loader", pos_loader)
        kw.setdefault("lock_wait", 1.0)
        return ar.run_retention(self.root, **kw)

    def plan(self, data=None):
        return ar.plan_prune(self.full if data is None else data, cutoff=CUTOFF, shop_id=tx.SHOP,
                             oa_scope=tx.OA, hash_key_version=tx.HKV)

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}


class CutoffTests(unittest.TestCase):
    def test_cutoff_rounds_down_to_iso_monday_taipei(self):
        self.assertEqual(ar.compute_cutoff(NOW, 90), CUTOFF)
        self.assertEqual(ar.compute_cutoff(datetime(2027, 2, 28, 12, tzinfo=TZ), 90), CUTOFF)
        self.assertEqual(ar.compute_cutoff(datetime(2027, 3, 7, 12, tzinfo=TZ), 90),
                         datetime(2026, 12, 7, tzinfo=TZ))
        # 17:00 UTC on Feb 28 is already March 1 in Taipei.
        self.assertEqual(ar.compute_cutoff(datetime(2027, 2, 28, 17, tzinfo=timezone.utc), 90), CUTOFF)
        for days in (30, 45, 90, 365):
            self.assertEqual(ar.compute_cutoff(NOW, days).astimezone(TZ).weekday(), 0)

    def test_maturity_horizon_is_longest_window(self):
        self.assertEqual(ar.MATURITY_HORIZON, timedelta(days=14))
        t_i = at(12, 1).astimezone(timezone.utc)
        inq = ax.Inquiry("i", "u", at(12, 1).date(), t_i, "other")
        late = [ax.Interval(t_i + ax.WINDOW - timedelta(seconds=1), ax.FAR_FUTURE, "ck")]
        st = ax.setup_policy(inq, late, "B7")
        self.assertGreater(st.maturity_end - t_i, ax.WINDOW)
        self.assertLessEqual(st.maturity_end - t_i, ar.MATURITY_HORIZON)


class PlanTests(Base):
    def post_cutoff_view(self, data):
        led = ax.parse_ledger(data, as_of=NOW, shop_id=tx.SHOP, oa_scope=tx.OA, hash_key_version=tx.HKV)
        inqs = sorted(ax.build_inquiries(led.rows, tx.SHOP, tx.OA).values(),
                      key=lambda i: (i.t_i, i.inquiry_id))
        confirmed, observed, _ = ax.build_timelines(led.rows)
        timelines = {}
        for name, store in (("confirmed", confirmed), ("observed", observed)):
            cut = {u: [iv for iv in ivs if iv.end > CUTOFF] for u, ivs in store.items()}
            timelines[name] = {u: v for u, v in cut.items() if v}
        pos = ax.prepare_pieces(PIECES, tx.KEY)
        post = [i for i in inqs if i.t_i >= CUTOFF]
        alloc = {}
        for policy in ax.POLICIES:
            states = ax.allocate(inqs, pos.pieces, confirmed, observed, policy)
            ax.finalize_states(states, inqs, confirmed, pos, led.gaps, NOW, NOW)
            alloc[policy] = {
                i.inquiry_id: (states[i.inquiry_id].status, sorted(states[i.inquiry_id].pieces),
                               sorted(states[i.inquiry_id].reasons), states[i.inquiry_id].w0,
                               states[i.inquiry_id].w1, states[i.inquiry_id].maturity_end,
                               states[i.inquiry_id].has_binding, states[i.inquiry_id].candidate_only)
                for i in post}
        inq_view = [(i.inquiry_id, i.t_i, i.first_intent, i.source_code, i.booking_confirmed,
                     sorted(i.flags)) for i in post]
        return timelines, inq_view, alloc, led

    def test_full_and_pruned_give_same_post_cutoff_timelines_and_allocations(self):
        plan = self.plan()
        self.assertGreater(plan.removed_total, 0)
        t_full, i_full, a_full, led_full = self.post_cutoff_view(self.full)
        t_pruned, i_pruned, a_pruned, _ = self.post_cutoff_view(plan.data)
        self.assertEqual(t_full, t_pruned)
        self.assertEqual(len(i_full), 5)
        self.assertEqual(i_full, i_pruned)
        self.assertEqual(a_full, a_pruned)
        self.assertIn(ax.ST_RECEIVED, {v[0] for v in a_full["I7"].values()})
        self.assertIn(ax.ST_RECEIVED, {v[0] for v in a_full["B7"].values()})
        led_pruned = ax.parse_ledger(plan.data, as_of=NOW, shop_id=tx.SHOP, oa_scope=tx.OA,
                                     hash_key_version=tx.HKV)
        for week in ("2026-W49", "2026-W50"):
            docs = [ax.compute_export(led, PIECES, key=tx.KEY, week=week, as_of=NOW, shop_id=tx.SHOP,
                                      oa_scope=tx.OA, pos_source_id=None, registry_version="reg-1",
                                      exported_at=NOW)
                    for led in (led_full, led_pruned)]
            self.assertEqual(docs[0]["rows"], docs[1]["rows"], week)

    def test_minimal_binding_rows_and_counts(self):
        plan = self.plan()
        self.assertEqual(plan.kept, EXPECTED_KEPT)
        self.assertEqual(plan.removed, EXPECTED_REMOVED)
        self.assertEqual(plan.required_weeks, ["2026-W44", "2026-W48"])
        self.assertEqual(plan.weeks_pruned, ["2026-W40", "2026-W41", "2026-W44", "2026-W45", "2026-W48"])
        kept_bindings = set()
        for line in plan.data.splitlines():
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj["event_kind"].startswith("binding_"):
                kept_bindings.add((obj["user_key"], obj["ts"][:10]))
        self.assertIn((tx.uk("alice"), "2026-10-01"), kept_bindings)
        self.assertIn((tx.uk("bob"), "2026-10-20"), kept_bindings)
        self.assertNotIn((tx.uk("bob"), "2026-10-05"), kept_bindings)
        self.assertFalse(any(u == tx.uk("carol") for u, _ in kept_bindings))

    def test_backfilled_old_row_is_kept(self):
        L = tx.Ledger()
        L.msg("zoe", at(10, 26), recorded=NOW - DAY)
        L.msg("yan", at(10, 27))
        plan = self.plan(L.dump())
        self.assertEqual(plan.removed, {"message_observed": 1})
        self.assertEqual(plan.kept, {"message_observed": 1})


class RunTests(Base):
    def test_prune_exports_missing_weeks_first(self):
        res = self.run_ret()
        self.assertEqual(res.code, 0, res.line)
        self.assertEqual(res.report["weeks_exported_first"], ["2026-W44", "2026-W48"])
        for week in ("2026-W44", "2026-W48"):
            doc = json.loads(ax.output_path(self.root, week).read_text(encoding="utf-8"))
            _, end = ax.iso_week_bounds(week)
            self.assertGreaterEqual(ax.parse_ts(doc["as_of"]), end + ar.MATURITY_HORIZON)
        self.assertEqual(self.ledger_path.read_bytes(), self.plan().data)
        self.assertEqual(self.gen_path.read_text(encoding="ascii").strip(), "1")
        self.assertEqual(res.report["removed"], EXPECTED_REMOVED)

    def test_export_failure_prunes_nothing(self):
        res = self.run_ret(pos_loader=failing_loader)
        self.assertEqual(res.code, 1)
        self.assertEqual(self.ledger_path.read_bytes(), self.full)
        self.assertFalse(self.gen_path.exists())
        self.assertFalse(ar.prune_log_path(self.root).exists())
        self.assertFalse((self.root / "data" / "inquiries.jsonl.lock").exists())

    def test_matured_summaries_skip_export(self):
        for week in ("2026-W44", "2026-W48"):
            self.assertEqual(ax.export_week(self.root, week, NOW - DAY, PIECES).code, 0)
        res = self.run_ret(pos_loader=failing_loader)  # must not be called
        self.assertEqual(res.code, 0, res.line)
        self.assertEqual(res.report["weeks_exported_first"], [])
        doc = json.loads(ax.output_path(self.root, "2026-W44").read_text(encoding="utf-8"))
        self.assertEqual(doc["revision"], 1)

    def test_immature_summary_is_reexported(self):
        _, end = ax.iso_week_bounds("2026-W44")
        self.assertEqual(ax.export_week(self.root, "2026-W44", end + 2 * DAY, PIECES).code, 0)
        res = self.run_ret()
        self.assertEqual(res.code, 0, res.line)
        self.assertIn("2026-W44", res.report["weeks_exported_first"])
        doc = json.loads(ax.output_path(self.root, "2026-W44").read_text(encoding="utf-8"))
        self.assertEqual(doc["revision"], 2)
        self.assertGreaterEqual(ax.parse_ts(doc["as_of"]), end + ar.MATURITY_HORIZON)

    def test_dry_run_writes_nothing(self):
        before = self.snapshot()
        res = self.run_ret(dry_run=True, pos_loader=failing_loader)
        self.assertEqual(res.code, 0, res.line)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(res.line.splitlines()), 1)
        for part in ("dry-run", "removed=10", "kept=12", "weeks_pruned=5", "weeks_exported_first=2",
                     "message_observed=4"):
            self.assertIn(part, res.line)

    def test_idempotent_second_run_removes_nothing(self):
        first = self.run_ret()
        self.assertEqual(first.code, 0, first.line)
        after_first = self.ledger_path.read_bytes()
        second = self.run_ret(pos_loader=failing_loader)
        self.assertEqual(second.code, 0, second.line)
        self.assertEqual(second.report["removed_total"], 0)
        self.assertIsNone(second.report["generation"])
        self.assertEqual(self.ledger_path.read_bytes(), after_first)
        self.assertEqual(self.gen_path.read_text(encoding="ascii").strip(), "1")
        log = ar.prune_log_path(self.root).read_text(encoding="ascii").splitlines()
        self.assertEqual(len(log), 2)
        self.assertEqual(json.loads(log[1])["removed_total"], 0)
        leftovers = [p.name for p in (self.root / "data").iterdir() if ".tmp" in p.name or "prune-" in p.name]
        self.assertEqual(leftovers, [])

    def test_lock_busy_exit3_changes_nothing(self):
        lock = self.root / "data" / "inquiries.jsonl.lock"
        lock.write_text("held by webhook", encoding="ascii")
        before = self.snapshot()
        t0 = time.monotonic()
        res = self.run_ret(lock_wait=0.2)
        self.assertLess(time.monotonic() - t0, 2.0)
        self.assertEqual(res.code, 3)
        self.assertIn("busy", res.line)
        self.assertEqual(self.snapshot(), before)

    def test_stale_lock_is_broken(self):
        lock = self.root / "data" / "inquiries.jsonl.lock"
        lock.write_text("crashed", encoding="ascii")
        old = time.time() - 120
        os.utime(lock, (old, old))
        res = self.run_ret(lock_wait=0.2)
        self.assertEqual(res.code, 0, res.line)
        self.assertFalse(lock.exists())
        self.assertEqual(self.gen_path.read_text(encoding="ascii").strip(), "1")

    def test_retention_below_30_refused(self):
        before = self.snapshot()
        err = io.StringIO()
        with redirect_stdout(io.StringIO()), redirect_stderr(err):
            rc = ar.main(["--root", str(self.root), "--retention-days", "29"])
        self.assertEqual(rc, 2)
        self.assertIn("refused", err.getvalue())
        self.assertEqual(self.run_ret(retention_days=0).code, 2)
        self.assertEqual(self.snapshot(), before)

    def test_cli_output_and_log_contain_counts_only(self):
        pos = self.root / "pieces.json"
        pos.write_text(json.dumps(PIECES), encoding="utf-8")
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = ar.main(["--root", str(self.root), "--as-of", tx.iso(NOW), "--pos-json", str(pos),
                          "--lock-wait", "2"])
        self.assertEqual(rc, 0, err.getvalue())
        text = out.getvalue() + err.getvalue() + ar.prune_log_path(self.root).read_text(encoding="ascii")
        self.assertEqual(len(out.getvalue().splitlines()), 1)
        needles = {tx.KEY.hex(), "K1", "alice", "bob"}
        for r in self.L.rows:
            for name in ("user_key", "cid_key", "event_id", "message_key"):
                if isinstance(r.get(name), str):
                    needles.add(r[name])
        for value in needles:
            self.assertNotIn(value, text)

    def test_live_ledger_survives_prune(self):
        live = asvc.AttributionLedger(self.root / "data", self.root / "secrets" / "attribution_hmac.key",
                                      tx.SHOP, tx.OA, "shop-pc")
        self.assertTrue(live.enabled)
        self.assertEqual(len([g for g in live.coverage_gaps if g["kind"] == "corrupt_line"]), 2)
        res = self.run_ret()
        self.assertEqual(res.code, 0, res.line)
        kept_wid = self.named["carol_new"]["event_id"].split(":", 1)[1]
        with redirect_stderr(io.StringIO()):
            self.assertIsNone(live.record_message(tsvc.make_event(webhook_id=kept_wid), None, "v"))
            row = live.record_message(tsvc.make_event(webhook_id="NEW-0001"), None, "v")
        self.assertIsNotNone(row)
        self.assertEqual(live.ledger_replaced_count, 1)
        self.assertEqual(len([g for g in live.coverage_gaps if g["kind"] == "corrupt_line"]), 1)
        data = self.ledger_path.read_bytes()
        self.assertTrue(data.endswith(b"\n"))
        ids = set()
        for line in data.splitlines():
            try:
                ids.add(json.loads(line)["event_id"])
            except ValueError:
                pass
        self.assertIn(tx.OA + ":NEW-0001", ids)
        self.assertEqual(live.status()["indexed_event_ids"], len(ids))
        self.assertEqual(len(ids), 12)


if __name__ == "__main__":
    unittest.main()
