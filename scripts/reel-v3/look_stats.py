#!/usr/bin/env python3
"""Measure what a video LOOKS like, so a camera treatment can be matched by number.

The owner, 2026-09-17: the picture is too sharp and does not look like the
reference. "Real footage" is not one knob. A phone clip that has been through a
social platform is softer than a render, carries sensor noise, has its fine
detail smeared by compression, and has its own tone curve and colour. Each of
those is measured here on the same footing for any two videos, so a treatment
can be tuned toward the reference instead of toward a guess.

Everything is computed at 360x640 so a 720p reference and a 1080p render are
compared at the same scale, and on a band that excludes the top of the frame,
where both films carry a crisp burned-in watermark that would dominate the
sharpness reading.

  sharp    mean absolute gradient -- edge energy. Soft footage reads low.
  fine     energy of the finest detail: |frame - 1px blur|. Compression and lens
           softness remove this first.
  noise    std of the high-pass residual in the flattest 30% of the picture --
           mostly sensor grain there, since flat areas have no texture to confuse it.
  luma     mean, std (contrast), 2nd and 98th percentile (black and white points).
  sat      mean HSV saturation.
  rgb      mean R, G, B -- a colour cast shows up as an imbalance.

Usage: look_stats.py <video> [<video> ...] [--frames 40] [--band 0.20,1.00]
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

W, H = 360, 640


def sample_frames(path: Path, n: int) -> list[np.ndarray]:
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
         str(path)], capture_output=True, text=True).stdout.strip())
    fps = n / dur
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path),
         "-vf", f"fps={fps:.6f},scale={W}:{H}:flags=area", "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    k = len(raw) // (W * H * 3)
    return list(np.frombuffer(raw[: k * W * H * 3], np.uint8).reshape(k, H, W, 3))


def stats(frames: list[np.ndarray], band: tuple[float, float]) -> dict:
    y0, y1 = int(band[0] * H), int(band[1] * H)
    acc: dict[str, list[float]] = {}

    def add(k, v):
        acc.setdefault(k, []).append(float(v))

    for f in frames:
        rgb = f[y0:y1].astype(np.float32)
        g = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
        gi = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8))
        b1 = np.asarray(gi.filter(ImageFilter.GaussianBlur(1)), np.float32)
        b2 = np.asarray(gi.filter(ImageFilter.GaussianBlur(2)), np.float32)
        grad = (np.abs(np.diff(g, axis=0))[:, :-1] + np.abs(np.diff(g, axis=1))[:-1, :]) / 2
        add("sharp", grad.mean())
        add("fine", np.abs(g - b1).mean())
        flat = grad <= np.percentile(grad, 30)
        add("noise", (g - b2)[:-1, :-1][flat].std())
        add("luma", g.mean())
        add("contrast", g.std())
        add("black", np.percentile(g, 2))
        add("white", np.percentile(g, 98))
        mx, mn = rgb.max(axis=2), rgb.min(axis=2)
        add("sat", np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0).mean())
        for i, c in enumerate("RGB"):
            add(c, rgb[..., i].mean())
    return {k: float(np.mean(v)) for k, v in acc.items()}


KEYS = ["sharp", "fine", "noise", "luma", "contrast", "black", "white", "sat", "R", "G", "B"]


def main() -> int:
    args = [a for a in sys.argv[1:]]
    n = 40
    band = (0.20, 1.00)
    if "--frames" in args:
        i = args.index("--frames"); n = int(args[i + 1]); del args[i:i + 2]
    if "--band" in args:
        i = args.index("--band"); band = tuple(float(v) for v in args[i + 1].split(",")); del args[i:i + 2]
    print(f"{'video':34}" + "".join(f"{k:>9}" for k in KEYS))
    for p in args:
        s = stats(sample_frames(Path(p), n), band)
        print(f"{Path(p).name[:34]:34}" + "".join(f"{s[k]:9.2f}" for k in KEYS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
