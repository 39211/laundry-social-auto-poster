# -*- coding: utf-8 -*-
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = (
    Path(os.environ["LAUNDRY_REPO_ROOT"]) / "line-bot" / "previews"
    if os.environ.get("LAUNDRY_REPO_ROOT")
    else Path(r"C:/Users/cyc39/laundry-repo/line-bot/previews")
)
OUT.mkdir(parents=True, exist_ok=True)
KAI = Path(r"C:/Windows/Fonts/kaiu.ttf")
SANS = Path(r"C:/Windows/Fonts/msjhl.ttc")
CREAM = (244, 239, 230)
INK = (44, 40, 36)
GOLD = (176, 137, 104)
BG = (232, 226, 216)


def bubble(d, xy, w, h):
    d.rounded_rectangle([xy[0], xy[1], xy[0] + w, xy[1] + h], 24, fill=(255, 252, 247), outline=GOLD)


def card(path, title, lines):
    w, h = 1080, 1350
    im = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(im)
    kai = ImageFont.truetype(str(KAI), 48)
    body = ImageFont.truetype(str(SANS), 32, index=0)
    small = ImageFont.truetype(str(SANS), 24, index=0)
    d.text((56, 40), "私享家  ·  對話預覽", font=small, fill=GOLD)
    y = 110
    # guest
    d.rounded_rectangle([420, y, 1024, y + 90], 22, fill=(255, 255, 255))
    d.text((448, y + 26), title, font=body, fill=INK)
    y += 130
    bubble(d, (48, y), 760, 90 + 70 * len(lines))
    d.text((80, y + 24), "私享家", font=small, fill=GOLD)
    yy = y + 64
    for line in lines:
        d.text((80, yy), line, font=body, fill=INK)
        yy += 58
    im.save(path, "JPEG", quality=90)
    print(path.name, path.stat().st_size)


def main():
    card(OUT / "preview-talk.jpg", "洗鞋子會掉色嗎", ["會擔心掉色很正常。", "淺色我們會先試，深色通常比較穩。", "您那件大概是什麼顏色？"])
    card(OUT / "preview-quote.jpg", "單人棉被", ["單人棉被水洗大概 350。", "實際還是看狀況，線上我不會跟您說死。", "您這週方便過來，還是先看我們在哪？"])


if __name__ == "__main__":
    main()
