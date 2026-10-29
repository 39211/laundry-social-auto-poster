#!/usr/bin/env python3
"""Write the job that turns unused V3 first frames into mid-action frames, for a 30 s cut.

The owner, 2026-09-17: the reference runs 30 seconds; ours runs 14.5. He also
said earlier that a shot type shown once is enough and repeats only expose flaws.
The reference squares that circle by repeating a TOOL on a DIFFERENT PART of the
shoe -- two drum passes, three narrow-wheel passes, three long-brush strokes -- and
so does this job.

Codex's 2026-09-16 cut showed how to get frames that move: take an existing V3
first frame and edit ONLY its operating state -- the brush already spinning with
local rotational blur, bristles compressed at contact, a foam ridge building at the
exit, the working glove smeared, and any machine that is not part of the step
replaced with plain splashback. Eight V3 setups were never used; seven are edited
here and one (s22, the owner wiping at the dry bench) is already a hand shot.

Motion prompts come from prompts/shots.json, where they were rewritten on
2026-09-16 to the fluidity contract and already pass gate_cloudtilt_motion.py.

Usage: write_extend_job.py <reel-job-dir>
"""
from __future__ import annotations

import io
import json
import shutil
import sys
from pathlib import Path

KEEP = (
    " Preserve the On Cloudtilt exactly as it is: grey engineered mesh, grey On marking, "
    "red tab on the lateral rear, pale ivory midsole with its through-openings, grey "
    "speed-laces, and the small charcoal toe tip, which is part of the shoe and not dirt. "
    "Keep the gloves, the tray, the framing and the light. It must read as one frame pulled "
    "from real phone footage of active work, not a product photograph. No global blur, no "
    "new text or labels, no extra hands or tools, no whitening of the shoe."
)

EDITS = {
    "s06-07p03": (
        "THE CHANGE: this is halfway through a brisk stroke with the long-handled white brush. "
        "The working pink glove and the brush head show short directional motion blur along "
        "the stroke, the white bristles are bent against the midsole, an uneven foam ridge is "
        "pushed ahead of them and thin milky runoff drips onto the tray. The white bristle drum "
        "at the upper left is not part of this step: replace it with plain wet brushed "
        "stainless splashback that matches the perspective and light." + KEEP),
    "s07-08p00": (
        "THE CHANGE: the white bristle wheel on the steel axle is already spinning fast. Its "
        "bristle ring shows strong circumferential motion blur with unresolved streaks, while "
        "the black hub and the axle stay sharp and exactly in place. Where the heel and midsole "
        "press against the wheel the bristle tips are bent and compressed; a small foam line "
        "builds where the bristles leave the shoe and thin milky water runs down onto the tray. "
        "Any other brush visible behind is spinning and blurred too." + KEEP),
    "s09-10p10": (
        "THE CHANGE: the small round cleaning head on the horizontal steel shaft, pushed into "
        "the collar, is spinning fast: its white bristles are a circular motion-blur smear. "
        "Foam is churned up out of the collar opening and spills over the heel in a short "
        "milky overflow that drips onto the tray. The shaft and the machine body stay sharp "
        "and in place." + KEEP),
    "s10-11p03": (
        "THE CHANGE: this is halfway through a brisk stroke along the medial midsole strip. "
        "The brush head and the working pink glove show short directional motion blur along "
        "the stroke, the bristles are bent against the midsole, a foam ridge is pushed ahead "
        "of them, a thinner wet track shows behind, and drips fall onto the tray." + KEEP),
    "s11-12p00": (
        "THE CHANGE: the motor is already spinning the white cylindrical brush fast. The "
        "bristle sleeve has realistic circumferential motion blur with unresolved streaks, "
        "like a real 1/60 shutter frame, while the hub and the steel axle stay sharp and in "
        "place. At the contact band the bristle tips are bent and compressed against the dark "
        "rubber outsole without passing into it. A modest uneven wet foam ridge builds just "
        "downstream of the contact, narrow milky runoff is pulled downward, and short wet "
        "swept tracks remain behind. Nothing sprays theatrically." + KEEP),
    "s12-13p00": (
        "THE CHANGE: both brushes on the machine are already spinning fast. The white bristle "
        "ring and the green brush behind it both show circumferential motion blur, while "
        "their hubs, the axle and the housing stay sharp and in place. The heel edge presses "
        "into the white brush: the bristle tips are bent and compressed there, a short foam "
        "ridge builds where they leave the shoe, and milky runoff drips from the contact." + KEEP),
    "s21-25p07": (
        "THE CHANGE: the black nozzle inside the collar is blowing steam. A real white vapour "
        "plume rises out of the collar opening and thins as it disperses upward, and a few "
        "condensation beads sit on the inner collar. The white bristle drum at the upper "
        "right is not part of this step: replace it with plain wet brushed stainless "
        "splashback that matches the perspective and light." + KEEP),
}
AS_IS = ["s22-26p10"]


def main() -> int:
    reel = Path(sys.argv[1]).resolve()
    job = reel / "extend"
    (job / "prompts").mkdir(parents=True, exist_ok=True)
    (job / "clips").mkdir(exist_ok=True)
    shots = {s["id"]: s for s in json.loads(io.open(reel / "prompts" / "shots.json",
                                                    encoding="utf-8").read())}

    edits = [{"id": f"act-{k}", "still_prompt": v, "motion_prompt": ""} for k, v in EDITS.items()]
    io.open(job / "prompts" / "edits.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(edits, ensure_ascii=False, indent=2) + "\n")
    anchors = {f"V3_{k.split('-')[0].upper()}": f"output/{reel.name}/{k}.png" for k in EDITS}
    refmap = {
        "_note": "30 秒延長。每一張都是對自己那張 V3 首幀做 -Mode edit,只改運作狀態。",
        "_anchors": anchors,
        "shots": {f"act-{k}": [f"V3_{k.split('-')[0].upper()}"] for k in EDITS},
    }
    io.open(job / "prompts" / "reference-map.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(refmap, ensure_ascii=False, indent=2) + "\n")

    for k in AS_IS:
        dst = job / f"act-{k}.png"
        if not dst.exists():
            shutil.copyfile(reel / f"{k}.png", dst)

    for k in list(EDITS) + AS_IS:
        m = {"generation_id": f"SXJ-CT-EXTEND-20260917-{k.upper().replace('-', '')}-T1",
             "input_image": f"act-{k}.png", "output_file": f"clips/act-{k}-t1.mp4",
             "duration_seconds": 4, "prompt": shots[k]["motion_prompt"]}
        io.open(job / f"act-{k}-t1.json", "w", encoding="utf-8", newline="\n").write(
            json.dumps(m, ensure_ascii=False, indent=2) + "\n")
        print(f"  act-{k}-t1  {len(m['prompt'].split())} words  "
              f"{'edit' if k in EDITS else 'as-is'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
