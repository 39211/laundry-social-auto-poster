# -*- coding: utf-8 -*-
"""Execute a slot-image-plan through the hermes xAI (Grok Imagine) plugin.

This is the formal version of the hand-run 2026-08-24 D+3 batch: the subscription
OAuth route (hermes plugin resolves xai-oauth pool -> auth.json -> XAI_API_KEY),
hero-then-edits identity locking, and a 4:5 center-crop to 1080x1350 PNG.

Decision-free by design: WHICH files to generate, WHICH prompt certifies each
file, and the guard suffix all come from the plan JSON written by
`npm run slot-image-plan` (src/slotImagePlan.ts). This script only executes.
Appending any prompt text here would desynchronize the plan from what was
actually generated, so it must never do that.

Per-slot atomicity: finals are staged next to their targets and only moved into
place when every image of that slot succeeded. A partial carousel at the real
paths would read as "present" to inventory while being unpublishable garbage.

Runs under the hermes venv python (has PIL + requests):
  C:/Users/cyc39/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe
"""
import argparse
import base64
import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

HERMES_AGENT_DIR = r"C:\Users\cyc39\AppData\Local\hermes\hermes-agent"

# Grok's edit endpoint follows the source image's ratio, and 3:4 loses less to
# the 4:5 crop than 9:16 portrait would. Same choice the accepted 08-24 batch
# used; changing it changes framing on every future slide.
GEN_ASPECT = "3:4"
FINAL_SIZE = (1080, 1350)


def fetch_image(ref: str, dest: Path) -> None:
    """Materialize a provider result (cache path, data URI, or URL) at dest."""
    ref = str(ref)
    if ref.startswith("data:image/"):
        dest.write_bytes(base64.b64decode(ref.split(",", 1)[1]))
        return
    if ref.startswith(("http://", "https://")):
        req = urllib.request.Request(ref, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=180) as resp:
            dest.write_bytes(resp.read())
        return
    src = Path(ref)
    if src.is_file():
        shutil.copyfile(src, dest)
        return
    raise RuntimeError(f"provider returned an image reference that is neither URL, data URI nor file: {ref[:120]}")


def to_45(src: Path, dest: Path) -> None:
    """Center-crop to 4:5 and resize to the pipeline's 1080x1350 PNG."""
    from PIL import Image

    im = Image.open(src).convert("RGB")
    w, h = im.size
    target = 4 / 5
    if w / h < target:  # too tall -> crop height
        nh = int(w / target)
        top = (h - nh) // 2
        im = im.crop((0, top, w, top + nh))
    else:
        nw = int(h * target)
        left = (w - nw) // 2
        im = im.crop((left, 0, left + nw, h))
    im = im.resize(FINAL_SIZE, Image.LANCZOS)
    im.save(dest, "PNG")


def generate_with_retry(provider, prompt: str, *, image_url=None, attempts: int = 2):
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            if image_url is None:
                result = provider.generate(prompt, aspect_ratio=GEN_ASPECT)
            else:
                result = provider.generate(prompt, aspect_ratio=GEN_ASPECT, image_url=str(image_url))
            if result.get("success"):
                ref = result.get("image") or result.get("public_url")
                if ref:
                    return ref
                last_error = f"success without image reference (keys: {sorted(result.keys())})"
            else:
                last_error = str(result.get("error") or "unknown provider error")[:300]
        except Exception as exc:  # noqa: BLE001 - report, retry once, then fail the slot
            last_error = f"{type(exc).__name__}: {exc}"
        print(f"GEN_RETRY attempt={attempt} error={last_error}", flush=True)
        time.sleep(5)
    raise RuntimeError(last_error or "generation failed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--raw-dir", default="")
    args = parser.parse_args()

    root = Path(args.root)
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    date = plan["date"]
    raw_dir = Path(args.raw_dir) if args.raw_dir else root / "output" / "d3-imggen"
    raw_dir.mkdir(parents=True, exist_ok=True)

    items = plan.get("items") or []
    generated = []
    failed = []

    if items:
        sys.path.insert(0, HERMES_AGENT_DIR)
        from plugins.image_gen.xai import XAIImageGenProvider

        provider = XAIImageGenProvider()
        if not provider.is_available():
            print("FATAL no xAI credentials available to the hermes plugin", flush=True)
            failed.append({"slot": 0, "reason": "no xAI credentials (hermes OAuth pool / auth.json / XAI_API_KEY all empty)"})
            items = []

    slots = sorted({item["slot"] for item in items})
    for slot in slots:
        # The plan is already hero-first within a slot; keep that order.
        slot_items = [item for item in items if item["slot"] == slot]
        staged = []
        hero_raw = None
        try:
            for item in slot_items:
                slide = item["slide"]
                target = root / Path(*item["target_path"].split("/"))
                raw_path = raw_dir / f"{date}-s{slot}-sl{slide}-raw.png"
                if item["role"] == "hero":
                    ref = generate_with_retry(provider, item["prompt"])
                    fetch_image(ref, raw_path)
                    hero_raw = raw_path
                else:
                    if item.get("base_exists"):
                        base = root / Path(*item["base_path"].split("/"))
                    else:
                        base = hero_raw
                    if base is None or not Path(base).is_file():
                        raise RuntimeError(f"slide {slide} has no identity base image on disk")
                    ref = generate_with_retry(provider, item["prompt"], image_url=base)
                    fetch_image(ref, raw_path)
                target.parent.mkdir(parents=True, exist_ok=True)
                staging = target.with_name(target.name + ".staged")
                to_45(raw_path, staging)
                staged.append((staging, target, item))
                print(f"GEN_OK slot={slot} slide={slide} raw={raw_path.name}", flush=True)
            for staging, target, item in staged:
                staging.replace(target)
                generated.append(
                    {
                        "slot": slot,
                        "slide": item["slide"],
                        "path": item["target_path"],
                        "public_image_url": item["public_image_url"],
                    }
                )
            print(f"SLOT_DONE slot={slot} images={len(staged)}", flush=True)
        except Exception as exc:  # noqa: BLE001 - a failed slot must not sink the others
            for staging, _target, _item in staged:
                try:
                    staging.unlink()
                except OSError:
                    pass
            reason = f"{type(exc).__name__}: {exc}"[:300]
            failed.append({"slot": slot, "reason": reason})
            print(f"SLOT_FAIL slot={slot} reason={reason}", flush=True)

    result = {"date": date, "generated": generated, "failed": failed}
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"RESULT generated={len(generated)} failed={len(failed)} out={out_path}", flush=True)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
