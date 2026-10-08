#!/usr/bin/env python3
"""Deterministic gate for a film's shot prompts. No model opinions involved.

Two adversarial passes signed off the 2026-09-14 prompts, which is evidence and
not a licence: a reviewer that says CLEAN has still only asserted something. The
checks below either hold or they do not, and they run on the file that will
actually be pasted into the image and video models.

Run with --self-test to see the gate fail on deliberately broken input. A gate
that has never been shown to go red is not a gate.

Usage:
  gate_shot_prompts.py <shots.json>
  gate_shot_prompts.py --self-test
"""
from __future__ import annotations

import io
import json
import re
import sys

REAL_BRANDS = ("nike", "adidas", "converse", "vans", "new balance", "asics", "puma",
               "reebok", "jordan", "air max", "swoosh logo")

# Words that make a motion prompt start on something other than a verb. Grok
# attaches the action to whatever the sentence opens on, so an opening article
# or pronoun is how a shot ends up with the object as the actor.
BAD_OPENERS = {"the", "a", "an", "he", "she", "it", "they", "his", "her", "their",
               "this", "that", "there", "both", "one", "two", "camera"}

LIFT_PHRASES = ("toward the camera", "toward the lens", "up to the camera", "holds up",
                "lifts it up", "raises it up", "presents it to")

AUDIO_TAIL = "No music, no voices, no dialogue."


def words(text: str) -> list[str]:
    return [w for w in re.split(r"\s+", text.strip()) if w]


def check_still(s: dict) -> list[str]:
    p = s["still_prompt"]
    low = p.lower()
    bad = []
    if "9:16" not in p:
        bad.append("still: no 9:16 aspect")
    if "camera not moving" in low and "still" not in low[:40]:
        pass  # harmless if present; the motion prompt is where it is required
    # A shoe counts as in frame when the prompt makes one its subject. Mentions
    # like "shoe-washing bench" or "outside this frame" must not trigger it.
    subject = re.search(r"(the shoe(?![-\w])|both shoes|one shoe|each shoe|plimsoll)", low)
    # A prompt may say the shoes are absent in several ways. Matching only one
    # spelling made the gate demand an object passport from two shots that
    # state outright that no shoe is in frame.
    outside = bool(re.search(
        r"no shoes? (is|are) in (this )?frame|outside this frame|(shoes?|plimsolls?)[^.]{0,60}\b(are|is) out of frame", low))
    shoe_visible = bool(subject) and not outside
    if shoe_visible and "canvas weave" not in low:
        bad.append("still: a shoe is in frame but the object passport's canvas weave is missing")
    if s["face_in_frame"]:
        if "mouth is closed" not in low:
            bad.append("still: a face is in frame but 'mouth is closed' is missing")
    else:
        if "no face" not in low:
            bad.append("still: hands-only shot does not forbid the face")
    # Three spellings are in use across the acts. Matching only two of them
    # red-flagged ten shots on 2026-09-14 that all carried a proper block.
    for marker in ("forbidden", "not allowed", "forbid"):
        if marker in low:
            break
    else:
        bad.append("still: no negative block (FORBID / NOT ALLOWED / FORBIDDEN)")
    if "logo" not in low:
        bad.append("still: the negative block never forbids a logo")
    for b in REAL_BRANDS:
        if b in low:
            bad.append(f"still: names a real brand: {b}")
    return bad


def check_motion(s: dict) -> list[str]:
    p = s["motion_prompt"].strip()
    low = p.lower()
    bad = []

    n = len(words(p))
    if not 25 <= n <= 55:
        bad.append(f"motion: {n} words, outside 25-55")

    first = words(p)[0].strip(",.").lower() if words(p) else ""
    if first in BAD_OPENERS:
        bad.append(f"motion: opens on '{first}', not a verb")

    if p.count("Camera not moving.") != 1:
        bad.append(f"motion: 'Camera not moving.' appears {p.count('Camera not moving.')} times, want exactly 1")

    if "Sound:" not in p:
        bad.append("motion: no Sound: clause")
    if not p.endswith(AUDIO_TAIL):
        bad.append("motion: does not end with the audio negative")

    if s["face_in_frame"] and "mouth" not in low:
        bad.append("motion: a face is in frame but the mouth is not pinned")

    for phrase in LIFT_PHRASES:
        for m in re.finditer(re.escape(phrase), low):
            window = low[max(0, m.start() - 60):m.start()]
            # A negation anywhere in the clause before it means the prompt is
            # forbidding the move, not asking for it.
            if re.search(r"(no|not|nothing|never|neither)[^.;]*$", window):
                continue
            bad.append(f"motion: something moves toward the lens: '{phrase}'")

    for b in REAL_BRANDS:
        if b in low:
            bad.append(f"motion: names a real brand: {b}")

    return bad


def check_pair_framing(shots: dict) -> list[str]:
    """a03 and f02 must be the same locked top-down frame, dirty versus clean.

    This is the film's before/after. If the two prompts do not carry the same
    framing numbers, the image model -- which never sees the other frame -- puts
    the pair at a different size on the mat and the cut reads as two pictures of
    two different pairs rather than one frame with the dirt removed.
    """
    a = shots.get("a03-insert-weave")
    f = shots.get("f02-hero-topdown")
    if not a or not f:
        return ["framing: a03-insert-weave or f02-hero-topdown is missing"]
    bad = []
    # Numbers, not adjectives: adjectives survive paraphrase, numbers do not.
    for num in re.findall(r"\b\d+\s*cm\b", a["still_prompt"]):
        if num.replace(" ", "") not in f["still_prompt"].replace(" ", ""):
            bad.append(f"framing: a03 pins '{num}' but f02 never repeats it")
    if "daylight from the left" in a["still_prompt"] and "daylight from the left" not in f["still_prompt"]:
        bad.append("framing: a03 keys from the left but f02 does not say so, so the shadows will flip")
    return bad


def check_laces(shots: dict) -> list[str]:
    """Laces come out in c01 and go back in at f01. Nothing between may show them threaded."""
    bad = []
    deLaced = ["c04-drybrush", "d01-outsole-brush", "d02-foam-upper", "d03-detail-eyelets",
               "d04-foxing", "d05-machine", "d06-rinse", "e02-inspect"]
    for sid in deLaced:
        s = shots.get(sid)
        if not s:
            continue
        p = s["still_prompt"].lower()
        if "laces through plain metal eyelets" in p or "laces through the metal eyelets" in p:
            bad.append(f"laces: {sid} still threads the laces, but they came out in c01")
    return bad


def run(shots_list: list[dict]) -> list[str]:
    shots = {s["id"]: s for s in shots_list}
    problems = []
    for s in shots_list:
        for msg in check_still(s) + check_motion(s):
            problems.append(f"{s['id']}: {msg}")
    problems += check_pair_framing(shots)
    problems += check_laces(shots)
    return problems


def self_test() -> int:
    """Prove the gate goes red. A checker never seen failing is not evidence."""
    good = {
        "id": "x", "face_in_frame": False, "shoe_in_frame": True,
        "still_prompt": ("Photorealistic candid smartphone photo, vertical portrait 9:16. "
                         "NO face, NO head. One plain cream cotton-canvas low-top plimsoll lies on "
                         "the bench, visible cotton canvas weave across the upper. "
                         "NOT ALLOWED: no logo, no emblem, no readable lettering."),
        "motion_prompt": ("Sweeping the brush in slow circles, the hand thickens the foam under "
                          "the bristles while the shoe stays flat on the bench and never leaves it. "
                          "Camera not moving. Sound: soft bristles on wet canvas. " + AUDIO_TAIL),
    }
    if run([good | {"id": "a03-insert-weave"}, good | {"id": "f02-hero-topdown"}]):
        print("SELF-TEST FAILED: the gate rejects input it should accept")
        print("\n".join(run([good | {"id": "a03-insert-weave"}, good | {"id": "f02-hero-topdown"}])))
        return 1

    mutations = {
        "drop the 9:16": {"still_prompt": good["still_prompt"].replace("vertical portrait 9:16", "vertical")},
        "drop the canvas weave": {"still_prompt": good["still_prompt"].replace("canvas weave", "surface")},
        "drop NO face": {"still_prompt": good["still_prompt"].replace("NO face, NO head. ", "")},
        "name a real brand": {"still_prompt": good["still_prompt"] + " The shoe is a Nike Air Max."},
        "open on an article": {"motion_prompt": "The hand sweeps the brush in slow circles and thickens "
                                                "the foam under the bristles while the shoe stays flat on "
                                                "the bench and never leaves it at any point of the take. "
                                                "Camera not moving. Sound: soft bristles. " + AUDIO_TAIL},
        "drop the camera clause": {"motion_prompt": good["motion_prompt"].replace("Camera not moving. ", "")},
        "lift toward the lens": {"motion_prompt": good["motion_prompt"].replace(
            "never leaves it", "then lifts it toward the camera")},
        "too short": {"motion_prompt": "Sweeping once. Camera not moving. Sound: bristles. " + AUDIO_TAIL},
    }
    failures = []
    for name, patch in mutations.items():
        mutant = dict(good)
        mutant.update(patch)
        mutant["id"] = "a03-insert-weave"
        caught = run([mutant, good | {"id": "f02-hero-topdown"}])
        caught = [c for c in caught if c.startswith("a03")]
        mark = "caught" if caught else "MISSED"
        if not caught:
            failures.append(name)
        print(f"  {mark:7} mutation: {name}"
              + (f"  ->  {caught[0].split(': ', 1)[1]}" if caught else ""))

    # Framing and lace checks need their own mutants.
    a = good | {"id": "a03-insert-weave",
                "still_prompt": good["still_prompt"] + " The gap between them is about 6 cm. Broad soft daylight from the left."}
    f_bad = good | {"id": "f02-hero-topdown"}
    framing = check_pair_framing({"a03-insert-weave": a, "f02-hero-topdown": f_bad})
    print(f"  {'caught' if framing else 'MISSED':7} mutation: f02 drops a03's framing numbers"
          + (f"  ->  {framing[0]}" if framing else ""))
    if not framing:
        failures.append("f02 drops a03's framing numbers")

    laced = good | {"id": "d02-foam-upper",
                    "still_prompt": good["still_prompt"] + " flat cotton laces through plain metal eyelets"}
    lace = check_laces({"d02-foam-upper": laced})
    print(f"  {'caught' if lace else 'MISSED':7} mutation: a washing shot re-threads the laces"
          + (f"  ->  {lace[0]}" if lace else ""))
    if not lace:
        failures.append("a washing shot re-threads the laces")

    print()
    if failures:
        print(f"SELF-TEST FAILED: {len(failures)} mutation(s) slipped through: {', '.join(failures)}")
        return 1
    print("SELF-TEST PASSED: clean input accepted, every mutation caught")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    if sys.argv[1] == "--self-test":
        return self_test()
    shots = json.loads(io.open(sys.argv[1], encoding="utf-8-sig").read())
    if isinstance(shots, dict):
        shots = shots.get("shots", [])
    problems = run(shots)
    for p in problems:
        print("  " + p)
    print()
    print(f"{len(shots)} shots checked, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
