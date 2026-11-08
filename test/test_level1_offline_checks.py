"""Evidence parsing must not turn an exit code, empty run or skip into green."""
import unittest
from pathlib import Path
import tempfile
import level1_offline_checks as checks


class OfflineEvidenceTests(unittest.TestCase):
    def test_full_discovery_includes_nested_regressions(self):
        with tempfile.TemporaryDirectory() as tmp:
            bot = Path(tmp)
            (bot / "tests").mkdir()
            (bot / "test_handoff.py").write_text("", encoding="utf-8")
            (bot / "tests/test_webhook_reply_first.py").write_text("", encoding="utf-8")
            self.assertEqual(checks.discover_modules(bot), ["test_handoff", "tests.test_webhook_reply_first"])

    def test_exit_zero_without_cases_is_not_pass(self):
        self.assertEqual(checks.parse_result("OK", 0)["status"], "no_data")
        self.assertEqual(checks.parse_result("Ran 0 tests in 0.0s\nOK", 0)["status"], "no_data")

    def test_completed_unittest_pass_failure_and_skip(self):
        for output, code, want in (("Ran 4 tests in 1.0s\nOK\n", 0, "pass"),
                                   ("Ran 4 tests in 1.0s\nFAILED (failures=1)", 1, "fail"),
                                   ("Ran 4 tests in 1.0s\nOK (skipped=1)", 0, "no_data")):
            with self.subTest(output=output):
                self.assertEqual(checks.parse_result(output, code)["status"], want)

    def test_golden_requires_real_case_summary(self):
        self.assertEqual(checks.parse_result("OK: 60 cases byte-identical to fixed.json", 0, True)["tests"], 60)
        self.assertEqual(checks.parse_result("", 0, True)["status"], "no_data")
        self.assertEqual(checks.parse_result("different", 1, True)["status"], "fail")

    def test_combination_incomplete_and_fail_are_not_green(self):
        passed = checks.parse_result("Ran 2 tests in 1s\nOK", 0)
        missing = checks.parse_result("", 0)
        failed = checks.parse_result("Ran 1 test in 1s\nFAILED (errors=1)", 1)
        self.assertEqual(checks.combine([])["status"], "no_data")
        self.assertEqual(checks.combine([passed, missing])["status"], "no_data")
        self.assertEqual(checks.combine([passed, failed])["status"], "fail")


if __name__ == "__main__":
    unittest.main()
