#!/usr/bin/env python3
"""Put the shop name on the owner's apron, and open the one hole in the ban on text.

2026-09-12, owner's instruction: every future film of him should carry 私享家 on
the apron for the promotional value.

The part that is easy to get wrong is not the apron, it is the negative clause.
It currently reads "no ... readable lettering of any kind anywhere in frame".
Adding an embroidered shop name without amending that puts two contradictory
facts in one prompt, and a model handed two contradictory facts does not error --
it picks one. That is precisely the fault that made four anchors for this same
film come back showing a cream sweater a few hours ago. So the ban stays, and a
single explicit hole is cut in it.

Three Chinese characters are also the hardest thing an image model renders, so
the wardrobe line pins the exact glyphs, the size, the placement and the style,
and every still that shows the apron has to be zoomed and read before it is
accepted. Garbled characters are worse for the shop than no characters at all.
"""
from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

PERSONA = Path("C:/Users/cyc39/laundry-repo/data/persona/master-owner/persona.json")

OLD_WARDROBE = (
    "He wears a plain light grey short-sleeve polo shirt with the sleeves rolled once above the elbow, "
    "under a plain dark navy bib apron, both one continuous field of plain uninterrupted fabric."
)
NEW_WARDROBE = (
    "He wears a plain light grey short-sleeve polo shirt with the sleeves rolled once above the elbow, "
    "under a dark navy bib apron. The apron carries the shop name embroidered on the chest panel: exactly "
    "the three Traditional Chinese characters 私享家, in that order, correctly and cleanly formed, in a "
    "simple upright sans-serif, in off-white thread, centred horizontally and sitting about a hand's width "
    "below the top edge of the bib, modest in size at roughly one sixth of the apron's width. The stitching "
    "lies flat on the cloth and follows its folds and its light. Nothing else is on the apron: no English, "
    "no second line, no slogan, no logo mark, no border, no pocket print. Apart from that embroidery the "
    "apron and the polo are each one continuous field of plain uninterrupted fabric."
)

OLD_NEGATIVE_HEAD = (
    "No logo, emblem, embroidery, printed graphic, watermark, camera-information bar or readable lettering "
    "of any kind anywhere in frame, and no care label, wash-symbol tag or hang tag on any garment."
)
NEW_NEGATIVE_HEAD = (
    "The ONLY text anywhere in frame is the three embroidered characters 私享家 on his apron, exactly as "
    "described above; if those characters cannot be formed correctly, leave the apron plain rather than "
    "render them wrongly. Apart from that: no logo, emblem, printed graphic, watermark, camera-information "
    "bar or readable lettering of any kind anywhere in frame, no lettering at all on the garment being "
    "cleaned, and no care label, wash-symbol tag or hang tag on any garment."
)


def main() -> int:
    persona = json.loads(io.open(PERSONA, encoding="utf-8-sig").read())

    backup = PERSONA.with_suffix(".json.bak-apron-20260912")
    if not backup.exists():
        shutil.copy2(PERSONA, backup)
        print(f"backup -> {backup.name}")

    for field, old, new in (
        ("base_prompt", OLD_WARDROBE, NEW_WARDROBE),
        ("negative_clause", OLD_NEGATIVE_HEAD, NEW_NEGATIVE_HEAD),
    ):
        text = persona[field]
        if text.count(old) != 1:
            print(f"ABORT: {field} matched {text.count(old)} times, expected 1")
            return 1
        persona[field] = text.replace(old, new)
        print(f"  ok {field}")

    # The ban and the exception have to agree, or this patch has reintroduced the
    # very contradiction it exists to avoid.
    neg = persona["negative_clause"]
    if "readable lettering of any kind anywhere in frame" in neg and "The ONLY text anywhere in frame" not in neg:
        print("ABORT: blanket text ban survived without the carve-out")
        return 1
    if "私享家" not in persona["base_prompt"] or "私享家" not in neg:
        print("ABORT: the shop name is missing from one of the two places that must agree")
        return 1

    persona.setdefault("revisions", []).append({
        "date": "2026-09-12",
        "change": "the apron now carries 私享家 embroidered on the chest panel, and the blanket ban on text in frame was narrowed to allow exactly that",
        "reason": "owner's instruction: put the shop name on his apron in every future film for the promotional value",
        "likeness_touched": False,
        "gate": "every still showing the apron must be zoomed and the three characters read before it is accepted; wrong or garbled glyphs are a reject, and the prompt tells the model to leave the apron plain rather than guess",
    })

    with io.open(PERSONA, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(persona, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"wrote {PERSONA}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
