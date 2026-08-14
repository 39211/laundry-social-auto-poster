# -*- coding: utf-8 -*-
"""Knowledge posters: one layout, many topics.

The single-topic build was rewritten into a generator the day after it
shipped, because a poster that teaches one judgement is a poster the shop
outgrows in a fortnight -- the shelf wants a series it can rotate.

Every topic below states a judgement a customer can actually make standing
in their own hallway, and every verdict is honest about what cannot be
undone. That honesty is the selling mechanism, not a caveat on it: of the
three rows, the two that need professional judgement are exactly what the
call to action offers to supply.

Prices come from data/prices.json (the owner's own price list). Nothing here
invents a number.

Run (from the repo root; `python` on PATH does NOT have qrcode/Pillow):
  "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe" \
      scripts/build-poster-knowledge.py [topic-key ...]
"""

import json
import os
import random
import sys

import qrcode
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

MM = 300 / 25.4
def mm(v): return int(round(v * MM))
# Trade rule: one inch of cap height per ten feet of viewing distance.
def dist(m): return round(m * 25.4 / 3.048, 1)

PAPER = (250, 247, 241); INK = (26, 34, 30); GREEN = (15, 76, 58)
GREEN_L = (96, 126, 112); GOLD = (176, 138, 58); HAIR = (214, 206, 192)
PANEL = (243, 239, 231)
OK = (46, 110, 72); PART = (176, 138, 58); NO = (140, 138, 130)

BOLD = "C:/Windows/Fonts/msjhbd.ttc"; LIGHT = "C:/Windows/Fonts/msjh.ttc"
def F(s, b=True): return ImageFont.truetype(BOLD if b else LIGHT, mm(s))

W, H = mm(216), mm(303); M = mm(17)
S = {k: dist(v) for k, v in {
    "title": 2.6, "sub": 1.5, "th": 0.75, "cell": 1.0, "cellsub": 0.75,
    "offer": 1.5, "phone": 1.35, "addr": 1.05, "small": 0.72
}.items()}
def adv(s): return mm(s * 1.24)

PRICES = json.load(open("data/prices.json", encoding="utf-8-sig"))

REF = "data/reference-photos"

# `hero` is a ready-made side-by-side diptych; `pair` is (before, after) and gets
# stitched here. The pair form is the one to use for new topics: the AFTER is
# produced by *editing* the BEFORE (see docs-internal/poster-spec.md), which is
# what keeps both halves the same object under the same light. Independently
# generated halves cannot promise that, and a before/after that isn't obviously
# the same object is worth nothing.
# `band` is (top, height) as fractions of the diptych height. Height should land
# near width/5 so the crop is not stretched when it fills the poster width.
TOPICS = {
    "white-shoe": {
        "hero": f"{REF}/poster-hero-diptych-grok.png",
        "band": (0.40, 0.50),
        "title": "白鞋的黃,有三種",
        "sub": "只有一種,刷得掉",
        "head": "自己先看這三個位置",
        "rows": [
            (OK,   "布面一整圈泛黃", "洗劑殘留", "洗得回來"),
            (PART, "鞋帶孔周圍發深", "汗漬滲入", "多半能淡化"),
            (NO,   "鞋邊膠條轉黃",   "橡膠氧化", "刷不掉,只能淡化"),
        ],
        "foot": "越用力刷,布面越起毛,只會更舊。分不出來先別動它。",
        "cta": "拍一張,我告訴你是哪一種",
        "price": lambda: "運動鞋 {一般運動鞋}・皮鞋 {皮鞋}・名牌鞋 {名牌鞋} 起｜台中免費到府收送".format(**PRICES["鞋子"]),
    },
    "luxury-bag": {
        "pair": (f"{REF}/bag-corner-before.png", f"{REF}/bag-corner-after.png"),
        "band": (0.38, 0.53),
        "title": "精品包,先壞在邊角",
        "sub": "三個階段,處理方式差很多",
        "head": "摸一下四個角,是哪一階段",
        "rows": [
            (OK,   "只是髒、還平整", "灰塵附著",       "清潔就好"),
            (PART, "邊油變薄、發亮", "塗層磨損中",     "還能補,趁早"),
            (NO,   "已露出裡層纖維", "邊油磨穿",       "只能重上,不是洗"),
        ],
        "foot": "磨穿了就不是洗的問題,是補色。摸得到粗糙就要留意。",
        "cta": "拍四個角,我告訴你在哪一階段",
        "price": lambda: "一般包 {一般包}・皮包 {皮包包}・名牌包 {名牌包} 起｜補色另計".format(**PRICES["包包"]),
    },
    "duvet": {
        "pair": (f"{REF}/duvet-corner-before.png", f"{REF}/duvet-corner-after.png"),
        "band": (0.28, 0.53),
        "title": "收棉被前,先聞一下",
        "sub": "摸起來乾,不代表裡面乾",
        "head": "換季收納前的三個檢查",
        "rows": [
            (OK,   "只有壓久的悶味", "表層濕氣",   "洗過曬乾就好"),
            (PART, "摸起來一塊一塊", "填充結塊",   "能重新蓬鬆"),
            (NO,   "有黑點、洗不掉", "已經長霉斑", "只能淡化,不保證"),
        ],
        "foot": "帶著濕氣收進櫃子,下一季打開就是那個味道。",
        # The hook is a smell, but a smell cannot be sent in a photo. The ask has
        # to land on the two rows that *are* visible -- the clumping and the spots.
        "cta": "拍一張,我告訴你要不要洗",
        "price": lambda: "單人 {棉被單人}・雙人 {棉被雙人}・羽絨羊毛被 {羽絨羊毛被}｜台中免費到府收送".format(**PRICES["寢具"]),
    },
}

SHOP = {
    "phone": "0968-327-653",
    "addr": "西屯區青海路二段365號",
    "near": "至善國中對面",
    "hours": "10:00-20:00・週日公休",
    "name": "私享家洗衣店",
    "line": "https://39211.github.io/go/line.html?source=poster-front",
}


def width_of(dd, text, size, tk, bold=True):
    f = F(size, bold); t = mm(tk)
    return sum(dd.textlength(c, font=f) + t for c in text) - t


def build(key: str) -> str:
    spec = TOPICS[key]
    rows = spec["rows"]
    ROW_H = mm(13)
    panel_h = (mm(6) + adv(S["th"]) + mm(4) + len(rows) * ROW_H
               + mm(5) + adv(S["cellsub"]) + mm(6))
    # The hero is the flex element: measure everything the content needs, then
    # give the photograph what is left. Two earlier builds guessed a hero
    # height first and overflowed the sheet.
    below = (mm(9) + adv(S["title"] * 0.9) + mm(3) + mm(6) + adv(S["sub"] * 0.9) + mm(7)
             + panel_h + mm(8)
             + (mm(5) + adv(S["offer"] * 0.92) + mm(1.5) + adv(S["small"]) + mm(5))
             + mm(7) + (mm(6) + mm(34) + mm(2.5) + adv(S["small"]) + mm(2) + adv(S["small"]))
             + mm(4))
    hero_mm = (H - mm(10) - below) / MM
    assert hero_mm >= 36, f"{key}: 主圖只剩 {hero_mm:.0f}mm,內容太多"

    img = Image.new("RGB", (W, H), PAPER)
    px = img.load(); rnd = random.Random(7)
    for _ in range(int(W * H * 0.02)):
        x = rnd.randrange(W); y = rnd.randrange(H); v = rnd.randint(-4, 3)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    d = ImageDraw.Draw(img)

    def track(x, y, text, size, fill, tk=0.0, bold=True, left=True, draw=None, maxw=None, label=""):
        dd = draw or d
        if maxw is not None:
            w = width_of(dd, text, size, tk, bold)
            # Chinese text width moves with size and tracking, and PIL will
            # happily draw past a container edge without complaining. The
            # vertical guard came first; this one caught a footnote overhanging
            # its column by 2.2mm, invisible on screen and obvious in print.
            assert w <= maxw, f"{key} {label} 超寬 {(w - maxw) / MM:.1f}mm:{text[:18]}"
        f = F(size, bold); t = mm(tk); cx = x
        if not left:
            cx = x - width_of(dd, text, size, tk, bold)
        for c in text:
            dd.text((cx, y), c, font=f, fill=fill); cx += dd.textlength(c, font=f) + t
        return y + mm(size * 1.24)

    ph = mm(hero_mm); half = W // 2
    if "pair" in spec:
        a, b = (Image.open(p).convert("RGB") for p in spec["pair"])
        b = b.resize(a.size, Image.LANCZOS)
        src = Image.new("RGB", (a.width * 2, a.height))
        src.paste(a, (0, 0)); src.paste(b, (a.width, 0))
    else:
        src = Image.open(spec["hero"])
    top, height = spec["band"]
    bt = int(src.height * top); bh = int(src.height * height)
    img.paste(src.crop((0, bt, src.width, bt + bh)).resize((W, ph), Image.LANCZOS), (0, 0))
    d.rectangle([half - mm(0.7), 0, half + mm(0.7), ph], fill=PAPER)
    sh = mm(12); sc = Image.new("L", (1, sh))
    for i in range(sh):
        sc.putpixel((0, i), int(150 * (i / sh) ** 1.6))
    img.paste(Image.new("RGB", (W, sh), (18, 26, 22)), (0, ph - sh), sc.resize((W, sh)))
    for x0, txt in ((M, "洗前"), (half + mm(10), "洗後")):
        d.line([x0, ph - mm(8), x0 + mm(6), ph - mm(8)], fill=GOLD, width=mm(0.55))
        track(x0, ph - mm(6.3), txt, 5, (252, 250, 246), tk=1.2)
    sh2 = Image.new("L", (1, mm(3)))
    for i in range(mm(3)):
        sh2.putpixel((0, i), int(75 * (1 - i / mm(3)) ** 1.4))
    img.paste(Image.new("RGB", (W, mm(3)), (60, 60, 55)), (0, ph), sh2.resize((W, mm(3))))

    y = ph + mm(9)
    y = track(M, y, spec["title"], S["title"] * 0.9, GREEN, tk=-0.3, maxw=W - 2 * M, label="主標")
    y += mm(3); d.line([M, y, M + mm(40), y], fill=GOLD, width=mm(0.9)); y += mm(6)
    y = track(M, y, spec["sub"], S["sub"] * 0.9, GREEN_L, tk=0.2, bold=False, maxw=W - 2 * M, label="副標")
    y += mm(7)

    pt = y; d.rectangle([M, pt, W - M, pt + panel_h], fill=PANEL)
    C1 = M + mm(9); C2 = M + mm(78); C3 = W - M - mm(9)
    iy = pt + mm(6)
    track(C1, iy, spec["head"], S["th"], GREEN_L, tk=0.9)
    track(C3, iy, "救不救得回", S["th"], GREEN_L, tk=0.9, left=False)
    iy += adv(S["th"]) + mm(4)
    for i, (col, where, why, verdict) in enumerate(rows):
        if i:
            d.line([C1, iy - mm(2), C3, iy - mm(2)], fill=(224, 219, 207), width=mm(0.3))
        d.ellipse([M + mm(4), iy + mm(2.2), M + mm(4) + mm(3), iy + mm(2.2) + mm(3)], fill=col)
        track(C1, iy + mm(1.5), where, S["cell"], INK, tk=0.1, maxw=C2 - C1 - mm(3), label="欄1")
        track(C2, iy + mm(1.8), why, S["cellsub"], GREEN_L, tk=0.2, bold=False, maxw=C3 - C2 - mm(30), label="欄2")
        track(C3, iy + mm(1.5), verdict, S["cell"] * 0.9, col, tk=0.1, left=False)
        iy += ROW_H
    iy += mm(3); d.line([C1, iy, C3, iy], fill=(224, 219, 207), width=mm(0.3)); iy += mm(4)
    track(C1, iy, spec["foot"], S["cellsub"], INK, tk=0.1, bold=False, maxw=C3 - C1, label="註腳")
    y = pt + panel_h + mm(8)

    CARD_W = W - 2 * M; PAD = mm(8)
    tmp = Image.new("RGB", (CARD_W, mm(60)), GREEN); td = ImageDraw.Draw(tmp)
    jy = mm(5)
    jy = track(PAD, jy, spec["cta"], S["offer"] * 0.92, GOLD, tk=-0.1, draw=td,
               maxw=CARD_W - 2 * PAD, label="CTA")
    jy += mm(1.5)
    jy = track(PAD, jy, spec["price"](), S["small"], (206, 220, 212), tk=0.15, bold=False,
               draw=td, maxw=CARD_W - 2 * PAD, label="價格行")
    th_ = jy + mm(5)
    card = tmp.crop((0, 0, CARD_W, th_)); cd = ImageDraw.Draw(card); n = mm(5)
    for p in ([(0, 0), (n, 0), (0, n)], [(0, th_), (n, th_), (0, th_ - n)],
              [(CARD_W, 0), (CARD_W - n, 0), (CARD_W, n)],
              [(CARD_W, th_), (CARD_W - n, th_), (CARD_W, th_ - n)]):
        cd.polygon(p, fill=PAPER)
    img.paste(card, (M, y)); d = ImageDraw.Draw(img); y += th_ + mm(7)

    d.line([M, y, W - M, y], fill=HAIR, width=mm(0.4)); y += mm(6)
    side = mm(34)
    img.paste(qrcode.make(SHOP["line"]).resize((side, side)), (M, y))
    qlab = track(M, y + side + mm(2.5), "掃碼加 LINE・傳照片估價", S["small"], INK, tk=0.15, bold=False)
    brand = track(M, qlab + mm(2), SHOP["name"], S["small"], GREEN, tk=0.9)
    rx = W - M; ry = y
    ry = track(rx, ry, "打電話", S["small"], GREEN_L, tk=0.5, bold=False, left=False)
    ry = track(rx, ry, SHOP["phone"], S["phone"] * 0.95, INK, tk=-0.25, left=False); ry += mm(3)
    ry = track(rx, ry, SHOP["addr"], S["addr"] * 0.9, INK, tk=0.1, bold=False, left=False)
    ry = track(rx, ry, SHOP["near"], S["addr"] * 0.9, GREEN_L, tk=0.1, bold=False, left=False); ry += mm(1.5)
    ry = track(rx, ry, SHOP["hours"], S["small"], GREEN_L, tk=0.15, bold=False, left=False)
    bottom = max(brand, ry) + mm(3)
    assert bottom <= H - mm(10), f"{key} 越界 {bottom / MM:.1f}mm"

    out = f"output/print/poster-A4-knowledge-{key}.png"
    img.save(out, dpi=(300, 300))
    print(f"  {key:12} → {out}  (主圖 {hero_mm:.0f}mm, 底部 {bottom / MM:.1f}mm)")
    return out


if __name__ == "__main__":
    keys = sys.argv[1:] or list(TOPICS)
    for k in keys:
        build(k)
