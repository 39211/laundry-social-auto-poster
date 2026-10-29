from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import patch_shop_json
from product_catalog import (
    DEFAULT_MODULES,
    DEFAULT_STYLE,
    MODULE_CATALOG,
    STYLE_CATALOG,
    catalog_payload,
    default_product,
    selection_report,
    validate_product,
)
from shop_config import ShopConfig


class ProductCatalogTests(unittest.TestCase):
    def test_catalog_has_multiple_modules_and_styles(self) -> None:
        payload = catalog_payload()
        self.assertGreaterEqual(len(payload["modules"]), 8)
        self.assertGreaterEqual(len(payload["styles"]), 5)
        self.assertEqual(list(DEFAULT_MODULES), payload["default"]["modules"])
        self.assertEqual(DEFAULT_STYLE, payload["default"]["style"])

    def test_default_selection_is_structurally_valid(self) -> None:
        self.assertEqual([], validate_product(default_product(), payment_mode="disabled"))

    def test_dependencies_and_payment_mode_are_fail_closed(self) -> None:
        missing_staff = {
            "plan": "custom",
            "style": DEFAULT_STYLE,
            "modules": ["brand_oa", "progress_lookup"],
        }
        errors = validate_product(missing_staff, payment_mode="disabled")
        self.assertTrue(any("staff_handoff" in item for item in errors))

        wrong_payment = {
            "plan": "growth",
            "style": DEFAULT_STYLE,
            "modules": [*DEFAULT_MODULES, "line_pay_qr"],
        }
        errors = validate_product(wrong_payment, payment_mode="disabled")
        self.assertTrue(any("merchant_qr" in item for item in errors))

    def test_unknown_style_and_module_are_rejected(self) -> None:
        selection = {
            "plan": "custom",
            "style": "made_up_style",
            "modules": ["brand_oa", "made_up_module"],
        }
        errors = validate_product(selection)
        self.assertTrue(any("style" in item for item in errors))
        self.assertTrue(any("made_up_module" in item for item in errors))

    def test_selection_report_exposes_setup_without_claiming_delivery(self) -> None:
        report = selection_report(default_product(), shop_data={
            "lookup": {"mode": "manual"},
            "vision": {"enabled": False},
            "payment": {"mode": "disabled"},
        })
        self.assertTrue(report["selection_valid"])
        self.assertIn("note", report)
        lookup = next(item for item in report["modules"] if item["key"] == "progress_lookup")
        self.assertEqual("needs_setup", lookup["state"])

    def test_patch_product_selection_preserves_unrelated_config(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            work = Path(raw)
            path = work / "shop.json"
            data = json.loads((ROOT / "config" / "shop.template.json").read_text(encoding="utf-8"))
            original_hours = data["hours"]
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            patch_shop_json.patch_shop(
                path,
                product={
                    "plan": "custom",
                    "style": "clean_teal",
                    "modules": ["brand_oa", "human_faq", "staff_handoff"],
                },
                validate=True,
            )
            updated = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual("clean_teal", updated["product"]["style"])
            self.assertEqual(original_hours, updated["hours"])
            self.assertEqual([], ShopConfig.load(path).validate())


if __name__ == "__main__":
    unittest.main()
