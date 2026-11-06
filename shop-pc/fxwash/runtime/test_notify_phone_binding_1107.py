"""Arrival notices for LINE sign-ups that only have a phone (fix/notify-phone-binding-1107).

Synthetic SQLite rows through the real run_monitor entry point (MonitorFixture); no MDB, no API.
Phones are made-up test numbers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from runtime import inbound_monitor as monitor  # noqa: E402
from runtime import test_inbound_monitor as base  # noqa: E402

PHONE = "0912345678"


class PhoneOnlyBindingTests(unittest.TestCase):
    def fixture(self, bindings, cus_rows=(("0001", "04-2200-0000", "0912-345-678"),)):
        f = base.MonitorFixture(self)
        f.sql.execute("CREATE TABLE Cus (Cid TEXT, Cname TEXT, Tel TEXT, Mtel TEXT)")
        for cid, tel, mtel in cus_rows:
            f.sql.execute("INSERT INTO Cus VALUES (?, 'synthetic', ?, ?)", (cid, tel, mtel))
        f.bindings(bindings)
        return f

    def cus_queries(self, f):
        return [q for q in f.queries if "FROM CUS" in q.upper()]

    def test_phone_only_signup_gets_the_intake_notice(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}})
        f.piece()
        f.run()
        self.assertEqual(["line-new"], [p["uid"] for p in f.pushes])
        self.assertEqual("done", f.outbox()[-1]["status"])

    def test_phone_only_signup_gets_the_completion_notice(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}})
        f.piece("000009", "READY", datei="2026-11-07")
        f.run()
        self.assertEqual(["line-new"], [p["uid"] for p in f.completions()])

    def test_binding_with_another_customer_id_is_never_matched_by_phone(self):
        f = self.fixture({"line-other": {"customer_id": "0099", "phone": PHONE}})
        f.piece()
        f.run()
        self.assertEqual([], f.pushes)
        self.assertEqual("NoBinding", f.outbox()[-1]["last_error_type"])

    def test_customer_id_binding_wins_and_cus_is_not_read(self):
        f = self.fixture({"test-user-a": {"customer_id": "0001"}, "line-new": {"customer_id": "", "phone": PHONE}})
        f.piece()
        f.run()
        self.assertEqual(["test-user-a"], [p["uid"] for p in f.pushes])
        self.assertEqual([], self.cus_queries(f))

    def test_no_phone_only_binding_means_no_extra_query(self):
        f = self.fixture({"line-other": {"customer_id": "0099"}})
        f.piece()
        f.run()
        self.assertEqual([], f.pushes)
        self.assertEqual([], self.cus_queries(f))

    def test_different_phone_does_not_match(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": "0987000111"}})
        f.piece()
        f.run()
        self.assertEqual([], f.pushes)

    def test_short_phone_never_matches(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": "123"}}, cus_rows=(("0001", "123", ""),))
        f.piece()
        f.run()
        self.assertEqual([], f.pushes)

    def test_cus_read_failure_keeps_old_behaviour_and_logs_type_only(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}})
        f.query_failure = lambda sql: "FROM CUS" in sql.upper()
        f.piece()
        f.run()
        self.assertEqual([], f.pushes)
        self.assertEqual("NoBinding", f.outbox()[-1]["last_error_type"])
        self.assertEqual("000011", f.state()["last_did"])
        self.assertIn("[PHONE_FALLBACK_UNAVAILABLE] error_type=OSError", f.stderr.getvalue())
        self.assertNotIn(PHONE, f.stderr.getvalue())

    def test_cus_is_read_once_per_scan(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}})
        f.piece("000011", "NEW1")
        f.piece("000012", "NEW2")
        f.run()
        self.assertEqual(["line-new", "line-new"], [p["uid"] for p in f.pushes])
        self.assertEqual(1, len(self.cus_queries(f)))

    def test_pos_id_without_leading_zeros_still_matches(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}}, cus_rows=(("1", "", PHONE),))
        f.piece()
        f.run()
        self.assertEqual(["line-new"], [p["uid"] for p in f.pushes])

    def test_plus886_format_in_pos_matches(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}}, cus_rows=(("0001", "", "+886-912-345-678"),))
        f.piece()
        f.run()
        self.assertEqual(["line-new"], [p["uid"] for p in f.pushes])

    def test_bindings_file_is_never_written(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}})
        before = (f.data / "customer_bindings.json").read_bytes()
        f.piece()
        f.run()
        self.assertEqual(before, (f.data / "customer_bindings.json").read_bytes())

    def _bump_mdb(self, f):
        import os
        st = f.mdb.stat()
        os.utime(f.mdb, (st.st_atime + 10, st.st_mtime + 10))

    def test_phone_book_is_rebuilt_each_scan(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}}, cus_rows=(("0001", "", "0987000111"),))
        f.piece("000011", "NEW1")

        def later(tick):
            if tick == 2:
                f.sql.execute("UPDATE Cus SET Mtel = ? WHERE Cid = '0001'", (PHONE,))
                f.piece("000012", "NEW2")
                self._bump_mdb(f)

        f.run(2, before_tick=later)
        self.assertEqual(["line-new"], [p["uid"] for p in f.pushes])
        self.assertEqual(2, len(self.cus_queries(f)))

    def test_failed_cus_read_is_retried_next_scan(self):
        f = self.fixture({"line-new": {"customer_id": "", "phone": PHONE}})
        f.query_failure = lambda sql: "FROM CUS" in sql.upper()
        f.piece("000011", "NEW1")

        def later(tick):
            if tick == 2:
                f.query_failure = lambda sql: False
                f.piece("000012", "NEW2")
                self._bump_mdb(f)

        f.run(2, before_tick=later)
        self.assertEqual(["line-new"], [p["uid"] for p in f.pushes])

    def test_helpers(self):
        self.assertEqual("0912345678", monitor.normalize_phone_digits("+886 912-345-678"))
        self.assertEqual({"a": PHONE}, monitor.phone_only_bindings(
            {"a": {"customer_id": "", "phone": PHONE}, "b": {"customer_id": "7", "phone": PHONE}, "c": "junk"}))
        self.assertEqual({}, monitor.phone_only_bindings({"short": {"customer_id": "", "phone": "123"}}))


if __name__ == "__main__":
    unittest.main()
