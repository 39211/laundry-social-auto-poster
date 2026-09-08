#!/usr/bin/env python3
"""Assemble a reel-v2 master from generated shots + narration, then write a QA receipt.

Layout (learned from the Codex comparison build the owner preferred, 2026-09-08):
  1080x1920 @24fps, each shot scaled-to-fit and padded (no crop) on 0x0E1826,
  the last shot freezes 2 s, then a 3 s tail card; brand watermark + "AI情境示意"
  disclosure persist top-left; one two-line summary card per shot; narration
  loudnorm I=-16 TP=-1.5 LRA=11; libx264 crf 18 slow, AAC 192k 48 kHz, faststart.

Usage: python build_master.py <job-dir>
job.json keys: shots [{file, seconds}], narration (text), shot_summaries [3],
               tail_lines [2], brand, disclosure, freeze_seconds, tail_seconds
Outputs: master-candidate.mp4, master-candidate-edl.json, qa/receipt.json, qa/grid.png
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
BG = "0x0E1826"
FONT = "Microsoft JhengHei"
W, H, FPS = 1080, 1920, 24


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def probe(path: Path) -> dict:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels",
         "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def duration_of(path: Path) -> float:
    return float(probe(path)["format"]["duration"])


def ass_time(t: float) -> str:
    cs = int(round(t * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, c = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def ass_text(s: str) -> str:
    return s.replace("\n", r"\N").replace("{", "(").replace("}", ")")


def loudness(path: Path) -> dict:
    out = subprocess.run([FFMPEG, "-v", "info", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", out)
    p = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", out)
    return {"integrated_lufs": float(i[-1]) if i else None, "true_peak_dbfs": float(p[-1]) if p else None}


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    cfg = json.loads((job / "job.json").read_text(encoding="utf-8-sig"))
    shots = cfg["shots"]
    freeze = float(cfg.get("freeze_seconds", 2.0))
    tail_seconds = float(cfg.get("tail_seconds", 3.0))
    narration = job / "narration.mp3"
    nar_len = duration_of(narration)

    # Timeline: equal real-time trims (never speed changes), last shot frozen.
    segs = []
    t = 0.0
    for i, s in enumerate(shots):
        src = job / s["file"]
        avail = duration_of(src)
        use = min(float(s.get("seconds", 7.0)), avail)
        segs.append({"src": src, "sha256": sha256(src), "source_duration": avail, "in": 0.0, "out": use, "tl_in": t, "tl_out": t + use})
        t += use
    content_end = t + freeze
    if nar_len > content_end - 0.4:
        # Narration must finish before the tail card; extend the freeze instead of speeding audio.
        freeze = round(nar_len + 0.6 - t, 3)
        content_end = t + freeze
    segs[-1]["tl_out_with_freeze"] = content_end
    planned = round(content_end + tail_seconds, 3)

    # overlays.ass
    summaries = cfg["shot_summaries"]
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Brand,{FONT},36,&H00FFFFFF,&H00FFFFFF,&H9009141F,&H9009141F,1,0,0,0,100,100,0,0,3,10,0,7,80,160,120,1",
        f"Style: Disclosure,{FONT},27,&H00FFFFFF,&H00FFFFFF,&H9009141F,&H9009141F,0,0,0,0,100,100,0,0,3,8,0,7,80,160,185,1",
        f"Style: Summary,{FONT},48,&H00FFFFFF,&H00FFFFFF,&H9009141F,&H9009141F,1,0,0,0,100,100,0,0,3,14,0,7,80,160,290,1",
        f"Style: End,{FONT},54,&H00FFFFFF,&H00FFFFFF,&H000E1826,&H000E1826,1,0,0,0,100,100,0,0,1,0,0,5,80,160,300,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        f"Dialogue: 0,{ass_time(0)},{ass_time(planned)},Brand,,0,0,0,,{ass_text(cfg.get('brand', '私享家洗衣店'))}",
        f"Dialogue: 0,{ass_time(0)},{ass_time(content_end)},Disclosure,,0,0,0,,{ass_text(cfg.get('disclosure', 'AI情境示意'))}",
    ]
    for i, seg in enumerate(segs):
        end = content_end if i == len(segs) - 1 else seg["tl_out"]
        lines.append(f"Dialogue: 0,{ass_time(seg['tl_in'])},{ass_time(end)},Summary,,0,0,0,,{ass_text(summaries[i])}")
    lines.append(f"Dialogue: 0,{ass_time(content_end)},{ass_time(planned)},End,,0,0,0,,{ass_text(chr(10).join(cfg['tail_lines']))}")
    build = job / "build"
    build.mkdir(exist_ok=True)
    (build / "overlays.ass").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # filters.txt
    f = []
    for i, seg in enumerate(segs):
        chain = (f"[{i}:v:0]trim=duration={seg['out']:.6f},setpts=PTS-STARTPTS,fps={FPS},"
                 f"scale={W}:{H}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
                 f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},setsar=1,format=yuv420p")
        if i == len(segs) - 1:
            chain += f",tpad=stop_mode=clone:stop_duration={freeze:.6f}"
        f.append(chain + f"[v{i}];")
    n = len(segs)
    f.append(f"[{n + 1}:v:0]format=yuv420p,setsar=1,setpts=PTS-STARTPTS[tail];")
    f.append("".join(f"[v{i}]" for i in range(n)) + f"[tail]concat=n={n + 1}:v=1:a=0,ass=filename=overlays.ass[vout];")
    f.append(f"[{n}:a:0]asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=duration={planned:.6f}[aout]")
    (build / "filters.txt").write_text("\n".join(f) + "\n", encoding="utf-8")

    out = job / "master-candidate.mp4"
    if out.exists():
        out.unlink()
    args = [FFMPEG, "-hide_banner", "-nostdin", "-n", "-filter_complex_threads", "1"]
    for seg in segs:
        args += ["-i", str(seg["src"])]
    args += ["-i", str(narration), "-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:r={FPS}:d={tail_seconds}",
             "-filter_complex_script", "filters.txt", "-map", "[vout]", "-map", "[aout]",
             "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS),
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{planned:.6f}", str(out)]
    subprocess.run(args, cwd=build, check=True, capture_output=True, text=True)

    # QA receipt: full decode, probe, loudness, thumbnails grid, hashes.
    qa = job / "qa"
    qa.mkdir(exist_ok=True)
    decode = subprocess.run([FFMPEG, "-v", "error", "-i", str(out), "-f", "null", "-"], capture_output=True, text=True)
    pr = probe(out)
    nb = int(round(planned * FPS))
    step = max(1, nb // 12)
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(out), "-vf", f"select='not(mod(n\\,{step}))',scale=270:-1,tile=6x2",
                    "-frames:v", "1", str(qa / "grid.png")], check=True)
    receipt = {
        "output": str(out), "output_sha256": sha256(out), "planned_duration": planned,
        "actual_duration": float(pr["format"]["duration"]), "streams": pr["streams"],
        "decode_errors": decode.stderr.strip()[:500] or None,
        "loudness": loudness(out), "narration_seconds": nar_len, "freeze_seconds": freeze,
        "segments": [{k: (str(v) if isinstance(v, Path) else v) for k, v in s.items()} for s in segs],
    }
    (qa / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    (job / "master-candidate-edl.json").write_text(json.dumps({
        "inputs": receipt["segments"], "narration": {"path": str(narration), "sha256": sha256(narration), "duration": nar_len,
        "normalization": "single-pass loudnorm I=-16 TP=-1.5 LRA=11"}, "shot_summaries": summaries, "content_end": content_end,
        "tail_card_seconds": tail_seconds, "planned_duration": planned, "ffmpeg_args": args, "font": FONT,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"master": str(out), "duration": receipt["actual_duration"], "loudness": receipt["loudness"],
                      "decode_ok": receipt["decode_errors"] is None, "sha256": receipt["output_sha256"][:12]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
