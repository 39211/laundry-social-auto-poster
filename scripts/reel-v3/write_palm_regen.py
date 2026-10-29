#!/usr/bin/env python3
"""Write the palm-brush regeneration job: first-frame prompts and I2V manifests.

The owner, 2026-09-17: regenerate the palm brush so it is as fast as the
reference. Measured with stroke_rate.py, the reference's three palm shots all
run at about 3.0 full back-and-forth cycles a second with a stroke 13-26% of the
frame high. Codex's palm-v2 -- the take in the current cut -- is one slow sweep
with a wobble (0.70 c/s by FFT); its rejected sibling palm-v1, from an almost
identical prompt, already runs at 2.65-2.97 c/s. So speed here is mostly the
draw of the dice, and the job is built to be rolled several times and measured,
not worded harder.

Three shots, as the reference has them:
  forefoot   the existing Codex active frame, no machinery in view
  side       new active frame: shoe on its side, lateral mesh to the lens
  heel       new active frame: heel to the lens, supporting glove on the collar

Forefoot is rolled five times: three at 4 s, two at 2 s, to learn whether a
shorter generation makes the model fit the same scrubbing in faster.

Usage: write_palm_regen.py <job-dir>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

MOTION = (
    "The working pink glove scrubs the foamy On Cloudtilt {area} fast, at a real shoe "
    "cleaner's full working speed. The transparent palm brush makes short, rapid "
    "{stroke}-centimetre strokes {path}, three complete back-and-forth strokes every "
    "second, in full swing from the first frame to the last. The bristles stay pressed on "
    "the mesh and flip direction at every turn. Foam is shoved into ridges ahead of the "
    "brush and flicked off in small drips, leaving thinner wet tracks. The working glove is "
    "smeared by motion blur. The "
    "other glove {support}. The camera remains completely stationary. "
    "Sound: brisk wet scrubbing."
)

SHOTS = {
    "forefoot": dict(area="forefoot", stroke=6,
                     path="diagonally toward the toe and straight back toward the laces",
                     support="holds the heel still"),
    "side": dict(area="lateral side mesh", stroke=6,
                 path="along the side of the shoe just above the midsole and back",
                 support="pins the upper down"),
    "heel": dict(area="heel panel", stroke=4,
                 path="up the heel toward the collar and back down",
                 support="presses on the collar from above so the shoe cannot tip"),
}

STILL_COMMON = (
    "A documentary video frame from a phone held about 20 centimetres away, captured "
    "halfway through a brisk scrubbing stroke in a shoe-cleaning wet room. Vertical 9:16. "
    "This is an On Cloudtilt: pale grey engineered mesh upper, grey On logo on the side, "
    "grey elastic speed-laces, a padded grey sock collar, a small red tab on the lateral "
    "rear only, a pale ivory midsole with a row of rounded through-openings, dark grey "
    "outsole rubber, and a small charcoal rubber tip on the toe that is part of the shoe "
    "and not dirt. The shoe is dirty and wet, mid-wash. Both hands wear glossy pink nitrile "
    "gloves. The working glove holds a transparent palm brush with short white bristles and "
    "is smeared by motion blur along its stroke, while the shoe and the supporting glove "
    "stay sharp. Thick white foam sits on the mesh, pushed into an uneven ridge ahead of the "
    "brush, with thinner wet tracks behind and drips falling to the tray. Wet perforated "
    "stainless steel tray below, brushed stainless wall behind, soft even workshop light. "
    "No machines, no rotating brushes, no nozzle, no hose anywhere in frame. No caption, no "
    "text, no watermark, no split screen, no second shoe."
)

STILLS = {
    "first-side": (
        "FRAMING: extreme close-up on the lateral side of the shoe. The On Cloudtilt lies on "
        "its medial side on the tray so its lateral side faces the lens, toe toward the left "
        "edge, heel toward the right. One pink glove presses down on the upper from the top "
        "left of the frame. The working glove and brush cross the lateral mesh just above "
        "the midsole in the middle of the frame. The shoe fills most of the frame; the toe tip "
        "and heel may be cut by the frame edges. " + STILL_COMMON
    ),
    "first-heel": (
        "FRAMING: extreme close-up on the heel. The On Cloudtilt stands upright on the tray "
        "with its heel pointing straight at the lens. One pink glove presses on the collar "
        "from above at the top of the frame. The working glove scrubs the heel panel in the "
        "lower half of the frame, bristles bent against the heel; foam runs down the heel in "
        "vertical streaks. The heel fills most of the frame. " + STILL_COMMON
    ),
}


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    (job / "prompts").mkdir(parents=True, exist_ok=True)
    (job / "clips").mkdir(exist_ok=True)

    stills = [{"id": k, "still_prompt": v, "motion_prompt": ""} for k, v in STILLS.items()]
    io.open(job / "prompts" / "stills.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(stills, ensure_ascii=False, indent=2) + "\n")
    rel = f"output/{job.parent.name}/{job.name}/inputs"
    refmap = {
        "_note": "掌刷重生首幀。以 Codex 的前掌作業首幀當場景與人物參考(粉紅手套、沖孔盤、不鏽鋼牆),另附物件正本鎖鞋款。",
        "_anchors": {
            "FOREFOOT_ACTIVE": f"{rel}/palm-forefoot-a.png",
            "CLOUDTILT_DIRTY": "output/reel-cloudtilt-20260916/canon-dirty.png",
        },
        "shots": {k: ["FOREFOOT_ACTIVE", "CLOUDTILT_DIRTY"] for k in STILLS},
    }
    io.open(job / "prompts" / "reference-map.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(refmap, ensure_ascii=False, indent=2) + "\n")

    takes = [
        ("forefoot", "inputs/palm-forefoot-a.png", 4, "t1"),
        ("forefoot", "inputs/palm-forefoot-a.png", 4, "t2"),
        ("forefoot", "inputs/palm-forefoot-a.png", 4, "t3"),
        ("forefoot", "inputs/palm-forefoot-a.png", 2, "d2t1"),
        ("forefoot", "inputs/palm-forefoot-a.png", 2, "d2t2"),
        ("side", "inputs/first-side.png", 4, "t1"),
        ("side", "inputs/first-side.png", 4, "t2"),
        ("heel", "inputs/first-heel.png", 4, "t1"),
        ("heel", "inputs/first-heel.png", 4, "t2"),
    ]
    for shot, still, dur, tag in takes:
        name = f"palm-{shot}-{tag}"
        prompt = MOTION.format(**SHOTS[shot])
        m = {"generation_id": f"SXJ-CT-PALMREGEN-20260917-{shot.upper()}-{tag.upper()}",
             "input_image": still, "output_file": f"clips/{name}.mp4",
             "duration_seconds": dur, "prompt": prompt}
        io.open(job / f"{name}.json", "w", encoding="utf-8", newline="\n").write(
            json.dumps(m, ensure_ascii=False, indent=2) + "\n")
        print(f"  {name:22} {dur}s  {len(prompt.split())} words  <- {still}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
