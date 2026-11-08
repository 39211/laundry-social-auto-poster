"""送出邊界的提示去重；只保存既有 uid 及營業／休息區間的時間鍵。"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import tempfile

OFF_HOURS = "現在是非營業時間，店員上班後會回覆你。"
WALK_IN = (
    "送洗不用預約，營業時間直接帶來就好。",
    "送洗不用預約，營業時間帶來就好。",
    "其他營業日直接帶來就好，不用預約。",
)
ADDRESS_WORDS = ("地址", "位置", "地圖", "怎麼去", "怎麼走", "在哪", "店址", "門市資訊", "停車")


def periods(conv, now: datetime) -> tuple[str, str]:
    """營業日＝上次開門至下次開門；休息鍵＝下次開門。共用現役 _span_for。"""
    openings = []
    for offset in range(-7, 8):
        day = now + timedelta(days=offset)
        span = conv._span_for(day.weekday())
        if span is None:
            continue
        hour, minute = map(int, span[0].split("-", 1)[0].split(":"))
        openings.append(day.replace(hour=hour, minute=minute, second=0, microsecond=0))
    previous = max((d for d in openings if d <= now), default=None)
    following = min((d for d in openings if d > now), default=None)
    business = previous.isoformat() if previous else ""
    rest = following.isoformat() if following and conv._closed_reason(now) is not None else ""
    return business, rest


def state_path(conv) -> Path:
    # 與現役 session 使用同一個 data 根；獨立於兩小時 session 的清除。
    return conv.SESS.with_name("line-reply-notices.json")


def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("invalid reply notice state")
    return data


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
        try:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            stream.close()
            temp.unlink(missing_ok=True)
            raise
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def prepare(conv, messages: list[dict], text: str, row: dict, now: datetime) -> tuple[list[dict], dict]:
    business, rest = periods(conv, now)
    asked_address = any(word in text for word in ADDRESS_WORDS)
    asked_reservation = "預約" in text
    seen_business = bool(business and row.get("business_day") == business)
    card = conv.shop_card()
    outgoing = []
    for message in deepcopy(messages):
        if seen_business and not asked_address and message == card:
            continue
        if message.get("type") == "text" and seen_business and not asked_reservation:
            body = message.get("text") or ""
            for line in WALK_IN:
                body = body.replace(line, "")
            # 時間回覆中的順帶地標也屬主動地址提示；被問地點仍保留地址與地圖。
            if not asked_address:
                body = body.replace(f"\n在{conv.LANDMARK}。", "")
            message["text"] = body.strip()
        outgoing.append(message)
    outgoing = outgoing[:5]
    marks = {}
    if business and any(
        (m == card and not asked_address)
        or (m.get("type") == "text" and not asked_reservation
            and any(line in (m.get("text") or "") for line in WALK_IN))
        for m in outgoing
    ):
        marks["business_day"] = business
    if rest and row.get("rest") != rest:
        for message in outgoing:
            if message.get("type") != "text":
                continue
            body = message.get("text") or ""
            # 找真人的既有回覆若已交代打烊後處理，這則不再疊加 F26。
            explained = any(word in body for word in ("營業時間處理", "上班後會回覆", "開門後回覆"))
            if not explained:
                if len(OFF_HOURS) + 1 + len(body) > 5000:
                    continue
                message["text"] = OFF_HOURS + "\n" + body
            marks["rest"] = rest
            break
    return outgoing, marks


def deliver(conv, uid: str, text: str, messages: list[dict], send) -> bool:
    # 沿用估價流程的同客人 RLock。鎖住「讀取→組回覆→送出→成功記錄」，
    # 第二個同客人請求要等第一個的真實送出結果，失敗時仍可補講。
    with conv.quote_flow._lock(uid):
        now = conv.now_tw()
        path = state_path(conv)
        with conv._SESSION_LOCK:
            row = _read(path).get(uid) or {}
        outgoing, marks = prepare(conv, messages, text, row, now)
        if not outgoing:
            return False
        accepted = send(outgoing)
        if accepted is True and marks:
            # 不用送出前讀到的整份資料回寫，避免其他客人的成功紀錄被蓋掉。
            with conv._SESSION_LOCK:
                data = _read(path)
                data[uid] = {**(data.get(uid) or {}), **marks}
                _write(path, data)
        return accepted
