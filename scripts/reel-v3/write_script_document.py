#!/usr/bin/env python3
"""Render a film's shot list, narration and prompts as one readable document.

The owner reviews the script before any of it is paid for. Grok clips and
gpt-image stills cannot be un-generated, so the whole film has to be legible on
paper first -- every shot, the line spoken over it, the words that go to the
image model and the words that go to the video model.

Usage: write_script_document.py <job-dir> <out.md>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()

    cfg = json.loads(io.open(job / "job.json", encoding="utf-8-sig").read())
    timing = json.loads(io.open(job / "narration-timing.json", encoding="utf-8-sig").read())["lines"]
    shots_txt = json.loads(io.open(job / "prompts" / "shots-revised.json", encoding="utf-8").read())
    by_id = {s["id"]: s for s in shots_txt}

    L: list[str] = []
    L.append(f"# {cfg['title']}")
    L.append("")
    L.append(f"**{len(cfg['shots'])} 顆鏡頭・畫面 {sum(s['seconds'] for s in cfg['shots'])} 秒・"
             f"成片約 {round(timing[-1]['end'] + cfg.get('tail_pad_seconds', 0.8), 1)} 秒**")
    L.append("")
    L.append(cfg["source_note"])
    L.append("")
    L.append("## 機位")
    L.append("")
    L.append(cfg["camera_note"])
    L.append("")
    L.append("## 字卡政策")
    L.append("")
    L.append(cfg.get("caption_policy", ""))
    L.append("")
    L.append("## 洗前洗後")
    L.append("")
    L.append(cfg["ab_compare_note"])
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 分鏡表")
    L.append("")
    L.append("| # | 鏡頭 | 幕 | 秒 | 旁白 | 字卡 |")
    L.append("|---|------|----|----|------|------|")
    for i, sh in enumerate(cfg["shots"], start=1):
        line = timing[sh["lines"][0]]
        card = (line.get("card") or "").replace("\n", " / ") or "—"
        L.append(f"| {i} | `{sh['file'].replace('-raw.mp4', '')}` | {sh['act']} | "
                 f"{sh['seconds']} | {line['say']} | {card} |")
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 每一顆的提示詞")
    L.append("")

    act_seen = set()
    for i, sh in enumerate(cfg["shots"], start=1):
        sid = sh["file"].replace("-raw.mp4", "")
        s = by_id[sid]
        line = timing[sh["lines"][0]]
        if sh["act"] not in act_seen:
            act_seen.add(sh["act"])
            L.append(f"### 第 {sh['act']} 幕")
            L.append("")
        L.append(f"#### {i}. `{sid}` — {sh['seconds']} 秒"
                 + ("（畫面裡有臉）" if s["face_in_frame"] else "（無臉）"))
        L.append("")
        L.append(f"**旁白**：{line['say']}　（{line['start']:.2f}–{line['end']:.2f} 秒）")
        card = (line.get("card") or "").replace("\n", " / ")
        L.append(f"**字卡**：{card if card else '（不上字卡）'}")
        L.append("")
        L.append("**生圖提示詞**")
        L.append("")
        L.append("```text")
        L.append(s["still_prompt"].strip())
        L.append("```")
        L.append("")
        L.append(f"**生影片提示詞**（{len(s['motion_prompt'].split())} 字）")
        L.append("")
        L.append("```text")
        L.append(s["motion_prompt"].strip())
        L.append("```")
        L.append("")

    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"written {out}  ({out.stat().st_size} bytes, {len(L)} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
