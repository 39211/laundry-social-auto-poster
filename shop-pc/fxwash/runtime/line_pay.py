"""LINE Pay Online v3 adapter kept inside the delivery package.

It signs reserve/confirm requests but never sends one implicitly.  A real
merchant must first configure sandbox credentials and run the explicit
connection check.  Production payment calls remain a separate owner action.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from shop_config import ConfigError, ShopConfig, is_merchant_qr_url

OpenFn = Callable[..., Any]
TRANSACTION_RE = re.compile(r"^[0-9]{1,30}$")

def _read_secret(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"找不到 LINE Pay 商戶密鑰檔：{path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"LINE Pay 商戶密鑰檔不是有效 JSON：{exc.msg}") from exc
    if not isinstance(value, dict):
        raise ConfigError("LINE Pay 商戶密鑰檔最外層必須是物件")
    return value


def credentials(shop: ShopConfig) -> dict[str, str]:
    data = _read_secret(shop.root / "secrets" / "line-pay.json")
    channel_id = str(data.get("channel_id") or "").strip()
    channel_secret = str(data.get("channel_secret") or "").strip()
    if not channel_id or not channel_secret:
        raise ConfigError("LINE Pay 商戶密鑰檔需要 channel_id 與 channel_secret")
    return {"channel_id": channel_id, "channel_secret": channel_secret}


def environment(shop: ShopConfig) -> str:
    value = str(shop.data.get("payment", {}).get("environment", "sandbox"))
    if value not in {"sandbox", "production"}:
        raise ConfigError("payment.environment 必須是 sandbox 或 production")
    return value


def base_url(shop: ShopConfig) -> str:
    return "https://sandbox-api-pay.line.me" if environment(shop) == "sandbox" else "https://api-pay.line.me"


def sign(channel_secret: str, uri: str, body: str, nonce: str) -> str:
    message = (channel_secret + uri + body + nonce).encode("utf-8")
    digest = hmac.new(channel_secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


class LinePayClient:
    def __init__(self, shop: ShopConfig, *, opener: OpenFn = urlopen):
        self.shop = shop
        self.opener = opener
        self.creds = credentials(shop)

    def _post(self, uri: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        nonce = uuid.uuid4().hex
        request = Request(
            base_url(self.shop) + uri,
            data=body.encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-LINE-ChannelId": self.creds["channel_id"],
                "X-LINE-Authorization-Nonce": nonce,
                "X-LINE-Authorization": sign(self.creds["channel_secret"], uri, body, nonce),
            },
        )
        try:
            with self.opener(request, timeout=20) as response:
                value = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            raise ConfigError(f"LINE Pay API HTTP {exc.code}") from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigError(f"LINE Pay API 連線失敗：{type(exc).__name__}") from exc
        if not isinstance(value, dict):
            raise ConfigError("LINE Pay API 回應不是 JSON 物件")
        return value

    def reserve(
        self,
        amount: int,
        order_id: str,
        product_name: str,
        confirm_url: str,
        cancel_url: str,
    ) -> dict[str, Any]:
        if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
            raise ConfigError("LINE Pay amount 必須是正整數")
        if not order_id or len(order_id) > 100:
            raise ConfigError("LINE Pay order_id 必須是 1 到 100 字元")
        if not confirm_url.startswith("https://") or not cancel_url.startswith("https://"):
            raise ConfigError("LINE Pay confirm/cancel URL 必須是 HTTPS")
        result = self._post(
            "/v3/payments/request",
            {
                "amount": amount,
                "currency": "TWD",
                "orderId": order_id,
                "packages": [{
                    "id": "pkg-1",
                    "amount": amount,
                    "products": [{"id": "item-1", "name": product_name[:40], "quantity": 1, "price": amount}],
                }],
                "redirectUrls": {"confirmUrl": confirm_url, "cancelUrl": cancel_url},
            },
        )
        info = result.get("info") or {}
        payment_url = (info.get("paymentUrl") or {}).get("web") or ""
        return {
            "ok": result.get("returnCode") == "0000" and bool(payment_url),
            "payment_url": payment_url,
            "transaction_id": str(info.get("transactionId") or ""),
            "return_code": result.get("returnCode"),
            "return_message": result.get("returnMessage"),
        }

    def confirm(self, transaction_id: str, amount: int) -> dict[str, Any]:
        if not TRANSACTION_RE.fullmatch(str(transaction_id)):
            raise ConfigError("LINE Pay transaction_id 只能是數字")
        if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
            raise ConfigError("LINE Pay amount 必須是正整數")
        result = self._post(f"/v3/payments/{transaction_id}/confirm", {"amount": amount, "currency": "TWD"})
        return {"ok": result.get("returnCode") == "0000", "return_code": result.get("returnCode"), "return_message": result.get("returnMessage")}


def local_report(shop: ShopConfig) -> dict[str, Any]:
    path = shop.root / "secrets" / "line-pay.json"
    payment = shop.data.get("payment", {}) if isinstance(shop.data.get("payment"), dict) else {}
    mode = str(payment.get("mode") or "disabled")

    if mode == "disabled":
        return {
            "status": "not_selected",
            "mode": mode,
            "path": str(path),
            "detail": "目前付款模式未選取（disabled）。",
        }

    if mode == "merchant_qr":
        url = str(payment.get("url") or "").strip()
        if is_merchant_qr_url(url):
            return {
                "status": "configured",
                "mode": "merchant_qr",
                "url": url,
                "path": str(path),
                "detail": "QR 入口已設定；店員須人工核對金額。",
            }
        return {
            "status": "missing",
            "mode": "merchant_qr",
            "url": url,
            "path": str(path),
            "detail": "merchant_qr 需要 payment.url 為 https://qrcodepay.line.me/<路徑>（不可只有網域或結尾斜線）。",
        }

    if mode != "line_pay_online":
        return {
            "status": "not_selected",
            "mode": mode,
            "path": str(path),
            "detail": f"未知付款模式：{mode}",
        }

    try:
        credentials(shop)
        env = environment(shop)
    except ConfigError as exc:
        return {"status": "missing", "mode": mode, "path": str(path), "detail": str(exc)}
    return {
        "status": "configured",
        "mode": mode,
        "environment": env,
        "path": str(path),
        "detail": "密鑰存在且欄位完整；尚未代表 sandbox 交易成功。",
    }
