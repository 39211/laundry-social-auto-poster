# -*- coding: utf-8 -*-
"""品項目錄同步。期望數字寫死自契約，不由被測程式計算。"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from datetime import datetime
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent
SANDBOX = ROOT / "_sandbox_repo"
NO_EHANK = str(SANDBOX / "no-ehank")
PY = r"C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe"

os.environ["LAUNDRY_REPO_ROOT"] = str(SANDBOX)
os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"
os.environ["LAUNDRY_EHANK_ROOT"] = NO_EHANK


def _no_net(*_a, **_k):
    raise RuntimeError("network disabled in tests")


urllib.request.urlopen = _no_net

_staff = ModuleType("staff_notify")
_staff.inbox = []


def _guest_name(_uid):
    return "測試客人"


def _push_inbox(kind, rec, **_k):
    _staff.inbox.append((kind, rec))
    return {"saved": True, "notified": True}


_staff.guest_name = _guest_name
_staff.push_inbox = _push_inbox
sys.modules["staff_notify"] = _staff

_pay = ModuleType("line_pay")
_pay.configured = lambda: False
sys.modules["line_pay"] = _pay

import conversation as conv  # noqa: E402
import customer_profile as cprof  # noqa: E402
import ehank_prices  # noqa: E402
import estimate  # noqa: E402
import laundry_lookup as L  # noqa: E402
import photo_estimate  # noqa: E402
from test_ehank_prices import (  # noqa: E402
    Probe,
    _base_prices,
    _clear_align_file,
    _item,
    _restore_bot,
    _write_basis,
    judge,
)
import test_ehank_prices as tp  # noqa: E402

DASH = "\u2013"
_UID = 0


def _uid() -> str:
    global _UID
    _UID += 1
    return f"cat{_UID:04d}"


def _freeze() -> None:
    dt = datetime(2026, 9, 23, 14, 0)
    if conv.TZ:
        dt = dt.replace(tzinfo=conv.TZ)
    conv.now_tw = lambda: dt


def _texts(msgs) -> list[str]:
    return [m.get("text") or "" for m in msgs if m.get("type") == "text"]


def _qr(msgs) -> list[tuple[str, str]]:
    out = []
    for msg in msgs:
        for item in (msg.get("quickReply") or {}).get("items") or []:
            action = item.get("action") or {}
            if action.get("type") == "message":
                out.append((action.get("label"), action.get("text")))
    return out


def _ask(text: str, uid: str | None = None):
    uid = uid or _uid()
    msgs, meta = conv.handle_ex(uid, text)
    return msgs, meta, uid


def _boot(basis: str) -> None:
    _write_basis(basis)
    conv.apply_price_alignment()


def _added(result):
    return [(row["name"], row["category"], row["price"], row["label"], row["ehank"]) for row in result.added]


def _skipped(result):
    return [(row["name"], row["ehank"], row["why"]) for row in result.skipped]


def _retired(result):
    return [(row["name"], list(row["replaced_by"])) for row in result.retired]


def _count_name(prices, name: str) -> int:
    total = 0
    for rows in prices.values():
        if isinstance(rows, dict) and name in rows:
            total += 1
    return total


def _env():
    env = os.environ.copy()
    env["LAUNDRY_REPO_ROOT"] = str(SANDBOX)
    env["LAUNDRY_LOOKUP_FIXTURE"] = "1"
    env["LAUNDRY_EHANK_ROOT"] = NO_EHANK
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def _golden(mode: str):
    tmp = tempfile.mkdtemp(prefix="catalog-golden-out-")
    out = str(Path(tmp) / "out.json")
    try:
        return subprocess.run(
            [
                PY,
                "-B",
                str(ROOT / "_catalog_golden" / "capture_catalog.py"),
                str(ROOT),
                mode,
                out,
                "--compare",
                str(ROOT / "_catalog_golden" / "golden_off.json"),
            ],
            cwd=str(ROOT),
            env=_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class CatalogSyncTests(unittest.TestCase):
    def setUp(self):
        _clear_align_file()
        _restore_bot()
        self._tmp = tempfile.mkdtemp(prefix="catalog-sync-")
        conv.SESS = Path(self._tmp) / "sess.json"
        conv.BOOK = Path(self._tmp) / "book.jsonl"
        L.BIND = Path(self._tmp) / "bind.json"
        L.WATCH = Path(self._tmp) / "watch.json"
        cprof.PROFILE_PATH = Path(self._tmp) / "profile.json"
        _freeze()

    def tearDown(self):
        _clear_align_file()
        _restore_bot()
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_C01_added_default(self):
        expect_added = [
            ("西裝", "衣物", 250, "乾洗", "西裝"),
            ("西褲", "衣物", 100, "乾洗", "西褲"),
            ("領帶", "衣物", 100, "乾洗", "領帶"),
            ("針織衣", "衣物", 150, "乾洗", "針織衣"),
            ("女衣", "衣物", 100, "", "女衣"),
            ("小毛毯", "寢具", 200, "", "毛毯(小)"),
            ("中毛毯", "寢具", 300, "", "毛毯(中)"),
            ("大毛毯", "寢具", 450, "", "毛毯(大)"),
            ("羽絨被", "寢具", 600, "", "羽絨被"),
            ("蠶絲羊毛被", "寢具", 800, "", "蠶絲.羊毛被子"),
            ("枕頭", "寢具", 300, "", "枕頭 娃娃"),
            ("娃娃", "寢具", 300, "", "枕頭 娃娃"),
            ("皮手套", "皮革", 300, "", "皮手套"),
            ("大書包", "包包", 800, "10天", "大書包"),
            ("大童鞋", "鞋子", 200, "", "大童鞋"),
            ("高級拖鞋", "鞋子", 400, "", "高級拖鞋"),
        ]
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
        self.assertEqual("ADDED_DEFAULT", "ADDED_DEFAULT")
        self.assertEqual(_added(result), expect_added)
        self.assertEqual(_skipped(result), [])
        self.assertEqual(result.labels.get("西裝"), "乾洗")
        self.assertEqual(result.labels.get("大書包"), "10天")

    def test_C02_added_water(self):
        expect = {
            "西裝": 200,
            "西褲": 80,
            "領帶": 100,
            "針織衣": 120,
            "女衣": 100,
            "小毛毯": 200,
            "中毛毯": 300,
            "大毛毯": 450,
            "羽絨被": 600,
            "蠶絲羊毛被": 800,
            "枕頭": 300,
            "娃娃": 300,
            "皮手套": 300,
            "大書包": 800,
            "大童鞋": 200,
            "高級拖鞋": 400,
        }
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="water", repo=SANDBOX)
        self.assertEqual("ADDED_WATER", "ADDED_WATER")
        for name, price in expect.items():
            self.assertEqual(_item(result.prices, name), price, name)
        self.assertEqual(len(result.added), 16)
        self.assertTrue(all(row["label"] == "" for row in result.added))

    def test_C03_retired_in_place(self):
        bedding = [
            "枕套", "涼被", "睡袋", "保潔墊", "床組四件套", "床單被套薄", "床單被套厚",
            "棉被單人", "棉被雙人", "小毛毯", "中毛毯", "大毛毯", "羽絨睡袋", "羽絨被",
            "蠶絲羊毛被", "枕頭", "娃娃",
        ]
        with Probe():
            result = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
        self.assertEqual("RETIRED_IN_PLACE", "RETIRED_IN_PLACE")
        self.assertEqual(_retired(result), [
            ("毛毯單人", ["小毛毯"]),
            ("毛毯雙人", ["中毛毯", "大毛毯"]),
            ("羽絨羊毛被", ["羽絨被", "蠶絲羊毛被"]),
        ])
        self.assertEqual(list(result.prices["寢具"]), bedding)
        for name in ("毛毯單人", "毛毯雙人", "羽絨羊毛被"):
            self.assertEqual(_count_name(result.prices, name), 0, name)

    def test_C04_appended_order(self):
        base = _base_prices()
        with Probe():
            result = ehank_prices.align(base, basis="default_mode", repo=SANDBOX)
        self.assertEqual("APPENDED_ORDER", "APPENDED_ORDER")
        clothing = list(result.prices["衣物"])
        leather = list(result.prices["皮革"])
        bags = list(result.prices["包包"])
        shoes = list(result.prices["鞋子"])
        self.assertEqual(clothing[-5:], ["西裝", "西褲", "領帶", "針織衣", "女衣"])
        self.assertEqual(leather[-1:], ["皮手套"])
        self.assertEqual(bags[-1:], ["大書包"])
        self.assertEqual(shoes[-2:], ["大童鞋", "高級拖鞋"])
        self.assertEqual(clothing[: len(base["衣物"])], list(base["衣物"]))
        self.assertEqual(leather[: len(base["皮革"])], list(base["皮革"]))
        self.assertEqual(bags[: len(base["包包"])], list(base["包包"]))
        self.assertEqual(shoes[: len(base["鞋子"])], list(base["鞋子"]))
        self.assertTrue(clothing[: len(base["衣物"])] == list(base["衣物"]))
        self.assertEqual(list(result.prices["精品"]), list(base["精品"]))
        self.assertEqual(list(result.prices["其他"]), list(base["其他"]))
        self.assertEqual(result.prices["note"], base["note"])

    def test_C05_name_set(self):
        removed = ["毛毯單人", "毛毯雙人", "羽絨羊毛被"]
        added = [
            "西裝", "西褲", "領帶", "針織衣", "女衣", "小毛毯", "中毛毯", "大毛毯",
            "羽絨被", "蠶絲羊毛被", "枕頭", "娃娃", "皮手套", "大書包", "大童鞋", "高級拖鞋",
        ]
        with Probe():
            base = _base_prices()
            result = ehank_prices.align(base, basis="default_mode", repo=SANDBOX)
        before = set(estimate.catalog(base))
        after = set(estimate.catalog(result.prices))
        self.assertEqual("NAME_SET", "NAME_SET")
        self.assertEqual(sorted(before - after), sorted(removed))
        self.assertEqual(sorted(after - before), sorted(added))
        self.assertEqual(len(after), 122)

    def test_C06_unmapped_eight(self):
        unmapped = ["一般包", "休閒鞋", "旗袍", "睡袋", "羽絨睡袋", "褶裙", "護士服", "高爾夫球鞋"]
        kept = {
            "一般包": 600,
            "睡袋": 250,
            "羽絨睡袋": 200,
            "旗袍": 200,
            "褶裙": 100,
            "護士服": 80,
            "休閒鞋": 350,
            "高爾夫球鞋": 150,
        }
        with Probe():
            default = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
            water = ehank_prices.align(_base_prices(), basis="water", repo=SANDBOX)
        self.assertEqual("UNMAPPED_EIGHT", "UNMAPPED_EIGHT")
        self.assertEqual(sorted(default.unmapped), sorted(unmapped))
        self.assertEqual(sorted(water.unmapped), sorted(unmapped))
        for name, price in kept.items():
            self.assertEqual(_item(default.prices, name), price, name)
            self.assertEqual(_item(water.prices, name), price, name)
        self.assertEqual([len(default.changed), len(default.labeled_only), len(default.unmapped)], [16, 14, 8])
        self.assertEqual([len(water.changed), len(water.labeled_only), len(water.unmapped)], [11, 2, 8])

    def test_C07_partial_book(self):
        dco = []
        for item in copy.deepcopy(tp.SNAPSHOT["dco"]):
            key = ehank_prices._norm_name(item["Dname"])
            if key == "毛毯(大)":
                continue
            if key == "皮手套":
                item = dict(item)
                item["M"] = [0, 0, 0, 0, 0, 0, 0, 0]
            dco.append(item)
        rows = [(item["Dname"], *item["M"][:8], item["DefMode"]) for item in dco]
        original = tp._dco_rows
        tp._dco_rows = lambda: rows
        try:
            with Probe():
                base = _base_prices()
                result = ehank_prices.align(base, basis="default_mode", repo=SANDBOX)
        finally:
            tp._dco_rows = original
        bedding = [
            "枕套", "涼被", "睡袋", "保潔墊", "床組四件套", "床單被套薄", "床單被套厚",
            "棉被單人", "棉被雙人", "小毛毯", "毛毯雙人", "羽絨睡袋", "羽絨被", "蠶絲羊毛被",
            "中毛毯", "枕頭", "娃娃",
        ]
        self.assertEqual("PARTIAL_BOOK", "PARTIAL_BOOK")
        self.assertEqual([row["name"] for row in result.added], [
            "西裝", "西褲", "領帶", "針織衣", "女衣", "小毛毯", "中毛毯", "羽絨被",
            "蠶絲羊毛被", "枕頭", "娃娃", "大書包", "大童鞋", "高級拖鞋",
        ])
        self.assertEqual(_skipped(result), [
            ("大毛毯", "毛毯(大)", "價目表沒有這個品項"),
            ("皮手套", "皮手套", "沒有可用價格"),
        ])
        self.assertEqual(_retired(result), [
            ("毛毯單人", ["小毛毯"]),
            ("羽絨羊毛被", ["羽絨被", "蠶絲羊毛被"]),
        ])
        self.assertEqual(_item(result.prices, "毛毯雙人"), 400)
        self.assertEqual(list(result.prices["寢具"]), bedding)
        self.assertEqual(list(result.prices["皮革"]), list(base["皮革"]))

    def test_C08_collision(self):
        base = _base_prices()
        base["衣物"]["西裝"] = 999
        with Probe():
            result = ehank_prices.align(base, basis="default_mode", repo=SANDBOX)
        self.assertEqual("COLLISION", "COLLISION")
        self.assertFalse(any(row["name"] == "西裝" for row in result.added))
        self.assertEqual(_skipped(result), [("西裝", "西裝", "bot 已有同名品項")])
        self.assertEqual(_item(result.prices, "西裝"), 250)
        self.assertEqual(result.labels.get("西裝"), "乾洗")
        self.assertEqual(_count_name(result.prices, "西裝"), 1)
        self.assertEqual(len(result.added), 15)

    def test_C09_report_default(self):
        needles = [
            "改價 16\n",
            "只加標示 14\n",
            "對不到 8\n",
            "新增 16\n",
            "衣物｜西裝 250（乾洗）\n",
            "寢具｜小毛毯 200\n",
            "包包｜大書包 800（10天）\n",
            "移除 3\n",
            "毛毯單人→小毛毯\n",
            "毛毯雙人→中毛毯、大毛毯\n",
            "羽絨羊毛被→羽絨被、蠶絲羊毛被\n",
            "未新增 0\n",
        ]
        with Probe():
            buf = io.StringIO()
            from contextlib import redirect_stdout
            with redirect_stdout(buf):
                code = ehank_prices.main(["--report", "--basis", "default_mode"])
        text = buf.getvalue()
        self.assertEqual("REPORT_DEFAULT", "REPORT_DEFAULT")
        self.assertEqual(code, 0)
        for needle in needles:
            self.assertIn(needle, text)

    def test_C10_report_water(self):
        needles = [
            "改價 11\n",
            "只加標示 2\n",
            "對不到 8\n",
            "新增 16\n",
            "衣物｜西裝 200\n",
            "移除 3\n",
            "未新增 0\n",
        ]
        with Probe():
            buf = io.StringIO()
            from contextlib import redirect_stdout
            with redirect_stdout(buf):
                code = ehank_prices.main(["--report", "--basis", "water"])
        text = buf.getvalue()
        self.assertEqual("REPORT_WATER", "REPORT_WATER")
        self.assertEqual(code, 0)
        for needle in needles:
            self.assertIn(needle, text)

    def test_C11_off_fallback_empty(self):
        base = _base_prices()
        with Probe():
            off = ehank_prices.align(base, basis="off", repo=SANDBOX)
        self.assertEqual(off.added, [])
        self.assertEqual(off.retired, [])
        self.assertEqual(off.skipped, [])
        self.assertEqual(off.prices, base)
        fallback = ehank_prices.align(_base_prices(), basis="default_mode", repo=SANDBOX)
        self.assertEqual("OFF_FALLBACK_EMPTY", "OFF_FALLBACK_EMPTY")
        self.assertEqual(fallback.added, [])
        self.assertEqual(fallback.retired, [])
        self.assertEqual(fallback.skipped, [])
        self.assertEqual(fallback.prices, base)

    def test_C12_effective_off(self):
        base = _base_prices()
        _boot("default_mode")
        draft = estimate.update("襯衫1件", None, conv.PRICES)
        text = estimate.render(draft)
        self.assertEqual("EFFECTIVE_OFF", "EFFECTIVE_OFF")
        self.assertEqual(conv.PRICE_BASIS, "off")
        self.assertEqual(conv.PRICES, base)
        self.assertEqual(text.splitlines()[0], "幫你算好了，先按一般水洗價：")
        self.assertEqual(conv.faq_answer("怎麼收費")[0]["text"], "價目表上是水洗價，乾洗跟柔洗會另計，實際以到店看件為準。")

    def test_C13_golden_off(self):
        proc = _golden("off")
        self.assertEqual("GOLDEN_OFF", "GOLDEN_OFF")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("GOLDEN_COMPARE| SAME", proc.stdout)

    def test_C14_golden_fallback(self):
        proc = _golden("fallback")
        self.assertEqual("GOLDEN_FALLBACK", "GOLDEN_FALLBACK")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("GOLDEN_COMPARE| SAME", proc.stdout)

    def test_C15_wired_catalog(self):
        bedding = [
            "枕套", "涼被", "睡袋", "保潔墊", "床組四件套", "床單被套薄", "床單被套厚",
            "棉被單人", "棉被雙人", "小毛毯", "中毛毯", "大毛毯", "羽絨睡袋", "羽絨被",
            "蠶絲羊毛被", "枕頭", "娃娃",
        ]
        with Probe():
            _boot("default_mode")
            cats = list(conv.CATS["寢具"])
            label = conv.PRICE_LABELS.get("西裝")
            doll = _item(conv.PRICES, "娃娃")
            basis = conv.PRICE_BASIS
            count = len(conv.CATS)
        self.assertEqual("WIRED_CATALOG", "WIRED_CATALOG")
        self.assertEqual(cats, bedding)
        self.assertEqual(label, "乾洗")
        self.assertEqual(doll, 300)
        self.assertEqual(basis, "default_mode")
        self.assertEqual(count, 7)

    def test_C16_quote_label(self):
        expect = {
            "毛衣多少錢": "毛衣大概 180（乾洗）。",
            "皮帶多少錢": "皮帶大概 400（14天）。",
            "襯衫多少錢": "襯衫水洗大概 70。",
            "大書包多少錢": "大書包大概 800（10天）。",
            "西裝背心": "西裝背心大概 110（乾洗）。",
        }
        with Probe():
            _boot("default_mode")
            got = {}
            intents = {}
            for text in expect:
                msgs, meta, _uid_used = _ask(text)
                got[text] = _texts(msgs)[0]
                intents[text] = meta["intent"]
            _restore_bot()
            _boot("off")
            off_msgs, _meta, _uid_used = _ask("毛衣多少錢")
        self.assertEqual("QUOTE_LABEL", "QUOTE_LABEL")
        self.assertEqual(got, expect)
        self.assertTrue(all(value == "quote" for value in intents.values()))
        self.assertEqual(_texts(off_msgs)[0], "毛衣水洗大概 150。")

    def test_C17_mention_label(self):
        with Probe():
            _boot("default_mode")
            msgs, meta, _uid_used = _ask("褲子")
        self.assertEqual("MENTION_LABEL", "MENTION_LABEL")
        self.assertEqual(_texts(msgs), [
            "褲子我對到這幾項。",
            "皮褲 700（14天）、皮短褲 600（14天）、短褲 60、長褲 70\n精品款另計，到店看件再報。\n您是哪一個？",
        ])
        self.assertEqual(meta["intent"], "clarify")

    def test_C18_fee_copy(self):
        with Probe():
            _boot("default_mode")
            default_mode = {
                "faq_first": conv.faq_answer("怎麼收費")[0]["text"],
                "wash_type_first": conv.wash_type_reply()[0]["text"],
                "pre_wash_first": conv.pre_wash_notes()[0]["text"],
                "bubble_sub": conv.cat_bubble("寢具")["header"]["contents"][1]["text"],
            }
            _boot("water")
            water = {
                "faq_first": conv.faq_answer("怎麼收費")[0]["text"],
                "wash_type_first": conv.wash_type_reply()[0]["text"],
                "pre_wash_first": conv.pre_wash_notes()[0]["text"],
                "bubble_sub": conv.cat_bubble("寢具")["header"]["contents"][1]["text"],
            }
        self.assertEqual("FEE_COPY", "FEE_COPY")
        self.assertEqual(default_mode, {
            "faq_first": "價目表上是店裡系統的標準價，有標洗法的（例如乾洗、14天）就是那種洗法的價；換別的洗法另計，實際以到店看件為準。",
            "wash_type_first": "價目表上是店裡系統的標準價，有標洗法的（例如乾洗、14天）就是那種洗法的價；換別的洗法另計。",
            "pre_wash_first": "送洗前先跟你講這幾件。價目表上是店裡系統的標準價，有標洗法的（例如乾洗、14天）就是那種洗法的價；換別的洗法另計，實際以現場報價為準。",
            "bubble_sub": "店裡標準價 · 看過再定",
        })
        self.assertEqual(water, {
            "faq_first": "價目表上是水洗價，乾洗跟柔洗會另計，實際以到店看件為準。",
            "wash_type_first": "價目表上是水洗價，乾洗跟柔洗會另計。",
            "pre_wash_first": "送洗前先跟你講這幾件。價目表上是水洗價，乾洗跟柔洗另計，實際以現場報價為準。",
            "bubble_sub": "水洗參考 · 看過再定",
        })

    def test_C19_suit_flow(self):
        with Probe():
            _boot("default_mode")
            suit_msgs, suit_meta, _uid_used = _ask("西裝多少錢")
            outer_msgs, outer_meta, _uid_used = _ask("西裝外套")
            pants_msgs, pants_meta, _uid_used = _ask("西裝褲多少錢")
            uid = _uid()
            _ask("西裝外套", uid)
            second_msgs, second_meta, _uid_used = _ask("西裝", uid)
        self.assertEqual("SUIT_FLOW", "SUIT_FLOW")
        self.assertEqual(_texts(suit_msgs), [
            "西裝上衣大概 250（乾洗）。",
            "西褲 100（乾洗）、西裝背心 110（乾洗），都是一件一件算。\n實際以到店看件為準。",
        ])
        self.assertEqual(suit_meta["intent"], "quote")
        self.assertEqual(_texts(outer_msgs), [
            "西裝上衣大概 250（乾洗）。",
            "西褲 100（乾洗）、西裝背心 110（乾洗），都是一件一件算。\n實際以到店看件為準。",
        ])
        self.assertEqual(_qr(outer_msgs), [("拍照詢問", "拍照問價"), ("安排收送", "外收送預約"), ("門市資訊", "店址"), ("打電話", "電話")])
        self.assertEqual(outer_meta["intent"], "quote")
        self.assertEqual(_texts(pants_msgs)[0], "西褲大概 100（乾洗）。")
        self.assertEqual(pants_meta["intent"], "quote")
        self.assertEqual(second_meta["intent"], "quote")
        self.assertEqual(_texts(second_msgs)[0], "西裝上衣大概 250（乾洗）。")

    def test_C20_bedding_flow(self):
        buttons = [
            ("單人", "單人棉被"),
            ("雙人", "雙人棉被"),
            ("羽絨被", "羽絨被"),
            ("蠶絲羊毛被", "蠶絲羊毛被"),
            ("不確定", "不確定"),
        ]
        second = "您是單人還是雙人？羽絨被、蠶絲羊毛被跟一般棉被價不一樣。"
        with Probe():
            _boot("default_mode")
            quilt_msgs, quilt_meta, _uid_used = _ask("棉被")
            direct = conv._cat_clarify("棉被", conv._flat_catalog())
            down_msgs, _meta, _uid_used = _ask("羽絨棉被")
            uid = _uid()
            _ask("棉被", uid)
            follow_msgs, _meta, _uid_used = _ask("羽絨被", uid)
        self.assertEqual("BEDDING_FLOW", "BEDDING_FLOW")
        self.assertEqual(_texts(quilt_msgs)[1], second)
        self.assertEqual(_qr(quilt_msgs), buttons)
        self.assertEqual(quilt_meta["intent"], "clarify")
        self.assertEqual(_texts(direct)[1], second)
        self.assertEqual(_qr(direct), buttons)
        self.assertEqual(_texts(down_msgs)[0], "羽絨被水洗大概 600。")
        self.assertEqual(_texts(follow_msgs)[0], "羽絨被水洗大概 600。")

    def test_C21_synonyms(self):
        with Probe():
            _boot("default_mode")
            down, _meta, _uid_used = _ask("羽絨羊毛被")
            wool, _meta, _uid_used = _ask("羊毛被")
            blanket, _meta, _uid_used = _ask("毛毯")
            single, _meta, _uid_used = _ask("毛毯單人")
            double, _meta, _uid_used = _ask("毛毯雙人")
            doll, _meta, _uid_used = _ask("玩偶")
            pillow, _meta, _uid_used = _ask("枕頭多少錢")
            case, _meta, _uid_used = _ask("枕頭套多少錢")
            family, _meta, _uid_used = _ask("羽絨")
        self.assertEqual("SYNONYMS", "SYNONYMS")
        self.assertEqual(_texts(down), ["我對到幾項。", "您是哪一個？"])
        self.assertEqual(_qr(down), [("羽絨被", "羽絨被"), ("蠶絲羊毛被", "蠶絲羊毛被")])
        self.assertEqual(_texts(wool)[0], "蠶絲羊毛被水洗大概 800。")
        self.assertEqual(_qr(blanket), [("小毛毯", "小毛毯"), ("中毛毯", "中毛毯"), ("大毛毯", "大毛毯")])
        self.assertEqual(_texts(single)[0], "小毛毯水洗大概 200。")
        self.assertEqual(_qr(double), [("中毛毯", "中毛毯"), ("大毛毯", "大毛毯")])
        self.assertEqual(_texts(doll)[0], "娃娃水洗大概 300。")
        self.assertEqual(_texts(pillow)[0], "枕頭水洗大概 300。")
        self.assertEqual(_texts(case)[0], "枕套水洗大概 30。")
        self.assertEqual(_texts(family)[1], "羽絨睡袋 200、羽絨被 600、羽絨背心 200、羽絨外套 280\n您是哪一個？")

    def test_C22_estimate_new(self):
        with Probe():
            _boot("default_mode")
            prices = conv.PRICES
            suit = estimate.render(estimate.update("西裝1件、西褲1件", None, prices))
            blanket = estimate.render(estimate.update("毛毯1件", None, prices))
            double = estimate.render(estimate.update("毛毯雙人1件", None, prices))
            single = estimate.render(estimate.update("毛毯單人1件", None, prices))
            down = estimate.render(estimate.update("羽絨羊毛被1件", None, prices))
            doll = estimate.render(estimate.update("玩偶3隻", None, prices))
            bag = estimate.render(estimate.update("大書包1個", None, prices))
            shoes = estimate.render(estimate.update("大童鞋1雙、高級拖鞋1雙", None, prices))
            jacket = estimate.render(estimate.update("西裝外套1件", None, prices))
            mix = estimate.render(estimate.update("羽絨羊毛被1件、保潔墊2件", None, prices))
        self.assertEqual("ESTIMATE_NEW", "ESTIMATE_NEW")
        self.assertIn("西裝 1件 × 250元＝250元（乾洗）", suit)
        self.assertIn("西褲 1件 × 100元＝100元（乾洗）", suit)
        self.assertIn("這批預估 350 元。", suit)
        self.assertIn(f"還有幾項先用區間抓：毛毯 1件：先抓 200{DASH}450 元。", blanket)
        self.assertIn(f"還有幾項先用區間抓：毛毯雙人 1件：先抓 300{DASH}450 元。", double)
        self.assertIn("小毛毯 1件 × 200元＝200元", single)
        self.assertIn(f"還有幾項先用區間抓：羽絨羊毛被 1件：先抓 600{DASH}800 元。", down)
        self.assertIn("娃娃 3件 × 300元＝900元", doll)
        self.assertIn("大書包 1個 × 800元＝800元（10天）", bag)
        self.assertIn("大童鞋 1雙 × 200元＝200元", shoes)
        self.assertIn("高級拖鞋 1雙 × 400元＝400元", shoes)
        self.assertIn("這批預估 600 元。", shoes)
        self.assertIn("西裝 1件 × 250元＝250元（乾洗）", jacket)
        self.assertIn(f"這批先抓約 900{DASH}1,100 元。", mix)

    def test_C23_estimate_refine(self):
        with Probe():
            _boot("default_mode")
            prices = conv.PRICES
            quilt = estimate.update("羽絨被1件", estimate.update("棉被1件", None, prices), prices)
            mid = estimate.update("中毛毯1件", estimate.update("毛毯雙人1件", None, prices), prices)
            large = estimate.update("毛毯是大毛毯1件", estimate.update("毛毯1件", None, prices), prices)
        self.assertEqual("ESTIMATE_REFINE", "ESTIMATE_REFINE")
        self.assertEqual([line["name"] for line in quilt["lines"]], ["羽絨被"])
        self.assertEqual(quilt["total"], 600)
        self.assertEqual([line["name"] for line in mid["lines"]], ["中毛毯"])
        self.assertEqual(mid["total"], 300)
        self.assertEqual([line["name"] for line in large["lines"]], ["大毛毯"])
        self.assertEqual(large["total"], 450)

    def test_C24_special_new(self):
        with Probe():
            _boot("default_mode")
            same = estimate.update("西裝1件要乾洗", None, conv.PRICES)
            soft = estimate.update("西裝1件要柔洗", None, conv.PRICES)
            _boot("water")
            water = estimate.update("西裝1件要乾洗", None, conv.PRICES)
        self.assertEqual("SPECIAL_NEW", "SPECIAL_NEW")
        self.assertEqual(same["total"], 250)
        self.assertNotIn("另外待評估", estimate.render(same))
        self.assertEqual(soft["lines"][0]["reason"], "洗法另計，不能直接套用一般水洗價")
        self.assertIn("另外待評估：柔洗，尚未加計。", estimate.render(soft))
        self.assertEqual(water["lines"][0]["reason"], "洗法另計，不能直接套用一般水洗價")

    def test_C25_photo_new(self):
        with Probe():
            _boot("default_mode")
            names = set(estimate.catalog(conv.PRICES))

            def photo(name, certainty="clear", qty=1):
                validated = photo_estimate.validate_result(
                    {"items": [{"name": name, "label": name, "quantity": qty, "certainty": certainty, "reason": "看過"}]},
                    names,
                )
                draft = estimate.from_photo(validated, None, conv.PRICES)
                return validated[0], draft["lines"][0], estimate.render(draft)

            suit_v, suit_line, _suit_text = photo("西裝")
            blanket_v, blanket_line, _blanket_text = photo("小毛毯")
            down_v, down_line, _down_text = photo("羽絨被")
            shoe_v, shoe_line, _shoe_text = photo("大童鞋")
            pants_v, pants_line, _pants_text = photo("西褲")
            tie_v, tie_line, _tie_text = photo("領帶", "estimated")
            pillow_v, _pillow_line, pillow_text = photo("枕頭", "clear", 2)
            gone = photo_estimate.validate_result(
                {"items": [{"name": "羽絨羊毛被", "label": "羽絨羊毛被", "quantity": 1, "certainty": "clear", "reason": "看過"}]},
                names,
            )[0]
        self.assertEqual("PHOTO_NEW", "PHOTO_NEW")
        self.assertEqual(suit_v["certainty"], "estimated")
        self.assertEqual(suit_line["display"], "照片中的外套")
        self.assertEqual((suit_line["range_min_price"], suit_line["range_max_price"]), (150, 450))
        self.assertEqual(blanket_v["certainty"], "estimated")
        self.assertEqual(blanket_line["display"], "照片中的寢具")
        self.assertEqual((blanket_line["range_min_price"], blanket_line["range_max_price"]), (200, 450))
        self.assertEqual(down_v["certainty"], "estimated")
        self.assertEqual(down_line["display"], "照片中的寢具")
        self.assertEqual((down_line["range_min_price"], down_line["range_max_price"]), (350, 800))
        self.assertEqual(shoe_v["certainty"], "estimated")
        self.assertEqual(shoe_line["display"], "照片中的鞋子")
        self.assertEqual((shoe_line["range_min_price"], shoe_line["range_max_price"]), (150, 600))
        self.assertEqual(pants_v["certainty"], "estimated")
        self.assertEqual((pants_line["range_min_price"], pants_line["range_max_price"]), (60, 110))
        self.assertEqual(tie_v["certainty"], "estimated")
        self.assertEqual((tie_line["range_min_price"], tie_line["range_max_price"]), (100, 130))
        self.assertEqual(pillow_v["certainty"], "clear")
        self.assertIn("枕頭 2件 × 300元＝600元", pillow_text)
        self.assertEqual(gone["name"], "")

    def test_C26_menu_synced(self):
        with Probe():
            _boot("default_mode")
            bubble = conv.cat_bubble("寢具")
            rows = [(box["contents"][0]["text"], box["contents"][1]["text"]) for box in bubble["body"]["contents"]]
            listed = conv.cat_list_flex("寢具")
            first10 = [box["contents"][0]["text"] for box in listed["contents"]["body"]["contents"]]
            bag_msgs, _meta, _uid_used = _ask("書包")
            doll_msgs, _meta, _uid_used = _ask("娃娃可以洗嗎")
        self.assertEqual("MENU_SYNCED", "MENU_SYNCED")
        self.assertEqual(rows, [("棉被單人", "350"), ("棉被雙人", "500"), ("羽絨被", "600"), ("涼被", "180")])
        self.assertEqual(first10, [
            "枕套", "涼被", "睡袋", "保潔墊", "床組四件套", "床單被套薄", "床單被套厚",
            "棉被單人", "棉被雙人", "小毛毯",
        ])
        self.assertEqual(_texts(bag_msgs), ["我對到幾項。", "您是哪一個？"])
        self.assertEqual(_qr(bag_msgs), [("大書包", "大書包")])
        self.assertEqual(_texts(doll_msgs), [
            "娃娃水洗大概 300。",
            "可以，一般都能洗。\n實際以到店看件為準。",
        ])


class ScorerTests(unittest.TestCase):
    def test_scorer_wrong_name_is_invalid(self):
        verdict = judge(True, ["pkg.Class.test_missing"], ["pkg.Class.test_missing"], {"pkg.Class.test_real"})
        self.assertEqual(verdict, "INVALID")

    def test_scorer_clean_fail_is_invalid(self):
        verdict = judge(False, ["pkg.Class.test_foo"], ["pkg.Class.test_foo"], {"pkg.Class.test_foo"})
        self.assertEqual(verdict, "INVALID")

    def test_scorer_substring_collision_survives(self):
        verdict = judge(
            True,
            ["pkg.Class.test_foo_bar"],
            ["pkg.Class.test_foo"],
            {"pkg.Class.test_foo", "pkg.Class.test_foo_bar"},
        )
        self.assertEqual(verdict, "EQUIVALENT")


CatalogSyncTests.__module__ = "test_catalog_sync"
ScorerTests.__module__ = "test_catalog_sync"

KNOWN_IDS = {
    f"test_catalog_sync.CatalogSyncTests.{name}"
    for name in dir(CatalogSyncTests)
    if name.startswith("test_C")
}


def _method_for(code: str) -> str:
    matches = [name for name in dir(CatalogSyncTests) if name.startswith(f"test_{code}_")]
    if len(matches) != 1:
        raise RuntimeError(code)
    return matches[0]


def _full_id(method: str) -> str:
    return f"test_catalog_sync.CatalogSyncTests.{method}"


MUTATIONS = [
    ("V01", ROOT / "ehank_prices.py",
     '        chosen = _pick_price(hit, result.basis, book["modes"])\n',
     '        chosen = _pick_price(hit, "water", book["modes"])\n',
     ["C01"]),
    ("V02", ROOT / "ehank_prices.py",
     "        in_place = bool(old and retire_ready.get(old))\n",
     "        in_place = False\n",
     ["C03"]),
    ("V03", ROOT / "ehank_prices.py",
     "    rebuilt = {}\n    for name, price in rows.items():\n",
     "    rebuilt = {}\n"
     "    for item in appended:\n"
     "        rebuilt[item[\"name\"]] = item[\"price\"]\n"
     "        _store_added_label(labels, item)\n"
     "    for name, price in rows.items():\n",
     ["C04"]),
    ("V04", ROOT / "ehank_prices.py",
     '    ("枕頭 娃娃", "娃娃", "寢具", ""),\n',
     "",
     ["C05"]),
    ("V05", ROOT / "ehank_prices.py",
     '    unmapped = [name for name in result.unmapped if name not in retired_names]\n',
     "    unmapped = [name for name in result.unmapped]\n",
     ["C06"]),
    ("V06", ROOT / "ehank_prices.py",
     '        retire_ready[old] = all(item["status"] == "add" for item in group) and _catalog_has(aligned, old)\n',
     '        retire_ready[old] = any(item["status"] == "add" for item in group) and _catalog_has(aligned, old)\n',
     ["C07"]),
    ("V07", ROOT / "ehank_prices.py",
     "        if chosen is None:\n"
     "            decisions.append({\n"
     '                "status": "skip",\n'
     '                "name": bot_name,\n'
     '                "ehank": ehank,\n'
     '                "category": category,\n'
     '                "retire": retire,\n'
     "                \"why\": _SKIP_NO_PRICE,\n"
     "            })\n"
     "            continue\n",
     "        if chosen is None:\n"
     '            chosen = (0, "")\n',
     ["C07"]),
    ("V08", ROOT / "ehank_prices.py",
     "        if bot_name in existing or bot_name in planned:\n",
     "        if False and (bot_name in existing or bot_name in planned):\n",
     ["C08"]),
    ("V09", ROOT / "ehank_prices.py",
     '    lines.append(f"移除 {len(result.retired)}")\n'
     "    for row in result.retired:\n"
     "        lines.append(f\"{row['name']}→{'、'.join(row['replaced_by'])}\")\n",
     "",
     ["C09"]),
    ("V10", ROOT / "ehank_prices.py",
     '    if book is None:\n        return _unchanged(base_prices, basis, "FALLBACK")\n',
     "    if book is None:\n"
     '        fallback = _unchanged(base_prices, basis, "FALLBACK")\n'
     '        for old in ("毛毯單人", "毛毯雙人", "羽絨羊毛被"):\n'
     "            _delete_name(fallback.prices, old)\n"
     "        return fallback\n",
     ["C11", "C14"]),
    ("V11", ROOT / "conversation.py",
     "        if result.code == \"ALIGNED\":\n"
     "            PRICE_BASIS = result.basis\n"
     "        else:\n"
     "            PRICE_BASIS = \"off\"\n",
     "        PRICE_BASIS = result.basis\n",
     ["C12", "C14"]),
    ("V12", ROOT / "estimate.py",
     "        if key not in cat and target in cat:\n",
     "        if key not in cat:\n",
     ["C13"]),
    ("V13", ROOT / "estimate.py",
     "    if key not in cat and all(item in cat for item in required):\n",
     "    if key not in cat:\n",
     ["C13"]),
    ("V14", ROOT / "estimate.py",
     '    "羽絨被": {"棉被", "羽絨羊毛被"},\n'
     '    "蠶絲羊毛被": {"棉被", "羽絨羊毛被"},\n',
     "",
     ["C23"]),
    ("V15", ROOT / "estimate.py",
     "    if cat is not None and name in cat and name in _REFINE_OVERLAY:\n",
     "    if cat is not None and name in _REFINE_OVERLAY:\n",
     ["C13"]),
    ("V16", ROOT / "estimate.py",
     '    "毛毯": ("小毛毯", "中毛毯", "大毛毯"),\n',
     "",
     ["C22"]),
    ("V17", ROOT / "ehank_prices.py",
     "def _store_added_label(labels: dict, item: dict) -> None:\n"
     "    if item[\"label\"]:\n"
     "        labels[item[\"name\"]] = item[\"label\"]\n",
     "def _store_added_label(labels: dict, item: dict) -> None:\n"
     "    return\n",
     ["C24"]),
    ("V18", ROOT / "conversation.py",
     '    label = PRICE_LABELS.get(item) or ""\n'
     "    if label:\n"
     '        first = f"{item}大概 {price}（{label}）。"\n'
     "    else:\n"
     '        first = f"{item}水洗大概 {price}。"\n',
     '    label = PRICE_LABELS.get(item) or ""\n'
     '    first = f"{item}水洗大概 {price}。"\n',
     ["C16"]),
    ("V19", ROOT / "conversation.py",
     '    line = "、".join(f"{h} {p(h)}" for h in shown)\n',
     '    line = "、".join(f"{h} {_price_of(h)}" for h in shown)\n',
     ["C17"]),
    ("V20", ROOT / "conversation.py",
     "def _standard_price_copy() -> bool:\n"
     '    return PRICE_BASIS == "default_mode"\n',
     "def _standard_price_copy() -> bool:\n"
     '    return PRICE_BASIS in ("default_mode", "water")\n',
     ["C18"]),
    ("V21", ROOT / "conversation.py",
     '                ("羽絨被", "羽絨被"),\n',
     '                ("羽絨被", "羽絨羊毛被"),\n',
     ["C20"]),
    ("V22", ROOT / "conversation.py",
     '            if suit_key in ("西裝", "西裝外套", "西裝上衣", "西裝上身"):\n',
     '            if suit_key in ("西裝", "西裝外套", "西裝上衣", "西裝上身") and False:\n',
     ["C19"]),
    ("V23", ROOT / "intents.py",
     '    if q == "羽絨羊毛被":\n'
     '        add("羽絨被")\n'
     '        add("蠶絲羊毛被")\n'
     "        if found:\n"
     "            return found\n\n",
     "",
     ["C21"]),
    ("V24", ROOT / "photo_estimate.py",
     '    "西裝", "西褲", "領帶", "針織衣", "女衣",\n',
     '    "西褲", "領帶", "針織衣", "女衣",\n',
     ["C25"]),
    ("V25", ROOT / "conversation.py",
     "        PRICES.clear()\n        PRICES.update(result.prices)\n",
     "        kept = {}\n"
     "        for cat, rows in list(PRICES.items()):\n"
     "            if not isinstance(rows, dict):\n"
     "                kept[cat] = result.prices.get(cat, rows)\n"
     "                continue\n"
     "            fresh = {}\n"
     "            new_rows = result.prices.get(cat) if isinstance(result.prices.get(cat), dict) else {}\n"
     "            for name, price in rows.items():\n"
     "                fresh[name] = new_rows[name] if name in new_rows else price\n"
     "            kept[cat] = fresh\n"
     "        PRICES.clear()\n"
     "        PRICES.update(kept)\n",
     ["C15"]),
    ("V26", ROOT / "conversation.py",
     '    "寢具": ["棉被單人", "棉被雙人", "羽絨羊毛被", "羽絨被", "涼被"],\n',
     '    "寢具": ["棉被單人", "棉被雙人", "羽絨羊毛被", "涼被"],\n',
     ["C26"]),
]


def print_ids(names: list[str]) -> int:
    loader = unittest.TestLoader()
    module = sys.modules[__name__]
    code = 0
    for name in names:
        try:
            suite = loader.loadTestsFromName(name, module)
        except Exception as exc:
            print(f"MISSING {name} {type(exc).__name__}")
            code = 2
            continue
        cases = list(suite)
        if len(cases) == 1 and cases[0].__class__.__name__ == "_FailedTest":
            print(f"MISSING {name}")
            code = 2
            continue
        result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
        if result.wasSuccessful() and result.testsRun:
            for test in cases:
                print(f"PASS {test.id()}")
            continue
        code = 1
        seen = False
        for test, _tb in list(result.failures) + list(result.errors):
            print(f"FAIL {test.id()}")
            seen = True
        if not seen:
            print(f"FAIL {name}")
    return code


def _parse_ids(stdout: str):
    passed, failed, missing = [], [], []
    for line in stdout.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        if parts[0] == "PASS":
            passed.append(parts[1])
        elif parts[0] == "FAIL":
            failed.append(parts[1])
        elif parts[0] == "MISSING":
            missing.append(parts[1])
    return passed, failed, missing


def _run_named(methods: list[str]):
    names = [f"CatalogSyncTests.{method}" for method in methods]
    proc = subprocess.run(
        [PY, "-B", str(ROOT / "test_catalog_sync.py"), "--ids", *names],
        cwd=str(ROOT),
        env=_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    passed, failed, missing = _parse_ids(proc.stdout or "")
    return proc.returncode, passed, failed, missing, (proc.stderr or "")[-800:]


def _apply_patch(path: Path, original: bytes, old: str, new: str):
    newline = b"\r\n" if b"\r\n" in original else b"\n"
    old_b = old.encode("utf-8").replace(b"\n", newline)
    new_b = new.encode("utf-8").replace(b"\n", newline)
    count = original.count(old_b)
    if count != 1:
        return count, original
    return count, original.replace(old_b, new_b, 1)


def run_mutations(only=None) -> int:
    selected = MUTATIONS
    if only:
        wanted = set(only)
        selected = [item for item in MUTATIONS if item[0] in wanted]
    for qid, path, old, new, codes in selected:
        try:
            methods = [_method_for(code) for code in codes]
        except RuntimeError:
            print(f"WITNESS_CLEAN| {qid} | ran=0 ok=false | missing-method")
            print(f"MUTATION| {qid} | INVALID | missing-method | -")
            continue
        expected = [_full_id(method) for method in methods]
        original = path.read_bytes()
        before = hashlib.sha256(original).hexdigest()
        verdict = "INVALID"
        shown = "-"
        try:
            _code, passed, failed, missing, err = _run_named(methods)
            clean_ok = not failed and not missing and all(item in passed for item in expected)
            print(
                f"WITNESS_CLEAN| {qid} | ran={len(expected)} ok={'true' if clean_ok else 'false'} | {','.join(failed + missing) or '-'}"
            )
            if not clean_ok:
                shown = ",".join(failed + missing) or "-"
                if err:
                    print(err)
                continue
            count, patched = _apply_patch(path, original, old, new)
            if count != 1:
                shown = f"patch_count={count}"
                continue
            path.write_bytes(patched)
            _code, _passed, failed, missing, err = _run_named(methods)
            verdict = judge(True, failed, expected, KNOWN_IDS)
            if missing:
                verdict = "INVALID"
            shown = ",".join(failed) if failed else "-"
            if err and verdict != "RED":
                print(err)
        finally:
            path.write_bytes(original)
            restored = path.read_bytes()
            digest = hashlib.sha256(restored).hexdigest()
            same = restored == original
            if not same:
                verdict = "INVALID"
                shown = "restore_mismatch"
            print(f"RESTORED| {qid} | same={str(same).lower()} | {digest} | before={before}")
            print(f"MUTATION| {qid} | {verdict} | {shown} | {digest}")
    return 0


if __name__ == "__main__":
    if "--mutations" in sys.argv:
        only = None
        if "--only" in sys.argv:
            only = sys.argv[sys.argv.index("--only") + 1].split(",")
        raise SystemExit(run_mutations(only))
    if "--ids" in sys.argv:
        index = sys.argv.index("--ids")
        raise SystemExit(print_ids(sys.argv[index + 1:]))
    unittest.main()
