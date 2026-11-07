# -*- coding: utf-8 -*-
"""L2-1: LINE usage counter (counts only; never customer text or ids)."""
from __future__ import annotations

import atexit
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from unittest import mock

HERE = Path(__file__).resolve().parent
_TMP = Path(tempfile.mkdtemp(prefix="line-usage-test-"))
atexit.register(shutil.rmtree, _TMP, True)
(_TMP / "data").mkdir()
_DATA_FILES = ("prices.json", "business-profile.json")
_HAVE_DATA = all((HERE.parent / "data" / name).is_file() for name in _DATA_FILES)
for _name in _DATA_FILES:
    if (HERE.parent / "data" / _name).is_file():
        shutil.copy2(HERE.parent / "data" / _name, _TMP / "data" / _name)
os.environ.update(
    LAUNDRY_REPO_ROOT=str(_TMP), LAUNDRY_LOOKUP_FIXTURE="1", LAUNDRY_AI_CHAT="off",
    LAUNDRY_CHAT_USAGE_DIR=str(_TMP / "data" / "chat-usage"),
    LAUNDRY_VISION_USAGE_DIR=str(_TMP / "data" / "vision-usage"),
    LAUNDRY_LINE_USAGE_DIR=str(_TMP / "data" / "line-usage-default"),
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

import line_usage  # noqa: E402

conv = None
if _HAVE_DATA:
    import conversation as conv  # noqa: E402

    if hasattr(conv, "cprof") and hasattr(conv.cprof, "PROFILE_PATH"):
        conv.cprof.PROFILE_PATH = _TMP / "data" / "line-customer-profile.json"

TAIPEI = timezone(line_usage.TAIPEI.utcoffset(None))
NOW = datetime(2026, 11, 10, 22, 15, tzinfo=TAIPEI)
UID = "U0123456789abcdef0123456789abcdef"
SECRET_TEXT = "zzqx-marker 0912345678 測試路99號 1280元"


class UsageCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="l21-")
        self.dir = Path(self._tmp.name) / "line-usage"
        self._env = {k: os.environ.get(k) for k in ("LAUNDRY_LINE_USAGE_DIR", "LAUNDRY_AI_CHAT", "LAUNDRY_LINE_USAGE")}
        os.environ["LAUNDRY_LINE_USAGE_DIR"] = str(self.dir)
        os.environ["LAUNDRY_AI_CHAT"] = "off"
        os.environ["LAUNDRY_LINE_USAGE"] = "on"  # the hook tests below act as the real bot process
        line_usage._WARNED = False

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def day_file(self, day="2026-11-10") -> Path:
        return self.dir / f"{day}.json"

    def load(self, day="2026-11-10") -> dict:
        return json.loads(self.day_file(day).read_text(encoding="utf-8"))


class MappingTests(unittest.TestCase):
    def test_table_values_are_known_outcomes(self):
        for intent, outcome in line_usage.OUTCOME_BY_INTENT.items():
            self.assertIn(outcome, line_usage.OUTCOMES, intent)
            self.assertRegex(intent, line_usage.INTENT_RE)

    def test_core_mapping(self):
        f = line_usage.outcome_for
        self.assertEqual(f("fallback"), "not_understood")
        self.assertEqual(f("meta_feedback"), "not_understood")
        for intent in ("human", "complaint", "ai_staff", "photo_need", "unknown_item", "payment_check"):
            self.assertEqual(f(intent), "to_staff", intent)
        for intent in ("ai_answer", "ai_side_question", "ai_resolved"):
            self.assertEqual(f(intent), "ai", intent)
        for intent in ("query", "quote", "faq", "hours_day", "pickup", "pre_wash", "clarify", "ack"):
            self.assertEqual(f(intent, "message", {"notify_staff": False, "staff_pushed": False}), "auto", intent)

    def test_staff_flag_moves_auto_to_to_staff(self):
        self.assertEqual(line_usage.outcome_for("query", "message", {"notify_staff": True}), "to_staff")
        self.assertEqual(line_usage.outcome_for("concern", "message", {"staff_pushed": True}), "to_staff")
        self.assertEqual(line_usage.outcome_for("cancel", "message", {"notify": True}), "to_staff")

    def test_not_understood_wins_over_staff_flag(self):
        self.assertEqual(line_usage.outcome_for("fallback", "message", {"notify_staff": True}), "not_understood")

    def test_unknown_future_intent_is_auto(self):
        self.assertEqual(line_usage.outcome_for("brand_new_flow"), "auto")
        self.assertEqual(line_usage.outcome_for(None), "auto")

    def test_non_text_events_are_other(self):
        for event in ("follow", "image", "image_error", "postback", "location", "sticker"):
            self.assertEqual(line_usage.outcome_for("welcome", event, {"notify_staff": True}), "other", event)


class FileTests(UsageCase):
    def test_schema_and_counts(self):
        for intent, event in (("quote", "message"), ("ai_answer", "message"), ("human", "message"),
                              ("fallback", "message"), ("welcome", "follow"), ("brand_new_flow", "message")):
            line_usage.count_reply(([], {"intent": intent, "notify_staff": False}), event, now=NOW)
        data = self.load()
        self.assertEqual(set(data), {"schema", "date", "messages", "by_outcome", "by_intent"})
        self.assertEqual(data["schema"], "line-usage/v1")
        self.assertEqual(data["date"], "2026-11-10")
        self.assertEqual(data["messages"], 6)
        self.assertEqual(set(data["by_outcome"]), set(line_usage.OUTCOMES))
        self.assertTrue(all(type(v) is int for v in data["by_outcome"].values()))
        self.assertEqual(sum(data["by_outcome"].values()), 6)
        self.assertEqual(data["by_outcome"], {"auto": 2, "ai": 1, "to_staff": 1, "not_understood": 1, "other": 1})
        self.assertEqual(data["by_intent"]["brand_new_flow"], 1)
        self.assertEqual(data["by_intent"]["welcome"], 1)

    def test_day_uses_taipei_date(self):
        utc_late = datetime(2026, 11, 9, 17, 30, tzinfo=timezone.utc)  # 2026-11-10 01:30 Taipei
        line_usage.count_reply(([], {"intent": "quote"}), now=utc_late)
        self.assertTrue(self.day_file("2026-11-10").is_file())
        self.assertFalse(self.day_file("2026-11-09").exists())

    def test_never_stores_text_uid_or_numbers(self):
        msgs = [{"type": "text", "text": "zzqx reply 1280"}]
        meta = {"intent": "quote", "uid": UID, "text": SECRET_TEXT, "phone": "0912345678",
                "price": 1280, "event_id": "evt-abc123", "name": "王小明"}
        line_usage.count_reply((msgs, meta), now=NOW)
        line_usage.count_reply((msgs, {"intent": "0912345678"}), now=NOW)
        line_usage.count_reply((msgs, {"intent": UID}), now=NOW)
        line_usage.count_reply((msgs, {"intent": SECRET_TEXT}), now=NOW)
        raw = self.day_file().read_text(encoding="utf-8")
        for secret in (UID, "0912345678", "1280", "evt-abc123", "zzqx", "王小明", SECRET_TEXT):
            self.assertNotIn(secret, raw)
        data = json.loads(raw)
        self.assertEqual(data["by_intent"], {"invalid": 3, "quote": 1})
        strings = [data["schema"], data["date"], *data["by_outcome"], *data["by_intent"]]
        for value in strings:
            self.assertIsInstance(value, str)
        self.assertFalse(any(ch.isdigit() for key in data["by_intent"] for ch in key))

    def test_atomic_write_keeps_old_file_on_replace_failure(self):
        line_usage.count_reply(([], {"intent": "quote"}), now=NOW)
        before = self.day_file().read_bytes()
        with mock.patch.object(line_usage.os, "replace", side_effect=OSError("disk full")):
            line_usage.count_reply(([], {"intent": "faq"}), now=NOW)  # must not raise
        self.assertEqual(self.day_file().read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["2026-11-10.json"])

    def test_corrupt_file_is_set_aside(self):
        self.dir.mkdir(parents=True)
        self.day_file().write_text("{not json", encoding="utf-8")
        line_usage.count_reply(([], {"intent": "quote"}), now=NOW)
        self.assertEqual(self.load()["messages"], 1)
        self.assertTrue((self.dir / "2026-11-10.json.bad").is_file())

    def test_unwritable_dir_is_swallowed_and_logged_once(self):
        blocker = Path(self._tmp.name) / "blocker"
        blocker.write_text("not a folder", encoding="utf-8")
        os.environ["LAUNDRY_LINE_USAGE_DIR"] = str(blocker / "line-usage")
        with self.assertLogs("line_usage", "WARNING") as logs:
            line_usage.count_reply(([], {"intent": "quote"}), now=NOW)
            line_usage.count_reply(([], {"intent": "quote"}), now=NOW)
        self.assertEqual(len(logs.records), 1)
        self.assertNotIn(str(blocker), logs.output[0])


class CliTests(UsageCase):
    def run_cli(self, *argv) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = line_usage.main(["report", *argv, "--dir", str(self.dir), "--date", "2026-11-10"])
        self.assertEqual(code, 0)
        return out.getvalue()

    def test_no_data_days_print_no_data_never_zero(self):
        text = self.run_cli("--days", "3")
        for day in ("2026-11-10", "2026-11-09", "2026-11-08"):
            self.assertIn(f"{day}  no data", text)
        self.assertIn("3-day total  no data", text)
        self.assertNotIn("0.0%", text)
        self.assertNotIn("=0", text)

    def test_rates_use_text_only_and_mark_partial_total(self):
        for intent in ("quote", "quote", "faq", "ai_answer", "human", "fallback"):
            line_usage.count_reply(([], {"intent": intent}), now=NOW)
        line_usage.count_reply(([], {"intent": "welcome"}), "follow", now=NOW)
        text = self.run_cli("--days", "3")
        self.assertIn("2026-11-10  messages=7 text=6  auto=50.0% ai=16.7% to_staff=16.7% not_understood=16.7%", text)
        self.assertIn("2026-11-09  no data", text)
        self.assertIn("3-day total  messages=7 text=6", text)
        self.assertIn("(partial: 1/3 days with data)", text)

    def test_unreadable_day(self):
        self.dir.mkdir(parents=True)
        self.day_file().write_text("[]", encoding="utf-8")
        text = self.run_cli("--days", "1")
        self.assertIn("2026-11-10  unreadable", text)
        self.assertIn("1-day total  no data (1 unreadable)", text)


@unittest.skipUnless(conv is not None, "data/prices.json or data/business-profile.json missing")
class HookTests(UsageCase):
    def today_file(self) -> Path:
        return self.dir / f"{line_usage.today_taipei().isoformat()}.json"

    def test_one_count_per_reply(self):
        msgs, meta = conv.handle_ex("Ul21hook0001", "電話")
        data = json.loads(self.today_file().read_text(encoding="utf-8"))
        self.assertEqual(data["messages"], 1)
        self.assertEqual(data["by_intent"], {line_usage.intent_key(meta.get("intent")): 1})

    def test_nested_calls_count_once(self):
        calls = []

        def fake(uid, text, event_type="message", event_id=""):
            if not calls:
                calls.append(1)
                conv.handle_ex(uid, text, event_type, event_id)  # like the pickup diversion
            return [], {"intent": "quote", "notify_staff": False, "staff_pushed": False}

        with mock.patch.object(conv, "_handle_ex_core", fake):
            conv.handle_ex("Ul21hook0002", "x")
        data = json.loads(self.today_file().read_text(encoding="utf-8"))
        self.assertEqual(data["messages"], 1)

    def test_exception_propagates_and_is_not_counted(self):
        def boom(*_a, **_k):
            raise ValueError("core failed")

        with mock.patch.object(conv, "_handle_ex_core", boom):
            with self.assertRaises(ValueError):
                conv.handle_ex("Ul21hook0003", "x")
        self.assertFalse(self.today_file().exists())

        def ok(*_a, **_k):
            return [], {"intent": "faq"}

        with mock.patch.object(conv, "_handle_ex_core", ok):
            conv.handle_ex("Ul21hook0003", "x")
        self.assertEqual(json.loads(self.today_file().read_text(encoding="utf-8"))["messages"], 1)

    def test_unwritable_dir_reply_unchanged(self):
        blocker = Path(self._tmp.name) / "blocker"
        blocker.write_text("not a folder", encoding="utf-8")
        os.environ["LAUNDRY_LINE_USAGE_DIR"] = str(blocker / "line-usage")
        got = conv.handle_ex("Ul21hook0004", "電話")
        expected = conv._handle_ex_core("Ul21hook0005", "電話")
        self.assertEqual(got, expected)

    def test_no_customer_text_or_uid_in_file(self):
        conv.handle_ex(UID, SECRET_TEXT)
        raw = self.today_file().read_text(encoding="utf-8")
        for secret in (UID, "0912345678", "zzqx", "1280", "測試路"):
            self.assertNotIn(secret, raw)
        self.assertEqual(json.loads(raw)["messages"], 1)

    def test_follow_event_counts_as_other(self):
        conv.handle_ex("Ul21hook0006", "", "follow")
        data = json.loads(self.today_file().read_text(encoding="utf-8"))
        self.assertEqual(data["by_outcome"]["other"], 1)
        self.assertEqual(sum(data["by_outcome"][k] for k in line_usage.TEXT_OUTCOMES), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
