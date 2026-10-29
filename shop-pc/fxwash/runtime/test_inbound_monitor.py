"""Offline notification regression tests: synthetic SQLite rows, no MDB or API."""

from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from runtime import inbound_monitor as monitor


class StopMonitor(BaseException):
    pass


class MonitorFixture:
    """Drive the real run_monitor entry point, replacing only its I/O boundaries."""

    def __init__(self, case):
        self.case = case
        # Windows 3.13+ interprets mkdtemp's 0700 as an ACL that excludes
        # restricted tokens. Keep inherited workspace ACLs for synthetic data.
        real_mkdir = os.mkdir

        def temp_mkdir(path, mode=0o777, **kwargs):
            if os.name == "nt":
                mode = 0o777
            return real_mkdir(path, mode, **kwargs)

        with patch.object(os, "mkdir", side_effect=temp_mkdir):
            self.temp = tempfile.TemporaryDirectory(prefix=".a3-2-", dir=ROOT)
        case.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.mdb = self.root / "fixture.mdb"
        self.mdb.write_bytes(b"synthetic mtime only; never opened as MDB")
        self.state_file = self.data / "monitor_state.json"
        self.outbox_file = self.data / "notify_outbox.jsonl"
        self.sql = sqlite3.connect(":memory:")
        case.addCleanup(self.sql.close)
        self.sql.execute(
            "CREATE TABLE Det (Did TEXT, Dno TEXT, Cid TEXT, State TEXT, "
            "Dname TEXT, Price TEXT, Indate TEXT, Pdate TEXT, Datei TEXT, Loc TEXT, Dater TEXT)"
        )
        self.queries = []
        self.query_failure = lambda sql: False
        self.push_results = []
        self.pushes = []
        self.now = 1000.0
        self.stdout = io.StringIO()
        self.stderr = io.StringIO()
        self.write_state({"last_did": "000010", "completed_dnos": ["OLD"]})
        self.bindings({"test-user-a": {"customer_id": "0001"}})

    def bindings(self, bindings):
        (self.data / "customer_bindings.json").write_text(json.dumps(bindings), encoding="utf-8")

    def write_state(self, state):
        self.state_file.write_text(json.dumps(state), encoding="utf-8")

    def state(self):
        return json.loads(self.state_file.read_text(encoding="utf-8"))

    def outbox(self):
        if not self.outbox_file.exists():
            return []
        return [json.loads(line) for line in self.outbox_file.read_text(encoding="utf-8").splitlines()]

    def piece(self, did="000011", dno="NEW", *, state="洗滌", datei=None, dater=None, pdate=""):
        self.sql.execute(
            "INSERT INTO Det VALUES (?, ?, '0001', ?, '測試襯衫', '70', '2026-10-30', ?, ?, '', ?)",
            (did, dno, state, pdate, datei, dater),
        )

    def run_query(self, sql):
        self.case.assertTrue(sql.lstrip().upper().startswith("SELECT"), sql)
        self.queries.append(sql)
        if self.query_failure(sql):
            raise OSError("synthetic MDB read failure")
        return self.sql.execute(sql).fetchall()

    def push_message(self, uid, messages, token):
        self.case.assertEqual("test-token", token)
        self.pushes.append({"uid": uid, "messages": messages, "ts": self.now})
        result = self.push_results.pop(0) if self.push_results else True
        if isinstance(result, Exception):
            raise result
        return result

    def run(self, cycles=1, *, deltas=None, before_tick=None):
        count = 0

        def sleep(seconds):
            nonlocal count
            if count >= cycles:
                raise StopMonitor()
            self.now += deltas[count] if deltas is not None else seconds
            count += 1
            if before_tick:
                before_tick(count)

        def fake_path(raw):
            if str(raw) in (r"C:\FXwash\eHank.mdb", r"c:\Users\AN\Desktop\備份0904\eHank.mdb"):
                return self.mdb
            return Path(raw)

        # A fake run_query sits behind the existing execute(...).fetchall() boundary.
        con = types.SimpleNamespace(execute=lambda sql: types.SimpleNamespace(fetchall=lambda: self.run_query(sql)))
        engine = types.ModuleType("ai_engine")
        engine.db_manager = types.SimpleNamespace(get_conn=lambda: con)
        with (
            patch.dict(sys.modules, {"ai_engine": engine}),
            patch.object(monitor, "load_shop", return_value=object()),
            patch.object(monitor, "channel_credentials", return_value={"token": "test-token"}),
            patch.object(monitor, "Path", side_effect=fake_path),
            patch.object(monitor, "push_message", side_effect=self.push_message),
            patch.object(monitor, "urlopen", side_effect=AssertionError("API forbidden")),
            patch.object(monitor.time, "time", side_effect=lambda: self.now),
            patch.object(monitor.time, "sleep", side_effect=sleep),
            redirect_stdout(self.stdout),
            redirect_stderr(self.stderr),
        ):
            try:
                monitor.run_monitor(self.root)
            except StopMonitor:
                pass

    def completions(self):
        return [p for p in self.pushes if "已經處理完工" in p["messages"][0]["text"]]


class InboundMonitorTests(unittest.TestCase):
    def fixture(self):
        return MonitorFixture(self)

    def test_false_push_is_queued_then_retried_without_mtime_change(self):
        f = self.fixture()
        f.piece()
        f.push_results = [False, True]

        def check_pending(tick):
            if tick == 2:
                self.assertEqual("000010", f.state()["last_did"], "failed intake must not advance cursor")
                self.assertTrue(f.outbox(), "failed push must be durable")
                self.assertEqual("pending", f.outbox()[-1]["status"])

        f.run(2, before_tick=check_pending)
        self.assertEqual(2, len(f.pushes))
        self.assertEqual("done", f.outbox()[-1]["status"])
        self.assertEqual("000011", f.state()["last_did"])

    def test_push_exception_is_durable_with_error_type_only(self):
        f = self.fixture()
        f.piece()
        f.push_results = [TimeoutError("private error detail"), True]
        f.run()
        self.assertTrue(f.outbox(), "exception must not lose event")
        self.assertEqual("TimeoutError", f.outbox()[-1]["last_error_type"])
        self.assertNotIn("private error detail", f.outbox_file.read_text(encoding="utf-8"))
        f.run()
        self.assertEqual(2, len(f.pushes))
        self.assertEqual("done", f.outbox()[-1]["status"])

    def test_retry_uses_five_backoff_intervals_then_abandons(self):
        f = self.fixture()
        f.piece()
        f.push_results = [False] * 20
        f.run(12, deltas=[6, 5, 1, 29, 1, 119, 1, 599, 1, 3599, 1, 3600])
        self.assertEqual([1006, 1012, 1042, 1162, 1762, 5362], [p["ts"] for p in f.pushes])
        self.assertEqual("abandoned", f.outbox()[-1]["status"])
        self.assertEqual(5, f.outbox()[-1]["attempts"])
        self.assertEqual("000011", f.state()["last_did"])

    def test_partial_recipient_failure_does_not_resend_successful_recipient(self):
        f = self.fixture()
        f.bindings({"test-user-a": {"customer_id": "0001"}, "test-user-b": {"customer_id": "0001"}})
        f.piece()
        f.push_results = [True, False, True]
        f.run(2)
        self.assertEqual(["test-user-a", "test-user-b", "test-user-b"], [p["uid"] for p in f.pushes])

    def test_pending_completion_does_not_enter_dedup_set_until_delivered(self):
        f = self.fixture()
        f.piece("000009", "READY", datei="2026-10-30")
        f.push_results = [False, True]
        f.run()
        state = f.state()
        self.assertNotIn(["READY", "000009"], state.get("completed_keys", []))
        self.assertNotIn("READY", state.get("completed_dnos", []))
        f.run()
        self.assertEqual(2, len(f.completions()))
        self.assertIn(["READY", "000009"], f.state()["completed_keys"])

    def test_restart_preserves_original_recipient_and_append_only_receipts(self):
        f = self.fixture()
        f.piece()
        f.push_results = [False, True]
        f.run()
        self.assertTrue(f.outbox_file.exists(), "outbox must survive restart")
        prefix = f.outbox_file.read_bytes()
        f.bindings({"test-user-b": {"customer_id": "0001"}})
        f.run()
        self.assertEqual(["test-user-a", "test-user-a"], [p["uid"] for p in f.pushes])
        self.assertTrue(f.outbox_file.read_bytes().startswith(prefix))
        f.run()
        self.assertEqual(2, len(f.pushes), "done receipt must prevent another push after restart")

    def test_outbox_is_retried_before_fresh_database_queries(self):
        f = self.fixture()
        f.piece()
        f.push_results = [False, True]
        f.run()
        queries = []
        f.query_failure = lambda sql: queries.append(len(f.pushes)) or True
        f.run()
        self.assertEqual(2, len(f.pushes), "MDB outage must not prevent queued retries")
        self.assertTrue(all(count == 2 for count in queries))

    def test_outbox_retries_even_when_mdb_file_is_missing(self):
        f = self.fixture()
        f.piece()
        f.push_results = [False, True]
        f.run()
        f.mdb.unlink()
        f.run()
        self.assertEqual(2, len(f.pushes))

    def test_success_receipt_survives_failed_state_save_and_restart(self):
        f = self.fixture()
        f.piece()
        with patch.object(monitor.os, "replace", side_effect=PermissionError("synthetic state lock")):
            f.run()
        f.run()
        self.assertEqual(1, len(f.pushes), "delivered outbox receipt must fence stale state")

    def test_atomic_replace_failure_leaves_previous_state_intact(self):
        f = self.fixture()
        before = f.state_file.read_bytes()
        replacements = []

        def fail_replace(src, dst):
            replacements.append((Path(src), Path(dst)))
            self.assertEqual(f.state_file, Path(dst))
            json.loads(Path(src).read_text(encoding="utf-8"))
            raise PermissionError("synthetic replacement failure")

        with patch.object(monitor.os, "replace", side_effect=fail_replace):
            f.run()
        self.assertEqual(before, f.state_file.read_bytes(), "direct overwrite destroys last good state")
        self.assertTrue(replacements, "state save must use os.replace")
        self.assertEqual(f.data, replacements[0][0].parent)
        self.assertEqual(".tmp", replacements[0][0].suffix)

    def test_corrupt_state_is_preserved_and_blocks_all_pushes(self):
        f = self.fixture()
        corrupt = b'{"last_did":'
        f.state_file.write_bytes(corrupt)

        def new_piece(tick):
            if tick == 1:
                f.piece()

        f.run(before_tick=new_piece)
        self.assertEqual([], f.pushes)
        self.assertEqual(corrupt, f.state_file.read_bytes())
        backups = list(f.data.glob("monitor_state.json.corrupt-*"))
        self.assertTrue(backups, "corrupt JSON must be retained for diagnosis")
        self.assertEqual(corrupt, backups[0].read_bytes())
        self.assertIn("STATE_CORRUPT", f.stderr.getvalue())
        f.run()
        self.assertEqual([], f.pushes, "restart must remain blocked until operator repairs state")

    def test_failed_max_baseline_retries_without_notifying_history(self):
        f = self.fixture()
        f.state_file.unlink()
        f.piece("000100", "HISTORY")
        failed = False

        def fail_once(sql):
            nonlocal failed
            if "MAX(Did)" in sql and not failed:
                failed = True
                return True
            return False

        f.query_failure = fail_once
        f.run()
        self.assertEqual([], f.pushes, "failed MAX must never become a 000000 baseline")
        self.assertEqual("000100", f.state()["last_did"])

    def test_failed_ready_baseline_retries_without_notifying_history(self):
        f = self.fixture()
        f.state_file.unlink()
        f.piece("000100", "HISTORY", datei="2026-10-30")
        failed = False

        def fail_once(sql):
            nonlocal failed
            if "Dater" in sql and not failed:
                failed = True
                return True
            return False

        f.query_failure = fail_once
        f.run()
        self.assertEqual([], f.pushes)
        self.assertIn(["HISTORY", "000100"], f.state()["completed_keys"])

    def test_failed_baseline_does_not_save_half_initialized_state(self):
        f = self.fixture()
        f.state_file.unlink()
        f.query_failure = lambda sql: "MAX(Did)" in sql
        f.run(2)
        self.assertFalse(f.state_file.exists(), "both baseline queries must succeed before save")
        self.assertEqual([], f.pushes)

    def test_empty_database_is_a_valid_persisted_baseline(self):
        f = self.fixture()
        f.state_file.unlink()
        f.run()
        self.assertIs(True, f.state().get("baseline_initialized"))
        before = len([q for q in f.queries if "MAX(Did)" in q])
        f.run()
        self.assertEqual(before, len([q for q in f.queries if "MAX(Did)" in q]))

    def test_empty_legacy_ready_set_does_not_rebaseline_offline_completions(self):
        f = self.fixture()
        f.write_state({"last_did": "000010", "completed_dnos": []})
        f.piece("000009", "READY", datei="2026-10-30")
        f.run()
        self.assertEqual(1, len(f.completions()))

    def test_state_only_completion_matches_lookup(self):
        f = self.fixture()
        f.piece("000009", "READY", state="完工")
        f.run()
        self.assertEqual(1, len(f.completions()), "State=完工 without Datei must notify")

    def test_picked_piece_never_notifies_completion(self):
        f = self.fixture()
        f.piece("000009", "PICKED", state="完工", datei="2026-10-29", dater="2026-10-30")
        f.run()
        self.assertEqual([], f.completions())

    def test_completion_dedup_uses_dno_and_did(self):
        f = self.fixture()
        f.piece("000008", "SHARED", datei="2026-10-30")
        f.piece("000009", "SHARED", datei="2026-10-30")
        f.run(2)
        self.assertEqual(2, len(f.completions()), "same Dno with different Did are different pieces")
        self.assertIn(["SHARED", "000008"], f.state()["completed_keys"])
        self.assertIn(["SHARED", "000009"], f.state()["completed_keys"])

    def test_legacy_migration_preserves_history_without_suppressing_new_did(self):
        f = self.fixture()
        f.write_state({"last_did": "000010", "completed_dnos": ["REUSED"]})
        f.piece("000009", "REUSED", datei="2026-10-29")
        f.piece("000011", "REUSED", datei="2026-10-30")
        f.run()
        self.assertEqual(1, len(f.completions()))
        self.assertIn(["REUSED", "000009"], f.state()["completed_keys"])
        self.assertIn(["REUSED", "000011"], f.state()["completed_keys"])

    def test_failed_intake_query_retries_same_mtime(self):
        f = self.fixture()
        f.piece()
        failed = False

        def fail_once(sql):
            nonlocal failed
            if "WHERE Did >" in sql and not failed:
                failed = True
                return True
            return False

        f.query_failure = fail_once
        f.run(2)
        self.assertEqual(1, len(f.pushes), "failed query must not consume MDB mtime")

    def test_failed_completion_query_retries_same_mtime(self):
        f = self.fixture()
        f.piece("000009", "READY", datei="2026-10-30")
        failed = False

        def fail_once(sql):
            nonlocal failed
            if "Dater" in sql and not failed:
                failed = True
                return True
            return False

        f.query_failure = fail_once
        f.run(2)
        self.assertEqual(1, len(f.completions()))

    def test_query_failure_logs_once_per_ten_consecutive_rounds(self):
        f = self.fixture()
        f.query_failure = lambda sql: True
        f.run(21)
        lines = [line for line in f.stderr.getvalue().splitlines() if "MDB_QUERY_FAILED" in line]
        self.assertEqual(2, len(lines), f.stderr.getvalue())
        self.assertIn("10", lines[0])
        self.assertIn("20", lines[1])

    def test_pending_earlier_intake_blocks_cursor_but_does_not_repeat_later_success(self):
        f = self.fixture()
        f.piece("000011", "FIRST")
        f.piece("000012", "SECOND")
        f.push_results = [False, True, True]
        f.run()
        self.assertEqual("000010", f.state()["last_did"])
        f.run()
        self.assertEqual(["FIRST", "SECOND", "FIRST"], [
            "FIRST" if "FIRST" in p["messages"][0]["text"] else "SECOND" for p in f.pushes
        ])
        self.assertEqual("000012", f.state()["last_did"])

    def test_original_intake_copy_and_price_are_unchanged(self):
        f = self.fixture()
        f.piece(pdate="2026-11-03")
        f.run()
        self.assertEqual(
            "您好，已收到您的送洗衣物：\n• 測試襯衫（單號：NEW）｜ 70 元\n"
            "預計取件日期：2026-11-03\n衣物處理完成後會再第一時間主動發訊通知您！",
            f.pushes[0]["messages"][0]["text"],
        )

    def test_original_completion_copy_and_price_are_unchanged(self):
        f = self.fixture()
        f.piece("000009", "READY", datei="2026-10-30")
        f.run()
        self.assertEqual(
            "您好，您的送洗衣物已經處理完工囉！\n• 測試襯衫（單號：READY）｜ 70 元\n\n"
            "歡迎於門市營業時間前來取件。\n我們在至善國中對面，407 臺中市西屯區至善里青海路二段365號。\n"
            "週一至週五 10:00-20:00；週六 12:00-18:00；週日公休",
            f.completions()[0]["messages"][0]["text"],
        )


if __name__ == "__main__":
    unittest.main()
