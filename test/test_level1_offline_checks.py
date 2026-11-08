"""Evidence parsing must not turn an exit code, empty run or skip into green."""
import unittest
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from unittest import mock
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

    def test_producer_uses_separate_snapshot_keeps_source_and_dates_and_golden_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            source, output, workspace = (base / n for n in ("repo", "results", "work"))
            (source / "line-bot").mkdir(parents=True)
            (source / "line-bot/test_handoff.py").write_text("# synthetic test module\n", encoding="utf-8")
            private = source / "line-bot/.runtime/customer.py"
            private.parent.mkdir()
            private.write_text("PRIVATE_DO_NOT_COPY", encoding="utf-8")
            (source / "line-bot/customer.json").write_text('{"uid":"PRIVATE"}', encoding="utf-8")
            original = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()}
            calls = []

            def fake_run(snapshot, script, args, logs, label, env, timeout):
                calls.append((script, timeout))
                self.assertTrue(snapshot.is_relative_to(workspace))
                self.assertNotIn("LAUNDRY_TEST_TOKEN", env)
                self.assertTrue(Path(env["TEMP"]).is_relative_to(workspace))
                return {"status": "pass", "tests": 2, "failures": 0, "errors": 0, "skipped": 0, "suite": label}

            stamp = datetime(2026, 11, 8, 22, 50, tzinfo=checks.TAIPEI)
            with mock.patch.object(checks, "run_check", side_effect=fake_run), \
                    mock.patch.dict(checks.os.environ, {"LAUNDRY_TEST_TOKEN": "SYNTHETIC"}):
                path = checks.produce(source, output, now=stamp, work_root=workspace)
            self.assertEqual(path, output / "output/operations/level1-checks-2026-11-08.json")
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(data["date"], "2026-11-08")
            self.assertEqual(data["generated_at"], stamp.isoformat(timespec="seconds"))
            self.assertTrue(data["offline"])
            self.assertEqual(data["checks"]["handoff"]["status"], "pass")
            self.assertEqual([t for script, t in calls if script.startswith("tests/golden/")], [300])
            self.assertLess(checks.RUN_BUDGET_SECONDS, 15*60)
            self.assertEqual(set(data["source_manifest"]), {"line-bot/test_handoff.py"})
            self.assertEqual(original, {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()})

    def test_timeout_keeps_partial_diagnostics_and_never_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            error = subprocess.TimeoutExpired("synthetic", 300, output=b"partial golden", stderr=b" diagnostic")
            with mock.patch.object(checks.subprocess, "run", side_effect=error):
                result = checks.run_check(root, "tests/golden/run_golden.py", ["check"], root, "golden", {}, timeout=300)
            self.assertEqual(result["status"], "no_data")
            self.assertEqual(result["runner_error"], "TimeoutExpired")
            self.assertIn("partial golden diagnostic", Path(result["log"]).read_text(encoding="utf-8"))

    def test_exhausted_daily_budget_writes_incomplete_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "line-bot").mkdir()
            with mock.patch.object(checks, "RUN_BUDGET_SECONDS", 0), mock.patch.object(checks, "run_check") as run:
                path = checks.produce(root, root / "results", work_root=root / "work")
            run.assert_not_called()
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual({r["status"] for r in data["checks"].values()}, {"no_data"})

    def test_workspace_in_production_is_rejected_before_mkdir(self):
        with mock.patch.object(checks.Path, "mkdir") as mkdir:
            with self.assertRaises(ValueError):
                checks.produce(Path.cwd(), Path.cwd(), work_root="C:/Users/cyc39/laundry-repo/output/snapshot")
        mkdir.assert_not_called()

    def test_missing_d_drive_never_falls_back_to_c(self):
        with mock.patch.object(checks.Path, "is_dir", return_value=False), mock.patch.object(checks.Path, "mkdir") as mkdir:
            with self.assertRaises(ValueError):
                checks.produce(Path.cwd(), Path.cwd(), work_root="D:/AI-Lanes-work/level1-offline-checks")
        mkdir.assert_not_called()

    def test_pos_cannot_be_source_or_output(self):
        with mock.patch.object(checks.Path, "mkdir") as mkdir:
            for source, output in (("C:/fxwash", Path.cwd()), (Path.cwd(), "C:/fxwash")):
                with self.assertRaises(ValueError):
                    checks.produce(source, output, work_root=Path.cwd() / "work")
        mkdir.assert_not_called()

    def test_day_audit_invokes_producer_in_isolation_without_running_rescues(self):
        # Extract exactly the new block: executing all of day-audit would run
        # production rescues. Stub the interpreter, not the PowerShell block.
        root = Path(__file__).resolve().parents[1]
        source = (root / "scripts/day-audit.ps1").read_text(encoding="utf-8-sig")
        self.assertEqual(source.count("# OPS-L1-12 offline checks begin"), 1)
        block = source.split("# OPS-L1-12 offline checks begin", 1)[1].split("# OPS-L1-12 offline checks end", 1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            stub = base / "stub.ps1"
            stub.write_text("[IO.File]::WriteAllText($env:L1_CALL_ARGS, ($args | ConvertTo-Json -Compress)); exit 0", encoding="utf-8-sig")
            block = block.replace("'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe'", "'" + str(stub).replace("'", "''") + "'")
            harness = base / "harness.ps1"
            # Test-Path is scoped to this harness only. No actual disk probing,
            # scheduler, LINE, GA4, publish or notification action is executed.
            harness.write_text("function Test-Path { return $true }\n$root = $env:L1_TEST_ROOT\n"
                               "$PSScriptRoot = Join-Path $root 'scripts'\n$logFile = $env:L1_TEST_LOG\n" + block,
                               encoding="utf-8-sig")
            args_file = base / "args.json"
            env = dict(checks.os.environ, L1_CALL_ARGS=str(args_file), L1_TEST_ROOT=str(base), L1_TEST_LOG=str(base / "run.log"))
            result = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(harness)],
                                    env=env, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
            arguments = json.loads(args_file.read_text(encoding="utf-8-sig"))
            self.assertIn(str(base / "scripts/level1_offline_checks.py"), arguments)
            self.assertEqual(arguments[arguments.index("--root") + 1], str(base))
            self.assertEqual(arguments[arguments.index("--out-root") + 1], str(base))
            self.assertEqual(arguments[arguments.index("--work-root") + 1], "D:/AI-Lanes-work/level1-offline-checks")


if __name__ == "__main__":
    unittest.main()
