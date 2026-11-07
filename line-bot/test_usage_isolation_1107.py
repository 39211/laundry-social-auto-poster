# -*- coding: utf-8 -*-
"""LINE usage is counted only by the real bot process (fix/usage-isolation-1107).

Before: every conversation.handle_ex call - thousands per offline test run, in any worktree and in the
restart gates - was counted into the live data/line-usage, so the owner's daily/weekly numbers were
inflated (11/06: 7553 replies on a quiet day). Now counting needs LAUNDRY_LINE_USAGE=on, which
line_webhook.py sets only when started as the bot."""
from __future__ import annotations

import ast
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import test_line_usage as base  # noqa: E402  (sets a temp LAUNDRY_REPO_ROOT and stubs before importing conversation)

conv = base.conv


@unittest.skipIf(conv is None, "conversation data files missing")
class UsageIsolationTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="uiso-")
        self.dir = Path(self._tmp.name) / "line-usage"
        self._env = {k: os.environ.get(k) for k in ("LAUNDRY_LINE_USAGE_DIR", "LAUNDRY_LINE_USAGE", "LAUNDRY_AI_CHAT")}
        os.environ["LAUNDRY_LINE_USAGE_DIR"] = str(self.dir)
        os.environ["LAUNDRY_AI_CHAT"] = "off"
        base.line_usage._WARNED = False

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def files(self):
        return sorted(p.name for p in self.dir.glob("*.json")) if self.dir.exists() else []

    def test_not_counted_without_the_switch(self):
        os.environ.pop("LAUNDRY_LINE_USAGE", None)
        conv.handle_ex("Uuiso00000001", "店址")
        conv.handle_ex("Uuiso00000001", "營業時間")
        self.assertEqual([], self.files())

    def test_not_counted_when_switch_is_off_or_junk(self):
        for value in ("off", "", "1", "true"):
            os.environ["LAUNDRY_LINE_USAGE"] = value
            conv.handle_ex("Uuiso00000002", "店址")
        self.assertEqual([], self.files())

    def test_counted_when_the_bot_process_turns_it_on(self):
        os.environ["LAUNDRY_LINE_USAGE"] = "on"
        conv.handle_ex("Uuiso00000003", "店址")
        self.assertEqual(1, len(self.files()))
        import json
        data = json.loads((self.dir / self.files()[0]).read_text(encoding="utf-8"))
        self.assertEqual(1, data["messages"])

    def test_only_the_bot_entry_point_turns_it_on(self):
        tree = ast.parse((HERE / "line_webhook.py").read_text(encoding="utf-8"))

        def sets_switch(node):
            for n in ast.walk(node):
                if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("setdefault", "__setitem__")
                        and n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == "LAUNDRY_LINE_USAGE"
                        and len(n.args) > 1 and isinstance(n.args[1], ast.Constant) and n.args[1].value == "on"):
                    return True
            return False

        main_blocks = [n for n in tree.body if isinstance(n, ast.If) and "__main__" in ast.unparse(n.test)]
        self.assertEqual(1, len(main_blocks))
        self.assertTrue(sets_switch(main_blocks[0]), "line_webhook __main__ must set LAUNDRY_LINE_USAGE=on")
        outside = [n for n in tree.body if n is not main_blocks[0]]
        self.assertFalse(any(sets_switch(n) for n in outside), "importing line_webhook must not turn counting on")


if __name__ == "__main__":
    unittest.main()
