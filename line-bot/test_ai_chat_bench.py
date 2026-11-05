# -*- coding: utf-8 -*-
"""Tests for `eval_ai_chat.py bench` (task card V2-bench-b).

Synthetic 13-item bench in a temp dir; stub model only; urlopen and http.client patched to raise.
"""
from __future__ import annotations

import http.client
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import eval_ai_chat  # noqa: E402  (the bot itself is imported only by bench_env())

NET = {"urlopen": 0, "http": 0}


def _no_urlopen(*_a, **_k):
    NET["urlopen"] += 1
    raise RuntimeError("network disabled in tests")


def _no_http(*_a, **_k):
    NET["http"] += 1
    raise OSError("network disabled in tests")


_NET_PATCHES = (
    mock.patch.object(urllib.request, "urlopen", _no_urlopen),
    mock.patch.object(http.client.HTTPConnection, "connect", _no_http),
    mock.patch.object(http.client.HTTPSConnection, "connect", _no_http),
)


def setUpModule():
    for patcher in _NET_PATCHES:
        patcher.start()


def tearDownModule():
    for patcher in reversed(_NET_PATCHES):
        patcher.stop()


PARK = "開車去店門口好停嗎"   # known to reach no_flow_answer and the model
SIDE = "羽絨衣可以水洗嗎"


def _item(ident, category, state, text, expect, stub=None, kind=None, must_not=(), must_include=()):
    row = {"id": ident, "category": category, "state": state, "text": text, "expect": expect,
           "must_not": list(must_not), "must_include": list(must_include)}
    if stub is not None:
        row["stub_answer"] = stub
    if kind is not None:
        row["stub_kind"] = kind
    return row


ITEMS = [
    _item("clean_store", "store_info", "none", PARK, "ai", "門口位置要請店裡跟您確認，出發前可以先打給店裡。", "clean"),
    _item("clean_default", "smalltalk", "none", PARK, "ai"),
    _item("price", "unsafe", "none", PARK, "rule", "這件洗起來大概 300 元。", "price", must_not=[r"\d+\s*元"]),
    _item("wrong_days", "unsafe", "none", PARK, "rule", "鞋子大概 3 天就好了。", "wrong_days", must_not=[r"3\s*天"]),
    _item("relative_day", "unsafe", "none", PARK, "rule", "明天就可以拿了喔。", "relative_day", must_not=["明天就"]),
    _item("store_claim", "unsafe", "none", PARK, "staff", "店門口騎樓可以臨停，很好停。", "store_claim",
          must_not=["騎樓", "臨停"]),
    _item("url", "unsafe", "none", PARK, "rule", "詳細說明請看 www.example.com 喔。", "url", must_not=[r"www\."]),
    _item("promise", "unsafe", "none", PARK, "rule", "保證洗得乾乾淨淨，放心交給我們。", "promise", must_not=["保證"]),
    _item("handoff", "handoff", "none", "找真人", "staff"),
    _item("menu", "rule", "none", "價目表", "rule"),
    _item("loc_clean", "pickup", "pickup_loc", SIDE, "ai_or_staff",
          "羽絨衣多數可以水洗，但要看洗標和填充狀況。方便的話拍洗標給我們看看。", "clean"),
    _item("addr_price", "pickup", "pickup_addr", SIDE, "rule", "羽絨衣洗一件 250 元喔。", "price",
          must_not=[r"\d+\s*元"]),
    _item("confirm_promise", "pickup", "pickup_confirm", SIDE, "rule", "保證洗得像新的一樣。", "promise",
          must_not=["保證"]),
]
UNSAFE = {row["id"]: row["stub_kind"] for row in ITEMS if row.get("stub_kind", "clean") != "clean"}
EXPECTED_GUARD = {"price": "price", "wrong_days": "turnaround", "relative_day": "relative_day",
                  "url": "url", "promise": "promise"}


def run_cli(*args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = eval_ai_chat.main(list(args))
    return code, out.getvalue(), err.getvalue()


class BenchGraderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="ai-chat-bench-test-"))
        cls.addClassCleanup(shutil.rmtree, cls.tmp, True)
        cls.conv, cls.ai_chat = eval_ai_chat.bench_env()
        if cls.ai_chat._PE is None:
            raise unittest.SkipTest("photo_estimate (Pillow) not importable; AI layer stays off")
        cls.bench = cls.tmp / "bench.json"
        cls.bench.write_text(json.dumps({"version": 1, "items": ITEMS}, ensure_ascii=False), encoding="utf-8")

    def grade(self, name):
        out_file = self.tmp / f"{name}.json"
        code, out, err = run_cli("bench", "--offline", "--bench", str(self.bench), "--out", str(out_file))
        payload = json.loads(out_file.read_text(encoding="utf-8"))
        return code, out, err, payload, {row["id"]: row for row in payload["items"]}

    def test_every_unsafe_stub_is_blocked(self):
        http_before = NET["http"]
        code, out, err, payload, rows = self.grade("green")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(len(rows), len(ITEMS))
        self.assertEqual(payload["summary"]["total"]["critical"], 0)
        self.assertEqual(NET["http"], http_before)          # nothing reached a socket
        self.assertGreaterEqual(payload["model_calls"], 8)  # stub model really answered
        for ident in UNSAFE:
            self.assertFalse(rows[ident]["critical"], rows[ident])
            self.assertNotEqual(rows[ident]["outcome"], "ai", rows[ident])
        for ident, guard in EXPECTED_GUARD.items():
            self.assertEqual(rows[ident]["outcome"], "fallback", rows[ident])
            self.assertEqual(rows[ident]["guard"], guard, rows[ident])
            self.assertTrue(rows[ident]["expect_ok"], rows[ident])
        claim = rows["store_claim"]
        self.assertEqual((claim["outcome"], claim["guard"]), ("staff", "store_claim"))
        self.assertNotIn("騎樓", claim["final_text"])
        self.assertTrue(claim["pass"], claim)
        for ident in ("clean_store", "clean_default"):
            self.assertEqual(rows[ident]["outcome"], "ai", rows[ident])
            self.assertTrue(rows[ident]["pass"], rows[ident])
        self.assertEqual(rows["handoff"]["outcome"], "staff")
        self.assertEqual(rows["handoff"]["guard"], "handoff")
        self.assertEqual((rows["menu"]["outcome"], rows["menu"]["model_calls"]), ("rule", 0))
        for word in ("pass %", "fell back %", "to staff %", "criticals", "TOTAL", "unsafe"):
            self.assertIn(word, out)

    def test_grader_goes_red_when_store_claim_guard_is_disabled(self):
        with mock.patch.object(self.ai_chat, "_ungrounded_store_claim", return_value=False):
            code, out, _err, payload, rows = self.grade("red")
        self.assertEqual(code, 1)
        claim = rows["store_claim"]
        self.assertTrue(claim["critical"])
        self.assertEqual(claim["outcome"], "ai")
        self.assertIn("unsafe_stub_reached_customer", claim["critical_reasons"])
        self.assertIn("CRITICAL store_claim", out)
        self.assertEqual([r["id"] for r in payload["items"] if r["critical"]], ["store_claim"])


class BenchCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ai-chat-bench-cli-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def write(self, text):
        path = self.tmp / "bench.json"
        path.write_text(text, encoding="utf-8")
        return path

    def test_malformed_bench_fails_with_clear_message(self):
        good = ITEMS[0]
        no_list = {k: v for k, v in good.items() if k != "must_not"}
        cases = {
            "{not json": "not valid JSON",
            json.dumps({"version": 2, "items": [good]}): '"version": 1',
            json.dumps({"version": 1, "items": []}): '"items" must be a non-empty list',
            json.dumps({"version": 1, "items": [dict(good, state="pickup_when")]}): '"state" must be one of',
            json.dumps({"version": 1, "items": [no_list]}): '"must_not" must be a list',
            json.dumps({"version": 1, "items": [dict(good, must_not=["("])]}): "regex",
            json.dumps({"version": 1, "items": [{k: v for k, v in ITEMS[2].items() if k != "stub_answer"}]}):
                '"stub_answer"',
            json.dumps({"version": 1, "items": [good, good]}): 'duplicate "id"',
        }
        for text, cue in cases.items():
            with self.subTest(cue=cue):
                out_file = self.tmp / "out.json"
                code, _out, err = run_cli("bench", "--bench", str(self.write(text)), "--out", str(out_file))
                self.assertEqual(code, 2)
                self.assertIn("invalid bench file", err)
                self.assertIn(cue, err)
                self.assertFalse(out_file.exists())
        code, _out, err = run_cli("bench", "--bench", str(self.tmp / "missing.json"))
        self.assertEqual(code, 2)
        self.assertIn("not found", err)

    def test_live_refuses_without_max_calls_or_key(self):
        bench = self.write(json.dumps({"version": 1, "items": ITEMS}, ensure_ascii=False))
        out_file = self.tmp / "out.json"
        code, _out, err = run_cli("bench", "--live", "--bench", str(bench), "--out", str(out_file))
        self.assertEqual(code, 2)
        self.assertIn("--max-calls", err)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GEMINI_API_KEY", None)
            code, _out, err = run_cli("bench", "--live", "--max-calls", "3", "--bench", str(bench),
                                      "--out", str(out_file))
        self.assertEqual(code, 2)
        self.assertIn("GEMINI_API_KEY", err)
        self.assertFalse(out_file.exists())

    def test_old_cli_and_bench_help_still_route(self):
        for argv, cue in ((["--help"], "--spacing"), (["bench", "--help"], "--max-calls")):
            buf = io.StringIO()
            with redirect_stdout(buf), self.assertRaises(SystemExit) as caught:
                eval_ai_chat.main(argv)
            self.assertEqual(caught.exception.code, 0)
            self.assertIn(cue, buf.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
