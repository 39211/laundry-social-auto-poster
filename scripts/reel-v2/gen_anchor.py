#!/usr/bin/env python3
"""Generate one photorealistic anchor still (first frame) through Codex gpt-image-2.

Mirrors scripts/generate-missing-images.ps1: the prompt is piped to
`codex exec -s read-only -c windows.sandbox="unelevated"`, the newest file
written to ~/.codex/generated_images after the start timestamp is the result.
Only one Codex image job may run on this machine at a time (shared output dir).

Usage: python gen_anchor.py <job-dir> <name> "<prompt>"   -> <job-dir>/<name>.png
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

CODEX = Path(os.environ["APPDATA"]) / "npm" / "codex.cmd"
GENERATED = Path(os.environ["USERPROFILE"]) / ".codex" / "generated_images"
FFMPEG = "ffmpeg"


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    name = sys.argv[2]
    prompt = sys.argv[3]
    out = job / f"{name}.png"
    if out.exists():
        print(f"exists {out}")
        return 0
    text = (
        "Generate exactly one image from the prompt below using the built-in image model. "
        "Do not read any workspace file and do not run any shell command. Leave the image where the tool saves it.\n\n"
        + prompt
    )
    start = time.time()
    proc = subprocess.run(
        [str(CODEX), "exec", "-C", str(job), "-s", "read-only", "-c", 'windows.sandbox="unelevated"', "-"],
        input=text, text=True, encoding="utf-8", capture_output=True, timeout=900,
    )
    tail = "\n".join(proc.stdout.splitlines()[-8:])
    candidates: list[Path] = []
    if GENERATED.exists():
        for session in GENERATED.iterdir():
            if not session.is_dir():
                continue
            for f in session.iterdir():
                if f.is_file() and f.stat().st_mtime >= start - 2:
                    candidates.append(f)
    if not candidates:
        print("NO_IMAGE\n" + tail)
        return 1
    newest = max(candidates, key=lambda p: p.stat().st_mtime)
    # Codex writes JPEG bytes under .png on some routes; re-encode to a real PNG.
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(newest), str(out)], check=True)
    print(f"ANCHOR_OK {out} ({out.stat().st_size} bytes) from {newest.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
