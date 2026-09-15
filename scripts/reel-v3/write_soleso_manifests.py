#!/usr/bin/env python3
"""Write the I2V manifests for the SOLESO-rhythm film.

Every clip is asked for LONGER than the cut needs. The video model is stable at
roughly five to eight seconds and the build trims each shot to its slot anyway,
so asking for exactly one second buys a worse clip and no time back. Most of this
film cuts at one second flat -- that is the reference's measured rhythm, not an
accident -- so almost every manifest asks for the bottom of the stable window.

Static shots are skipped on purpose. The loop seam and the two studio cards have
no hands in them and nothing in those frames has any reason to move; handing them
to a video model is exactly how the last film grew a lace that lifted off one
shoe and swung to the other across three seconds.

The generation_id carries a VERSION. generate_shot.py pins each id against its
input and refuses to re-run when the input changed -- which is right, it stops a
silent reuse of a stale generation. But after the stills are regenerated the same
shot legitimately needs a new clip, and on 2026-09-15 nine of twenty-one were
refused for exactly that reason. Bump the version on any re-run that follows new
stills.

Usage: write_soleso_manifests.py <job-dir> [--version V2]
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

MIN_STABLE = 5


def generated_length(cut: float) -> int:
    """Seconds to ask for, given how many the edit will use."""
    return MIN_STABLE if cut <= 4 else int(cut) + 2


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    version = "V1"
    if "--version" in sys.argv:
        version = sys.argv[sys.argv.index("--version") + 1].upper()
    cut = json.loads(io.open(job / "cut-list.json", encoding="utf-8").read())
    prompts = {s["id"]: s for s in
               json.loads(io.open(job / "prompts" / "shots-revised.json",
                                  encoding="utf-8").read())}

    written = held = blocked = 0
    for shot in cut["shots"]:
        sid = shot["id"]
        if shot.get("static"):
            held += 1
            print(f"  hold {sid:22} static, no video model called")
            continue

        p = prompts.get(sid)
        bad = []
        if not p:
            bad.append("no prompt entry")
        if not (job / shot["still"]).exists():
            bad.append("still not generated")
        if p:
            n = len(p["motion_prompt"].split())
            if not 25 <= n <= 55:
                bad.append(f"{n} words, outside 25-55")
            if p["motion_prompt"].count("Camera not moving.") != 1:
                bad.append("camera clause missing or repeated")
        if bad:
            blocked += 1
            print(f"  SKIP {sid:22} {'; '.join(bad)}")
            continue

        seconds = generated_length(float(shot["seconds"]))
        manifest = {
            "generation_id": f"SXJ-SOLESO-20260916-{sid.upper().replace('-', '')}-{version}",
            "input_image": shot["still"],
            "output_file": shot["clip"],
            "duration_seconds": seconds,
            "prompt": p["motion_prompt"].strip(),
        }
        io.open(job / f"{sid}.json", "w", encoding="utf-8", newline="\n").write(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        written += 1
        print(f"  ok   {sid:22} {len(p['motion_prompt'].split()):2} words  "
              f"{seconds}s generated for a {shot['seconds']}s cut")

    print()
    print(f"{written} manifest(s) written, {held} held as static, {blocked} blocked")
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
