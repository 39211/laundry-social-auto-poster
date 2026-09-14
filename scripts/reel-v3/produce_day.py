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

# generate_shot.py reaches the xAI subscription route through hermes's own
# tools.xai_http, and imports httpx. The interpreter running THIS script
# (pythoncore 3.14) has neither, so calling it with sys.executable dies with
# ModuleNotFoundError: No module named 'httpx' the instant the motion stage
# starts -- which is how the 2026-09-12 09:41 run ended, after the stills had
# already been paid for. make_narration.py and build_master.py are stdlib-only
# and stay on sys.executable; only this one call needs hermes's environment.
XAI_PY = Path("C:/Users/cyc39/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe")

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


def fill(text: str, job: dict) -> str:
    """Put the job's subject into a persona framing.

    Until 2026-09-12 the framings named the garment themselves -- "one plain pale
    cream wool sweater" -- and compose_master_prompt appended the job's OBJECT
    PASSPORT after it. Every prompt therefore carried two different garments, and
    the model believed the earlier, more concrete one: four of the six anchors for
    the down-jacket film came back as a cream sweater, one of them with a coffee
    stain and a cleaning brush. A framing now says only where the camera is and
    how the man appears; what is being cleaned comes from here.

    An unresolved token is a hard stop. Shipping "{{GARMENT}}" to the image model
    would render the literal braces, or worse, quietly render whatever it liked.
    """
    for token, key in (("{{GARMENT}}", "object_short"), ("{{PROBLEM}}", "problem_short")):
        if token in text:
            value = job.get(key)
            if not value:
                raise SystemExit(f"job.json is missing {key!r}, required by {token} in this framing")
            text = text.replace(token, value)
    if "{{" in text:
        raise SystemExit(f"unresolved template token in prompt: {text[text.index('{{'):][:60]}")
    return text


def compose_master_prompt(persona: dict, job: dict, framing_key: str) -> str:
    """Anchor prompt for a shot the owner appears in, assembled from persona.json.

    Assembled rather than hand-written so the approved likeness has exactly one
    source of truth. Hand-copying it into six files is how a persona drifts.
    """
    framing = persona["framings"][framing_key]
    return "\n\n".join(
        part
        for part in [
            fill(framing.get("still_prompt", ""), job),
            persona["base_prompt"],
            "SETTING: " + persona["scene_clause"],
            "OBJECT PASSPORT (the garment on the counter): " + job["object_passport"],
            "MATERIAL OPTICS: " + job.get("material_optics_note", ""),
            persona["negative_clause"],
        ]
        if part
    )


def shot_seconds_from_narration(job: dict, timing: list[dict]) -> list[int]:
    """Cut the shots to the spoken lines instead of to round numbers.

    2026-09-12. The shots used to carry hand-picked durations and the narration
    was laid over the top, so a card changed when the picture changed while the
    sentence it paraphrased was still four seconds away. Here each shot declares
    which narration lines it covers, and its length falls out of when those lines
    are actually spoken.

    Boundaries are rounded, not durations, so the integer seconds the video model
    needs still add up to exactly the moment the closing line begins -- rounding
    each duration separately would drift by a second or more across six shots.
    """
    shots = job["shots"]
    closing = timing[-1]
    tail_start = closing["start"] if not closing.get("card") else timing[-1]["end"]

    bounds = [0]
    for shot in shots[1:]:
        first = shot["lines"][0]
        bounds.append(round(timing[first]["start"]))
    bounds.append(int(tail_start))

    seconds = []
    for i in range(len(shots)):
        span = bounds[i + 1] - bounds[i]
        if span < 2:
            print(f"  FAIL shot-{i + 1:02d}: only {span}s of narration; merge it with a neighbour or lengthen the line")
            return []
        if span > 15:
            print(f"  FAIL shot-{i + 1:02d}: {span}s exceeds the 15s single-clip ceiling; split the line across two shots")
            return []
        seconds.append(span)
    return seconds


def compose_motion_manifest(persona: dict, job: dict, index: int, shot: dict) -> dict | None:
    """The I2V contract for one shot. Returns None when the job has not said enough.

    Separate from main() so the prompts can be read before any of them is sent:
    Grok clips are paid for one at a time and cannot be un-generated, so the
    prompts get an eye over them first, and that eye has to be on the text this
    function actually produces rather than on a copy of it.
    """
    plan = job["anchor_plan"][f"shot-{index:02d}-anchor"]
    framing_key = {"customer": None, "object": None, "master-hands": "hands-detail"}.get(plan["who"], "counter-talk")
    if index == 3:
        framing_key = "profile-inspect"

    # Shots the owner is not in (the customer, the object) have no persona
    # framing, so before 2026-09-12 their motion was the empty string and the
    # whole prompt came out as a camera instruction wrapped in negatives --
    # nothing at all about what happens in the four seconds. Handed that, an I2V
    # model either freezes or invents a beat, and what it invents with a garment
    # in someone's hands is raising it toward the lens (2026-08-27). The job has
    # to say what the shot is; refusing is better than shipping a subject-less
    # prompt.
    action = shot.get("action")
    if action:
        motion = fill(action, job)
    elif framing_key:
        motion = fill(persona["framings"][framing_key]["motion_prompt"], job)
    else:
        print(f"  FAIL shot-{index:02d}: no persona framing and no \"action\" on this shot in job.json")
        return None

    # Strip whatever camera sentence the persona carried and append this shot's
    # own rhythm, so the framing stays the source of truth for the person and the
    # job stays the source of truth for the camera.
    #
    # Rejoin with ". ", not " ". Splitting on ". " consumes the separator, so the
    # original rejoin ran every sentence into the next one -- "keeps her eyes down
    # on the cuff The jacket stays at the same height" -- in every prompt, whether
    # or not anything was actually stripped.
    kept = [s.strip().rstrip(".") for s in motion.split(". ") if not s.strip().startswith("Camera")]
    motion = ". ".join(s for s in kept if s)
    if motion:
        motion += "."
    return {
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
    }


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
    # Read the sheet from the persona, not from a path written here. On
    # 2026-09-12 the approved sheet was replaced and a hard-coded copy of the old
    # filename in this file would have silently kept generating the old face.
    sheet_rel = persona.get("anchor", {}).get("character_sheet")
    if not sheet_rel:
        print("  FAIL: persona.anchor.character_sheet is not set")
        return 1
    master_sheet = REPO / sheet_rel
    if not master_sheet.exists():
        print(f"  FAIL: character sheet {master_sheet} does not exist")
        return 1
    print(f"   identity reference: {sheet_rel}")

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

    # Narration before motion, not after. When the job is line-timed the shots
    # are cut to the spoken lines, so the lines have to be measured before a
    # single paid clip is generated.
    print("== narration ==")
    if not (job_dir / "narration.mp3").exists():
        proc = run([sys.executable, str(V2 / "make_narration.py"), str(job_dir)])
        print("   " + (proc.stdout or proc.stderr or "").strip()[-400:])
        if not (job_dir / "narration.mp3").exists():
            print("\nSTOPPED at narration. Re-run this same command to resume.")
            return 4

    timing_file = job_dir / "narration-timing.json"
    if timing_file.exists():
        timing = json.loads(timing_file.read_text(encoding="utf-8-sig"))["lines"]
        seconds = shot_seconds_from_narration(job, timing)
        if not seconds:
            return 5
        for i, secs in enumerate(seconds):
            job["shots"][i]["seconds"] = secs
        # Write them back. build_master reads job.json from disk, so a duration
        # that only ever existed in this process is a duration it never sees: it
        # falls back to its 7s default, takes each clip whole, and the footage
        # overruns the closing line by the few hundredths of a second the video
        # model adds to every clip. Persisting it also makes the job record what
        # was actually produced rather than what was originally asked for.
        (job_dir / "job.json").write_text(
            json.dumps(job, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("  shot lengths from the narration: " + ", ".join(f"{s}s" for s in seconds))

    print("== motion clips (Grok I2V via hermes xai-oauth) ==")
    if not XAI_PY.exists():
        print(f"  FAIL: {XAI_PY} not found; generate_shot.py needs hermes's httpx and tools.xai_http")
        return 3
    # Every shot that names its own file gets generated. The 2026-09-15 v1 job
    # had six real shots and a seventh that re-used the first; this one has seven
    # real shots, so the loop follows the job rather than a hard-coded six.
    for index, shot in enumerate(job["shots"], start=1):
        manifest = job_dir / f"shot-{index:02d}.json"
        raw = job_dir / shot["file"]
        if raw.exists() and raw.stat().st_size > 0:
            print(f"  skip {shot['file']} (exists)")
            continue
        if not manifest.exists():
            built = compose_motion_manifest(persona, job, index, shot)
            if built is None:
                return 3
            manifest.write_text(json.dumps(built, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  wrote {manifest.name}")
        proc = run([str(XAI_PY), str(V2 / "generate_shot.py"), str(manifest)])
        print("   " + (proc.stdout or proc.stderr or "").strip()[-300:])
        if not raw.exists():
            print("\nSTOPPED at motion. Re-run this same command to resume.")
            return 3

    print("== master ==")
    print((run([sys.executable, str(V2 / "build_master.py"), str(job_dir)]).stdout or "").strip()[-500:])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
