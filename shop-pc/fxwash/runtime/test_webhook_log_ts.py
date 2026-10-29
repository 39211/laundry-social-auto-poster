"""Exercise the real stream wrapper without starting a server or writing live logs."""

from __future__ import annotations

import importlib.util
import io
import sys
import unittest
from contextlib import ExitStack
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_webhook(log_open_fails=False):
    spec = importlib.util.spec_from_file_location("a4_2_webhook_under_test", ROOT / "runtime" / "webhook_server.py")
    module = importlib.util.module_from_spec(spec)
    console = io.StringIO()
    error_console = io.StringIO()
    log = io.StringIO()
    with ExitStack() as stack:
        stack.enter_context(patch.object(sys, "stdout", console))
        stack.enter_context(patch.object(sys, "stderr", error_console))
        stack.enter_context(patch("pathlib.Path.mkdir"))
        stack.enter_context(patch("builtins.open", side_effect=OSError("offline log unavailable")) if log_open_fails
                            else patch("builtins.open", return_value=log))
        server = stack.enter_context(patch("http.server.ThreadingHTTPServer"))
        spec.loader.exec_module(module)
        writer, error_writer = sys.stdout, sys.stderr
        server.assert_not_called()
    return module, writer, error_writer, console, error_console, log


class BrokenWriter:
    def write(self, text):
        raise OSError("offline sink")

    def flush(self):
        raise OSError("offline sink")


class WebhookLogTimestampTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module, *_ = load_webhook()

    def setUp(self):
        self.console, self.log = io.StringIO(), io.StringIO()
        self.writer = self.module.SafeWriter(self.console, self.log)
        clock = patch.object(self.module, "datetime")
        self.addCleanup(clock.stop)
        clock.start().now.return_value = datetime(2026, 10, 29, 11, 12, 13)

    def test_print_parts_get_exactly_one_local_timestamp(self):
        print("[Webhook] POST", "/line/webhook", file=self.writer)
        expected = "2026-10-29 11:12:13 [Webhook] POST /line/webhook\n"
        self.assertEqual(expected, self.log.getvalue())
        self.assertEqual(expected, self.console.getvalue())

    def test_each_multiline_and_blank_line_has_a_timestamp(self):
        self.writer.write("first\n\nthird\n")
        self.assertEqual("2026-10-29 11:12:13 first\n2026-10-29 11:12:13 \n2026-10-29 11:12:13 third\n", self.log.getvalue())

    def test_empty_write_does_not_create_a_log_line(self):
        self.writer.write("")
        self.assertEqual("", self.log.getvalue())

    def test_broken_console_does_not_drop_file_log(self):
        writer = self.module.SafeWriter(BrokenWriter(), self.log)
        writer.write("still recorded\n")
        writer.flush()
        self.assertEqual("2026-10-29 11:12:13 still recorded\n", self.log.getvalue())

    def test_broken_log_does_not_drop_console(self):
        writer = self.module.SafeWriter(self.console, BrokenWriter())
        writer.write("still visible\n")
        writer.flush()
        self.assertEqual("2026-10-29 11:12:13 still visible\n", self.console.getvalue())

    def test_import_wraps_stdout_and_stderr_without_starting_server(self):
        _, writer, error_writer, console, error_console, log = load_webhook()
        print("normal", file=writer)
        print("error", file=error_writer)
        for value in (console.getvalue(), error_console.getvalue()):
            self.assertRegex(value, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (normal|error)\n$")
        self.assertEqual(console.getvalue() + error_console.getvalue(), log.getvalue())

    def test_log_open_failure_still_timestamps_both_consoles(self):
        _, writer, error_writer, console, error_console, _ = load_webhook(log_open_fails=True)
        print("fallback", file=writer)
        print("fallback", file=error_writer)
        for value in (console.getvalue(), error_console.getvalue()):
            self.assertRegex(value, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} fallback\n$")


if __name__ == "__main__":
    unittest.main()
