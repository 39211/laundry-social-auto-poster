# -*- coding: utf-8 -*-
"""Before/after comparison image with a circular zoom-detail inset.

Studied from a competitor's Facebook posts at the owner's request (2026-08-23),
proven on a hand-picked crop of the leather-bag-corner pair, then generalised
here so it works on any before/after reference pair without hand-tuning
coordinates per case: the detail region is found automatically from where the
two photos actually differ, using PIL's own difference/bbox (no numpy/scipy
installed on this machine, and this did not need them).

The before/after pair must already be the same object, same angle, same
scale, same light. This is NOT guaranteed for every pair under
data/reference-photos/ -- 2026-08-23 testing found denim-knee-fade is a
before/after shot at two different distances (before: flat on the counter;
after: held up close), and running this on that pair drew a circle on the
same pixel coordinates in each half while pointing at two different real-
world spots. That result looks exactly as finished as a correct one and is
worse than no image, because it reads as "same spot, fixed" when it is not.

This script cannot reliably detect that failure on its own (no numpy/scipy
on this machine to do real alignment scoring, and a wrong heuristic here
would just be a second thing to not trust). Before using any output for a
real post: open both halves side by side and confirm the circle in AFTER is
really the same physical spot as the circle in BEFORE, at roughly the same
scale. leather-bag-corner (2026-08-23) passed this check; denim-knee-fade
did not. Check every new pair the same way -- passing once elsewhere is not
evidence for a different concept_id.

Run (from the repo root; `python` on PATH does NOT have Pillow):
  "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe" \
      scripts/build-before-after-inset.py <object_type> <concept_id>

Example:
  ...  scripts/build-before-after-inset.py leather-bag leather-bag-corner
"""

import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

BOLD = "C:/Windows/Fonts/msjhbd.ttc"
INK = (20, 24, 22)
GOLD = (176, 138, 58)
WHITE = (250, 248, 244)

# A diff bbox smaller than this fraction of the shorter side is probably noise
# (JPEG blocking, a shadow that moved slightly) rather than the real repair
# spot, so the inset is not made distractingly tiny by it.
MIN_BOX_FRACTION = 0.22
# A diff bbox larger than this fraction is probably global exposure/white-
# balance drift between the two shots rather than a localised change, and
# would defeat the point of a detail callout.
MAX_BOX_FRACTION = 0.75


def find_detail_box(before: Image.Image, after: Image.Image) -> tuple[int, int, int, int]:
    diff = ImageChops.difference(before.convert("RGB"), after.convert("RGB")).convert("L")
    # Blur first so single-pixel sensor/JPEG noise does not fragment the real
    # difference region into something getbbox() cannot see as one blob.
    diff = diff.filter(ImageFilter.GaussianBlur(radius=6))
    short_side = min(before.width, before.height)

    # Start strict and relax the threshold until something bbox-able survives;
    # a fixed threshold either missed subtle recolouring or, on a noisier
    # photo pair, bounded almost the whole frame.
    box = None
    for threshold in (60, 40, 25, 15):
        mask = diff.point(lambda p, t=threshold: 255 if p > t else 0)
        candidate = mask.getbbox()
        if not candidate:
            continue
        cw, ch = candidate[2] - candidate[0], candidate[3] - candidate[1]
        if min(cw, ch) < short_side * MIN_BOX_FRACTION:
            continue
        if max(cw, ch) > short_side * MAX_BOX_FRACTION:
            continue
        box = candidate
        break

    if box is None:
        # Nothing passed both bounds -- fall back to the image centre rather
        # than fail the whole build over one hard pair.
        cx, cy = before.width // 2, before.height // 2
        half = int(short_side * 0.3)
        return (cx - half, cy - half, cx + half, cy + half)

    # Pad and square the box around its centre, clamped to the frame.
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    half = int(max(box[2] - box[0], box[3] - box[1]) * 0.6)
    half = max(half, int(short_side * MIN_BOX_FRACTION / 2))
    left, top = cx - half, cy - half
    right, bottom = cx + half, cy + half
    dx = max(0 - left, 0) - max(right - before.width, 0)
    dy = max(0 - top, 0) - max(bottom - before.height, 0)
    left, right = max(0, left + dx), min(before.width, right + dx)
    top, bottom = max(0, top + dy), min(before.height, bottom + dy)
    side = min(right - left, bottom - top)
    return (left, top, left + side, top + side)


def circular_crop(img: Image.Image, box, out_size: int) -> Image.Image:
    crop = img.crop(box).resize((out_size, out_size), Image.LANCZOS)
    mask = Image.new("L", (out_size, out_size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, out_size, out_size), fill=255)
    ring = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    ring.paste(crop, (0, 0), mask)
    return ring


def labelled_half(photo: Image.Image, label: str, detail_box) -> Image.Image:
    inset_size = int(photo.width * 0.42)
    inset = circular_crop(photo, detail_box, inset_size)
    ring_w = max(4, inset_size // 45)
    ring = Image.new("RGBA", (inset_size + ring_w * 2, inset_size + ring_w * 2), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse((0, 0, ring.width, ring.height), fill=(255, 255, 255, 255))
    ring.paste(inset, (ring_w, ring_w), inset)

    canvas = photo.convert("RGBA")
    pos = (canvas.width - ring.width - 36, canvas.height - ring.height - 36)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        (pos[0] + 6, pos[1] + 10, pos[0] + ring.width + 6, pos[1] + ring.height + 10),
        fill=(0, 0, 0, 90)
    )
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(ring, pos, ring)

    d = ImageDraw.Draw(canvas)
    f = ImageFont.truetype(BOLD, 64)
    tx, ty = 34, 30
    for dx, dy in ((-2, -2), (2, -2), (-2, 2), (2, 2)):
        d.text((tx + dx, ty + dy), label, font=f, fill=(0, 0, 0, 160))
    d.text((tx, ty), label, font=f, fill=WHITE)
    return canvas.convert("RGB")


def build(object_type: str, concept_id: str) -> str:
    ref_dir = os.path.join("data", "reference-photos", object_type)
    before_path = os.path.join(ref_dir, f"{concept_id}-before.png")
    after_path = os.path.join(ref_dir, f"{concept_id}-after.png")
    for p in (before_path, after_path):
        if not os.path.exists(p):
            raise SystemExit(f"missing {p}")

    before_img = Image.open(before_path).convert("RGB")
    after_img = Image.open(after_path).convert("RGB")
    if after_img.size != before_img.size:
        after_img = after_img.resize(before_img.size, Image.LANCZOS)

    detail_box = find_detail_box(before_img, after_img)

    before = labelled_half(before_img, "BEFORE", detail_box)
    after = labelled_half(after_img, "AFTER", detail_box)

    gap = 6
    combo = Image.new("RGB", (before.width * 2 + gap, before.height), WHITE)
    combo.paste(before, (0, 0)); combo.paste(after, (before.width + gap, 0))

    band_h = 90
    out = Image.new("RGB", (combo.width, combo.height + band_h), INK)
    out.paste(combo, (0, 0))
    d = ImageDraw.Draw(out)
    f = ImageFont.truetype(BOLD, 44)
    brand = "私享家洗衣店"
    bw = d.textlength(brand, font=f)
    d.text(((out.width - bw) / 2, combo.height + (band_h - 44) / 2 - 6), brand, font=f, fill=GOLD)

    out_dir = "output/print/before-after"
    os.makedirs(out_dir, exist_ok=True)
    path = f"{out_dir}/{concept_id}.png"
    out.save(path, dpi=(300, 300))
    print(f"  {concept_id:24} -> {path}  (detail box {detail_box})")
    print("  CHECK BEFORE USING: open the image and confirm the AFTER circle is the same")
    print("  physical spot as the BEFORE circle, at roughly the same scale. This is not")
    print("  verified automatically -- denim-knee-fade drew two different spots and still")
    print("  printed a clean success line just like this one.")
    return path


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build-before-after-inset.py <object_type> <concept_id>")
    build(sys.argv[1], sys.argv[2])
