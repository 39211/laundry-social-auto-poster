# -*- coding: utf-8 -*-
"""逐項預估：只用店內價目計算；文字與照片候選都不能自行創造價格。"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import unicodedata

import ehank_prices

DISCLAIMER = "先給你抓預算，這不是最後應付款；實際以現場看件報價為準。材質、尺寸或特殊處理（如乾洗、去霉、修補）可能另外確認費用。"
ALIASES = {
    "T-shirt": "棉T", "t-shirt": "棉T", "T恤": "棉T", "T桖": "棉T",
    "棉Ｔ": "棉T", "羽絨衣": "羽絨外套", "羽絨服": "羽絨外套",
    "單人棉被": "棉被單人", "雙人棉被": "棉被雙人", "枕頭套": "枕套",
    "一般球鞋": "一般運動鞋", "四件式床組": "床組四件套",
    "一般的運動鞋": "一般運動鞋", "普通運動鞋": "一般運動鞋",
    "普通的運動鞋": "一般運動鞋", "T": "棉T",
}
UNKNOWN = {
    "西裝外套": "西裝外套需另外看件報價", "西裝褲": "西裝褲需另外看件報價",
    "枕頭": "枕頭本體不是枕套，請補洗標或交店員看件", "枕芯": "枕芯沒有可直接採用的表列價",
    "床組": "請確認套內有哪些物件，是否包含棉被本體", "床套": "請確認是床單、被套還是整套",
    "床單": "請確認薄或厚的床單", "被套": "請確認薄或厚的被套",
    "棉被": "請確認單人、雙人或羽絨羊毛被", "羽絨被": "請確認材質及是否適用羽絨羊毛被價格",
    "毛毯": "請確認單人或雙人", "鞋子": "鞋款及材質會影響價格", "球鞋": "請確認一般、皮類或混合運動鞋",
    "運動鞋": "請確認一般、皮類或混合運動鞋", "包包": "請確認包款及材質", "外套": "請確認薄、厚、羽絨或其他款式",
    "衣服": "請列衣物款式，或傳照片", "衣物": "請列衣物款式，或傳照片", "床組四件": "請確認是一套四件套",
    "洋裝": "請確認長度及款式", "大衣": "請確認長度及款式", "褲子": "請確認褲款",
    "玩偶": "玩偶需看件報價", "娃娃": "娃娃需看件報價", "地毯": "地毯需看尺寸與材質", "窗簾": "窗簾需看尺寸與材質",
}
NUM = r"[-－]?(?:\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百千]+)"
QUANTITY = re.compile(rf"(?P<lo>{NUM})(?:\s*(?:到|至|[~～–-])\s*(?P<hi>{NUM}))?\s*(?P<unit>件|雙|隻|只|套|個|顆|條|張|袋|包)?")
SPLIT = re.compile(r"[，,、；;\n。]|以及|還有|另外|(?<!混)和|(?<!高)跟|加上")
MAX_LINES = 30

# 泛稱品項先用店內價目表的候選列抓區間，不把客人說的「運動鞋」直接漏出總額。
# 價格仍只來自本店價目表，模型或文字不會自行創造金額。
GENERIC_PRICE_OPTIONS = {
    "運動鞋": ("一般運動鞋", "皮類運動鞋", "混合運動鞋"),
    "球鞋": ("一般運動鞋", "皮類運動鞋", "混合運動鞋"),
    "包包": ("一般包", "皮包包", "名牌包"),
    "外套": ("薄外套", "厚外套", "羽絨外套"),
    "洋裝": ("短洋裝", "中洋裝", "長洋裝"),
    "裙子": ("短裙子", "中裙子", "長裙子"),
    "大衣": ("短大衣", "中大衣", "長大衣"),
    "棉被": ("棉被單人", "棉被雙人", "羽絨羊毛被"),
    "毛毯": ("毛毯單人", "毛毯雙人"),
}

# A photo can suggest one of these rows without proving the exact tariff row.
# Keep the quote useful by showing a catalogue-derived range, never a model-
# chosen exact price.
PHOTO_RANGE_OPTIONS = {
    "一般運動鞋": ("一般運動鞋", "皮類運動鞋", "混合運動鞋"),
    "皮類運動鞋": ("一般運動鞋", "皮類運動鞋", "混合運動鞋"),
    "混合運動鞋": ("一般運動鞋", "皮類運動鞋", "混合運動鞋"),
    "一般包": ("一般包", "皮包包", "名牌包"),
    "皮包包": ("一般包", "皮包包", "名牌包"),
    "名牌包": ("一般包", "皮包包", "名牌包"),
    "薄外套": ("薄外套", "厚外套", "羽絨外套"),
    "厚外套": ("薄外套", "厚外套", "羽絨外套"),
    "羽絨外套": ("薄外套", "厚外套", "羽絨外套"),
    "短洋裝": ("短洋裝", "中洋裝", "長洋裝"),
    "中洋裝": ("短洋裝", "中洋裝", "長洋裝"),
    "長洋裝": ("短洋裝", "中洋裝", "長洋裝"),
    "短裙子": ("短裙子", "中裙子", "長裙子"),
    "中裙子": ("短裙子", "中裙子", "長裙子"),
    "長裙子": ("短裙子", "中裙子", "長裙子"),
    "短大衣": ("短大衣", "中大衣", "長大衣"),
    "中大衣": ("短大衣", "中大衣", "長大衣"),
    "長大衣": ("短大衣", "中大衣", "長大衣"),
    "棉被單人": ("棉被單人", "棉被雙人", "羽絨羊毛被", "羽絨被", "蠶絲羊毛被"),
    "棉被雙人": ("棉被單人", "棉被雙人", "羽絨羊毛被", "羽絨被", "蠶絲羊毛被"),
    "羽絨羊毛被": ("棉被單人", "棉被雙人", "羽絨羊毛被", "羽絨被", "蠶絲羊毛被"),
    "羽絨被": ("棉被單人", "棉被雙人", "羽絨羊毛被", "羽絨被", "蠶絲羊毛被"),
    "蠶絲羊毛被": ("棉被單人", "棉被雙人", "羽絨羊毛被", "羽絨被", "蠶絲羊毛被"),
    "毛毯單人": ("毛毯單人", "毛毯雙人", "小毛毯", "中毛毯", "大毛毯"),
    "毛毯雙人": ("毛毯單人", "毛毯雙人", "小毛毯", "中毛毯", "大毛毯"),
    "小毛毯": ("小毛毯", "中毛毯", "大毛毯"),
    "中毛毯": ("小毛毯", "中毛毯", "大毛毯"),
    "大毛毯": ("小毛毯", "中毛毯", "大毛毯"),
}

# Gemini may choose a valid catalogue row while still being unsure about the
# material, brand, size, or style.  Keep those rows useful by widening them to
# the smallest honest catalogue family instead of dropping the whole quote.
_PHOTO_BAG_ROWS = ("背包", "全布包", "布混包", "短皮夾", "長皮夾", "一般包", "皮包包", "名牌包", "特殊類名牌包", "大書包")
_PHOTO_SHOE_ROWS = ("一般運動鞋", "皮類運動鞋", "混合運動鞋", "高爾夫球鞋", "一般登山鞋", "高筒登山鞋", "童鞋", "涼鞋", "拖鞋", "休閒鞋", "低靴子", "中靴子", "高靴子", "麂皮鞋", "高跟鞋", "特殊鞋", "名牌鞋", "皮鞋", "大童鞋", "高級拖鞋")
_PHOTO_TOP_ROWS = ("襯衫", "精品襯衫", "女衣")
_PHOTO_TSHIRT_ROWS = ("棉T", "長T", "帽T", "精品棉T", "精品長T", "精品帽T")
_PHOTO_PANTS_ROWS = ("短褲", "長褲", "牛仔褲", "精品短褲", "精品長褲", "精品牛仔褲", "西褲")
_PHOTO_SCARF_HAT_ROWS = ("圍巾", "精品圍巾", "帽子", "精品帽子", "領帶")
_PHOTO_SWEATER_ROWS = ("毛衣", "精品毛衣", "針織衣")
_PHOTO_CARDIGAN_ROWS = ("毛衣外套", "精品毛衣外套")
_PHOTO_OUTER_ROWS = ("薄外套", "厚外套", "薄夾克", "厚夾克", "毛衣外套", "羽絨外套", "G-T外套", "G-T兩件式外套", "精品外套", "精品厚外套", "精品毛衣外套", "西裝")
_PHOTO_BEDDING_ROWS = ("涼被", "睡袋", "保潔墊", "床組四件套", "床單被套薄", "床單被套厚", "棉被單人", "棉被雙人", "毛毯單人", "毛毯雙人", "羽絨睡袋", "羽絨羊毛被", "羽絨被", "蠶絲羊毛被", "小毛毯", "中毛毯", "大毛毯")
for _photo_rows in (_PHOTO_BAG_ROWS, _PHOTO_SHOE_ROWS, _PHOTO_TOP_ROWS, _PHOTO_TSHIRT_ROWS,
                    _PHOTO_PANTS_ROWS, _PHOTO_SCARF_HAT_ROWS, _PHOTO_SWEATER_ROWS,
                    _PHOTO_CARDIGAN_ROWS, _PHOTO_OUTER_ROWS, _PHOTO_BEDDING_ROWS):
    for _photo_name in _photo_rows:
        PHOTO_RANGE_OPTIONS.setdefault(_photo_name, _photo_rows)


def catalog(prices: dict) -> dict:
    return {name: {"price": value, "category": cat, "unit": "雙" if cat == "鞋子" else "套" if name == "床組四件套" else "個" if cat == "包包" or name == "枕套" else "件"}
            for cat, rows in prices.items() if isinstance(rows, dict)
            for name, value in rows.items() if type(value) is int and value > 0}


# 只在目標已進價目、鍵本身不在價目時才套用。關閉或讀不到 eHank 時這些鍵維持原行為。
_SYNC_ALIASES = (
    ("西裝褲", "西褲"),
    ("毛毯單人", "小毛毯"),
    ("單人毛毯", "小毛毯"),
    ("毛毯(小)", "小毛毯"),
    ("毛毯(中)", "中毛毯"),
    ("毛毯(大)", "大毛毯"),
    ("蠶絲被", "蠶絲羊毛被"),
    ("羊毛被", "蠶絲羊毛被"),
    ("玩偶", "娃娃"),
)
_SYNC_UNKNOWN = {
    "棉被": ("請確認單人、雙人、羽絨被或蠶絲羊毛被", ("羽絨被", "蠶絲羊毛被")),
    "毛毯": ("請確認小、中或大", ("小毛毯", "中毛毯", "大毛毯")),
    "羽絨羊毛被": ("請確認是羽絨被還是蠶絲羊毛被", ("羽絨被", "蠶絲羊毛被")),
    "毛毯雙人": ("請確認中或大", ("中毛毯", "大毛毯")),
    "雙人毛毯": ("請確認中或大", ("中毛毯", "大毛毯")),
}
_SYNC_RANGES = {
    "棉被": ("棉被單人", "棉被雙人", "羽絨被", "蠶絲羊毛被"),
    "毛毯": ("小毛毯", "中毛毯", "大毛毯"),
    "羽絨羊毛被": ("羽絨被", "蠶絲羊毛被"),
    "毛毯雙人": ("中毛毯", "大毛毯"),
    "雙人毛毯": ("中毛毯", "大毛毯"),
}
_REFINE_OVERLAY = {
    "小毛毯": {"毛毯"},
    "中毛毯": {"毛毯", "毛毯雙人", "雙人毛毯"},
    "大毛毯": {"毛毯", "毛毯雙人", "雙人毛毯"},
    "羽絨被": {"棉被", "羽絨羊毛被"},
    "蠶絲羊毛被": {"棉被", "羽絨羊毛被"},
}


# 上衣說法。條件與 _SYNC_ALIASES 相同：目標在價目、鍵本身不在價目。UNKNOWN 的「西裝外套」不刪。
_JACKET_ALIASES = (
    ("西裝外套", "西裝"),
    ("西裝上衣", "西裝"),
    ("西裝上身", "西裝"),
)


def _jacket_alias_target_ready(target: str, cat: dict) -> bool:
    """上衣別名只在目標已在這份價目時套用。"""
    return target in cat


def _sync_alias_map(cat: dict) -> dict:
    out = {}
    for key, target in _SYNC_ALIASES:
        if key not in cat and target in cat:
            out[key] = target
    for key, target in _JACKET_ALIASES:
        if key not in cat and _jacket_alias_target_ready(target, cat):
            out[key] = target
    return out


def _overlay_unknown(key: str, cat: dict):
    spec = _SYNC_UNKNOWN.get(key)
    if not spec:
        return None
    reason, required = spec
    if key not in cat and all(item in cat for item in required):
        return reason
    return None


def _sync_range_options(name: str, cat: dict):
    options = _SYNC_RANGES.get(name)
    if options and all(item in cat for item in options):
        return options
    return None


def generic_price_range(name: str, prices: dict) -> tuple[int, int] | None:
    """從店內價目表取得泛稱品項的最低／最高候選價。"""
    cat = catalog(prices)
    options = _sync_range_options(name, cat)
    if options is None:
        options = GENERIC_PRICE_OPTIONS.get(name, ())
    values = [cat[item]["price"] for item in options if item in cat]
    return (min(values), max(values)) if values else None


def photo_price_range(name: str, prices: dict) -> tuple[int, int] | None:
    cat = catalog(prices)
    if name not in cat:
        return None
    values = [cat[item]["price"] for item in PHOTO_RANGE_OPTIONS.get(name, ()) if item in cat]
    return (min(values), max(values)) if values else None


PHOTO_DISPLAY_GROUPS = {
    "鞋子": {"一般運動鞋", "皮類運動鞋", "混合運動鞋", "高爾夫球鞋", "一般登山鞋", "高筒登山鞋", "童鞋", "涼鞋", "拖鞋", "休閒鞋", "低靴子", "中靴子", "高靴子", "麂皮鞋", "高跟鞋", "特殊鞋", "名牌鞋", "皮鞋", "大童鞋", "高級拖鞋"},
    "包包": {"背包", "全布包", "布混包", "短皮夾", "長皮夾", "一般包", "皮包包", "名牌包", "特殊類名牌包", "大書包"},
    "外套": {"薄外套", "厚外套", "薄夾克", "厚夾克", "毛衣外套", "羽絨外套", "G-T外套", "G-T兩件式外套", "精品外套", "精品厚外套", "羽絨背心", "皮背心", "西裝"},
    "洋裝／裙子": {"短洋裝", "中洋裝", "長洋裝", "精品短洋裝", "精品中洋裝", "精品長洋裝", "褶裙", "短裙子", "中裙子", "長裙子", "精品短裙子", "精品中裙子", "精品長裙子"},
    "寢具": {"涼被", "睡袋", "保潔墊", "床組四件套", "床單被套薄", "床單被套厚", "棉被單人", "棉被雙人", "毛毯單人", "毛毯雙人", "羽絨睡袋", "羽絨羊毛被", "羽絨被", "蠶絲羊毛被", "小毛毯", "中毛毯", "大毛毯"},
}


def photo_display_label(name: str, certainty: str, prices: dict | None = None) -> str:
    """Do not repeat a model's material/style guess as if it were confirmed."""
    in_catalog = prices is None or name in catalog(prices)
    for label, names in PHOTO_DISPLAY_GROUPS.items():
        if name in names and in_catalog:
            return f"照片中的{label}"
    if name:
        return f"照片中的{name}" if certainty != "clear" else name
    return "照片中的物件"


def number(value: str) -> int | None:
    value = unicodedata.normalize("NFKC", value)
    if re.fullmatch(r"\d+", value):
        result = int(value)
    elif re.fullmatch(r"[零〇一二兩三四五六七八九十百千]+", value):
        digits = dict(zip("零〇一二兩三四五六七八九", [0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]))
        result = current = 0
        for ch in value:
            if ch in digits:
                current = digits[ch]
            else:
                result += (current or 1) * {"十": 10, "百": 100, "千": 1000}[ch]
                current = 0
        result += current
    else:
        return None
    return result if 1 <= result <= 999 else None


# A bare number followed by a size word is a size (27號, 30腰, 3XL, 180x200), never a count.
# 3XL only when glued to the digit; 「棉T 2 XL」 stays a count of 2.
_SIZE_SPEC = re.compile(r"\s*\d+(?:\.\d+)?\s*(?:號半?|腰|吋|寸|碼|公分|cm|mm|歲|(?<=\d)X{1,4}L(?![A-Za-z])|[xX×*]\s*\d+(?:\.\d+)?(?:\s*(?:cm|公分))?)\s*", re.IGNORECASE)


def _skip_sizes(text: str) -> str:
    while (size := _SIZE_SPEC.match(text)):
        text = text[size.end():]
    return text


def _quantity(after: str, before: str):
    # Read immediately after the noun, or an explicit measure immediately before it.
    tail = _skip_sizes(re.sub(r"^\s*(?:改成|改為|更正為|大概|大約|約|是|有|共|各|再加|加|[xX×*=：:]|要)?\s*", "", after))
    match = QUANTITY.match(tail)
    # In 「襯衫洗一件」, only accept a measure after the verb when it has a unit.
    if not match and (verb := re.match(r"洗\s*", tail)):
        measured = QUANTITY.match(tail, verb.end())
        if measured and measured.group("unit"):
            match = measured
    correction = re.search(r"(?:改成|改為|更正為)\s*(.+)", after)
    if correction:
        match = QUANTITY.match(correction.group(1))
    if not match:
        candidates = list(QUANTITY.finditer(before))
        match = next((m for m in reversed(candidates) if m.group("unit") and
                      re.fullmatch(r"\s*(?:(?:一般|普通)的?|的)?\s*", before[m.end():])), None)
    if not match:
        return None, None, "", False
    lo = number(match.group("lo"))
    hi = number(match.group("hi")) if match.group("hi") else lo
    if lo is None or hi is None or lo > hi:
        return None, None, match.group("unit") or "", True
    return lo, hi, match.group("unit") or "", True


def _item_quantities(clause, hits):
    """Assign each quantity span once, allowing prefix and suffix forms in one list."""
    empty = (None, None, "", False)
    values = [empty for _ in hits]
    values[0] = _quantity("", clause[:hits[0].start()])
    for index, hit in enumerate(hits):
        end = hits[index + 1].start() if index + 1 < len(hits) else len(clause)
        gap = clause[hit.end():end]
        suffix = _quantity(gap, "")
        prefix = _quantity("", gap) if index + 1 < len(hits) else empty
        correction = bool(re.search(r"改成|改為|更正", gap))
        # Two explicit measures in the gap belong to opposite sides, e.g. 襯衫3件 2雙皮鞋.
        measures = [m for m in QUANTITY.finditer(gap) if m.group("unit")]
        distinct = len(measures) >= 2 and not correction
        if suffix[3] and (not values[index][3] or correction):
            values[index] = suffix
            if prefix[3] and distinct:
                values[index + 1] = prefix
        elif prefix[3]:
            values[index + 1] = prefix
    return values


def _refined_generic(name, cat=None):
    """A more specific name may replace one unresolved row, never the whole category."""
    if name in ("一般運動鞋", "皮類運動鞋", "混合運動鞋"):
        return {"運動鞋", "球鞋", "鞋子"}
    base = {"床組四件套": {"床組"}, "棉被單人": {"棉被"}, "棉被雙人": {"棉被"},
            "毛毯單人": {"毛毯"}, "毛毯雙人": {"毛毯"}}.get(name, set())
    if cat is not None and name in cat and name in _REFINE_OVERLAY:
        return set(base) | set(_REFINE_OVERLAY[name])
    return base


def _unlisted(clause):
    units = r"件|雙|隻|只|套|個|顆|條|張|袋|頂"
    prefix = re.match(rf"^(?:我有|有|再加|加)?\s*({NUM})\s*({units})\s*(.+)", clause)
    suffix = re.search(rf"(.+?)({NUM})\s*({units})", clause)
    if prefix:
        label, count, unit = prefix.group(3), prefix.group(1), prefix.group(2)
    elif suffix:
        label, count, unit = suffix.group(1), suffix.group(2), suffix.group(3)
    else:
        return None
    label = label.strip()[:40]
    if not label or re.fullmatch(r"改成|改為|更正|總共|合計|共|是|有", label):
        return None
    return {"name": label, "quantity": number(count), "max_quantity": number(count), "unit": unit, "reason": "價目未列，需店員看件", "source": "text"}


def _remove(lines: list, name: str, cat: dict) -> list:
    group = {"鞋子": "鞋子", "運動鞋": "鞋子", "球鞋": "鞋子", "衣服": "衣物", "衣物": "衣物", "包包": "包包", "床組": "寢具"}.get(name)
    return [line for line in lines if not (line["name"] == name or group and cat.get(line["name"], {}).get("category") == group)]


_OTHER_WASH_REASON = "洗法另計，不能直接套用一般水洗價"


def _adopted_label(name: str) -> str:
    """品項最終採用的洗法標示；水洗、一般，或沒有對齊時是空字串。"""
    try:
        import conversation
    except Exception:
        return ""
    return conversation.PRICE_LABELS.get(name) or ""


def _estimate_basis() -> str:
    try:
        import conversation
    except Exception:
        return "off"
    return conversation.PRICE_BASIS or "off"


def _refuse_other_wash(name: str, requested: list[str]) -> bool:
    """客人指定的洗法不是這品項採用的洗法時，維持原本的拒報。"""
    if not requested:
        return False
    adopted = _adopted_label(name)
    if len(requested) == 1 and requested[0] == adopted:
        return False
    return True


def _legacy_recorded_specials(specials: list[str], lines: list) -> list[str]:
    """basis 為 off：整單每一件都採用該洗法時，才從待評估拿掉。"""
    wash = [word for word in specials if word in ("乾洗", "柔洗")]
    if len(wash) == 1 and lines and all(_adopted_label(line.get("name", "")) == wash[0] for line in lines):
        adopted = wash[0]
        return [word for word in specials if word != adopted]
    return list(specials)


def _remember_causes(line: dict, requested: list[str]) -> None:
    line["wash_causes"] = [word for word in requested if word in ("乾洗", "柔洗")]


def _cause_washes(line: dict, specials: list[str]) -> set[str]:
    """仍被拒報的行才算。有記錄就用記錄；舊草稿沒有欄位時，退回不等於採用洗法的待評估洗法。"""
    if line.get("reason") != _OTHER_WASH_REASON:
        return set()
    recorded = line.get("wash_causes")
    if isinstance(recorded, (list, tuple)):
        return {word for word in recorded if word in ("乾洗", "柔洗")}
    adopted = _adopted_label(line.get("name", ""))
    return {word for word in specials if word in ("乾洗", "柔洗") and word != adopted}


def _recorded_specials(specials: list[str], lines: list, refused_washes=None) -> list[str]:
    """乾洗／柔洗只留目前仍被拒報各行所記原因的聯集；basis 為 off 時走舊演算法。"""
    if _estimate_basis() == "off":
        return _legacy_recorded_specials(specials, lines)
    refused: set[str] = set()
    for line in lines:
        refused.update(_cause_washes(line, specials))
    kept = []
    for word in specials:
        if word in ("乾洗", "柔洗") and word not in refused:
            continue
        kept.append(word)
    return kept


def _display_category(name: str) -> str:
    try:
        import conversation
        hit = conversation.lookup_item(name)
    except Exception:
        return ""
    return hit[2] if hit else ""


def _mode_suffix(name: str) -> str:
    label = _adopted_label(name)
    if not label:
        return ""
    label = ehank_prices.bag_turnaround_label(name, label, _display_category(name))
    return f"（{label}）"


def _attached_count(prefix: str, suffix: str, units: str):
    """數量貼在說法前面或後面。units 是允許的單位字（套，或套與件）。"""
    suf = suffix.lstrip()
    match = QUANTITY.match(suf)
    if match and (match.group("unit") or "") and (match.group("unit") or "") in units:
        lo = number(match.group("lo"))
        hi = number(match.group("hi")) if match.group("hi") else lo
        if lo is not None and hi is not None and lo <= hi:
            return lo, hi
    pre = prefix.rstrip()
    for found in reversed(list(QUANTITY.finditer(pre))):
        if pre[found.end():].strip():
            continue
        unit = found.group("unit") or ""
        if not unit or unit not in units:
            continue
        lo = number(found.group("lo"))
        hi = number(found.group("hi")) if found.group("hi") else lo
        if lo is None or hi is None or lo > hi:
            continue
        return lo, hi
    return None


def _suit_bundle(raw: str, before: str, after: str, cat: dict):
    """一套或三件式帶明確數量時，拆成逐件。沒有數量就回 None，交給原本的單行。"""
    if raw in ("西裝外套", "西裝上衣", "西裝上身"):
        return None
    if raw != "西裝":
        return None
    if "西裝" not in cat or "西褲" not in cat:
        return None
    left = before.rstrip()
    right = after.lstrip()
    kind = None
    count = None
    if left.endswith("三件式"):
        kind = "three"
        count = _attached_count(left[: -len("三件式")], right, "套件")
    elif right.startswith("三件式"):
        kind = "three"
        count = _attached_count(left, right[len("三件式"):], "套件")
    elif left.endswith("整套"):
        kind = "pair"
        count = _attached_count(left[: -len("整套")], right, "套件")
    elif right.startswith("整套"):
        kind = "pair"
        count = _attached_count(left, right[len("整套"):], "套件")
    elif right.startswith("套裝"):
        kind = "pair"
        count = _attached_count(left, right[len("套裝"):], "套件")
    else:
        bare = _attached_count(left, right, "套")
        if bare is not None:
            kind = "pair"
            count = bare
    if kind is None:
        return None
    if count is None:
        return None
    lo, hi = count[0], count[1]
    if kind == "three":
        names = ("西裝", "西褲", "西裝背心")
    else:
        names = ("西裝", "西褲")
    return names, lo, hi


def _commit_suit_bundle(lines, seen, part_names, lo, hi, requested, append, clause, refused_washes, cat) -> bool:
    """拆出來的每一行走和一般品項同一套累加、拒報。"""
    changed = False
    for name in part_names:
        reason = ""
        if lo is None:
            reason = "數量待確認"
        if _refuse_other_wash(name, requested):
            reason = _OTHER_WASH_REASON
        existing = next((x for x in lines if x["name"] == name), None)
        part_append = append
        use_lo, use_hi = lo, hi
        if (
            existing
            and (part_append or name in seen)
            and not re.search(r"改成|改為|更正|其實", clause)
            and use_lo is not None
            and existing.get("quantity") is not None
        ):
            use_lo = use_lo + existing["quantity"]
            use_hi = use_hi + (existing.get("max_quantity") or existing["quantity"])
        line = {
            "name": name,
            "quantity": use_lo,
            "max_quantity": use_hi,
            "unit": cat.get(name, {}).get("unit", "件"),
            "reason": reason,
            "source": "text",
        }
        if existing:
            lines[lines.index(existing)] = line
        else:
            lines.append(line)
        if reason == _OTHER_WASH_REASON:
            _remember_causes(line, requested)
            refused_washes.extend(requested)
        seen.add(name)  # 拆出來的品項這則訊息裡算已出現
        changed = True
    return changed


def _opening_line(draft: dict) -> str:
    if draft.get("source") == "photo":
        return "看照片，我先幫你抓個預算："
    if _estimate_basis() == "default_mode":
        return "幫你算好了，先按店裡系統的標準價："
    return "幫你算好了，先按一般水洗價："


def update(text: str, previous: dict | None, prices: dict) -> dict | None:
    """None means this is not a batch estimate turn. Previous drafts are never mutated."""
    text = unicodedata.normalize("NFKC", text or "").strip()
    text = re.sub(r"(?i)T\s+([恤桖])", r"T\1", text)
    cat = catalog(prices)
    alias_extra = _sync_alias_map(cat)
    merged_alias = dict(ALIASES)
    merged_alias.update(alias_extra)
    unknown_extra = [key for key in _SYNC_UNKNOWN if _overlay_unknown(key, cat)]
    names = sorted(set(cat) | set(merged_alias) | set(UNKNOWN) | set(unknown_extra), key=len, reverse=True)
    matcher = re.compile("|".join(r"(?<![A-Za-z])T(?![A-Za-z])" if n == "T" else re.escape(n) for n in names), re.IGNORECASE)
    matches = list(matcher.finditer(text))
    active = bool(previous and previous.get("lines"))
    specials = [word for word in ("乾洗", "柔洗", "去霉", "除霉", "補色", "修補", "修鞋") if re.search(r"(?<!不要)(?<!不用)" + word, text)]
    if not matches:
        if not active or not specials:
            return None
        draft = copy.deepcopy(previous)
        merged = list(dict.fromkeys(list(draft.get("special", [])) + specials))
        requested = [w for w in ("乾洗", "柔洗") if w in specials]
        refused_washes = []
        if requested:
            for line in draft["lines"]:
                if _refuse_other_wash(line.get("name", ""), requested):
                    line["reason"] = _OTHER_WASH_REASON
                    _remember_causes(line, requested)
                    refused_washes.extend(requested)
        draft["special"] = _recorded_specials(merged, draft["lines"], refused_washes)
        draft["revision"] += 1
        return price(draft, prices)
    # Bare single-item price questions stay in the existing guided catalogue flow.
    if not active and len(matches) < 2 and not re.search(rf"{NUM}\s*(?:件|雙|隻|只|套|個|顆|條|張|袋)|[xX×]\s*\d|整批|加總|全部多少", text):
        return None
    draft = copy.deepcopy(previous or {"lines": [], "special": [], "revision": 0, "source": "text"})
    lines = draft["lines"]
    # Resolve an uncertain photograph via its row number or a named category.
    numbered = re.search(r"第([一二三四五六七八九十\d]+)項(?:是|改成|改為)", text)
    if numbered:
        index = number(numbered.group(1))
        if index and index <= len(lines):
            del lines[index - 1]
    for generic, category in (("鞋子", "鞋子"), ("球鞋", "鞋子"), ("包包", "包包"), ("棉被", "寢具"), ("毛毯", "寢具")):
        if re.search(re.escape(generic) + r"(?:都是|是|改成|改為)", text) and any(m.group() in cat for m in matches):
            lines = [x for x in lines if not (x.get("reason") and (x["name"] == generic or cat.get(x["name"], {}).get("category") == category))]
            text = re.sub(re.escape(generic) + r"(?:都是|是|改成|改為)", "", text)
    seen = set()
    changed = False
    refused_washes = []
    restated = sum(merged_alias.get(m.group(), m.group()) in {x['name'] for x in lines} for m in matches) >= 2
    clauses = [c.strip() for c in SPLIT.split(text) if c.strip()]
    for clause in clauses:
        hits = list(matcher.finditer(clause))
        if not hits:
            # A priced list must not silently drop an unlisted named object.
            unknown = _unlisted(clause)
            if unknown:
                lines.append(unknown)
                changed = True
            continue
        quantities = _item_quantities(clause, hits)
        for index, hit in enumerate(hits):
            raw = hit.group()
            raw = next((n for n in names if n.lower() == raw.lower()), raw)
            name = merged_alias.get(raw, raw)
            before = clause[:hit.start()]
            after = clause[hit.end():hits[index + 1].start() if index + 1 < len(hits) else len(clause)]
            if re.search(r"留著|照舊|不變", after):
                continue
            if re.search(r"(?:先不用|不要洗|不用洗|先不要|取消|拿掉|刪掉|移除)", before + after):
                lines = _remove(lines, name, cat)
                changed = True
                continue
            bundle = _suit_bundle(raw, before, after, cat)
            if bundle is not None:
                part_names, blo, bhi = bundle
                requested = [w for w in ("乾洗", "柔洗") if w in specials and w in clause]
                append = bool(re.search(r"再加|多加|追加", before) or
                              re.search(r"(?:另外|再加).*" + re.escape(raw), text) or
                              not restated and re.search(r"還有.*" + re.escape(raw), text))
                if _commit_suit_bundle(lines, seen, part_names, blo, bhi, requested, append, clause, refused_washes, cat):
                    changed = True
                continue
            lo, hi, unit, explicit = quantities[index]
            refinements = [x for x in lines if active and x['name'] in _refined_generic(name, cat) and x['name'] not in seen]
            if len(refinements) == 1 and not re.search(r"再加|多加|追加|另外", text):
                old = refinements[0]
                if not explicit:
                    lo, hi, unit = old.get('quantity'), old.get('max_quantity'), old.get('unit', '')
                lines.remove(old)
            reason = ""
            if explicit and lo is None:
                reason = "件數看不清楚，請確認正確數量"
            elif lo is None:
                reason = "數量待確認"
            if unit in ("袋", "包") or name in cat and cat[name]["category"] == "鞋子" and unit in ("隻", "只"):
                reason = "請確認實際件數／雙數，不以袋數或單鞋拆價"
            elif name in cat and unit == "雙" and cat[name]["category"] != "鞋子":
                reason = "請確認計價單位與件數"
            if name not in cat:
                overlay = _overlay_unknown(raw, cat)
                base_reason = overlay if overlay is not None else UNKNOWN.get(raw, "價目未列，需店員看件")
                reason = base_reason + ("；數量待確認" if lo is None else "")
            requested = [w for w in ("乾洗", "柔洗") if w in specials and w in clause]
            if _refuse_other_wash(name, requested):
                reason = _OTHER_WASH_REASON
            if name == "枕套" and any(x["name"] == "床組四件套" for x in lines) and re.search(r"裡面|裏面|包含|內含|套內", clause):
                continue
            existing = next((x for x in lines if x["name"] == name), None)
            if existing and not explicit and not reason:
                continue
            # Follow-up statements without quantities are not a request to erase a known count.
            if existing and not explicit and name in cat:
                continue
            append = bool(re.search(r"再加|多加|追加", before) or
                          re.search(r"(?:另外|再加).*" + re.escape(raw), text) or
                          not restated and re.search(r"還有.*" + re.escape(raw), text))
            if existing and (append or name in seen) and not re.search(r"改成|改為|更正|其實", clause) and lo is not None and existing.get("quantity") is not None:
                lo += existing["quantity"]
                hi += existing.get("max_quantity") or existing["quantity"]
            fallback_unit = "雙" if name in ("運動鞋", "球鞋", "鞋子") else "套" if name == "床組" else unit or "件"
            line = {"name": name, "quantity": lo, "max_quantity": hi, "unit": cat.get(name, {}).get("unit", fallback_unit), "reason": reason, "source": "text"}
            if existing:
                lines[lines.index(existing)] = line
            else:
                lines.append(line)
            if reason == _OTHER_WASH_REASON:
                _remember_causes(line, requested)
                refused_washes.extend(requested)
            seen.add(name)
            changed = True
            if _quantity(after, "")[3] and quantities[index] == _quantity(after, ""):
                rest = _skip_sizes(after.strip())
                tail_count = QUANTITY.match(rest)
                if tail_count:
                    unknown = _unlisted(rest[tail_count.end():].strip())
                    if unknown:
                        lines.append(unknown)
    if not changed:
        return None
    if len(lines) > MAX_LINES:
        return {"lines": [], "special": [], "revision": draft["revision"] + 1, "source": "text", "error": "品項比較多，這批請店員一起核對，避免漏算。"}
    draft["lines"] = lines
    merged = list(dict.fromkeys(list(draft.get("special", [])) + specials))
    batch_wash = re.search(r"(?:全部|整批|都)(?:要|用)?(乾洗|柔洗)", text)
    if batch_wash:
        mode = batch_wash.group(1)
        for line in lines:
            if _refuse_other_wash(line.get("name", ""), [mode]):
                line["reason"] = _OTHER_WASH_REASON
                _remember_causes(line, [mode])
                refused_washes.append(mode)
    draft["special"] = _recorded_specials(merged, lines, refused_washes)
    draft["revision"] = draft.get("revision", 0) + 1
    draft["source"] = "text"
    return price(draft, prices)


def price(draft: dict, prices: dict) -> dict:
    cat = catalog(prices)
    draft = copy.deepcopy(draft)
    minimum = maximum = 0
    estimate_minimum = estimate_maximum = 0
    pending = bool(draft.get("special") or draft.get("error"))
    ranged_lines = []
    for line in draft.get("lines", []):
        entry = cat.get(line["name"])
        valid = (entry is not None and type(line.get("quantity")) is int and type(line.get("max_quantity")) is int
                 and 1 <= line["quantity"] <= line["max_quantity"] <= 999 and not line.get("reason"))
        line["unit_price"] = entry["price"] if valid else None
        line["subtotal"] = line["quantity"] * entry["price"] if valid else None
        line["max_subtotal"] = line["max_quantity"] * entry["price"] if valid else None
        if valid:
            minimum += line["subtotal"]
            maximum += line["max_subtotal"]
            estimate_minimum += line["subtotal"]
            estimate_maximum += line["max_subtotal"]
        else:
            quantity = line.get("quantity")
            max_quantity = line.get("max_quantity")
            generic = generic_price_range(line.get("name", ""), prices)
            if line.get("source") == "photo" and line.get("photo_certainty") != "clear":
                generic = photo_price_range(line.get("name", ""), prices) or generic
            can_range = (generic is not None and type(quantity) is int and type(max_quantity) is int
                         and 1 <= quantity <= max_quantity <= 999 and not draft.get("special")
                         and not draft.get("error") and "數量" not in (line.get("reason") or ""))
            if can_range:
                low, high = generic
                line["range_min_price"] = low
                line["range_max_price"] = high
                line["range_min_subtotal"] = quantity * low
                line["range_max_subtotal"] = max_quantity * high
                estimate_minimum += line["range_min_subtotal"]
                estimate_maximum += line["range_max_subtotal"]
                ranged_lines.append(line["name"])
            else:
                line["range_min_price"] = None
                line["range_max_price"] = None
                line["range_min_subtotal"] = None
                line["range_max_subtotal"] = None
                pending = True
    has_unresolved = any(x.get("subtotal") is None and x.get("range_min_subtotal") is None for x in draft.get("lines", []))
    exact_total = None if pending or ranged_lines or has_unresolved or not draft.get("lines") else minimum
    draft.update(known_subtotal=minimum, known_maximum=maximum,
                 estimated_minimum=estimate_minimum if draft.get("lines") else None,
                 estimated_maximum=estimate_maximum if draft.get("lines") else None,
                 estimate_ranges=ranged_lines,
                 estimate_status="confirmed" if exact_total is not None else ("partial" if has_unresolved else "range"),
                 confirmed_total=exact_total, payable_total=None,
                 total=exact_total, max_total=None if exact_total is None else maximum,
                 price_version=hashlib.sha256(json.dumps(prices, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16])
    return draft


_PHOTO_FIELDS = ("brand", "model", "material", "stain", "craft", "question")


def _photo_text(value, limit=80) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"[\s\x00-\x1f\x7f\u2028\u2029]+", " ", value).replace("*", "").strip()[:limit]


def from_photo(items: list, previous: dict | None, prices: dict) -> dict:
    cat = catalog(prices)
    # The model analyses the whole batch, so previous photo rows are replaced, never added again.
    draft = copy.deepcopy(previous or {"lines": [], "special": [], "revision": 0})
    lines = [x for x in draft["lines"] if x.get("source") == "text"]
    for line in lines:
        line.pop("photo_items", None)  # Only the newly analysed batch supplies evidence.
    for item in items:
        name = item["name"] or item["label"][:40]
        quantity = item["quantity"]
        known = next((x for x in lines if x["name"] == name), None)
        diagnoses = []
        for part in item.get("diagnoses", [item]):
            detail = {"name": name, "quantity": part.get("quantity"),
                      "photo_certainty": part.get("certainty", "uncertain"),
                      "photo_reason": _photo_text(part.get("reason"), 100),
                      "photo_label": _photo_text(part.get("label"), 40)}
            for field in _PHOTO_FIELDS:
                detail[f"photo_{field}"] = _photo_text(part.get(field))
            diagnoses.append(detail)
        if known:
            known.setdefault("photo_items", []).extend(diagnoses)
            if known.get("source") == "photo":
                known.update(quantity=None, max_quantity=None, reason="同款物件可能重複入鏡，請確認總件數")
            continue
        certainty = item.get("certainty", "uncertain")
        # clear or estimated + catalogue name + int quantity => one catalogue price.
        priced = (certainty in ("clear", "estimated") and name in cat
                  and type(quantity) is int and 1 <= quantity <= 999)
        reason = "" if priced else (item.get("reason", "") or "照片中的款式或數量需確認")
        line = {"name": name, "quantity": quantity, "max_quantity": quantity,
                "unit": cat.get(name, {}).get("unit", "件"), "reason": reason,
                "display": photo_display_label(name, certainty, prices),
                "photo_certainty": certainty,
                "photo_reason": item.get("reason", ""),
                "estimate_assumption": "",
                "photo_category": cat.get(name, {}).get("category", ""),
                "photo_label": _photo_text(item.get("label"), 40),
                "source": "photo", "photo_items": diagnoses}
        for field in _PHOTO_FIELDS:
            line[f"photo_{field}"] = _photo_text(item.get(field))
        lines.append(line)
    draft.update(lines=lines, source="photo", revision=draft.get("revision", 0) + 1)
    return price(draft, prices)


PHOTO_CLOSING = "實際以到店看件為準。"
# Owner-fixed turnaround facts; nothing else is promised.
PHOTO_TURNAROUND = {"shoe": "7 天", "bag": "14 天", "bedding": "10–14 天", "other": "5–7 天"}
_PHOTO_UNIT_WORD = {"shoe": "雙", "bag": "個"}


def photo_kind(name: str, category: str = "") -> str:
    if category == "鞋子" or name in PHOTO_DISPLAY_GROUPS["鞋子"] or "鞋" in name:
        return "shoe"
    if name in PHOTO_DISPLAY_GROUPS["包包"] or ehank_prices.is_bag_or_leather_good(name, category):
        return "bag"
    if name in PHOTO_DISPLAY_GROUPS["寢具"] or re.search(r"毛毯|窗簾|沙發套|地毯", name):
        return "bedding"
    return "other"


def photo_turnaround(name: str, category: str = "") -> str:
    return PHOTO_TURNAROUND[photo_kind(name, category)]


def _photo_unit_word(line: dict) -> str:
    kind = photo_kind(line["name"], line.get("photo_category", ""))
    if kind in _PHOTO_UNIT_WORD:
        return _PHOTO_UNIT_WORD[kind]
    if line["name"] == "床組四件套":
        return "套"
    return "件"


def _photo_priced_sentence(line: dict) -> str:
    unit = _photo_unit_word(line)
    name = line["name"]
    q = line["quantity"]
    high = line.get("max_quantity")
    subject = " ".join(part for part in (line.get("photo_brand", ""), line.get("photo_model", "")) if part)
    if not subject:
        label = line.get("photo_label", "")
        if label and label not in (name, "照片物件"):
            subject = label
    material = line.get("photo_material", "")
    bracket = f"（{material}）" if material else ""
    count = str(q) + (f"–{high}" if high not in (None, q) else "")
    single = q == 1 and high in (None, 1)
    lead = f"這{unit}" if single else f"這 {count} {unit}"
    head = f"{lead}是 {subject}{bracket}，門市分類" if subject else f"{lead}{bracket}在門市分類"
    subtotal = line["subtotal"]
    max_subtotal = line.get("max_subtotal")
    amount = f"{subtotal:,}" + (f"–{max_subtotal:,}" if max_subtotal not in (None, subtotal) else "")
    if single:
        fee = f"清洗費用 {amount} 元"
    else:
        fee = f"清洗費用每{unit} {line['unit_price']:,} 元 × {count} {unit}＝{amount} 元"
    return f"{head}【{name}】，{fee}，約 {photo_turnaround(name, line.get('photo_category', ''))}。"


def _photo_detail(line: dict) -> str:
    edge = " 。，,；;"
    stain = (line.get("photo_stain") or "").strip(edge)
    craft = (line.get("photo_craft") or "").strip(edge)
    question = (line.get("photo_question") or "").strip(edge)
    segments = []
    if stain:
        segments.append(f"照片看到{stain}")
    if craft:
        segments.append(craft)
    text = "，".join(segments) + ("。" if segments else "")
    if question:
        if not question.endswith(("？", "?")):
            question += "？"
        text += question
    return text


PHOTO_MESSAGE_CHARS = 400
PHOTO_MAX_MESSAGES = 3
PHOTO_MAX_DIAGNOSES = 5
PHOTO_DETAIL_CHARS = 40


def _one_photo_question(value: str) -> str:
    # Never let a model's list of questions become several customer requests.
    first = re.split(r"[？?。；;，,]", value or "", maxsplit=1)[0].strip(" ，,")
    return first + "？" if first else ""


def _photo_excerpt(value: str, fallback: str) -> str:
    """Keep whole clauses; an overlong unbroken clause earns a complete fallback."""
    # Question clauses belong only in the globally selected question, even if a
    # provider misplaced them in stain/craft. Drop the clause, not just its '?'.
    value = re.sub(r"[^，,。；;！？!?]*[？?]", "", value or "").strip(" 。，,；;！？!?")
    if len(value) <= PHOTO_DETAIL_CHARS:
        return value
    kept = []
    for clause in re.split(r"[，,。；;！？!?]", value):
        clause = clause.strip()
        if len("，".join(kept + [clause])) > PHOTO_DETAIL_CHARS:
            break
        if clause:
            kept.append(clause)
    return "，".join(kept) or fallback


def _photo_diagnosis_key(detail: dict) -> tuple:
    # Only punctuation/spacing variants are equivalent, never fuzzy similarity:
    # e.g. 領口泛黃 and 領口未泛黃 must not merge. Compare full stored evidence,
    # not its shortened customer excerpt. Brand differences alone may be grouped.
    def normalized(value):
        return re.sub(r"[\s，,。；;！？!?、]+", "", unicodedata.normalize("NFKC", value or ""))
    return tuple(normalized(detail.get(field)) for field in (
        "name", "photo_model", "photo_material", "photo_certainty", "photo_reason", "photo_stain", "photo_craft"))


def _photo_question_priority(detail: dict) -> int:
    if detail.get("photo_certainty") != "clear" and re.search(
            r"不清|看不到|看不出|只拍|未拍|缺|無法|需|待|不確定", detail.get("photo_reason") or ""):
        return 0
    question = _one_photo_question(detail.get("photo_question"))
    if re.search(r"多久|何時|什麼時候|時間|來源|沾到|怎麼沾", question):
        return 1
    if re.search(r"曾|自行|自己|刷洗|洗過|漂白|去漬劑", question):
        return 2
    return 3


def _photo_question(detail: dict) -> str:
    question = _one_photo_question(detail.get("photo_question"))
    if _photo_question_priority(detail) == 0 and not re.search(r"補|拍|洗標|材質|款式|尺寸|數量|幾件", question):
        reason = detail.get("photo_reason") or ""
        if re.search(r"洗標|材質", reason):
            return "可以補拍洗標或材質標示嗎？"
        if "數量" in reason:
            return "這項總共有幾件呢？"
        return "可以補拍整件與尺寸標示嗎？"
    return question


def _photo_evidence(detail: dict) -> str:
    stain = (detail.get("photo_stain") or "").strip(" 。，,；;")
    pieces = ["照片看到" + stain] if stain else []
    if detail.get("photo_certainty") != "clear":
        reason = (detail.get("photo_reason") or "").strip(" 。，,；;")
        # A vague confidence label does not tell a customer which evidence is missing.
        if reason and re.search(r"不清|看不到|看不出|只拍|未拍|缺|無法|需|待|不確定", reason):
            pieces.append(reason)
        elif not detail.get("photo_material"):
            pieces.append("照片看不出材質，還需要洗標或材質近照確認")
        else:
            pieces.append("照片還無法確認款式細節，需要整件與標示近照")
    # Missing evidence must remain explicit even if a long stain clause was cut.
    if len(pieces) > 1:
        pieces = pieces[1:] + pieces[:1]
    return _photo_excerpt("，".join(pieces), "照片污況細節較多，需到店核對")


def _photo_order(number: int) -> str:
    digits = "零一二三四五六七八九"
    if number < 10:
        return digits[number]
    if number < 100:
        tens, units = divmod(number, 10)
        return (digits[tens] if tens > 1 else "") + "十" + (digits[units] if units else "")
    return str(number)


def _photo_group_titles(grouped: list, labels: dict) -> list[tuple]:
    """Give every group one identity, also used when its diagnosis is omitted."""
    names, brands = [], []
    for members in grouped:
        detail = members[0][0]
        group_labels = {labels[id(d)] for d, _, _ in members}
        names.append(labels[id(detail)] if len(group_labels) == 1 else detail["name"])
        values = {d.get("photo_brand", "") for d, _, _ in members}
        brands.append(next(iter(values)) if len(values) == 1 else "")
    titles = []
    for i, members in enumerate(grouped):
        detail = members[0][0]
        name = names[i]
        quantity = (sum(d["quantity"] for d, _, _ in members)
                    if all(type(d.get("quantity")) is int for d, _, _ in members) else None)
        plural = len(members) > 1 or (quantity is not None and quantity > 1)
        peers = [j for j, other in enumerate(names) if other == name]
        numbered = len(peers) > 1 and (not brands[i] or sum(brands[j] == brands[i] for j in peers) > 1)
        if numbered:
            unit = "批" if plural else _photo_unit_word(detail)
            name = f"第{_photo_order(peers.index(i) + 1)}{unit}{name}"
        identity = " ".join(x for x in (detail.get("photo_brand"), detail.get("photo_model")) if x)
        if plural:
            count = f"{quantity} {_photo_unit_word(detail)}" if quantity is not None else "數量待確認"
            identity = f"{identity}等 {count}" if identity and len(members) > 1 else "，".join(filter(None, (identity, count)))
        if detail.get("photo_material"):
            identity += ("，" if identity else "") + detail["photo_material"]
        head = name + (f"（{identity}）" if identity else "") + "："
        # Distinct brands disambiguate same-name items; otherwise use the same
        # ordinal as the heading. A multi-brand batch must not name just one brand.
        subject = name if numbered else " ".join(filter(None, (brands[i], name)))
        if plural and not numbered:
            subject = "這批" + subject
        compact = name + (f"（{brands[i]}）" if len(peers) > 1 and not numbered else "") + "："
        titles.append((head, compact, subject, plural))
    return titles


def _photo_addressed_question(question: str, subject: str, plural: bool) -> str:
    # A follow-up is a sentence, never a second item-heading-shaped line.
    question = re.sub(r"^(?:這|那|該)(?:件|雙|個|項)(?:衣物|物品)?", "", question)
    if plural:
        question = question.replace("這件", "這批物品")
    return f"關於 {subject}，{question}"


def _photo_sections(draft: dict, notice: str = "") -> list[dict]:
    """Priority: tariff/count/fee/time, then evidence, craft, and one question."""
    sections = [{"core": notice}] if notice else []
    groups = {}
    candidates = []
    labels = {}
    references = {}
    ordinal = 0
    lines = draft.get("lines") or []
    for line in lines:
        details = line.get("photo_items") or ([line] if line.get("source") == "photo" else [])
        display = dict(line)
        if len(details) > 1:
            for field in _PHOTO_FIELDS + ("label",):
                display.pop("photo_" + field, None)
        if line.get("subtotal") is not None:
            core = _photo_priced_sentence(display)
        else:
            q, high = line.get("quantity"), line.get("max_quantity")
            count = "數量待確認" if q is None else str(q) + (f"–{high}" if high not in (None, q) else "") + line.get("unit", "件")
            if line.get("range_min_subtotal") is not None:
                low, high_fee = line['range_min_subtotal'], line['range_max_subtotal']
                fee = f"預估 {low:,} 元" if low == high_fee else f"先抓 {low:,}–{high_fee:,} 元"
            else:
                fee = "費用待看件確認，還沒加進去"
            turnaround = ("約 " + photo_turnaround(line["name"], line["photo_category"])) if line.get("photo_category") else "交期待品項確認"
            core = f"{line.get('display') or line['name']} {count}：{fee}，{turnaround}。"
        if line.get("subtotal") is not None:
            q, high = line["quantity"], line.get("max_quantity")
            count = str(q) + (f"–{high}" if high not in (None, q) else "")
            amount = f"{line['subtotal']:,}"
            if line.get("max_subtotal") not in (None, line["subtotal"]):
                amount += f"–{line['max_subtotal']:,}"
            compact_core = f"【{line['name']}】{count}{_photo_unit_word(line)} {amount}元，約 {photo_turnaround(line['name'], line.get('photo_category', ''))}。"
        else:
            compact_core = f"【{line.get('display') or line['name']}】{count}：{fee}，{turnaround}。"
            if line.get("range_min_subtotal") is None:
                compact_core = f"【{line.get('display') or line['name']}】{count}，費用待看件，{turnaround}。"
        sections.append({"core": core, "compact_core": compact_core})
        for index, detail in enumerate(details):
            q = detail.get("quantity")
            size = q if type(q) is int else 1
            member = (detail, ordinal + 1, ordinal + size)
            ordinal += size
            label = detail.get("photo_label")
            if not label or label == "照片物件":
                label = line["name"]
            labels[id(detail)] = (line.get("display") or line["name"]) if line.get("subtotal") is None else label
            key = _photo_diagnosis_key(detail)
            groups.setdefault(key, []).append(member)
            question = _photo_question(detail)
            if question:
                candidates.append((detail, question))
    priced = [x for x in lines if x.get("subtotal") is not None]
    if len(priced) > 1:
        low = sum(x["subtotal"] for x in priced)
        high = sum(x.get("max_subtotal") or x["subtotal"] for x in priced)
        amount = f"{low:,}" + (f"–{high:,}" if high != low else "")
        mixed = any(x.get("source") == "text" for x in lines)
        prefix = "這批預估" if mixed else "這批合計"
        suffix = "，其他品項還要確認" if len(priced) != len(lines) else ""
        sections.append({"core": f"{prefix} {amount} 元{suffix}。"})
    grouped = list(groups.values())
    titles = _photo_group_titles(grouped, labels)
    for members, (_, _, subject, plural) in zip(grouped, titles):
        for detail, _, _ in members:
            references[id(detail)] = (subject, plural)
    for members, (head, compact, _, _) in list(zip(grouped, titles))[:PHOTO_MAX_DIAGNOSES]:
        detail = members[0][0]
        sections.append({"core": head, "compact_core": compact,
                         "evidence": _photo_evidence(detail),
                         "craft": _photo_excerpt(detail.get("photo_craft"), "處理細節到店確認"),
                         "members": members})
    omitted = [d for members in grouped[PHOTO_MAX_DIAGNOSES:] for d, _, _ in members]
    if omitted:
        if all(type(d.get("quantity")) is int for d in omitted):
            remaining = sum(d["quantity"] for d in omitted)
            sections.append({"core": f"另外 {remaining} 件到店一起看。"})
        else:
            sections.append({"core": f"另外 {len(omitted)} 項數量待確認，到店一起看。"})
    # One question for the whole batch, including a high-priority omitted group.
    if candidates:
        detail, question = min(candidates, key=lambda item: _photo_question_priority(item[0]))
        subject, plural = references[id(detail)]
        addressed = _photo_addressed_question(question, subject, plural)
        sections.append({"core": "", "question": addressed, "question_detail": detail})
    closing = DISCLAIMER if any(x.get("source") == "text" for x in lines) else PHOTO_CLOSING
    if draft.get("special"):
        closing = "另外待評估：" + "、".join(draft["special"]) + "，尚未加計。" + closing
    sections.append({"core": closing})
    return sections


def _section_text(section: dict) -> str:
    description = "".join(section[key] + "。" for key in ("evidence", "craft") if section.get(key))
    if ("members" in section and not description) or ("question_detail" in section and not section.get("question")):
        return ""
    return section["core"] + description + section.get("question", "")


def _pack_photo_sections(sections: list[dict]) -> list[str]:
    messages = []
    for section in sections:
        text = _section_text(section)
        if not text:
            continue
        if messages and len(messages[-1]) + len(text) + 1 <= PHOTO_MESSAGE_CHARS:
            messages[-1] += "\n" + text
        else:
            messages.append(text)
    return messages


def _bounded_photo_sections(draft: dict, max_messages: int = PHOTO_MAX_MESSAGES, notice: str = "") -> list[dict]:
    sections = _photo_sections(draft, notice)
    max_messages = max(1, min(max_messages, PHOTO_MAX_MESSAGES))

    def fits():
        messages = _pack_photo_sections(sections)
        return len(messages) <= max_messages and all(len(text) <= PHOTO_MESSAGE_CHARS for text in messages)

    # Long identity fields are optional; compact summaries preserve every tariff,
    # count, amount and turnaround before sacrificing diagnostic evidence.
    if not fits():
        for section in sections:
            section["core"] = section.get("compact_core", section["core"])
    for priority in ("question", "craft", "evidence"):
        for section in reversed(sections):
            if fits():
                return sections
            section.pop(priority, None)
    return sections


def photo_followup_items(draft: dict, max_messages: int = PHOTO_MAX_MESSAGES, notice: str = "") -> list[dict]:
    # Only questions that survived the customer-message budget count as asked.
    asked = {id(s["question_detail"]): s["question"] for s in _bounded_photo_sections(draft, max_messages, notice)
             if s.get("question") and "question_detail" in s}
    details = [d for line in draft.get("lines", [])
               for d in (line.get("photo_items") or ([line] if line.get("source") == "photo" else []))]
    return [dict(name=d["name"], quantity=d.get("quantity"),
                 **{field: d.get("photo_" + field, "") for field in ("brand", "model", "material", "stain", "craft")},
                 reason=d.get("photo_reason", ""), certainty=d.get("photo_certainty", "uncertain"),
                 question=asked.get(id(d), "")) for d in details]


def render_messages(draft: dict, max_messages: int = PHOTO_MAX_MESSAGES, notice: str = "") -> list[str]:
    if not draft.get("error") and any(x.get("source") == "photo" or x.get("photo_items") for x in draft.get("lines", [])):
        return _pack_photo_sections(_bounded_photo_sections(draft, max_messages, notice))
    return ([notice] if notice else []) + [render(draft)]


def render_photo(draft: dict) -> str:
    return "\n".join(_pack_photo_sections(_bounded_photo_sections(draft)))


def render(draft: dict) -> str:
    if draft.get("error"):
        return draft["error"]
    if not draft.get("lines"):
        return "這份預估清單已清空。還有要估的品項，直接告訴我就好。"
    if any(line.get("source") == "photo" or line.get("photo_items") for line in draft["lines"]):
        return render_photo(draft)
    out = [_opening_line(draft), ""]
    pending = []
    ranges = []
    for line in draft["lines"]:
        q = line.get("quantity")
        high = line.get("max_quantity")
        count = "數量待確認" if q is None else str(q) + (f"–{high}" if high != q else "") + line["unit"]
        if line.get("subtotal") is None and line.get("range_min_subtotal") is not None:
            note = "（照片先初判，材質／款式到店確認）" if line.get("source") == "photo" and line.get("photo_certainty") != "clear" else ""
            ranges.append(f"{line.get('display') or line['name']} {count}：先抓 {line['range_min_subtotal']:,}–{line['range_max_subtotal']:,} 元{note}")
        elif line.get("subtotal") is None:
            pending.append(f"{line.get('display') or line['name']}" + (f" {count}" if q is not None else "（件數還沒說）"))
        else:
            amount = f"{line['subtotal']:,}" + (f"–{line['max_subtotal']:,}" if line["max_subtotal"] != line["subtotal"] else "")
            out.append(f"{line['name']} {count} × {line['unit_price']:,}元＝{amount}元{_mode_suffix(line['name'])}")
            if line.get('estimate_assumption'):
                out.append('（先按照片可見款式估，材質到店再確認）')
    out.append("")
    if draft.get("total") is not None:
        amount = f"{draft['total']:,}" + (f"–{draft['max_total']:,}" if draft["max_total"] != draft["total"] else "")
        out.append(f"這批預估 {amount} 元。")
    elif draft.get("estimated_minimum") is not None and draft.get("estimated_maximum") is not None and (draft.get("estimated_minimum") or draft.get("estimated_maximum")):
        amount = f"{draft['estimated_minimum']:,}" + (f"–{draft['estimated_maximum']:,}" if draft["estimated_maximum"] != draft["estimated_minimum"] else "")
        out.append(f"這批先抓約 {amount} 元。")
        if draft.get("known_subtotal"):
            out.append(f"已確認品項小計 {draft['known_subtotal']:,} 元。")
    else:
        out[0] = "清單收到了，還差一點資料就能幫你算："
    if ranges:
        out.extend(["", "還有幾項先用區間抓：" + "、".join(ranges) + "。"])
    if pending:
        out.extend(["", "還沒加進去：" + "、".join(pending) + "。", clarification(draft)])
    if draft.get("special"):
        out.append("另外待評估：" + "、".join(draft["special"]) + "，尚未加計。")
    out.extend(["", DISCLAIMER])
    return "\n".join(out)


def clarification(draft):
    row = next((x for x in draft.get('lines', []) if x.get('subtotal') is None), None)
    if not row:
        return ""
    name = row['name']
    if name == '床組':
        return "床組是四件套嗎？是的話按下面確認；不是的話，告訴我有哪些床單、被套或枕套就好。"
    if name in ('運動鞋', '球鞋', '鞋子'):
        return "運動鞋是一般、皮類還是混合材質？可以按下面選；不確定就拍給我們看。"
    if name == '棉被':
        return "棉被是單人還是雙人、共幾件？例如回「雙人棉被1件」，我就接著加上去。"
    if row.get('quantity') is None:
        return f"{name}有幾{row.get('unit', '件')}？告訴我數量，我接著算。"
    return f"{name}：{row.get('reason') or '這項需要店員看件確認'}。其他算好的金額會保留。"


def clarification_actions(draft):
    row = next((x for x in draft.get('lines', []) if x.get('subtotal') is None), None)
    if not row:
        return []
    count = row.get('quantity')
    # An ambiguous quantity/range must not silently become a single-item quote.
    if count is None or count != row.get('max_quantity'):
        return []
    choices = []
    if row['name'] == '床組':
        choices = [(f'四件套 {count}套', f'床組四件套{count}套')]
    elif row['name'] in ('運動鞋', '球鞋', '鞋子'):
        choices = [(kind, f'{kind}{count}雙') for kind in ('一般運動鞋', '皮類運動鞋', '混合運動鞋')]
    elif row['name'] == '棉被':
        choices = [(f'{kind} {count}件', f'{kind}{count}件') for kind in ('單人棉被', '雙人棉被')]
    return [{'type': 'message', 'label': label, 'text': value} for label, value in choices]
