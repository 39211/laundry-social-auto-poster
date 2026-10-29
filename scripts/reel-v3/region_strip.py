#!/usr/bin/env python3
"""Tile one region of a clip across time, so motion can be judged by eye.

region_motion.py gives a number per region, and a number cannot answer the
question the owner actually asked -- "is the brush turning?" -- because a shoe
passing through the brush's bounding box raises that box's difference just as
much as a spinning drum would.

So this crops the same box out of N frames and lays them side by side with their
timestamps. A spinning bristle drum shows its highlights and bristle clumps
marching around the circumference frame to frame. A frozen prop shows the same
bristles in the same places while something else moves past.

Usage:
  region_strip.py <clip.mp4> <out.png> --box 0.30,0.00,1.00,0.30 --n 8
  region_strip.py <clip.mp4> <out.png> --box ... --from 0 --to 1.03
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

LABEL_H = 20


def flag(name, default, cast=float):
    return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def main() -> int:
    clip, out = Path(sys.argv[1]), Path(sys.argv[2])
    box = tuple(float(v) for v in flag("--box", "0,0,1,1", str).split(","))
    n = flag("--n", 8, int)
    t0 = flag("--from", 0.0)
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
         "csv=p=0", str(clip)], capture_output=True, text=True).stdout.strip())
    t1 = flag("--to", dur)

    times = [t0 + (t1 - t0) * i / max(1, n - 1) for i in range(n)]
    crops = []
    with tempfile.TemporaryDirectory() as td:
        for i, t in enumerate(times):
            p = Path(td) / f"{i}.png"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, min(t, dur - 0.05)):.3f}",
                 "-i", str(clip), "-frames:v", "1", str(p), "-y"],
                capture_output=True, text=True)
            if not p.exists():
                continue
            im = Image.open(p).convert("RGB")
            W, H = im.size
            crops.append((t, im.crop((int(box[0] * W), int(box[1] * H),
                                     int(box[2] * W), int(box[3] * H)))))

    if not crops:
        print("no frames extracted")
        return 1

    cw = max(200, min(320, 1800 // len(crops)))
    ch = round(cw * crops[0][1].height / crops[0][1].width)
    sheet = Image.new("RGB", (cw * len(crops), ch + LABEL_H), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    for i, (t, im) in enumerate(crops):
        sheet.paste(im.resize((cw, ch), Image.LANCZOS), (i * cw, 0))
        d.text((i * cw + 4, ch + 3), f"{t:.2f}s", font=font, fill=(240, 240, 240))
    sheet.save(out)
    print(f"{len(crops)} crops from {t0:.2f}-{t1:.2f}s of {clip.name} -> {out} "
          f"({sheet.width}x{sheet.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
