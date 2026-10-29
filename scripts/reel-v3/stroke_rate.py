#!/usr/bin/env python3
"""How fast is the hand actually scrubbing? Strokes per second, measured from the glove.

Asking a video model for "three complete back-and-forth cycles each second" does
not produce them: Codex's palm-v2 prompt said exactly that and the owner still
judged the brushing slower than the reference. A frame-difference number cannot
settle it either -- it rises with texture as much as with speed, and a single
slow sweep and a fast scrub can score the same.

So this tracks the WORKING glove. The gloves are pink, which separates cleanly
from grey mesh, white foam, steel and skin. Inside a box that excludes the
supporting hand, the pink pixels' centroid is followed frame by frame, projected
onto its own main axis of travel, and the back-and-forth rate is read two ways:

  fft        the dominant frequency of that 1-D path, 0.7-8 Hz
  reversals  how often the smoothed velocity changes sign, halved

Both are reported as full cycles per second (one there-and-back). When the two
disagree a lot the track is unreliable -- the glove left the box, or the
supporting hand leaked in -- and the output says so.

Also reported: stroke amplitude as a fraction of the frame height, because a
fast scrub a few pixels wide does not read as scrubbing either.

Usage: stroke_rate.py <video> --box x0,y0,x1,y1 [--from T --to T] [--speed 2.5]
  --speed  multiply the measured rate, to predict it after a retime
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

W, H = 270, 480


def flag(name, default, cast=float):
    return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def main() -> int:
    src = Path(sys.argv[1])
    box = tuple(float(v) for v in flag("--box", "0,0,1,1", str).split(","))
    t0, t1 = flag("--from", 0.0), flag("--to", 0.0)
    speed = flag("--speed", 1.0)
    fps = float(eval(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=r_frame_rate", "-of", "csv=p=0", str(src)],
        capture_output=True, text=True).stdout.strip()))
    cmd = ["ffmpeg", "-v", "error"]
    if t0:
        cmd += ["-ss", f"{t0:.3f}"]
    if t1:
        cmd += ["-t", f"{t1 - t0:.3f}"]
    cmd += ["-i", str(src), "-vf", f"scale={W}:{H}:flags=area", "-f", "rawvideo",
            "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    fr = np.frombuffer(raw[: n * W * H * 3], np.uint8).reshape(n, H, W, 3).astype(np.int16)

    x0, y0, x1, y1 = int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)
    pts, cover = [], []
    for f in fr:
        r, g, b = f[y0:y1, x0:x1, 0], f[y0:y1, x0:x1, 1], f[y0:y1, x0:x1, 2]
        # Pink: strong red, green well below red, blue not far below green.
        # Skin fails the last test (its blue sits well under its green).
        m = (r > 140) & (r - g > 50) & (b - g > -5)
        cover.append(m.mean())
        if m.sum() < 30:
            pts.append((np.nan, np.nan))
            continue
        ys, xs = np.nonzero(m)
        pts.append((xs.mean() + x0, ys.mean() + y0))
    p = np.array(pts, float)
    ok = ~np.isnan(p[:, 0])
    if ok.sum() < max(8, n // 2):
        print(f"{src.name}: glove visible in only {ok.sum()}/{n} frames -- box is wrong or no glove")
        return 1
    # Fill short gaps so the frequency analysis sees an even sampling.
    for k in (0, 1):
        idx = np.arange(n)
        p[:, k] = np.interp(idx, idx[ok], p[ok, k])

    c = p - p.mean(axis=0)
    u, s, vt = np.linalg.svd(c, full_matrices=False)
    axis = vt[0]
    path = c @ axis
    path = path - np.polyval(np.polyfit(np.arange(n), path, 1), np.arange(n))

    # FFT with zero padding, 0.7-8 Hz band.
    pad = 1 << int(np.ceil(np.log2(n * 8)))
    spec = np.abs(np.fft.rfft(path * np.hanning(n), pad))
    freqs = np.fft.rfftfreq(pad, 1 / fps)
    band = (freqs >= 0.7) & (freqs <= 8.0)
    f_fft = float(freqs[band][np.argmax(spec[band])])

    # Velocity sign changes on a lightly smoothed path.
    k = max(1, int(round(fps / 15)))
    sm = np.convolve(path, np.ones(2 * k + 1) / (2 * k + 1), mode="same")
    v = np.diff(sm)
    v = v[np.abs(v) > 0.15]
    rev = int(np.sum(np.diff(np.sign(v)) != 0))
    dur = n / fps
    f_rev = rev / 2 / dur

    amp = float(np.percentile(path, 90) - np.percentile(path, 10)) / H

    print(f"{src.name}  {n} frames @ {fps:g} fps ({dur:.2f}s)  glove in {ok.mean() * 100:.0f}% of frames, "
          f"mean cover {np.mean(cover) * 100:.1f}% of box")
    print(f"  cycles/s   fft {f_fft:.2f}   reversals {f_rev:.2f}"
          + (f"   -> after {speed}x retime: fft {f_fft * speed:.2f}, reversals {f_rev * speed:.2f}"
             if speed != 1.0 else ""))
    print(f"  stroke amplitude {amp * 100:.1f}% of frame height (10-90th pct along the main axis)")
    if abs(f_fft - f_rev) > 0.4 * max(f_fft, f_rev):
        print("  NOTE: the two estimates disagree -- treat the rate as unreliable for this track")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
