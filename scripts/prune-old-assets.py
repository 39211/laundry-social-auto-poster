"""Retention for docs/assets/<date>/ media folders.

Policy (owner decision, 2026-08-22): a date's media stays as long as any of
that date's posts are still referenced by docs/feed.json's rolling 100-item
window (currently ~44 days). Once a date ages out of the feed, its media is
no longer linked from anything actively crawled (the AEO feed is the only
consumer of these raw asset URLs outside docs/posts/<date>-slot-N.html,
whose own images point at the same files and go stale right along with
them -- that page's text/structured content stays crawlable regardless).
Tying retention to the feed's own window, rather than a fixed day count,
means this script never deletes something the feed still points at.

Never touches docs/assets/backgrounds or docs/assets/services (not date
folders), and never touches today or future dates (staged content waiting
to air).

Usage:
    python scripts/prune-old-assets.py            # dry run, prints what would be removed
    python scripts/prune-old-assets.py --apply     # actually deletes
"""

import argparse
import json
import re
import shutil
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "docs" / "assets"
FEED_PATH = ROOT / "docs" / "feed.json"
DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FEED_IMAGE_DATE_RE = re.compile(r"/assets/(\d{4}-\d{2}-\d{2})/")


def dates_referenced_by_feed() -> set[str]:
    with open(FEED_PATH, encoding="utf-8") as f:
        feed = json.load(f)
    referenced = set()
    for item in feed.get("items", []):
        m = FEED_IMAGE_DATE_RE.search(item.get("image", ""))
        if m:
            referenced.add(m.group(1))
    return referenced


def prune_candidates(today: str) -> list[str]:
    referenced = dates_referenced_by_feed()
    candidates = []
    for entry in sorted(ASSETS_DIR.iterdir()):
        if not entry.is_dir() or not DATE_DIR_RE.match(entry.name):
            continue
        if entry.name >= today:
            continue
        if entry.name in referenced:
            continue
        candidates.append(entry.name)
    return candidates


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually delete; default is dry-run")
    parser.add_argument("--today", default=None, help="override today's date (YYYY-MM-DD), for testing")
    args = parser.parse_args()

    today = args.today or datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    candidates = prune_candidates(today)

    if not candidates:
        print(f"[prune-old-assets] nothing to prune as of {today}.")
        return

    total_bytes = 0
    for name in candidates:
        folder = ASSETS_DIR / name
        size = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
        total_bytes += size
        action = "removing" if args.apply else "would remove"
        print(f"[prune-old-assets] {action} {folder} ({size / 1_048_576:.1f} MB)")
        if args.apply:
            shutil.rmtree(folder)

    print(
        f"[prune-old-assets] {'removed' if args.apply else 'would remove'} "
        f"{len(candidates)} date folder(s), {total_bytes / 1_048_576:.1f} MB total."
    )
    if not args.apply:
        print("[prune-old-assets] dry run only -- pass --apply to actually delete.")


if __name__ == "__main__":
    main()
