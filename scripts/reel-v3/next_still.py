#!/usr/bin/env python3
"""Say which still to generate next, and print everything needed to generate it.

The 26-shot film is generated one still at a time through a browser session, so
the loop needs a single source of truth for "what is left" rather than a count
kept in my head. This reads the job, the prompts and the reference map, checks
which stills are already on disk, and prints the next one: its prompt as a
single line ready to type, and the absolute paths of its reference images.

Every reference path is checked to exist. On 2026-09-09 a still was generated
against a reference that was not what anyone thought it was, and four shots had
to be regenerated; a missing or mistyped path must stop the run, not warn.

Usage:
  next_still.py <job-dir>              -- the next ungenerated shot
  next_still.py <job-dir> --id <shot>  -- a specific shot
  next_still.py <job-dir> --status     -- what is done and what is left
"""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

REPO = Path("C:/Users/cyc39/laundry-repo")


def load(job: Path):
    cfg = json.loads(io.open(job / "job.json", encoding="utf-8-sig").read())
    shots = json.loads(io.open(job / "prompts" / "shots-revised.json", encoding="utf-8").read())
    refmap = json.loads(io.open(job / "prompts" / "reference-map.json", encoding="utf-8").read())
    return cfg, {s["id"]: s for s in shots}, refmap


def refs_for(shot_id: str, refmap: dict) -> list[Path]:
    keys = refmap["shots"].get(shot_id)
    if keys is None:
        raise SystemExit(f"reference-map.json has no entry for {shot_id}")
    out = []
    for k in keys:
        rel = refmap["_anchors"].get(k)
        if not rel:
            raise SystemExit(f"reference-map.json has no anchor named {k}")
        p = (REPO / rel).resolve()
        if not p.exists():
            raise SystemExit(f"reference image missing on disk: {p}")
        out.append(p)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("job")
    ap.add_argument("--id")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    job = Path(args.job).resolve()
    cfg, shots, refmap = load(job)
    order = [s["file"].replace("-raw.mp4", "") for s in cfg["shots"]]

    done = [sid for sid in order if (job / f"{sid}.png").exists()]
    todo = [sid for sid in order if sid not in done]

    if args.status:
        print(f"{len(done)}/{len(order)} stills generated")
        for sid in order:
            clip = (job / f"{sid}-raw.mp4").exists()
            print(f"  {'PNG' if sid in done else '   '} {'MP4' if clip else '   '}  {sid}")
        return 0

    sid = args.id or (todo[0] if todo else None)
    if sid is None:
        print("all stills generated")
        return 0
    if sid not in shots:
        raise SystemExit(f"unknown shot {sid}")

    s = shots[sid]
    shot_cfg = next(x for x in cfg["shots"] if x["file"].startswith(sid))
    refs = refs_for(sid, refmap)
    one_line = " ".join(s["still_prompt"].split())

    print(f"SHOT      {sid}   ({len(done)} done, {len(todo)} left)")
    print(f"ACT       {shot_cfg['act']}")
    print(f"SECONDS   {shot_cfg['seconds']}")
    print(f"FACE      {'yes' if s['face_in_frame'] else 'no'}")
    print(f"DEST      {job / (sid + '.png')}")
    print("REFS")
    for p in refs:
        print(f"  {p}")
    print(f"CHARS     {len(one_line)}")
    print("PROMPT")
    print(one_line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
