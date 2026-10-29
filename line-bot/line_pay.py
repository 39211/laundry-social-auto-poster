# -*- coding: utf-8 -*-
"""LINE Pay Online v3. 商戶憑證放 secrets/line-pay.json；沒檔就只走引導、不打 API。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import uuid
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

REPO = Path(os.environ.get("LAUNDRY_REPO_ROOT", r"C:/Users/cyc39/laundry-repo"))
PAY_SECRETS = REPO / "secrets" / "line-pay.json"


def configured() -> bool:
    if not PAY_SECRETS.exists():
        return False
    try:
        d = json.loads(PAY_SECRETS.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return bool(d.get("channel_id") and d.get("channel_secret"))


def _cfg() -> dict:
    return json.loads(PAY_SECRETS.read_text(encoding="utf-8"))


def _sign(secret: str, uri: str, body: str, nonce: str) -> str:
    msg = (secret + uri + body + nonce).encode()
    digest = hmac.new(secret.encode(), msg, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def request_payment(amount: int, order_id: str, product_name: str, confirm_url: str, cancel_url: str) -> dict:
    """回傳 {ok, paymentUrl, transactionId, error}。未設定商戶時 ok=False。"""
    if not configured():
        return {"ok": False, "error": "not_configured"}
    cfg = _cfg()
    sandbox = bool(cfg.get("sandbox", True))
    host = "https://sandbox-api-pay.line.me" if sandbox else "https://api-pay.line.me"
    uri = "/v3/payments/request"
    payload = {
        "amount": int(amount),
        "currency": "TWD",
        "orderId": order_id,
        "packages": [
            {
                "id": "pkg-1",
                "amount": int(amount),
                "products": [
                    {
                        "id": "item-1",
                        "name": product_name[:40],
                        "quantity": 1,
                        "price": int(amount),
                    }
                ],
            }
        ],
        "redirectUrls": {"confirmUrl": confirm_url, "cancelUrl": cancel_url},
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    nonce = uuid.uuid4().hex
    sig = _sign(cfg["channel_secret"], uri, body, nonce)
    req = Request(
        host + uri,
        data=body.encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-LINE-ChannelId": str(cfg["channel_id"]),
            "X-LINE-Authorization-Nonce": nonce,
            "X-LINE-Authorization": sig,
        },
    )
    try:
        with urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
    except HTTPError as e:
        return {"ok": False, "error": e.read()[:300].decode("utf-8", "replace")}
    info = (data or {}).get("info") or {}
    url = ((info.get("paymentUrl") or {}).get("web")) or ""
    return {
        "ok": data.get("returnCode") == "0000" and bool(url),
        "paymentUrl": url,
        "transactionId": str(info.get("transactionId") or ""),
        "raw_code": data.get("returnCode"),
        "error": None if data.get("returnCode") == "0000" else data.get("returnMessage"),
    }


def confirm(transaction_id: str, amount: int) -> dict:
    if not configured():
        return {"ok": False, "error": "not_configured"}
    cfg = _cfg()
    sandbox = bool(cfg.get("sandbox", True))
    host = "https://sandbox-api-pay.line.me" if sandbox else "https://api-pay.line.me"
    uri = f"/v3/payments/{transaction_id}/confirm"
    payload = {"amount": int(amount), "currency": "TWD"}
    body = json.dumps(payload, separators=(",", ":"))
    nonce = uuid.uuid4().hex
    sig = _sign(cfg["channel_secret"], uri, body, nonce)
    req = Request(
        host + uri,
        data=body.encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-LINE-ChannelId": str(cfg["channel_id"]),
            "X-LINE-Authorization-Nonce": nonce,
            "X-LINE-Authorization": sig,
        },
    )
    try:
        with urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
    except HTTPError as e:
        return {"ok": False, "error": e.read()[:300].decode("utf-8", "replace")}
    return {"ok": data.get("returnCode") == "0000", "raw": data}
