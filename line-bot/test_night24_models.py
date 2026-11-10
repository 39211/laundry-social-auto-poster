"""NIGHT24 A7: offline HTTP fakes; ephemeral keys never appear in test output/artifacts."""
from contextlib import redirect_stdout, redirect_stderr
import io
import json
import logging
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock
import urllib.error
import uuid

import ai_chat as chat
import photo_estimate as photo


class Response:
    def __init__(self, value):
        self.value = json.dumps({"candidates": [{"finishReason": "STOP", "content": {
            "parts": [{"text": json.dumps(value)}]}}]}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, limit):
        return self.value[:limit]


ANSWER = {"kind": "answer", "reply": "可以先拍洗標給店裡看看。"}


class Night24ModelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        # Generate values at runtime: neither source files nor failed equality diffs contain them.
        self.chat_key, self.photo_key = (uuid.uuid4().hex for _ in range(2))
        self.env = mock.patch.dict(os.environ, {
            "LAUNDRY_CHAT_GEMINI_KEY": self.chat_key, "GEMINI_API_KEY": self.photo_key,
            "LAUNDRY_AI_CHAT": "on", "LAUNDRY_PHOTO_ESTIMATE": "1",
            "LAUNDRY_CHAT_USAGE_DIR": str(self.root / "chat"),
            "LAUNDRY_VISION_USAGE_DIR": str(self.root / "vision"),
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        for name in ("LAUNDRY_CHAT_MODELS", "LAUNDRY_CHAT_THINKING", "LAUNDRY_VISION_MODEL", "LAUNDRY_VISION_FALLBACK_MODEL"):
            os.environ.pop(name, None)
        for patcher in (mock.patch.object(chat, "_MODEL_FN", None),
                        mock.patch.object(chat, "build_prompt", return_value="synthetic")):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.output = io.StringIO()
        for manager in (redirect_stdout(self.output), redirect_stderr(self.output)):
            manager.__enter__()
            self.addCleanup(manager.__exit__, None, None, None)
        handler = logging.StreamHandler(self.output)
        logging.getLogger().addHandler(handler)
        self.addCleanup(logging.getLogger().removeHandler, handler)

    def tearDown(self):
        contents = self.output.getvalue().encode() + b"".join(p.read_bytes() for p in self.root.rglob("*") if p.is_file())
        self.assertTrue(all(key.encode() not in contents for key in (self.chat_key, self.photo_key)), "key leaked to output/artifact")

    def decide(self):
        return chat._decide(SimpleNamespace(REPO=self.root), "測試問題", "")

    def test_defaults_have_no_lite_and_vision_order_is_preserved(self):
        self.assertEqual(chat.CHAT_MODEL_CHAIN, ("gemini-3.8-flash", "gemini-3.5-flash"))
        self.assertEqual(chat._chain(), list(chat.CHAT_MODEL_CHAIN))
        self.assertEqual(photo.DEFAULT_MODEL_CHAIN, ("gemini-2.5-flash", "gemini-flash-latest", "gemini-3.5-flash"))
        self.assertFalse(any("lite" in model.lower() for model in (*chat.CHAT_MODEL_CHAIN, *photo.DEFAULT_MODEL_CHAIN)))
        os.environ["LAUNDRY_VISION_MODEL"] = "gemini-3.8-flash"
        self.assertEqual(photo.model_chain(), ["gemini-3.8-flash", "gemini-3.5-flash"])

    def test_overrides_filter_lite_and_invalid_names_before_call_limit(self):
        os.environ["LAUNDRY_CHAT_MODELS"] = "gemini-2.5-flash-lite, gemini-3.7-flash, gemini-3.5-FLASH-LITE, bad/name,gemini-3.5-flash"
        self.assertEqual(chat._chain(), ["gemini-3.7-flash", "gemini-3.5-flash"])
        os.environ["LAUNDRY_CHAT_MODELS"] = "gemini-flash-lite-latest"
        self.assertEqual(chat._chain(), list(chat.CHAT_MODEL_CHAIN))

    def test_chat_uses_dedicated_key_and_photo_uses_original_key(self):
        observed = []

        def call(req, **_kwargs):
            is_photo = "inlineData" in req.data.decode()
            expected = self.photo_key if is_photo else self.chat_key
            observed.append((is_photo, req.get_header("X-goog-api-key") == expected))
            if is_photo:
                return Response({"items": [{"name": "棉T", "label": "棉T", "quantity": 1, "certainty": "clear",
                    "reason": "短袖", "brand": "", "model": "", "material": "棉", "color": "白", "stain": "",
                    "craft": "一般水洗", "question": ""}]})
            return Response(ANSWER)

        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            self.assertEqual(self.decide(), ANSWER)
            path = mock.Mock()
            path.stat.return_value.st_size = 1
            original = mock.MagicMock(width=1, height=1)
            with mock.patch.object(photo.Image, "open") as image_open, \
                    mock.patch.object(photo.ImageOps, "exif_transpose"), \
                    mock.patch.object(photo, "build_prompt", return_value="synthetic"):
                image_open.return_value.__enter__.return_value = original
                result = photo.inventory([path], ["棉T"])
            self.assertTrue(result["ok"])
        self.assertEqual([x[0] for x in observed], [False, True])
        self.assertTrue(all(x[1] for x in observed), "chat/photo key routing mismatch")
        self.assertTrue(list((self.root / "chat").glob("*.json")))
        self.assertTrue(list((self.root / "vision").glob("*.json")))

    def test_chat_key_without_photo_key_is_available(self):
        os.environ.pop("GEMINI_API_KEY")
        self.assertTrue(chat.available())
        self.assertFalse(photo.configured())

    def test_chat_falls_back_to_original_key_when_override_absent_or_empty(self):
        for value in (None, ""):
            if value is None:
                os.environ.pop("LAUNDRY_CHAT_GEMINI_KEY", None)
            else:
                os.environ["LAUNDRY_CHAT_GEMINI_KEY"] = value
            matched = []
            def call(req, **_kwargs):
                matched.append(req.get_header("X-goog-api-key") == self.photo_key)
                return Response(ANSWER)
            with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
                self.assertEqual(self.decide(), ANSWER)
            self.assertTrue(matched and all(matched), "fallback key mismatch")

    def test_thinking_defaults_and_override(self):
        for model, level in (("gemini-3.8-flash", "low"), ("gemini-3.7-flash", "low"), ("gemini-3.5-flash", "minimal")):
            with mock.patch.object(chat.urllib.request, "urlopen", return_value=Response(ANSWER)) as call:
                chat._gemini_call(model, "synthetic", 1)
            self.assertEqual(json.loads(call.call_args.args[0].data)["generationConfig"]["thinkingConfig"], {"thinkingLevel": level})
        os.environ["LAUNDRY_CHAT_THINKING"] = " HIGH "
        self.assertEqual(chat._thinking_level("gemini-3.8-flash"), "high")

    def test_38_minimal_400_retries_low_once_within_same_budget(self):
        os.environ["LAUNDRY_CHAT_THINKING"] = "MINIMAL"
        levels, timeouts = [], []
        def call(req, timeout):
            levels.append(json.loads(req.data)["generationConfig"]["thinkingConfig"]["thinkingLevel"])
            timeouts.append(timeout)
            if len(levels) == 1:
                error = ("thinking level not supported " + self.chat_key).encode()
                raise urllib.error.HTTPError(req.full_url, 400, "bad request", {}, io.BytesIO(error))
            return Response(ANSWER)
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(levels, ["minimal", "low"])
        self.assertLessEqual(timeouts[1], timeouts[0])
        usage = json.loads(next((self.root / "chat").glob("*.json")).read_text())
        self.assertEqual(usage["models"]["gemini-3.8-flash"], {"http_400": 1, "ok": 1})

    def test_first_model_timeout_moves_to_35(self):
        models = []
        def call(req, **_kwargs):
            models.append(req.full_url.split("/models/", 1)[1].split(":", 1)[0])
            if len(models) == 1:
                raise TimeoutError(self.chat_key)
            return Response(ANSWER)
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(models, ["gemini-3.8-flash", "gemini-3.5-flash"])

    def test_last_model_gets_the_remaining_budget_after_a_fast_failure(self):
        # 11/10 live: gemini-3.8-flash answered 429 (free tier 20/day) in 0.3s while 3.5 Flash took ~6s;
        # a 4.5s per-call cap then dropped the 3.5 answer although 9.7s of the 10s budget were left.
        timeouts = []
        def call(model, _prompt, timeout):
            timeouts.append((model, timeout))
            if model == "gemini-3.8-flash":
                raise chat.ModelError("http_429")
            return json.dumps(ANSWER)
        with mock.patch.object(chat, "_MODEL_FN", call):
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual([m for m, _ in timeouts], ["gemini-3.8-flash", "gemini-3.5-flash"])
        self.assertLessEqual(timeouts[0][1], chat.PER_CALL_SECONDS)
        self.assertGreater(timeouts[1][1], chat.PER_CALL_SECONDS + 3)
        self.assertLessEqual(timeouts[1][1], chat.TOTAL_SECONDS)

    def test_unrelated_400_does_not_retry_same_model(self):
        error = urllib.error.HTTPError("synthetic", 400, "bad request", {}, io.BytesIO(b"invalid schema"))
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=[error, Response(ANSWER)]) as call:
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(call.call_count, 2)
        self.assertIn("gemini-3.5-flash", call.call_args.args[0].full_url)

    def test_repeated_thinking_error_is_bounded_and_falls_back(self):
        os.environ["LAUNDRY_CHAT_THINKING"] = "minimal"
        calls = []
        def call(req, **_kwargs):
            calls.append(req.full_url)
            raise urllib.error.HTTPError("synthetic", 400, "bad request", {}, io.BytesIO(b"thinkingLevel is not supported"))
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            self.assertIsNone(self.decide())
        self.assertEqual(len(calls), 4)

    def test_total_deadline_stays_bounded(self):
        def slow(*_args):
            time.sleep(0.2)
            return json.dumps(ANSWER)
        with mock.patch.object(chat, "TOTAL_SECONDS", 0.05), mock.patch.object(chat, "MIN_CALL_SECONDS", 0.001), \
                mock.patch.object(chat, "_MODEL_FN", slow):
            start = time.monotonic()
            self.assertIsNone(self.decide())
            self.assertLess(time.monotonic() - start, 0.18)
            time.sleep(0.2)  # let this test's worker exit before restoring patches


if __name__ == "__main__":
    unittest.main()
