#!/usr/bin/env python3
"""Render the v3 acceptance report from recorded evidence, not from claims.

The second external review's central charge on 2026-09-14 was that the previous
round reported "14 prompts, 0 defects" as if that meant the pictures were right.
It did not: a prompt gate reads text. So this renderer refuses to print a verdict
that has nothing attached to it.

The rule is enforced here, not remembered:

  * status "fixed" requires at least one evidence entry whose kind is "frames"
    or "measure" -- something read off the rendered film. An entry of kind
    "prompt" alone is not enough and raises.
  * status "open" and "unverified" need no evidence and are printed as-is. They
    are the honest answer when nothing was checked.
  * every measurement is printed as the command that produced it plus its
    verbatim output, so a reader can re-run it.

Usage: write_v3_report.py <evidence.json> <out.md>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

STATUS_ZH = {
    "fixed": "已修正（有畫面證據）",
    "improved": "有改善但未達標",
    "open": "仍未修",
    "unverified": "尚未驗收",
    "rejected": "本輪退件重做",
}
STATUS_MARK = {
    "fixed": "OK", "improved": "~", "open": "X", "unverified": "?", "rejected": "X",
}
FROM_FILM = {"frames", "measure"}


def check(ev: dict) -> None:
    """Refuse a verdict that rests on nothing read off the film."""
    bad = []
    for item in ev["items"]:
        if item["status"] in ("fixed", "improved"):
            kinds = {e["kind"] for e in item.get("evidence", [])}
            if not (kinds & FROM_FILM):
                bad.append(f"{item['id']}: status {item['status']!r} with no frames or measurement "
                           f"(only {sorted(kinds) or 'nothing'})")
    if bad:
        print("REFUSING to write the report:")
        for b in bad:
            print("  " + b)
        raise SystemExit(1)


def render(ev: dict) -> str:
    L: list[str] = []
    f = ev["film"]
    L.append(f"# {f['title']}")
    L.append("")
    L.append(f"{f['date']}　`{f['dir']}`")
    L.append("")
    L.append("## 先講白話")
    L.append("")
    for line in ev["plain_language"]:
        L.append(f"- {line}")
    L.append("")
    L.append("---")
    L.append("")

    L.append("## 一、外部複審點名的三個反例：那幾秒現在實際變成什麼畫面")
    L.append("")
    L.append("複審的原話是「不要再以『14 顆提示詞零缺陷』作結，要以『原本出錯的這幾秒，"
             "現在實際變成什麼畫面』作結」。所以下面每一條都先寫 v2 那幾秒到底是什麼畫面，"
             "再寫 v3 同一段現在是什麼畫面，最後附上判斷所根據的東西。")
    L.append("")

    for item in ev["items"]:
        if not item.get("counterexample"):
            continue
        L.append(f"### {STATUS_MARK[item['status']]}　{item['title']}")
        L.append("")
        L.append(f"**判定：{STATUS_ZH[item['status']]}**")
        L.append("")
        L.append(f"| | |")
        L.append(f"|---|---|")
        L.append(f"| 複審指控 | {item['charge']} |")
        L.append(f"| v2 那幾秒 | `{item['v2_window']}`　{item['v2_picture']} |")
        L.append(f"| v3 同一段 | `{item['v3_window']}`　{item['v3_picture']} |")
        L.append(f"| 怎麼改的 | {item['how']} |")
        L.append("")
        for e in item.get("evidence", []):
            L.append(f"**證據（{e['kind']}）**　{e['what']}")
            L.append("")
            if e.get("command"):
                L.append("```")
                L.append(e["command"])
                if e.get("output"):
                    L.append("")
                    L.append(e["output"].rstrip())
                L.append("```")
                L.append("")
            elif e.get("file"):
                L.append(f"　檔案：`{e['file']}`")
                L.append("")
        if item.get("caveat"):
            L.append(f"> 但是：{item['caveat']}")
            L.append("")

    L.append("---")
    L.append("")
    L.append("## 二、這一輪我自己看出來、複審沒點到的問題")
    L.append("")
    for item in ev["items"]:
        if item.get("counterexample"):
            continue
        L.append(f"### {STATUS_MARK[item['status']]}　{item['title']}")
        L.append("")
        L.append(f"**判定：{STATUS_ZH[item['status']]}**")
        L.append("")
        L.append(item["detail"])
        L.append("")
        for e in item.get("evidence", []):
            if e.get("command"):
                L.append("```")
                L.append(e["command"])
                if e.get("output"):
                    L.append("")
                    L.append(e["output"].rstrip())
                L.append("```")
                L.append("")
            elif e.get("file"):
                L.append(f"　檔案：`{e['file']}`")
                L.append("")

    L.append("---")
    L.append("")
    L.append("## 三、尚未驗收的項目（不得當成已完成）")
    L.append("")
    for u in ev["unverified"]:
        L.append(f"- **{u['what']}** — {u['why']}")
    L.append("")

    if ev.get("failed_tools"):
        L.append("---")
        L.append("")
        L.append("## 四、這輪做壞、已經丟掉的東西")
        L.append("")
        for t in ev["failed_tools"]:
            L.append(f"**{t['name']}**")
            L.append("")
            L.append(t["why"])
            L.append("")

    L.append("---")
    L.append("")
    L.append("## 五、下一輪的順序")
    L.append("")
    for i, n in enumerate(ev["next"], 1):
        L.append(f"{i}. {n}")
    L.append("")
    return "\n".join(L) + "\n"


def main() -> int:
    ev = json.loads(io.open(sys.argv[1], encoding="utf-8").read())
    check(ev)
    out = Path(sys.argv[2]).resolve()
    out.write_text(render(ev), encoding="utf-8")

    counts: dict[str, int] = {}
    for item in ev["items"]:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    print(f"written {out}  ({out.stat().st_size} bytes)")
    for k in ("fixed", "improved", "open", "rejected", "unverified"):
        if counts.get(k):
            print(f"  {counts[k]:2}  {k}")
    print(f"  {len(ev['unverified']):2}  listed as not yet accepted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
