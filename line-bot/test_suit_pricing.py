# -*- coding: utf-8 -*-
"""西裝逐件計價。期望文字寫死自契約附錄，不由被測程式計算。"""
from __future__ import annotations

import copy
import hashlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from contextlib import contextmanager
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
import estimate  # noqa: E402
import laundry_lookup as L  # noqa: E402
import test_ehank_prices as tp  # noqa: E402
from test_ehank_prices import (  # noqa: E402
    Probe,
    _clear_align_file,
    _restore_bot,
    _write_basis,
    judge,
)

_UID = 0
TAIL = "先給你抓預算，這不是最後應付款；實際以現場看件報價為準。材質、尺寸或特殊處理（如乾洗、去霉、修補）可能另外確認費用。"
QUOTE_BUTTONS = [
    ("拍照詢問", "拍照問價"),
    ("安排收送", "外收送預約"),
    ("門市資訊", "店址"),
    ("打電話", "電話"),
]
CLARIFY_BUTTONS = [
    ("西裝上衣", "西裝上衣"),
    ("西褲", "西褲"),
    ("西裝背心", "西裝背心"),
]


def _std(body: str, total: str) -> str:
    return (
        "幫你算好了，先按店裡系統的標準價：\n\n"
        + body
        + "\n\n這批預估 "
        + total
        + " 元。\n\n"
        + TAIL
    )


def _water(body: str, total: str) -> str:
    return (
        "幫你算好了，先按一般水洗價：\n\n"
        + body
        + "\n\n這批預估 "
        + total
        + " 元。\n\n"
        + TAIL
    )


SET_ONE = _std(
    "西裝 1件 × 250元＝250元（乾洗）\n西褲 1件 × 100元＝100元（乾洗）",
    "350",
)
SET_TWO = _std(
    "西裝 2件 × 250元＝500元（乾洗）\n西褲 2件 × 100元＝200元（乾洗）",
    "700",
)
JACKET_ONE = _std("西裝 1件 × 250元＝250元（乾洗）", "250")
THREE_ONE = _std(
    "西裝 1件 × 250元＝250元（乾洗）\n西褲 1件 × 100元＝100元（乾洗）\n西裝背心 1件 × 110元＝110元（乾洗）",
    "460",
)
THREE_TWO = _std(
    "西裝 2件 × 250元＝500元（乾洗）\n西褲 2件 × 100元＝200元（乾洗）\n西裝背心 2件 × 110元＝220元（乾洗）",
    "920",
)
SOFT = (
    "清單收到了，還差一點資料就能幫你算：\n"
    "\n\n\n"
    "還沒加進去：西裝 1件、西褲 1件。\n"
    "西裝：洗法另計，不能直接套用一般水洗價。其他算好的金額會保留。\n"
    "另外待評估：柔洗，尚未加計。\n\n"
    + TAIL
)
NOCOUNT = (
    "幫你算好了，先按店裡系統的標準價：\n\n"
    "襯衫 2件 × 70元＝140元\n\n"
    "這批先抓約 140 元。\n"
    "已確認品項小計 140 元。\n\n"
    "還沒加進去：西裝（件數還沒說）。\n"
    "西裝有幾件？告訴我數量，我接著算。\n\n"
    + TAIL
)


def _uid() -> str:
    global _UID
    _UID += 1
    return f"suit{_UID:04d}"


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


def _render(text: str, previous=None) -> str:
    draft = estimate.update(text, previous, conv.PRICES)
    if draft is None:
        raise AssertionError(text)
    return estimate.render(draft)


def _priced(text: str) -> list[str]:
    return [line for line in text.splitlines() if "×" in line]


def _env():
    env = os.environ.copy()
    env["LAUNDRY_REPO_ROOT"] = str(SANDBOX)
    env["LAUNDRY_LOOKUP_FIXTURE"] = "1"
    env["LAUNDRY_EHANK_ROOT"] = NO_EHANK
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def _golden(mode: str):
    tmp = tempfile.mkdtemp(prefix="suit-golden-out-")
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


def _row_name(row: dict) -> str:
    return str(row.get("Dname") or "").strip()


@contextmanager
def _patched_snapshot(mutator):
    saved = tp.SNAPSHOT
    copied = copy.deepcopy(saved)
    mutator(copied)
    tp.SNAPSHOT = copied
    try:
        yield
    finally:
        tp.SNAPSHOT = saved


def _pants_defmode_water(snapshot: dict) -> None:
    for row in snapshot["dco"]:
        if _row_name(row) == "西褲":
            row["DefMode"] = 1


def _drop_pants(snapshot: dict) -> None:
    snapshot["dco"] = [row for row in snapshot["dco"] if _row_name(row) != "西褲"]


class SuitPricingTests(unittest.TestCase):
    def setUp(self):
        _clear_align_file()
        _restore_bot()
        self._tmp = tempfile.mkdtemp(prefix="suit-pricing-")
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

    def test_S01_jacket_quote(self):
        texts = [
            "西裝上衣大概 250（乾洗）。",
            "西褲 100（乾洗）、西裝背心 110（乾洗），都是一件一件算。\n實際以到店看件為準。",
        ]
        with Probe():
            _boot("default_mode")
            for spoken in ("西裝多少錢", "西裝", "西裝外套", "西裝外套多少錢", "西裝上衣", "西裝上身", "洗西裝"):
                msgs, meta, uid = _ask(spoken)
                self.assertEqual(_texts(msgs), texts, spoken)
                self.assertEqual(_qr(msgs), QUOTE_BUTTONS, spoken)
                self.assertEqual(meta["intent"], "quote", spoken)
                self.assertEqual(conv.get_sess(uid)["last_item"], "西裝", spoken)

    def test_S02_jacket_quote_water(self):
        with Probe():
            _boot("water")
            msgs, meta, _uid_used = _ask("西裝多少錢")
        self.assertEqual(_texts(msgs), [
            "西裝上衣水洗大概 200。",
            "西褲 80、西裝背心 80，都是一件一件算。\n實際以到店看件為準。",
        ])
        self.assertEqual(meta["intent"], "quote")

    def test_S03_piece_list(self):
        texts = [
            "西裝沒有整套價，一件一件算：西裝上衣 250（乾洗）、西褲 100（乾洗）、西裝背心 110（乾洗）。",
            "實際以到店看件為準。",
        ]
        with Probe():
            _boot("default_mode")
            for spoken in ("整套西裝", "西裝整套多少錢", "西裝套裝", "三件式西裝", "西裝三件式"):
                msgs, meta, uid = _ask(spoken)
                self.assertEqual(_texts(msgs), texts, spoken)
                self.assertEqual(_qr(msgs), QUOTE_BUTTONS, spoken)
                self.assertEqual(meta["intent"], "quote", spoken)
                self.assertEqual(conv.get_sess(uid)["last_item"], "西裝", spoken)

    def test_S04_piece_list_water(self):
        texts = [
            "西裝沒有整套價，一件一件算：西裝上衣 200、西褲 80、西裝背心 80。",
            "實際以到店看件為準。",
        ]
        with Probe():
            _boot("water")
            for spoken in ("整套西裝", "三件式西裝"):
                msgs, meta, _uid_used = _ask(spoken)
                self.assertEqual(_texts(msgs), texts, spoken)
                self.assertEqual(meta["intent"], "quote", spoken)

    def test_S05_clarify_buttons(self):
        with Probe():
            _boot("default_mode")
            uid = _uid()
            msgs, meta, _uid_used = _ask("西裝要乾洗嗎", uid)
            self.assertEqual(_texts(msgs), [
                "西裝上衣 250（乾洗）、西褲 100（乾洗）、西裝背心 110（乾洗）。",
                "您要洗哪一件？",
            ])
            self.assertEqual(_qr(msgs), CLARIFY_BUTTONS)
            self.assertEqual(meta["intent"], "clarify")
            follow = _ask("西裝上衣", uid)
            self.assertEqual(_texts(follow[0])[0], "西裝上衣大概 250（乾洗）。")
            self.assertEqual(follow[1]["intent"], "quote")
            pants = _ask("西褲", uid)
            self.assertEqual(_texts(pants[0])[0], "西褲大概 100（乾洗）。")
            self.assertEqual(pants[1]["intent"], "quote")
            vest = _ask("西裝背心", uid)
            self.assertEqual(_texts(vest[0])[0], "西裝背心大概 110（乾洗）。")
            self.assertEqual(vest[1]["intent"], "quote")

    def test_S06_pants_vest_unchanged(self):
        with Probe():
            _boot("default_mode")
            pants_word, pants_meta, _uid_used = _ask("西裝褲多少錢")
            pants, _meta, _uid_used = _ask("西褲多少錢")
            vest, vest_meta, _uid_used = _ask("西裝背心")
        self.assertEqual(_texts(pants_word)[0], "西褲大概 100（乾洗）。")
        self.assertEqual(_texts(pants), [
            "西褲大概 100（乾洗）。",
            "實際以到店看件為準。",
        ])
        self.assertEqual(_texts(vest)[0], "西裝背心大概 110（乾洗）。")
        self.assertEqual(pants_meta["intent"], "quote")
        self.assertEqual(_meta["intent"], "quote")
        self.assertEqual(vest_meta["intent"], "quote")

    def test_S07_set_expand(self):
        expect = {
            "西裝一套": SET_ONE,
            "西裝1套": SET_ONE,
            "一套西裝": SET_ONE,
            "整套西裝1套": SET_ONE,
            "西裝套裝1套": SET_ONE,
            "西裝2套": SET_TWO,
            "兩套西裝": SET_TWO,
        }
        with Probe():
            _boot("default_mode")
            for spoken, wanted in expect.items():
                self.assertEqual(_render(spoken), wanted, spoken)

    def test_S08_three_piece(self):
        with Probe():
            _boot("default_mode")
            self.assertEqual(_render("三件式西裝1套"), THREE_ONE)
            self.assertEqual(_render("三件式西裝2套"), THREE_TWO)

    def test_S09_jacket_alias(self):
        mix = _std(
            "西裝 2件 × 250元＝500元（乾洗）\n西褲 1件 × 100元＝100元（乾洗）",
            "600",
        )
        expect = {
            "西裝外套1件": JACKET_ONE,
            "西裝上衣1件": JACKET_ONE,
            "西裝上身1件": JACKET_ONE,
            "西裝外套2件、西褲1件": mix,
            "西裝1件": JACKET_ONE,
        }
        with Probe():
            _boot("default_mode")
            for spoken, wanted in expect.items():
                self.assertEqual(_render(spoken), wanted, spoken)

    def test_S10_merge_append(self):
        mix = _std(
            "西裝 1件 × 250元＝250元（乾洗）\n西褲 1件 × 100元＝100元（乾洗）\n襯衫 2件 × 70元＝140元",
            "490",
        )
        extra = _std(
            "西裝 1件 × 250元＝250元（乾洗）\n西褲 2件 × 100元＝200元（乾洗）",
            "450",
        )
        with Probe():
            _boot("default_mode")
            self.assertEqual(_render("西裝1套、襯衫2件"), mix)
            self.assertEqual(_render("西裝1套、西褲1件"), extra)
            first = estimate.update("西裝1套", None, conv.PRICES)
            second = estimate.update("再加西裝1套", first, conv.PRICES)
            self.assertEqual(estimate.render(second), SET_TWO)

    def test_S11_wash_refuse(self):
        with Probe():
            _boot("default_mode")
            self.assertEqual(_render("西裝1套要乾洗"), SET_ONE)
            self.assertEqual(_render("西裝1套要柔洗"), SOFT)

    def test_S12_water_estimates(self):
        expect = {
            "西裝一套": _water("西裝 1件 × 200元＝200元\n西褲 1件 × 80元＝80元", "280"),
            "三件式西裝1套": _water(
                "西裝 1件 × 200元＝200元\n西褲 1件 × 80元＝80元\n西裝背心 1件 × 80元＝80元",
                "360",
            ),
            "西裝外套1件": _water("西裝 1件 × 200元＝200元", "200"),
        }
        with Probe():
            _boot("water")
            for spoken, wanted in expect.items():
                self.assertEqual(_render(spoken), wanted, spoken)

    def test_S13_nocount_unchanged(self):
        with Probe():
            _boot("default_mode")
            self.assertEqual(_render("整套西裝、襯衫2件"), NOCOUNT)

    def test_S14_mixed_label(self):
        with _patched_snapshot(_pants_defmode_water):
            with Probe():
                _boot("default_mode")
                whole, _meta, _uid_used = _ask("整套西裝")
                money, _meta2, _uid_used = _ask("西裝多少錢")
                rendered = _render("西裝1套")
        self.assertEqual(_texts(whole), [
            "西裝沒有整套價，一件一件算：西裝上衣 250（乾洗）、西褲 80、西裝背心 110（乾洗）。",
            "實際以到店看件為準。",
        ])
        self.assertEqual(_texts(money), [
            "西裝上衣大概 250（乾洗）。",
            "西褲 80、西裝背心 110（乾洗），都是一件一件算。\n實際以到店看件為準。",
        ])
        self.assertEqual(_priced(rendered), [
            "西裝 1件 × 250元＝250元（乾洗）",
            "西褲 1件 × 80元＝80元",
        ])
        self.assertIn("這批預估 330 元。", rendered)

    def test_S15_pants_absent(self):
        with _patched_snapshot(_drop_pants):
            with Probe():
                _boot("default_mode")
                rendered = _render("西裝1套")
                jacket = _render("西裝外套1件")
                msgs, meta, _uid_used = _ask("西裝多少錢")
        self.assertEqual(_priced(rendered), ["西裝 1件 × 250元＝250元（乾洗）"])
        self.assertIn("這批預估 250 元。", rendered)
        self.assertEqual(_priced(jacket), ["西裝 1件 × 250元＝250元（乾洗）"])
        self.assertEqual(_texts(msgs), [
            "西裝外套還是西裝褲？",
            "價目目前列的是西裝背心；外套跟褲子建議到店看件。",
        ])
        self.assertEqual(meta["intent"], "clarify")

    def test_S16_golden_off(self):
        proc = _golden("off")
        self.assertEqual(proc.returncode, 0, (proc.stdout or "")[-500:] + (proc.stderr or "")[-500:])
        self.assertIn("GOLDEN_COMPARE| SAME", proc.stdout or "")

    def test_S17_golden_fallback(self):
        proc = _golden("fallback")
        self.assertEqual(proc.returncode, 0, (proc.stdout or "")[-500:] + (proc.stderr or "")[-500:])
        self.assertIn("GOLDEN_COMPARE| SAME", proc.stdout or "")


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


SuitPricingTests.__module__ = "test_suit_pricing"
ScorerTests.__module__ = "test_suit_pricing"

KNOWN_IDS = {
    f"test_suit_pricing.SuitPricingTests.{name}"
    for name in dir(SuitPricingTests)
    if name.startswith("test_S")
}


def _method_for(code: str) -> str:
    matches = [name for name in dir(SuitPricingTests) if name.startswith(f"test_{code}_")]
    if len(matches) != 1:
        raise RuntimeError(code)
    return matches[0]


def _full_id(method: str) -> str:
    return f"test_suit_pricing.SuitPricingTests.{method}"


MUTATIONS = [
    ("W01", ROOT / "estimate.py",
     "def _jacket_alias_target_ready(target: str, cat: dict) -> bool:\n"
     '    """上衣別名只在目標已在這份價目時套用。"""\n'
     "    return target in cat\n",
     "def _jacket_alias_target_ready(target: str, cat: dict) -> bool:\n"
     '    """上衣別名只在目標已在這份價目時套用。"""\n'
     "    return True\n",
     ["S16", "S17"]),
    ("W02", ROOT / "estimate.py",
     '    if "西裝" not in cat or "西褲" not in cat:\n',
     '    if "西裝" not in cat:\n',
     ["S15"]),
    ("W03", ROOT / "estimate.py",
     "    lo, hi = count[0], count[1]\n",
     "    lo, hi = 1, 1\n",
     ["S07"]),
    ("W04", ROOT / "estimate.py",
     '        names = ("西裝", "西褲", "西裝背心")\n',
     '        names = ("西裝", "西褲")\n',
     ["S08"]),
    ("W05", ROOT / "estimate.py",
     "        seen.add(name)  # 拆出來的品項這則訊息裡算已出現\n",
     "        if name == \"西裝\":\n"
     "            seen.add(name)  # 拆出來的品項這則訊息裡算已出現\n",
     ["S10"]),
    ("W06", ROOT / "conversation.py",
     "def _suit_piece_bits() -> list[str]:\n"
     "    return [\n"
     "        f\"西裝上衣 {_labeled_price('西裝')}\",\n"
     "        f\"西褲 {_labeled_price('西褲')}\",\n"
     "        f\"西裝背心 {_labeled_price('西裝背心')}\",\n"
     "    ]\n",
     "def _suit_piece_bits() -> list[str]:\n"
     "    label = _labeled_price(\"西裝\")\n"
     "    return [\n"
     "        f\"西裝上衣 {label}\",\n"
     "        f\"西褲 {label}\",\n"
     "        f\"西裝背心 {label}\",\n"
     "    ]\n",
     ["S14"]),
    ("W07", ROOT / "conversation.py",
     "def _suit_jacket_aside() -> str:\n"
     "    return f\"西褲 {_labeled_price('西褲')}、西裝背心 {_labeled_price('西裝背心')}，都是一件一件算。\"\n",
     "def _suit_jacket_aside() -> str:\n"
     "    return f\"西裝背心 {_labeled_price('西裝背心')}，都是一件一件算。\"\n",
     ["S01"]),
    ("W08", ROOT / "conversation.py",
     "def _suit_clarify_buttons():\n"
     "    return [(\"西裝上衣\", \"西裝上衣\"), (\"西褲\", \"西褲\"), (\"西裝背心\", \"西裝背心\")]\n",
     "def _suit_clarify_buttons():\n"
     "    return [(\"西裝\", \"西裝\"), (\"西褲\", \"西褲\"), (\"西裝背心\", \"西裝背心\")]\n",
     ["S05"]),
    ("W09", ROOT / "conversation.py",
     "        f\"西裝上衣 {_labeled_price('西裝')}\",\n"
     "        f\"西褲 {_labeled_price('西褲')}\",\n"
     "        f\"西裝背心 {_labeled_price('西裝背心')}\",\n",
     "        f\"西裝上衣 {_labeled_price('西裝')}\",\n"
     "        f\"西裝背心 {_labeled_price('西裝背心')}\",\n",
     ["S03"]),
    ("W10", ROOT / "conversation.py",
     "def _suit_phrase_messages(uid: str, norm: str):\n"
     "    if norm in _SUIT_SET_PHRASES or norm in _SUIT_THREE_PHRASES:\n"
     "        return _suit_piece_list(uid)\n"
     "    return None\n",
     "def _suit_phrase_messages(uid: str, norm: str):\n"
     "    if norm in _SUIT_SET_PHRASES:\n"
     "        return _suit_jacket_quote(uid)\n"
     "    if norm in _SUIT_THREE_PHRASES:\n"
     "        return _suit_piece_list(uid)\n"
     "    return None\n",
     ["S03"]),
    ("W11", ROOT / "estimate.py",
     "        part_append = append\n",
     "        part_append = append and name == \"西裝\"\n",
     ["S10"]),
    ("W12", ROOT / "estimate.py",
     "        if lo is None:\n"
     "            reason = \"數量待確認\"\n"
     "        if _refuse_other_wash(name, requested):\n"
     "            reason = _OTHER_WASH_REASON\n",
     "        if lo is None:\n"
     "            reason = \"數量待確認\"\n"
     "        if False and _refuse_other_wash(name, requested):\n"
     "            reason = _OTHER_WASH_REASON\n",
     ["S11"]),
    ("W13", ROOT / "estimate.py",
     "    if count is None:\n"
     "        return None\n"
     "    lo, hi = count[0], count[1]\n",
     "    if count is None:\n"
     "        names = (\"西裝\", \"西褲\", \"西裝背心\") if kind == \"three\" else (\"西裝\", \"西褲\")\n"
     "        return names, None, None\n"
     "    lo, hi = count[0], count[1]\n",
     ["S13"]),
    ("W14", ROOT / "estimate.py",
     "_JACKET_ALIASES = (\n"
     "    (\"西裝外套\", \"西裝\"),\n"
     "    (\"西裝上衣\", \"西裝\"),\n"
     "    (\"西裝上身\", \"西裝\"),\n"
     ")\n",
     "_JACKET_ALIASES = (\n"
     "    (\"西裝外套\", \"西裝\"),\n"
     ")\n",
     ["S09"]),
    ("W15", ROOT / "estimate.py",
     "        bare = _attached_count(left, right, \"套\")\n",
     "        bare = None\n",
     ["S07"]),
    ("W16", ROOT / "conversation.py",
     "_SUIT_THREE_PHRASES = (\"三件式西裝\", \"西裝三件式\")\n",
     "_SUIT_THREE_PHRASES = ()\n",
     ["S03"]),
    ("W17", ROOT / "conversation.py",
     "            if suit_key.startswith(\"西裝褲\"):\n"
     "                return _pack(_quote_item(uid, \"西褲\"), \"quote\", False)\n",
     "            if suit_key.startswith(\"西裝褲\"):\n"
     "                return _pack(_suit_jacket_quote(uid), \"quote\", False)\n",
     ["S06"]),
    ("W18", ROOT / "conversation.py",
     "    set_sess(uid, last_item=\"西裝\", last_price=_price_of(\"西裝\"), topic=None)\n",
     "    set_sess(uid, last_item=\"西裝上衣\", last_price=_price_of(\"西裝\"), topic=None)\n",
     ["S01"]),
    ("W19", ROOT / "conversation.py",
     "def _menu_price(name: str, price) -> str:\n"
     "    label = PRICE_LABELS.get(name) or \"\"\n"
     "    shown = str(price)\n"
     "    if label:\n"
     "        shown = f\"{shown}（{label}）\"\n"
     "    return shown\n",
     "def _menu_price(name: str, price) -> str:\n"
     "    label = PRICE_LABELS.get(name) or \"\"\n"
     "    shown = str(price)\n"
     "    shown = f\"{shown}（{label}）\"\n"
     "    return shown\n",
     ["S02", "S04"]),
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
    names = [f"SuitPricingTests.{method}" for method in methods]
    proc = subprocess.run(
        [PY, "-B", str(ROOT / "test_suit_pricing.py"), "--ids", *names],
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
