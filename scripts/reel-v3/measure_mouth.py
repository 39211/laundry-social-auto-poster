#!/usr/bin/env python3
"""Measure how much a clip's mouth region moves, against a control patch.

2026-09-12. The owner's complaint was that the mouth did not match the voice. A
measurement on the previous cut found the mouth and the narration statistically
independent -- 48.1% frame agreement against 50.5% by chance -- because the video
model has no audio input at all, so any visible speech is out of sync by
construction. The fix was to stop showing speech.

"The mouth looks closed to me" is not evidence that it is. This puts a number on
it: mean absolute inter-frame difference inside a mouth box, divided by the same
figure for a control patch on the apron in the same frames. A mouth that is not
moving scores about the same as a patch of still cloth. On the previous cut the
shot that was told to keep its mouth shut scored 1.7x and the two that were told
to speak scored 6.6x and 6.7x.

Usage: measure_mouth.py <clip> <mx> <my> <mw> <mh> <cx> <cy> <cw> <ch> [end_seconds]
"""
from __future__ import annotations

import subprocess
import sys
import re


def activity(clip: str, box: tuple[int, int, int, int], end: float | None) -> float:
    x, y, w, h = box
    vf = f"crop={w}:{h}:{x}:{y},format=gray,tblend=all_mode=difference"
    args = ["ffmpeg", "-v", "error"]
    if end:
        args += ["-t", str(end)]
    # metadata=print goes to the log at info level, which -v error swallows.
    # Send it to stdout with file=- so the numbers survive regardless of log level.
    args += ["-i", clip, "-vf", vf + ",signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
             "-f", "null", "-"]
    proc = subprocess.run(args, capture_output=True, text=True)
    vals = [float(m) for m in re.findall(r"lavfi\.signalstats\.YAVG=([0-9.]+)", proc.stdout + proc.stderr)]
    if not vals:
        raise SystemExit(f"no frames measured for {clip} box={box}\n{proc.stderr[-400:]}")
    # Drop the first value: the first tblend output compares a frame with itself.
    vals = vals[1:] or vals
    return sum(vals) / len(vals)


def main() -> int:
    clip = sys.argv[1]
    mouth = tuple(int(v) for v in sys.argv[2:6])
    ctrl = tuple(int(v) for v in sys.argv[6:10])
    end = float(sys.argv[10]) if len(sys.argv) > 10 else None
    m = activity(clip, mouth, end)
    c = activity(clip, ctrl, end)
    ratio = m / c if c else float("inf")
    verdict = "MOUTH STILL" if ratio < 2.5 else ("BORDERLINE" if ratio < 4.0 else "MOUTH MOVING")
    print(f"{clip}")
    print(f"  mouth box {mouth}: {m:.3f}")
    print(f"  control   {ctrl}: {c:.3f}")
    print(f"  ratio {ratio:.2f}x  -> {verdict}   (prior cut: closed 1.7x, speaking 6.6x / 6.7x)")
    return 0 if ratio < 2.5 else 1


if __name__ == "__main__":
    raise SystemExit(main())
