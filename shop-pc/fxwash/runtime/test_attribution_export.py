"""Offline tests for attribution_export (synthetic ledger + synthetic pieces).

Run from the fxwash root:
    python -I -S -B -m unittest discover -s runtime -p test_attribution_export.py
"""

import hashlib
import hmac
import io
import json
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, datetime, timedelta
from pathlib import Path

import attribution_export as ax
import attribution_service as asvc

TZ = asvc.TZ_TAIPEI
SHOP = "fxwash"
OA = "fxwash-line-oa"
KEY = bytes(range(1, 33))
HKV = "hk1-" + hmac.new(KEY, b"fxwash-attribution-key-fingerprint-v1", hashlib.sha256).hexdigest()[:16]
CODE1, CODE2, CODE3 = "SXJ-261026-S1", "SXJ-261026-S2", "SXJ-261026-S3"
WEEK = "2026-W44"
T0 = datetime(2026, 10, 26, 10, 0, tzinfo=TZ)  # Monday of 2026-W44, 10:00 Taipei
DAY = timedelta(days=1)
H = timedelta(hours=1)
AS_OF = T0 + 30 * DAY


def h(value):
    return hmac.new(KEY, value.encode("utf-8"), hashlib.sha256).hexdigest()


def uk(name):
    return h(SHOP + "|" + OA + "|" + name)


def iso(dt):
    return dt.isoformat(timespec="milliseconds")


def pos_time(dt):
    return dt.astimezone(TZ).strftime("%Y/%m/%d %H:%M:%S")


def piece(pid, cid, when):
    rec = when if isinstance(when, str) else pos_time(when)
    return {"piece_id": pid, "order_no": "D" + pid, "customer_id": cid, "received_at": rec, "state": ""}


class Ledger:
    """Builds synthetic rows with the exact B2-2 schema."""

    def __init__(self):
        self.items = []
        self.rows = []
        self.n = 0

    def event(self, kind, user, at, eid=None, recorded=None, runtime="shop-pc", **fields):
        self.n += 1
        row = {
            "schema_version": 1, "policy_version": "v1", "event_kind": kind,
            "event_id": eid or "%s:evt-%05d" % (OA, self.n), "event_id_basis": "line",
            "ts": iso(at), "ts_basis": "line", "recorded_at": iso(recorded or at),
            "shop_id": SHOP, "oa_scope": OA, "runtime_id": runtime,
            "user_key": uk(user), "hash_key_version": HKV,
        }
        row.update(fields)
        self.items.append(row)
        self.rows.append(row)
        return row

    def msg(self, user, at, code=None, intent="quote", status=None, mtype="text", **kw):
        return self.event(
            "message_observed", user, at, message_key=h("msg-%d" % (self.n + 1)),
            message_type=mtype, first_intent=intent, intent_basis="rule_v1", source_code=code,
            source_method="keyword", source_status=status or ("ok" if code else "unknown_no_code"),
            source_registry_version="reg-1", **kw)

    def bind(self, user, cid, at, kind="binding_confirmed", **kw):
        norm, status = asvc.normalize_cid(cid)
        trust = {"binding_confirmed": "confirmed", "binding_observed": "observed",
                 "binding_revoked": "revoked"}[kind]
        return self.event(kind, user, at, cid_key=h(norm) if status == "single" else None,
                          identity_status=status, pos_source_id="ehank", binding_trust=trust,
                          binding_basis="staff", **kw)

    def copy(self, row, **changes):
        r = dict(row)
        r.update(changes)
        self.items.append(r)
        return r

    def corrupt(self, raw=b"{not json at all"):
        self.items.append(raw)

    def dump(self):
        out = b""
        for it in self.items:
            if isinstance(it, bytes):
                out += it + b"\n"
            else:
                out += json.dumps(it, sort_keys=True, ensure_ascii=False).encode("utf-8") + b"\n"
        return out


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="attr-export-")
        self.root = Path(self.tmp)
        (self.root / "secrets").mkdir()
        (self.root / "secrets" / "attribution_hmac.key").write_text(KEY.hex(), encoding="ascii")
        reg = self.root / "data" / "attribution"
        reg.mkdir(parents=True)
        entries = [{"source_code": c, "content_id": "c" + c[-2:], "kind": "post"} for c in (CODE1, CODE2, CODE3)]
        (reg / "source-codes.json").write_text(
            json.dumps({"schema_version": 1, "registry_version": "reg-1", "entries": entries}), encoding="utf-8")
        self.L = Ledger()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_export(self, pieces=(), as_of=AS_OF, week=WEEK, pos_through=None,
                   completeness=ax.POS_DET_UNVERIFIED, dry_run=True, tail=b""):
        (self.root / "data" / "inquiries.jsonl").write_bytes(self.L.dump() + tail)
        return ax.export_week(self.root, week, as_of, list(pieces), pos_through=pos_through,
                              pos_completeness=completeness, dry_run=dry_run)

    def doc(self, *a, **kw):
        res = self.run_export(*a, **kw)
        self.assertEqual(res.code, 0, res.message)
        return res.doc

    @staticmethod
    def row(doc, code):
        return next(r for r in doc["rows"] if r["source_code"] == code)

    def pol(self, doc, code, policy="I7"):
        return self.row(doc, code)[policy]

    def assertInvariant(self, doc):
        for r in doc["rows"]:
            for p in ("I7", "B7"):
                b = r[p]
                total = b["received_inquiries"] + b["pending_window"] + b["unknown_inquiries"] + b["matured_no_receipt"]
                self.assertEqual(total, r["inquiries"], (r["source_code"], p))
                self.assertLessEqual(b["candidate_only"], b["unknown_inquiries"])


# ---------------------------------------------------------------- pure parts

class PureTests(unittest.TestCase):
    def test_parse_received_exact(self):
        rec = ax.parse_received_at("2026/10/27 14:05:09")
        self.assertTrue(rec.exact)
        self.assertEqual(rec.lo, datetime(2026, 10, 27, 14, 5, 9, tzinfo=TZ))

    def test_parse_received_date_only_formats(self):
        for text in ("2026/10/27", "2026-10-27", "2026-10-27 00:00:00", "115/10/27"):
            rec = ax.parse_received_at(text)
            self.assertIsNotNone(rec, text)
            self.assertFalse(rec.exact, text)
            self.assertEqual(rec.lo, datetime(2026, 10, 27, tzinfo=TZ), text)
            self.assertEqual(rec.hi - rec.lo, DAY, text)

    def test_parse_received_am_pm(self):
        pm = ax.parse_received_at("2026/10/27 \u4e0b\u5348 02:30:00")
        am = ax.parse_received_at("2026/10/27 12:15 AM")
        self.assertEqual(pm.lo, datetime(2026, 10, 27, 14, 30, tzinfo=TZ))
        self.assertEqual(am.lo, datetime(2026, 10, 27, 0, 15, tzinfo=TZ))

    def test_parse_received_invalid(self):
        for value in ("", None, "yesterday", "2026/13/40", "2026/10/27 25:00", 12345):
            self.assertIsNone(ax.parse_received_at(value), repr(value))

    def test_in_window_boundaries(self):
        w0, w1 = T0, T0 + 7 * DAY
        self.assertEqual(ax.in_window(w0, w1, ax.parse_received_at(pos_time(T0))), ax.YES)
        self.assertEqual(ax.in_window(w0, w1, ax.parse_received_at(pos_time(T0 + 7 * DAY))), ax.NO)
        self.assertEqual(ax.in_window(w0, w1, ax.parse_received_at("2026/10/26")), ax.MAYBE)
        self.assertEqual(ax.in_window(w0, w1, ax.parse_received_at("2026/10/28")), ax.YES)
        self.assertEqual(ax.in_window(w0, w1, ax.parse_received_at("2026/10/25")), ax.NO)
        self.assertEqual(ax.in_window(w0, w1, ax.parse_received_at("2026/11/02")), ax.MAYBE)

    def test_iso_week_helpers(self):
        start, end = ax.iso_week_bounds(WEEK)
        self.assertEqual(start, datetime(2026, 10, 26, tzinfo=TZ))
        self.assertEqual(end - start, 7 * DAY)
        self.assertEqual(ax.week_label(T0), WEEK)
        self.assertEqual(ax.last_completed_week(T0 + 2 * DAY), "2026-W43")
        with self.assertRaises(ax.ExportError):
            ax.iso_week_bounds("2026-44")

    def test_cid_and_user_key_match_ledger_module(self):
        tmp = tempfile.mkdtemp(prefix="attr-led-")
        try:
            secret = Path(tmp) / "k"
            secret.write_text(KEY.hex(), encoding="ascii")
            led = asvc.AttributionLedger(Path(tmp) / "data", secret, SHOP, OA, "shop-pc")
            row = led.record_binding_observed("Uabc", " 00123 ", "staff")
            self.assertEqual(ax.cid_key(KEY, "00123")[0], row["cid_key"])
            self.assertNotEqual(ax.cid_key(KEY, "123")[0], row["cid_key"])  # leading zeros kept
            self.assertEqual(row["user_key"], uk("Uabc"))
            self.assertEqual(ax.hash_key_version(KEY), led.hash_key_version)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- ledger replay

class LedgerTests(Base):
    def test_duplicates_and_replay_count_once(self):
        r = self.L.msg("alice", T0, CODE1)
        self.L.copy(r)
        self.L.copy(r, runtime_id="night-pc")
        doc = self.doc()
        self.assertEqual(self.row(doc, CODE1)["inquiries"], 1)
        self.assertEqual(doc["coverage"]["ledger"]["duplicates"], 2)
        self.assertEqual(doc["coverage"]["runtime_ids"], ["night-pc", "shop-pc"])

    def test_same_day_multi_message_is_one_inquiry_next_day_new(self):
        self.L.msg("alice", T0, intent="lookup")
        self.L.msg("alice", T0 + H, mtype="image", intent="quote")
        self.L.msg("alice", T0 + 5 * H, intent="pickup")
        self.L.msg("alice", T0 + DAY, intent="pickup")
        r = self.row(self.doc(), "unknown")
        self.assertEqual(r["inquiries"], 2)
        self.assertEqual(r["unique_line_users"], 1)
        self.assertEqual(r["first_intent_counts"], {"quote": 0, "lookup": 1, "pickup": 1, "other": 0})

    def test_first_code_wins_later_code_is_conflict(self):
        self.L.msg("alice", T0, CODE1)
        self.L.msg("alice", T0 + H, CODE2)
        doc = self.doc()
        self.assertEqual(self.row(doc, CODE1)["inquiries"], 1)
        self.assertFalse(any(r["source_code"] == CODE2 for r in doc["rows"]))
        self.assertEqual(self.pol(doc, CODE1)["reason_counts"].get("source_conflict"), 1)

    def test_source_corrected_overrides(self):
        self.L.msg("alice", T0, CODE1)
        iid = ax.make_inquiry_id(SHOP, OA, uk("alice"), date(2026, 10, 26))
        self.L.event("source_corrected", "alice", T0 + DAY, inquiry_id=iid, source_code=CODE2,
                     reason_code="staff_fix")
        doc = self.doc()
        self.assertEqual(self.row(doc, CODE2)["inquiries"], 1)
        self.assertFalse(any(r["source_code"] == CODE1 for r in doc["rows"]))

    def test_bookings_counted_per_source(self):
        self.L.msg("alice", T0, CODE1)
        self.L.event("booking_confirmed", "alice", T0 + 2 * H, booking_id="b-1", booking_status="confirmed")
        self.L.event("booking_cancelled", "alice", T0 + 3 * H, booking_id="b-1", booking_status="cancelled")
        r = self.row(self.doc(), CODE1)
        self.assertEqual((r["booking_confirmed"], r["booking_cancelled"]), (1, 1))

    def test_rows_recorded_after_as_of_are_excluded(self):
        self.L.msg("alice", T0, CODE1)
        self.L.msg("zed", T0 + H, CODE2, recorded=AS_OF + 10 * DAY)
        doc = self.doc()
        self.assertFalse(any(r["source_code"] == CODE2 for r in doc["rows"]))
        self.assertEqual(doc["coverage"]["ledger"]["future_rows_excluded"], 1)

    def test_hash_key_mismatch_is_gap(self):
        self.L.msg("alice", T0, CODE1)
        self.L.msg("bob", T0 + H, CODE2)["hash_key_version"] = "hk1-0000000000000000"
        doc = self.doc()
        self.assertEqual(doc["status"], "lower_bound")
        self.assertIn("hash_key_mismatch", [g["kind"] for g in doc["coverage"]["gap_intervals"]])

    def test_nothing_to_export(self):
        res = ax.export_week(self.root, WEEK, AS_OF, [])
        self.assertEqual(res.code, 2)
        self.L.msg("alice", T0 - 7 * DAY, CODE1)  # previous week only
        self.assertEqual(self.run_export().code, 2)


# ---------------------------------------------------------------- matching boundaries

class MatchTests(Base):
    def test_pre_existing_binding_both_hit(self):
        self.L.bind("alice", "00123", T0 - 60 * DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc([piece("P1", "00123", T0 + 3 * DAY), piece("PX", "123", T0 + 3 * DAY)])
        for p in ("I7", "B7"):
            self.assertEqual(self.pol(doc, CODE1, p)["received_inquiries"], 1)
            self.assertEqual(self.pol(doc, CODE1, p)["matched_received_pieces"], 1)

    def test_binding_day2_receipt_day8_i7_no_b7_yes(self):
        self.L.msg("alice", T0, CODE1)
        self.L.bind("alice", "K1", T0 + DAY + 2 * H)
        doc = self.doc([piece("P1", "K1", T0 + 7 * DAY + 2 * H)])
        self.assertEqual(self.pol(doc, CODE1, "I7")["matured_no_receipt"], 1)
        self.assertEqual(self.pol(doc, CODE1, "B7")["received_inquiries"], 1)

    def test_receipt_before_binding_not_counted(self):
        self.L.msg("alice", T0, CODE1)
        self.L.bind("alice", "K1", T0 + 3 * DAY)
        doc = self.doc([piece("P1", "K1", T0 + DAY)])
        for p in ("I7", "B7"):
            b = self.pol(doc, CODE1, p)
            self.assertEqual(b["received_inquiries"], 0)
            self.assertEqual(b["unknown_inquiries"], 1)
            self.assertEqual(b["reason_counts"].get("pre_binding_receipt_candidate"), 1)

    def test_late_binding_day9(self):
        self.L.msg("alice", T0, CODE1)
        self.L.bind("alice", "K1", T0 + 8 * DAY + H)
        doc = self.doc([piece("P1", "K1", T0 + 9 * DAY)])
        b7 = self.pol(doc, CODE1, "B7")
        self.assertEqual((b7["unknown_inquiries"], b7["reason_counts"].get("late_binding")), (1, 1))
        i7 = self.pol(doc, CODE1, "I7")
        self.assertEqual((i7["unknown_inquiries"], i7["reason_counts"].get("no_confirmed_binding")), (1, 1))

    def test_rebinding_uses_effective_intervals(self):
        self.L.bind("alice", "A100", T0 - 10 * DAY)
        self.L.msg("alice", T0, CODE1)
        self.L.bind("alice", "B200", T0 + 2 * DAY)
        pieces = [piece("P1", "A100", T0 + DAY), piece("P2", "A100", T0 + 3 * DAY),
                  piece("P3", "B200", T0 + 4 * DAY)]
        i7 = self.pol(self.doc(pieces), CODE1, "I7")
        self.assertEqual(i7["received_inquiries"], 1)
        self.assertEqual(i7["matched_received_pieces"], 2)  # P1 + P3, never P2

    def test_shared_cid_conflict(self):
        self.L.bind("alice", "C1", T0 - 5 * DAY)
        self.L.bind("bob", "C1", T0 - 3 * DAY)
        self.L.msg("alice", T0, CODE1)
        self.L.msg("bob", T0 + H, CODE2)
        doc = self.doc([piece("P1", "C1", T0 + 2 * DAY)])
        for code in (CODE1, CODE2):
            b = self.pol(doc, code, "I7")
            self.assertEqual((b["received_inquiries"], b["unknown_inquiries"]), (0, 1))
            self.assertEqual(b["reason_counts"].get("shared_cid_conflict"), 1)

    def test_code_after_receipt(self):
        self.L.bind("alice", "K1", T0 - 5 * DAY)
        self.L.msg("alice", T0)
        self.L.msg("alice", T0 + 2 * H, CODE1)
        doc = self.doc([piece("P1", "K1", T0 + H)])
        b = self.pol(doc, CODE1, "I7")
        self.assertEqual((b["received_inquiries"], b["unknown_inquiries"]), (0, 1))
        self.assertEqual(b["reason_counts"].get("source_after_receipt"), 1)

    def test_exact_start_boundary_included(self):
        self.L.bind("alice", "K1", T0 - 5 * DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc([piece("P1", "K1", T0)])
        self.assertEqual(self.pol(doc, CODE1, "I7")["received_inquiries"], 1)
        self.assertEqual(self.pol(doc, CODE1, "B7")["received_inquiries"], 1)

    def test_exact_end_boundary_excluded(self):
        self.L.bind("alice", "K1", T0 - 5 * DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc([piece("P1", "K1", T0 + 7 * DAY)])
        self.assertEqual(self.pol(doc, CODE1, "I7")["matured_no_receipt"], 1)
        self.assertEqual(self.pol(doc, CODE1, "B7")["matured_no_receipt"], 1)

    def test_date_only_straddle_is_unknown(self):
        self.L.bind("alice", "K1", T0 - 5 * DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc([piece("P1", "K1", "2026/10/26")])
        b = self.pol(doc, CODE1, "I7")
        self.assertEqual((b["received_inquiries"], b["unknown_inquiries"]), (0, 1))
        self.assertEqual(b["reason_counts"].get("date_boundary_unknown"), 1)

    def test_date_only_whole_day_inside_counts(self):
        self.L.bind("alice", "K1", T0 - 5 * DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc([piece("P1", "K1", "2026/10/28"), piece("P2", "K1", "2026-10-29 00:00:00")])
        b = self.pol(doc, CODE1, "I7")
        self.assertEqual((b["received_inquiries"], b["matched_received_pieces"]), (1, 2))
        self.assertEqual(doc["coverage"]["date_precision"]["date_only"], 2)

    def test_allocation_unique_across_two_inquiries(self):
        self.L.bind("alice", "K1", T0 - 5 * DAY)
        self.L.msg("alice", T0, CODE1)
        self.L.msg("alice", T0 + 2 * DAY, CODE2)
        doc = self.doc([piece("P1", "K1", T0 + 3 * DAY)])
        for p in ("I7", "B7"):
            self.assertEqual(self.pol(doc, CODE2, p)["received_inquiries"], 1)
            self.assertEqual(self.pol(doc, CODE1, p)["received_inquiries"], 0)
            self.assertEqual(self.pol(doc, CODE1, p)["matured_no_receipt"], 1)
            self.assertEqual(sum(r[p]["matched_received_pieces"] for r in doc["rows"]), 1)

    def test_observed_only_is_candidate_not_main_number(self):
        self.L.bind("alice", "O1", T0 - DAY, kind="binding_observed")
        self.L.msg("alice", T0, CODE1)
        doc = self.doc([piece("P1", "O1", T0 + 2 * DAY)])
        for p in ("I7", "B7"):
            b = self.pol(doc, CODE1, p)
            self.assertEqual((b["received_inquiries"], b["unknown_inquiries"], b["candidate_only"]), (0, 1, 1))

    def test_composite_cid_binding_is_identity_ambiguous(self):
        self.L.bind("alice", "123/456", T0 - DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc([piece("P1", "123", T0 + DAY)])
        b = self.pol(doc, CODE1, "I7")
        self.assertEqual((b["unknown_inquiries"], b["reason_counts"].get("identity_ambiguous")), (1, 1))
        self.assertEqual(doc["coverage"]["identity_status"].get("identity_ambiguous"), 1)

    def test_pos_duplicates_and_conflicts(self):
        self.L.bind("alice", "K1", T0 - 5 * DAY)
        self.L.bind("bob", "K3", T0 - 5 * DAY)
        self.L.msg("alice", T0, CODE1)
        self.L.msg("bob", T0, CODE2)
        pieces = [piece("P1", "K1", T0 + DAY), piece("P1", "K1", T0 + DAY),
                  piece("P2", "K1", T0 + 2 * DAY), piece("P2", "K2", T0 + 2 * DAY),
                  piece("P3", "K3", T0 + 2 * DAY), piece("P3", "K4", T0 + 2 * DAY)]
        doc = self.doc(pieces)
        a = self.pol(doc, CODE1, "I7")
        self.assertEqual((a["received_inquiries"], a["matched_received_pieces"]), (1, 1))
        b = self.pol(doc, CODE2, "I7")
        self.assertEqual((b["unknown_inquiries"], b["reason_counts"].get("pos_conflict")), (1, 1))
        self.assertEqual(doc["coverage"]["pos"]["conflicts"], 2)
        self.assertEqual(doc["coverage"]["pos"]["duplicates"], 3)


# ---------------------------------------------------------------- coverage and status

class CoverageTests(Base):
    def test_coverage_gap_is_unknown_not_zero(self):
        self.L.bind("alice", "K1", T0 - 30 * DAY)
        self.L.msg("alice", T0, CODE1)
        self.L.corrupt()
        self.L.msg("bob", T0 + 2 * DAY, CODE2)
        doc = self.doc()
        b = self.pol(doc, CODE1, "I7")
        self.assertEqual((b["matured_no_receipt"], b["unknown_inquiries"]), (0, 1))
        self.assertEqual(b["reason_counts"].get("ledger_gap"), 1)
        self.assertEqual(doc["status"], "lower_bound")
        self.assertEqual(doc["coverage"]["gap_intervals"][0]["kind"], "corrupt_line")

    def test_truncated_tail_is_gap(self):
        self.L.bind("alice", "K1", T0 - 30 * DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc(tail=b'{"schema_version":1,"event_kind":"message_obs')
        self.assertEqual(doc["coverage"]["gap_intervals"][-1]["kind"], "corrupt_last_line")
        self.assertEqual(self.pol(doc, CODE1, "I7")["unknown_inquiries"], 1)

    def test_pending_then_matured(self):
        self.L.bind("alice", "K1", T0 - 30 * DAY)
        self.L.msg("alice", T0, CODE1)
        early = self.doc(as_of=T0 + 3 * DAY)
        for p in ("I7", "B7"):
            self.assertEqual(self.pol(early, CODE1, p)["pending_window"], 1)
        self.assertEqual(self.pol(early, CODE1)["reason_counts"].get("window_open"), 1)
        late = self.doc(as_of=T0 + 8 * DAY)
        for p in ("I7", "B7"):
            self.assertEqual(self.pol(late, CODE1, p)["matured_no_receipt"], 1)

    def test_pos_not_through_window_is_pending(self):
        self.L.bind("alice", "K1", T0 - 30 * DAY)
        self.L.msg("alice", T0, CODE1)
        doc = self.doc(pos_through=T0 + 5 * DAY)
        b = self.pol(doc, CODE1, "I7")
        self.assertEqual(b["pending_window"], 1)
        self.assertEqual(b["reason_counts"].get("pos_not_through_window"), 1)

    def test_unbound_inquiry_pending_then_unknown(self):
        self.L.msg("bob", T0, CODE1)
        self.assertEqual(self.pol(self.doc(as_of=T0 + DAY), CODE1, "B7")["pending_window"], 1)
        self.assertEqual(self.pol(self.doc(), CODE1, "B7")["unknown_inquiries"], 1)

    def test_complete_status_requires_verified_pos_and_no_gaps(self):
        self.L.bind("alice", "K1", T0 - 30 * DAY)
        self.L.msg("alice", T0, CODE1)
        pieces = [piece("P1", "K1", T0 + DAY)]
        doc = self.doc(pieces, completeness=ax.POS_VERIFIED)
        self.assertEqual(doc["status"], "complete")
        self.assertEqual(self.pol(doc, CODE1, "I7")["status"], "complete")
        self.assertEqual(self.doc(pieces)["status"], "lower_bound")

    def test_invariant_sums(self):
        self.L.bind("alice", "K1", T0 - 30 * DAY)
        self.L.bind("carol", "K2", T0 - 30 * DAY)
        self.L.bind("dave", "K3", T0 - 30 * DAY)
        self.L.msg("alice", T0, CODE1)
        self.L.msg("bob", T0 + H, CODE1)
        self.L.msg("carol", T0 + 2 * H, CODE2)
        self.L.msg("dave", T0 + 6 * DAY)
        self.L.msg("erin", T0 + 3 * DAY)
        doc = self.doc([piece("P1", "K1", T0 + DAY)], as_of=T0 + 10 * DAY)
        self.assertInvariant(doc)
        statuses = set()
        for r in doc["rows"]:
            for name in ("received_inquiries", "pending_window", "unknown_inquiries", "matured_no_receipt"):
                if r["I7"][name]:
                    statuses.add(name)
        self.assertEqual(len(statuses), 4)

    def test_revision_increment_and_supersedes(self):
        self.L.msg("alice", T0, CODE1)
        first = self.run_export(dry_run=False)
        self.assertEqual((first.code, first.doc["revision"], first.doc["supersedes"]), (0, 1, None))
        second = self.run_export(dry_run=False)
        self.assertEqual((second.doc["revision"], second.doc["supersedes"]), (2, 1))
        stored = json.loads(second.path.read_text(encoding="utf-8"))
        self.assertEqual(stored["revision"], 2)
        hist = second.path.parent / "history" / "source-to-order-2026-W44.r1.json"
        self.assertEqual(json.loads(hist.read_text(encoding="utf-8"))["revision"], 1)
        self.assertEqual(list(second.path.parent.glob(".*tmp*")), [])

    def test_no_identifiers_in_output(self):
        self.L.bind("alice", "Z9Q7", T0 - 30 * DAY)
        self.L.bind("bob", "Y8W6", T0 - 30 * DAY, kind="binding_observed")
        self.L.msg("alice", T0, CODE1)
        self.L.msg("bob", T0 + H, CODE2)
        self.L.corrupt()
        self.L.msg("carol", T0 + DAY)
        res = self.run_export([piece("P1", "Z9Q7", T0 + DAY), piece("P2", "Y8W6", T0 + DAY)], dry_run=False)
        text = res.path.read_text(encoding="utf-8")
        secrets = {KEY.hex(), "Z9Q7", "Y8W6", "alice", "bob", "carol"}
        for r in self.L.rows:
            for name in ("user_key", "cid_key", "event_id", "message_key"):
                if isinstance(r.get(name), str):
                    secrets.add(r[name])
        for name in ("alice", "bob", "carol"):
            secrets.add(ax.make_inquiry_id(SHOP, OA, uk(name), date(2026, 10, 26)))
        for value in secrets:
            self.assertNotIn(value, text)
        self.assertNotIn("user_key", text)
        self.assertNotIn("cid_key", text)

    def test_cli_dry_run_with_pos_json(self):
        self.L.bind("alice", "K1", T0 - 30 * DAY)
        self.L.msg("alice", T0, CODE1)
        (self.root / "data" / "inquiries.jsonl").write_bytes(self.L.dump())
        pos = self.root / "pieces.json"
        pos.write_text(json.dumps([piece("P1", "K1", T0 + DAY)]), encoding="utf-8")
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = ax.main(["--root", str(self.root), "--week", WEEK, "--as-of", iso(AS_OF),
                          "--pos-json", str(pos), "--dry-run"])
        self.assertEqual(rc, 0, err.getvalue())
        self.assertTrue(out.getvalue().startswith("[ATTRIBUTION_EXPORT]"))
        self.assertIn("I7 received=1", out.getvalue())
        self.assertFalse(ax.output_path(self.root, WEEK).exists())
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(ax.main(["--root", str(self.root), "--week", "bad", "--pos-json", str(pos)]), 1)

    def test_connector_adapter_flags_state_fallback(self):
        class Snap:
            state = "ok"
            read_at = "2026-11-20T00:00:00+00:00"
            customers = [{"customer_id": "K1"}]
            pieces = [
                {"piece_id": "P1", "order_no": "D1", "customer_id": "K1", "received_at": "2026/10/27", "state_raw": ""},
                {"piece_id": "P2", "order_no": "D2", "customer_id": "K1", "received_at": "2026/10/27", "state_raw": "K1"},
                {"piece_id": "P3", "order_no": "D3", "customer_id": "K9", "received_at": "2026/10/27", "state_raw": ""},
            ]
        rows = ax.load_pos_rows_from_connector(Snap())
        self.assertEqual([r["identity_hint"] for r in rows], [None, "identity_ambiguous", "identity_ambiguous"])
        self.assertEqual(ax.snapshot_through(Snap()), datetime(2026, 11, 20, 8, 0, tzinfo=TZ))


if __name__ == "__main__":
    unittest.main()