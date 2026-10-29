#!/usr/bin/env python3
"""Pick the most active used-length window from each generated Cloudtilt clip.

Every clip is generated at ~5 s and the edit uses ~1 s. Taking 0.00-used is the
structural reason the film reads slow: the model dumps motion in the later
seconds. GPT-6 Pro (share 6aa95173 F1) said not to invert that into "always start
at 1.00" either -- scan candidate windows and pick a live one.

A high whole-frame score can also mean melt. The first Cloudtilt v2 cut proved
it: s03 and s11 scored best at 3.6-3.9 s because the Cloudtilt sole turned into
a different shoe, and s05 grew lettering. A window is illegal when its first or
last frame has drifted farther from frame 0 than the first used window is
allowed to travel -- either as whole-frame MAD, or as a 16-bit average hash of
the centre crop (MAD alone cannot tell an 8 cm feed from a sole swap). Among
the legal windows, a late start within 10% of the best legal score still wins,
and the first 0.5 s is never preferred unless it is the only legal window.

This does not regenerate anything. It writes `ss` onto each shot in cut-list.json
so build_soleso_master.py can trim that window.
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

STEP = 0.10
RAMP = 0.50
SAMPLE_FPS = 12.0
# The first used window is the legal amount of change. Starts may exceed that
# by 20%; ends may exceed it by 40%. Both floors stop a quiet first second from
# rejecting every later window that merely has foam moving.
START_SLACK = 1.20
END_SLACK = 1.40
START_FLOOR = 8.0
END_FLOOR = 10.0
AHASH_SIZE = 16
AHASH_SLACK = 1.35
AHASH_PAD = 0.03
AHASH_FLOOR = 0.12


def frames(path: Path) -> list[np.ndarray]:
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"fps={SAMPLE_FPS}",
             str(Path(td) / "f%04d.png"), "-y"],
            capture_output=True, text=True)
        return [np.asarray(Image.open(p).convert("L"), dtype=np.float32)
                for p in sorted(Path(td).glob("f*.png"))]


def window_score(diffs: np.ndarray, t0: float, used: float) -> float:
    a = int(round(t0 * SAMPLE_FPS))
    b = int(round((t0 + used) * SAMPLE_FPS))
    sl = diffs[max(0, a):max(a + 1, min(len(diffs), b))]
    return float(sl.mean()) if len(sl) else 0.0


def ident(fs: list[np.ndarray], i: int) -> float:
    i = min(max(0, i), len(fs) - 1)
    return float(np.abs(fs[i] - fs[0]).mean())


def ahash(frame: np.ndarray) -> np.ndarray:
    h, w = frame.shape
    crop = frame[int(h * 0.20):int(h * 0.80), int(w * 0.15):int(w * 0.85)]
    small = np.asarray(
        Image.fromarray(crop.astype(np.uint8)).resize((AHASH_SIZE, AHASH_SIZE), Image.BILINEAR),
        dtype=np.float32)
    return small > small.mean()


def ham(a: np.ndarray, b: np.ndarray) -> float:
    return float((a != b).mean())


def pick(clip: Path, used: float) -> tuple[float, float, float, float, int]:
    fs = frames(clip)
    if len(fs) < 3:
        return 0.0, 0.0, 0.0, 0.0, 0
    diffs = np.array([np.abs(fs[i + 1] - fs[i]).mean() for i in range(len(fs) - 1)])
    duration = len(fs) / SAMPLE_FPS
    used = min(used, duration)
    used_n = max(1, int(round(used * SAMPLE_FPS)))
    legal = ident(fs, used_n)
    cap_start = max(START_FLOOR, legal * START_SLACK)
    cap_end = max(END_FLOOR, legal * END_SLACK)
    h0 = ahash(fs[0])
    legal_h = max(ham(ahash(fs[i]), h0) for i in range(0, min(len(fs), used_n + 1)))
    cap_h = max(AHASH_FLOOR, legal_h * AHASH_SLACK + AHASH_PAD)
    last_start = max(0.0, duration - used - 0.05)
    starts = []
    t = 0.0
    while t <= last_start + 1e-9:
        starts.append(round(t, 3))
        t += STEP
    if not starts:
        starts = [0.0]

    scored = []
    rejected = 0
    for t0 in starts:
        a = int(round(t0 * SAMPLE_FPS))
        b = min(len(fs) - 1, int(round((t0 + used) * SAMPLE_FPS)))
        d0, d1 = ident(fs, a), ident(fs, b)
        h_start, h_end = ham(ahash(fs[a]), h0), ham(ahash(fs[b]), h0)
        if d0 > cap_start or d1 > cap_end or h_start > cap_h or h_end > cap_h:
            rejected += 1
            continue
        scored.append((window_score(diffs, t0, used), t0, d0))
    if not scored:
        scored = [(window_score(diffs, 0.0, used), 0.0, 0.0)]
        rejected = max(0, len(starts) - 1)
    best_score, best_t, best_id = max(scored)
    late = [(s, t0, d0) for s, t0, d0 in scored if t0 >= RAMP]
    if late:
        late_best, late_t, late_id = max(late)
        if late_best >= 0.90 * best_score:
            best_score, best_t, best_id = late_best, late_t, late_id
    first = window_score(diffs, 0.0, used)
    return best_t, best_score, first, best_id, rejected


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    write = "--write" in sys.argv
    cut_path = job / "cut-list.json"
    cut = json.loads(io.open(cut_path, encoding="utf-8").read())
    print(f"{'id':22} {'used':>5} {'ss':>6} {'best':>7} {'first':>7} "
          f"{'ident':>6} {'drop':>4}  note")
    for shot in cut["shots"]:
        if shot.get("static"):
            shot["ss"] = 0.0
            print(f"{shot['id']:22} {shot['seconds']:5.2f} {0:6.2f} "
                  f"{'-':>7} {'-':>7} {'-':>6} {'-':>4}  static")
            continue
        clip = job / shot["clip"]
        if not clip.exists():
            print(f"{shot['id']:22} {shot['seconds']:5.2f}  MISSING {clip.name}")
            return 1
        ss, best, first, ident0, dropped = pick(clip, float(shot["seconds"]))
        shot["ss"] = round(ss, 3)
        if ss < 0.05:
            note = "kept first"
        elif dropped:
            note = f"shifted +{ss:.2f}s; dropped {dropped} melted"
        else:
            note = f"shifted +{ss:.2f}s"
        print(f"{shot['id']:22} {shot['seconds']:5.2f} {ss:6.2f} {best:7.3f} "
              f"{first:7.3f} {ident0:6.2f} {dropped:4}  {note}")
    if write:
        io.open(cut_path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(cut, ensure_ascii=False, indent=2) + "\n")
        print(f"wrote ss into {cut_path}")
    else:
        print("dry run -- pass --write to save ss into cut-list.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
