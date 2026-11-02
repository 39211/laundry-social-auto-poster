"""Plain-unittest coverage for scripts/nightly_checks_helpers.py.

CI runs this as its own step (`python -m unittest discover -s test/py -v`) so a
python-side regression fails here with a python traceback, not through a node
subprocess. The same cases are also asserted from test/nightlyChecks.test.ts.
"""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import nightly_checks_helpers as n  # noqa: E402


def cal(*captions_by_slot):
    return {"slots": [{"slot": slot, "instagram_caption": caption} for slot, caption in captions_by_slot]}


class ReadyChainTests(unittest.TestCase):
    def test_quiet_only_when_task_present_scheduled_and_can_wake(self):
        self.assertEqual(n.ready_chain_breaks("Ready|True|2026-08-18 06:30:00"), [])
        self.assertEqual(n.ready_chain_breaks("MISSING||"), ["排程不在"])
        self.assertEqual(n.ready_chain_breaks("Ready|False|2026-08-18 06:30:00"), ["叫不醒"])
        self.assertEqual(n.ready_chain_breaks("Ready|True|"), ["觸發器沒有下次"])
        self.assertEqual(n.ready_chain_breaks(""), ["排程探測空"])
        self.assertEqual(n.ready_chain_breaks(None), ["排程探測空"])

    def test_powershell_true_literal_counts_as_wake(self):
        self.assertEqual(n.ready_chain_breaks("Ready|$true|2026-08-18 06:30:00"), [])


class TodayImageTests(unittest.TestCase):
    def test_cover_path_and_fix_are_for_the_given_day(self):
        self.assertEqual(n.today_image_path("2026-08-17", 1), "docs/assets/2026-08-17/slot-01.png")
        fix = n.today_image_fix("2026-08-17")
        self.assertIn("invalidate", fix)
        self.assertIn("--date 2026-08-17", fix)
        self.assertIn("generate-missing-images.ps1 -Date 2026-08-17", fix)
        self.assertNotIn("2026-08-18", fix)


class ConversionFieldTests(unittest.TestCase):
    CASES = [
        ("提問", "直接點這裡問:https://39211.github.io/go/line.html?source=post", False),
        ("提問", "你現在最想處理掉的是哪一件？", True),
        ("提問", "還沒決定?", True),
        ("價格線索", "衣櫃塞到關不起來的朋友", False),
        ("價格線索", "看起來還好", False),
        ("價格線索", "參考價：運動鞋 $250", True),
        ("價格線索", "運動鞋兩百五、250元", True),
        ("價格線索", "運動鞋 250起", True),
        ("收送句", "台中市區到府收", True),
        ("收送句", "先拍一張再決定", False),
        ("聯絡方式", "加 LINE:0968327653", True),
    ]

    def test_url_query_mark_and_bare_qi_are_not_hits(self):
        for name, text, expected in self.CASES:
            with self.subTest(name=name, text=text):
                self.assertIs(n.caption_has(name, text), expected)

    def test_generator_defect_needs_two_bad_days(self):
        pickup = "台中市區免費到府收送。你住哪一區？ LINE 0968"
        no_pickup = "看起來還好。直接點 https://x.test/go/line.html?source=post 加 LINE 0968"
        good = cal((1, pickup), (2, pickup))
        bad = cal((1, no_pickup), (2, no_pickup), (3, pickup))
        quiet = [r["what"] for r in n.conversion_generator_findings(bad, good, "2026-08-16", "2026-08-17")]
        hot = [r["what"] for r in n.conversion_generator_findings(bad, bad, "2026-08-16", "2026-08-17")]
        self.assertNotIn("產生器沒寫收送", quiet)
        self.assertEqual(hot.count("產生器沒寫收送"), 1)

    def test_missing_calendar_is_not_a_generator_defect(self):
        self.assertFalse(n.generator_lacks("收送句", None, cal((1, "x"))))
        self.assertFalse(n.generator_lacks("收送句", cal((1, "x"))))


class LogSeverityTests(unittest.TestCase):
    def test_missing_log_stays_med_when_day_still_posted_or_committed(self):
        self.assertIsNone(n.opt_log_severity(True, False, False))
        self.assertEqual(n.opt_log_severity(False, True, False), "MED")
        self.assertEqual(n.opt_log_severity(False, False, True), "MED")
        self.assertEqual(n.opt_log_severity(False, False, False), "HIGH")


if __name__ == "__main__":
    unittest.main()
