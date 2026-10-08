#!/usr/bin/env python3
"""Write the eight I2V manifests for the two-person shoe film.

Same rules the adversarial pass produced on 2026-09-12, each earned by a failure:

  * 25-55 words, opening on a verb, describing only what CHANGES from the still.
  * Every verb has a subject. A subjectless "Slides the shoe" makes the model
    pick the object as the actor.
  * The Sound clause names ONLY contacts that actually happen in the shot.
    Grok's sound field behaves as a second motion prompt: naming a sound invites
    it to animate that contact.
  * Nothing is lifted or tilted toward the lens.
  * Where a face is in frame the mouth is stated closed. The video model has no
    audio input, so any visible speech cannot sync with the voice-over.

Each clip is generated LONGER than the cut needs. Grok is stable around five to
eight seconds and build_master trims every shot to its narration length anyway,
so asking for exactly three seconds buys a worse clip and no time back.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

JOB = Path("C:/Users/cyc39/laundry-repo/output/reel-shoe-two-person-20260913")

SHOTS = [
    {
        "id": "T01-CUSTOMER-ARRIVES",
        "still": "t01-customer-arrives.png",
        "out": "t01-customer-arrives-raw.mp4",
        "seconds": 5,
        "cut": 4,
        "prompt": "Drawing his hand back off the mat, he straightens a little and keeps his eyes "
                  "down on the shoes with his mouth closed. Both shoes stay filthy and do not move. "
                  "Camera not moving. Sound: a rubber sole settling on a cutting mat, quiet shop "
                  "room tone. No music, no voices, no dialogue.",
    },
    {
        "id": "T02-INTAKE",
        "still": "t02-intake.png",
        "out": "t02-intake-raw.mp4",
        "seconds": 5,
        "cut": 3,
        "prompt": "Sliding both shoes a few centimetres toward himself across the mat, the man in "
                  "the apron rests his hands flat and still. The customer keeps his hands at his "
                  "sides and his mouth closed. Camera not moving. Sound: canvas dragging on a "
                  "cutting mat. No music, no voices, no dialogue.",
    },
    {
        "id": "T03-PREP",
        "still": "t03-prep.png",
        "out": "t03-prep-raw.mp4",
        "seconds": 8,
        "cut": 7,
        "prompt": "Pulling the last of the lace free, the hand lays it on the bench, takes up the "
                  "stiff brush and sweeps twice across the dry toe. Dust lifts off and the bench "
                  "stays dry. Camera not moving. Sound: lace sliding through metal eyelets, dry "
                  "bristles on canvas. No music, no voices, no dialogue.",
    },
    {
        "id": "T04-OUTSOLE",
        "still": "t04-outsole.png",
        "out": "t04-outsole-raw.mp4",
        "seconds": 5,
        "cut": 3,
        "prompt": "Scrubbing the brush back and forth twice across the upturned outsole, the hand "
                  "drives grey water and grit off the rubber down into the tray. The upper stays "
                  "dirty and stays dry. Camera not moving. Sound: stiff bristles on wet rubber, "
                  "water dripping into a steel tray. No music, no voices, no dialogue.",
    },
    {
        "id": "T07-DRYCABINET",
        "still": "t07-drycabinet.png",
        "out": "t07-drycabinet-raw.mp4",
        "seconds": 5,
        "cut": 4,
        "prompt": "Letting go of the shoe, both hands withdraw out of frame and it settles level on "
                  "the mesh shelf. The lace and insole beside it do not move; the violet light "
                  "stays steady. Camera not moving. Sound: a rubber sole settling on wire mesh, a "
                  "low fan hum. No music, no voices, no dialogue.",
    },
    {
        "id": "T10-BAGGING",
        "still": "t10-bagging.png",
        "out": "t10-bagging-raw.mp4",
        "seconds": 5,
        "cut": 3,
        "prompt": "Lowering the second shoe until only its heel shows above the rim, both hands let "
                  "go and draw back from the bag. The bag stays upright on the mat and neither shoe "
                  "changes colour. Camera not moving. Sound: canvas sliding against kraft paper, "
                  "paper creasing. No music, no voices, no dialogue.",
    },
    {
        "id": "T11-HANDOVER",
        "still": "t11-handover.png",
        "out": "t11-handover-raw.mp4",
        "seconds": 5,
        "cut": 3,
        "prompt": "Releasing the bag, the man in the apron draws both hands back, and the customer's "
                  "hand closes on the rim and takes its weight. Both men keep their eyes down and "
                  "their mouths closed. Camera not moving. Sound: kraft paper creasing under a "
                  "hand, quiet shop room tone. No music, no voices, no dialogue.",
    },
    {
        "id": "T12-CUSTOMER-CONFIRMS",
        "still": "t12-customer-confirms.png",
        "out": "t12-customer-confirms-raw.mp4",
        "seconds": 5,
        "cut": 3,
        "prompt": "Leaning in a little over the counter, he looks from the clean shoe across to the "
                  "dirty one and back again, and his eyebrows lift slightly. His mouth stays "
                  "closed. Neither shoe moves. Camera not moving. Sound: quiet shop room tone, a "
                  "hand shifting on a counter edge. No music, no voices, no dialogue.",
    },
]

# Shots whose still has a face in it; those prompts must state the mouth closed.
FACE_SHOTS = {"T01-CUSTOMER-ARRIVES", "T02-INTAKE", "T11-HANDOVER", "T12-CUSTOMER-CONFIRMS"}
LIFT_WORDS = ("lifts toward", "raises toward", "toward the camera", "toward the lens", "holds up")


def problems(s: dict) -> list[str]:
    p = s["prompt"]
    bad = []
    words = len(p.split())
    if not 25 <= words <= 55:
        bad.append("%d words, outside 25-55" % words)
    if p.count("Camera not moving.") != 1:
        bad.append("camera clause missing or repeated")
    if "Sound:" not in p:
        bad.append("no Sound clause")
    if "No music, no voices, no dialogue." not in p:
        bad.append("audio negative missing")
    if s["id"] in FACE_SHOTS and "mouth" not in p:
        bad.append("a face is in frame but the mouth is not pinned")
    for w in LIFT_WORDS:
        if w in p.lower():
            bad.append("something is lifted toward the lens: " + w)
    if s["seconds"] < s["cut"]:
        bad.append("generated %ss is shorter than the %ss the cut needs" % (s["seconds"], s["cut"]))
    if not (JOB / s["still"]).exists():
        bad.append("still %s not generated yet" % s["still"])
    return bad


def main() -> int:
    written = 0
    blocked = 0
    for s in SHOTS:
        bad = problems(s)
        if bad:
            blocked += 1
            print("  SKIP %-22s %s" % (s["id"], "; ".join(bad)))
            continue
        manifest = {
            "generation_id": "SXJ-SHOE2P-20260913-%s-V1" % s["id"],
            "input_image": s["still"],
            "output_file": s["out"],
            "duration_seconds": s["seconds"],
            "prompt": s["prompt"],
        }
        path = JOB / s["out"].replace("-raw.mp4", ".json")
        io.open(path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        written += 1
        print("  ok   %-22s %2d words  %ss generated for a %ss cut" % (
            s["id"], len(s["prompt"].split()), s["seconds"], s["cut"]))
    print()
    print("%d manifest(s) written, %d still waiting on a still" % (written, blocked))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
