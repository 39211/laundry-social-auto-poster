#!/usr/bin/env python3
"""Contact-sheet the LAST frame of every cut segment.

The first frame of each segment is the still that was already approved by eye, so
a sheet of first frames proves nothing about the video model. Everything the model
invents appears later in the clip, and the last frame that survives the cut is the
one the viewer actually reaches. That is where the brand marks appeared on
2026-09-12: a clean first frame went in and a swoosh grew on the quarter halfway
through.

So this pulls the final frame of each BUILT segment -- after trimming, so a frame
the edit throws away cannot raise a false alarm -- and lays them out in cut order
next to their ids.

Usage: last_frame_sheet.py <job-dir> <out.png> [--cols 6] [--width 320]
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
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

    frames = []
    with tempfile.TemporaryDirectory() as td:
        for s in cut["shots"]:
            seg = job / "build" / f"{s['id']}.mp4"
            if not seg.exists():
                continue
            dur = float(subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(seg)], capture_output=True, text=True).stdout.strip())
            # Step back a couple of frames: seeking to the exact end can land past
            # the last packet and return nothing at all.
            p = Path(td) / f"{s['id']}.png"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, dur - 0.07):.3f}",
                 "-i", str(seg), "-frames:v", "1", str(p), "-y"],
                capture_output=True, text=True)
            if p.exists():
                frames.append((s["id"], dur, Image.open(p).convert("RGB")))

        if not frames:
            print("no built segments found -- build the master first")
            return 1

        ch = round(cw * frames[0][2].height / frames[0][2].width)
        rows = (len(frames) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cw, rows * (ch + LABEL_H)), (24, 24, 24))
        d = ImageDraw.Draw(sheet)
        try:
            font = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 14)
        except OSError:
            font = ImageFont.load_default()
        for i, (sid, dur, im) in enumerate(frames):
            x, y = (i % cols) * cw, (i // cols) * (ch + LABEL_H)
            sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
            d.text((x + 4, y + ch + 4), f"{sid}  end {dur:.2f}s",
                   font=font, fill=(235, 235, 235))
        sheet.save(out)

    print(f"{len(frames)} last frame(s) -> {out}  ({sheet.width}x{sheet.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
