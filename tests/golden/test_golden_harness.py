# -*- coding: utf-8 -*-
"""Tests for tests/golden/run_golden.py (task card D1-2). Standard library only.

    python tests/golden/test_golden_harness.py -v

Temporary files live in tests/golden/.golden-test-<hex>/ (plain mkdir, like the harness sandbox,
so Python 3.14's restrictive mkdtemp ACL never applies) and are removed afterwards.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "run_golden.py"
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import run_golden as rg  # noqa: E402  (module import installs nothing)

TEST_PREFIX = ".golden-test-"
TIMEOUT = 900
FORBIDDEN = rg.load_forbidden_roots()
CHECKOUT_BLOCKED = rg.is_blocked(rg.REPO_ROOT, FORBIDDEN)
SKIP_REASON = "checkout sits under a protected production path; run from a branch worktree"

CASES = {
    "format": "linebot-golden-cases/1",
    "default_clock": "2030-01-09T14:00:00+08:00",
    "notes": ["synthetic 3-case file written by test_golden_harness.py"],
    "cases": [
        {"id": "t-greeting-follow", "topic": "greeting", "title": "follow event",
         "turns": [{"type": "follow"}]},
        {"id": "t-hours-today", "topic": "hours", "title": "open today question",
         "turns": [{"type": "message", "text": "今天有開嗎"}]},
        {"id": "t-richmenu-prices", "topic": "richmenu", "title": "price menu then sticker",
         "clock": "2030-01-12T11:00:00+08:00",
         "turns": [{"type": "message", "text": "價目表"}, {"type": "sticker"}]},
    ],
}
EXTRA_CASE = {"id": "t-unknown-extra", "topic": "unknown", "title": "extra case",
              "turns": [{"type": "message", "text": "嗯嗯嗯"}]}


def run_harness(*args: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k.upper() != "GOLDEN_REEXEC"}
    return subprocess.run([sys.executable, str(HARNESS), *args], cwd=str(rg.REPO_ROOT), env=env,
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT)


def write_json(path: Path, doc: dict) -> None:
    path.write_bytes(json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"))


def flip_one_reply_byte(golden: bytes) -> tuple[bytes, str]:
    """Change one character of the first reply text so that exactly one UTF-8 byte differs."""
    doc = json.loads(golden.decode("utf-8"))
    for case in doc["cases"]:
        for turn in case["turns"]:
            output = turn.get("output") if isinstance(turn.get("output"), dict) else {}
            for message in output.get("messages") or []:
                text = message.get("text") if isinstance(message, dict) else None
                if not isinstance(text, str):
                    continue
                for index, char in enumerate(text):
                    if not (char.isalnum() or ord(char) > 0x7F):
                        continue
                    new = chr(ord(char) ^ 1)
                    if new.isprintable() and new not in '"\\' and not 0xD800 <= ord(new) <= 0xDFFF:
                        message["text"] = text[:index] + new + text[index + 1:]
                        return rg.canonical_bytes(doc), case["id"]
    raise AssertionError("no reply text found in the golden file")


class GuardUnitTest(unittest.TestCase):
    def test_guard_refuses_real_repo_data(self) -> None:
        private = (rg.norm_path(rg.REPO_ROOT / "data"),)
        guard = rg.Guard(FORBIDDEN + private, [])
        others = [root for root in FORBIDDEN if root != "c:/fxwash"]
        self.assertTrue(others, "run_a2b_tests.py should list the real repo as a forbidden root")
        for root in others:
            self.assertEqual(guard.classify(root + "/data/prices.json"), "forbidden")
            self.assertEqual(guard.classify(root.upper().replace("/", "\\") + "\\DATA\\x.json"), "forbidden")
        self.assertEqual(guard.classify("c:/fxwash/data/x.json"), "forbidden")
        self.assertEqual(guard.classify(rg.REPO_ROOT / "data" / "prices.json"), "forbidden")
        if not CHECKOUT_BLOCKED:
            self.assertIsNone(guard.classify(HERE / "linebot_cases.json"))


@unittest.skipIf(CHECKOUT_BLOCKED, SKIP_REASON)
class GoldenHarnessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.work = HERE / (TEST_PREFIX + uuid.uuid4().hex)
        cls.work.mkdir()
        cls.addClassCleanup(cls._remove_work)
        cls.cases = cls.work / "cases.json"
        cls.golden = cls.work / "golden.json"
        write_json(cls.cases, CASES)
        cls.record = run_harness("record", "--cases", str(cls.cases), "--golden", str(cls.golden))

    @classmethod
    def _remove_work(cls) -> None:
        if cls.work.parent == HERE and cls.work.name.startswith(TEST_PREFIX):
            shutil.rmtree(cls.work, ignore_errors=True)

    def assertExit(self, proc: subprocess.CompletedProcess, code: int) -> None:
        self.assertEqual(proc.returncode, code,
                         f"exit {proc.returncode}\n--- stdout\n{proc.stdout}\n--- stderr\n{proc.stderr}")

    def golden_bytes(self) -> bytes:
        self.assertExit(self.record, 0)
        return self.golden.read_bytes()

    def test_record_then_check_passes(self) -> None:
        data = self.golden_bytes()
        self.assertIn("double run byte-identical", self.record.stdout)
        doc = json.loads(data.decode("utf-8"))
        self.assertEqual([c["id"] for c in doc["cases"]], [c["id"] for c in CASES["cases"]])
        self.assertEqual(data, rg.canonical_bytes(doc), "golden must be canonical JSON")
        proc = run_harness("check", "--cases", str(self.cases), "--golden", str(self.golden))
        self.assertExit(proc, 0)
        self.assertIn("OK: 3 cases byte-identical", proc.stdout)

    def test_env_matrix_passes(self) -> None:
        self.golden_bytes()
        proc = run_harness("check", "--env-matrix", "--cases", str(self.cases), "--golden", str(self.golden))
        self.assertExit(proc, 0)
        self.assertIn("[OK] SXJ_SHOP_ID unset", proc.stdout)
        self.assertIn("[OK] SXJ_SHOP_ID=sxj", proc.stdout)

    def test_changed_reply_byte_fails(self) -> None:
        original = self.golden_bytes()
        changed, case_id = flip_one_reply_byte(original)
        self.assertEqual(len(changed), len(original))
        self.assertEqual(sum(a != b for a, b in zip(changed, original)), 1)
        tampered = self.work / "golden-tampered.json"
        tampered.write_bytes(changed)
        proc = run_harness("check", "--cases", str(self.cases), "--golden", str(tampered))
        self.assertExit(proc, 1)
        self.assertIn("DIFFERENCE between this run and golden", proc.stdout)
        self.assertIn(f"first differing case: {case_id}", proc.stdout)
        self.assertIn("first differing line", proc.stdout)

    def test_extra_case_is_reported(self) -> None:
        self.golden_bytes()
        extended = self.work / "cases-extra.json"
        write_json(extended, dict(CASES, cases=CASES["cases"] + [EXTRA_CASE]))
        proc = run_harness("check", "--cases", str(extended), "--golden", str(self.golden))
        self.assertExit(proc, 1)
        self.assertIn("extra case (in this run, not in golden): t-unknown-extra", proc.stdout)

    def test_guard_selftest_refuses_real_repo_data(self) -> None:
        proc = run_harness("guard-selftest")
        self.assertExit(proc, 0)
        for index, root in enumerate(FORBIDDEN):
            name = root if root == "c:/fxwash" else f"forbidden root #{index}"
            self.assertIn(f"[refused] open {name}/data/prices.json", proc.stdout)
        self.assertIn("[refused] open checkout data/prices.json", proc.stdout)
        self.assertNotIn("NOT REFUSED", proc.stdout)

    def test_golden_path_under_real_repo_data_is_refused(self) -> None:
        root = next(r for r in FORBIDDEN if r != "c:/fxwash")
        target = root + "/data/golden-probe.json"  # never touched: refused before any file access
        proc = run_harness("record", "--cases", str(self.cases), "--golden", target)
        self.assertExit(proc, 2)
        self.assertIn("protected path", proc.stderr)

    def test_malformed_case_file_exits_2(self) -> None:
        bad = self.work / "bad.json"
        bad.write_text('{"format": "linebot-golden-cases/1", "cases": [', encoding="utf-8")
        proc = run_harness("check", "--cases", str(bad), "--golden", str(self.golden))
        self.assertExit(proc, 2)
        self.assertIn("not valid JSON", proc.stderr)
        schema = self.work / "bad-schema.json"
        write_json(schema, dict(CASES, cases=[dict(CASES["cases"][0], turns=[{"type": "video"}])]))
        proc = run_harness("check", "--cases", str(schema), "--golden", str(self.golden))
        self.assertExit(proc, 2)
        self.assertIn("unknown turn type", proc.stderr)


if __name__ == "__main__":
    unittest.main()
