"""Fail-closed customer progress lookup over a read-only connector."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from connectors.base import Connector, normalize_phone


def extract_phone(raw_text: str) -> str | None:
    """Extract and normalize a Taiwan phone number from freeform text.

    Supports:
    - 0958373456 (10 continuous digits)
    - 0958-373-456, 0958 373 456, 0958.373.456
    - 0958-373456, 0958373-456
    - 手機0958373456, 查0958-373-456, 0958373456查件
    - ０９５８３７３４５６ (full-width digits/symbols)
    - 04-24527411, 0424527411 (Taiwan landlines)
    """
    if not raw_text:
        return None

    norm = unicodedata.normalize("NFKC", str(raw_text)).strip()

    # 1. Search for 09 mobile pattern first (most common, e.g. 0912-345-678)
    m = re.search(r"(?:^|[^\d])(09[\d\s\-\.]{8,14}\d)(?:[^\d]|$)", norm)
    if m:
        candidate = m.group(1)
        digits = re.sub(r"\D", "", candidate)
        if len(digits) == 10 and digits.startswith("09"):
            return digits

    # 2. Check if whole text stripped of separators is 10 digits starting with 09
    digits_only = re.sub(r"\D", "", norm)
    if len(digits_only) == 10 and digits_only.startswith("09"):
        return digits_only

    # 3. Search for Taiwan landline (02~08, 9~10 digits)
    m_land = re.search(r"(?:^|[^\d])(0[2-8][\d\s\-\.]{7,13}\d)(?:[^\d]|$)", norm)
    if m_land:
        candidate = m_land.group(1)
        digits = re.sub(r"\D", "", candidate)
        if len(digits) in (9, 10):
            return digits

    return None


def lookup_by_phone(connector: Connector, phone: str) -> dict[str, Any]:
    """Return a safe machine-readable result for a full Taiwan mobile or landline number."""
    normalized_phone = normalize_phone(phone)
    is_mobile = len(normalized_phone) == 10 and normalized_phone.startswith("09")
    is_landline = len(normalized_phone) in (9, 10) and normalized_phone.startswith("0")
    if not (is_mobile or is_landline):
        return {
            "status": "invalid_input",
            "message": "請提供完整的手機號碼（09 開頭）或市話號碼，店員才能幫您查件。",
        }

    snapshot = connector.read_snapshot()
    base = {
        "source": snapshot.source,
        "source_state": snapshot.state,
        "read_at": snapshot.read_at,
    }
    if snapshot.state != "available":
        return {
            **base,
            "status": "manual_required",
            "message": "我現在連不到店內查件資料，先請店裡人工幫您確認，避免回錯進度。",
            "detail": snapshot.detail,
        }

    matches = []
    for customer in snapshot.customers:
        phones = [customer.get("phone"), customer.get("mobile")]
        if any(normalize_phone(value) == normalized_phone for value in phones):
            matches.append(customer)
    if not matches:
        return {
            **base,
            "status": "not_found",
            "message": "目前查不到這個手機號碼的案件，請確認是否留的是送洗時的完整手機號碼。",
        }
    # Collect all pieces belonging to any of the matched profiles
    matching_cids = {str(c.get("customer_id") or "") for c in matches}
    cid_to_cust = {str(c.get("customer_id") or ""): c for c in matches}
    cid_to_name = {str(c.get("customer_id") or ""): str(c.get("name") or "").strip() for c in matches}
    pieces = [
        piece for piece in snapshot.pieces
        if str(piece.get("customer_id") or "") in matching_cids and piece.get("status") != "picked"
    ]

    # Determine customer from active pieces if multiple matches
    active_cids = {str(piece.get("customer_id") or "") for piece in pieces}
    active_custs = [c for c in matches if str(c.get("customer_id") or "") in active_cids]
    if active_custs:
        primary_cust = active_custs[0]
        matched_id = "/".join(str(c.get("customer_id") or "") for c in active_custs)
        customer_name = " / ".join(dict.fromkeys(str(c.get("name") or "").strip() for c in active_custs if c.get("name")))
        overm = sum(c.get("overm", 0) for c in active_custs)
        svm = sum(c.get("svm", 0) for c in active_custs)
        customer_phone = str(primary_cust.get("mobile") or primary_cust.get("phone") or normalized_phone).strip()
    else:
        primary_cust = matches[0]
        matched_id = str(primary_cust.get("customer_id") or "")
        customer_name = str(primary_cust.get("name") or "").strip()
        overm = primary_cust.get("overm", 0)
        svm = primary_cust.get("svm", 0)
        customer_phone = str(primary_cust.get("mobile") or primary_cust.get("phone") or normalized_phone).strip()

    if not pieces:
        return {
            **base,
            "status": "not_found",
            "customer_id": matched_id,
            "customer_name": customer_name,
            "customer_phone": customer_phone,
            "overm": overm,
            "svm": svm,
            "message": f"找到客戶【{customer_name}】（客號:{matched_id}），目前店內沒有未取的送洗衣物。",
        }

    statuses = {str(piece.get("status") or "processing") for piece in pieces}
    if statuses <= {"ready", "picked"}:
        status = "found_ready"
        message = "您的衣物已完成，請依店家通知時間取件；若已取件也可以直接忽略這則訊息。"
    else:
        status = "found_not_ready"
        message = "已查到您的送洗資料，目前還在處理中；完成後店裡會再通知您。"
    return {
        **base,
        "status": status,
        "customer_id": matched_id,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "overm": overm,
        "svm": svm,
        "message": message,
        "pieces": [
            {
                "order_no": piece.get("order_no", ""),
                "item": piece.get("item", ""),
                "status": piece.get("status", "processing"),
                "price": piece.get("price"),
                "received_at": piece.get("received_at", ""),
                "ready_at": piece.get("ready_at", ""),
                "location": piece.get("location", ""),
            }
            for piece in pieces
        ],
    }


def lookup_by_customer_id(connector: Connector, customer_id: str) -> dict[str, Any]:
    """Return a safe progress lookup result by eHank Customer ID (客號)."""
    clean_id = str(customer_id or "").strip()
    if not clean_id:
        return {
            "status": "invalid_input",
            "message": "請提供有效的客戶編號（例如 客號 0034）。",
        }

    snapshot = connector.read_snapshot()
    base = {
        "source": snapshot.source,
        "source_state": snapshot.state,
        "read_at": snapshot.read_at,
    }
    if snapshot.state != "available":
        return {
            **base,
            "status": "manual_required",
            "message": "我現在連不到店內查件資料，先請店裡人工幫您確認，避免回錯進度。",
            "detail": snapshot.detail,
        }

    # Match exact, zero-padded, or zero-stripped customer_id
    target_ids = {clean_id, clean_id.zfill(4), clean_id.lstrip("0") or "0"}
    matches = [c for c in snapshot.customers if str(c.get("customer_id") or "").strip() in target_ids]

    if not matches:
        return {
            **base,
            "status": "not_found",
            "message": f"目前查不到客號【{clean_id}】的客戶資料，請確認號碼是否正確，或改用送洗登記的手機號碼查詢。",
        }

    customer = matches[0]
    matched_id = str(customer.get("customer_id") or "")
    customer_name = str(customer.get("name") or "").strip()
    customer_phone = str(customer.get("mobile") or customer.get("phone") or "").strip()
    overm = customer.get("overm", 0)
    svm = customer.get("svm", 0)

    target_match_ids = {matched_id, matched_id.zfill(4), matched_id.lstrip("0") or "0"}
    pieces = [
        piece for piece in snapshot.pieces
        if str(piece.get("customer_id") or "").strip() in target_match_ids and piece.get("status") != "picked"
    ]

    if not pieces:
        return {
            **base,
            "status": "not_found",
            "customer_id": matched_id,
            "customer_name": customer_name,
            "customer_phone": customer_phone,
            "overm": overm,
            "svm": svm,
            "message": f"找到客戶【{customer_name}】（客號:{matched_id}），目前店內沒有未取的送洗衣物。",
        }

    statuses = {str(piece.get("status") or "processing") for piece in pieces}
    if statuses <= {"ready", "picked"}:
        status = "found_ready"
        message = "您的衣物已完成，請依店家通知時間取件；若已取件也可以直接忽略這則訊息。"
    else:
        status = "found_not_ready"
        message = "已查到您的送洗資料，目前還在處理中；完成後店裡會再通知您。"

    return {
        **base,
        "status": status,
        "customer_id": matched_id,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "overm": overm,
        "svm": svm,
        "message": message,
        "pieces": [
            {
                "order_no": piece.get("order_no", ""),
                "item": piece.get("item", ""),
                "status": piece.get("status", "processing"),
                "price": piece.get("price"),
                "received_at": piece.get("received_at", ""),
                "ready_at": piece.get("ready_at", ""),
                "location": piece.get("location", ""),
            }
            for piece in pieces
        ],
    }


def format_phone_display(raw: str) -> str:
    """Format Taiwan mobile or telephone number with readable hyphens."""
    import re
    cleaned = re.sub(r"\D", "", str(raw or ""))
    if len(cleaned) == 10 and cleaned.startswith("09"):
        return f"{cleaned[:4]}-{cleaned[4:7]}-{cleaned[7:]}"
    if len(cleaned) == 10 and cleaned.startswith("0"):
        return f"{cleaned[:2]}-{cleaned[2:6]}-{cleaned[6:]}"
    if len(cleaned) == 9 and cleaned.startswith("0"):
        return f"{cleaned[:2]}-{cleaned[2:5]}-{cleaned[5:]}"
    if cleaned:
        return cleaned
    return str(raw or "").strip()


def get_visual_width(s: str) -> int:
    """Calculate display width for CJK and ASCII characters for alignment."""
    import unicodedata
    w = 0
    for ch in s:
        if unicodedata.east_asian_width(ch) in ("W", "F"):
            w += 2
        else:
            w += 1
    return w


def format_screenshot3_text(result: dict, identifier: str = "") -> str:
    """Format customer lookup output into clean, structured, mobile-optimized card layout."""
    import re
    status = result.get("status")
    if status == "invalid_input":
        return result.get("message", "請輸入有效的手機號碼或門市客號。")
    if status == "manual_required":
        return result.get("message", "目前連線門市系統稍有延遲，店員會盡快手動幫您確認喔！")

    cid = str(result.get("customer_id") or "").strip()
    name = str(result.get("customer_name") or "").strip()
    raw_phone = str(result.get("customer_phone") or "").strip()
    if not raw_phone and identifier and re.sub(r"\D", "", identifier).startswith("09"):
        raw_phone = identifier
    phone_disp = format_phone_display(raw_phone) if raw_phone else "未登記"

    lines = ["【私享家專業洗衣】洗滌進度"]

    # Customer Info Header
    cust_parts = []
    if name:
        cust_parts.append(f"客戶：{name}")
    if cid:
        cust_parts.append(f"（客號 {cid}）" if name else f"客號：{cid}")
    if cust_parts:
        lines.append("👤 " + "".join(cust_parts))
    lines.append(f"📱 手機：{phone_disp}")
    lines.append("─────────────────")

    pieces = result.get("pieces", [])
    overm = result.get("overm", 0)

    # 1. No pieces in store
    if not pieces or status == "not_found":
        lines.append("✨ 目前店內沒有未取的送洗衣物喔！")
        if overm < 0:
            lines.append(f"💳 帳務狀態：取件待付款 {abs(overm):,} 元")
        elif overm > 0:
            lines.append(f"💳 帳務狀態：目前帳戶餘額 {overm:,} 元")
        else:
            lines.append("💳 帳務狀態：均已繳納付款")
        lines.append("─────────────────")
        lines.append("隨時歡迎送洗，營業時間直接前來即可（至善國中對面好停車）！")
        return "\n".join(lines)

    # 2. Has pieces in store
    ready_pieces = [p for p in pieces if p.get("status") == "ready"]
    proc_pieces = [p for p in pieces if p.get("status") != "ready"]
    total_price = sum(int(p.get("price") or 0) for p in pieces)

    # Calculate max label width across all pieces for vertical column alignment
    all_pieces = ready_pieces + proc_pieces
    labels = {id(p): f"  ・{p.get('item', '')} ({p.get('order_no', '')})" for p in all_pieces}
    max_label_w = max((get_visual_width(lbl) for lbl in labels.values()), default=0)

    if ready_pieces:
        lines.append(f"✅ 可以取件囉（共 {len(ready_pieces)} 件）：")
        for p in ready_pieces:
            lbl = labels[id(p)]
            pad = " " * max(1, max_label_w - get_visual_width(lbl) + 1)
            lines.append(f"{lbl}{pad}｜ {p.get('price')} 元")
        lines.append("")

    if proc_pieces:
        lines.append(f"⏳ 清洗處理中（共 {len(proc_pieces)} 件）：")
        for p in proc_pieces:
            lbl = labels[id(p)]
            pad = " " * max(1, max_label_w - get_visual_width(lbl) + 1)
            lines.append(f"{lbl}{pad}｜ {p.get('price')} 元")
        lines.append("")

    if lines[-1] == "":
        lines.pop()

    lines.append("─────────────────")
    lines.append(f"💰 品項合計：{total_price:,} 元")

    if overm < 0:
        lines.append(f"💳 帳務狀態：取件待付款 {abs(overm):,} 元")
    elif overm > 0:
        lines.append(f"💳 帳務狀態：目前帳戶餘額 {overm:,} 元")
    else:
        lines.append("💳 帳務狀態：均已繳納付款")

    lines.append("─────────────────")
    if ready_pieces and not proc_pieces:
        lines.append("🎉 全部衣物皆已完工，營業時間隨時歡迎前來取件（至善國中對面好停車）！")
    else:
        lines.append("營業時間免預約直接前來即可（至善國中對面好停車）！")

    return "\n".join(lines)


