# -*- coding: utf-8 -*-
"""B1 店家定案事實回歸：程式文字與實際回覆都不能再出現舊說法。

執行：python -B -X utf8 test_b1_facts.py（在 line-bot/ 目錄），失敗時 exit code 1。
也可被 unittest 匯入執行。
"""
from __future__ import annotations

import ast
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import test_conversation as base  # noqa: E402
import ehank_prices  # noqa: E402
import estimate  # noqa: E402

conv = base.conv

SOURCES = ("conversation.py", "quote_flow.py")

_DELIVERY = re.compile(r"工作天|工作日|三到五天|三到四天|3\s*[~～到\-–]\s*4\s*(?:個)?\s*天")
_MIN_SPEND = re.compile(r"滿額")
_AREA = re.compile(r"市區|全區|全市")
_PAY = re.compile(r"刷卡|信用卡|街口")
_RESULT = re.compile(r"不傷(?:衣服|衣料|布料|被胎|皮質|鞋體)|徹底殺菌|彻底殺菌|徹底除味|恢復全新|一定洗白")
_OLD_PICKUP_TIME = re.compile(r"跟營業時間一樣")
# 只有「句子」才檢查付款用語，路由關鍵字（例如「可以刷卡嗎」）不算。
_SENTENCE = re.compile(r"[，。！？；]")
_CLAUSE_SPLIT = re.compile(r"[，。！？；、,.!?;:：\n「」『』（）()]")
_NEGATIONS = ("不", "沒", "無法", "未")


def unnegated_guarantees(s: str) -> list[str]:
    """「保證」前面同一小句 8 字內沒有 不/沒/無法/未 才算違規。"""
    hits = []
    for m in re.finditer("保證", s):
        clause = _CLAUSE_SPLIT.split(s[: m.start()])[-1][-8:]
        if not any(neg in clause for neg in _NEGATIONS):
            hits.append(s[max(0, m.start() - 12): m.end() + 6])
    return hits


def banned_hits(s: str, *, reply: bool = False) -> list[str]:
    hits = []
    for name, pat in (
        ("delivery", _DELIVERY),
        ("min_spend", _MIN_SPEND),
        ("area", _AREA),
        ("result", _RESULT),
        ("pickup_time", _OLD_PICKUP_TIME),
    ):
        m = pat.search(s)
        if m:
            hits.append(f"{name}:{m.group(0)}")
    if reply or _SENTENCE.search(s):
        m = _PAY.search(s)
        if m:
            hits.append(f"payment:{m.group(0)}")
    for g in unnegated_guarantees(s):
        hits.append(f"guarantee:{g}")
    return hits


def string_constants(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


_SHOE_7 = re.compile(r"(?<![–~\-\d])7\s*天")
_BAG_14 = re.compile(r"(?<![–~\-\d])14\s*天")


class B1FactsTest(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls) -> None:
        base.setup_tmp()
        base.freeze_now("2026-09-05T13:00")

    def ask(self, text: str) -> str:
        B1FactsTest._n += 1
        uid = f"Ub1facts{B1FactsTest._n:03d}"
        msgs, _meta = conv.handle_ex(uid, text)
        blob = base.flatten(msgs)
        hits = banned_hits(blob, reply=True)
        self.assertEqual(hits, [], f"{text!r} reply has banned facts {hits}: {blob}")
        return blob

    def test_sources_have_no_banned_facts(self) -> None:
        problems = []
        for name in SOURCES:
            for s in string_constants(HERE / name):
                for hit in banned_hits(s):
                    problems.append(f"{name}: {hit} in {s[:60]!r}")
        self.assertEqual(problems, [], "\n".join(problems))

    def test_guarantee_pattern_allows_negated(self) -> None:
        for ok in ("不保證", "光用文字我不敢跟你保證", "不能只看深淺色就保證", "不會先跟你保證一定沒問題"):
            self.assertEqual(unnegated_guarantees(ok), [], ok)
        self.assertNotEqual(unnegated_guarantees("交給門市，保證不縮水"), [])
        self.assertEqual(banned_hits("台中市西屯區青海路二段365號"), [])

    def test_general_turnaround(self) -> None:
        blob = self.ask("要洗多久")
        self.assertIn("5–7", blob, blob)

    def test_shoe_turnaround(self) -> None:
        blob = self.ask("鞋子要洗幾天")
        self.assertRegex(blob, _SHOE_7)

    def test_bag_turnaround(self) -> None:
        blob = self.ask("包包要多久")
        self.assertRegex(blob, _BAG_14)

    def test_duvet_turnaround(self) -> None:
        blob = self.ask("棉被要幾天")
        self.assertIn("10–14", blob, blob)

    def test_payment_methods(self) -> None:
        for text in ("付款方式有哪些", "可以刷卡嗎"):
            blob = self.ask(text)
            for need in ("現金", "LINE Pay", "轉帳"):
                self.assertIn(need, blob, f"{text}: {blob}")

    def test_pickup_minimum(self) -> None:
        blob = self.ask("收送要多少錢才收")
        self.assertTrue("一件也收" in blob or "沒有低消" in blob, blob)

    def test_pickup_time(self) -> None:
        blob = self.ask("收送時間")
        self.assertIn("營業時間", blob, blob)

    # ---- B1-4：包、皮件一律 14 天 ----
    def _with_labels(self, **labels) -> None:
        saved = dict(conv.PRICE_LABELS)

        def restore() -> None:
            conv.PRICE_LABELS.clear()
            conv.PRICE_LABELS.update(saved)

        self.addCleanup(restore)
        conv.PRICE_LABELS.update(labels)

    def _quote_blob(self, item: str) -> str:
        self.assertIsNotNone(conv.lookup_item(item), f"fixture prices lack {item}")
        B1FactsTest._n += 1
        uid = f"Ub1facts{B1FactsTest._n:03d}"
        return base.flatten(conv.quote(item, conv._price_of(item), uid))

    def test_bag_day_label_reply_says_14(self) -> None:
        self.assertIsNotNone(conv.lookup_item("特殊類名牌包"))
        self._with_labels(特殊類名牌包="10天")
        blob = self.ask("洗特殊類名牌包多少錢")
        self.assertIn("14天", blob, blob)
        self.assertNotIn("10天", blob, blob)

    def test_non_bag_day_label_kept(self) -> None:
        self._with_labels(襯衫="10天")
        blob = self._quote_blob("襯衫")
        self.assertIn("（10天）", blob, blob)
        self.assertNotIn("14天", blob, blob)

    def test_bag_non_day_label_kept(self) -> None:
        self._with_labels(名牌包="乾洗")
        blob = self._quote_blob("名牌包")
        self.assertIn("（乾洗）", blob, blob)
        self.assertNotIn("14天", blob, blob)

    def test_menu_price_bag_and_leather_clothing(self) -> None:
        self._with_labels(特殊類名牌包="10天", 皮衣="10天")
        self.assertEqual(conv._menu_price("特殊類名牌包", 2000), "2000（14天）")
        self.assertEqual(conv._menu_price("皮衣", 1000), "1000（10天）")

    def test_estimate_lines_use_14_for_bags(self) -> None:
        import conversation
        self.assertIs(conversation, conv)
        cat = estimate.catalog(conv.PRICES)
        for name in ("特殊類名牌包", "襯衫"):
            self.assertIn(name, cat, f"fixture prices lack {name}")
        self._with_labels(特殊類名牌包="10天", 襯衫="10天")
        draft = estimate.price({
            "lines": [
                {"name": "特殊類名牌包", "quantity": 1, "max_quantity": 1, "unit": "個", "reason": "", "source": "text"},
                {"name": "襯衫", "quantity": 1, "max_quantity": 1, "unit": "件", "reason": "", "source": "text"},
            ],
            "special": [], "revision": 1, "source": "text",
        }, conv.PRICES)
        text = estimate.render(draft)
        bag = [ln for ln in text.splitlines() if ln.startswith("特殊類名牌包")]
        shirt = [ln for ln in text.splitlines() if ln.startswith("襯衫")]
        self.assertEqual(len(bag), 1, text)
        self.assertEqual(len(shirt), 1, text)
        self.assertTrue(bag[0].endswith("（14天）"), bag[0])
        self.assertTrue(shirt[0].endswith("（10天）"), shirt[0])

    def test_bag_label_helper(self) -> None:
        f = ehank_prices.bag_turnaround_label
        self.assertEqual(f("特殊類名牌包", "10天", "包包"), "14天")
        self.assertEqual(f("短皮夾", "７天", "包包"), "14天")
        self.assertEqual(f("名牌包", " １０ 天 ", "包包"), "14天")
        self.assertEqual(f("一般包", "10天"), "14天")
        self.assertEqual(f("皮帶", "10天", "皮革"), "14天")
        self.assertEqual(f("皮手套", "21天", "皮革"), "14天")
        self.assertEqual(f("名牌包", "乾洗", "包包"), "乾洗")
        self.assertEqual(f("名牌包", "10天以上", "包包"), "10天以上")
        self.assertEqual(f("名牌包", "", "包包"), "")
        self.assertEqual(f("皮鞋", "10天", "鞋子"), "10天")
        self.assertEqual(f("皮鞋", "10天"), "10天")
        # 包鞋 (closed-toe shoes) contains 包 but is a shoe: 7-day rule, never the bag rule.
        self.assertEqual(f("包鞋", "10天", "鞋子"), "10天")
        self.assertEqual(f("包鞋", "10天"), "10天")
        self.assertEqual(f("皮衣", "10天", "皮革"), "10天")
        self.assertEqual(f("襯衫", "10天", "衣物"), "10天")
        self.assertEqual(f("包巾", "10天"), "10天")


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(B1FactsTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
