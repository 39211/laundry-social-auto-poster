#!/usr/bin/env python3
"""Write the six new I2V manifests for the shoe-washing film.

Every prompt here is held to the rules the adversarial pass produced on
2026-09-12, each of which was earned by a real failure:

  * 25-55 words, opening on a verb, describing only what CHANGES from the still.
  * Every verb has a subject. A subjectless "Slides the shoe" makes the model
    pick the object as the actor.
  * The Sound clause names ONLY contacts that actually happen in the shot.
    Grok's sound field behaves as a second motion prompt: naming a sound invites
    it to animate that contact, which is how things nobody asked for start moving.
  * Nothing is lifted or tilted toward the lens.
  * Where the face is in frame, the mouth is stated closed. The video model has
    no audio input, so any visible speech cannot sync with the voice-over.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

JOB = Path("C:/Users/cyc39/laundry-repo/output/reel-shoe-wash-20260912")

SHOTS = [
    {
        "id": "S01-INTAKE",
        "still": "s01-intake.png",
        "out": "s01-intake-raw.mp4",
        "seconds": 4,
        "prompt": "Withdrawing, the two hands lift away out of the top of the frame and the shoes settle "
                  "on the mat. Both stay filthy, both side panels stay blank. Camera not moving. "
                  "Sound: a rubber sole tapping a counter, gritty canvas settling. "
                  "No music, no voices, no dialogue.",
    },
    {
        "id": "S02-EXPLAIN",
        "still": "s02-explain.png",
        "out": "s02-explain-raw.mp4",
        "seconds": 6,
        "prompt": "Sliding his fingertip onto the grimy canvas, he traces once along the seam above the "
                  "foxing band, then rests it there. His eyes stay down, his mouth closed. "
                  "Camera not moving. Sound: a fingertip dragging on dry canvas, quiet shop room tone. "
                  "No music, no voices, no dialogue.",
    },
    {
        "id": "S06-DRY",
        "still": "s06-dry.png",
        "out": "s06-dry-raw.mp4",
        "seconds": 5,
        "prompt": "Stirring in the moving air, the coiled laces shift a little and one drop gathers under the "
                  "foxing band and falls. The shoe stays damp and does not move. Camera not moving. "
                  "Sound: a low fan hum, one drop ticking on wire. No music, no voices, no dialogue.",
    },
    {
        "id": "S07-INSPECT",
        "still": "s07-inspect.png",
        "out": "s07-inspect-raw.mp4",
        "seconds": 4,
        "prompt": "Running his thumb slowly along the foxing band from toe to heel, he keeps his eyes down and "
                  "his mouth closed. The shoe stays at chest height and never turns toward the camera. "
                  "Camera not moving. Sound: a thumb dragging on dry rubber, quiet shop room tone. "
                  "No music, no voices, no dialogue.",
    },
    {
        "id": "S08-PACK",
        "still": "s08-pack.png",
        "out": "s08-pack-raw.mp4",
        "seconds": 4,
        "prompt": "Settling flat on the mat, both hands go still and the shot holds. Neither shoe moves; the "
                  "clean one stays clean and the dirty one stays dirty. Camera not moving. "
                  "Sound: quiet shop room tone, a hand settling on a rubber mat. "
                  "No music, no voices, no dialogue.",
    },
    {
        "id": "S09-HANDOVER",
        "still": "s09-handover.png",
        "out": "s09-handover-raw.mp4",
        "seconds": 4,
        "prompt": "Pushing the bag a few centimetres further across the mat, both hands then open and withdraw "
                  "from the frame. The bag stays upright and flat on the mat. Camera not moving. "
                  "Sound: kraft paper shifting on a rubber mat, a shoe knocking softly inside the bag. "
                  "No music, no voices, no dialogue.",
    },
]


def main() -> int:
    bad = 0
    for s in SHOTS:
        words = len(s["prompt"].split())
        flags = []
        if not 25 <= words <= 55:
            flags.append(f"{words} words, outside 25-55")
        if s["prompt"].count("Camera not moving.") != 1:
            flags.append("camera clause missing or repeated")
        if not (JOB / s["still"]).exists():
            flags.append(f"still {s['still']} missing")
        if flags:
            bad += 1
            print(f"  FAIL {s['id']}: " + "; ".join(flags))
            continue

        manifest = {
            "generation_id": f"SXJ-SHOEWASH-20260913-{s['id']}-V1",
            "input_image": s["still"],
            "output_file": s["out"],
            "duration_seconds": s["seconds"],
            "prompt": s["prompt"],
        }
        path = JOB / (s["out"].replace("-raw.mp4", ".json"))
        io.open(path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        print(f"  ok {path.name}  {words} words  {s['seconds']}s")
    if bad:
        print(f"\n{bad} manifest(s) refused")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
