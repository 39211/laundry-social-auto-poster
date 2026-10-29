# -*- coding: utf-8 -*-
"""到件通知與實收金額。案例 C01–C30 與 P1 規則。不連網。"""
from __future__ import annotations

import email
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import types
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import arrival_notify as A
import laundry_lookup as L
import staff_notify as sn

UID_A = "U0000" + ("a" * 28)
UID_B = "U0000" + ("b" * 28)
PHONE = "0912345678"
PHONE_B = "0900000002"
UTC = timezone.utc


class _Resp:
    def __init__(self, status=200):
        self.status = status
        self.code = status

    def read(self):
        return b""

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def _http_error(code, headers=None):
    return urllib.error.HTTPError(
        "https://api.line.me/v2/bot/message/push",
        code,
        "err",
        headers if headers is not None else email.message.Message(),
        None,
    )


def judge_mutation(clean: dict, failed_ids, expect_ids) -> str:
    """乾淨樹沒過、或見證名字不存在 → invalid。killed 只認完整 id 相等。"""
    failed = set(failed_ids)
    for test_id in expect_ids:
        if clean.get(test_id) != "pass":
            return "invalid"
    if any(test_id in failed for test_id in expect_ids):
        return "RED"
    return "EQUIVALENT"


class Shop:
    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="arrival-case-"))
        # Fresh synthetic source metadata; no production MDB is accessed.
        (self.root / "eHank.mdb").write_bytes(b"synthetic source metadata")
        self.customers = []
        self.garments = []
        self.reads = 0
        self.fail = ""
        self.source = L.EHANK_SOURCE
        self.calls = []
        self.script = []
        self.left = 900
        self.quota_calls = 0
        self.now = datetime(2026, 9, 25, 3, 0, tzinfo=UTC)
        (self.root / "data").mkdir(parents=True, exist_ok=True)
        self._orig_inv = L.inventory
        L.REPO = self.root
        L.EHANK_ROOT = self.root
        os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
        L.BIND = self.root / "data" / "line-customer-bind.json"
        L.WATCH = self.root / "data" / "laundry-watch.json"
        L.inventory = self._inventory

    def deactivate(self):
        L.inventory = self._orig_inv

    def _inventory(self):
        self.reads += 1
        if self.fail == "exception":
            raise RuntimeError("ehank down")
        if self.fail == "zero_customers":
            pieces = list(self.garments) or [
                {
                    "donly": "PX",
                    "customer_no": "0028",
                    "wash_no": "W1",
                    "name": "襯衫",
                    "datei": "115.09.25",
                    "loc": "A1",
                    "dater": "",
                    "price": 1,
                }
            ]
            return [], pieces, L.EHANK_SOURCE
        if self.fail == "zero_pieces":
            customers = list(self.customers) or [{"no": "0028", "name": "測試客", "phone": PHONE, "balance": 0}]
            return customers, [], L.EHANK_SOURCE
        return list(self.customers), list(self.garments), self.source

    def install_opener(self):
        A.push_opener = self._open

    def _open(self, req, timeout=10):
        header = req.get_header("X-line-retry-key")
        if header and A.state_path().is_file():
            if header not in A.state_path().read_text(encoding="utf-8"):
                raise AssertionError("retry key missing before http")
        self.calls.append(req)
        event = self.script.pop(0) if self.script else "200"
        if event == "timeout":
            raise TimeoutError("timeout")
        if event == "500":
            raise _http_error(500)
        if event == "400":
            raise _http_error(400)
        if event == "409bare":
            raise _http_error(409)
        if event == "409":
            headers = email.message.Message()
            headers["x-line-accepted-request-id"] = "accepted-1"
            raise _http_error(409, headers)
        if event == "429":
            raise _http_error(429)
        if event == "kill":
            raise BaseException("killed")
        return _Resp(200)

    def set_mode(self, mode):
        path = A.config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"mode": mode}), encoding="utf-8")

    def add_customer(self, no="0028", name="測試客", phone=PHONE, balance=-180):
        self.customers.append({"no": no, "name": name, "phone": phone, "balance": balance})

    def add_piece(
        self,
        donly,
        customer_no="0028",
        wash_no="W1001",
        name="襯衫",
        price=900,
        loc="A1",
        datei="115.09.25",
        dater="",
    ):
        row = {
            "donly": donly,
            "customer_no": customer_no,
            "wash_no": wash_no,
            "name": name,
            "price": price,
            "loc": loc,
            "datei": datei,
            "dater": dater,
        }
        self.garments.append(row)
        return row

    def bind(self, uid, customer_no="0028", method="phone", phone=PHONE):
        data = {}
        if L.BIND.is_file():
            data = json.loads(L.BIND.read_text(encoding="utf-8"))
        if method is None:
            data[uid] = {"customer_no": customer_no, "phone": phone}
        else:
            data[uid] = {
                "customer_no": customer_no,
                "phone": phone,
                "method": method,
                "bound_at": "2026-09-25T11:00:00+08:00",
            }
        L.BIND.parent.mkdir(parents=True, exist_ok=True)
        L.BIND.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def seed(self, seen):
        state = A._empty_state()
        state["seen"] = list(seen)
        A._save_state(state)

    def advance(self, minutes):
        self.now += timedelta(minutes=minutes)

    def run(self, mode=None):
        return A.run_cycle(mode_override=mode, clock=lambda: self.now)

    def open_and_wait(self, minutes=15):
        first = self.run()
        self.advance(minutes)
        second = self.run()
        return first, second

    def body(self, index=0):
        payload = json.loads(self.calls[index].data.decode("utf-8"))
        return payload["messages"][0]["text"]


class Isolated(unittest.TestCase):
    def setUp(self):
        self._repo = L.REPO
        self._bind = L.BIND
        self._watch = L.WATCH
        self._inv = L.inventory
        self._ehank = L.EHANK_ROOT
        self._opener = A.push_opener
        self._quota = sn.quota_left
        self._token = sn._token
        self._urlopen = urllib.request.urlopen
        self._save = A._save_state
        self._supervised = A.run_supervised
        self._fixture = os.environ.get("LAUNDRY_LOOKUP_FIXTURE")
        self.shop = Shop()
        self.shop.install_opener()
        shop = self.shop

        def quota():
            shop.quota_calls += 1
            return (1000, 0, shop.left)

        sn.quota_left = quota
        sn._token = lambda: "x"

        def _no_net(*_a, **_k):
            raise AssertionError("network disabled")

        urllib.request.urlopen = _no_net

    def tearDown(self):
        L.inventory = self._inv
        L.REPO = self._repo
        L.BIND = self._bind
        L.WATCH = self._watch
        L.EHANK_ROOT = self._ehank
        A.push_opener = self._opener
        sn.quota_left = self._quota
        sn._token = self._token
        urllib.request.urlopen = self._urlopen
        A._save_state = self._save
        A.run_supervised = self._supervised
        if self._fixture is None:
            os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
        else:
            os.environ["LAUNDRY_LOOKUP_FIXTURE"] = self._fixture
        sys.modules.pop("ai_engine", None)
        A._release_lock()
        shutil.rmtree(self.shop.root, ignore_errors=True)

    def expect_ok(self, actual, expect):
        for key, value in expect.items():
            self.assertIn(key, actual)
            self.assertEqual(actual[key], value, key)

    def arm(self, **kwargs):
        shop = self.shop
        mode = kwargs.get("mode", "on")
        if mode:
            shop.set_mode(mode)
        shop.add_customer(
            no=kwargs.get("customer_no", "0028"),
            balance=kwargs.get("balance", -180),
        )
        shop.add_piece(
            kwargs.get("donly", "D100"),
            customer_no=kwargs.get("customer_no", "0028"),
            wash_no=kwargs.get("wash", "W1001"),
            name=kwargs.get("name", "襯衫"),
            price=kwargs.get("price", 900),
            loc=kwargs.get("loc", "A1"),
            datei=kwargs.get("datei", "115.09.25"),
            dater=kwargs.get("dater", ""),
        )
        if kwargs.get("bind", True):
            shop.bind(
                kwargs.get("uid", UID_A),
                customer_no=kwargs.get("customer_no", "0028"),
                method=kwargs.get("method", "phone"),
                phone=kwargs.get("phone", PHONE),
            )
        shop.seed(kwargs.get("seen", ["BASE"]))
        return shop

    def ehank_text(self, *, price, tpay, name, wash, donly):
        self.shop.deactivate()
        os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
        tmp = Path(tempfile.mkdtemp(prefix="ehank-fake-"))
        old_root = L.EHANK_ROOT
        L.EHANK_ROOT = tmp
        holder = {"sql": ""}

        class Cursor:
            def __init__(self):
                self.sql = ""

            def execute(self, sql):
                self.sql = sql
                holder["sql"] = sql

            def fetchall(self):
                if "FROM Cus" in self.sql:
                    return [("0028", "測試客", "", PHONE, 0)]
                cols = [part.strip() for part in self.sql.split("FROM", 1)[0].replace("SELECT", "", 1).split(",")]
                values = {
                    "Did": "100001",
                    "Dno": wash,
                    "Cid": "0028",
                    "Dname": name,
                    "Price": price,
                    "Datei": "115.09.25   ",
                    "Loc": "A1      ",
                    "State": "完工",
                    "Dater": "         ",
                    "Tpay": tpay,
                    "Donly": donly,
                }
                return [tuple(values.get(col) for col in cols)]

        class Con:
            def cursor(self):
                return Cursor()

            def close(self):
                return None

        module = types.ModuleType("ai_engine")
        module.db_manager = types.SimpleNamespace(get_conn=lambda: Con())
        sys.modules["ai_engine"] = module
        try:
            text = L.guest_copy(L.lookup(PHONE))
            _customers, garments = L._from_ehank()
            return text, garments[0], holder["sql"]
        finally:
            L.EHANK_ROOT = old_root
            sys.modules.pop("ai_engine", None)
            os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
            shutil.rmtree(tmp, ignore_errors=True)


class Cases(Isolated):
    def test_c01_baseline_only(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer()
        for index in range(3):
            shop.add_piece(f"D{index}", wash_no=f"W{index}", name=f"衣{index}")
        result = shop.run()
        self.expect_ok({"code": result["code"], "http": result["http"]}, {"code": "BASELINE_ONLY", "http": 0})
        self.assertEqual(shop.calls, [])
        self.assertFalse(A.outbox_path().exists())
        self.assertEqual(len(A._load_state()["seen"]), 3)

    def test_c02_read_exception_holds(self):
        shop = self.arm()
        before = A.state_path().read_bytes()
        shop.fail = "exception"
        result = shop.run()
        actual = {"code": result["code"], "http": result["http"], "cursor": result["cursor"]}
        self.expect_ok(actual, {"code": "READ_FAIL_HOLD", "http": 0, "cursor": "unchanged"})
        self.assertEqual(A.state_path().read_bytes(), before)
        self.assertEqual(shop.calls, [])

    def test_c03_zero_customers_hold(self):
        shop = self.arm()
        before = A.state_path().read_bytes()
        shop.fail = "zero_customers"
        result = shop.run()
        actual = {"code": result["code"], "http": result["http"], "cursor": result["cursor"]}
        self.expect_ok(actual, {"code": "READ_FAIL_HOLD", "http": 0, "cursor": "unchanged"})
        self.assertEqual(A.state_path().read_bytes(), before)

    def test_c04_loc_blank_not_ready(self):
        shop = self.arm(loc="")
        result = shop.run()
        self.expect_ok({"code": result["code"], "http": result["http"]}, {"code": "NOT_READY", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c05_phone_bind_accepted(self):
        shop = self.arm()
        _first, sent = shop.open_and_wait()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "ACCEPTED", "http": 1})
        text = shop.body()
        self.assertIn("襯衫", text)
        self.assertIn("W1001", text)
        self.assertIn("900", text)
        self.assertIn(A.DISCLAIMER, text)
        self.assertNotIn("測試客", text)
        self.assertNotIn(PHONE, text)
        self.assertNotIn("0028", text)
        self.assertNotIn("A1", text)
        self.assertNotIn(UID_A, text)

    def test_c06_customer_no_need_bind(self):
        shop = self.arm(method="customer_no")
        _first, sent = shop.open_and_wait()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "NEED_BIND", "http": 0})
        self.assertEqual(shop.calls, [])
        pending = next(iter(A._load_state()["pending"].values()))
        self.assertIn(A.DISCLAIMER, pending.get("text") or "")

    def test_c07_owner_unknown(self):
        shop = self.arm(customer_no="@@@A")
        result = shop.run()
        self.expect_ok({"code": result["code"], "http": result["http"]}, {"code": "OWNER_UNKNOWN", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c08_dry_run_no_http(self):
        shop = self.arm(mode="dry_run")
        _first, sent = shop.open_and_wait()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "DRY_RUN", "http": 0})
        self.assertEqual(shop.calls, [])
        self.assertEqual(shop.quota_calls, 0)
        previews = [row for row in A._outbox_rows() if row.get("kind") == "dry_run"]
        self.assertEqual(len(previews), 1)
        self.assertIn(A.DISCLAIMER, previews[0]["text"])

    def test_c09_missing_config_off(self):
        shop = self.shop
        shop.add_customer()
        shop.add_piece("D100")
        shop.bind(UID_A)
        shop.seed(["BASE"])
        result = shop.run()
        actual = {"code": result["code"], "http": result["http"], "ehank_reads": result["ehank_reads"]}
        self.expect_ok(actual, {"code": "MODE_OFF", "http": 0, "ehank_reads": 0})
        self.assertEqual(shop.reads, 0)
        self.assertFalse(A.config_path().exists())

    def test_c10_window_taipei_22(self):
        shop = self.arm()
        shop.now = datetime(2026, 9, 25, 3, 0, tzinfo=UTC)
        first = shop.run()
        self.assertEqual(first["code"], "SETTLE_HOLD")
        shop.now = datetime(2026, 9, 25, 14, 0, tzinfo=UTC)
        sent = shop.run()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "WINDOW_HOLD", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c11_picked_suppressed(self):
        shop = self.arm(dater="115.09.26")
        state = A._load_state()
        state["seen"] = ["D100"]
        state["pending"] = {
            "D100": {
                "donly": "D100",
                "customer_no": "0028",
                "first_seen": A._iso(shop.now - timedelta(minutes=15)),
                "status": "pending",
            }
        }
        A._save_state(state)
        result = shop.run()
        self.expect_ok({"code": result["code"], "http": result["http"]}, {"code": "SUPPRESSED", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c12_quota_hold(self):
        shop = self.arm()
        shop.left = 20
        _first, sent = shop.open_and_wait()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "QUOTA_HOLD", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c13_retry_same_key(self):
        shop = self.arm()
        shop.script = ["timeout", "timeout"]
        _first, sent = shop.open_and_wait()
        self.assertEqual(sent["code"], "UNCERTAIN")
        shop.advance(1)
        retry = shop.run()
        self.assertEqual(len(shop.calls), 2)
        first_key = shop.calls[0].get_header("X-line-retry-key")
        second_key = shop.calls[1].get_header("X-line-retry-key")
        self.assertTrue(first_key)
        self.assertEqual(first_key, second_key)
        actual = {"code": retry["code"], "retry_key": retry.get("retry_key")}
        self.expect_ok(actual, {"code": "UNCERTAIN", "retry_key": "same_on_retry"})

    def test_c14_http_409_accepted(self):
        shop = self.arm()
        shop.script = ["409"]
        _first, sent = shop.open_and_wait()
        self.expect_ok({"code": sent["code"]}, {"code": "ACCEPTED"})
        blob = A.state_path().read_text(encoding="utf-8")
        self.assertIn('"accepted"', blob)
        self.assertNotIn("delivered", blob.lower())
        self.assertNotIn("已送達", blob)
        self.assertNotIn("已讀", blob)

    def test_c15_http_400_rejected(self):
        shop = self.arm()
        shop.script = ["400"]
        _first, sent = shop.open_and_wait()
        later = shop.run()
        self.assertEqual(later["http"], 0)
        self.assertEqual(len(shop.calls), 1)
        self.expect_ok({"code": sent["code"], "retries": sent["retries"]}, {"code": "REJECTED", "retries": 0})

    def test_c16_uncertain_expired(self):
        shop = self.arm()
        cid_key = L._cid_key("0028")
        delivery_id = cid_key + ":" + UID_A
        state = A._load_state()
        state["seen"] = ["D100"]
        state["pending"] = {
            "D100": {
                "donly": "D100",
                "customer_no": "0028",
                "first_seen": A._iso(shop.now - timedelta(hours=26)),
                "status": "inflight",
            }
        }
        state["deliveries"] = {
            delivery_id: {
                "id": delivery_id,
                "uid": UID_A,
                "customer_no": "0028",
                "text": "可以來取了：",
                "retry_key": "11111111-1111-4111-8111-111111111111",
                "attempts": 1,
                "first_attempt": A._iso(shop.now - timedelta(hours=25)),
                "status": "uncertain",
                "donlies": ["D100"],
            }
        }
        A._save_state(state)
        result = shop.run()
        self.expect_ok({"code": result["code"], "http": result["http"]}, {"code": "UNCERTAIN_EXPIRED", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c17_anomaly_hold(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer()
        shop.seed(["BASE"])
        seen_before = list(A._load_state()["seen"])
        for index in range(81):
            shop.add_piece(f"N{index:03d}", wash_no=f"W{index:03d}")
        result = shop.run()
        actual = {"code": result["code"], "http": result["http"], "cursor": result["cursor"]}
        self.expect_ok(actual, {"code": "ANOMALY_HOLD", "http": 0, "cursor": "unchanged"})
        self.assertEqual(A._load_state()["seen"], seen_before)
        self.assertFalse(A.outbox_path().exists())

    def test_c18_crash_no_duplicate(self):
        shop = self.arm()

        def boom(_state):
            raise RuntimeError("crash")

        A._save_state = boom
        try:
            with self.assertRaises(RuntimeError):
                shop.run()
        finally:
            A._save_state = self._save
        self.assertEqual(sum(1 for row in A._outbox_rows() if row.get("event_key") == "D100"), 1)
        result = shop.run()
        count = sum(1 for row in A._outbox_rows() if row.get("event_key") == "D100")
        self.expect_ok({"code": result["code"], "events_for_piece": count}, {"code": "NO_DUPLICATE", "events_for_piece": 1})

    def test_c19_grouped_one_message(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer()
        shop.bind(UID_A)
        names = [("襯衫", "W1001", 900), ("西裝褲", "W1002", 500), ("大衣", "W1003", 450)]
        for index, (name, wash, price) in enumerate(names):
            shop.add_piece(f"G{index}", wash_no=wash, name=name, price=price)
        shop.seed(["BASE"])
        _first, sent = shop.open_and_wait()
        text = shop.body()
        listed = sent.get("pieces_listed")
        code = "GROUPED" if sent["code"] == "ACCEPTED" and sent["http"] == 1 and listed == 3 else sent["code"]
        self.expect_ok({"code": code, "http": sent["http"], "pieces_listed": listed}, {"code": "GROUPED", "http": 1, "pieces_listed": 3})
        for name, wash, price in names:
            self.assertIn(name, text)
            self.assertIn(wash, text)
            self.assertIn(str(price), text)
        self.assertIn("品項合計：1,850 元", text)
        self.assertEqual(len(shop.calls), 1)

    def test_c20_settle_hold(self):
        shop = self.arm()
        shop.run()
        shop.advance(5)
        sent = shop.run()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "SETTLE_HOLD", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c21_interval_hold(self):
        shop = self.arm()
        state = A._load_state()
        state["seen"] = ["D100"]
        state["pending"] = {
            "D100": {
                "donly": "D100",
                "customer_no": "0028",
                "first_seen": A._iso(shop.now - timedelta(minutes=15)),
                "status": "pending",
            }
        }
        state["last_sent"] = {L._cid_key("0028"): A._iso(shop.now - timedelta(minutes=30))}
        A._save_state(state)
        result = shop.run()
        self.expect_ok({"code": result["code"], "http": result["http"]}, {"code": "INTERVAL_HOLD", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c22_amount_tpay(self):
        text, garment, sql = self.ehank_text(price=1500, tpay=900, name="襯衫", wash="W0900", donly="_3AB7CDEFG")
        cols = [part.strip() for part in sql.split("FROM", 1)[0].replace("SELECT", "", 1).split(",")]
        self.assertIn("Price", cols)
        self.assertIn("Tpay", cols)
        self.assertNotEqual(cols.index("Price"), cols.index("Tpay"))
        self.assertEqual(garment["price"], 900)
        self.assertEqual(garment["datei"], "115.09.25")
        self.assertEqual(garment["loc"], "A1")
        self.assertEqual(garment["dater"], "")
        self.assertEqual(garment["donly"], "_3AB7CDEFG")
        shown = 900 if "｜900 元" in text and "品項合計：900 元" in text and "1500" not in text else 0
        self.expect_ok({"code": "AMOUNT_TPAY" if shown == 900 else "AMOUNT_OTHER", "shown": shown}, {"code": "AMOUNT_TPAY", "shown": 900})

    def test_c23_method_kept(self):
        L.bind_uid(UID_A, "0028", PHONE, method="phone")
        first = json.loads(L.BIND.read_text(encoding="utf-8"))[UID_A]
        L.bind_uid(UID_A, "0028", PHONE, method="customer_no")
        second = json.loads(L.BIND.read_text(encoding="utf-8"))[UID_A]
        self.assertEqual(second["bound_at"], first["bound_at"])
        self.expect_ok({"code": "METHOD_KEPT", "method": second["method"]}, {"code": "METHOD_KEPT", "method": "phone"})

    def test_c24_method_replaced(self):
        L.bind_uid(UID_A, "0028", PHONE, method="phone")
        L.bind_uid(UID_A, "1947", PHONE_B, method="customer_no")
        method = json.loads(L.BIND.read_text(encoding="utf-8"))[UID_A]["method"]
        self.expect_ok(
            {"code": "METHOD_REPLACED" if method == "customer_no" else "METHOD_KEPT", "method": method},
            {"code": "METHOD_REPLACED", "method": "customer_no"},
        )

    def test_c25_legacy_need_bind(self):
        shop = self.arm(bind=False)
        shop.bind(UID_A, method=None)
        _first, sent = shop.open_and_wait()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "NEED_BIND", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c26_no_repeat(self):
        shop = self.arm()
        _first, sent = shop.open_and_wait()
        self.assertEqual(sent["code"], "ACCEPTED")
        shop.garments[0]["loc"] = ""
        shop.run()
        shop.garments[0]["loc"] = "A1"
        shop.advance(15)
        shop.run()
        shop.advance(70)
        shop.run()
        http_total = len(shop.calls)
        code = "NO_REPEAT" if http_total == 1 else "REPEAT"
        self.expect_ok({"code": code, "http_total": http_total}, {"code": "NO_REPEAT", "http_total": 1})

    def test_c27_import_starts_no_thread(self):
        import line_webhook  # noqa: F401

        started = [thread for thread in threading.enumerate() if thread.name == "arrival-notify"]
        text = (ROOT / "line_webhook.py").read_text(encoding="utf-8")
        head, _sep, tail = text.partition('if __name__ == "__main__":')
        self.assertNotIn("start_poller", head)
        self.assertIn("start_poller", tail)
        self.expect_ok(
            {"code": "NO_THREAD", "threads_started": len(started)},
            {"code": "NO_THREAD", "threads_started": 0},
        )

    def test_c28_cycle_survives(self):
        calls = []

        def cycle():
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("boom " + UID_A + " " + PHONE + " 測試客")

        done = A.run_supervised(2, cycle_fn=cycle, sleeper=lambda _seconds: None)
        log = A.log_path().read_text(encoding="utf-8")
        self.assertEqual(done, 2)
        self.assertIn("RuntimeError", log)
        self.assertNotIn(UID_A, log)
        self.assertNotIn(PHONE, log)
        self.assertNotIn("測試客", log)
        self.expect_ok(
            {"code": "CYCLE_SURVIVES", "next_cycle_ran": calls == [1, 1]},
            {"code": "CYCLE_SURVIVES", "next_cycle_ran": True},
        )

    def test_c29_picked_not_ready(self):
        shop = self.arm(dater="115.09.26")
        result = shop.run()
        self.expect_ok({"code": result["code"], "http": result["http"]}, {"code": "NOT_READY", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_c30_bad_uid_need_bind(self):
        shop = self.arm(uid="not-a-line-user")
        _first, sent = shop.open_and_wait()
        self.expect_ok({"code": sent["code"], "http": sent["http"]}, {"code": "NEED_BIND", "http": 0})
        self.assertEqual(shop.calls, [])


class Rules(Isolated):
    def test_amount_qty_two_and_markup(self):
        qty_text, qty_row, _sql = self.ehank_text(price=250, tpay=500, name="西裝褲", wash="W0500", donly="_QTY500")
        self.assertIn("｜500 元", qty_text)
        self.assertIn("品項合計：500 元", qty_text)
        self.assertNotIn("250", qty_text)
        self.assertEqual(qty_row["price"], 500)
        mark_text, mark_row, _sql = self.ehank_text(price=250, tpay=450, name="大衣", wash="W0450", donly="_OP450")
        self.assertIn("｜450 元", mark_text)
        self.assertIn("品項合計：450 元", mark_text)
        self.assertNotIn("250", mark_text)
        self.assertEqual(mark_row["price"], 450)

    def test_money_rejects_non_integer_negative_and_non_numeric(self):
        self.assertIsNone(L._money("abc"))
        self.assertIsNone(L._money(-3))
        self.assertIsNone(L._money(1.5))
        self.assertIsNone(L._money(True))
        self.assertEqual(L._money(900), 900)

    def test_matched_by_three_ways(self):
        self.shop.deactivate()
        os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
        self.assertEqual(L.lookup(PHONE).matched_by, "phone")
        self.assertEqual(L.lookup("0028").matched_by, "customer_no")
        self.assertEqual(L.lookup("W2001").matched_by, "wash_no")

    def test_tell_status_ex_passes_matched_by_and_does_not_downgrade(self):
        import conversation as conv

        self.shop.deactivate()
        os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
        conv.SESS = self.shop.root / "data" / "line-sessions.json"
        seen = []
        real = L.bind_uid

        def wrapped(*args, **kwargs):
            seen.append(kwargs.get("method"))
            return real(*args, **kwargs)

        L.bind_uid = wrapped
        try:
            conv.tell_status_ex(UID_A, PHONE, notify_staff=False)
            conv.tell_status_ex(UID_A, "0028", notify_staff=False)
        finally:
            L.bind_uid = real
        self.assertEqual(seen, ["phone", "customer_no"])
        stored = json.loads(L.BIND.read_text(encoding="utf-8"))[UID_A]
        self.assertEqual(stored["method"], "phone")
        self.assertIn("+08:00", stored["bound_at"])

    def test_upgrade_from_weaker_and_legacy_unknown(self):
        L.bind_uid(UID_A, "0028", PHONE, method="customer_no")
        L.bind_uid(UID_A, "0028", PHONE, method="phone")
        self.assertEqual(json.loads(L.BIND.read_text(encoding="utf-8"))[UID_A]["method"], "phone")
        L.bind_uid(UID_A, "0028", PHONE, method="wash_no")
        self.assertEqual(json.loads(L.BIND.read_text(encoding="utf-8"))[UID_A]["method"], "phone")
        self.shop.bind(UID_B, method=None)
        L.bind_uid(UID_B, "0028", PHONE_B, method="phone")
        self.assertEqual(json.loads(L.BIND.read_text(encoding="utf-8"))[UID_B]["method"], "phone")

    def test_waiting_count_hides_names_and_missing_date_is_not_ready(self):
        shop = self.arm()
        shop.add_piece("WAIT", name="羽絨外套", datei="", loc="", wash_no="W2001", price=100)
        _first, sent = shop.open_and_wait()
        text = shop.body()
        self.assertEqual(sent["code"], "ACCEPTED")
        self.assertIn("還有 1 件在處理中。", text)
        self.assertNotIn("羽絨外套", text)
        self.assertEqual(L._balance_copy(-180), "帳務狀態：目前尚欠款 180 元。")
        self.assertIn(L._balance_copy(-180), text)
        shop.garments.clear()
        shop.customers.clear()
        self.arm = None
        fresh = self.shop
        fresh.garments.clear()
        fresh.customers.clear()
        fresh.set_mode("on")
        fresh.add_customer()
        fresh.add_piece("NODATE", datei="", loc="A1")
        fresh.seed(["BASE"])
        result = fresh.run()
        self.assertEqual(result["code"], "NOT_READY")

    def test_over_twenty_and_missing_price_skips_total(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer(balance=0)
        shop.bind(UID_A)
        for index in range(21):
            shop.add_piece(f"P{index:02d}", wash_no=f"W{index:02d}", name=f"品{index:02d}", price=10)
        shop.seed(["BASE"])
        _first, sent = shop.open_and_wait()
        text = shop.body()
        self.assertEqual(sent["pieces_listed"], 20)
        self.assertIn("共 21 件可取，這裡先列 20 件。", text)
        self.assertNotIn("品20", text)
        self.assertIn("品項合計：210 元", text)
        shop.garments[0]["price"] = None
        state = A._load_state()
        for key, row in list(state["pending"].items()):
            if row.get("status") == "accepted":
                row["status"] = "pending"
                row["first_seen"] = A._iso(shop.now - timedelta(minutes=30))
        state["last_sent"] = {}
        A._save_state(state)
        shop.advance(60)
        again = shop.run()
        self.assertEqual(again["code"], "ACCEPTED")
        self.assertNotIn("品項合計", shop.body(1))

    def test_two_uids_and_no_backfill_after_later_bind(self):
        shop = self.arm(bind=False)
        shop.bind(UID_A)
        shop.bind(UID_B)
        _first, sent = shop.open_and_wait()
        self.assertEqual(sent["http"], 2)
        self.assertEqual(len(shop.calls), 2)
        late = self.shop
        late.calls.clear()
        late.script.clear()
        late.garments.clear()
        late.customers.clear()
        late.set_mode("on")
        late.add_customer()
        late.add_piece("LATE", wash_no="W3001")
        L.BIND.write_text(
            json.dumps({UID_A: {"customer_no": "0028", "phone": PHONE, "method": "customer_no"}}),
            encoding="utf-8",
        )
        late.seed(["BASE"])
        _hold, blocked = late.open_and_wait()
        self.assertEqual(blocked["code"], "NEED_BIND")
        late.bind(UID_A, method="phone")
        late.advance(30)
        again = late.run()
        self.assertEqual(late.calls, [])
        self.assertNotEqual(again["code"], "ACCEPTED")

    def test_anomaly_does_not_grow_and_eighty_is_allowed(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer()
        shop.seed(["BASE"])
        for index in range(81):
            shop.add_piece(f"N{index:03d}", wash_no=f"W{index:03d}")
        shop.run()
        stamp = A._load_state()["anomaly"]["at"]
        shop.run()
        self.assertEqual(A._load_state()["anomaly"]["at"], stamp)
        self.assertEqual(A._load_state()["anomaly"]["new_count"], 81)
        result = A.rebaseline(clock=lambda: shop.now)
        self.assertIsNone(A._load_state()["anomaly"])
        self.assertEqual(result["http"], 0)
        self.assertEqual(len(A._load_state()["seen"]), 81)
        shop.garments.clear()
        for index in range(80):
            shop.add_piece(f"Z{index:03d}", wash_no=f"Z{index:03d}")
        follow = shop.run()
        self.assertEqual(follow["code"], "SETTLE_HOLD")
        self.assertEqual(len(A._load_state()["seen"]), 161)

    def test_attempts_quota_token_and_bare_409(self):
        shop = self.arm()
        cid_key = L._cid_key("0028")
        delivery_id = cid_key + ":" + UID_A
        state = A._load_state()
        state["seen"] = ["D100"]
        state["pending"] = {
            "D100": {
                "donly": "D100",
                "customer_no": "0028",
                "first_seen": A._iso(shop.now - timedelta(minutes=30)),
                "status": "inflight",
            }
        }
        state["deliveries"] = {
            delivery_id: {
                "id": delivery_id,
                "uid": UID_A,
                "customer_no": "0028",
                "text": "可以來取了：",
                "retry_key": "22222222-2222-4222-8222-222222222222",
                "attempts": 5,
                "first_attempt": A._iso(shop.now - timedelta(minutes=30)),
                "status": "uncertain",
                "donlies": ["D100"],
            }
        }
        A._save_state(state)
        # 重送前會用本輪快照重組文字；這裡改成與 _compose 逐字相同，滿 5 次仍走同一把鍵。
        planted, _shown = A._compose("0028", shop.garments, shop.customers, A._known_keys(shop.customers))
        state = A._load_state()
        state["deliveries"][delivery_id]["text"] = planted
        A._save_state(state)
        # 不確定推播不再有 5 次上限；滿 5 次、未滿 24 小時仍用同一把鍵再送。
        retried = shop.run()
        self.assertEqual(retried["http"], 1)
        self.assertEqual(len(shop.calls), 1)
        self.assertEqual(A._load_state()["deliveries"][delivery_id]["attempts"], 6)
        self.assertEqual(A._load_state()["deliveries"][delivery_id]["status"], "accepted")
        shop.calls.clear()
        shop.script = ["500"]
        shop.garments[0]["donly"] = "D500"
        shop.seed(["BASE"])
        _first, uncertain = shop.open_and_wait()
        self.assertEqual(uncertain["code"], "UNCERTAIN")
        shop.script = ["409bare"]
        shop.garments[0]["donly"] = "D409"
        shop.seed(["BASE"])
        _first, rejected = shop.open_and_wait()
        self.assertEqual(rejected["code"], "REJECTED")
        sn.quota_left = lambda: (None, None, None)
        shop.garments[0]["donly"] = "DNONE"
        shop.seed(["BASE"])
        shop.calls.clear()
        _first, held = shop.open_and_wait()
        self.assertEqual(held["code"], "QUOTA_HOLD")
        self.assertEqual(shop.calls, [])
        sn._token = lambda: ""
        shop.garments[0]["donly"] = "DTOK"
        shop.seed(["BASE"])
        shop.calls.clear()

        def quota():
            return (1000, 0, 900)

        sn.quota_left = quota
        _first, missing = shop.open_and_wait()
        self.assertEqual(missing["code"], "TOKEN_HOLD")
        self.assertEqual(shop.calls, [])

    def test_window_edges_naive_clock_and_untrusted_sources(self):
        morning = A._to_taipei(datetime(2026, 9, 25, 1, 0, tzinfo=UTC))
        closing = A._to_taipei(datetime(2026, 9, 25, 13, 0, tzinfo=UTC))
        early = A._to_taipei(datetime(2026, 9, 25, 0, 59, tzinfo=UTC))
        self.assertEqual(morning.hour, 9)
        self.assertEqual(closing.hour, 21)
        self.assertTrue(A._inside_window(morning, "09:00-21:00"))
        self.assertFalse(A._inside_window(closing, "09:00-21:00"))
        self.assertFalse(A._inside_window(early, "09:00-21:00"))
        self.shop.set_mode("on")
        with self.assertRaises(ValueError):
            A.run_cycle(clock=lambda: datetime(2026, 9, 25, 3, 0))
        shop = self.arm()
        before = A.state_path().read_bytes()
        shop.source = "fixture"
        result = shop.run()
        self.assertEqual(result["code"], "READ_FAIL_HOLD")
        self.assertEqual(A.state_path().read_bytes(), before)
        shop.source = L.EHANK_SOURCE
        shop.fail = "zero_pieces"
        result = shop.run()
        self.assertEqual(result["code"], "READ_FAIL_HOLD")
        self.assertEqual(A.state_path().read_bytes(), before)
        self.shop.fail = "exception"
        missing = self.shop.root / "data" / "no-such-state"
        self.assertFalse(missing.exists())
        # 沒有狀態檔時讀取失敗，不得建基線。
        A.state_path().unlink()
        result = shop.run()
        self.assertEqual(result["code"], "READ_FAIL_HOLD")
        self.assertFalse(A.state_path().exists())

    def test_config_reread_bad_mode_and_cli(self):
        shop = self.shop
        shop.add_customer()
        shop.add_piece("D100")
        first = shop.run()
        self.assertEqual(first["code"], "MODE_OFF")
        self.assertEqual(shop.reads, 0)
        A.config_path().parent.mkdir(parents=True, exist_ok=True)
        A.config_path().write_text("{", encoding="utf-8")
        self.assertEqual(shop.run()["code"], "MODE_OFF")
        A.config_path().write_text(json.dumps({"mode": "yes"}), encoding="utf-8")
        self.assertEqual(shop.run()["code"], "MODE_OFF")
        self.assertEqual(shop.reads, 0)
        shop.set_mode("on")
        second = shop.run()
        self.assertNotEqual(second["code"], "MODE_OFF")
        self.assertGreaterEqual(shop.reads, 1)
        cfg = A.load_config()
        self.assertEqual(cfg["poll_seconds"], 300)
        self.assertEqual(cfg["max_new_per_cycle"], 80)
        self.assertEqual(cfg["settle_minutes"], 10)
        self.assertEqual(cfg["min_interval_minutes"], 60)
        self.assertEqual(cfg["send_window"], "09:00-21:00")
        self.assertEqual(cfg["quota_reserve"], 50)
        A.config_path().unlink()
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(A.main(["--status"]), 0)
        self.assertIn("mode=off", buf.getvalue())
        state = A._empty_state()
        state["deliveries"] = {
            "x": {"id": "x", "uid": UID_A, "status": "accepted", "text": "測試客 " + PHONE}
        }
        A._save_state(state)
        buf = io.StringIO()
        with redirect_stdout(buf):
            A.main(["--status"])
        shown = buf.getvalue()
        self.assertNotIn(UID_A, shown)
        self.assertNotIn(PHONE, shown)
        self.assertNotIn("測試客", shown)
        A.state_path().unlink()
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(A.main(["--once", "--mode", "dry_run"]), 0)
        self.assertFalse(A.config_path().exists())
        self.assertIn("BASELINE_ONLY", buf.getvalue())
        self.assertEqual(shop.calls, [])
        state = A._load_state()
        state["anomaly"] = {"active": True, "at": A._iso(shop.now), "new_count": 81}
        A._save_state(state)
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(A.main(["--rebaseline"]), 0)
        self.assertIn("REBASELINED", buf.getvalue())
        self.assertIsNone(A._load_state()["anomaly"])
        self.assertFalse((A.state_path().parent / (A.state_path().name + ".tmp")).exists())

    def test_lock_and_daemon_thread(self):
        self.assertTrue(A._acquire_lock())
        self.assertFalse(A._acquire_lock())
        A._release_lock()
        A.lock_path().write_text("99999999", encoding="ascii")
        self.assertTrue(A._acquire_lock())
        A._release_lock()
        called = []
        A.run_supervised = lambda *args, **kwargs: called.append(1)
        thread = A.start_poller()
        self.assertTrue(thread.daemon)
        self.assertEqual(thread.name, "arrival-notify")
        thread.join(timeout=2)
        self.assertEqual(called, [1])
        self.assertFalse(thread.is_alive())
        self.assertTrue(A._acquire_lock())
        called.clear()
        thread = A.start_poller()
        thread.join(timeout=2)
        self.assertEqual(called, [])
        A._release_lock()

    def test_first_run_does_not_anomaly_pause(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer()
        for index in range(81):
            shop.add_piece(f"B{index:03d}", wash_no=f"B{index:03d}")
        result = shop.run()
        self.assertEqual(result["code"], "BASELINE_ONLY")
        self.assertEqual(result["http"], 0)
        self.assertEqual(len(A._load_state()["seen"]), 81)
        self.assertFalse(A._anomaly_active(A._load_state()))

    def test_fixture_optional_arrival_fields_default_blank(self):
        self.shop.deactivate()
        _customers, garments = L._from_fixture()
        self.assertTrue(garments)
        for row in garments:
            self.assertEqual(row.get("donly"), "")
            self.assertEqual(row.get("datei"), "")
            self.assertEqual(row.get("loc"), "")
            self.assertEqual(row.get("dater"), "")


def _targets(shop):
    found = []
    for req in shop.calls:
        body = json.loads(req.data.decode("utf-8"))
        found.append((body.get("to"), body["messages"][0]["text"]))
    return found


class Relay(Isolated):
    def _cfg(self, **kwargs):
        raw = json.loads(A.config_path().read_text(encoding="utf-8"))
        raw.update(kwargs)
        A.config_path().write_text(json.dumps(raw), encoding="utf-8")

    def _to_uncertain(self, shop):
        shop.script = ["timeout"]
        shop.run()
        shop.advance(15)
        cycle = shop.run()
        self.assertEqual(cycle["code"], "UNCERTAIN")
        self.assertEqual(cycle["http"], 1)
        return next(iter(A._load_state()["deliveries"].values()))

    def _crash_during_send(self, shop):
        shop.script = ["kill"]
        shop.run()
        shop.advance(15)
        with self.assertRaises(BaseException) as caught:
            shop.run()
        self.assertEqual(str(caught.exception), "killed")
        delivery = next(iter(A._load_state()["deliveries"].values()))
        self.assertEqual(delivery["status"], "inflight")
        return delivery

    def test_r01_b_sent_next_cycle(self):
        shop = self.shop
        shop.set_mode("on")
        raw = json.loads(A.config_path().read_text(encoding="utf-8"))
        raw["settle_minutes"] = 0
        A.config_path().write_text(json.dumps(raw), encoding="utf-8")
        shop.add_customer(no="0028", balance=-180)
        shop.add_customer(no="1947", phone=PHONE_B, balance=-20)
        shop.add_piece("DA", customer_no="0028", wash_no="WA", name="襯衫", price=900)
        shop.bind(UID_A, "0028", phone=PHONE)
        shop.bind(UID_B, "1947", phone=PHONE_B)
        shop.seed(["BASE"])
        shop.script = ["timeout"] * 6
        for _ in range(6):
            cycle = shop.run()
            self.assertEqual(cycle["http"], 1)
        shop.add_piece("DB", customer_no="1947", wash_no="WB", name="大衣", price=700)
        shop.script = ["200", "200"]
        shop.run()
        b_pushes = 0
        for req in shop.calls[6:]:
            body = json.loads(req.data.decode("utf-8"))
            if body.get("to") == UID_B:
                b_pushes += 1
        b_delay_cycles = 0 if b_pushes == 1 else 1
        code = "B_SENT_NEXT_CYCLE" if b_pushes == 1 and b_delay_cycles == 0 else "BLOCKED"
        self.expect_ok(
            {"code": code, "b_pushes": b_pushes, "b_delay_cycles": b_delay_cycles},
            {"code": "B_SENT_NEXT_CYCLE", "b_pushes": 1, "b_delay_cycles": 0},
        )

    def test_r02_retry_same_key_without_cap(self):
        shop = self.arm()
        shop.script = ["timeout"] * 6 + ["200"]
        shop.run()
        shop.advance(15)
        keys = []
        for _ in range(6):
            cycle = shop.run()
            self.assertEqual(cycle["http"], 1)
            keys.append(shop.calls[-1].get_header("X-line-retry-key"))
        accepted = shop.run()
        keys.append(shop.calls[-1].get_header("X-line-retry-key"))
        kinds = len(set(keys))
        delivery = next(iter(A._load_state()["deliveries"].values()))
        a_accepted = accepted["code"] == "ACCEPTED" and delivery["status"] == "accepted"
        code = "A_RETRIED_SAME_KEY" if a_accepted and kinds == 1 else "CAPPED"
        self.expect_ok(
            {"code": code, "a_accepted": a_accepted, "a_key_kinds": kinds},
            {"code": "A_RETRIED_SAME_KEY", "a_accepted": True, "a_key_kinds": 1},
        )

    def test_r17_new_piece_new_message(self):
        shop = self.arm(name="襯衫", wash="WA100", price=900)
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        old_donlies = list(delivery["donlies"])
        shop.add_piece("DNEW", wash_no="WB200", name="羽絨外套", price=1500)
        shop.script = ["200"]
        mid = shop.run()
        self.assertEqual(mid["http"], 0)
        shop.advance(15)
        before = len(shop.calls)
        sent = shop.run()
        recovery = shop.calls[before:]
        text = shop.body(-1) if recovery else ""
        new_key = recovery[-1].get_header("X-line-retry-key") if recovery else ""
        old_key_calls = sum(1 for req in recovery if req.get_header("X-line-retry-key") == old_key)
        state = A._load_state()
        superseded = [row for row in state["deliveries"].values() if row.get("status") == "superseded"]
        if superseded:
            old_donlies_grew = list(superseded[0].get("donlies") or []) != old_donlies
        else:
            old_donlies_grew = True
        self.expect_ok(
            {
                "code": "NEW_PIECE_NEW_MESSAGE" if sent["http"] == 1 and "羽絨外套" in text and "襯衫" in text and new_key != old_key and old_key_calls == 0 and not old_donlies_grew else "MERGED",
                "calls_after_recovery": len(recovery),
                "text_lists_both": "羽絨外套" in text and "襯衫" in text,
                "new_key_differs": bool(new_key) and new_key != old_key,
                "old_key_calls_after_supersede": old_key_calls,
                "old_donlies_grew": old_donlies_grew,
            },
            {
                "code": "NEW_PIECE_NEW_MESSAGE",
                "calls_after_recovery": 1,
                "text_lists_both": True,
                "new_key_differs": True,
                "old_key_calls_after_supersede": 0,
                "old_donlies_grew": False,
            },
        )

    def test_r04_http_429_retryable(self):
        shop = self.arm()
        shop.script = ["429", "200"]
        shop.run()
        shop.advance(15)
        first = shop.run()
        self.assertEqual(first["code"], "UNCERTAIN")
        first_status = next(iter(A._load_state()["deliveries"].values()))["status"]
        key1 = shop.calls[0].get_header("X-line-retry-key")
        shop.advance(1)
        second = shop.run()
        key2 = shop.calls[1].get_header("X-line-retry-key")
        same = bool(key1) and key1 == key2 and second["code"] == "ACCEPTED"
        code = "RETRYABLE_429" if first_status == "uncertain" and same else "STUCK"
        self.expect_ok(
            {"code": code, "first_status": first_status, "retry_same_key": same},
            {"code": "RETRYABLE_429", "first_status": "uncertain", "retry_same_key": True},
        )

    def test_r05_binding_changed(self):
        shop = self.arm()
        shop.script = ["timeout"]
        shop.run()
        shop.advance(15)
        sent = shop.run()
        self.assertEqual(sent["code"], "UNCERTAIN")
        shop.bind(UID_A, customer_no="1947", phone=PHONE_B)
        shop.calls.clear()
        result = shop.run()
        status = next(iter(A._load_state()["deliveries"].values()))["status"]
        code = "BINDING_CHANGED" if status == "binding_changed" else result["code"]
        self.expect_ok({"code": code, "http": result["http"]}, {"code": "BINDING_CHANGED", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_r06_only_owner_pushed(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer(no="0028", balance=-180)
        shop.add_customer(no="1947", phone=PHONE_B, balance=-50)
        shop.add_piece("DA", customer_no="0028", wash_no="WA", name="襯衫", price=900)
        shop.bind(UID_A, "0028", phone=PHONE)
        shop.bind(UID_B, "1947", phone=PHONE_B)
        shop.seed(["BASE"])
        shop.run()
        shop.advance(15)
        shop.run()
        targets = _targets(shop)
        pushes_to_a = sum(1 for uid, _text in targets if uid == UID_A)
        pushes_to_b = sum(1 for uid, _text in targets if uid == UID_B)
        code = "ONLY_OWNER_PUSHED" if pushes_to_a == 1 and pushes_to_b == 0 else "LEAKED"
        self.expect_ok(
            {"code": code, "pushes_to_a": pushes_to_a, "pushes_to_b": pushes_to_b},
            {"code": "ONLY_OWNER_PUSHED", "pushes_to_a": 1, "pushes_to_b": 0},
        )

    def test_r07_only_owner_content(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer(no="0028", balance=-180)
        shop.add_customer(no="1947", phone=PHONE_B, balance=-999)
        shop.add_piece("DA", customer_no="0028", wash_no="WA100", name="襯衫", price=900)
        shop.add_piece("DB", customer_no="1947", wash_no="WB200", name="羽絨外套", price=1500)
        shop.bind(UID_A, "0028", phone=PHONE)
        shop.bind(UID_B, "1947", phone=PHONE_B)
        shop.seed(["BASE"])
        shop.run()
        shop.advance(15)
        shop.run()
        texts = {uid: text for uid, text in _targets(shop)}
        text_a = texts[UID_A]
        leaked = 0
        for token in ("羽絨外套", "WB200", "1,500", "999"):
            if token in text_a:
                leaked += 1
        self.assertIn("180", text_a)
        self.assertIn("襯衫", text_a)
        code = "ONLY_OWNER_CONTENT" if leaked == 0 else "LEAKED"
        self.expect_ok(
            {"code": code, "b_items_in_a_text": leaked},
            {"code": "ONLY_OWNER_CONTENT", "b_items_in_a_text": 0},
        )

    def test_r08_anomaly_sticky(self):
        shop = self.shop
        shop.set_mode("on")
        shop.add_customer()
        shop.seed(["BASE"])
        for index in range(81):
            shop.add_piece(f"N{index:03d}", wash_no=f"W{index:03d}")
        shop.run()
        seen = list(A._load_state()["seen"])
        shop.garments[0]["dater"] = "115.09.26"
        shop.garments[1]["dater"] = "115.09.26"
        second = shop.run()
        actual = {"code": second["code"], "http": second["http"], "cursor": second["cursor"]}
        self.expect_ok(actual, {"code": "ANOMALY_HOLD", "http": 0, "cursor": "unchanged"})
        self.assertEqual(list(A._load_state()["seen"]), seen)
        self.assertEqual(shop.calls, [])
        again = A.rebaseline(clock=lambda: shop.now)
        self.assertEqual(again["code"], "REBASELINED")
        self.assertIsNone(A._load_state().get("anomaly"))
        shop.add_piece("AFTER", wash_no="WA", name="恢復後")
        follow = shop.run()
        self.assertNotEqual(follow["code"], "ANOMALY_HOLD")

    def test_r09_atomic_bind_write(self):
        L.BIND.parent.mkdir(parents=True, exist_ok=True)
        L.BIND.write_text('{"keep": 1}\n', encoding="utf-8")
        before = L.BIND.read_bytes()
        real = os.replace

        def boom(*_args, **_kwargs):
            raise OSError("replace failed")

        os.replace = boom
        try:
            with self.assertRaises(OSError):
                L.bind_uid(UID_B, "1947", PHONE_B, method="phone")
        finally:
            os.replace = real
        unchanged = L.BIND.read_bytes() == before
        code = "ATOMIC_BIND_WRITE" if unchanged else "OVERWRITTEN"
        self.expect_ok(
            {"code": code, "bind_file_unchanged": unchanged},
            {"code": "ATOMIC_BIND_WRITE", "bind_file_unchanged": True},
        )

    def test_r10_bind_unreadable(self):
        shop = self.arm()
        L.BIND.write_text('{"' + UID_A + '": {"customer_no": "0028", "method": "ph', encoding="utf-8")
        shop.run()
        shop.advance(15)
        held = shop.run()
        pending = A._load_state()["pending"]["D100"]
        need_bind = pending.get("status") == "need_bind"
        self.assertEqual(shop.calls, [])
        L.BIND.write_text(
            json.dumps({UID_A: {"customer_no": "0028", "phone": PHONE, "method": "phone"}}),
            encoding="utf-8",
        )
        shop.advance(1)
        shop.run()
        pushes = len(shop.calls)
        code = "BIND_UNREADABLE" if held["code"] == "BIND_UNREADABLE" and not need_bind and pushes == 1 else "DROPPED"
        self.expect_ok(
            {"code": code, "need_bind_recorded": need_bind, "pushes_after_fix": pushes},
            {"code": "BIND_UNREADABLE", "need_bind_recorded": False, "pushes_after_fix": 1},
        )

    def test_r11_need_bind_when_parsed(self):
        shop = self.arm(method="customer_no")
        shop.run()
        shop.advance(15)
        sent = shop.run()
        pending = next(iter(A._load_state()["pending"].values()))
        recorded = pending.get("status") == "need_bind"
        code = sent["code"] if recorded else "NOT_RECORDED"
        self.expect_ok({"code": code, "http": sent["http"]}, {"code": "NEED_BIND", "http": 0})
        self.assertEqual(shop.calls, [])

    def test_r12_startup_survives(self):
        import line_webhook

        text = (ROOT / "line_webhook.py").read_text(encoding="utf-8")
        _head, _sep, tail = text.partition('if __name__ == "__main__":')
        body = textwrap.dedent(tail)
        called = []
        real_run = line_webhook.app.run
        real_start = A.start_poller

        def fake_run(*_args, **_kwargs):
            called.append(True)

        def boom():
            raise RuntimeError("blocked " + PHONE)

        line_webhook.app.run = fake_run
        A.start_poller = boom
        stderr = io.StringIO()
        try:
            with redirect_stderr(stderr):
                exec(compile(body, str(ROOT / "line_webhook.py"), "exec"), line_webhook.__dict__)
        finally:
            line_webhook.app.run = real_run
            A.start_poller = real_start
        logged = stderr.getvalue()
        self.assertEqual(logged.splitlines(), ["RuntimeError"])
        self.assertNotIn(PHONE, logged)
        self.expect_ok(
            {"code": "STARTUP_SURVIVES", "app_run_called": bool(called)},
            {"code": "STARTUP_SURVIVES", "app_run_called": True},
        )

    def test_r13_all_gone_superseded(self):
        shop = self.arm(balance=-350, name="襯衫")
        self._to_uncertain(shop)
        shop.garments[0]["dater"] = "115.09.26"
        shop.garments[0]["customer_no"] = "@@@X"
        shop.customers[0]["balance"] = 0
        shop.calls.clear()
        shop.script = ["200"]
        result = shop.run()
        state = A._load_state()
        delivery = next(iter(state["deliveries"].values()))
        piece = state["pending"]["D100"]["status"]
        self.expect_ok(
            {
                "code": result["code"],
                "calls_after_recovery": len(shop.calls),
                "delivery_status": delivery["status"],
                "piece_status": piece,
            },
            {
                "code": "SUPERSEDED",
                "calls_after_recovery": 0,
                "delivery_status": "superseded",
                "piece_status": "suppressed",
            },
        )

    def test_r14_balance_new_message(self):
        shop = self.arm(balance=-350, name="襯衫")
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        shop.customers[0]["balance"] = 0
        shop.calls.clear()
        shop.script = ["200"]
        result = shop.run()
        text = shop.body(-1) if shop.calls else ""
        new_key = shop.calls[-1].get_header("X-line-retry-key") if shop.calls else ""
        old_key_calls = sum(1 for req in shop.calls if req.get_header("X-line-retry-key") == old_key)
        stale = "尚欠款 350" in text
        ok = result["http"] == 1 and new_key != old_key and not stale and old_key_calls == 0
        self.expect_ok(
            {
                "code": "NEW_MESSAGE_NEW_KEY" if ok else result["code"],
                "calls_after_recovery": len(shop.calls),
                "new_key_differs": bool(new_key) and new_key != old_key,
                "text_has_stale_debt": stale,
                "old_key_calls_after_supersede": old_key_calls,
            },
            {
                "code": "NEW_MESSAGE_NEW_KEY",
                "calls_after_recovery": 1,
                "new_key_differs": True,
                "text_has_stale_debt": False,
                "old_key_calls_after_supersede": 0,
            },
        )

    def test_r15_requeue_still_ready(self):
        shop = self.arm(name="襯衫", wash="WA100", price=900)
        shop.add_piece("D200", wash_no="WB200", name="西裝褲", price=500)
        self._cfg(settle_minutes=10)
        self._to_uncertain(shop)
        kept = A._load_state()["pending"]["D200"]["first_seen"]
        shop.garments[0]["dater"] = "115.09.26"
        shop.advance(15)
        shop.calls.clear()
        shop.script = ["200"]
        result = shop.run()
        text = shop.body(-1) if shop.calls else ""
        state = A._load_state()
        same_seen = state["pending"]["D200"]["first_seen"] == kept
        sent = result["http"] == 1 and result["code"] == "ACCEPTED" and same_seen
        self.expect_ok(
            {
                "code": "REQUEUED_STILL_READY" if sent and "西裝褲" in text and "襯衫" not in text else "STALE",
                "calls_after_recovery": len(shop.calls),
                "text_lists_remaining": "西裝褲" in text,
                "text_lists_picked": "襯衫" in text,
                "sent_in_recovery_cycle": sent,
            },
            {
                "code": "REQUEUED_STILL_READY",
                "calls_after_recovery": 1,
                "text_lists_remaining": True,
                "text_lists_picked": False,
                "sent_in_recovery_cycle": True,
            },
        )

    def test_r16_same_key_unchanged(self):
        shop = self.arm(name="襯衫", wash="WA100", price=900)
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        old_text = delivery["text"]
        shop.calls.clear()
        shop.script = ["200"]
        result = shop.run()
        text = shop.body(-1) if shop.calls else ""
        new_key = shop.calls[-1].get_header("X-line-retry-key") if shop.calls else ""
        shop.advance(20)
        shop.add_piece("DLATE", wash_no="WLATE", name="新外套", price=300)
        shop.run()
        shop.advance(15)
        later = shop.run()
        self.expect_ok(
            {
                "code": "SAME_KEY_UNCHANGED" if result["http"] == 1 and new_key == old_key and text == old_text else "CHANGED",
                "calls_after_recovery": 1 if result["http"] == 1 else len(shop.calls),
                "same_key": bool(new_key) and new_key == old_key,
                "same_text": text == old_text,
                "later_piece": later["code"],
            },
            {
                "code": "SAME_KEY_UNCHANGED",
                "calls_after_recovery": 1,
                "same_key": True,
                "same_text": True,
                "later_piece": "INTERVAL_HOLD",
            },
        )

    def test_r18_inflight_resent(self):
        shop = self.arm()
        self._crash_during_send(shop)
        shop.script = ["409"]
        shop.run()
        keys = [req.get_header("X-line-retry-key") for req in shop.calls]
        state = A._load_state()
        delivery = next(iter(state["deliveries"].values()))
        piece = state["pending"]["D100"]["status"]
        self.expect_ok(
            {
                "code": "INFLIGHT_RESENT" if len(shop.calls) == 2 and len(set(keys)) == 1 and delivery["status"] == "accepted" and piece == "accepted" else "MISSED",
                "total_calls": len(shop.calls),
                "key_kinds": len(set(keys)),
                "delivery_status": delivery["status"],
                "piece_status": piece,
            },
            {
                "code": "INFLIGHT_RESENT",
                "total_calls": 2,
                "key_kinds": 1,
                "delivery_status": "accepted",
                "piece_status": "accepted",
            },
        )

    def test_r19_one_key_after_crash(self):
        shop = self.arm()
        self._crash_during_send(shop)
        shop.script = ["timeout", "timeout", "timeout", "200"]
        for _ in range(3):
            shop.run()
        shop.run()
        keys = [req.get_header("X-line-retry-key") for req in shop.calls]
        state = A._load_state()
        mine = [row for row in state["deliveries"].values() if row.get("customer_no") == "0028"]
        final = mine[-1]["status"] if mine else ""
        self.expect_ok(
            {
                "code": "ONE_KEY_AFTER_CRASH" if len(set(keys)) == 1 and len(mine) == 1 and final == "accepted" else "SPLIT",
                "key_kinds": len(set(keys)),
                "deliveries_for_customer": len(mine),
                "final_status": final,
            },
            {
                "code": "ONE_KEY_AFTER_CRASH",
                "key_kinds": 1,
                "deliveries_for_customer": 1,
                "final_status": "accepted",
            },
        )

    def test_r20_window_hold(self):
        shop = self.arm()
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        shop.now = datetime(2026, 9, 25, 13, 30, tzinfo=UTC)
        shop.calls.clear()
        shop.script = ["200", "200"]
        held = shop.run()
        held_calls = len(shop.calls)
        shop.now = datetime(2026, 9, 26, 1, 5, tzinfo=UTC)
        shop.run()
        after = len(shop.calls) - held_calls
        new_key = shop.calls[-1].get_header("X-line-retry-key") if shop.calls else ""
        self.expect_ok(
            {
                "code": held["code"],
                "calls_while_held": held_calls,
                "calls_after_release": after,
                "same_key": bool(new_key) and new_key == old_key and held_calls == 0,
            },
            {
                "code": "WINDOW_HOLD",
                "calls_while_held": 0,
                "calls_after_release": 1,
                "same_key": True,
            },
        )

    def test_r21_dry_run_hold(self):
        shop = self.arm()
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        shop.calls.clear()
        shop.script = ["200"] * 4
        shop.set_mode("dry_run")
        held = None
        for _ in range(3):
            held = shop.run()
        held_calls = len(shop.calls)
        shop.set_mode("on")
        shop.run()
        after = len(shop.calls) - held_calls
        new_key = shop.calls[-1].get_header("X-line-retry-key") if shop.calls else ""
        self.expect_ok(
            {
                "code": held["code"],
                "calls_while_held": held_calls,
                "calls_after_release": after,
                "same_key": bool(new_key) and new_key == old_key and held_calls == 0,
            },
            {
                "code": "DRY_RUN",
                "calls_while_held": 0,
                "calls_after_release": 1,
                "same_key": True,
            },
        )

    def test_r22_quota_hold(self):
        shop = self.arm()
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        shop.left = 20
        shop.calls.clear()
        shop.script = ["200", "200"]
        held = shop.run()
        held_calls = len(shop.calls)
        shop.left = 900
        shop.run()
        after = len(shop.calls) - held_calls
        new_key = shop.calls[-1].get_header("X-line-retry-key") if shop.calls else ""
        self.expect_ok(
            {
                "code": held["code"],
                "calls_while_held": held_calls,
                "calls_after_release": after,
                "same_key": bool(new_key) and new_key == old_key and held_calls == 0,
            },
            {
                "code": "QUOTA_HOLD",
                "calls_while_held": 0,
                "calls_after_release": 1,
                "same_key": True,
            },
        )

    def test_r23_token_hold(self):
        shop = self.arm()
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        shop.calls.clear()
        shop.script = ["200", "200"]
        sn._token = lambda: ""
        held = shop.run()
        held_calls = len(shop.calls)
        sn._token = lambda: "x"
        shop.run()
        after = len(shop.calls) - held_calls
        new_key = shop.calls[-1].get_header("X-line-retry-key") if shop.calls else ""
        self.expect_ok(
            {
                "code": held["code"],
                "calls_while_held": held_calls,
                "calls_after_release": after,
                "same_key": bool(new_key) and new_key == old_key and held_calls == 0,
            },
            {
                "code": "TOKEN_HOLD",
                "calls_while_held": 0,
                "calls_after_release": 1,
                "same_key": True,
            },
        )

    def test_r24_uncertain_24h_boundary(self):
        shop = self.arm()
        self._cfg(send_window="00:00-24:00")
        delivery = self._to_uncertain(shop)
        old_key = delivery["retry_key"]
        shop.now += timedelta(hours=23, minutes=50)
        shop.calls.clear()
        shop.script = ["timeout"]
        shop.run()
        mid_calls = len(shop.calls)
        mid_key = shop.calls[-1].get_header("X-line-retry-key") if shop.calls else ""
        shop.now += timedelta(minutes=10)
        shop.calls.clear()
        expired = shop.run()
        piece = A._load_state()["pending"]["D100"]["status"]
        self.expect_ok(
            {
                "code": expired["code"],
                "calls_at_23h50m": mid_calls,
                "same_key_at_23h50m": bool(mid_key) and mid_key == old_key,
                "calls_at_24h": len(shop.calls),
                "piece_status": piece,
            },
            {
                "code": "UNCERTAIN_EXPIRED",
                "calls_at_23h50m": 1,
                "same_key_at_23h50m": True,
                "calls_at_24h": 0,
                "piece_status": "uncertain_expired",
            },
        )

    def test_r25_http_sum(self):
        shop = self.arm()
        self._to_uncertain(shop)
        shop.add_customer(no="1947", phone=PHONE_B, balance=-20)
        shop.add_piece("DB", customer_no="1947", wash_no="WB", name="大衣", price=700)
        shop.bind(UID_B, "1947", phone=PHONE_B)
        shop.script = ["timeout"]
        shop.run()
        shop.advance(15)
        shop.calls.clear()
        shop.script = ["200", "200"]
        result = shop.run()
        self.expect_ok(
            {
                "code": "HTTP_SUM" if result["http"] == 2 and len(shop.calls) == 2 else "SHORT",
                "result_http": result["http"],
                "fake_calls_in_cycle": len(shop.calls),
            },
            {"code": "HTTP_SUM", "result_http": 2, "fake_calls_in_cycle": 2},
        )

    def test_r26_bind_locked(self):
        started = threading.Event()
        release = threading.Event()
        orig = L._load_json
        seen = {"n": 0}

        def wrapped(path):
            data = orig(path)
            seen["n"] += 1
            if seen["n"] == 1:
                started.set()
                release.wait(5)
            return data

        L._load_json = wrapped
        errors = []

        def bind(uid, customer_no):
            try:
                L.bind_uid(uid, customer_no, PHONE, method="phone")
            except Exception as exc:
                errors.append(exc)

        first = threading.Thread(target=bind, args=(UID_A, "0028"))
        second = threading.Thread(target=bind, args=(UID_B, "1947"))
        try:
            first.start()
            self.assertTrue(started.wait(2))
            second.start()
            second.join(0.5)
            release.set()
            first.join(2)
            second.join(2)
        finally:
            release.set()
            L._load_json = orig
        self.assertEqual(errors, [])
        data = json.loads(L.BIND.read_text(encoding="utf-8"))
        both = UID_A in data and UID_B in data
        self.expect_ok(
            {"code": "BIND_LOCKED" if both else "LOST", "both_records_present": both},
            {"code": "BIND_LOCKED", "both_records_present": True},
        )

    def test_r27_any_accepted(self):
        shop = self.arm()
        shop.bind(UID_B, "0028")
        shop.script = ["200", "400"]
        shop.run()
        shop.advance(15)
        shop.run()
        state = A._load_state()
        piece = state["pending"]["D100"]["status"]
        last = bool((state.get("last_sent") or {}).get(L._cid_key("0028")))
        shop.advance(20)
        shop.add_piece("DLATE", wash_no="WLATE", name="新外套", price=300)
        shop.run()
        shop.advance(15)
        later = shop.run()
        self.expect_ok(
            {
                "code": "ANY_ACCEPTED" if piece == "accepted" and last and later["code"] == "INTERVAL_HOLD" else "LAST_WINS",
                "piece_status": piece,
                "last_sent_recorded": last,
                "later_piece": later["code"],
            },
            {
                "code": "ANY_ACCEPTED",
                "piece_status": "accepted",
                "last_sent_recorded": True,
                "later_piece": "INTERVAL_HOLD",
            },
        )

    def test_r28_accepted_sticky(self):
        shop = self.arm()
        shop.bind(UID_B, "0028")
        shop.script = ["200", "timeout"]
        shop.run()
        shop.advance(15)
        shop.run()
        shop.now += timedelta(hours=24)
        shop.calls.clear()
        shop.run()
        state = A._load_state()
        piece = state["pending"]["D100"]["status"]
        b_row = next(row for row in state["deliveries"].values() if row.get("uid") == UID_B)
        self.expect_ok(
            {
                "code": "ACCEPTED_STICKY" if piece == "accepted" and b_row["status"] == "uncertain_expired" else "DOWNGRADED",
                "piece_status_after_b_expired": piece,
                "b_delivery_status": b_row["status"],
            },
            {
                "code": "ACCEPTED_STICKY",
                "piece_status_after_b_expired": "accepted",
                "b_delivery_status": "uncertain_expired",
            },
        )
        self.assertEqual(shop.calls, [])


class Scorer(unittest.TestCase):
    def test_wrong_name_is_invalid_not_killed(self):
        verdict = judge_mutation({}, ["pkg.Test.test_other"], ["pkg.Test.test_missing"])
        self.assertEqual(verdict, "invalid")

    def test_clean_failure_is_invalid(self):
        verdict = judge_mutation(
            {"pkg.Test.test_c01": "fail"},
            ["pkg.Test.test_c01"],
            ["pkg.Test.test_c01"],
        )
        self.assertEqual(verdict, "invalid")

    def test_substring_collision_does_not_kill(self):
        verdict = judge_mutation(
            {"pkg.Test.test_foo": "pass", "pkg.Test.test_foo_bar": "pass"},
            ["pkg.Test.test_foo_bar"],
            ["pkg.Test.test_foo"],
        )
        self.assertEqual(verdict, "EQUIVALENT")
        self.assertNotEqual(verdict, "RED")

    def test_exact_id_is_red(self):
        verdict = judge_mutation(
            {"pkg.Test.test_foo": "pass"},
            ["pkg.Test.test_foo"],
            ["pkg.Test.test_foo"],
        )
        self.assertEqual(verdict, "RED")


MUTATIONS = [
    ("M01", "arrival_notify.py", "def _is_unbaselined(state) -> bool:\n    return state is None\n", "def _is_unbaselined(state) -> bool:\n    return False\n", "test_arrival_notify.Cases.test_c01_baseline_only"),
    ("M02", "arrival_notify.py", "    except Exception:\n        return _hold_after_read_exception(state)\n", "    except Exception:\n        _save_state(_empty_state())\n        return _hold_after_read_exception(state)\n", "test_arrival_notify.Cases.test_c02_read_exception_holds"),
    ("M03", "arrival_notify.py", "def _empty_snapshot_untrusted(n_customers: int, n_pieces: int) -> bool:\n    return n_customers == 0 or n_pieces == 0\n", "def _empty_snapshot_untrusted(n_customers: int, n_pieces: int) -> bool:\n    return False\n", "test_arrival_notify.Cases.test_c03_zero_customers_hold"),
    ("M04", "arrival_notify.py", "def _loc_present(loc: str) -> bool:\n    return bool(str(loc or \"\").strip())\n", "def _loc_present(loc: str) -> bool:\n    return True\n", "test_arrival_notify.Cases.test_c04_loc_blank_not_ready"),
    ("M05", "arrival_notify.py", "def _unpicked(dater: str) -> bool:\n    return not str(dater or \"\").strip()\n", "def _unpicked(dater: str) -> bool:\n    return True\n", "test_arrival_notify.Cases.test_c29_picked_not_ready"),
    ("M06", "arrival_notify.py", "def _owner_known(cid: str, known_keys: set[str]) -> bool:\n    text = str(cid or \"\").strip()\n    if text.startswith(\"@@@\"):\n        return False\n    key = laundry_lookup._cid_key(text)\n    return bool(key) and key != \"0\" and key in known_keys\n", "def _owner_known(cid: str, known_keys: set[str]) -> bool:\n    return True\n", "test_arrival_notify.Cases.test_c07_owner_unknown"),
    ("M07", "arrival_notify.py", "def _method_ok(method: str) -> bool:\n    return str(method or \"\") == \"phone\"\n", "def _method_ok(method: str) -> bool:\n    return True\n", "test_arrival_notify.Cases.test_c06_customer_no_need_bind"),
    ("M08", "arrival_notify.py", "def _uid_ok(uid: str) -> bool:\n    return bool(_UID_RE.fullmatch(str(uid or \"\")))\n", "def _uid_ok(uid: str) -> bool:\n    return True\n", "test_arrival_notify.Cases.test_c30_bad_uid_need_bind"),
    ("M09", "laundry_lookup.py", "    return _method_rank(old_method) >= _method_rank(new_method)\n", "    return False\n", "test_arrival_notify.Cases.test_c23_method_kept"),
    ("M10", "laundry_lookup.py", "def _amount_column_name() -> str:\n    return \"Tpay\"\n", "def _amount_column_name() -> str:\n    return \"Price\"\n", "test_arrival_notify.Cases.test_c22_amount_tpay"),
    ("M11", "arrival_notify.py", "def _retry_key(existing: str) -> str:\n    if existing:\n        return existing\n    return str(uuid.uuid4())\n", "def _retry_key(existing: str) -> str:\n    return str(uuid.uuid4())\n", "test_arrival_notify.Cases.test_c13_retry_same_key"),
    ("M12", "arrival_notify.py", "def _retry_expired(age_seconds: float) -> bool:\n    return age_seconds >= 24 * 3600\n", "def _retry_expired(age_seconds: float) -> bool:\n    return False\n", "test_arrival_notify.Cases.test_c16_uncertain_expired"),
    ("M13", "arrival_notify.py", "    return start_m <= minute < end_m\n", "    return True\n", "test_arrival_notify.Cases.test_c10_window_taipei_22"),
    ("M14", "arrival_notify.py", "def _anomaly_tripped(new_count: int, limit: int) -> bool:\n    return new_count > limit\n", "def _anomaly_tripped(new_count: int, limit: int) -> bool:\n    return False\n", "test_arrival_notify.Cases.test_c17_anomaly_hold"),
    ("M15", "arrival_notify.py", "def _default_mode() -> str:\n    return \"off\"\n", "def _default_mode() -> str:\n    return \"on\"\n", "test_arrival_notify.Cases.test_c09_missing_config_off"),
    ("M16", "arrival_notify.py", "def _quota_allows(left, reserve) -> bool:\n    if left is None:\n        return False\n    return int(left) >= int(reserve)\n", "def _quota_allows(left, reserve) -> bool:\n    return True\n", "test_arrival_notify.Cases.test_c12_quota_hold"),
    ("M17", "arrival_notify.py", "def _still_listable(garment: dict, known_keys: set[str]) -> bool:\n    return _classify(garment, known_keys) == \"ready\"\n", "def _still_listable(garment: dict, known_keys: set[str]) -> bool:\n    return True\n", "test_arrival_notify.Cases.test_c11_picked_suppressed"),
    ("M18", "arrival_notify.py", "def _event_already_recorded(keys: set[str], key: str) -> bool:\n    return key in keys\n", "def _event_already_recorded(keys: set[str], key: str) -> bool:\n    return False\n", "test_arrival_notify.Cases.test_c18_crash_no_duplicate"),
    (
        "N01",
        "arrival_notify.py",
        "def _dispatch(state: dict, snap: Snapshot, cfg: dict, now: datetime, known: set[str]) -> dict | None:\n    retry = _retry_deliveries(state, now, cfg, snap, known)\n    fresh = _dispatch_pending(state, snap, cfg, now, known)\n    return _combine_dispatch(retry, fresh)\n",
        "def _dispatch(state: dict, snap: Snapshot, cfg: dict, now: datetime, known: set[str]) -> dict | None:\n    retry = _retry_deliveries(state, now, cfg, snap, known)\n    if retry is not None:\n        return retry\n    fresh = _dispatch_pending(state, snap, cfg, now, known)\n    return _combine_dispatch(retry, fresh)\n",
        "test_arrival_notify.Relay.test_r01_b_sent_next_cycle",
    ),
    (
        "N02",
        "arrival_notify.py",
        "        if not _token_ok():\n            codes.append(\"TOKEN_HOLD\")\n            continue\n        pending_ids = _pending_ids_for(state, delivery.get(\"customer_no\") or \"\")\n",
        "        if not _token_ok():\n            codes.append(\"TOKEN_HOLD\")\n            continue\n        if int(delivery.get(\"attempts\") or 0) >= 5:\n            codes.append(\"UNCERTAIN\")\n            continue\n        pending_ids = _pending_ids_for(state, delivery.get(\"customer_no\") or \"\")\n",
        "test_arrival_notify.Relay.test_r02_retry_same_key_without_cap",
    ),
    (
        "N03",
        "arrival_notify.py",
        "def _absorb_new_pieces(delivery: dict, pending_ids, content_changed: bool) -> bool:\n    \"\"\"內容變了就作廢這則，不把新件併進舊 donlies。回傳 True 表示應作廢。\"\"\"\n    if content_changed:\n        return True\n    delivery[\"donlies\"] = _donlies_for_open_delivery(delivery, pending_ids)\n    return False\n",
        "def _absorb_new_pieces(delivery: dict, pending_ids, content_changed: bool) -> bool:\n    \"\"\"內容變了就作廢這則，不把新件併進舊 donlies。回傳 True 表示應作廢。\"\"\"\n    delivery[\"donlies\"] = sorted(set(delivery.get(\"donlies\") or []) | set(pending_ids))\n    return False\n",
        "test_arrival_notify.Relay.test_r17_new_piece_new_message",
    ),
    (
        "N04",
        "arrival_notify.py",
        "        if int(exc.code) == 429:\n            return \"uncertain\"\n        if 400 <= int(exc.code) < 500:\n            return \"rejected\"\n",
        "        if 400 <= int(exc.code) < 500:\n            return \"rejected\"\n",
        "test_arrival_notify.Relay.test_r04_http_429_retryable",
    ),
    (
        "N05",
        "arrival_notify.py",
        "def _binding_still_matches(uid: str, customer_no: str, records: dict) -> bool:\n    row = records.get(str(uid))\n    if not isinstance(row, dict):\n        return False\n    if not _method_ok(str(row.get(\"method\") or \"\")):\n        return False\n    if not _uid_ok(str(uid)):\n        return False\n    return laundry_lookup._cid_key(_s(row.get(\"customer_no\"))) == laundry_lookup._cid_key(_s(customer_no))\n",
        "def _binding_still_matches(uid: str, customer_no: str, records: dict) -> bool:\n    return True\n",
        "test_arrival_notify.Relay.test_r05_binding_changed",
    ),
    (
        "N06",
        "arrival_notify.py",
        "        if not _uid_ok(str(uid)):\n            continue\n        if laundry_lookup._cid_key(_s(row.get(\"customer_no\"))) != want:\n            continue\n        found.append(str(uid))\n",
        "        if not _uid_ok(str(uid)):\n            continue\n        found.append(str(uid))\n",
        "test_arrival_notify.Relay.test_r06_only_owner_pushed",
    ),
    (
        "N07",
        "arrival_notify.py",
        "    mine = [g for g in garments if _same_customer(g.get(\"customer_no\"), customer_no)]\n",
        "    mine = list(garments)\n",
        "test_arrival_notify.Relay.test_r07_only_owner_content",
    ),
    (
        "N08",
        "arrival_notify.py",
        "    if _anomaly_active(state):\n        return {\"code\": \"ANOMALY_HOLD\", \"http\": 0, \"ehank_reads\": reads, \"cursor\": \"unchanged\"}\n    seen = set(prior_seen)\n",
        "    seen = set(prior_seen)\n",
        "test_arrival_notify.Relay.test_r08_anomaly_sticky",
    ),
    (
        "N09",
        "laundry_lookup.py",
        "def _atomic_bind_write(path: Path, text: str) -> None:\n    path.parent.mkdir(parents=True, exist_ok=True)\n    tmp = path.with_name(path.name + \".tmp\")\n    tmp.write_text(text, encoding=\"utf-8\")\n    os.replace(tmp, path)\n",
        "def _atomic_bind_write(path: Path, text: str) -> None:\n    path.parent.mkdir(parents=True, exist_ok=True)\n    path.write_text(text, encoding=\"utf-8\")\n",
        "test_arrival_notify.Relay.test_r09_atomic_bind_write",
    ),
    (
        "N10",
        "arrival_notify.py",
        "    except (OSError, json.JSONDecodeError, UnicodeError, ValueError):\n        return None, \"unreadable\"\n",
        "    except (OSError, json.JSONDecodeError, UnicodeError, ValueError):\n        return {}, \"ok\"\n",
        "test_arrival_notify.Relay.test_r10_bind_unreadable",
    ),
    (
        "N11",
        "arrival_notify.py",
        "            slot[\"status\"] = \"need_bind\"\n",
        "            slot[\"status\"] = \"pending\"\n",
        "test_arrival_notify.Relay.test_r11_need_bind_when_parsed",
    ),
    (
        "N12",
        "line_webhook.py",
        "    def _start_background_jobs():\n        try:\n            import arrival_notify\n\n            arrival_notify.start_poller()\n        except Exception as exc:\n            sys.stderr.write(type(exc).__name__ + \"\\n\")\n",
        "    def _start_background_jobs():\n        import arrival_notify\n\n        arrival_notify.start_poller()\n",
        "test_arrival_notify.Relay.test_r12_startup_survives",
    ),
    (
        "P01",
        "arrival_notify.py",
        "    if listed_count > 0 and still_count == 0:\n        return \"all_gone\"\n",
        "    if listed_count > 0 and still_count == 0:\n        return \"same\"\n",
        "test_arrival_notify.Relay.test_r13_all_gone_superseded",
    ),
    (
        "P02",
        "arrival_notify.py",
        "    if stored_text != fresh_text:\n        return \"changed\"\n",
        "    if False and stored_text != fresh_text:\n        return \"changed\"\n",
        "test_arrival_notify.Relay.test_r14_balance_new_message",
    ),
    (
        "P03",
        "arrival_notify.py",
        "def _requeue_listable_pieces(state: dict, donlies: list, now: datetime) -> None:\n    \"\"\"仍可取、且還沒被接受的件放回待送，保留原來的 first_seen。\"\"\"\n    for donly in donlies:\n",
        "def _requeue_listable_pieces(state: dict, donlies: list, now: datetime) -> None:\n    \"\"\"仍可取、且還沒被接受的件放回待送，保留原來的 first_seen。\"\"\"\n    return\n    for donly in donlies:\n",
        "test_arrival_notify.Relay.test_r15_requeue_still_ready",
    ),
    (
        "P04",
        "arrival_notify.py",
        "        row[\"status\"] = \"pending\"\n        row[\"first_seen\"] = row.get(\"first_seen\") or \"\"\n",
        "        row[\"status\"] = \"pending\"\n        row[\"first_seen\"] = _iso(now)\n",
        "test_arrival_notify.Relay.test_r15_requeue_still_ready",
    ),
    (
        "P05",
        "arrival_notify.py",
        "def _key_for_new_delivery(state, customer_no) -> str:\n    \"\"\"新的一則用新鍵，而且不得挑到這位客人已經 superseded 的鍵。\"\"\"\n    banned = set()\n    want = laundry_lookup._cid_key(_s(customer_no))\n    for row in (state.get(\"deliveries\") or {}).values():\n        if not isinstance(row, dict) or row.get(\"status\") != \"superseded\":\n            continue\n        if laundry_lookup._cid_key(_s(row.get(\"customer_no\"))) != want:\n            continue\n        if row.get(\"retry_key\"):\n            banned.add(str(row[\"retry_key\"]))\n    while True:\n        key = str(uuid.uuid4())\n        if key not in banned:\n            return key\n",
        "def _key_for_new_delivery(state, customer_no) -> str:\n    \"\"\"新的一則用新鍵，而且不得挑到這位客人已經 superseded 的鍵。\"\"\"\n    want = laundry_lookup._cid_key(_s(customer_no))\n    for row in (state.get(\"deliveries\") or {}).values():\n        if isinstance(row, dict) and row.get(\"status\") == \"superseded\" and laundry_lookup._cid_key(_s(row.get(\"customer_no\"))) == want and row.get(\"retry_key\"):\n            return str(row[\"retry_key\"])\n    return str(uuid.uuid4())\n",
        "test_arrival_notify.Relay.test_r14_balance_new_message",
    ),
    (
        "P06",
        "arrival_notify.py",
        "        if outcome == \"changed\":\n            if _absorb_new_pieces(delivery, pending_ids, True):\n                _supersede_because_content_changed(state, delivery, still, gone, now)\n                codes.append(\"SUPERSEDED\")\n                continue\n            still_open.append(delivery)\n            continue\n",
        "        if outcome == \"changed\":\n            delivery[\"donlies\"] = sorted(set(delivery.get(\"donlies\") or []) | set(pending_ids))\n            delivery[\"text\"] = fresh_text\n            still_open.append(delivery)\n            continue\n",
        "test_arrival_notify.Relay.test_r17_new_piece_new_message",
    ),
    (
        "P07",
        "arrival_notify.py",
        "        if not _inside_window(now, cfg[\"send_window\"]):\n            codes.append(\"WINDOW_HOLD\")\n            continue\n",
        "        if False and not _inside_window(now, cfg[\"send_window\"]):\n            codes.append(\"WINDOW_HOLD\")\n            continue\n",
        "test_arrival_notify.Relay.test_r20_window_hold",
    ),
    (
        "P08",
        "arrival_notify.py",
        "        if cfg[\"mode\"] != \"on\":\n            codes.append(\"DRY_RUN\" if cfg[\"mode\"] == \"dry_run\" else \"MODE_OFF\")\n            continue\n",
        "        if False and cfg[\"mode\"] != \"on\":\n            codes.append(\"DRY_RUN\" if cfg[\"mode\"] == \"dry_run\" else \"MODE_OFF\")\n            continue\n",
        "test_arrival_notify.Relay.test_r21_dry_run_hold",
    ),
    (
        "P09",
        "arrival_notify.py",
        "        if not _quota_allows(_quota_left_value(), cfg[\"quota_reserve\"]):\n            codes.append(\"QUOTA_HOLD\")\n            continue\n",
        "        if False and not _quota_allows(_quota_left_value(), cfg[\"quota_reserve\"]):\n            codes.append(\"QUOTA_HOLD\")\n            continue\n",
        "test_arrival_notify.Relay.test_r22_quota_hold",
    ),
    (
        "P10",
        "arrival_notify.py",
        "        if not _token_ok():\n            codes.append(\"TOKEN_HOLD\")\n            continue\n",
        "        if False and not _token_ok():\n            codes.append(\"TOKEN_HOLD\")\n            continue\n",
        "test_arrival_notify.Relay.test_r23_token_hold",
    ),
    (
        "P11",
        "arrival_notify.py",
        "        if isinstance(row, dict) and row.get(\"status\") in (\"inflight\", \"uncertain\")\n",
        "        if isinstance(row, dict) and row.get(\"status\") == \"uncertain\"\n",
        "test_arrival_notify.Relay.test_r18_inflight_resent",
    ),
    (
        "P12",
        "arrival_notify.py",
        "def _customer_blocked_by_open(state: dict, customer_no: str) -> bool:\n    want = laundry_lookup._cid_key(_s(customer_no))\n    for row in (state.get(\"deliveries\") or {}).values():\n        if not isinstance(row, dict) or row.get(\"status\") not in (\"inflight\", \"uncertain\"):\n            continue\n        if laundry_lookup._cid_key(_s(row.get(\"customer_no\"))) == want:\n            return True\n    return False\n",
        "def _customer_blocked_by_open(state: dict, customer_no: str) -> bool:\n    return False\n",
        "test_arrival_notify.Relay.test_r19_one_key_after_crash",
    ),
    (
        "P13",
        "arrival_notify.py",
        "    return age_seconds >= 24 * 3600\n",
        "    return age_seconds >= 2 * 3600\n",
        "test_arrival_notify.Relay.test_r24_uncertain_24h_boundary",
    ),
    (
        "P14",
        "arrival_notify.py",
        "        \"http\": int(retry.get(\"http\") or 0) + int(fresh.get(\"http\") or 0),\n",
        "        \"http\": int(fresh.get(\"http\") or 0),\n",
        "test_arrival_notify.Relay.test_r25_http_sum",
    ),
    (
        "P15",
        "laundry_lookup.py",
        "    with _BIND_LOCK:\n",
        "    if True:\n",
        "test_arrival_notify.Relay.test_r26_bind_locked",
    ),
    (
        "P16",
        "arrival_notify.py",
        "    if stored_text != fresh_text:\n        return \"changed\"\n    return \"same\"\n",
        "    if stored_text != fresh_text:\n        return \"changed\"\n    return \"changed\"\n",
        "test_arrival_notify.Relay.test_r16_same_key_unchanged",
    ),
    (
        "P17",
        "arrival_notify.py",
        "            _mark_pieces(state, delivery, \"accepted\")\n            cid_key = laundry_lookup._cid_key(_s(delivery.get(\"customer_no\")))\n            state.setdefault(\"last_sent\", {})[cid_key] = _iso(now)\n            codes.append(\"ACCEPTED\")\n",
        "            _mark_pieces(state, delivery, \"accepted\")\n            cid_key = laundry_lookup._cid_key(_s(delivery.get(\"customer_no\")))\n            codes.append(\"ACCEPTED\")\n",
        "test_arrival_notify.Relay.test_r16_same_key_unchanged",
    ),
    (
        "P18",
        "arrival_notify.py",
        "def _aggregate_recipient_outcomes(outcomes: list[str]) -> str:\n    \"\"\"多個帳號時，只要有一個接受，件就是 accepted。\"\"\"\n    if any(item == \"accepted\" for item in outcomes):\n        return \"accepted\"\n    if any(item == \"uncertain\" for item in outcomes):\n        return \"inflight\"\n    return \"rejected\"\n",
        "def _aggregate_recipient_outcomes(outcomes: list[str]) -> str:\n    \"\"\"多個帳號時，只要有一個接受，件就是 accepted。\"\"\"\n    last = outcomes[-1] if outcomes else \"rejected\"\n    if last == \"accepted\":\n        return \"accepted\"\n    if last == \"uncertain\":\n        return \"inflight\"\n    return \"rejected\"\n",
        "test_arrival_notify.Relay.test_r27_any_accepted",
    ),
    (
        "P19",
        "arrival_notify.py",
        "    if not isinstance(row, dict):\n        return\n    if row.get(\"status\") == \"accepted\" and status != \"accepted\":\n        return\n    row[\"status\"] = status\n",
        "    if not isinstance(row, dict):\n        return\n    row[\"status\"] = status\n",
        "test_arrival_notify.Relay.test_r28_accepted_sticky",
    ),
]


def _run_one(test_id: str) -> tuple[bool, list[str], int]:
    code = (
        "import unittest\n"
        f"suite = unittest.defaultTestLoader.loadTestsFromName({test_id!r})\n"
        "result = unittest.TextTestRunner(verbosity=1).run(suite)\n"
        "failed = [test.id() for test, _tb in list(result.failures) + list(result.errors)]\n"
        "print('FAILED_IDS=' + '|'.join(failed))\n"
        "print('RESULT_OK=' + ('1' if result.wasSuccessful() else '0'))\n"
        "print('RESULT_RAN=' + str(result.testsRun))\n"
    )
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    failed = []
    ok = False
    ran = 0
    for line in (proc.stdout or "").splitlines():
        if line.startswith("FAILED_IDS="):
            body = line.split("=", 1)[1]
            failed = [part for part in body.split("|") if part]
        elif line.startswith("RESULT_OK="):
            ok = line.endswith("1")
        elif line.startswith("RESULT_RAN="):
            ran = int(line.split("=", 1)[1])
    if proc.returncode != 0 and not ok and ran == 0:
        ok = False
    return ok, failed, ran


def audit_mutations() -> int:
    originals = {}
    problems = 0
    for mid, filename, old, new, test_id in MUTATIONS:
        path = ROOT / filename
        originals.setdefault(filename, path.read_bytes())
        text = path.read_text(encoding="utf-8")
        if text.count(old) != 1:
            print(f"WITNESS_CLEAN| {mid} | ran=0 ok=false | pattern-not-unique")
            print(f"MUTATION| {mid} | INVALID | pattern-not-unique | ")
            problems += 1
            continue
        ok, failed, ran = _run_one(test_id)
        clean_pass = ok and ran == 1 and not failed
        print(f"WITNESS_CLEAN| {mid} | ran={ran} ok={'true' if clean_pass else 'false'} | {'' if clean_pass else '|'.join(failed) or 'not-green'}")
        if not clean_pass:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            print(f"MUTATION| {mid} | INVALID | clean-witness-failed | {digest}")
            problems += 1
            continue
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
        try:
            ok2, failed2, _ran2 = _run_one(test_id)
        finally:
            path.write_bytes(originals[filename])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        verdict = judge_mutation({test_id: "pass"}, failed2, [test_id])
        if verdict != "RED":
            problems += 1
        print(f"MUTATION| {mid} | {verdict} | {'|'.join(failed2) or '-'} | {digest}")
        if hashlib.sha256(originals[filename]).hexdigest() != digest:
            print(f"RESTORE_MISMATCH| {mid}")
            problems += 1
    return 1 if problems else 0


def run_suite() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    skipped = len(getattr(result, "skipped", []))
    failed = len(result.failures) + len(result.errors)
    passed = result.testsRun - failed - skipped
    print(f"collected={result.testsRun} passed={passed} failed={failed} skipped={skipped}")
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    if "--audit-mutations" in sys.argv:
        sys.exit(audit_mutations())
    sys.exit(run_suite())
