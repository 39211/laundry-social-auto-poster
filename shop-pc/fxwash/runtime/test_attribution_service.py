"""Offline tests for attribution_service (stdlib unittest, temp dirs, fixed secret)."""

import contextlib
import hashlib
import hmac
import io
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import attribution_service as attr

TZ8 = timezone(timedelta(hours=8))
SECRET_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90" * 2  # 32 bytes
SECRET = bytes.fromhex(SECRET_HEX)
SHOP, OA, RT = "fxwash-test", "oa-test", "rt-day"
USER_ID = "U0123456789abcdef0123456789abcdef"
MSG_ID = "587654321098765432"
_TS_DT = datetime(2026, 10, 30, 10, 0, 0, 123000, tzinfo=TZ8)
TS_MS = (_TS_DT - datetime(1970, 1, 1, tzinfo=timezone.utc)) // timedelta(milliseconds=1)

REGISTRY_DOC = {
    "schema_version": 1,
    "registry_version": "test-2026-10-30",
    "entries": [
        {"source_code": "SXJ-261030-S1", "content_id": "2026-10-30/slot-1", "kind": "slot",
         "date": "2026-10-30", "slot": 1, "feature_slug": None,
         "placements": ["facebook", "instagram"], "valid_from": "2026-10-30", "retired_at": None},
        {"source_code": "SXJ-261030-F01", "content_id": "2026-10-30/feature-down", "kind": "feature",
         "date": "2026-10-30", "slot": None, "feature_slug": "down-jacket",
         "placements": ["facebook"], "valid_from": "2026-10-30", "retired_at": None},
        {"source_code": "sxj-261031-s2", "content_id": "2026-10-31/slot-2", "kind": "slot",
         "date": "2026-10-31", "slot": 2, "feature_slug": None, "placements": [],
         "valid_from": "2026-10-31", "retired_at": None},
        {"source_code": "BAD-CODE", "content_id": "x", "kind": "slot"},
    ],
}
REGISTRY = attr.registry_from_document(REGISTRY_DOC)


def hmac_hex(key, value):
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()


def make_event(text="你好", webhook_id="01JTESTEVENT0000000000001", msg_type="text",
               source_type="user", user_id=USER_ID, event_type="message", ts_ms=TS_MS,
               msg_id=MSG_ID, reply_token="nHuyWiB7yP5Zw52FIkcQobQuGDXCTA"):
    source = {"type": source_type}
    if source_type == "group":
        source["groupId"] = "Cgroup0001"
    if source_type == "room":
        source["roomId"] = "Rroom0001"
    if user_id is not None:
        source["userId"] = user_id
    event = {"type": event_type, "source": source, "mode": "active"}
    if webhook_id is not None:
        event["webhookEventId"] = webhook_id
    if ts_ms is not None:
        event["timestamp"] = ts_ms
    if reply_token is not None:
        event["replyToken"] = reply_token
    if event_type == "message":
        msg = {"type": msg_type}
        if msg_id is not None:
            msg["id"] = msg_id
        if msg_type == "text":
            msg["text"] = text
        if msg_type == "sticker":
            msg["packageId"] = "1"
            msg["stickerId"] = "1"
        event["message"] = msg
    return event


class _TempBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.data_dir = self.root / "data"
        self.secret_path = self.root / "secrets" / "attribution_hmac.key"
        self.secret_path.parent.mkdir(parents=True)
        self.secret_path.write_text(SECRET_HEX + "\n", encoding="ascii")
        self.registry_path = self.root / "data" / "attribution" / "source-codes.json"
        self.registry_path.parent.mkdir(parents=True)
        self.registry_path.write_text(json.dumps(REGISTRY_DOC), encoding="utf-8")
        self.stderr = io.StringIO()
        redirect = contextlib.redirect_stderr(self.stderr)
        redirect.__enter__()
        self.addCleanup(redirect.__exit__, None, None, None)

    def make_ledger(self, **kwargs):
        return attr.AttributionLedger(self.data_dir, self.secret_path, SHOP, OA, RT, **kwargs)

    @property
    def ledger_path(self):
        return self.data_dir / "inquiries.jsonl"

    def rows(self):
        return [json.loads(line) for line in self.ledger_path.read_text(encoding="utf-8").splitlines() if line]


class TokenGrammarTests(unittest.TestCase):
    def test_valid_registered_code_ok(self):
        res = attr.extract_source("SXJ-261030-S1 想問羽絨衣", REGISTRY)
        self.assertEqual(res.source_status, "ok")
        self.assertEqual(res.source_code, "SXJ-261030-S1")
        self.assertEqual(res.stripped_text, "想問羽絨衣")

    def test_lower_case_is_canonicalized(self):
        res = attr.extract_source("sxj-261030-f01 價格?", REGISTRY)
        self.assertEqual(res.source_status, "ok")
        self.assertEqual(res.source_code, "SXJ-261030-F01")
        self.assertEqual(res.stripped_text, "價格?")

    def test_code_inside_word_is_ignored(self):
        for text in ("ABCSXJ-261030-S1 hi", "SXJ-261030-S1X hi", "SXJ-261030-S12", "x_SXJ-261030-S1"):
            res = attr.extract_source(text, REGISTRY)
            self.assertEqual(res.source_status, "unknown_no_code", text)
            self.assertIsNone(res.source_code)
            self.assertEqual(res.stripped_text, text)

    def test_overlong_token_run_is_ignored(self):
        text = "SXJ-261030-S1-" + "A" * 40 + " hi"
        res = attr.extract_source(text, REGISTRY)
        self.assertEqual(res.source_status, "unknown_no_code")
        self.assertEqual(res.stripped_text, text)

    def test_unregistered_code(self):
        res = attr.extract_source("SXJ-991231-S3 你好", REGISTRY)
        self.assertEqual(res.source_status, "unknown_unregistered_code")
        self.assertIsNone(res.source_code)
        self.assertEqual(res.stripped_text, "SXJ-991231-S3 你好")

    def test_multiple_different_codes_no_stripping(self):
        text = "SXJ-261030-S1 SXJ-261030-F01  想問"
        res = attr.extract_source(text, REGISTRY)
        self.assertEqual(res.source_status, "unknown_multiple_codes")
        self.assertIsNone(res.source_code)
        self.assertEqual(res.stripped_text, text)

    def test_same_code_twice_is_ok(self):
        res = attr.extract_source("SXJ-261030-S1 收送 sxj-261030-s1", REGISTRY)
        self.assertEqual(res.source_status, "ok")
        self.assertEqual(res.source_code, "SXJ-261030-S1")
        self.assertEqual(res.stripped_text, "收送")

    def test_invalid_slot_or_feature_number(self):
        for text in ("SXJ-261030-S4", "SXJ-261030-S0", "SXJ-261030-F1", "SXJ-26103-S1", "SXJ-2610301-S1"):
            self.assertEqual(attr.extract_source(text, REGISTRY).source_status, "unknown_no_code", text)

    def test_registered_plus_unregistered_keeps_registered(self):
        res = attr.extract_source("SXJ-261030-S1 SXJ-991231-S3 hi", REGISTRY)
        self.assertEqual(res.source_status, "ok")
        self.assertEqual(res.source_code, "SXJ-261030-S1")
        self.assertEqual(res.stripped_text, "SXJ-991231-S3 hi")

    def test_no_text_or_non_string(self):
        self.assertEqual(attr.extract_source("", REGISTRY).source_status, "unknown_no_code")
        self.assertEqual(attr.extract_source(None, REGISTRY).source_status, "unknown_no_code")
        self.assertEqual(attr.extract_source("SXJ-261030-S1", None).source_status, "unknown_unregistered_code")

    def test_repr_does_not_contain_text(self):
        res = attr.extract_source("SXJ-261030-S1 祕密內容", REGISTRY)
        self.assertNotIn("祕密內容", repr(res))


class StrippingTests(unittest.TestCase):
    def test_strip_keeps_rest_and_normalizes_whitespace(self):
        text = "我想問  SXJ-261030-F01\t羽絨衣  多少錢\n\n第二行 保持"
        res = attr.extract_source(text, REGISTRY)
        self.assertEqual(res.source_status, "ok")
        self.assertEqual(res.stripped_text, "我想問 羽絨衣 多少錢\n\n第二行 保持")

    def test_strip_adjacent_cjk_and_quotes(self):
        self.assertEqual(attr.extract_source("想問SXJ-261030-S1價格", REGISTRY).stripped_text, "想問價格")
        self.assertEqual(attr.extract_source("請問『SXJ-261030-S1』羽絨衣多少錢", REGISTRY).stripped_text,
                         "請問羽絨衣多少錢")
        self.assertEqual(attr.extract_source("「SXJ-261030-S1」34", REGISTRY).stripped_text, "34")

    def test_line_with_only_code_is_dropped(self):
        res = attr.extract_source("SXJ-261030-S1\n0912345678", REGISTRY)
        self.assertEqual(res.stripped_text, "0912345678")
        res = attr.extract_source("SXJ-261030-S1", REGISTRY)
        self.assertEqual(res.source_status, "ok")
        self.assertEqual(res.stripped_text, "")


class RegistryTests(_TempBase):
    def test_missing_registry_file(self):
        reg = attr.load_source_registry(self.root / "nope.json")
        self.assertEqual(reg.registry_version, "none")
        self.assertEqual(len(reg.entries), 0)
        self.assertEqual(attr.extract_source("SXJ-261030-S1", reg).source_status, "unknown_unregistered_code")

    def test_corrupt_registry_file(self):
        bad = self.root / "bad.json"
        bad.write_text("{not json", encoding="utf-8")
        reg = attr.load_source_registry(bad)
        self.assertEqual(reg.registry_version, "invalid")
        self.assertEqual(len(reg.entries), 0)
        self.assertIn("[ATTRIBUTION_ERROR] RegistryInvalid", self.stderr.getvalue())

    def test_registry_canonicalizes_and_skips_invalid(self):
        reg = attr.load_source_registry(self.registry_path)
        self.assertEqual(reg.registry_version, "test-2026-10-30")
        self.assertEqual(reg.codes, frozenset({"SXJ-261030-S1", "SXJ-261030-F01", "SXJ-261031-S2"}))
        self.assertEqual(reg.skipped_entries, 1)
        self.assertEqual(reg.entries["SXJ-261030-S1"].placements, ("facebook", "instagram"))


class IntentTests(unittest.TestCase):
    def test_lookup(self):
        for text in ("0912-345-678", "0912345678 謝謝", "我的單號", "客號 34", "洗好了嗎 進度", "查件 多少錢"):
            self.assertEqual(attr.classify_intent(text, "text"), "lookup", text)

    def test_quote(self):
        for text in ("這件羽絨衣多少錢", "估價", "費用怎麼算", "可以洗這個嗎"):
            self.assertEqual(attr.classify_intent(text, "text"), "quote", text)
        self.assertEqual(attr.classify_intent("", "image"), "quote")

    def test_pickup(self):
        for text in ("可以到府收送嗎", "什麼時候來收", "取件時間"):
            self.assertEqual(attr.classify_intent(text, "text"), "pickup", text)

    def test_other_and_code_digits_not_phone(self):
        self.assertEqual(attr.classify_intent("你好", "text"), "other")
        self.assertEqual(attr.classify_intent("SXJ-261030-F01 你好", "text"), "other")
        # Without token removal "F01 23456789" would form 10 digits.
        self.assertEqual(attr.classify_intent("SXJ-261030-F01 23456789", "text"), "other")
        self.assertEqual(attr.classify_intent("", "audio"), "other")


class LedgerTests(_TempBase):
    def test_message_row_fields(self):
        ledger = self.make_ledger()
        src = attr.extract_source("SXJ-261030-S1 羽絨衣多少錢", REGISTRY)
        row = ledger.record_message(make_event("SXJ-261030-S1 羽絨衣多少錢"), src, REGISTRY.registry_version)
        self.assertIsNotNone(row)
        expected_keys = {
            "schema_version", "policy_version", "event_kind", "event_id", "event_id_basis", "ts", "ts_basis",
            "recorded_at", "shop_id", "oa_scope", "runtime_id", "user_key", "hash_key_version",
            "message_key", "message_type", "first_intent", "intent_basis", "source_code", "source_method",
            "source_status", "source_registry_version",
        }
        self.assertEqual(set(row), expected_keys)
        self.assertEqual(row["schema_version"], 1)
        self.assertEqual(row["policy_version"], "v1")
        self.assertEqual(row["event_kind"], "message_observed")
        self.assertEqual(row["event_id"], OA + ":01JTESTEVENT0000000000001")
        self.assertEqual(row["event_id_basis"], "line")
        self.assertEqual(row["ts"], "2026-10-30T10:00:00.123+08:00")
        self.assertTrue(row["recorded_at"].endswith("+08:00"))
        self.assertEqual(row["user_key"], hmac_hex(SECRET, SHOP + "|" + OA + "|" + USER_ID))
        self.assertEqual(row["message_key"], hmac_hex(SECRET, MSG_ID))
        self.assertEqual(row["first_intent"], "quote")
        self.assertEqual(row["intent_basis"], "rule_v1")
        self.assertEqual(row["source_code"], "SXJ-261030-S1")
        self.assertEqual(row["source_method"], "keyword")
        self.assertEqual(row["source_status"], "ok")
        self.assertEqual(row["source_registry_version"], "test-2026-10-30")
        self.assertEqual(self.rows(), [row])

    def test_non_user_and_non_message_events_ignored(self):
        ledger = self.make_ledger()
        cases = [
            make_event(source_type="group"),
            make_event(source_type="room"),
            make_event(event_type="follow"),
            make_event(event_type="unfollow"),
            make_event(msg_type="sticker"),
            make_event(user_id=None),
            make_event(reply_token="0" * 32),
        ]
        for ev in cases:
            self.assertIsNone(ledger.record_message(ev, None, "v"))
        self.assertFalse(self.ledger_path.exists())

    def test_image_message_recorded_as_quote(self):
        ledger = self.make_ledger()
        row = ledger.record_message(make_event(msg_type="image", webhook_id="IMG1"), None, "v")
        self.assertEqual(row["message_type"], "image")
        self.assertEqual(row["first_intent"], "quote")
        self.assertEqual(row["source_status"], "unknown_no_code")
        self.assertIsNone(row["source_code"])

    def test_dedupe_across_instances_via_replay(self):
        first = self.make_ledger()
        self.assertIsNotNone(first.record_message(make_event(webhook_id="E1"), None, "v"))
        self.assertIsNone(first.record_message(make_event(webhook_id="E1"), None, "v"))
        second = self.make_ledger()
        self.assertIsNone(second.record_message(make_event(webhook_id="E1"), None, "v"))
        self.assertIsNotNone(second.record_message(make_event(webhook_id="E2"), None, "v"))
        self.assertEqual(len(self.rows()), 2)
        self.assertEqual(second.coverage_gaps, [])

    def test_dedupe_between_live_instances(self):
        a = self.make_ledger()
        b = self.make_ledger()
        self.assertIsNotNone(a.record_message(make_event(webhook_id="E1"), None, "v"))
        self.assertIsNone(b.record_message(make_event(webhook_id="E1"), None, "v"))
        self.assertIsNotNone(b.record_message(make_event(webhook_id="E2"), None, "v"))
        self.assertIsNone(a.record_message(make_event(webhook_id="E2"), None, "v"))
        self.assertEqual(len(self.rows()), 2)

    def test_missing_webhook_event_id_uses_local_basis(self):
        ledger = self.make_ledger()
        r1 = ledger.record_message(make_event(webhook_id=None, ts_ms=None), None, "v")
        r2 = ledger.record_message(make_event(webhook_id=None), None, "v")
        self.assertEqual(r1["event_id_basis"], "local")
        self.assertTrue(r1["event_id"].startswith(OA + ":local-"))
        self.assertEqual(r1["ts_basis"], "local")
        self.assertNotEqual(r1["event_id"], r2["event_id"])
        self.assertEqual(len(self.rows()), 2)

    def test_lock_busy_returns_none_and_records_gap(self):
        ledger = self.make_ledger(lock_timeout=0.2, busy_cooldown=0.0)
        ledger.lock_path.write_text("held by test", encoding="ascii")
        t0 = time.monotonic()
        res = ledger.record_message(make_event(webhook_id="B1"), None, "v")
        elapsed = time.monotonic() - t0
        self.assertIsNone(res)
        self.assertGreaterEqual(elapsed, 0.15)
        self.assertLess(elapsed, 1.5)
        self.assertIn("[ATTRIBUTION_ERROR] LedgerBusy", self.stderr.getvalue())
        self.assertTrue(any(g.get("reason") == "ledger_busy" for g in ledger.coverage_gaps))
        ledger.lock_path.unlink()
        # The failed event was not marked as seen: a LINE redelivery can still be recorded.
        self.assertIsNotNone(ledger.record_message(make_event(webhook_id="B1"), None, "v"))

    def test_lock_wait_raises_ledger_busy(self):
        ledger = self.make_ledger()
        ledger.lock_path.write_text("held", encoding="ascii")
        with self.assertRaises(attr.LedgerBusy):
            ledger._acquire_file_lock(time.monotonic() + 0.1)

    def test_busy_cooldown_fails_fast(self):
        ledger = self.make_ledger(lock_timeout=0.2, busy_cooldown=60.0)
        ledger.lock_path.write_text("held", encoding="ascii")
        self.assertIsNone(ledger.record_message(make_event(webhook_id="C1"), None, "v"))
        t0 = time.monotonic()
        self.assertIsNone(ledger.record_message(make_event(webhook_id="C2"), None, "v"))
        self.assertLess(time.monotonic() - t0, 0.1)
        self.assertTrue(any(g.get("reason") == "busy_cooldown" for g in ledger.coverage_gaps))

    def test_stale_lock_is_broken(self):
        ledger = self.make_ledger()
        ledger.lock_path.write_text("crashed writer", encoding="ascii")
        old = time.time() - 120
        os.utime(ledger.lock_path, (old, old))
        self.assertIsNotNone(ledger.record_message(make_event(webhook_id="S1"), None, "v"))
        self.assertTrue(any(g["kind"] == "stale_lock_broken" for g in ledger.coverage_gaps))
        self.assertFalse(ledger.lock_path.exists())

    def test_corrupt_last_line_reported_and_append_still_works(self):
        a = self.make_ledger()
        a.record_message(make_event(webhook_id="E1"), None, "v")
        with open(self.ledger_path, "ab") as handle:
            handle.write(b'{"event_id":"oa-test:TRUNC","schema_')
        b = self.make_ledger()
        self.assertIn("corrupt_last_line", [g["kind"] for g in b.coverage_gaps])
        self.assertNotIn("TRUNC", json.dumps(b.coverage_gaps))
        row = b.record_message(make_event(webhook_id="E2"), None, "v")
        self.assertIsNotNone(row)
        lines = self.ledger_path.read_bytes().split(b"\n")
        self.assertEqual(lines[-1], b"")
        self.assertEqual(json.loads(lines[0])["event_id"], OA + ":E1")
        self.assertEqual(json.loads(lines[-2])["event_id"], OA + ":E2")
        c = self.make_ledger()
        middle = [g for g in c.coverage_gaps if g["kind"] == "corrupt_line"]
        self.assertEqual(len(middle), 1)
        self.assertEqual(middle[0]["line_no"], 2)
        self.assertIsNone(c.record_message(make_event(webhook_id="E1"), None, "v"))
        self.assertIsNone(c.record_message(make_event(webhook_id="E2"), None, "v"))

    def test_corrupt_middle_line_reported_and_skipped(self):
        a = self.make_ledger()
        a.record_message(make_event(webhook_id="E1"), None, "v")
        with open(self.ledger_path, "ab") as handle:
            handle.write(b"not json at all\n")
        self.assertIsNotNone(a.record_message(make_event(webhook_id="E2"), None, "v"))
        self.assertEqual([g["kind"] for g in a.coverage_gaps], ["corrupt_line"])
        b = self.make_ledger()
        self.assertEqual(len(b.coverage_gaps), 1)
        self.assertEqual(b.coverage_gaps[0]["kind"], "corrupt_line")
        self.assertEqual(b.coverage_gaps[0]["line_no"], 2)
        self.assertEqual(b.status()["indexed_event_ids"], 2)
        self.assertIsNone(b.record_message(make_event(webhook_id="E2"), None, "v"))

    def test_missing_secret_disabled_mode(self):
        ledger = attr.AttributionLedger(self.data_dir, self.root / "nope.key", SHOP, OA, RT)
        self.assertFalse(ledger.enabled)
        self.assertIsNone(ledger.record_message(make_event(webhook_id="D1"), None, "v"))
        self.assertIsNone(ledger.record_message(make_event(webhook_id="D2"), None, "v"))
        self.assertIsNone(ledger.record_binding_observed(USER_ID, "0034", "phone_lookup"))
        self.assertEqual(self.stderr.getvalue().count("[ATTRIBUTION_DISABLED] no hmac secret"), 1)
        self.assertFalse(self.ledger_path.exists())

    def test_short_secret_disabled_and_raw_secret_accepted(self):
        short = self.root / "short.key"
        short.write_text("abcd", encoding="ascii")
        self.assertFalse(attr.AttributionLedger(self.data_dir, short, SHOP, OA, RT).enabled)
        raw_key = bytes(range(48))
        raw = self.root / "raw.key"
        raw.write_bytes(raw_key)
        ledger = attr.AttributionLedger(self.data_dir, raw, SHOP, OA, RT)
        self.assertTrue(ledger.enabled)
        row = ledger.record_message(make_event(webhook_id="R1"), None, "v")
        self.assertEqual(row["user_key"], hmac_hex(raw_key, SHOP + "|" + OA + "|" + USER_ID))
        self.assertNotEqual(row["hash_key_version"], self.make_ledger().hash_key_version)

    def test_no_raw_user_id_or_text_in_jsonl(self):
        ledger = self.make_ledger()
        text = "SXJ-261030-S1 我想問羽絨衣多少錢 0912345678 住址青海路"
        src = attr.extract_source(text, REGISTRY)
        row = ledger.record_message(make_event(text, webhook_id="P1"), src, REGISTRY.registry_version)
        self.assertEqual(row["first_intent"], "lookup")
        ledger.record_message(make_event(msg_type="image", webhook_id="P2"), None, "v")
        ledger.record_binding_observed(USER_ID, "A0034", "phone_lookup")
        ledger.record_binding_observed(USER_ID, "12/34", "phone_lookup")
        content = self.ledger_path.read_text(encoding="utf-8")
        for needle in (USER_ID, MSG_ID, "羽絨衣", "我想問", "0912345678", "青海路", "A0034", "12/34", SECRET_HEX):
            self.assertNotIn(needle, content)
            self.assertNotIn(needle, self.stderr.getvalue())
        self.assertIn("SXJ-261030-S1", content)  # public code is allowed

    def test_binding_composite_cid_is_identity_ambiguous(self):
        ledger = self.make_ledger()
        for cid in ("12/34", "12\uff0f34", "12,34", "12 34"):
            row = ledger.record_binding_observed(USER_ID, cid, "phone_lookup")
            self.assertEqual(row["event_kind"], "binding_observed")
            self.assertIsNone(row["cid_key"])
            self.assertEqual(row["identity_status"], "identity_ambiguous")
        self.assertEqual(len(self.rows()), 4)

    def test_binding_single_cid_key(self):
        ledger = self.make_ledger()
        row = ledger.record_binding_observed(USER_ID, " 0034 ", "cid_lookup")
        self.assertEqual(row["identity_status"], "single")
        self.assertEqual(row["cid_key"], hmac_hex(SECRET, "0034"))
        self.assertNotEqual(row["cid_key"], hmac_hex(SECRET, "34"))
        self.assertEqual(row["binding_trust"], "observed")
        self.assertEqual(row["binding_basis"], "cid_lookup")
        self.assertEqual(row["user_key"], hmac_hex(SECRET, SHOP + "|" + OA + "|" + USER_ID))
        self.assertEqual(ledger.record_binding_observed(USER_ID, "1", "Bad Basis!")["binding_basis"], "other")
        self.assertIsNone(ledger.record_binding_observed("", "0034", "cid_lookup"))

    def test_record_errors_are_caught_without_content(self):
        ledger = self.make_ledger()
        self.assertIsNone(ledger.record_message("not-a-dict", None, "v"))
        bogus = attr.SourceResult("SXJ-261030-S1", "bogus", "x")
        self.assertIsNone(ledger.record_message(make_event(webhook_id="X1"), bogus, "v"))
        sneaky = attr.SourceResult("hello " + USER_ID, "ok", "x")
        self.assertIsNone(ledger.record_message(make_event(webhook_id="X2"), sneaky, "v"))
        err = self.stderr.getvalue()
        self.assertIn("[ATTRIBUTION_ERROR] TypeError", err)
        self.assertEqual(err.count("[ATTRIBUTION_ERROR] ValueError"), 2)
        self.assertNotIn(USER_ID, err)
        self.assertFalse(self.ledger_path.exists())

    def test_init_attribution_not_configured_and_configured(self):
        ledger, registry = attr.init_attribution(self.root, None)
        self.assertIsNone(ledger)
        self.assertEqual(registry.registry_version, "none")
        self.assertIn("[ATTRIBUTION_DISABLED] not configured", self.stderr.getvalue())
        cfg = {"enabled": True, "secret_path": "secrets/attribution_hmac.key",
               "registry_path": "data/attribution/source-codes.json"}
        ledger, registry = attr.init_attribution(self.root, cfg)
        self.assertIsNotNone(ledger)
        self.assertTrue(ledger.enabled)
        self.assertEqual(registry.registry_version, "test-2026-10-30")
        self.assertEqual(ledger.path, self.root / "data" / "inquiries.jsonl")
        cfg_missing = dict(cfg, secret_path="secrets/missing.key")
        ledger, registry = attr.init_attribution(self.root, cfg_missing)
        self.assertIsNone(ledger)
        self.assertEqual(registry.registry_version, "test-2026-10-30")
        self.assertIn("[ATTRIBUTION_DISABLED] no hmac secret", self.stderr.getvalue())


class ReplacementTests(_TempBase):
    """Another process (retention) rewrites the ledger under a live instance."""

    def _kept_bytes(self, drop_ids):
        lines = self.ledger_path.read_bytes().splitlines(keepends=True)
        return b"".join(l for l in lines if json.loads(l)["event_id"] not in drop_ids)

    def _rewrite_in_place(self, drop_ids):
        kept = self._kept_bytes(drop_ids)
        with open(self.ledger_path, "r+b") as handle:  # same file identity
            handle.seek(0)
            handle.write(kept)
            handle.truncate()
            handle.flush()
            os.fsync(handle.fileno())

    def _bump(self):
        gen = attr.read_ledger_generation(self.data_dir)
        (self.data_dir / "inquiries.jsonl.gen").write_text(str(max(gen, 0) + 1), encoding="ascii")

    def _lagging_setup(self):
        writer = self.make_ledger()
        for i in (1, 2):
            writer.record_message(make_event(webhook_id="E%d" % i), None, "v")
        live = self.make_ledger()
        self.assertEqual(live.status()["indexed_event_ids"], 2)
        for i in range(3, 7):
            writer.record_message(make_event(webhook_id="E%d" % i), None, "v")
        return live

    def _assert_recovered(self, live):
        self.assertIsNone(live.record_message(make_event(webhook_id="E4"), None, "v"))
        self.assertIsNotNone(live.record_message(make_event(webhook_id="E7"), None, "v"))
        self.assertEqual(live.ledger_replaced_count, 1)
        self.assertEqual(live.coverage_gaps, [])
        self.assertEqual(live.status()["indexed_event_ids"], 6)
        self.assertEqual([r["event_id"] for r in self.rows()], [OA + ":E%d" % i for i in range(2, 8)])

    def test_generation_bump_forces_full_replay(self):
        live = self._lagging_setup()
        self._rewrite_in_place({OA + ":E1"})
        self._bump()
        # Bigger than the live offset: the shrink check alone could not notice.
        self.assertGreater(self.ledger_path.stat().st_size, live._offset)
        self._assert_recovered(live)

    def test_replaced_file_detected_by_identity_without_generation(self):
        live = self._lagging_setup()
        if not os.stat(self.ledger_path).st_ino:
            self.skipTest("file identity not available on this filesystem")
        tmp = self.data_dir / "replacement.tmp"
        tmp.write_bytes(self._kept_bytes({OA + ":E1"}))
        os.replace(tmp, self.ledger_path)
        self._assert_recovered(live)

    def test_shrunk_file_is_replayed(self):
        writer = self.make_ledger()
        for i in (1, 2, 3):
            writer.record_message(make_event(webhook_id="E%d" % i), None, "v")
        self._rewrite_in_place({OA + ":E1", OA + ":E2"})
        self.assertIsNone(writer.record_message(make_event(webhook_id="E3"), None, "v"))
        self.assertIsNotNone(writer.record_message(make_event(webhook_id="E4"), None, "v"))
        self.assertIn("ledger_shrunk", [g["kind"] for g in writer.coverage_gaps])
        self.assertEqual(writer.status()["indexed_event_ids"], 2)

    def test_generation_reader(self):
        self.assertEqual(attr.read_ledger_generation(self.data_dir), 0)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "inquiries.jsonl.gen").write_text("7\n", encoding="ascii")
        self.assertEqual(attr.read_ledger_generation(self.data_dir), 7)
        (self.data_dir / "inquiries.jsonl.gen").write_text("garbage", encoding="ascii")
        self.assertEqual(attr.read_ledger_generation(self.data_dir), -1)


if __name__ == "__main__":
    unittest.main()