# -*- coding: utf-8 -*-
"""Generate one reel clip through the hermes xai subscription route (F39).

Replaces the copx generate-shot.ps1 dependency: that script lived outside the
repository (Documents/Codex/2026-06-30/copx/) and was wiped by a disk cleanup
around 2026-08-26, taking the whole 10s production queue down with it. This
generator lives in the repo and rides the already-authenticated hermes
plugins.video_gen.xai OAuth route, so a clip costs subscription quota instead
of metered API credits.

Driven by the same per-shot manifest produce-next-reel.ps1 writes:
    { generation_id, source_shot_id, input_image, output_file, prompt,
      duration_seconds, aspect_ratio, resolution }
Paths in the manifest are relative to --run.

The downloaded file carries video + native audio + an attached thumbnail
stream; the output is remuxed to video-only because [0:v] in the assembler's
filter_complex must match exactly one stream, and clip audio is excluded by
policy (the assembler lays its own ambient bed and declares it in a sidecar).
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERMES_AGENT = Path(r"C:\Users\cyc39\AppData\Local\hermes\hermes-agent")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--report", default="")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    sys.path.insert(0, str(HERMES_AGENT))
    from plugins.video_gen import xai as video_xai  # noqa: E402

    run = Path(args.run)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8-sig"))
    still = run / str(manifest["input_image"]).replace("/", "\\")
    out = run / str(manifest["output_file"]).replace("/", "\\")
    out.parent.mkdir(parents=True, exist_ok=True)
    if not still.is_file():
        print(f"MISSING_STILL {still}", flush=True)
        return 1

    t0 = time.time()
    result = video_xai.run_xai_video_generation(
        prompt=str(manifest["prompt"]),
        model=None,
        explicit_model=False,
        image_url=str(still),
        reference_image_urls=None,
        duration=int(manifest.get("duration_seconds", 5) or 5),
        aspect_ratio=str(manifest.get("aspect_ratio", "9:16") or "9:16"),
        resolution=str(manifest.get("resolution", "720p") or "720p"),
    )
    url = result.get("video") or result.get("public_url") or result.get("temporary_url")
    if not url or not str(url).startswith("http"):
        print(f"CLIP_FAIL {manifest.get('generation_id')}: keys={sorted(result.keys())} error={result.get('error', '')}", flush=True)
        return 1

    raw_download = out.with_suffix(".download.mp4")
    req = urllib.request.Request(str(url), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        raw_download.write_bytes(resp.read())

    # Remux into a temp file and promote only on success: the caller's retry
    # loop treats the mere existence of the destination as "generated", so a
    # partial file left behind by a failed remux would be waved straight into
    # gain measurement and assembly as if it were a finished clip.
    remux_tmp = out.with_suffix(".remux.tmp.mp4")
    remux = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(raw_download),
         "-map", "0:v:0", "-c", "copy", str(remux_tmp)],
        capture_output=True, text=True)
    raw_download.unlink(missing_ok=True)
    if remux.returncode != 0 or not remux_tmp.is_file():
        remux_tmp.unlink(missing_ok=True)
        print(f"REMUX_FAIL {manifest.get('generation_id')}: {remux.stderr.strip()}", flush=True)
        return 1
    remux_tmp.replace(out)

    if args.report:
        Path(args.report).write_text(json.dumps({
            "generation_id": manifest.get("generation_id"),
            "source_shot_id": manifest.get("source_shot_id"),
            "status": "complete",
            "route": "hermes-xai-oauth",
            "output_file": manifest.get("output_file"),
            "elapsed_seconds": round(time.time() - t0, 1),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"CLIP_OK {manifest.get('generation_id')} ({out.stat().st_size} bytes, {time.time() - t0:.0f}s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
