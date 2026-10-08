#!/usr/bin/env python3
"""Write the I2V manifests for every shot of the 2026-09-14 shoe film.

The motion prompts already passed the deterministic gate; this only wraps them
in the contract generate_shot.py expects and decides how long to ask for.

Every clip is generated LONGER than the cut needs. Grok is stable at roughly
five to eight seconds and build_master trims each shot to its narration length
anyway, so asking for exactly two seconds buys a worse clip and no time back.
Fourteen of these shots cut at two or three seconds -- that is the reference
film's fast macro rhythm, not a mistake.

Usage: write_supbro_manifests.py <job-dir>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path


def generated_length(cut: int) -> int:
    """How many seconds to ask Grok for, given how many the edit will use."""
    if cut <= 4:
        return 5          # the bottom of Grok's stable window
    return cut + 2        # keep a margin for the trim


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    cfg = json.loads(io.open(job / "job.json", encoding="utf-8-sig").read())
    shots = {s["id"]: s for s in
             json.loads(io.open(job / "prompts" / "shots-revised.json", encoding="utf-8").read())}

    written = blocked = 0
    for entry in cfg["shots"]:
        # A shot carried from an earlier film is copied, not generated. v3 seeds
        # itself from v2 with carried_from_v2; older jobs used reuse_from. Honour
        # both, or every carried shot reports as "blocked" and the exit code stops
        # meaning anything.
        if entry.get("reuse_from") or entry.get("carried_from_v2"):
            continue
        # A static shot is built by holding its approved still. Writing a manifest for
        # it would hand it back to the video model, which is the exact defect the
        # static build exists to prevent.
        if entry.get("static"):
            print(f"  hold {entry['file'].replace('-raw.mp4',''):22} static, no video model")
            continue
        sid = entry["file"].replace("-raw.mp4", "")
        s = shots.get(sid)
        bad = []
        if not s:
            bad.append("no prompt entry")
        if not (job / f"{sid}.png").exists():
            bad.append("still not generated")
        if s:
            n = len(s["motion_prompt"].split())
            if not 25 <= n <= 55:
                bad.append(f"{n} words, outside 25-55")
            if s["motion_prompt"].count("Camera not moving.") != 1:
                bad.append("camera clause missing or repeated")
        if bad:
            blocked += 1
            print(f"  SKIP {sid:22} {'; '.join(bad)}")
            continue

        seconds = generated_length(entry["seconds"])
        manifest = {
            "generation_id": f"SXJ-SUPBRO-20260914-{sid.upper()}-V1",
            "input_image": f"{sid}.png",
            "output_file": entry["file"],
            "duration_seconds": seconds,
            "prompt": s["motion_prompt"].strip(),
        }
        io.open(job / f"{sid}.json", "w", encoding="utf-8", newline="\n").write(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        written += 1
        print(f"  ok   {sid:22} {len(s['motion_prompt'].split()):2} words  "
              f"{seconds}s generated for a {entry['seconds']}s cut")

    print()
    print(f"{written} manifest(s) written, {blocked} blocked")
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
