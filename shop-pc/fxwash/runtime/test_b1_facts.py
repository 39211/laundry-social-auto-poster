# -*- coding: utf-8 -*-
"""B1 店家定案事實回歸（店內電腦，Python 3.11 embedded，無網路）。

從 shop-pc/fxwash 執行：
python -I -S -B -m unittest discover -s runtime -p "test_b1_facts.py"
"""
from __future__ import annotations

import ast
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import dialog_corpus  # noqa: E402

CHAT_SERVICE = ROOT / "runtime" / "chat_service.py"
BUILDERS = (ROOT / "build_expanded_corpus.py", ROOT / "build_expanded_corpus_v5.py")

_DELIVERY = re.compile(r"工作天|工作日|三到五天|三到四天|3\s*[~～到\-–]\s*4\s*(?:個)?\s*天")
_MIN_SPEND = re.compile(r"滿額")
_AREA = re.compile(r"市區|全區|全市")
_PAY = re.compile(r"刷卡|信用卡|街口")
_RESULT = re.compile(r"不傷(?:衣服|衣料|布料|被胎|皮質|鞋體)|徹底殺菌|彻底殺菌|徹底除味|恢復全新|一定洗白")
_OLD_PICKUP_TIME = re.compile(r"跟營業時間一樣")
_SENTENCE = re.compile(r"[，。！？；]")
_CLAUSE_SPLIT = re.compile(r"[，。！？；、,.!?;:：\n「」『』（）()]")
_NEGATIONS = ("不", "沒", "無法", "未")

_SHOE_7 = re.compile(r"(?<![–~\-\d])7\s*天")
_BAG_14 = re.compile(r"(?<![–~\-\d])14\s*天")


def unnegated_guarantees(s: str) -> list:
    hits = []
    for m in re.finditer("保證", s):
        clause = _CLAUSE_SPLIT.split(s[: m.start()])[-1][-8:]
        if not any(neg in clause for neg in _NEGATIONS):
            hits.append(s[max(0, m.start() - 12): m.end() + 6])
    return hits


def banned_hits(s: str) -> list:
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
            hits.append(name + ":" + m.group(0))
    # 只檢查句子；程式碼中的關鍵字清單字串（無中文標點）不算提供付款方式。
    if _SENTENCE.search(s):
        m = _PAY.search(s)
        if m:
            hits.append("payment:" + m.group(0))
    for g in unnegated_guarantees(s):
        hits.append("guarantee:" + g)
    return hits


def string_constants(path: Path) -> list:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


def walk_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_strings(k)
            yield from walk_strings(v)
    elif isinstance(obj, (list, tuple, set, frozenset)):
        for x in obj:
            yield from walk_strings(x)


def _scan(label: str, strings) -> list:
    problems = []
    for s in strings:
        for hit in banned_hits(s):
            problems.append(label + ": " + hit + " in " + repr(s[:60]))
    return problems


class B1ShopFactsTest(unittest.TestCase):
    def test_phrase_count_unchanged(self) -> None:
        self.assertEqual(dialog_corpus.get_total_phrase_count(), 659)

    def test_corpus_has_no_banned_facts(self) -> None:
        problems = _scan("CORPUS", walk_strings(dialog_corpus.CORPUS))
        self.assertEqual(problems, [], "\n".join(problems))

    def test_chat_service_has_no_banned_facts(self) -> None:
        problems = _scan("chat_service", string_constants(CHAT_SERVICE))
        self.assertEqual(problems, [], "\n".join(problems))

    def test_builders_have_no_banned_facts(self) -> None:
        problems = []
        for path in BUILDERS:
            problems.extend(_scan(path.name, string_constants(path)))
        self.assertEqual(problems, [], "\n".join(problems))

    def test_chat_service_prompt_has_decided_facts(self) -> None:
        text = "\n".join(string_constants(CHAT_SERVICE))
        for need in ("5–7", "10–14", "現金、LINE Pay、轉帳", "沒有低消"):
            self.assertIn(need, text, need)
        self.assertRegex(text, _SHOE_7)
        self.assertRegex(text, _BAG_14)

    def test_chat_service_imports_without_network(self) -> None:
        from runtime import chat_service  # noqa: F401
        self.assertTrue(callable(chat_service.generate_chat_reply))

    def test_guarantee_pattern_allows_negated(self) -> None:
        for ok in ("不保證", "不敢跟你保證", "不能只看深淺色就保證"):
            self.assertEqual(unnegated_guarantees(ok), [], ok)
        self.assertNotEqual(unnegated_guarantees("交給門市精緻乾洗，保證不縮水"), [])
        self.assertEqual(banned_hits("台中市西屯區青海路二段365號（至善國中正對面）"), [])


if __name__ == "__main__":
    unittest.main()
