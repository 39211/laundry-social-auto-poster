# -*- coding: utf-8 -*-
"""Old (off) vs new (on) replies for the LAUNDRY_AI_CHAT switch, for the owner's review.

Runs every dialogue in test-assets/ai-chat-eval.json through conversation.handle twice, in an
isolated temp copy of the public data files (no sessions, bookings or customer files copied).
Without --live (or without GEMINI_API_KEY) a deterministic fake model answers from the dataset.
With --live the real Gemini is used and calls are spaced (default 13 s) for the free tier.

Writes output/ai-chat-eval/<date>.md and .json under the repo root.

Sub-command `bench` (task card V2-bench-b) grades test-assets/ai-chat-bench.json:
  bench [--offline]            stub model returns each item's stub_answer (default; no network)
  bench --live --max-calls N   real model chain, hard-capped at N calls
Exit code 1 when any item is CRITICAL (an unsafe answer reached the customer); 2 = cannot grade.
"""
from __future__ import annotations

import argparse
import atexit
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent
TAIPEI = timezone(timedelta(hours=8))
DATASET = HERE / "test-assets" / "ai-chat-eval.json"


def copy_public_data(src_repo: Path, dst_repo: Path) -> None:
    """Copy only the two approved public configuration files, never customer data."""
    src, dst = src_repo / "data", dst_repo / "data"
    dst.mkdir(parents=True, exist_ok=True)
    for name in ("prices.json", "business-profile.json"):
        path = src / name
        if path.is_file():
            shutil.copy2(path, dst / name)


def _render(msgs) -> tuple[list[str], list[str]]:
    texts, buttons = [], []
    for msg in msgs or []:
        if msg.get("type") == "text":
            texts.append(msg.get("text") or "")
        elif msg.get("type") == "flex":
            texts.append("[卡片] " + (msg.get("altText") or ""))
        else:
            texts.append(f"[{msg.get('type')}]")
        for item in (msg.get("quickReply") or {}).get("items") or []:
            label = (item.get("action") or {}).get("label")
            if label:
                buttons.append(label)
    return texts, buttons


def _cell(texts: list[str], buttons: list[str], staff: int) -> str:
    body = " / ".join(texts) or "（無回覆）"
    if buttons:
        body += "〔按鈕：" + "、".join(buttons) + "〕"
    if staff:
        body += f"〔通知店員 ×{staff}〕"
    return body.replace("|", "｜").replace("\n", "<br>")


def compare_main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Compare old vs AI chat replies. (Also: bench --help)")
    parser.add_argument("--live", action="store_true", help="use the real Gemini (needs GEMINI_API_KEY)")
    parser.add_argument("--spacing", type=float, default=None, help="seconds between live model calls (default 13)")
    parser.add_argument("--out", default="", help="output directory (default <repo>/output/ai-chat-eval)")
    args = parser.parse_args(argv)

    src_repo = Path(os.environ.get("LAUNDRY_REPO_ROOT") or HERE.parent).resolve()
    key = os.environ.get("GEMINI_API_KEY", "")
    live = bool(args.live and key)
    if args.live and not key:
        print("--live requires GEMINI_API_KEY; no live evaluation was performed.", file=sys.stderr)
        return 2
    if not live:
        os.environ.pop("GEMINI_API_KEY", None)
    spacing = args.spacing if args.spacing is not None else (13.0 if live else 0.0)

    tmp = Path(tempfile.mkdtemp(prefix="ai-chat-eval-"))
    try:
        copy_public_data(src_repo, tmp)
        os.environ["LAUNDRY_REPO_ROOT"] = str(tmp)
        os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
        os.environ["LAUNDRY_CHAT_USAGE_DIR"] = str(tmp / "data" / "chat-usage")
        os.environ["LAUNDRY_VISION_USAGE_DIR"] = str(tmp / "data" / "vision-usage")
        os.environ["LAUNDRY_AI_CHAT"] = "off"
        sys.path.insert(0, str(HERE))

        real_urlopen = urllib.request.urlopen

        def guarded(req, *a, **k):
            url = getattr(req, "full_url", str(req))
            if live and url.startswith("https://generativelanguage.googleapis.com/"):
                return real_urlopen(req, *a, **k)
            raise RuntimeError("network disabled in eval")

        urllib.request.urlopen = guarded

        staff = ModuleType("staff_notify")
        staff.inbox = []
        staff.guest_name = lambda _uid: "測試客人"
        staff.push_inbox = lambda kind, rec, **_k: (staff.inbox.append((kind, rec)) or {"saved": True, "notified": True})
        sys.modules["staff_notify"] = staff
        pay = ModuleType("line_pay")
        pay.configured = lambda: False
        sys.modules["line_pay"] = pay

        import conversation as conv
        import ai_chat

        if hasattr(conv.cprof, "PROFILE_PATH"):
            conv.cprof.PROFILE_PATH = tmp / "data" / "line-customer-profile.json"

        state = {"fake": None}

        def fake(_model, _prompt, _timeout):
            return json.dumps(state["fake"] or {"kind": "unsure", "reply": ""}, ensure_ascii=False)

        if not live:
            ai_chat.set_model(fake)

        dataset = json.loads(DATASET.read_text(encoding="utf-8"))
        stamp = datetime.now(TAIPEI).strftime("%H%M%S")
        report = []
        totals = {"turns": 0, "changed": 0, "model_calls": 0, "staff_old": 0, "staff_new": 0}
        for index, dialogue in enumerate(dataset["dialogues"], 1):
            rows = []
            runs = {}
            for mode in ("off", "on"):
                os.environ["LAUNDRY_AI_CHAT"] = mode
                uid = f"Ueval{mode}{index:03d}{stamp}"
                out = []
                for turn in dialogue["turns"]:
                    state["fake"] = turn.get("fake")
                    calls_before = ai_chat.call_count
                    inbox_before = len(staff.inbox)
                    started = time.monotonic()
                    try:
                        msgs = conv.handle(uid, turn["say"])
                    except Exception as exc:  # keep the report going; show the class only
                        msgs = [{"type": "text", "text": f"[錯誤 {type(exc).__name__}]"}]
                    texts, buttons = _render(msgs)
                    calls = ai_chat.call_count - calls_before
                    out.append({
                        "texts": texts,
                        "buttons": buttons,
                        "staff": len(staff.inbox) - inbox_before,
                        "model_calls": calls,
                        "ms": int((time.monotonic() - started) * 1000),
                    })
                    if live and calls and spacing:
                        time.sleep(spacing)
                runs[mode] = out
            for pos, turn in enumerate(dialogue["turns"]):
                old, new = runs["off"][pos], runs["on"][pos]
                changed = (old["texts"], old["buttons"]) != (new["texts"], new["buttons"])
                totals["turns"] += 1
                totals["changed"] += int(changed)
                totals["model_calls"] += new["model_calls"]
                totals["staff_old"] += old["staff"]
                totals["staff_new"] += new["staff"]
                rows.append({"say": turn["say"], "off": old, "on": new, "changed": changed})
            report.append({"id": dialogue["id"], "title": dialogue["title"], "turns": rows})
            print(f"completed dialogue {index}/{len(dataset['dialogues'])}; model_calls={totals['model_calls']}", flush=True)

        os.environ["LAUNDRY_AI_CHAT"] = "off"
        day = datetime.now(TAIPEI).date().isoformat()
        out_dir = Path(args.out) if args.out else src_repo / "output" / "ai-chat-eval"
        out_dir.mkdir(parents=True, exist_ok=True)
        payload = {"date": day, "model": "live" if live else "fake", "summary": totals, "dialogues": report}
        payload["anonymous_usage"] = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in (tmp / "data" / "chat-usage").glob("*.json")}
        payload["evidence_scope"] = "Synthetic dialogues; staff notifications stubbed; no customer messages sent."
        (out_dir / f"{day}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

        lines = [
            f"# LINE AI 對話比較（{day}）",
            "",
            f"- 模型：{'真的 Gemini' if live else '固定假模型（沒加 --live）'}",
            f"- 對話 {len(report)} 組、共 {totals['turns']} 句；回覆有變的 {totals['changed']} 句；模型呼叫 {totals['model_calls']} 次",
            f"- 通知店員：舊 {totals['staff_old']} 次 → 新 {totals['staff_new']} 次",
            "- 「相同」代表那一句由原本的固定流程處理，AI 沒有插手。",
            "",
        ]
        for i, dialogue in enumerate(report, 1):
            lines += [f"## {i:02d} · {dialogue['title']}", "",
                      "| # | 客人 | 舊回覆（off） | 新回覆（on） | |", "|---|---|---|---|---|"]
            for pos, row in enumerate(dialogue["turns"], 1):
                old, new = row["off"], row["on"]
                lines.append(
                    f"| {pos} | {row['say'].replace('|', '｜')} | {_cell(old['texts'], old['buttons'], old['staff'])} | "
                    f"{_cell(new['texts'], new['buttons'], new['staff'])} | {'改變' if row['changed'] else '相同'} |")
            lines.append("")
        (out_dir / f"{day}.md").write_text("\n".join(lines), encoding="utf-8")
        print(f"wrote {out_dir / (day + '.md')}")
        print(f"wrote {out_dir / (day + '.json')}")
        print(f"turns={totals['turns']} changed={totals['changed']} model_calls={totals['model_calls']}")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# bench sub-command (task card V2-bench-b): grade test-assets/ai-chat-bench.json
# ---------------------------------------------------------------------------
BENCH_FILE = HERE / "test-assets" / "ai-chat-bench.json"
BENCH_STATES = ("none", "pickup_loc", "pickup_addr", "pickup_confirm")
BENCH_EXPECTS = ("rule", "ai", "staff", "ai_or_staff")
STUB_KINDS = ("clean", "price", "wrong_days", "relative_day", "store_claim", "url", "promise")
NEUTRAL_ANSWER = "好的，有需要送洗或想問洗護的地方都可以跟我說。"
GEMINI_PREFIX = "https://generativelanguage.googleapis.com/"
_AI_INTENTS = frozenset({"ai_answer", "ai_side_question", "ai_resolved"})
_STAFF_INTENTS = frozenset({"ai_staff", "human"})
_HOOK_NAMES = ("handoff_first", "compound_payment_question", "mid_flow", "no_flow_answer")
_BENCH_ENV: dict = {}


class BenchError(ValueError):
    """The bench cannot be graded; the message says what to fix."""


def load_bench(path: Path) -> list[dict]:
    """Read and validate the bench file (schema fixed by the task card)."""
    where = f"bench file {path.name}"
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise BenchError(f"{where}: not found at {path}") from None
    except (OSError, UnicodeError) as exc:
        raise BenchError(f"{where}: cannot be read ({type(exc).__name__})") from None
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise BenchError(f"{where}: not valid JSON ({exc})") from None
    if not isinstance(data, dict) or data.get("version") != 1:
        raise BenchError(f'{where}: the top level must be an object with "version": 1')
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise BenchError(f'{where}: "items" must be a non-empty list')
    seen: set = set()
    out = []
    for pos, item in enumerate(items, 1):
        label = f"{where}: item {pos}"
        if not isinstance(item, dict):
            raise BenchError(f"{label}: must be an object")
        ident = item.get("id")
        if not isinstance(ident, str) or not ident.strip():
            raise BenchError(f'{label}: "id" must be a non-empty string')
        label += f" (id={ident})"
        if ident in seen:
            raise BenchError(f'{label}: duplicate "id"')
        seen.add(ident)
        for key in ("category", "text"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                raise BenchError(f'{label}: "{key}" must be a non-empty string')
        if item.get("state") not in BENCH_STATES:
            raise BenchError(f'{label}: "state" must be one of {", ".join(BENCH_STATES)}')
        if item.get("expect") not in BENCH_EXPECTS:
            raise BenchError(f'{label}: "expect" must be one of {", ".join(BENCH_EXPECTS)}')
        lists = {}
        for key in ("must_not", "must_include"):
            value = item.get(key)
            if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
                raise BenchError(f'{label}: "{key}" must be a list of non-empty strings')
            lists[key] = value
        compiled = []
        for pattern in lists["must_not"]:
            try:
                compiled.append(re.compile(pattern))
            except re.error as exc:
                raise BenchError(f'{label}: "must_not" regex {pattern!r} does not compile ({exc})') from None
        stub = item.get("stub_answer")
        if stub is not None and (not isinstance(stub, str) or not stub.strip()):
            raise BenchError(f'{label}: "stub_answer" must be a non-empty string when given')
        kind = item.get("stub_kind")
        if kind is not None and kind not in STUB_KINDS:
            raise BenchError(f'{label}: "stub_kind" must be one of {", ".join(STUB_KINDS)}')
        if kind not in (None, "clean") and stub is None:
            raise BenchError(f'{label}: "stub_kind" {kind} needs a "stub_answer"')
        out.append({
            "id": ident, "category": item["category"].strip(), "state": item["state"],
            "text": item["text"], "expect": item["expect"], "must_not": lists["must_not"],
            "must_include": lists["must_include"], "stub_answer": stub, "stub_kind": kind or "clean",
            "_must_not": compiled,
        })
    return out


def _swap_env(values: dict) -> dict:
    old = {key: os.environ.get(key) for key in values}
    for key, value in values.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    return old


@contextmanager
def _network_guard(live: bool, counter: dict):
    """Block urlopen; in live mode only the Gemini endpoint may pass."""
    real = urllib.request.urlopen

    def guarded(req, *a, **k):
        url = getattr(req, "full_url", str(req))
        if live and url.startswith(GEMINI_PREFIX):
            return real(req, *a, **k)
        counter["attempts"] = counter.get("attempts", 0) + 1
        raise urllib.error.URLError("network disabled in bench")

    urllib.request.urlopen = guarded
    try:
        yield
    finally:
        urllib.request.urlopen = real


def bench_env():
    """Import the bot once per process inside a temp copy of the public config files only."""
    if _BENCH_ENV:
        return _BENCH_ENV["conv"], _BENCH_ENV["ai_chat"]
    src_repo = Path(os.environ.get("LAUNDRY_REPO_ROOT") or HERE.parent).resolve()
    tmp = Path(tempfile.mkdtemp(prefix="ai-chat-bench-"))
    atexit.register(shutil.rmtree, tmp, True)
    copy_public_data(src_repo, tmp)
    env = {
        "LAUNDRY_REPO_ROOT": str(tmp),
        "LAUNDRY_LOOKUP_FIXTURE": "1",
        "LAUNDRY_CHAT_USAGE_DIR": str(tmp / "data" / "chat-usage"),
        "LAUNDRY_VISION_USAGE_DIR": str(tmp / "data" / "vision-usage"),
        "LAUNDRY_AI_CHAT": "off",
    }
    saved = _swap_env(env)
    try:
        with _network_guard(False, {}):
            if str(HERE) not in sys.path:
                sys.path.insert(0, str(HERE))
            fresh = "conversation" not in sys.modules
            if fresh:
                staff = ModuleType("staff_notify")
                staff.inbox = []
                staff.guest_name = lambda _uid: "測試客人"
                staff.push_inbox = lambda kind, rec, **_k: (
                    staff.inbox.append((kind, rec)) or {"saved": True, "notified": True})
                sys.modules["staff_notify"] = staff
                pay = ModuleType("line_pay")
                pay.configured = lambda: False
                sys.modules["line_pay"] = pay
            import conversation as conv
            import ai_chat
            if fresh and hasattr(getattr(conv, "cprof", None), "PROFILE_PATH"):
                conv.cprof.PROFILE_PATH = tmp / "data" / "line-customer-profile.json"
    finally:
        _swap_env(saved)
    _BENCH_ENV.update(conv=conv, ai_chat=ai_chat, env=env, tmp=tmp)
    return conv, ai_chat


def _squash(text: str) -> str:
    return re.sub(r"[\s*#`「」\"']+", "", unicodedata.normalize("NFKC", text or ""))


def _leaked(stub: str, texts: list, ai_reply: bool) -> bool:
    """True when the stub (or a cleaned piece of it, for AI replies) reached the customer."""
    s = _squash(stub)
    if not s:
        return False
    if s in _squash("".join(texts)):
        return True
    return ai_reply and any(len(_squash(t)) >= 4 and _squash(t) in s for t in texts)


def _explain_rejection(ai_chat, reply, facts: str, customer: str) -> str:
    """Name the check_reply rule the reply breaks (label only; blocking is done by ai_chat)."""
    try:
        if not isinstance(reply, str):
            return "not_text"
        if ai_chat._ACTION_CLAIM_RE.search(reply):
            return "action_claim"
        text = reply.replace("**", "").replace("*", "").replace("#", "").replace("`", "")
        text = re.sub(r"\s+", " ", text).strip().strip("「」\"' ")
        if len(text) < 4:
            return "too_short"
        probe = unicodedata.normalize("NFKC", text)
        low = probe.lower()
        if ai_chat._MONEY_RE.search(probe) or ai_chat._CN_AMOUNT_RE.search(probe):
            return "price"
        if ai_chat._CN_DAYS_RE.search(probe):
            return "turnaround"
        if ai_chat._OTHER_TIME_RE.search(probe):
            return "relative_day"
        for match in ai_chat._DAY_SPAN_RE.finditer(probe):
            span = match.group(1) + ("-" + match.group(2) if match.group(2) else "")
            if span not in ai_chat._ALLOWED_DAY_SPANS:
                return "turnaround"
        allowed = set(re.findall(r"\d+", unicodedata.normalize("NFKC", facts))) | {"5", "7", "10", "14"}
        if any(d not in allowed for d in re.findall(r"\d+", probe)):
            return "number"
        if not ai_chat._duration_is_grounded(probe):
            return "turnaround"
        if ai_chat._URL_RE.search(low):
            return "url"
        if any(word in low for word in ai_chat._BANNED):
            return "banned_word"
        if ai_chat._GUARANTEE_RE.search(probe):
            return "promise"
        if any(ch in ai_chat._SIMPLIFIED for ch in text) or not re.search(r"[\u4e00-\u9fff]", text):
            return "script"
        if sum(1 for ch in text if ai_chat._is_emoji(ch)) > 1:
            return "emoji"
        if ai_chat._echoes_address(customer, text, facts):
            return "address_echo"
        if ai_chat._ungrounded_store_claim(text, facts):
            return "store_claim"
        return "length"
    except Exception:
        return "unknown"


def _guard_name(conv, ai_chat, item, outcome, hook, intent, calls, checks) -> str:
    text = item["text"]
    n = text.strip().replace(" ", "").replace("？", "").replace("?", "")
    try:
        if hook == "handoff_first" or (intent == "human" and ai_chat.is_handoff_text(text)):
            return "handoff"
        if outcome == "staff" and any(allow and res is not None for allow, _r, res in checks):
            return "store_claim"  # clean except for an invented store detail -> asked the shop
        rejected = [reply for allow, reply, res in checks if not allow and res is None]
        if rejected and outcome != "ai":
            return _explain_rejection(ai_chat, rejected[-1], ai_chat.facts_text(conv), text)
        if not calls and ai_chat._PRIVATE_CUSTOMER_RE.search(text):
            return "private_input"
        if not calls and hook in ("mid_flow", "no_flow_answer") and ai_chat._PRICE_RE.search(n):
            return "price_route"
        if calls and outcome == "fallback":
            return "model_unusable"
    except Exception:
        return "unknown"
    return ""


def _split_result(result):
    if isinstance(result, tuple):
        msgs = result[0] if result and isinstance(result[0], list) else []
        meta = result[1] if len(result) > 1 and isinstance(result[1], dict) else {}
        return msgs, meta
    if isinstance(result, list):
        return result, {}
    return [], {}


def _grade_item(conv, ai_chat, item: dict, index: int, sessions: Path, state: dict,
                answered: list, checks: list) -> dict:
    stub, stub_kind = item["stub_answer"], item["stub_kind"]
    state["payload"] = {"kind": "answer", "reply": stub if stub is not None else NEUTRAL_ANSWER}
    inbox = getattr(sys.modules.get("staff_notify"), "inbox", None)
    if not isinstance(inbox, list):
        inbox = None
    folder = Path(tempfile.mkdtemp(prefix=f"item{index:04d}-", dir=sessions))
    old_paths = {key: getattr(conv, key) for key in ("SESS", "BOOK") if hasattr(conv, key)}
    uid = f"Ubench{index:04d}{os.urandom(8).hex()}"
    result, error, setup_error, calls, inbox_delta = None, "", "", 0, 0
    try:
        if "SESS" in old_paths:
            conv.SESS = folder / "line-sessions.json"
        if "BOOK" in old_paths:
            conv.BOOK = folder / "line-bookings.jsonl"
        os.environ["LAUNDRY_AI_CHAT"] = "off"
        if item["state"] != "none":
            try:
                conv.handle_ex(uid, "外收送預約")  # real start of the pickup flow (form id, step data)
            except Exception as exc:
                setup_error = type(exc).__name__
            conv.set_sess(uid, wait=item["state"])
        answered.clear()
        checks.clear()
        os.environ["LAUNDRY_AI_CHAT"] = "on"
        calls_before = ai_chat.call_count
        inbox_before = len(inbox) if inbox is not None else 0
        try:
            result = conv.handle_ex(uid, item["text"], "message", f"bench-{index:04d}")
        finally:
            calls = ai_chat.call_count - calls_before
            inbox_delta = len(inbox) - inbox_before if inbox is not None else 0
    except Exception as exc:
        error = type(exc).__name__
    finally:
        os.environ["LAUNDRY_AI_CHAT"] = "off"
        for key, value in old_paths.items():
            setattr(conv, key, value)

    msgs, meta = _split_result(result)
    texts, _buttons = _render([m for m in msgs if isinstance(m, dict)])
    final = "\n".join(texts)
    hook = answered[-1] if answered else ""
    intent = str(meta.get("intent") or "")
    staff_notified = bool(meta.get("notify_staff") or meta.get("staff_pushed") or inbox_delta > 0)
    if error:
        outcome = "error"
    elif intent in _AI_INTENTS:
        outcome = "ai"
    elif intent == "ai_staff" or (hook and intent in _STAFF_INTENTS):
        outcome = "staff"
    elif hook:
        outcome = "rule"      # AI layer routed to a deterministic reply (price line, old router)
    elif calls:
        outcome = "fallback"  # model was asked, answer not used: rule reply went out
    elif staff_notified or intent == "human":
        outcome = "staff"
    else:
        outcome = "rule"
    guard = _guard_name(conv, ai_chat, item, outcome, hook, intent, calls, checks)
    violations = [p.pattern for p in item["_must_not"] if p.search(final)]
    missing = [s for s in item["must_include"] if s not in final]
    reasons = []
    if stub is not None and stub_kind != "clean" and _leaked(stub, texts, outcome == "ai"):
        reasons.append("unsafe_stub_reached_customer")
    if outcome == "ai" and violations:
        reasons.append("must_not_in_ai_reply")
    expect = item["expect"]
    if outcome == "error":
        ok = False
    elif expect == "rule":
        ok = outcome in ("rule", "fallback")
    elif expect == "ai":
        ok = outcome == "ai"
    elif expect == "staff":
        ok = outcome == "staff" or staff_notified
    else:
        ok = outcome in ("ai", "staff") or staff_notified
    return {
        "id": item["id"], "category": item["category"], "state": item["state"], "text": item["text"],
        "expect": expect, "stub": "item" if stub is not None else "neutral", "stub_kind": stub_kind,
        "outcome": outcome, "hook": hook, "intent": intent, "guard": guard, "model_calls": calls,
        "staff_notified": staff_notified, "final_text": final, "expect_ok": ok,
        "pass": bool(ok and not violations and not missing and not reasons),
        "must_not_violations": violations, "missing_includes": missing,
        "critical": bool(reasons), "critical_reasons": reasons, "error": error, "setup_error": setup_error,
    }


def _skipped_row(item: dict) -> dict:
    return {
        "id": item["id"], "category": item["category"], "state": item["state"], "text": item["text"],
        "expect": item["expect"], "stub": "none", "stub_kind": item["stub_kind"], "outcome": "skipped",
        "hook": "", "intent": "", "guard": "", "model_calls": 0, "staff_notified": False,
        "final_text": "", "expect_ok": False, "pass": False, "must_not_violations": [],
        "missing_includes": [], "critical": False, "critical_reasons": [], "error": "", "setup_error": "",
    }


def run_bench(items: list, *, live: bool = False, max_calls: int = 0, spacing: float = 0.0) -> dict:
    conv, ai_chat = bench_env()
    if ai_chat._PE is None:
        raise BenchError("photo_estimate could not be imported (Pillow missing?); the AI layer cannot run")
    env = dict(_BENCH_ENV["env"])
    if not live:
        env["GEMINI_API_KEY"] = None
    sessions = Path(tempfile.mkdtemp(prefix="sessions-", dir=_BENCH_ENV["tmp"]))
    state = {"payload": None, "used": 0, "attempts": 0}
    answered: list = []
    checks: list = []

    def offline_model(_model, _prompt, _timeout):
        return json.dumps(state["payload"], ensure_ascii=False)

    def live_model(model, prompt, timeout):
        if state["used"] >= max_calls:
            raise ai_chat.ModelError("http_other")  # budget spent: no request is made
        state["used"] += 1
        return ai_chat._gemini_call(model, prompt, timeout)

    def spy(name, fn):
        def wrapper(*args, **kwargs):
            result = fn(*args, **kwargs)
            if result is not None:
                answered.append(name)
            return result
        return wrapper

    real_check = ai_chat.check_reply

    def check_spy(reply, facts, customer_text="", *, allow_store_claims=False):
        result = real_check(reply, facts, customer_text, allow_store_claims=allow_store_claims)
        checks.append((bool(allow_store_claims), reply, result))
        return result

    originals = {name: getattr(ai_chat, name) for name in _HOOK_NAMES if hasattr(ai_chat, name)}
    old_model = ai_chat._MODEL_FN
    calls_start = ai_chat.call_count
    saved_env = _swap_env(env)
    rows = []
    try:
        with _network_guard(live, state):
            ai_chat.set_model(live_model if live else offline_model)
            ai_chat.check_reply = check_spy
            for name, fn in originals.items():
                setattr(ai_chat, name, spy(name, fn))
            for index, item in enumerate(items, 1):
                if live and state["used"] >= max_calls:
                    rows.append(_skipped_row(item))
                    continue
                used_before = state["used"]
                rows.append(_grade_item(conv, ai_chat, item, index, sessions, state, answered, checks))
                if live and spacing and state["used"] > used_before and index < len(items):
                    time.sleep(spacing)
    finally:
        for name, fn in originals.items():
            setattr(ai_chat, name, fn)
        ai_chat.check_reply = real_check
        ai_chat.set_model(old_model)
        _swap_env(saved_env)
    return {"rows": rows, "model_attempts": ai_chat.call_count - calls_start,
            "live_calls_used": state["used"], "network_attempts": state["attempts"]}


def _bench_summary(rows: list) -> dict:
    def blank():
        return {"items": 0, "graded": 0, "passed": 0, "fell_back": 0, "to_staff": 0,
                "critical": 0, "errors": 0, "skipped": 0}
    cats: dict = {}
    total = blank()
    for row in rows:
        for slot in (cats.setdefault(row["category"], blank()), total):
            slot["items"] += 1
            if row["outcome"] == "skipped":
                slot["skipped"] += 1
                continue
            slot["graded"] += 1
            slot["passed"] += int(row["pass"])
            slot["fell_back"] += int(row["outcome"] == "fallback")
            slot["to_staff"] += int(row["outcome"] == "staff" or row["staff_notified"])
            slot["critical"] += int(row["critical"])
            slot["errors"] += int(row["outcome"] == "error")
    return {"by_category": dict(sorted(cats.items())), "total": total}


def _pct(n: int, d: int) -> str:
    return f"{100.0 * n / d:.0f}%" if d else "-"


def _print_table(summary: dict) -> None:
    head = f"{'category':<24}{'items':>6}{'pass %':>8}{'fell back %':>13}{'to staff %':>12}{'criticals':>11}"
    print(head)
    print("-" * len(head))
    for name, s in list(summary["by_category"].items()) + [("TOTAL", summary["total"])]:
        print(f"{name[:24]:<24}{s['items']:>6}{_pct(s['passed'], s['graded']):>8}"
              f"{_pct(s['fell_back'], s['graded']):>13}{_pct(s['to_staff'], s['graded']):>12}{s['critical']:>11}")


def bench_main(argv) -> int:
    parser = argparse.ArgumentParser(prog="eval_ai_chat.py bench",
                                     description="Grade the night-chat bench (offline stub model by default).")
    how = parser.add_mutually_exclusive_group()
    how.add_argument("--offline", action="store_true", help="stub model returns each item's stub_answer (default)")
    how.add_argument("--live", action="store_true", help="real model calls; needs --max-calls and GEMINI_API_KEY")
    parser.add_argument("--max-calls", type=int, default=None, help="hard cap on live model calls (required with --live)")
    parser.add_argument("--spacing", type=float, default=None, help="seconds between live calls (default 13)")
    parser.add_argument("--bench", default=str(BENCH_FILE), help="bench JSON (default test-assets/ai-chat-bench.json)")
    parser.add_argument("--out", default="", help="result JSON (default <repo>/output/ai-chat-bench/<date>-<mode>.json)")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(errors="replace")
        except Exception:
            pass
    live = bool(args.live)
    if live:
        if args.max_calls is None:
            print("bench --live refuses to run without --max-calls N; no model calls were made.", file=sys.stderr)
            return 2
        if args.max_calls < 1:
            print("bench --live: --max-calls must be at least 1; no model calls were made.", file=sys.stderr)
            return 2
        if not os.environ.get("GEMINI_API_KEY"):
            print("bench --live requires GEMINI_API_KEY; no model calls were made.", file=sys.stderr)
            return 2
    try:
        items = load_bench(Path(args.bench))
    except BenchError as exc:
        print(f"bench: invalid bench file: {exc}", file=sys.stderr)
        return 2
    src_repo = Path(os.environ.get("LAUNDRY_REPO_ROOT") or HERE.parent).resolve()
    day = datetime.now(TAIPEI).date().isoformat()
    mode_name = "live" if live else "offline"
    out = Path(args.out) if args.out else src_repo / "output" / "ai-chat-bench" / f"{day}-{mode_name}.json"
    spacing = args.spacing if args.spacing is not None else (13.0 if live else 0.0)
    try:
        run = run_bench(items, live=live, max_calls=args.max_calls or 0, spacing=spacing)
    except BenchError as exc:
        print(f"bench: {exc}", file=sys.stderr)
        return 2
    rows = run["rows"]
    summary = _bench_summary(rows)
    criticals = [row for row in rows if row["critical"]]
    payload = {
        "schema": "ai-chat-bench-result/v1", "date": day, "mode": mode_name, "bench": Path(args.bench).name,
        "summary": summary, "model_calls": run["model_attempts"],
        "live_calls_used": run["live_calls_used"] if live else 0, "live_max_calls": args.max_calls if live else 0,
        "network_attempts": run["network_attempts"],
        "evidence_scope": "Synthetic bench items; staff notifications stubbed; no customer messages sent.",
        "items": rows,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    _print_table(summary)
    for row in criticals:
        print(f"CRITICAL {row['id']}: {', '.join(row['critical_reasons'])} -> {row['final_text'][:80]!r}")
    for row in rows:
        if row["outcome"] == "error":
            print(f"ERROR {row['id']}: {row['error']}")
    if live:
        print(f"live model calls used: {run['live_calls_used']}/{args.max_calls}")
    else:
        print(f"offline stub model calls: {run['model_attempts']}")
    print(f"wrote {out}")
    return 1 if criticals else 0


def main(argv=None) -> int:
    """`bench ...` grades the bench; anything else is the original old-vs-new comparison."""
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "bench":
        return bench_main(args[1:])
    return compare_main(args)


if __name__ == "__main__":
    raise SystemExit(main())
