#!/usr/bin/env python3
"""Patch selected shop.json fields without PowerShell ConvertTo-Json.

Loads with utf-8-sig, writes UTF-8 without BOM, preserves nested structures
such as hours list-of-lists. Optionally validates and exits non-zero on failure.
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

from shop_config import ConfigError, ShopConfig, is_merchant_qr_url


PAYMENT_KEYS = ("mode", "url", "environment", "currency", "order_prefix")
SERVER_KEYS = ("webhook_url", "webhook_path", "public_base", "webhook_port", "staff_port")
PRODUCT_KEYS = ("plan", "style", "modules")


def _read_json(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8-sig")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ConfigError("設定檔最外層必須是物件")
    return value


def _write_json(path: Path, data: dict[str, Any]) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def patch_shop(
    path: Path,
    *,
    payment: dict[str, Any] | None = None,
    server: dict[str, Any] | None = None,
    product: dict[str, Any] | None = None,
    validate: bool = False,
) -> dict[str, Any]:
    data = _read_json(path)

    if payment:
        block = data.get("payment")
        if not isinstance(block, dict):
            block = {}
            data["payment"] = block
        for key, value in payment.items():
            if key not in PAYMENT_KEYS:
                raise ConfigError(f"不支援的 payment 欄位：{key}")
            block[key] = value
        mode = str(block.get("mode") or "")
        if mode == "merchant_qr":
            url = str(block.get("url") or "").strip()
            if not is_merchant_qr_url(url):
                raise ConfigError(
                    "merchant_qr 的 payment.url 必須是 LINE Pay QR 網址，"
                    "且 https://qrcodepay.line.me/ 之後至少要有一段路徑"
                )

    if server:
        block = data.get("server")
        if not isinstance(block, dict):
            block = {}
            data["server"] = block
        for key, value in server.items():
            if key not in SERVER_KEYS:
                raise ConfigError(f"不支援的 server 欄位：{key}")
            block[key] = value

    if product:
        block = data.get("product")
        if not isinstance(block, dict):
            block = {}
            data["product"] = block
        for key, value in product.items():
            if key not in PRODUCT_KEYS:
                raise ConfigError(f"不支援的 product 欄位：{key}")
            block[key] = value

    # line_pay_qr implies merchant_qr payment fields
    modules = []
    prod = data.get("product")
    if isinstance(prod, dict) and isinstance(prod.get("modules"), list):
        modules = [str(m) for m in prod["modules"]]
    if "line_pay_qr" in modules:
        pay = data.get("payment")
        if not isinstance(pay, dict):
            pay = {}
            data["payment"] = pay
        mode = str(pay.get("mode") or "")
        if mode == "line_pay_online":
            raise ConfigError("選擇 line_pay_qr 時不可同時使用 line_pay_online；請改 payment.mode=merchant_qr")
        if mode != "merchant_qr":
            pay["mode"] = "merchant_qr"
        url = str(pay.get("url") or "").strip()
        if not is_merchant_qr_url(url):
            raise ConfigError(
                "選擇 line_pay_qr 時必須提供合法 payment.url（https://qrcodepay.line.me/ 後至少一段路徑）。"
                "請加 --payment-mode merchant_qr --payment-url <QR網址>。"
            )

    _write_json(path, data)

    if validate:
        shop = ShopConfig.load(path)
        shop.require_valid()

    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Patch shop.json payment/server/product fields safely")
    parser.add_argument("--shop", required=True, help="Path to shop.json")
    parser.add_argument("--payment-mode", default=None)
    parser.add_argument("--payment-url", default=None)
    parser.add_argument("--payment-environment", default=None)
    parser.add_argument("--payment-currency", default=None)
    parser.add_argument("--payment-order-prefix", default=None)
    parser.add_argument("--server-webhook-url", default=None)
    parser.add_argument("--server-webhook-path", default=None)
    parser.add_argument("--server-public-base", default=None)
    parser.add_argument("--product-plan", default=None)
    parser.add_argument("--product-style", default=None)
    parser.add_argument("--product-modules", default=None, help="以逗號分隔，例如 brand_oa,human_faq,staff_handoff")
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args(argv)

    payment: dict[str, Any] = {}
    if args.payment_mode is not None:
        payment["mode"] = args.payment_mode
    if args.payment_url is not None:
        payment["url"] = args.payment_url
    if args.payment_environment is not None:
        payment["environment"] = args.payment_environment
    if args.payment_currency is not None:
        payment["currency"] = args.payment_currency
    if args.payment_order_prefix is not None:
        payment["order_prefix"] = args.payment_order_prefix

    server: dict[str, Any] = {}
    if args.server_webhook_url is not None:
        server["webhook_url"] = args.server_webhook_url
    if args.server_webhook_path is not None:
        server["webhook_path"] = args.server_webhook_path
    if args.server_public_base is not None:
        server["public_base"] = args.server_public_base

    product: dict[str, Any] = {}
    if args.product_plan is not None:
        product["plan"] = args.product_plan
    if args.product_style is not None:
        product["style"] = args.product_style
    if args.product_modules is not None:
        product["modules"] = [item.strip() for item in args.product_modules.split(",") if item.strip()]

    if not payment and not server and not product:
        print("沒有要寫入的欄位。", file=sys.stderr)
        return 2

    path = Path(args.shop).expanduser().resolve()
    try:
        patch_shop(
            path,
            payment=payment or None,
            server=server or None,
            product=product or None,
            validate=args.validate,
        )
    except (ConfigError, OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(f"patched {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
