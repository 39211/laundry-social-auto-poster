# -*- coding: utf-8 -*-
"""本地驗 richmenu-v3.jpg 與 areas。不發網路請求。"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

import make_richmenu as mk
import upload_default as up

HERE = Path(__file__).resolve().parent
FAILS: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    if ok:
        print(f"PASS: {name}" + (f" ({detail})" if detail else ""))
    else:
        msg = f"FAIL: {name}" + (f" — {detail}" if detail else "")
        print(msg)
        FAILS.append(msg)


def test_jpg() -> None:
    p = up.JPG_PATH
    check("jpg exists", p.is_file(), str(p))
    if not p.is_file():
        return
    n = p.stat().st_size
    check("jpg <= 1MB", n <= 1_000_000, f"{n} bytes")
    with Image.open(p) as im:
        check("jpg size 2500x1686", im.size == (2500, 1686), str(im.size))


def test_areas() -> None:
    areas = up.build_areas()
    ok, detail = up.validate_areas(areas)
    check("areas no overlap full cover", ok, detail)
    total = sum(a["bounds"]["width"] * a["bounds"]["height"] for a in areas)
    check("union pixels 2500x1686", total == 2500 * 1686, str(total))


# U1 表寫死在測試裡，不得從 upload_default 匯入。
U1_EXPECTED = [
    {"type": "message", "text": "拍照問價"},
    {"type": "message", "text": "外收送預約"},
    {"type": "message", "text": "價目表"},
    {"type": "message", "text": "物件查詢"},
    {"type": "message", "text": "預約到店"},
    {"type": "uri", "uri": "https://maps.app.goo.gl/kUREPkWDXYNTkpct7"},
]


def test_actions() -> None:
    areas_v3 = up.build_areas(up.V3_ACTIONS)
    if len(areas_v3) != len(U1_EXPECTED):
        check("v3 action count", False, f"{len(areas_v3)} != {len(U1_EXPECTED)}")
        return
    bad = []
    for i, (got, exp) in enumerate(zip(areas_v3, U1_EXPECTED)):
        if got["action"] != exp:
            bad.append(f"[{i}] expected {exp} got {got['action']}")
    check("v3 actions match U1", not bad, "; ".join(bad) if bad else "6/6")
    areas = up.build_areas()
    w5 = [
        {"type": "message", "text": "拍照問價"},
        {"type": "message", "text": "外收送預約"},
        {"type": "message", "text": "價目表"},
        {"type": "message", "text": "物件查詢"},
        {"type": "message", "text": "常見問題"},
        {"type": "uri", "uri": "https://maps.app.goo.gl/kUREPkWDXYNTkpct7"},
    ]
    bad = []
    for i, (got, exp) in enumerate(zip(areas, w5)):
        if got["action"] != exp:
            bad.append(f"[{i}] expected {exp} got {got['action']}")
    check("default actions match W5", not bad, "; ".join(bad) if bad else "6/6")
    body = up.menu_body()
    check("chatBarText U3", body.get("chatBarText") == "看服務・問價", str(body.get("chatBarText")))
    check("chatBarText <=14", len(body.get("chatBarText") or "") <= 14)


def test_contrast() -> None:
    check("brand ink #2C2824", mk.INK == (44, 40, 36), str(mk.INK))
    check("brand cream #F4EFE6", mk.CREAM == (244, 239, 230), str(mk.CREAM))
    ratio = mk.contrast_ratio((44, 40, 36), (244, 239, 230))
    check("contrast >= 4.5", ratio >= 4.5, f"{ratio:.2f}:1")
    en_ratio = mk.contrast_ratio(mk.EN_BROWN, mk.CREAM)
    check("en contrast >= 4.5", en_ratio >= 4.5, f"{en_ratio:.2f}:1")


def test_secrets_paths() -> None:
    orig = up.HERE
    try:
        with tempfile.TemporaryDirectory() as td:
            here = Path(td) / "line-bot"
            here.mkdir()
            up.HERE = here

            raised = None
            try:
                up.load_token()
            except Exception as e:
                raised = e
            check(
                "load_token neither secrets",
                raised is not None and "secrets" in str(raised).lower(),
                "no raise" if raised is None else type(raised).__name__,
            )

            parent_dir = here.parent / "secrets"
            parent_dir.mkdir()
            parent_file = parent_dir / "line-channel.json"
            parent_file.write_text(
                json.dumps({"line_channel_token": "fake-parent-token"}),
                encoding="utf-8",
            )
            try:
                tok = up.load_token()
                check("load_token parent secrets", tok == "fake-parent-token")
            except Exception as e:
                check("load_token parent secrets", False, type(e).__name__)

            parent_file.unlink()
            local_dir = here / "secrets"
            local_dir.mkdir()
            (local_dir / "line-channel.json").write_text(
                json.dumps({"line_channel_token": "fake-local-token"}),
                encoding="utf-8",
            )
            try:
                tok = up.load_token()
                check("load_token local secrets", tok == "fake-local-token")
            except Exception as e:
                check("load_token local secrets", False, type(e).__name__)
    finally:
        up.HERE = orig


# L2 表寫死在測試裡，不得從 upload_default 匯入。
L2_V4_EXPECTED = [
    {"type": "message", "text": "拍照問價"},
    {"type": "message", "text": "外收送預約"},
    {"type": "message", "text": "價目表"},
    {"type": "message", "text": "物件查詢"},
    {"type": "message", "text": "預約到店"},
    {"type": "uri", "uri": "https://liff.line.me/example-point-card"},
]


def test_v4_jpg() -> None:
    p = up.JPG_V4_PATH
    check("v4 jpg exists", p.is_file(), str(p))
    if not p.is_file():
        return
    n = p.stat().st_size
    check("v4 jpg <= 1MB", n <= 1_000_000, f"{n} bytes")
    with Image.open(p) as im:
        check("v4 jpg size 2500x1686", im.size == (2500, 1686), str(im.size))
    png = HERE / "richmenu-v4.png"
    check("v4 png exists", png.is_file(), str(png))
    if png.is_file():
        with Image.open(png) as im:
            check("v4 png size 2500x1686", im.size == (2500, 1686), str(im.size))
    ratio = mk.contrast_ratio(mk.INK, mk.CREAM)
    check("v4 contrast >= 4.5", ratio >= 4.5, f"{ratio:.2f}:1")
    en_ratio = mk.contrast_ratio(mk.EN_BROWN, mk.CREAM)
    check("v4 en contrast >= 4.5", en_ratio >= 4.5, f"{en_ratio:.2f}:1")


def test_v4_areas_and_l2_actions() -> None:
    dummy = L2_V4_EXPECTED[5]["uri"]
    areas = up.build_areas(up.v4_actions(dummy))
    ok, detail = up.validate_areas(areas)
    check("v4 areas no overlap full cover", ok, detail)
    total = sum(a["bounds"]["width"] * a["bounds"]["height"] for a in areas)
    check("v4 union pixels 2500x1686", total == 2500 * 1686, str(total))
    if len(areas) != len(L2_V4_EXPECTED):
        check("v4 action count", False, f"{len(areas)} != {len(L2_V4_EXPECTED)}")
        return
    bad = []
    for i, (got, exp) in enumerate(zip(areas, L2_V4_EXPECTED)):
        if got["action"] != exp:
            bad.append(f"[{i}] expected {exp} got {got['action']}")
    check("v4 actions match L2", not bad, "; ".join(bad) if bad else "6/6")


W5_EXPECTED = [
    {"type": "message", "text": "拍照問價"},
    {"type": "message", "text": "外收送預約"},
    {"type": "message", "text": "價目表"},
    {"type": "message", "text": "物件查詢"},
    {"type": "message", "text": "常見問題"},
    {"type": "uri", "uri": "https://maps.app.goo.gl/kUREPkWDXYNTkpct7"},
]
W6_EXPECTED = [
    {"type": "message", "text": "拍照問價"},
    {"type": "message", "text": "外收送預約"},
    {"type": "message", "text": "價目表"},
    {"type": "message", "text": "物件查詢"},
    {"type": "message", "text": "常見問題"},
    {"type": "uri", "uri": "https://liff.line.me/example-point-card"},
]


def test_v5_jpg() -> None:
    p = up.JPG_V5_PATH
    check("v5 jpg exists", p.is_file(), str(p))
    if not p.is_file():
        return
    n = p.stat().st_size
    check("v5 jpg <= 1MB", n <= 1_000_000, f"{n} bytes")
    with Image.open(p) as im:
        check("v5 jpg size 2500x1686", im.size == (2500, 1686), str(im.size))
    png = HERE / "richmenu-v5.png"
    check("v5 png exists", png.is_file(), str(png))


def test_v6_jpg() -> None:
    p = up.JPG_V6_PATH
    check("v6 jpg exists", p.is_file(), str(p))
    if not p.is_file():
        return
    n = p.stat().st_size
    check("v6 jpg <= 1MB", n <= 1_000_000, f"{n} bytes")
    with Image.open(p) as im:
        check("v6 jpg size 2500x1686", im.size == (2500, 1686), str(im.size))
    png = HERE / "richmenu-v6.png"
    check("v6 png exists", png.is_file(), str(png))


def test_auto_select_v5_without_file() -> None:
    check(
        "no real point-card-url.txt",
        not up.POINT_CARD_URL_PATH.is_file(),
        str(up.POINT_CARD_URL_PATH),
    )
    sel = up.resolve_menu()
    check("no url file uses v5", sel["version"] == "v5", str(sel["version"]))
    check("no url file name sxj-v5", sel["name"] == "sxj-v5", str(sel["name"]))
    check("no url file jpg is v5", Path(sel["jpg"]).name == "richmenu-v5.jpg", str(sel["jpg"]))


def test_auto_select_v6_injected_url() -> None:
    injected = W6_EXPECTED[5]["uri"]
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "point-card-url.txt"
        p.write_text(injected + "\n", encoding="utf-8")
        orig = up.POINT_CARD_URL_PATH
        try:
            up.POINT_CARD_URL_PATH = p
            sel = up.resolve_menu()
            check("valid url uses v6", sel["version"] == "v6", str(sel["version"]))
            check("valid url name sxj-v6", sel["name"] == "sxj-v6", str(sel["name"]))
            check("valid url jpg is v6", Path(sel["jpg"]).name == "richmenu-v6.jpg", str(sel["jpg"]))
            areas = up.build_areas(sel["actions"])
            bad = []
            for i, (got, exp) in enumerate(zip(areas, W6_EXPECTED)):
                if got["action"] != exp:
                    bad.append(f"[{i}] expected {exp} got {got['action']}")
            check("injected v6 actions match W5+card", not bad, "; ".join(bad) if bad else "6/6")
            last = areas[5]["action"] if len(areas) > 5 else {}
            check("v6 last uri equals injected", last.get("uri") == injected, str(last))
            fifth = areas[4]["action"] if len(areas) > 4 else {}
            check("v6 fifth is FAQ", fifth.get("text") == "常見問題", str(fifth))
        finally:
            up.POINT_CARD_URL_PATH = orig
    check("did not leave point-card-url.txt", not up.POINT_CARD_URL_PATH.is_file())


def test_auto_select_not_https_falls_back_v5() -> None:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "point-card-url.txt"
        p.write_text("http://example.test/not-https\n", encoding="utf-8")
        orig = up.POINT_CARD_URL_PATH
        try:
            up.POINT_CARD_URL_PATH = p
            sel = up.resolve_menu()
            check("non-https uses v5", sel["version"] == "v5", str(sel["version"]))
            check("non-https name sxj-v5", sel["name"] == "sxj-v5", str(sel["name"]))
        finally:
            up.POINT_CARD_URL_PATH = orig


def test_cream_bg() -> None:
    p = up.JPG_PATH
    if not p.is_file():
        check("cream sample", False, "no jpg")
        return
    im = Image.open(p).convert("RGB")
    cream = mk.CREAM
    bad = []
    for i in range(6):
        x0, y0, cw, ch = mk.cell_origin(i)
        y1 = y0
        y2 = y0 + int(ch * 0.30)
        x1 = x0 + int(cw * 0.30)
        x2 = x0 + int(cw * 0.70)
        crop = im.crop((x1, y1, x2, y2))
        avg = crop.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
        delta = tuple(abs(avg[c] - cream[c]) for c in range(3))
        if max(delta) > 45 or min(avg[:3]) < 180:
            bad.append(f"cell{i} avg={avg} d={delta}")
    check("cream bg top-30%", not bad, "; ".join(bad) if bad else "6 cells")


def main() -> int:
    test_jpg()
    test_areas()
    test_actions()
    test_contrast()
    test_cream_bg()
    test_secrets_paths()
    test_v4_jpg()
    test_v4_areas_and_l2_actions()
    test_v5_jpg()
    test_v6_jpg()
    test_auto_select_v5_without_file()
    test_auto_select_v6_injected_url()
    test_auto_select_not_https_falls_back_v5()
    if FAILS:
        print(f"RESULT FAIL {len(FAILS)}")
        return 1
    print("RESULT PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
