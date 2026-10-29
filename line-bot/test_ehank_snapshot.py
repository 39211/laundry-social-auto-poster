# -*- coding: utf-8 -*-
import os
import sys
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_line_flows as flows
import laundry_lookup as L


def test_unconnected_snapshot_fails_closed():
    os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
    with patch.object(L, "_from_ehank", return_value=([], [])), patch.object(L, "db_path", return_value=None):
        cust, pieces, source = L.inventory()
    assert source == "none", source
    assert cust == []
    assert pieces == []


def test_ehank_adapter_wires_full_phone_and_wash_no():
    os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
    with patch.object(
        L,
        "_from_ehank",
        return_value=(
            [{"no": "C100", "name": "測試客", "phone": "0912345678", "balance": -180}],
            [
                {"id": "D1", "customer_no": "C100", "wash_no": "W1001", "name": "襯衫", "status": "stock", "price": 70},
                {"id": "D2", "customer_no": "C100", "wash_no": "W1002", "name": "外套", "status": "wash", "price": 180},
            ],
        ),
    ), patch.object(L, "db_path", return_value=None):
        row = L.lookup("0912345678")
        assert row.source == "ehank-mdb"
        assert row.customer_no == "C100"
        assert row.balance == -180
        assert row.total_price == 250
        assert "襯衫（W1001）｜70 元" in L.guest_copy(row)
        assert "品項合計：250 元" in L.guest_copy(row)
        assert "尚欠款 180 元" in L.guest_copy(row)
        assert L.guest_ready_flag(row) == "mixed"
        assert L.lookup("W1001").customer_no == "C100"
        assert not L.lookup("5678").found


def test_customer_balance_copy_zero_and_credit():
    zero = L.Lookup(
        query="0912345678",
        customer_no="C100",
        source="ehank-mdb",
        balance=0,
        pieces=[L.Piece("W1001", "襯衫", "stock", "C100", 70)],
    )
    assert "餘額 0 元" in L.guest_copy(zero)

    credit = L.Lookup(
        query="0912345678",
        customer_no="C100",
        source="ehank-mdb",
        balance=500,
        pieces=[L.Piece("W1001", "襯衫", "stock", "C100", 70)],
    )
    assert "帳戶餘額：500 元" in L.guest_copy(credit)


def test_unconnected_copy():
    os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
    with patch.object(L, "_from_ehank", return_value=([], [])), patch.object(L, "db_path", return_value=None):
        row = L.lookup("000000")
    assert not row.found
    assert "正本" in L.guest_copy(row)


if __name__ == "__main__":
    flows.install_isolation(fixture=False)
    test_unconnected_snapshot_fails_closed()
    test_ehank_adapter_wires_full_phone_and_wash_no()
    test_unconnected_copy()
    print("PASS", 3)
