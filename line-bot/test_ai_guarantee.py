# -*- coding: utf-8 -*-
"""AI chat must not promise results (G-2: 「婚紗交給我們絕對沒問題。」 reached the customer)."""
from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
import unicodedata
import unittest
import urllib.request
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent
_TMP = Path(tempfile.mkdtemp(prefix="ai-guarantee-"))
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
_OLD_STAFF = sys.modules.get("staff_notify")
if isinstance(getattr(_OLD_STAFF, "inbox", None), list):
    STAFF = _OLD_STAFF  # another test file already installed the stub conversation is bound to
else:
    STAFF = ModuleType("staff_notify")
    STAFF.inbox = []
    STAFF.guest_name = lambda _uid: "測試客人"
    STAFF.push_inbox = lambda kind, rec, **_k: (STAFF.inbox.append((kind, rec)) or {"saved": True, "notified": True})
    sys.modules["staff_notify"] = STAFF
if "line_pay" not in sys.modules:
    _PAY = ModuleType("line_pay")
    _PAY.configured = lambda: False
    sys.modules["line_pay"] = _PAY

import conversation as conv  # noqa: E402
import ai_chat  # noqa: E402

if hasattr(conv, "cprof") and hasattr(conv.cprof, "PROFILE_PATH"):
    conv.cprof.PROFILE_PATH = _TMP / "data" / "line-customer-profile.json"

_NEXT = {"decision": None}


def _model(_model_name, _prompt, _timeout):
    return json.dumps(_NEXT["decision"], ensure_ascii=False)


def _ask(uid: str, say: str, decision: dict) -> str:
    _NEXT["decision"] = decision
    ai_chat.set_model(_model)  # set per call: other test files inject their own fake model
    msgs = conv.handle(uid, say)
    return " / ".join(m.get("text") or "" for m in msgs or [] if m.get("type") == "text")


# Owner facts without landmarks; digits allowed are only the turnaround spans.
FACTS = "交期：" + ai_chat.TURNAROUND_FACT + "。\n到府收送：" + ai_chat.PICKUP_FACT + "。"

BLOCKED = {
    "絕對": "婚紗交給我們絕對沒問題。",
    "絕對不會": "絕對不會褪色。",
    "一定沒問題": "這件交給師傅一定沒問題。",
    "一定可以": "這個污漬一定可以洗乾淨。",
    "一定會": "洗完一定會很乾淨。",
    "一定能": "師傅一定能處理好。",
    "一定洗得": "這種黃斑一定洗得掉。",
    "一定處理得": "這種材質我們一定處理得好。",
    "一定弄得": "放心，一定弄得乾淨。",
    "肯定沒問題": "交給我們肯定沒問題。",
    "肯定可以": "這件肯定可以洗。",
    "肯定會": "洗完肯定會變新。",
    "百分之百": "百分之百洗得乾淨。",
    "100%": "100%洗得乾淨。",
    "100%全形": "１００％洗得乾淨。",
    "包你滿意": "洗完包你滿意。",
    "包您洗好": "交給我們包您洗好。",
    "包你乾淨": "包你乾淨溜溜。",
    "沒問題的啦": "放心，沒問題的啦。",
}

ALLOWED = {
    "不一定": "這個不一定，要看布料狀況。",
    "不一定可以": "不一定可以完全洗掉，要請師傅看過。",
    "不一定會": "不一定會褪色，先拍洗標給我們看。",
    "一定要先看洗標": "一定要先看洗標，再決定怎麼洗。",
    "不保證": "我們不保證能完全去除，可以先拍照給我們看。",
    "絕對不要": "絕對不要用漂白水，會傷布料。",
    "絕對不能": "絕對不能用熱水燙，容易縮水。",
}


class GuaranteeTests(unittest.TestCase):
    def test_each_promise_pattern_blocks_its_example(self):
        for name, reply in BLOCKED.items():
            with self.subTest(pattern=name):
                probe = unicodedata.normalize("NFKC", reply)
                self.assertIsNotNone(ai_chat._GUARANTEE_RE.search(probe))
                self.assertIsNone(ai_chat.check_reply(reply, FACTS))

    def test_advice_and_hedges_still_pass(self):
        for name, reply in ALLOWED.items():
            with self.subTest(phrase=name):
                probe = unicodedata.normalize("NFKC", reply)
                self.assertIsNone(ai_chat._GUARANTEE_RE.search(probe))
                self.assertIsNotNone(ai_chat.check_reply(reply, FACTS))

    def test_wedding_dress_promise_never_reaches_customer(self):
        body = _ask("Ugu001", "婚紗可以洗嗎", {"kind": "answer", "reply": "婚紗交給我們絕對沒問題。"})
        self.assertNotIn("絕對", body)
        self.assertNotIn("沒問題", body)

    def test_wedding_dress_advice_still_answered(self):
        body = _ask("Ugu002", "婚紗可以洗嗎",
                    {"kind": "answer", "reply": "婚紗要先看洗標和材質，不一定都能水洗，可以拍照給我們看。"})
        self.assertIn("洗標", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
