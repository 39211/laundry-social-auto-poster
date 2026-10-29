#!/usr/bin/env python3
"""Configure and verify LINE Official Account and LINE Pay connections.

This command never prints secret values.  ``validate`` is local-only,
``verify-line`` performs read-only LINE API calls, ``apply-webhook`` is the
explicit channel mutation, and ``verify-linepay --reserve-amount`` is the
explicit sandbox payment call.
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

from runtime import line_api, line_pay  # noqa: E402
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


def local_report(shop: ShopConfig) -> dict[str, Any]:
    return {
        "shop_id": shop.shop_id,
        "line_official": line_api.local_report(shop),
        "line_pay": line_pay.local_report(shop),
        "note": "configured 只代表本機欄位完整；verify-line 或 sandbox 交易才是平台證據。",
    }


def load_shop(path: str) -> ShopConfig:
    shop = ShopConfig.load(path)
    shop.require_valid()
    return shop


def cmd_validate(args: argparse.Namespace) -> int:
    try:
        shop = load_shop(args.shop)
    except ConfigError as exc:
        emit({"command": "connections validate", "status": "blocked", "detail": str(exc)})
        return 2
    report = local_report(shop)
    line_ok = report["line_official"]["status"] == "configured"
    payment_mode = shop.data.get("payment", {}).get("mode")
    pay_ok = payment_mode != "line_pay_online" or report["line_pay"]["status"] == "configured"
    report.update({"command": "connections validate", "status": "ready_for_verify" if line_ok and pay_ok else "needs_input"})
    emit(report)
    return 0 if line_ok and pay_ok else 2


def cmd_verify_line(args: argparse.Namespace) -> int:
    try:
        shop = load_shop(args.shop)
        info = line_api.bot_info(shop)
        webhook = line_api.get_webhook(shop)
    except (ConfigError, OSError, ValueError) as exc:
        emit({"command": "connections verify-line", "status": "failed", "detail": str(exc)})
        return 2
    emit({
        "command": "connections verify-line",
        "status": "verified",
        "bot": {key: info.get(key) for key in ("displayName", "basicId", "userId") if info.get(key)},
        "webhook": webhook,
        "note": "已回讀 LINE 平台；未修改選單。",
    })
    return 0


def cmd_apply_webhook(args: argparse.Namespace) -> int:
    if not args.confirm:
        emit({"command": "connections apply-webhook", "status": "blocked", "detail": "需要 --confirm 才會修改 LINE 平台 webhook。"})
        return 2
    try:
        shop = load_shop(args.shop)
        endpoint = args.endpoint or str(shop.data.get("server", {}).get("webhook_url", ""))
        if not endpoint:
            raise ConfigError("請用 --endpoint 或在 shop.json 的 server.webhook_url 提供 HTTPS URL")
        result = line_api.set_webhook(shop, endpoint)
        readback = line_api.get_webhook(shop)
    except (ConfigError, OSError, ValueError) as exc:
        emit({"command": "connections apply-webhook", "status": "failed", "detail": str(exc)})
        return 2
    emit({"command": "connections apply-webhook", "status": "applied_and_read_back", "response": result, "readback": readback})
    return 0


def cmd_test_webhook(args: argparse.Namespace) -> int:
    try:
        shop = load_shop(args.shop)
        endpoint = args.endpoint or str(shop.data.get("server", {}).get("webhook_url", ""))
        result = line_api.test_webhook(shop, endpoint)
    except (ConfigError, OSError, ValueError) as exc:
        emit({"command": "connections test-webhook", "status": "failed", "detail": str(exc)})
        return 2
    emit({"command": "connections test-webhook", "status": "tested", "result": result, "note": "這會請 LINE 平台送一個空 events 測試 webhook 到門市端。"})
    return 0 if result.get("success") is not False else 2


def cmd_verify_linepay(args: argparse.Namespace) -> int:
    try:
        shop = load_shop(args.shop)
        report = line_pay.local_report(shop)
        if shop.data.get("payment", {}).get("mode") != "line_pay_online":
            emit({
                "command": "connections verify-linepay",
                "status": "needs_input",
                "local": report,
                "detail": "verify-linepay 僅適用於 line_pay_online（QR 模式請人工核對金額）。",
            })
            return 2
        if report["status"] != "configured":
            emit({"command": "connections verify-linepay", "status": "needs_input", "local": report})
            return 2
        if args.reserve_amount is None:
            emit({
                "command": "connections verify-linepay",
                "status": "configured_needs_sandbox_transaction",
                "local": report,
                "next": "提供 --reserve-amount 與 --order-id 才會明確發出一次付款 reserve；production 另需 --allow-production。",
            })
            return 2
        actual_environment = line_pay.environment(shop)
        if actual_environment == "production" and not args.allow_production:
            raise ConfigError("production LINE Pay 呼叫需要 --allow-production")
        client = line_pay.LinePayClient(shop)
        result = client.reserve(
            args.reserve_amount,
            args.order_id,
            args.product_name,
            args.confirm_url,
            args.cancel_url,
        )
    except (ConfigError, OSError, ValueError) as exc:
        emit({"command": "connections verify-linepay", "status": "failed", "detail": str(exc)})
        return 2
    emit({
        "command": "connections verify-linepay",
        "status": "sandbox_reserve_returned" if result.get("ok") else "provider_rejected",
        "local": report,
        "result": result,
        "note": "reserve 回傳不等於已收款；仍需依交易結果完成 confirm、金額核對、冪等與案件狀態流程。",
    })
    return 0 if result.get("ok") else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LINE Official Account / LINE Pay 連接設定與驗證")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate")
    validate.add_argument("--shop", required=True)
    validate.set_defaults(func=cmd_validate)
    verify_line = sub.add_parser("verify-line")
    verify_line.add_argument("--shop", required=True)
    verify_line.set_defaults(func=cmd_verify_line)
    apply = sub.add_parser("apply-webhook")
    apply.add_argument("--shop", required=True)
    apply.add_argument("--endpoint")
    apply.add_argument("--confirm", action="store_true")
    apply.set_defaults(func=cmd_apply_webhook)
    test_webhook = sub.add_parser("test-webhook")
    test_webhook.add_argument("--shop", required=True)
    test_webhook.add_argument("--endpoint")
    test_webhook.set_defaults(func=cmd_test_webhook)
    pay = sub.add_parser("verify-linepay")
    pay.add_argument("--shop", required=True)
    pay.add_argument("--reserve-amount", type=int)
    pay.add_argument("--order-id", default="sandbox-verify-001")
    pay.add_argument("--product-name", default="LINE Pay sandbox 驗證")
    pay.add_argument("--confirm-url", default="https://example.invalid/pay/confirm")
    pay.add_argument("--cancel-url", default="https://example.invalid/pay/cancel")
    pay.add_argument("--allow-production", action="store_true")
    pay.set_defaults(func=cmd_verify_linepay)
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_stdio_utf8()
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
