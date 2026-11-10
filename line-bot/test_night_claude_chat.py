"""TASK-CLAUDECHAT-r1: offline HTTP fakes, isolated counters, no real credentials."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
import io
import json
import logging
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import urllib.error
import uuid

import ai_chat as chat
import photo_estimate as photo


ANSWER = {"kind": "answer", "reply": "可以先拍洗標給店裡看看。"}
SONNET = "claude-sonnet-5-5"
HAIKU = "claude-haiku-5-5"
GEMINI = "gemini-3.5-flash"


class Response:
    def __init__(self, payload):
        self.raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, limit):
        return self.raw[:limit]


def claude_response(*, input_tokens=1000, output_tokens=100, stop="end_turn", content=None):
    return Response({"stop_reason": stop,
                     "content": content if content is not None else [{"type": "text", "text": json.dumps(ANSWER)}],
                     "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}})


def gemini_response():
    return Response({"candidates": [{"finishReason": "STOP", "content": {
        "parts": [{"text": json.dumps(ANSWER)}]}}]})


class ClaudeChatTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.key = uuid.uuid4().hex
        self.prompt = "private-prompt-" + uuid.uuid4().hex
        self.private_reply = "private-answer-" + uuid.uuid4().hex
        patcher = mock.patch.dict(os.environ, {
            "CLAUDE_API_CREDIT_KEY": self.key, "LAUNDRY_CHAT_GEMINI_KEY": uuid.uuid4().hex,
            "LAUNDRY_CHAT_USAGE_DIR": str(self.root / "chat"), "LAUNDRY_AI_CHAT": "on",
            "LAUNDRY_CHAT_MODELS": "", "LAUNDRY_CLAUDE_EFFORT": "", "LAUNDRY_CLAUDE_DAILY_USD": "3.0",
        })
        patcher.start()
        self.addCleanup(patcher.stop)
        for patcher in (mock.patch.object(chat, "_MODEL_FN", None),
                        mock.patch.object(chat, "build_prompt", return_value=self.prompt),
                        mock.patch.object(photo, "usage_day", return_value="2026-11-10")):
            patcher.start()
            self.addCleanup(patcher.stop)
        # Fail immediately if any test forgets to install its own fake urlopen.
        patcher = mock.patch.object(chat.urllib.request, "urlopen", side_effect=AssertionError("HTTP fake required"))
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
        contents = self.output.getvalue().encode() + b"".join(
            p.read_bytes() for p in self.root.rglob("*") if p.is_file())
        self.assertTrue(all(s.encode() not in contents for s in (self.key, self.prompt, self.private_reply)),
                        "private value leaked to logs or usage files")

    def ledger_path(self):
        return self.root / "chat" / "claude-2026-11-10.json"

    def ledger(self):
        return json.loads(self.ledger_path().read_text(encoding="utf-8"))

    def set_spend(self, dollars):
        path = self.ledger_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"calls": 1, "input_tokens": 1000, "output_tokens": 100,
                                    "estimated_usd": dollars}), encoding="utf-8")

    def decide(self):
        return chat._decide(SimpleNamespace(REPO=self.root), "測試問題", "")

    def test_request_headers_body_and_default_effort(self):
        os.environ.pop("LAUNDRY_CLAUDE_EFFORT")
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response()) as call:
            self.assertEqual(chat._claude_call(SONNET, self.prompt, 2.5), json.dumps(ANSWER))
        req = call.call_args.args[0]
        self.assertEqual(req.full_url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(req.get_method(), "POST")
        self.assertTrue(req.get_header("X-api-key") == self.key, "key routing mismatch")
        self.assertEqual(req.get_header("Anthropic-version"), "2023-06-01")
        self.assertEqual(req.get_header("Content-type"), "application/json")
        body = json.loads(req.data)
        self.assertTrue(body["messages"] == [{"role": "user", "content": self.prompt}])
        self.assertEqual({k: v for k, v in body.items() if k != "messages"}, {
            "model": SONNET, "max_tokens": 2048, "output_config": {"effort": "low"}})
        self.assertEqual(call.call_args.kwargs["timeout"], 2.5)

    def test_effort_allowlist_and_invalid_values(self):
        for value, expected in (("low", "low"), ("medium", "medium"), ("high", "high"),
                                (" HIGH ", "high"), ("max", "low"), ("", "low"), ("0", "low")):
            with self.subTest(value=value):
                os.environ["LAUNDRY_CLAUDE_EFFORT"] = value
                with mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response()) as call:
                    chat._claude_call(HAIKU, self.prompt, 1)
                self.assertEqual(json.loads(call.call_args.args[0].data)["output_config"], {"effort": expected})

    def test_only_text_blocks_are_concatenated(self):
        blocks = [{"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": "one"},
                  {"type": "tool_use", "text": "ignored"}, {"type": "text", "text": "two"}]
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response(content=blocks)):
            self.assertEqual(chat._claude_call(SONNET, self.prompt, 1), "onetwo")

    def test_non_end_turn_is_unusable_but_tokens_are_charged(self):
        for reason in ("max_tokens", "tool_use", "stop_sequence", "refusal", None):
            with self.subTest(reason=reason), mock.patch.object(
                    chat.urllib.request, "urlopen", return_value=claude_response(stop=reason)):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._claude_call(SONNET, self.prompt, 1)
                self.assertEqual(caught.exception.kind, "unusable")
        self.assertEqual(self.ledger()["calls"], 5)
        self.assertAlmostEqual(self.ledger()["estimated_usd"], 0.015)

    def test_http_error_mapping_and_no_private_error_logging(self):
        for code, kind in ((401, "http_other"), (429, "http_429"), (529, "http_5xx"), (400, "http_400")):
            error = urllib.error.HTTPError("synthetic", code, self.key, {}, io.BytesIO(self.prompt.encode()))
            with self.subTest(code=code), mock.patch.object(chat.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._claude_call(SONNET, self.prompt, 1)
                self.assertEqual(caught.exception.kind, kind)
                self.assertEqual(str(caught.exception), kind)
            self.assertTrue(error.closed)
        self.assertFalse(self.ledger_path().exists())

    def test_network_errors_are_timeout(self):
        for error in (TimeoutError(self.key), urllib.error.URLError(self.key), OSError(self.key)):
            with self.subTest(kind=type(error).__name__), mock.patch.object(
                    chat.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._claude_call(SONNET, self.prompt, 1)
                self.assertEqual(caught.exception.kind, "timeout")

    def test_bad_json_and_invalid_shapes_are_unusable(self):
        for payload in (b"not-json", b"\xff", [], {}, {"usage": None},
                        {"usage": {"input_tokens": -1, "output_tokens": 1}}):
            with self.subTest(kind=type(payload).__name__), mock.patch.object(
                    chat.urllib.request, "urlopen", return_value=Response(payload)):
                with self.assertRaises(chat.ModelError) as caught:
                    chat._claude_call(SONNET, self.prompt, 1)
                self.assertEqual(caught.exception.kind, "unusable")

    def test_missing_key_does_not_call_http(self):
        os.environ.pop("CLAUDE_API_CREDIT_KEY")
        with mock.patch.object(chat.urllib.request, "urlopen") as call:
            with self.assertRaises(chat.ModelError) as caught:
                chat._claude_call(SONNET, self.prompt, 1)
            call.assert_not_called()
        self.assertEqual(caught.exception.kind, "http_other")

    def test_dispatch_calls_correct_provider(self):
        with mock.patch.object(chat, "_claude_call", return_value="c") as claude, \
                mock.patch.object(chat, "_gemini_call", return_value="g") as gemini:
            self.assertEqual(chat._model_call(SONNET, "synthetic", 2), "c")
            claude.assert_called_once_with(SONNET, "synthetic", 2)
            gemini.assert_not_called()
            self.assertEqual(chat._model_call(GEMINI, "synthetic", 3), "g")
            gemini.assert_called_once_with(GEMINI, "synthetic", 3)

    def test_claude_default_chain(self):
        self.assertEqual(chat._chain(), [SONNET, HAIKU, GEMINI])
        self.assertEqual(chat.CLAUDE_CHAT_CHAIN, (SONNET, HAIKU, GEMINI))
        self.assertEqual(chat.MAX_CALLS, 3)
        self.assertEqual(chat.TOTAL_SECONDS, 10.0)

    def test_no_claude_key_keeps_original_chain(self):
        os.environ.pop("CLAUDE_API_CREDIT_KEY")
        self.assertEqual(chat._chain(), ["gemini-3.8-flash", GEMINI])
        os.environ["LAUNDRY_CHAT_MODELS"] = f"{SONNET},{GEMINI}"
        self.assertEqual(chat._chain(), [GEMINI])

    def test_override_filters_lite_invalid_duplicates_before_limit(self):
        os.environ["LAUNDRY_CHAT_MODELS"] = (
            f"claude-haiku-lite,gemini-3.5-FLASH-LITE,bad/name,claude-UPPER,{HAIKU},{HAIKU},{GEMINI},{SONNET},gemini-2.5-flash")
        self.assertEqual(chat._chain(), [HAIKU, GEMINI, SONNET])
        os.environ["LAUNDRY_CHAT_MODELS"] = "claude-next-5.5,gemini-3.8-flash"
        self.assertEqual(chat._chain(), ["claude-next-5.5", "gemini-3.8-flash"])
        os.environ["LAUNDRY_CHAT_MODELS"] = "claude-lite,gemini-flash-lite-latest"
        self.assertEqual(chat._chain(), [SONNET, HAIKU, GEMINI])

    def test_cap_boundary_uses_gemini_defaults(self):
        self.set_spend(2.9999999)
        self.assertEqual(chat._chain(), [SONNET, HAIKU, GEMINI])
        for spend in (3.0, 3.1):
            self.set_spend(spend)
            self.assertEqual(chat._chain(), ["gemini-3.8-flash", GEMINI])

    def test_cap_filters_claude_overrides_and_never_sends_claude(self):
        self.set_spend(3.0)
        for override in (f"{SONNET},{HAIKU},{GEMINI}", f"{SONNET},{HAIKU}", ""):
            with self.subTest(override=override):
                os.environ["LAUNDRY_CHAT_MODELS"] = override
                with mock.patch.object(chat.urllib.request, "urlopen", return_value=gemini_response()) as call:
                    self.assertEqual(self.decide(), ANSWER)
                self.assertTrue(all("generativelanguage.googleapis.com" in c.args[0].full_url
                                    and "claude" not in c.args[0].full_url for c in call.call_args_list))
        self.assertEqual(self.ledger()["calls"], 1)

    def test_direct_claude_call_at_cap_does_not_send(self):
        self.set_spend(3.0)
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response()) as call:
            with self.assertRaises(chat.ModelError):
                chat._claude_call(SONNET, self.prompt, 1)
            call.assert_not_called()

    def test_cap_is_rechecked_between_fallback_models(self):
        self.set_spend(2.999)
        models = []

        def call(req, **_kwargs):
            if "anthropic.com" in req.full_url:
                models.append(json.loads(req.data)["model"])
                return claude_response(stop="max_tokens")  # costs .003, now over the cap
            models.append(GEMINI)
            return gemini_response()

        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(models, [SONNET, GEMINI])
        self.assertAlmostEqual(self.ledger()["estimated_usd"], 3.002)

    def test_daily_limit_override_zero_and_invalid_values(self):
        self.set_spend(0.5)
        for value in ("0", "0.5"):
            os.environ["LAUNDRY_CLAUDE_DAILY_USD"] = value
            self.assertFalse(chat._claude_allowed())
        for value in ("", "bad", "-1", "nan", "inf"):
            os.environ["LAUNDRY_CLAUDE_DAILY_USD"] = value
            self.assertTrue(chat._claude_allowed())
            self.set_spend(3.0)
            self.assertFalse(chat._claude_allowed())
            self.set_spend(0.5)

    def test_sonnet_429_then_haiku_answers_and_statuses_persist(self):
        models = []

        def call(req, **_kwargs):
            models.append(json.loads(req.data)["model"])
            if len(models) == 1:
                raise urllib.error.HTTPError("synthetic", 429, self.key, {}, io.BytesIO(b""))
            return claude_response()

        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call):
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(models, [SONNET, HAIKU])
        data = json.loads((self.root / "chat" / "2026-11-10.json").read_text(encoding="utf-8"))
        self.assertEqual(data["models"], {SONNET: {"http_429": 1}, HAIKU: {"ok": 1}})
        self.assertTrue(chat._valid(data, "2026-11-10"))
        self.assertAlmostEqual(self.ledger()["estimated_usd"], 0.00015)

    def test_both_claude_fail_then_gemini_answers_with_remaining_budget(self):
        models, timeouts, now = [], [], [90.0]

        def call(req, timeout):
            timeouts.append(timeout)
            if "anthropic.com" in req.full_url:
                models.append(json.loads(req.data)["model"])
                now[0] += 1.0
                raise urllib.error.HTTPError("synthetic", 529, "error", {}, io.BytesIO(b""))
            models.append(GEMINI)
            return gemini_response()

        box = {}
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=call), \
                mock.patch.object(chat.time, "monotonic", side_effect=lambda: now[0]):
            chat._worker(self.prompt, 100.0, photo._UsageTrace(), box)
        self.assertEqual(box["decision"], ANSWER)
        self.assertEqual(models, [SONNET, HAIKU, GEMINI])
        self.assertEqual(timeouts, [chat.PER_CALL_SECONDS, chat.PER_CALL_SECONDS, 8.0])

    def test_injected_model_still_overrides_dispatch(self):
        with mock.patch.object(chat, "_MODEL_FN", return_value=json.dumps(ANSWER)) as injected:
            self.assertEqual(self.decide(), ANSWER)
        self.assertEqual(injected.call_count, 1)
        self.assertEqual(injected.call_args.args[0], SONNET)

    def test_two_calls_accumulate_tokens_and_dollars_without_content(self):
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=[
                claude_response(input_tokens=2000, output_tokens=300,
                                content=[{"type": "text", "text": self.private_reply}]),
                claude_response(input_tokens=4000, output_tokens=500)]):
            chat._claude_call(SONNET, self.prompt, 1)
            chat._claude_call(HAIKU, self.prompt, 1)
        self.assertEqual(self.ledger(), {"calls": 2, "input_tokens": 6000,
                                        "output_tokens": 800, "estimated_usd": 0.00765})
        self.assertEqual(list(self.ledger_path().parent.iterdir()), [self.ledger_path()])

    def test_atomic_replacement_and_existing_file_is_kept_until_replace(self):
        self.set_spend(0.01)
        original = self.ledger_path().read_bytes()
        real_replace = os.replace
        observed = []

        def replace(source, target):
            self.assertEqual(Path(target), self.ledger_path())
            self.assertEqual(Path(source).parent, Path(target).parent)
            self.assertEqual(Path(target).read_bytes(), original)
            self.assertEqual(json.loads(Path(source).read_text(encoding="utf-8"))["calls"], 2)
            observed.append(True)
            return real_replace(source, target)

        with mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response()), \
                mock.patch.object(os, "replace", side_effect=replace):
            chat._claude_call(SONNET, self.prompt, 1)
        self.assertEqual(observed, [True])

    def test_concurrent_accounting_does_not_lose_updates(self):
        with mock.patch.object(chat.urllib.request, "urlopen", side_effect=lambda *_a, **_k: claude_response()):
            with ThreadPoolExecutor(max_workers=8) as pool:
                replies = list(pool.map(lambda _i: chat._claude_call(HAIKU, self.prompt, 1), range(24)))
        self.assertEqual(len(replies), 24)
        self.assertEqual(self.ledger(), {"calls": 24, "input_tokens": 24000,
                                        "output_tokens": 2400, "estimated_usd": 0.0036})

    def test_new_taipei_day_has_separate_budget(self):
        self.set_spend(3.0)
        with mock.patch.object(photo, "usage_day", return_value="2026-11-11"), \
                mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response()):
            self.assertTrue(chat._claude_allowed())
            chat._claude_call(SONNET, self.prompt, 1)
        self.assertEqual(self.ledger()["estimated_usd"], 3.0)
        new = json.loads((self.root / "chat" / "claude-2026-11-11.json").read_text(encoding="utf-8"))
        self.assertEqual(new["calls"], 1)

    def test_corrupt_or_unreadable_ledger_disables_claude_without_overwrite(self):
        self.set_spend(0)
        for raw in ("bad", "{}", '{"calls":false,"input_tokens":0,"output_tokens":0,"estimated_usd":0}'):
            self.ledger_path().write_text(raw, encoding="utf-8")
            self.assertFalse(chat._claude_allowed())
            self.assertEqual(self.ledger_path().read_text(encoding="utf-8"), raw)
        with mock.patch.object(Path, "read_text", side_effect=OSError("synthetic")):
            self.assertFalse(chat._claude_allowed())

    def test_failed_accounting_write_disables_claude_for_this_day(self):
        with mock.patch.object(chat.urllib.request, "urlopen", return_value=claude_response()), \
                mock.patch.object(photo, "_atomic_write", side_effect=OSError(self.key)):
            with self.assertRaises(chat.ModelError) as caught:
                chat._claude_call(SONNET, self.prompt, 1)
        self.assertEqual(caught.exception.kind, "http_other")
        self.assertFalse(chat._claude_allowed())
        self.assertEqual(chat._chain(), ["gemini-3.8-flash", GEMINI])

    def test_available_with_each_provider_or_injected_model(self):
        names = ("CLAUDE_API_CREDIT_KEY", "LAUNDRY_CHAT_GEMINI_KEY", "GEMINI_API_KEY")
        for name in names:
            os.environ.pop(name, None)
        self.assertFalse(chat.available())
        for name in names:
            os.environ[name] = self.key
            self.assertTrue(chat.available())
            os.environ.pop(name)
        with mock.patch.object(chat, "_MODEL_FN", lambda *_args: ""):
            self.assertTrue(chat.available())

    def test_chat_usage_readback_accepts_claude_but_vision_rejects_it(self):
        chat.record(None, {"routed": 1}, {SONNET: {"ok": 1}})
        chat.record(None, {"routed": 1}, {HAIKU: {"http_429": 1}})
        data = json.loads((self.root / "chat" / "2026-11-10.json").read_text(encoding="utf-8"))
        self.assertEqual(data["models"], {SONNET: {"ok": 1}, HAIKU: {"http_429": 1}})
        with mock.patch.object(photo, "_taipei_date", return_value=date(2026, 11, 10)):
            report = chat.usage_report(1)[0]
        self.assertIn(SONNET, report)
        self.assertIn(HAIKU, report)
        with mock.patch.dict(os.environ, {"LAUNDRY_VISION_MODEL": SONNET}):
            self.assertEqual(photo.model_chain(), [])
        with mock.patch.dict(os.environ, {"LAUNDRY_VISION_MODEL": "gemini-2.5-flash",
                                          "LAUNDRY_VISION_FALLBACK_MODEL": HAIKU}):
            self.assertEqual(photo.model_chain(), ["gemini-2.5-flash"])
        self.assertEqual(photo.DEFAULT_MODEL_CHAIN, ("gemini-2.5-flash", "gemini-flash-latest", GEMINI))

    def test_readyz_adds_only_boolean_chat_claude_and_no_key(self):
        import line_webhook as webhook
        request = SimpleNamespace(remote_addr="127.0.0.1", host="127.0.0.1:8791", headers={})
        with mock.patch.object(webhook, "request", request), \
                mock.patch.object(webhook, "jsonify", side_effect=lambda **kwargs: kwargs):
            present = webhook.readyz()
            os.environ.pop("CLAUDE_API_CREDIT_KEY")
            absent = webhook.readyz()
        self.assertIs(present.pop("chat_claude"), True)
        self.assertIs(absent.pop("chat_claude"), False)
        self.assertEqual(present, absent)
        self.assertEqual(set(present), {"pid", "vision_configured", "ai_chat", "missing"})
        self.assertTrue(self.key not in str(present))

    def test_readyz_claude_only_enables_chat_without_claiming_vision_ready(self):
        import line_webhook as webhook
        os.environ.pop("LAUNDRY_CHAT_GEMINI_KEY", None)
        os.environ.pop("GEMINI_API_KEY", None)
        request = SimpleNamespace(remote_addr="127.0.0.1", host="127.0.0.1:8791", headers={})
        with mock.patch.object(webhook, "request", request), \
                mock.patch.object(webhook, "jsonify", side_effect=lambda **kwargs: kwargs):
            row = webhook.readyz()
        self.assertIs(row["chat_claude"], True)
        self.assertIs(row["ai_chat"], True)
        self.assertIs(row["vision_configured"], False)
        self.assertIn("GEMINI_API_KEY", row["missing"])


if __name__ == "__main__":
    unittest.main()
