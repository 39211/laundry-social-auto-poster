# -*- coding: utf-8 -*-
"""私享家 LINE Rich Menu：奶油底、金線圖示、標楷大字。

v4 只寫 richmenu-v4.*，不得覆寫 v2 / v3。
右下格用集點卡取代「店址・電話」：店址與電話在官方帳號主頁已經有，
是六格裡最可被取代的一格；路易莎、鍋日子、裕珍馨都把集點卡放進圖文選單，
這也是唯一能讓沉睡好友「現在就點開」的一格。
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
JPG_OUT = HERE / "richmenu-v5.jpg"
PNG_OUT = HERE / "richmenu-v5.png"
JPG_V5 = HERE / "richmenu-v5.jpg"
PNG_V5 = HERE / "richmenu-v5.png"
JPG_V6 = HERE / "richmenu-v6.jpg"
PNG_V6 = HERE / "richmenu-v6.png"

W, H = 2500, 1686
COL_W = (833, 833, 834)
ROW_H = (843, 843)
MAX_JPEG_BYTES = 1_000_000
JPEG_QUALITY = 88

CREAM = (244, 239, 230)  # #F4EFE6
INK = (44, 40, 36)  # #2C2824
GOLD = (176, 137, 104)  # #B08968  icons / frames / grid
NAVY = (61, 50, 41)  # #3D3229
# #8A6A4B is only 4.32:1 vs cream; #806040 is warm brown >= 4.5:1
EN_BROWN = (128, 96, 64)  # #806040  English caption + separator

KAIU = Path(r"C:/Windows/Fonts/kaiu.ttf")
MSJH = Path(r"C:/Windows/Fonts/msjh.ttc")

TITLE_PX = 120
EN_PX = 44
ICON_PX = 300
STROKE = 22
FRAME_INSET = 28
FRAME_WIDTH = 3
GRID_WIDTH = 2

GOLD_A = GOLD + (255,)


def srgb_lin(c: float) -> float:
    s = c / 255.0
    return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4


def rel_luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.2126 * srgb_lin(r) + 0.7152 * srgb_lin(g) + 0.0722 * srgb_lin(b)


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    l1, l2 = rel_luminance(a), rel_luminance(b)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def _line(d: ImageDraw.ImageDraw, pts, width: int, color) -> None:
    d.line(pts, fill=color, width=width, joint="curve")
    r = max(1, width // 2)
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)


def _icon_canvas():
    scale = 2
    size = ICON_PX * scale
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im), scale, STROKE * scale


def _finish_icon(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im.resize((ICON_PX, ICON_PX), Image.Resampling.LANCZOS)
    cropped = im.crop(bbox)
    cw, ch = cropped.size
    scale = min(ICON_PX / cw, ICON_PX / ch)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    cropped = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (ICON_PX, ICON_PX), (0, 0, 0, 0))
    canvas.paste(cropped, ((ICON_PX - nw) // 2, (ICON_PX - nh) // 2), cropped)
    return canvas


def icon_calendar() -> Image.Image:
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    for x0 in (92, 178):
        d.rounded_rectangle(
            [x0 * s, 16 * s, (x0 + 30) * s, 72 * s],
            radius=12 * s,
            outline=c,
            width=w,
        )
    d.rounded_rectangle(
        [38 * s, 50 * s, 262 * s, 278 * s],
        radius=22 * s,
        outline=c,
        width=w,
    )
    _line(d, [(62 * s, 108 * s), (238 * s, 108 * s)], w, c)
    _line(d, [(92 * s, 182 * s), (132 * s, 226 * s), (218 * s, 128 * s)], w, c)
    return _finish_icon(im)


def icon_van() -> Image.Image:
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    d.rounded_rectangle(
        [16 * s, 58 * s, 168 * s, 186 * s],
        radius=16 * s,
        outline=c,
        width=w,
    )
    cab = [
        (168 * s, 100 * s),
        (214 * s, 100 * s),
        (272 * s, 148 * s),
        (272 * s, 186 * s),
        (168 * s, 186 * s),
    ]
    _line(d, cab + [cab[0]], w, c)
    d.rounded_rectangle(
        [188 * s, 120 * s, 244 * s, 164 * s],
        radius=8 * s,
        outline=c,
        width=w,
    )
    d.rounded_rectangle(
        [42 * s, 84 * s, 142 * s, 150 * s],
        radius=8 * s,
        outline=c,
        width=w,
    )
    _line(d, [(250 * s, 166 * s), (282 * s, 166 * s)], w, c)
    for cx in (76, 210):
        d.ellipse(
            [(cx - 34) * s, 166 * s, (cx + 34) * s, 234 * s],
            outline=c,
            width=w,
        )
    return _finish_icon(im)


def icon_price() -> Image.Image:
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    paper = [
        (64 * s, 28 * s),
        (176 * s, 28 * s),
        (236 * s, 88 * s),
        (236 * s, 272 * s),
        (64 * s, 272 * s),
    ]
    _line(d, paper + [paper[0]], w, c)
    _line(d, [(176 * s, 28 * s), (176 * s, 88 * s), (236 * s, 88 * s)], w, c)
    font = ImageFont.truetype(str(Path(r"C:/Windows/Fonts/msjhbd.ttc")), 210, index=0)
    bb = font.getbbox("$")
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    cx, cy = 138 * s, 168 * s
    d.text(
        (cx - tw / 2 - bb[0], cy - th / 2 - bb[1]),
        "$",
        font=font,
        fill=(0, 0, 0, 0),
        stroke_width=max(14, w // 2),
        stroke_fill=c,
    )
    return _finish_icon(im)


def icon_search_shirt() -> Image.Image:
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    _line(d, [(64 * s, 78 * s), (100 * s, 78 * s)], w, c)
    _line(d, [(136 * s, 78 * s), (172 * s, 78 * s)], w, c)
    _line(d, [(100 * s, 78 * s), (118 * s, 68 * s), (136 * s, 78 * s)], w, c)
    _line(d, [(100 * s, 78 * s), (118 * s, 122 * s), (136 * s, 78 * s)], w, c)
    _line(
        d,
        [(64 * s, 78 * s), (16 * s, 112 * s), (34 * s, 148 * s), (64 * s, 118 * s)],
        w,
        c,
    )
    _line(
        d,
        [(172 * s, 78 * s), (220 * s, 112 * s), (202 * s, 148 * s), (172 * s, 118 * s)],
        w,
        c,
    )
    _line(d, [(64 * s, 118 * s), (64 * s, 248 * s)], w, c)
    _line(d, [(172 * s, 118 * s), (172 * s, 248 * s)], w, c)
    _line(d, [(64 * s, 248 * s), (172 * s, 248 * s)], w, c)
    d.ellipse([152 * s, 152 * s, 268 * s, 268 * s], outline=c, width=w)
    _line(d, [(252 * s, 252 * s), (290 * s, 290 * s)], w, c)
    return _finish_icon(im)


def icon_pin() -> Image.Image:
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    cx, cy, r = 150.0, 108.0, 76.0
    pts = []
    for deg in range(210, -31, -4):
        a = math.radians(deg)
        pts.append(((cx + r * math.cos(a)) * s, (cy - r * math.sin(a)) * s))
    pts.append((cx * s, 278 * s))
    pts.append(pts[0])
    d.line(pts, fill=c, width=w, joint="curve")
    cap = max(1, w // 2)
    tx, ty = cx * s, 278 * s
    d.ellipse((tx - cap, ty - cap, tx + cap, ty + cap), fill=c)
    d.ellipse(
        [(cx - 30) * s, (cy - 30) * s, (cx + 30) * s, (cy + 30) * s],
        outline=c,
        width=w,
    )
    return _finish_icon(im)


def _bezier(p0, p1, p2, n: int = 56) -> list[tuple[float, float]]:
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def icon_phone() -> Image.Image:
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    outer = _bezier((78, 36), (10, 168), (214, 268))
    inner = _bezier((118, 78), (78, 164), (190, 230))
    path = [(x * s, y * s) for x, y in outer]
    path += [(x * s, y * s) for x, y in reversed(inner)]
    path.append(path[0])
    d.line(path, fill=c, width=w, joint="curve")
    ends = [
        ((outer[0][0] + inner[0][0]) / 2, (outer[0][1] + inner[0][1]) / 2),
        ((outer[-1][0] + inner[-1][0]) / 2, (outer[-1][1] + inner[-1][1]) / 2),
    ]
    for x, y in ends:
        d.ellipse([(x - 38) * s, (y - 38) * s, (x + 38) * s, (y + 38) * s], outline=c, width=w)
    return _finish_icon(im)


def icon_point_card() -> Image.Image:
    """集點格子＋一格蓋章勾。線寬沿用 STROKE（≥18px），外框 ≥260×260。"""
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    d.rounded_rectangle(
        [16 * s, 16 * s, 284 * s, 284 * s],
        radius=22 * s,
        outline=c,
        width=w,
    )
    boxes = [
        (50, 50),
        (120, 50),
        (190, 50),
        (50, 120),
        (120, 120),
        (190, 120),
        (50, 190),
        (120, 190),
        (190, 190),
    ]
    side = 60
    for x0, y0 in boxes:
        d.rounded_rectangle(
            [x0 * s, y0 * s, (x0 + side) * s, (y0 + side) * s],
            radius=10 * s,
            outline=c,
            width=w,
        )
    x0, y0 = 190, 190
    _line(
        d,
        [
            ((x0 + 10) * s, (y0 + 34) * s),
            ((x0 + 24) * s, (y0 + 50) * s),
            ((x0 + 54) * s, (y0 + 14) * s),
        ],
        w,
        c,
    )
    return _finish_icon(im)


def icon_faq() -> Image.Image:
    """問號對話框。線寬沿用 STROKE（≥18px）。"""
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    d.rounded_rectangle(
        [36 * s, 24 * s, 264 * s, 204 * s],
        radius=28 * s,
        outline=c,
        width=w,
    )
    tail = [
        (108 * s, 204 * s),
        (84 * s, 268 * s),
        (168 * s, 204 * s),
    ]
    _line(d, tail, w, c)
    font = ImageFont.truetype(str(MSJH), 168, index=0)
    q = "?"
    bb = font.getbbox(q)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    cx, cy = 150 * s, 112 * s
    d.text(
        (cx - tw / 2 - bb[0], cy - th / 2 - bb[1]),
        q,
        font=font,
        fill=c,
    )
    return _finish_icon(im)


def icon_camera() -> Image.Image:
    """線稿相機：機身、鏡頭、取景凸起。線寬沿用 STROKE（≥18px）。"""
    im, d, s, w = _icon_canvas()
    c = GOLD_A
    d.rounded_rectangle(
        [108 * s, 28 * s, 192 * s, 78 * s],
        radius=14 * s,
        outline=c,
        width=w,
    )
    d.rounded_rectangle(
        [24 * s, 70 * s, 276 * s, 268 * s],
        radius=22 * s,
        outline=c,
        width=w,
    )
    d.ellipse([86 * s, 104 * s, 214 * s, 232 * s], outline=c, width=w)
    d.ellipse([118 * s, 136 * s, 182 * s, 200 * s], outline=c, width=w)
    d.ellipse([214 * s, 92 * s, 250 * s, 128 * s], outline=c, width=w)
    return _finish_icon(im)


# L2 / v4 排列：前五格沿用 v3。右下「店址・電話」換成「我的集點卡」。
# 理由：店址與電話在官方帳號主頁已經有，是六格裡最可被取代的一格；
# 集點卡是同業（路易莎、鍋日子、裕珍馨）最一致的做法，且是唯一能讓
# 沉睡好友「現在就點開」的東西。鍋日子集滿 10 點、第 5 點先給階段回饋。
CELLS_V4 = [
    ("拍照問價", "PHOTO QUOTE", icon_camera),
    ("免費到府收送", "FREE PICKUP", icon_van),
    ("服務價目", "PRICE LIST", icon_price),
    ("查件進度", "TRACK", icon_search_shirt),
    ("預約到店", "RESERVE", icon_calendar),
    ("我的集點卡", "POINT CARD", icon_point_card),
]
# W5：第五格（中下）改常見問題；其餘五格與 v3 相同。
CELLS_V5 = [
    ("拍照問價", "PHOTO QUOTE", icon_camera),
    ("免費到府收送", "FREE PICKUP", icon_van),
    ("服務價目", "PRICE LIST", icon_price),
    ("查件進度", "TRACK", icon_search_shirt),
    ("常見問題", "FAQ", icon_faq),
    ("店址・電話", "LOCATION", icon_pin),
]
# v6 = v5 版面 + 右下換集點卡
CELLS_V6 = [
    ("拍照問價", "PHOTO QUOTE", icon_camera),
    ("免費到府收送", "FREE PICKUP", icon_van),
    ("服務價目", "PRICE LIST", icon_price),
    ("查件進度", "TRACK", icon_search_shirt),
    ("常見問題", "FAQ", icon_faq),
    ("我的集點卡", "POINT CARD", icon_point_card),
]
CELLS = CELLS_V5


def cell_origin(i: int) -> tuple[int, int, int, int]:
    col, row = i % 3, i // 3
    x = sum(COL_W[:col])
    y = sum(ROW_H[:row])
    return x, y, COL_W[col], ROW_H[row]


def draw_tracked(draw: ImageDraw.ImageDraw, text: str, cx: float, y: float, font, fill, tracking: int) -> None:
    widths = []
    for ch in text:
        bb = font.getbbox(ch)
        widths.append(bb[2] - bb[0])
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x = cx - total / 2
    for ch, gw in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += gw + tracking


def render(cells=None) -> Image.Image:
    cells = cells or CELLS
    im = Image.new("RGB", (W, H), CREAM)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    od = ImageDraw.Draw(overlay)
    title_font = ImageFont.truetype(str(KAIU), TITLE_PX)
    en_font = ImageFont.truetype(str(MSJH), EN_PX, index=0)

    for i, (zh, en, maker) in enumerate(cells):
        x0, y0, cw, ch = cell_origin(i)
        draw.rectangle(
            [x0 + FRAME_INSET, y0 + FRAME_INSET, x0 + cw - FRAME_INSET, y0 + ch - FRAME_INSET],
            outline=GOLD,
            width=FRAME_WIDTH,
        )
        icon = maker()
        ix = x0 + (cw - ICON_PX) // 2
        iy = y0 + 86
        overlay.paste(icon, (ix, iy), icon)
        cx = x0 + cw / 2
        title_y = y0 + 430
        usable = cw - 2 * FRAME_INSET - 20
        tracking = 4 if len(zh) >= 6 else (14 if len(zh) >= 4 else 22)
        ch_w = [title_font.getbbox(ch)[2] - title_font.getbbox(ch)[0] for ch in zh]
        while len(zh) > 1 and sum(ch_w) + tracking * (len(zh) - 1) > usable and tracking > 0:
            tracking -= 2
        draw_tracked(draw, zh, cx, title_y, title_font, INK, tracking)
        tb = title_font.getbbox(zh[0])
        title_h = tb[3] - tb[1]
        line_y = title_y + title_h + 28
        draw.line([(cx - 90, line_y), (cx + 90, line_y)], fill=EN_BROWN, width=3)
        en_y = line_y + 22
        draw_tracked(draw, en, cx, en_y, en_font, EN_BROWN, 6)

    x = COL_W[0]
    od.line([(x, 0), (x, H)], fill=GOLD_A, width=GRID_WIDTH)
    x += COL_W[1]
    od.line([(x, 0), (x, H)], fill=GOLD_A, width=GRID_WIDTH)
    od.line([(0, ROW_H[0]), (W, ROW_H[0])], fill=GOLD_A, width=GRID_WIDTH)
    return Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")


def save_jpeg(im: Image.Image, path: Path) -> int:
    quality = JPEG_QUALITY
    while quality >= 70:
        im.save(path, "JPEG", quality=quality, optimize=True, subsampling=0)
        n = path.stat().st_size
        if n <= MAX_JPEG_BYTES and quality <= 90:
            return n
        quality -= 4
    raise SystemExit(f"JPEG still too large: {path.stat().st_size}")


def main() -> None:
    ratio = contrast_ratio(INK, CREAM)
    en_ratio = contrast_ratio(EN_BROWN, CREAM)
    for cells, jpg, png in (
        (CELLS_V5, JPG_V5, PNG_V5),
        (CELLS_V6, JPG_V6, PNG_V6),
    ):
        im = render(cells)
        jpg_bytes = save_jpeg(im, jpg)
        im.save(png, "PNG", optimize=True)
        print("jpg", jpg, jpg_bytes)
        print("png", png, png.stat().st_size)
        print("size", im.size)
    print("contrast_ink_cream", f"{ratio:.2f}:1")
    print("contrast_en_cream", f"{en_ratio:.2f}:1")
    print("title_px", TITLE_PX, "en_px", EN_PX, "stroke", STROKE, "icon", ICON_PX)


if __name__ == "__main__":
    main()
