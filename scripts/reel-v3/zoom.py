#!/usr/bin/env python3
"""Crop a fraction of an image and blow it up, so I can actually look at detail.

Written because "the anchor is correct" kept being asserted from a 941x1672
thumbnail in which nine midsole openings and eight are the same picture. The
countable features of the On Cloudtilt are the whole point of the canon, and
they are not countable until the row fills the screen.

Usage: zoom.py <img> <out.png> <x0> <y0> <x1> <y1> [scale]
Coordinates are fractions of width/height, 0..1.
"""
from __future__ import annotations

import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = (float(v) for v in sys.argv[3:7])
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0

im = Image.open(src).convert("RGB")
W, H = im.size
box = (int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))
crop = im.crop(box)
if not scale:
    scale = min(1400 / crop.width, 1400 / crop.height)
crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
crop.save(dst)
print(f"{src} {W}x{H} -> box={box} -> {crop.width}x{crop.height} {dst}")
