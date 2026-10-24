#!/usr/bin/env python3
"""Read the I2V prompts a job will actually send, and flag self-contradiction.

Grok clips are paid for one at a time and cannot be un-generated, so the prompts
get read before any of them goes out -- and read from compose_motion_manifest(),
the function production uses, not from a copy of its logic.

The three checks are the three faults found on 2026-09-12: two duration headers
disagreeing inside one prompt, more than one camera instruction, and the room
tone stated twice.

Usage: python check_motion_prompts.py <job-dir>
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import produce_day as pd  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def main() -> int:
    job_dir = Path(sys.argv[1]).resolve()
    job = json.loads(io.open(job_dir / "job.json", encoding="utf-8-sig").read())
    persona = json.loads(io.open(REPO / job["persona"], encoding="utf-8-sig").read())

    # A line-timed job carries no hand-written seconds: the shot lengths come
    # from the measured narration, exactly as they do in production. Derive them
    # the same way here, or this checks prompts that will never be sent.
    timing_file = job_dir / "narration-timing.json"
    if timing_file.exists():
        timing = json.loads(io.open(timing_file, encoding="utf-8-sig").read())["lines"]
        lengths = pd.shot_seconds_from_narration(job, timing)
        if not lengths:
            print("shot lengths could not be derived from the narration")
            return 1
        for shot, n in zip(job["shots"], lengths):
            shot["seconds"] = n

    defects = 0
    for index, shot in enumerate(job["shots"], start=1):
        built = pd.compose_motion_manifest(persona, job, index, shot)
        if built is None:
            print(f"shot {index}: REFUSED")
            defects += 1
            continue
        prompt = built["prompt"]
        durations = set(re.findall(r"([0-9a-z-]+)-second", prompt))
        cameras = prompt.count("Camera")
        tones = prompt.count("Quiet shop room tone")

        flags = []
        if len(durations) > 1:
            flags.append(f"DURATION CLASH {sorted(durations)}")
        if cameras != 1:
            flags.append(f"CAMERA x{cameras}")
        if tones != 1:
            flags.append(f"TONE x{tones}")
        defects += len(flags)

        head = f"shot {index} ({shot['seconds']}s, {len(prompt.split())} words)"
        print("=" * 6, head, ("<<< " + "; ".join(flags)) if flags else "ok")
        print(prompt)
        print()

    print(f"DEFECTS: {defects}")
    return 1 if defects else 0


if __name__ == "__main__":
    raise SystemExit(main())
