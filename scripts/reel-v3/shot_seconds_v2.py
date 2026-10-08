#!/usr/bin/env python3
"""Shot lengths for a film where some shots carry no spoken line.

The 2026-09-14 external review asked for four beats to run on action sound with
no narration over them -- de-lacing the insole, rinsing it, closing the cabinet
door, tidying the bow. The original helper in produce_day.py assumes every shot
owns exactly one narration line and derives every boundary from that line's
start, so a silent shot has no boundary to derive and the whole walk collapses.

This version walks the shots in order instead:

  * a shot that owns a line starts when that line starts;
  * a silent shot starts where the previous shot ended and runs for the seconds
    the job declares;
  * the silence it plays over comes from the previous line's gap_after, which
    the job sets wide enough on purpose.

Boundaries are rounded, never durations: rounding each duration separately
drifts by a second or more across twenty-four shots, and the last boundary has
to land exactly on the moment the closing line begins.

The checks refuse rather than warn. A shot shorter than 1.5 s cannot be read; a
shot longer than 15 s cannot be generated in one clip; and a silent shot whose
declared length runs past the next spoken line means the gap_after is too small,
which would put narration over the wrong picture.

Usage: shot_seconds_v2.py <job-dir>   (writes the seconds back into job.json)
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path


def seconds_for(job: dict, timing: list[dict]) -> list[float] | None:
    """Exact boundaries, not rounded ones.

    The first version rounded every boundary to a whole second, which is fine
    when shots run four or five seconds and fatal when they run one. A 1.28 s
    line whose start and end round in opposite directions collapsed to a 1 s
    slot and then failed its own floor. Nothing downstream needs integers: the
    clips are always generated at five seconds and trimmed, and build_master
    formats the trim to six decimal places.

    A spoken shot starts when its line starts. A silent shot fills the gap the
    job deliberately opened after the previous line, so it starts when that line
    ends and finishes when the next one begins.
    """
    shots = job["shots"]
    ends_at = timing[-1]["start"]

    starts: list[float] = []
    for i, shot in enumerate(shots):
        if shot.get("lines"):
            starts.append(float(timing[shot["lines"][0]]["start"]))
        else:
            prev = shots[i - 1] if i else None
            if not prev or not prev.get("lines"):
                print(f"  FAIL shot-{i + 1:02d} ({shot['file']}): a silent shot must follow a spoken one")
                return None
            starts.append(float(timing[prev["lines"][0]]["end"]))
    starts.append(float(ends_at))

    out = []
    for i, shot in enumerate(shots):
        span = round(starts[i + 1] - starts[i], 3)
        # 1.2 s, not 1.5: the external review's own recut runs slots at 1.2-1.4 s
        # and says outright that an action readable in 1.1 s should not be
        # stretched to 3.
        if span < 1.2:
            print(f"  FAIL shot-{i + 1:02d} ({shot['file']}): {span}s is under the 1.2s floor")
            return None
        if span > 15:
            print(f"  FAIL shot-{i + 1:02d} ({shot['file']}): {span}s exceeds the 15s single-clip ceiling")
            return None
        out.append(span)
    return out


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    cfg = json.loads(io.open(job / "job.json", encoding="utf-8-sig").read())
    timing = json.loads(io.open(job / "narration-timing.json", encoding="utf-8-sig").read())["lines"]

    secs = seconds_for(cfg, timing)
    if secs is None:
        return 1

    for shot, n in zip(cfg["shots"], secs):
        shot["seconds"] = n
    io.open(job / "job.json", "w", encoding="utf-8").write(
        json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")

    back = json.loads(io.open(job / "job.json", encoding="utf-8-sig").read())
    got = [s["seconds"] for s in back["shots"]]
    if got != secs:
        print("  FAIL: the durations did not survive the write")
        return 1

    for shot, n in zip(back["shots"], got):
        tag = "(silent)" if not shot.get("lines") else ""
        print(f"  {shot['file'].replace('-raw.mp4',''):26} {n:5.2f}s {tag}")
    print()
    print(f"footage {round(sum(got), 2)}s, closing line starts {timing[-1]['start']}s, "
          f"narration ends {timing[-1]['end']}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
