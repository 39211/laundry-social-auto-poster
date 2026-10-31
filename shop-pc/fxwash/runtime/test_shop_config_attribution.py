"""B2c: shop.json may carry the optional top-level "attribution" object.

10/31 14:04 the webhook stopped at load_shop() with "unsupported top-level field: attribution".
These checks use the shop's own shop.json (read only; nothing is written) so they hold on the
ai repo snapshot and on the shop PC alike.
"""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import shop_config  # noqa: E402

ATTR = {"enabled": True, "secret_path": "secrets/attribution_hmac.key",
        "registry_path": "data/attribution/source-codes.json"}


def _errors_with(extra: dict) -> list:
    base = shop_config.ShopConfig.load(ROOT / "shop.json")
    data = copy.deepcopy(base.data)
    data.update(extra)
    return shop_config.ShopConfig(base.path, data).validate()


class ShopConfigAttributionTest(unittest.TestCase):
    def setUp(self):
        self.baseline = _errors_with({})

    def test_attribution_key_adds_no_error(self):
        self.assertEqual(_errors_with({"attribution": copy.deepcopy(ATTR)}), self.baseline)

    def test_attribution_is_optional(self):
        self.assertIn("attribution", shop_config.OPTIONAL_TOP_LEVEL)
        self.assertNotIn("attribution", shop_config.REQUIRED_TOP_LEVEL)
        base = shop_config.ShopConfig.load(ROOT / "shop.json")
        data = copy.deepcopy(base.data)
        data.pop("attribution", None)
        self.assertEqual(shop_config.ShopConfig(base.path, data).validate(), self.baseline)

    def test_other_unknown_keys_still_rejected(self):
        errors = _errors_with({"attributionx": {}, "foo": 1})
        joined = "".join(errors)
        self.assertIn("attributionx", joined)
        self.assertIn("foo", joined)
        self.assertGreater(len(errors), len(self.baseline))

    def test_disabled_or_odd_attribution_values_do_not_stop_startup(self):
        for value in ({"enabled": False}, {}, None, "off"):
            with self.subTest(value=value):
                self.assertEqual(_errors_with({"attribution": value}), self.baseline)


if __name__ == "__main__":
    unittest.main()
