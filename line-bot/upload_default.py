# -*- coding: utf-8 -*-
"""上傳預設 Rich Menu。point-card-url.txt 有合法 https 時用 v6，否則用 v5。失敗不刪任何既有選單。"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
JPG_V3_PATH = HERE / "richmenu-v3.jpg"
JPG_V4_PATH = HERE / "richmenu-v4.jpg"
JPG_V5_PATH = HERE / "richmenu-v5.jpg"
JPG_V6_PATH = HERE / "richmenu-v6.jpg"
JPG_PATH = JPG_V5_PATH
ID_PATH = HERE / "richmenu-id.txt"
POINT_CARD_URL_PATH = HERE / "point-card-url.txt"
DEFAULT_MENU_URL = "https://api.line.me/v2/bot/user/all/richmenu"

W, H = 2500, 1686
MAX_BYTES = 1_000_000
COL_W = (833, 833, 834)
ROW_H = (843, 843)
MAP_URI = "https://maps.app.goo.gl/kUREPkWDXYNTkpct7"
OLD_ALIASES = ("sxj-service", "sxj-member")

# U1：左上「拍照問價」（門檻最低／本店賣點）；上中露出「免費」；
# 右下合併店址與電話（電話在官方帳號主頁），動作只留地圖。
V3_ACTIONS = [
    {"type": "message", "text": "拍照問價"},
    {"type": "message", "text": "外收送預約"},
    {"type": "message", "text": "價目表"},
    {"type": "message", "text": "物件查詢"},
    {"type": "message", "text": "預約到店"},
    {"type": "uri", "uri": MAP_URI},
]


def read_https_switch(path: Path) -> str:
    """L1：不存在或空 = 未設定。必須 https://；否則當沒設定，警告到 stderr（不寫網址）。"""
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    line = text.lstrip("\ufeff").strip()
    if not line:
        return ""
    line = line.splitlines()[0].strip()
    if not line:
        return ""
    if not line.startswith("https://"):
        print(f"WARN: {path.name} is not an https URL; treating as unset", file=sys.stderr)
        return ""
    return line


def v4_actions(url: str) -> list[dict]:
    # L2：右下改集點卡 URI。店址與電話在官方帳號主頁已經有，是六格裡最可被取代的一格。
    return [
        {"type": "message", "text": "拍照問價"},
        {"type": "message", "text": "外收送預約"},
        {"type": "message", "text": "價目表"},
        {"type": "message", "text": "物件查詢"},
        {"type": "message", "text": "預約到店"},
        {"type": "uri", "uri": url},
    ]


V5_ACTIONS = [
    {"type": "message", "text": "拍照問價"},
    {"type": "message", "text": "外收送預約"},
    {"type": "message", "text": "價目表"},
    {"type": "message", "text": "物件查詢"},
    {"type": "message", "text": "常見問題"},
    {"type": "uri", "uri": MAP_URI},
]


def v6_actions(url: str) -> list[dict]:
    """v5 版面 + 右下換集點卡。"""
    return [
        {"type": "message", "text": "拍照問價"},
        {"type": "message", "text": "外收送預約"},
        {"type": "message", "text": "價目表"},
        {"type": "message", "text": "物件查詢"},
        {"type": "message", "text": "常見問題"},
        {"type": "uri", "uri": url},
    ]


def resolve_menu() -> dict:
    """W5：point-card-url.txt 合法 https → v6；否則 v5。v3/v4 圖檔與 id 不得刪改。"""
    url = read_https_switch(POINT_CARD_URL_PATH)
    if url:
        return {
            "version": "v6",
            "jpg": JPG_V6_PATH,
            "name": "sxj-v6",
            "actions": v6_actions(url),
        }
    return {
        "version": "v5",
        "jpg": JPG_V5_PATH,
        "name": "sxj-v5",
        "actions": [dict(a) for a in V5_ACTIONS],
    }


def build_areas(actions: list[dict] | None = None) -> list[dict]:
    if actions is None:
        actions = resolve_menu()["actions"]
    areas = []
    for i, action in enumerate(actions):
        col, row = i % 3, i // 3
        x = sum(COL_W[:col])
        y = sum(ROW_H[:row])
        areas.append(
            {
                "bounds": {
                    "x": x,
                    "y": y,
                    "width": COL_W[col],
                    "height": ROW_H[row],
                },
                "action": dict(action),
            }
        )
    return areas


def _rects_overlap(a: dict, b: dict) -> bool:
    aw, ah = a["width"], a["height"]
    bw, bh = b["width"], b["height"]
    overlap_w = max(0, min(a["x"] + aw, b["x"] + bw) - max(a["x"], b["x"]))
    overlap_h = max(0, min(a["y"] + ah, b["y"] + bh) - max(a["y"], b["y"]))
    return overlap_w > 0 and overlap_h > 0


def validate_areas(areas: list[dict]) -> tuple[bool, str]:
    if len(areas) != 6:
        return False, f"expected 6 areas, got {len(areas)}"
    canvas = W * H
    total = 0
    for i, area in enumerate(areas):
        b = area["bounds"]
        if b["x"] < 0 or b["y"] < 0:
            return False, f"area[{i}] origin negative"
        if b["width"] <= 0 or b["height"] <= 0:
            return False, f"area[{i}] non-positive size"
        if b["x"] + b["width"] > W or b["y"] + b["height"] > H:
            return False, f"area[{i}] exceeds canvas"
        total += b["width"] * b["height"]
        for j in range(i + 1, len(areas)):
            if _rects_overlap(b, areas[j]["bounds"]):
                return False, f"overlap {i} and {j}"
    if total != canvas:
        return False, f"union {total} != {canvas}"
    return True, f"cover {total}"


def validate_image(path: Path) -> tuple[bool, str]:
    if not path.is_file():
        return False, f"missing {path}"
    n = path.stat().st_size
    if n > MAX_BYTES:
        return False, f"file too large {n} > {MAX_BYTES}"
    with Image.open(path) as im:
        if im.size != (W, H):
            return False, f"size {im.size} != {(W, H)}"
    return True, f"ok {n} bytes {W}x{H}"


def validate_chat_bar(text: str) -> tuple[bool, str]:
    n = len(text or "")
    if n < 1 or n > 14:
        return False, f"chatBarText len {n} not in 1..14"
    return True, f"chatBarText {n} chars"


def menu_body() -> dict:
    sel = resolve_menu()
    return {
        "size": {"width": W, "height": H},
        "selected": True,
        "name": sel["name"],
        "chatBarText": "看服務・問價",
        "areas": build_areas(sel["actions"]),
    }


def secrets_candidates() -> tuple[Path, ...]:
    # Production tree: secrets sits next to the bot folder. Lane copy: secrets inside HERE.
    return (
        HERE.parent / "secrets" / "line-channel.json",
        HERE / "secrets" / "line-channel.json",
    )


def find_secrets() -> Path:
    candidates = secrets_candidates()
    for path in candidates:
        if path.is_file():
            return path
    tried = " then ".join(str(p) for p in candidates) or "(none)"
    raise FileNotFoundError(f"secrets file missing: tried {tried}")


def load_token() -> str:
    path = find_secrets()
    sec = json.loads(path.read_text(encoding="utf-8"))
    token = sec.get("line_channel_token")
    if not token or not isinstance(token, str):
        raise ValueError("line_channel_token missing")
    return token


def get_default_richmenu_id(token: str) -> str:
    try:
        data = api("GET", DEFAULT_MENU_URL, token)
    except RuntimeError as e:
        if "HTTP 404" in str(e):
            return ""
        raise
    rid = (data or {}).get("richMenuId")
    return str(rid) if rid else ""


def api(method: str, url: str, token: str, data=None, headers=None, raw=False):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            if raw:
                return {"ok": True, "status": r.status}
            return json.loads(body) if body else {"ok": True, "status": r.status}
    except urllib.error.HTTPError as e:
        err = e.read()[:240].decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code} {method} {url.split('/v2/')[-1][:60]} {err}") from e


def step_fail(n, msg: str) -> int:
    print(f"STEP {n} FAIL: {msg}")
    return 1


def dry_run() -> int:
    sel = resolve_menu()
    print(f"這次會用 {sel['version']}")
    ok, msg = validate_image(sel["jpg"])
    if not ok:
        return step_fail(1, msg)
    print(f"STEP 1 OK: {msg}")
    areas = build_areas(sel["actions"])
    ok, msg = validate_areas(areas)
    if not ok:
        return step_fail(1, f"areas {msg}")
    print(f"STEP 1 AREAS OK: {msg}")
    body = menu_body()
    ok, msg = validate_chat_bar(body.get("chatBarText") or "")
    if not ok:
        return step_fail(1, msg)
    print(f"STEP 1 CHATBAR OK: {msg}")
    print(json.dumps(body, ensure_ascii=False, indent=2))
    return 0


def upload() -> int:
    sel = resolve_menu()
    print(f"這次會用 {sel['version']}")
    ok, msg = validate_image(sel["jpg"])
    if not ok:
        return step_fail(1, msg)
    print(f"STEP 1 OK: {msg}")
    areas = build_areas(sel["actions"])
    ok, msg = validate_areas(areas)
    if not ok:
        return step_fail(1, f"areas {msg}")
    ok, msg = validate_chat_bar(menu_body().get("chatBarText") or "")
    if not ok:
        return step_fail(1, msg)

    try:
        token = load_token()
    except Exception as e:
        return step_fail(2, f"token {e}")

    try:
        prev_default = get_default_richmenu_id(token)
    except Exception as e:
        return step_fail(2, f"get current default {e}")
    print(f"STEP 2 PRE: current default={prev_default or '(none)'}")

    body = json.dumps(menu_body()).encode("utf-8")
    try:
        created = api(
            "POST",
            "https://api.line.me/v2/bot/richmenu",
            token,
            data=body,
            headers={"Content-Type": "application/json"},
        )
    except Exception as e:
        return step_fail(2, str(e))
    rid = (created or {}).get("richMenuId")
    if not rid:
        return step_fail(2, "no richMenuId in response")
    print("STEP 2 OK: created")

    img = sel["jpg"].read_bytes()
    try:
        api(
            "POST",
            f"https://api-data.line.me/v2/bot/richmenu/{rid}/content",
            token,
            data=img,
            headers={"Content-Type": "image/jpeg"},
            raw=True,
        )
    except Exception as e:
        return step_fail(3, str(e))
    print("STEP 3 OK: uploaded")

    try:
        api("POST", f"https://api.line.me/v2/bot/user/all/richmenu/{rid}", token)
    except Exception as e:
        return step_fail(4, str(e))
    print("STEP 4 OK: default set")

    try:
        confirmed = get_default_richmenu_id(token)
    except Exception as e:
        return step_fail(4.5, str(e))
    if confirmed != rid:
        print(f"STEP 4.5 ids new={rid} current={confirmed}")
        return step_fail(4.5, f"default mismatch new={rid} current={confirmed}")
    print("STEP 4.5 OK: default confirmed")

    try:
        listed = api("GET", "https://api.line.me/v2/bot/richmenu/list", token) or {}
        for rm in listed.get("richmenus", []):
            old = rm.get("richMenuId")
            if old and old != rid and old != prev_default:
                api("DELETE", f"https://api.line.me/v2/bot/richmenu/{old}", token)
        for alias in OLD_ALIASES:
            try:
                api("DELETE", f"https://api.line.me/v2/bot/richmenu/alias/{alias}", token)
            except RuntimeError as e:
                if "HTTP 404" not in str(e):
                    raise
    except Exception as e:
        return step_fail(5, str(e))
    print("STEP 5 OK: old menus/aliases removed")

    try:
        ID_PATH.write_text(str(rid) + "\n", encoding="utf-8")
    except Exception as e:
        return step_fail(6, str(e))
    print("STEP 6 OK: id written")
    return 0


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--dry-run" in argv:
        return dry_run()
    return upload()


if __name__ == "__main__":
    sys.exit(main())
