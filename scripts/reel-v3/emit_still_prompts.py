#!/usr/bin/env python3
"""Write the anchor prompt files for a job without generating anything.

produce_day.py composes these lazily, just before it calls agy. When the stills
are being made somewhere else -- 2026-09-12, agy out of quota and the owner
offering his ChatGPT web session, which runs gpt-image-2.5 -- the prompts still
have to come from the same place, or the two routes drift apart and whichever
ran last silently becomes the truth.

Writing them here means both routes read identical text, and the file on disk is
what produce_day will reuse if it resumes later.

Usage: python emit_still_prompts.py <job-dir> [shot-03-anchor shot-04-anchor ...]
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import produce_day as pd  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

FRAMING_FOR = {"master": "counter-talk", "master-hands": "hands-detail"}


def main() -> int:
    job_dir = Path(sys.argv[1]).resolve()
    wanted = sys.argv[2:]
    job = json.loads(io.open(job_dir / "job.json", encoding="utf-8-sig").read())
    persona = json.loads(io.open(REPO / job["persona"], encoding="utf-8-sig").read())

    for name, plan in job["anchor_plan"].items():
        if wanted and name not in wanted:
            continue
        out = job_dir / f"{name}.txt"
        if out.exists():
            print(f"  skip {out.name} (exists)")
            continue
        framing = FRAMING_FOR.get(plan["who"])
        if plan["who"] == "master" and name == "shot-03-anchor":
            framing = "profile-inspect"
        if framing is None:
            print(f"  skip {name}: hand-authored prompt, not composed from the persona")
            continue
        out.write_text(pd.compose_master_prompt(persona, job, framing), encoding="utf-8")
        print(f"  wrote {out.name} from framings[{framing}] ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
