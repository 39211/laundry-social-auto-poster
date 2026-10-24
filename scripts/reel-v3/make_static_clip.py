#!/usr/bin/env python3
"""Build a shot from a held still instead of from the video model.

2026-09-15. Some shots should not move. The finished pair at the end of a
cleaning film is the clearest case: there are no hands in frame, nothing in the
picture has any reason to move, and asking an image-to-video model to animate it
anyway is asking for invention. It duly invented -- a lace lifted off one shoe
and swung toward the other over three seconds, in the one shot whose whole job
was to say the work was done.

So this makes the segment directly from the approved still. It is faster, it is
free, and it cannot drift. A shot built this way measures 0.003 mean
consecutive-frame difference against 1.08 for the generated version it replaces.

The output is video-only on purpose: build_master concatenates video and lays
the narration over the top, so a silent segment joins the others cleanly.

Usage: make_static_clip.py <job-dir> <slug> --seconds 3.2
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

FPS = 24


def film_frame_size(job: Path) -> tuple[int, int]:
    """Take the frame size from a clip the film already contains.

    The stills are 941x1672 and the video model returns 1088x1920, so a segment
    built straight from a PNG would be a different size from every shot around
    it -- and 941 is odd, which libx264 refuses outright with yuv420p. Reading
    the size off a sibling clip means this segment cannot silently disagree with
    the film it is being cut into.
    """
    clips = sorted(job.glob("*-raw.mp4"))
    for c in clips:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", str(c)],
            capture_output=True, text=True, check=True).stdout.strip()
        w, h = (int(v) for v in out.split(",")[:2])
        return w, h
    raise SystemExit("no sibling clip to take the frame size from")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("job")
    ap.add_argument("slug")
    ap.add_argument("--seconds", type=float, required=True)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    job = Path(args.job).resolve()
    still = job / f"{args.slug}.png"
    out = job / f"{args.slug}-raw.mp4"

    if not still.exists():
        print(f"NO STILL: {still}")
        return 1
    if out.exists() and not args.force:
        print(f"EXISTS {out}")
        return 0

    # A little longer than the cut needs, so build_master's trim still has room.
    hold = round(args.seconds + 1.0, 3)
    w, h = film_frame_size(job)
    # Cover-and-crop, never stretch: the finished top-down has to overlay the intake
    # top-down to the pixel, and a 0.7% horizontal stretch would show at that cut.
    vf = (f"fps={FPS},scale={w}:{h}:force_original_aspect_ratio=increase,"
          f"crop={w}:{h},format=yuv420p,setsar=1")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-loop", "1", "-t", f"{hold}", "-i", str(still),
         "-vf", vf, "-c:v", "libx264", "-crf", "16",
         "-preset", "medium", str(out), "-y"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print("ffmpeg failed:")
        print(r.stderr.strip()[:2000])
        return 1

    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True).stdout.strip())
    if dur < args.seconds - 0.01:
        print(f"TOO SHORT: {dur:.3f}s built for a {args.seconds}s cut")
        return 1

    print(f"OK {out.name}  {dur:.3f}s held from {still.name}  {w}x{h}  ({out.stat().st_size} bytes)")
    print("   no video model was called for this shot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
