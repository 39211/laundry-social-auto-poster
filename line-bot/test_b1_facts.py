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


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(B1FactsTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
