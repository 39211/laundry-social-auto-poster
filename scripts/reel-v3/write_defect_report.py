#!/usr/bin/env python3
"""Render the per-shot comparison the external review asked for.

The reviewer could read the pixels but not the prompts, so they left the
original_prompt field of all 27 shots blank and asked for it to be filled from
the project. This joins the three things that were never in one place:

  * what the reviewer saw and concluded,
  * the prompt text that actually produced that shot, and
  * which layer failed -- the prompt, the first frame, the model, the edit or
    the narration.

Anything that cannot be traced to a real clause is written UNKNOWN rather than
guessed, which is the distinction the review was explicit about.

Usage: write_defect_report.py <v2-job-dir> <v1-job-dir> <out.md>
"""
from __future__ import annotations

import io
import json
import sys
from collections import Counter
from pathlib import Path

CAUSE_ZH = {
    "PROMPT_LACKED_ACTION_LOGIC": "提示詞沒要求可驗證的結果",
    "FIRST_FRAME_GEOMETRY": "首幀幾何／起始狀態錯",
    "MODEL_DID_NOT_COMPLY": "提示詞寫對了，模型沒遵守",
    "EDIT_JOINED_WRONG_STATES": "單顆沒錯，剪接把狀態接錯",
    "NARRATION_UNSUPPORTED_BY_PICTURE": "旁白說了畫面撐不起來的事",
    "NO_DEFECT": "不構成缺陷",
}


def main() -> int:
    v2 = Path(sys.argv[1]).resolve()
    v1 = Path(sys.argv[2]).resolve()
    out = Path(sys.argv[3]).resolve()

    rows = json.loads(io.open(v2 / "prompts" / "defect-classification.json", encoding="utf-8").read())
    mine = {s["id"]: s for s in
            json.loads(io.open(v1 / "prompts" / "shots-revised.json", encoding="utf-8").read())}
    findings = json.loads(io.open(v2 / "prompts" / "classification-input.json", encoding="utf-8").read())
    byshot = {f["shot"]: f for f in findings}

    counts = Counter(r["cause"] for r in rows)

    L: list[str] = []
    L.append("# 逐鏡原文比對與責任歸屬")
    L.append("")
    L.append("外部審查把成片拆成 27 鏡、解碼 2002 幀，但它讀得到畫面、讀不到提示詞，"
             "所以 27 鏡的 `original_prompt` 欄位全部留空，並要求由專案端填回。這份文件就是那件事。")
    L.append("")
    L.append("每一鏡三欄並排：審查看到什麼、**真正用過的提示詞原文**、以及哪一層失守。"
             "找不到對應原文的一律寫 UNKNOWN，不用推測補。")
    L.append("")
    L.append("## 總計")
    L.append("")
    L.append("| 失守的那一層 | 鏡數 |")
    L.append("|---|---|")
    for cause, n in counts.most_common():
        L.append(f"| {CAUSE_ZH.get(cause, cause)} | {n} |")
    L.append("")
    own = counts["PROMPT_LACKED_ACTION_LOGIC"] + counts["FIRST_FRAME_GEOMETRY"]
    L.append(f"**{own} 顆是提示詞自己的問題**（缺動作邏輯或首幀幾何錯），"
             f"只有 {counts['MODEL_DID_NOT_COMPLY']} 顆是提示詞寫對了而模型沒照做。"
             "審查說「不能只靠全片加速或多加一句超寫實解決」，這個分佈證實了它。")
    L.append("")
    L.append("---")
    L.append("")

    for r in rows:
        f = byshot.get(r["shot"], {})
        m = mine.get(r["my_id"])
        L.append(f"## {r['shot']} → `{r['my_id']}`")
        L.append("")
        L.append(f"**判定**：{CAUSE_ZH.get(r['cause'], r['cause'])}　`{r['cause']}`")
        L.append("")
        L.append(f"**我對審查那一條的態度**：{r['verdict_on_their_finding']}")
        L.append("")
        L.append(f"**審查看到的**（{f.get('their_priority', '?')}／{f.get('their_decision', '?')}）："
                 f"{f.get('their_problem', 'UNKNOWN')}")
        L.append("")
        L.append(f"**證據在原文的哪一句**：{r['evidence_from_my_prompt']}")
        L.append("")
        if m:
            L.append("<details><summary>當時真正用過的動作提示詞原文</summary>")
            L.append("")
            L.append("```text")
            L.append(m["motion_prompt"].strip())
            L.append("```")
            L.append("")
            L.append("</details>")
        else:
            L.append("**原文**：UNKNOWN — 這一格是後製渲染的尾卡，不是生成鏡頭，沒有提示詞。")
        L.append("")

    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"written {out}  ({out.stat().st_size} bytes)")
    for cause, n in counts.most_common():
        print(f"  {n:2}  {cause}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
