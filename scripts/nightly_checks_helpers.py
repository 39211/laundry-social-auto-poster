"""Pure helpers for scripts/nightly_optimize.py.

Kept free of I/O and side effects on purpose: they are how we prove a quiet
night stays quiet and a broken night lights up. test/py/test_nightly_checks_helpers.py
tests them with plain unittest (run in CI), and test/nightlyChecks.test.ts
checks them once per file through a single isolated python process.
"""

import re

URL_RE = re.compile(r"https?://\S+", re.I)
PRICE_RE = re.compile(r"\$[0-9]+|[0-9]+元|參考價|[0-9]+起")
PICKUP_RE = re.compile(r"收送|到府|外送")
CONTACT_RE = re.compile(r"LINE|line|0968")
QUESTION_RE = re.compile(r"[?？]")
PRIMARY_SLOTS = {1, 2}
CONVERSION_FIELDS = ("收送句", "價格線索", "提問", "聯絡方式")


def strip_caption_urls(text):
    return URL_RE.sub("", text or "")


def caption_has(name, text):
    raw = text or ""
    if name == "提問":
        return bool(QUESTION_RE.search(strip_caption_urls(raw)))
    if name == "價格線索":
        return bool(PRICE_RE.search(raw))
    if name == "收送句":
        return bool(PICKUP_RE.search(raw))
    if name == "聯絡方式":
        return bool(CONTACT_RE.search(raw))
    return False


def primary_captions(cal):
    if not cal:
        return []
    out = []
    for slot in cal.get("slots") or []:
        if slot.get("slot") in PRIMARY_SLOTS:
            out.append(slot.get("instagram_caption") or "")
    return out


def generator_lacks(name, *cals):
    """True only when every primary caption on every given day lacks `name`.

    One healthy day (or a missing calendar) is not a generator defect.
    Two consecutive generated days all missing the same field is.
    """
    days = [primary_captions(cal) for cal in cals]
    if len(days) < 2 or any(len(caps) == 0 for caps in days):
        return False
    return all(not caption_has(name, cap) for caps in days for cap in caps)


def conversion_generator_findings(yesterday_cal, today_cal, yesterday, today):
    rows = []
    labels = {
        "收送句": "產生器沒寫收送",
        "價格線索": "產生器沒寫價格線索",
        "提問": "產生器沒寫提問",
        "聯絡方式": "產生器沒寫聯絡方式",
    }
    for name in CONVERSION_FIELDS:
        if generator_lacks(name, yesterday_cal, today_cal):
            rows.append({
                "severity": "MED",
                "area": "轉單要素",
                "what": labels[name],
                "evidence": (
                    f"data/content-calendar/{yesterday}.json 與 {today}.json "
                    f"的 slot 1/2 連續兩天缺 {name}"
                ),
                "fix": "修 src/contentPlan.ts 文案模板;06:30 generate 會覆寫明天草稿,不要手補明天曆",
            })
    return rows


def ready_chain_breaks(line):
    """Parse Generate-task probe `state|wake|next`. One list, one finding."""
    line = (line or "").strip()
    if not line:
        return ["排程探測空"]
    state, wake, nxt = (line.split("|") + ["", "", ""])[:3]
    broken = []
    if state == "MISSING":
        broken.append("排程不在")
    if state != "MISSING" and not nxt.strip():
        broken.append("觸發器沒有下次")
    if state != "MISSING" and wake.strip().lower() not in ("true", "$true"):
        broken.append("叫不醒")
    return broken


def today_image_path(day, slot_n):
    return f"docs/assets/{day}/slot-{int(slot_n):02d}.png"


def today_image_fix(day):
    return (
        f"先 invalidate 失效舊圖,再 npm run generate-image-manifest -- --date {day} "
        f"重生 manifest,再跑 scripts/generate-missing-images.ps1 -Date {day} 補產,產完親眼看圖"
    )


def opt_log_severity(has_log, has_success_post, has_git):
    if has_log:
        return None
    if not has_success_post and not has_git:
        return "HIGH"
    return "MED"
