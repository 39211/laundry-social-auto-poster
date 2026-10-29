# -*- coding: utf-8 -*-
"""私享家對話：像電話裡的店員，不是選單機器人。"""
from __future__ import annotations

import json
import hashlib
import logging
import os
import re
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import customer_profile as cprof
import ehank_prices
import intents
import quote_flow
import journey_ux

_SESSION_LOCK = threading.RLock()

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Asia/Taipei")
except Exception:
    TZ = None

REPO = Path(os.environ.get("LAUNDRY_REPO_ROOT", r"C:/Users/cyc39/laundry-repo"))
_BOT_DIR = Path(__file__).resolve().parent
COUPON_URL_PATH = _BOT_DIR / "coupon-url.txt"
COUPON_NAME_PATH = _BOT_DIR / "coupon-name.txt"
DEFAULT_COUPON_NAME = "新朋友優惠"
PRICES = json.loads((REPO / "data/prices.json").read_text(encoding="utf-8"))
BIZ = json.loads((REPO / "data/business-profile.json").read_text(encoding="utf-8"))
SESS = REPO / "data" / "line-sessions.json"
BOOK = REPO / "data" / "line-bookings.jsonl"
# 洗法標示與基準只在啟動時套用一次；店主改 eHank 價目後要重啟 bot 才會生效。
PRICE_LABELS: dict[str, str] = {}
PRICE_BASIS = "off"
CATS: dict = {}


def apply_price_alignment() -> None:
    """依 price-align.json 把 eHank 價目套進 PRICES。失敗就留著 prices.json。"""
    global PRICE_BASIS
    try:
        result = ehank_prices.align(PRICES, repo=REPO)
    except Exception as exc:
        logging.getLogger("conversation").warning(
            "price align kept prices.json (%s)", type(exc).__name__
        )
    else:
        PRICES.clear()
        PRICES.update(result.prices)
        PRICE_LABELS.clear()
        PRICE_LABELS.update(result.labels)
        if result.code == "ALIGNED":
            PRICE_BASIS = result.basis
        else:
            PRICE_BASIS = "off"
    CATS.clear()
    CATS.update({k: v for k, v in PRICES.items() if isinstance(v, dict)})


apply_price_alignment()

PHONE = BIZ.get("telephone_local") or "04-2452-7411"
MAP = BIZ.get("map_url") or ""
ADDR = BIZ.get("address_text") or ""
HOURS = BIZ.get("opening_hours_text") or ""
LANDMARK = BIZ.get("landmark") or "至善國中對面"

CREAM = "#F4EFE6"
INK = "#2C2824"
GOLD = "#B08968"
NAVY = "#3D3229"
GREEN = "#06C755"

_FEATURED_NAMES = {
    "寢具": ["棉被單人", "棉被雙人", "羽絨羊毛被", "羽絨被", "涼被"],
    "鞋子": ["一般運動鞋", "皮鞋", "名牌鞋", "休閒鞋"],
    "包包": ["一般包", "皮包包", "名牌包", "背包"],
    "衣物": ["襯衫", "長褲", "薄外套", "羽絨外套"],
    "皮革": ["皮衣", "皮帶", "皮裙"],
}

_CATEGORY_WORDS = (
    "外套",
    "洋裝",
    "大衣",
    "裙子",
    "褲子",
    "包包",
    "鞋子",
    "棉被",
    "衣服",
    "寢具",
    "羽絨",
)

_CAT_STEM = {
    "大衣": "大衣",
    "裙子": "裙子",
    "褲子": "褲",
    "羽絨": "羽絨",
    "洋裝": "洋裝",
}

_IN_STORE_EXACT = frozenset({"到了", "到囉", "到店了", "我人到了", "到門口了", "到門口", "人到了"})
_QUERY_CODE_RE = re.compile(r"^[A-Za-z0-9\-]{2,20}$")
_ADDR_MARKS = set("路街巷弄號段區村里")
_PICKUP_MENU = {
    "外收送預約",
    "外收",
    "外收送",
    "到府收送",
    "收送",
}
_QUERY_MENU = {
    "物件查詢",
    "查件",
    "查衣服",
    "好了沒",
    "可以取了嗎",
    "入庫了嗎",
    "進度查詢",
    "查件進度",
    "進度",
}

# U5：等於「拍照問價」，或含口語「拍照問／傳照片／拍給你」
_PHOTO_QUOTE_TRIGGERS = ("拍照問價", "拍照問", "傳照片", "拍給你")
_PHOTO_WAIT_MINUTES = 10
_PHOTO_NUDGES = ("有照片我比較好講。", "拍一張我比較準。")
_PHOTO_NUDGE = _PHOTO_NUDGES[0]
_PHOTO_CAMERA_ACTIONS = (
    {"type": "camera", "label": "📷 拍照"},
    {"type": "cameraRoll", "label": "🖼 從相簿選"},
)
_PRICE_MENU = frozenset(
    {"價目", "價目表", "價格表", "menu", "服務價目", "先看價錢", "先看價目表", "看價目表"}
)

# V1–V5 文案（電話號碼不進掉底句）
_WHO_AM_I_REPLY = "我是私享家的小幫手，先幫老闆接話。要找真人的話說一聲，我馬上轉。"
_WHO_AM_I_QR = [("找真人", "找真人"), ("我要洗東西", "我要洗東西"), ("看價目表", "看價目表")]
_META_FEEDBACK_REPLY = "抱歉，剛剛講得太制式了。你想先問哪件事？也可以直接請店員接著回。"
_META_FEEDBACK_QR = [("拍照問價", "拍照問價"), ("找真人", "找真人")]
_HUMAN_REPLY = "好，我把需求轉給店裡，請店員接著回。若已經打烊，會等營業時間處理。"
_FALLBACK_QR = [
    ("拍照問價", "拍照問價"),
    ("看價目表", "看價目表"),
    ("找真人", "找真人"),
]
# V5：規格字表＋「件」（契約例句「這件可以嗎」）
_LAUNDRY_MARKS = ("洗", "衣", "件", "褲", "裙", "鞋", "包", "被", "髒", "污", "乾洗", "燙")
_ACK_VARIANTS = (
    "不客氣，有需要再跟我說。",
    "好，有事再叫我。",
    "OK，隨時找我。",
)
_QUOTE_TAILS = (
    "實際以到店看件為準。",
    "這是參考價，看件再確定。",
    "大概這個數，實際看件。",
)


def _featured_pairs(cat: str) -> list[tuple[str, object]]:
    items = CATS.get(cat) or {}
    out = []
    for n in _FEATURED_NAMES.get(cat) or []:
        if n in items:
            out.append((n, items[n]))
    return out

def _pay_ready() -> bool:
    try:
        import line_pay
        return bool(line_pay.configured())
    except Exception:
        return False


def next_qr_items() -> list[tuple[str, str]]:
    """R5：LINE Pay 未設定時不出現該按鈕。"""
    items = [
        ("這週到店", "預約到店"),
        ("先看位置", "位置"),
        ("先看價目", "價目表"),
    ]
    if _pay_ready():
        items.append(("LINE Pay", "LINE Pay"))
    else:
        # F1：未設定時只追加打電話，避免與「先看位置」重複
        items.append(("打電話", "電話"))
    return items


def now_tw() -> datetime:
    return datetime.now(TZ) if TZ else datetime.now()


def dt_fmt(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M")


def _load_sess() -> dict:
    if SESS.exists():
        try:
            return json.loads(SESS.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def _save_sess(data: dict) -> None:
    SESS.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=SESS.parent, delete=False) as f:
        temp = Path(f.name)
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    try:
        os.replace(temp, SESS)
    finally:
        temp.unlink(missing_ok=True)


def get_sess(uid: str) -> dict:
    data = _load_sess()
    row = data.get(uid) or {}
    ts = row.get("ts")
    if ts:
        try:
            if datetime.now() - datetime.fromisoformat(ts) > timedelta(hours=2):
                row = {}
        except ValueError:
            row = {}
    return row


def set_sess(uid: str, **kw) -> None:
    with _SESSION_LOCK:
        data = _load_sess()
        previous = data.get(uid) or {}
        row = get_sess(uid).copy()
        if not row and previous.get("estimate_events"):
            row["estimate_events"] = previous["estimate_events"]
            row["estimate_replies"] = previous.get("estimate_replies", {})
            row["estimate_reply_accepted"] = previous.get("estimate_reply_accepted", [])
        row.update(kw)
        row["ts"] = datetime.now().isoformat(timespec="seconds")
        data[uid] = row
        _save_sess(data)


def _clear_photo_wait(uid: str) -> None:
    set_sess(uid, wait=None, photo_wait_ts="", photo_nudged=False)


def _photo_wait_alive(uid: str) -> bool:
    sess = get_sess(uid) or {}
    if sess.get("wait") != "photo":
        return False
    return _ts_within(sess.get("photo_wait_ts") or "", _PHOTO_WAIT_MINUTES)


def _with_photo_funnel(msgs: list[dict], uid: str, intent: str) -> list[dict]:
    """F3：拍照模式中，最後一則回覆前面留相機按鈕；催拍句同一輪只講一次。"""
    if intent in ("ack", "image", "photo_quote", "who_am_i", "meta_feedback", "human"):
        return msgs
    if not uid or not msgs:
        return msgs
    out = [dict(m) for m in msgs]
    last = dict(out[-1])
    existing = []
    for it in (last.get("quickReply") or {}).get("items") or []:
        existing.append(dict(it.get("action") or {}))
    head = existing[:2]
    already = (
        len(head) == 2
        and head[0].get("type") == "camera"
        and head[1].get("type") == "cameraRoll"
    )
    if not already:
        existing = [dict(a) for a in _PHOTO_CAMERA_ACTIONS] + existing
    last["quickReply"] = qr_actions(existing[:13])
    out[-1] = last
    sess = get_sess(uid) or {}
    if not sess.get("photo_nudged"):
        for i in range(len(out) - 1, -1, -1):
            if out[i].get("type") == "text":
                t = out[i].get("text") or ""
                if not any(n in t for n in _PHOTO_NUDGES):
                    nudge = _pick_variant(uid, "photo_nudge", _PHOTO_NUDGES)
                    out[i]["text"] = (t + "\n" + nudge) if t else nudge
                break
        set_sess(uid, photo_nudged=True)
    return out


def qr(items: list[tuple[str, str]]) -> dict:
    return {
        "items": [
            {"type": "action", "action": {"type": "message", "label": label[:20], "text": text}}
            for label, text in items[:13]
        ]
    }


def qr_actions(actions: list[dict]) -> dict:
    """快速回覆：允許 camera／cameraRoll／location／datetimepicker／postback／message。"""
    items = []
    for act in (actions or [])[:13]:
        a = dict(act)
        lab = a.get("label") or ""
        if lab:
            a["label"] = lab[:20]
        items.append({"type": "action", "action": a})
    return {"items": items}


def text_msg(
    text: str,
    buttons: list[tuple[str, str]] | None = None,
    actions: list[dict] | None = None,
) -> dict:
    msg = {"type": "text", "text": text}
    if actions:
        msg["quickReply"] = qr_actions(actions)
    elif buttons:
        msg["quickReply"] = qr(buttons)
    return msg


def say(*bubbles: str, buttons=None, actions=None) -> list[dict]:
    """電話裡會停頓的地方，就拆成兩則。最後一則才放選項。"""
    msgs = [text_msg(b) for b in bubbles[:-1]]
    msgs.append(text_msg(bubbles[-1], buttons=buttons, actions=actions))
    return msgs


def hello() -> str:
    h = now_tw().hour
    if 5 <= h < 11:
        return "早安"
    if 11 <= h < 17:
        return "午安"
    if 17 <= h < 22:
        return "晚安"
    return "您好"


def _pick_variant(uid: str, key: str, variants: tuple[str, ...] | list[str]) -> str:
    """V6：同一 uid 連續兩次不得收到同一句。無 uid 時固定第一句。"""
    if not variants:
        return ""
    if not uid:
        return variants[0]
    sess = get_sess(uid) or {}
    store = sess.get("variant_idx")
    if not isinstance(store, dict):
        store = {}
    last = store.get(key)
    n = len(variants)
    if last is None:
        idx = 0
    else:
        try:
            last_i = int(last)
        except (TypeError, ValueError):
            last_i = -1
        idx = (last_i + 1) % n
    store = dict(store)
    store[key] = idx
    set_sess(uid, variant_idx=store)
    return variants[idx]


def _looks_like_laundry_talk(text: str) -> bool:
    s = text or ""
    return any(m in s for m in _LAUNDRY_MARKS)


def _voice_meta_intent(t: str, n: str) -> str | None:
    if intents.is_who_am_i(t) or intents.is_who_am_i(n):
        return "who_am_i"
    if intents.is_meta_feedback(t) or intents.is_meta_feedback(n):
        return "meta_feedback"
    if intents.is_human_request(t) or intents.is_human_request(n):
        return "human"
    return None


def _push_ask(uid: str, text: str) -> bool:
    try:
        import staff_notify
        case_id = "Q" + now_tw().strftime("%H%M%S") + uuid.uuid4().hex[:6]
        result = staff_notify.push_inbox(
            "ask",
            {
                "id": case_id,
                "case_id": case_id,
                "uid": uid,
                "when": now_tw().isoformat(timespec="minutes"),
                "name": staff_notify.guest_name(uid),
                "text": text,
                "handoff": True,
            },
        )
        _accept_staff_push(result)
        # 群組沒送到時 staff_pushed 仍是假，呼叫端要保持 notify_staff，webhook 才補得了。
        return True
    except Exception:
        return False


_PAYMENT_CLAIM_MARKS = (
    "已付款",
    "付款完成",
    "付款了",
    "付好了",
    "付完了",
    "我付了",
    "我已經付",
    "我剛剛付",
    "已匯款",
    "匯款完成",
    "已轉帳",
    "轉帳完成",
    "已繳費",
    "繳費完成",
)


def _is_payment_claim(text: str) -> bool:
    """只辨認客人宣稱已付款，不把詢問付款方式誤當成已付款。"""
    raw = (text or "").strip().lower()
    if not raw:
        return False
    compact = re.sub(r"[\s，。,.、！!？?：:；;「」『』（）()]+", "", raw)
    if any(mark in compact for mark in ("怎麼付款", "如何付款", "付款方式", "付款頁", "還沒付款", "尚未付款")):
        return False
    return any(mark in compact for mark in _PAYMENT_CLAIM_MARKS)


def _push_payment_check(
    uid: str,
    text: str,
    event_id: str = "",
    photo: str = "",
    case_id: str = "",
    notify: bool = True,
) -> bool:
    """通知櫃台核對付款；這裡永遠不寫入已付款狀態。"""
    try:
        import staff_notify

        case_id = case_id or ("P" + now_tw().strftime("%H%M%S") + uuid.uuid4().hex[:6])
        payload = {
            "id": case_id,
            "case_id": case_id,
            "uid": uid,
            "when": now_tw().isoformat(timespec="minutes"),
            "name": staff_notify.guest_name(uid),
            "text": text or "客人表示已付款",
            "need": "請查商家交易紀錄，核對金額後再更新案件狀態",
        }
        if photo:
            payload["photo"] = photo
            payload["note"] = "客人補傳付款畫面，仍以商家交易紀錄為準"
        # LINE webhook 重送同一事件時，沿用 event_id 讓看板去重。
        payload["event_id"] = event_id or case_id
        result = staff_notify.push_inbox("payment_check", payload, notify=notify)
        _accept_staff_push(result)
        return bool(result.get("saved"))
    except Exception:
        return False


def _payment_claim_reply(uid: str, text: str, event_id: str = "") -> tuple[list[dict], dict]:
    case_id = "P" + now_tw().strftime("%H%M%S") + uuid.uuid4().hex[:6]
    set_sess(uid, wait="payment_check", payment_check_ts=now_tw().isoformat(), payment_case_id=case_id)
    notified = _push_payment_check(uid, text, event_id, case_id=case_id)
    return _pack(
        say(
            "收到，我先把付款訊息交給櫃台核對。",
            "付款狀態要以店裡交易紀錄為準；有付款畫面或交易末四碼，也可以一起傳來，店員會比較快對到。",
            actions=[
                {"type": "cameraRoll", "label": "傳付款畫面"},
                {"type": "message", "label": "稍後再傳", "text": "稍後再傳"},
            ],
        ),
        "payment_check",
        notified,
    )


def _payment_proof_photo(uid: str, photo: str, event_id: str = "") -> tuple[list[dict], dict]:
    sess = get_sess(uid) or {}
    case_id = str(sess.get("payment_case_id") or "")
    set_sess(uid, wait=None, payment_check_ts=now_tw().isoformat(), payment_case_id=case_id)
    # 初次宣稱已付款已通知群組；照片只合併回同一案件，避免重複群發。
    notified = _push_payment_check(
        uid,
        "客人補傳付款畫面",
        event_id,
        photo=photo,
        case_id=case_id,
        notify=False,
    )
    return _pack(
        say(
            "收到，付款畫面我一起交給櫃台核對。",
            "店員確認交易紀錄後會回覆你；在確認前先不用重複付款。",
        ),
        "payment_check",
        notified,
    )


def _fallback_copy(stage: int, laundry: bool) -> str:
    """V4／V5。stage 1、2 為客人句；>=3 轉真人。"""
    if stage >= 3:
        return "我幫您轉給店裡的人，稍等一下。"
    if laundry:
        if stage <= 1:
            return "這個我不太確定。是衣服、棉被、鞋子還是包包？"
        return "不好意思，我還是沒聽懂。您要洗的是衣服、棉被、鞋子還是包包？"
    if stage <= 1:
        return "這個我不太確定。您是要洗東西嗎？"
    return "不好意思，我還是沒聽懂。打幾個字說要洗什麼，或直接按下面的選單。"


def _do_fallback(uid: str, spoken: str) -> tuple[list[dict], bool]:
    """V4：連續掉底計數；第三次才通知。回 (msgs, notify)。"""
    n = int((get_sess(uid) or {}).get("last_fallback_n") or 0) + 1
    laundry = _looks_like_laundry_talk(spoken)
    copy = _fallback_copy(n, laundry)
    if n >= 3:
        set_sess(uid, last_fallback_n=0)
        prefix = recent_staff_ask_prefix(uid)
        last_line = (spoken or "").strip()
        _push_ask(uid, prefix + f"客人連續三句我聽不懂：{last_line}")
        return say(copy), True
    set_sess(uid, last_fallback_n=n)
    return say(copy, buttons=_FALLBACK_QR), False


def lookup_item(name: str):
    for cat, items in CATS.items():
        if name in items:
            return name, items[name], cat
    return None


def _price_of(name: str):
    hit = lookup_item(name)
    if hit:
        return hit[1]
    return _flat_catalog().get(name)


def _prefer_general(names: list[str]) -> tuple[list[str], bool]:
    """K2：一般款優先於精品。回 (按鈕品名, 是否另有精品被藏起來)。"""
    general = [n for n in names if not str(n).startswith("精品")]
    luxury = [n for n in names if str(n).startswith("精品")]
    if general:
        return general[:4], bool(luxury)
    return luxury[:4], False


def _items_with_stem(stem: str, catalog: dict) -> list[str]:
    out = []
    for name in catalog:
        if stem and stem in name:
            out.append(name)
    return out


def _flat_catalog() -> dict:
    out = {}
    for items in CATS.values():
        out.update(items)
    return out


_PHOTO_FOLLOW_INTENTS = {"clarify", "quote", "prices"}
_PHOTO_FOLLOW_SKIP = {"價目表", "價目", "價格表", "menu", "服務價目", "先看價錢", "看價目表", "先看價目"}
_PHOTO_LEAD = "我請師傅看你傳的照片，等一下回你。"
_PHOTO_DISCLAIMERS = ("先給你個大概：", "大概是這樣：")
_PHOTO_DISCLAIMER = _PHOTO_DISCLAIMERS[0]
_PHOTO_NEED_WAIT = "photo_need"
_PHOTO_NEED_QR = [
    ("局部髒污", "局部髒污"),
    ("整件都髒", "整件都髒"),
    ("有味道", "有味道"),
    ("泛黃變色", "泛黃變色"),
    ("我不確定，你們看", "我不確定，你們看"),
    ("我想問別的", "我想問別的"),
]
_PHOTO_NEED_MAP = {
    "局部髒污": "有局部髒污",
    "整件都髒": "整件都要洗",
    "有味道": "要處理味道",
    "泛黃變色": "泛黃要處理",
    "我不確定，你們看": "先讓師傅看看",
}
_PHOTO_ASK_QR = [
    ("多久可以拿", "多久可以拿"),
    ("會不會洗壞", "會不會洗壞"),
    ("怎麼收費", "怎麼收費"),
    ("找真人", "找真人"),
]
_PHOTO_NEED_MARKS = (
    "髒", "污", "味", "黃", "加強", "處理", "油", "漬", "霉", "臭",
    "局部", "整件", "發黃", "變色", "鞋帶", "口袋",
)
_PHOTO_NEED_STORE = 60
_PHOTO_NEED_SAY = 20


def _clip_chars(text: str, limit: int) -> str:
    s = (text or "").strip()
    if len(s) <= limit:
        return s
    return s[:limit] + "…"


def _with_photo_follow(msgs: list[dict], item: str, uid: str = "", intent: str = "") -> list[dict]:
    """X6：剛傳過照片再點品項，只說會看照片；不自動附參考價目卡。打品名（quote）才保留報價。"""
    lead = _pick_variant(
        uid,
        "photo_lead",
        (
            "我請師傅看你傳的照片，等一下回你。",
            "你傳的照片我拿給師傅看，等等回你。",
        ),
    )
    if intent != "quote":
        return [text_msg(lead)]
    patched = []
    for m in msgs:
        if m.get("type") == "flex":
            continue
        cloned = dict(m)
        if cloned.get("type") == "text" and "您" in (cloned.get("text") or ""):
            cloned["text"] = cloned["text"].replace("您", "你")
        patched.append(cloned)
    return [text_msg(lead)] + patched


def _note_staff_push() -> None:
    _pack._npush = getattr(_pack, "_npush", 0) + 1


def _accept_staff_push(result) -> bool:
    """只在群組通知真的送到時才標記 staff_pushed，失敗留給 webhook 補發。"""
    notified = isinstance(result, dict) and result.get("notified") is True
    if notified:
        _note_staff_push()
    return notified


def _ts_within(ts: str, minutes: int = 30) -> bool:
    if not ts:
        return False
    try:
        when = datetime.fromisoformat(ts)
    except ValueError:
        return False
    now = now_tw()
    if when.tzinfo is None and now.tzinfo is not None:
        when = when.replace(tzinfo=now.tzinfo)
    elif when.tzinfo is not None and now.tzinfo is None:
        when = when.replace(tzinfo=None)
    try:
        return (now - when) <= timedelta(minutes=minutes)
    except TypeError:
        return False


def _pack(msgs: list[dict], intent: str, notify_staff: bool = False) -> tuple[list[dict], dict]:
    uid = getattr(_pack, "uid", None)
    spoken = getattr(_pack, "text", "") or ""
    if (
        not notify_staff
        and uid
        and _has_recent_photo(uid)
        and intent in _PHOTO_FOLLOW_INTENTS
        and spoken not in _PHOTO_FOLLOW_SKIP
    ):
        item = spoken or (get_sess(uid) or {}).get("last_item") or ""
        msgs = _with_photo_follow(msgs, item or "這件", uid, intent=intent)
        set_sess(uid, photo_ts="", wait=None)
    if getattr(_pack, "photo_funnel", False):
        msgs = _with_photo_funnel(msgs, uid, intent)
    if uid and intent != "fallback":
        sess_now = get_sess(uid) or {}
        if sess_now.get("last_fallback_n"):
            set_sess(uid, last_fallback_n=0)
    staff_pushed = bool(getattr(_pack, "_npush", 0))
    return msgs, {
        "intent": intent,
        "notify_staff": bool(notify_staff),
        "staff_pushed": staff_pushed,
    }


def auto_query_available() -> bool:
    """洗衣系統有正本才走自動查詢；source==none 一律交辦櫃台。"""
    try:
        import laundry_lookup
        _cust, _pieces, source = laundry_lookup.inventory()
        return (source or "none") != "none"
    except Exception:
        return False


def normalize_mobile(text: str) -> str | None:
    """允許中間有 - 或空白；正規化後必須十碼且 09 開頭。"""
    digits = "".join(ch for ch in (text or "") if ch.isdigit())
    if len(digits) == 10 and digits.startswith("09"):
        return digits
    return None


def _has_recent_photo(uid: str) -> bool:
    ts = (get_sess(uid) or {}).get("photo_ts") or ""
    return _ts_within(ts, 30)


def _has_recent_phone(uid: str) -> bool:
    sess = get_sess(uid) or {}
    if not (sess.get("query_phone") or ""):
        return False
    return _ts_within(sess.get("phone_ts") or "", 30)


def recent_staff_ask_prefix(uid: str) -> str:
    """D4：fallback ask 前綴。電話只給遮罩，不印完整號碼。"""
    bits = []
    if _has_recent_photo(uid):
        bits.append("（有照片）")
    if _has_recent_phone(uid):
        bits.append("（電話 09xx…）")
    return "".join(bits)


def _is_photo_need_free(t: str, n: str) -> bool:
    """wait=photo_need 時，打字描述（非品項／選單）算需求。"""
    if not n:
        return False
    if n in CATS or n in _flat_catalog() or n in _PRICE_MENU:
        return False
    if n in _CATEGORY_WORDS:
        return False
    if n in _FAQ_ANSWERS or n in _FAQ_ALIASES:
        return False
    if _looks_like_laundry_talk(t) or any(k in n for k in _PHOTO_NEED_MARKS):
        return True
    return False


def _photo_need_spoken(raw: str, n: str) -> str:
    if n in _PHOTO_NEED_MAP:
        return _PHOTO_NEED_MAP[n]
    return _clip_chars(raw, _PHOTO_NEED_SAY)


def _push_photo_need(uid: str, need: str) -> bool:
    try:
        import staff_notify
        sess = get_sess(uid) or {}
        result = staff_notify.push_inbox(
            "photo_need",
            {
                "id": sess.get("estimate_case") or "P" + now_tw().strftime("%H%M%S"),
                "case_id": sess.get("estimate_case"),
                "photos": sess.get("estimate_photos") or [],
                "uid": uid,
                "when": now_tw().isoformat(timespec="minutes"),
                "name": staff_notify.guest_name(uid),
                "need": need,
                "photo": sess.get("photo_path") or "",
                "text": need,
            },
        )
        _accept_staff_push(result)
        # 群組沒送到時 staff_pushed 仍是假，呼叫端要保持 notify_staff，webhook 才補得了。
        return True
    except Exception:
        return False


def _ack_photo_need_msgs(uid: str, raw: str, n: str) -> list[dict]:
    need = _clip_chars(raw, _PHOTO_NEED_STORE)
    spoken = _photo_need_spoken(raw, n)
    set_sess(uid, photo_need=need, wait=None, photo_ts="")
    _push_photo_need(uid, need)
    return say(f"好，{spoken}，和照片放在同一筆，讓店員接著評估。",
               actions=[{"type": "postback", "label": "先估這批", "data": "action=estimate_photos", "displayText": "幫我估這批照片"}])


_PICKUP_ITEM_QR = [
    ("衣服", "衣服"),
    ("棉被", "棉被"),
    ("鞋子", "鞋子"),
    ("包包", "包包"),
    ("到時再看", "到時再看"),
]
_PICKUP_ITEM_AFTER = {"衣服", "棉被", "鞋子", "包包", "到時再看", "不確定"}
_QUERY_ITEM_QR = [
    ("衣服", "衣服"),
    ("鞋子", "鞋子"),
    ("包包", "包包"),
    ("棉被", "棉被"),
    ("不確定", "不確定"),
]
_PICKUP_ITEMS = {"衣服", "棉被", "鞋子", "包包", "到時再看", "不確定"}
_QUERY_ITEMS = {"衣服", "鞋子", "包包", "棉被", "不確定"}
_FAQ_QR = [
    ("會不會洗壞", "會不會洗壞"),
    ("會不會掉色", "會不會掉色"),
    ("要洗多久", "要洗多久"),
    ("名牌敢洗嗎", "名牌敢洗嗎"),
    ("怎麼收費", "怎麼收費"),
]
_FAQ_NEXT = [
    ("拍照問價", "拍照問價"),
    ("價目表", "價目表"),
    ("找真人", "找真人"),
]
_FAQ_ALIASES = {
    "多久可以拿": "要洗多久",
}
_FAQ_ANSWERS = {
    "會不會洗壞": (
        "我們收之前一定看過件，看了覺得有風險會先跟你說，不會硬收。",
        "不確定的話，拍張照給我看最快。",
    ),
    "會不會掉色": (
        "要看布料、染色和洗標，不能只看深淺色就保證。",
        "方便拍整件和洗標給我們嗎？請店員看過，再跟你說處理方式。",
    ),
    "要洗多久": (
        "一般件三到五天，名牌、皮革會再久一點。",
        "有趕著用的日子跟我說，我幫你問櫃台。",
    ),
    "名牌敢洗嗎": (
        "名牌、皮革我們有收，但一定看過再收，不會先跟你保證。",
        "拍張照給我，我請師傅先看。",
    ),
    "怎麼收費": (
        "價目表上是水洗價，乾洗跟柔洗會另計，實際以到店看件為準。",
        "要看價目表還是直接拍給我？",
    ),
}


def _start_photo_question(uid: str) -> list[dict]:
    """把「照片可以估嗎」和「拍照問價」導到同一條拍照入口。"""
    set_sess(uid, wait="photo", photo_wait_ts=now_tw().isoformat(), photo_nudged=False)
    _pack.photo_funnel = False
    return photo_quote_reply(uid)


def _unsupported_shop_question(uid: str, text: str) -> tuple[list[dict], str, bool]:
    """店裡是否販售／提供的未知項目，誠實轉店員，不把關鍵字誤當衣服。"""
    notified = _push_ask(uid, f"客人詢問目前未列入服務的項目：{_clip_chars(text, 120)}")
    return (
        say(
            "這項目前不在 LINE 的服務／價目裡，我不先跟你亂說有。",
            "我先轉給店裡確認；如果你是要送洗，也可以直接拍物件給我看。",
            buttons=[("拍照問價", "拍照問價"), ("找真人", "找真人")],
        ),
        "shop_question",
        notified,
    )


def _complaint_reply(uid: str, text: str) -> tuple[list[dict], str, bool]:
    """客訴先接住並交給店員，避免機器人自行判責或承諾賠償。"""
    notified = _push_ask(uid, f"客人需要處理客訴：{_clip_chars(text, 160)}")
    return (
        say(
            "先別急，這種狀況我不在這裡亂判。",
            f"我先交給店裡處理，請留手機或洗衣單號；急的話直接打 {PHONE} 會比較快。",
            buttons=[("找真人", "找真人"), ("打電話", "電話")],
        ),
        "complaint",
        notified,
    )


def _photo_care_reply(uid: str) -> tuple[list[dict], str, bool]:
    """污漬、縮水等需要看件的問題，要求有用的照片資訊。"""
    set_sess(uid, wait="photo", photo_wait_ts=now_tw().isoformat(), photo_nudged=False)
    _pack.photo_funnel = False
    return (
        say(
            "這個要看材質和實際狀況，光用文字我不敢跟你保證。",
            "拍整件一張，問題的地方再近拍一張；有洗標也一起拍，我先請店裡看。",
            actions=[
                {"type": "camera", "label": "📷 拍照"},
                {"type": "cameraRoll", "label": "🖼 從相簿選"},
                {"type": "message", "label": "先找真人", "text": "找真人"},
            ],
        ),
        "photo_quote",
        False,
    )


def _natural_customer_question(uid: str, text: str, normalized: str) -> tuple[list[dict], str, bool] | None:
    """接住客人常用的完整問句，回一個答案加一個下一步。

    這裡故意用可讀、可測的規則，不讓模型自行編造店家價格、時程、付款結果。
    品名與批次估價仍交給 quote_flow；這層只處理客服問法與轉接。
    """
    n = normalized

    # 先處理容易被泛稱關鍵字誤判的商品／服務問題。
    if any(k in n for k in ("洗衣精", "洗衣粉", "洗衣袋", "自助洗", "烘衣機", "烘衣服務", "烘乾服務", "修改衣服")):
        return _unsupported_shop_question(uid, text)

    # 客人說明洗衣流程時，先講清楚送洗不用預約；外收送才需要安排時間。
    if any(k in n for k in ("送洗要預約嗎", "洗衣要預約嗎", "需要預約嗎", "一定要預約嗎", "要先預約嗎")):
        return (
            say(
                "一般送洗不用預約，營業時間直接帶來就可以。",
                "如果是到府收送，才需要先選時間、留地址和手機。",
                buttons=[("安排收送", "外收送預約"), ("看店址", "位置"), ("打電話", "電話")],
            ),
            "faq",
            False,
        )

    # 查件問法要先進查件流程，不能被「我的衣服」當成品名報價。
    if _is_query_text(n):
        msgs, notified = start_query(uid)
        return msgs, "query", notified

    # 收送時間問的是營業時間；其他收送問法才進外收送表單。
    if _is_pickup_hours_text(n):
        return _hours_with_pickup_note(n), "hours_day", False
    if any(k in n for k in ("有外送嗎", "有到府嗎", "可以到府嗎", "可以幫我收嗎", "到府怎麼約", "怎麼預約收送")):
        return start_pickup(uid), "pickup", False
    if any(k in n for k in ("收送免費嗎", "到府收送多少", "收送要錢嗎", "有收送費嗎", "哪一區可以收")):
        return (
            say(
                "收送要看地址和安排的時段，我不先亂報費用。",
                "你先按外收送，把時間、位置和手機留給我，店員確認後會跟你說。",
                buttons=[("開始安排", "外收送預約"), ("找真人", "找真人")],
            ),
            "pickup_info",
            False,
        )

    # 營業、地址、電話用設定檔的真實資料回覆。
    if _is_hours_query(n) or any(k in n for k in ("幾點打烊", "幾點關門", "哪天休息", "哪一天公休", "禮拜天開嗎")):
        return hours_reply(n), "hours_day", False
    if any(k in n for k in ("在哪裡", "怎麼走", "附近怎麼去", "店在哪", "你們店在哪", "有沒有停車")):
        body = f"地址：{ADDR}\n我們在{LANDMARK}。"
        if MAP:
            body += f"\n導航：{MAP}"
        if "停車" in n:
            body += "\n停車請以現場合法車位和標誌為準。"
        return (
            say(body, f"{HOURS}\n送洗不用預約，營業時間直接帶來就好。", actions=([{"type": "uri", "label": "開啟地圖", "uri": MAP}] if MAP else []) + [{"type": "uri", "label": "打給店裡", "uri": "tel:" + PHONE}]),
            "location",
            False,
        )
    if any(k in n for k in ("電話幾號", "怎麼聯絡", "聯絡電話", "店家電話")):
        return say(f"店裡 {PHONE}。", "如果文字說不清楚，直接打過來會比較快。", buttons=next_qr_items()), "phone", False

    # 拍照問價的自然說法；一律先要求照片，不假裝已經看到了。
    if any(k in n for k in ("照片估價", "照片報價", "照片可以估", "看照片報價", "拍照估價", "拍照報價", "拍了可以估嗎", "傳照片可以嗎")):
        return _start_photo_question(uid), "photo_quote", False

    if any(k in n for k in ("送洗前要注意", "送洗前注意什麼", "送洗要注意什麼", "送洗前要準備")):
        return pre_wash_notes(), "pre_wash", False

    if ("名牌" in n or "精品" in n or "皮革" in n) and any(k in n for k in ("敢洗", "可以洗", "能洗", "能不能洗")):
        return (
            say(
                "名牌、皮革我們有收，但一定看過再收，不會先跟你保證一定沒問題。",
                "拍整件和洗標給我，或帶到店裡讓店員看過再決定。",
                buttons=[("拍照問價", "拍照問價"), ("看店址", "位置"), ("找真人", "找真人")],
            ),
            "concern",
            False,
        )

    # 有明確品項時不搶 quote_flow；沒有品項的費用問題才先給選擇。
    if any(k in n for k in ("怎麼算錢", "費用怎麼算", "一件多少", "大概多少", "收費方式", "價格怎麼算")):
        if not any(k in n for k in ("衣", "鞋", "包", "被", "褲", "裙", "外套", "洋裝")):
            return (
                say(
                    "可以先幫你抓參考價，但要先知道是哪一類。",
                    "你可以打品名和數量，或直接拍照；實際還是以現場看件為準。",
                    buttons=_CAT_QR + [("拍照問價", "拍照問價")],
                ),
                "ask_price",
                False,
            )

    # 工作時間與材質風險：回答能確定的範圍，下一步要求照片或店員判斷。
    if any(k in n for k in ("通常幾天", "幾天拿得到", "多久拿得到", "何時可以取", "什麼時候可以拿")):
        return faq_answer("要洗多久"), "faq", False
    if any(k in n for k in ("會縮水嗎", "會變形嗎", "會起毛球嗎", "污漬洗得掉嗎", "油漬洗得掉嗎", "咖啡漬", "血漬", "味道洗得掉嗎", "汗味")):
        return _photo_care_reply(uid)
    if any(k in n for k in ("不確定能不能洗", "不知道能不能洗", "洗標看不懂", "看不懂洗標")):
        return _photo_care_reply(uid)

    # 洗不乾淨、少件、拿錯、損傷屬於客訴，不能用通用估價話術帶過。
    if any(k in n for k in ("洗不乾淨", "沒洗乾淨", "洗壞了", "破掉", "少一件", "少件", "拿錯", "不見了", "客訴", "要賠")):
        return _complaint_reply(uid, text)

    # 付款方式不能亂猜；已付款宣稱已在前面進入核對案件。
    if any(k in n for k in ("付款方式", "怎麼付款", "如何付款", "可以刷卡嗎", "可以現金嗎", "可以轉帳嗎", "要發票嗎", "收據")):
        return (
            say(
                "付款方式我先跟你說清楚：LINE Pay 要等店員確認金額後，再由你自己輸入付款。",
                "現金、刷卡或收據需求，請讓店員依現場告訴你；預估價先不用付。",
                buttons=[("LINE Pay", "LINE Pay"), ("找真人", "找真人"), ("打電話", "電話")],
            ),
            "pay",
            False,
        )

    # 會員、優惠、集點尚未啟用時，不做不存在的承諾，交給店裡確認。
    if any(k in n for k in ("有會員嗎", "會員優惠", "有集點嗎", "有優惠嗎", "有折扣嗎", "新客優惠")):
        return _unsupported_shop_question(uid, text)

    return None


def _menu_price(name: str, price) -> str:
    label = PRICE_LABELS.get(name) or ""
    shown = str(price)
    if label:
        shown = f"{shown}（{label}）"
    return shown


def _labeled_price(name: str) -> str:
    return _menu_price(name, _price_of(name))


def _standard_price_copy() -> bool:
    return PRICE_BASIS == "default_mode"


def row(label: str, value: str) -> dict:
    return {
        "type": "box",
        "layout": "baseline",
        "contents": [
            {"type": "text", "text": label, "size": "sm", "color": "#6B6158", "flex": 4, "wrap": True},
            {"type": "text", "text": value, "size": "sm", "color": INK, "align": "end", "flex": 2, "weight": "bold"},
        ],
    }


def cat_bubble(cat: str) -> dict:
    featured = _featured_pairs(cat) or list(CATS.get(cat, {}).items())[:4]
    return {
        "type": "bubble",
        "size": "kilo",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": CREAM,
            "paddingAll": "20px",
            "contents": [
                {"type": "text", "text": cat, "color": INK, "weight": "bold", "size": "xl"},
                {"type": "text", "text": "店裡標準價 · 看過再定" if _standard_price_copy() else "水洗參考 · 看過再定", "color": GOLD, "size": "xs", "margin": "md"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [row(n, _menu_price(n, p)) for n, p in featured[:4]],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "style": "primary",
                    "color": NAVY,
                    "height": "sm",
                    "action": {"type": "message", "label": "我想問這類", "text": cat},
                },
                {
                    "type": "button",
                    "style": "secondary",
                    "height": "sm",
                    "color": CREAM,
                    "action": {"type": "message", "label": "先約時間", "text": f"預約{cat}"},
                },
            ],
        },
    }


def price_carousel() -> dict:
    cats = [c for c in ["寢具", "鞋子", "包包", "衣物"] if c in CATS]
    return {
        "type": "flex",
        "altText": "私享家服務價目",
        "contents": {"type": "carousel", "contents": [cat_bubble(c) for c in cats]},
        "quickReply": qr(next_qr_items()),
    }


def cat_list_flex(cat: str) -> dict:
    items = list(CATS.get(cat, {}).items())[:10]
    return {
        "type": "flex",
        "altText": f"{cat}價目",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": CREAM,
                "paddingAll": "20px",
                "contents": [
                    {"type": "text", "text": cat, "color": INK, "weight": "bold", "size": "xl"},
                    {"type": "text", "text": "先看這幾項，沒列到的跟我說。", "color": GOLD, "size": "xs", "margin": "md", "wrap": True},
                ],
            },
            "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": [row(n, _menu_price(n, p)) for n, p in items]},
            "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": NAVY,
                        "action": {"type": "message", "label": "約個到店時間", "text": "預約到店"},
                    }
                ],
            },
        },
        "quickReply": qr(next_qr_items()),
    }


def booking_flex(item: str | None = None, pickup: bool = False, address: str = "") -> dict:
    start = (now_tw() + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    end = now_tw() + timedelta(days=21)
    title = "外收時間" if pickup else "到店時間"
    hint = address or item or ("台中市我們可以去收。" if pickup else "先留時間也行，到了再說要洗什麼。")
    action = "pickup" if pickup else "reserve"
    return {
        "type": "flex",
        "altText": title,
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": CREAM,
                "paddingAll": "20px",
                "contents": [
                    {"type": "text", "text": title, "color": INK, "weight": "bold", "size": "xl"},
                    {
                        "type": "text",
                        "text": hint,
                        "color": GOLD,
                        "size": "sm",
                        "margin": "md",
                        "wrap": True,
                    },
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {"type": "text", "text": HOURS, "size": "sm", "wrap": True, "color": "#6B6158"},
                    {"type": "text", "text": f"{ADDR}（{LANDMARK}）", "size": "sm", "wrap": True, "margin": "md", "color": "#6B6158"},
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": NAVY,
                        "action": {
                            "type": "datetimepicker",
                            "label": "選時間",
                            "data": f"action={action}&item={item or ''}",
                            "mode": "datetime",
                            "initial": dt_fmt(start),
                            "min": dt_fmt(now_tw()),
                            "max": dt_fmt(end),
                        },
                    }
                ],
            },
        },
    }


def _booking_ok_footer(pickup: bool) -> list[dict]:
    """R5：未設定 LINE Pay 時頁腳改看位置／打電話，不改版面結構。"""
    if _pay_ready():
        return [
            {
                "type": "button",
                "style": "primary",
                "color": GREEN,
                "action": {"type": "message", "label": "到時用 LINE Pay", "text": "LINE Pay"},
            },
            {
                "type": "button",
                "style": "secondary",
                "action": {
                    "type": "message" if pickup else "uri",
                    "label": "改時間" if pickup else "我看一下路",
                    **({"text": "外收送預約"} if pickup else {"uri": MAP or "https://maps.google.com"}),
                },
            },
        ]
    return [
        {
            "type": "button",
            "style": "primary",
            "color": GREEN,
            "action": {"type": "message", "label": "看位置", "text": "位置"},
        },
        {
            "type": "button",
            "style": "secondary",
            "action": {"type": "message", "label": "打電話", "text": "電話"},
        },
    ]


def parse_when(when: str) -> datetime | None:
    raw = (when or "").strip()
    if not raw:
        return None
    for fmt, n in (("%Y-%m-%dT%H:%M:%S", 19), ("%Y-%m-%dT%H:%M", 16), ("%Y-%m-%d", 10)):
        if len(raw) < n:
            continue
        try:
            dt = datetime.strptime(raw[:n], fmt)
            if TZ:
                dt = dt.replace(tzinfo=TZ)
            return dt
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(raw)
        if TZ and dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ)
        return dt
    except ValueError:
        return None


def booking_guard(dt: datetime) -> str | None:
    """R4：週日、營業時段外、過去時間不收。恰好 20:00 算已打烊。"""
    now = now_tw()
    if dt.tzinfo is None and now.tzinfo is not None:
        dt = dt.replace(tzinfo=now.tzinfo)
    elif dt.tzinfo is not None and now.tzinfo is None:
        dt = dt.replace(tzinfo=None)
    if dt < now:
        return "已經過了"
    wd = dt.weekday()
    hm = dt.hour * 60 + dt.minute
    if wd == 6:
        return "週日公休"
    if wd == 5:
        if hm < 12 * 60:
            return "週六中午 12:00 才開門"
        if hm >= 18 * 60:
            return "週六 18:00 已打烊"
        return None
    if hm < 10 * 60:
        return "平日 10:00 才開門"
    if hm >= 20 * 60:
        return "平日 20:00 已打烊"
    return None


def make_booking_id(uid: str, when: str, kind: str) -> str:
    """R4：P/W + MMDD + HHMM + uid 末四碼；同分鐘加 -2、-3。"""
    prefix = "W" if kind == "pickup" else "P"
    dt = parse_when(when) or now_tw()
    stamp = dt.strftime("%m%d%H%M")
    tail = (uid or "0000")[-4:]
    base = prefix + stamp + tail
    existing = set()
    if BOOK.exists():
        for line in BOOK.read_text(encoding="utf-8").splitlines():
            try:
                existing.add(json.loads(line).get("id") or "")
            except json.JSONDecodeError:
                continue
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def _booking_end(row: dict, when_dt: datetime) -> datetime:
    slot = row.get("slot") or ""
    m = re.search(r"（(\d{2}:\d{2})–(\d{2}:\d{2})）", slot)
    if m:
        hh, mm = m.group(2).split(":")
        try:
            return when_dt.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        except ValueError:
            return when_dt
    return when_dt


def last_active_booking(uid: str) -> dict | None:
    """略過已取消的列，以及 when 已過的列。R2 cancel / my_booking / K9"""
    if not BOOK.exists():
        return None
    rows = []
    cancelled = set()
    for line in BOOK.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("uid") != uid:
            continue
        if row.get("kind") == "cancel":
            cancelled.add(row.get("id"))
            continue
        rows.append(row)
    now = now_tw()
    for row in reversed(rows):
        if row.get("id") in cancelled:
            continue
        when_dt = parse_when(row.get("when") or "")
        if when_dt is not None:
            if when_dt.tzinfo is None and now.tzinfo is not None:
                when_dt = when_dt.replace(tzinfo=now.tzinfo)
            elif when_dt.tzinfo is not None and now.tzinfo is None:
                when_dt = when_dt.replace(tzinfo=None)
            end_dt = _booking_end(row, when_dt)
            if end_dt < now:
                continue
        return row
    return None


def append_book(rec: dict) -> None:
    BOOK.parent.mkdir(parents=True, exist_ok=True)
    with BOOK.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def booking_ok(bid: str, when: str, item: str, pickup: bool = False, address: str = "") -> dict:
    note = "到時我們去收，不用先付。" if pickup else "到店報這個編號就好，不用先付。"
    body = [row("編號", bid), row("時間", when)]
    if pickup:
        body.append(row("地址", address or "待補"))
    body.append(row("先記", item or ("到時再看" if pickup else "到店再說")))
    return {
        "type": "flex",
        "altText": "時間記下了",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": CREAM,
                "paddingAll": "20px",
                "contents": [
                    {"type": "text", "text": "好，記下了", "color": INK, "weight": "bold", "size": "xl"},
                    {"type": "text", "text": note, "color": GOLD, "size": "sm", "margin": "md", "wrap": True},
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": body,
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "contents": _booking_ok_footer(pickup),
            },
        },
        "quickReply": qr(
            [("改時間", "外收送預約" if pickup else "預約到店"), ("我還想問", "我想洗")]
        ),
    }


class PickupPhoneRequired(ValueError):
    """Q2：外收預約沒有電話，禁止存檔。"""


def save_booking(uid: str, when: str, item: str, kind: str = "book", extra: dict | None = None) -> str:
    extra = extra or {}
    if kind == "pickup" and not str(extra.get("phone") or "").strip():
        raise PickupPhoneRequired("pickup_phone_required")
    bid = make_booking_id(uid, when, kind)
    BOOK.parent.mkdir(parents=True, exist_ok=True)
    name = "客人"
    try:
        import staff_notify
        name = staff_notify.guest_name(uid)
    except Exception:
        name = "客人"
    rec = {
        "id": bid,
        "uid": uid,
        "when": when,
        "item": item,
        "name": name,
        "kind": kind,
        "ts": now_tw().isoformat(),
    }
    rec.update(extra)
    estimate_link = get_sess(uid).get("estimate_for_pickup") or {}
    draft = get_sess(uid).get("estimate_draft")
    if kind == "pickup" and draft and estimate_link.get("revision") == draft.get("revision") and estimate_link.get("case") == draft.get("case_id"):
        import estimate
        rec["estimate_summary"] = estimate.render(draft)
        rec["estimate_case"] = estimate_link.get("case")
        rec["estimate_revision"] = draft["revision"]
    with BOOK.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    try:
        import staff_notify
        result = staff_notify.push_inbox(kind, rec)
        _accept_staff_push(result)
    except Exception:
        pass
    return bid


_WD_SLOT = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]


def _profile_file() -> Path:
    official_prof = REPO / "data" / "line-customer-profile.json"
    official_book = REPO / "data" / "line-bookings.jsonl"
    try:
        if Path(cprof.PROFILE_PATH).resolve() != official_prof.resolve():
            return cprof.PROFILE_PATH
    except Exception:
        pass
    try:
        if Path(BOOK).resolve() != official_book.resolve():
            return Path(BOOK).parent / "line-customer-profile.json"
    except Exception:
        pass
    return cprof.PROFILE_PATH


def _profile_get(uid: str) -> dict:
    try:
        return cprof.get(uid, path=_profile_file()) or {}
    except Exception:
        return {}


def _profile_save(uid: str, *, phone: str = "", address: str = "") -> None:
    try:
        cprof.upsert(uid, phone=phone or None, address=address or None, path=_profile_file())
    except Exception:
        pass


def _mask_phone(phone: str) -> str:
    try:
        return cprof.mask_phone(phone)
    except Exception:
        digits = "".join(ch for ch in (phone or "") if ch.isdigit())
        if len(digits) >= 3:
            return f"09xx-xxx-{digits[-3:]}"
        return "09xx-xxx-xxx"


def pickup_can_shortcut(uid: str) -> bool:
    """P2：同時有地址與電話才走老客人捷徑。突變自證會關掉這層。"""
    row = _profile_get(uid)
    return bool((row.get("phone") or "").strip() and (row.get("address") or "").strip())


def slot_still_open(now: datetime, start: datetime, end: datetime) -> bool:
    """P4：已過的時段不給。週六下午 17:00 之後跳下一個營業日。"""
    cutoff = end
    if start.weekday() == 5 and start.hour == 14:
        cutoff = start.replace(hour=17, minute=0, second=0, microsecond=0)
    return now < cutoff


def _day_word(now: datetime, day: datetime) -> str:
    delta = (day.date() - now.date()).days
    if delta == 0:
        return "今天"
    if delta == 1:
        return "明天"
    if delta == 2:
        return "後天"
    return _WD_SLOT[day.weekday()]


def _slot_bounds(day: datetime, which: str):
    wd = day.weekday()
    if wd == 6:
        return None
    if which == "am":
        start_h, end_h = (12, 14) if wd == 5 else (10, 12)
    else:
        start_h, end_h = 14, 18
    start = day.replace(hour=start_h, minute=0, second=0, microsecond=0)
    end = day.replace(hour=end_h, minute=0, second=0, microsecond=0)
    return start, end


def iter_pickup_slots(now: datetime | None = None, limit: int = 4) -> list[dict]:
    now = now or now_tw()
    out: list[dict] = []
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for _ in range(16):
        if day.weekday() != 6:
            for which in ("am", "pm"):
                bounds = _slot_bounds(day, which)
                if not bounds:
                    continue
                start, end = bounds
                if not slot_still_open(now, start, end):
                    continue
                word = _day_word(now, day)
                half = "上午" if which == "am" else "下午"
                label = word + half
                span = f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')}"
                out.append(
                    {
                        "label": label,
                        "when": dt_fmt(start),
                        "slot": f"{label}（{span}）",
                        "start": start,
                        "end": end,
                    }
                )
                if len(out) >= limit:
                    return out
        day = day + timedelta(days=1)
    return out


def _slot_meta_for_dt(dt: datetime) -> tuple[str, str]:
    """回 (when 存檔用起點, 人看的 slot 字)。落在固定區間就對齊區間，否則用實際時間。"""
    now = now_tw()
    day = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    wd = dt.weekday()
    hm = dt.hour * 60 + dt.minute
    which = None
    if wd == 5:
        if 12 * 60 <= hm < 14 * 60:
            which = "am"
        elif 14 * 60 <= hm < 18 * 60:
            which = "pm"
    elif wd != 6:
        if 10 * 60 <= hm < 12 * 60:
            which = "am"
        elif 14 * 60 <= hm < 18 * 60:
            which = "pm"
    if which:
        bounds = _slot_bounds(day, which)
        if bounds:
            start, end = bounds
            word = _day_word(now, day)
            half = "上午" if which == "am" else "下午"
            label = word + half
            span = f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')}"
            return dt_fmt(start), f"{label}（{span}）"
    word = _day_word(now, day)
    stamp = dt.strftime("%H:%M")
    return dt_fmt(dt), f"{word} {stamp}"


def _datetimepicker_other() -> dict:
    start = (now_tw() + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    end = now_tw() + timedelta(days=21)
    return {
        "type": "datetimepicker",
        "label": "其他時間",
        "data": "action=pickup_when",
        "mode": "datetime",
        "initial": dt_fmt(start),
        "min": dt_fmt(now_tw()),
        "max": dt_fmt(end),
    }


def _pickup_when_actions(uid: str = "") -> list[dict]:
    acts = []
    for opt in iter_pickup_slots():
        acts.append({"type": "message", "label": opt["label"][:20], "text": opt["label"]})
    acts.append(_datetimepicker_other())
    if uid and (get_sess(uid) or {}).get("pickup_returning"):
        acts.append({"type": "message", "label": "改地址或電話", "text": "改地址或電話"})
    return acts


def start_pickup(uid: str, force_new: bool = False) -> list[dict]:
    if not force_new and pickup_can_shortcut(uid):
        row = _profile_get(uid)
        addr = (row.get("address") or "").strip()
        phone = (row.get("phone") or "").strip()
        set_sess(
            uid,
            wait="pickup_when",
            pickup_item="",
            pickup_when="",
            pickup_slot="",
            pickup_addr=addr,
            pickup_phone=phone,
            pickup_returning=True,
            pickup_id="",
            pickup_form_id=os.urandom(8).hex(),
        )
        return say(
            _pick_variant(
                uid,
                "pickup_return",
                (
                    f"還是{addr}那邊嗎？一樣的話直接選時間。",
                    f"歡迎回來。還是{addr}嗎？一樣就選個時間。",
                ),
            ),
            actions=_pickup_when_actions(uid),
        )
    set_sess(
        uid,
        wait="pickup_when",
        pickup_item="",
        pickup_when="",
        pickup_slot="",
        pickup_addr="",
        pickup_phone="",
        pickup_returning=False,
        pickup_id="",
        pickup_form_id=os.urandom(8).hex(),
    )
    return say(
        _pick_variant(
            uid,
            "pickup_new",
            (
                "好啊，台中市區都免費去收。哪天方便？",
                "可以，台中市區免費收。什麼時候方便？",
            ),
        ),
        actions=_pickup_when_actions(uid),
    )


def _mid_open_slot(day: datetime) -> datetime:
    return day.replace(hour=15, minute=0, second=0, microsecond=0)


def _location_actions() -> list[dict]:
    return [
        {"type": "location", "label": "📍 傳送目前位置"},
        {"type": "message", "label": "我用打字的", "text": "我用打字的"},
    ]


def _confirm_address_label(address: str) -> str:
    s = (address or "").strip()
    if not s:
        return "（待補，師傅會電話確認）"
    if len(s) > 30:
        return s[:30] + "…"
    return s


def _kv_row(label: str, value: str) -> dict:
    return {
        "type": "box",
        "layout": "baseline",
        "contents": [
            {"type": "text", "text": label, "size": "sm", "color": "#6B6158", "flex": 2, "wrap": True},
            {
                "type": "text",
                "text": value or "—",
                "size": "sm",
                "color": INK,
                "align": "end",
                "flex": 5,
                "weight": "bold",
                "wrap": True,
            },
        ],
    }


def pickup_confirm_flex(item: str, when: str, address: str, phone: str = "", slot: str = "", confirm_key: str = "") -> dict:
    slot_show = slot or (when or "").replace("T", " ") or "待選"
    note = "這是希望收件的時段；送出後由店員確認安排。"
    return {
        "type": "flex",
        "altText": "確認外收資料",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": CREAM,
                "paddingAll": "20px",
                "contents": [
                    {"type": "text", "text": "請確認外收", "color": INK, "weight": "bold", "size": "xl"},
                    {"type": "text", "text": note, "color": GOLD, "size": "sm", "margin": "md", "wrap": True},
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    _kv_row("時段", slot_show),
                    _kv_row("地址", _confirm_address_label(address)),
                    _kv_row("電話", phone or "待補"),
                    _kv_row("品項", item or "待補"),
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": NAVY,
                        "action": {
                            "type": "postback",
                            "label": "確認送出",
                            "data": "action=pickup_confirm" + ("&key=" + confirm_key if confirm_key else ""),
                            "displayText": "確認送出這份收送資料",
                        },
                    },
                    {
                        "type": "button",
                        "style": "secondary",
                        "action": {"type": "message", "label": "修改資料", "text": "修改收送資料"},
                    },
                ],
            },
        },
    }


def _match_pickup_slot(n: str) -> dict | None:
    raw = (n or "").strip()
    for opt in iter_pickup_slots(limit=8):
        if raw == opt["label"] or raw == opt["slot"]:
            return opt
    day_off = {"今天": 0, "明天": 1, "後天": 2}
    if raw in day_off:
        day = (now_tw() + timedelta(days=day_off[raw])).date()
        for opt in iter_pickup_slots(limit=12):
            if opt["start"].date() == day:
                return opt
    return None


def _looks_like_pickup_address(text: str) -> bool:
    """Q1：含路／街／巷／弄／號／段／區／村／里其中一字，且長度 ≥6。"""
    s = (text or "").strip()
    if len(s) < 6:
        return False
    return any(ch in _ADDR_MARKS for ch in s)


def _looks_like_pickup_phone(text: str) -> str | None:
    """Q1：去掉 - 與空白後為 09 開頭十碼。"""
    s = (text or "").replace("-", "").replace(" ", "").replace("\u3000", "")
    if len(s) == 10 and s.startswith("09") and s.isdigit():
        return s
    return None


def _pickup_slot_spoken(dt: datetime) -> str:
    wd = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"][dt.weekday()]
    return f"{dt.month}/{dt.day}（{wd}）{dt.strftime('%H:%M')} 前後"


_HOUR_SPEECH = {
    0: "十二",
    1: "一",
    2: "兩",
    3: "三",
    4: "四",
    5: "五",
    6: "六",
    7: "七",
    8: "八",
    9: "九",
    10: "十",
    11: "十一",
    12: "十二",
    13: "一",
    14: "兩",
    15: "三",
    16: "四",
    17: "五",
    18: "六",
    19: "七",
    20: "八",
    21: "九",
    22: "十",
    23: "十一",
}
_SLOT_SPAN_RE = re.compile(
    r"^(?P<pre>.*?)(?P<half>上午|下午)[（(](?P<h1>\d{1,2}):(?P<m1>\d{2})[–\-](?P<h2>\d{1,2}):(?P<m2>\d{2})[）)]$"
)
_SLOT_PICK_RE = re.compile(
    r"^(?P<date>\d{1,2}/\d{1,2})[（(](?P<wd>週.)[）)]\s*(?P<h>\d{1,2}):(?P<m>\d{2}) 前後$"
)


def _clock_speech(hour: int, minute: int = 0) -> str:
    stem = _HOUR_SPEECH.get(int(hour), str(int(hour)))
    mm = int(minute)
    if mm == 30:
        return stem + "點半"
    if mm:
        return stem + "點" + str(mm) + "分"
    return stem + "點"


def slot_speech(slot: str) -> str:
    """T2：對話用人話時段；確認卡仍用括號版。"""
    s = (slot or "").strip()
    if not s:
        return s
    m = _SLOT_PICK_RE.match(s)
    if m:
        return (
            f"{m.group('date')} {m.group('wd')}"
            f"{_clock_speech(int(m.group('h')), int(m.group('m')))}左右"
        )
    m = _SLOT_SPAN_RE.match(s)
    if m:
        h1, m1 = int(m.group("h1")), int(m.group("m1"))
        h2, m2 = int(m.group("h2")), int(m.group("m2"))
        half = m.group("half")
        pre = m.group("pre")
        if h1 == 12 and h2 == 14:
            tod = "中午"
        elif half == "上午":
            tod = "早上"
        else:
            tod = "下午"
        return f"{pre}{tod}{_clock_speech(h1, m1)}到{_clock_speech(h2, m2)}"
    return s


def _ask_pickup_item(uid: str) -> list[dict]:
    # wait 仍用 pickup_confirm：舊 isolation 測試在填完電話後釘這個狀態。
    set_sess(uid, wait="pickup_confirm")
    return say("大概是什麼東西？", buttons=_PICKUP_ITEM_QR)


def _accept_preconfirm_item(uid: str, n: str) -> list[dict] | None:
    """確認卡出現前收下品項。突變自證會關掉這層。"""
    if (get_sess(uid).get("pickup_item") or "").strip():
        return None
    set_sess(uid, pickup_item=n)
    return _pickup_confirm_msgs(uid)


def _pickup_next_missing(uid: str) -> list[dict]:
    sess = get_sess(uid)
    if not (sess.get("pickup_when") or "").strip():
        set_sess(uid, wait="pickup_when")
        return say("什麼時候方便？", actions=_pickup_when_actions(uid))
    if not (sess.get("pickup_addr") or "").strip():
        return _ask_pickup_address(uid)
    if not (sess.get("pickup_phone") or "").strip():
        return _ask_pickup_phone(uid)
    if not (sess.get("pickup_item") or "").strip():
        return _ask_pickup_item(uid)
    return _pickup_confirm_msgs(uid)


def _ack_then_next(uid: str, note: str) -> list[dict]:
    sess = get_sess(uid)
    bid = (sess.get("pickup_id") or "").strip()
    head = [text_msg(note)]
    if bid:
        _patch_booking(
            bid,
            address=(sess.get("pickup_addr") or ""),
            phone=(sess.get("pickup_phone") or ""),
            slot=(sess.get("pickup_slot") or ""),
        )
        if not (
            (sess.get("pickup_when") or "").strip()
            and (sess.get("pickup_addr") or "").strip()
            and (sess.get("pickup_phone") or "").strip()
        ):
            return head + _pickup_next_missing(uid)
        return head
    return head + _pickup_next_missing(uid)


def _try_collect_pickup_fact(uid: str, t: str) -> list[dict] | None:
    """外收流程進行中，亂序收下地址或電話。電話優先，避免被當成地址。"""
    phone = _looks_like_pickup_phone(t)
    if phone:
        set_sess(uid, pickup_phone=phone)
        return _ack_then_next(
            uid,
            _pick_variant(uid, "pickup_phone_ack", ("好。", "記下了。")),
        )
    if _looks_like_pickup_address(t):
        set_sess(uid, pickup_addr=(t or "").strip())
        return _ack_then_next(
            uid,
            _pick_variant(uid, "pickup_addr_ack", ("好，記下了。", "收到。")),
        )
    return None


def _after_pickup_address(uid: str) -> list[dict]:
    return _pickup_next_missing(uid)


def _ask_pickup_address(uid: str) -> list[dict]:
    set_sess(uid, wait="pickup_loc")
    return say(
        _pick_variant(
            uid,
            "pickup_ask_addr",
            (
                "地址在哪？按下面傳位置最快。",
                "地址給我，按傳位置就行。",
            ),
        ),
        actions=_location_actions(),
    )


def _ask_pickup_phone(uid: str) -> list[dict]:
    set_sess(uid, wait="pickup_phone")
    prof = _profile_get(uid)
    phone = (prof.get("phone") or "").strip()
    actions = None
    if phone:
        last3 = "".join(ch for ch in phone if ch.isdigit())[-3:] if phone else "xxx"
        lab = f"用上次的 09xx…{last3}"[:20]
        actions = [{"type": "message", "label": lab, "text": "用上次的電話"}]
    return say(
        _pick_variant(
            uid,
            "pickup_ask_phone",
            (
                "電話留一下，師傅到了打給你。",
                "留個電話，到時候好聯絡。",
            ),
        ),
        actions=actions,
    )


def _apply_pickup_when(uid: str, dt: datetime, slot: str = "") -> list[dict]:
    if slot:
        when_s, slot_s = dt_fmt(dt), slot
    else:
        reason = booking_guard(dt)
        if reason:
            return say(
                f"那個時間我們沒開（{reason}）。",
                "再選一個方便的時間。",
                actions=_pickup_when_actions(uid),
            )
        when_s, slot_s = _slot_meta_for_dt(dt)
    set_sess(uid, pickup_when=when_s, pickup_slot=slot_s)
    return _pickup_next_missing(uid)


def _pickup_confirm_msgs(uid: str) -> list[dict]:
    sess = get_sess(uid)
    item = sess.get("pickup_item") or ""
    when = sess.get("pickup_when") or ""
    addr = sess.get("pickup_addr") or ""
    phone = sess.get("pickup_phone") or ""
    slot = sess.get("pickup_slot") or ""
    confirm_key = _pickup_fingerprint(sess)
    set_sess(uid, wait="pickup_confirm", pickup_confirm_key=confirm_key)
    return [
        text_msg(
            _pick_variant(
                uid,
                "pickup_confirm_lead",
                (
                    "資料先整理好了，看一下有沒有要改的：",
                    "確認一下，沒問題再按「確認送出」：",
                ),
            )
        ),
        pickup_confirm_flex(item, when, addr, phone=phone, slot=slot, confirm_key=confirm_key),
    ]


def _patch_booking(bid: str, **fields) -> None:
    if not bid or not BOOK.exists() or not fields:
        return
    try:
        lines = BOOK.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    out = []
    for line in lines:
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            out.append(line)
            continue
        if row.get("id") == bid and row.get("kind") != "cancel":
            row.update(fields)
        out.append(json.dumps(row, ensure_ascii=False))
    try:
        BOOK.write_text("\n".join(out) + ("\n" if out else ""), encoding="utf-8")
    except OSError:
        pass


def _push_pickup_item(uid: str, bid: str, item: str) -> bool:
    try:
        import staff_notify
        result = staff_notify.push_inbox(
            "pickup_item",
            {
                "id": bid,
                "uid": uid,
                "item": item,
                "name": staff_notify.guest_name(uid),
                "when": now_tw().isoformat(timespec="minutes"),
            },
        )
        _accept_staff_push(result)
        # 群組沒送到時 staff_pushed 仍是假，呼叫端要保持 notify_staff，webhook 才補得了。
        return True
    except Exception:
        return False


def _pickup_fingerprint(sess: dict) -> str:
    return hashlib.sha256(json.dumps([sess.get(k) or '' for k in ('pickup_form_id','pickup_when','pickup_slot','pickup_addr','pickup_phone','pickup_item')], ensure_ascii=False).encode()).hexdigest()[:20]


def _pickup_commit(uid: str, confirm_key: str = "") -> list[dict]:
    sess = get_sess(uid)
    if sess.get('pickup_id'):
        return say('這份收送資料已送出，不用再按一次。要更改的話跟我說。',buttons=[('改時間','我要改時間')])
    if sess.get('wait') != 'pickup_confirm':
        return say('這張確認卡已經不是目前的步驟，請重新選收送時間。',buttons=[('安排收送','外收送預約')])
    if confirm_key and confirm_key != _pickup_fingerprint(sess):
        return [text_msg('資料有更新，請確認這份最新的再送出。'), *_pickup_confirm_msgs(uid)]
    item = sess.get("pickup_item") or ""
    when = (sess.get("pickup_when") or "").strip()
    addr = (sess.get("pickup_addr") or "").strip()
    phone = (sess.get("pickup_phone") or "").strip()
    slot = sess.get("pickup_slot") or ""
    if not when or not addr or not phone:
        return _pickup_next_missing(uid)
    try:
        bid = save_booking(
            uid,
            when,
            item,
            kind="pickup",
            extra={"address": addr, "phone": phone, "slot": slot},
        )
    except PickupPhoneRequired:
        return _ask_pickup_phone(uid)
    _profile_save(uid, phone=phone, address=addr)
    set_sess(uid, last_booking=bid, wait=None, pickup_id=bid)
    spoken = slot_speech(slot)
    return say(
        _pick_variant(
            uid,
            "pickup_ok_1",
            (
                f"收送資料已送出，想約{spoken}去收，單號 {bid}。請店員確認安排，有調整會用你留的電話聯絡。",
                f"記下來了，希望{spoken}去收，單號 {bid}。請店員確認安排，有調整會用你留的電話聯絡。",
            ),
        ),
    )


def faq_menu() -> list[dict]:
    return say("您想問哪一個？", buttons=_FAQ_QR)


def faq_answer(key: str) -> list[dict]:
    a, b = _FAQ_ANSWERS[key]
    if key == "怎麼收費" and _standard_price_copy():
        a = "價目表上是店裡系統的標準價，有標洗法的（例如乾洗、14天）就是那種洗法的價；換別的洗法另計，實際以到店看件為準。"
    return say(a, b, buttons=_FAQ_NEXT)


def _is_query_code(text: str) -> bool:
    """M3：normalize 後只由英數與 - 組成、長度 2–20 才當查詢碼。"""
    q = intents.normalize(text)
    return bool(q and _QUERY_CODE_RE.fullmatch(q))


def _looks_like_address(text: str) -> bool:
    """M4：地址至少含數字或路／街／巷／弄／號／段／區／村／里。"""
    s = text or ""
    if any(ch.isdigit() for ch in s):
        return True
    return any(ch in _ADDR_MARKS for ch in s)


def _is_in_store_text(t: str, n: str) -> bool:
    if "嗎" in n:
        return False
    if any(k in n for k in ("我在店裡", "我在店里", "在門口", "我到了", "到店了", "到你們店")):
        return True
    return intents.normalize(t) in _IN_STORE_EXACT


def _is_cancel_text(n: str) -> bool:
    if any(k in n for k in ["取消", "不去了", "改期", "延期"]):
        return True
    return bool(re.fullmatch(
        r"(?:算了[，,。\s]*)?(?:先)?(?:不用了|不要了|不約了|不收了|不用來收了)(?:[，,。\s]*謝謝)?[！!。\s]*", n))


def _is_pickup_hours_text(n: str) -> bool:
    """M7：同時問幾點／什麼時候與收件／收送 → 營業時間，不是外收。"""
    time_ask = ("幾點" in n) or ("什麼時候" in n)
    recv = ("收件" in n) or ("收送" in n)
    return time_ask and recv


def _is_pickup_text(n: str) -> bool:
    if _is_pickup_hours_text(n):
        return False
    return any(k in n for k in ["收件", "到府", "來收", "收送", "幫我收"]) or n in _PICKUP_MENU


def _is_query_text(n: str) -> bool:
    # 「通常幾天可以拿」是問處理天數，不是拿單查件；有「我的／單號／好了嗎」才進查件。
    turnaround = any(k in n for k in ("通常", "一般", "幾天", "多久", "何時"))
    status_context = any(k in n for k in ("我的", "這件", "單號", "好了嗎", "查", "進度"))
    if turnaround and not status_context:
        return False
    return any(
        k in n
        for k in [
            "洗好了",
            "好了嗎",
            "可以拿",
            "可以取",
            "取件",
            "查進度",
            "查件進度",
            "送洗進度",
            "洗衣進度",
            "查我的單",
            "查單",
            "查案件",
            "我的衣服好了嗎",
        ]
    ) or n in _QUERY_MENU


def _is_photo_quote(n: str) -> bool:
    return any((n == k) or (k in n) for k in _PHOTO_QUOTE_TRIGGERS) or any(
        k in n
        for k in (
            "照片估價",
            "照片報價",
            "照片可以估",
            "看照片報價",
            "拍照估價",
            "拍照報價",
            "傳照片可以嗎",
        )
    )


def photo_quote_reply(uid: str = "") -> list[dict]:
    return say(
        _pick_variant(uid, "photo_quote_1", ("好啊，拍給我看。", "可以，直接拍。")),
        _pick_variant(
            uid,
            "photo_quote_2",
            (
                "整件一張，髒的地方再補一張，我比較好抓價錢。",
                "整件拍一張，有髒污或洗標的地方再一張。",
            ),
        ),
        actions=[
            {"type": "camera", "label": "📷 拍照"},
            {"type": "cameraRoll", "label": "🖼 從相簿選"},
            {"type": "message", "label": "先看價目表", "text": "價目表"},
        ],
    )


def _addr_divert_intent(t: str, n: str) -> str | None:
    """M4：等地址時先認的意圖。"""
    if _is_rush_text(n):
        return "concern"
    voice = _voice_meta_intent(t, n)
    if voice:
        return voice
    if intents.is_ack(t):
        return "ack"
    if _is_in_store_text(t, n):
        return "in_store"
    if _is_cancel_text(n):
        return "cancel"
    if _is_pickup_hours_text(n):
        return "hours_day"
    if _is_pickup_text(n):
        return "pickup"
    if _is_query_text(n):
        return "query"
    if _is_hours_query(n):
        return "hours_day"
    return None


def _hours_with_pickup_note(n: str) -> list[dict]:
    msgs = hours_reply(n)
    extra = "收送時間跟營業時間一樣"
    if msgs and msgs[-1].get("type") == "text":
        prev = msgs[-1].get("text") or ""
        msgs[-1]["text"] = (prev + "\n" + extra) if prev else extra
    else:
        msgs = list(msgs) + [text_msg(extra)]
    return msgs


def start_query(uid: str) -> tuple[list[dict], bool]:
    if not auto_query_available():
        prof = _profile_get(uid)
        phone = (prof.get("phone") or "").strip()
        if phone:
            set_sess(uid, wait="query_phone_choice", query_phone=phone, query_misses=0)
            masked = _mask_phone(phone)
            return say(
                _pick_variant(
                    uid,
                    "query_reuse",
                    (
                        f"用上次的 {masked} 嗎？",
                        f"還是 {masked} 這支？",
                    ),
                ),
                buttons=[("就用這支", "就用這支"), ("換一支", "換一支")],
            ), False
        set_sess(uid, wait="query_phone", query_misses=0)
        return say(
            _pick_variant(
                uid,
                "query_ask_phone",
                (
                    "我幫你問櫃台，手機給我一下？",
                    "好，我問櫃台。手機號碼給我？",
                ),
            ),
        ), False
    bound = ""
    try:
        import laundry_lookup
        bound = laundry_lookup.bound_customer(uid)
    except Exception:
        bound = ""
    if bound:
        # 查件已成功綁定後，客人再次點「查件進度」只回覆客人，
        # 不要每點一次就再燒一則店員群通知。
        return tell_status_ex(uid, bound, notify_staff=False)
    set_sess(uid, wait="query", query_misses=0)
    return say(
        "我幫你看店裡有沒有入庫、能不能取。",
        "請給我送洗時留的完整手機號碼（09 開頭十碼），也可以提供收據洗號。",
    ), False


def tell_status(uid: str, query: str) -> list[dict]:
    msgs, _notified = tell_status_ex(uid, query)
    return msgs


def tell_status_ex(uid: str, query: str, *, notify_staff: bool = False) -> tuple[list[dict], bool]:
    import laundry_lookup
    row = laundry_lookup.lookup(query)
    text = laundry_lookup.guest_copy(row)
    if row.data_as_of:
        data_time = datetime.fromisoformat(row.data_as_of).strftime("%m/%d %H:%M")
        footer = (f"以上是 {data_time} 的資料,最新狀態請於營業時間再確認"
                  if row.stale else f"資料時間 {data_time}")
        text += "\n" + footer
    elif row.source == laundry_lookup.EHANK_SOURCE and row.stale:
        text += "\n資料時間無法確認,最新狀態請於營業時間再確認"
    flag = laundry_lookup.guest_ready_flag(row)
    notified = False
    if row.found:
        laundry_lookup.bind_uid(uid, row.customer_no, row.phone, method=row.matched_by or "")
        set_sess(uid, wait=None, customer_no=row.customer_no, query_misses=0)
        if notify_staff:
            try:
                import staff_notify
                result = staff_notify.push_inbox(
                    "query",
                    {
                        "id": "C" + now_tw().strftime("%H%M%S") + uid[-4:],
                        "uid": uid,
                        "when": now_tw().isoformat(timespec="minutes"),
                        "name": staff_notify.guest_name(uid),
                        "phone": row.phone,
                        "item": f"客號 {row.customer_no}",
                        "text": text,
                        "flag": flag,
                        "customer_no": row.customer_no,
                        "auto_replied": True,
                    },
                )
                _accept_staff_push(result)
                notified = True
            except Exception:
                notified = True
        buttons = [("再查一次", "物件查詢"), ("約到店", "預約到店")]
        if flag == "not_ready":
            buttons = [("再查一次", "物件查詢"), ("外收送", "外收送預約")]
        return say(text, buttons=buttons), notified

    misses = int(get_sess(uid).get("query_misses") or 0) + 1
    if misses >= 2:
        set_sess(uid, wait=None, query_misses=0)
        try:
            import staff_notify
            result = staff_notify.push_inbox(
                "query",
                {
                    "id": "C" + now_tw().strftime("%H%M%S") + uid[-4:],
                    "uid": uid,
                    "when": now_tw().isoformat(timespec="minutes"),
                    "name": staff_notify.guest_name(uid),
                    "text": query,
                    "flag": "unknown",
                },
            )
            _accept_staff_push(result)
            notified = True
        except Exception:
            notified = True
        return say("這樣我先幫你轉店裡，你方便的話把收據拍給我。"), notified

    set_sess(uid, wait="query", query_misses=misses)
    buttons = [("再查一次", "物件查詢"), ("約到店", "預約到店")]
    return say(text, buttons=buttons), False


def public_base() -> str:
    p = Path(__file__).with_name("public_base.txt")
    if p.exists():
        return p.read_text(encoding="utf-8").strip().rstrip("/")
    return ""


def img_url(name: str) -> str:
    b = public_base()
    return f"{b}/img/{name}" if b else ""


def read_https_switch(path: Path) -> str:
    """L1：不存在或空 = 未設定。必須 https://；否則當沒設定，警告到 stderr（不寫網址）。"""
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    line = text.lstrip("\ufeff").strip()
    if not line:
        return ""
    line = line.splitlines()[0].strip()
    if not line:
        return ""
    if not line.startswith("https://"):
        print(f"WARN: {path.name} is not an https URL; treating as unset", file=sys.stderr)
        return ""
    return line


def coupon_display_name() -> str:
    p = COUPON_NAME_PATH
    if not p.is_file():
        return DEFAULT_COUPON_NAME
    try:
        text = p.read_text(encoding="utf-8")
    except OSError:
        return DEFAULT_COUPON_NAME
    line = text.lstrip("\ufeff").strip()
    if not line:
        return DEFAULT_COUPON_NAME
    line = line.splitlines()[0].strip()
    return line or DEFAULT_COUPON_NAME


def shop_card() -> dict:
    return {
        "type": "flex",
        "altText": "私享家精品洗護",
        "contents": {
            "type": "bubble",
            "size": "mega",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": CREAM,
                "paddingAll": "20px",
                "contents": [
                    {"type": "text", "text": "私享家", "weight": "bold", "size": "xl", "color": INK},
                    {"type": "text", "text": "精品洗護 · 台中西屯", "size": "sm", "color": GOLD, "margin": "md"},
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {"type": "text", "text": HOURS, "size": "sm", "color": "#6B6158", "wrap": True},
                    {"type": "text", "text": f"{ADDR}（{LANDMARK}）", "size": "sm", "color": "#6B6158", "wrap": True, "margin": "md"},
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "contents": [
                    {"type": "button", "style": "primary", "color": NAVY, "action": {"type": "message", "label": "約到店", "text": "預約到店"}},
                    {"type": "button", "style": "secondary", "action": {"type": "message", "label": "看價目", "text": "價目表"}},
                    {"type": "button", "style": "secondary", "action": {"type": "message", "label": "看作品", "text": "作品案例"}},
                ],
            },
        },
    }


def works_flex() -> dict:
    cards = []
    for title, sub, fn, send in [
        ("鞋履護理", f"運動鞋 {_labeled_price('一般運動鞋')} 起", "shoes.jpg", "鞋子"),
        ("包款護理", f"一般包 {_labeled_price('一般包')} 起", "bags.jpg", "包包"),
        ("衣物寢具", "到店看過再定", "clothes.jpg", "衣服"),
    ]:
        url = img_url(fn)
        hero = {"type": "image", "url": url, "size": "full", "aspectRatio": "20:13", "aspectMode": "cover"} if url else None
        bubble = {
            "type": "bubble",
            "size": "kilo",
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {"type": "text", "text": title, "weight": "bold", "size": "lg", "color": INK},
                    {"type": "text", "text": sub, "size": "sm", "color": GOLD, "margin": "md"},
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {"type": "button", "style": "primary", "color": NAVY, "action": {"type": "message", "label": "我想送這個", "text": send}},
                ],
            },
        }
        if hero:
            bubble["hero"] = hero
        cards.append(bubble)
    return {"type": "flex", "altText": "私享家作品", "contents": {"type": "carousel", "contents": cards}, "quickReply": qr(next_qr_items())}


def courtesy_flex() -> dict:
    return {
        "type": "flex",
        "altText": "到店禮遇",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": CREAM,
                "paddingAll": "20px",
                "contents": [
                    {"type": "text", "text": "到店禮遇", "weight": "bold", "size": "xl", "color": INK},
                    {"type": "text", "text": "不是折扣券，是我們怎麼接待您。", "size": "sm", "color": GOLD, "margin": "md", "wrap": True},
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {"type": "text", "text": "跟我們說您從 LINE 來。我們會先看件、說明流程，不會逼您當天留下。名牌、皮革一定看過再收。", "wrap": True, "size": "sm", "color": "#6B6158"},
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {"type": "button", "style": "primary", "color": NAVY, "action": {"type": "message", "label": "約個時間", "text": "預約到店"}},
                ],
            },
        },
    }


def my_booking(uid: str) -> list[dict]:
    last = last_active_booking(uid)
    if not last:
        return say("目前還沒有幫您記下的時間。", "要現在留一個嗎？", buttons=[("約時間", "預約到店")])
    return say(
        f"您上次留的是 {last.get('when','').replace('T',' ')}，編號 {last.get('id')}。",
        "要改時間，還是就這樣？",
        buttons=[("改時間", "預約到店"), ("就這樣", "位置")],
    )


def welcome(uid: str = "") -> list[dict]:
    h = hello()
    first = _pick_variant(
        uid,
        "welcome",
        (
            f"{h}，這裡是私享家。不確定能不能洗、洗多少錢，拍張照給我就好。",
            f"{h}，私享家。要洗什麼直接跟我說，或拍張照也行。",
            f"{h}，這裡是私享家。拍張照或打品名都可以。",
        ),
    )
    msgs = [
        text_msg(first),
        shop_card(),
    ]
    url = read_https_switch(COUPON_URL_PATH)
    if url:
        name = coupon_display_name()
        msgs.append(
            text_msg(
                f"加好友禮：{name}\n{url}\n第一次送洗時出示就可以。",
                buttons=[("先看價目", "價目表")],
            )
        )
    return msgs


def pay_guide() -> list[dict]:
    url = read_https_switch(_BOT_DIR / 'merchant-pay-url.txt')
    return say(
        '可以用 LINE Pay。等店員確認金額後，再開付款頁自行輸入。',
        '付款前確認收款店家是私享家、金額也正確。預估價先不用付；付款後仍由店員核對。',
        actions=[{'type':'uri','label':'開啟 LINE Pay','uri':url}] if url else [{'type':'uri','label':'問店員付款方式','uri':'tel:'+PHONE}],
    )


_SUIT_SET_PHRASES = ("整套西裝", "西裝整套", "西裝套裝")
_SUIT_THREE_PHRASES = ("三件式西裝", "西裝三件式")
_QUOTE_BUTTONS = [("拍照詢問", "拍照問價"), ("安排收送", "外收送預約"), ("門市資訊", "店址"), ("打電話", "電話")]


def _suit_parts_ready() -> bool:
    catalog = _flat_catalog()
    return "西裝" in catalog and "西褲" in catalog


def _suit_piece_bits() -> list[str]:
    return [
        f"西裝上衣 {_labeled_price('西裝')}",
        f"西褲 {_labeled_price('西褲')}",
        f"西裝背心 {_labeled_price('西裝背心')}",
    ]


def _suit_jacket_first() -> str:
    price = _price_of("西裝")
    label = PRICE_LABELS.get("西裝") or ""
    if label:
        return f"西裝上衣大概 {price}（{label}）。"
    return f"西裝上衣水洗大概 {price}。"


def _suit_jacket_aside() -> str:
    return f"西褲 {_labeled_price('西褲')}、西裝背心 {_labeled_price('西裝背心')}，都是一件一件算。"


def _suit_remember(uid: str) -> None:
    set_sess(uid, last_item="西裝", last_price=_price_of("西裝"), topic=None)


def _suit_clarify_buttons():
    return [("西裝上衣", "西裝上衣"), ("西褲", "西褲"), ("西裝背心", "西裝背心")]


def _suit_jacket_quote(uid: str) -> list[dict]:
    _suit_remember(uid)
    tail = _pick_variant(uid, "quote_tail", _QUOTE_TAILS)
    second = _suit_jacket_aside() + "\n" + tail
    return say(_suit_jacket_first(), second, buttons=_QUOTE_BUTTONS)


def _suit_piece_list(uid: str) -> list[dict]:
    first = "西裝沒有整套價，一件一件算：" + "、".join(_suit_piece_bits()) + "。"
    _suit_remember(uid)
    tail = _pick_variant(uid, "quote_tail", _QUOTE_TAILS)
    return say(first, tail, buttons=_QUOTE_BUTTONS)


def _suit_phrase_messages(uid: str, norm: str):
    if norm in _SUIT_SET_PHRASES or norm in _SUIT_THREE_PHRASES:
        return _suit_piece_list(uid)
    return None


def _suit_phrase_reply(uid: str, norm: str):
    if not _suit_parts_ready():
        return None
    messages = _suit_phrase_messages(uid, norm)
    if messages is None:
        return None
    return _pack(messages, "quote", False)


def quote(item: str, price, uid: str, aside: str = "") -> list[dict]:
    if item == "西裝" and _suit_parts_ready():
        return _suit_jacket_quote(uid)
    set_sess(uid, last_item=item, last_price=price, topic=None)
    label = PRICE_LABELS.get(item) or ""
    if label:
        first = f"{item}大概 {price}（{label}）。"
    else:
        first = f"{item}水洗大概 {price}。"
    bits = []
    if aside:
        bits.append(aside.rstrip("。") + "。")
    bits.append(_pick_variant(uid, "quote_tail", _QUOTE_TAILS))
    second = "\n".join(bits)
    return say(first, second, buttons=_QUOTE_BUTTONS)


def wash_ask() -> list[dict]:
    return say(
        "好。",
        "您是棉被、鞋子、包包，還是衣服？有名牌或皮革先跟我說一聲。",
        buttons=[("棉被", "棉被"), ("鞋子", "鞋子"), ("包包", "包包"), ("衣服", "衣服"), ("皮衣", "皮衣")],
    )


def _is_rush_text(n: str) -> bool:
    # Negative phrases such as "不急" must not create an urgent task.
    positive = re.sub(r"(?:不(?:用|要|太)?|沒(?:有)?(?:那麼|很)?)(?:著|着)?急|不趕(?:時間)?|不是急件", "", n)
    return any(k in positive for k in ["急", "趕時間", "快一點"]) or bool(
        re.search(r"(?:今天|今晚|當天|明天).{0,12}(?:拿到|取件|要取|要拿|要穿|要用|洗好|完成)|明天(?:要)?(?:出國|出差)", positive))


def concern(n: str, uid: str) -> list[dict] | None:
    """電話裡客人真正會先講的擔心，比品名更先接。"""
    if _is_rush_text(n):
        set_sess(uid, worry="rush")
        saved = _push_ask(uid, "急件需求，請核對能否趕上；尚未承諾完成時間。客人說：" + n)
        return say(
            "你趕著要用，這個得請店裡看件量，現在還不能答應一定來得及。",
            ("需求已留給店員。最晚幾點要拿，也一起告訴店員，方便核對。" if saved else
             "這次需求沒能存下來，麻煩直接打給店裡，才不會耽誤你。"),
            actions=[{"type": "uri", "label": "打給店裡", "uri": "tel:" + PHONE}],
        )
    if any(k in n for k in ["掉色", "褪色", "染色"]):
        set_sess(uid, worry="color")
        return say(
            "會擔心掉色很正常。",
            "要看材質、染色和洗標，不能只看深淺色就保證。方便拍整件和洗標給我們嗎？",
            buttons=[("白／淺色", "淺色"), ("深色", "深色"), ("到店給你們看", "預約到店")],
        )
    if any(k in n for k in ["怕洗壞", "會不會壞", "會壞"]):
        return say(
            "名牌、皮革我們有收，但一定是看過再收，不會先跟您說一定沒問題。",
            "您方便帶過來，還是先傳照片給我轉店裡？",
            buttons=[("我到店", "預約到店"), ("先問價錢", "價目表")],
        )
    if any(k in n for k in ["發霉", "霉味", "臭"]):
        return say(
            "發霉、重污皮革跟包會另計，我先跟您說清楚。",
            "您是包、皮衣，還是鞋子？",
            buttons=[("包包", "包包"), ("皮衣", "皮衣"), ("鞋子", "鞋子")],
        )
    if any(k in n for k in ["多久", "幾天", "幾號取", "要洗多久"]):
        return say(
            "一般件大概三到五天，名牌、皮革會再久一點。",
            "您有趕著用的日子嗎？",
            buttons=[("不急", "這週到店"), ("有點趕", "急件"), ("約時間", "預約到店")],
        )
    if n in ("淺色", "白／淺色", "白色"):
        return say("淺色我記下了。到店我們會先試色再洗。", "您是鞋子還是衣服？", buttons=[("鞋子", "鞋子"), ("衣服", "衣服"), ("約時間", "預約到店")])
    if n == "深色":
        return say("深色相對穩。", "您是要送鞋子，還是衣服？", buttons=[("鞋子", "鞋子"), ("衣服", "衣服"), ("約時間", "預約到店")])
    if n in ("今天取", "明天取"):
        return say(
            "我先幫您問店裡，不一定留得住。",
            f"您也可以直接打 {PHONE}，比較快。要我先幫您留一個到店時間嗎？",
            buttons=[("約時間", "預約到店"), ("我自己打", "電話")],
        )
    return None


_WD = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}
_WD_LABEL = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
_CAT_QR = [("棉被", "棉被"), ("鞋子", "鞋子"), ("包包", "包包"), ("衣服", "衣服")]


def wash_type_reply() -> list[dict]:
    """K5：乾洗／水洗／柔洗／送洗。不自創乾洗價格。"""
    first = "價目表上是水洗價，乾洗跟柔洗會另計。"
    if _standard_price_copy():
        first = "價目表上是店裡系統的標準價，有標洗法的（例如乾洗、14天）就是那種洗法的價；換別的洗法另計。"
    return say(
        first,
        "您要洗的是什麼？我先看是哪一類。",
        buttons=_CAT_QR,
    )


def pre_wash_notes() -> list[dict]:
    """選單「送洗前必看」：只講契約與價目表能支持的事實。"""
    first = "送洗前先跟你講這幾件。價目表上是水洗價，乾洗跟柔洗另計，實際以現場報價為準。"
    if _standard_price_copy():
        first = "送洗前先跟你講這幾件。價目表上是店裡系統的標準價，有標洗法的（例如乾洗、14天）就是那種洗法的價；換別的洗法另計，實際以現場報價為準。"
    return say(
        first,
        "有名牌或皮革先說一聲。鞋類跟寢具通常比一般件久。急件先講。",
        buttons=[("拍照問價", "拍照問價"), ("價目表", "價目表"), ("找真人", "找真人")],
    )


def _down_quilt_split(catalog: dict) -> bool:
    return "羽絨羊毛被" not in catalog and "羽絨被" in catalog and "蠶絲羊毛被" in catalog


def _quilt_clarify() -> list[dict]:
    if _down_quilt_split(_flat_catalog()):
        return say(
            "棉被啊。",
            "您是單人還是雙人？羽絨被、蠶絲羊毛被跟一般棉被價不一樣。",
            buttons=[
                ("單人", "單人棉被"),
                ("雙人", "雙人棉被"),
                ("羽絨被", "羽絨被"),
                ("蠶絲羊毛被", "蠶絲羊毛被"),
                ("不確定", "不確定"),
            ],
        )
    return say(
        "棉被啊。",
        "您是單人還是雙人？羽絨被跟一般棉被價不一樣。",
        buttons=[("單人", "單人棉被"), ("雙人", "雙人棉被"), ("羽絨被", "羽絨羊毛被"), ("不確定", "不確定")],
    )


def _cat_clarify(word: str, catalog: dict) -> list[dict] | None:
    """K3：類別詞反問。價格一律從價目讀。"""
    p = _labeled_price
    if word == "外套":
        items = _items_with_stem("外套", catalog)
        _shown, has_lux = _prefer_general(items)
        extra = "\n精品款另計，到店看件再報。" if has_lux else ""
        return say(
            f"外套薄的大概 {p('薄外套')}，厚的 {p('厚外套')}，羽絨 {p('羽絨外套')}。",
            "您那件比較薄還是厚？" + extra,
            buttons=[("薄的", "薄外套"), ("厚的", "厚外套"), ("羽絨", "羽絨外套")],
        )
    if word == "洋裝":
        items = _items_with_stem("洋裝", catalog)
        shown, has_lux = _prefer_general(items)
        extra = "\n精品款另計，到店看件再報。" if has_lux else ""
        return say(
            f"洋裝短 {p('短洋裝')}、中 {p('中洋裝')}、長 {p('長洋裝')}。",
            "大概什麼長度？" + extra,
            buttons=[(h, h) for h in shown],
        )
    if word == "包包":
        return say(
            "包包我先問您。",
            "一般包、皮包，還是名牌？",
            buttons=[("一般包", "一般包"), ("皮包", "皮包包"), ("名牌包", "名牌包")],
        )
    if word == "鞋子":
        return say(
            "鞋子，好。",
            "運動鞋還是皮鞋？名牌的話跟我說，價錢不一樣。",
            buttons=[("運動鞋", "運動鞋"), ("皮鞋", "皮鞋"), ("名牌鞋", "名牌鞋"), ("不確定", "不確定")],
        )
    if word == "棉被":
        return _quilt_clarify()
    if word == "衣服":
        return say(
            "衣服，好。",
            "襯衫長褲，還是外套、洋裝？",
            buttons=[("襯衫", "襯衫"), ("長褲", "長褲"), ("外套", "外套"), ("洋裝", "洋裝")],
        )
    if word == "寢具" and word in CATS:
        return say(f"{word}我幫您攤開。", "沒列到的，直接打品名給我。") + [cat_list_flex(word)]
    stem = _CAT_STEM.get(word, word)
    items = _items_with_stem(stem, catalog)
    shown, has_lux = _prefer_general(items)
    if not shown:
        return None
    extra = "\n精品款另計，到店看件再報。" if has_lux else ""
    line = "、".join(f"{h} {p(h)}" for h in shown)
    return say(
        f"{word}我對到這幾項。",
        line + extra + "\n您是哪一個？",
        buttons=[(h, h) for h in shown],
    )


def _hours_target(n: str) -> tuple[int, str, bool]:
    """回 (weekday, 那天標籤, 是否問今天)。R2 hours_day"""
    if "今天" in n:
        return now_tw().weekday(), "今天", True
    if "明天" in n:
        return (now_tw().weekday() + 1) % 7, "明天", False
    for prefix in ("星期", "禮拜", "週", "周"):
        i = n.find(prefix)
        if i >= 0 and i + len(prefix) < len(n):
            ch = n[i + len(prefix)]
            if ch in _WD:
                wd = _WD[ch]
                return wd, _WD_LABEL[wd], False
    return now_tw().weekday(), "今天", True


def _span_for(wd: int):
    if wd == 6:
        return None
    if wd == 5:
        return "12:00-18:00", "18:00"
    return "10:00-20:00", "20:00"


def hours_reply(n: str) -> list[dict]:
    wd, label, is_today = _hours_target(n)
    buttons = [("約時間", "預約到店"), ("看路", "位置")]
    span = _span_for(wd)
    if span is None:
        return say(
            f"{label}我們公休。",
            f"{HOURS}\n在{LANDMARK}。其他營業日直接帶來就好，不用預約。",
            buttons=buttons,
        )
    hours, close = span
    if is_today:
        now = now_tw()
        if booking_guard(now) is None:
            first = f"現在有開，到 {close}。"
        else:
            hm = now.hour * 60 + now.minute
            if now.weekday() == 5:
                open_hm, open_s = 12 * 60, "12:00"
            else:
                open_hm, open_s = 10 * 60, "10:00"
            if hm < open_hm:
                first = f"今天還沒開，{open_s} 開。"
            else:
                first = "今天已經打烊了。"
    else:
        first = f"{label}我們 {hours}。"
    return say(first, f"{HOURS}\n在{LANDMARK}。送洗不用預約，營業時間帶來就好。", buttons=[('門市資訊','店址'),('安排收送','外收送預約')])


def _is_hours_query(n: str) -> bool:
    if n in ("時間", "營業"):
        return True
    return any(k in n for k in ["有開", "開嗎", "營業", "幾點", "公休", "今天開", "開到"])


def _quote_item(uid: str, name: str, aside: str = "") -> list[dict]:
    hit = lookup_item(name)
    if not hit:
        return say("這項我幫您轉店裡問。", f"也可以直接打 {PHONE}。", buttons=_CAT_QR)
    item, price, cat = hit
    extra = aside
    if cat == "皮革" and "發霉" not in extra:
        extra = (extra + "。" if extra and not extra.endswith("。") else extra)
        extra = (extra + "皮革發霉、特污會另計，我先講。").strip()
    return quote(item, price, uid, extra)


def handle_postback(uid: str, data: str, params: dict, event_id: str = "") -> list[dict]:
    estimated = quote_flow.handle_postback(sys.modules[__name__], uid, data, event_id)
    if estimated is not None:
        return estimated
    raw = data or ""
    if raw.startswith("tab="):
        return []
    if "action=pickup_confirm" in raw:
        from urllib.parse import parse_qs
        key = parse_qs(raw).get('key',[''])[0]
        with quote_flow._lock(uid):
            return _pickup_commit(uid, key) if key else _pickup_commit(uid)
    if "action=pickup_day" in raw:
        offset = 0
        if "offset=" in raw:
            try:
                offset = int(raw.split("offset=", 1)[-1].split("&")[0])
            except ValueError:
                offset = 0
        day = (now_tw() + timedelta(days=offset)).date()
        for opt in iter_pickup_slots(limit=12):
            if opt["start"].date() == day:
                return _apply_pickup_when(uid, opt["start"], opt["slot"])
        return say(
            "那個時間我們沒開。",
            "再選一個方便的時間。",
            actions=_pickup_when_actions(uid),
        )
    if "action=pickup_when" in raw:
        when = (params or {}).get("datetime") or (params or {}).get("date") or ""
        dt = parse_when(when)
        if dt is None:
            return say("時間沒選到，我們再選一次。", actions=_pickup_when_actions())
        return _apply_pickup_when(uid, dt)
    when = (params or {}).get("datetime") or (params or {}).get("date") or ""
    item = ""
    if "item=" in raw:
        item = raw.split("item=", 1)[-1]
    if not item:
        item = get_sess(uid).get("last_item") or ""
    pickup = "action=pickup" in raw
    if not when:
        retry = "外收送預約" if pickup else "預約到店"
        return say("時間沒選到，我們再選一次。", buttons=[("再選一次", retry)])
    dt = parse_when(when)
    reason = "時間看不懂" if dt is None else booking_guard(dt)
    if reason:
        # R4 不存檔，重送選時間卡
        if pickup:
            return say(
                f"那個時間我們沒開（{reason}）。",
                "再選一個方便的時間。",
                actions=_pickup_when_actions(uid),
            )
        return [
            text_msg(f"那個時間我們沒開（{reason}）。"),
            booking_flex(item or None, pickup=False, address=""),
        ]
    if pickup:
        if item:
            set_sess(uid, pickup_item=item, last_item=item)
        return _apply_pickup_when(uid, dt, slot=_pickup_slot_spoken(dt))
    extra = {}
    kind = "book"
    bid = save_booking(uid, when, item, kind=kind, extra=extra)
    set_sess(uid, last_booking=bid, wait=None)
    return [
        text_msg("好，時間我幫您記下了。"),
        booking_ok(bid, when.replace("T", " "), item, pickup=False, address=""),
    ]


def _query_should_leave(t: str, n: str) -> bool:
    """M3：等待手機時若客人講的是別的意圖，離開查件流程。"""
    if _is_rush_text(n):
        return True
    if re.search(r"多少|價錢|價格|報價|估價|加總|總價|怎麼算", n) and not re.search(r"餘額|儲值|欠款|已付|未付", n):
        return True
    if _voice_meta_intent(t, n):
        return True
    if intents.is_ack(t):
        return True
    if _is_in_store_text(t, n):
        return True
    if _is_cancel_text(n):
        return True
    if _is_pickup_hours_text(n) or _is_pickup_text(n):
        return True
    if _is_hours_query(n):
        return True
    if _is_photo_quote(n):
        return True
    if n in ("價目", "價目表", "價格表", "menu", "服務價目", "先看價錢", "看價目表"):
        return True
    if n in ("預約到店", "預約", "約時間", "這週到店", "我要預約", "預約這個", "立即預約") or n.startswith("預約"):
        return True
    if n in ("常見問題", "FAQ", "faq"):
        return True
    if n in ("位置", "地址", "地圖", "怎麼去", "在哪", "店址", "先看位置", "電話", "打電話"):
        return True
    return False


def _push_query_handoff(uid: str, phone: str, item: str) -> bool:
    try:
        import staff_notify
        result = staff_notify.push_inbox(
            "query",
            {
                "id": "C" + now_tw().strftime("%H%M%S") + (uid[-4:] if uid else ""),
                "uid": uid,
                "when": now_tw().isoformat(timespec="minutes"),
                "name": staff_notify.guest_name(uid),
                "text": phone,
                "phone": phone,
                "item": item,
            },
        )
        _accept_staff_push(result)
        # 群組沒送到時 staff_pushed 仍是假，呼叫端要保持 notify_staff，webhook 才補得了。
        return True
    except Exception:
        return False


def _push_faq_human(uid: str) -> bool:
    try:
        import staff_notify
        case_id = "Q" + now_tw().strftime("%H%M%S") + uuid.uuid4().hex[:6]
        result = staff_notify.push_inbox(
            "ask",
            {
                "id": case_id,
                "case_id": case_id,
                "uid": uid,
                "when": now_tw().isoformat(timespec="minutes"),
                "name": staff_notify.guest_name(uid),
                "text": "我還是想問人",
                "handoff": True,
            },
        )
        _accept_staff_push(result)
        # 群組沒送到時 staff_pushed 仍是假，呼叫端要保持 notify_staff，webhook 才補得了。
        return True
    except Exception:
        return False


def handle_ex(uid: str, text: str, event_type: str = "message", event_id: str = "") -> tuple[list[dict], dict]:
    """IF-1 / R6：回 (messages, meta)，meta = {"intent", "notify_staff", "staff_pushed"}。"""
    _pack.uid = uid
    _pack.text = (text or "").strip().replace(" ", "").replace("？", "").replace("?", "")
    _pack._npush = 0
    _pack.photo_funnel = False
    if event_type == "image_error":
        return [text_msg("照片這次沒有收完整，請再傳一次，或先用文字告訴我需求。", actions=[{"type": "cameraRoll", "label": "重傳照片"}])], {"intent": "image_error", "notify_staff": True, "staff_pushed": False}
    if event_type == "image":
        if (get_sess(uid) or {}).get("wait") == "payment_check":
            return _payment_proof_photo(uid, text, event_id)
        estimated = quote_flow.photo_received(sys.modules[__name__], uid, text, event_id)
        if estimated is not None:
            return estimated
    elif event_type == "message":
        # 客訴、店內未啟用服務與明確的處理天數先處理，
        # 免得導覽層把「衣服／多久」帶到錯的分支；品項估價仍交給 quote_flow。
        early_text = (text or "").strip()
        early_n = early_text.replace(" ", "").replace("？", "").replace("?", "")
        # 只提前攔截導覽層容易誤判的類別；收送／查件仍走下方的狀態機，
        # 避免剛建立 pickup_when 又被當成「要離開流程」而遞迴。
        early_candidate = (
            any(k in early_n for k in ("洗不乾淨", "沒洗乾淨", "洗壞", "破掉", "少一件", "少件", "拿錯", "不見", "客訴", "要賠"))
            or any(k in early_n for k in ("洗衣精", "洗衣粉", "洗衣袋", "自助洗", "烘衣", "烘乾服務", "修改衣服"))
            or any(k in early_n for k in ("會員優惠", "有會員嗎", "有集點嗎", "有優惠嗎", "有折扣嗎", "新客優惠"))
            or any(k in early_n for k in ("通常幾天", "一般幾天", "幾天拿得到", "多久拿得到", "何時可以取", "送洗要預約嗎", "洗衣要先預約嗎", "一定要預約嗎"))
        )
        if early_candidate:
            early = _natural_customer_question(uid, early_text, early_n)
            if early is not None and early[1] in ("complaint", "shop_question", "faq"):
                msgs, intent, notify = early
                return _pack(msgs, intent, notify)
        navigated = journey_ux.handle(sys.modules[__name__], uid, text)
        if navigated is not None:
            return navigated
        sess_now = get_sess(uid) or {}
        wait_now = sess_now.get("wait") or ""
        if not wait_now or wait_now in ("photo", "photo_need"):
            suit_phrase = _suit_phrase_reply(uid, intents.normalize(early_text))
            if suit_phrase is not None:
                return suit_phrase
        estimated = quote_flow.handle_text(sys.modules[__name__], uid, text, event_id)
        if estimated is not None:
            return estimated
    if event_type == "follow":
        set_sess(uid, topic=None)
        return _pack(welcome(uid), "welcome", False)
    if event_type == "image":
        incoming = (text or "").strip()
        photo_path = incoming if incoming.startswith("photos/") else ""
        set_sess(
            uid,
            photo_ts=now_tw().isoformat(),
            wait=_PHOTO_NEED_WAIT,
            photo_wait_ts="",
            photo_nudged=False,
            photo_need=(get_sess(uid) or {}).get("photo_need", ""),
            photo_path=photo_path or (get_sess(uid) or {}).get("photo_path") or "",
        )
        return _pack(
            say(
                _pick_variant(uid, "photo_got_1", ("收到，我看看。", "收到。")),
                _pick_variant(uid, "photo_got_2", ("哪邊要特別處理？", "有哪裡要加強的嗎？")),
                buttons=_PHOTO_NEED_QR,
            ),
            "image",
            True,
        )
    if event_type == "location":
        addr = (text or "").strip()
        wait_loc = (get_sess(uid) or {}).get("wait")
        if wait_loc in (
            "pickup_item",
            "pickup_when",
            "pickup_loc",
            "pickup_addr",
            "pickup_phone",
            "pickup_confirm",
        ):
            if not addr:
                if wait_loc == "pickup_phone":
                    return _pack(_ask_pickup_phone(uid), "pickup", False)
                return _pack(
                    say("位置我沒收到，再傳一次，或改用打字。", actions=_location_actions()),
                    "pickup",
                    False,
                )
            set_sess(uid, pickup_addr=addr)
            return _pack(
                _ack_then_next(
                    uid,
                    _pick_variant(uid, "pickup_addr_ack", ("好，記下了。", "收到。")),
                ),
                "pickup",
                False,
            )
        return _pack(
            say("位置我收到了。您是要預約外收送嗎？", buttons=[("外收送預約", "外收送預約")]),
            "pickup",
            False,
        )
    if event_type == "sticker":
        # R6
        return _pack([text_msg("😊 有需要再跟我說。")], "ack", False)

    t = (text or "").strip()
    n = t.replace(" ", "").replace("？", "").replace("?", "")
    _pack.text = n
    sess = get_sess(uid)
    wait = sess.get("wait")
    catalog = _flat_catalog()

    if wait == "payment_check" and n in ("稍後再傳", "先不用", "不用了", "取消付款"):
        set_sess(uid, wait=None)
        return _pack(say("好，先不用急著付款；等櫃台確認金額後再付就好。"), "payment_check", False)
    if _is_payment_claim(t):
        return _payment_claim_reply(uid, t, event_id)

    if wait == "photo":
        if not _photo_wait_alive(uid):
            _clear_photo_wait(uid)
            wait = None
        elif n in _PRICE_MENU:
            _clear_photo_wait(uid)
            wait = None
        else:
            _pack.photo_funnel = True

    MENU = {
        "外收送預約", "外收", "外收送", "到府收送", "收送",
        "物件查詢", "查件", "查衣服", "好了沒", "可以取了嗎", "入庫了嗎",
        "進度查詢", "查件進度", "進度",
        "預約到店", "預約", "約時間", "價目表", "看價目表", "LINE Pay",
        "拍照問價", "常見問題", "找真人", "我要洗東西",
        "送洗前必看",
    }
    if n in MENU and wait and wait != "photo":
        set_sess(uid, wait=None)
        wait = None
    if wait == _PHOTO_NEED_WAIT and n and n not in MENU:
        if n == "我想問別的":
            set_sess(uid, wait=None)
            return _pack(
                say("好啊，你想問什麼？", buttons=_PHOTO_ASK_QR),
                "photo_ask",
                False,
            )
        if n in _PHOTO_NEED_MAP or _is_photo_need_free(t, n):
            return _pack(_ack_photo_need_msgs(uid, t, n), "photo_need", True)
    if wait == "pickup_item" and n and n not in MENU:
        diverted = _addr_divert_intent(t, n)
        if diverted:
            set_sess(uid, wait=None)
            msgs, meta = handle_ex(uid, text, event_type)
            return _pack(list(msgs), meta.get("intent") or diverted, bool(meta.get("notify_staff")))
        collected = _try_collect_pickup_fact(uid, t)
        if collected:
            return _pack(collected, "pickup", False)
        bid = (get_sess(uid) or {}).get("pickup_id") or (get_sess(uid) or {}).get("last_booking") or ""
        _patch_booking(bid, item=n)
        notified = _push_pickup_item(uid, bid, n)
        set_sess(uid, wait=None, pickup_item=n)
        return _pack(
            say(
                _pick_variant(
                    uid,
                    "pickup_item_ack",
                    ("好，記下來了。到時候見。", "OK，到時候見。"),
                )
            ),
            "pickup",
            notified,
        )
    if wait == "pickup_when" and n and n not in MENU:
        if n == "改地址或電話":
            return _pack(start_pickup(uid, force_new=True), "pickup", False)
        diverted = _addr_divert_intent(t, n)
        if diverted:
            set_sess(uid, wait=None)
            msgs, meta = handle_ex(uid, text, event_type)
            return _pack(list(msgs), meta.get("intent") or diverted, bool(meta.get("notify_staff")))
        opt = _match_pickup_slot(n)
        if opt:
            return _pack(_apply_pickup_when(uid, opt["start"], opt["slot"]), "pickup", False)
        spoken_dt = journey_ux.spoken_datetime(sys.modules[__name__], n)
        if spoken_dt is not None:
            slot = _pickup_slot_spoken(spoken_dt) if not booking_guard(spoken_dt) else ''
            return _pack(_apply_pickup_when(uid, spoken_dt, slot), 'pickup', False)
        collected = _try_collect_pickup_fact(uid, t)
        if collected:
            return _pack(collected, "pickup", False)
        return _pack(say("選下面的時間就好。", actions=_pickup_when_actions(uid)), "pickup", False)
    if wait == "pickup_loc" and n and n not in MENU:
        if n == "改地址或電話":
            return _pack(start_pickup(uid, force_new=True), "pickup", False)
        diverted = _addr_divert_intent(t, n)
        if diverted:
            set_sess(uid, wait=None)
            msgs, meta = handle_ex(uid, text, event_type)
            return _pack(list(msgs), meta.get("intent") or diverted, bool(meta.get("notify_staff")))
        if n == "我用打字的":
            set_sess(uid, wait="pickup_addr")
            return _pack(say("好，把地址打給我就行。門牌號碼也寫上。"), "pickup", False)
        collected = _try_collect_pickup_fact(uid, t)
        if collected:
            return _pack(collected, "pickup", False)
        if _looks_like_address(t):
            set_sess(uid, pickup_addr=t)
            return _pack(_after_pickup_address(uid), "pickup", False)
        return _pack(
            say("點下面按鈕傳位置最快，或改用打字。", actions=_location_actions()),
            "pickup",
            False,
        )
    if wait == "pickup_addr" and n and n not in MENU:
        if n == "改地址或電話":
            return _pack(start_pickup(uid, force_new=True), "pickup", False)
        # M4：意圖優先於地址；明顯不是地址就不存
        diverted = _addr_divert_intent(t, n)
        if diverted:
            set_sess(uid, wait=None)
            msgs, meta = handle_ex(uid, text, event_type)
            set_sess(uid, wait="pickup_addr")
            reminder = text_msg("這個我先幫你處理。地址方便的時候再給我就好。")
            out = list(msgs) + [reminder]
            return _pack(out, meta.get("intent") or diverted, bool(meta.get("notify_staff")))
        collected = _try_collect_pickup_fact(uid, t)
        if collected:
            return _pack(collected, "pickup", False)
        if not _looks_like_address(t):
            return _pack(
                say("這樣我可能會送錯，你把門牌號碼也給我好嗎？"),
                "pickup",
                False,
            )
        set_sess(uid, pickup_addr=t)
        return _pack(_after_pickup_address(uid), "pickup", False)
    if wait in ("pickup_phone", "pickup_contact_alternative") and n and n not in MENU:
        if n == "改地址或電話":
            return _pack(start_pickup(uid, force_new=True), "pickup", False)
        if wait == "pickup_contact_alternative" and n == "找店員安排收送":
            pending = get_sess(uid)
            saved = _push_ask(uid, "收送聯絡方式需店員協助；尚未成立預約。希望時間：" +
                str(pending.get("pickup_when", "")) + "；地址：" + str(pending.get("pickup_addr", "")) +
                "；客人說：" + str(pending.get("pickup_contact_note", "只有市話或不方便留手機")))
            set_sess(uid, wait=None)
            return _pack(say("時間、地址和聯絡需求已留給店員，請店員在這裡接著安排。這筆還沒成立。" if saved else
                "這次需求沒能存下來，麻煩直接打給店裡安排。", actions=[
                {"type": "uri", "label": "打給店裡安排", "uri": "tel:" + PHONE}]), "human", True)
        if any(k in n for k in ("只有市話", "沒有手機", "沒手機", "不想留電話", "不方便留電話")):
            # Keep the collected time/address, but do not create a booking with
            # an invalid mobile number. Staff can arrange an alternative.
            set_sess(uid, wait="pickup_contact_alternative", pickup_contact_note=t)
            return _pack(say(
                "沒關係，只有市話也可以先打給店裡安排。線上這筆還沒成立，剛剛填的時間和地址會保留。",
                actions=[{"type": "uri", "label": "打給店裡安排", "uri": "tel:" + PHONE},
                         {"type": "message", "label": "改留手機", "text": "修改收送電話"},
                         {"type": "message", "label": "請店員協助", "text": "找店員安排收送"}]), "pickup", False)
        diverted = _addr_divert_intent(t, n)
        if diverted:
            set_sess(uid, wait=None)
            msgs, meta = handle_ex(uid, text, event_type)
            return _pack(list(msgs), meta.get("intent") or diverted, bool(meta.get("notify_staff")))
        if n == "用上次的電話" or n.startswith("用上次的"):
            phone = (_profile_get(uid).get("phone") or "").strip()
            if phone:
                set_sess(uid, pickup_phone=phone)
                return _pack(_pickup_next_missing(uid), "pickup", False)
        collected = _try_collect_pickup_fact(uid, t)
        if collected:
            return _pack(collected, "pickup", False)
        phone = normalize_mobile(t)
        if phone:
            set_sess(uid, pickup_phone=phone)
            return _pack(_pickup_next_missing(uid), "pickup", False)
        return _pack(
            say(
                _pick_variant(
                    uid,
                    "pickup_phone_bad",
                    (
                        "這號碼好像少幾碼？09 開頭十碼給我一下。",
                        "好像不對耶，09 開頭的手機十碼。",
                    ),
                )
            ),
            "pickup",
            False,
        )
    if wait == "pickup_confirm" and n and n not in MENU:
        diverted = _addr_divert_intent(t, n)
        if diverted:
            set_sess(uid, wait=None)
            msgs, meta = handle_ex(uid, text, event_type)
            return _pack(list(msgs), meta.get("intent") or diverted, bool(meta.get("notify_staff")))
        collected = _try_collect_pickup_fact(uid, t)
        if collected:
            return _pack(collected, "pickup", False)
        taken = _accept_preconfirm_item(uid, n)
        if taken:
            return _pack(taken, "pickup", False)
        return _pack(_pickup_confirm_msgs(uid), "pickup", False)
    if wait == "query_phone_choice" and n and n not in MENU:
        if n == "就用這支":
            phone = (get_sess(uid).get("query_phone") or _profile_get(uid).get("phone") or "").strip()
            set_sess(uid, wait="query_item", query_phone=phone, phone_ts=now_tw().isoformat())
            return _pack(
                say(
                    _pick_variant(uid, "query_ask_item", ("是哪一件？", "哪一件？")),
                    buttons=_QUERY_ITEM_QR,
                ),
                "query",
                False,
            )
        if n == "換一支":
            set_sess(uid, wait="query_phone", query_phone="")
            return _pack(
                say(
                    _pick_variant(
                        uid,
                        "query_ask_phone",
                        (
                            "我幫你問櫃台，手機給我一下？",
                            "好，我問櫃台。手機號碼給我？",
                        ),
                    )
                ),
                "query",
                False,
            )
        phone = normalize_mobile(t)
        if phone:
            _profile_save(uid, phone=phone)
            set_sess(uid, wait="query_item", query_phone=phone, phone_ts=now_tw().isoformat())
            return _pack(
                say(
                    _pick_variant(uid, "query_ask_item", ("是哪一件？", "哪一件？")),
                    buttons=_QUERY_ITEM_QR,
                ),
                "query",
                False,
            )
        if _query_should_leave(t, n):
            set_sess(uid, wait=None)
            wait = None
        else:
            return _pack(
                say(
                    "用上次的嗎？選下面就好。",
                    buttons=[("就用這支", "就用這支"), ("換一支", "換一支")],
                ),
                "query",
                False,
            )
    if wait == "query_phone" and n and n not in MENU:
        phone = normalize_mobile(t)
        if phone:
            _profile_save(uid, phone=phone)
            set_sess(uid, wait="query_item", query_phone=phone, phone_ts=now_tw().isoformat())
            return _pack(
                say(
                    _pick_variant(uid, "query_ask_item", ("是哪一件？", "哪一件？")),
                    buttons=_QUERY_ITEM_QR,
                ),
                "query",
                False,
            )
        if _query_should_leave(t, n):
            set_sess(uid, wait=None)
            wait = None
        else:
            return _pack(
                say(
                    _pick_variant(
                        uid,
                        "query_phone_bad",
                        (
                            "這號碼好像少幾碼？09 開頭十碼給我一下。",
                            "好像不對耶，09 開頭的手機十碼。",
                        ),
                    )
                ),
                "query",
                False,
            )
    if wait == "query_item" and n and n not in MENU:
        known_item = bool(intents.match_item_ex(t, catalog)[0])
        if n in _QUERY_ITEMS or ((known_item or (len(n) >= 3 and _looks_like_laundry_talk(t))) and not _query_should_leave(t, n)):
            phone = get_sess(uid).get("query_phone") or ""
            set_sess(uid, wait=None)
            notified = _push_query_handoff(uid, phone, n)
            return _pack(
                say(
                    _pick_variant(
                        uid,
                        "query_sent",
                        ("好，手機和品項已記下，請櫃台查好後在這裡回覆你。", "收到，我把手機和品項交給櫃台查，查好後再回覆你。"),
                    )
                ),
                "query",
                notified,
            )
        if _query_should_leave(t, n):
            set_sess(uid, wait=None)
            wait = None
        else:
            return _pack(
                say(
                    _pick_variant(uid, "query_ask_item", ("是哪一件？", "哪一件？")),
                    buttons=_QUERY_ITEM_QR,
                ),
                "query",
                False,
            )
    if wait == "query" and n and n not in MENU:
        # M3：只有查詢碼才查；不像的話離開查件模式走一般流程
        if _is_query_code(t):
            msgs, notified = tell_status_ex(uid, t)
            return _pack(msgs, "query", notified)
        set_sess(uid, wait=None)
        wait = None

    voice = _voice_meta_intent(t, n)
    if voice == "who_am_i":
        return _pack(say(_WHO_AM_I_REPLY, buttons=_WHO_AM_I_QR), "who_am_i", False)
    if voice == "meta_feedback":
        return _pack(say(_META_FEEDBACK_REPLY, buttons=_META_FEEDBACK_QR), "meta_feedback", False)
    if voice == "human":
        _push_ask(uid, "客人要找真人")
        return _pack(say(_HUMAN_REPLY), "human", True)

    # U5：拍照問價（客人還沒傳照片，不吵店員）
    if _is_photo_quote(n):
        set_sess(uid, wait="photo", photo_wait_ts=now_tw().isoformat(), photo_nudged=False)
        _pack.photo_funnel = False
        return _pack(photo_quote_reply(uid), "photo_quote", False)

    if n in ("常見問題", "FAQ", "faq"):
        return _pack(faq_menu(), "faq", False)
    if n == "我還是想問人":
        _push_ask(uid, "客人要找真人")
        return _pack(say(_HUMAN_REPLY), "human", True)
    if n in _FAQ_ANSWERS or n in _FAQ_ALIASES:
        return _pack(faq_answer(_FAQ_ALIASES.get(n, n)), "faq", False)

    # 客人自然問句：先回答能確定的事，不能保證的事給明確下一步。
    natural = _natural_customer_question(uid, t, n)
    if natural is not None:
        msgs, intent, notify = natural
        return _pack(msgs, intent, notify)

    # M5：英文問候整句相等；中文維持子字串
    if any(k in n for k in ["你好", "您好", "嗨", "哈囉"]) or n.lower() in ("hi", "hello", "hey", "yo"):
        return _pack(welcome(uid), "welcome", False)

    if n in ("作品", "作品案例", "案例", "看作品"):
        return _pack([text_msg("這是我們常做的幾類。您要送哪一種，跟我說就好。"), works_flex()], "works", False)
    if n in ("到店禮遇", "禮遇", "優惠"):
        return _pack([text_msg("先跟您說清楚，我們不在線上亂開折扣。"), courtesy_flex()], "courtesy", False)
    if n in ("我的預約", "預約紀錄"):
        return _pack(my_booking(uid), "my_booking", False)
    if n in ("再問一次", "會員"):
        return _pack(wash_ask(), "wash_ask", False)

    # R2 ack（整句只由致謝／附和組成才算，避免「好了嗎」）
    if intents.is_ack(t):
        msg = _pick_variant(uid, "ack", _ACK_VARIANTS)
        return _pack([text_msg(msg)], "ack", False)

    # R2 in_store / F4 / K7 / M7：明確到店句，或整句等於「到了」等；不含「嗎」
    if _is_in_store_text(t, n):
        return _pack(say("好，跟櫃台說一聲從 LINE 來的，我們幫您看件。"), "in_store", True)

    # R2 cancel
    if _is_cancel_text(n):
        last = last_active_booking(uid)
        if not last:
            # F2：沒預約不叮店員，給一顆重約
            return _pack(
                say("目前沒有幫您留的時間。", buttons=[("約時間", "預約到店")]),
                "cancel",
                False,
            )
        rec = {
            "id": last.get("id"),
            "uid": uid,
            "kind": "cancel",
            "ts": now_tw().isoformat(),
        }
        append_book(rec)
        when_s = (last.get("when") or "").replace("T", " ")
        return _pack(
            say(
                f"好，{when_s} 這筆我幫您取消了，要重約再跟我說",
                buttons=[("重約", "預約到店")],
            ),
            "cancel",
            True,
        )

    if n in ("預約到店", "預約", "約時間", "這週到店", "我要預約", "預約這個", "立即預約") or n.startswith("預約"):
        item = get_sess(uid).get("last_item")
        if n.startswith("預約") and n not in ("預約到店", "預約", "預約這個"):
            maybe = n.replace("預約", "")
            if maybe in CATS:
                set_sess(uid, last_item=maybe)
                item = maybe
        return _pack(
            [text_msg("您選一個方便到店的時間。週日我們公休。"), booking_flex(item)],
            "booking",
            False,
        )

    # M7：幾點／什麼時候 + 收件／收送 → 營業時間
    if _is_pickup_hours_text(n):
        return _pack(_hours_with_pickup_note(n), "hours_day", False)

    # R2 pickup（W4：進場不通知，確認後才通知）
    if _is_pickup_text(n):
        return _pack(start_pickup(uid), "pickup", False)

    # R2 query
    if _is_query_text(n):
        msgs, notified = start_query(uid)
        return _pack(msgs, "query", notified)

    # R2 hours_day
    if _is_hours_query(n):
        return _pack(hours_reply(n), "hours_day", False)

    if n in ("價目", "價目表", "價格表", "menu", "服務價目", "先看價錢", "看價目表"):
        return _pack(
            [text_msg("我先給您常洗的幾類，左右滑。沒有的再問我。"), price_carousel()],
            "prices",
            False,
        )

    if n in CATS:
        return _pack(
            say(f"{n}我幫您攤開。", "沒列到的，直接打品名給我。") + [cat_list_flex(n)],
            "prices",
            False,
        )

    if any(k in n.lower() for k in ["linepay", "line pay"]) or n == "LINE Pay":
        return _pack(pay_guide(), "pay", False)
    if "pay" in n.lower() and "line" in n.lower():
        return _pack(pay_guide(), "pay", False)

    if n in ("我想洗", "想送洗", "今天想洗什麼", "今天想洗", "我要洗東西"):
        return _pack(wash_ask(), "wash_ask", False)

    if n == "送洗前必看":
        return _pack(pre_wash_notes(), "pre_wash", False)

    # K5：用 normalize 後的字串判斷，讓 K4 長度守衛生效。
    # 價目同時有西裝與西褲時，以西裝開頭的句子留給下面的逐件報價，不進洗法總說明。
    wash_norm = intents.normalize(t)
    suit_wash = _suit_parts_ready() and wash_norm.startswith("西裝") and wash_norm != "西裝背心"
    if any(k in wash_norm for k in ("乾洗", "水洗", "柔洗", "送洗")) and not suit_wash:
        return _pack(wash_type_reply(), "wash_type", False)

    if any(k in n for k in ["地址", "位置", "地圖", "怎麼去", "在哪", "店址", "先看位置", "門市資訊"]):
        body = f"我們在{LANDMARK}，{ADDR}。"
        if MAP:
            body += f"\n{MAP}"
        return _pack(
            say(body + "\n" + HOURS + "\n送洗不用預約，營業時間直接帶來就好。", actions=[{'type':'uri','label':'開啟地圖','uri':MAP}] + [{'type':'uri','label':'打給店裡','uri':'tel:'+PHONE}] if MAP else [{'type':'uri','label':'打給店裡','uri':'tel:'+PHONE}]),
            "location",
            False,
        )

    if n in ("電話", "打電話", "致電", "我自己打"):
        return _pack(say(f"店裡 {PHONE}。", "打不通再傳訊息給我。", buttons=next_qr_items()), "phone", False)

    if n in ("不確定", "不知道", "我再看看"):
        return _pack(
            say("沒關係。", "到店看過再報，比較準。您要留一個時間嗎？", buttons=[("約時間", "預約到店"), ("先看價目", "價目表")]),
            "clarify",
            False,
        )

    can_wash = any(k in n for k in ["可以洗嗎", "能洗嗎", "敢洗嗎", "能不能洗"])
    luxury = any(k in n for k in ["名牌", "皮革", "皮", "精品"])
    # R2：可以洗嗎 只有名牌／皮革／皮／精品才走舊段
    if can_wash and luxury:
        return _pack(
            say(
                "名牌、皮革我們有收，但一定是看過再收，不會先跟您說一定沒問題。",
                "您方便帶過來，還是先傳照片給我轉店裡？",
                buttons=[("我到店", "預約到店"), ("先問價錢", "價目表")],
            ),
            "concern",
            False,
        )

    hit = concern(n, uid)
    if hit:
        return _pack(hit, "concern", _is_rush_text(n))

    # R1 / K1 品名比對
    hits, kind = intents.match_item_ex(t, catalog)
    norm = intents.normalize(t)
    # M2：normalize 後以西裝開頭（且不是整句西裝背心）走反問，不得配到西裝背心
    if (norm.startswith("西裝") and norm != "西裝背心") or (
        n.startswith("西裝") and intents.normalize(n) != "西裝背心"
    ):
        suit_key = norm if norm.startswith("西裝") and norm != "西裝背心" else intents.normalize(n)
        if "西裝" in catalog and "西褲" in catalog:
            if suit_key.startswith("西裝褲"):
                return _pack(_quote_item(uid, "西褲"), "quote", False)
            if suit_key in ("西裝", "西裝外套", "西裝上衣", "西裝上身"):
                return _pack(_suit_jacket_quote(uid), "quote", False)
            phrase = _suit_phrase_messages(uid, suit_key)
            if phrase is not None:
                return _pack(phrase, "quote", False)
            return _pack(
                say(
                    "、".join(_suit_piece_bits()) + "。",
                    "您要洗哪一件？",
                    buttons=_suit_clarify_buttons(),
                ),
                "clarify",
                False,
            )
        return _pack(
            say(
                "西裝外套還是西裝褲？",
                "價目目前列的是西裝背心；外套跟褲子建議到店看件。",
                buttons=[("西裝背心", "西裝背心"), ("到店看", "預約到店")],
            ),
            "clarify",
            False,
        )

    sheet = {"床單被套薄", "床單被套厚"}
    if hits and sheet.issubset(set(hits)) and "薄" not in n and "厚" not in n:
        return _pack(
            say(
                "床單被套啊。",
                f"薄的 {_labeled_price('床單被套薄')}，厚的 {_labeled_price('床單被套厚')}。您那套是薄的還是厚的？",
                buttons=[("薄的", "床單被套薄"), ("厚的", "床單被套厚")],
            ),
            "clarify",
            False,
        )

    if (
        hits
        and set(hits) <= {"棉被單人", "棉被雙人"}
        and "單人" not in n
        and "雙人" not in n
        and ("棉被" in n or norm == "棉被")
    ):
        return _pack(_quilt_clarify(), "clarify", False)

    aside_wash = "可以，一般都能洗" if can_wash else ""
    # K1：只有 exact／synonym／contains 且唯一才直接報價；方向 B 一律反問
    if kind in ("exact", "synonym", "contains") and len(hits) == 1:
        name = hits[0]
        found = lookup_item(name)
        extra = aside_wash
        if found and found[2] == "皮革":
            extra = (aside_wash + "。" if aside_wash else "") + "皮革發霉、特污會另計，我先講。"
        if found:
            return _pack(_quote_item(uid, name, extra), "quote", False)
        return _pack(quote(name, catalog[name], uid, extra), "quote", False)

    # K3：類別詞（正規化後整句）走手寫或動態反問，贏過最長品名
    if norm in _CATEGORY_WORDS:
        cat_msgs = _cat_clarify(norm, catalog)
        if cat_msgs:
            intent = "prices" if norm == "寢具" else "clarify"
            return _pack(cat_msgs, intent, False)

    if kind == "prefix" or len(hits) > 1:
        shown, has_lux = _prefer_general(hits)
        extra = "精品款另計，到店看件再報。" if has_lux else ""
        second = extra + "\n您是哪一個？" if extra else "您是哪一個？"
        buttons = [(h, h) for h in (shown or hits)[:4]]
        return _pack(say("我對到幾項。", second, buttons=buttons), "clarify", False)

    exact = lookup_item(n)
    if exact:
        item, price, cat = exact
        extra = aside_wash
        if cat == "皮革":
            extra = (aside_wash + "。" if aside_wash else "") + "皮革發霉、特污會另計，我先講。"
        return _pack(quote(item, price, uid, extra), "quote", False)

    if any(k in n for k in ["棉被", "寢具", "羽絨被"]):
        if "單人" in n:
            return _pack(_quote_item(uid, "棉被單人", aside_wash), "quote", False)
        if "雙人" in n:
            return _pack(_quote_item(uid, "棉被雙人", aside_wash), "quote", False)
        if "羽絨" in n:
            target = "羽絨被" if _down_quilt_split(catalog) else "羽絨羊毛被"
            return _pack(_quote_item(uid, target, aside_wash), "quote", False)
        return _pack(_quilt_clarify(), "clarify", False)

    if "運動鞋" in n:
        return _pack(
            _quote_item(
                uid,
                "一般運動鞋",
                aside_wash or f"皮料的大概 {_labeled_price('皮類運動鞋')}，混合的 {_labeled_price('混合運動鞋')}。",
            ),
            "quote",
            False,
        )
    if any(k in n for k in ["鞋子", "洗鞋", "球鞋"]):
        return _pack(
            say(
                "鞋子，好。",
                "運動鞋還是皮鞋？名牌的話跟我說，價錢不一樣。",
                buttons=[("運動鞋", "運動鞋"), ("皮鞋", "皮鞋"), ("名牌鞋", "名牌鞋"), ("不確定", "不確定")],
            ),
            "clarify",
            False,
        )

    if any(k in n for k in ["包包", "皮包", "名牌包"]):
        if "名牌" in n:
            return _pack(
                _quote_item(
                    uid,
                    "名牌包",
                    aside_wash or f"特殊款會到 {_labeled_price('特殊類名牌包')}，一定看過再定。",
                ),
                "quote",
                False,
            )
        if n in ("皮包包", "皮包"):
            return _pack(_quote_item(uid, "皮包包", aside_wash), "quote", False)
        return _pack(
            say("包包我先問您。", "一般包、皮包，還是名牌？", buttons=[("一般包", "一般包"), ("皮包", "皮包包"), ("名牌包", "名牌包")]),
            "clarify",
            False,
        )

    if n == "外套":
        cat_msgs = _cat_clarify("外套", catalog)
        if cat_msgs:
            return _pack(cat_msgs, "clarify", False)
    if n == "洋裝":
        cat_msgs = _cat_clarify("洋裝", catalog)
        if cat_msgs:
            return _pack(cat_msgs, "clarify", False)
    if any(k in n for k in ["衣服", "洗衣"]):
        return _pack(
            say("衣服，好。", "襯衫長褲，還是外套、洋裝？", buttons=[("襯衫", "襯衫"), ("長褲", "長褲"), ("外套", "外套"), ("洋裝", "洋裝")]),
            "clarify",
            False,
        )
    if "皮衣" in n:
        return _pack(
            _quote_item(
                uid,
                "皮衣",
                aside_wash or f"特殊皮衣 {_labeled_price('特殊皮衣')}。發霉會另計。",
            ),
            "quote",
            False,
        )

    # R2 unknown_item
    blob = t + n
    if any(k in blob for k in intents.UNKNOWN_ITEMS):
        return _pack(
            say(
                "這類不在常規價目，要看件才能報。",
                "我先轉店裡，您方便的話拍張照給我。",
            ),
            "unknown_item",
            True,
        )

    # R2 ask_price：只有價錢詞、沒品名
    if any(k in n for k in ["多少錢", "價格", "怎麼算"]) or norm == "":
        if any(k in n for k in ["多少錢", "價格", "怎麼算", "價錢", "多少"]):
            return _pack(
                say(
                    "您是問哪一類的價錢？",
                    "棉被、鞋子、包包，還是衣服？",
                    buttons=_CAT_QR,
                ),
                "ask_price",
                False,
            )

    # V4／V5 fallback（覆寫 R3 文案與「長度≥2 就通知」）
    msgs, notify = _do_fallback(uid, t)
    return _pack(msgs, "fallback", notify)


def handle(uid: str, text: str, event_type: str = "message") -> list[dict]:
    return handle_ex(uid, text, event_type)[0]
