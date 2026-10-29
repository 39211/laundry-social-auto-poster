# -*- coding: utf-8 -*-
"""P1 客人地址／電話記憶。測試只用暫存目錄。"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import customer_profile as cprof


def _tmp():
    p = Path(tempfile.mkdtemp(prefix="sxj-prof-")) / "line-customer-profile.json"
    cprof.PROFILE_PATH = p
    return p


def test_missing_is_empty():
    p = _tmp()
    assert cprof.load() == {}
    assert cprof.get("U1") == {}
    assert not p.exists()


def test_corrupt_and_nondict():
    p = _tmp()
    p.write_text("{not json", encoding="utf-8")
    assert cprof.load() == {}
    p.write_text("[]", encoding="utf-8")
    assert cprof.load() == {}
    p.write_text("null", encoding="utf-8")
    assert cprof.load() == {}
    p.write_text('"str"', encoding="utf-8")
    assert cprof.load() == {}


def test_upsert_phone_address():
    p = _tmp()
    cprof.upsert("Uabc", phone="0912345678", address="台中市西屯區青海路二段365號")
    row = cprof.get("Uabc")
    assert row["phone"] == "0912345678"
    assert "青海路" in row["address"]
    assert row.get("updated")
    data = json.loads(p.read_text(encoding="utf-8"))
    assert "Uabc" in data


def test_upsert_merges():
    _tmp()
    cprof.upsert("Uabc", phone="0912345678")
    cprof.upsert("Uabc", address="河南路一段1號")
    row = cprof.get("Uabc")
    assert row["phone"] == "0912345678"
    assert row["address"] == "河南路一段1號"


def test_mask_phone():
    assert cprof.mask_phone("0912345678") == "09xx-xxx-678"
    assert cprof.mask_phone("0912-345-678") == "09xx-xxx-678"
    assert cprof.mask_phone("") == "09xx-xxx-xxx"


def test_get_bad_row():
    p = _tmp()
    p.write_text(json.dumps({"Uabc": "nope"}), encoding="utf-8")
    assert cprof.get("Uabc") == {}


if __name__ == "__main__":
    test_missing_is_empty()
    test_corrupt_and_nondict()
    test_upsert_phone_address()
    test_upsert_merges()
    test_mask_phone()
    test_get_bad_row()
    print("PASS", 6)
