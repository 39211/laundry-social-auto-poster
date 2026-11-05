# -*- coding: utf-8 -*-
"""T-3: synthetic fake repo root for the old line-bot suites (replaces the lost line-bot/_sandbox_repo/).

make_sandbox(tmp) writes, under tmp/_sandbox_repo:
  data/prices.json            test catalogue. Every item that exists in prices-test-subset.json takes its price
                              from that file; the other items the old suites name come from EXTRA_PRICES below.
  data/dco-snapshot.json      synthetic eHank Dco/Cpy snapshot (made-up rows, no POS data).
  data/business-profile.json  fake shop profile (phone/landmark keys omitted so the product defaults apply).
  data/line-customer-bind.json  empty.
  data/laundry-fixture.json   synthetic lookup fixture (LOOKUP_FIXTURE below) for test_line_flows / test_isolation.
  data/photos/                empty.
  secrets/line-channel.json   obviously fake values.
No data/price-align.json is written: the bot starts with alignment "off", as on a fresh checkout.

Hand-derived facts the suites hard-code (update the suites if you edit the tables below):
  catalogue size       44 base items; after an aligned sync 44 - 3 retired + 16 added = 57.
  default_mode report  changed 6: 保潔墊 120→150, 床組四件套 300→350, 全布包 600→500（10天）, 皮帶 300→400（14天）,
                       毛衣 150→180（乾洗）, 西裝背心 80→110（乾洗）; labels only 3: 皮褲, 皮短褲, 精品毛衣; unmapped 8.
  water report         changed 2: 保潔墊, 床組四件套; labels only 1: 精品毛衣 (water cell is 0, falls back to 乾洗);
                       unmapped 8.
  unmapped 8           一般包, 休閒鞋, 旗袍, 睡袋, 羽絨睡袋, 褶裙, 護士服, 高爾夫球鞋. 毛毯雙人 and 羽絨羊毛被 are also
                       unmapped but the sync retires them, so they are not reported.
The subset key 羊毛被 is stored under the catalogue name 羽絨羊毛被: the real price list has no 羊毛被 row
(ehank_prices retires 羽絨羊毛被; estimate aliases 羊毛被→蠶絲羊毛被 only while 羊毛被 is absent).
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
import threading
from pathlib import Path

ASSETS = Path(__file__).resolve().parent
SUBSET_PATH = ASSETS / "prices-test-subset.json"
SANDBOX_DIRNAME = "_sandbox_repo"

# Category order and item order matter (menus, "褲"/"羽絨" listings, in-place retirement).
LAYOUT = (
    ("寢具", ("枕套", "涼被", "睡袋", "保潔墊", "床組四件套", "床單被套薄", "床單被套厚",
             "棉被單人", "棉被雙人", "毛毯單人", "毛毯雙人", "羽絨睡袋", "羽絨羊毛被")),
    ("包包", ("背包", "全布包", "一般包", "名牌包")),
    ("鞋子", ("一般運動鞋", "皮類運動鞋", "混合運動鞋", "名牌鞋", "皮鞋", "休閒鞋", "高爾夫球鞋")),
    ("皮革", ("皮褲", "皮短褲", "皮帶")),
    ("衣物", ("短褲", "襯衫", "長褲", "棉T", "毛衣", "薄外套", "羽絨背心", "羽絨外套",
             "旗袍", "褶裙", "護士服", "圍巾", "西裝背心")),
    ("精品", ("精品毛衣", "精品短褲", "精品襯衫")),
    ("其他", ("整燙",)),
)
SUBSET_KEY = {"羽絨羊毛被": "羊毛被"}
# Only items the subset does not have. Values are the old suites' own contract numbers.
EXTRA_PRICES = {
    "睡袋": 250, "床單被套薄": 200, "床單被套厚": 250, "毛毯雙人": 400, "羽絨睡袋": 200,
    "全布包": 600,
    "休閒鞋": 350, "高爾夫球鞋": 150,
    "皮褲": 700, "皮短褲": 600, "皮帶": 300,
    "毛衣": 150, "羽絨背心": 200, "旗袍": 200, "褶裙": 100, "護士服": 80, "圍巾": 80, "西裝背心": 80,
    "精品毛衣": 210, "精品短褲": 100,
}
NOTE = "T-3 合成測試價目（不是店裡的價目表）"

# Synthetic Cpy modes: DefMode n means MODES[n-1].
MODES = ("水洗", "乾洗", "柔洗", "10天", "14天", "", "", "")
# (Dname, Dclass, Unit, prices per mode (padded to 8 with 0), DefMode)
DCO_ROWS = (
    ("枕套", "寢具", "件", (30,), 1),
    ("涼被", "寢具", "件", (180,), 1),
    ("保潔墊", "寢具", "件", (150,), 1),
    ("床組=床單+被套+枕套2", "寢具", "套", (350,), 1),
    ("床單.被套(薄)", "寢具", "件", (200,), 1),
    ("床單.被套(厚)", "寢具", "件", (250,), 1),
    ("棉被(小)", "寢具", "件", (350,), 1),
    ("棉被(大)", "寢具", "件", (500,), 1),
    ("毛毯(小)", "寢具", "件", (200,), 1),
    ("毛毯(中)", "寢具", "件", (300,), 1),
    ("毛毯(大)", "寢具", "件", (450,), 1),
    ("羽絨被", "寢具", "件", (600,), 1),
    ("蠶絲.羊毛被子", "寢具", "件", (800,), 1),
    ("枕頭 娃娃", "寢具", "件", (300,), 1),
    ("書包OR背包", "包包", "個", (500,), 1),
    ("全布包", "包包", "個", (600, 0, 0, 500), 4),
    ("名牌包", "包包", "個", (1500,), 1),
    ("大書包", "包包", "個", (800, 0, 0, 800), 4),
    ("一般運動鞋", "鞋子", "雙", (250,), 1),
    ("皮運動鞋", "鞋子", "雙", (300,), 1),
    ("混和運動鞋", "鞋子", "雙", (350,), 1),
    ("名牌鞋", "鞋子", "雙", (600,), 1),
    ("皮鞋", "鞋子", "雙", (400,), 1),
    ("大童鞋", "鞋子", "雙", (200,), 1),
    ("高級拖鞋", "鞋子", "雙", (400,), 1),
    ("皮褲", "皮革", "件", (700, 0, 0, 0, 700), 5),
    ("皮短褲", "皮革", "件", (600, 0, 0, 0, 600), 5),
    ("皮帶", "皮革", "條", (300, 0, 0, 0, 400), 5),
    ("皮手套", "皮革", "雙", (300,), 1),
    ("短褲", "衣物", "件", (60,), 1),
    ("襯衫", "衣物", "件", (70,), 1),
    ("長褲", "衣物", "件", (70,), 1),
    ("棉T", "衣物", "件", (70,), 1),
    ("毛衣", "衣物", "件", (150, 180), 2),
    ("薄外套", "衣物", "件", (150,), 1),
    ("羽絨背心", "衣物", "件", (200,), 1),
    ("羽絨外套", "衣物", "件", (280,), 1),
    ("圍巾", "衣物", "件", (80,), 1),
    ("西裝背心", "衣物", "件", (80, 110), 2),
    ("西裝", "衣物", "件", (200, 250), 2),
    ("西褲", "衣物", "件", (80, 100), 2),
    ("領帶", "衣物", "條", (100, 100), 2),
    ("針織衣", "衣物", "件", (120, 150), 2),
    ("女衣", "衣物", "件", (100,), 1),
    ("精品毛衣", "精品", "件", (0, 210), 2),
    ("精品短褲", "精品", "件", (100,), 1),
    ("精品襯衫", "精品", "件", (100,), 1),
    ("整燙", "其他", "件", (50,), 1),
)

# Synthetic lookup fixture in laundry_lookup._from_fixture shape (made-up numbers, not customer data):
#   0028  one ready piece (stock) + one waiting piece (factory) -> "mixed"; mobile 0912345678 (the suites' placeholder)
#   1947  waiting piece only (wash) -> "not_ready"; wash number W2001
#   5678 (partial mobile), 9999 and 0000 must match nothing.
LOOKUP_FIXTURE = {
    "note": "T-3 synthetic lookup fixture (test only, not customer data)",
    "customers": [
        {"no": "0028", "name": "測試客A", "phone": "0912345678"},
        {"no": "1947", "name": "測試客B", "phone": "0900000000"},
    ],
    "garments": [
        {"id": "T3-G001", "customer_no": "0028", "wash_no": "W1001", "name": "襯衫", "status": "stock", "price": 70},
        {"id": "T3-G002", "customer_no": "0028", "wash_no": "W1002", "name": "長褲", "status": "factory", "price": 70},
        {"id": "T3-G003", "customer_no": "1947", "wash_no": "W2001", "name": "毛衣", "status": "wash", "price": 150},
    ],
}

BUSINESS_PROFILE = {
    "name": "測試洗衣店（合成資料）",
    "address_text": "合成測試地址（非真實地址）",
    "opening_hours_text": "週一至週五 10:00–20:00、週六 12:00–18:00、週日公休（測試資料）",
    "map_url": "",
}
FAKE_LINE_CHANNEL = {
    "channel_secret": "FAKE-T3-channel-secret-not-real",
    "line_channel_token": "FAKE-T3-channel-token-not-real",
}


def _subset_names(subset: dict) -> set:
    return {name for rows in subset.values() if isinstance(rows, dict) for name in rows}


def build_prices() -> dict:
    subset = json.loads(SUBSET_PATH.read_text(encoding="utf-8"))
    overlap = sorted(set(EXTRA_PRICES) & _subset_names(subset))
    if overlap:
        raise ValueError(f"EXTRA_PRICES must not override prices-test-subset.json: {overlap}")
    prices: dict = {}
    for cat, names in LAYOUT:
        rows = {}
        for name in names:
            key = SUBSET_KEY.get(name, name)
            cat_rows = subset.get(cat) if isinstance(subset.get(cat), dict) else {}
            if key in cat_rows:
                rows[name] = cat_rows[key]
            elif name in EXTRA_PRICES:
                rows[name] = EXTRA_PRICES[name]
            else:
                raise KeyError(f"no test price for {cat}/{name} (expected in prices-test-subset.json as {key})")
            if type(rows[name]) is not int or rows[name] <= 0:
                raise ValueError(f"bad test price for {name}: {rows[name]!r}")
        prices[cat] = rows
    prices["note"] = NOTE
    return prices


def build_dco_snapshot() -> dict:
    rows = []
    for index, (dname, dclass, unit, values, def_mode) in enumerate(DCO_ROWS, 1):
        cells = list(values) + [0] * (8 - len(values))
        rows.append({"Dco": f"T3-{index:03d}", "Dname": dname, "Dclass": dclass, "Unit": unit,
                     "M": cells, "DefMode": def_mode})
    return {"note": "T-3 synthetic eHank snapshot (test only)", "modes": list(MODES), "dco": rows}


def _write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


def make_sandbox(tmp: Path) -> Path:
    """Write the synthetic fake repo root under tmp and return it (tmp/_sandbox_repo)."""
    root = Path(tmp) / SANDBOX_DIRNAME
    root.mkdir(parents=True, exist_ok=False)
    data = root / "data"
    secrets = root / "secrets"
    (data / "photos").mkdir(parents=True)
    secrets.mkdir()
    _write_json(data / "prices.json", build_prices())
    _write_json(data / "dco-snapshot.json", build_dco_snapshot())
    _write_json(data / "business-profile.json", BUSINESS_PROFILE)
    _write_json(data / "line-customer-bind.json", {})
    _write_json(data / "laundry-fixture.json", LOOKUP_FIXTURE)
    _write_json(secrets / "line-channel.json", FAKE_LINE_CHANNEL)
    return root


_SHARED: Path | None = None


def shared_sandbox(prefix: str = "t3-sandbox-") -> Path:
    """One sandbox per process (suites import each other); removed at exit."""
    global _SHARED
    if _SHARED is None:
        tmp = Path(tempfile.mkdtemp(prefix=prefix)).resolve()
        atexit.register(lambda: shutil.rmtree(tmp, ignore_errors=True))
        _SHARED = make_sandbox(tmp)
    return _SHARED


def harness_mode(argv=None) -> bool:
    """--mutations / --commander patch product files on purpose; the write guard stays off there."""
    argv = sys.argv if argv is None else argv
    return "--mutations" in argv or "--commander" in argv


_VIOLATIONS: list[str] = []
_ALLOWED: list[Path] = []
_STATE = {"installed": False}
_LOCAL = threading.local()
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | getattr(os, "O_TRUNC", 0)
_LOOPBACK = ("127.0.0.1", "::1", "localhost")


def write_violations() -> list[str]:
    return list(_VIOLATIONS)


def _allowed(raw) -> bool:
    try:
        text = os.fsdecode(os.fspath(raw))
    except TypeError:
        return True  # file descriptor
    if text == os.devnull:
        return True
    try:
        path = Path(text).resolve()
    except (OSError, ValueError):
        return True
    if any(part == ".pytest_cache" or part.startswith("pytest-cache-files-") for part in path.parts):
        return True
    return any(path == root or path.is_relative_to(root) for root in _ALLOWED)


def _audit(event, args):
    if getattr(_LOCAL, "busy", False):
        return
    _LOCAL.busy = True
    problem = ""
    try:
        targets = ()
        if event == "open":
            mode = args[1] if len(args) > 1 else None
            flags = args[2] if len(args) > 2 else 0
            writing = (isinstance(mode, str) and any(ch in mode for ch in "wax+")) or (
                isinstance(flags, int) and flags > 0 and flags & _WRITE_FLAGS)
            if writing:
                targets = args[:1]
        elif event in ("os.remove", "os.mkdir", "os.rmdir", "os.truncate", "shutil.rmtree"):
            targets = args[:1]
        elif event == "os.rename":
            targets = args[:2]
        elif event == "shutil.copyfile":
            targets = args[1:2]
        elif event == "socket.connect":
            address = args[1] if len(args) > 1 else None
            host = address[0] if isinstance(address, tuple) and address else address
            if isinstance(host, str) and host not in _LOOPBACK:
                problem = f"socket.connect: {address!r}"
        for target in targets:
            if isinstance(target, (str, bytes, os.PathLike)) and not _allowed(target):
                problem = f"{event}: {os.fsdecode(os.fspath(target))}"
                break
    except Exception:  # noqa: BLE001  never let the guard itself break the code under test
        problem = ""
    finally:
        _LOCAL.busy = False
    if problem:
        _VIOLATIONS.append(problem)
        raise PermissionError("T-3 isolation guard blocked " + problem)


def install_write_guard(*extra_allowed: Path) -> None:
    """Block writes outside the system temp dir (and real sockets) for the rest of the process."""
    for root in (Path(tempfile.gettempdir()), *extra_allowed):
        resolved = Path(root).resolve()
        if resolved not in _ALLOWED:
            _ALLOWED.append(resolved)
    if _STATE["installed"]:
        return
    _STATE["installed"] = True
    sys.addaudithook(_audit)
