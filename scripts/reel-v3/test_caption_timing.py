#!/usr/bin/env python3
"""Prove the caption cards land on the spoken line, using throwaway clips.

Grok clips and stills cost money and cannot be un-generated, so the timing chain
gets proved first with solid-colour stand-ins of exactly the right lengths: real
narration, real timing map, real build_master, fake pictures.

What it asserts, against the rendered overlays.ass rather than against the code
that wrote it:
  1. every card's start and end equals its line's measured start and end;
  2. the tail card starts when the closing line starts, so the price is read and
     heard at the same moment (it used to appear 10.8 s after the price was said);
  3. no two cards overlap, and none is on screen for less than 1.8 s -- the floor
     for reading two lines of Chinese.

Then it mutates: it rebuilds with the timing map hidden, and asserts the cards
come out on the shot grid instead. A test that passes both with and without the
thing it is testing proves nothing.

Usage: python test_caption_timing.py <job-dir-with-narration-timing>
"""
from __future__ import annotations

import json
import io
import re
import shutil
import subprocess
import sys
from pathlib import Path

V2 = Path("C:/Users/cyc39/AI-Lanes/wt-reel-v2/scripts/reel-v2")
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import produce_day as pd  # noqa: E402

CUE = re.compile(r"^Dialogue: \d+,(\d+:\d\d:\d\d\.\d\d),(\d+:\d\d:\d\d\.\d\d),(\w+),")


def secs(stamp: str) -> float:
    h, m, s = stamp.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def cues(ass: Path, style: str) -> list[tuple[float, float]]:
    out = []
    for line in ass.read_text(encoding="utf-8").splitlines():
        m = CUE.match(line)
        if m and m.group(3) == style:
            out.append((secs(m.group(1)), secs(m.group(2))))
    return out


def make_stub(path: Path, seconds: int, colour: str) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"color=c={colour}:s=1080x1920:d={seconds}:r=24",
         "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=mono:d={seconds}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path), "-y"],
        check=True, capture_output=True,
    )


def build(job_dir: Path) -> Path:
    proc = subprocess.run([sys.executable, str(V2 / "build_master.py"), str(job_dir)],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr)
        raise SystemExit("build_master failed")
    return job_dir / "build" / "overlays.ass"


def main() -> int:
    src = Path(sys.argv[1]).resolve()
    work = REPO / "output" / "reel-v3" / "_caption-timing-test"
    if work.exists():
        shutil.rmtree(work)
    (work / "build").mkdir(parents=True)

    shutil.copy2(src / "job.json", work / "job.json")
    shutil.copy2(src / "narration.mp3", work / "narration.mp3")
    shutil.copy2(src / "narration-timing.json", work / "narration-timing.json")

    job = json.loads(io.open(work / "job.json", encoding="utf-8-sig").read())
    # The pictures are stand-ins, but anything the job names by filename has to
    # come along or build_master refuses -- the tail QR, for one. Stubbing that
    # out would mean the test builds a different tail card than production does.
    tail_image = job.get("tail_image")
    if tail_image:
        shutil.copy2(src / tail_image, work / tail_image)
    timing = json.loads(io.open(work / "narration-timing.json", encoding="utf-8-sig").read())["lines"]

    lengths = pd.shot_seconds_from_narration(job, timing)
    if not lengths:
        raise SystemExit("shot lengths could not be derived")
    colours = ["red", "orange", "yellow", "green", "blue", "purple", "gray"]
    for i, (shot, n) in enumerate(zip(job["shots"], lengths)):
        shot["seconds"] = n
        make_stub(work / shot["file"], n, colours[i % len(colours)])
    (work / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    failures: list[str] = []

    ass = build(work)
    summary = cues(ass, "Summary")
    end = cues(ass, "End")
    carded = [l for l in timing if l.get("card")]
    closing = timing[-1]

    if len(summary) != len(carded):
        failures.append(f"{len(summary)} cards rendered, {len(carded)} lines carry a card")
    else:
        for i, (line, (a, b)) in enumerate(zip(carded, summary)):
            if abs(a - line["start"]) > 0.05 or abs(b - line["end"]) > 0.05:
                failures.append(
                    f"card {i} at {a:.2f}-{b:.2f} but its line is spoken {line['start']:.2f}-{line['end']:.2f}")

    if not end:
        failures.append("no tail card rendered")
    elif abs(end[0][0] - closing["start"]) > 0.05:
        failures.append(f"tail card starts {end[0][0]:.2f} but the closing line starts {closing['start']:.2f}")

    for i in range(len(summary) - 1):
        if summary[i][1] > summary[i + 1][0] + 0.001:
            failures.append(f"cards {i} and {i+1} overlap")
    for i, (a, b) in enumerate(summary):
        if b - a < 1.8:
            failures.append(f"card {i} is on screen {b - a:.2f}s, under the 1.8s reading floor")

    # Mutation: hide the timing map and the cards must fall back to shot cuts.
    (work / "narration-timing.json").rename(work / "narration-timing.json.hidden")
    fallback = cues(build(work), "Summary")
    (work / "narration-timing.json.hidden").rename(work / "narration-timing.json")

    grid = []
    t = 0.0
    for n in lengths:
        grid.append(t)
        t += n
    if len(fallback) != len(lengths):
        failures.append(f"fallback rendered {len(fallback)} cards, expected {len(lengths)}")
    else:
        on_grid = all(abs(fallback[i][0] - grid[i]) < 0.05 for i in range(len(grid)))
        if not on_grid:
            failures.append("fallback cards are not on the shot grid, so the mutation proves nothing")
        if fallback == summary:
            failures.append("cards are identical with and without the timing map: the test has no discriminating power")

    print(f"cards (timing map)  : {[f'{a:.2f}-{b:.2f}' for a, b in summary]}")
    print(f"cards (shot grid)   : {[f'{a:.2f}-{b:.2f}' for a, b in fallback]}")
    print(f"tail card           : {[f'{a:.2f}-{b:.2f}' for a, b in end]}")
    print(f"closing line spoken : {closing['start']:.2f}-{closing['end']:.2f}")
    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print(f"PASS: {len(summary)} cards land on their spoken line; tail card meets the price line; "
          f"fallback still uses the shot grid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
