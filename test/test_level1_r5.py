"""R5 behavioral contract: archive HEAD, native sequential runners, truthful evidence."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import level1_offline_checks as checks


def make_repo(root, files=None):
    root.mkdir(parents=True, exist_ok=True)
    contents = {"line-bot/test_handoff.py": "# committed\n", "data/prices.json": "{}",
                "shop-pc/fxwash/config/Memory.md": "synthetic fixture",
                "tests/golden/fixture.json": "{}"}
    contents.update(files or {})
    for name, body in contents.items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    def git(*args):
        return subprocess.run(["git", "-c", "core.hooksPath=", "-c", "commit.gpgsign=false",
                               "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid",
                               *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
    git("init")
    git("add", ".")
    git("commit", "-m", "synthetic fixture")
    return git("rev-parse", "HEAD")


class ResultRulesTests(unittest.TestCase):
    def test_zero_cases_never_pass(self):
        for output, golden in (("Ran 0 tests in 0s\nOK", False), ("OK", False),
                               ("OK: 0 cases byte-identical", True), ("SKIP probe", False)):
            with self.subTest(output=output):
                self.assertEqual(checks.parse_result(output, 0, golden)["status"], "no_data")

    def test_nonzero_exit_never_pass(self):
        for code in (1, 2, 9, -1):
            for output, golden in (("Ran 4 tests in 1s\nOK", False), ("", False),
                                   ("PASS probe", False), ("OK: 85 cases byte-identical", True)):
                with self.subTest(code=code, output=output):
                    self.assertEqual(checks.parse_result(output, code, golden)["status"], "fail")

    def test_partial_skip_passes_but_skip_only_does_not(self):
        self.assertEqual(checks.parse_result("Ran 4 tests in 1s\nOK (skipped=1)", 0)["status"], "pass")
        self.assertEqual(checks.parse_result("Ran 4 tests in 1s\nOK (skipped=4)", 0)["status"], "no_data")

    def test_failed_names_and_last_unittest_summary(self):
        result = checks.parse_result("Ran 0 tests in 0s\nOK\nFAIL: test_wrong (Probe)\n"
                                     "ERROR: test_broken (Probe)\nRan 3 tests in 1s\n"
                                     "FAILED (failures=1, errors=1)", 1)
        self.assertEqual(result["tests"], 3)
        self.assertEqual(result["failed_tests"], ["test_wrong (Probe)", "test_broken (Probe)"])
        self.assertEqual(checks.parse_result("PASS a\nFAIL b\n", 1)["failed_tests"], ["b"])
        self.assertEqual(checks.parse_result("first differing case: pickup-probe at $", 1, True)
                         ["failed_tests"], ["pickup-probe"])


class ArchiveTests(unittest.TestCase):
    def test_snapshot_excludes_dirty_worktree_and_untracked_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root, snapshot = base / "repo", base / "snapshot"
            head = make_repo(root)
            (root / "line-bot/test_handoff.py").write_text("DIRTY", encoding="utf-8")
            (root / "line-bot/test_dirty.py").write_text("UNTRACKED", encoding="utf-8")
            (root / "data/customer-private.json").write_text("PRIVATE", encoding="utf-8")
            revision, manifest = checks.create_snapshot(root, snapshot, 15)
            self.assertEqual(revision, head)
            self.assertEqual((snapshot / "line-bot/test_handoff.py").read_text(), "# committed\n")
            self.assertFalse((snapshot / "line-bot/test_dirty.py").exists())
            self.assertFalse((snapshot / "data/customer-private.json").exists())
            self.assertNotIn("line-bot/test_dirty.py", manifest)
            self.assertTrue((snapshot / "shop-pc/fxwash/config/Memory.md").is_file())

    def test_producer_only_writes_receipt_to_source_and_runs_sequentially(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "repo"
            # Native-runner stand-in records real process ordering and only writes
            # beneath its archived cwd. The source deliberately contains a dirty file.
            runner = ("from pathlib import Path\nimport os, sys, time\n"
                      "p=Path('order.log')\n"
                      "assert os.environ['LAUNDRY_AI_CHAT']=='off'\n"
                      "with p.open('a') as f: f.write('START '+sys.argv[1]+'\\n')\n"
                      "time.sleep(0.03)\n"
                      "with p.open('a') as f: f.write('END '+sys.argv[1]+'\\n')\n"
                      "print('Ran 1 test in 0.03s\\nOK')\n")
            files = {"line-bot/run_a2b_tests.py": runner,
                     "tests/golden/run_golden.py": "print('OK: 2 cases byte-identical')\n",
                     "line-bot/tests/test_audit_a_conv.py": "# fixture",
                     "line-bot/tests/test_audit_a_quote.py": "# fixture",
                     "line-bot/test_second.py": "# fixture"}
            head = make_repo(root, files)
            (root / "line-bot/test_dirty.py").write_text("do not execute", encoding="utf-8")
            before = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in root.rglob("*") if p.is_file()}
            path = checks.produce_legacy(root, root, work_root=base / "work")
            after = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in root.rglob("*") if p.is_file() and p != path}
            self.assertEqual(before, after)
            receipt = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(receipt["source_head"], head)
            self.assertTrue(all(c["status"] == "pass" for c in receipt["checks"].values()))
            self.assertEqual(len(receipt["checks"]["line_full"]["suites"]), 4)
            order = (Path(receipt["snapshot"]) / "line-bot/order.log").read_text().splitlines()
            self.assertEqual(order, [f"{action} {module}" for module in
                                    ("test_audit_a_conv", "test_audit_a_quote", "test_handoff", "test_second")
                                    for action in ("START", "END")])

    def test_no_workspace_inside_source_before_any_write(self):
        root = Path.cwd()
        with mock.patch.object(checks.Path, "mkdir") as mkdir:
            with self.assertRaises(ValueError):
                checks.produce_legacy(root, root, work_root=root / "unsafe")
        mkdir.assert_not_called()

    def test_snapshot_failure_produces_no_data_and_no_runners(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "repo").mkdir()
            with mock.patch.object(checks, "run_check") as run:
                receipt = checks.produce_legacy(base / "repo", base / "out", work_root=base / "work")
            run.assert_not_called()
            data = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertTrue(data["snapshot_error"].startswith("SnapshotUnavailable:"))
            self.assertEqual({r["status"] for r in data["checks"].values()}, {"no_data"})


class NativeProcessTests(unittest.TestCase):
    def test_direct_runner_has_verified_command_cwd_and_no_wrapper(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            runner = base / "line-bot/run_a2b_tests.py"
            runner.parent.mkdir()
            runner.write_text("# native runner", encoding="utf-8")
            result = subprocess.CompletedProcess([], 0, "Ran 1 test in 0s\nOK", "")
            with mock.patch.object(checks, "run_process", return_value=result) as run:
                row = checks.run_check(base, "line-bot/run_a2b_tests.py", ["tests.test_probe"],
                                       base, "probe", {}, timeout=4)
            self.assertEqual(row["status"], "pass")
            self.assertEqual(run.call_args.args[0],
                             [sys.executable, "-B", "-X", "utf8", str(runner), "test_probe"])
            self.assertEqual(run.call_args.kwargs["cwd"], runner.parent)

    def test_timeout_stops_descendant_before_its_delayed_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            worker = base / "worker.py"
            worker.write_text("from pathlib import Path\nimport time\n"
                              "Path('ready').write_text('ready')\ntime.sleep(2)\n"
                              "Path('late').write_text('escaped')\n", encoding="utf-8")
            runner = base / "runner.py"
            runner.write_text("import subprocess, sys\n"
                              "subprocess.run([sys.executable, '-B', 'worker.py'])\n", encoding="utf-8")
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    checks.run_process([sys.executable, "-B", str(runner)], cwd=base,
                                       env=dict(os.environ), timeout=0.8)
            except RuntimeError as exc:
                if os.name != "nt" or "Access denied" not in str(exc):
                    raise
                # Restricted Codex token denies taskkill /T. Let this short-lived
                # synthetic child exit; never label unverified tree cleanup PASS.
                time.sleep(2.5)
                self.skipTest("taskkill /T Access denied in sandbox; normal-user replay required")
            self.assertTrue((base / "ready").is_file(), "worker must actually have started")
            time.sleep(1.5)
            self.assertFalse((base / "late").exists(), "descendant survived the timeout")

    def test_missing_runner_is_no_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            row = checks.run_check(base, "line-bot/run_a2b_tests.py", ["test_probe"],
                                   base, "missing", {}, timeout=1)
            self.assertEqual(row["status"], "no_data")
            self.assertEqual(row["runner_error"], "FileNotFoundError")

    def test_cleanup_failure_halts_remaining_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            make_repo(base / "repo")
            def broken(*args, **kwargs):
                return {**checks.no_data("ProcessTreeCleanupFailed"), "suite": args[4]}
            with mock.patch.object(checks, "run_check", side_effect=broken) as run:
                path = checks.produce_legacy(base / "repo", base / "out", work_root=base / "work")
            self.assertEqual(run.call_count, 1)
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual({r["status"] for r in data["checks"].values()}, {"no_data"})


if __name__ == "__main__":
    unittest.main()
