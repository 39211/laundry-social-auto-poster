#!/usr/bin/env python3
"""Queue the 30-second extension takes without any new image generation.

Codex hit its usage limit on 2026-09-17 (back on 2026-09-19 17:01), so neither the
fresh palm side/heel frames nor the mid-action edits of the unused V3 frames could
be made. Two sources need no image model at all:

  * the V3 first frames themselves, unchanged. Codex's own cut fed four of them in
    as-is (long brush, inside, detail, nozzle) and those shots held up; the risk is
    the machine setups, whose frames show a crisp, stopped brush -- those get one
    try each and are measured before use.
  * a frame lifted from a clip that already moves. A frame from late in Codex's
    drum and narrow-wheel takes already shows the brush spinning with rotational
    blur, which is exactly the state a first frame should be in.

Palm side and heel are generated at 2 s: on 2026-09-17 the five forefoot takes
showed that the 2 s generations scrub at 2.95-3.09 cycles a second against
2.46-2.65 for the 4 s ones, and the reference runs at about 3.0.

A manifest whose submission already exists is never rewritten -- generate_shot.py
pins each generation id to its manifest's hash.

Usage: write_extend_takes.py <reel-job-dir>
"""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

PALM = (
    "The working pink glove scrubs the foamy On Cloudtilt {area} fast, at a real shoe "
    "cleaner's full working speed. The transparent palm brush makes short, rapid "
    "{stroke}-centimetre strokes {path}, three complete back-and-forth strokes every "
    "second, in full swing from the first frame to the last. The bristles stay pressed on "
    "the mesh and flip direction at every turn. Foam is shoved into ridges ahead of the "
    "brush and flicked off in small drips, leaving thinner wet tracks. The working glove is "
    "smeared by motion blur. The other glove {support}. The camera remains completely "
    "stationary. Sound: brisk wet scrubbing."
)

PALM_TAKES = [
    # name, V3 still, area, stroke cm, path, support, takes
    ("side", "s14-15p93", "lateral side mesh", 6,
     "diagonally up from the midsole onto the side mesh and back", "braces the collar", 2),
    ("side2", "s17-20p07", "side mesh", 5,
     "down toward the heel across the side mesh and back", "holds the shoe upright", 1),
    ("rear", "s16-18p03", "rear quarter", 5,
     "up and down across the rear quarter mesh", "presses the upper from above", 1),
    ("heel", "s20-23p10", "heel panel", 4,
     "up the heel toward the collar and back down", "presses on the collar from above", 2),
]


def written_already(job: Path, gen_id: str) -> bool:
    return (job / "jobs" / (hashlib.sha256(gen_id.encode()).hexdigest() + ".json")).exists()


def write(job: Path, name: str, m: dict) -> None:
    if written_already(job, m["generation_id"]):
        print(f"  keep {name} (already submitted)")
        return
    io.open(job / f"{name}.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(m, ensure_ascii=False, indent=2) + "\n")
    print(f"  {name:28} {m['duration_seconds']}s  {len(m['prompt'].split())} words  <- {m['input_image']}")


def grab(src: Path, frame: int, dst: Path) -> None:
    if dst.exists():
        return
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vf", f"select=eq(n\\,{frame})",
                    "-frames:v", "1", str(dst), "-y"], check=True, capture_output=True)


def main() -> int:
    reel = Path(sys.argv[1]).resolve()
    shots = {s["id"]: s for s in json.loads(io.open(reel / "prompts" / "shots.json",
                                                    encoding="utf-8").read())}

    pj = reel / "palm-regen"
    (pj / "inputs").mkdir(exist_ok=True)
    print("palm-regen:")
    for tag, still, area, stroke, path, support, n in PALM_TAKES:
        inp = pj / "inputs" / f"v3-{still}.png"
        if not inp.exists():
            shutil.copyfile(reel / f"{still}.png", inp)
        prompt = PALM.format(area=area, stroke=stroke, path=path, support=support)
        for k in range(1, n + 1):
            name = f"palm-{tag}-d2t{k}"
            write(pj, name, {
                "generation_id": f"SXJ-CT-PALMREGEN-20260917-{tag.upper()}-V3-D2T{k}",
                "input_image": f"inputs/v3-{still}.png", "output_file": f"clips/{name}.mp4",
                "duration_seconds": 2, "prompt": prompt})

    ej = reel / "extend"
    print("extend:")
    for still in ("s06-07p03", "s07-08p00", "s09-10p10", "s10-11p03",
                  "s11-12p00", "s12-13p00", "s21-25p07", "s22-26p10"):
        act = ej / f"act-{still}.png"
        if not act.exists():
            # The Codex mid-action edit could not be made; use the V3 frame as it is.
            shutil.copyfile(reel / f"{still}.png", act)
        name = f"act-{still}-t1"
        write(ej, name, {
            "generation_id": f"SXJ-CT-EXTEND-20260917-{still.upper().replace('-', '')}-T1",
            "input_image": act.name, "output_file": f"clips/{name}.mp4",
            "duration_seconds": 4, "prompt": shots[still]["motion_prompt"]})

    cx = reel.parent / "codex-cloudtilt-20260916"
    lifted = [
        # name, source clip, frame, motion prompt borrowed from
        ("drumB", "drum-v1.mp4", 90, "s11-12p00"),
        ("narrowB", "narrow-v2.mp4", 66, "s12-13p00"),
    ]
    for tag, clip, frame, prompt_from in lifted:
        inp = ej / f"lift-{tag}.png"
        grab(cx / clip, frame, inp)
        name = f"lift-{tag}-t1"
        write(ej, name, {
            "generation_id": f"SXJ-CT-EXTEND-20260917-LIFT-{tag.upper()}-T1",
            "input_image": inp.name, "output_file": f"clips/{name}.mp4",
            "duration_seconds": 4, "prompt": shots[prompt_from]["motion_prompt"]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
