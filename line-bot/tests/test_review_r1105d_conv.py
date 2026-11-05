# -*- coding: utf-8 -*-
"""R-1105d F1: polite / affirmative cancel commands still cancel; questions still keep."""
from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from test_audit_a_conv import _Isolated, conv  # noqa: E402


class PoliteCancelStillCancels(_Isolated):
    UID = "Utest" + "0" * 24 + "rv05"

    def setUp(self):
        super().setUp()
        when = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%dT15:00")
        row = {"id": "PTEST0105", "uid": self.UID, "when": when, "item": "", "kind": "book", "ts": "x"}
        self.book.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")

    def cancel_rows(self):
        rows = [json.loads(x) for x in self.book.read_text(encoding="utf-8").splitlines() if x.strip()]
        return [r for r in rows if r.get("kind") == "cancel"]

    def test_question_keeps_then_polite_command_cancels(self):
        msgs, _meta = conv.handle_ex(self.UID, "可以取消嗎")
        self.assertEqual(self.cancel_rows(), [])
        self.assertNotIn("取消了", self.texts(msgs))
        _msgs, meta = conv.handle_ex(self.UID, "可以幫我取消預約")
        self.assertEqual(len(self.cancel_rows()), 1)
        self.assertEqual(meta["intent"], "cancel")

    def test_affirmative_reply_cancels(self):
        _msgs, meta = conv.handle_ex(self.UID, "好，可以，取消")
        self.assertEqual(len(self.cancel_rows()), 1)
        self.assertEqual(meta["intent"], "cancel")

    def test_tentative_classifier(self):
        # 「我可以取消預約」 without 嗎 is a question about being allowed to, not a command.
        self.assertTrue(conv._cancel_is_tentative("我可以取消預約"))
        self.assertTrue(conv._cancel_is_tentative("可以取消嗎"))
        self.assertFalse(conv._cancel_is_tentative("可以幫我取消預約"))
        self.assertFalse(conv._cancel_is_tentative("好，可以，取消"))


if __name__ == "__main__":
    unittest.main()
