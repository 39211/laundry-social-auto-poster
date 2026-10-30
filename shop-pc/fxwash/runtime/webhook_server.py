"""Standalone, safe LINE Official Account Webhook Server for FXwash.

Provides real-time customer garment lookup, Rich Menu actions, Flex Message Carousels,
natural human-like replies (matching pilot templates), and binding management.
Strictly read-only with eHank MDB and fully adheres to LINE Messaging API specifications.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.server
import json
import re
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

try:
    sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
    sys.stderr.reconfigure(line_buffering=True, encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
LOG_FILE = ROOT / "logs" / "webhook_server.log"


class SafeWriter:
    """Tee complete/partial writes with one local timestamp per output line."""

    _lock = threading.RLock()

    def __init__(self, console_writer, file_writer):
        self.console = console_writer
        self.file = file_writer
        self._line_start = True

    def write(self, s):
        with self._lock:
            parts = []
            for part in s.splitlines(keepends=True):
                if self._line_start:
                    parts.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S "))
                parts.append(part)
                self._line_start = part.endswith(("\n", "\r"))
            output = "".join(parts)
            for writer in (self.file, self.console):
                try:
                    if writer is not None:
                        writer.write(output)
                except Exception:
                    pass
        return len(s)

    def flush(self):
        with self._lock:
            for writer in (self.file, self.console):
                try:
                    if writer is not None:
                        writer.flush()
                except Exception:
                    pass


_log_fp = None
try:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    _log_fp = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
except Exception:
    pass
sys.stdout = SafeWriter(sys.stdout, _log_fp)
sys.stderr = SafeWriter(sys.stderr, _log_fp)

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from connectors.base import connector_from_shop
from runtime.chat_service import generate_chat_reply
from runtime.line_api import channel_credentials
from runtime.lookup_service import extract_phone, format_screenshot3_text, lookup_by_customer_id, lookup_by_phone
from runtime.vision_service import build_photo_quote_reply, download_line_image
from shop_config import load_shop

# Attribution ledger is optional (B2). Any import problem leaves the webhook exactly as before.
# The top-level name is tried first (runtime dir on sys.path); the package path is the
# fallback for launches where the script dir is not on sys.path (-I / ._pth embedded Python).
try:
    from attribution_service import extract_source, init_attribution
except Exception:  # attribution is optional; never block the webhook
    try:
        from runtime.attribution_service import extract_source, init_attribution
    except Exception:
        extract_source = None
        init_attribution = None

LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply"
PHONE_REGEX = re.compile(r"09\d{8}")
CID_PREFIX_REGEX = re.compile(r"(?:客號|會員號|會員編號|會員|卡號|客戶編號|CID|NO\.?)\s*[:：#是為]?\s*([A-Za-z0-9]{1,8})", re.IGNORECASE)
PURE_CID_REGEX = re.compile(r"^#?([0-9]{1,6})$")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    if not signature or not secret:
        return False
    computed = base64.b64encode(hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()).decode("utf-8")
    return hmac.compare_digest(computed, signature)


def reply_message(reply_token: str, messages: list[dict], token: str) -> bool:
    if not reply_token or not messages:
        return False
    payload = {
        "replyToken": reply_token,
        "messages": messages,
    }
    req = Request(
        LINE_REPLY_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as resp:
            print(f"[Webhook Reply Success] HTTP {resp.status}")
            return True
    except Exception as exc:
        err_detail = ""
        if hasattr(exc, "read"):
            err_detail = exc.read().decode("utf-8", errors="ignore")
        print(f"[ERROR] Failed to send LINE reply: {exc} | {err_detail}", file=sys.stderr)
        return False


def load_bindings(data_dir: Path) -> dict[str, dict]:
    path = data_dir / "customer_bindings.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_binding(data_dir: Path, user_id: str, customer_id: str, phone: str = "", name: str = ""):
    if not user_id or not customer_id:
        return
    bindings = load_bindings(data_dir)
    existing = bindings.get(user_id, {})
    phone_to_save = str(phone).strip() or existing.get("phone", "")
    name_to_save = str(name).strip() or existing.get("name", "")
    bindings[user_id] = {
        "customer_id": str(customer_id),
        "phone": phone_to_save,
        "name": name_to_save,
        "updated_at": utc_now(),
    }
    path = data_dir / "customer_bindings.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(bindings, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Binding Saved] User: {user_id[:8]}... -> CID: {customer_id}, Name: {name_to_save}")


def build_price_card(title: str, subtitle: str, items: list[tuple[str, str]], query_text: str):
    item_boxes = []
    for name, price in items:
        item_boxes.append({
            "type": "box",
            "layout": "horizontal",
            "contents": [
                {
                    "type": "text",
                    "text": name,
                    "size": "sm",
                    "color": "#4A3E36",
                    "flex": 4,
                },
                {
                    "type": "text",
                    "text": price,
                    "size": "sm",
                    "weight": "bold",
                    "color": "#2B2520",
                    "align": "end",
                    "flex": 2,
                },
            ],
            "margin": "md",
        })

    return {
        "type": "bubble",
        "size": "kilo",
        "styles": {
            "body": {
                "backgroundColor": "#FAF7F2",
            },
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": title,
                    "weight": "bold",
                    "size": "xl",
                    "color": "#2B2520",
                },
                {
                    "type": "text",
                    "text": subtitle,
                    "size": "xs",
                    "color": "#9E7B58",
                    "margin": "xs",
                },
                {
                    "type": "separator",
                    "margin": "lg",
                    "color": "#E5DDD0",
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "lg",
                    "contents": item_boxes,
                },
                {
                    "type": "button",
                    "action": {
                        "type": "message",
                        "label": "我想問這類",
                        "text": query_text,
                    },
                    "style": "primary",
                    "color": "#3C332A",
                    "margin": "xl",
                    "height": "sm",
                },
                {
                    "type": "button",
                    "action": {
                        "type": "message",
                        "label": "先約時間",
                        "text": "預約到店",
                    },
                    "style": "secondary",
                    "color": "#EFE8DC",
                    "margin": "sm",
                    "height": "sm",
                },
            ],
        },
    }


def build_price_carousel() -> dict:
    c1 = build_price_card("寢具被品", "精緻水洗 · 看過再定", [
        ("涼被", "180"),
        ("棉被 (小 / 單人)", "350"),
        ("棉被 (大 / 雙人)", "500"),
        ("羽絨被 / 羊毛被", "600~800"),
    ], "我想問寢具")

    c2 = build_price_card("鞋子清潔", "手工洗護 · 看過再定", [
        ("一般運動鞋", "250"),
        ("童鞋 / 大童鞋", "150~200"),
        ("皮鞋 / 麂皮鞋", "400"),
        ("名牌鞋", "600"),
    ], "我想問鞋子")

    c3 = build_price_card("包包皮件", "深層保養 · 看過再定", [
        ("短皮夾 / 長皮夾", "400~600"),
        ("書包 / 後背包", "600~800"),
        ("布混包 / 全布包", "500~900"),
        ("皮包包 / 名牌包", "1000~1500"),
    ], "我想問包包")

    c4 = build_price_card("日常衣物", "精緻乾水洗 · 看過再定", [
        ("襯衫 / 棉T", "70"),
        ("西褲 / 牛仔褲", "80~100"),
        ("羽絨外套 / 背心", "200~280"),
        ("西裝 / 大衣", "200~250"),
    ], "我想問衣物")

    return {
        "type": "flex",
        "altText": "私享家 常見洗滌價目表",
        "contents": {
            "type": "carousel",
            "contents": [c1, c2, c3, c4],
        },
    }


def build_store_hours_card() -> dict:
    return {
        "type": "flex",
        "altText": "私享家 到店時間與預約",
        "contents": {
            "type": "bubble",
            "size": "kilo",
            "styles": {
                "body": {
                    "backgroundColor": "#FAF7F2",
                },
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "到店時間",
                        "weight": "bold",
                        "size": "xl",
                        "color": "#2B2520",
                    },
                    {
                        "type": "text",
                        "text": "先留時間也行，到了再說要洗什麼。",
                        "size": "xs",
                        "color": "#9E7B58",
                        "margin": "xs",
                    },
                    {
                        "type": "separator",
                        "margin": "lg",
                        "color": "#E5DDD0",
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "spacing": "md",
                        "contents": [
                            {
                                "type": "text",
                                "text": "週一至週五 10:00-20:00；週六 12:00-18:00；週日公休",
                                "size": "sm",
                                "color": "#4A3E36",
                                "wrap": True,
                            },
                            {
                                "type": "text",
                                "text": "407 臺中市西屯區至善里青海路二段365號（至善國中對面）",
                                "size": "sm",
                                "color": "#4A3E36",
                                "wrap": True,
                            },
                        ],
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "datetimepicker",
                            "label": "選時間",
                            "data": "action=select_booking_time",
                            "mode": "datetime",
                        },
                        "style": "primary",
                        "color": "#3C332A",
                        "margin": "xl",
                        "height": "sm",
                    },
                ],
            },
        },
    }


def build_lookup_guide_card() -> dict:
    return {
        "type": "flex",
        "altText": "私享家 送洗進度查詢",
        "contents": {
            "type": "bubble",
            "size": "kilo",
            "styles": {
                "body": {
                    "backgroundColor": "#FAF7F2",
                },
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "送洗進度查詢",
                        "weight": "bold",
                        "size": "xl",
                        "color": "#2B2520",
                    },
                    {
                        "type": "text",
                        "text": "門市系統即時連線",
                        "size": "xs",
                        "color": "#9E7B58",
                        "margin": "xs",
                    },
                    {
                        "type": "separator",
                        "margin": "lg",
                        "color": "#E5DDD0",
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "text",
                                "text": "請直接在對話框輸入您的：",
                                "size": "sm",
                                "color": "#4A3E36",
                                "weight": "bold",
                            },
                            {
                                "type": "text",
                                "text": "• 手機號碼（例如：0910041887）",
                                "size": "sm",
                                "color": "#4A3E36",
                            },
                            {
                                "type": "text",
                                "text": "• 門市客號（例如：28 或 34）",
                                "size": "sm",
                                "color": "#4A3E36",
                            },
                            {
                                "type": "text",
                                "text": "系統將立即回報在店物件、洗滌進度與費用明細。",
                                "size": "xs",
                                "color": "#8C7D70",
                                "margin": "md",
                                "wrap": True,
                            },
                        ],
                    },
                ],
            },
        },
    }


def build_photo_quote_guide_card() -> dict:
    return {
        "type": "flex",
        "altText": "私享家 拍照線上估價",
        "contents": {
            "type": "bubble",
            "size": "kilo",
            "styles": {
                "body": {
                    "backgroundColor": "#FAF7F2",
                },
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "拍照線上估價",
                        "weight": "bold",
                        "size": "xl",
                        "color": "#2B2520",
                    },
                    {
                        "type": "text",
                        "text": "傳送照片即可為您初步估價",
                        "size": "xs",
                        "color": "#9E7B58",
                        "margin": "xs",
                    },
                    {
                        "type": "separator",
                        "margin": "lg",
                        "color": "#E5DDD0",
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "text",
                                "text": "建議拍攝重點：",
                                "size": "sm",
                                "color": "#4A3E36",
                                "weight": "bold",
                            },
                            {
                                "type": "text",
                                "text": "1. 衣物或物品正面全貌",
                                "size": "sm",
                                "color": "#4A3E36",
                            },
                            {
                                "type": "text",
                                "text": "2. 污漬、發霉或受損處特寫",
                                "size": "sm",
                                "color": "#4A3E36",
                            },
                            {
                                "type": "text",
                                "text": "3. 內側水洗標籤（若有）",
                                "size": "sm",
                                "color": "#4A3E36",
                            },
                            {
                                "type": "text",
                                "text": "收到照片後會為您初估洗滌方式與費用；最終仍以現場實際檢視為準喔！",
                                "size": "xs",
                                "color": "#8C7D70",
                                "margin": "md",
                                "wrap": True,
                            },
                        ],
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "打開相機拍照",
                            "uri": "https://line.me/R/nv/camera/",
                        },
                        "style": "primary",
                        "color": "#3C332A",
                        "margin": "xl",
                        "height": "sm",
                    },
                ],
            },
        },
    }


def format_location_reply() -> list[dict]:
    text = (
        "我們在至善國中對面，407 臺中市西屯區至善里青海路二段365號。\n"
        "https://maps.app.goo.gl/kUREPkWDXYNTkpct7\n"
        "週一至週五 10:00-20:00；週六 12:00-18:00；週日公休\n"
        "送洗不用預約，營業時間直接帶來就好。"
    )
    return [{"type": "text", "text": text}]


def make_request_handler(shop, connector, creds):
    processed_tokens: set[str] = set()
    data_dir = shop.root / "data"

    # Attribution ledger (B2, default OFF). shop.json is read only here, i.e. once at
    # startup; changing the "attribution" key needs a webhook restart.
    attr_ledger, attr_registry = None, None
    if init_attribution is not None:
        try:
            _shop_cfg = json.loads((ROOT / "shop.json").read_text(encoding="utf-8-sig"))
        except Exception:
            _shop_cfg = {}
        _attr_cfg = _shop_cfg.get("attribution") if isinstance(_shop_cfg, dict) else None
        try:
            attr_ledger, attr_registry = init_attribution(shop.root, _attr_cfg)  # never raises
        except Exception:
            attr_ledger, attr_registry = None, None
            print("[ATTRIBUTION_DISABLED] init failed", file=sys.stderr)
    else:
        print("[ATTRIBUTION_DISABLED] module unavailable", file=sys.stderr)

    class WebhookHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"OK")

        def do_POST(self):
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            signature = self.headers.get("X-Line-Signature", "")

            # Verify signature
            if not verify_signature(body, signature, creds["secret"]):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Invalid signature")
                self.wfile.flush()
                return

            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                data = None

            # Attribution: small local fsync'd append, bounded (<= 2 s lock wait), no network.
            # Runs only when fully enabled; every failure is swallowed here and never
            # changes the HTTP response.
            attr_text = {}
            if attr_ledger is not None and isinstance(data, dict):
                attr_events = data.get("events")
                for ev in attr_events if isinstance(attr_events, list) else []:
                    try:
                        src_res = None
                        m = ev.get("message") if isinstance(ev, dict) else None
                        if isinstance(m, dict) and m.get("type") == "text" and isinstance(m.get("text"), str):
                            src_res = extract_source(m["text"], attr_registry)
                            if src_res.source_status == "ok" and src_res.stripped_text:
                                attr_text[id(ev)] = src_res.stripped_text
                        attr_ledger.record_message(ev, src_res, attr_registry.registry_version)
                    except Exception as exc:
                        print("[ATTRIBUTION_ERROR] " + type(exc).__name__, file=sys.stderr)

            # Respond 200 OK immediately and flush buffer so LINE never times out
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"OK")
            self.wfile.flush()

            if data is None:
                return

            events = data.get("events", [])
            for event in events:
                event_type = event.get("type")
                reply_token = event.get("replyToken")
                source = event.get("source", {})
                user_id = source.get("userId", "")

                if not reply_token:
                    continue

                if reply_token in {"00000000000000000000000000000000", "ffffffffffffffffffffffffffffffff"}:
                    print("[Webhook] Received LINE test webhook verification ping. Skipping dummy token.")
                    continue

                # Deduplicate tokens
                if reply_token in processed_tokens:
                    print(f"[Webhook] Duplicate replyToken received: {reply_token[:8]}..., ignoring.")
                    continue
                processed_tokens.add(reply_token)
                if len(processed_tokens) > 2000:
                    processed_tokens.clear()

                # Handle postback events (e.g. from datetimepicker "選時間")
                if event_type == "postback":
                    params = event.get("postback", {}).get("params", {})
                    dt = params.get("datetime") or params.get("date") or ""
                    resp_text = (
                        f"好的，已為您記下預約到店時間：{dt}！\n"
                        f"門市在至善國中正對面（青海路二段365號好停車），營業時間直接送過來就可以囉！"
                    )
                    reply_message(reply_token, [{"type": "text", "text": resp_text}], creds["token"])
                    continue

                if event_type != "message":
                    continue

                msg = event.get("message", {})
                msg_type = msg.get("type")

                # Case A: User sent an image (Photo Quote)
                if msg_type == "image":
                    msg_id = msg.get("id", "")
                    print(f"[Webhook Image] Received image {msg_id} from {user_id[:8]}...")
                    image_bytes = download_line_image(msg_id, creds["token"]) if msg_id else None
                    replies = build_photo_quote_reply(image_bytes, shop.root, user_id=user_id)
                    reply_message(reply_token, replies, creds["token"])
                    continue

                if msg_type != "text":
                    continue

                user_text = msg.get("text", "").strip()
                # Attribution: a registered source code is removed from the routed text.
                if id(event) in attr_text:
                    user_text = attr_text[id(event)]
                print(f"[Webhook Text] User {user_id[:8]}...: '{user_text}'")

                # 1. Phone number lookup (09xxxxxxxx, 09xx-xxx-xxx, with spaces, etc.)
                phone_val = extract_phone(user_text)
                if phone_val:
                    lookup_res = lookup_by_phone(connector, phone_val)
                    cid_found = lookup_res.get("customer_id")
                    cname_found = lookup_res.get("customer_name")
                    phone_found = lookup_res.get("customer_phone") or phone_val
                    if cid_found and user_id:
                        save_binding(data_dir, user_id, cid_found, phone_found, cname_found)
                        if attr_ledger is not None:
                            try:
                                attr_ledger.record_binding_observed(user_id, cid_found, "phone_lookup")
                            except Exception as exc:
                                print("[ATTRIBUTION_ERROR] " + type(exc).__name__, file=sys.stderr)
                    formatted_text = format_screenshot3_text(lookup_res, phone_val)
                    reply_message(reply_token, [{"type": "text", "text": formatted_text}], creds["token"])
                    continue

                # 2. Customer ID lookup (客號 34 / #34 / 34 / 0034)
                cid_match = CID_PREFIX_REGEX.search(user_text) or PURE_CID_REGEX.match(user_text)
                if cid_match:
                    cid = cid_match.group(1)
                    lookup_res = lookup_by_customer_id(connector, cid)
                    cid_found = lookup_res.get("customer_id")
                    cname_found = lookup_res.get("customer_name")
                    phone_found = lookup_res.get("customer_phone") or ""
                    if not phone_found and user_id:
                        bindings = load_bindings(data_dir)
                        if user_id in bindings and bindings[user_id].get("phone"):
                            phone_found = bindings[user_id]["phone"]
                            lookup_res["customer_phone"] = phone_found
                    if cid_found and user_id:
                        save_binding(data_dir, user_id, cid_found, phone_found, cname_found)
                        if attr_ledger is not None:
                            try:
                                attr_ledger.record_binding_observed(user_id, cid_found, "cid_lookup")
                            except Exception as exc:
                                print("[ATTRIBUTION_ERROR] " + type(exc).__name__, file=sys.stderr)
                    formatted_text = format_screenshot3_text(lookup_res, f"客號 {cid}")
                    reply_message(reply_token, [{"type": "text", "text": formatted_text}], creds["token"])
                    continue

                # 3. Rich menu / Query prompt: 物件查詢 / 查件 / 進度
                if any(kw in user_text for kw in ("物件查詢", "查件", "查詢進度", "洗衣進度", "查進度", "查衣服", "我的衣服", "送洗進度")):
                    # Check if user has an existing customer binding
                    bindings = load_bindings(data_dir)
                    user_binding = bindings.get(user_id) if user_id else None
                    if user_binding and user_binding.get("customer_id"):
                        bound_cid = user_binding["customer_id"]
                        lookup_res = lookup_by_customer_id(connector, bound_cid)
                        if not lookup_res.get("customer_phone") and user_binding.get("phone"):
                            lookup_res["customer_phone"] = user_binding["phone"]
                        formatted_text = format_screenshot3_text(lookup_res, f"客號 {bound_cid}")
                        reply_message(reply_token, [{"type": "text", "text": formatted_text}], creds["token"])
                    else:
                        reply_message(reply_token, [build_lookup_guide_card()], creds["token"])
                    continue

                # 4. Rich menu: 價目表 (Screenshot 2)
                if user_text in ("價目表", "價目", "看價目表", "完整價目表", "價目總覽") or (len(user_text) <= 4 and any(kw in user_text for kw in ("價目表", "價目"))):
                    replies = [
                        {"type": "text", "text": "我先給您常洗的幾類，左右滑。沒有的再問我。"},
                        build_price_carousel(),
                    ]
                    reply_message(reply_token, replies, creds["token"])
                    continue

                # 4.1 Card button inquiries (aligned with eHank Dco prices)
                if user_text == "我想問寢具":
                    text = (
                        "門市寢具床組洗滌參考費用：\n"
                        "・涼被：180 元 / 件\n"
                        "・棉被 (小 / 單人)：350 元 / 件\n"
                        "・棉被 (大 / 雙人)：500 元 / 件\n"
                        "・毛毯：200 ~ 450 元 / 件\n"
                        "・羽絨被：600 元 / 件\n"
                        "・蠶絲 / 羊毛被：800 元 / 件\n"
                        "・枕套 / 枕頭娃娃：30 ~ 300 元 / 件\n\n"
                        "💡 大件被單送洗不用預約，營業時間直接帶來門市就可以囉！"
                    )
                    reply_message(reply_token, [{"type": "text", "text": text}], creds["token"])
                    continue

                if user_text == "我想問鞋子":
                    text = (
                        "門市鞋類洗滌參考費用：\n"
                        "・一般運動鞋：250 元 / 雙\n"
                        "・皮運動鞋：300 元 / 雙\n"
                        "・混和運動鞋：350 元 / 雙\n"
                        "・童鞋 / 大童鞋：150 ~ 200 元 / 雙\n"
                        "・皮鞋 / 高跟鞋：400 元 / 雙\n"
                        "・麂皮鞋 / 反毛皮鞋：400 元 / 雙\n"
                        "・登山鞋 / 低靴：350 ~ 500 元 / 雙\n"
                        "・中靴 / 高靴：450 ~ 550 元 / 雙\n"
                        "・名牌鞋款：600 元 / 雙\n\n"
                        "💡 您也可以直接在此拍照傳送鞋子，AI 小幫手會自動辨識材質並為您初估金額喔！"
                    )
                    reply_message(reply_token, [{"type": "text", "text": text}], creds["token"])
                    continue

                if user_text == "我想問包包":
                    text = (
                        "門市包包與皮件保養參考費用：\n"
                        "・短皮夾：400 元 / 個\n"
                        "・長皮夾：600 元 / 個\n"
                        "・書包 / 後背包：600 ~ 800 元 / 個\n"
                        "・全布包：500 元 / 個\n"
                        "・布混包：900 元 / 個\n"
                        "・皮包包：1000 元 / 個\n"
                        "・名牌包：1500 ~ 2000 元 / 個\n\n"
                        "💡 精品包款歡迎先拍照傳過來，或直接帶到門市幫您現場評估！"
                    )
                    reply_message(reply_token, [{"type": "text", "text": text}], creds["token"])
                    continue

                if user_text == "我想問衣物":
                    text = (
                        "門市常見衣物洗滌參考費用：\n"
                        "・襯衫 / 棉T：70 元 / 件\n"
                        "・西褲 / 牛仔褲：80 ~ 100 元 / 件\n"
                        "・薄外套 / 厚外套：150 ~ 180 元 / 件\n"
                        "・羽絨外套 / 背心：200 ~ 280 元 / 件\n"
                        "・西裝 / 西裝外套：200 ~ 250 元 / 件\n"
                        "・洋裝 / 禮服：120 ~ 450 元 / 件\n"
                        "・毛衣 / 針織衣：150 ~ 180 元 / 件\n\n"
                        "💡 一般衣物送洗營業時間直接帶來門市就可以囉，免預約！"
                    )
                    reply_message(reply_token, [{"type": "text", "text": text}], creds["token"])
                    continue

                # 5. Rich menu: 預約到店 (Screenshot 3 & 4)
                if user_text in ("預約到店", "到店預約", "到店時間", "選時間"):
                    replies = [
                        {"type": "text", "text": "您選一個方便到店的時間。週日我們公休。"},
                        build_store_hours_card(),
                    ]
                    reply_message(reply_token, replies, creds["token"])
                    continue

                # 6. Rich menu: 店址 (Screenshot 4 & 5)
                if user_text in ("店址", "門市地址", "看店址", "查看地址"):
                    reply_message(reply_token, format_location_reply(), creds["token"])
                    continue

                # 7. Rich menu: 拍照問價 / 線上估價
                if user_text in ("拍照問價", "拍照估價", "線上估價"):
                    reply_message(reply_token, [build_photo_quote_guide_card()], creds["token"])
                    continue

                # 8. Intelligent Humanized Clerk Reply (Gemini AI + 400+ Phrase Dialog Corpus)
                # Handles all natural questions (stains, turnaround, pricing combinations, chitchat, bot skepticism, guidance)
                chat_reply = generate_chat_reply(user_text, shop.root, user_id)
                reply_message(reply_token, [{"type": "text", "text": chat_reply}], creds["token"])
                continue

        def log_message(self, format, *args):
            print(f"[Webhook] {args[0]} - {args[1]}", file=sys.stderr)

    return WebhookHandler


def run_server(port: int = 18791):
    shop = load_shop(ROOT / "shop.json")
    connector = connector_from_shop(shop)
    creds = channel_credentials(shop)

    handler = make_request_handler(shop, connector, creds)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"FXwash LINE Webhook Server running on http://127.0.0.1:{port}/line/webhook")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
    except Exception as exc:
        print(f"Server exception: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        server.server_close()


if __name__ == "__main__":
    port = 18791
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run_server(port)