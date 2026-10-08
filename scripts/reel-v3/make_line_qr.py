#!/usr/bin/env python3
"""Render the shop's LINE QR code as a PNG for the tail card.

The QR is generated, never drawn by an image model. A model-drawn QR is a
decorative grid of squares that will not scan, and inventing a code that points
somewhere is worse than having none.

Two destinations, both taken from the shop's own files rather than typed here:

  default    data/business-profile.json line_url -- straight to LINE
  --source X PUBLIC_SITE_BASE_URL/go/line.html?source=X -- the same LINE
             account by way of the shop's own redirect page, which fires a GA4
             line_click carrying the source. The printed poster already uses
             this form (source=poster-keba, read off the poster by decoding it),
             so a video that uses it too can be told apart from the poster in
             GA4. A code with no source is a click nobody can attribute.

Error correction is set to H (about 30% recoverable). Video compression eats
fine black-and-white detail, and a card that scans on a monitor but not after
H.264 is the failure worth spending redundancy on.

The result is decoded before it is written. A QR that does not read back is a
picture of a QR.

Usage: make_line_qr.py <out.png> [--source reel-shoe-20260913] [--px-per-module 12]
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H

REPO = Path(__file__).resolve().parents[2]
PROFILE = REPO / "data" / "business-profile.json"
ENV = REPO / ".env"
REDIRECT_PATH = "/go/line.html?source="


def site_base_url() -> str:
    """Origin from .env, the same variable src/contentPlan.ts composes with.

    Hardcoding the host here would let the video outlive a domain change that
    every other link in the repo follows.
    """
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            if line.startswith("PUBLIC_SITE_BASE_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--source", default="", help="tag the click; routes through the site's own redirect page")
    ap.add_argument("--px-per-module", type=int, default=12)
    ap.add_argument("--quiet-zone", type=int, default=4, help="modules of white margin; 4 is the spec minimum")
    args = ap.parse_args()

    if args.source:
        origin = site_base_url()
        if not origin:
            print("ABORT: .env has no PUBLIC_SITE_BASE_URL, so --source cannot be composed")
            return 1
        url = f"{origin}{REDIRECT_PATH}{args.source}"
    else:
        profile = json.loads(io.open(PROFILE, encoding="utf-8-sig").read())
        url = profile.get("line_url")
        if not url:
            print("ABORT: data/business-profile.json has no line_url")
            return 1

    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=args.px_per_module,
        border=args.quiet_zone,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    # Read it back. zxing-cpp was installed on 2026-09-13; before that this
    # script could only say "a human has to scan it once".
    try:
        import zxingcpp
    except ImportError:
        print("ABORT: zxing-cpp is not installed, so the code cannot be verified. "
              "pip install zxing-cpp")
        return 1
    found = zxingcpp.read_barcodes(img)
    texts = [r.text for r in found]
    if url not in texts:
        print(f"ABORT: the rendered code does not read back as {url!r}; decoder saw {texts!r}")
        return 1

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)

    modules = qr.modules_count
    print(f"url           : {url}")
    print(f"qr version    : {qr.version}  ({modules}x{modules} modules)")
    print(f"error correct : H (~30% recoverable)")
    print(f"image         : {img.width}x{img.height} px, {args.px_per_module} px per module, "
          f"{args.quiet_zone}-module quiet zone")
    print(f"decoded back  : OK ({len(found)} code found)")
    print(f"written       : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
