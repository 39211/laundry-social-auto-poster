#!/usr/bin/env python3
"""Narration audio for a reel-v2 job: MiniMax (hermes tts provider) first, edge-tts fallback.

Normal Traditional-Chinese speaking pace, speed 1.0 -- never sped up; if the
script runs long, rewrite the script. Writes <job>/narration.mp3 and a receipt.

Usage: python make_narration.py <job-dir>   (reads job.json: narration, voice)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERMES_AGENT = Path(r"C:\Users\cyc39\AppData\Local\hermes\hermes-agent")
sys.path.insert(0, str(HERMES_AGENT))

# This account's key authenticates against the MiniMax CN endpoint only
# (api.minimax.io returns 2049 invalid api key, api.minimaxi.com accepts it),
# so the region is pinned here rather than inferred from which env var is set.
# The voice the Codex comparison build called "m5-warm-bestie" is listed on
# this account as "Chinese (Mandarin)_Warm_Bestie" (温暖闺蜜); the old id
# returns 2054 voice id not exist.
DEFAULT_MINIMAX_VOICE = "Chinese (Mandarin)_Warm_Bestie"
MINIMAX_ENDPOINT = "https://api.minimaxi.com/v1/t2a_v2"
EDGE_VOICE = "zh-TW-HsiaoChenNeural"


def minimax_key() -> str:
    """Key from ~/.hermes/.env (written without BOM) or the environment."""
    env_file = Path.home() / ".hermes" / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            if line.startswith("MINIMAX_API_KEY="):
                value = line.split("=", 1)[1].strip()
                if value:
                    return value
    return os.environ.get("MINIMAX_API_KEY", "").strip()


def minimax_tts(text: str, out: Path, voice: str, model: str) -> None:
    """Direct t2a_v2 call.

    hermes' own provider picks the region from which env var is set and did not
    honour an explicit region in the config, so it always hit api.minimax.io,
    where this account's key returns 2049. The endpoint and voice are pinned
    here instead; edge-tts stays as the fallback.
    """
    key = minimax_key()
    if not key:
        raise RuntimeError("MINIMAX_API_KEY not found in ~/.hermes/.env or the environment")
    payload = {
        "model": model,
        "text": text,
        "stream": False,
        "voice_setting": {"voice_id": voice, "speed": 1.0, "vol": 1.0, "pitch": 0},
        "audio_setting": {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1},
    }
    req = urllib.request.Request(
        MINIMAX_ENDPOINT, data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        body = json.loads(response.read().decode("utf-8"))
    status = body.get("base_resp", {})
    if status.get("status_code") not in (0, None):
        raise RuntimeError(f"MiniMax TTS API error (code {status.get('status_code')}): {status.get('status_msg')}")
    audio_hex = (body.get("data") or {}).get("audio")
    if not audio_hex:
        raise RuntimeError("MiniMax TTS returned no audio")
    out.write_bytes(bytes.fromhex(audio_hex))


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
        minimax_tts(text, out, voice, cfg.get("tts_model", "speech-02-hd"))
        receipt.update(engine="minimax", voice=voice, endpoint=MINIMAX_ENDPOINT)
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
