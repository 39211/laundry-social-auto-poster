#!/usr/bin/env python3
"""Write Cloudtilt FLUID1 manifests and generate clips one at a time.

Does not overwrite V1 clips. New files are <id>-fluid.mp4 with new generation
ids so generate_shot.py will submit. Uses the hermes xai-oauth route only.
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
XAI_PY = Path(r"C:\Users\cyc39\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe")
GS = Path(r"C:\Users\cyc39\AI-Lanes\wt-reel-v2\scripts\reel-v2\generate_shot.py")
PREFIX = "SXJ-CT-20260916"
VERSION = "FLUID1"


def generated_length(cut: float) -> int:
    return 5 if cut <= 4 else int(cut) + 2


def write_manifests(job: Path) -> list[Path]:
    cut = json.loads(io.open(job / "cut-list.json", encoding="utf-8").read())
    prompts = {s["id"]: s for s in
               json.loads(io.open(job / "prompts" / "shots.json", encoding="utf-8").read())}
    out_paths = []
    for shot in cut["shots"]:
        if shot.get("static"):
            continue
        sid = shot["id"]
        p = prompts[sid]["motion_prompt"].strip()
        stem = sid.upper().replace("-", "")
        manifest = {
            "generation_id": f"{PREFIX}-{stem}-{VERSION}",
            "input_image": shot["still"],
            "output_file": f"{sid}-fluid.mp4",
            "duration_seconds": generated_length(float(shot["seconds"])),
            "prompt": p,
        }
        path = job / f"{sid}-fluid.json"
        io.open(path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        out_paths.append(path)
        print(f"  wrote {path.name}  {len(p.split())}w  {manifest['duration_seconds']}s")
    return out_paths


def generate(manifest: Path) -> int:
    clip = manifest.parent / json.loads(io.open(manifest, encoding="utf-8").read())["output_file"]
    if clip.exists() and clip.stat().st_size > 1024:
        print(f"  skip {manifest.stem} (already on disk, {clip.stat().st_size} bytes)")
        return 0
    print(f"  generating {manifest.stem} ...", flush=True)
    r = subprocess.run(
        [str(XAI_PY), str(GS), str(manifest), "--resolution", "1080p"],
        cwd=str(manifest.parent))
    if r.returncode == 0 and clip.exists():
        print(f"  ok {clip.name} ({clip.stat().st_size} bytes)")
        return 0
    print(f"  FAIL {manifest.stem} exit={r.returncode}")
    return r.returncode or 1


def point_cut_list(job: Path) -> None:
    cut_path = job / "cut-list.json"
    cut = json.loads(io.open(cut_path, encoding="utf-8").read())
    for shot in cut["shots"]:
        if shot.get("static"):
            continue
        fluid = job / f"{shot['id']}-fluid.mp4"
        if fluid.exists() and fluid.stat().st_size > 1024:
            shot["clip"] = fluid.name
            shot["ss"] = 0.0
    io.open(cut_path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(cut, ensure_ascii=False, indent=2) + "\n")
    print(f"updated {cut_path} to prefer *-fluid.mp4 where present")


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    only = [a for a in sys.argv[2:] if not a.startswith("--")]
    do_write = "--write-only" in sys.argv
    do_point = "--point-cut" in sys.argv
    if not XAI_PY.is_file():
        print(f"missing hermes python: {XAI_PY}")
        return 1
    if not GS.is_file():
        print(f"missing generate_shot.py: {GS}")
        return 1
    core = {
        "s03-04p03-fluid", "s05-06p03-fluid", "s13-13p97-fluid",
        "s11-12p00-fluid", "s07-08p00-fluid", "s16-18p03-fluid",
    }
    manifests = write_manifests(job)
    if only:
        manifests = [m for m in manifests if m.stem.replace("-fluid", "") in only
                     or m.stem in only]
    else:
        manifests.sort(key=lambda p: (p.stem not in core, p.stem))
    if do_write:
        return 0
    failed = 0
    for m in manifests:
        if generate(m) != 0:
            failed += 1
    if do_point or failed < len(manifests):
        point_cut_list(job)
    print(f"done: {len(manifests) - failed} ok/skip, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
