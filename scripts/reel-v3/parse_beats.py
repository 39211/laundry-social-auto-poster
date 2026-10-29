#!/usr/bin/env python3
"""Parse the 60-beat decode into shots the pipeline can generate.

A BEAT is not a SHOT. The decode splits wherever the tool, grip, contact or
direction changes, which is the right granularity for describing motion -- but
many consecutive beats share one camera setup and the reference does not cut
between them. Generating a still per beat would put a cut where the reference
has none, which is most of what made the last edit feel wrong.

So this groups beats into camera setups. A beat starts a new setup when its
CAMERA line describes a new position; it continues the previous one when the
CAMERA line says so (the decode marks these explicitly, e.g. "保持前段機位" or
"同一鏡頭"). One still is generated per setup; the setup's beats supply their
motion prompts in order.

The decode's motion prompts also do not carry this pipeline's contract, so they
are normalised here: the positive camera lock is appended when missing, the old
negation pile is stripped, and a short English sound line is derived from what
is touching the shoe (see SOUND_BY_TOOL for why the decode's own SOUND field
cannot be used).

Usage: parse_beats.py <decode.txt> <out-dir>
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

FIELDS = ["DURATION", "TOOL", "GRIP", "CONTACT", "TRAVEL", "CAMERA", "FRAME", "SOUND"]

# The scene cuts, measured off the source with ffmpeg scene detection. These are
# the shot boundaries; everything between two of them is one camera setup.
#
# Grouping by the decode's own CAMERA wording was tried first and produced 58
# setups with a 0.20 s median -- the decode splits a beat wherever the tool, grip
# or direction changes, which is right for describing motion and wrong for
# deciding where to cut. A 0.13 s shot is three frames. Putting a cut there would
# invent cuts the reference does not have, which is most of what made the last
# edit read badly. So the cuts come from measurement and the beats supply the
# motion inside them.
CUTS = [0.07, 4.033, 5.067, 6.033, 7.033, 8.0, 9.033, 10.10, 11.033, 12.0, 13.0,
        13.967, 15.933, 17.0, 18.033, 20.067, 21.10, 22.10, 23.10, 25.067, 26.10,
        27.10, 30.133]


def split_beats(text: str) -> list[dict]:
    # "BEAT 3｜2.07–4.03"  -- the separator and dash are full-width.
    heads = list(re.finditer(r"^BEAT\s*(\d+)\s*[｜|]\s*([\d.]+)\s*[–\-—]\s*([\d.]+)",
                             text, re.M))
    beats = []
    for i, m in enumerate(heads):
        body = text[m.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        b = {"n": int(m.group(1)), "t0": float(m.group(2)), "t1": float(m.group(3))}
        for f in FIELDS:
            g = re.search(rf"^{f}[：:]\s*(.+?)(?=\n[A-Z_]+[：:]|\nIMAGE_PROMPT|\Z)",
                          body, re.M | re.S)
            b[f.lower()] = g.group(1).strip() if g else ""
        for f, key in (("IMAGE_PROMPT", "image"), ("MOTION_PROMPT", "motion")):
            g = re.search(rf"{f}[：:]\s*\n?(.+?)(?=\n[A-Z_]+[：:]|\Z)", body, re.S)
            b[key] = re.sub(r"\s+", " ", g.group(1)).strip() if g else ""
        beats.append(b)
    return beats


# The decode's own SOUND fields cannot be used. Asked what the viewer would hear,
# GPT Pro answered honestly every time that the attachment carries no audio track
# and it will not assert a sound it did not hear -- correct of it, and useless as
# a prompt. Worse, beat 1's SOUND ran on into a 200-character Chinese methodology
# note with no field marker to stop the capture, and that whole block was landing
# inside a motion prompt that is supposed to be 25 to 55 English words. Long
# prompts are exactly how the motion instruction gets squeezed out.
#
# So the sound line is derived from what is touching the shoe instead, in English,
# in six words or so. Order matters: steam before machine brush before hand brush,
# because a beat that mentions two tools should be named by the loudest one.
SOUND_BY_TOOL = [
    (("蒸汽", "白霧", "steam"), "steam hissing against wet fabric"),
    (("圓柱", "滾筒", "機器刷", "鋼軸"), "a machine brush turning, bristles slapping wet rubber"),
    (("掌刷", "手刷", "毛刷", "刷"), "bristles scrubbing wet mesh"),
    (("噴", "沖", "水流", "清水"), "water hissing onto the shoe"),
    (("毛巾", "擦拭", "抹布", "布巾"), "cloth dragging over damp fabric"),
]
SOUND_IDLE = "the quiet room tone of a wet workroom"
SOUND_DEFAULT = "water and bristles on wet mesh"


def sound_for(tool: str, contact: str) -> str:
    blob = f"{tool} {contact}"
    if "沒有工具" in tool or "NONE" in tool.upper():
        return SOUND_IDLE
    for keys, phrase in SOUND_BY_TOOL:
        if any(k in blob for k in keys):
            return phrase
    return SOUND_DEFAULT


def normalise_motion(motion: str, tool: str, contact: str) -> str:
    """Bring a decode motion prompt up to this pipeline's contract."""
    m = re.sub(r"\s+", " ", motion).strip().rstrip(" .;")
    if not m:
        return ""
    m = re.sub(r"\s*Camera not moving\.", "", m)
    m = re.sub(r"\s*No music, no voices, no dialogue\.?", "", m)
    if "The camera remains completely stationary." not in m:
        m = m.rstrip(".") + ". The camera remains completely stationary."
    if "Sound:" not in m:
        m += f" Sound: {sound_for(tool, contact)}."
    return m


def main() -> int:
    text = io.open(sys.argv[1], encoding="utf-8").read()
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    beats = split_beats(text)
    if not beats:
        print("no beats parsed -- the heading format did not match")
        return 1

    # Group beats into the measured shots by LARGEST OVERLAP, not by which window
    # contains the beat's start. Assigning by start left three shot windows with no
    # beat at all -- a beat that begins just before a cut and runs across it was
    # filed entirely under the earlier shot -- and orphaned the two-frame opening
    # flash, which starts before the first cut.
    windows = [(CUTS[i], CUTS[i + 1]) for i in range(len(CUTS) - 1)]
    # The opening flash lives before the first cut; give it its own window.
    windows.insert(0, (0.0, CUTS[0]))

    def overlap(b, w):
        return max(0.0, min(b["t1"], w[1]) - max(b["t0"], w[0]))

    buckets: list[list] = [[] for _ in windows]
    for b in beats:
        best = max(range(len(windows)), key=lambda i: overlap(b, windows[i]))
        if overlap(b, windows[best]) <= 0:
            print(f"  WARNING: beat {b['n']} ({b['t0']}-{b['t1']}) overlaps no shot window")
            continue
        buckets[best].append(b)

    setups = [{"beats": bs, "t0": w[0], "t1": w[1]}
              for bs, w in zip(buckets, windows) if bs]
    empty = [f"{w[0]:.2f}-{w[1]:.2f}" for bs, w in zip(buckets, windows) if not bs]
    if empty:
        print(f"  WARNING: shot windows with no beat: {empty}")

    for i, s in enumerate(setups, 1):
        first = s["beats"][0]
        sid = f"s{i:02d}-{s['t0']:05.2f}".replace(".", "p")
        s["id"] = sid
        s["seconds"] = round(s["t1"] - s["t0"], 3)
        s["still_prompt"] = first["image"]
        s["motion_prompt"] = normalise_motion(first["motion"], first["tool"], first["contact"])
        s["beat_numbers"] = [b["n"] for b in s["beats"]]
        # Carried through for the shot builder: it decides which anchor to attach
        # and whether a shot is a wet-room shot from these, and should not have to
        # re-parse the decode to find out.
        for f in ("tool", "grip", "contact", "camera", "frame"):
            s[f] = re.sub(r"\s+", " ", first[f]).strip()
        s["extra_beats"] = [
            {"n": b["n"], "t0": b["t0"], "t1": b["t1"],
             "motion_prompt": normalise_motion(b["motion"], b["tool"], b["contact"]),
             "travel": b["travel"], "tool": b["tool"]}
            for b in s["beats"][1:]
        ]
        io.open(out / f"{sid}.json", "w", encoding="utf-8", newline="\n").write(
            json.dumps({k: s[k] for k in
                        ("id", "t0", "t1", "seconds", "still_prompt", "motion_prompt",
                         "beat_numbers", "tool", "grip", "contact", "camera", "frame",
                         "extra_beats")},
                       ensure_ascii=False, indent=2) + "\n")

    print(f"{len(beats)} beats -> {len(setups)} camera setups")
    print()
    for s in setups:
        n = len(s["beats"])
        print(f"  {s['id']:14} {s['t0']:6.2f}-{s['t1']:6.2f}  {s['seconds']:5.2f}s  "
              f"{n} beat{'s' if n > 1 else ' '}  beats {s['beat_numbers']}")
    total = sum(s["seconds"] for s in setups)
    print()
    print(f"  total {total:.2f}s across {len(setups)} setups "
          f"(median {sorted(s['seconds'] for s in setups)[len(setups)//2]:.2f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
