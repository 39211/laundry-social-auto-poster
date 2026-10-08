#!/usr/bin/env python3
"""Render the distilled shot-technique library as a document the next film can use.

Nine reference promptbooks were handed over on 2026-09-14 containing 450 numbered
"shots". Measured, they hold 217 distinct prompts: three of the books repeat a
single paragraph fifteen or twenty times, and the counter in "shot 7" is the only
thing that changes down the page. This library is what survived reading all 217
against the shop's own rules.

Nothing here is copied verbatim unless it could be. Brand names, camera moves,
coloured gloves, flame work and sterilisation claims are all recorded in the
BANNED section with what to use instead, because those are the patterns most
likely to be lifted by accident.

Usage: write_technique_library.py <library.json> <out.md>
"""
from __future__ import annotations

import io
import json
import sys
from collections import Counter
from pathlib import Path

ORDER = ["MICRO_EVENT", "MATERIAL_OPTICS", "TOOL", "FRAMING", "PACING", "SOUND", "BANNED"]
ZH = {
    "MICRO_EVENT": "微事件：一個有界、看得出結果的動作",
    "MATERIAL_OPTICS": "材質光學：髒與淨怎麼寫成可查驗的事實",
    "TOOL": "工具",
    "FRAMING": "取景（鏡頭不動的前提下）",
    "PACING": "節奏",
    "SOUND": "聲音",
    "BANNED": "不得照抄，以及改用什麼",
}
WHY = {
    "MICRO_EVENT": "外部審查對上一支片的核心指控就是「動作沒有可驗收的結果」。這一節是解方：每一條都指定一個物件、一個位置、一個結束狀態，逐幀比對指得出來。寫新鏡頭時先從這裡挑。",
    "MATERIAL_OPTICS": "「髒」「亮」這種形容詞生不出畫面，也驗不了。這一節把它們換成位置與光的行為。",
    "TOOL": "參考片的變化來自換工具而不是運鏡。這些是能用在帆布、棉鞋帶、灰色鞋墊、橡膠圍條與橡膠大底上的。",
    "FRAMING": "本店兩台機位都不動。參考片裡所有的環繞、推軌、跟拍都不能用，這一節是在鏡頭不動的前提下仍然換得到新面的方法。",
    "PACING": "人的段落長，工序段落碎。",
    "SOUND": "生影片的模型把 Sound 欄當成第二組動作指令：講了什麼接觸，它就去演什麼接觸。",
    "BANNED": "這些是最容易順手抄進來的東西。每一條都附上改用什麼。",
}


def main() -> int:
    lib = json.loads(io.open(sys.argv[1], encoding="utf-8").read())
    out = Path(sys.argv[2]).resolve()
    entries = lib["library"] if isinstance(lib, dict) else lib

    counts = Counter(e["category"] for e in entries)
    verbatim = sum(1 for e in entries if e.get("verbatim"))

    L: list[str] = []
    L.append("# 鏡頭技法庫（蒸餾自九本參考提示詞本，2026-09-14）")
    L.append("")
    L.append("## 這份庫是怎麼來的，以及原始素材的實際成色")
    L.append("")
    L.append("老闆 2026-09-14 交來九本提示詞本，標題都寫 50 shots，合計 450 個編號鏡頭。"
             "實際量過，**不重複的只有 217 句**：")
    L.append("")
    L.append("| 提示詞本 | 標稱 | 實際不重複 | |")
    L.append("|---|---|---|---|")
    for name, total, uniq in [
        ("video_4_kingskleans_offwhite", 50, 50), ("video_9_petershoeshine_fire", 49, 49),
        ("video_2_volkswagen_w12", 49, 49), ("video_1_chenclean", 50, 32),
        ("video_5_cleankicks_vans", 50, 22), ("video_3_claude_promptmaster", 50, 5),
        ("video_8_soleso_cloudtilt", 50, 4), ("video_6_etsben_pressing", 50, 3),
        ("video_7_customkicks_on", 50, 3),
    ]:
        pct = round(100 * uniq / total)
        L.append(f"| {name} | {total} | {uniq} | {pct}% |")
    L.append("")
    L.append("重複率高的那幾本，是把一支三十秒的片切成五十等份，同一段場景的每一格填同一句話，"
             "只有 `shot 1`、`shot 2` 的編號在變。**老闆點名的三本正好是重複率最高的三本之一到之三**，"
             "所以這份庫的取材以 kingskleans 與 petershoeshine 兩本為主。")
    L.append("")
    L.append(f"217 句讀完後留下 **{len(entries)} 條**，其中 {verbatim} 條可直接照用，"
             f"其餘因為帶品牌、帶運鏡或帶未經證實的功效宣稱而改寫過。")
    L.append("")
    L.append("---")
    L.append("")

    for cat in ORDER:
        rows = [e for e in entries if e["category"] == cat]
        if not rows:
            continue
        L.append(f"## {ZH.get(cat, cat)}　（{len(rows)} 條）")
        L.append("")
        L.append(WHY.get(cat, "").replace("\n", ""))
        L.append("")
        for e in rows:
            tag = "" if e.get("verbatim") else "　*(改寫過)*"
            L.append(f"**{e['phrase']}**{tag}")
            L.append("")
            L.append(f"> {e['why']}　　`{e.get('source_shot', '')}`")
            L.append("")

    L.append("---")
    L.append("")
    L.append("## 怎麼用")
    L.append("")
    L.append("寫新鏡頭時的順序：先從**微事件**挑一條當這顆鏡頭的骨幹，"
             "再用**材質光學**把起始狀態寫成可查驗的事實，"
             "接著用**取景**決定怎麼在不動鏡頭的前提下看到要看的那一面，"
             "最後**聲音**只點這顆鏡頭真的會發生的接觸。")
    L.append("")
    L.append("房規不變，這份庫不覆蓋它們：25–55 字、動詞開頭、恰好一次 "
             "`Camera not moving.`、有臉就鎖 mouth closed、物件護照逢鞋必寫、"
             "禁令區塊逐項列。庫只是讓每一顆鏡頭有東西可寫，不是放寬檢查。")
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"written {out}  ({out.stat().st_size} bytes, {len(entries)} entries)")
    for cat in ORDER:
        if counts[cat]:
            print(f"  {counts[cat]:2}  {cat}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
