# -*- coding: utf-8 -*-
"""Finish a model-generated social poster: splice to 4:5 and stamp the QR.

The image model composes at 2:3 no matter how firmly 4:5 is asked for. The
posters it makes for us keep a wide band of pure gradient between the type
block and the hero, so the honest fix is to remove height from that empty
band - a vertical-gradient splice is invisible when the two cut edges are
blended across a feather zone - rather than crop away the headline or the
footer.

QR is stamped last because no image model renders a scannable code. It goes
in the bottom-right corner the prompt reserved, linking the LINE redirect
with its own source code so GA4 attributes poster scans separately.

Run:
  "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe" \
      scripts/finish-social-poster.py <src.png> <out.png> [splice_center_frac]
"""

import os
import sys

import qrcode
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

LINE_URL = "https://sixiangjialaundry.com/go/line.html?source=post-poster"
W, H = 1080, 1350
FEATHER = 60  # px blended across the splice so the gradient stays continuous


def splice_to_ratio(img: Image.Image, center_frac: float) -> Image.Image:
    """Remove a horizontal band centered at center_frac of the height."""
    w, h = img.size
    target_h = int(round(w * H / W))
    excess = h - target_h
    if excess <= 0:
        return img.resize((W, H), Image.LANCZOS)
    top_end = int(h * center_frac) - excess // 2
    bot_start = top_end + excess
    assert top_end > FEATHER and bot_start < h - FEATHER, "splice band out of range"
    top = img.crop((0, 0, w, top_end))
    bottom = img.crop((0, bot_start, w, h))
    out = Image.new("RGB", (w, target_h))
    out.paste(top, (0, 0))
    out.paste(bottom, (0, top_end))
    # Feather: cross-blend a strip straddling the seam so the vertical
    # gradient has no visible step.
    for i in range(FEATHER):
        alpha = i / FEATHER
        ya = top_end - FEATHER // 2 + i
        row_top = img.crop((0, top_end - FEATHER // 2 + i, w, top_end - FEATHER // 2 + i + 1))
        row_bot = img.crop((0, bot_start - FEATHER // 2 + i, w, bot_start - FEATHER // 2 + i + 1))
        out.paste(Image.blend(row_top, row_bot, alpha), (0, ya))
    return out.resize((W, H), Image.LANCZOS)


def stamp_qr(img: Image.Image) -> Image.Image:
    qr = qrcode.QRCode(border=1, box_size=10)
    qr.add_data(LINE_URL)
    qr.make(fit=True)
    q = qr.make_image(fill_color="#1a221e", back_color="white").convert("RGB")
    side = 150
    q = q.resize((side, side), Image.NEAREST)
    pad = 40
    img.paste(q, (W - side - pad, H - side - pad))
    return img


def main():
    src, out = sys.argv[1], sys.argv[2]
    frac = float(sys.argv[3]) if len(sys.argv) > 3 else 0.30
    img = Image.open(src).convert("RGB")
    img = splice_to_ratio(img, frac)
    img = stamp_qr(img)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print("finished:", out, img.size)


if __name__ == "__main__":
    main()
