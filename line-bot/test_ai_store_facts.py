# -*- coding: utf-8 -*-
"""AI chat must not invent store details (11/05 live eval: a made-up paid car park)."""
from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent
_TMP = Path(tempfile.mkdtemp(prefix="ai-store-facts-"))
atexit.register(shutil.rmtree, _TMP, True)
(_TMP / "data").mkdir()
for _name in ("prices.json", "business-profile.json"):
    if (HERE.parent / "data" / _name).is_file():
        shutil.copy2(HERE.parent / "data" / _name, _TMP / "data" / _name)
os.environ.update(
    LAUNDRY_REPO_ROOT=str(_TMP), LAUNDRY_LOOKUP_FIXTURE="1", LAUNDRY_AI_CHAT="on",
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
import ai_chat  # noqa: E402

if hasattr(conv, "cprof") and hasattr(conv.cprof, "PROFILE_PATH"):
    conv.cprof.PROFILE_PATH = _TMP / "data" / "line-customer-profile.json"

_NEXT = {"decision": None}
ai_chat.set_model(lambda _model, _prompt, _timeout: json.dumps(_NEXT["decision"], ensure_ascii=False))


def _ask(uid: str, say: str, decision: dict) -> tuple[str, int]:
    _NEXT["decision"] = decision
    before = len(STAFF.inbox)
    msgs = conv.handle(uid, say)
    body = " / ".join(m.get("text") or "" for m in msgs or [] if m.get("type") == "text")
    return body, len(STAFF.inbox) - before


class StoreFactTests(unittest.TestCase):
    def test_invented_parking_goes_to_staff(self):
        body, staff = _ask("Usf001", "開車去店門口好停嗎",
                           {"kind": "answer", "reply": "店門口有時候比較不好停，但附近有收費停車場。"})
        self.assertNotIn("停車場", body)
        self.assertNotIn("附近有", body)
        self.assertGreaterEqual(staff, 1)

    def test_check_reply_rejects_ungrounded_transit(self):
        facts = ai_chat.facts_text(conv)
        self.assertIsNone(ai_chat.check_reply("走路到捷運站很近喔。", facts))

    def test_care_answer_still_allowed(self):
        body, _ = _ask("Usf002", "羽絨衣可以水洗嗎",
                       {"kind": "answer", "reply": "羽絨衣要看洗標和填充物，可以拍洗標給我們看。"})
        self.assertIn("洗標", body)

    def test_chat_models_leave_photo_quota_alone(self):
        chain = ai_chat._chain()
        self.assertEqual(chain[0], "gemini-2.5-flash-lite")
        self.assertNotIn("gemini-2.5-flash", chain)
        self.assertNotIn("gemini-flash-latest", chain)

    def test_landmark_from_facts_still_allowed(self):
        facts = ai_chat.facts_text(conv)
        self.assertIn("對面", facts)
        self.assertIsNotNone(ai_chat.check_reply("我們在至善國中對面喔。", facts))

    def test_negated_fact_does_not_ground_opposite_claim(self):
        facts = ai_chat.facts_text(conv) + "\n店門口沒有停車位。"
        self.assertIsNone(ai_chat.check_reply("店門口有停車位喔。", facts))
        self.assertIsNotNone(ai_chat.check_reply("店門口沒有停車位喔。", facts))

    def test_scooter_parking_claim_needs_facts(self):
        self.assertIsNone(ai_chat.check_reply("機車可以停門口騎樓喔。", ai_chat.facts_text(conv)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
