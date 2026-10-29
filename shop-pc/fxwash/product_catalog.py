#!/usr/bin/env python3
"""Sellable product catalogue and selection validation.

This file is intentionally local and data-only.  It does not log in to LINE,
call a model, publish a menu, send a message, or touch a store database.  A
selection describes what a customer bought; the normal shop validation and
handover gates still decide whether that selection is configured and usable.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


CATALOG_VERSION = 1


MODULE_CATALOG: dict[str, dict[str, Any]] = {
    "brand_oa": {
        "label": "品牌基礎與 LINE 選單（規劃／接線）",
        "category": "core",
        "implementation_status": "ready",
        "default": True,
        "description": "店家資料、品牌文案、六格選單規劃與按鈕接線清單。implementation_status=ready 指規劃／接線清單齊備，不含 LINE 平台選單發布（見 package-manifest not_included）。",
        "dependencies": [],
        "setup_requirements": ["店名、地址、電話、營業時間、地圖與選單素材"],
    },
    "human_faq": {
        "label": "真人感客服回覆",
        "category": "core",
        "implementation_status": "ready",
        "default": True,
        "description": "常見問法、引導式回覆、轉真人與店家語氣設定。",
        "dependencies": ["brand_oa"],
        "setup_requirements": ["店家常用說法、服務規則與不可承諾事項"],
    },
    "staff_handoff": {
        "label": "店員接手與群組通知",
        "category": "core",
        "implementation_status": "ready",
        "default": True,
        "description": "把預約、照片、查件與需要人工判斷的案件整理給店員。",
        "dependencies": ["brand_oa"],
        "setup_requirements": ["LINE Channel 憑證、店員群綁定與接手規則"],
    },
    "progress_lookup": {
        "label": "查件進度與金額摘要",
        "category": "core",
        "implementation_status": "ready",
        "default": True,
        "description": "以完整手機號碼查詢件況、品項金額、合計與餘額／欠款。",
        "dependencies": ["brand_oa", "staff_handoff"],
        "setup_requirements": ["門市洗衣系統的唯讀連接器與查件授權測試"],
    },
    "pickup_booking": {
        "label": "外收送引導預約",
        "category": "add_on",
        "implementation_status": "prepared",
        "default": False,
        "description": "用時段、地址、電話與確認卡完成外收送，減少客人打字。",
        "dependencies": ["staff_handoff"],
        "setup_requirements": ["收送範圍、時段、費用、完整手機號碼與店員確認流程"],
    },
    "photo_quote": {
        "label": "照片問價與人工複核",
        "category": "add_on",
        "implementation_status": "prepared",
        "default": False,
        "description": "客人傳照片後，先辨識可見品項與數量，再提供區間估價與但書。",
        "dependencies": ["staff_handoff"],
        "setup_requirements": ["視覺模型、照片告知同意、價格表與人工複核規則"],
    },
    "line_pay_qr": {
        "label": "LINE Pay 客人自行輸入／掃碼付款",
        "category": "add_on",
        "implementation_status": "ready",
        "default": False,
        "description": "提供店家的 LINE Pay 付款入口，客人自行輸入金額；店員依店規核對。",
        "dependencies": ["brand_oa"],
        "setup_requirements": ["店家 LINE Pay 入口網址與人工對帳規則"],
        "payment_mode": "merchant_qr",
    },
    "line_pay_online": {
        "label": "LINE Pay Online API",
        "category": "advanced",
        "implementation_status": "integration_required",
        "default": False,
        "description": "付款請求、回呼、金額核對與案件狀態接線。",
        "dependencies": ["staff_handoff"],
        "setup_requirements": ["商戶憑證、回呼網址、sandbox／正式驗收與對帳規則"],
        "payment_mode": "line_pay_online",
    },
    "loyalty": {
        "label": "集點卡與優惠券",
        "category": "advanced",
        "implementation_status": "prepared",
        "default": False,
        "description": "把集點、券規則與兌換說明納入選單與客服。",
        "dependencies": ["brand_oa", "human_faq"],
        "setup_requirements": ["點數規則、有效期限、優惠券條件與後台建立"],
    },
    "broadcast_content": {
        "label": "LINE 圖文推播內容包",
        "category": "advanced",
        "implementation_status": "prepared",
        "default": False,
        "description": "每月主題、文案、圖片規格與發送前檢查表。",
        "dependencies": ["brand_oa"],
        "setup_requirements": ["活動目標、素材、發送頻率與店主核稿"],
    },
    "social_content": {
        "label": "FB／IG／YouTube／SEO 加購包",
        "category": "add_on",
        "implementation_status": "add_on",
        "default": False,
        "description": "把 LINE 活動延伸到社群與搜尋內容。",
        "dependencies": ["brand_oa"],
        "setup_requirements": ["各平台帳號、品牌素材、發布權限與內容審核人"],
    },
}


STYLE_CATALOG: dict[str, dict[str, Any]] = {
    "heritage_green_gold": {
        "label": "雅緻深綠金",
        "palette": {"primary": "#123C31", "surface": "#F7F1E6", "accent": "#C9975B", "text": "#173B32"},
        "typography": "Noto Serif TC 標題＋Noto Sans TC 內文",
        "tone": "溫和、講究、像熟悉的店員",
        "menu_variant": "real_photo_hero",
        "suitable_for": "精品洗衣、重視質感與信任感的門市",
    },
    "warm_cream": {
        "label": "奶油暖生活",
        "palette": {"primary": "#6A4B3C", "surface": "#FFF8ED", "accent": "#D69B67", "text": "#49352C"},
        "typography": "Noto Sans TC Medium＋圓角按鈕",
        "tone": "親切、安心、適合第一次使用的客人",
        "menu_variant": "guided_cards",
        "suitable_for": "社區型門市、家庭客與長輩客群",
    },
    "clean_teal": {
        "label": "清爽專業藍綠",
        "palette": {"primary": "#075E63", "surface": "#F4FBFA", "accent": "#E8B85C", "text": "#123D40"},
        "typography": "Noto Sans TC Bold＋高對比資訊層級",
        "tone": "清楚、快速、少裝飾",
        "menu_variant": "service_first",
        "suitable_for": "連鎖門市、需要快速查價查件的客群",
    },
    "friendly_sun": {
        "label": "明亮親切橘綠",
        "palette": {"primary": "#2F5D50", "surface": "#FFF5E9", "accent": "#E28A57", "text": "#30463E"},
        "typography": "Noto Sans TC Medium＋大字級導引",
        "tone": "有活力、白話、願意一步一步教客人",
        "menu_variant": "large_guidance",
        "suitable_for": "年輕家庭、學生與高頻日常送洗",
    },
    "modern_mono": {
        "label": "黑白俐落銅色",
        "palette": {"primary": "#202827", "surface": "#F5F5F1", "accent": "#B5794A", "text": "#202827"},
        "typography": "Noto Sans TC Bold＋短句標題",
        "tone": "俐落、可靠、偏商務",
        "menu_variant": "minimal_grid",
        "suitable_for": "商辦區、高端客戶與多分店品牌",
    },
}


PLANS: dict[str, dict[str, Any]] = {
    "starter": {
        "label": "基本客服包",
        "description": "品牌選單、真人感客服、店員接手與查件骨架。",
        "included_modules": ["brand_oa", "human_faq", "staff_handoff", "progress_lookup"],
    },
    "growth": {
        "label": "成長營運包",
        "description": "基本客服再加外收送、照片問價與客人自行付款入口。",
        "included_modules": [
            "brand_oa",
            "human_faq",
            "staff_handoff",
            "progress_lookup",
            "pickup_booking",
            "photo_quote",
            "line_pay_qr",
        ],
    },
    "pro": {
        "label": "品牌經營包",
        "description": "成長營運再加集點、優惠券與 LINE 內容規劃。",
        "included_modules": [
            "brand_oa",
            "human_faq",
            "staff_handoff",
            "progress_lookup",
            "pickup_booking",
            "photo_quote",
            "line_pay_qr",
            "loyalty",
            "broadcast_content",
        ],
    },
    "custom": {
        "label": "客製模組包",
        "description": "依門市營運選擇功能，不自動替客戶開啟高風險整合。",
        "included_modules": [],
    },
}


DEFAULT_STYLE = "heritage_green_gold"
DEFAULT_MODULES = tuple(PLANS["starter"]["included_modules"])


def default_product() -> dict[str, Any]:
    """Return a fresh default selection for a new store."""
    return {
        "plan": "starter",
        "style": DEFAULT_STYLE,
        "modules": list(DEFAULT_MODULES),
    }


def catalog_payload() -> dict[str, Any]:
    """Return a JSON-safe copy for the CLI and customer-facing selector."""
    return {
        "catalog_version": CATALOG_VERSION,
        "default": default_product(),
        "plans": deepcopy(PLANS),
        "modules": deepcopy(MODULE_CATALOG),
        "styles": deepcopy(STYLE_CATALOG),
    }


def selected_product(value: Any) -> dict[str, Any]:
    """Normalize a missing legacy selection without mutating caller data."""
    if value is None:
        return default_product()
    if not isinstance(value, dict):
        return {}
    result = default_product()
    result.update({key: deepcopy(item) for key, item in value.items() if key in {"plan", "style", "modules"}})
    return result


def validate_product(value: Any, *, payment_mode: str | None = None) -> list[str]:
    """Return structural and cross-setting errors for an explicit selection."""
    if value is None:
        return []
    if not isinstance(value, dict):
        return ["product 必須是物件"]

    errors: list[str] = []
    plan = value.get("plan")
    if plan not in PLANS:
        errors.append("product.plan 必須是 starter、growth、pro 或 custom")

    style = value.get("style")
    if style not in STYLE_CATALOG:
        errors.append("product.style 不在可用風格目錄中")

    modules = value.get("modules")
    if not isinstance(modules, list) or not modules:
        errors.append("product.modules 必須是非空陣列")
        modules = []
    elif any(not isinstance(item, str) or not item.strip() for item in modules):
        errors.append("product.modules 每個項目都必須是非空文字")
    if len(modules) != len(set(modules)):
        errors.append("product.modules 不可有重複模組")

    selected = set(modules)
    for key in modules:
        if key not in MODULE_CATALOG:
            errors.append(f"product.modules 含未知模組：{key}")
            continue
        for dependency in MODULE_CATALOG[key]["dependencies"]:
            if dependency not in selected:
                errors.append(f"模組 {key} 需要先選擇 {dependency}")

    if {"line_pay_qr", "line_pay_online"}.issubset(selected):
        errors.append("line_pay_qr 與 line_pay_online 不可同時選擇")
    if "line_pay_qr" in selected and payment_mode not in {None, "merchant_qr"}:
        errors.append("選擇 line_pay_qr 時 payment.mode 必須是 merchant_qr")
    if "line_pay_online" in selected and payment_mode not in {None, "line_pay_online"}:
        errors.append("選擇 line_pay_online 時 payment.mode 必須是 line_pay_online")
    return errors


def selection_report(value: Any, *, shop_data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a non-authoritative setup report for a selected product."""
    payment = (shop_data or {}).get("payment", {})
    lookup = (shop_data or {}).get("lookup", {})
    vision = (shop_data or {}).get("vision", {})
    selection = selected_product(value)
    errors = validate_product(value, payment_mode=payment.get("mode"))
    modules: list[dict[str, Any]] = []
    next_inputs: list[str] = []

    for key in selection.get("modules", []):
        definition = MODULE_CATALOG.get(key)
        if definition is None:
            modules.append({"key": key, "state": "invalid"})
            continue
        blockers: list[str] = []
        if key == "progress_lookup" and lookup.get("mode", "manual") == "manual":
            blockers.append("尚未選定門市洗衣系統唯讀連接器")
        if key == "photo_quote" and vision.get("enabled") is not True:
            blockers.append("尚未啟用具同意紀錄的照片辨識服務")
        if key == "line_pay_qr" and payment.get("mode") != "merchant_qr":
            blockers.append("尚未填入店家 LINE Pay 入口")
        if key == "line_pay_online":
            blockers.append("需要另做 API、回呼、核帳與正式金流驗收")
        if key in {"pickup_booking", "staff_handoff"}:
            blockers.extend(definition["setup_requirements"])
        if definition["implementation_status"] in {"prepared", "integration_required", "add_on"}:
            blockers.append("此模組尚未列為本商品包的已驗收預設能力")
        for item in definition["setup_requirements"]:
            if item not in next_inputs:
                next_inputs.append(item)
        modules.append({
            "key": key,
            "label": definition["label"],
            "implementation_status": definition["implementation_status"],
            "state": "needs_setup" if blockers else "ready_for_next_gate",
            "blockers": blockers,
        })

    return {
        "catalog_version": CATALOG_VERSION,
        "selection_valid": not errors,
        "errors": errors,
        "plan": selection.get("plan"),
        "style": {
            "key": selection.get("style"),
            **deepcopy(STYLE_CATALOG.get(selection.get("style"), {})),
        },
        "modules": modules,
        "next_inputs": next_inputs,
        "note": "此報告只表示選配與設定狀態，不代表 LINE 平台回讀、手機測試或正式交機已完成。",
    }
