#!/usr/bin/env python3
"""Deterministic checks on the Cloudtilt motion prompts, before any clip is paid for.

2026-09-15 fluidity rewrite. The old 25-55 / verb-first / "Camera not moving."
contract is what produced the owner's complaint: the machine was a prepositional
phrase, the negation pile froze the frame, and there was no room left to assert
simultaneous contact reactions. GPT-6 Pro (share 6aa95173) and the I2V research
lane agreed on the replacement:

  LENGTH        working shots 70-120 English words (target 80-110). Held shots
                stay short. Identity stays in the still; these words are motion.
  DRIVER FIRST  a working machine or tool is its own clause, not a modifier on
                the shoe. Held shots may still open with an -ing hold verb.
  CAMERA LOCK   one positive sentence: "The camera remains completely stationary."
                Negation ("Camera not moving", "no music") is no longer required
                and is rejected on working shots.
  EXTENT        a centimetre figure, a cycle rate, or an explicit hold. "Slightly"
                is not an extent.
  NO CAMERA MOVE / NO RESTATING THE PICTURE  unchanged from the previous gate.

Usage: gate_cloudtilt_motion.py <job-dir>
       gate_cloudtilt_motion.py --self-test
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

HELD_MIN, HELD_MAX = 20, 60
WORK_MIN, WORK_MAX = 70, 120
CAMERA_LOCK = "The camera remains completely stationary."

CAMERA_MOVE = [
    (r"\bcamera (?:slowly )?(?:pans?|tilts?|zooms?|tracks?|dollies|pushes|pulls|moves|drifts|rotates|orbits|cranes|rises|descends)\b",
     "the camera moves"),
    (r"\b(?:push(?:ing|es)? in|pull(?:ing|s)? back|pull(?:ing|s)? out|zoom(?:ing|s)? (?:in|out)|dolly(?:ing)? (?:in|out)|crane (?:up|down)|rack focus|racking focus)\b",
     "a camera move"),
    (r"\bthe (?:shot|frame|view) (?:widens|tightens|opens up|closes in)\b", "the frame changes size"),
    (r"\b(?:handheld|shaky cam|whip pan|slow motion|time.?lapse)\b", "a camera or speed effect"),
]

RESTATEMENT = [
    (r"\b(?:split.?screen|before.?and.?after|side.?by.?side|picture.?in.?picture)\b", "a split frame"),
    (r"\b(?:caption|subtitle|title card|text overlay|watermark|on.?screen text)\b", "on-screen text"),
    (r"\b(?:cut to|cuts to|hard cut|dissolve to|fade (?:in|out)|transition to)\b", "an edit inside one clip"),
]

DISTANCE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:cm|centimet(?:re|er)s?)\b", re.I)
CYCLE = re.compile(
    r"\b(?:continuously|throughout|every second|already spinning|already working|"
    r"keeps spinning|keep spinning|never stops)\b",
    re.I,
)
HELD = re.compile(r"\b(?:motionless|completely still|0 cm|zero displacement)\b", re.I)
OPENING_ING = re.compile(r"^[A-Z][a-z]+ing\b")
OPENING_DRIVER = re.compile(r"^The [A-Za-z]")
NEGATION_PILE = re.compile(r"\b(?:Camera not moving|No music, no voices, no dialogue)\b")


def is_held(m: str) -> bool:
    return bool(HELD.search(m))


def check(sid: str, m: str) -> list[str]:
    bad: list[str] = []
    n = len(m.split())
    held = is_held(m)
    lo, hi = (HELD_MIN, HELD_MAX) if held else (WORK_MIN, WORK_MAX)
    if not lo <= n <= hi:
        kind = "held" if held else "working"
        bad.append(f"{n} words, outside {lo}-{hi} for a {kind} shot")
    if held:
        if not OPENING_ING.match(m):
            bad.append(f"held shot does not open with an -ing verb: {m.split(' ')[0]!r}")
    else:
        if not (OPENING_DRIVER.match(m) or OPENING_ING.match(m)):
            bad.append(f"does not open with a driver clause or -ing verb: {m.split(' ')[0]!r}")
        if NEGATION_PILE.search(m):
            bad.append("working shot still uses a negation pile")
    c = m.count(CAMERA_LOCK)
    if c != 1:
        bad.append(f"{CAMERA_LOCK!r} appears {c} times, needs exactly 1")
    if m.count("Sound:") != 1:
        bad.append(f"'Sound:' appears {m.count('Sound:')} times, needs exactly 1")
    if not (DISTANCE.search(m) or CYCLE.search(m) or held):
        bad.append("no travel distance, cycle rate, or explicit hold")
    for pat, why in CAMERA_MOVE + RESTATEMENT:
        hit = re.search(pat, m, re.I)
        if hit:
            bad.append(f"{why}: {hit.group(0)!r}")
    return bad


SELF_TEST_CLEAN = [
    "The large white drum is already spinning rapidly on its axle and keeps spinning "
    "throughout; its bristle texture changes continuously with localized rotational "
    "blur. The hands guide the On Cloudtilt outsole 8 cm toward screen left within "
    "the first 1.0 second, maintaining contact. Bristles bend at the contact patch "
    "and spring back after leaving it. Foam is swept into changing streaks; thin "
    "milky runoff and a few small droplets fall toward the lower edge. The shoe "
    "yields slightly against the gloves without changing its overall shape. Rotation, "
    "contact and runoff continue afterward. The camera remains completely stationary. "
    "Sound: a machine brush turning, bristles slapping wet rubber.",
    "The working hand scrubs the On Cloudtilt forefoot with brisk 7 cm one-way strokes, "
    "diagonally down-left toward the toe and back up-right. It completes three full "
    "back-and-forth cycles every second, starting immediately and maintaining that "
    "rhythm throughout the clip. The supporting hand braces the rear. Bristles bend "
    "against the mesh on each stroke and flex the opposite way on the return without "
    "lifting. Foam ridges move ahead of the brush, leave thinner wet tracks behind, "
    "and release a few small beads near the sole edge. Blur affects the moving brush "
    "and glove, not the background. The camera remains completely stationary. "
    "Sound: bristles scrubbing wet mesh.",
    "Holding both shoes completely motionless with 0 cm displacement, maintaining "
    "unchanged laces, openings, contact shadows and lighting while the editor uses "
    "this frame as a two-frame preview. The camera remains completely stationary. "
    "Sound: the quiet room tone of a wet workroom.",
]

SELF_TEST_BAD = [
    ("The brush moves 5 cm right. " + CAMERA_LOCK + " Sound: x.", "words, outside"),
    ("Meanwhile foam spreads ahead of the brush and the bristles bend under pressure "
     "from the gloved hand as the shoe feeds 5 cm left throughout the first second "
     "and contact continues afterward with runoff falling down. " + CAMERA_LOCK +
     " Sound: bristles scrubbing wet mesh.", "does not open with"),
    (SELF_TEST_CLEAN[0].replace(CAMERA_LOCK, CAMERA_LOCK + " " + CAMERA_LOCK),
     "appears 2 times"),
    (SELF_TEST_CLEAN[0].replace(CAMERA_LOCK + " ", ""), "appears 0 times"),
    (SELF_TEST_CLEAN[1].replace("7 cm one-way strokes", "short strokes").replace(
        "three full back-and-forth cycles every second", "a few passes").replace(
        "throughout the clip", "in this shot"),
     "no travel distance"),
    (SELF_TEST_CLEAN[0].replace("The hands guide", "the camera slowly pushes in while the hands guide"),
     "camera move"),
    (SELF_TEST_CLEAN[0].replace("The hands guide", "the camera pans right past the hands that guide"),
     "the camera moves"),
    (SELF_TEST_CLEAN[0].replace("Foam is swept", "a before-and-after of the foam is swept"),
     "a split frame"),
    (SELF_TEST_CLEAN[0].replace("Foam is swept", "a caption over the foam is swept"),
     "on-screen text"),
    (SELF_TEST_CLEAN[0].replace("Foam is swept", "then cut to the finished foam is swept"),
     "an edit inside one clip"),
    (SELF_TEST_CLEAN[0].replace("Foam is swept", "the shot widens to reveal the foam is swept"),
     "the frame changes size"),
    (SELF_TEST_CLEAN[1] + " Camera not moving. No music, no voices, no dialogue.",
     "negation pile"),
]


def self_test() -> int:
    bad = 0
    print("CLEAN CASES -- any report here is a false positive")
    for i, m in enumerate(SELF_TEST_CLEAN, 1):
        found = check(f"clean{i}", m)
        if found:
            bad += 1
            print(f"  FALSE POSITIVE on clean case {i}: {found}")
        else:
            print(f"  quiet  clean case {i}  ({len(m.split())} words)")
    print()
    print("MUTATIONS -- each must be caught, and caught for the stated reason")
    for i, (m, want) in enumerate(SELF_TEST_BAD, 1):
        found = check(f"bad{i}", m)
        if any(want in f for f in found):
            print(f"  caught mutation {i:2}  ({want})")
        else:
            bad += 1
            print(f"  MISSED mutation {i:2}  wanted {want!r}, got {found}")
    print()
    if bad:
        print(f"SELF-TEST FAILED: {bad} problem(s)")
        return 1
    print(f"SELF-TEST PASSED: {len(SELF_TEST_CLEAN)} clean cases quiet, "
          f"{len(SELF_TEST_BAD)} mutations caught")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    job = Path(sys.argv[1]).resolve()
    shots = json.loads(io.open(job / "prompts" / "shots.json", encoding="utf-8").read())
    problems = 0
    for s in shots:
        bad = check(s["id"], s["motion_prompt"])
        if bad:
            problems += 1
            print(f"  FAIL {s['id']}")
            for b in bad:
                print(f"         {b}")
        else:
            print(f"  ok   {s['id']:14} {len(s['motion_prompt'].split()):2} words")
    print()
    if problems:
        print(f"{problems} of {len(shots)} motion prompts have problems")
        return 1
    print(f"all {len(shots)} motion prompts pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
