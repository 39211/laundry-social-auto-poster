# -*- coding: utf-8 -*-
"""Social promo posters (4:5, 1080x1350) for feed posts.

Two drafts for the owner to pick from, both built from the shop's own
recorded numbers and nothing else: per-item prices from data/prices.json
(the owner's price sheet) and the stored-value ladder from data/promo.json
(the owner's own FB post). Nothing here invents a number, a claim, or an
address.

Layout discipline is inherited from build-poster-knowledge.py: measure the
fixed content first, give the hero what is left, and assert on every text
run that can overflow its container -- PIL draws past edges silently.

The QR goes to the LINE redirect on the live domain with its own source
code (post-poster), so GA4 can attribute poster clicks separately from
regular post links.

Run (system python lacks qrcode/Pillow):
  "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe" \
      scripts/build-social-promo.py [A|B ...]
"""

import json
import os
import sys

import qrcode
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

W, H = 1080, 1350
M = 64  # side margin

PAPER = (250, 247, 241); INK = (26, 34, 30); GREEN = (15, 76, 58)
GREEN_L = (96, 126, 112); GOLD = (176, 138, 58); HAIR = (214, 206, 192)
PANEL = (243, 239, 231)

BOLD = "C:/Windows/Fonts/msjhbd.ttc"; LIGHT = "C:/Windows/Fonts/msjh.ttc"


def F(px, b=True):
    return ImageFont.truetype(BOLD if b else LIGHT, px)


PRICES = json.load(open("data/prices.json", encoding="utf-8-sig"))
PROMO = json.load(open("data/promo.json", encoding="utf-8-sig"))

SHOP = {
    "phone": "0968-327-653",
    "addr": "西屯區青海路二段365號",
    "near": "至善國中對面",
    "hours": "10:00-20:00・週日公休",
    "name": "私享家洗衣店",
    "line": "https://sixiangjialaundry.com/go/line.html?source=post-poster",
}


def track_draw(d, x, y, text, size, fill, tk=0.0, bold=True, right_at=None, maxw=None, label=""):
    """Per-character draw with tracking; asserts when a maximum width is given."""
    f = F(size, bold)
    widths = [d.textlength(c, font=f) for c in text]
    total = sum(widths) + tk * (len(text) - 1)
    if maxw is not None:
        assert total <= maxw, f"{label} 超寬 {total - maxw:.0f}px:{text[:18]}"
    cx = (right_at - total) if right_at is not None else x
    for c, w in zip(text, widths):
        d.text((cx, y), c, font=f, fill=fill)
        cx += w + tk
    return y + int(size * 1.3)


def centered(d, y, text, size, fill, tk=0.0, bold=True, label=""):
    f = F(size, bold)
    total = sum(d.textlength(c, font=f) for c in text) + tk * (len(text) - 1)
    assert total <= W - 2 * M, f"{label} 超寬 {total - (W - 2 * M):.0f}px:{text[:18]}"
    return track_draw(d, (W - total) / 2, y, text, size, fill, tk, bold)


def base_canvas():
    img = Image.new("RGB", (W, H), PAPER)
    return img, ImageDraw.Draw(img)


def qr_block(d, img, y_top, block_h):
    """QR on the right, contact stack on the left, inside the footer band."""
    qr = qrcode.QRCode(border=1, box_size=10)
    qr.add_data(SHOP["line"])
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    side = block_h - 16
    q = q.resize((side, side), Image.NEAREST)
    qx = W - M - side
    img.paste(q, (qx, y_top + 8))

    y = y_top + 6
    y = track_draw(d, M, y, SHOP["name"], 40, GREEN, tk=2, label="店名")
    y = track_draw(d, M, y + 2, f"{SHOP['addr']}（{SHOP['near']}）", 30, INK, bold=False,
                   maxw=qx - M - 24, label="地址")
    y = track_draw(d, M, y + 2, f"{SHOP['hours']}｜LINE {SHOP['phone']}", 30, INK, bold=False,
                   maxw=qx - M - 24, label="時間")
    track_draw(d, M, y + 4, "掃碼加 LINE,拍照直接估價", 28, GREEN_L, bold=False,
               maxw=qx - M - 24, label="掃碼說明")


def build_A() -> str:
    """開學洗鞋主打:hero 白鞋對比圖+真實鞋價條+儲值金一行。"""
    img, d = base_canvas()

    # -- draw the headline first, then measure what is left for the hero;
    # a fixed top budget clipped the sub-line's descenders under the hero.
    y = 40
    y = centered(d, y, "開學了,鞋先洗好", 84, INK, tk=6, label="主標")
    y = centered(d, y + 4, "小孩的、大人的,一起收", 40, GREEN_L, bold=False, tk=3, label="副標")

    price_h = 210        # price panel
    stored_h = 76        # stored-value single line band
    footer_h = 190       # shop + QR
    hero_y = y + 24
    hero_h = H - hero_y - price_h - stored_h - footer_h - 4 * 24
    assert hero_h >= 380, f"hero 只剩 {hero_h}px,內容太多"
    src = Image.open("data/reference-photos/poster-hero-diptych-grok.png").convert("RGB")
    band_top, band_h = 0.40, 0.50
    crop = src.crop((0, int(src.height * band_top), src.width,
                     int(src.height * (band_top + band_h))))
    crop = crop.resize((W - 2 * M, hero_h), Image.LANCZOS)
    img.paste(crop, (M, hero_y))
    d.rectangle([M, hero_y, W - M, hero_y + hero_h], outline=HAIR, width=2)

    # price panel: numbers straight from the owner's price sheet
    py = hero_y + hero_h + 24
    d.rounded_rectangle([M, py, W - M, py + price_h], radius=18, fill=PANEL,
                        outline=HAIR, width=2)
    s = PRICES["鞋子"]
    rows = [
        ("童鞋", s["童鞋"], "一般運動鞋", s["一般運動鞋"]),
        ("皮鞋", s["皮鞋"], "麂皮鞋", s["麂皮鞋"]),
        ("登山鞋", s["一般登山鞋"], "高筒登山鞋", s["高筒登山鞋"]),
    ]
    ry = py + 22
    col2 = W // 2 + 30
    for l_name, l_price, r_name, r_price in rows:
        track_draw(d, M + 36, ry, l_name, 36, INK, label="價名")
        track_draw(d, 0, ry, f"${l_price}", 36, GREEN, right_at=W // 2 - 30, label="價錢")
        track_draw(d, col2, ry, r_name, 36, INK, label="價名")
        track_draw(d, 0, ry, f"${r_price}", 36, GREEN, right_at=W - M - 36, label="價錢")
        ry += 54
    track_draw(d, M + 36, ry - 4, "水洗價;實際依現場報價", 24, GREEN_L, bold=False, label="價註")

    # stored-value single line: first and last rungs of the owner's ladder
    sy = py + price_h + 24
    d.rectangle([M, sy, W - M, sy + stored_h], fill=GREEN)
    first, last = PROMO["stored_value_ladder"][0], PROMO["stored_value_ladder"][-1]
    line = (f"儲值金優惠:存 {first['threshold']} 送 {first['bonus']}"
            f",最高存 {last['threshold']} 送 {last['bonus']}")
    f = F(34)
    total = sum(d.textlength(c, font=f) for c in line) + 2 * (len(line) - 1)
    assert total <= W - 2 * M - 40, f"儲值行超寬 {total:.0f}px"
    track_draw(d, (W - total) / 2, sy + 18, line, 34, PAPER, tk=2, label="儲值行")

    qr_block(d, img, sy + stored_h + 24, footer_h)

    out = "output/social-promo/promo-0824-A-shoes.png"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    return out


def build_B() -> str:
    """儲值金主打:五階梯全表當主視覺。"""
    img, d = base_canvas()

    y = 48
    y = centered(d, y, "儲值金優惠", 92, INK, tk=8, label="主標")
    y = centered(d, y + 6, "洗衣、洗鞋、洗包全品項適用", 40, GREEN_L, bold=False, tk=3, label="副標")

    # ladder table: the owner's own published tiers, nothing added
    ladder = PROMO["stored_value_ladder"]
    ty = y + 36
    row_h = 118
    table_h = row_h * len(ladder)
    d.rounded_rectangle([M, ty, W - M, ty + table_h + 24], radius=18, fill=PANEL,
                        outline=HAIR, width=2)
    ry = ty + 16
    for i, rung in enumerate(ladder):
        if i:
            d.line([M + 30, ry - 2, W - M - 30, ry - 2], fill=HAIR, width=2)
        track_draw(d, M + 48, ry + 22, f"存 {rung['threshold']:,}", 52, INK, label="階梯左")
        track_draw(d, 0, ry + 22, f"送 {rung['bonus']:,}", 52,
                   GOLD if i == len(ladder) - 1 else GREEN,
                   right_at=W - M - 48, label="階梯右")
        ry += row_h
    ry = ty + table_h + 24

    ry = centered(d, ry + 26, "常送洗的家庭,一年下來差很多", 34, INK, bold=False, tk=2, label="說明")
    s = PRICES["鞋子"]; b = PRICES["寢具"]
    teaser = f"參考價:童鞋 ${s['童鞋']}・運動鞋 ${s['一般運動鞋']} 起・雙人棉被 ${b['棉被雙人']}"
    ry = centered(d, ry + 8, teaser, 30, GREEN_L, bold=False, label="參考價")

    footer_h = 190
    qr_block(d, img, H - footer_h - 40, footer_h)

    out = "output/social-promo/promo-0824-B-storedvalue.png"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    return out


def main():
    keys = [k.upper() for k in sys.argv[1:]] or ["A", "B"]
    for key in keys:
        path = {"A": build_A, "B": build_B}[key]()
        print("built:", path)


if __name__ == "__main__":
    main()
