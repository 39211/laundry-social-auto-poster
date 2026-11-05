# -*- coding: utf-8 -*-
"""R-1105d F2-F6: photo text scrub keeps honest hedges/materials, drops all turnaround forms;
glued apparel sizes (3XL) are not counts. No network, no files, no real data."""
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import estimate  # noqa: E402
import photo_estimate  # noqa: E402


def _conversation_stub():
    stub = types.ModuleType("conversation")
    stub.PRICE_LABELS = {}
    stub.PRICE_BASIS = "off"
    stub.lookup_item = lambda name: None
    return stub


class GluedApparelSize(unittest.TestCase):
    PRICES = {"衣物": {"棉T": 150}}

    def setUp(self):
        patcher = mock.patch.dict(sys.modules, {"conversation": _conversation_stub()})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_3xl_is_size_not_count(self):
        draft = estimate.update("棉T 3XL 2件", None, self.PRICES)
        self.assertEqual([x["name"] for x in draft["lines"]], ["棉T"])
        self.assertEqual(draft["lines"][0]["quantity"], 2)
        self.assertEqual(draft["total"], 300)


def _scrub(**fields):
    row = {"name": "襯衫", "label": "白襯衫", "quantity": 1, "certainty": "clear", "reason": ""}
    row.update({field: "" for field in photo_estimate.PHOTO_TEXT_FIELDS})
    row.update(fields)
    return photo_estimate.validate_result({"items": [row]}, {"襯衫"})[0]


class PhotoTextScrub(unittest.TestCase):
    def test_honest_hedges_kept(self):
        self.assertEqual(_scrub(craft="黃斑無法保證完全去除")["craft"], "黃斑無法保證完全去除")
        self.assertEqual(_scrub(craft="不能百分之百去除")["craft"], "不能百分之百去除")
        self.assertEqual(_scrub(craft="能改善到一定程度")["craft"], "能改善到一定程度")
        self.assertEqual(_scrub(stain="鞋口四週脫膠")["stain"], "鞋口四週脫膠")

    def test_material_composition_kept(self):
        self.assertEqual(_scrub(material="棉100%")["material"], "棉100%")
        self.assertEqual(_scrub(material="100%羊毛")["material"], "100%羊毛")

    def test_other_turnaround_forms_and_promises_dropped(self):
        self.assertEqual(_scrub(question="大約兩周可以拿嗎")["question"], "")
        self.assertEqual(_scrub(craft="皮件約一個月完成")["craft"], "")
        self.assertEqual(_scrub(craft="下週就能取件")["craft"], "")
        self.assertEqual(_scrub(craft="100%會洗乾淨")["craft"], "")
        self.assertEqual(_scrub(craft="會先局部去漬，大約兩周完成")["craft"], "會先局部去漬")


if __name__ == "__main__":
    unittest.main()
