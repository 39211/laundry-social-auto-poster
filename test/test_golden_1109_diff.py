"""OPS-GOLDEN r1: only the observed, approved 11/09 golden edits are allowed.

Run: python -B -X utf8 test/test_golden_1109_diff.py -v
The baseline is pinned to the task's base commit, never the moving HEAD. Git is
read-only. This test needs that local commit; it never fetches missing objects.
B has an empty allowlist: all 85 cases were compared and no PHOTO-FIX delta was
observed. A photo case name alone must never authorize arbitrary changes.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = ROOT / "tests/golden/linebot.golden.json"
BASE_COMMIT = "7598f8a1799179a1e3ca9383651dcde906c82507"
BASE_SHA256 = "531e500510cafb46921ed6031c6d692f6d2a571b86c11b813028c8507dab829a"
RUSH_CASE = "turnaround-rush-tomorrow"
NOTICE = "急件可能另計費用，由店員報價。"

spec = importlib.util.spec_from_file_location("golden_1109_harness", GOLDEN.parent / "run_golden.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)  # Definitions only; no product imports or guards.


def read_baseline() -> bytes:
    return subprocess.run(
        ["git", "show", f"{BASE_COMMIT}:tests/golden/linebot.golden.json"],
        cwd=ROOT, check=True, capture_output=True, timeout=30,
    ).stdout


def rush_message(doc: dict) -> dict:
    cases = [case for case in doc["cases"] if case["id"] == RUSH_CASE]
    if len(cases) != 1:
        raise AssertionError(f"expected exactly one {RUSH_CASE} case")
    return cases[0]["turns"][0]["output"]["messages"][1]


def validate_diff(before: bytes, after: bytes) -> None:
    """Require the exact A suffix and byte-identical rollback of the whole file."""
    if hashlib.sha256(before).hexdigest() != BASE_SHA256:
        raise AssertionError("baseline is not the frozen OPS-GOLDEN r1 input")
    old = json.loads(before)
    new = json.loads(after)
    old_text = rush_message(old)["text"]
    new_text = rush_message(new)["text"]
    if NOTICE in old_text or new_text != old_text + NOTICE:
        raise AssertionError(f"A: {RUSH_CASE} must append the exact notice once at the original text's end")
    restored = copy.deepcopy(new)
    rush_message(restored)["text"] = new_text[:-len(NOTICE)]
    if harness.canonical_bytes(restored) != before:
        raise AssertionError("C: unapproved difference remains after undoing A; B allowlist is empty.\n" +
                             harness.first_difference(harness.canonical_bytes(restored), before,
                                                      "restored candidate", "frozen baseline"))
    expected = copy.deepcopy(old)
    rush_message(expected)["text"] = old_text + NOTICE
    if after != harness.canonical_bytes(expected):
        raise AssertionError("C: golden serialization changed outside the approved suffix")


class Golden1109DiffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = read_baseline()

    def test_only_approved_a_b_differences(self):
        validate_diff(self.before, GOLDEN.read_bytes())

    def test_allowlist_rejects_unapproved_edits(self):
        # Build the approved candidate from the frozen baseline, independently
        # of the working golden, then challenge each boundary.
        good = json.loads(self.before)
        rush_message(good)["text"] += NOTICE
        validate_diff(self.before, harness.canonical_bytes(good))
        mutations = (
            "missing_notice", "duplicate_notice", "changed_original_text",
            "non_rush_sentence", "photo_sentence", "metadata", "missing_case",
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                bad = copy.deepcopy(good)
                if mutation == "missing_notice":
                    rush_message(bad)["text"] = rush_message(bad)["text"][:-len(NOTICE)]
                elif mutation == "duplicate_notice":
                    rush_message(bad)["text"] += NOTICE
                elif mutation == "changed_original_text":
                    rush_message(bad)["text"] = "未核准句。" + rush_message(bad)["text"]
                elif mutation in ("non_rush_sentence", "photo_sentence"):
                    case = next(c for c in bad["cases"]
                                if c["topic"] == ("photo" if mutation == "photo_sentence" else "greeting"))
                    case["turns"][0]["output"]["messages"][0]["text"] += "未核准句。"
                elif mutation == "metadata":
                    bad["harness"]["zoneinfo_asia_taipei"] = True
                else:
                    bad["cases"].pop()
                with self.assertRaises(AssertionError):
                    validate_diff(self.before, harness.canonical_bytes(bad))
        with self.assertRaises(AssertionError):
            validate_diff(self.before, harness.canonical_bytes(good) + b"\n")


if __name__ == "__main__":
    unittest.main()
