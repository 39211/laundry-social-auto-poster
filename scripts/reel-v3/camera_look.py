#!/usr/bin/env python3
"""Give a rendered picture the look of phone footage that has been through a Reel.

Measured 2026-09-17 at 360x640, the SOLESO reference against our v4 cut:

              sharp  fine  noise  contrast  black  white   sat   R/G/B
  reference    2.9   1.7    1.9      48      40    219    0.15  154/144/150
  v4          10.1   6.4    6.1      56      19    229    0.11  150/138/138

So the reference is about three times softer, has lifted blacks and held-down
whites (a phone tone curve plus platform compression), is more saturated and
slightly cooler. Its flat areas are CLEANER than ours, not grainier -- compression
eats grain -- so "add film grain" would move us away from it, not toward it.

The treatment is therefore, in order:
  1. downscale to an intermediate resolution  (phone detail, not render detail)
  2. an optional small lens blur
  3. a tone curve that lifts blacks and holds whites
  4. saturation and a slight cool shift
  5. encode the intermediate at a platform-like quality, which smears the finest
     detail and flat-area texture the way a Reel does
  6. upscale back to the delivery size

Burned-in text (the shop name) must be laid on AFTER this, because an overlay on
a real Reel is crisp even when the footage under it is not.

Usage:
  camera_look.py apply <in.mp4> <out.mp4> [--height 720] [--blur 0.6] [--crf 28]
  camera_look.py sweep <in.mp4> <reference.mp4> [--seconds 6 --from 1.8]
"""
from __future__ import annotations

import itertools
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from look_stats import sample_frames, stats  # noqa: E402

DEFAULT = {
    "height": 720,      # intermediate height; width follows 9:16
    "blur": 0.6,        # gblur sigma at the intermediate size, 0 disables
    "crf": 28,          # x264 quality of the intermediate
    # Linear map 19->40 and 229->219 in luma, with a hair of midtone lift:
    # contrast 55.6 -> ~47, black and white points onto the reference's.
    "curve": "0/0.093 0.5/0.53 1/0.945",
    "saturation": 2.30,
    "red_gain": 0.95,
    "blue_gain": 1.06,
    "grain": 0,         # temporal luma noise strength; the reference has little
}


def first_pass_filter(p: dict) -> str:
    h = int(p["height"]) // 2 * 2
    w = int(round(h * 9 / 16)) // 2 * 2
    parts = [f"scale={w}:{h}:flags=area"]
    if p["blur"]:
        parts.append(f"gblur=sigma={p['blur']}")
    parts.append(f"curves=all='{p['curve']}'")
    parts.append(f"eq=saturation={p['saturation']}")
    parts.append(f"colorchannelmixer=rr={p['red_gain']}:gg=1:bb={p['blue_gain']}")
    if p["grain"]:
        parts.append(f"noise=c0s={p['grain']}:c0f=t")
    parts.append("format=yuv420p")
    return ",".join(parts)


def apply(src: Path, dst: Path, p: dict, out_w: int = 1080, out_h: int = 1920,
          t0: float | None = None, seconds: float | None = None) -> None:
    trim = []
    if t0 is not None:
        trim += ["-ss", f"{t0:.3f}"]
    if seconds is not None:
        trim += ["-t", f"{seconds:.3f}"]
    with tempfile.TemporaryDirectory() as td:
        mid = Path(td) / "mid.mp4"
        r = subprocess.run(
            ["ffmpeg", "-v", "error", *trim, "-i", str(src), "-an",
             "-vf", first_pass_filter(p), "-c:v", "libx264", "-preset", "medium",
             "-crf", str(p["crf"]), str(mid), "-y"], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr[-800:])
        r = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(mid),
             "-vf", f"scale={out_w}:{out_h}:flags=bicubic,format=yuv420p",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", str(dst), "-y"],
            capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr[-800:])


def distance(s: dict, ref: dict) -> float:
    """How far a look is from the reference, on the axes that matter most here."""
    w = {"sharp": 3.0, "fine": 3.0, "noise": 1.0, "contrast": 1.0,
         "black": 1.0, "white": 1.0, "sat": 1.0}
    scale = {"sharp": ref["sharp"], "fine": ref["fine"], "noise": ref["noise"],
             "contrast": ref["contrast"], "black": 40.0, "white": 40.0, "sat": ref["sat"]}
    return sum(w[k] * abs(s[k] - ref[k]) / scale[k] for k in w)


def main() -> int:
    mode = sys.argv[1]

    def flag(name, default, cast=float):
        return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default

    if mode == "apply":
        p = dict(DEFAULT)
        for k in ("height", "blur", "crf", "saturation", "red_gain", "blue_gain", "grain"):
            p[k] = flag(f"--{k.replace('_', '-')}", p[k])
        apply(Path(sys.argv[2]), Path(sys.argv[3]), p)
        print(f"applied {p}")
        return 0

    if mode == "sweep":
        src, ref_path = Path(sys.argv[2]), Path(sys.argv[3])
        t0, secs = flag("--from", 1.8), flag("--seconds", 6.0)
        ref = stats(sample_frames(ref_path, 40), (0.20, 1.00))
        print(f"{'height':>6} {'blur':>5} {'crf':>4}  {'sharp':>6} {'fine':>6} {'noise':>6} "
              f"{'contr':>6} {'black':>6} {'white':>6} {'sat':>5}  distance")
        print(f"{'REF':>18}  {ref['sharp']:6.2f} {ref['fine']:6.2f} {ref['noise']:6.2f} "
              f"{ref['contrast']:6.1f} {ref['black']:6.1f} {ref['white']:6.1f} {ref['sat']:5.2f}")
        rows = []
        with tempfile.TemporaryDirectory() as td:
            for h, b, c in itertools.product((960, 720, 540), (0.0, 0.6, 1.2), (24, 30)):
                p = dict(DEFAULT, height=h, blur=b, crf=c)
                out = Path(td) / f"c-{h}-{b}-{c}.mp4"
                apply(src, out, p, t0=t0, seconds=secs)
                s = stats(sample_frames(out, 24), (0.20, 1.00))
                d = distance(s, ref)
                rows.append((d, h, b, c, s))
                print(f"{h:6} {b:5.1f} {c:4}  {s['sharp']:6.2f} {s['fine']:6.2f} {s['noise']:6.2f} "
                      f"{s['contrast']:6.1f} {s['black']:6.1f} {s['white']:6.1f} {s['sat']:5.2f}  {d:6.2f}")
        rows.sort(key=lambda r: r[0])
        print()
        print("closest:", [(r[1], r[2], r[3], round(r[0], 2)) for r in rows[:4]])
        return 0

    print(__doc__)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
