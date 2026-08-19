# F15 full-rule simulation for W-SLOT1SWAP. Read-only. Does not write schedule or calendar.
# Replays reel loader rules (day-by-day, 21-day cooldown, adjacent object_type)
# and the 7-day object-gram window used by autoApprove.

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TOPIC_LABEL_PREFIX_RE = re.compile(r"^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：")
TOPIC_LEAD_INS = re.compile(r"怎麼判斷|怎麼辦|你可能|其實|今天|當天|門市檢查|最髒的|先看|再看")
CJK3 = re.compile(r"^[一-鿿]{3}$")
COOLDOWN_DAYS = 21

BUILT_IN_CONCEPTS = {
    "white-shoe-yellowing": "white-shoe",
    "handbag-handle": "handbag",
    "leather-shoe-rain": "leather-shoe",
    "plush-doll": "plush-doll",
    "duvet-storage": "duvet",
    "leather-bag-corner": "leather-bag",
    "shirt-collar": "shirt",
    "suit-shoulder": "suit",
    "curtain-hem": "curtain",
    "luggage-wheel": "luggage",
    "backpack-base": "backpack",
    "canvas-shoe-mud": "canvas-shoe",
}

BUILT_IN_SCHEDULE = [
    ("2026-07-29", "leather-bag-corner"),
    ("2026-08-02", "handbag-handle"),
    ("2026-08-03", "duvet-storage"),
    ("2026-08-06", "canvas-shoe-mud"),
    ("2026-08-07", "suit-shoulder"),
    ("2026-08-08", "backpack-base"),
    ("2026-08-09", "curtain-hem"),
    ("2026-08-10", "plush-doll"),
    ("2026-08-11", "leather-shoe-rain"),
    ("2026-08-12", "white-shoe-yellowing"),
    ("2026-08-13", "shirt-collar"),
    ("2026-08-14", "luggage-wheel"),
]


def object_head(topic: str) -> str:
    text = TOPIC_LABEL_PREFIX_RE.sub("", topic)
    text = re.sub(r"[（(].*?[)）]", "", text)
    text = TOPIC_LEAD_INS.sub("", text)
    text = re.sub(r"[：:，,。!？?\s]", "", text)
    return text[:8]


def repeating_gram(left: str, right: str) -> str | None:
    head = object_head(left)
    other = object_head(right)
    for i in range(0, len(other) - 2):
        gram = other[i : i + 3]
        if CJK3.match(gram) and gram in head:
            return gram
    return None


def add_days(iso: str, n: int) -> str:
    y, m, d = (int(p) for p in iso.split("-"))
    return (date(y, m, d) + timedelta(days=n)).isoformat()


def simulate_reel_schedule() -> dict:
    ext = json.loads((ROOT / "data" / "reel-concepts-extension.json").read_text(encoding="utf-8-sig"))
    concepts = dict(BUILT_IN_CONCEPTS)
    rejected_concepts = []
    for entry in ext.get("concepts") or []:
        cid = entry.get("id")
        otype = entry.get("object_type")
        hook = entry.get("hook") or ""
        narration = entry.get("narration") or ""
        close = entry.get("close") or ""
        if not cid or cid in concepts:
            rejected_concepts.append(f"concept-id:{cid}")
            continue
        if not (7 <= len(hook) <= 20):
            rejected_concepts.append(f"concept-hook:{cid}")
            continue
        if not (21 <= len(narration) <= 36):
            rejected_concepts.append(f"concept-narration:{cid}")
            continue
        if narration.startswith(hook[:2]):
            rejected_concepts.append(f"concept-narration-restates:{cid}")
            continue
        if len(close) < 7:
            rejected_concepts.append(f"concept-close:{cid}")
            continue
        if not otype:
            rejected_concepts.append(f"concept-otype:{cid}")
            continue
        concepts[cid] = otype

    schedule = list(BUILT_IN_SCHEDULE)
    accepted = []
    rejected = []
    for entry in ext.get("schedule") or []:
        last_date, last_id = schedule[-1]
        expected = add_days(last_date, 1)
        cid = entry.get("conceptId")
        d = entry.get("date")
        otype = concepts.get(cid)
        last_otype = concepts.get(last_id)
        cooldown_start = add_days(d, -COOLDOWN_DAYS) if isinstance(d, str) else ""
        used_within = any(s_id == cid and s_date > cooldown_start for s_date, s_id in schedule)
        ok = (
            isinstance(d, str)
            and d == expected
            and otype is not None
            and not used_within
            and otype != last_otype
        )
        if ok:
            schedule.append((d, cid))
            accepted.append(d)
        else:
            why = []
            if d != expected:
                why.append(f"expected {expected} got {d}")
            if otype is None:
                why.append("unknown concept")
            if used_within:
                why.append("cooldown")
            if otype == last_otype:
                why.append(f"adjacent {otype}")
            rejected.append({"entry": entry, "why": why})

    return {
        "built_in": len(BUILT_IN_SCHEDULE),
        "extension_accepted": len(accepted),
        "extension_rejected": rejected,
        "rejected_concepts": rejected_concepts,
        "total_schedule": len(schedule),
        "first_ext": accepted[0] if accepted else None,
        "last_ext": accepted[-1] if accepted else None,
        "adjacent_ok": all(
            concepts[schedule[i][1]] != concepts[schedule[i - 1][1]] for i in range(1, len(schedule))
        ),
        "day_by_day_ok": all(
            add_days(schedule[i - 1][0], 1) == schedule[i][0]
            or schedule[i][0] in {row[0] for row in BUILT_IN_SCHEDULE}
            for i in range(1, len(schedule))
            if schedule[i][0] >= "2026-08-15"
        ),
    }


def load_day_topics(iso: str) -> list[tuple[int, str]]:
    path = ROOT / "data" / "content-calendar" / f"{iso}.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    out = []
    for slot in data.get("slots") or []:
        topic = slot.get("topic")
        if isinstance(topic, str) and topic.strip():
            out.append((int(slot.get("slot") or 0), topic))
    return out


def window_topics(center: str, days: int = 7) -> list[dict]:
    rows = []
    for delta in range(-days, days + 1):
        if delta == 0:
            continue
        iso = add_days(center, delta)
        for slot, topic in load_day_topics(iso):
            rows.append({"date": iso, "slot": slot, "topic": topic, "head": object_head(topic)})
        if not load_day_topics(iso) and delta > 0:
            plan = json.loads((ROOT / "data" / "slot1-plan.json").read_text(encoding="utf-8-sig"))
            if iso in plan:
                rows.append(
                    {
                        "date": iso,
                        "slot": 1,
                        "topic": plan[iso],
                        "head": object_head(plan[iso]),
                        "source": "slot1-plan",
                    }
                )
    return rows


def collisions(candidate: str, rows: list[dict]) -> list[dict]:
    hits = []
    for row in rows:
        gram = repeating_gram(candidate, row["topic"])
        if gram:
            hits.append({**row, "gram": gram})
    return hits


def main() -> None:
    reel = simulate_reel_schedule()
    center = "2026-08-19"
    rows = window_topics(center, 7)
    # same-day other slots also listed for honesty
    same_day = load_day_topics(center)
    same_day_others = [{"date": center, "slot": s, "topic": t, "head": object_head(t)} for s, t in same_day if s != 1]

    current_slot1 = next((t for s, t in same_day if s == 1), "")
    plan = json.loads((ROOT / "data" / "slot1-plan.json").read_text(encoding="utf-8-sig"))
    planned = plan[center]

    candidates = [
        planned,
        "診所淺藍短袖護理服領口袖口每週收送",
        "娃娃不是不能洗是不能亂洗",
        "行李箱輪子卡泥",
        "棉被收納前先聞一下",
        "窗簾拆洗",
        "沙發布面",
        "領帶油痕",
        "保潔墊黃圈",
        "長夾邊角起毛",
    ]

    report = {
        "reel": {
            "accepted": reel["extension_accepted"],
            "rejected": len(reel["extension_rejected"]),
            "score": f"{reel['extension_accepted']}/60",
            "pass": reel["extension_accepted"] == 60 and len(reel["extension_rejected"]) == 0,
            "adjacent_ok": reel["adjacent_ok"],
            "day_by_day_ok": reel["day_by_day_ok"],
            "span": [reel["first_ext"], reel["last_ext"]],
            "rejected_detail": reel["extension_rejected"][:5],
        },
        "window_rows": rows + same_day_others,
        "current_slot1": current_slot1,
        "planned_slot1": planned,
        "current_vs_8_14": repeating_gram(current_slot1, "可收藏：白鞋鞋邊泛灰前的檢查，送洗前先看三個位置"),
        "candidates": [],
    }
    for cand in candidates:
        hits = collisions(cand, rows + same_day_others)
        report["candidates"].append(
            {
                "topic": cand,
                "head": object_head(cand),
                "hit_count": len(hits),
                "hits": hits,
                "ok": len(hits) == 0,
            }
        )

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
