"""Measures the colour gains that pull an after clip onto its before clip.

Two separate generations never agree on exposure. The object legitimately
changes between the clips, so the comparison uses only the frame border --
counter, wall and floor, where nothing should differ -- sampled where the
crossfade will land: the end of the before clip against the start of the after.

Prints ffmpeg colorchannelmixer gains and the residual per-channel gap in
8-bit levels. Assembly's join threshold is 14; the gains exist to get the
residual near zero regardless.

Usage: python scripts/measure-pair-gain.py <before.mp4> <after.mp4>
"""
import subprocess
import sys

W, H = 720, 1280
BORDER_X, BORDER_Y = 108, 192  # outer 15% of each edge


def border_means(path: str, tail: bool) -> list[float]:
    seek = ["-sseof", "-0.5"] if tail else []
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", *seek, "-i", path, "-frames:v", "1",
         "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True).stdout
    if len(raw) != W * H * 3:
        raise SystemExit(f"unexpected frame size from {path}: {len(raw)}")

    totals, counts = [0, 0, 0], 0
    for y in range(H):
        for x in range(W):
            if BORDER_X <= x < W - BORDER_X and BORDER_Y <= y < H - BORDER_Y:
                continue
            i = (y * W + x) * 3
            totals[0] += raw[i]
            totals[1] += raw[i + 1]
            totals[2] += raw[i + 2]
            counts += 1
    return [t / counts for t in totals]


before = border_means(sys.argv[1], tail=True)
after = border_means(sys.argv[2], tail=False)

gains = [b / a if a > 0 else 1.0 for b, a in zip(before, after)]
residual = max(abs(b - a) for b, a in zip(before, after))

print(f"before RGB: {[round(v, 1) for v in before]}")
print(f"after  RGB: {[round(v, 1) for v in after]}")
print(f"residual before correction: {residual:.1f}")
print(f"-GainR {gains[0]:.4f} -GainG {gains[1]:.4f} -GainB {gains[2]:.4f}")
