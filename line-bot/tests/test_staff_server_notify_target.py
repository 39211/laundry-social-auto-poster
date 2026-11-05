# -*- coding: utf-8 -*-
"""A-STAFFSRV H1/H2: /staff/notify must never send to a mismatched, ambiguous or missing target.
No network, no real data: staff_notify and laundry_lookup are in-memory fakes."""
import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

LINE_BOT_DIR = Path(__file__).resolve().parents[1]
if str(LINE_BOT_DIR) not in sys.path:
    sys.path.insert(0, str(LINE_BOT_DIR))

BASE = "http://127.0.0.1:8792"

_ROW_A = dict(found=True, ambiguous=False, customer_no="A001", name="A", source="test")
_ROW_AMBIG = dict(found=False, ambiguous=True, customer_no="", name="", source="test")
_ROW_NONE = dict(found=False, ambiguous=False, customer_no="", name="", source="test")

# "0913": an inconsistent row that is ambiguous yet still carries a customer_no (defence in depth)
_ROW_AMBIG_WITH_NO = dict(found=False, ambiguous=True, customer_no="A001", name="A", source="test")

ROWS = {"A001": _ROW_A, "alice": _ROW_A, "0912": _ROW_AMBIG, "0913": _ROW_AMBIG_WITH_NO}
UIDS = {"A001": "U_A_FAKE", "B002": "U_B_FAKE"}


class NotifyTargetTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        sent = self.sent

        fake_notify = types.ModuleType("staff_notify")

        def notify_guest(uid="", customer_no="", mode="auto"):
            sent.append({"uid": uid, "customer_no": customer_no, "mode": mode})
            return {"ok": True}

        fake_notify.notify_guest = notify_guest
        fake_notify.list_inbox = lambda: []
        fake_notify.set_status = lambda *a, **k: True
        fake_notify.claim_handoff = lambda *a, **k: True
        fake_notify.release_handoff = lambda *a, **k: True

        fake_lookup = types.ModuleType("laundry_lookup")
        fake_lookup.lookup = lambda q: types.SimpleNamespace(**ROWS.get(q, _ROW_NONE))
        fake_lookup.uid_for_customer = lambda no: UIDS.get(no, "")

        patcher = mock.patch.dict(sys.modules, {"staff_notify": fake_notify, "laundry_lookup": fake_lookup})
        patcher.start()
        self.addCleanup(patcher.stop)
        sys.modules.pop("staff_server", None)
        self.addCleanup(sys.modules.pop, "staff_server", None)
        mod = importlib.import_module("staff_server")
        mod.app.config["TESTING"] = True
        self.client = mod.app.test_client()

    def post(self, payload):
        return self.client.post("/staff/notify", json=payload, base_url=BASE)

    def test_real_ui_payload_passes_through_unchanged(self):
        # staff.html sends exactly {customer_no, mode}; behaviour must not change.
        r = self.post({"customer_no": "A001", "mode": "ready"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.sent, [{"uid": "", "customer_no": "A001", "mode": "ready"}])

    def test_refuses_uid_of_other_customer(self):
        r = self.post({"uid": "U_A_FAKE", "customer_no": "B002"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.sent, [])
        self.assertFalse(r.get_json()["ok"])

    def test_refuses_uid_with_unbound_customer_no(self):
        r = self.post({"uid": "U_A_FAKE", "customer_no": "Z999"})
        self.assertEqual(self.sent, [])
        self.assertFalse(r.get_json()["ok"])

    def test_matching_pair_still_sends(self):
        r = self.post({"uid": "U_A_FAKE", "customer_no": "A001"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.sent, [{"uid": "U_A_FAKE", "customer_no": "A001", "mode": "auto"}])

    def test_uid_only_still_sends(self):
        self.post({"uid": "U_A_FAKE"})
        self.assertEqual(self.sent, [{"uid": "U_A_FAKE", "customer_no": "", "mode": "auto"}])

    def test_refuses_ambiguous_query(self):
        r = self.post({"q": "0912"})
        self.assertEqual(self.sent, [])
        self.assertFalse(r.get_json()["ok"])

    def test_refuses_ambiguous_query_even_if_row_carries_customer_no(self):
        r = self.post({"q": "0913"})
        self.assertEqual(self.sent, [])
        self.assertFalse(r.get_json()["ok"])

    def test_refuses_unknown_query(self):
        r = self.post({"q": "nobody"})
        self.assertEqual(self.sent, [])
        self.assertFalse(r.get_json()["ok"])

    def test_resolves_unique_query_to_customer_no(self):
        self.post({"q": "alice"})
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["customer_no"], "A001")

    def test_refuses_empty_target(self):
        r = self.post({})
        self.assertEqual(self.sent, [])
        self.assertFalse(r.get_json()["ok"])

    def test_non_object_body_does_not_crash(self):
        r = self.post(["U_A_FAKE"])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.sent, [])
        self.assertFalse(r.get_json()["ok"])


if __name__ == "__main__":
    unittest.main()
