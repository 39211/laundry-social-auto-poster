#!/usr/bin/env python3
"""Render the shot prompts as a promptbook the owner can actually read.

Deliberately not shaped like the nine promptbooks handed over on 2026-09-14.
Those claimed 50 shots each and held 217 distinct prompts between them; the one
for this very reel claimed 50 and contained four distinct sentences, the same
paragraph pasted down the page with only the shot number changing. It could not
even count the shots: it said 50, the film has 23.

So this one carries, per shot: the measured slot from the reference edit, the
one micro-event, the full image prompt, the motion prompt with its word count,
and what the adversarial pass changed. Nothing is padded to reach a number.

Usage: write_soleso_promptbook.py <revised-dir> <out.md>
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

HEAD = """# 洗鞋片 v4 提示詞正本（SOLESO 節奏，2026-09-16 開拍）

拆解來源：`output/ref-learned/soleso-20260915/BREAKDOWN.md`
設計決策：`output/ref-learned/soleso-20260915/OUR-DESIGN.md`

## 這本和老闆交來那九本的差別

那九本每本都寫「50 shots」，合計 450 個編號鏡頭，實際只有 **217 句不重複**。
這支片對應的 `video_8_soleso_cloudtilt_50shots.md` 標稱 50 鏡，**實際只有 4 句不重複的提示詞**，
鏡頭 01 到 11 逐字相同，只有句中的編號在變；而且它連鏡數都算錯——參考片實測是 **23 鏡**，不是 50。

所以這本是重看影片做的。每一顆鏡頭都有：參考片量到的實際秒數、一個微事件、完整生圖提示詞、
運鏡提示詞與字數、以及對抗覆核改掉了什麼。**沒有為了湊數字而灌水的鏡頭。**

## 怎麼用

1. 先生 `s22b-studio-clean`（成品棚拍）。它同時是**片頭第一格**與**片尾最後一格**，迴圈靠它。
2. 用同一張檔案加髒污圖層做出 `s22a-studio-dirty`，**不要獨立再生一張**——兩張要 100% 對位。
3. 其餘鏡頭依序生圖 → 肉眼過 → I2V → 剪。
4. 每一顆都要過 `scripts/reel-v3/gate_soleso_prompts.py`。**但閘門過了只代表文字寫得好，
   不代表畫面是對的。畫面對不對只有逐幀看得出來。**

## 全片硬規則

| | |
|---|---|
| 機位 | **一律鎖死**。沒有推、拉、搖、跟、變焦。變化靠換工具，不靠運鏡 |
| 手 | **赤手**，淺灰短袖 polo。不戴任何顏色的手套 |
| 鞋 | 無品牌厚底白球鞋：細白針織鞋面、厚白泡棉中底、**中底側面一整排大型圓角鏤空**、素面深灰包頭與後跟護片 |
| 文字 | **畫面任何位置都不得出現任何字**，鞋上尤其不得有字標、標誌、條紋、徽章 |
| 每鏡 | 一個微事件，一個看得出來的結束狀態 |
| 運鏡提示詞 | 25–55 字、-ing 開頭、`Camera not moving.` 剛好一次、Sound 只點真的發生的接觸 |

---

"""


def main() -> int:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]).resolve()
    files = sorted(src.glob("*.json"))
    if not files:
        print(f"no shot json in {src}")
        return 2

    shots = [json.loads(io.open(f, encoding="utf-8").read()) for f in files]
    shots.sort(key=lambda s: s.get("slot", ""))

    L = [HEAD]
    total_seconds = 0.0
    for s in shots:
        sid = s.get("id", "?")
        slot = s.get("slot", "?")
        secs = float(s.get("seconds") or 0)
        total_seconds += secs
        mp = s.get("motion_prompt", "")
        n = len(mp.split())

        L.append(f"## `{sid}`　{slot} 秒　（{secs:.2f} 秒）")
        L.append("")
        if s.get("micro_event"):
            L.append(f"**微事件**：{s['micro_event']}")
            L.append("")
        L.append("### 生圖提示詞")
        L.append("")
        L.append("```text")
        L.append(s.get("still_prompt", "").strip())
        L.append("```")
        L.append("")
        L.append(f"### 運鏡提示詞（{n} 字）")
        L.append("")
        L.append("```text")
        L.append(mp.strip())
        L.append("```")
        L.append("")
        if s.get("revision_note"):
            L.append(f"> **對抗覆核改了什麼**：{s['revision_note']}")
            L.append("")
        L.append("---")
        L.append("")

    L.append("## 總計")
    L.append("")
    L.append(f"- 鏡頭數：**{len(shots)}**")
    L.append(f"- 片長：**{total_seconds:.2f} 秒**（參考片 30.13 秒）")
    words = [len(s.get("motion_prompt", "").split()) for s in shots]
    L.append(f"- 運鏡提示詞字數：最少 {min(words)}、最多 {max(words)}、中位數 {sorted(words)[len(words)//2]}")
    stills = [len(s.get("still_prompt", "")) for s in shots]
    L.append(f"- 生圖提示詞長度：最短 {min(stills):,}、最長 {max(stills):,} 字元，合計 {sum(stills):,}")
    uniq = len({s.get("still_prompt", "")[:400] for s in shots})
    L.append(f"- **不重複的生圖提示詞：{uniq} / {len(shots)}**"
             f"{'（全部都不一樣）' if uniq == len(shots) else '　← 有重複，要查'}")
    L.append("")

    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"written {out}  ({out.stat().st_size:,} bytes)")
    print(f"  {len(shots)} shots, {total_seconds:.2f}s, {uniq}/{len(shots)} distinct still prompts")
    if uniq != len(shots):
        print("  WARNING: some still prompts are near-duplicates -- that is the failure mode of the")
        print("           promptbooks this one replaces. Check before generating.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
