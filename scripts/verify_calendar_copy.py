#!/usr/bin/env python3
"""Deterministic acceptance for rewritten FB/IG calendar copy (read-only).

Written 2026-09-17 after the seo-desk bot's rewrite of 2026-09-19..10-08 shipped
captions that described the post instead of speaking to the customer, a 6-day
topic loop, a non-standard hashtag set, no price clues, and Reel formats with no
video behind them. Each of those is a rule here, and each rule is proven to fire
by --self-test.

Rules (per slot unless noted):
  LEAK      no writer-instruction sentence in the FB or IG caption
  TAGS      hashtags <= 6, includes #私享家洗衣店 and #台中洗衣店,
            excludes #台中 #西屯 #逢甲 as whole tags
  PRICE     a 參考價 line (hard for object topics; promo/pickup topics exempt)
  LENGTH    FB body (before the LINE line) 80..400 characters
  REPEAT    no object repeated 1..7 days apart across all slots or twice on the
            same day (objects are finer than families: canvas shoe != leather
            shoe), and no two identical normalised topics anywhere in the range
  SAMEDAY   slot 2 is not slot 1's family on the same day (topicQuota.test.ts)
  ADJACENT  a slot-3 object family differs from the previous day's slot-3
  FORMAT    reel format only where a video file exists or the slot is slot 3
            (the daily reel line owns slot 3)
  PASSPORT  the image_prompt OBJECT PASSPORT names a noun consistent with the
            topic's object (a generic 'matching the topic' passport fails)
  BODY      past the opening line the FB body still names the topic's object
  PROV      AI media is labelled: no 「門市當日看件」, and 「AI生成示意」 present
            (GPT-6 Pro 2026-09-17 Q6)
  STALE     no 「開學前」 once the term has started (from 09-10)

Usage:
  verify_calendar_copy.py --from 2026-09-19 --to 2026-10-08 [--context-from 2026-09-12] [--root DIR]
  verify_calendar_copy.py --self-test
"""
from __future__ import annotations

import datetime as dt
import io
import json
import os
import re
import sys

ROOT = r"C:\Users\cyc39\laundry-repo"

LEAK = [
    "店內先做材質判斷", "看一個關鍵位置", "避開一個錯誤做法", "先看一個位置",
    "晚上用短影片", "中午這則用短影片", "材質判斷短影片", "補強同一個判斷邏輯",
    "物件異常＋一個錯誤做法", "可收藏的材質判斷", "文末可走", "這篇先提醒你",
    "用短影片做", "這則貼文", "本篇", "本則", "這支影片會", "以下將",
]
REQUIRED_TAGS = ["#私享家洗衣店", "#台中洗衣店"]
BANNED_TAGS = ["#台中", "#西屯", "#逢甲"]
# Objects are the unit of the 7-day rule. They are finer than families on
# purpose: canvas shoes and leather shoes are different posts, but the same
# canvas shoe asked a different way is the same post (GPT-6 Pro, 2026-09-17).
# First match wins, so the longer / more specific nouns come first.
FAMILIES = [
    ("storage", ["鞋櫃", "衣櫃", "收納櫃"]),
    ("cover", ["電熱毯套"]),
    ("plush", ["娃娃", "玩偶"]),
    ("luggage", ["行李箱"]),
    ("luxury-bag", ["精品包", "名牌包", "愛馬仕包", "柏金", "菱格包"]),
    ("backpack", ["背包", "書包"]),
    ("wallet", ["皮夾", "長夾", "錢包"]),
    ("bag", ["皮包", "包包", "包角", "提把", "化妝包"]),
    ("sandal", ["勃肯", "軟木", "拖鞋", "涼鞋"]),
    ("heel", ["高跟", "香奈兒雙色鞋"]),
    ("canvas-shoe", ["帆布鞋"]),
    ("boot", ["靴", "登山鞋"]),
    ("leather-shoe", ["皮鞋", "樂福"]),
    ("shoe", ["白鞋", "球鞋", "運動鞋", "網布", "童鞋", "鞋"]),
    ("leather", ["皮件", "皮衣", "皮帶"]),
    ("curtain", ["窗簾"]),
    ("doormat", ["踏墊"]),
    ("carpet", ["地毯"]),
    ("cushion", ["抱枕"]),
    ("pillow", ["枕頭"]),
    ("sheet", ["被單", "床單", "被套", "床包", "床組"]),
    ("mattress-pad", ["保潔墊"]),
    ("duvet", ["棉被", "被子", "羽絨被", "薄被", "厚被", "涼被"]),
    ("blanket", ["毛毯", "寵物毯", "電熱毯", "沙發毯", "毯"]),
    ("sofa", ["沙發"]),
    ("down", ["羽絨"]),
    ("coat", ["大衣", "風衣"]),
    ("suit", ["西裝", "領帶", "肩線"]),
    ("shirt", ["制服", "襯衫", "領口"]),
    ("sweater", ["毛衣", "針織"]),
    ("promo", ["免費收送", "收送", "儲值金", "門口", "價目", "估價"]),
]
PASSPORT_NOUNS = {
    "plush": r"plush|stuffed|toy|doll",
    "luggage": r"suitcase|luggage",
    "luxury-bag": r"bag|handbag|tote|purse|satchel",
    "backpack": r"backpack|rucksack|school ?bag",
    "wallet": r"wallet|billfold",
    "bag": r"bag|handbag|tote|purse|satchel|pouch",
    "sandal": r"sandal|cork|footbed|slipper|clog",
    "heel": r"heel|pump|slingback",
    "canvas-shoe": r"canvas",
    "boot": r"boot",
    "leather-shoe": r"leather (?:shoe|oxford|derby|loafer)|oxford|derby|loafer",
    "shoe": r"shoe|sneaker|trainer",
    "leather": r"leather|jacket|belt",
    "curtain": r"curtain|drape",
    "doormat": r"doormat|\bmat\b",
    "carpet": r"\brug\b|carpet",
    "cushion": r"cushion|pillow",
    "pillow": r"pillow",
    "sheet": r"sheet|bedding|duvet cover|pillowcase|bed ?linen",
    "mattress-pad": r"mattress (?:pad|protector)|\bpad\b|protector",
    "duvet": r"duvet|quilt|comforter",
    "blanket": r"blanket|throw",
    "sofa": r"sofa|couch",
    "down": r"down (?:jacket|coat|vest)|puffer",
    "coat": r"\bcoat\b|overcoat|trench",
    "suit": r"\bsuit|\bnecktie|\btie\b|blazer",
    "shirt": r"uniform|shirt|collar|blouse",
    "sweater": r"sweater|knit|cardigan",
    "promo": r".",
}
PRICE_EXEMPT = {"promo", "other", "storage", "cover"}
REAIR_MIN_DAYS = 10

# Reel slots are named by their hook ("先看四個角的邊油"), which often has no
# object word. The cover prompt carries the concept id, and each concept
# declares object_type in src/reelConcepts.ts / reel-concepts-extension.json.
CONCEPT_OBJECT = {
    "white-shoe": "shoe", "kids-shoe": "shoe", "suede-shoe": "shoe",
    "handbag": "bag", "leather-bag": "bag", "wallet": "wallet",
    "leather-shoe": "leather-shoe", "high-heel": "heel",
    "hiking-boot": "boot", "leather-boot": "boot",
    "canvas-shoe": "canvas-shoe", "backpack": "backpack", "luggage": "luggage",
    "plush-doll": "plush", "duvet": "duvet", "blanket": "blanket",
    "mattress-pad": "mattress-pad", "curtain": "curtain",
    "shirt": "shirt", "suit": "suit", "wool-coat": "coat", "down-jacket": "down",
    "sweater": "sweater", "denim": "denim", "leather-belt": "leather",
}
CONCEPT_TYPE = {
    "white-shoe-yellowing": "white-shoe", "white-shoe-rescue": "white-shoe",
    "handbag-handle": "handbag", "leather-shoe-rain": "leather-shoe",
    "plush-doll": "plush-doll", "duvet-storage": "duvet", "leather-bag-corner": "leather-bag",
    "shirt-collar": "shirt", "suit-shoulder": "suit", "curtain-hem": "curtain",
    "luggage-wheel": "luggage", "backpack-base": "backpack", "canvas-shoe-mud": "canvas-shoe",
    "down-jacket-cuff": "down-jacket", "wool-coat-shoulder": "wool-coat",
    "suede-shoe-nap": "suede-shoe", "heel-tip-scuff": "high-heel",
    "leather-belt-crease": "leather-belt", "mattress-pad-sweat": "mattress-pad",
    "blanket-pilling": "blanket", "denim-knee-fade": "denim", "wallet-edge-wear": "wallet",
    "kids-shoe-toe": "kids-shoe", "hiking-boot-mud": "hiking-boot",
    "sweater-underarm": "sweater", "boot-mould-bloom": "leather-boot",
}
# object family -> the production topicFamily() bucket used for adjacency
OBJECT_COARSE = {
    "plush": "plush", "luggage": "luggage", "boot": "boot",
    "curtain": "textile", "doormat": "textile", "carpet": "textile", "pillow": "textile", "cushion": "textile",
    "sheet": "textile", "mattress-pad": "textile", "duvet": "textile", "blanket": "textile", "sofa": "textile",
    "shoe": "shoe", "heel": "shoe", "canvas-shoe": "shoe", "leather-shoe": "shoe", "sandal": "other",
    "luxury-bag": "bag", "backpack": "bag", "bag": "bag", "wallet": "bag", "leather": "bag",
    "down": "garment", "coat": "garment", "suit": "garment", "shirt": "garment", "sweater": "garment", "denim": "garment",
}


def concept_of(slot: dict) -> str:
    m = re.search(r"references/([a-z-]+)-before\.png", slot.get("image_prompt") or "")
    return (m.group(1) if m else "") or (slot.get("concept_id") or "")


def slot_family(slot: dict) -> str:
    typ = CONCEPT_TYPE.get(concept_of(slot))
    if typ:
        return CONCEPT_OBJECT.get(typ, "other")
    return family(slot.get("topic") or "")


def slot_coarse(slot: dict) -> str:
    typ = CONCEPT_TYPE.get(concept_of(slot))
    if typ:
        return OBJECT_COARSE.get(CONCEPT_OBJECT.get(typ, ""), "other")
    return coarse_family(slot.get("topic") or "")
# Generic nouns a body about that object will use at least once.
BODY_KEYS = {
    "plush": ["娃娃", "玩偶", "填充"],
    "luggage": ["行李箱", "輪子", "拉桿"],
    "luxury-bag": ["包"],
    "backpack": ["包"],
    "wallet": ["夾", "皮"],
    "bag": ["包"],
    "sandal": ["鞋", "軟木", "勃肯"],
    "heel": ["鞋", "跟"],
    "canvas-shoe": ["鞋", "帆布"],
    "boot": ["靴", "鞋"],
    "leather-shoe": ["鞋"],
    "shoe": ["鞋"],
    "leather": ["皮"],
    "curtain": ["窗簾"],
    "doormat": ["踏墊", "墊"],
    "carpet": ["地毯", "毯"],
    "pillow": ["枕"],
    "cushion": ["枕"],
    "sheet": ["被單", "床單", "被套", "床包", "床組"],
    "mattress-pad": ["保潔墊", "墊"],
    "duvet": ["被"],
    "blanket": ["毯"],
    "sofa": ["沙發"],
    "down": ["羽絨"],
    "coat": ["大衣", "風衣", "外套"],
    "suit": ["西裝", "領帶", "肩"],
    "shirt": ["領", "制服", "襯衫"],
    "sweater": ["毛衣", "針織"],
}


def family(topic: str) -> str:
    for name, keys in FAMILIES:
        if any(k in topic for k in keys):
            return name
    return "other"


def coarse_family(topic: str) -> str:
    """Verbatim port of topicFamily() in test/topicQuota.test.ts (production rule:
    slot 2 is never the same family as slot 1 on the same day)."""
    if re.search(r"娃娃|玩偶", topic):
        return "plush"
    if re.search(r"行李箱", topic):
        return "luggage"
    if re.search(r"靴|登山鞋", topic):
        return "boot"
    if re.search(r"被|毯|枕|床|窗簾|地毯|踏墊|抱枕|沙發|保潔墊|寢", topic):
        return "textile"
    if re.search(r"鞋", topic):
        return "shoe"
    if re.search(r"包|夾|皮帶", topic):
        return "bag"
    if re.search(r"衣|外套|西裝|襯衫|制服|禮服|雨衣|領帶|圍巾|牛仔|針織|大衣|羽絨|棉麻|安全帽", topic):
        return "garment"
    return "other"


def tags(text: str) -> list[str]:
    return re.findall(r"#[^\s#]+", text or "")


def body_before_line(caption: str) -> str:
    cut = caption.find("line.html")
    head = caption[:cut] if cut > 0 else caption
    head = re.sub(r"#[^\s#]+", "", head)
    return re.sub(r"\s+", "", head)


def check_slot(date: str, s: dict, root: str) -> list[str]:
    bad = []
    fb, ig = s.get("facebook_caption") or "", s.get("instagram_caption") or ""
    topic = s.get("topic") or ""
    fam = slot_family(s)
    for name, cap in (("fb", fb), ("ig", ig)):
        hit = [k for k in LEAK if k in cap]
        if hit:
            bad.append(f"LEAK {name}: {hit[0]}")
        t = tags(cap)
        if len(t) > 6:
            bad.append(f"TAGS {name}: {len(t)} > 6")
        for req in REQUIRED_TAGS:
            if req not in t:
                bad.append(f"TAGS {name}: missing {req}")
        for ban in BANNED_TAGS:
            if ban in t:
                bad.append(f"TAGS {name}: has {ban}")
    if fam not in PRICE_EXEMPT and "參考價" not in fb:
        bad.append("PRICE: no 參考價 line")
    n = len(body_before_line(fb))
    if not 80 <= n <= 400:
        bad.append(f"LENGTH: body {n} chars, want 80..400")
    fmt = (s.get("format") or s.get("media_type") or "")
    if fmt == "reel" and int(s.get("slot") or 0) != 3:
        vid = s.get("local_video_path") or ""
        if not (vid and os.path.exists(os.path.join(root, vid))):
            bad.append("FORMAT: reel on a non-slot-3 slot with no video file")
    ip = s.get("image_prompt") or ""
    m = re.search(r"OBJECT PASSPORT:(.{0,160})", ip)
    if m and "matching the topic" in m.group(1):
        bad.append("PASSPORT: generic fallback passport (no named object)")
    elif m and fam in PASSPORT_NOUNS and not re.search(PASSPORT_NOUNS[fam], m.group(1), re.I):
        bad.append(f"PASSPORT: topic family {fam} but passport says '{m.group(1).strip()[:60]}'")
    for name, cap in (("fb", fb), ("ig", ig)):
        if "門市當日看件" in cap:
            bad.append(f"PROV {name}: claims 門市當日看件 over AI media")
        elif "AI生成示意" not in cap:
            bad.append(f"PROV {name}: no AI生成示意 label")
        if "開學前" in cap and date[5:] >= "09-10" and date[5:] <= "12-31":
            bad.append(f"STALE {name}: 開學前 after the term started")
    # BODY: once the topic sentence is removed, the caption must still talk
    # about the object (the generator once put a bedding paragraph under a
    # Birkenstock topic).
    keys = BODY_KEYS.get(fam)
    if keys:
        paras = [x for x in fb.split("\n\n") if x.strip()]
        rest = "".join(
            x for x in paras
            if not x.startswith(("參考價", "#", "出處", "下一集")) and "line.html" not in x
        ).replace(topic, "")
        if not any(k in rest for k in keys):
            bad.append(f"BODY: body never names the {fam} object ({'/'.join(keys[:3])})")
    return bad


def check_range(cals: dict[str, dict], root: str, held: set | None = None) -> dict[str, list[str]]:
    held = held or set()
    out: dict[str, list[str]] = {}
    dates = sorted(cals)
    seen_topic: dict[str, str] = {}
    for d in dates:
        for s in cals[d]["slots"]:
            key = f"{d}#{s['slot']}"
            out[key] = check_slot(d, s, root)
            nt = re.sub(r"[，,。！？?：:\s]", "", s.get("topic") or "")
            prev_key = seen_topic.get(nt)
            gap = (dt.date.fromisoformat(d) - dt.date.fromisoformat(prev_key[:10])).days if prev_key else None
            # a finished reel may re-air after >= 10 days (GPT-6 Pro R8, R6); text posts never repeat
            if prev_key and not (concept_of(s) and gap >= REAIR_MIN_DAYS):
                out[key].append(f"REPEAT: same topic as {prev_key}")
            seen_topic[nt] = key
    # 7-day object window across all slots (promo/other exempt). Same bound as
    # topicQuota.test.ts: anything 1..7 days apart collides, 8 is clear.
    for i, d in enumerate(dates):
        day = dt.date.fromisoformat(d)
        cur = {int(s["slot"]): s for s in cals[d]["slots"]}
        for s in cals[d]["slots"]:
            if f"{d}#{s['slot']}" in held:
                continue
            fam = slot_family(s)
            if fam in PRICE_EXEMPT:
                continue
            for d2 in dates[:i]:
                if (day - dt.date.fromisoformat(d2)).days > 7:
                    continue
                for s2 in cals[d2]["slots"]:
                    if f"{d2}#{s2['slot']}" not in held and slot_family(s2) == fam:
                        out[f"{d}#{s['slot']}"].append(f"REPEAT: object {fam} also on {d2}#{s2['slot']}")
            for s2 in cals[d]["slots"]:
                if (int(s2["slot"]) < int(s["slot"]) and f"{d}#{s2['slot']}" not in held
                        and slot_family(s2) == fam):
                    out[f"{d}#{s['slot']}"].append(f"REPEAT: object {fam} also on {d}#{s2['slot']}")
        if 1 in cur and 2 in cur and (cur[2].get("format") or "") != "poster":
            c1, c2 = slot_coarse(cur[1]), slot_coarse(cur[2])
            if c1 == c2 and c1 != "other":
                out[f"{d}#2"].append(f"SAMEDAY: slot 2 family {c2} same as slot 1")
        if i > 0 and (day - dt.date.fromisoformat(dates[i - 1])).days == 1:
            prev = {int(s["slot"]): s for s in cals[dates[i - 1]]["slots"]}
            if 3 in prev and 3 in cur:
                f1, f2 = slot_coarse(prev[3]), slot_coarse(cur[3])
                if f1 == f2 and f1 != "other":
                    out[f"{d}#3"].append(f"ADJACENT: slot 3 family {f1} same as previous day")
    return out


def load_range(start: str, end: str, root: str) -> dict[str, dict]:
    cals = {}
    d, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    while d <= e:
        p = os.path.join(root, "data", "content-calendar", f"{d.isoformat()}.json")
        cals[d.isoformat()] = json.loads(io.open(p, encoding="utf-8").read())
        d += dt.timedelta(days=1)
    return cals


GOOD_FB = ("娃娃抱久了表面看起來還好，但接縫和填充才是味道藏的地方。"
           "我們收件會先捏一下填充有沒有結塊，再看接縫有沒有鬆。"
           "千萬不要整隻丟洗衣機脫水，填充一甩就會結成一團，乾了也回不去。"
           "如果是有發聲裝置或內部是泡棉的，改善有限，我們會先跟你說清楚。\n\n"
           "參考價：絨毛娃娃依大小報價，LINE 傳照片先估\n\n"
           "內容：一般洗護說明；配圖：AI生成示意\n\n"
           "直接點這裡問:https://sixiangjialaundry.com/go/line.html?source=post\n\n"
           "#私享家洗衣店 #台中洗衣店 #娃娃清洗 #絨毛玩偶")


def _slot(**kw):
    base = {"slot": 1, "topic": "娃娃抱久了有味道", "format": "image-post",
            "facebook_caption": GOOD_FB, "instagram_caption": GOOD_FB,
            "image_prompt": "OBJECT PASSPORT: exactly one plush toy bear (object locked as plush toy)"}
    base.update(kw)
    return base


def self_test() -> int:
    root = ROOT
    clean = {
        "2026-01-01": {"slots": [_slot(slot=1), _slot(slot=2, topic="行李箱輪子卡灰",
            facebook_caption=(GOOD_FB.replace("絨毛娃娃依大小報價", "行李箱依尺寸報價")
                              .replace("娃娃", "行李箱").replace("#絨毛玩偶", "#行李箱清潔")),
            image_prompt="OBJECT PASSPORT: exactly one suitcase")]},
    }
    problems = 0
    res = check_range(clean, root)
    for k, v in res.items():
        if v:
            problems += 1
            print(f"FALSE POSITIVE {k}: {v}")
    mutations = [
        ("LEAK", _slot(facebook_caption=GOOD_FB.replace("我們收件", "店內先做材質判斷：看一個關鍵位置，我們收件"))),
        ("TAGS", _slot(facebook_caption=GOOD_FB.replace("#私享家洗衣店", "#私享家洗衣精洗"))),
        ("TAGS", _slot(facebook_caption=GOOD_FB + " #台中")),
        ("TAGS", _slot(facebook_caption=GOOD_FB + " #a #b #c")),
        ("PRICE", _slot(facebook_caption=GOOD_FB.replace("參考價：絨毛娃娃依大小報價，LINE 傳照片先估", ""))),
        ("LENGTH", _slot(facebook_caption="娃娃洗。\n\n參考價：x\n\nline.html #私享家洗衣店 #台中洗衣店")),
        ("FORMAT", _slot(format="reel", slot=1)),
        ("PASSPORT", _slot(image_prompt="OBJECT PASSPORT: exactly one pair of black horsebit loafers")),
        ("PASSPORT", _slot(image_prompt="OBJECT PASSPORT: exactly one complete worn laundry item matching the topic")),
        ("PROV", _slot(facebook_caption=GOOD_FB.replace("內容：一般洗護說明；配圖：AI生成示意", "出處：門市當日看件"))),
        ("PROV", _slot(facebook_caption=GOOD_FB.replace("內容：一般洗護說明；配圖：AI生成示意", "出處：門市常見狀況"))),
        ("STALE", _slot(facebook_caption=GOOD_FB.replace("我們收件", "開學前送洗來得及，我們收件"))),
        ("BODY", _slot(facebook_caption=GOOD_FB.replace("娃娃抱久了表面看起來還好，但接縫和填充才是味道藏的地方。", "娃娃抱久了有味道。\n\n寢具最厚的地方最慢乾，表面摸起來乾了中間通常還沒。").replace("填充", "棉").replace("絨毛娃娃", "物件"))),
    ]
    for want, s in mutations:
        day = "2026-09-20" if want == "STALE" else "2026-01-01"
        r = check_range({day: {"slots": [s]}}, root)[f"{day}#{s['slot']}"]
        if any(x.startswith(want) for x in r):
            print(f"caught {want}")
        else:
            problems += 1
            print(f"MISSED {want}: {r}")
    # repeat: same family inside 7 days; and adjacency on slot 3
    rep = {
        "2026-01-01": {"slots": [_slot(slot=3)]},
        "2026-01-02": {"slots": [_slot(slot=3, topic="玩偶接縫發黃")]},
    }
    r = check_range(rep, root)
    for want, key in (("REPEAT", "2026-01-02#3"), ("ADJACENT", "2026-01-02#3")):
        if any(x.startswith(want) for x in r[key]):
            print(f"caught {want}")
        else:
            problems += 1
            print(f"MISSED {want}: {r[key]}")
    far = {
        "2026-01-01": {"slots": [_slot(slot=1)]},
        "2026-01-09": {"slots": [_slot(slot=1, topic="玩偶接縫發黃")]},
    }
    if any(check_range(far, root).values()):
        problems += 1
        print(f"FALSE POSITIVE 8-day gap: {check_range(far, root)}")
    else:
        print("quiet 8-day gap")
    # exactly 7 days apart is still a repeat (production bound is > 7)
    seven = {
        "2026-01-01": {"slots": [_slot(slot=1)]},
        "2026-01-08": {"slots": [_slot(slot=1, topic="玩偶接縫發黃")]},
    }
    if any(x.startswith("REPEAT") for x in check_range(seven, root)["2026-01-08#1"]):
        print("caught REPEAT at 7 days")
    else:
        problems += 1
        print("MISSED REPEAT at 7 days")
    # different shoe objects two days apart are not a repeat; string slot ids work
    shoe_fb = (GOOD_FB.replace("絨毛娃娃依大小報價，LINE 傳照片先估", "一般運動鞋 $250")
               .replace("娃娃", "鞋子").replace("填充", "鞋墊").replace("#絨毛玩偶", "#台中洗鞋"))
    shoes = {
        "2026-01-01": {"slots": [_slot(slot="1", topic="帆布鞋沾泥先分泥痕", facebook_caption=shoe_fb,
                                       image_prompt="OBJECT PASSPORT: one pair of canvas shoes")]},
        "2026-01-03": {"slots": [_slot(slot="3", topic="皮鞋淋雨後別只看外面", format="reel",
                                       facebook_caption=shoe_fb,
                                       image_prompt="OBJECT PASSPORT: one pair of leather oxford shoes")]},
    }
    rs = check_range(shoes, root)
    if any(rs.values()):
        problems += 1
        print(f"FALSE POSITIVE canvas vs leather shoe: {rs}")
    else:
        print("quiet canvas vs leather shoe, string slot ids")
    # same-day slot 1 / slot 2 family (topicQuota.test.ts rule)
    same = {"2026-01-01": {"slots": [_slot(slot=1, topic="棉被收納先看濕氣"),
                                     _slot(slot=2, topic="窗簾下緣一圈灰")]}}
    if any(x.startswith("SAMEDAY") for x in check_range(same, root)["2026-01-01#2"]):
        print("caught SAMEDAY")
    else:
        problems += 1
        print("MISSED SAMEDAY")
    # a reel hook with no object word still collides through its concept id
    reel = {"2026-01-01": {"slots": [
        _slot(slot=1, topic="皮包邊角磨白先看再說", facebook_caption=GOOD_FB.replace("娃娃", "皮包"),
              image_prompt="OBJECT PASSPORT: one leather bag"),
        _slot(slot=3, topic="先看四個角的邊油", format="reel",
              facebook_caption=GOOD_FB.replace("娃娃", "包"),
              image_prompt="Copied reel cover from output/reels-run/2026-07-29/references/leather-bag-corner-before.png")]}}
    if any(x.startswith("REPEAT") for x in check_range(reel, root)["2026-01-01#3"]):
        print("caught REPEAT via concept id")
    else:
        problems += 1
        print("MISSED REPEAT via concept id")
    # the same finished reel may re-air after >= 10 days, never sooner
    def reel_slot():
        return _slot(slot=3, topic="先看四個角的邊油", format="reel", facebook_caption=GOOD_FB.replace("娃娃", "皮包"),
                     image_prompt="Copied reel cover from output/reels-run/2026-07-29/references/leather-bag-corner-before.png")
    for gap_days, want_repeat in ((9, True), (10, False)):
        second = (dt.date(2026, 1, 1) + dt.timedelta(days=gap_days)).isoformat()
        rr = check_range({"2026-01-01": {"slots": [reel_slot()]}, second: {"slots": [reel_slot()]}}, root)
        got = any(x.startswith("REPEAT: same topic") for x in rr[f"{second}#3"])
        if got == want_repeat:
            print(f"ok reel re-air after {gap_days} days -> repeat={got}")
        else:
            problems += 1
            print(f"WRONG reel re-air after {gap_days} days -> repeat={got}")
    # a held slot does not count against the window
    heldcase = {"2026-01-01": {"slots": [_slot(slot=2)]}, "2026-01-03": {"slots": [_slot(slot=1, topic="玩偶接縫發黃")]}}
    if any(check_range(heldcase, root, held={"2026-01-01#2"})["2026-01-03#1"]):
        problems += 1
        print("FALSE POSITIVE: held slot counted")
    else:
        print("quiet: held slot not counted")
    print("SELF-TEST", "PASSED" if problems == 0 else f"FAILED ({problems})")
    return 1 if problems else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    a = sys.argv
    start = a[a.index("--from") + 1]
    end = a[a.index("--to") + 1]
    # --root lets a mutation rehearsal run on a copied tree instead of the live
    # calendars (data/content-calendar and any video paths are read under it).
    root = a[a.index("--root") + 1] if "--root" in a else ROOT
    # --context-from loads earlier (already published) days so the 7-day and
    # adjacency rules see them, without reporting those days' own slots.
    ctx = a[a.index("--context-from") + 1] if "--context-from" in a else start
    # --skip 2026-09-19#2,2026-09-21#2 names slots on owner HOLD: they are not
    # scored, and since they will not publish they do not count in the windows.
    skipped = set(a[a.index("--skip") + 1].split(",")) if "--skip" in a else set()
    res = check_range(load_range(ctx, end, root), root, held=skipped)
    res = {k: v for k, v in res.items() if k[:10] >= start}
    for k in sorted(skipped & set(res)):
        print(f"skip {k}  (on hold; not scored)")
    res = {k: v for k, v in res.items() if k not in skipped}
    fails = {k: v for k, v in res.items() if v}
    for k in sorted(res):
        print(f"{'FAIL' if res[k] else 'ok  '} {k}  " + "; ".join(res[k]))
    print()
    print(f"{len(res) - len(fails)}/{len(res)} slots pass")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
