#!/usr/bin/env python3
"""Replace Cloudtilt motion_prompt values with the 2026-09-15 fluidity rewrite.

Identity stays in the still. These words assert the driver, the contact, the
consequence, and the pace. Sources: GPT-6 Pro share 6aa95173 (D4-D9 candidates)
plus the same grammar applied to the remaining shots. Does not regenerate clips.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from gate_cloudtilt_motion import CAMERA_LOCK, check

PROMPTS = {
    "s01-00p00": (
        "Holding both shoes completely motionless with 0 cm displacement, "
        "maintaining unchanged laces, openings, contact shadows, and lighting "
        "while the editor uses this frame as a two-frame preview. "
        f"{CAMERA_LOCK} "
        "Sound: the quiet room tone of a wet workroom."
    ),
    "s02-00p07": (
        "The liquid keeps pouring across the On Cloudtilt forefoot throughout the "
        "clip, already moving when the shot begins. The existing foam ridge "
        "swells and travels across a 2 cm patch of wet mesh instead of sitting "
        "as a fixed white shape. Thin runoff sheets toward the toe edge and "
        "breaks into a few beads that leave the surface. The supporting glove "
        "holds the shoe without sliding it. The mesh darkens only where water "
        "passes and the charcoal toe rubber stays charcoal. "
        f"{CAMERA_LOCK} "
        "Sound: water hissing onto the shoe."
    ),
    "s03-04p03": (
        "The large white drum is already spinning rapidly on its axle and keeps "
        "spinning throughout; its bristle texture changes continuously with "
        "localized rotational blur. The hands guide the On Cloudtilt outsole "
        "8 cm toward screen left within the first 1.0 second, maintaining "
        "contact. Bristles bend at the contact patch and spring back after "
        "leaving it. Foam is swept into changing streaks; thin milky runoff "
        "and a few small droplets fall toward the lower edge. The shoe yields "
        "slightly against the gloves without changing its overall shape. "
        "Rotation, contact and runoff continue afterward. "
        f"{CAMERA_LOCK} "
        "Sound: a machine brush turning, bristles slapping wet rubber."
    ),
    "s04-05p07": (
        "The working hand draws the white brush 12 cm diagonally down-right "
        "along the On Cloudtilt midsole edge in one continuous working stroke, "
        "starting immediately. Bristles stay in contact, bend at the leading "
        "edge and recover behind the head. The existing foam is pushed into a "
        "travelling ridge; a thinner wet film remains on the path already "
        "crossed. The supporting glove braces the heel without sliding the "
        "shoe. A few small beads fall toward the tray. The midsole openings "
        "keep their shape. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s05-06p03": (
        "The narrow white wheel spins continuously around its stationary axle "
        "center; the moving rim has changing texture and localized rotational "
        "blur. Both hands feed the On Cloudtilt 6 cm toward screen left within "
        "the first 1.0 second while maintaining contact between the sole edge "
        "and the lower wheel rim. The contact band compresses locally, then "
        "recovers behind the wheel. A thin wet film is pushed aside; small "
        "foam threads and droplets descend from the contact area. The "
        "supporting gloves make small pressure corrections without releasing "
        "the shoe. Rotation and runoff continue afterward. "
        f"{CAMERA_LOCK} "
        "Sound: a machine brush turning, bristles slapping wet rubber."
    ),
    "s06-07p03": (
        "The working hand pulls the white brush 12 cm diagonally down-left "
        "from the On Cloudtilt forefoot toward the heel in one continuous "
        "stroke, starting immediately. Bristles stay pressed into the midsole "
        "edge, bend at the front of the head and recover behind it. Existing "
        "foam is carried across successive openings and leaves a thinner wet "
        "band on the path already crossed. The supporting glove keeps the "
        "tilted shoe from rotating. A few beads fall toward the tray. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s07-08p00": (
        "The narrow wheel keeps spinning throughout around a fixed axle, with "
        "changing rim texture and localized rotational blur. The hands move "
        "the On Cloudtilt heel 3 cm toward screen left along the lower contact "
        "edge within the first 1.0 second, keeping the collar pressed to the "
        "rim. Bristles compress at the contact band and recover behind it. "
        "Foam trails downward from the rim instead of riding the shoe as a "
        "fixed patch. The collar shape holds. Rotation continues afterward. "
        f"{CAMERA_LOCK} "
        "Sound: a machine brush turning, bristles slapping wet rubber."
    ),
    "s08-09p03": (
        "The interior brush head is already turning inside the On Cloudtilt "
        "collar and keeps turning throughout. The working hand pushes the head "
        "4 cm forward along the inner floor within the first 1.0 second. "
        "Bristles whip the lining, compress against the padded collar and "
        "drive foam up over the rim in a slow overflow. Two thick suds runs "
        "spill down the heel counter. The collar deforms outward under the "
        "head and springs back as it passes. "
        f"{CAMERA_LOCK} "
        "Sound: a muffled motor turning inside the shoe, wet bristles on foam padding."
    ),
    "s09-10p10": (
        "The interior brush head spins continuously inside the On Cloudtilt "
        "collar, its bristles whipping the lining throughout the shot. The "
        "hands advance the shoe 2 cm leftward over the rotating head within "
        "the first 1.0 second, then hold contact as foam overflows the rim. "
        "Suds spill down the heel counter in moving runs rather than a frozen "
        "collar of foam. Both hands stay outside the opening. The padded "
        "collar yields and recovers. "
        f"{CAMERA_LOCK} "
        "Sound: a muffled motor turning inside the shoe."
    ),
    "s10-11p03": (
        "The working hand pulls the brush 14 cm downward from the On Cloudtilt "
        "forefoot toward the heel along the medial midsole strip in one "
        "continuous stroke, starting immediately. Bristles stay in contact, "
        "bend at the leading edge and recover behind the head. Existing foam "
        "is drawn into a continuous travelling band; a thinner wet film remains "
        "on the path already crossed. The supporting glove keeps the vertical "
        "orientation without rotating the shoe. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s11-12p00": (
        "The large white drum keeps spinning rapidly throughout the shot, with "
        "continuously changing bristle streaks and localized rotational blur. "
        "The hands advance the On Cloudtilt outsole 3 cm toward screen left "
        "within the first 1.0 second, keeping the tread pressed against the "
        "rotating bristle band. Bristles compress against each raised rubber "
        "section and recover over the intervening grooves. The rotating "
        "contact redistributes the remaining thin foam into wet streaks; fine "
        "runoff falls downward while the original dark rubber becomes more "
        "visible. The sole retains its shape and openings. The drum continues "
        "spinning afterward. "
        f"{CAMERA_LOCK} "
        "Sound: a machine brush turning, bristles slapping wet rubber."
    ),
    "s12-13p00": (
        "The narrow wheel spins continuously around a stationary axle; the rim "
        "texture keeps changing with localized rotational blur. The hands "
        "slide the On Cloudtilt 4 cm toward screen left within the first 1.0 "
        "second while rolling the heel edge into the contact patch. The "
        "contact band compresses, then recovers behind the rim. Foam sheds "
        "downward instead of translating with the shoe as a rigid sticker. "
        "The supporting gloves make small pressure corrections without a "
        "regrip. Rotation continues afterward. "
        f"{CAMERA_LOCK} "
        "Sound: a machine brush turning, bristles slapping wet rubber."
    ),
    "s13-13p97": (
        "The working hand scrubs the On Cloudtilt forefoot with brisk 7 cm "
        "one-way strokes, diagonally down-left toward the toe and back "
        "up-right. It completes three full back-and-forth cycles every second, "
        "starting immediately and maintaining that rhythm throughout the clip. "
        "The supporting hand braces the rear. Bristles bend against the mesh "
        "on each stroke and flex the opposite way on the return without "
        "lifting. Foam ridges move ahead of the brush, leave thinner wet "
        "tracks behind, and release a few small beads near the sole edge. "
        "Blur affects the moving brush and glove, not the background. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s14-15p93": (
        "The working hand scrubs from the On Cloudtilt midsole junction onto "
        "the side mesh with 5 cm strokes diagonally up-right and back. It "
        "completes three full back-and-forth cycles every second, starting "
        "immediately. Bristles bend on the outbound stroke and reverse their "
        "flex on the return without lifting off. Foam gathers at each leading "
        "edge, then trickles toward the midsole. The supporting glove keeps "
        "the shoe from sliding. Only the moving brush and glove show "
        "directional blur. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s15-17p00": (
        "The black nozzle is already working over the On Cloudtilt side "
        "marking. The hand moves its tip 4 cm down-right toward the lower "
        "seam within the first 1.0 second while the supporting glove braces "
        "the shoe. Vapor emerges from the contact area, expands upward and "
        "dissipates rather than remaining a fixed cloud. Local foam collapses "
        "into a thinner wet film, and small runoff trails move toward the "
        "sole edge. The mesh stays naturally gray and wet. The nozzle "
        "continues working locally afterward. "
        f"{CAMERA_LOCK} "
        "Sound: steam hissing against wet fabric."
    ),
    "s16-18p03": (
        "The working hand scrubs the On Cloudtilt rear-quarter mesh with 6 cm "
        "one-way strokes along the existing contact strip. It completes three "
        "full back-and-forth cycles every second, starting immediately and "
        "continuing throughout the clip. The other hand braces the collar with "
        "small pressure adjustments. Bristles bend against the upper, reverse "
        "their flex on each return, and stay in contact. The mesh dimples "
        "slightly under pressure and recovers behind the brush. Foam gathers "
        "at each leading edge, shifts with the strokes, then trickles toward "
        "the midsole; the whole shoe does not slide. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s17-20p07": (
        "The working hand scrubs the On Cloudtilt side mesh toward the heel "
        "with 3 cm down-right strokes and matching returns. It completes three "
        "full back-and-forth cycles every second, starting immediately. "
        "Bristles compress on the outbound stroke and reverse on the return "
        "without lifting. Foam gathers below the contact strip and is combed "
        "into moving streaks instead of a static crust. The vertically "
        "oriented shoe stays braced. Only the moving brush shows directional "
        "blur. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s18-21p10": (
        "The black nozzle works immediately over the On Cloudtilt side-marking "
        "area. The hand guides it 3 cm leftward within the first 1.0 second "
        "while the other glove keeps the collar supported. Vapor forms near "
        "the tip, spreads upward and thins into the air. Foam retreats locally "
        "into narrow moving wet trails, revealing the existing gray textile "
        "without changing the side marking. Small droplets drain toward the "
        "tray. The nozzle continues treating the same small area afterward. "
        f"{CAMERA_LOCK} "
        "Sound: steam hissing against wet fabric."
    ),
    "s19-22p10": (
        "The narrow brush works 1 cm into and out of a single On Cloudtilt "
        "midsole opening, starting immediately and repeating that short stroke "
        "throughout the first 1.0 second. Bristles flex against the lower lip "
        "and recover as they withdraw. Residue loosens along the lip; a thin "
        "wet film redistributes around the opening without enlarging it. The "
        "supporting glove holds the shoe still. The opening keeps its shape. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s20-23p10": (
        "The working hand scrubs the On Cloudtilt heel panel with brisk 4 cm "
        "upward and downward strokes between the lower heel and collar. It "
        "completes three full back-and-forth cycles every second, beginning "
        "immediately and maintaining that rhythm throughout. The support hand "
        "presses the collar gently from above without changing its grip. "
        "Bristles spread under pressure and reverse their flex on each return. "
        "The heel fabric yields locally and recovers; foam forms shifting "
        "vertical streaks and slowly runs toward the sole. The original heel "
        "marking and overall silhouette remain intact. Only moving parts show "
        "directional blur. "
        f"{CAMERA_LOCK} "
        "Sound: bristles scrubbing wet mesh."
    ),
    "s21-25p07": (
        "The black nozzle is already working along the right inner collar of "
        "the On Cloudtilt. The hand traces a 3 cm path along that edge within "
        "the first 1.0 second while the supporting glove steadies the distant "
        "end. Vapor rises from the heel cavity, spills over the collar and "
        "dissipates instead of hanging as a fixed cloud. Condensation beads "
        "form on the lining and run outward. The cavity stays a natural gray "
        "interior, not a black hole. Local treatment continues afterward. "
        f"{CAMERA_LOCK} "
        "Sound: steam hissing against wet fabric."
    ),
    "s22-26p10": (
        "The folded cloth sweeps 4 cm rightward along the On Cloudtilt midsole "
        "edge, starting immediately. The fabric bunches into travelling "
        "wrinkles ahead of the hand. A film of water peels off the rubber and "
        "breaks into separate beads that slide down and drop off the edge. "
        "The cloth darkens as it soaks. Behind the pass the midsole reads "
        "drier and matte, while the charcoal toe rubber stays charcoal and "
        "uncovered. The supporting glove holds the rear still. "
        f"{CAMERA_LOCK} "
        "Sound: damp cotton dragging on rubber, a single water drop landing."
    ),
    "s23-27p10": (
        "The folded cloth wipes 3 cm leftward along the On Cloudtilt midsole "
        "edge while the supporting hand feeds the shoe 2 cm left, revealing "
        "the next openings. The fabric bunches ahead of the pass; a thin water "
        "film peels into beads that drop off the edge. Openings keep their "
        "shape and the charcoal toe rubber stays charcoal. Behind the cloth "
        "the midsole reads drier. The cream apron and its embroidery stay in "
        "place. "
        f"{CAMERA_LOCK} "
        "Sound: damp cotton dragging on rubber."
    ),
}


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    path = job / "prompts" / "shots.json"
    shots = json.loads(io.open(path, encoding="utf-8").read())
    missing = [s["id"] for s in shots if s["id"] not in PROMPTS]
    extra = [k for k in PROMPTS if k not in {s["id"] for s in shots}]
    if missing or extra:
        print("id mismatch", missing, extra)
        return 1
    problems = 0
    for s in shots:
        p = PROMPTS[s["id"]]
        bad = check(s["id"], p)
        n = len(p.split())
        if bad:
            problems += 1
            print(f"  FAIL {s['id']:14} {n:3}w  {bad}")
        else:
            print(f"  ok   {s['id']:14} {n:3}w")
        s["motion_prompt"] = p
    if problems:
        print(f"{problems} prompt(s) fail the gate -- not written")
        return 1
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(shots, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(shots)} motion prompts to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
