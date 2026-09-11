#!/usr/bin/env python3
"""Produce one reel-v3 character reel end to end, resumably.

Usage:  python scripts/reel-v3/produce_day.py output/reel-v3/2026-09-15
        python scripts/reel-v3/produce_day.py <job-dir> --stills-only
        python scripts/reel-v3/produce_day.py <job-dir> --skip-stills

Every stage skips work whose output already exists, so this can be re-run after
a quota wall, a network drop or a reboot without paying for anything twice. That
matters more than usual here: on 2026-09-12 all three image backends were
unavailable at once -- Codex out of credit until 09-15, Gemini/agy at
429 RESOURCE_EXHAUSTED with a ~4h reset, and Grok banned for stills because its
image model reliably paints brand marks onto shoes (2026-08-25, three rolls,
three hits). The only correct response to that is to wait, so this has to be
safe to start again.

STILL BACKEND is agy (Google), not Codex. gen_anchor.py drives Codex; this drives
AI-Lanes/reelv3/agy-ref-image.ps1, which passes ImagePaths so the man's face and
the object stay the same across shots.

ORDER IS NOT ARBITRARY. The object-canon shot is generated first and every later
prompt is written against what that image actually shows. Generating the master
shots first once produced Chelsea boots on the counter and lace-up boots in the
customer's hands in the same film (2026-09-09), because whichever image exists
first becomes the de-facto truth and the other pipeline never sees it.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AGY = Path("C:/Users/cyc39/AI-Lanes/reelv3/agy-ref-image.ps1")
V2 = Path("C:/Users/cyc39/AI-Lanes/wt-reel-v2/scripts/reel-v2")

# Camera rhythm, one line per shot, 2026-09-12.
#
# Before this the six persona framings offered exactly two behaviours: "Camera
# locked" or "one restrained slow push-in of about four to six centimetres", and
# every push was the same speed and distance, so seven cuts read as one shot
# repeated. These are four behaviours built from the same safe vocabulary.
#
# Still no pull-back, widen or handheld sweep: 2026-08-27 established that any
# move which reveals space outside the reference frame forces the model to invent
# a room it was never shown, and it always breaks. Lateral drift is the one new
# move here and it is safe for the opposite reason -- the counter continues past
# both edges of frame, so drifting along it reveals nothing unseen.
CAMERA = {
    1: "Camera locked and completely still for the whole shot.",
    2: "Camera holds perfectly still for the first second and a half, then makes one slow push-in of about three centimetres and continues moving gently until the end.",
    3: "Camera makes one slow push-in of about four centimetres over the first three seconds, then stops completely and holds still for the rest of the shot.",
    4: "Camera locked and extremely steady.",
    5: "Camera locked.",
    6: "Camera drifts slowly sideways about four centimetres along the line of the counter, at a constant speed, without rotating and without changing height; the counter continues past both edges of frame throughout so nothing new is revealed.",
    7: "Camera locked and completely still for the whole shot.",
}


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print("  $ " + " ".join(str(c) for c in cmd[:4]) + " ...")
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def compose_master_prompt(persona: dict, job: dict, framing_key: str) -> str:
    """Anchor prompt for a shot the owner appears in, assembled from persona.json.

    Assembled rather than hand-written so the approved likeness has exactly one
    source of truth. Hand-copying it into six files is how a persona drifts.
    """
    framing = persona["framings"][framing_key]
    return "\n\n".join(
        part
        for part in [
            framing.get("still_prompt", ""),
            persona["base_prompt"],
            "SETTING: " + persona["scene_clause"],
            "OBJECT PASSPORT (the garment on the counter): " + job["object_passport"],
            "MATERIAL OPTICS: " + job.get("material_optics_note", ""),
            persona["negative_clause"],
        ]
        if part
    )


def gen_still(job_dir: Path, name: str, prompt_file: Path, ref: Path | None) -> bool:
    out = job_dir / f"{name}.png"
    if out.exists() and out.stat().st_size > 0:
        print(f"  skip {name}.png (exists)")
        return True
    if ref is None or not ref.exists():
        print(f"  FAIL {name}: reference {ref} missing")
        return False
    proc = run([
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(AGY),
        "-PromptFile", str(prompt_file), "-RefPath", str(ref), "-OutFile", str(out), "-Aspect", "9:16",
    ])
    whole = (proc.stdout or "") + (proc.stderr or "")
    tail = whole[-400:]
    if out.exists() and out.stat().st_size > 0:
        print(f"  OK   {name}.png ({out.stat().st_size} bytes)")
        return True
    # Search the whole transcript, not the tail: agy reports the quota error near
    # the top of a long JSON envelope, so a tail-only check mislabels a wait as a
    # failure and sends someone debugging a prompt that is fine.
    if "RESOURCE_EXHAUSTED" in whole or "quota" in whole.lower():
        print(f"  QUOTA {name}: Gemini image quota exhausted; re-run after the reset and this stage resumes here.")
    else:
        print(f"  FAIL {name}: {tail.strip()[:300]}")
    return False


def main() -> int:
    job_dir = Path(sys.argv[1]).resolve()
    stills_only = "--stills-only" in sys.argv
    skip_stills = "--skip-stills" in sys.argv
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8-sig"))
    persona = json.loads((REPO / job["persona"]).read_text(encoding="utf-8-sig"))
    master_sheet = REPO / "data/persona/master-owner/anchor/master-sheet-approved.png"

    if not skip_stills:
        print("== stills (Google agy, reference-conditioned) ==")
        for name, plan in job["anchor_plan"].items():
            prompt_file = job_dir / f"{name}.txt"
            if not prompt_file.exists():
                framing = {"master": "counter-talk", "master-hands": "hands-detail"}.get(plan["who"])
                if plan["who"] == "master" and name == "shot-03-anchor":
                    framing = "profile-inspect"
                if framing is None:
                    print(f"  FAIL {name}: no prompt file and no framing to compose from")
                    return 1
                prompt_file.write_text(compose_master_prompt(persona, job, framing), encoding="utf-8")
                print(f"  wrote {prompt_file.name} from persona.framings[{framing}]")
            ref_spec = plan["ref"]
            ref = master_sheet if ref_spec == "master-sheet" else (
                master_sheet if ref_spec == "none" else job_dir / ref_spec
            )
            if not gen_still(job_dir, name, prompt_file, ref):
                print("\nSTOPPED at stills. Re-run this same command to resume.")
                return 2

    if stills_only:
        return 0

    print("== motion clips (Grok I2V via hermes xai-oauth) ==")
    for index, shot in enumerate(job["shots"][:6], start=1):
        manifest = job_dir / f"shot-{index:02d}.json"
        raw = job_dir / shot["file"]
        if raw.exists() and raw.stat().st_size > 0:
            print(f"  skip {shot['file']} (exists)")
            continue
        if not manifest.exists():
            plan = job["anchor_plan"][f"shot-{index:02d}-anchor"]
            framing_key = {"customer": None, "object": None, "master-hands": "hands-detail"}.get(plan["who"], "counter-talk")
            if index == 3:
                framing_key = "profile-inspect"
            motion = persona["framings"][framing_key]["motion_prompt"] if framing_key else ""
            # Strip whatever camera sentence the persona carried and append this
            # shot's own rhythm, so the framing stays the source of truth for the
            # person and the job stays the source of truth for the camera.
            motion = " ".join(s for s in motion.split(". ") if not s.strip().startswith("Camera"))
            manifest.write_text(json.dumps({
                "generation_id": f"SXJ-REELV3-{job['date'].replace('-', '')}-DOWNCUFF-SHOT{index:02d}-V1",
                "input_image": f"shot-{index:02d}-anchor.png",
                "output_file": shot["file"],
                "duration_seconds": shot["seconds"],
                "prompt": (
                    f"One continuous {shot['seconds']}-second photorealistic native 1080p portrait 9:16 shot. "
                    f"Begin exactly from the reference frame. {motion} {CAMERA[index]} "
                    "No other person, no extra hands, no cleaning, no foam, no water, no text, no logos, "
                    "no music or dialogue. Quiet shop room tone."
                ).replace("  ", " "),
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  wrote {manifest.name}")
        proc = run([sys.executable, str(V2 / "generate_shot.py"), str(manifest)])
        print("   " + (proc.stdout or proc.stderr or "").strip()[-300:])
        if not raw.exists():
            print("\nSTOPPED at motion. Re-run this same command to resume.")
            return 3

    print("== narration ==")
    if not (job_dir / "narration.mp3").exists():
        print((run([sys.executable, str(V2 / "make_narration.py"), str(job_dir)]).stdout or "").strip()[-300:])

    print("== master ==")
    print((run([sys.executable, str(V2 / "build_master.py"), str(job_dir)]).stdout or "").strip()[-500:])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
