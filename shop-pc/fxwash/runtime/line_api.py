"""Minimal LINE Official Account connection and webhook verifier.

All methods are explicit: ``bot_info`` and ``get_webhook`` are read-only;
``set_webhook`` is the only method that changes the LINE channel and is only
called by the explicit ``apply-webhook`` command.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable
from urllib.request import Request, urlopen

from shop_config import ConfigError, ShopConfig

OpenFn = Callable[..., Any]
LINE_API = "https://api.line.me"


def _read_secret(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"找不到 LINE 官方密鑰檔：{path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"LINE 官方密鑰檔不是有效 JSON：{exc.msg}") from exc
    if not isinstance(value, dict):
        raise ConfigError("LINE 官方密鑰檔最外層必須是物件")
    return value


def channel_credentials(shop: ShopConfig) -> dict[str, str]:
    data = _read_secret(shop.root / "secrets" / "line-channel.json")
    token = str(data.get("channel_access_token") or data.get("line_channel_token") or "").strip()
    secret = str(data.get("channel_secret") or "").strip()
    if not token or not secret:
        raise ConfigError("LINE 官方密鑰檔需要 channel_access_token（或 line_channel_token）與 channel_secret")
    return {"token": token, "secret": secret}


def _json_call(
    method: str,
    path: str,
    credentials: dict[str, str],
    *,
    body: dict[str, Any] | None = None,
    opener: OpenFn = urlopen,
) -> dict[str, Any]:
    raw = b"" if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {"Authorization": f"Bearer {credentials['token']}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(LINE_API + path, data=raw if body is not None else None, method=method, headers=headers)
    with opener(request, timeout=20) as response:
        response_body = response.read()
        payload = {} if not response_body.strip() else json.loads(response_body.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ConfigError("LINE API 回應不是 JSON 物件")
    return payload


def bot_info(shop: ShopConfig, *, opener: OpenFn = urlopen) -> dict[str, Any]:
    return _json_call("GET", "/v2/bot/info", channel_credentials(shop), opener=opener)


def get_webhook(shop: ShopConfig, *, opener: OpenFn = urlopen) -> dict[str, Any]:
    return _json_call("GET", "/v2/bot/channel/webhook/endpoint", channel_credentials(shop), opener=opener)


def set_webhook(shop: ShopConfig, endpoint: str, *, opener: OpenFn = urlopen) -> dict[str, Any]:
    if not endpoint.startswith("https://") or len(endpoint) > 500:
        raise ConfigError("LINE webhook endpoint 必須是 500 字元內的 HTTPS URL")
    return _json_call(
        "PUT",
        "/v2/bot/channel/webhook/endpoint",
        channel_credentials(shop),
        body={"endpoint": endpoint},
        opener=opener,
    )


def test_webhook(shop: ShopConfig, endpoint: str = "", *, opener: OpenFn = urlopen) -> dict[str, Any]:
    if endpoint and (not endpoint.startswith("https://") or len(endpoint) > 500):
        raise ConfigError("LINE webhook endpoint 必須是 500 字元內的 HTTPS URL")
    body = {"endpoint": endpoint} if endpoint else None
    return _json_call("POST", "/v2/bot/channel/webhook/test", channel_credentials(shop), body=body, opener=opener)


def local_report(shop: ShopConfig) -> dict[str, Any]:
    path = shop.root / "secrets" / "line-channel.json"
    try:
        channel_credentials(shop)
    except ConfigError as exc:
        return {"status": "missing", "path": str(path), "detail": str(exc)}
    return {"status": "configured", "path": str(path), "detail": "密鑰存在且欄位完整；尚未代表平台回讀成功。"}
