#!/usr/bin/env python3
"""One-off: cut the standalone-contract wrapper out of the persona motion prompts.

2026-09-12. Dry-running the six I2V prompts before sending any of them showed
each framed shot carrying two contradictory headers:

    "One continuous 6-second ... shot. Begin exactly from the reference frame.
     One continuous seven-second ... shot Begin exactly from the reference frame
     He keeps his eyes down ..."

Shot 3 asked for six seconds and seven seconds, shot 5 for six and seven, shot 6
for seven and nine. The negatives were stated twice as well. The cause is that
each motion_prompt was written as a complete standalone contract back when it was
sent on its own, and produce_day.py now wraps it again with the duration, the
camera rhythm and the negatives from the job.

A framing should describe only how the man behaves. Duration, camera and
negatives belong to the shot. This strips the wrapper sentences and leaves the
behaviour.

Each removal is asserted, and the result is re-checked for any surviving
duration or camera sentence, so a partial strip cannot pass silently.
"""
from __future__ import annotations

import io
import json
import re
import shutil
from pathlib import Path

PERSONA = Path("C:/Users/cyc39/laundry-repo/data/persona/master-owner/persona.json")

HEADER = re.compile(
    r"^One continuous [a-z-]+-second photorealistic native 1080p portrait 9:16 shot\. "
    r"Begin exactly from the reference frame\. "
)
CAMERA_SENTENCE = re.compile(r"\s*Camera [^.]*\.")
# Anchored at the end on purpose. hands-detail carries "No face or head ever
# enters." in the middle of its behaviour, and that one has to survive -- it is
# the whole reason that framing exists.
TRAILING_NEGATIVES = re.compile(r"\s*No [^.]*\.\s*Quiet shop room tone\.\s*$")
TRAILING_NEGATIVES_ALT = re.compile(r"\s*Quiet shop room tone\.\s*$")


def main() -> int:
    persona = json.loads(io.open(PERSONA, encoding="utf-8-sig").read())

    backup = PERSONA.with_suffix(".json.bak-motion-20260912")
    if not backup.exists():
        shutil.copy2(PERSONA, backup)
        print(f"backup -> {backup.name}")

    failed = False
    for name, framing in persona["framings"].items():
        text = framing.get("motion_prompt", "")
        if not text:
            continue
        original = text

        text, n_header = HEADER.subn("", text)
        text, n_neg = TRAILING_NEGATIVES.subn("", text)
        if not n_neg:
            text, n_neg = TRAILING_NEGATIVES_ALT.subn("", text)
        text, n_cam = CAMERA_SENTENCE.subn("", text)
        text = text.strip()

        if not (n_header and n_neg):
            print(f"  FAIL {name}: header={n_header} negatives={n_neg} camera={n_cam}")
            failed = True
            continue

        # Nothing about duration, camera or the shop tone may survive: those are
        # the job's to state, and a leftover is exactly the contradiction this
        # patch exists to remove.
        for leftover in ["One continuous", "Camera", "Quiet shop room tone", "-second"]:
            if leftover in text:
                print(f"  FAIL {name}: {leftover!r} survived")
                failed = True
        if failed:
            continue

        framing["motion_prompt"] = text
        print(f"  ok {name}: {len(original)} -> {len(text)} chars")
        print(f"      {text[:110]}...")

    if failed:
        print("ABORT: nothing written")
        return 1

    persona.setdefault("revisions", []).append({
        "date": "2026-09-12",
        "change": "motion_prompt in every framing is now behaviour only; the duration header, the camera sentence and the trailing negatives were removed",
        "reason": "produce_day.py wraps each framing with the shot's own duration, camera rhythm and negatives, so the framing's standalone contract produced two headers per prompt with conflicting durations (shot 3 asked for six and seven seconds) and stated the negatives twice",
        "likeness_touched": False,
    })

    with io.open(PERSONA, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(persona, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"wrote {PERSONA}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
