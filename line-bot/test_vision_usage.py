# -*- coding: utf-8 -*-
"""Tests for the per-day photo model usage counter (counts only)."""
from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

import photo_estimate  # noqa: E402

FAKE_KEY = "fake-test-key-not-real-0123456789"
NAMES = ["棉T", "一般運動鞋", "長褲"]
ITEM = {"name": "棉T", "label": "白色棉T", "quantity": 1, "certainty": "clear", "reason": "短袖套頭",
        "brand": "", "model": "", "material": "棉", "color": "白", "stain": "", "craft": "一般水洗",
        "question": ""}
# 2024-10-31 12:00 in Taipei.
NOON_TAIPEI = datetime(2024, 10, 31, 4, 0, tzinfo=timezone.utc)
CHAIN = photo_estimate.DEFAULT_MODEL_CHAIN


class FakeResponse:
    def __init__(self, payload):
        self._raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n=-1):
        return self._raw if n is None or n < 0 else self._raw[:n]


def ok_response(finish="STOP", text=None):
    if text is None:
        text = json.dumps({"items": [ITEM]}, ensure_ascii=False)
    return FakeResponse({"candidates": [{"finishReason": finish, "content": {"parts": [{"text": text}]}}]})


def http_error(code):
    return urllib.error.HTTPError("https://example.invalid/model", code, "error", None, io.BytesIO(b""))


class VisionUsageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.usage = root / "usage"
        env = {
            "LAUNDRY_VISION_USAGE_DIR": str(self.usage),
            "GEMINI_API_KEY": FAKE_KEY,
            "LAUNDRY_PHOTO_ESTIMATE": "1",
            "LAUNDRY_VISION_KNOWLEDGE_DIR": str(root / "no-knowledge"),
        }
        env_patch = mock.patch.dict(os.environ, env)
        env_patch.start()
        self.addCleanup(env_patch.stop)
        for key in ("LAUNDRY_VISION_MODEL", "LAUNDRY_VISION_FALLBACK_MODEL"):
            os.environ.pop(key, None)
        sleep_patch = mock.patch.object(photo_estimate.time, "sleep")
        sleep_patch.start()
        self.addCleanup(sleep_patch.stop)
        self.clock = mock.patch.object(photo_estimate, "_utc_now", return_value=NOON_TAIPEI)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.photo = root / "photo.png"
        Image.new("RGB", (32, 32), (200, 30, 30)).save(self.photo)

    # helpers -----------------------------------------------------------
    def run_inventory(self, effects, paths=None):
        with mock.patch.object(photo_estimate.urllib.request, "urlopen", side_effect=list(effects)) as fake:
            result = photo_estimate.inventory(paths if paths is not None else [self.photo], NAMES)
        return result, fake

    def day_file(self, day="2024-10-31"):
        return self.usage / f"{day}.json"

    def load(self, day="2024-10-31"):
        return json.loads(self.day_file(day).read_text(encoding="utf-8"))

    def baseline(self, effects_factory):
        with mock.patch.object(photo_estimate, "_record_usage"):
            result, _ = self.run_inventory(effects_factory())
        return result

    # cases -------------------------------------------------------------
    def test_429_then_ok(self):
        result, fake = self.run_inventory([http_error(429), ok_response()])
        self.assertTrue(result["ok"])
        self.assertEqual(result["model"], CHAIN[1])
        self.assertEqual(fake.call_count, 2)
        data = self.load()
        self.assertEqual(data["schema"], "vision-usage/v1")
        self.assertEqual(data["date"], "2024-10-31")
        self.assertEqual((data["requests"], data["answered"], data["failed"]), (1, 1, 0))
        self.assertEqual(data["models"][CHAIN[0]], {"http_429": 1})
        self.assertEqual(data["models"][CHAIN[1]], {"ok": 1})

    def test_all_three_busy(self):
        result, fake = self.run_inventory([http_error(503)] * 3)
        self.assertEqual(result, {"ok": False, "error": "provider_503"})
        self.assertEqual(fake.call_count, 3)
        data = self.load()
        self.assertEqual((data["requests"], data["answered"], data["failed"]), (1, 0, 1))
        for model in CHAIN[:3]:
            self.assertEqual(data["models"][model], {"http_5xx": 1})
        self.assertNotIn(CHAIN[3], data["models"])

    def test_timeout_counted(self):
        result, _ = self.run_inventory([TimeoutError("timed out"), ok_response()])
        self.assertTrue(result["ok"])
        data = self.load()
        self.assertEqual(data["models"][CHAIN[0]], {"timeout": 1})
        self.assertEqual(data["models"][CHAIN[1]], {"ok": 1})

    def test_unusable_finish_reason(self):
        result, fake = self.run_inventory([ok_response(finish="MAX_TOKENS") for _ in range(3)])
        self.assertEqual(result, {"ok": False, "error": "unavailable"})
        self.assertEqual(fake.call_count, 3)
        data = self.load()
        self.assertEqual((data["requests"], data["answered"], data["failed"]), (1, 0, 1))
        for model in CHAIN[:3]:
            self.assertEqual(data["models"][model], {"unusable": 1})

    def test_unusable_bad_json(self):
        result, fake = self.run_inventory([ok_response(text="not json at all") for _ in range(3)])
        self.assertEqual(result, {"ok": False, "error": "unavailable"})
        self.assertEqual(fake.call_count, 3)
        for model in CHAIN[:3]:
            self.assertEqual(self.load()["models"][model], {"unusable": 1})

    def test_two_calls_accumulate(self):
        self.run_inventory([ok_response()])
        self.run_inventory([http_error(429), ok_response()])
        data = self.load()
        self.assertEqual((data["requests"], data["answered"], data["failed"]), (2, 2, 0))
        self.assertEqual(data["models"][CHAIN[0]], {"ok": 1, "http_429": 1})
        self.assertEqual(data["models"][CHAIN[1]], {"ok": 1})
        self.assertEqual([p.name for p in self.usage.iterdir()], ["2024-10-31.json"])

    def test_date_boundary_is_taipei(self):
        with mock.patch.object(photo_estimate, "_utc_now",
                               return_value=datetime(2024, 10, 31, 15, 59, 59, tzinfo=timezone.utc)):
            self.run_inventory([ok_response()])
        with mock.patch.object(photo_estimate, "_utc_now",
                               return_value=datetime(2024, 10, 31, 16, 0, 0, tzinfo=timezone.utc)):
            self.run_inventory([ok_response()])
        self.assertEqual(self.load("2024-10-31")["requests"], 1)
        self.assertEqual(self.load("2024-11-01")["requests"], 1)

    def test_not_counted_before_model_loop(self):
        os.environ.pop("GEMINI_API_KEY")
        result, fake = self.run_inventory([ok_response()])
        self.assertEqual(result, {"ok": False, "error": "not_configured"})
        os.environ["GEMINI_API_KEY"] = FAKE_KEY
        result, _ = self.run_inventory([ok_response()], paths=[self.photo] * 7)
        self.assertEqual(result, {"ok": False, "error": "too_many_photos"})
        self.assertFalse(self.day_file().exists())

    def test_corrupt_file_does_not_crash(self):
        def effects():
            return [http_error(429), ok_response()]
        expected = self.baseline(effects)
        self.assertFalse(self.day_file().exists())
        self.usage.mkdir(parents=True)
        self.day_file().write_text("{not json", encoding="utf-8")
        result, _ = self.run_inventory(effects())
        self.assertEqual(result, expected)
        data = self.load()
        self.assertEqual((data["requests"], data["answered"]), (1, 1))
        bad = self.usage / "2024-10-31.json.bad"
        self.assertEqual(bad.read_text(encoding="utf-8"), "{not json")

    def test_foreign_file_starts_fresh(self):
        self.usage.mkdir(parents=True)
        foreign = {"schema": "other/v9", "date": "2024-10-31", "requests": 99}
        self.day_file().write_text(json.dumps(foreign), encoding="utf-8")
        self.run_inventory([ok_response()])
        self.assertEqual(self.load()["requests"], 1)
        self.assertTrue((self.usage / "2024-10-31.json.bad").exists())

    def test_recorder_that_raises_is_swallowed(self):
        cases = [lambda: [http_error(429), ok_response()], lambda: [http_error(503)] * 3]
        for effects in cases:
            expected = self.baseline(effects)
            for error in (RuntimeError("boom"), AssertionError("audit hook"), OSError("disk full")):
                with mock.patch.object(photo_estimate, "_store_usage", side_effect=error):
                    result, _ = self.run_inventory(effects())
                self.assertEqual(result, expected)
                with mock.patch.object(photo_estimate, "_record_usage", side_effect=error):
                    result, _ = self.run_inventory(effects())
                self.assertEqual(result, expected)
        self.assertFalse(self.day_file().exists())

    def test_file_has_counts_only(self):
        self.run_inventory([http_error(429), ok_response()])
        raw = self.day_file().read_text(encoding="utf-8")
        forbidden = ["棉T", "白色棉T", "短袖套頭", "私享家", "品名", "洗衣", FAKE_KEY, "x-goog",
                     "generativelanguage", "http://", "https://", str(self.photo), self.tmp.name, "photo.png",
                     "candidates", "items"]
        for text in forbidden:
            self.assertNotIn(text, raw)
            self.assertNotIn(json.dumps(text, ensure_ascii=True).strip('"'), raw)
        data = json.loads(raw)
        self.assertEqual(set(data), {"schema", "date", "requests", "answered", "failed", "models"})
        for model, slot in data["models"].items():
            self.assertRegex(model, r"^gemini-[a-zA-Z0-9.-]+$")
            for key, value in slot.items():
                self.assertIn(key, photo_estimate._USAGE_KEYS)
                self.assertIs(type(value), int)
        self.assertEqual([p.name for p in self.usage.iterdir()], ["2024-10-31.json"])

    def test_cli_no_data_for_missing_day(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(photo_estimate.main(["usage", "--days", "2"]), 0)
        lines = out.getvalue().splitlines()
        self.assertEqual(lines, ["2024-10-31  no data", "2024-10-30  no data"])
        self.run_inventory([http_error(429), ok_response()])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            photo_estimate.main(["usage", "--days", "2"])
        lines = out.getvalue().splitlines()
        self.assertIn("requests=1 answered=1 failed=0", lines[0])
        self.assertIn(f"{CHAIN[0]} ok=0 429=1 5xx=0", lines[0])
        self.assertEqual(lines[1], "2024-10-30  no data")
        self.assertNotIn("requests=0", out.getvalue())

    def test_cli_script_entry_point(self):
        script = Path(photo_estimate.__file__).resolve()
        proc = subprocess.run([sys.executable, str(script), "usage", "--days", "3"],
                              capture_output=True, text=True, timeout=120, env=dict(os.environ))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = proc.stdout.splitlines()
        self.assertEqual(len(lines), 3)
        for line in lines:
            self.assertTrue(line.endswith("no data"), line)


if __name__ == "__main__":
    unittest.main()
