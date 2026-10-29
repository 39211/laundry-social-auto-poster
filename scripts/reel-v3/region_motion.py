#!/usr/bin/env python3
"""Measure motion separately in named regions of a clip, over time.

The whole-frame difference number that verify_master_motion.py reports says a clip
is "moving" and says nothing about WHAT is moving. The owner's complaint on
2026-09-15 was precise and the whole-frame number cannot see it: the machine's
cylinder brush is supposed to spin continuously and in our clips it is frozen
while only the shoe drifts past. Both cases give the same whole-frame mean.

So this splits the frame into named boxes and reports each one's own motion, plus
how that motion is distributed over time -- because a second reason the clips read
badly is that every clip is generated at 5.04 s and only the first ~1 s is cut into
the film, so whatever the model does late is thrown away.

Regions are given as NAME=x0,y0,x1,y1 in fractions of width and height.

Usage:
  region_motion.py <clip.mp4> --regions brush=0.35,0.0,1.0,0.35 shoe=0.0,0.3,1.0,0.8
  region_motion.py <clip.mp4> --regions ... --used 1.03 --fps 12
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


def frames(path: Path, fps: float) -> list[np.ndarray]:
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"fps={fps}",
             str(Path(td) / "f%04d.png"), "-y"],
            capture_output=True, text=True)
        out = []
        for p in sorted(Path(td).glob("f*.png")):
            out.append(np.asarray(Image.open(p).convert("L"), dtype=np.float32))
        return out


def main() -> int:
    clip = Path(sys.argv[1])
    fps = float(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 12.0
    used = float(sys.argv[sys.argv.index("--used") + 1]) if "--used" in sys.argv else None

    regions = {}
    if "--regions" in sys.argv:
        for spec in sys.argv[sys.argv.index("--regions") + 1:]:
            if spec.startswith("--"):
                break
            name, box = spec.split("=")
            regions[name] = tuple(float(v) for v in box.split(","))
    if not regions:
        regions = {"whole": (0.0, 0.0, 1.0, 1.0)}

    fs = frames(clip, fps)
    if len(fs) < 3:
        print(f"only {len(fs)} frames extracted -- nothing to measure")
        return 1
    H, W = fs[0].shape

    print(f"{clip.name}  {len(fs)} frames at {fps} fps  ({len(fs)/fps:.2f}s sampled)")
    if used:
        print(f"  the edit uses the first {used:.2f}s = the first "
              f"{max(1, int(used * fps))} of these frames")
    print()
    print(f"  {'region':10} {'whole clip':>11} {'used window':>12} {'after':>9}  "
          f"{'ratio':>6} {'sharp':>7}  peak at")
    for name, (x0, y0, x1, y1) in regions.items():
        a, b = int(y0 * H), int(y1 * H)
        c, d = int(x0 * W), int(x1 * W)
        diffs = np.array([np.abs(fs[i + 1][a:b, c:d] - fs[i][a:b, c:d]).mean()
                          for i in range(len(fs) - 1)])
        # Edge energy, as a stand-in for motion blur. A part that is moving too
        # fast for the shutter is smeared and loses its high frequencies; a part
        # that is merely sitting there keeps them. On 2026-09-15 this turned out
        # to be the sharpest difference between our clips and the reference: the
        # reference's spinning brush is a directional smear with no resolvable
        # bristles, ours has every bristle crisp and simply sways. Reported as the
        # mean gradient magnitude, averaged over the sampled frames.
        sharp = float(np.mean([
            (np.abs(np.diff(f[a:b, c:d], axis=0)).mean()
             + np.abs(np.diff(f[a:b, c:d], axis=1)).mean()) / 2
            for f in fs[::max(1, len(fs) // 8)]]))
        n_used = max(1, int(used * fps)) if used else len(diffs)
        in_used = diffs[:n_used].mean()
        after = diffs[n_used:].mean() if n_used < len(diffs) else float("nan")
        peak_t = int(np.argmax(diffs)) / fps
        ratio = in_used / diffs.mean() if diffs.mean() else 0.0
        print(f"  {name:10} {diffs.mean():11.3f} {in_used:12.3f} {after:9.3f}  "
              f"{ratio:6.2f} {sharp:7.2f}  {peak_t:.2f}s")

    print()
    print("  ratio < 1.00 means the edit keeps a QUIETER-than-average stretch of the clip.")
    print("  A region that is meant to run continuously (a spinning brush) should have")
    print("  a high number in every column; a frozen prop reads near the noise floor.")
    print("  sharp is edge energy: a part moving too fast for the shutter smears and")
    print("  reads LOW. A crisply resolved fast-moving part is the AI tell.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
