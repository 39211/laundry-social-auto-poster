#!/usr/bin/env python3
"""Measure every shot of the finished film: did it move, or is it a frozen still?

The third tier of verification. The first is the approved still, the second is
the generated clip, and this is the only one that speaks for what a viewer will
actually see -- the segment as it was cut into the master. They come apart: on
2026-09-15 nine clips were silently refused by the generator, the builder
substituted their stills, and the master was announced as finished with a third
of the film frozen.

It runs assert_static.py over each shot's own window, inset from both cut
boundaries so the reading is of the shot and not of the cut. A shot marked
static in the cut list is expected to be flat and is failed if it moves; every
other shot is expected to move and is failed if it is flat.

Usage: verify_master_motion.py <job-dir> <master.mp4> [--min-move 0.6]
"""
from __future__ import annotations

import io
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable
# A held PNG measures about 0.002. Anything below this is not a moving picture.
MIN_MOVE = 0.6
MAX_STATIC = 0.05


def measure(video: Path, t0: float, t1: float) -> float:
    r = subprocess.run(
        [PY, str(HERE / "assert_static.py"), str(video),
         "--from", f"{t0:.3f}", "--to", f"{t1:.3f}", "--inset", "0.15"],
        capture_output=True, text=True)
    # assert_static.py prints "mean= 5.732" -- equals sign, then a space.
    m = re.search(r"mean=?\s*([\d.]+)", r.stdout)
    if not m:
        print(r.stdout.strip()[-400:] or r.stderr.strip()[-400:])
        raise SystemExit(f"could not read a mean for {t0}-{t1}")
    return float(m.group(1))


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    master = Path(sys.argv[2])
    if not master.is_absolute():
        master = job / master
    floor = float(sys.argv[sys.argv.index("--min-move") + 1]) if "--min-move" in sys.argv else MIN_MOVE

    cut = json.loads(io.open(job / "cut-list.json", encoding="utf-8").read())

    # Windows come from the BUILT segments, not from the cut list's requested
    # seconds. ffmpeg rounds each segment up to a whole frame, so a 30.13 s cut
    # list becomes a 30.51 s master; walking the requested numbers puts the last
    # windows nearly four tenths of a second out of place, and by then a one
    # second shot is being measured mostly inside its neighbour. Measuring the
    # wrong window is exactly the failure this tool's own docstring warns about.
    def seg_seconds(sid: str) -> float:
        p = job / "build" / f"{sid}.mp4"
        if not p.exists():
            raise SystemExit(f"{sid}: no built segment at {p}; build the master first")
        return float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(p)], capture_output=True, text=True).stdout.strip())

    t = 0.0
    bad = []
    print(f"  {'id':14} {'window':>15} {'kind':7} {'mean':>7}  verdict")
    for s in cut["shots"]:
        t0, t1 = t, t + seg_seconds(s["id"])
        t = t1
        # A window shorter than a few frames cannot be measured either way.
        if t1 - t0 < 0.20:
            print(f"  {s['id']:14} {t0:6.2f}-{t1:6.2f} {'flash':7} {'--':>7}  "
                  f"too short to measure ({t1 - t0:.2f}s)")
            continue
        mean = measure(master, t0, t1)
        if s.get("static"):
            ok = mean <= MAX_STATIC
            verdict = "held" if ok else f"MOVED (wanted <= {MAX_STATIC})"
        else:
            ok = mean >= floor
            verdict = "moving" if ok else f"FROZEN (wanted >= {floor})"
        if not ok:
            bad.append(s["id"])
        print(f"  {s['id']:14} {t0:6.2f}-{t1:6.2f} "
              f"{'static' if s.get('static') else 'clip':7} {mean:7.3f}  {verdict}")

    print()
    if bad:
        print(f"{len(bad)} shot(s) wrong: {', '.join(bad)}")
        return 1
    print(f"all {len(cut['shots'])} shots behave as the cut list says they should")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
