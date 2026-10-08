#!/usr/bin/env python3
"""Measure how far the CAMERA moved across a clip, in pixels.

Every motion prompt in this pipeline says "Camera not moving." Whether the model
obeyed is the sort of claim that is easy to assert and easy to get wrong by eye,
so it gets measured.

The method is phase correlation: take two frames, take their 2-D FFTs, and find
the peak of the normalised cross-power spectrum. That peak sits at the global
translation between the two images. It is dominated by whatever fills most of
the frame -- for these shots, the static room -- so a moving hand or a tumbling
drum does not drag the answer around.

A FIRST VERSION OF THIS CHECK WAS WRONG AND IS RECORDED HERE SO IT IS NOT
REPEATED: it measured the mean absolute difference of the top strip of the
frame. That number cannot tell a moving camera from a moving subject, and it
duly reported the clip I could SEE drifting (7.95) as steadier than one I could
see was rock-solid (14.23). A metric that ranks a known-bad above a known-good
has no discriminating power and must be thrown away, not tuned.

Usage: measure_camera_drift.py <clip.mp4> [--cut-seconds 4]
"""
from __future__ import annotations

import argparse
import io
import subprocess
import sys

import numpy as np
from PIL import Image


def frame(path: str, t: float) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1",
         "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True, check=True,
    )
    img = Image.open(io.BytesIO(out.stdout)).convert("L")
    return np.asarray(img, dtype=np.float64)


def shift_between(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Global (dy, dx) translation from a to b, by phase correlation."""
    # A window kills the wrap-around edge energy that would otherwise put a
    # false peak at (0, 0) and make every clip look perfectly still.
    wy = np.hanning(a.shape[0])[:, None]
    wx = np.hanning(a.shape[1])[None, :]
    fa = np.fft.fft2(a * wy * wx)
    fb = np.fft.fft2(b * wy * wx)
    cross = fa * np.conj(fb)
    mag = np.abs(cross)
    mag[mag == 0] = 1e-12
    corr = np.fft.ifft2(cross / mag).real
    peak = np.unravel_index(np.argmax(corr), corr.shape)
    dy, dx = peak
    if dy > a.shape[0] // 2:
        dy -= a.shape[0]
    if dx > a.shape[1] // 2:
        dx -= a.shape[1]
    return float(dy), float(dx)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--cut-seconds", type=float, default=None,
                    help="only measure the part of the clip the edit actually uses")
    ap.add_argument("--samples", type=int, default=5)
    args = ap.parse_args()

    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.clip],
        capture_output=True, text=True, check=True).stdout.strip())
    end = min(dur - 0.1, args.cut_seconds if args.cut_seconds else dur - 0.1)

    times = [0.05 + i * (end - 0.05) / (args.samples - 1) for i in range(args.samples)]
    base = frame(args.clip, times[0])
    rows = []
    for t in times[1:]:
        dy, dx = shift_between(base, frame(args.clip, t))
        mag = (dy * dy + dx * dx) ** 0.5
        rows.append((t, dx, dy, mag))

    # Headline is the MEDIAN, not the max. A single frame where a hand or a
    # brush briefly fills the picture can pull the correlation peak onto the
    # subject instead of the room: in the calibration run below, one sample read
    # 42px on a clip that was provably not panning at all, while every other
    # sample on it read 0. The max would have condemned a clean clip.
    mags = sorted(m for _, _, _, m in rows)
    mid = len(mags) // 2
    median = mags[mid] if len(mags) % 2 else (mags[mid - 1] + mags[mid]) / 2
    end_to_end = rows[-1][3]

    print(f"{args.clip}")
    print(f"  duration {dur:.2f}s, measured over the first {end:.2f}s, {args.samples} samples")
    for t, dx, dy, mag in rows:
        print(f"  t={t:5.2f}s  dx={dx:+7.1f}px  dy={dy:+7.1f}px  |shift|={mag:6.1f}px")
    w = base.shape[1]
    print(f"  MEDIAN SHIFT {median:.1f}px ({100 * median / w:.1f}% of frame width), "
          f"END-TO-END {end_to_end:.1f}px ({100 * end_to_end / w:.1f}%)")
    print("  calibration 2026-09-13: an injected 30px/5s pan reads median 16.0px / end-to-end 18.0px; "
          "the same clip with no pan reads median 0.5px / end-to-end 1.0px.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
