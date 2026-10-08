#!/usr/bin/env python3
"""Move the last eight body negations into their FORBID blocks.

After the adversarial pass and its revision, the gate still found eight places
where a prohibition sat beside the thing it could erase. Each is handled the same
way: say what IS there where the subject is described, and move the prohibition
to the FORBID block at the end, which is the only safe place for it.

Two of the eight are contrasts rather than plain prohibitions ("not a hand
brush", "clear water, not grey water"). A contrast is the more dangerous form,
because the model sees the negated noun immediately beside the real one, so those
are rewritten positively rather than moved.

Usage: fix_remaining_negations.py <revised-dir>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

# (shot id, text to find, replacement, sentence to append to FORBID or None)
FIXES = [
    # s01: the shoe is the subject; the brush is merely absent. Move it.
    ("s01-hook-dirty",
     "No brush is being held, no tool is in",
     "Nothing is being held and nothing else is in",
     "no brush, cylinder drum, cloth, bottle or hand tool anywhere in this frame"),

    # s11: here the drum IS the subject, and "not a hand brush" puts the negated
    # noun right beside the real one. State what it is instead.
    ("s11-machine-wide",
     "purpose-built shop equipment, not a hand brush",
     "purpose-built shop equipment: machine-mounted cylinder drums turning on a common steel shaft",
     None),

    # s13: the hand is the subject and the midsole is genuinely wet, so a stack of
    # water prohibitions sits right beside real water.
    ("s13-hand-wipe",
     "No spray, no jet, no falling water, no mist: the nozzle is off",
     "The nozzle is off",
     "no spray, no jet, no falling water and no mist in this frame; the water present is only what already wets the shoe and the steel"),

    # s16: two rendering stacks move; the third is a contrast and is rewritten.
    ("s16-press-foam",
     "added sparkle, no soap suds, no steam, no smoke.",
     "added sparkle.",
     "no soap suds, no steam and no smoke in this frame"),
    ("s16-press-foam",
     "no motion blur anywhere, no streaking water, no flying droplets in mid-air",
     "every edge sharp",
     "motion blur, streaking water or droplets frozen in mid-air"),
    ("s16-press-foam",
     "clear water, not grey water",
     "clear water, running as clean as tap water",
     None),

    # s22a: a studio card. Both prohibitions move to the end.
    ("s22a-studio-dirty",
     "both bows tied, no lace ends draped off onto the pape",
     "both bows tied and both lying flat against their own tongues, clear of the pape",
     "any lace end draped off the shoe onto the paper"),
    ("s22a-studio-dirty",
     "no tool, no tiles, no wet floor, no water anywhere, no suds, no lather,",
     "nothing but the pair and the paper:",
     "any tool, tile, wet floor, water, suds or lather"),
]


def main() -> int:
    d = Path(sys.argv[1])
    by_shot: dict[str, list[tuple]] = {}
    for shot, find, repl, forbid in FIXES:
        by_shot.setdefault(shot, []).append((find, repl, forbid))

    changed = 0
    for shot, items in by_shot.items():
        p = d / f"{shot}.json"
        data = json.loads(io.open(p, encoding="utf-8").read())
        still = data["still_prompt"]
        adds: list[str] = []
        for find, repl, forbid in items:
            if find not in still:
                print(f"  MISS {shot}: could not find {find[:56]!r}")
                continue
            still = still.replace(find, repl, 1)
            if forbid:
                adds.append(forbid)
            print(f"  ok   {shot}: {find[:50]!r} -> {repl[:50]!r}")
        if adds:
            # Append to the LAST FORBID paragraph, which is the end of the prompt.
            still = still.rstrip()
            tail = "; also forbidden: " + "; ".join(adds) + "."
            still = still[:-1] + tail if still.endswith(".") else still + tail
        data["still_prompt"] = still
        data["revision_note"] = (data.get("revision_note", "") +
                                 " Final pass moved the remaining body negations into FORBID and "
                                 "rewrote two contrasts positively.").strip()
        io.open(p, "w", encoding="utf-8", newline="\n").write(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        changed += 1
    print(f"\n{changed} file(s) rewritten")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
