#!/usr/bin/env python3
"""One-off: give the 2026-09-15 job an explicit beat for each shot the owner is not in.

Shots 1 and 2 are the customer and the object. Neither maps to a persona framing,
so produce_day.py had nothing to say about them and emitted a prompt that was a
camera instruction and a list of negatives -- four seconds with no stated subject
behaviour at all.

Written to the rules that actually hold for this model (Grok Imagine): open on a
verb, stay short, say the camera move once, do not re-describe what the still
already shows. The anti-lift clause is not decoration -- a garment in a pair of
hands gets raised toward the lens unless the prompt forbids it (2026-08-27).
"""
from __future__ import annotations

import collections
import io
import json
from pathlib import Path

JOB = Path("C:/Users/cyc39/laundry-repo/output/reel-v3/2026-09-15/job.json")

ACTIONS = {
    0: (
        "She turns the jacket about ten degrees so the right cuff swings toward the lens, "
        "then holds it steady and keeps her eyes down on the cuff. "
        "The jacket stays at the same height and is never raised toward the camera; "
        "the dark band never moves, narrows or lightens."
    ),
    1: (
        "Hold the sleeve completely still on the surface; no hand, arm or person enters the frame "
        "and the fabric settles by no more than a hair. "
        "The dark band keeps its exact width, position and soft edge throughout, "
        "and never lightens, spreads or becomes clean."
    ),
}


def main() -> int:
    job = json.loads(io.open(JOB, encoding="utf-8-sig").read(), object_pairs_hook=collections.OrderedDict)
    shots = job["shots"]
    for index, action in ACTIONS.items():
        if index >= len(shots):
            print(f"ABORT: shot index {index} out of range")
            return 1
        shots[index]["action"] = action
        print(f"  shot {index + 1} ({shots[index]['seconds']}s): {action[:70]}...")

    with io.open(JOB, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(job, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"wrote {JOB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
