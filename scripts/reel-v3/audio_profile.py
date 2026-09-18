#!/usr/bin/env python3
"""Per-second loudness profile of a finished film.

Written 2026-09-15 after a mistake worth naming: the clips from the video model
carry an audio STREAM, and I checked for the stream and concluded the film had a
soundtrack. Measured properly, ten of the twenty-one clips sat below -50 dB --
silence with a codec attached. The first build shipped a nearly silent film with
one loud line at the end.

So this measures what is actually in the file, second by second, and prints the
reference film's own profile beside it for comparison.

Usage:
  audio_profile.py <video> [--label NAME] [--voice-from 26.6 --voice-to 29.9]
"""
from __future__ import annotations

import argparse
import re
import statistics
import subprocess
import sys

# Measured off the SOLESO reference reel on 2026-09-15: work sound swinging
# between about -16 and -30 dB, then deliberately collapsing to -36 under the
# closing studio cards.
REF_WORK = (-16.0, -30.0)
REF_TAIL = -36.0


def profile(path: str) -> list[float]:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-af",
         "aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,"
         "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
         "-f", "null", "-"],
        capture_output=True, text=True).stdout
    return [float(m) for m in re.findall(r"RMS_level=(-?[0-9.]+)", out)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--label", default="")
    ap.add_argument("--voice-from", type=float, default=None)
    ap.add_argument("--voice-to", type=float, default=None)
    ap.add_argument("--quiet-below", type=float, default=-45.0,
                    help="seconds below this are reported as dead air")
    args = ap.parse_args()

    v = profile(args.video)
    if not v:
        print("no audio readings at all -- the file has no usable audio track")
        return 1

    vf = int(args.voice_from) if args.voice_from is not None else len(v)
    vt = int(args.voice_to) + 1 if args.voice_to is not None else len(v)
    work = v[:vf]
    voice = v[vf:vt]

    print(f"{args.label or args.video}")
    print(f"  seconds measured: {len(v)}")
    if work:
        print(f"  work section   median {statistics.median(work):6.1f} dB   "
              f"min {min(work):6.1f}   max {max(work):6.1f}")
        print(f"                 reference film was {REF_WORK[0]:.0f} to {REF_WORK[1]:.0f} dB")
    if voice:
        print(f"  spoken line    median {statistics.median(voice):6.1f} dB   "
              f"max {max(voice):6.1f}")
        if work:
            lift = statistics.median(voice) - statistics.median(work)
            verdict = ("clearly above the bed" if lift > 4 else
                       "level with the bed -- the line will not cut through" if lift > -2 else
                       "BELOW the bed -- the line will be buried")
            print(f"                 {lift:+.1f} dB against the work bed: {verdict}")

    dead = [(i, x) for i, x in enumerate(work) if x < args.quiet_below]
    print()
    if dead:
        print(f"  DEAD AIR ({len(dead)}s below {args.quiet_below:.0f} dB):")
        for i, x in dead:
            print(f"    {i:3d}s  {x:6.1f} dB")
    else:
        print(f"  no second of the work section falls below {args.quiet_below:.0f} dB")

    print()
    for i, x in enumerate(v):
        tag = "  <- spoken line" if vf <= i < vt else ""
        bar = "#" * max(0, int(x + 60))
        print(f"  {i:3d}s {x:7.1f}  {bar}{tag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
