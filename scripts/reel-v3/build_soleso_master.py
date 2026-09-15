#!/usr/bin/env python3
"""Assemble the SOLESO-rhythm film: 24 shots, a zoom burst, and a true loop.

This is not build_master.py. That one is built for the shop's narrated three-shot
Reels: it burns a two-line summary card over every shot, freezes the last frame,
appends a three-second tail card and lays a continuous voice track over the top.
Every one of those would destroy this film, which is an ASMR piece with
one-second cuts, one spoken line and an ending that has to be invisible.

What is different here, and why:

  native audio     The I2V clips come back with their own sound (22 of 23 on the
                   last film carried aac 48k). The reference reel is raw work
                   sound the whole way, swinging with the action, so the clips'
                   own audio IS the soundtrack. It is faded to near silence under
                   the closing studio cards, matching the reference's measured
                   drop from -27 dB to -36 dB across its last three seconds.

  one line only    A single narration line drops in at the studio reveal. Any
                   more would kill the ASMR.

  zoom burst       Between the two studio cards, built here in ffmpeg as a short
                   scale-up. It is a camera move, and every camera move handed to
                   the video model so far has made it invent objects, so the
                   model never sees it.

  the loop         The first shot and the last shot are the SAME FILE. Reels
                   replay immediately, so the last frame flowing into the first
                   with no visible change is what makes the loop seamless. This
                   script asserts they are the same file rather than trusting it.

  no cards         No summary cards, no tail card, no disclosure. The owner asked
                   on 2026-09-15 for no AI disclosure; the cards are simply wrong
                   for one-second cuts.

Usage: build_soleso_master.py <job-dir> [--out master-candidate.mp4]
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

W, H, FPS = 1080, 1920, 24
BURST_SECONDS = 0.13          # the two studio cards are joined by this
# The work sound starts dropping away here. The reference measures -27 dB at 26 s
# and -36 dB by 28 s, so the fade begins just before the line does and the voice
# arrives into quiet rather than fighting the steam.
AUDIO_FADE_FROM = 26.40
# The line is 3.27 s. Starting it at the studio card (28.08) would run 1.2 s past
# the end of the film and clip the last word, so it starts over the final towel
# pass instead and lands its last syllable on the clean reveal.
NARRATION_AT = 26.60


def run(args: list[str]) -> None:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(" ".join(args[:6]), "...")
        print(r.stderr.strip()[:1500])
        raise SystemExit(f"ffmpeg failed ({r.returncode})")


def probe(path: Path, stream: str, entries: str) -> str:
    return subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", stream,
         "-show_entries", entries, "-of", "csv=p=0", str(path)],
        capture_output=True, text=True).stdout.strip()


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def segment(job: Path, shot: dict, work: Path) -> Path:
    """One shot, cut to its slot length, normalised to the film's frame and rate.

    A shot with a clip is trimmed from its start. A shot without one -- the loop
    seam and the two studio cards -- is held from its still, because nothing in
    those frames has any reason to move and asking a video model to animate them
    is how the last film grew a lace that swung between two shoes on its own.
    """
    sid, seconds = shot["id"], float(shot["seconds"])
    out = work / f"{sid}.mp4"
    clip = job / shot["clip"]
    still = job / shot["still"]

    vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
          f"crop={W}:{H},fps={FPS},format=yuv420p,setsar=1")

    if not shot.get("static") and clip.exists():
        run(["ffmpeg", "-v", "error", "-ss", "0", "-t", f"{seconds:.3f}", "-i", str(clip),
             "-vf", vf, "-c:v", "libx264", "-crf", "17", "-preset", "medium",
             "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
             "-af", f"atrim=0:{seconds:.3f},asetpts=PTS-STARTPTS",
             str(out), "-y"])
    else:
        if not still.exists():
            raise SystemExit(f"{sid}: neither {clip.name} nor {still.name} exists")
        # Silent hold. anullsrc keeps every segment two-stream so concat is clean.
        run(["ffmpeg", "-v", "error", "-loop", "1", "-t", f"{seconds:.3f}", "-i", str(still),
             "-f", "lavfi", "-t", f"{seconds:.3f}", "-i",
             "anullsrc=channel_layout=stereo:sample_rate=48000",
             "-vf", vf, "-c:v", "libx264", "-crf", "17", "-preset", "medium",
             "-c:a", "aac", "-b:a", "160k", "-shortest", str(out), "-y"])
    return out


def burst(job: Path, work: Path, frm: dict, to: dict) -> Path:
    """The zoom punch between the two studio cards.

    A hard scale-up on the outgoing frame for a handful of frames. Short and
    violent on purpose: it is what lets two separately generated studio frames
    cut together without the small offset between them reading as a jump.
    """
    out = work / "burst.mp4"
    src = job / frm["still"]
    n = max(2, round(BURST_SECONDS * FPS))
    # zoompan ramps the scale across n frames, then the cut lands on the clean card.
    # The blur is a flat sigma, not a ramp: gblur's sigma is not frame-evaluable
    # ("on" is a zoompan variable) and asking for a ramp fails the whole build
    # with "Undefined constant or missing '(' in 'on/3'". Over three frames a
    # constant blur is indistinguishable from a ramped one anyway.
    vf = (f"scale={W*2}:{H*2},zoompan=z='1+0.55*on/{n}':d={n}:s={W}x{H}:fps={FPS},"
          f"gblur=sigma=5,format=yuv420p,setsar=1")
    run(["ffmpeg", "-v", "error", "-loop", "1", "-t", f"{n/FPS:.3f}", "-i", str(src),
         "-f", "lavfi", "-t", f"{n/FPS:.3f}", "-i",
         "anullsrc=channel_layout=stereo:sample_rate=48000",
         "-vf", vf, "-c:v", "libx264", "-crf", "17", "-preset", "medium",
         "-c:a", "aac", "-b:a", "160k", "-shortest", str(out), "-y"])
    return out


def watermark(work: Path, text: str) -> Path:
    """Render the shop name to a PNG.

    Not drawtext: ffmpeg's drawtext segfaults on this machine because fontconfig
    has no default config, and it has cost a build twice.
    """
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGBA", (W, 150), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = None
    for cand in (r"C:\Windows\Fonts\msjh.ttc", r"C:\Windows\Fonts\msjhbd.ttc",
                 r"C:\Windows\Fonts\mingliu.ttc"):
        try:
            font = ImageFont.truetype(cand, 40)
            break
        except OSError:
            continue
    if font is None:
        raise SystemExit("no Chinese font found for the watermark")
    box = d.textbbox((0, 0), text, font=font)
    x = (W - (box[2] - box[0])) // 2
    # A soft shadow so it stays readable over both the white foam and the steam.
    d.text((x + 2, 42), text, font=font, fill=(0, 0, 0, 90))
    d.text((x, 40), text, font=font, fill=(255, 255, 255, 215))
    p = work / "watermark.png"
    img.save(p)
    return p


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("job")
    ap.add_argument("--out", default="master-candidate.mp4")
    ap.add_argument("--brand", default="私享家洗衣店")
    ap.add_argument("--narration", default=None,
                    help="wav/mp3 of the single closing line")
    ap.add_argument("--narration-at", type=float, default=NARRATION_AT)
    args = ap.parse_args()

    job = Path(args.job).resolve()
    cut = json.loads(io.open(job / "cut-list.json", encoding="utf-8").read())
    work = job / "build"
    work.mkdir(exist_ok=True)

    shots = cut["shots"]
    first, last = shots[0], shots[-1]

    # The loop is the whole ending. Assert it rather than hope for it.
    f_still, l_still = job / first["still"], job / last["still"]
    if not (f_still.exists() and l_still.exists()):
        raise SystemExit("the first and last stills must both exist")
    if sha(f_still) != sha(l_still):
        raise SystemExit(
            f"LOOP BROKEN: {first['still']} and {last['still']} are different files.\n"
            f"  The reel replays immediately; if these differ the seam is visible.\n"
            f"  {first['still']} must be a copy of {last['still']}.")
    print(f"loop seam ok: {first['still']} and {last['still']} are the same file")

    print()
    parts: list[Path] = []
    for shot in shots:
        seg = segment(job, shot, work)
        dur = float(probe(seg, "v:0", "format=duration") or 0)
        kind = "held still" if shot.get("static") else "clip"
        print(f"  {shot['id']:22} {shot['seconds']:5.2f}s  {kind:10} -> {dur:5.2f}s")
        parts.append(seg)
        if shot["id"] == "s22a-studio-dirty":
            b = burst(job, work, shot, last)
            print(f"  {'(zoom burst)':22} {BURST_SECONDS:5.2f}s  ffmpeg    -> "
                  f"{float(probe(b, 'v:0', 'format=duration') or 0):5.2f}s")
            parts.append(b)

    listfile = work / "concat.txt"
    listfile.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")

    joined = work / "joined.mp4"
    run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listfile),
         "-c:v", "libx264", "-crf", "17", "-preset", "medium",
         "-c:a", "aac", "-b:a", "160k", "-ar", "48000", str(joined), "-y"])
    total = float(probe(joined, "v:0", "format=duration") or 0)
    print(f"\njoined: {total:.2f}s")

    wm = watermark(work, args.brand)
    out = job / args.out

    # Work sound runs the whole film and falls away under the studio cards, the
    # way the reference does. The one spoken line sits on top of that silence.
    #
    # dynaudnorm comes first because the generated clips' own audio is far
    # quieter and far less even than assumed. Measured per clip, the means run
    # from -34 dB down to -73 dB and ten of the twenty-one sit below -50 dB,
    # which is silence. Checking that an audio STREAM existed was not the same as
    # checking it contained anything, and the first build shipped a near-silent
    # film with one loud line at the end. This lifts the quiet passages toward the
    # loud ones so whatever signal is really there becomes audible; it cannot
    # invent sound that was never recorded, and the report says so.
    fade = f"dynaudnorm=f=250:g=15:p=0.75:m=20,afade=t=out:st={AUDIO_FADE_FROM}:d=1.2"
    if args.narration and Path(args.narration).exists():
        run(["ffmpeg", "-v", "error", "-i", str(joined), "-i", str(wm),
             "-i", str(args.narration),
             "-filter_complex",
             f"[0:v][1:v]overlay=0:36[v];"
             f"[0:a]{fade},volume=1.0[bed];"
             # 4.0, not 1.6. Measured on the built film: at 1.6 the line lands
             # 2.9 dB BELOW the work bed and is buried; at 4.0 it sits +4.9 dB
             # above it, which is clear without shouting. (7.0 gives +9.1 dB and
             # is too much for one closing line.) Levels from audio_profile.py.
             f"[2:a]adelay={int(args.narration_at*1000)}|{int(args.narration_at*1000)},"
             f"volume=4.0[vo];"
             f"[bed][vo]amix=inputs=2:duration=first:dropout_transition=0,"
             f"loudnorm=I=-16:TP=-1.5:LRA=11[a]",
             "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
             str(out), "-y"])
    else:
        print("  (no narration file given -- building with work sound only)")
        run(["ffmpeg", "-v", "error", "-i", str(joined), "-i", str(wm),
             "-filter_complex",
             f"[0:v][1:v]overlay=0:36[v];[0:a]{fade},loudnorm=I=-16:TP=-1.5:LRA=11[a]",
             "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
             str(out), "-y"])

    dur = float(probe(out, "v:0", "format=duration") or 0)
    size = out.stat().st_size
    print()
    print(f"MASTER {out}")
    print(f"  {dur:.2f}s  {probe(out, 'v:0', 'stream=width,height')}  "
          f"{size:,} bytes  sha {sha(out)[:12]}")
    print(f"  target was {cut['target_seconds']}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
