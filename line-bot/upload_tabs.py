# -*- coding: utf-8 -*-
"""上傳服務/會員兩頁選單並設 alias（官方 richmenuswitch）。"""
import json
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(r"C:/Users/cyc39/laundry-repo")
sec = json.loads((REPO / "secrets/line-channel.json").read_text(encoding="utf-8"))
TOK = sec["line_channel_token"]
MAP = "https://maps.app.goo.gl/kUREPkWDXYNTkpct7"
TEL = "tel:0424527411"
TAB_H = 260
CW, CH = 833, 713


def call(method, url, data=None, headers=None, raw=False):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOK)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read()
            return json.loads(b) if b and not raw else {"ok": True, "status": r.status}
    except urllib.error.HTTPError as e:
        print("FAIL", method, url.split("/v2/")[-1][:50], e.code, e.read()[:240].decode("utf-8", "replace"))
        return None


def areas_tabs(switch_alias, cells):
    out = [
        {"bounds": {"x": 0, "y": 0, "width": 1250, "height": TAB_H},
         "action": {"type": "richmenuswitch", "richMenuAliasId": "sxj-service", "data": "tab=service"}
         if switch_alias == "sxj-service" else {"type": "message", "text": "我想洗"}},
        {"bounds": {"x": 1250, "y": 0, "width": 1250, "height": TAB_H},
         "action": {"type": "richmenuswitch", "richMenuAliasId": "sxj-member", "data": "tab=member"}
         if switch_alias == "sxj-member" else {"type": "message", "text": "我的預約"}},
    ]
    # If we are ON service page, left tab should not switch to self (LINE requires alias of OTHER menu).
    # Service page: left tab message 我想洗, right switch member
    # Member page: left switch service, right message 我的預約
    for i, act in enumerate(cells):
        x = (i % 3) * CW
        y = TAB_H + (i // 3) * CH
        w = 834 if i % 3 == 2 else 833
        out.append({"bounds": {"x": x, "y": y, "width": w, "height": CH}, "action": act})
    return out


def create_menu(name, jpg, chat, areas):
    body = {
        "size": {"width": 2500, "height": 1686},
        "selected": True,
        "name": name,
        "chatBarText": chat,
        "areas": areas,
    }
    created = call("POST", "https://api.line.me/v2/bot/richmenu",
                   data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    rid = created["richMenuId"]
    img = Path(jpg).read_bytes()
    call("POST", f"https://api-data.line.me/v2/bot/richmenu/{rid}/content",
         data=img, headers={"Content-Type": "image/jpeg"}, raw=True)
    print("created", name, rid, "bytes", len(img))
    return rid


def main():
    call("DELETE", "https://api.line.me/v2/bot/user/all/richmenu")
    listed = call("GET", "https://api.line.me/v2/bot/richmenu/list") or {}
    for rm in listed.get("richmenus", []):
        call("DELETE", f"https://api.line.me/v2/bot/richmenu/{rm['richMenuId']}")
    for alias in ("sxj-service", "sxj-member"):
        call("DELETE", f"https://api.line.me/v2/bot/richmenu/alias/{alias}")

    service_cells = [
        {"type": "message", "text": "預約到店"},
        {"type": "message", "text": "價目表"},
        {"type": "message", "text": "作品案例"},
        {"type": "uri", "uri": MAP},
        {"type": "uri", "uri": TEL},
        {"type": "message", "text": "營業時間"},
    ]
    member_cells = [
        {"type": "message", "text": "LINE Pay"},
        {"type": "message", "text": "我的預約"},
        {"type": "message", "text": "到店禮遇"},
        {"type": "message", "text": "我想洗"},
        {"type": "uri", "uri": TEL},
        {"type": "message", "text": "營業時間"},
    ]
    # service: right tab switches to member
    a_areas = [
        {"bounds": {"x": 0, "y": 0, "width": 1250, "height": TAB_H}, "action": {"type": "message", "text": "我想洗"}},
        {"bounds": {"x": 1250, "y": 0, "width": 1250, "height": TAB_H},
         "action": {"type": "richmenuswitch", "richMenuAliasId": "sxj-member", "data": "tab=member"}},
    ]
    b_areas = [
        {"bounds": {"x": 0, "y": 0, "width": 1250, "height": TAB_H},
         "action": {"type": "richmenuswitch", "richMenuAliasId": "sxj-service", "data": "tab=service"}},
        {"bounds": {"x": 1250, "y": 0, "width": 1250, "height": TAB_H}, "action": {"type": "message", "text": "我的預約"}},
    ]
    for i, act in enumerate(service_cells):
        x = (i % 3) * 833
        y = TAB_H + (i // 3) * CH
        w = 834 if i % 3 == 2 else 833
        a_areas.append({"bounds": {"x": x, "y": y, "width": w, "height": CH}, "action": act})
    for i, act in enumerate(member_cells):
        x = (i % 3) * 833
        y = TAB_H + (i // 3) * CH
        w = 834 if i % 3 == 2 else 833
        b_areas.append({"bounds": {"x": x, "y": y, "width": w, "height": CH}, "action": act})

    rid_a = create_menu("sxj-service", r"C:/Users/cyc39/laundry-repo/line-bot/richmenu-service.jpg", "服務", a_areas)
    rid_b = create_menu("sxj-member", r"C:/Users/cyc39/laundry-repo/line-bot/richmenu-member.jpg", "會員", b_areas)
    call("POST", "https://api.line.me/v2/bot/richmenu/alias",
         data=json.dumps({"richMenuAliasId": "sxj-service", "richMenuId": rid_a}).encode(),
         headers={"Content-Type": "application/json"})
    call("POST", "https://api.line.me/v2/bot/richmenu/alias",
         data=json.dumps({"richMenuAliasId": "sxj-member", "richMenuId": rid_b}).encode(),
         headers={"Content-Type": "application/json"})
    call("POST", f"https://api.line.me/v2/bot/user/all/richmenu/{rid_a}")
    print("DEFAULT", rid_a)


if __name__ == "__main__":
    main()
