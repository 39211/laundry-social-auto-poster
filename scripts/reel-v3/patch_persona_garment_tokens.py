#!/usr/bin/env python3
"""One-off: take the hard-coded garment and props out of the persona framings.

2026-09-12. The 2026-09-15 reel is about a navy down jacket with a blackened
cuff. Four of its six anchor stills came back showing a pale cream wool sweater,
and the most important one -- the close-up that carries the line about grease
pressed into the fibres -- came back showing a cream sweater with a brown coffee
stain, next to a bowl and a brush.

The prompts were not written wrong. persona.json's framings describe a SCENE,
not a framing of the person: they name the garment, the problem and the props.
compose_master_prompt() appends the job's OBJECT PASSPORT after that, so every
prompt carried two different garments and the model believed the first, more
concrete one.

A framing should only say where the camera is and how the man appears. What is
being cleaned belongs to the job. This replaces the baked-in nouns with
{{GARMENT}} and {{PROBLEM}} tokens; produce_day.py substitutes them and refuses
to generate if any token is left unresolved.

The bowl and the brush go entirely. They are cleaning props, and every film's
own negative clause bans cleaning and brushing; the white bowl is also a pale
bounce source, which is the exact fault measured on 2026-09-09 (sweater 231.3
luminance against a 173.5 face).

Every replacement asserts it matched exactly once, so a silent no-op is
impossible.
"""
from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

PERSONA = Path("C:/Users/cyc39/laundry-repo/data/persona/master-owner/persona.json")

# (framing, field, old, new) -- each `old` must appear exactly once.
EDITS = [
    (
        "profile-inspect",
        "still_prompt",
        "He holds one plain pale cream wool sweater open at chest height",
        "He holds {{GARMENT}} open at chest height",
    ),
    (
        "counter-talk",
        "still_prompt",
        "one plain pale cream wool sweater spread flat on the counter in front of him with one hand resting beside it",
        "{{GARMENT}} spread flat on the counter in front of him with {{PROBLEM}} facing the camera and one hand resting beside it",
    ),
    (
        "hands-detail",
        "still_prompt",
        "close-up from above of one plain pale cream wool sweater lying flat on a warm wood-topped laundry counter with the problem area centred in frame",
        "close-up from above of {{GARMENT}} lying flat on a warm wood-topped laundry counter with {{PROBLEM}} centred in frame",
    ),
    (
        "hands-detail",
        "still_prompt",
        " A plain white ceramic bowl and a plain wooden-handled soft brush rest at the top edge of the frame.",
        "",
    ),
    (
        "hands-detail",
        "still_prompt",
        "Natural wool texture, natural skin texture.",
        "Natural fabric texture, natural skin texture.",
    ),
    (
        "hands-detail",
        "motion_prompt",
        "The garment, the mark, the bowl and the brush stay exactly in place",
        "The garment and the mark stay exactly in place",
    ),
    (
        "hands-receive",
        "still_prompt",
        "receiving one plain pale cream wool sweater and laying it flat",
        "receiving {{GARMENT}} and laying it flat",
    ),
    (
        "over-shoulder",
        "still_prompt",
        "In focus beyond him: one plain pale cream wool sweater laid flat on a warm wood-topped laundry counter",
        "In focus beyond him: {{GARMENT}} laid flat on a warm wood-topped laundry counter",
    ),
    (
        "hands-receive",
        "motion_prompt",
        "The same two hands smooth the sweater flat on the counter",
        "The same two hands smooth the garment flat on the counter",
    ),
    (
        "hands-receive",
        "motion_prompt",
        "The sweater stays the same size, colour, weave and position",
        "The garment stays the same size, colour, weave and position",
    ),
]

REVISION = {
    "date": "2026-09-12",
    "change": "framings no longer name a garment, a problem or props; they carry {{GARMENT}} and {{PROBLEM}} tokens supplied by the job",
    "reason": "four of six anchor stills for 2026-09-15 rendered a pale cream wool sweater instead of the job's navy down jacket, because the framing named a garment more concretely than the OBJECT PASSPORT appended after it; the hands-detail close-up also rendered a coffee stain, a bowl and a brush",
    "likeness_touched": False,
    "also": "removed the white bowl and soft brush, which are cleaning props barred by every film's negative clause and a pale bounce source per the 2026-09-09 luminance finding",
}


def main() -> int:
    raw = io.open(PERSONA, encoding="utf-8-sig").read()
    persona = json.loads(raw)

    backup = PERSONA.with_suffix(".json.bak-20260912")
    if not backup.exists():
        shutil.copy2(PERSONA, backup)
        print(f"backup -> {backup.name}")

    for framing, field, old, new in EDITS:
        text = persona["framings"][framing][field]
        hits = text.count(old)
        if hits != 1:
            print(f"ABORT: {framing}.{field} matched {hits} times, expected 1")
            print(f"  looking for: {old[:80]}")
            return 1
        persona["framings"][framing][field] = text.replace(old, new)
        print(f"  ok {framing}.{field}")

    persona.setdefault("revisions", []).append(REVISION)

    # No sweater, no props, anywhere in the framings.
    blob = json.dumps(persona["framings"], ensure_ascii=False)
    for banned in ["sweater", "ceramic bowl", "soft brush"]:
        if banned in blob:
            print(f"ABORT: '{banned}' still present in framings after patching")
            return 1

    with io.open(PERSONA, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(persona, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"wrote {PERSONA}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
