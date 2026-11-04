# -*- coding: utf-8 -*-
"""Owner-approved wording fixes (11/04): hypothetical damage questions and items named as 裙."""
from __future__ import annotations

import atexit
import os
import shutil
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent
_TMP = Path(tempfile.mkdtemp(prefix="rule-wording-"))
atexit.register(shutil.rmtree, _TMP, True)
(_TMP / "data").mkdir()
for _name in ("prices.json", "business-profile.json"):
    if (HERE.parent / "data" / _name).is_file():
        shutil.copy2(HERE.parent / "data" / _name, _TMP / "data" / _name)
os.environ.update(
    LAUNDRY_REPO_ROOT=str(_TMP), LAUNDRY_LOOKUP_FIXTURE="1", LAUNDRY_AI_CHAT="off",
    LAUNDRY_CHAT_USAGE_DIR=str(_TMP / "data" / "chat-usage"),
    LAUNDRY_VISION_USAGE_DIR=str(_TMP / "data" / "vision-usage"),
)
os.environ.pop("GEMINI_API_KEY", None)
sys.path.insert(0, str(HERE))


def _no_network(*_a, **_k):
    raise RuntimeError("network disabled in tests")


urllib.request.urlopen = _no_network
STAFF = ModuleType("staff_notify")
STAFF.inbox = []
STAFF.guest_name = lambda _uid: "測試客人"
STAFF.push_inbox = lambda kind, rec, **_k: (STAFF.inbox.append((kind, rec)) or {"saved": True, "notified": True})
sys.modules["staff_notify"] = STAFF
_PAY = ModuleType("line_pay")
_PAY.configured = lambda: False
sys.modules["line_pay"] = _PAY

import conversation as conv  # noqa: E402

if hasattr(conv, "cprof") and hasattr(conv.cprof, "PROFILE_PATH"):
    conv.cprof.PROFILE_PATH = _TMP / "data" / "line-customer-profile.json"


def _texts(uid: str, say: str) -> tuple[str, int]:
    before = len(STAFF.inbox)
    msgs = conv.handle(uid, say)
    body = " / ".join(m.get("text") or "" for m in msgs or [] if m.get("type") == "text")
    return body, len(STAFF.inbox) - before


class RuleWordingTests(unittest.TestCase):
    def test_hypothetical_damage_is_not_treated_as_a_bad_result(self):
        body, staff = _texts("Urw001", "如果衣服洗壞了你們會賠嗎")
        self.assertNotIn("抱歉這次洗護結果", body)
        self.assertIn("先別急", body)
        self.assertEqual(staff, 1)

    def test_real_complaint_keeps_the_apology(self):
        body, staff = _texts("Urw002", "上次洗的襯衫領口還是黃黃的")
        self.assertIn("抱歉這次洗護結果讓你困擾", body)
        self.assertEqual(staff, 1)

    def test_past_damage_with_if_word_still_apologises(self):
        body, _ = _texts("Urw003", "昨天拿回來的大衣縮水了，如果要重洗怎麼辦")
        self.assertIn("抱歉這次洗護結果讓你困擾", body)

    def test_skirt_named_as_qun_is_not_asked_again(self):
        body, _ = _texts("Urw004", "咖啡灑在淺色裙上，怎麼辦？")
        self.assertNotIn("是沾在什麼物件上", body)
        self.assertIn("裙子", body)

    def test_skirt_still_recognised_as_qunzi(self):
        body, _ = _texts("Urw005", "裙子上有咖啡漬，洗得掉嗎")
        self.assertNotIn("是沾在什麼物件上", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
