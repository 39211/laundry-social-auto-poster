#!/usr/bin/env python3
"""Generate one 9:16 1080p image-to-video shot through the hermes xai-oauth route.

Ported from the Codex comparison build (output/codex-comparison-20260908-0910/
generate-shot.py, 2026-09-08) that the owner judged better than the v1 reel
pipeline. Contract:

  * one manifest = one immutable submission (sha of manifest + input still are
    pinned in jobs/<id>.json; any change is refused, never silently re-sent);
  * OAuth subscription route only -- a metered key is a hard error;
  * the raw clip is written once (hard link from a temp download), never
    overwritten; QA and the director decide whether it is accepted.

Usage: python generate_shot.py <job-dir>/shot-01.json
Manifest: {generation_id, input_image, output_file, duration_seconds, prompt}
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

HERMES_AGENT = Path(r"C:\Users\cyc39\AppData\Local\hermes\hermes-agent")
sys.path.insert(0, str(HERMES_AGENT))
from tools.xai_http import hermes_xai_user_agent, resolve_xai_http_credentials  # noqa: E402

MODEL = "grok-imagine-video-1.5"


def save(path: Path, data: dict) -> None:
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--resolution", default="1080p")
    args = ap.parse_args()
    manifest = Path(args.manifest).resolve()
    run = manifest.parent
    m = json.loads(manifest.read_text(encoding="utf-8-sig"))
    still = (run / m["input_image"]).resolve()
    out = (run / m["output_file"]).resolve()
    if run not in still.parents or run not in out.parents:
        raise RuntimeError("Media must live inside the job directory")
    generation_id = m.get("generation_id")
    if not isinstance(generation_id, str) or not generation_id.strip():
        raise RuntimeError("Missing generation id")
    if not still.is_file():
        raise RuntimeError(f"Missing still: {still}")
    jobs = run / "jobs"
    jobs.mkdir(exist_ok=True)
    state = jobs / (hashlib.sha256(generation_id.encode()).hexdigest() + ".json")

    j = json.loads(state.read_text(encoding="utf-8")) if state.exists() else None
    ih = hashlib.sha256(still.read_bytes()).hexdigest()
    mh = hashlib.sha256(manifest.read_bytes()).hexdigest()
    if j and (j["manifest_sha256"] != mh or j["input_sha256"] != ih):
        raise RuntimeError("Immutable manifest or input changed; write a new manifest (v2, v3 ...)")
    if j and j["status"] == "downloaded":
        if out.is_file() and hashlib.sha256(out.read_bytes()).hexdigest() == j["output_sha256"]:
            print(json.dumps({"generation_id": generation_id, "status": "downloaded", "output": str(out)}))
            return 0
        raise RuntimeError("Downloaded artifact missing or changed")
    if j and (j["status"] in ("failed", "expired", "cancelled", "http_error") or not j.get("request_id")):
        raise RuntimeError(f"Existing terminal/uncertain submission ({j['status']}); no resubmission allowed")
    if out.exists():
        raise RuntimeError("Output already exists; refusing overwrite")

    creds = resolve_xai_http_credentials()
    if creds.get("provider") != "xai-oauth" or not creds.get("api_key") or creds.get("base_url") != "https://api.x.ai/v1":
        raise RuntimeError("OAuth-only readiness failed; metered fallback forbidden")
    headers = {"Authorization": "Bearer " + creds["api_key"], "User-Agent": hermes_xai_user_agent()}

    with httpx.Client(timeout=60, follow_redirects=False) as client:
        if j is None:
            j = {
                "generation_id": generation_id,
                "status": "submission_uncertain",
                "manifest_sha256": mh,
                "input_sha256": ih,
                "provider": "hermes-xai-oauth",
                "model": MODEL,
                "resolution": args.resolution,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            with state.open("x", encoding="utf-8") as f:  # exclusive create = once-only submission
                json.dump(j, f, ensure_ascii=False, indent=2)
            payload = {
                "model": MODEL,
                "prompt": m["prompt"],
                "duration": int(m.get("duration_seconds", 7)),
                "aspect_ratio": "9:16",
                "resolution": args.resolution,
                "image": {"url": "data:image/png;base64," + base64.b64encode(still.read_bytes()).decode("ascii")},
            }
            response = client.post("https://api.x.ai/v1/videos/generations", headers=headers, json=payload)
            if response.status_code >= 400:
                j.update(status="http_error", http_status=response.status_code, body=response.text[:500])
                save(state, j)
                print(json.dumps(j, ensure_ascii=False))
                return 2
            rid = response.json().get("request_id")
            if not rid:
                raise RuntimeError("No request id; state stays uncertain")
            j.update(status="pending", request_id=rid)
            save(state, j)
            print(json.dumps({"generation_id": generation_id, "status": "submitted", "request_id": rid}), flush=True)

        # Poll until done (the caller may also re-run the script; state is resumable).
        import time
        for _ in range(120):
            response = client.get("https://api.x.ai/v1/videos/" + j["request_id"], headers=headers)
            if response.status_code >= 400:
                print(json.dumps({"generation_id": generation_id, "status": "poll_http_error", "http_status": response.status_code}))
                return 2
            result = response.json()
            status = result.get("status", "unknown")
            j["last_poll_at"] = datetime.now(timezone.utc).isoformat()
            j["provider_status"] = status
            if status == "done":
                url = result.get("video", {}).get("url")
                if not url or not url.startswith("https://"):
                    raise RuntimeError("No HTTPS generated video")
                tmp = out.with_name(out.name + "." + uuid.uuid4().hex + ".download.tmp")
                with httpx.stream("GET", url, timeout=180, follow_redirects=True) as r:
                    r.raise_for_status()
                    with tmp.open("wb") as f:
                        for chunk in r.iter_bytes():
                            f.write(chunk)
                if tmp.stat().st_size < 1024:
                    raise RuntimeError("Empty generated video")
                os.link(tmp, out)
                tmp.unlink()
                j.update(status="downloaded", output_sha256=hashlib.sha256(out.read_bytes()).hexdigest(), output_bytes=out.stat().st_size)
                save(state, j)
                print(json.dumps({"generation_id": generation_id, "status": "downloaded", "output": str(out), "bytes": out.stat().st_size}), flush=True)
                return 0
            if status in ("failed", "expired", "cancelled"):
                j["status"] = status
                save(state, j)
                print(json.dumps({"generation_id": generation_id, "status": status}), flush=True)
                return 2
            j["status"] = "pending"
            save(state, j)
            time.sleep(5)
    print(json.dumps({"generation_id": generation_id, "status": "pending", "note": "still pending; re-run to resume"}))
    return 3


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"status": "stopped", "error_type": type(e).__name__, "error": str(e)[:300]}, ensure_ascii=False), flush=True)
        sys.exit(1)
