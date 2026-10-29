#!/usr/bin/env python3
"""First, middle and last frame of every shot in a finished master, in one sheet.

A shot can start well and go wrong in its last half second -- a machine stops, a
tread pattern melts, a wordmark smears. The first frame is the approved still and
proves nothing about the tail; the tail is what the viewer carries into the cut.
So every column here is one shot, top to bottom: its first, middle and last frame
as they actually appear in the master.

Usage: boundary_sheet.py <job-dir-with-timeline.json> <out.png> [--width 200]
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2])
    cw = int(sys.argv[sys.argv.index("--width") + 1]) if "--width" in sys.argv else 200
    tl = json.loads(io.open(job / "timeline.json", encoding="utf-8").read())
    master = job / tl["master"]
    shots = tl["shots"]
    font = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 13)
    ch = round(cw * 16 / 9)
    LAB = 18
    sheet = Image.new("RGB", (cw * len(shots), 3 * (ch + LAB)), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    with tempfile.TemporaryDirectory() as td:
        for c, s in enumerate(shots):
            t0, dur = s["t0"], s["seconds"]
            # Inset by a frame and a half at each end so a seek never lands in the
            # neighbouring shot.
            for r, t in enumerate((t0 + 0.05, t0 + dur / 2, t0 + dur - 0.05)):
                p = Path(td) / f"{c}-{r}.png"
                subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(master),
                                "-frames:v", "1", str(p), "-y"], capture_output=True)
                if not p.exists():
                    continue
                x, y = c * cw, r * (ch + LAB)
                d.text((x + 3, y + 2), f"{s['id'][:12]} {t:.2f}s", font=font, fill=(230, 230, 230))
                sheet.paste(Image.open(p).convert("RGB").resize((cw, ch), Image.LANCZOS), (x, y + LAB))
    sheet.save(out)
    print(f"{len(shots)} shots x 3 frames -> {out} ({sheet.width}x{sheet.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
