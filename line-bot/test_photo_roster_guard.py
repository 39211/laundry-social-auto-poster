# -*- coding: utf-8 -*-
"""Photo recognition precision (11/06): luxury-roster guard, shoe-pair prompt rules, optional thinking budget.

Run this file in its own Python process. No real network, no production writes.
"""
import json
import os
import re
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
TEMP = Path(tempfile.mkdtemp(prefix="sxj-roster-guard-")).resolve()
os.environ["LAUNDRY_VISION_USAGE_DIR"] = str(TEMP / "vision-usage")
os.environ["LAUNDRY_PHOTO_ESTIMATE"] = "0"
urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(AssertionError("unmocked network"))
sys.path.insert(0, str(ROOT))
import photo_estimate as pe

NAMES = {"名牌鞋", "名牌包", "特殊類名牌包", "一般運動鞋", "皮類運動鞋", "皮鞋", "一般包", "背包", "皮包包", "短皮夾", "精品外套", "厚外套"}


def item(name, brand="", quantity=1, certainty="clear", reason="x", label="物件"):
    return {"name": name, "label": label, "quantity": quantity, "certainty": certainty, "reason": reason,
            "brand": brand, "model": "", "material": "", "color": "", "stain": "", "craft": "", "question": ""}


class Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, *args):
        return json.dumps(self.body).encode()


class BrandMatchTests(unittest.TestCase):
    def test_roster_brands_match_in_spellings_the_model_uses(self):
        for brand in ["Gucci", "GUCCI", "Louis Vuitton", "LV", "lv", "路易威登", "Hermès", "Canada Goose", "Golden Goose",
                      "Christian Dior", "Dior", "Chloé", "MCM", "Tod's", "Arc'teryx Veilance", "Van Cleef & Arpels", "Off-White"]:
            self.assertTrue(pe.roster_brand(brand), brand)

    def test_non_roster_brands_and_junk_do_not_match(self):
        for brand in ["Longchamp", "Coach", "Nike", "New Balance", "Puma", "Victorinox", "Michael Kors", "LVMH", "Wolverine",
                      "MCMXX", "", "   ", None, 123]:
            self.assertEqual(pe.roster_brand(brand), "", repr(brand))

    def test_roster_covers_every_english_brand_in_the_owners_file(self):
        text = (ROOT.parent / "shop-pc" / "fxwash" / "config" / "Memory.md").read_text(encoding="utf-8")
        section = text.split("### 1. 國際精品奢牌名冊", 1)[1].split("### 2.", 1)[0]
        seen = []
        for line in section.splitlines():
            if not line.startswith("- **") or "**：" not in line:
                continue
            for piece in line.split("**：", 1)[1].split(","):
                piece = re.sub(r"\([^)]*\)", "", piece)
                for name in piece.split("/"):
                    name = name.strip()
                    if re.match(r"[A-Za-z]", name):
                        seen.append(name)
        self.assertGreaterEqual(len(seen), 45)
        missing = [name for name in seen if not pe.roster_brand(name)]
        self.assertEqual(missing, [], "roster brands in Memory.md that the guard does not know")


class GuardTests(unittest.TestCase):
    def test_luxury_class_with_non_roster_brand_is_not_a_firm_price(self):
        for name in ("名牌包", "特殊類名牌包", "名牌鞋"):
            row = pe.apply_roster_guard([item(name, "Longchamp", certainty="clear")], NAMES)[0]
            self.assertEqual(row["certainty"], "uncertain", name)
            self.assertIn("品牌不在精品名冊", row["reason"])
            self.assertEqual((row["name"], row["quantity"], row["brand"]), (name, 1, "Longchamp"))

    def test_luxury_class_without_any_brand_is_not_a_firm_price(self):
        row = pe.apply_roster_guard([item("名牌鞋", "", certainty="estimated")], NAMES)[0]
        self.assertEqual(row["certainty"], "uncertain")

    def test_luxury_class_with_roster_brand_is_left_alone(self):
        before = item("名牌包", "Louis Vuitton", certainty="clear", reason="看到老花")
        self.assertEqual(pe.apply_roster_guard([before], NAMES), [before])

    def test_roster_brand_shoe_in_a_plain_class_becomes_名牌鞋(self):
        row = pe.apply_roster_guard([item("一般運動鞋", "Gucci", quantity=1, certainty="clear")], NAMES)[0]
        self.assertEqual((row["name"], row["quantity"], row["certainty"]), ("名牌鞋", 1, "estimated"))
        self.assertIn("名牌鞋", row["reason"])
        row = pe.apply_roster_guard([item("皮鞋", "Balenciaga", certainty="estimated")], NAMES)[0]
        self.assertEqual((row["name"], row["certainty"]), ("名牌鞋", "estimated"))

    def test_reclassed_row_that_was_uncertain_stays_uncertain(self):
        row = pe.apply_roster_guard([item("一般運動鞋", "Gucci", quantity=None, certainty="uncertain")], NAMES)[0]
        self.assertEqual((row["name"], row["certainty"], row["quantity"]), ("名牌鞋", "uncertain", None))

    def test_no_reclass_when_the_catalogue_has_no_名牌鞋(self):
        names = NAMES - {"名牌鞋"}
        row = pe.apply_roster_guard([item("一般運動鞋", "Gucci")], names)[0]
        self.assertEqual((row["name"], row["certainty"]), ("一般運動鞋", "clear"))

    def test_roster_brand_bag_in_a_plain_class_becomes_名牌包(self):
        for plain, brand in (("一般包", "LV"), ("背包", "Hermès"), ("皮包包", "Prada")):
            row = pe.apply_roster_guard([item(plain, brand)], NAMES)[0]
            self.assertEqual((row["name"], row["certainty"]), ("名牌包", "estimated"), plain)

    def test_non_roster_brand_in_a_plain_class_is_left_alone(self):
        for before in (item("背包", "Longchamp"), item("一般運動鞋", "Nike"), item("皮鞋", "")):
            self.assertEqual(pe.apply_roster_guard([before], NAMES), [before])

    def test_scope_is_shoes_and_bags_only(self):
        for before in (item("短皮夾", "Gucci"), item("精品外套", ""), item("厚外套", "Moncler"), item("", "Gucci", quantity=None, certainty="uncertain")):
            self.assertEqual(pe.apply_roster_guard([before], NAMES), [before])

    def test_input_rows_are_not_mutated(self):
        rows = [item("一般運動鞋", "Gucci"), item("名牌包", "Longchamp")]
        snapshot = json.loads(json.dumps(rows))
        pe.apply_roster_guard(rows, NAMES)
        self.assertEqual(rows, snapshot)

    def test_renamed_rows_are_merged_with_same_named_rows(self):
        rows = [item("一般運動鞋", "Gucci", quantity=1), item("名牌鞋", "Gucci", quantity=1)]
        out = pe.apply_roster_guard(rows, NAMES)
        self.assertEqual([(r["name"], r["quantity"]) for r in out], [("名牌鞋", 2)])


class PipelineTests(unittest.TestCase):
    def run_inventory(self, rows, env=None):
        body = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({"items": rows})}]}}]}
        settings = {"GEMINI_API_KEY": "synthetic-key", "LAUNDRY_PHOTO_ESTIMATE": "1", "LAUNDRY_VISION_MODEL": "gemini-2.5-flash"}
        settings.update(env or {})
        with patch.dict(os.environ, settings), \
             patch.object(pe.urllib.request, "urlopen", side_effect=[Response(body)]) as request, \
             patch.object(pe.time, "sleep"):
            result = pe.inventory([ROOT / "test-assets" / "estimate-items-synthetic.png"], sorted(NAMES))
        return result, request

    def test_inventory_applies_the_guard_to_the_model_answer(self):
        result, _ = self.run_inventory([item("名牌包", "Longchamp"), item("一般運動鞋", "Gucci", quantity=1)])
        self.assertTrue(result["ok"])
        by = {r["name"]: r for r in result["items"]}
        self.assertEqual(by["名牌包"]["certainty"], "uncertain")
        self.assertEqual(by["名牌鞋"]["certainty"], "estimated")
        self.assertNotIn("一般運動鞋", by)


class PromptAndBudgetTests(unittest.TestCase):
    def test_prompt_states_the_pair_rule_the_edge_rule_the_roster_rule_and_the_evidence_rubric(self):
        prompt = pe.build_prompt(sorted(NAMES))
        self.assertIn("先數出完整看得到的單隻，再除以 2 換成雙數", prompt)
        self.assertIn("一雙鞋 quantity 是 1，不是 2", prompt)
        self.assertIn("被照片邊緣截斷的物件", prompt)
        self.assertIn("只有 brand 屬於後面【國際精品奢牌名冊】時才可選", prompt)
        self.assertIn("品類、數量（鞋以雙計）、品牌", prompt)
        self.assertIn("也不可在關鍵資訊看不到時用 clear", prompt)

    def test_plain_json_format_asks_for_the_evidence_before_the_decision(self):
        fmt = pe.FALLBACK_FORMAT
        self.assertLess(fmt.index('"reason"'), fmt.index('"name"'))
        self.assertLess(fmt.index('"reason"'), fmt.index('"quantity"'))
        self.assertLess(fmt.index('"quantity"'), fmt.index('"certainty"'))

    def test_thinking_budget_defaults_to_off_and_only_accepts_a_small_integer(self):
        for raw, want in ((None, 0), ("", 0), ("0", 0), ("512", 512), ("2048", 2048), ("2049", 0), ("-1", 0), ("abc", 0), ("1e3", 0)):
            env = {k: v for k, v in os.environ.items() if k != "LAUNDRY_VISION_THINKING_BUDGET"}
            if raw is not None:
                env["LAUNDRY_VISION_THINKING_BUDGET"] = raw
            with patch.dict(os.environ, env, clear=True):
                self.assertEqual(pe.thinking_budget(), want, raw)

    def test_budget_reaches_the_request_for_flash_but_never_for_flash_lite(self):
        result, request = PipelineTests().run_inventory([item("一般運動鞋", "Nike")], env={"LAUNDRY_VISION_THINKING_BUDGET": "512"})
        self.assertTrue(result["ok"])
        sent = json.loads(request.call_args_list[0].args[0].data)["generationConfig"]
        self.assertEqual(sent["thinkingConfig"], {"thinkingBudget": 512})
        # Owner 11/10: never Lite. A pinned flash-lite is refused outright, so no request is sent at all.
        result, request = PipelineTests().run_inventory([item("一般運動鞋", "Nike")],
                                                        env={"LAUNDRY_VISION_THINKING_BUDGET": "512", "LAUNDRY_VISION_MODEL": "gemini-2.5-flash-lite"})
        self.assertEqual(result, {"ok": False, "error": "invalid_model"})
        self.assertEqual(request.call_args_list, [])


if __name__ == "__main__":
    unittest.main()
