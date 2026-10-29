# -*- coding: utf-8 -*-
"""eHank 價目對齊。期望數字寫死自契約，不由被測程式計算。"""
from __future__ import annotations

import copy
import hashlib
import inspect
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SANDBOX = ROOT / "_sandbox_repo"
NO_EHANK = str(SANDBOX / "no-ehank")
PY = r"C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe"

os.environ["LAUNDRY_REPO_ROOT"] = str(SANDBOX)
os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
os.environ["LAUNDRY_EHANK_ROOT"] = NO_EHANK

import conversation as conv  # noqa: E402
import ehank_prices  # noqa: E402
import estimate  # noqa: E402

# 總指揮從快照獨立算好的數字。測試只準寫死，不准再算一次。
DEFAULT_MODE_PRICES = {
    "毛衣": (180, "乾洗"),
    "皮帶": (400, "14天"),
    "全布包": (500, "10天"),
    "床組四件套": (350, ""),
    "精品毛衣": (210, "乾洗"),
    "襯衫": (70, ""),
    "一般運動鞋": (250, ""),
}
WATER_PRICES = {
    "毛衣": (150, ""),
    "皮帶": (300, ""),
    "全布包": (600, ""),
    "精品毛衣": (210, "乾洗"),
    "襯衫": (70, ""),
}
KEPT_PRICES = {
    "一般包": 600,
    "睡袋": 250,
    "羽絨睡袋": 200,
    "旗袍": 200,
    "褶裙": 100,
    "護士服": 80,
    "休閒鞋": 350,
    "高爾夫球鞋": 150,
}
REPORT_DEFAULT = (16, 14, 10)
REPORT_WATER = (11, 2, 10)
DCO_SQL = "SELECT Dname, M1, M2, M3, m4, m5, m6, m7, m8, DefMode FROM Dco"
CPY_SQL = "SELECT Mode1, Mode2, Mode3, Mode4, Mode5, Mode6, Mode7, Mode8 FROM Cpy"
REFUSAL = "洗法另計，不能直接套用一般水洗價"

SNAPSHOT = json.loads((SANDBOX / "data" / "dco-snapshot.json").read_text(encoding="utf-8"))


def _base_prices():
    return json.loads((SANDBOX / "data" / "prices.json").read_text(encoding="utf-8"))


def _item(prices, name):
    for rows in prices.values():
        if isinstance(rows, dict) and name in rows:
            return rows[name]
    raise AssertionError(name)


def _dco_rows():
    rows = []
    for item in SNAPSHOT["dco"]:
        prices = item["M"]
        rows.append((item["Dname"], *prices[:8], item["DefMode"]))
    return rows


def _cpy_rows():
    return [tuple(SNAPSHOT["modes"][:8])]


def _install(result):
    conv.PRICES.clear()
    conv.PRICES.update(result.prices)
    conv.PRICE_LABELS.clear()
    conv.PRICE_LABELS.update(result.labels)
    conv.PRICE_BASIS = result.basis
    conv.CATS.clear()
    conv.CATS.update({k: v for k, v in conv.PRICES.items() if isinstance(v, dict)})


def _reset_catalog():
    fresh = _base_prices()
    conv.PRICES.clear()
    conv.PRICES.update(fresh)
    conv.PRICE_LABELS.clear()
    conv.PRICE_BASIS = "off"
    conv.CATS.clear()
    conv.CATS.update({k: v for k, v in fresh.items() if isinstance(v, dict)})


def _restore_bot():
    _reset_catalog()
    os.environ["LAUNDRY_EHANK_ROOT"] = NO_EHANK


def _align_path() -> Path:
    return SANDBOX / "data" / "price-align.json"


def _clear_align_file():
    path = _align_path()
    if path.is_file():
        path.unlink()


def _write_basis(basis: str):
    _align_path().write_text(json.dumps({"basis": basis}, ensure_ascii=False), encoding="utf-8")


def _dict_cats(prices):
    return {key: value for key, value in prices.items() if isinstance(value, dict)}


class Probe:
    def __enter__(self):
        self.sql = []
        self.temp = tempfile.mkdtemp(prefix="ehank-fake-")
        os.environ["LAUNDRY_EHANK_ROOT"] = self.temp
        dco = _dco_rows()
        cpy = _cpy_rows()
        sql = self.sql

        class Cursor:
            def execute(self, statement, *args):
                sql.append(statement)
                if "FROM Dco" in statement:
                    self._pending = dco
                elif "FROM Cpy" in statement:
                    self._pending = cpy
                else:
                    self._pending = []

            def fetchall(self):
                return list(getattr(self, "_pending", []))

        class Conn:
            def cursor(self):
                return Cursor()

            def close(self):
                return None

        ai = types.ModuleType("ai_engine")
        ai.__path__ = [self.temp]
        ai.__package__ = "ai_engine"
        db = types.ModuleType("ai_engine.db_manager")
        db.__package__ = "ai_engine"
        db.get_conn = lambda: Conn()
        ai.db_manager = db
        self._saved = {
            "ai_engine": sys.modules.get("ai_engine"),
            "ai_engine.db_manager": sys.modules.get("ai_engine.db_manager"),
        }
        sys.modules["ai_engine"] = ai
        sys.modules["ai_engine.db_manager"] = db
        return self

    def __exit__(self, *_exc):
        os.environ["LAUNDRY_EHANK_ROOT"] = NO_EHANK
        for key, old in self._saved.items():
            if old is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = old
        temp = self.temp
        sys.path[:] = [p for p in sys.path if os.path.normcase(str(p)) != os.path.normcase(temp)]
        shutil.rmtree(temp, ignore_errors=True)
        return False


def _full_id(method: str) -> str:
    return f"test_ehank_prices.PriceAlignTests.{method}"


def judge(clean_ok: bool, failed_ids, expected_ids, known_ids) -> str:
    """完整 id 相等才算 RED。子字串不算。乾淨樹不過或名字不存在是 INVALID。"""
    if not clean_ok:
        return "INVALID"
    if not expected_ids or any(expected not in known_ids for expected in expected_ids):
        return "INVALID"
    for failed in failed_ids:
        for expected in expected_ids:
            if failed == expected:
                return "RED"
    return "EQUIVALENT"


class PriceAlignTests(unittest.TestCase):
    def setUp(self):
        _clear_align_file()
        _restore_bot()

    def tearDown(self):
        _clear_align_file()
        _restore_bot()

    def test_P01_unreadable_fallback(self):
        os.environ["LAUNDRY_EHANK_ROOT"] = NO_EHANK
        base = _base_prices()
        result = ehank_prices.align(copy.deepcopy(base), basis="default_mode", repo=SANDBOX)
        self.assertEqual(result.code, "FALLBACK")
        self.assertEqual(result.prices, base)
        self.assertEqual(result.labels, {})

    def test_P02_readonly_select(self):
        with Probe() as probe:
            ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            self.assertEqual(len(probe.sql), 2)
            self.assertEqual(probe.sql, [DCO_SQL, CPY_SQL])

    def test_P03_exact_name_default_mode(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            for name, (price, label) in DEFAULT_MODE_PRICES.items():
                self.assertEqual(_item(result.prices, name), price, name)
                self.assertEqual(result.labels.get(name, ""), label, name)

    def test_P04_renamed_bed_set(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            self.assertEqual(_item(result.prices, "床組四件套"), 350)
            self.assertEqual(result.labels.get("床組四件套", ""), "")

    def test_P05_unmapped_keep(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            for name, price in KEPT_PRICES.items():
                self.assertEqual(_item(result.prices, name), price, name)
            self.assertIn("旗袍", result.unmapped)
            self.assertEqual(_item(result.prices, "旗袍"), 200)
            names = set(estimate.catalog(result.prices))
            self.assertNotIn("毛毯雙人", names)
            self.assertNotIn("羽絨羊毛被", names)

    def test_P06_water_basis(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="water", repo=SANDBOX)
            for name, (price, label) in WATER_PRICES.items():
                self.assertEqual(_item(result.prices, name), price, name)
                self.assertEqual(result.labels.get(name, ""), label, name)

    def test_P07_off_when_config_missing(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis=None, repo=SANDBOX)
            self.assertEqual(result.code, "OFF")
            self.assertEqual(result.basis, "off")
            self.assertEqual(_item(result.prices, "毛衣"), 150)

    def test_P08_water_zero_fallback(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="water", repo=SANDBOX)
            self.assertEqual(_item(result.prices, "精品毛衣"), 210)
            self.assertEqual(result.labels.get("精品毛衣", ""), "乾洗")

    def test_P09_input_not_mutated(self):
        with Probe():
            base = _base_prices()
            snapshot = copy.deepcopy(base)
            result = ehank_prices.align(base, basis="default_mode", repo=SANDBOX)
            self.assertEqual(base, snapshot)
            self.assertIsNot(result.prices, base)
            self.assertEqual(base["衣物"]["毛衣"], 150)
            self.assertEqual(result.prices["衣物"]["毛衣"], 180)

    def test_P10_estimate_line_label(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            _install(result)
            draft = estimate.update("毛衣1件", None, result.prices)
            text = estimate.render(draft)
            self.assertIn("先按店裡系統的標準價", text)
            self.assertIn("（乾洗）", text)
            self.assertIn("毛衣 1件 × 180元＝180元（乾洗）", text)

    def test_P11_same_mode_priced(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            _install(result)
            draft = estimate.update("毛衣1件要乾洗", None, result.prices)
            self.assertEqual(draft["total"], 180)
            self.assertNotEqual(draft["lines"][0].get("reason"), REFUSAL)
            self.assertNotIn(REFUSAL, estimate.render(draft))

    def test_P12_other_mode_refused(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            _install(result)
            draft = estimate.update("襯衫1件要乾洗", None, result.prices)
            self.assertIsNone(draft["total"])
            self.assertEqual(draft["lines"][0]["reason"], REFUSAL)

    def test_P13_menu_label(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            _install(result)
            blob = json.dumps(conv.cat_list_flex("皮革"), ensure_ascii=False)
            self.assertIn("400（14天）", blob)

    def test_P14_names_synced(self):
        with Probe():
            base = _base_prices()
            result = ehank_prices.align(base, basis="default_mode", repo=SANDBOX)
            before = set(estimate.catalog(base))
            after = set(estimate.catalog(result.prices))
            removed = {"毛毯單人", "毛毯雙人", "羽絨羊毛被"}
            added = {
                "西裝", "西褲", "領帶", "針織衣", "女衣",
                "小毛毯", "中毛毯", "大毛毯", "羽絨被", "蠶絲羊毛被",
                "枕頭", "娃娃", "皮手套", "大書包", "大童鞋", "高級拖鞋",
            }
            self.assertEqual(after, (before - removed) | added)
            self.assertEqual(len(after), 122)

    def test_P15_report_default_mode(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            self.assertEqual(len(result.changed), 16)
            self.assertEqual(len(result.labeled_only), 14)
            self.assertEqual(len(result.unmapped), 8)
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = ehank_prices.main(["--report", "--basis", "default_mode"])
            text = buf.getvalue()
            self.assertEqual(code, 0)
            self.assertIn("改價 16\n", text)
            self.assertIn("只加標示 14\n", text)
            self.assertIn("對不到 8\n", text)
            self.assertIn("新增 16\n", text)
            self.assertIn("移除 3\n", text)
            self.assertIn("未新增 0\n", text)

    def test_P16_report_water(self):
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="water", repo=SANDBOX)
            self.assertEqual(len(result.changed), 11)
            self.assertEqual(len(result.labeled_only), 2)
            self.assertEqual(len(result.unmapped), 8)
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = ehank_prices.main(["--report", "--basis", "water"])
            text = buf.getvalue()
            self.assertEqual(code, 0)
            self.assertIn("改價 11\n", text)
            self.assertIn("只加標示 2\n", text)
            self.assertIn("對不到 8\n", text)
            self.assertIn("新增 16\n", text)
            self.assertIn("移除 3\n", text)
            self.assertIn("未新增 0\n", text)

    def test_S01_wired_prices(self):
        base_cats = _dict_cats(_base_prices())
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            conv_price_sweater = _item(conv.PRICES, "毛衣")
            cats_sweater = _item(conv.CATS, "毛衣")
            code = "WIRED" if conv_price_sweater == 180 and cats_sweater == 180 else "NOT_WIRED"
            self.assertEqual(code, "WIRED")
            self.assertEqual(conv_price_sweater, 180)
            self.assertEqual(cats_sweater, 180)
            self.assertEqual(conv.PRICE_BASIS, "default_mode")
            self.assertEqual(len(conv.CATS), len(base_cats))

    def test_S02_wired_labels(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            label_sweater = conv.PRICE_LABELS.get("毛衣", "")
            draft = estimate.update("毛衣1件", None, conv.PRICES)
            text = estimate.render(draft)
            line_suffix = "（乾洗）"
            code = "LABEL_WIRED" if label_sweater == "乾洗" and line_suffix in text else "NOT_LABELED"
            self.assertEqual(code, "LABEL_WIRED")
            self.assertEqual(label_sweater, "乾洗")
            self.assertIn(line_suffix, text)
            self.assertIn("毛衣 1件 × 180元＝180元（乾洗）", text)

    def test_S03_wired_basis_water(self):
        with Probe():
            _write_basis("water")
            conv.apply_price_alignment()
            price_basis = conv.PRICE_BASIS
            conv_price_belt = _item(conv.PRICES, "皮帶")
            code = "BASIS_WIRED" if price_basis == "water" and conv_price_belt == 300 else "NOT_WIRED"
            self.assertEqual(code, "BASIS_WIRED")
            self.assertEqual(price_basis, "water")
            self.assertEqual(conv_price_belt, 300)

    def test_S04_corrupt_config_off(self):
        base = _base_prices()
        blobs = {
            "not_json": "{",
            "json_array": "[1, 2]",
            "unknown_basis": '{"basis": "nope"}',
        }
        with Probe():
            for label, blob in blobs.items():
                _reset_catalog()
                _align_path().write_text(blob, encoding="utf-8")
                conv.apply_price_alignment()
                prices = "equal_prices_json" if conv.PRICES == base else "changed"
                code = "OFF" if conv.PRICE_BASIS == "off" and prices == "equal_prices_json" else "NOT_OFF"
                self.assertEqual(code, "OFF", label)
                self.assertEqual(prices, "equal_prices_json", label)
                self.assertEqual(conv.PRICE_BASIS, "off", label)
                self.assertEqual(conv.PRICES, base, label)

    def test_S05_exception_keeps_catalog(self):
        base = _base_prices()
        expected = _dict_cats(base)
        real = ehank_prices.align

        def boom(*_args, **_kwargs):
            raise RuntimeError("align failed")

        ehank_prices.align = boom
        try:
            conv.CATS.clear()
            conv.CATS["壞掉"] = {"不該留下": 1}
            conv.apply_price_alignment()
            prices = "equal_prices_json" if conv.PRICES == base else "changed"
            cats_categories = len(conv.CATS)
            code = "KEPT_CATALOG" if prices == "equal_prices_json" and cats_categories == 7 and conv.CATS == expected else "NOT_KEPT"
            self.assertEqual(code, "KEPT_CATALOG")
            self.assertEqual(prices, "equal_prices_json")
            self.assertEqual(cats_categories, 7)
            self.assertEqual(conv.CATS, expected)
            self.assertNotIn("壞掉", conv.CATS)
        finally:
            ehank_prices.align = real

    def test_S06_water_header(self):
        with Probe():
            _write_basis("water")
            conv.apply_price_alignment()
            draft = estimate.update("襯衫1件", None, conv.PRICES)
            text = estimate.render(draft)
            header = text.splitlines()[0]
            code = "WATER_HEADER" if header == "幫你算好了，先按一般水洗價：" else "NOT_WATER"
            self.assertEqual(code, "WATER_HEADER")
            self.assertEqual(header, "幫你算好了，先按一般水洗價：")

    def test_S07_carousel_label(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            bubble = conv.cat_bubble("皮革")
            values = [box["contents"][1]["text"] for box in bubble["body"]["contents"]]
            row_has_label = any("（" in value and "）" in value for value in values)
            code = "CAROUSEL_LABEL" if row_has_label else "NO_LABEL"
            self.assertEqual(code, "CAROUSEL_LABEL")
            self.assertEqual(row_has_label, True)
            self.assertIn("400（14天）", values)

    def test_S08_two_modes_refused(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            draft = estimate.update("毛衣1件要乾洗或柔洗", None, conv.PRICES)
            sweater = next(line for line in draft["lines"] if line["name"] == "毛衣")
            reason = sweater.get("reason")
            code = "REFUSED" if reason == REFUSAL else "PRICED"
            self.assertEqual(code, "REFUSED")
            self.assertEqual(reason, REFUSAL)

    def test_S09_default_repo(self):
        source = inspect.getsource(ehank_prices.repo_root)
        matched = re.search(r'Path\("([^"]+)"\)', source)
        repo = matched.group(1) if matched else ""
        code = "DEFAULT_REPO" if repo == "C:/Users/cyc39/laundry-repo" else "NOT_DEFAULT"
        self.assertEqual(code, "DEFAULT_REPO")
        self.assertEqual(repo, "C:/Users/cyc39/laundry-repo")
        self.assertEqual(source.count("C:/Users/cyc39/laundry-repo"), 1)
        saved = os.environ.get("LAUNDRY_REPO_ROOT")
        os.environ["LAUNDRY_REPO_ROOT"] = str(SANDBOX)
        try:
            self.assertEqual(ehank_prices.repo_root().as_posix(), SANDBOX.as_posix())
        finally:
            if saved is None:
                os.environ.pop("LAUNDRY_REPO_ROOT", None)
            else:
                os.environ["LAUNDRY_REPO_ROOT"] = saved

    def test_S10_special_dropped(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            draft = estimate.update("襯衫1件、毛衣1件要乾洗", None, conv.PRICES)
            text = estimate.render(draft)
            special_note_present = "另外待評估：" in text
            total_rows = [line for line in text.splitlines() if line.startswith("這批")]
            total_line = total_rows[0] if len(total_rows) == 1 else ""
            code = "SPECIAL_DROPPED" if not special_note_present and total_line == "這批預估 250 元。" else "NOT_DROPPED"
            self.assertEqual(code, "SPECIAL_DROPPED")
            self.assertEqual(special_note_present, False)
            self.assertEqual(total_line, "這批預估 250 元。")
            self.assertIn("毛衣 1件 × 180元＝180元（乾洗）", text)
            self.assertIn("襯衫 1件 × 70元＝70元", text)

    def test_S11_special_kept(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            draft = estimate.update("襯衫1件要乾洗、毛衣1件要乾洗", None, conv.PRICES)
            text = estimate.render(draft)
            shirt = next(line for line in draft["lines"] if line["name"] == "襯衫")
            special_note_present = "另外待評估：" in text
            shirt_reason = shirt.get("reason")
            code = "SPECIAL_KEPT" if special_note_present and shirt_reason == REFUSAL else "NOT_KEPT"
            self.assertEqual(code, "SPECIAL_KEPT")
            self.assertEqual(special_note_present, True)
            self.assertEqual(shirt_reason, REFUSAL)
            self.assertIn("另外待評估：乾洗，尚未加計。", text)

    def test_off_basis_keeps_dry_clean_special(self):
        self.assertEqual(conv.PRICE_BASIS, "off")
        draft = estimate.update("襯衫1件要乾洗", None, conv.PRICES)
        text = estimate.render(draft)
        self.assertEqual(draft["lines"][0]["reason"], REFUSAL)
        self.assertIn("另外待評估：乾洗，尚未加計。", text)

    def _turns(self, texts):
        draft = None
        for text in texts:
            draft = estimate.update(text, draft, conv.PRICES)
            self.assertIsNotNone(draft, text)
        return draft

    def test_T01_both_kept(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            self.assertEqual(conv.PRICE_LABELS.get("毛衣"), "乾洗")
            draft = self._turns(["襯衫1件要乾洗", "毛衣1件要柔洗"])
            text = estimate.render(draft)
            shirt = next(line for line in draft["lines"] if line["name"] == "襯衫")
            sweater = next(line for line in draft["lines"] if line["name"] == "毛衣")
            special_has_dry = "乾洗" in draft["special"]
            special_has_soft = "柔洗" in draft["special"]
            render_line = "另外待評估：乾洗、柔洗，尚未加計。"
            code = "BOTH_KEPT" if special_has_dry and special_has_soft and render_line in text else "NOT_BOTH"
            self.assertEqual(code, "BOTH_KEPT")
            self.assertEqual(special_has_dry, True)
            self.assertEqual(special_has_soft, True)
            self.assertIn(render_line, text)
            self.assertEqual(shirt.get("reason"), REFUSAL)
            self.assertEqual(sweater.get("reason"), REFUSAL)
            self.assertEqual(shirt.get("wash_causes"), ["乾洗"])
            self.assertEqual(sweater.get("wash_causes"), ["柔洗"])

    def test_T02_adopted_not_listed(self):
        fake = {
            "Dco": "T02",
            "Dname": "圍巾",
            "Dclass": "衣物",
            "Unit": "件",
            "M": [80, 0, 90, 0, 0, 0, 0, 0],
            "DefMode": 3,
        }
        SNAPSHOT["dco"].insert(0, fake)
        try:
            with Probe():
                _write_basis("default_mode")
                conv.apply_price_alignment()
                self.assertEqual(conv.PRICE_LABELS.get("圍巾"), "柔洗")
                self.assertEqual(conv.PRICE_LABELS.get("襯衫", ""), "")
                draft = self._turns(["襯衫1件要乾洗", "圍巾1件要柔洗"])
                shirt = next(line for line in draft["lines"] if line["name"] == "襯衫")
                scarf = next(line for line in draft["lines"] if line["name"] == "圍巾")
                special_has_dry = "乾洗" in draft["special"]
                special_has_soft = "柔洗" in draft["special"]
                code = "ADOPTED_NOT_LISTED" if special_has_dry and not special_has_soft else "GUESSED"
                self.assertEqual(code, "ADOPTED_NOT_LISTED")
                self.assertEqual(special_has_dry, True)
                self.assertEqual(special_has_soft, False)
                self.assertEqual(shirt.get("wash_causes"), ["乾洗"])
                self.assertEqual(shirt.get("reason"), REFUSAL)
                self.assertFalse(scarf.get("reason"))
                self.assertNotIn("wash_causes", scarf)
        finally:
            SNAPSHOT["dco"].remove(fake)

    def test_T03_followup_refusal_kept(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            draft = self._turns(["襯衫1件、毛衣1件要乾洗", "襯衫1件也要乾洗"])
            text = estimate.render(draft)
            shirt = next(line for line in draft["lines"] if line["name"] == "襯衫")
            shirt_refused = shirt.get("reason") == REFUSAL
            special_has_dry = "乾洗" in draft["special"]
            render_line = "另外待評估：乾洗，尚未加計。"
            recorded = shirt.get("wash_causes") == ["乾洗"]
            code = "FOLLOWUP_REFUSAL_KEPT" if shirt_refused and special_has_dry and render_line in text and recorded else "NOT_RECORDED"
            self.assertEqual(code, "FOLLOWUP_REFUSAL_KEPT")
            self.assertEqual(shirt_refused, True)
            self.assertEqual(special_has_dry, True)
            self.assertIn(render_line, text)
            self.assertEqual(shirt.get("wash_causes"), ["乾洗"])

    def test_T04_old_draft_kept(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            draft = estimate.update("襯衫1件要乾洗", None, conv.PRICES)
            self.assertIsNotNone(draft)
            self.assertEqual(draft["lines"][0].get("wash_causes"), ["乾洗"])
            draft["lines"][0].pop("wash_causes")
            draft["special"] = ["乾洗"]
            draft = estimate.update("再加毛衣1件", draft, conv.PRICES)
            self.assertIsNotNone(draft)
            shirt = next(line for line in draft["lines"] if line["name"] == "襯衫")
            special_has_dry = "乾洗" in draft["special"]
            code = "OLD_DRAFT_KEPT" if special_has_dry else "DROPPED"
            self.assertEqual(code, "OLD_DRAFT_KEPT")
            self.assertEqual(special_has_dry, True)
            self.assertEqual(shirt.get("reason"), REFUSAL)
            self.assertNotIn("wash_causes", shirt)

    def test_T05_unrefused_dropped(self):
        with Probe():
            _write_basis("default_mode")
            conv.apply_price_alignment()
            draft = self._turns(["襯衫1件要乾洗、毛衣1件", "襯衫先不用"])
            shirt_present = any(line["name"] == "襯衫" for line in draft["lines"])
            special_has_dry = "乾洗" in draft["special"]
            code = "UNREFUSED_DROPPED" if not shirt_present and not special_has_dry else "STILL_COUNTED"
            self.assertEqual(code, "UNREFUSED_DROPPED")
            self.assertEqual(shirt_present, False)
            self.assertEqual(special_has_dry, False)

    def test_T06_off_unchanged(self):
        off_render = (
            "清單收到了，還差一點資料就能幫你算：\n"
            "\n"
            "\n"
            "\n"
            "還沒加進去：襯衫 1件、毛衣 1件。\n"
            "襯衫：洗法另計，不能直接套用一般水洗價。其他算好的金額會保留。\n"
            "另外待評估：乾洗、柔洗，尚未加計。\n"
            "\n"
            "先給你抓預算，這不是最後應付款；實際以現場看件報價為準。材質、尺寸或特殊處理（如乾洗、去霉、修補）可能另外確認費用。"
        )
        with Probe():
            _write_basis("off")
            conv.apply_price_alignment()
            self.assertEqual(conv.PRICE_BASIS, "off")
            draft = self._turns(["襯衫1件要乾洗", "毛衣1件要柔洗"])
            special = list(draft["special"])
            control = estimate.update("襯衫1件。要乾洗", None, conv.PRICES)
            self.assertIsNotNone(control)
            legacy_control = estimate._legacy_recorded_specials(["乾洗"], control["lines"])
            same_as_legacy = (
                special == ["乾洗", "柔洗"]
                and estimate.render(draft) == off_render
                and control["special"] == ["乾洗"]
                and control["special"] == legacy_control
                and control["total"] is None
                and "另外待評估：乾洗，尚未加計。" in estimate.render(control)
            )
            code = "OFF_UNCHANGED" if same_as_legacy else "CHANGED"
            self.assertEqual(code, "OFF_UNCHANGED")
            self.assertEqual(special, ["乾洗", "柔洗"])
            self.assertEqual(same_as_legacy, True)


class ScorerTests(unittest.TestCase):
    def test_scorer_wrong_name_is_invalid(self):
        verdict = judge(
            True,
            ["pkg.Class._FailedTest"],
            ["pkg.Class.test_missing"],
            {"pkg.Class.test_P01_unreadable_fallback"},
        )
        self.assertEqual(verdict, "INVALID")

    def test_scorer_clean_fail_is_invalid(self):
        verdict = judge(
            False,
            ["pkg.Class.test_foo"],
            ["pkg.Class.test_foo"],
            {"pkg.Class.test_foo"},
        )
        self.assertEqual(verdict, "INVALID")

    def test_scorer_substring_collision_survives(self):
        verdict = judge(
            True,
            ["pkg.Class.test_foo_bar"],
            ["pkg.Class.test_foo"],
            {"pkg.Class.test_foo", "pkg.Class.test_foo_bar"},
        )
        self.assertEqual(verdict, "EQUIVALENT")


PriceAlignTests.__module__ = "test_ehank_prices"
ScorerTests.__module__ = "test_ehank_prices"

KNOWN_IDS = {
    _full_id(name)
    for name in dir(PriceAlignTests)
    if name.startswith("test_P") or name.startswith("test_S") or name.startswith("test_T")
}

MUTATIONS = [
    (
        "Q01",
        ROOT / "ehank_prices.py",
        '    if book is None:\n        return _unchanged(base_prices, basis, "FALLBACK")\n',
        '    if book is None:\n'
        "        wiped = copy.deepcopy(base_prices)\n"
        "        for rows in wiped.values():\n"
        "            if isinstance(rows, dict):\n"
        "                for key, value in list(rows.items()):\n"
        "                    if type(value) is int:\n"
        "                        rows[key] = 0\n"
        '        return AlignResult("FALLBACK", basis, wiped, {}, [], [], [])\n',
        ["test_P01_unreadable_fallback"],
    ),
    (
        "Q02",
        ROOT / "ehank_prices.py",
        'DCO_SQL = "SELECT Dname, M1, M2, M3, m4, m5, m6, m7, m8, DefMode FROM Dco"\n',
        'DCO_SQL = "SELECT * FROM Dco"\n',
        ["test_P02_readonly_select"],
    ),
    (
        "Q03",
        ROOT / "ehank_prices.py",
        'def _norm_name(value) -> str:\n    return str("" if value is None else value).strip()\n',
        'def _norm_name(value) -> str:\n    return str("" if value is None else value)\n',
        ["test_P03_exact_name_default_mode"],
    ),
    (
        "Q04",
        ROOT / "ehank_prices.py",
        '    "床組四件套": "床組=床單+被套+枕套2",\n',
        "",
        ["test_P04_renamed_bed_set"],
    ),
    (
        "Q05",
        ROOT / "ehank_prices.py",
        "            if hit is None:\n                unmapped.append(name)\n                continue\n",
        "            if hit is None:\n                rows[name] = 0\n                unmapped.append(name)\n                continue\n",
        ["test_P05_unmapped_keep"],
    ),
    (
        "Q06",
        ROOT / "ehank_prices.py",
        '    if basis == "water":\n'
        '        chosen = _cell(hit["prices"], 0, mode_names)\n'
        "        if chosen is None:\n"
        '            chosen = _cell(hit["prices"], _def_index(hit["def_mode"]), mode_names)\n'
        "        return chosen\n",
        '    if basis == "water":\n'
        '        chosen = _cell(hit["prices"], _def_index(hit["def_mode"]), mode_names)\n'
        "        if chosen is None:\n"
        '            chosen = _cell(hit["prices"], 0, mode_names)\n'
        "        return chosen\n",
        ["test_P06_water_basis"],
    ),
    (
        "Q07",
        ROOT / "ehank_prices.py",
        "    if isinstance(value, str) and value.strip() in _BASIS_VALUES:\n"
        "        return value.strip()\n"
        '    return "off"\n',
        "    if isinstance(value, str) and value.strip() in _BASIS_VALUES:\n"
        "        return value.strip()\n"
        '    return "default_mode"\n',
        ["test_P07_off_when_config_missing"],
    ),
    (
        "Q08",
        ROOT / "ehank_prices.py",
        '    if basis == "water":\n'
        '        chosen = _cell(hit["prices"], 0, mode_names)\n'
        "        if chosen is None:\n"
        '            chosen = _cell(hit["prices"], _def_index(hit["def_mode"]), mode_names)\n'
        "        return chosen\n",
        '    if basis == "water":\n'
        '        chosen = _cell(hit["prices"], 0, mode_names)\n'
        "        return chosen\n",
        ["test_P08_water_zero_fallback"],
    ),
    (
        "Q09",
        ROOT / "ehank_prices.py",
        "    aligned = copy.deepcopy(base_prices)\n",
        "    aligned = base_prices\n",
        ["test_P09_input_not_mutated"],
    ),
    (
        "Q10",
        ROOT / "estimate.py",
        '            out.append(f"{line[\'name\']} {count} × {line[\'unit_price\']:,}元＝{amount}元{_mode_suffix(line[\'name\'])}")\n',
        '            out.append(f"{line[\'name\']} {count} × {line[\'unit_price\']:,}元＝{amount}元")\n',
        ["test_P10_estimate_line_label"],
    ),
    (
        "Q11",
        ROOT / "estimate.py",
        "    if len(requested) == 1 and requested[0] == adopted:\n        return False\n",
        "    if len(requested) == 1 and requested[0] == adopted:\n        return True\n",
        ["test_P11_same_mode_priced"],
    ),
    (
        "Q12",
        ROOT / "estimate.py",
        "    if len(requested) == 1 and requested[0] == adopted:\n        return False\n    return True\n",
        "    if len(requested) == 1 and requested[0] == adopted:\n        return False\n    return False\n",
        ["test_P12_other_mode_refused"],
    ),
    (
        "Q13",
        ROOT / "conversation.py",
        "def _menu_price(name: str, price) -> str:\n"
        '    label = PRICE_LABELS.get(name) or ""\n'
        "    shown = str(price)\n"
        "    if label:\n"
        '        shown = f"{shown}（{label}）"\n'
        "    return shown\n",
        "def _menu_price(name: str, price) -> str:\n"
        '    label = PRICE_LABELS.get(name) or ""\n'
        "    shown = str(price)\n"
        "    return shown\n",
        ["test_P13_menu_label"],
    ),
    (
        "Q14",
        ROOT / "ehank_prices.py",
        "            rows[name] = chosen_price\n",
        '            rows[hit["key"]] = chosen_price\n'
        '            if hit["key"] != name and name in rows:\n'
        "                del rows[name]\n",
        ["test_P14_names_synced"],
    ),
    (
        "Q15",
        ROOT / "ehank_prices.py",
        '    if basis == "default_mode":\n'
        '        chosen = _cell(hit["prices"], _def_index(hit["def_mode"]), mode_names)\n'
        "        if chosen is None:\n"
        '            chosen = _cell(hit["prices"], 0, mode_names)\n'
        "        return chosen\n",
        '    if basis == "default_mode":\n'
        '        chosen = _cell(hit["prices"], 0, mode_names)\n'
        "        if chosen is None:\n"
        '            chosen = _cell(hit["prices"], _def_index(hit["def_mode"]), mode_names)\n'
        "        return chosen\n",
        ["test_P03_exact_name_default_mode"],
    ),
    (
        "Z01",
        ROOT / "conversation.py",
        "        PRICES.clear()\n        PRICES.update(result.prices)\n",
        "        pass\n",
        ["test_S01_wired_prices"],
    ),
    (
        "Z02",
        ROOT / "conversation.py",
        "        PRICE_LABELS.clear()\n        PRICE_LABELS.update(result.labels)\n",
        "        pass\n",
        ["test_S02_wired_labels"],
    ),
    (
        "Z03",
        ROOT / "conversation.py",
        "            PRICE_BASIS = result.basis\n",
        "            pass\n",
        ["test_S03_wired_basis_water"],
    ),
    (
        "Z04",
        ROOT / "ehank_prices.py",
        '        data = json.loads(path.read_text(encoding="utf-8"))\n'
        "    except Exception:\n"
        "        return resolve_basis(None)\n",
        '        data = json.loads(path.read_text(encoding="utf-8"))\n'
        "    except Exception:\n"
        '        return "default_mode"\n',
        ["test_S04_corrupt_config_off"],
    ),
    (
        "Z05",
        ROOT / "conversation.py",
        "            PRICE_BASIS = \"off\"\n"
        "    CATS.clear()\n"
        "    CATS.update({k: v for k, v in PRICES.items() if isinstance(v, dict)})\n",
        "            PRICE_BASIS = \"off\"\n"
        "        CATS.clear()\n"
        "        CATS.update({k: v for k, v in PRICES.items() if isinstance(v, dict)})\n",
        ["test_S05_exception_keeps_catalog"],
    ),
    (
        "Z06",
        ROOT / "estimate.py",
        '    if _estimate_basis() == "default_mode":\n'
        '        return "幫你算好了，先按店裡系統的標準價："\n',
        '    if _estimate_basis() in ("default_mode", "water"):\n'
        '        return "幫你算好了，先按店裡系統的標準價："\n',
        ["test_S06_water_header"],
    ),
    (
        "Z07",
        ROOT / "conversation.py",
        '            "contents": [row(n, _menu_price(n, p)) for n, p in featured[:4]],\n',
        '            "contents": [row(n, str(p)) for n, p in featured[:4]],\n',
        ["test_S07_carousel_label"],
    ),
    (
        "Z08",
        ROOT / "estimate.py",
        "    if len(requested) == 1 and requested[0] == adopted:\n"
        "        return False\n"
        "    return True\n",
        "    if len(requested) != 1:\n"
        "        return False\n"
        "    if requested[0] == adopted:\n"
        "        return False\n"
        "    return True\n",
        ["test_S08_two_modes_refused"],
    ),
    (
        "Z09",
        ROOT / "ehank_prices.py",
        '    if not raw:\n        return Path("C:/Users/cyc39/laundry-repo")\n',
        '    if not raw:\n        raise OSError("LAUNDRY_REPO_ROOT is not set")\n',
        ["test_S09_default_repo"],
    ),
    (
        "Z10",
        ROOT / "estimate.py",
        "    refused: set[str] = set()\n"
        "    for line in lines:\n"
        "        refused.update(_cause_washes(line, specials))\n"
        "    kept = []\n"
        "    for word in specials:\n"
        '        if word in ("乾洗", "柔洗") and word not in refused:\n'
        "            continue\n"
        "        kept.append(word)\n"
        "    return kept\n",
        "    return _legacy_recorded_specials(specials, lines)\n",
        ["test_S10_special_dropped"],
    ),
    (
        "Z11",
        ROOT / "estimate.py",
        "    refused: set[str] = set()\n"
        "    for line in lines:\n"
        "        refused.update(_cause_washes(line, specials))\n"
        "    kept = []\n"
        "    for word in specials:\n"
        '        if word in ("乾洗", "柔洗") and word not in refused:\n'
        "            continue\n"
        "        kept.append(word)\n"
        "    return kept\n",
        "    adopted_labels = {_adopted_label(line.get(\"name\", \"\")) for line in lines}\n"
        "    kept = []\n"
        "    for word in specials:\n"
        '        if word in ("乾洗", "柔洗") and word in adopted_labels:\n'
        "            continue\n"
        "        kept.append(word)\n"
        "    return kept\n",
        ["test_S11_special_kept"],
    ),
    (
        "U01",
        ROOT / "estimate.py",
        "    refused: set[str] = set()\n"
        "    for line in lines:\n"
        "        refused.update(_cause_washes(line, specials))\n",
        '    refused = {word for word in (refused_washes or []) if word in ("乾洗", "柔洗")}\n'
        "    if not refused:\n"
        "        for line in lines:\n"
        "            refused.update(_cause_washes(line, specials))\n",
        ["test_T01_both_kept"],
    ),
    (
        "U02",
        ROOT / "estimate.py",
        '    recorded = line.get("wash_causes")\n'
        "    if isinstance(recorded, (list, tuple)):\n"
        '        return {word for word in recorded if word in ("乾洗", "柔洗")}\n'
        '    adopted = _adopted_label(line.get("name", ""))\n'
        '    return {word for word in specials if word in ("乾洗", "柔洗") and word != adopted}\n',
        '    adopted = _adopted_label(line.get("name", ""))\n'
        '    return {word for word in specials if word in ("乾洗", "柔洗") and word != adopted}\n',
        ["test_T02_adopted_not_listed"],
    ),
    (
        "U03",
        ROOT / "estimate.py",
        "            if reason == _OTHER_WASH_REASON:\n"
        "                _remember_causes(line, requested)\n"
        "                refused_washes.extend(requested)\n",
        "            if reason == _OTHER_WASH_REASON and existing is None:\n"
        "                _remember_causes(line, requested)\n"
        "                refused_washes.extend(requested)\n",
        ["test_T03_followup_refusal_kept"],
    ),
    (
        "U04",
        ROOT / "estimate.py",
        '    adopted = _adopted_label(line.get("name", ""))\n'
        '    return {word for word in specials if word in ("乾洗", "柔洗") and word != adopted}\n',
        "    return set()\n",
        ["test_T04_old_draft_kept"],
    ),
    (
        "U05",
        ROOT / "estimate.py",
        "    refused: set[str] = set()\n",
        '    refused: set[str] = {word for word in specials if word in ("乾洗", "柔洗")}\n',
        ["test_T05_unrefused_dropped"],
    ),
    (
        "U06",
        ROOT / "estimate.py",
        '    if _estimate_basis() == "off":\n'
        "        return _legacy_recorded_specials(specials, lines)\n",
        "",
        ["test_T06_off_unchanged"],
    ),
]

COMMANDER_FROM = (
    ("Y03", "Z08"),
    ("Y04", "Z05"),
    ("Y05", "Z06"),
    ("Y08", "Z01"),
    ("Y09", "Z02"),
    ("Y10", "Z07"),
    ("Y11", "Z04"),
)


def _env():
    env = os.environ.copy()
    env["LAUNDRY_REPO_ROOT"] = str(SANDBOX)
    env["LAUNDRY_LOOKUP_FIXTURE"] = "1"
    env["LAUNDRY_EHANK_ROOT"] = NO_EHANK
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def print_ids(names: list[str]) -> int:
    loader = unittest.TestLoader()
    module = sys.modules[__name__]
    code = 0
    for name in names:
        try:
            suite = loader.loadTestsFromName(name, module)
        except Exception as exc:
            print(f"MISSING {name} {type(exc).__name__}")
            code = 2
            continue
        cases = list(suite)
        if len(cases) == 1 and cases[0].__class__.__name__ == "_FailedTest":
            print(f"MISSING {name}")
            code = 2
            continue
        result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
        if result.wasSuccessful() and result.testsRun:
            for test in cases:
                print(f"PASS {test.id()}")
            continue
        code = 1
        seen = False
        for test, _tb in list(result.failures) + list(result.errors):
            print(f"FAIL {test.id()}")
            seen = True
        if not seen:
            print(f"FAIL {name}")
    return code


def _parse_ids(stdout: str):
    passed, failed, missing = [], [], []
    for line in stdout.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        if parts[0] == "PASS":
            passed.append(parts[1])
        elif parts[0] == "FAIL":
            failed.append(parts[1])
        elif parts[0] == "MISSING":
            missing.append(parts[1])
    return passed, failed, missing


def _run_named(methods: list[str]):
    names = [f"PriceAlignTests.{method}" for method in methods]
    proc = subprocess.run(
        [PY, "-B", str(ROOT / "test_ehank_prices.py"), "--ids", *names],
        cwd=str(ROOT),
        env=_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    passed, failed, missing = _parse_ids(proc.stdout or "")
    return proc.returncode, passed, failed, missing, (proc.stderr or "")[-500:]


def _apply_patch(path: Path, original: bytes, old: str, new: str):
    newline = b"\r\n" if b"\r\n" in original else b"\n"
    old_b = old.encode("utf-8").replace(b"\n", newline)
    new_b = new.encode("utf-8").replace(b"\n", newline)
    count = original.count(old_b)
    if count != 1:
        return count, original
    return count, original.replace(old_b, new_b, 1)


def _case_method_names():
    return [
        name
        for name in dir(PriceAlignTests)
        if name.startswith(("test_P", "test_S", "test_off"))
    ]


def run_mutations(only=None) -> int:
    selected = MUTATIONS
    if only:
        wanted = set(only)
        selected = [item for item in MUTATIONS if item[0] in wanted]
    for qid, path, old, new, methods in selected:
        expected = [_full_id(method) for method in methods]
        original = path.read_bytes()
        before = hashlib.sha256(original).hexdigest()
        verdict = "INVALID"
        shown = "-"
        try:
            _code, passed, failed, missing, err = _run_named(methods)
            clean_ok = not failed and not missing and all(item in passed for item in expected)
            print(
                f"WITNESS_CLEAN| {qid} | ran={len(expected)} ok={'true' if clean_ok else 'false'} | {','.join(failed + missing) or '-'}"
            )
            if not clean_ok:
                shown = ",".join(failed + missing) or "-"
                if err:
                    print(err)
                continue
            count, patched = _apply_patch(path, original, old, new)
            if count != 1:
                shown = f"patch_count={count}"
                continue
            path.write_bytes(patched)
            _code, _passed, failed, missing, err = _run_named(methods)
            verdict = judge(True, failed, expected, KNOWN_IDS)
            if missing:
                verdict = "INVALID"
            shown = ",".join(failed) if failed else "-"
            if err and verdict != "RED":
                print(err)
        finally:
            path.write_bytes(original)
            restored = path.read_bytes()
            digest = hashlib.sha256(restored).hexdigest()
            same = restored == original
            if not same:
                verdict = "INVALID"
                shown = "restore_mismatch"
            print(f"RESTORED| {qid} | same={str(same).lower()} | {digest} | before={before}")
            print(f"MUTATION| {qid} | {verdict} | {shown} | {digest}")
    return 0


def run_commander() -> int:
    by_id = {item[0]: item for item in MUTATIONS}
    methods = _case_method_names()
    for yid, zid in COMMANDER_FROM:
        _qid, path, old, new, witness_methods = by_id[zid]
        original = path.read_bytes()
        try:
            _code, passed, failed, missing, err = _run_named(witness_methods)
            expected = [_full_id(method) for method in witness_methods]
            clean_ok = not failed and not missing and all(item in passed for item in expected)
            if not clean_ok:
                print(f"COMMANDER_CUT| {yid} | INVALID | {','.join(failed + missing) or '-'}")
                if err:
                    print(err)
                continue
            count, patched = _apply_patch(path, original, old, new)
            if count != 1:
                print(f"COMMANDER_CUT| {yid} | INVALID | patch_count={count}")
                continue
            path.write_bytes(patched)
            _code, _passed, failed, missing, err = _run_named(methods)
            shown = ",".join(failed + missing) if (failed or missing) else "-"
            print(f"COMMANDER_CUT| {yid} | {shown}")
            if err and not failed and not missing:
                print(err)
        finally:
            path.write_bytes(original)
            restored = path.read_bytes()
            if restored != original:
                print(f"COMMANDER_RESTORE_FAIL| {yid}")
    return 0


if __name__ == "__main__":
    if "--mutations" in sys.argv:
        only = None
        if "--only" in sys.argv:
            only = sys.argv[sys.argv.index("--only") + 1].split(",")
        raise SystemExit(run_mutations(only))
    if "--commander" in sys.argv:
        raise SystemExit(run_commander())
    if "--ids" in sys.argv:
        index = sys.argv.index("--ids")
        raise SystemExit(print_ids(sys.argv[index + 1 :]))
    unittest.main()
