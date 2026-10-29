#!/usr/bin/env python3
"""Retime a generated clip and give it a real camera's shutter blur.

WHY THIS EXISTS. Measured on 2026-09-16 against the SOLESO reference, over the
same 0.8 s palm-brush action at the same 360x640 size:

                    motion   sharpness
    reference        22.8       2.16
    Claude V3        10.2      11.83
    Codex cut         8.5      12.36

Both generated cuts move at well under half the reference's rate and carry five
times its edge detail. A real phone camera cannot freeze a hand scrubbing three
strokes a second -- the shutter is open while the hand moves, so the hand smears
and the shoe it is holding does not. A generated clip has no shutter at all:
every frame is a perfect still, and that is a large part of what reads as "AI".

The fix a camera would give us is exactly an average of consecutive instants. So
each output frame here is the MEAN of `blend` consecutive source frames, and the
read head advances `step` source frames per output frame. Anything that did not
move between those instants averages to itself and stays sharp; anything that did
move smears along its own path, by its own distance. That is localized motion blur
by construction, not a filter laid over the whole picture.

With native 24 fps sources and a 30 fps timeline the mapping is exact:
    step 1, blend 1   1.25x, no blur      -- what the Codex cut did
    step 1, blend 2   1.25x, shutter blur -- isolates the blur
    step 2, blend 1   2.50x, no blur      -- isolates the speed
    step 2, blend 2   2.50x, shutter blur -- both

This is a post process. It cannot create contact, reversal or foam response that
the clip does not already contain; it only presents what is there at a working
speed with a working shutter. A clip whose brush floats past the shoe will float
past faster. Judge the source first.

Usage:
  shutter_retime.py <src.mp4> <out.mp4> --start 2 --frames 24 --step 2 --blend 2
      [--crop 0.10,0.20,0.90,0.80] [--size 1080x1920] [--fps 30]
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np


def flag(name, default, cast=str):
    return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def probe(src: Path) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,r_frame_rate", "-of", "csv=p=0", str(src)],
        capture_output=True, text=True).stdout.strip().split(",")
    num, den = out[2].split("/")
    return int(out[0]), int(out[1]), float(num) / float(den)


def retime(src: Path, dst: Path, start: int, frames_out: int, step: int = 1,
           blend: int = 1, fps_out: int = 30, size: str = "", crop: str = "") -> str:
    """Render one retimed, shutter-blended segment. Returns a one-line summary.

    Raises SystemExit when the source is too short for the requested window, so a
    caller building a whole film stops instead of shipping a truncated shot.
    """
    W, H, fps_in = probe(src)
    need = start + (frames_out - 1) * step + blend
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(src), "-frames:v", str(need),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True).stdout
    have = len(raw) // (W * H * 3)
    if have < need:
        raise SystemExit(
            f"{src.name}: source has {have} frames, this retime needs {need} "
            f"(start {start} + {frames_out} x step {step} + blend {blend})")
    src_frames = np.frombuffer(raw, np.uint8)[: have * W * H * 3].reshape(have, H, W, 3)

    vf = []
    if crop:
        x0, y0, x1, y1 = (float(v) for v in crop.split(","))
        cw, ch = int((x1 - x0) * W) // 2 * 2, int((y1 - y0) * H) // 2 * 2
        vf.append(f"crop={cw}:{ch}:{int(x0 * W)}:{int(y0 * H)}")
    if size:
        w, h = size.lower().split("x")
        vf.append(f"scale={w}:{h}:flags=lanczos")
    vf.append("format=yuv420p")

    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(fps_out), "-i", "-",
         "-vf", ",".join(vf), "-c:v", "libx264", "-crf", "16", "-preset", "medium",
         "-video_track_timescale", str(fps_out * 1000), str(dst), "-y"],
        stdin=subprocess.PIPE)
    for k in range(frames_out):
        i = start + k * step
        # Average in linear-ish float space. Gamma-correct averaging would be more
        # physically exact; at two or three frames the difference is invisible,
        # and the point is the position of the smear, not its exact luminance.
        f = src_frames[i:i + blend].astype(np.float32).mean(axis=0)
        enc.stdin.write(np.clip(f + 0.5, 0, 255).astype(np.uint8).tobytes())
    enc.stdin.close()
    enc.wait()

    # `step` source frames are consumed per output frame, and output frames are
    # shown at fps_out while the source was captured at fps_in.
    speed = step * fps_out / fps_in
    return (f"{src.name} [{fps_in:g} fps] frames {start}..{start + (frames_out - 1) * step + blend - 1}"
            f" -> {dst.name}: {frames_out} frames at {fps_out} fps, "
            f"{speed:.2f}x, {blend}-frame shutter")


def main() -> int:
    print(retime(Path(sys.argv[1]), Path(sys.argv[2]),
                 start=flag("--start", 0, int), frames_out=flag("--frames", 24, int),
                 step=flag("--step", 1, int), blend=flag("--blend", 1, int),
                 fps_out=flag("--fps", 30, int), size=flag("--size", "", str),
                 crop=flag("--crop", "", str)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
