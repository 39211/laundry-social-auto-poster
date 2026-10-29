#!/usr/bin/env python3
"""Lay the job's stills out as one labelled sheet, in cut order.

Looking at twenty-three frames one at a time is how continuity breaks get missed:
the shoe changing between shot 7 and shot 11 is invisible unless 7 and 11 are on
screen together. On the last film the object changed in four places and each
frame on its own looked fine.

Labels are burned in so a frame can be named when something is wrong with it.

Usage: contact_sheet.py <job-dir> <out.png> [--cols 6] [--width 320]
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

LABEL_H = 22


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2])

    def flag(name, default):
        return int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default

    cols, cw = flag("--cols", 6), flag("--width", 320)
    cut = json.loads(io.open(job / "cut-list.json", encoding="utf-8").read())

    have = [s for s in cut["shots"] if (job / s["still"]).exists()]
    missing = [s["id"] for s in cut["shots"] if not (job / s["still"]).exists()]
    if not have:
        print("no stills on disk yet")
        return 1

    probe = Image.open(job / have[0]["still"])
    ch = round(cw * probe.height / probe.width)
    rows = (len(have) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * (ch + LABEL_H)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 14)
    except OSError:
        font = ImageFont.load_default()

    for i, s in enumerate(have):
        x, y = (i % cols) * cw, (i // cols) * (ch + LABEL_H)
        sheet.paste(Image.open(job / s["still"]).convert("RGB").resize((cw, ch), Image.LANCZOS),
                    (x, y))
        d.text((x + 4, y + ch + 4),
               f"{s['id']}  {s['t0']:.2f}  {s['seconds']:.2f}s", font=font, fill=(235, 235, 235))

    sheet.save(out)
    print(f"{len(have)} still(s) -> {out}  ({sheet.width}x{sheet.height})")
    if missing:
        print(f"not yet generated ({len(missing)}): {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
