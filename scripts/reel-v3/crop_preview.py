#!/usr/bin/env python3
"""Preview proposed crops for every shot of an edit, one early and one late frame each.

Tightening a crop is cheap to try and easy to get wrong: a zoom that frames the
contact point at the start of a shot can lose it by the end, when the hand has
moved. So each shot is shown at the first and the last source frame it will use,
cropped exactly as build_fluid_cut.py would crop it.

Overrides are given as ID=ZOOM@CX,CY and leave every other shot as the edit has it.

Usage: crop_preview.py <edit.json> <out.png> [06-palm=2.0@0.40,0.45 ...]
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shutter_retime import probe  # noqa: E402
from build_fluid_cut import ROOT, crop_fractions  # noqa: E402


def main() -> int:
    edit = json.loads(io.open(sys.argv[1], encoding="utf-8").read())
    out = Path(sys.argv[2])
    overrides = {}
    for o in sys.argv[3:]:
        sid, rest = o.split("=")
        z, c = rest.split("@")
        overrides[sid] = (float(z), tuple(float(v) for v in c.split(",")))

    src_dir = ROOT / edit["source_dir"]
    cw, ch, LAB = 160, 284, 30
    shots = [s for s in edit["shots"] if not s.get("still")]
    COLS = 12  # wrap into bands so a 26-shot edit stays viewable
    bands = (len(shots) + COLS - 1) // COLS
    sheet = Image.new("RGB", (cw * min(COLS, len(shots)), bands * 2 * (ch + LAB)), (16, 16, 16))
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 12)
    with tempfile.TemporaryDirectory() as td:
        for c, s in enumerate(shots):
            if s.get("still"):
                continue
            zoom, center = overrides.get(s["id"], (s["zoom"], tuple(s["center"])))
            src = src_dir / s["source"]
            W, H, fps = probe(src)
            x0, y0, x1, y1 = (float(v) for v in
                              crop_fractions(W, H, zoom, center, 1080, 1920).split(","))
            last = s["start"] + (s["frames"] - 1) * s["step"] + s["blend"] - 1
            for r, fr in enumerate((s["start"], last)):
                p = Path(td) / f"{c}-{r}.png"
                subprocess.run(["ffmpeg", "-v", "error", "-i", str(src),
                                "-vf", f"select=eq(n\\,{fr})", "-frames:v", "1", str(p), "-y"],
                               capture_output=True)
                if not p.exists():
                    continue
                im = Image.open(p).convert("RGB")
                im = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
                x, y = (c % COLS) * cw, ((c // COLS) * 2 + r) * (ch + LAB)
                tag = "*" if s["id"] in overrides else " "
                d.text((x + 2, y + 2), f"{tag}{s['id'][:11]}", font=font, fill=(255, 210, 140))
                d.text((x + 2, y + 15), f" z{zoom} f{fr}", font=font, fill=(200, 200, 200))
                sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y + LAB))
    sheet.save(out)
    print(f"{len(shots)} shots -> {out}; overridden: {sorted(overrides)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
