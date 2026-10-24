#!/usr/bin/env python3
"""Install candidate F as the approved character sheet.

2026-09-12. The owner reviewed six candidates rebuilt directly from his own
photographs and chose F.

What was wrong before is worth writing down, because the obvious diagnosis was
wrong: the persona's TEXT already described him accurately -- "a wide round face
clearly wider than it is long, widest low at the full soft cheeks", "a short
broad nose with a low flat bridge, rounded fleshy tip and wide nostril wings".
The drift was in the reference IMAGE. The old sheet was itself an AI picture
that had quietly idealised him, and anchor.rule said every later shot must use
that sheet and never the original photographs again -- so every image was a copy
of a copy, and each generation pulled a little further toward a handsome
stranger. The owner's words were "只有下巴像我".

So the rule changes too: a character sheet is rebuilt from the photographs, not
from the sheet it replaces.
"""
from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

BASE = Path("C:/Users/cyc39/laundry-repo/data/persona/master-owner")
PERSONA = BASE / "persona.json"
CHOSEN = BASE / "candidates-20260912" / "cand-F.png"
NEW_SHEET = BASE / "anchor" / "master-sheet-approved-20260912F.png"


def main() -> int:
    if not CHOSEN.exists():
        print(f"ABORT: {CHOSEN} missing")
        return 1

    persona = json.loads(io.open(PERSONA, encoding="utf-8-sig").read())
    old = persona["anchor"].get("character_sheet")

    shutil.copy2(CHOSEN, NEW_SHEET)
    rel = NEW_SHEET.relative_to(Path("C:/Users/cyc39/laundry-repo")).as_posix()
    persona["anchor"]["character_sheet"] = rel
    persona["anchor"]["superseded"] = old
    persona["anchor"]["rule"] = (
        "所有分鏡一律以 character_sheet 當 ImagePaths 參考圖。"
        "但 character_sheet 本身必須從 reference_photos 的真實照片重建，"
        "絕不可以從上一張定妝照再生——2026-09-12 就是因為一路複製舊定妝照，"
        "人物愈生愈漂亮、愈不像本人（老闆原話：只有下巴像我）。"
    )
    persona["anchor"]["approved_at"] = "2026-09-12"
    persona["anchor"]["chosen_from"] = "candidates-20260912/CHOOSE-faces.png (A-F)，老闆選 F"

    persona.setdefault("revisions", []).append({
        "date": "2026-09-12",
        "change": f"character_sheet 換成 {NEW_SHEET.name}（六選一，老闆選 F）",
        "reason": "舊定妝照是被美化過的 AI 圖，而 anchor.rule 規定之後只能照它生，"
                  "所以每張圖都是複製品的複製品，臉愈來愈不像本人。新定妝照直接用他本人的四張照片重建。",
        "likeness_touched": True,
        "note": "base_prompt 的五官文字沒有動——它本來就寫對了（寬大於長、最寬處在低處、鼻樑低鼻翼寬、眼睛細）。"
                "壞的是參考圖不是文字。F 的鬍型與正臉照一致：臉頰剃淨、稀疏鬍子過嘴角、下巴一小撮，不連過兩頰。",
    })

    with io.open(PERSONA, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(persona, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"character_sheet: {old}")
    print(f"             -> {rel}")
    print(f"superseded sheet kept in place, not deleted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
