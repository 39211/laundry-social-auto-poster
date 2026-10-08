#!/usr/bin/env python3
"""Measure whether a stretch of finished film actually holds still.

Written on 2026-09-15 because of a defect nobody's prompt gate could ever have
caught. The v2 film's hero shot -- the finished pair, no hands in frame -- had a
lace lift off one shoe and swing across to the other over three seconds. The
prompts had passed every check; the picture was wrong. A gate on the text can
only ever say the text is well formed.

So this measures the rendered frames instead. For a shot that is supposed to be
a held image, the frame-to-frame difference is the whole story: a real hold is
flat at the noise floor, and anything the generator invents shows up as a bump.

It reports two numbers over the window:

  mean  the average absolute difference between consecutive frames, 0-255
  p95   the 95th percentile of the same, which is what catches a short move
        inside an otherwise quiet shot

Calibrate against the two references it prints: a segment built by holding a PNG
(a true static) and the window being judged.

TWO WAYS THIS TOOL LIES IF YOU LET IT, both found on 2026-09-15 reading a hold
that was genuinely flat as mean 1.970:

  * A window that touches the cut. Ask for 36.85-39.80 on a shot that runs
    36.751-39.852 and the first sample still carries the previous shot, so one
    enormous difference lands in the average. --inset trims both ends and is on
    by default; a shot boundary is never what you meant to measure.
  * The burned-in overlays. The brand mark, the disclosure and the per-shot
    summary card all sit in the same frame as the picture, and the summary card
    changing is a real difference that has nothing to do with whether the shoes
    moved. --band restricts the measurement to the rows the picture occupies.

Usage:
  assert_static.py <video> --from 36.75 --to 39.85 [--max-mean 0.05]
  assert_static.py <video> --from .. --to .. --band 420:1400 --inset 0.45
"""
from __future__ import annotations

import argparse
import io
import subprocess
import sys

import numpy as np
from PIL import Image


def frames(path: str, start: float, end: float, fps: float = 8.0,
           band: tuple[int, int] | None = None) -> list[np.ndarray]:
    vf = f"fps={fps}"
    if band:
        y0, y1 = band
        vf += f",crop=in_w:{y1 - y0}:0:{y0}"
    vf += ",scale=240:-1"
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-to", str(end), "-i", path,
         "-vf", vf, "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True, check=True,
    ).stdout
    imgs, buf = [], out
    sig = b"\x89PNG\r\n\x1a\n"
    starts = [i for i in range(len(buf)) if buf.startswith(sig, i)]
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(buf)
        imgs.append(np.asarray(Image.open(io.BytesIO(buf[s:e])).convert("L"), dtype=np.int16))
    return imgs


def stats(imgs: list[np.ndarray]) -> tuple[float, float, int]:
    if len(imgs) < 2:
        return 0.0, 0.0, len(imgs)
    diffs = [float(np.abs(imgs[i + 1] - imgs[i]).mean()) for i in range(len(imgs) - 1)]
    return float(np.mean(diffs)), float(np.percentile(diffs, 95)), len(imgs)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--from", dest="start", type=float, required=True)
    ap.add_argument("--to", dest="end", type=float, required=True)
    ap.add_argument("--fps", type=float, default=8.0)
    ap.add_argument("--max-mean", type=float, default=None,
                    help="fail if the mean consecutive-frame difference exceeds this")
    ap.add_argument("--label", default="")
    ap.add_argument("--band", default=None,
                    help="y0:y1 rows to measure, to keep the burned-in cards out of it")
    ap.add_argument("--inset", type=float, default=0.25,
                    help="seconds trimmed off each end so the cut itself is not measured")
    args = ap.parse_args()

    start, end = args.start + args.inset, args.end - args.inset
    if end - start < 0.5:
        print(f"FAIL: {end - start:.2f}s left after a {args.inset}s inset at each end -- "
              f"too short to judge; lower --inset or widen the window")
        return 1
    band = tuple(int(v) for v in args.band.split(":")) if args.band else None

    imgs = frames(args.video, start, end, args.fps, band)
    mean, p95, n = stats(imgs)

    name = args.label or f"{args.start:.2f}-{args.end:.2f}s"
    extra = f"  band={args.band}" if band else "  WHOLE FRAME (overlays included)"
    print(f"{name:34} frames={n:3}  mean={mean:6.3f}  p95={p95:6.3f}"
          f"  [{start:.2f}-{end:.2f}s{extra}]")

    if args.max_mean is not None:
        if mean > args.max_mean:
            print(f"  FAIL: mean {mean:.3f} exceeds {args.max_mean} -- something in this shot moves")
            return 1
        print(f"  ok: mean {mean:.3f} is within {args.max_mean}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
