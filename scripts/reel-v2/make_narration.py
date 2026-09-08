#!/usr/bin/env python3
"""Narration audio for a reel-v2 job: MiniMax (hermes tts provider) first, edge-tts fallback.

Normal Traditional-Chinese speaking pace, speed 1.0 -- never sped up; if the
script runs long, rewrite the script. Writes <job>/narration.mp3 and a receipt.

Usage: python make_narration.py <job-dir>   (reads job.json: narration, voice)
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERMES_AGENT = Path(r"C:\Users\cyc39\AppData\Local\hermes\hermes-agent")
sys.path.insert(0, str(HERMES_AGENT))

DEFAULT_MINIMAX_VOICE = "m5-warm-bestie"
EDGE_VOICE = "zh-TW-HsiaoChenNeural"


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return round(float(out), 3)


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    cfg = json.loads((job / "job.json").read_text(encoding="utf-8-sig"))
    text = cfg["narration"].strip()
    out = job / "narration.mp3"
    if out.exists():
        print(f"exists {out} {probe_duration(out)}s")
        return 0
    voice = cfg.get("voice") or DEFAULT_MINIMAX_VOICE
    receipt = {"text": text, "speed": 1, "generated_at": datetime.now(timezone.utc).isoformat()}
    try:
        from tools.tts_tool_providers import _generate_minimax_tts  # type: ignore

        tts_config = {"minimax": {"voice_id": voice, "model": cfg.get("tts_model", "speech-02-hd"), "speed": 1.0, "vol": 1.0}}
        _generate_minimax_tts(text, str(out), tts_config)
        receipt.update(engine="minimax", voice=voice)
    except Exception as exc:  # noqa: BLE001
        receipt.update(minimax_error=f"{type(exc).__name__}: {str(exc)[:200]}")
        subprocess.run(
            [sys.executable, "-m", "edge_tts", "--voice", EDGE_VOICE, "--text", text, "--write-media", str(out)],
            check=True, capture_output=True,
        )
        receipt.update(engine="edge-tts", voice=EDGE_VOICE)
    receipt["duration_seconds"] = probe_duration(out)
    (job / "narration-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: receipt[k] for k in ("engine", "voice", "duration_seconds")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
