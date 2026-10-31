# -*- coding: utf-8 -*-
"""現役修復：群組沒送到不標已通知。不碰正式 data、不發網路。

10/31 店主要求照片報價要跟店機一樣明確(V1):高價品項不再一律降成區間;
模型看得清楚(clear)就報那一列的價目,看不清楚(uncertain)才給區間。"""
from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path

os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
os.environ["LAUNDRY_PHOTO_ESTIMATE"] = "0"


def _no_net(*_a, **_k):
    raise RuntimeError("network disabled")


urllib.request.urlopen = _no_net
sys.path.insert(0, str(Path(__file__).resolve().parent))

import conversation as conv  # noqa: E402
import photo_estimate as pe  # noqa: E402


def test_staff_push_requires_group_delivery():
    conv._pack._npush = 0
    assert conv._accept_staff_push({"saved": True, "notified": False}) is False
    assert conv._pack._npush == 0
    assert conv._accept_staff_push({"saved": True, "notified": None}) is False
    assert conv._pack._npush == 0
    assert conv._accept_staff_push({"saved": True, "notified": True}) is True
    assert conv._pack._npush == 1


def _row(name, certainty):
    return {"name": name, "label": name, "quantity": 1, "certainty": certainty, "reason": "清楚",
            "brand": "", "model": "", "material": "", "color": "", "stain": "", "craft": "", "question": ""}


def test_high_price_photo_names_keep_model_certainty():
    names = {"皮鞋", "名牌鞋", "高跟鞋", "精品長大衣", "特殊皮衣", "特殊類名牌包", "襯衫"}
    for name in ("皮鞋", "名牌鞋", "高跟鞋", "精品長大衣", "特殊皮衣", "特殊類名牌包"):
        for certainty in ("clear", "estimated", "uncertain"):
            rows = pe.validate_result({"items": [_row(name, certainty)]}, names)
            assert rows[0]["certainty"] == certainty, (name, certainty, rows)
            assert rows[0]["name"] == name


if __name__ == "__main__":
    test_staff_push_requires_group_delivery()
    test_high_price_photo_names_keep_model_certainty()
    print("ok")
