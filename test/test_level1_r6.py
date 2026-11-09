"""R6: zero-case modules need a real, isolated __main__ run before passing."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import level1_offline_checks as checks
from test_level1_r5 import make_repo

ROOT = Path(__file__).resolve().parents[1]
NATIVE_FILES = ("line-bot/run_a2b_tests.py", "line-bot/test-assets/offline_temp.py",
                "line-bot/test_linebot_fix_20260926.py")
UNIT = ("import unittest\nclass Probe(unittest.TestCase):\n"
        "    def test_ok(self): self.assertTrue(True)\n")
SCRIPT = '''import json, os, sys, tempfile
from pathlib import Path
def main():
    repo = Path(os.environ['LAUNDRY_REPO_ROOT'])
    assert repo.is_relative_to(Path.cwd())
    assert Path(tempfile.gettempdir()).is_relative_to(Path.cwd())
    assert os.environ['LAUNDRY_AI_CHAT'] == 'off'
    assert os.environ['LAUNDRY_LOOKUP_FIXTURE'] == '1'
    assert Path(os.environ['LAUNDRY_EHANK_ROOT']) == repo / 'no-pos'
    fixture = json.loads((repo / 'data/laundry-fixture.json').read_text())
    assert {r['no'] for r in fixture['customers']} == {'0028', '1947'}
    for event, args in [('socket.connect', (None, ('203.0.113.1', 443))),
                        ('open', ('C:/fxwash/SYNTHETIC', 'r', 0))]:
        try:
            sys.audit(event, *args)
        except PermissionError:
            pass
        else:
            raise AssertionError('native guard missing: ' + event)
    with Path('script-ran.jsonl').open('a') as stream:
        stream.write(json.dumps({'module': Path(__file__).name,
                                 'repo': str(repo), 'temp': tempfile.gettempdir()}) + '\\n')
    return EXIT_CODE
if __name__ == '__main__':
    raise SystemExit(main())
'''


class ScriptModuleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / "repo"

    def produce(self, body, extra=None):
        files = {name: (ROOT / name).read_text(encoding="utf-8-sig") for name in NATIVE_FILES}
        files.update({"data/prices.json": '{"\u8863\u7269": {}, "\u5be2\u5177": {}, "\u5176\u4ed6": {}}',
                      "data/business-profile.json": "{}",
                      "line-bot/test_handoff.py": UNIT,
                      "line-bot/tests/test_audit_a_conv.py": UNIT,
                      "line-bot/tests/test_audit_a_quote.py": UNIT,
                      "line-bot/test_probe.py": body,
                      "tests/golden/run_golden.py": "print('OK: 2 cases byte-identical')\n"})
        files.update(extra or {})
        make_repo(self.source, files)
        # The copied shim is a dependency, not part of this synthetic test corpus.
        corpus = [name for name in checks.discover_modules(self.source / "line-bot")
                  if name != "test_linebot_fix_20260926"]
        with mock.patch.object(checks, "discover_modules", return_value=corpus):
            path = checks.produce(self.source, self.base / "out", work_root=self.base / "work")
        self.receipt = json.loads(path.read_text(encoding="utf-8"))
        self.bot = Path(self.receipt["snapshot"]) / "line-bot"
        self.full = self.receipt["checks"]["line_full"]
        self.row = next(r for r in self.full["suites"] if r["suite"] == "test_probe")
        self.assertEqual(self.receipt["budget_seconds"], 780)
        self.assertFalse(list(self.bot.glob(".a2b-test-tmp-*")))
        for name in NATIVE_FILES:
            self.assertEqual((self.source / name).read_bytes(),
                             (Path(self.receipt["snapshot"]) / name).read_bytes())
        return self.row

    def test_script_exit_zero_runs_main_and_passes_one_case(self):
        row = self.produce(SCRIPT.replace("EXIT_CODE", "0"))
        self.assertEqual(row["status"], "pass", row)
        self.assertEqual(row["tests"], 1)
        self.assertEqual(row.get("execution_mode"), "script")
        self.assertEqual(row["exit_code"], 0)
        self.assertEqual(self.full["status"], "pass")
        self.assertEqual(row["discovery"]["status"], "no_data")
        self.assertEqual(row["discovery"]["tests"], 0)
        self.assertNotEqual(row["log"], row["discovery"]["log"])
        events = (self.bot / "script-ran.jsonl").read_text().splitlines()
        self.assertEqual(len(events), 1, "__main__ must really run, exactly once")
        self.assertLess(row["timeout_seconds"], 90)

    def test_script_nonzero_makes_line_full_fail_with_log_tail(self):
        body = SCRIPT.replace("EXIT_CODE", "1").replace("    return 1", "    print('SCRIPT_FAILED_SENTINEL')\n    return 1")
        row = self.produce(body)
        self.assertEqual(self.full["status"], "fail", self.full)
        self.assertEqual(row["status"], "fail")
        self.assertEqual(row["exit_code"], 1)
        self.assertEqual(row["tests"], 1)
        self.assertIn("SCRIPT_FAILED_SENTINEL", row["failure_detail"])

    def test_empty_module_stays_no_data(self):
        row = self.produce("# no cases and no entrypoint\n")
        self.assertEqual(row["status"], "no_data", row)
        self.assertEqual(self.full["status"], "no_data")
        self.assertEqual(row["tests"], 0)
        self.assertNotIn("execution_mode", row)
        self.assertFalse((self.bot / "script-ran.jsonl").exists())

    def test_unittest_with_main_does_not_run_main(self):
        row = self.produce(UNIT + "if __name__ == '__main__':\n    raise RuntimeError('must not run')\n")
        self.assertEqual(row["status"], "pass", row)
        self.assertEqual(row["tests"], 1)
        self.assertNotIn("execution_mode", row)

    def test_skipped_unittest_does_not_fall_back_to_main(self):
        row = self.produce(UNIT.replace("class Probe", "@unittest.skip('synthetic')\nclass Probe") +
                           "if __name__ == '__main__':\n    raise RuntimeError('must not run')\n")
        self.assertEqual(row["status"], "no_data", row)
        self.assertEqual(row["skipped"], 1)
        self.assertNotIn("execution_mode", row)

    def test_function_tests_stay_native(self):
        row = self.produce("def test_probe(): assert True\n"
                           "if __name__ == '__main__':\n    raise RuntimeError('must not run')\n")
        self.assertEqual(row["status"], "pass", row)
        self.assertNotIn("execution_mode", row)

    def test_scripts_and_discovery_get_distinct_temp_roots(self):
        body = SCRIPT.replace("EXIT_CODE", "0")
        body = body.replace("def main():", "with Path('imports.jsonl').open('a') as stream:\n"
                            "    stream.write(json.dumps(os.environ['LAUNDRY_REPO_ROOT']) + '\\n')\n"
                            "def main():")
        self.produce(body, {"line-bot/tests/test_second.py": body})
        imports = [json.loads(x) for x in (self.bot / "imports.jsonl").read_text().splitlines()]
        self.assertEqual(len(imports), 4)
        self.assertEqual(len(set(imports)), 4, "no temp reuse across discovery/main/modules")
        events = [json.loads(x) for x in (self.bot / "script-ran.jsonl").read_text().splitlines()]
        self.assertEqual([e["module"] for e in events], ["test_probe.py", "test_second.py"])
        self.assertEqual(self.full["status"], "pass")

    def test_import_error_with_main_is_not_retried(self):
        row = self.produce("raise RuntimeError('import failed')\n"
                           "if __name__ == '__main__':\n    pass\n")
        self.assertEqual(row["status"], "fail")
        self.assertNotIn("execution_mode", row)

    def test_script_timeout_is_fail_and_keeps_partial_log(self):
        runner = self.base / "line-bot/run_a2b_tests.py"
        runner.parent.mkdir()
        runner.write_text("# fixture", encoding="utf-8")
        error = subprocess.TimeoutExpired("synthetic", 1, output=b"SCRIPT_STARTED", stderr=b" TIMEOUT")
        with mock.patch.object(checks, "run_process", side_effect=error):
            row = checks.run_check(self.base, "line-bot/run_a2b_tests.py", ["test_probe"],
                                   self.base, "test_probe", {}, timeout=1, script_mode=True)
        self.assertEqual(row["status"], "fail", row)
        self.assertEqual(checks.combine([row])["status"], "fail")
        self.assertEqual(row["runner_error"], "TimeoutExpired")
        self.assertIn("SCRIPT_STARTED TIMEOUT", row["failure_detail"])

    def test_entrypoint_detection_rejects_comments_and_nested_guards(self):
        bot = self.base / "line-bot"
        bot.mkdir()
        path = bot / "test_probe.py"
        for body, want in (("# if __name__ == '__main__':\n", False),
                           ("def main():\n    if __name__ == '__main__': pass\n", False),
                           ("if __name__ != '__main__': pass\n", False),
                           ("if '__main__' == __name__:\n    pass\n", True)):
            path.write_text(body, encoding="utf-8")
            self.assertEqual(checks.has_script_entry(bot, "test_probe"), want)


if __name__ == "__main__":
    unittest.main()
