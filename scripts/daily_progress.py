#!/usr/bin/env python3
"""Daily progress ledger: is today measurably better than yesterday?

2026-08-17, owner's directive: indexing pushes and GA4 wiring existed, but no
mechanism compared day N against day N-1, so "progress" was a feeling. This
builds the comparison from artifacts that already exist on disk:

  - output/day-reports/<date>.json      publishing integrity + GA4 line_clicks
  - data/insights/instagram/*.json      per-post views / reach / watch time
  - output/operations/indexing-push-<date>.json   IndexNow submissions + audit

Rules inherited from the revenue operating system (three iron rules):
  null is NOT 0. A metric that could not be measured prints "null" and the
  comparison verdict is 無法比, never a fake regression to zero.

Output: appends a row to reports/daily-progress.md and writes the raw JSON to
output/operations/daily-progress-<date>.json. Run for "yesterday" by default,
because GA4 and IG insights mature overnight.
"""

import glob
import io
import json
import os
import sys
from datetime import date, datetime, timedelta

ROOT = os.environ.get("DAILY_PROGRESS_ROOT") or os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))
)


def read_json(path):
    try:
        return json.load(io.open(path, encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


def day_report(d):
    return read_json(os.path.join(ROOT, "output", "day-reports", f"{d}.json"))


def indexing_report(d):
    return read_json(os.path.join(ROOT, "output", "operations", f"indexing-push-{d}.json"))


def ig_rows_for(d):
    files = sorted(glob.glob(os.path.join(ROOT, "data", "insights", "instagram", "*.json")),
                   key=os.path.getmtime)
    if not files:
        return []
    data = read_json(files[-1]) or {}
    rows = []
    for row in data.get("rows", []):
        if row.get("date") != d:
            continue
        metrics = row.get("metrics")
        if metrics is None:
            metrics = row.get("insights")
        # Keep measured rows even when every metric is 0. Dropping them
        # turned a measured-zero day into null at aggregate time.
        if isinstance(metrics, dict):
            rows.append(metrics)
    return rows


def metrics_for(d):
    report = day_report(d)
    idx = indexing_report(d)
    ig = ig_rows_for(d)

    published_ok = None
    line_clicks = None
    if report:
        slots = report.get("slots") if "slots" in report else None
        if slots is None or slots == {} or slots == []:
            published_ok = None
        else:
            flags = [v for slot in slots.values() for v in slot.values()]
            published_ok = bool(flags) and all(flags) and not report.get("missing_posts")
        line_clicks = report.get("line_clicks", None)

    views = [m.get("views") for m in ig if isinstance(m.get("views"), (int, float))]
    watch = [m.get("ig_reels_avg_watch_time") for m in ig
             if isinstance(m.get("ig_reels_avg_watch_time"), (int, float))]

    if idx is None:
        pages_audited_ok = None
    elif "audited" not in idx or idx.get("audited") is None:
        pages_audited_ok = None
    else:
        pages_audited_ok = sum(
            1 for p in idx.get("audited", [])
            if isinstance(p, dict) and p.get("status") == 200 and not p.get("thin")
        )

    return {
        "date": d,
        "published_all_slots": published_ok,
        "line_clicks": line_clicks,
        "ig_posts_measured": len(ig),
        "ig_views_sum": sum(views) if views else None,
        "ig_watch_avg_ms": round(sum(watch) / len(watch)) if watch else None,
        "indexnow_submitted": (idx or {}).get("submitted", None),
        "indexnow_status": (idx or {}).get("indexnow_status", None),
        "pages_audited_ok": pages_audited_ok,
    }


def verdict(today, yesterday):
    if today is None or yesterday is None:
        return "無法比"
    if today > yesterday:
        return "↑"
    if today < yesterday:
        return "↓"
    return "→"


def fmt(value):
    return "null" if value is None else str(value)


def replace_day_block(existing, target, block):
    """Replace only the target day's section; keep earlier and later dates."""
    marker = "## {0}(".format(target)
    start = existing.find(marker)
    if start < 0:
        header = ""
        if not existing.strip():
            header = "# 每日進步帳\n\n每天問同一個問題:比昨天好嗎?null=未量測≠0。\n\n"
        body = existing
        if body and not body.endswith("\n"):
            body += "\n"
        return body + header + block + "\n"
    next_h2 = existing.find("\n## ", start + len(marker))
    prefix = existing[:start]
    suffix = existing[next_h2 + 1:] if next_h2 >= 0 else ""
    if prefix and not prefix.endswith("\n"):
        prefix += "\n"
    text = block if block.endswith("\n") else block + "\n"
    if suffix:
        return prefix + text + "\n" + suffix
    return prefix + text


def atomic_write(path, text):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = "{0}.tmp-{1}-{2}".format(path, os.getpid(), int(datetime.now().timestamp() * 1000))
    try:
        with io.open(tmp, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise


def main():
    # The scheduler console decodes cp950; arrows and check marks kill print.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    target = sys.argv[1] if len(sys.argv) > 1 else (date.today() - timedelta(days=1)).isoformat()
    prev = (datetime.strptime(target, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
    today = metrics_for(target)
    yesterday = metrics_for(prev)

    compare_keys = [
        ("line_clicks", "LINE 點擊(GA4)"),
        ("ig_views_sum", "IG 觀看合計"),
        ("ig_watch_avg_ms", "IG 平均停留 ms"),
        ("indexnow_submitted", "IndexNow 提交數"),
        ("pages_audited_ok", "頁面稽核通過"),
    ]
    lines = [f"## {target}(對照 {prev})", ""]
    lines.append("| 指標 | 前一天 | 當天 | 判定 |")
    lines.append("|---|---|---|---|")
    ups = downs = 0
    for key, label in compare_keys:
        v = verdict(today.get(key), yesterday.get(key))
        ups += v == "↑"
        downs += v == "↓"
        lines.append(f"| {label} | {fmt(yesterday.get(key))} | {fmt(today.get(key))} | {v} |")
    lines.append(f"| 發布完整(全槽) | {fmt(yesterday.get('published_all_slots'))} | {fmt(today.get('published_all_slots'))} | {'✓' if today.get('published_all_slots') else '✗' if today.get('published_all_slots') is not None else 'null'} |")
    lines.append("")
    lines.append(f"**結論:{ups} 項進步、{downs} 項退步**"
                 f"(null 表示未量測,不算 0、不算退步;generated {datetime.now().isoformat(timespec='seconds')})")
    lines.append("")
    block = "\n".join(lines)

    ledger = os.path.join(ROOT, "reports", "daily-progress.md")
    existing = ""
    if os.path.exists(ledger):
        existing = io.open(ledger, encoding="utf-8").read()
    atomic_write(ledger, replace_day_block(existing, target, block))

    out_json = os.path.join(ROOT, "output", "operations", f"daily-progress-{target}.json")
    atomic_write(
        out_json,
        json.dumps({"target": today, "previous": yesterday}, ensure_ascii=False, indent=1),
    )
    print(block)


if __name__ == "__main__":
    main()
