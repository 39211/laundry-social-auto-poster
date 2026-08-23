# -*- coding: utf-8 -*-
"""到府收送流程海報:私享家沒有的「物流透明感」內容類型。

不是抄 Quick快客的版型,是學它「把收送流程本身當成一則內容」這個做法——
私享家的知識海報系列(build-poster-knowledge.py)教的是「怎麼判斷」,這張教的是
「送到我們手上之後會怎麼樣」。四個步驟全部來自網站首頁已經在用的流程說明與
既有的收送政策(免費、無最低消費),沒有新編一套流程。

Run (from the repo root; `python` on PATH does NOT have qrcode/Pillow):
  "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe" \
      scripts/build-poster-process.py
"""

import os
import sys

import qrcode
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

MM = 300 / 25.4
def mm(v): return int(round(v * MM))
def dist(m): return round(m * 25.4 / 3.048, 1)

PAPER = (250, 247, 241); INK = (26, 34, 30); GREEN = (15, 76, 58)
GREEN_L = (96, 126, 112); GOLD = (176, 138, 58); HAIR = (214, 206, 192)
PANEL = (243, 239, 231)

BOLD = "C:/Windows/Fonts/msjhbd.ttc"; LIGHT = "C:/Windows/Fonts/msjh.ttc"
def F(s, b=True): return ImageFont.truetype(BOLD if b else LIGHT, mm(s))

W, H = mm(216), mm(303); M = mm(17)
S = {k: dist(v) for k, v in {
    "title": 2.6, "sub": 1.5, "step_no": 1.7, "step_title": 1.5, "step_body": 1.0,
    "offer": 1.5, "phone": 1.35, "addr": 1.05, "small": 0.72
}.items()}
def adv(s): return mm(s * 1.24)

SHOP = {
    "phone": "0968-327-653",
    "addr": "西屯區青海路二段365號",
    "near": "至善國中對面",
    "hours": "10:00-20:00・週日公休",
    "name": "私享家洗衣店",
    "line": "https://39211.github.io/go/line.html?source=poster-process",
}

# Every step is already documented on the public site (docs/index.html "送洗前流程"
# + the citywide-pickup service page's free/no-minimum policy) -- this poster is
# a different presentation of the same facts, not a new claim.
STEPS = [
    ("LINE 傳照片", "拍照片,先說明狀況"),
    ("門市判斷回覆", "判斷處理方式與費用"),
    ("約時間到府收件", "免費收送,沒有最低消費"),
    ("洗好送回府上", "處理完成,直接送回"),
]

TITLE = "到府收送怎麼運作?"
SUB = "四個步驟,人不用出門"
OFFER = "台中市全區免費收送"
OFFER_SUB = "沒有最低消費,清潔費用依實際物件另計"


def width_of(dd, text, size, tk, bold=True):
    f = F(size, bold); t = mm(tk)
    return sum(dd.textlength(c, font=f) + t for c in text) - t


def track(d, x, y, text, size, fill, tk=0.0, bold=True, left=True, draw=None, maxw=None, label=""):
    dd = draw or d
    if maxw is not None:
        w = width_of(dd, text, size, tk, bold)
        assert w <= maxw, f"{label} 超寬 {(w - maxw) / MM:.1f}mm:{text[:18]}"
    f = F(size, bold); t = mm(tk); cx = x
    if not left:
        cx = x - width_of(dd, text, size, tk, bold)
    for c in text:
        dd.text((cx, y), c, font=f, fill=fill); cx += dd.textlength(c, font=f) + t
    return y + mm(size * 1.24)


def build() -> str:
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    y = mm(20)
    y = track(d, M, y, TITLE, S["title"], GREEN, tk=-0.3, maxw=W - 2 * M, label="主標")
    y += mm(3); d.line([M, y, M + mm(40), y], fill=GOLD, width=mm(0.9)); y += mm(6)
    y = track(d, M, y, SUB, S["sub"], GREEN_L, tk=0.2, bold=False, maxw=W - 2 * M, label="副標")
    y += mm(14)

    # Vertical step flow: a numbered badge column with a connecting line, and a
    # text column to its right. The line is drawn first so the badges sit on
    # top of it cleanly.
    badge_r = mm(9); badge_cx = M + badge_r; text_x = M + badge_r * 2 + mm(8)
    text_w = W - M - text_x
    row_h = mm(25)
    line_top = mm(20) + adv(S["title"]) + mm(3) + mm(6) + adv(S["sub"]) + mm(8) + badge_r
    line_bottom = line_top + row_h * (len(STEPS) - 1)
    d.line([badge_cx, line_top, badge_cx, line_bottom], fill=HAIR, width=mm(0.6))

    for i, (title, body) in enumerate(STEPS):
        cy = line_top + row_h * i
        d.ellipse([badge_cx - badge_r, cy - badge_r, badge_cx + badge_r, cy + badge_r], fill=GREEN)
        no_w = width_of(d, str(i + 1), S["step_no"], 0)
        d.text((badge_cx - no_w / 2, cy - mm(S["step_no"] * 0.62)), str(i + 1), font=F(S["step_no"]), fill=(252, 250, 246))

        ty = cy - mm(S["step_title"] * 0.62) - mm(1)
        ty = track(d, text_x, ty, title, S["step_title"], INK, tk=0.2, maxw=text_w, label=f"步驟{i+1}標題")
        ty += mm(2)
        track(d, text_x, ty, body, S["step_body"], GREEN_L, tk=0.1, bold=False, maxw=text_w, label=f"步驟{i+1}內文")

    # line_bottom is the last badge's centre; the step body text drawn beneath
    # it (title + gap + body line) extends roughly title*0.62 + 1 + body*1.24
    # mm past that centre, which badge_r + a flat gap does not account for --
    # the card overlapped step 4's body text until this was measured instead
    # of guessed.
    last_body_bottom = mm(S["step_title"] * 0.62 + 1 + S["step_body"] * 1.24)
    y = line_bottom + last_body_bottom + mm(6)

    CARD_W = W - 2 * M; PAD = mm(8)
    tmp = Image.new("RGB", (CARD_W, mm(60)), GREEN); td = ImageDraw.Draw(tmp)
    jy = mm(5)
    jy = track(d, PAD, jy, OFFER, S["offer"] * 0.92, GOLD, tk=-0.1, draw=td, maxw=CARD_W - 2 * PAD, label="優惠標題")
    jy += mm(1.5)
    jy = track(d, PAD, jy, OFFER_SUB, S["small"], (206, 220, 212), tk=0.15, bold=False, draw=td, maxw=CARD_W - 2 * PAD, label="優惠副行")
    th_ = jy + mm(5)
    card = tmp.crop((0, 0, CARD_W, th_)); cd = ImageDraw.Draw(card); n = mm(5)
    for p in ([(0, 0), (n, 0), (0, n)], [(0, th_), (n, th_), (0, th_ - n)],
              [(CARD_W, 0), (CARD_W - n, 0), (CARD_W, n)],
              [(CARD_W, th_), (CARD_W - n, th_), (CARD_W, th_ - n)]):
        cd.polygon(p, fill=PAPER)
    img.paste(card, (M, y)); d = ImageDraw.Draw(img); y += th_ + mm(6)

    d.line([M, y, W - M, y], fill=HAIR, width=mm(0.4)); y += mm(5)
    side = mm(34)
    img.paste(qrcode.make(SHOP["line"]).resize((side, side)), (M, y))
    qlab = track(d, M, y + side + mm(2.5), "掃碼加 LINE・傳照片估價", S["small"], INK, tk=0.15, bold=False)
    brand = track(d, M, qlab + mm(2), SHOP["name"], S["small"], GREEN, tk=0.9)
    rx = W - M; ry = y
    ry = track(d, rx, ry, "打電話", S["small"], GREEN_L, tk=0.5, bold=False, left=False)
    ry = track(d, rx, ry, SHOP["phone"], S["phone"] * 0.95, INK, tk=-0.25, left=False); ry += mm(3)
    ry = track(d, rx, ry, SHOP["addr"], S["addr"] * 0.9, INK, tk=0.1, bold=False, left=False)
    ry = track(d, rx, ry, SHOP["near"], S["addr"] * 0.9, GREEN_L, tk=0.1, bold=False, left=False); ry += mm(1.5)
    ry = track(d, rx, ry, SHOP["hours"], S["small"], GREEN_L, tk=0.15, bold=False, left=False)
    bottom = max(brand, ry) + mm(3)
    assert bottom <= H - mm(10), f"越界 {bottom / MM:.1f}mm"

    out = "output/print/poster-A4-process-pickup-delivery.png"
    img.save(out, dpi=(300, 300))
    print(f"  process → {out}  (底部 {bottom / MM:.1f}mm)")
    return out


if __name__ == "__main__":
    build()
