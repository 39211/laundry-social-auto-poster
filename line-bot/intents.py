# -*- coding: utf-8 -*-
"""品名正規化與比對（純函式、無 I/O）。R1"""
from __future__ import annotations

import unicodedata

# R2 unknown_item 關鍵詞（窗簾重複寫一次即可）
UNKNOWN_ITEMS = (
    "窗簾",
    "地毯",
    "娃娃",
    "玩偶",
    "安全帽",
    "汽車座椅",
    "嬰兒車",
    "沙發套",
    "枕頭",
    "枕芯",
)

_SUFFIXES = (
    "多少錢",
    "要多少",
    "怎麼算",
    "怎麼收",
    "價格",
    "價錢",
    "多少",
    "一件",
    "一雙",
    "一條",
    "一張",
    "一個",
    "請問",
    "幫我",
    "我想洗",
    "想洗",
    "可以嗎",
    "嗎",
    "洗",
)

_PREFIXES = (
    "請問",
    "幫我",
    "我想洗",
    "想洗",
)

_PUNCT = (
    "，。！？、；：,.!?;:…·「」『』（）()【】[]～~／/＋+＝=＊*＆&＃#＠@％%＿_　"
    "\"'“”‘’—–"
)

# 簡單別名 → 價目實際鍵（品牌詞另外處理）
_SIMPLE_SYNONYM = {
    "羽絨衣": "羽絨外套",
    "羽絨服": "羽絨外套",
    "球鞋": "一般運動鞋",
    "運動鞋": "一般運動鞋",
    "慢跑鞋": "一般運動鞋",
    "枕頭套": "枕套",
    "單人棉被": "棉被單人",
    "雙人棉被": "棉被雙人",
    "毛毯單人": "小毛毯",
    "單人毛毯": "小毛毯",
    "玩偶": "娃娃",
    "蠶絲被": "蠶絲羊毛被",
    "羊毛被": "蠶絲羊毛被",
}

_BRANDS = ("lv", "gucci", "chanel", "hermes", "coach")

# 長詞在前，避免「謝謝你」先被剝成「你」
_ACK_WORDS = (
    "thank you",
    "thanks",
    "謝謝你",
    "謝謝您",
    "感謝你",
    "感謝您",
    "3q",
    "okay",
    "ok",
    "謝謝",
    "感謝",
    "感恩",
    "好的",
    "好喔",
    "了解",
    "收到",
    "辛苦了",
    "好",
    "嗯",
    "讚",
)

_ACK_PUNCT = set("，。！？、；：,.!?;:…·「」『』（）()【】[]～~／/＋+＝=＊*＆&＃#＠@％%＿_　 \"'“”‘’—–\n\r\t")


def _fw2hw(text: str) -> str:
    out = []
    for ch in text or "":
        o = ord(ch)
        if o == 0x3000:
            out.append(" ")
        elif 0xFF01 <= o <= 0xFF5E:
            out.append(chr(o - 0xFEE0))
        else:
            out.append(ch)
    return "".join(out)


def _strip_punct(text: str) -> str:
    return "".join(ch for ch in text if ch not in _PUNCT and not ch.isspace())


def _bare(text: str) -> str:
    s = unicodedata.normalize("NFKC", _fw2hw(text or ""))
    return _strip_punct(s)


def normalize(text: str) -> str:
    """去空白、全形轉半形、去標點、去尾綴／禮貌前綴。R1"""
    s = _bare(text)
    changed = True
    while s and changed:
        changed = False
        for p in _PREFIXES:
            if s.startswith(p) and len(s) > len(p):
                s = s[len(p) :]
                changed = True
                break
        if changed:
            continue
        for suf in _SUFFIXES:
            if s.endswith(suf) and len(s) > len(suf):
                remain = s[: -len(suf)]
                # K4：剝完不足 2 字就放棄這次剝除（避免「乾洗」→「乾」）
                if len(remain) < 2:
                    continue
                s = remain
                changed = True
                break
        if not changed:
            # 整句就是尾綴（例如「多少錢」）。剝完會變空字串，K4 同樣放棄。
            for suf in _SUFFIXES:
                if s == suf:
                    break
            else:
                for p in _PREFIXES:
                    if s == p:
                        s = ""
                        changed = True
                        break
    return s


def _ascii_fold(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch)).lower()


def _is_emoji(ch: str) -> bool:
    o = ord(ch)
    return (
        0x1F300 <= o <= 0x1FAFF
        or 0x1F1E6 <= o <= 0x1F1FF
        or 0x2600 <= o <= 0x27BF
        or 0x2300 <= o <= 0x23FF
        or 0xFE00 <= o <= 0xFE0F
        or 0x200D == o
        or 0x20E3 == o
        or 0xFE0F == o
    )


def is_ack(text: str) -> bool:
    """文字只由致謝／附和詞、emoji、標點組成。R2 ack"""
    s = _fw2hw(text or "").strip()
    if not s:
        return False
    s = unicodedata.normalize("NFKC", s)
    # 反覆剝致謝詞、標點、emoji
    changed = True
    while s and changed:
        changed = False
        low = s.lower()
        for w in _ACK_WORDS:
            if low.startswith(w.lower()):
                s = s[len(w) :]
                changed = True
                break
        if changed:
            continue
        if s[0] in _ACK_PUNCT or _is_emoji(s[0]):
            s = s[1:]
            changed = True
    return s == ""


def _brand_hits(text: str, q: str) -> bool:
    hay = _ascii_fold(text + " " + q)
    compact = hay.replace(" ", "")
    if "名牌" in (text or "") or "名牌" in q:
        return True
    for b in _BRANDS:
        if b in compact:
            return True
    return False


def _synonym_names(q: str, catalog: dict, raw: str) -> list[str]:
    """同義詞表。R1"""
    found: list[str] = []

    def add(name: str) -> None:
        if name in catalog and name not in found:
            found.append(name)

    if q in ("床單", "被套", "床單被套") or q.endswith("床單") or q.endswith("被套"):
        add("床單被套薄")
        add("床單被套厚")
        if found:
            return found

    if q == "棉被":
        add("棉被單人")
        add("棉被雙人")
        if found:
            return found

    if q == "羽絨羊毛被":
        add("羽絨被")
        add("蠶絲羊毛被")
        if found:
            return found

    if q in ("毛毯雙人", "雙人毛毯"):
        add("中毛毯")
        add("大毛毯")
        if found:
            return found

    # M2：西裝／西裝外套／西裝褲不得子字串配到「西裝背心」
    if q == "西裝" or (q.startswith("西裝") and q != "西裝背心"):
        return found

    mapped = _SIMPLE_SYNONYM.get(q)
    if mapped:
        add(mapped)
        if found:
            return found

    if _brand_hits(raw, q):
        hay = raw + q
        add("名牌鞋" if "鞋" in hay else "名牌包")
        if found:
            return found

    return found


def _dedupe(names: list[str]) -> list[str]:
    uniq: list[str] = []
    for h in names:
        if h not in uniq:
            uniq.append(h)
    return uniq


def _longest(names: list[str]) -> list[str]:
    uniq = _dedupe(names)
    if not uniq:
        return []
    maxlen = max(len(_bare(h) or h) for h in uniq)
    return [h for h in uniq if len(_bare(h) or h) == maxlen]


def match_item_ex(text: str, catalog: dict) -> tuple[list[str], str]:
    """回 (品名列, 方向)。方向：exact / synonym / contains（A）/ prefix（B）。K1"""
    if not catalog:
        return [], ""
    q = normalize(text)
    if not q:
        return [], ""

    exact = []
    if q in catalog:
        exact.append(q)
    for name in catalog:
        if name == q:
            if name not in exact:
                exact.append(name)
        elif _bare(name) == q and name not in exact:
            exact.append(name)
    if exact:
        return exact, "exact"

    # M6：品牌／名牌判斷排在子字串比對之後
    if q in _SIMPLE_SYNONYM or q in ("床單", "被套", "床單被套", "棉被", "西裝"):
        syn_first = _synonym_names(q, catalog, text or "")
        if syn_first:
            return syn_first, "synonym"

    contains: list[str] = []
    prefix: list[str] = []
    for name in catalog:
        bare = _bare(name) or name
        if name and name in q:
            contains.append(name)
        elif bare and bare in q:
            contains.append(name)
        elif len(q) >= 2 and (q in name or q in bare):
            prefix.append(name)

    if contains:
        uniq = _dedupe(contains)
        longest = _longest(uniq)
        if len(longest) == 1:
            return longest, "contains"
        syn = _synonym_names(q, catalog, text or "")
        if syn:
            return syn, "synonym"
        return longest, "contains"

    if prefix:
        # 方向 B：類別詞，回全部候選，不取最長
        return _dedupe(prefix), "prefix"

    syn = _synonym_names(q, catalog, text or "")
    if syn:
        return syn, "synonym"
    return [], ""


def match_item(text: str, catalog: dict) -> list[str]:
    """先精確、再子字串、再同義詞。回價目實際鍵。R1／K1 相容包裝。"""
    names, _kind = match_item_ex(text, catalog)
    return names


def _compact_trigger(text: str) -> str:
    s = unicodedata.normalize("NFKC", _fw2hw(text or ""))
    s = s.replace(" ", "").replace("\u3000", "").replace("？", "").replace("?", "")
    return s.lower()


# V1／V2／V3：觸發詞（比對前先 compact；另用 normalize 再比一次）
_WHO_AM_I_TRIGGERS = (
    "你是ai嗎",
    "你是ai",
    "是機器人",
    "機器人嗎",
    "真人嗎",
    "是人嗎",
    "你是誰",
    "你是真的嗎",
    "有人在嗎",
)

_META_FEEDBACK_TRIGGERS = (
    "太公板",
    "太制式",
    "像機器",
    "罐頭",
    "複製貼上",
    "不像人",
    "太ai",
    "聽不懂人話",
    "答非所問",
)

_HUMAN_TRIGGERS = (
    "找真人",
    "真人",
    "找店員",
    "找老闆",
    "我要跟人講",
    "叫人",
)


def _has_trigger(text: str, triggers: tuple[str, ...]) -> bool:
    """normalize 只套在客人原句；觸發詞本身不剝「嗎」，避免「是人嗎」變成「是人」。"""
    hay = _compact_trigger(text)
    nq = (normalize(text) or "").lower()
    if not hay and not nq:
        return False
    for trig in triggers:
        t = _compact_trigger(trig)
        if not t:
            continue
        if t in hay or (nq and t in nq):
            return True
    return False


def is_who_am_i(text: str) -> bool:
    """V1：你是誰／是不是機器人。"""
    return _has_trigger(text, _WHO_AM_I_TRIGGERS)


def is_meta_feedback(text: str) -> bool:
    """V2：嫌公板、像機器。"""
    return _has_trigger(text, _META_FEEDBACK_TRIGGERS)


def is_human_request(text: str) -> bool:
    """V3：明確要找真人。"""
    return _has_trigger(text, _HUMAN_TRIGGERS)
