#!/usr/bin/env python3
"""Turn the 23 parsed setups into the job's shots.json, cut-list and reference-map.

The decode's IMAGE_PROMPTs are good and are used almost as written -- they carry
the camera, the framing, the tool with its size in centimetres, the wetness and
where the dirt sits. What they do not carry is this pipeline's two hard-won
contracts, so those are appended here rather than rewritten into each one:

  THE IDENTITY LOCK.  Short, and only about the things that actually drifted. On
  the last film the charcoal toe rubber washed off in two shots, one shot grew a
  different object, and three shots disagreed about how many midsole openings the
  shoe has. Every one of those is a sentence here. The lock is deliberately NOT a
  restatement of the whole shoe: the anchor photograph carries the appearance, and
  the generator is told the photograph wins, so re-describing the appearance in
  text adds nothing and crowds out the part that matters.

  THE FORBID BLOCK.  Burned-in captions, split screens, a second pair, the shoe
  changing material. The decode's prompts say "no generated captions" in some
  beats and not others; a rule that applies to some shots is how a caption ends up
  in shot eleven.

Which anchor a shot gets is decided by the decode's own SHOE STATE TIMELINE, not
by eye: a shot whose first beat still scores dirty is conditioned on the dirty
canon, and one at or below CLEAN_AT on the clean canon. That is what stops a
half-washed shoe being generated from a photograph of a finished one.

Usage: build_cloudtilt_shots.py <decode.txt> <job-dir>
"""
from __future__ import annotations

import glob
import io
import json
import re
import sys
from pathlib import Path

CLEAN_AT = 2.0          # dirtiness at or below this is conditioned on the clean canon
WETROOM_HINTS = ("沖孔", "孔板", "機器", "鋼軸", "刷輪", "水管", "擋水")
DRYBENCH_HINTS = ("圍裙", "乾檯")
STUDIO_HINTS = ("棚拍", "灰牆", "灰色平台")

# The decode tells you what a shot is NOT as often as what it is, and a hint read
# out of a negated clause is a wrong answer that looks like a right one. s06's
# FRAME reads "上方是不鏽鋼背板…；不能換成乾檯" -- do not swap this for the dry bench --
# and a plain substring search filed it as the dry bench, which would have put the
# owner and his apron into the middle of the wash.
#
# So clauses are split on Chinese punctuation and any clause carrying a negation is
# dropped before hints are matched. The negation tokens are spelt out in full
# rather than matching a bare 不, because 不鏽鋼 -- stainless steel, the surface the
# whole wet room is made of -- contains one.
NEGATIONS = re.compile(r"不能|不是|不應|不得|不要|不可|不准|不會|沒有|並非|非|無")
CLAUSE_SPLIT = re.compile(r"[。；，、;,\.]")


def positive(text: str) -> str:
    """The text with every negated clause removed."""
    return " ".join(c for c in CLAUSE_SPLIT.split(text) if not NEGATIONS.search(c))

IDENTITY_LOCK = """IDENTITY LOCK -- THIS IS THE SAME ON CLOUDTILT IN EVERY SHOT OF THE FILM
The shoe is an On Cloudtilt. Name it, do not paraphrase it into a generic trainer.

THE DARK TOE RUBBER IS PART OF THE SHOE, NOT DIRT. A charcoal / dark grey rubber
tip about 3.5 cm wide and 2 cm high wraps the very front of the toe. It is the
same charcoal whether the shoe is filthy or finished. Never clean it off, never
lighten it, never let foam or steam turn it pale, and never let it grow into a
large black cap over the whole forefoot.

THE OPENINGS ARE NINE A SIDE. Nine CloudTec openings through the lateral midsole
wall and nine through the medial wall, as rounded oblique slots and flattened
ovals of unequal size and tilt -- not equal circles, not equal capsules. The third
back from the heel is the tall teardrop. A glove, foam, the angle or the crop may
hide some of them, so the number VISIBLE in this frame may be fewer than nine; the
number that EXISTS never changes, and no shot may invent a tenth.

WHAT ELSE STAYS PUT: pale grey engineered mesh with a legible weave, darker where
wet, never leather and never suede and never a cracked or crazed surface; a grey
On marking on each side keeping its own position and never mirrored or erased; one
small red tab on the LATERAL rear only, never copied to the medial side; grey
elastic speed-laces that stay laced and fastened all film, with two pale upper
anchors and two dark lower keepers per shoe -- the keepers are hardware and stay
dark; a padded grey sock collar; dark grey outsole rubber keeping its own tread
and wear.

ONE WORKING SHOE. Through the whole wash only ONE shoe is handled. Its partner is
not on the bench, not in the background, and not half in frame. Wet greying of the
mesh is water, not new dirt, and already-cleaned areas do not become dirty again."""

PAIR_NOTE = """THE PAIR. This is a studio plate, so BOTH shoes are present: a real
left and a real right of the same pair, not one shoe duplicated and mirrored --
mirroring would put the On marking and the red tab on the wrong sides."""

DRY_BENCH = """THE DRY BENCH. This is the shop's dry side, not the wet room. The
work surface is clean brushed stainless steel with NO perforations and no drain
holes -- it is not wood, not laminate, not stone. No machine brushes, no rollers,
no steel shaft, no hose, no bucket, no foam, no standing water: all of that
belongs to the wet room and none of it may appear here. Finished garments hang on
a rail well behind, softly out of focus.

THE APRON. The person at the bench wears a cream / off-white canvas apron over a
light grey polo shirt, and the three Chinese characters 私享家 are embroidered on
the chest of the apron in dark navy thread, about 9 cm across, following the
weave of the cloth. Render those three characters correctly and completely --
私, 享, 家 -- as embroidery on fabric, not as a printed label or a flat graphic.
No face and no head: the frame holds torso, apron, forearms and hands only.

THE TOE STAYS VISIBLE. The cloth works the MIDSOLE and its outer edge. It does
not cover the front of the toe: the charcoal toe rubber stays uncovered and in
shot, because this is where the viewer sees that it is still the same shoe."""

# The apron's three characters are the ONE piece of text allowed in this film, and
# the carve-out has to live INSIDE the forbid block, not only in the block above
# it. On the first pass the exception was stated in the apron paragraph while the
# forbid paragraph still said "no on-screen text of any kind"; the two contradicted
# each other, the blunter one won, and s22/s23 came back with a plain navy apron
# and no wordmark at all. The same mistake is on record from 2026-09-12.
APRON_EXCEPTION = """
ONE EXCEPTION TO THE TEXT RULE ABOVE: the three embroidered characters 私享家 on
the apron are required and must be rendered. They are the only text permitted.
Nothing else in the frame carries any lettering, number or mark."""

FORBID = """FORBID -- NONE OF THE FOLLOWING ANYWHERE IN FRAME
No burned-in caption, subtitle, title card, on-screen text, watermark, logo bug,
timestamp, frame counter, arrow, circle or annotation of any kind. No split-screen,
no before/after panel, no divided frame, no inset, no picture-in-picture, no
mirrored or kaleidoscope half. No second pair of shoes, no spare single shoe, no
other footwear anywhere in the frame or the background. No change of material: the
upper never becomes leather, suede, smooth plastic or a cracked, crazed or peeling
surface, and the midsole openings are always real holes punched through the foam
-- never painted or printed hole shapes, never shallow dimples, never embossed
outlines, never closed foam where the row should be. No wire brush, no metal drill
bit, no power tool, no flame, no bleach bottle. No steam whiteout that hides the
shoe. No paper-white or glossy plastic sheen on any part of the shoe. No camera
move, no zoom, no push-in, no pull-back, no rack focus, no fisheye."""


def dirt_timeline(text: str) -> dict[int, float]:
    out: dict[int, float] = {}
    for m in re.finditer(r"^BEAT\s*(\d+)\s*[：:]\s*([\d.]+)\s*[／/]\s*10", text, re.M):
        out[int(m.group(1))] = float(m.group(2))
    return out


def main() -> int:
    decode = io.open(sys.argv[1], encoding="utf-8").read()
    job = Path(sys.argv[2]).resolve()
    dirt = dirt_timeline(decode)
    if len(dirt) < 50:
        print(f"only {len(dirt)} beats have a dirtiness score -- the timeline did not parse")
        return 1

    setups = [json.loads(io.open(f, encoding="utf-8").read())
              for f in sorted(glob.glob(str(job / "prompts" / "setups" / "*.json")))]

    shots, cuts = [], []
    refs: dict[str, list[str]] = {}
    first_drybench: str | None = None
    for s in setups:
        sid = s["id"]
        scene = positive(f"{s['tool']} {s['frame']} {s['grip']}")
        # The first beat's score is the state at the first frame, which is what the
        # still has to show. Using the minimum across the shot would generate a
        # cleaner frame than the shot starts on and make the wash jump backwards.
        score = dirt.get(s["beat_numbers"][0], 9.0)
        studio = any(h in scene for h in STUDIO_HINTS)
        drybench = not studio and any(h in scene for h in DRYBENCH_HINTS)
        wetroom = not studio and not drybench and any(h in scene for h in WETROOM_HINTS)
        if not (studio or drybench or wetroom):
            print(f"  {sid}: no scene hint survived; treating as wet room")
            wetroom = True

        blocks = [s["still_prompt"], IDENTITY_LOCK]
        if studio:
            blocks.append(PAIR_NOTE)
        if drybench:
            blocks.append(DRY_BENCH)
        blocks.append(FORBID + (APRON_EXCEPTION if drybench else ""))

        anchors = ["CLOUDTILT_CLEAN" if score <= CLEAN_AT else "CLOUDTILT_DIRTY"]
        if wetroom:
            anchors.append("BENCH")
        if drybench:
            anchors.append("OWNER")
            # The OWNER anchor is a head-and-shoulders sheet: it fixes his build
            # and his polo, and says nothing about the apron, the bench or the
            # room, because none of those are in it. Left to the text alone the
            # two dry-bench shots came back one second apart wearing different
            # aprons -- cream in s22, navy in s23 -- which is the same continuity
            # break as the shoe changing. So every dry-bench shot after the first
            # is also conditioned on the first one, which is where that set was
            # actually decided.
            if first_drybench is None:
                first_drybench = sid
            else:
                anchors.append("DRYBENCH_PLATE")

        shots.append({
            "id": sid,
            "seconds": s["seconds"],
            "dirt": score,
            "scene": "studio" if studio else ("dry-bench" if drybench else "wet-room"),
            "still_prompt": "\n\n".join(blocks),
            "motion_prompt": s["motion_prompt"],
            "beat_numbers": s["beat_numbers"],
        })
        refs[sid] = anchors
        cuts.append({
            "id": sid,
            "t0": s["t0"],
            "seconds": s["seconds"],
            "still": f"{sid}.png",
            "clip": f"{sid}.mp4",
            # Only the two-frame loop flash is frozen. Everything else is a moving
            # shot, and the builder refuses to substitute a still for one -- on the
            # last film it silently froze nine shots and still printed MASTER.
            "static": s["seconds"] < 0.2,
        })

    w = lambda p, o: io.open(p, "w", encoding="utf-8", newline="\n").write(
        json.dumps(o, ensure_ascii=False, indent=2) + "\n")
    w(job / "prompts" / "shots.json", shots)
    w(job / "cut-list.json", {"fps": 30, "shots": cuts})

    rm = json.loads(io.open(job / "prompts" / "reference-map.json", encoding="utf-8").read())
    rm["shots"] = {**{k: v for k, v in rm["shots"].items() if k.startswith("canon-")}, **refs}
    if first_drybench:
        rm["_anchors"]["DRYBENCH_PLATE"] = f"output/{job.name}/{first_drybench}.png"
        rm["_why"]["DRYBENCH_PLATE"] = (
            "乾區第一顆鏡頭。後面的乾區鏡頭都對著它生,這樣圍裙顏色、檯面、"
            "手套、背景衣架不會在一秒之間換掉。OWNER 錨點只有定妝照,管不到這些。")
    w(job / "prompts" / "reference-map.json", rm)

    print(f"{len(shots)} shots, {sum(s['seconds'] for s in shots):.2f}s total")
    print()
    print(f"  {'id':14} {'sec':>5} {'dirt':>5}  {'scene':10} {'mwords':>6}  anchors")
    for s, c in zip(shots, cuts):
        print(f"  {s['id']:14} {s['seconds']:5.2f} {s['dirt']:5.1f}  {s['scene']:10} "
              f"{len(s['motion_prompt'].split()):6}  {','.join(refs[s['id']])}"
              f"{'   [STATIC]' if c['static'] else ''}")
    by = {}
    for s in shots:
        by[s["scene"]] = by.get(s["scene"], 0) + 1
    print()
    print("  " + "  ".join(f"{k}={v}" for k, v in sorted(by.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
