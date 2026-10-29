#!/usr/bin/env python3
"""Portable laundry LINE product CLI.

The CLI is deliberately a preparation/health/handover tool.  It does not log
into LINE, publish a menu, send a message, take payment, or modify a POS.
Those are separate gates and must be verified on the real store instance.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from connectors.base import connector_from_shop  # noqa: E402
from product_catalog import catalog_payload, selection_report  # noqa: E402
from runtime.lookup_service import lookup_by_phone  # noqa: E402
from shop_config import ConfigError, ShopConfig  # noqa: E402


def configure_stdio_utf8() -> None:
    """Prefer UTF-8 on Windows consoles so Chinese JSON is not replaced with ?."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError, AttributeError):
                pass


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def validation_payload(shop: ShopConfig) -> dict[str, Any]:
    errors = shop.validate()
    return {
        "command": "validate",
        "shop": str(shop.path),
        "shop_id": shop.shop_id,
        "mode": shop.mode,
        "valid": not errors,
        "errors": errors,
    }


def cmd_validate(args: argparse.Namespace) -> int:
    try:
        shop = ShopConfig.load(args.shop)
    except ConfigError as exc:
        emit({"command": "validate", "valid": False, "errors": [str(exc)]})
        return 2
    payload = validation_payload(shop)
    emit(payload)
    return 0 if payload["valid"] else 2


def cmd_health(args: argparse.Namespace) -> int:
    try:
        shop = ShopConfig.load(args.shop)
        shop.require_valid()
        connector = connector_from_shop(shop)
        health = connector.health()
    except ConfigError as exc:
        emit({"command": "health", "status": "invalid", "errors": [str(exc)]})
        return 2
    status = "ok" if health["state"] == "available" else health["state"]
    emit({"command": "health", "status": status, "shop_id": shop.shop_id, **health})
    return 0 if status == "ok" else 2


def _missing_handover_gates(shop: ShopConfig, health: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    if shop.mode != "live":
        missing.append("shop.mode=live")
    if health.get("state") != "available":
        missing.append(f"lookup connector state=available（目前 {health.get('state')}）")
    payment_mode = shop.data.get("payment", {}).get("mode")
    if payment_mode == "line_pay_online":
        pay_secret = shop.root / "secrets" / "line-pay.json"
        if not pay_secret.exists():
            missing.append("LINE Pay Online 商戶設定 secrets/line-pay.json")
    if not shop.data.get("server", {}).get("public_base", "").startswith("https://"):
        missing.append("server.public_base HTTPS")
    secrets_file = shop.root / "secrets" / "line-channel.json"
    if not secrets_file.exists():
        missing.append("門市 secrets/line-channel.json（只在門市現場填入，不放進交付包）")
    for key, label in (
        ("owner_confirmed", "店主確認"),
        ("real_phone_tested", "實體手機測試"),
        ("photo_tested", "照片流程測試"),
        ("location_tested", "位置流程測試"),
        ("staff_group_tested", "店員群通知測試"),
        ("query_authorization_tested", "查件授權測試"),
        ("payment_tested", "付款流程測試"),
        ("backup_restore_tested", "備份還原測試"),
        ("outage_recovery_tested", "斷線復原測試"),
    ):
        if shop.acceptance.get(key) is not True:
            missing.append(label)
    return missing


def cmd_handover(args: argparse.Namespace) -> int:
    try:
        shop = ShopConfig.load(args.shop)
        shop.require_valid()
        connector = connector_from_shop(shop)
        health = connector.health()
    except ConfigError as exc:
        emit({"command": "handover", "status": "blocked", "errors": [str(exc)]})
        return 2
    missing = _missing_handover_gates(shop, health)
    status = "ready_for_owner_handover" if not missing else "blocked"
    emit({
        "command": "handover",
        "status": status,
        "shop_id": shop.shop_id,
        "health": health,
        "missing_gates": missing,
        "note": "ready 仍需店主在真帳號確認；文件與測試不能代替手機逐格驗收。",
    })
    return 0 if status == "ready_for_owner_handover" else 2


def cmd_lookup(args: argparse.Namespace) -> int:
    try:
        shop = ShopConfig.load(args.shop)
        shop.require_valid()
        connector = connector_from_shop(shop)
    except ConfigError as exc:
        emit({"command": "lookup", "status": "blocked", "errors": [str(exc)]})
        return 2
    result = lookup_by_phone(connector, args.phone)
    emit({"command": "lookup", **result})
    return 0 if result["status"] in {"found_ready", "found_not_ready", "not_found", "ambiguous"} else 2


def cmd_catalog(args: argparse.Namespace) -> int:
    emit({"command": "catalog", **catalog_payload()})
    return 0


def cmd_selection(args: argparse.Namespace) -> int:
    try:
        shop = ShopConfig.load(args.shop)
    except ConfigError as exc:
        emit({"command": "selection", "selection_valid": False, "errors": [str(exc)]})
        return 2
    report = selection_report(shop.product, shop_data=shop.data)
    report.update({"command": "selection", "shop": str(shop.path), "shop_id": shop.shop_id})
    config_errors = shop.validate()
    if config_errors:
        report["selection_valid"] = False
        report.setdefault("errors", []).extend(config_errors)
    emit(report)
    return 0 if report["selection_valid"] else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="洗衣 LINE 商品包：選配、設定、健檢、查件與交機")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, fn in (("validate", cmd_validate), ("health", cmd_health), ("handover", cmd_handover)):
        command = sub.add_parser(name)
        command.add_argument("--shop", required=True, help="門市 shop.json 路徑")
        command.set_defaults(func=fn)
    lookup = sub.add_parser("lookup")
    lookup.add_argument("--shop", required=True, help="門市 shop.json 路徑")
    lookup.add_argument("--phone", required=True, help="完整 10 碼手機號碼")
    lookup.set_defaults(func=cmd_lookup)
    sub.add_parser("catalog", help="列出可選方案、模組與風格").set_defaults(func=cmd_catalog)
    selection = sub.add_parser("selection", help="顯示單一門市的模組／風格選擇與待補資料")
    selection.add_argument("--shop", required=True, help="門市 shop.json 路徑")
    selection.set_defaults(func=cmd_selection)
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_stdio_utf8()
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
