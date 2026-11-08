"""Real subprocess regressions for OPS-L1-12 r4 (synthetic, offline only)."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

import level1_offline_checks as checks

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("l1_golden", ROOT / "tests/golden/run_golden.py")
golden = importlib.util.module_from_spec(spec)
spec.loader.exec_module(golden)


class WorkerGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.snapshot = self.base / "work/snapshot"
        for name in ("scripts/level1_offline_checks.py", "line-bot/run_a2b_tests.py",
                     "line-bot/test-assets/offline_temp.py", "line-bot/test_linebot_fix_20260926.py",
                     "data/prices.json", "data/business-profile.json"):
            dest = self.snapshot / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, dest)
        self.logs = self.base / "logs"
        self.logs.mkdir()

    def run_probe(self, body):
        (self.snapshot / "line-bot/test_probe.py").write_text(
            "import unittest, subprocess, sys, os, socket\nfrom pathlib import Path\n"
            "class Probe(unittest.TestCase):\n    def test_probe(self):\n" +
            "\n".join("        " + line for line in body.splitlines()) + "\n", encoding="utf-8")
        result = checks.run_check(self.snapshot, "line-bot/run_a2b_tests.py", ["test_probe"],
                                 self.logs, "probe", dict(os.environ), timeout=15)
        log = Path(result["log"]).read_text(encoding="utf-8")
        self.assertEqual(result["status"], "pass", log)
        self.assertEqual(result["tests"], 1, log)
        self.assertFalse(list((self.snapshot / "line-bot").glob(".a2b-test-tmp-*")), log)

    def test_producer_runner_subprocess_is_allowed(self):
        self.run_probe("self.assertTrue(Path(__file__).is_file())")

    def test_arbitrary_subprocess_is_refused_inside_worker(self):
        self.run_probe('with self.assertRaisesRegex(PermissionError, "unguarded child"):\n'
                       '    subprocess.run([sys.executable, "-c", "raise SystemExit(0)"], check=True)')

    def test_timed_out_worker_is_reaped_before_cleanup(self):
        (self.snapshot / "line-bot/test_timeout.py").write_text("import time\ntime.sleep(20)\n", encoding="utf-8")
        started = time.monotonic()
        row = checks.run_check(self.snapshot, "line-bot/run_a2b_tests.py", ["test_timeout"],
                               self.logs, "timeout", dict(os.environ), timeout=5)
        self.assertNotEqual(row["status"], "pass")
        self.assertIn("TimeoutExpired", Path(row["log"]).read_text(encoding="utf-8"))
        self.assertLess(time.monotonic() - started, 6)
        self.assertFalse(list((self.snapshot / "line-bot").glob(".a2b-test-tmp-*")))

    def test_worker_keeps_filesystem_and_network_guards(self):
        outside = self.base / "sentinel.txt"
        outside.write_text("unchanged", encoding="utf-8")
        self.run_probe(
            f'with self.assertRaisesRegex(PermissionError, "write outside"):\n'
            f'    Path({str(outside)!r}).write_text("changed", encoding="utf-8")\n'
            'for event, args in [("socket.connect", (None, ("203.0.113.1", 443))),\n'
            '                    ("socket.sendto", (None, ("203.0.113.1", 53))),\n'
            '                    ("socket.getaddrinfo", ("example.invalid", 443))]:\n'
            '    with self.assertRaisesRegex(PermissionError, "network refused"):\n'
            '        sys.audit(event, *args)\n'
            'for event in ("open", "os.mkdir", "os.remove", "os.rmdir"):\n'
            '    with self.assertRaises(PermissionError):\n'
            '        sys.audit(event, "C:/fxwash/OPS-L1-12-synthetic-probe")')
        self.assertEqual(outside.read_text(encoding="utf-8"), "unchanged")


class GoldenPortabilityTests(unittest.TestCase):
    def test_timestamp_labels_follow_instants_not_zoneinfo_capability(self):
        naive = {"a": "2030-01-09T14:00:00", "b": "2030-01-09T14:00:00",
                 "c": "2030-01-09T14:00:30"}
        aware = {"a": "2030-01-09T14:00:00+08:00", "b": "2030-01-09T14:00:00",
                 "c": "2030-01-09T06:00:30Z"}
        normalized = golden.Normalizer([], [], ()).apply(naive)
        self.assertEqual(normalized, golden.Normalizer([], [], ()).apply(aware))
        self.assertEqual(normalized, {"a": "<TS#1>", "b": "<TS#1>", "c": "<TS#2>"})

    def test_timestamp_normalization_preserves_submicrosecond_differences(self):
        n = golden.Normalizer([], [], ())
        self.assertNotEqual(n.text("2030-01-09T14:00:00.1234567"), n.text("2030-01-09T14:00:00.1234568"))

    def test_minute_only_timestamps_keep_literal_minutes_in_both_modes(self):
        n = golden.Normalizer([], [], ())
        self.assertEqual(n.text("2030-01-09T14:01+08:00"), n.text("2030-01-09T14:01"))
        self.assertEqual(n.text("2030-01-09T14:01+08:00"), "2030-01-09T14:01")
        self.assertNotEqual(n.text("2030-01-09T14:01+08:00"), n.text("2030-01-09T14:02+08:00"))

    def compare(self, expected, actual):
        # Exercise the actual check branch, including double-run determinism.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "golden.json"
            path.write_bytes(golden.canonical_bytes(expected))
            args = type("Args", (), dict(cases=Path(tmp) / "cases.json", golden=path,
                                        out=None, mode="check"))()
            with mock.patch.object(golden, "load_cases", return_value={"cases": [{"id": "probe"}]}), \
                 mock.patch.object(golden, "Harness") as harness:
                harness.return_value.run.return_value = actual
                return golden.cmd_run(args)

    def documents(self):
        doc = {"format": "linebot-golden/1", "harness": {"zoneinfo_asia_taipei": False, "network": "refused"},
               "cases": [{"id": "probe", "turns": [{"output": {"messages": [{"text": "Hello"}]}}]}]}
        actual = copy.deepcopy(doc)
        actual["harness"]["zoneinfo_asia_taipei"] = True
        return doc, actual

    def test_only_confirmed_capability_field_is_ignored(self):
        expected, actual = self.documents()
        self.assertEqual(self.compare(expected, actual), golden.EXIT_OK)
        actual["harness"]["network"] = "allowed"
        self.assertEqual(self.compare(expected, actual), golden.EXIT_DIFF)

    def test_customer_reply_byte_difference_still_fails(self):
        expected, actual = self.documents()
        actual["cases"][0]["turns"][0]["output"]["messages"][0]["text"] = "Jello"
        self.assertEqual(self.compare(expected, actual), golden.EXIT_DIFF)


class SmokeTests(unittest.TestCase):
    def test_smoke_is_bounded_and_cannot_overwrite_full_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            calls = []
            def fake_run(snapshot, script, args, logs, label, env, timeout):
                calls.append((script, args, timeout))
                return dict(status="pass", tests=1, failures=0, errors=0, skipped=0, suite=label)
            with mock.patch.object(checks, "run_check", side_effect=fake_run):
                path = checks.produce(root, root, work_root=root / "work", smoke=True)
            receipt = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(receipt["schema"], "level1-offline-smoke/v1")
            self.assertTrue(path.name.startswith("level1-smoke-"))
            self.assertFalse(list(path.parent.glob("level1-checks-*.json")))
            self.assertEqual(receipt["mode"], "smoke")
            self.assertEqual([args for _, args, _ in calls],
                             [["tests.test_audit_a_conv"], ["tests.test_audit_a_quote"],
                              ["test_handoff"], ["test_bulky_days_1106"]])
            self.assertTrue(all(t <= 25 for _, _, t in calls))
            self.assertEqual(receipt["checks"]["golden"]["status"], "no_data")
            self.assertEqual(receipt["checks"]["line_full"]["tests"], 1)


if __name__ == "__main__":
    unittest.main()
