# -*- coding: utf-8 -*-
"""SP-1 safety guards for the shop-PC daytime LINE chat. Standard library only.

Used by runtime.chat_service:
  is_complaint(text)          damage / loss / compensation talk, also "what if"  -> COMPLAINT_LINE
  guard_ai_reply(reply)       (OK, None) | (REJECT, reason) | (STAFF, "store_claim")
  notify_staff(reason, uid)   one grep-able log line: "[Chat Guard] STAFF reason=..."

The shop PC has NO staff push channel. STAFF_LINE and COMPLAINT_LINE therefore never say the
message was forwarded; they send the customer to the phone or the counter.

Owner-defined facts (the only store facts an AI reply may state):
  交期 一般衣物 5-7 天、鞋 7 天、難乾的大件 10-14 天、皮件包 14 天；台中市免費到府收送。
Prices come only from the shop price data, so an AI reply never states a price.
Everything else (minimum order, payment methods, holidays, parking, ...) is 待店主確認.
Reply checks follow line-bot/ai_chat.py check_reply (incl. _OTHER_TIME_RE, G-2 store words).
"""
from __future__ import annotations

import re
import sys
import unicodedata

OK = "ok"
REJECT = "reject"
STAFF = "staff"

STAFF_LINE = "這個要請店員親自確認，我這邊先不回答；方便的話請在營業時間直接打給店裡。"
COMPLAINT_LINE = (
    "了解，衣物的狀況要由店員親自看過才能說明，我這邊先不回答；"
    "麻煩您在營業時間直接打給店裡，或帶著衣物到門市找店員。"
)

# Owner turnaround: 一般衣物 5–7 天、鞋 7 天、難乾的大件 10–14 天、皮件包 14 天
_ALLOWED_DAY_SPANS = frozenset({"5-7", "7", "10-14", "14"})
_ALLOWED_DIGITS = frozenset({"5", "7", "10", "14"})
# Grounded store claims (owner-confirmed): 台中市免費到府收送; 一件也收 (owner 「是」, 11/05);
# 沒有低消 (owner 「成立,繼續用」, 11/06). Anything else about minimums or fees stays ungrounded.
_GROUNDED_CLAIM_RE = re.compile(r"[台臺]中市?免費到府收送|一件也收|沒有低消")


def _compact(text) -> str:
    s = unicodedata.normalize("NFKC", text or "")
    return re.sub(r"[\s，,。.！!？?～~、…：:；;「」『』()（）]+", "", s).lower()


# ---------------------------------------------------------------------------
# Complaint / damage / loss / compensation (past or hypothetical) -> staff, no model call
# ---------------------------------------------------------------------------
_COMPLAINT_RE = re.compile(
    r"洗壞|弄壞|洗爛|洗破|弄破|縮水|變形|掉色|褪色|退色|染色|變色|脫膠"
    r"|弄丟|搞丟|遺失|少了?一件|拿錯|賠|客訴|投訴|申訴|消保|退錢|退費"
    r"|誰負責|要負責|負責任|沒洗乾淨|沒洗好|洗不乾淨|越洗越"
    r"|洗坏|弄坏|缩水|赔"
)


def is_complaint(text) -> bool:
    if not isinstance(text, str):
        return False
    return bool(_COMPLAINT_RE.search(_compact(text)))


# ---------------------------------------------------------------------------
# Reply rules: price, turnaround, numbers, URL, action claims, promises -> REJECT
# ---------------------------------------------------------------------------
_MONEY_RE = re.compile(
    r"NT\s*\$|NTD|TWD|\$|元|\d\s*塊|[零〇一二兩三四五六七八九十百千萬幾]\s*塊"
    r"|價[^。，,!?！？]{0,6}\d|\d[^。，,!?！？]{0,3}價",
    re.IGNORECASE,
)
_CN_AMOUNT_RE = re.compile(r"[一二兩三四五六七八九十]\s*[百千萬]")
_CN_DAYS_RE = re.compile(
    r"[一二兩三四五六七八九十半幾數]\s*(?:個)?(?:工作)?(?:天|日|週|周|星期|禮拜|小時|鐘頭|個月)")
_DAY_SPAN_RE = re.compile(r"(\d+)(?:\s*[–\-~至到]\s*(\d+))?\s*(?:個)?(?:工作)?(?:天|日)")
_OTHER_TIME_RE = re.compile(
    r"工作天|工作日|營業日"
    r"|\d+\s*(?:個\s*)?(?:小時|鐘頭|分鐘|月|週|周|星期|禮拜|點|號)"
    r"|明天|後天|隔天|隔日|當天|當日|明日|即日|今天(?:就|可以|能)|馬上|立刻|快洗|小時內"
)
_URL_RE = re.compile(r"https?://|www\.|\.(?:com|net|org|tw|io|me|ly|cc|co|app|link)\b")
_ACTION_CLAIM_RE = re.compile(
    r"(?:已(?:經)?|剛剛)(?:幫你|替你|幫您|為您|替您)?"
    r"(?:查到|查好|轉交|轉達|轉給|傳給|通知|記下|預約成功|安排好|確認入帳|收到付款)"
)
_PROMISE_RE = re.compile(
    r"(?<!不)保證|包您|包你|包在|包準"
    r"|絕對(?!不要|不能|不可|別)"
    r"|(?<![不未])一定"
    r"|(?<!不)肯定|百分之百|萬無一失"
    r"|恢復全新|恢復如新|跟新的一樣|像新的一樣|煥然一新"
    r"|完全(?:去除|去掉|洗掉|清除|恢復|消失|沒問題)"
    r"|急件|插單|提早|提前|優先處理|加急|趕件|加快"
)


def _duration_is_grounded(text: str) -> bool:
    # night bot: every day span must follow the category it belongs to
    categories = re.compile(r"難乾[^，。！？；、]*|厚棉被|大件|皮件|皮包|包包|包|鞋[^，。！？；、\d]*|一般衣物|一般衣服|衣物|衣服")
    previous = 0
    for match in _DAY_SPAN_RE.finditer(text):
        labels = list(categories.finditer(text[previous:match.start()]))
        if not labels:
            return False
        label = labels[-1].group()
        expected = "10-14" if any(x in label for x in ("難乾", "厚棉被", "大件")) else "14" if any(x in label for x in ("皮", "包")) else "7" if "鞋" in label else "5-7"
        actual = match.group(1) + ("-" + match.group(2) if match.group(2) else "")
        if actual != expected:
            return False
        previous = match.end()
    return True


def reply_violation(reply) -> str | None:
    """Reason an AI reply breaks an owner rule, else None."""
    if not isinstance(reply, str):
        return "empty"
    text = reply.replace("**", "").replace("*", "").replace("#", "").replace("`", "")
    text = re.sub(r"\s+", " ", text).strip().strip("「」\"' ")
    if not text:
        return "empty"
    probe = unicodedata.normalize("NFKC", text)
    if _MONEY_RE.search(probe) or _CN_AMOUNT_RE.search(probe):
        return "price"
    if _CN_DAYS_RE.search(probe) or _OTHER_TIME_RE.search(probe):
        return "day_count"
    if any(d not in _ALLOWED_DIGITS for d in re.findall(r"\d+", probe)):
        return "number"
    for match in _DAY_SPAN_RE.finditer(probe):
        span = match.group(1) + ("-" + match.group(2) if match.group(2) else "")
        if span not in _ALLOWED_DAY_SPANS:
            return "day_count"
    if not _duration_is_grounded(probe):
        return "day_count"
    if _URL_RE.search(probe.lower()):
        return "url"
    if _ACTION_CLAIM_RE.search(probe):
        return "action_claim"
    if _PROMISE_RE.search(probe):
        return "promise"
    return None


# ---------------------------------------------------------------------------
# Store details the owner has not confirmed -> STAFF
# ---------------------------------------------------------------------------
_STORE_CLAIM_RE = re.compile(
    # parking / transit / building / neighbours (night bot G-2 list)
    r"停車|車位|好停|臨停|停放|停在|騎樓|路邊|紅線|黃線|捷運|公車|站牌|火車站|高鐵|步行|走路"
    r"|附近有|旁邊有|對面有|斜對面|隔壁|樓下|樓上|巷口|轉角|走過去|電梯|無障礙"
    # payment methods
    r"|付款|付費|支付|現金|line\s*pay|apple\s*pay|轉帳|匯款|刷卡|信用卡|街口|悠遊卡"
    # minimum order / service area
    r"|低消|最低消費|滿額|免運|起送|一件也收|門檻|外縣市|全台|全區|市區|郊區"
    # holidays / opening days and hours
    r"|公休|店休|休假|休息日|假日|連假|過年|春節"
    r"|週[一二三四五六日天末]|周[一二三四五六日天末]|星期[一二三四五六日天]|禮拜[一二三四五六日天]"
    r"|幾點|開門|關門|打烊|營業到"
    # services / compensation the owner has not defined
    r"|保管|寄放|會員|儲值|優惠|折扣|打折|免費|賠|保障|保固|保險",
    re.IGNORECASE,
)


def ungrounded_store_claim(reply) -> bool:
    if not isinstance(reply, str):
        return False
    probe = unicodedata.normalize("NFKC", reply)
    grounded = [(m.start(), m.end()) for m in _GROUNDED_CLAIM_RE.finditer(probe)]
    for m in _STORE_CLAIM_RE.finditer(probe):
        if not any(s <= m.start() and m.end() <= e for s, e in grounded):
            return True
    return False


def guard_ai_reply(reply) -> tuple[str, str | None]:
    """Rule break -> REJECT (non-AI reply); otherwise-clean unconfirmed store fact -> STAFF."""
    reason = reply_violation(reply)
    if reason is not None:
        return REJECT, reason
    if ungrounded_store_claim(reply):
        return STAFF, "store_claim"
    return OK, None


def notify_staff(reason: str, user_id: str = "") -> None:
    """One log line (no customer text; it is in the [Webhook Text] line). Not a push."""
    who = (str(user_id)[:8] + "...") if user_id else "unknown"
    print(f"[Chat Guard] STAFF reason={reason} user={who}", file=sys.stderr)
