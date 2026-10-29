#!/usr/bin/env python3
"""Build a film from already-generated clips, cut the way a camera would have shot it.

Nothing here generates anything. It takes clips that already contain the right
action and fixes the three things that made them read as AI on 2026-09-16:

  FRAMING   every generated shot was composed like a product photograph -- the
            whole shoe, the whole machine, a strip of razor-sharp perforated tray.
            The reference is shot from a hand's width away: the drum is a soft
            wall, the shoe is cropped, the frame is full of foam. Each shot here is
            punched in around its point of contact.
  SPEED     measured on the palm brush, the generated action runs at about a third
            of the reference's rate. Working shots are retimed to 2.5x; the owner's
            own hands and the fine-detail shot are not, because a sped-up person
            reads as fast-forward rather than as work.
  SHUTTER   a generated frame is an instant with no exposure time. Each output
            frame of a retimed shot is the mean of the source frames the shutter
            would have been open across, so what moves smears and what does not
            stays sharp.

Audio is taken from the same source window and time-stretched with atempo, which
changes duration without changing pitch, so brush strokes stay in sync with the
picture and do not turn into chipmunk noise.

Usage: build_fluid_cut.py <edit.json> [--out master.mp4]
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shutter_retime import probe, retime  # noqa: E402
from build_soleso_master import watermark  # noqa: E402
from foley import mix_shot  # noqa: E402
from camera_look import DEFAULT as CAMERA_DEFAULT, apply as camera_apply  # noqa: E402

ROOT = HERE.parents[1]


def run(args: list[str]) -> None:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(" ".join(str(a) for a in args[:8]), "...")
        print(r.stderr.strip()[-1500:])
        raise SystemExit(f"ffmpeg failed ({r.returncode})")


def has_audio(p: Path) -> bool:
    return bool(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", str(p)],
        capture_output=True, text=True).stdout.strip())


def duration(p: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)], capture_output=True, text=True).stdout.strip())


def frames_to_seconds(frames: int, fps: int) -> float:
    return frames / fps


def count_frames(p: Path) -> int:
    return int(subprocess.run(
        ["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(p)],
        capture_output=True, text=True).stdout.strip() or 0)


def count_samples(p: Path) -> int:
    """Samples in a PCM WAV, from the data size -- exact, unlike a duration probe."""
    import wave
    with wave.open(str(p), "rb") as w:
        return w.getnframes()


def crop_fractions(W: int, H: int, zoom: float, center, out_w: int, out_h: int) -> str:
    """A crop box of the output's exact aspect, zoomed and centred, clamped inside."""
    ch = int(round(H / zoom)) // 2 * 2
    cw = int(round(ch * out_w / out_h)) // 2 * 2
    cw = min(cw, W // 2 * 2)
    x0 = min(max(0, int(round(center[0] * W - cw / 2))), W - cw)
    y0 = min(max(0, int(round(center[1] * H - ch / 2))), H - ch)
    return f"{x0 / W:.6f},{y0 / H:.6f},{(x0 + cw) / W:.6f},{(y0 + ch) / H:.6f}"


def still_size(p: Path) -> tuple[int, int]:
    from PIL import Image
    with Image.open(p) as im:
        return im.size


def render_still(src: Path, dst: Path, frames: int, fps: int, crop: str,
                 out_w: int, out_h: int, push: float) -> None:
    """Hold a still for exactly `frames` frames, optionally pushing in by `push`."""
    W, H = still_size(src)
    x0, y0, x1, y1 = (float(v) for v in crop.split(","))
    cw, ch = int(round((x1 - x0) * W)) // 2 * 2, int(round((y1 - y0) * H)) // 2 * 2
    base = f"crop={cw}:{ch}:{int(round(x0 * W))}:{int(round(y0 * H))}"
    if push:
        # zoompan needs headroom to zoom without softening; work at 2x.
        vf = (f"{base},scale={out_w * 2}:{out_h * 2}:flags=lanczos,"
              f"zoompan=z='1+{push}*on/{max(1, frames - 1)}':d={frames}"
              f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={out_w}x{out_h}:fps={fps},"
              f"format=yuv420p")
        run(["ffmpeg", "-v", "error", "-loop", "1", "-i", str(src), "-vf", vf,
             "-frames:v", str(frames), "-c:v", "libx264", "-crf", "16",
             "-video_track_timescale", str(fps * 1000), str(dst), "-y"])
    else:
        run(["ffmpeg", "-v", "error", "-loop", "1", "-framerate", str(fps), "-i", str(src),
             "-vf", f"{base},scale={out_w}:{out_h}:flags=lanczos,format=yuv420p",
             "-frames:v", str(frames), "-c:v", "libx264", "-crf", "16",
             "-video_track_timescale", str(fps * 1000), str(dst), "-y"])


def atempo_chain(speed: float) -> str:
    # atempo is limited to 0.5..2.0 per instance on older builds; chain it.
    parts, s = [], speed
    while s > 2.0:
        parts.append("atempo=2.0")
        s /= 2.0
    parts.append(f"atempo={s:.6f}")
    return ",".join(parts)


def main() -> int:
    edit_path = Path(sys.argv[1]).resolve()
    edit = json.loads(io.open(edit_path, encoding="utf-8").read())
    out_name = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "master.mp4"
    job = edit_path.parent
    work = job / "build"
    work.mkdir(exist_ok=True)
    src_dir = ROOT / edit["source_dir"]
    fps, W_out, H_out = edit["fps"], edit["width"], edit["height"]

    parts, cursor, timeline = [], 0.0, []
    for s in edit["shots"]:
        src = src_dir / s["source"]
        vid = work / f"{s['id']}-v.mp4"
        seconds = s["frames"] / fps
        if s.get("still"):
            # A studio plate: nothing in it has a reason to move, so no video model
            # touches it. An optional slow push-in (a post move on a still, which
            # cannot invent anything) keeps a held reveal from reading as a freeze.
            W, H = still_size(src)
            crop = crop_fractions(W, H, s.get("zoom", 1.0), s.get("center", (0.5, 0.5)),
                                  W_out, H_out)
            render_still(src, vid, s["frames"], fps, crop, W_out, H_out, s.get("push", 0.0))
            print(f"  {src.name} still -> {vid.name}: {s['frames']} frames, push {s.get('push', 0.0)}")
            speed, fps_in = 1.0, fps
            a0, a_len = 0.0, 0.0
        else:
            W, H, fps_in = probe(src)
            crop = crop_fractions(W, H, s["zoom"], s["center"], W_out, H_out)
            print("  " + retime(src, vid, start=s["start"], frames_out=s["frames"],
                                step=s["step"], blend=s["blend"], fps_out=fps,
                                size=f"{W_out}x{H_out}", crop=crop))
            speed = s["step"] * fps / fps_in
            a0 = s["start"] / fps_in
            a_len = seconds * speed
        # Audio is cut per shot to an EXACT sample count and kept as PCM until the
        # very end. The first build muxed each shot to AAC with -shortest, and that
        # silently dropped four frames from the palm shot (46 asked, 42 written)
        # while its audio kept the full length -- everything after it drifted by
        # 0.13 s and the sheet showed the detail shot inside the palm window. AAC
        # also rounds every segment to 1024-sample packets, which on its own left
        # four of nine shots 7-17 ms short. Sample-exact WAV avoids both.
        n_samples = int(round(frames_to_seconds(s["frames"], fps) * 48000))
        wav = work / f"{s['id']}.wav"
        if has_audio(src):
            run(["ffmpeg", "-v", "error", "-ss", f"{a0:.4f}", "-t", f"{a_len + 0.1:.4f}",
                 "-i", str(src), "-vn",
                 "-af", f"{atempo_chain(speed)},aresample=48000,"
                        f"apad=whole_len={n_samples},atrim=end_sample={n_samples}",
                 "-ac", "2", "-c:a", "pcm_s16le", str(wav), "-y"])
        else:
            run(["ffmpeg", "-v", "error", "-f", "lavfi",
                 "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                 "-af", f"atrim=end_sample={n_samples}", "-c:a", "pcm_s16le", str(wav), "-y"])
        audio_report = mix_shot(wav, wav, s.get("foley"))
        print(f"      audio {audio_report}")
        parts.append((vid, wav, s["frames"], n_samples))
        timeline.append({"id": s["id"], "t0": round(cursor, 3), "seconds": round(seconds, 3),
                         "speed": round(speed, 3), "blend": s.get("blend", 1),
                         "zoom": s.get("zoom", 1.0), "crop": crop, "source": s["source"],
                         "still": bool(s.get("still")), "start_frame": s.get("start", 0),
                         "source_frames_used": 1 if s.get("still") else
                         (s["frames"] - 1) * s["step"] + s["blend"]})
        cursor += seconds

    # Check every piece is exactly the length the timeline claims BEFORE joining.
    bad = []
    for vid, wav, frames, n_samples in parts:
        got_f = count_frames(vid)
        got_s = count_samples(wav)
        if got_f != frames or got_s != n_samples:
            bad.append(f"{vid.stem}: frames {got_f}/{frames}, samples {got_s}/{n_samples}")
    if bad:
        raise SystemExit("segment lengths do not match the edit:\n  " + "\n  ".join(bad))

    vlist = work / "concat-video.txt"
    vlist.write_text("".join(f"file '{v.as_posix()}'\n" for v, _, _, _ in parts), encoding="utf-8")
    alist = work / "concat-audio.txt"
    alist.write_text("".join(f"file '{a.as_posix()}'\n" for _, a, _, _ in parts), encoding="utf-8")
    joined_v = work / "joined-video.mp4"
    joined_a = work / "joined-audio.wav"
    run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(vlist),
         "-c", "copy", str(joined_v), "-y"])
    run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(alist),
         "-c", "copy", str(joined_a), "-y"])

    # Camera look goes on the picture BEFORE the shop name is laid over it: a
    # real Reel's text overlay is crisp even when the footage under it is soft.
    if edit.get("camera"):
        looked = work / "joined-video-look.mp4"
        camera_apply(joined_v, looked, dict(CAMERA_DEFAULT, **edit["camera"]),
                     out_w=W_out, out_h=H_out)
        if count_frames(looked) != count_frames(joined_v):
            raise SystemExit("the camera look changed the frame count")
        joined_v = looked
        print(f"  camera look {edit['camera']}")

    wm = watermark(work, "私享家洗衣店")
    out = job / out_name
    narration = ROOT / edit["narration"] if edit.get("narration") else None
    total_samples = sum(n for _, _, _, n in parts)
    # The sound is mixed to its OWN file first, cut to the picture's exact sample
    # count and checked, and only then muxed. Mixing inside the same command as
    # the picture fed loudnorm's irregular 192 kHz frames straight into the AAC
    # encoder, and the stream came out claiming 30.20 s against a 30.133 s picture
    # (2026-09-17) even with a trim after loudnorm.
    mixed = work / "mixed-audio.wav"
    trim = f"aresample=48000,atrim=end_sample={total_samples},asetpts=PTS-STARTPTS"
    if narration and narration.exists():
        at = int(edit["narration_at"] * 1000)
        afc = (f"[1:a]aresample=48000,adelay={at}|{at},volume=4.0[n];"
               f"[0:a][n]amix=inputs=2:duration=first:dropout_transition=0,"
               f"loudnorm=I=-16:TP=-1.5:LRA=11,{trim}[a]")
        run(["ffmpeg", "-v", "error", "-i", str(joined_a), "-i", str(narration),
             "-filter_complex", afc, "-map", "[a]", "-ac", "2", "-c:a", "pcm_s16le",
             str(mixed), "-y"])
    else:
        run(["ffmpeg", "-v", "error", "-i", str(joined_a),
             "-af", f"loudnorm=I=-16:TP=-1.5:LRA=11,{trim}", "-ac", "2", "-c:a", "pcm_s16le",
             str(mixed), "-y"])
    got = count_samples(mixed)
    if got != total_samples:
        raise SystemExit(f"mixed audio has {got} samples, the picture needs {total_samples}")

    run(["ffmpeg", "-v", "error", "-i", str(joined_v), "-i", str(wm), "-i", str(mixed),
         "-filter_complex", "[0:v][1:v]overlay=0:36[v]",
         "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-crf", "18", "-preset", "slow",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", str(out), "-y"])

    vdur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration",
         "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout.strip())
    adur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration",
         "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout.strip())
    if abs(vdur - adur) > 0.034:
        raise SystemExit(f"picture {vdur:.3f}s and sound {adur:.3f}s differ by more than a frame")

    preview = job / (Path(out_name).stem + "-720p.mp4")
    run(["ffmpeg", "-v", "error", "-i", str(out), "-vf", "scale=720:1280",
         "-c:v", "libx264", "-crf", "26", "-preset", "medium", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(preview), "-y"])

    io.open(job / "timeline.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps({"master": out_name, "shots": timeline}, ensure_ascii=False, indent=2) + "\n")

    print()
    for t in timeline:
        print(f"  {t['id']:14} {t['t0']:6.2f}s  {t['seconds']:5.2f}s  "
              f"{t['speed']:.2f}x  shutter {t['blend']}  zoom {t['zoom']}")
    print()
    print(f"MASTER  {out}  {duration(out):.2f}s  {out.stat().st_size / 1e6:.1f} MB")
    print(f"PREVIEW {preview}  {preview.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
