#!/usr/bin/env python3
"""Check that a dirty/clean canon pair is the SAME object, moved nowhere, cleaned.

Three things went wrong on the last film and all three are measurable, so none of
them should ever again be settled by looking at a thumbnail and saying it looks
fine:

  REGISTRATION  the two plates must be the same photograph. Measured as the IoU of
                the two subject silhouettes plus the drift of their bounding boxes.
                A before/after that does not register reads as two different shoes
                no matter how alike they are.

  TOE RUBBER    the charcoal toe tip is part of the shoe, not dirt. On the last
                film it washed off in two shots. Measured as the darkness of the
                darkest patch inside the toe region: if cleaning lightened it, the
                clean plate's toe is no longer charcoal and the pair is rejected.

  ACTUALLY CLEAN  the clean plate must be cleaner because the surfaces are clean,
                not because the exposure went up. Measured as the change in the
                subject's median lightness AND the change in the backdrop's: if
                the backdrop moved with it, that is an exposure change.

The subject mask is found by LOCAL CONTRAST, not by colour distance from the
backdrop. Colour distance was tried first and was useless: the sweep carries a
lighting falloff, so thresholding against a corner median selected half the
backdrop and returned a full-frame bounding box and a meaningless 0.887 IoU
between two plates that are in fact registered. The shoes and the sweep are close
in colour but not in texture -- mesh, holes and edges have local range, a paper
sweep has almost none -- so the mask keys on range and is then closed to fill the
smooth interior panels.

Usage: check_canon_pair.py <dirty.png> <clean.png>
"""
from __future__ import annotations

import sys

import numpy as np
from PIL import Image, ImageFilter

IOU_MIN = 0.90          # below this the two plates are not the same photograph
BBOX_DRIFT_MAX = 0.015  # fraction of frame; ~25 px on a 1672-tall plate
TOE_DARK_MAX = 12       # the clean toe may not be more than this much lighter


def load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def subject_mask(img: np.ndarray) -> np.ndarray:
    """True on the shoes, False on the sweep, by local contrast."""
    g = Image.fromarray(img.mean(axis=2).astype(np.uint8), "L")
    rng = (np.asarray(g.filter(ImageFilter.MaxFilter(9))).astype(np.int16)
           - np.asarray(g.filter(ImageFilter.MinFilter(9))).astype(np.int16))
    m = Image.fromarray(((rng > 10) * 255).astype(np.uint8), "L")
    m = m.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))   # close
    # Open hard. The dirty plate's contact shadow carries grit texture that the
    # clean plate's does not, so a weak open left a band of speckle under the
    # shoes, dragged the dirty mask's bounding box 51 rows lower than the clean
    # one, and reported a 3.05% drift for two plates whose shoes had not moved at
    # all. 13 px erodes away anything thinner than the shoe body.
    m = m.filter(ImageFilter.MinFilter(13)).filter(ImageFilter.MaxFilter(13))
    return np.asarray(m) > 127


def bbox(mask: np.ndarray):
    rows, cols = np.any(mask, axis=1), np.any(mask, axis=0)
    r, c = np.where(rows)[0], np.where(cols)[0]
    return (r[0], r[-1], c[0], c[-1]) if len(r) and len(c) else (0, 0, 0, 0)


def main() -> int:
    d, c = load(sys.argv[1]), load(sys.argv[2])
    if d.shape != c.shape:
        print(f"FAIL  different sizes: {d.shape} vs {c.shape}")
        return 1
    h, w, _ = d.shape
    md, mc = subject_mask(d), subject_mask(c)

    # A mask this check depends on is a thing to look at, not to trust. Red where
    # only the dirty plate has subject, green where only the clean one does; a
    # registered pair shows a thin outline and nothing else.
    if "--dump" in sys.argv:
        out = sys.argv[sys.argv.index("--dump") + 1]
        vis = np.zeros((h, w, 3), np.uint8)
        vis[..., 0] = np.logical_and(md, ~mc) * 255
        vis[..., 1] = np.logical_and(mc, ~md) * 255
        vis[np.logical_and(md, mc)] = (70, 70, 70)
        Image.fromarray(vis).save(out)
        print(f"  mask diff -> {out}")

    inter = np.logical_and(md, mc).sum()
    union = np.logical_or(md, mc).sum()
    iou = inter / union if union else 0.0
    bd, bc = bbox(md), bbox(mc)
    drift = max(abs(bd[0] - bc[0]) / h, abs(bd[1] - bc[1]) / h,
                abs(bd[2] - bc[2]) / w, abs(bd[3] - bc[3]) / w)

    lum_d, lum_c = d.mean(axis=2), c.mean(axis=2)
    subj_d, subj_c = np.median(lum_d[md]), np.median(lum_c[mc])
    back_d, back_c = np.median(lum_d[~md]), np.median(lum_c[~mc])

    # The toe region: the lowest-right quarter of the subject box, where both
    # plates put the forefoot and the dark rubber tip.
    r0, r1, c0, c1 = bd
    tr0, tc0 = r0 + int((r1 - r0) * 0.55), c0 + int((c1 - c0) * 0.55)
    toe_d = lum_d[tr0:r1, tc0:c1][md[tr0:r1, tc0:c1]]
    toe_c = lum_c[tr0:r1, tc0:c1][mc[tr0:r1, tc0:c1]]
    # "How dark is the darkest real material there" -- a percentile, not a min, so
    # one stray pixel cannot answer for the rubber.
    dark_d, dark_c = np.percentile(toe_d, 2), np.percentile(toe_c, 2)

    print(f"  size            {w}x{h}")
    print(f"  silhouette IoU  {iou:.4f}   (need >= {IOU_MIN})")
    print(f"  bbox drift      {drift * 100:.2f}% of frame   (need <= {BBOX_DRIFT_MAX * 100:.1f}%)")
    print(f"    dirty box     rows {bd[0]}-{bd[1]}  cols {bd[2]}-{bd[3]}")
    print(f"    clean box     rows {bc[0]}-{bc[1]}  cols {bc[2]}-{bc[3]}")
    print(f"  subject median  {subj_d:6.1f} -> {subj_c:6.1f}   ({subj_c - subj_d:+.1f})")
    print(f"  backdrop median {back_d:6.1f} -> {back_c:6.1f}   ({back_c - back_d:+.1f})")
    print(f"  toe 2nd pctile  {dark_d:6.1f} -> {dark_c:6.1f}   ({dark_c - dark_d:+.1f}, "
          f"need <= {TOE_DARK_MAX:+.0f})")

    fails = []
    if iou < IOU_MIN:
        fails.append(f"the two plates do not register (IoU {iou:.3f})")
    if drift > BBOX_DRIFT_MAX:
        fails.append(f"the shoes moved between plates (bbox drift {drift * 100:.2f}%)")
    if dark_c - dark_d > TOE_DARK_MAX:
        fails.append(f"the dark toe rubber lightened by {dark_c - dark_d:.1f} -- "
                     f"it is being treated as dirt")
    if subj_c <= subj_d:
        fails.append("the clean plate is not lighter than the dirty one on the subject")
    if abs(back_c - back_d) > 6:
        fails.append(f"the backdrop moved {back_c - back_d:+.1f} -- this is an "
                     f"exposure change, not a cleaning")

    print()
    if fails:
        for f in fails:
            print(f"  FAIL  {f}")
        return 1
    print("  PASS  same photograph, same object, cleaned by surface not by exposure")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
