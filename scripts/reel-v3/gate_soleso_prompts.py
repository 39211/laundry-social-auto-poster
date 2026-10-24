#!/usr/bin/env python3
"""Deterministic gate for the SOLESO-rhythm shoe film's shot prompts.

Written 2026-09-15. This checks only what a program can decide without an
opinion. Everything a model thinks about a prompt is evidence, not a verdict;
the rules below are the verdict.

Why each rule is here, so nobody softens one later without knowing the cost:

  camera        Every time a camera move survived into a prompt, the video model
                started inventing objects that were not in the first frame. The
                camera is bolted down in this film. A SUBJECT may drift -- steam
                drifts -- so only camera-directed movement is searched for.
  format        The video model treats a long motion prompt as a scene
                description and drops the motion. 25-55 words, verb first,
                exactly one camera clause, a Sound line, and the no-music tail.
  negation      On 2026-09-15 a prompt said EMPTY five times beside the one
                eyelet that had to be threaded, and the model rendered it empty
                with the lace lying detached beside it. A negation of the shot's
                own subject must live in the FORBID block, not next to the
                subject. This gate measures the distance between them.
  passport      The shoe is knit and foam with a row of cut-outs through the
                midsole. Three films running, the upper came out as crazed
                leather because the wording let it.
  brand         This is an advert. No lettering, no wordmark, anywhere.
  people        Bare hands, light grey short-sleeve polo, no face in macro.

THE SELF-TEST HAS TWO HALVES, and the first version of this file only had one.
Mutating a good prompt proves a rule CAN fire. It does not prove the rule stays
quiet on correct wording. Run against real prompts, the one-sided version
reported 136 problems, most of them its own false alarms: "pan" was matching
inside "panel", and every prompt that properly forbade gloves or leather was
reported for containing the word. So CLEAN_CASES now runs alongside MUTATIONS
and a false alarm fails the self-test exactly like a missed mutation does.

Usage:
  gate_soleso_prompts.py <dir-of-shot-json>
  gate_soleso_prompts.py --self-test
"""
from __future__ import annotations

import argparse
import io
import json
import re
from pathlib import Path

# Movement words that mean THE CAMERA moved.
CAMERA_MOVES = [
    "pan", "pans", "panning", "tilt", "tilts", "tilting", "push in", "pushes in",
    "pushing in", "pull back", "pulls back", "pulling back", "zoom", "zooms",
    "zooming", "orbit", "orbits", "orbiting", "dolly", "dollies", "tracking shot",
    "handheld", "widen", "widens", "widening", "crane", "steadicam", "slow push",
    "camera drifts", "camera drift", "camera moves", "camera creeps", "camera sweeps",
]
# A negation of a word that is also the shot's subject is only safe inside FORBID.
SUBJECT_WORDS = ["foam", "steam", "cut-out", "cut-outs", "lace", "laces", "knit",
                 "midsole", "brush", "bristle", "bristles", "water"]
NEG = r"(?:no|not|never|without|nothing)"

REQUIRED_FORBID = [
    (r"letter|lettering|wordmark|text", "no lettering anywhere in frame"),
    (r"logo|emblem|swoosh|badge|monogram", "no logo/emblem/swoosh/badge on the shoes"),
    (r"watermark|timestamp|caption|subtitle", "no burned-in caption/timestamp/watermark"),
]
# These may appear ONLY inside a negation ("no gloves", "never leather"). Naming
# one positively is the fault; forbidding it is the prompt doing its job.
BANNED_ANYWHERE = [
    (r"\bglove[sd]?\b", "gloves appear; the owner works bare-handed"),
    # Only pink WORN or HELD matters -- the reference shop's pink gloves are their
    # signature. Pink skin from hot water is just a hand.
    (r"\bpink\b(?!\s+(from|with|where|because))(?![^.]{0,30}\bskin\b)", "pink appears; that is the reference shop's signature colour"),
    (r"\bleather\b", "the upper reads as leather"),
]


def check_motion(mp: str) -> list[str]:
    bad = []
    n = len(mp.split())
    if not 25 <= n <= 55:
        bad.append(f"motion prompt is {n} words, outside 25-55")
    first = re.sub(r"[^A-Za-z]", "", mp.split()[0]) if mp.split() else ""
    if not first.lower().endswith("ing"):
        bad.append(f"motion prompt opens with {first!r}, not an -ing verb")
    c = mp.count("Camera not moving.")
    if c != 1:
        bad.append(f"'Camera not moving.' appears {c} times, must be exactly once")
    if "Sound:" not in mp:
        bad.append("motion prompt has no 'Sound:' line")
    if "No music, no voices, no dialogue." not in mp:
        bad.append("motion prompt is missing the no-music tail")
    return bad


def forbidding(window: str) -> bool:
    """Does the text immediately before an offset put it inside a prohibition?"""
    if re.search(NEG + r"\b[^.;]*$", window):
        return True
    return bool(re.search(r"(does not|do not|cannot|is not|are not|rather than|instead of)\b[^.;]*$", window))


def check_camera(text: str, where: str) -> list[str]:
    low = text.lower()
    hits = []
    for phrase in CAMERA_MOVES:
        # Word boundaries on BOTH ends. Without them "pan" fires inside "panel"
        # and "expand", which was most of this gate's first real-run output.
        for m in re.finditer(r"\b" + re.escape(phrase) + r"\b", low):
            if forbidding(low[max(0, m.start() - 70):m.start()]):
                continue
            hits.append(f"{where}: camera movement {phrase!r}")
    return hits


def forbid_block(still: str) -> str:
    """Everything from the last FORBID heading onward."""
    last = None
    for last in re.finditer(r"\bFORBID\b", still):
        pass
    return still[last.start():] if last else ""


def check_negation_distance(still: str) -> list[str]:
    """A negated subject word outside the FORBID block is how a subject gets erased."""
    fb = forbid_block(still)
    body = still[: len(still) - len(fb)] if fb else still
    low = body.lower()
    bad = []
    for w in SUBJECT_WORDS:
        pattern = r"\b" + NEG + r"\s+(?:\w+\s+){0,2}" + re.escape(w) + r"\b"
        for m in re.finditer(pattern, low):
            phrase = low[m.start():m.end()]
            # "nothing but the foam" admits the foam, it does not forbid it.
            if re.match(r"nothing but\b", phrase):
                continue
            # "not blocking the cut-outs" negates the blocking, not the cut-outs.
            if re.match(r"not \w+ing\b", phrase):
                continue
            seg = body[max(0, m.start() - 30):m.end() + 30].replace("\n", " ")
            bad.append(f"negated subject word {w!r} outside FORBID: ...{seg.strip()}...")
    return bad


def check_forbid(still: str) -> list[str]:
    fb = forbid_block(still)
    if not fb:
        return ["no FORBID block at all"]
    return [f"FORBID block does not cover: {label}"
            for pattern, label in REQUIRED_FORBID
            if not re.search(pattern, fb, re.I)]


def check_banned(still: str) -> list[str]:
    bad = []
    for pattern, label in BANNED_ANYWHERE:
        for m in re.finditer(pattern, still, re.I):
            if forbidding(still[max(0, m.start() - 60):m.start()].lower()):
                continue
            seg = still[max(0, m.start() - 40):m.end() + 40].replace("\n", " ")
            bad.append(f"{label}: ...{seg.strip()}...")
            break
    return bad


def check_passport(still: str) -> list[str]:
    """Only for shots that show the shoe."""
    low = still.lower()
    if not re.search(r"\bshoe|\bshoes|\bpair\b", low):
        return []
    bad = []
    if "knit" not in low:
        bad.append("passport: the knit upper is not stated")
    if "foam" not in low:
        bad.append("passport: the foam midsole is not stated")
    if not re.search(r"cut-?outs?", low):
        bad.append("passport: the row of midsole cut-outs is not stated")
    return bad


def body_only(still: str) -> str:
    """The prompt with its FORBID block removed.

    Prohibitions are SUPPOSED to live in FORBID. Scanning that block for banned
    words or camera moves reports every correct prompt: "no pan, no tilt, no
    zoom", "gloves of any colour", "leather, suede, patent" are all the prompt
    doing its job. Only the body is evidence of a fault.
    """
    fb = forbid_block(still)
    return still[: len(still) - len(fb)] if fb else still


# --- the verified action spec, encoded so it cannot quietly come back ---------
#
# Reconciled 2026-09-15 from three sources (a five-frames-per-shot re-watch, a
# model reading the source video natively, and pixel arithmetic). Each of these
# was a real error that shipped in a previous cut, so each is a hard check now.

# There is exactly ONE dispenser in the reference and it is used once, at s07.
# A previous version invented a squeeze bottle and built two shots on it, after
# mistaking a foam-loaded brush head for a rope of extruded foam.
DISPENSER_OK_IN = "s07"
# "nozzle tip" was in this list and fired on every steam shot, because a steam wand
# legitimately has a nozzle. What marks a dispenser is a CONTAINER or a HOSE behind
# it, or foam being emitted, so match those instead of the word nozzle.
DISPENSER_WORDS = (r"\b(squeeze bottle|squeeze[- ]bottle|dispenser|dispensing|"
                   r"extrud\w+|piped|pipe a bead|bead of foam|rope of foam|"
                   r"foam (flow\w+|pour\w+|emerg\w+) (out )?(of|from) (the )?(nozzle|tube|spout))\b")

# The steam nozzle is ROUND and TAPERS TO A POINT, pressed against the surface
# with no gap. It was written wide, flat and held off at a distance.
STEAM_WRONG = [
    (r"\bwide (and )?flat\b[^.]{0,40}(head|nozzle|steam)", "steam head described as wide/flat; it is round and tapered"),
    (r"(head|nozzle)[^.]{0,40}\bwide (and )?flat\b", "steam head described as wide/flat; it is round and tapered"),
    (r"garment[- ]steamer", "garment-steamer head; the reference nozzle is a narrow cone"),
    (r"\b(jet|blast\w*)\b[^.]{0,30}steam|steam[^.]{0,30}\b(jet|blast\w*)\b", "steam described as a jet or blast; it is in contact and stroked"),
    (r"steam[^.]{0,60}(fills the (whole )?frame|whiteout|white-out|obscur\w+ the shoe)", "a steam whiteout; measured, no such frame exists in the reference"),
]

# A locked camera means the SUBJECT must travel, or the shot is inert. The
# motion prompt has to name a distance.
# Distances get written in words as often as in digits ("eighteen centimetres",
# "six-centimetre strokes"), and the digits-only version of this rule reported
# three prompts that had stated their travel perfectly well.
_NUMWORD = (r"one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
            r"fifteen|eighteen|twenty|thirty")
TRAVEL_UNITS = (
    r"\b\d+(\.\d+)?\s*[- ]?(cm|centimetre|centimeter|mm|millimetre)"
    rf"|\b({_NUMWORD})[- ](cm|centimetre|centimeter|mm|millimetre)"
    rf"|\b({_NUMWORD})\s+(cm|centimetres?|centimeters?|mm|millimetres?)"
    r"|\bhalf\b|\bone third\b|\btwo thirds\b|\bquarter\b|\bshoe[- ]length"
    r"|\bhand'?s width\b|\bthumb'?s width\b|\bfinger'?s width\b"
)


def check_action(shot: dict) -> list[str]:
    """The four errors that shipped in earlier cuts."""
    sid = shot.get("id", "")
    still = shot.get("still_prompt", "")
    mp = shot.get("motion_prompt", "")
    body = body_only(still)
    bad = []

    if DISPENSER_OK_IN not in sid:
        for m in re.finditer(DISPENSER_WORDS, body, re.I):
            if forbidding(body[max(0, m.start() - 60):m.start()].lower()):
                continue
            seg = body[max(0, m.start() - 35):m.end() + 35].replace("\n", " ")
            bad.append(f"dispenser/extrusion language outside {DISPENSER_OK_IN}: ...{seg.strip()}...")
            break

    if "steam" in (sid + body).lower():
        for pattern, label in STEAM_WRONG:
            if re.search(pattern, body, re.I | re.S):
                bad.append(f"steam: {label}")

    if mp and not re.search(TRAVEL_UNITS, mp, re.I):
        bad.append("motion prompt states no concrete travel (no distance, no unit) -- "
                   "a locked camera with a still subject is what made the last cut inert")
    return bad


def check_shot(shot: dict) -> list[str]:
    still = shot.get("still_prompt", "")
    mp = shot.get("motion_prompt", "")
    if not still:
        return ["no still_prompt"]
    bad: list[str] = []
    if not mp:
        bad.append("no motion_prompt")
    else:
        bad += check_motion(mp)
        bad += check_camera(mp, "motion")
    bad += check_action(shot)
    bad += check_camera(body_only(still), "still")
    bad += check_forbid(still)
    bad += check_banned(body_only(still))
    bad += check_passport(still)
    bad += check_negation_distance(still)
    return bad


GOOD = {
    "id": "self-test",
    "still_prompt": (
        "CAMERA. One locked frame, vertical 9:16, 50mm-equivalent macro. The camera does not "
        "move.\n\n"
        "OBJECT PASSPORT. One chunky white running shoe: fine white engineered knit upper, thick "
        "white foam midsole with a row of large rounded-rectangular cut-outs punched through its "
        "side, a blank dark grey rubber toe bumper.\n\n"
        "STAGING. The shoe rests flat on the perforated steel tray. A thick white foam bead lies "
        "along the midsole. The owner's bare hand steadies the heel; his light grey short-sleeve "
        "polo cuff clips the frame edge.\n\n"
        "FORBID anywhere in frame: any lettering, wordmark, logo, emblem, swoosh, stripe or badge, "
        "on the shoes or anywhere else; any watermark, timestamp or burned-in caption; any second "
        "person or face."
    ),
    # Rewritten 2026-09-15 when the travel rule was added. The old fixture had the
    # owner squeezing a bottle and stated no distance -- both of which are now
    # exactly what the gate exists to catch, so it could not stay the known-good.
    "motion_prompt": (
        "Stroking the foam-loaded brush along the midsole, the owner draws it two thirds of a "
        "shoe-length toward the toe and stops, leaving one unbroken band of foam while the shoe "
        "stays flat on the tray. Camera not moving. Sound: bristles on wet foam. "
        "No music, no voices, no dialogue."
    ),
}

MUTATIONS = [
    ("camera move in the motion prompt",
     lambda s: {**s, "motion_prompt": s["motion_prompt"].replace("Camera not moving.", "Camera slowly pushes in. Camera not moving.")}),
    ("motion prompt too long",
     lambda s: {**s, "motion_prompt": s["motion_prompt"] + " " + ("extra " * 30)}),
    ("motion prompt does not open with an -ing verb",
     lambda s: {**s, "motion_prompt": "The owner squeezes " + s["motion_prompt"].split(" ", 2)[2]}),
    ("camera clause missing",
     lambda s: {**s, "motion_prompt": s["motion_prompt"].replace("Camera not moving. ", "")}),
    ("no-music tail missing",
     lambda s: {**s, "motion_prompt": s["motion_prompt"].replace(" No music, no voices, no dialogue.", "")}),
    ("camera move in the still prompt",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("STAGING.", "STAGING. The camera drifts left across the bench.")}),
    ("FORBID block dropped",
     lambda s: {**s, "still_prompt": s["still_prompt"][: s["still_prompt"].rindex("FORBID")]}),
    ("FORBID no longer covers logos",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("wordmark, logo, emblem, swoosh, stripe or badge", "stripe")}),
    ("gloves appear",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("bare hand", "gloved hand")}),
    ("the reference shop's signature colour appears",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("light grey short-sleeve", "pink short-sleeve")}),
    ("the upper is described as leather",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("engineered knit upper", "engineered leather upper")}),
    ("the knit upper is dropped from the passport",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("fine white engineered knit upper, ", "")}),
    ("the midsole cut-outs are dropped from the passport",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("with a row of large rounded-rectangular cut-outs punched through its side, ", "")}),
    ("a negation of the subject sits beside the subject",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("A thick white foam bead lies", "There is no foam anywhere yet. A thick white foam bead lies")}),
    # The four action errors that shipped in earlier cuts.
    ("a squeeze bottle outside s07",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("The owner's bare hand", "A squeeze bottle is held above the shoe. The owner's bare hand")}),
    ("foam described as an extruded bead",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("A thick white foam bead lies", "A rope of foam is extruded and lies")}),
    # These inject into STAGING, not after FORBID: body_only() strips everything from
    # the FORBID heading onward, so text appended at the very end is invisible to the
    # body checks by design. The first version of these two mutations appended, and
    # the self-test correctly reported them as missed.
    ("the steam head described as wide and flat",
     lambda s: {**s, "id": "s14-steam",
                "still_prompt": s["still_prompt"].replace(
                    "STAGING.", "STAGING. The steam nozzle is a wide and flat head laid on the midsole.")}),
    ("a steam whiteout",
     lambda s: {**s, "id": "s15-steam",
                "still_prompt": s["still_prompt"].replace(
                    "STAGING.", "STAGING. Steam fills the whole frame so the shoe is not visible.")}),
    ("a motion prompt with no concrete travel",
     lambda s: {**s, "motion_prompt": "Scrubbing steadily, the owner works the midsole area and then stops while "
                                      "the shoe stays flat on the tray. Camera not moving. Sound: bristles on wet "
                                      "foam. No music, no voices, no dialogue."}),
]

# The half that was missing. Correct wording must NOT be reported.
CLEAN_CASES = [
    ("the word 'panel' contains 'pan'",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("midsole with", "side panel and midsole with")}),
    ("gloves named inside a prohibition",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("bare hand", "bare hand, never a glove")}),
    ("leather named inside a prohibition",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("knit upper", "knit upper, never leather")}),
    ("the camera forbidding its own movement",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("does not move.", "does not move, does not zoom and does not orbit.")}),
    ("a negated subject word sitting inside the FORBID block",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("any watermark", "no foam on the laces, no steam anywhere, any watermark")}),
    ("steam described as drifting (the subject may move, the camera may not)",
     lambda s: {**s, "motion_prompt": s["motion_prompt"].replace("then stops", "letting vapour drift upward, then stops")}),
    ("a camera move forbidden inside the FORBID block",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("any watermark", "any pan, tilt, zoom, orbit or handheld move; any watermark")}),
    ("gloves and leather listed inside the FORBID block",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("any watermark", "gloves of any colour; leather, suede or patent; any watermark")}),
    ("the idiom 'nothing but' does not forbid what follows it",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("rests flat", "rests flat, with nothing but the foam touching the tray")}),
    ("'not blocking the cut-outs' negates the blocking, not the cut-outs",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("steadies the heel", "steadies the heel, not blocking the cut-outs")}),
    ("the word 'expand' contains 'pan'",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace("rests flat", "rests flat, the foam free to expand")}),
    # The dispenser IS allowed in s07, and steam wording must not fire on a correct description.
    ("the one legitimate dispenser, in s07",
     lambda s: {**s, "id": "s07-feed-foam-collar",
                "still_prompt": s["still_prompt"].replace("A thick white foam bead lies",
                    "A hose-fed dispenser nozzle feeds foam into the collar, and a thick white foam bead lies")}),
    ("a correctly described steam nozzle",
     lambda s: {**s, "id": "s14-steam",
                "still_prompt": s["still_prompt"] + "\n\nThe black steam nozzle is round and tapers to a point, "
                                                    "pressed against the midsole with no gap and stroked along it."}),
    ("a motion prompt whose travel is given in shoe-lengths",
     lambda s: {**s, "motion_prompt": "Sliding the shoe along the shaft, the owner draws it one shoe-length to the "
                                      "right under the turning drum, then stops. Camera not moving. Sound: bristles "
                                      "on wet rubber. No music, no voices, no dialogue."}),
    # Three false alarms the gate produced on real prompts, each now pinned.
    ("a travel written in words rather than digits",
     lambda s: {**s, "motion_prompt": "Dragging the flat bare hand along the midsole, heel toward toe, eighteen "
                                      "centimetres, stopping short of the toe bumper. Camera not moving. "
                                      "Sound: wet skin on foam. No music, no voices, no dialogue."}),
    ("a hyphenated travel",
     lambda s: {**s, "motion_prompt": "Scrubbing the knit fast, the palm blurring in six-centimetre strokes, then "
                                      "stopping with the hand flat. Camera not moving. Sound: palm on wet knit. "
                                      "No music, no voices, no dialogue."}),
    ("a steam wand's own nozzle tip",
     lambda s: {**s, "id": "s20-steam",
                "still_prompt": s["still_prompt"].replace(
                    "STAGING.", "STAGING. The round tapered nozzle tip beds into the knit with no gap.")}),
    ("skin reddened by hot water",
     lambda s: {**s, "still_prompt": s["still_prompt"].replace(
         "bare hand", "bare hand, the skin faintly damp and slightly pink from hot water,")}),
]


def self_test() -> int:
    print("SELF-TEST: a good prompt must pass, every mutation must be caught,")
    print("           and correct wording must not raise a false alarm.")
    print()
    base = check_shot(GOOD)
    if base:
        print("FAILED: the known-good prompt did not pass:")
        for b in base:
            print("   ", b)
        return 1
    print("  known-good prompt passes cleanly")
    print()

    missed = 0
    for name, mutate in MUTATIONS:
        new = [f for f in check_shot(mutate(GOOD)) if f not in base]
        if new:
            print(f"  caught       {name}")
            print(f"                 -> {new[0][:104]}")
        else:
            missed += 1
            print(f"  MISSED       {name}")

    print()
    false_alarms = 0
    for name, tweak in CLEAN_CASES:
        new = [f for f in check_shot(tweak(GOOD)) if f not in base]
        if new:
            false_alarms += 1
            print(f"  FALSE ALARM  {name}")
            print(f"                 -> {new[0][:104]}")
        else:
            print(f"  quiet        {name}")

    print()
    if missed or false_alarms:
        print(f"SELF-TEST FAILED: {missed} mutation(s) missed, {false_alarms} false alarm(s).")
        return 1
    print(f"SELF-TEST PASSED: {len(MUTATIONS)} mutations caught, "
          f"{len(CLEAN_CASES)} clean cases stayed quiet.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("directory", nargs="?")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if not args.directory:
        print("give a directory of shot json, or --self-test")
        return 2

    files = sorted(Path(args.directory).glob("*.json"))
    if not files:
        print(f"no shot json in {args.directory}")
        return 2

    total = 0
    for f in files:
        shot = json.loads(io.open(f, encoding="utf-8").read())
        bad = check_shot(shot)
        total += len(bad)
        print(f"{'ok  ' if not bad else 'FAIL'} {shot.get('id', f.stem):22} {len(bad)} problem(s)")
        for b in bad:
            print(f"       - {b}")
    print()
    print(f"{len(files)} shots checked, {total} problem(s)")
    print("NOTE: a clean gate means the TEXT is well formed. It says nothing about whether the")
    print("      generated picture is correct. Only frames can say that.")
    return 1 if total else 0


if __name__ == "__main__":
    raise SystemExit(main())
