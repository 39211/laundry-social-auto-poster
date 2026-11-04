# -*- coding: utf-8 -*-
"""Old (off) vs new (on) replies for the LAUNDRY_AI_CHAT switch, for the owner's review.

Runs every dialogue in test-assets/ai-chat-eval.json through conversation.handle twice, in an
isolated temp copy of the public data files (no sessions, bookings or customer files copied).
Without --live (or without GEMINI_API_KEY) a deterministic fake model answers from the dataset.
With --live the real Gemini is used and calls are spaced (default 13 s) for the free tier.

Writes output/ai-chat-eval/<date>.md and .json under the repo root.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request
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


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Compare old vs AI chat replies.")
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


if __name__ == "__main__":
    raise SystemExit(main())
