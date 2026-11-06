# -*- coding: utf-8 -*-
"""Owner 11/06: bags up to about NT$20-30k are ordinary bag classes (皮包包 / 布混包 / 全布包 / 背包); only roster brands are 名牌包.

The model sometimes files a non-roster brand (Longchamp, Coach, TUMI...) under 名牌包. The guard now moves it to the ordinary
class that matches the material the model itself reported, and falls back to "uncertain" when the material says nothing.
Run this file in its own Python process. No real network, no production writes.
"""
import json
import os
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
TEMP = Path(tempfile.mkdtemp(prefix="sxj-plain-bag-")).resolve()
os.environ["LAUNDRY_VISION_USAGE_DIR"] = str(TEMP / "vision-usage")
os.environ["LAUNDRY_PHOTO_ESTIMATE"] = "0"
urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(AssertionError("unmocked network"))
sys.path.insert(0, str(ROOT))
import photo_estimate as pe

NAMES = {"名牌鞋", "名牌包", "特殊類名牌包", "一般包", "皮包包", "背包", "全布包", "布混包", "大書包", "一般運動鞋", "皮鞋"}


def bag(name="名牌包", brand="Longchamp", material="尼龍", label="黑色包", certainty="clear", quantity=1, reason="x"):
    return {"name": name, "label": label, "quantity": quantity, "certainty": certainty, "reason": reason, "brand": brand,
            "model": "", "material": material, "color": "", "stain": "", "craft": "", "question": ""}


def guard(*rows, names=NAMES):
    return pe.apply_roster_guard(list(rows), set(names))


class PlainBagTests(unittest.TestCase):
    def test_non_roster_nylon_bag_becomes_全布包_and_keeps_brand_and_count(self):
        row = guard(bag(material="尼龍"))[0]
        self.assertEqual((row["name"], row["certainty"], row["quantity"], row["brand"]), ("全布包", "estimated", 1, "Longchamp"))
        self.assertIn("品牌不在精品名冊", row["reason"])

    def test_material_picks_the_ordinary_class(self):
        for material, want in (("尼龍", "全布包"), ("帆布", "全布包"), ("棉布", "全布包"), ("牛皮", "皮包包"), ("真皮", "皮包包"),
                               ("PU皮", "皮包包"), ("皮革、布", "布混包"), ("帆布拼皮革", "布混包"), ("尼龍、皮革", "布混包")):
            with self.subTest(material=material):
                self.assertEqual(guard(bag(material=material))[0]["name"], want)

    def test_backpacks_become_背包(self):
        for label in ("黑色後背包", "尼龍背包"):
            with self.subTest(label=label):
                self.assertEqual(guard(bag(material="尼龍", label=label))[0]["name"], "背包")

    def test_special_luxury_class_is_treated_the_same(self):
        self.assertEqual(guard(bag(name="特殊類名牌包", material="牛皮"))[0]["name"], "皮包包")

    def test_no_material_evidence_stays_uncertain_luxury(self):
        for material in ("", "不明", "金屬"):
            with self.subTest(material=material):
                row = guard(bag(material=material))[0]
                self.assertEqual((row["name"], row["certainty"]), ("名牌包", "uncertain"))
                self.assertIn("品牌不在精品名冊", row["reason"])

    def test_missing_catalogue_class_falls_back_to_uncertain(self):
        row = guard(bag(material="尼龍"), names=NAMES - {"全布包"})[0]
        self.assertEqual((row["name"], row["certainty"]), ("名牌包", "uncertain"))

    def test_roster_brand_is_left_alone(self):
        before = bag(brand="Louis Vuitton", material="帆布", certainty="clear")
        self.assertEqual(guard(before), [before])

    def test_model_hedge_is_kept_and_clear_is_lowered(self):
        self.assertEqual(guard(bag(certainty="clear"))[0]["certainty"], "estimated")
        self.assertEqual(guard(bag(certainty="estimated"))[0]["certainty"], "estimated")
        self.assertEqual(guard(bag(certainty="uncertain"))[0]["certainty"], "uncertain")

    def test_unknown_count_stays_unknown(self):
        row = guard(bag(quantity=None, certainty="uncertain"))[0]
        self.assertEqual((row["name"], row["quantity"], row["certainty"]), ("全布包", None, "uncertain"))

    def test_shoes_are_not_affected(self):
        row = guard(bag(name="名牌鞋", brand="Coach", material="皮革"))[0]
        self.assertEqual((row["name"], row["certainty"]), ("名牌鞋", "uncertain"))

    def test_two_rows_that_land_in_the_same_class_are_merged(self):
        out = guard(bag(material="尼龍", quantity=1), bag(name="全布包", brand="Longchamp", material="尼龍", quantity=1, certainty="estimated"))
        self.assertEqual([(r["name"], r["quantity"]) for r in out], [("全布包", 2)])

    def test_input_rows_are_not_changed(self):
        rows = [bag(material="尼龍")]
        snapshot = json.loads(json.dumps(rows))
        guard(*rows)
        self.assertEqual(rows, snapshot)


class PipelineTests(unittest.TestCase):
    def test_inventory_moves_a_longchamp_nylon_backpack_out_of_名牌包(self):
        rows = [bag(material="尼龍", label="黑色後背包")]
        body = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({"items": rows})}]}}]}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, *args):
                return json.dumps(body).encode()

        settings = {"GEMINI_API_KEY": "synthetic-key", "LAUNDRY_PHOTO_ESTIMATE": "1", "LAUNDRY_VISION_MODEL": "gemini-2.5-flash"}
        with patch.dict(os.environ, settings), \
             patch.object(pe.urllib.request, "urlopen", side_effect=[Response()]), \
             patch.object(pe.time, "sleep"):
            result = pe.inventory([ROOT / "test-assets" / "estimate-items-synthetic.png"], sorted(NAMES))
        self.assertTrue(result["ok"])
        item = result["items"][0]
        self.assertEqual((item["name"], item["certainty"], item["brand"]), ("背包", "estimated", "Longchamp"))


if __name__ == "__main__":
    unittest.main()
