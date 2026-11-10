"""TASK-OPENAISOL-r1: synthetic HTTP only; shared text/photo budget and privacy."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
import base64
import io
import json
import logging
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock
import urllib.error
import uuid

from PIL import Image

import ai_chat as chat
import photo_estimate as photo
import line_webhook as webhook  # bind only to the runner's synthetic repo, before per-test envs


GPT = "gpt-6.1-sol"
CLAUDE = "claude-sonnet-5-5"
GEMINI = "gemini-3.5-flash"
DAY = "2026-11-11"
ANSWER = {"kind": "answer", "reply": "可以先拍洗標給店裡看看。"}
ITEM = {"name": "棉T", "label": "白色棉T", "quantity": 1, "view": "whole",
        "certainty": "clear", "reason": "短袖套頭", "brand": "", "model": "",
        "material": "棉", "color": "白", "stain": "", "craft": "一般水洗", "question": ""}


class Response:
    def __init__(self, payload):
        self.raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, limit):
        return self.raw[:limit]


def openai_response(value=ANSWER, *, status="completed", input_tokens=1000, output_tokens=100,
                    output=None, service_tier=None):
    payload = {"status": status, "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens,
                     "output_tokens_details": {"reasoning_tokens": 50}},
                     "output": output if output is not None else [{"type": "message", "content": [
                         {"type": "output_text", "text": json.dumps(value)}]}]}
    if service_tier is not None:
        payload["service_tier"] = service_tier
    return Response(payload)


def claude_response():
    return Response({"stop_reason": "end_turn", "usage": {"input_tokens": 1000, "output_tokens": 100},
                     "content": [{"type": "text", "text": json.dumps(ANSWER)}]})


def gemini_response(value=ANSWER):
    return Response({"candidates": [{"finishReason": "STOP", "content": {
        "parts": [{"text": json.dumps(value)}]}}]})


class OpenAISolTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.key, self.prompt, self.private_reply = (uuid.uuid4().hex for _ in range(3))
        env = {"OPENAI_API_KEY": self.key, "CLAUDE_API_CREDIT_KEY": uuid.uuid4().hex,
               "GEMINI_API_KEY": uuid.uuid4().hex, "LAUNDRY_AI_CHAT": "on",
               "LAUNDRY_PHOTO_ESTIMATE": "1", "LAUNDRY_REPO_ROOT": str(self.root),
               "LAUNDRY_CHAT_USAGE_DIR": str(self.root / "chat"),
               "LAUNDRY_VISION_USAGE_DIR": str(self.root / "vision"),
               "LAUNDRY_VISION_KNOWLEDGE_DIR": str(self.root / "no-knowledge")}
        patchers = [mock.patch.dict(os.environ, env, clear=True),
                    mock.patch.object(chat, "_MODEL_FN", None),
                    mock.patch.object(chat, "build_prompt", return_value=self.prompt),
                    mock.patch.object(photo, "usage_day", return_value=DAY),
                    mock.patch.object(photo.time, "sleep"),
                    mock.patch.object(chat.urllib.request, "urlopen",
                                      side_effect=AssertionError("HTTP fake required"))]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.image = self.root / "synthetic.png"
        Image.new("RGBA", (32, 24), (120, 130, 140, 255)).save(self.image)
        self.output = io.StringIO()
        for manager in (redirect_stdout(self.output), redirect_stderr(self.output)):
            manager.__enter__()
            self.addCleanup(manager.__exit__, None, None, None)
        handler = logging.StreamHandler(self.output)
        logging.getLogger().addHandler(handler)
        self.addCleanup(logging.getLogger().removeHandler, handler)

    def tearDown(self):
        private = (self.key, self.prompt, self.private_reply)
        artifacts = self.output.getvalue().encode() + b"".join(
            p.read_bytes() for p in self.root.rglob("*") if p.is_file() and p.suffix != ".png")
        self.assertTrue(all(value.encode() not in artifacts for value in private),
                        "private marker leaked to output or accounting")

    def ledger_path(self):
        return self.root / "chat" / f"openai-{DAY}.json"

    def ledger(self):
        return json.loads(self.ledger_path().read_text(encoding="utf-8"))

    def set_spend(self, dollars):
        path = self.ledger_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"calls": 1, "input_tokens": 1000, "output_tokens": 100,
                                    "estimated_usd": dollars}), encoding="utf-8")

    def decide(self):
        return chat._decide(SimpleNamespace(REPO=self.root), "測試問題", "")

    def inventory(self):
        return photo.inventory([self.image], ["棉T"])

    def test_text_request_headers_model_format_tokens_and_default_effort(self):
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response()) as call:
            self.assertEqual(chat._openai_call(GPT, self.prompt, 2.5), json.dumps(ANSWER))
        req = call.call_args.args[0]
        self.assertEqual(req.full_url, "https://api.openai.com/v1/responses")
        self.assertEqual(req.get_method(), "POST")
        self.assertTrue(req.get_header("Authorization") == "Bearer " + self.key, "key routing mismatch")
        self.assertEqual(req.get_header("Content-type"), "application/json")
        body = json.loads(req.data)
        self.assertTrue(body.pop("input") == [{"role": "user", "content": [
            {"type": "input_text", "text": self.prompt}]}], "prompt routing mismatch")
        self.assertEqual(body, {"model": GPT, "reasoning": {"effort": "low"}, "max_output_tokens": 2048,
                                "text": {"format": {"type": "json_object"}}, "service_tier": "fast"})
        self.assertGreater(call.call_args.kwargs["timeout"], 0)
        self.assertLessEqual(call.call_args.kwargs["timeout"], 2.5)

    def test_text_service_tier_allowlist_and_default(self):
        for value, expected in ((None, "fast"), ("fast", "fast"), (" FAST ", "fast"),
                                ("default", None), (" DEFAULT ", None),
                                ("", "fast"), ("invalid", "fast"), ("auto", "fast"), ("priority", "fast")):
            tier_env = {} if value is None else {"LAUNDRY_OPENAI_SERVICE_TIER": value}
            with self.subTest(value=value), mock.patch.dict(os.environ, tier_env), \
                    mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response()) as http:
                chat._openai_call(GPT, self.prompt, 1)
                body = json.loads(http.call_args.args[0].data)
                if expected is None:
                    self.assertNotIn("service_tier", body)
                else:
                    self.assertEqual(body.get("service_tier"), expected)

    def test_photo_service_tier_allowlist_and_default(self):
        for value, expected in ((None, "fast"), ("fast", "fast"), ("default", None), ("invalid", "fast")):
            tier_env = {} if value is None else {"LAUNDRY_OPENAI_SERVICE_TIER": value}
            with self.subTest(value=value), mock.patch.dict(os.environ, tier_env), \
                    mock.patch.object(photo.urllib.request, "urlopen",
                                      return_value=openai_response({"items": [ITEM]})) as http:
                self.assertTrue(self.inventory()["ok"])
                body = json.loads(http.call_args.args[0].data)
                if expected is None:
                    self.assertNotIn("service_tier", body)
                else:
                    self.assertEqual(body.get("service_tier"), expected)

    def test_actual_response_tier_controls_text_and_photo_costs(self):
        expected = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "estimated_usd": 0.0}
        for route in ("text", "photo"):
            for requested in ("fast", "default"):
                for actual, cost in (("fast", 0.006), ("default", 0.003), (None, 0.003)):
                    value = ANSWER if route == "text" else {"items": [ITEM]}
                    with self.subTest(route=route, requested=requested, actual=actual), \
                            mock.patch.dict(os.environ, {"LAUNDRY_OPENAI_SERVICE_TIER": requested}), \
                            mock.patch.object(chat.urllib.request, "urlopen",
                                              return_value=openai_response(value, service_tier=actual)):
                        if route == "text":
                            chat._openai_call(GPT, self.prompt, 1)
                        else:
                            self.assertTrue(self.inventory()["ok"])
                        expected["calls"] += 1
                        expected["input_tokens"] += 1000
                        expected["output_tokens"] += 100
                        expected["estimated_usd"] = round(expected["estimated_usd"] + cost, 10)
                        self.assertEqual(self.ledger(), expected)

    def test_fast_cost_reaches_shared_daily_cap_at_two_standard_dollars(self):
        os.environ["LAUNDRY_OPENAI_DAILY_USD"] = "4.0"
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=[
                openai_response(input_tokens=250000, output_tokens=50000, service_tier="fast"),
                openai_response({"items": [ITEM]}, input_tokens=250000, output_tokens=50000,
                                service_tier="fast")]) as http:
            chat._openai_call(GPT, self.prompt, 1)
            self.assertEqual(self.ledger()["estimated_usd"], 2.0)
            self.assertTrue(chat._openai_allowed())
            self.assertTrue(self.inventory()["ok"])
        self.assertEqual(http.call_count, 2)
        self.assertEqual(self.ledger(), {"calls": 2, "input_tokens": 500000, "output_tokens": 100000,
                                        "estimated_usd": 4.0})
        self.assertFalse(chat._openai_allowed())
        self.assertNotIn(GPT, chat._chain())
        self.assertNotIn(GPT, photo.model_chain())
        with mock.patch.object(chat.urllib.request, "urlopen") as http:
            with self.assertRaises(chat.ModelError):
                chat._openai_call(GPT, self.prompt, 1)
            http.assert_not_called()

    def test_incomplete_fast_response_is_charged_before_rejection(self):
        with mock.patch.object(chat.urllib.request, "urlopen",
                               return_value=openai_response(status="incomplete", service_tier="fast")):
            with self.assertRaises(chat.ModelError) as caught:
                chat._openai_call(GPT, self.prompt, 1)
        self.assertEqual(caught.exception.kind, "unusable")
        self.assertEqual(self.ledger(), {"calls": 1, "input_tokens": 1000, "output_tokens": 100,
                                        "estimated_usd": 0.006})

    def test_effort_allowlist_and_invalid_fallback(self):
        for value, expected in (("low", "low"), ("medium", "medium"), (" HIGH ", "high"),
                                ("none", "low"), ("minimal", "low"), ("xhigh", "low"), ("", "low")):
            with self.subTest(value=value), mock.patch.dict(os.environ, {"LAUNDRY_OPENAI_EFFORT": value}), \
                    mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response()) as call:
                chat._openai_call(GPT, self.prompt, 1)
                self.assertEqual(json.loads(call.call_args.args[0].data)["reasoning"], {"effort": expected})

    def test_only_message_output_text_is_joined_in_order(self):
        output = [{"type": "reasoning", "content": [{"type": "output_text", "text": "ignored"}]},
                  {"type": "message", "content": [{"type": "output_text", "text": "one"},
                    {"type": "refusal", "text": "ignored"}, {"type": "input_text", "text": "ignored"}]},
                  {"type": "function_call", "text": "ignored"},
                  {"type": "message", "content": [{"type": "output_text", "text": "two"}]}]
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response(output=output)):
            self.assertEqual(chat._openai_call(GPT, self.prompt, 1), "onetwo")

    def test_incomplete_is_unusable_and_all_output_tokens_are_charged(self):
        for status in ("incomplete", "failed", "in_progress", "cancelled", None):
            with self.subTest(status=status), mock.patch.object(
                    chat.urllib.request, "urlopen", return_value=openai_response(status=status)):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._openai_call(GPT, self.prompt, 1)
                self.assertEqual(caught.exception.kind, "unusable")
        self.assertEqual(self.ledger(), {"calls": 5, "input_tokens": 5000, "output_tokens": 500,
                                        "estimated_usd": 0.015})

    def test_http_error_kinds_close_response_and_do_not_leak(self):
        for code, kind in ((401, "http_other"), (429, "http_429"), (500, "http_5xx"), (400, "http_400")):
            error = urllib.error.HTTPError("synthetic", code, self.key, {}, io.BytesIO(self.prompt.encode()))
            with self.subTest(code=code), mock.patch.object(chat.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._openai_call(GPT, self.prompt, 1)
                self.assertEqual(caught.exception.kind, kind)
                self.assertEqual(str(caught.exception), kind)
            self.assertTrue(error.closed)
        self.assertFalse(self.ledger_path().exists())

    def test_network_errors_are_timeout(self):
        for error in (TimeoutError(self.key), urllib.error.URLError(self.key), OSError(self.key)):
            with self.subTest(kind=type(error).__name__), mock.patch.object(
                    chat.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._openai_call(GPT, self.prompt, 1)
                self.assertEqual(caught.exception.kind, "timeout")

    def test_waiting_for_another_openai_call_is_bounded_and_never_sends_http(self):
        with mock.patch.object(chat, "_OPENAI_CALL_LOCK") as lock, \
                mock.patch.object(chat.urllib.request, "urlopen") as http:
            lock.acquire.return_value = False
            with self.assertRaises(chat.ModelError) as caught:
                chat._openai_call(GPT, self.prompt, 1.5)
            self.assertEqual(caught.exception.kind, "timeout")
            lock.acquire.assert_called_once_with(timeout=1.5)
            lock.release.assert_not_called()
            http.assert_not_called()

    def test_empty_or_malformed_message_output_is_unusable_but_accounted(self):
        for output in ([], None, [{"type": "message", "content": []}],
                       [{"type": "message", "content": [{"type": "output_text", "text": 1}]}]):
            # Supply the raw envelope so output=None is not replaced by the response helper.
            payload = {"status": "completed", "usage": {"input_tokens": 1000, "output_tokens": 100},
                       "output": output}
            with self.subTest(kind=type(output).__name__), mock.patch.object(
                    chat.urllib.request, "urlopen", return_value=Response(payload)):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._openai_call(GPT, self.prompt, 1)
                self.assertEqual(caught.exception.kind, "unusable")
        self.assertEqual(self.ledger()["calls"], 4)

    def test_bad_json_and_response_shapes_are_unusable(self):
        for payload in (b"not-json", b"\xff", [], {}, {"status": "completed", "usage": None},
                        {"status": "completed", "usage": {"input_tokens": -1, "output_tokens": 1}}):
            with self.subTest(kind=type(payload).__name__), mock.patch.object(
                    chat.urllib.request, "urlopen", return_value=Response(payload)):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._openai_call(GPT, self.prompt, 1)
                self.assertEqual(caught.exception.kind, "unusable")
                # Invalid usage can disable subsequent calls; keep malformed cases independent.
                chat._OPENAI_USAGE_BLOCKED.clear()

    def test_missing_key_is_http_other_without_http(self):
        os.environ.pop("OPENAI_API_KEY")
        with mock.patch.object(chat.urllib.request, "urlopen") as call:
            with self.assertRaises(chat.ModelError) as caught:
                chat._openai_call(GPT, self.prompt, 1)
            self.assertEqual(caught.exception.kind, "http_other")
            call.assert_not_called()

    def test_dispatch_routes_gpt_claude_and_gemini(self):
        with mock.patch.object(chat, "_openai_call", return_value="o") as openai, \
                mock.patch.object(chat, "_claude_call", return_value="c") as claude, \
                mock.patch.object(chat, "_gemini_call", return_value="g") as gemini:
            self.assertEqual(chat._model_call(GPT, "synthetic", 2), "o")
            openai.assert_called_once_with(GPT, "synthetic", 2)
            claude.assert_not_called()
            gemini.assert_not_called()
            self.assertEqual(chat._model_call(CLAUDE, "synthetic", 3), "c")
            claude.assert_called_once_with(CLAUDE, "synthetic", 3)
            self.assertEqual(chat._model_call(GEMINI, "synthetic", 4), "g")
            gemini.assert_called_once_with(GEMINI, "synthetic", 4)

    def test_openai_default_chat_and_photo_chains(self):
        self.assertEqual(chat.OPENAI_CHAT_CHAIN, (GPT, CLAUDE, GEMINI))
        self.assertEqual(chat._chain(), [GPT, CLAUDE, GEMINI])
        self.assertEqual(photo.model_chain(), [GPT, *photo.DEFAULT_MODEL_CHAIN])
        self.assertEqual(chat.TOTAL_SECONDS, 10.0)

    def test_no_openai_key_preserves_claude_and_gemini_defaults(self):
        os.environ.pop("OPENAI_API_KEY")
        self.assertEqual(chat._chain(), [CLAUDE, "claude-haiku-5-5", GEMINI])
        self.assertEqual(photo.model_chain(), list(photo.DEFAULT_MODEL_CHAIN))
        os.environ.pop("CLAUDE_API_CREDIT_KEY")
        self.assertEqual(chat._chain(), ["gemini-3.8-flash", GEMINI])

    def test_unavailable_claude_is_skipped_in_openai_chain(self):
        os.environ.pop("CLAUDE_API_CREDIT_KEY")
        self.assertEqual(chat._chain(), [GPT, GEMINI])
        os.environ["CLAUDE_API_CREDIT_KEY"] = uuid.uuid4().hex
        os.environ["LAUNDRY_CLAUDE_DAILY_USD"] = "0"
        self.assertEqual(chat._chain(), [GPT, GEMINI])

    def test_chat_override_accepts_gpt_and_filters_lite_invalid_and_duplicates(self):
        os.environ["LAUNDRY_CHAT_MODELS"] = f"gpt-lite,gpt-LITE,gpt-6.1-sol/extra,{GPT},{GPT},{GEMINI},{CLAUDE}"
        self.assertEqual(chat._chain(), [GPT, GEMINI, CLAUDE])
        os.environ["LAUNDRY_CHAT_MODELS"] = f"gpt-next-6.1,{GEMINI}"
        self.assertEqual(chat._chain(), ["gpt-next-6.1", GEMINI])
        os.environ.pop("OPENAI_API_KEY")
        self.assertEqual(chat._chain(), [GEMINI])

    def test_pinned_vision_preserves_order_and_accepts_gpt(self):
        os.environ["LAUNDRY_VISION_MODEL"] = "gemini-flash-latest"
        self.assertEqual(photo.model_chain(), ["gemini-flash-latest", GEMINI])
        os.environ["LAUNDRY_VISION_MODEL"] = GPT
        self.assertEqual(photo.model_chain(), [GPT, GEMINI])
        os.environ["LAUNDRY_VISION_MODEL"] = "gpt-lite"
        self.assertEqual(photo.model_chain(), [])

    def test_cap_boundary_changes_both_default_chains(self):
        for spend, eligible in ((3.9999999, True), (4.0, False), (4.1, False)):
            with self.subTest(spend=spend):
                self.set_spend(spend)
                self.assertEqual(chat._openai_allowed(), eligible)
                self.assertEqual(chat._chain()[0] == GPT, eligible)
                self.assertEqual(photo.model_chain()[0] == GPT, eligible)

    def test_daily_cap_filters_override_and_blocks_direct_text_http(self):
        self.set_spend(4.0)
        os.environ["LAUNDRY_CHAT_MODELS"] = f"{GPT},{GEMINI}"
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=gemini_response()) as call:
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(call.call_count, 1)
        self.assertIn("generativelanguage.googleapis.com", call.call_args.args[0].full_url)
        with mock.patch.object(chat.urllib.request, "urlopen") as call:
            with self.assertRaises(chat.ModelError):
                chat._openai_call(GPT, self.prompt, 1)
            call.assert_not_called()

    def test_daily_cap_never_sends_gpt_photo_even_if_pinned(self):
        self.set_spend(4.0)
        for pinned in (None, GPT):
            with self.subTest(pinned=pinned):
                if pinned:
                    os.environ["LAUNDRY_VISION_MODEL"] = pinned
                with mock.patch.object(photo.urllib.request, "urlopen", return_value=gemini_response({"items": [ITEM]})) as call:
                    result = self.inventory()
                self.assertTrue(result["ok"])
                self.assertEqual(call.call_count, 1)
                self.assertIn("generativelanguage.googleapis.com", call.call_args.args[0].full_url)
                self.assertNotIn("gpt-", call.call_args.args[0].full_url)

    def test_budget_is_rechecked_after_chain_selection_for_both_paths(self):
        chain = chat._chain()
        vision_chain = photo.model_chain()
        self.set_spend(4.0)
        with mock.patch.object(chat, "_chain", return_value=chain), \
                mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response()) as call:
            self.assertEqual(self.decide(), ANSWER)
        self.assertTrue(all("openai.com" not in c.args[0].full_url for c in call.call_args_list))
        with mock.patch.object(photo, "model_chain", return_value=vision_chain), \
                mock.patch.object(photo.urllib.request, "urlopen", return_value=gemini_response({"items": [ITEM]})) as call:
            self.assertTrue(self.inventory()["ok"])
        self.assertTrue(all("openai.com" not in c.args[0].full_url for c in call.call_args_list))

    def test_gpt_429_then_claude_answers(self):
        def call(req, **_kwargs):
            if "openai.com" in req.full_url:
                raise urllib.error.HTTPError("synthetic", 429, self.key, {}, io.BytesIO(b""))
            return claude_response()
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call) as http:
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual([json.loads(c.args[0].data)["model"] for c in http.call_args_list], [GPT, CLAUDE])

    def test_gpt_and_claude_fail_then_gemini_answers(self):
        def call(req, **_kwargs):
            if "generativelanguage.googleapis.com" in req.full_url:
                return gemini_response()
            raise urllib.error.HTTPError("synthetic", 500, self.key, {}, io.BytesIO(b""))
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call) as http:
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(len(http.call_args_list), 3)
        counts = json.loads((self.root / "chat" / f"{DAY}.json").read_text(encoding="utf-8"))
        self.assertEqual(counts["models"], {GPT: {"http_5xx": 1}, CLAUDE: {"http_5xx": 1}, GEMINI: {"ok": 1}})

    def test_photo_sends_converted_jpeg_schema_and_uses_existing_validation(self):
        with mock.patch.object(photo.urllib.request, "urlopen", return_value=openai_response({"items": [ITEM]})) as http, \
                mock.patch.object(photo, "validate_result", wraps=photo.validate_result) as validate:
            result = self.inventory()
        self.assertTrue(result["ok"])
        self.assertEqual(result["model"], GPT)
        validate.assert_called_once_with({"items": [ITEM]}, {"棉T"})
        req = http.call_args.args[0]
        body = json.loads(req.data)
        self.assertEqual(req.full_url, "https://api.openai.com/v1/responses")
        self.assertEqual(body["model"], GPT)
        self.assertEqual(body["service_tier"], "fast")
        self.assertEqual(body["max_output_tokens"], 4096)
        self.assertEqual(body["reasoning"], {"effort": "low"})
        self.assertEqual(body["text"]["format"], {"type": "json_schema", "name": "photo_inventory",
                                                     "schema": photo.SCHEMA, "strict": False})
        parts = body["input"][0]["content"]
        self.assertEqual(parts[0]["type"], "input_text")
        self.assertIn("JSON", parts[0]["text"])
        self.assertEqual(parts[1]["type"], "input_image")
        self.assertTrue(parts[1]["image_url"].startswith("data:image/jpeg;base64,"))
        jpeg = base64.b64decode(parts[1]["image_url"].split(",", 1)[1], validate=True)
        with Image.open(io.BytesIO(jpeg)) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.mode, "RGB")
            self.assertEqual(image.size, (32, 24))

    def test_openai_only_is_available_and_configured_but_vision_switch_still_applies(self):
        for name in ("GEMINI_API_KEY", "CLAUDE_API_CREDIT_KEY"):
            os.environ.pop(name)
        self.assertTrue(chat.available())
        self.assertTrue(photo.configured())
        with mock.patch.object(photo.urllib.request, "urlopen", return_value=openai_response({"items": [ITEM]})):
            self.assertTrue(self.inventory()["ok"])
        os.environ["LAUNDRY_PHOTO_ESTIMATE"] = "0"
        self.assertFalse(photo.configured())
        os.environ.pop("OPENAI_API_KEY")
        self.assertFalse(chat.available())

    def test_openai_photo_failures_fall_through_to_gemini(self):
        for code in (401, 429, 500, 400):
            with self.subTest(code=code):
                error = urllib.error.HTTPError("synthetic", code, self.key, {}, io.BytesIO(b""))
                with mock.patch.object(photo.urllib.request, "urlopen", side_effect=[
                        error, gemini_response({"items": [ITEM]})]) as http:
                    result = self.inventory()
                self.assertTrue(result["ok"])
                self.assertEqual(result["model"], photo.DEFAULT_MODEL_CHAIN[0])
                self.assertEqual(http.call_count, 2)
                self.assertIn("generativelanguage.googleapis.com", http.call_args_list[1].args[0].full_url)

    def test_unusable_openai_photo_falls_back_without_bypassing_validation(self):
        with mock.patch.object(photo.urllib.request, "urlopen", side_effect=[
                openai_response({"items": "invalid"}), gemini_response({"items": [ITEM]})]) as http:
            result = self.inventory()
        self.assertTrue(result["ok"])
        self.assertEqual(http.call_count, 2)
        counters = json.loads((self.root / "vision" / f"{DAY}.json").read_text(encoding="utf-8"))
        self.assertEqual(counters["models"][GPT], {"unusable": 1})

    def test_all_three_gemini_photo_fallbacks_remain_reachable(self):
        errors = [urllib.error.HTTPError("synthetic", 429, self.key, {}, io.BytesIO(b"")) for _ in range(3)]
        with mock.patch.object(photo.urllib.request, "urlopen", side_effect=[
                *errors, gemini_response({"items": [ITEM]})]) as http:
            result = self.inventory()
        self.assertTrue(result["ok"])
        self.assertEqual(result["model"], photo.DEFAULT_MODEL_CHAIN[2])
        self.assertEqual(http.call_count, 4)
        self.assertEqual([c.args[0].full_url.rsplit("/", 1)[-1].split(":")[0] for c in http.call_args_list[1:]],
                         list(photo.DEFAULT_MODEL_CHAIN))

    def test_text_plus_photo_accumulates_in_one_ledger_without_content(self):
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=[
                openai_response(self.private_reply, input_tokens=2000, output_tokens=300),
                openai_response({"items": [ITEM]}, input_tokens=4000, output_tokens=500)]):
            chat._openai_call(GPT, self.prompt, 1)
            self.assertTrue(self.inventory()["ok"])
        self.assertEqual(self.ledger(), {"calls": 2, "input_tokens": 6000, "output_tokens": 800,
                                        "estimated_usd": 0.02})
        self.assertEqual(list(self.ledger_path().parent.iterdir()), [self.ledger_path()])
        vision = json.loads((self.root / "vision" / f"{DAY}.json").read_text(encoding="utf-8"))
        self.assertEqual(vision["models"], {GPT: {"ok": 1}})
        self.assertTrue(photo._valid_day(vision, DAY))

    def test_text_spend_stops_photo_and_photo_spend_stops_text(self):
        for first in ("text", "photo"):
            with self.subTest(first=first):
                self.set_spend(3.999)
                value = ANSWER if first == "text" else {"items": [ITEM]}
                with mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response(value)):
                    if first == "text":
                        chat._openai_call(GPT, self.prompt, 1)
                    else:
                        self.assertTrue(self.inventory()["ok"])
                self.assertFalse(chat._openai_allowed())
                self.assertNotIn(GPT, chat._chain())
                self.assertNotIn(GPT, photo.model_chain())

    def test_atomic_replacement_keeps_original_until_replace(self):
        self.set_spend(0.01)
        original = self.ledger_path().read_bytes()
        real_replace, observed = os.replace, []
        def replace(source, target):
            self.assertEqual(Path(target), self.ledger_path())
            self.assertEqual(Path(source).parent, Path(target).parent)
            self.assertEqual(Path(target).read_bytes(), original)
            self.assertEqual(json.loads(Path(source).read_text(encoding="utf-8"))["calls"], 2)
            observed.append(True)
            return real_replace(source, target)
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response()), \
                mock.patch.object(os, "replace", side_effect=replace):
            chat._openai_call(GPT, self.prompt, 1)
        self.assertEqual(observed, [True])

    def test_concurrent_text_and_photo_accounting_loses_no_updates(self):
        def call(req, **_kwargs):
            parts = json.loads(req.data)["input"][0]["content"]
            return openai_response({"items": [ITEM]} if len(parts) > 1 else ANSWER)
        def request(index):
            return self.inventory()["ok"] if index % 2 else bool(chat._openai_call(GPT, self.prompt, 3))
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(request, range(12)))
        self.assertTrue(all(results))
        self.assertEqual(self.ledger(), {"calls": 12, "input_tokens": 12000, "output_tokens": 1200,
                                        "estimated_usd": 0.036})

    def test_concurrent_admissions_recheck_daily_cap_before_http(self):
        self.set_spend(3.999)
        barrier = threading.Barrier(4)
        def request(_index):
            barrier.wait(timeout=3)
            try:
                chat._openai_call(GPT, self.prompt, 3)
                return True
            except chat.ModelError:
                return False
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=lambda *_a, **_k: openai_response()) as http:
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(request, range(4)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(http.call_count, 1)
        self.assertAlmostEqual(self.ledger()["estimated_usd"], 4.002)

    def test_corrupt_or_unreadable_accounting_never_resets_budget(self):
        self.set_spend(0)
        for raw in ("bad", "{}", '{"calls":false,"input_tokens":0,"output_tokens":0,"estimated_usd":0}',
                    '{"calls":0,"input_tokens":0,"output_tokens":0,"estimated_usd":NaN}'):
            self.ledger_path().write_text(raw, encoding="utf-8")
            self.assertFalse(chat._openai_allowed())
            self.assertNotIn(GPT, chat._chain())
            self.assertNotIn(GPT, photo.model_chain())
            self.assertEqual(self.ledger_path().read_text(encoding="utf-8"), raw)
        with mock.patch.object(Path, "read_text", side_effect=OSError(self.key)):
            self.assertFalse(chat._openai_allowed())

    def test_failed_accounting_write_blocks_both_paths_for_the_day(self):
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response()), \
                mock.patch.object(photo, "_atomic_write", side_effect=OSError(self.key)):
            with self.assertRaises(chat.ModelError) as caught:
                chat._openai_call(GPT, self.prompt, 1)
        self.assertEqual(caught.exception.kind, "http_other")
        self.assertFalse(chat._openai_allowed())
        self.assertNotIn(GPT, chat._chain())
        self.assertNotIn(GPT, photo.model_chain())

    def test_new_taipei_day_has_a_separate_budget(self):
        self.set_spend(4.0)
        with mock.patch.object(photo, "usage_day", return_value="2026-11-12"), \
                mock.patch.object(chat.urllib.request, "urlopen", return_value=openai_response()):
            self.assertTrue(chat._openai_allowed())
            chat._openai_call(GPT, self.prompt, 1)
        self.assertEqual(self.ledger()["estimated_usd"], 4.0)
        new = json.loads((self.root / "chat" / "openai-2026-11-12.json").read_text(encoding="utf-8"))
        self.assertEqual(new["calls"], 1)

    def test_response_crossing_midnight_is_charged_to_its_admitted_day(self):
        day = [DAY]
        def call(*_args, **_kwargs):
            day[0] = "2026-11-12"
            return openai_response()
        with mock.patch.object(photo, "usage_day", side_effect=lambda: day[0]), \
                mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            chat._openai_call(GPT, self.prompt, 1)
        self.assertEqual(self.ledger()["calls"], 1)
        self.assertFalse((self.root / "chat" / "openai-2026-11-12.json").exists())

    def test_daily_limit_zero_boundary_and_invalid_values(self):
        self.set_spend(0.5)
        for value in ("0", "0.5"):
            os.environ["LAUNDRY_OPENAI_DAILY_USD"] = value
            self.assertFalse(chat._openai_allowed())
        for value in ("", "bad", "-1", "nan", "inf"):
            os.environ["LAUNDRY_OPENAI_DAILY_USD"] = value
            self.assertTrue(chat._openai_allowed())
            self.set_spend(4.0)
            self.assertFalse(chat._openai_allowed())
            self.set_spend(0.5)

    def test_chat_per_call_seconds_is_bounded_and_last_uses_remaining(self):
        for value, expected in ((None, 4.5), ("2.75", 2.75), ("1.5", 1.5), ("9", 9.0),
                                ("1.49", 4.5), ("9.01", 4.5), ("bad", 4.5), ("nan", 4.5), ("inf", 4.5)):
            with self.subTest(value=value):
                if value is None:
                    os.environ.pop("LAUNDRY_CHAT_PER_CALL_SECONDS", None)
                else:
                    os.environ["LAUNDRY_CHAT_PER_CALL_SECONDS"] = value
                models, caps, now = [], [], [90.0]
                def fake(model, _prompt, timeout):
                    models.append(model)
                    caps.append(timeout)
                    now[0] += 1
                    if model != GEMINI:
                        raise chat.ModelError("http_429")
                    return json.dumps(ANSWER)
                box = {}
                with mock.patch.object(chat, "_MODEL_FN", fake), \
                        mock.patch.object(chat.time, "monotonic", side_effect=lambda: now[0]):
                    chat._worker(self.prompt, 100.0, photo._UsageTrace(), box)
                self.assertEqual(box["decision"], ANSWER)
                self.assertEqual(models, [GPT, CLAUDE, GEMINI])
                self.assertEqual(caps, [expected, expected, 8.0])

    def test_gpt_usage_names_are_readable_in_both_reports(self):
        chat.record(None, {"routed": 1}, {GPT: {"ok": 1}})
        photo._store_usage({GPT: {"ok": 1}}, True)
        with mock.patch.object(photo, "_taipei_date", return_value=date(2026, 11, 11)):
            self.assertIn(GPT, chat.usage_report(1)[0])
            self.assertIn(GPT, photo.usage_report(1)[0])

    def test_readyz_reports_openai_boolean_without_keys_or_other_schema_changes(self):
        request = SimpleNamespace(remote_addr="127.0.0.1", host="127.0.0.1:8791", headers={})
        with mock.patch.object(webhook, "request", request), \
                mock.patch.object(webhook, "jsonify", side_effect=lambda **kwargs: kwargs):
            present = webhook.readyz()
            os.environ.pop("OPENAI_API_KEY")
            absent = webhook.readyz()
        self.assertIs(present.pop("chat_openai"), True)
        self.assertIs(absent.pop("chat_openai"), False)
        self.assertEqual(present, absent)
        self.assertEqual(set(present), {"pid", "vision_configured", "ai_chat", "missing", "chat_claude"})
        self.assertTrue(self.key not in str(present))

    def test_launcher_allows_all_openai_settings(self):
        launcher = (Path(__file__).parent / "run_line_bot.ps1").read_text(encoding="ascii")
        allowlist = launcher.split("function Get-BotConfigNames {", 1)[1].split("\n}", 1)[0]
        for name in ("OPENAI_API_KEY", "LAUNDRY_OPENAI_EFFORT", "LAUNDRY_OPENAI_DAILY_USD",
                     "LAUNDRY_CHAT_PER_CALL_SECONDS", "LAUNDRY_OPENAI_SERVICE_TIER"):
            self.assertIn("'" + name + "'", allowlist)


if __name__ == "__main__":
    unittest.main()
