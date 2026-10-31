# -*- coding: utf-8 -*-
"""把 bot 價目對齊 eHank Dco。讀不到或基準是 off 時，沿用 prices.json，品名不增減。

對齊成功（default_mode 或 water，且讀得到價目表）時，依 CATALOG_SYNC 加入有定價的新品項；
被取代的舊品項只有在替代品全部加入後才移除。
"""
from __future__ import annotations

import argparse
import copy
import dataclasses
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

# 現役 bot 不會設 LAUNDRY_EHANK_ROOT，所以預設指到店裡的 eHank 根目錄。
DEFAULT_EHANK_ROOT = "C:/FXwash"

DCO_SQL = "SELECT Dname, M1, M2, M3, m4, m5, m6, m7, m8, DefMode FROM Dco"
CPY_SQL = "SELECT Mode1, Mode2, Mode3, Mode4, Mode5, Mode6, Mode7, Mode8 FROM Cpy"

# 左是 bot 品名，右是 eHank 品名。不得自行增刪。
NAME_MAP = {
    "床組四件套": "床組=床單+被套+枕套2",
    "床單被套薄": "床單.被套(薄)",
    "床單被套厚": "床單.被套(厚)",
    "棉被單人": "棉被(小)",
    "棉被雙人": "棉被(大)",
    "毛毯單人": "毛毯(小)",
    "背包": "書包OR背包",
    "特殊類名牌包": "特殊名牌包",
    "皮類運動鞋": "皮運動鞋",
    "混合運動鞋": "混和運動鞋",
    "薄夾克": "薄外套",
    "厚夾克": "厚外套",
    "G-T兩件式外套": "G-T外套2件式",
}

# eHank 品名、bot 顯示名、分類、被取代的舊品名。空字串表示只附加、不取代。不得自行增刪。
# 括號是半形；「枕頭 娃娃」中間是一個半形空白。顯示名不帶括號與空白。
CATALOG_SYNC = (
    ("西裝", "西裝", "衣物", ""),
    ("西褲", "西褲", "衣物", ""),
    ("領帶", "領帶", "衣物", ""),
    ("針織衣", "針織衣", "衣物", ""),
    ("女衣", "女衣", "衣物", ""),
    ("毛毯(小)", "小毛毯", "寢具", "毛毯單人"),
    ("毛毯(中)", "中毛毯", "寢具", "毛毯雙人"),
    ("毛毯(大)", "大毛毯", "寢具", "毛毯雙人"),
    ("羽絨被", "羽絨被", "寢具", "羽絨羊毛被"),
    ("蠶絲.羊毛被子", "蠶絲羊毛被", "寢具", "羽絨羊毛被"),
    ("枕頭 娃娃", "枕頭", "寢具", ""),
    ("枕頭 娃娃", "娃娃", "寢具", ""),
    ("皮手套", "皮手套", "皮革", ""),
    ("大書包", "大書包", "包包", ""),
    ("大童鞋", "大童鞋", "鞋子", ""),
    ("高級拖鞋", "高級拖鞋", "鞋子", ""),
)
_RETIRE_ORDER = ("毛毯單人", "毛毯雙人", "羽絨羊毛被")
_SKIP_MISSING = "價目表沒有這個品項"
_SKIP_NO_PRICE = "沒有可用價格"
_SKIP_EXISTS = "bot 已有同名品項"

_BASIS_VALUES = ("off", "default_mode", "water")
_NO_LABEL_MODES = ("水洗", "一般")

# B1-4 皮件／包交期，規則見 bag_turnaround_label。
BAG_LEATHER_TURNAROUND = "14天"
_DAY_ONLY_LABEL = re.compile(r"^\s*\d+\s*天\s*$")
_BAG_CATEGORIES = frozenset({"包包"})
_SHOE_CATEGORIES = frozenset({"鞋子"})
_LEATHER_GOOD_MARKS = ("皮件", "皮夾", "皮帶", "皮手套")
_BAG_FALSE_FRIENDS = ("包巾", "包被", "包裝", "包含", "包括")


def is_bag_or_leather_good(name, category="") -> bool:
    """包或皮件（皮夾、皮帶、皮手套）。皮鞋是鞋，皮衣是皮革衣物，都不算。"""
    key = unicodedata.normalize("NFKC", _norm_name(name))
    cat = unicodedata.normalize("NFKC", _norm_name(category))
    if not key:
        return False
    if cat in _SHOE_CATEGORIES or "鞋" in key:
        return False
    if cat in _BAG_CATEGORIES:
        return True
    if any(mark in key for mark in _LEATHER_GOOD_MARKS):
        return True
    if "包" in key and not any(word in key for word in _BAG_FALSE_FRIENDS):
        return True
    return False


def bag_turnaround_label(name, label, category="") -> str:
    """店主 2026-10-31 拍板（SHOP-FACTS F21／C04，卡 B1-4）：皮件、包 14 天。

    eHank 價目（店主自己的系統，不得修改）有些品項的標示只是天數，例如「10天」。
    對客顯示時，包與皮件的標示若只是天數（含全形數字），一律顯示「14天」；
    乾洗、水洗等不是純天數的標示不動，非包／皮件品項不動，價格不動。
    """
    text = "" if label is None else str(label)
    if not text:
        return text
    if not is_bag_or_leather_good(name, category):
        return text
    if _DAY_ONLY_LABEL.match(unicodedata.normalize("NFKC", text)):
        return BAG_LEATHER_TURNAROUND
    return text


@dataclasses.dataclass
class AlignResult:
    code: str
    basis: str
    prices: dict
    labels: dict
    changed: list
    labeled_only: list
    unmapped: list
    added: list = dataclasses.field(default_factory=list)
    retired: list = dataclasses.field(default_factory=list)
    skipped: list = dataclasses.field(default_factory=list)


def ehank_root() -> Path:
    return Path(os.environ.get("LAUNDRY_EHANK_ROOT", DEFAULT_EHANK_ROOT))


def repo_root() -> Path:
    raw = os.environ.get("LAUNDRY_REPO_ROOT", "").strip()
    if not raw:
        return Path("C:/Users/cyc39/laundry-repo")
    return Path(raw)


def _norm_name(value) -> str:
    return str("" if value is None else value).strip()


def resolve_basis(value) -> str:
    if isinstance(value, str) and value.strip() in _BASIS_VALUES:
        return value.strip()
    return "off"


def read_basis(repo: Path) -> str:
    try:
        path = Path(repo) / "data" / "price-align.json"
        if not path.is_file():
            return resolve_basis(None)
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return resolve_basis(None)
    if not isinstance(data, dict):
        return resolve_basis(None)
    return resolve_basis(data.get("basis"))


def _price_value(raw):
    """0 或空值視為沒有這個洗法的價格。"""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return None
    if number == 0:
        return None
    whole = int(number)
    if float(whole) != number:
        return None
    return whole


def _def_index(raw) -> int:
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return -1
    if 1 <= number <= 8:
        return number - 1
    return -1


def _cell(prices, index, mode_names):
    if not isinstance(index, int) or index < 0 or index >= 8:
        return None
    seq = list(prices)
    if index >= len(seq):
        return None
    number = _price_value(seq[index])
    if number is None:
        return None
    modes = list(mode_names)
    raw_mode = modes[index] if index < len(modes) else ""
    mode = str("" if raw_mode is None else raw_mode).strip()
    label = "" if mode in _NO_LABEL_MODES else mode
    return number, label


def _pick_price(hit, basis, mode_names):
    if basis == "water":
        chosen = _cell(hit["prices"], 0, mode_names)
        if chosen is None:
            chosen = _cell(hit["prices"], _def_index(hit["def_mode"]), mode_names)
        return chosen
    if basis == "default_mode":
        chosen = _cell(hit["prices"], _def_index(hit["def_mode"]), mode_names)
        if chosen is None:
            chosen = _cell(hit["prices"], 0, mode_names)
        return chosen
    return None


def _find_item(bot_name, items):
    key = _norm_name(bot_name)
    hit = items.get(key)
    if hit is not None:
        return hit
    mapped = NAME_MAP.get(key)
    if not mapped:
        return None
    return items.get(_norm_name(mapped))


def _book_from_rows(dco_rows, cpy_rows):
    if not dco_rows or not cpy_rows:
        return None
    mode_row = list(cpy_rows[0])
    modes = ["" if value is None else str(value) for value in mode_row[:8]]
    if len(modes) < 8:
        return None
    items = {}
    for raw in dco_rows:
        seq = list(raw)
        if len(seq) < 10:
            return None
        key = _norm_name(seq[0])
        if not key or key in items:
            continue
        items[key] = {"key": key, "prices": seq[1:9], "def_mode": seq[9]}
    if not items:
        return None
    return {"modes": modes, "items": items}


def read_price_book():
    """只執行 Dco / Cpy 兩句 SELECT。失敗回傳 None，呼叫端沿用 prices.json。"""
    root_path = ehank_root()
    if not root_path.is_dir():
        return None
    root = str(root_path)
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        from ai_engine import db_manager

        con = db_manager.get_conn()
    except Exception:
        return None
    try:
        cur = con.cursor()
        cur.execute(DCO_SQL)
        dco_rows = cur.fetchall()
        if not dco_rows:
            return None
        cur.execute(CPY_SQL)
        cpy_rows = cur.fetchall()
        if not cpy_rows:
            return None
        return _book_from_rows(dco_rows, cpy_rows)
    except Exception:
        return None
    finally:
        try:
            con.close()
        except Exception:
            pass


def _unchanged(base_prices: dict, basis: str, code: str) -> AlignResult:
    cloned = copy.deepcopy(base_prices)
    return AlignResult(code, basis, cloned, {}, [], [], [])


def _apply(base_prices: dict, basis: str, book: dict) -> AlignResult:
    aligned = copy.deepcopy(base_prices)
    labels = {}
    changed = []
    labeled_only = []
    unmapped = []
    modes = book["modes"]
    items = book["items"]
    for cat, rows in aligned.items():
        if not isinstance(rows, dict):
            continue
        for name, old in list(rows.items()):
            if type(old) is not int:
                continue
            hit = _find_item(name, items)
            if hit is None:
                unmapped.append(name)
                continue
            chosen = _pick_price(hit, basis, modes)
            if chosen is None:
                continue
            chosen_price, label = chosen
            rows[name] = chosen_price
            if label:
                labels[name] = label
            if chosen_price != old:
                changed.append({"name": name, "old": old, "new": chosen_price, "label": label})
            elif label:
                labeled_only.append({"name": name, "price": chosen_price, "label": label})
    return AlignResult("ALIGNED", basis, aligned, labels, changed, labeled_only, unmapped)


def _catalog_has(prices: dict, name: str) -> bool:
    for rows in prices.values():
        if isinstance(rows, dict) and name in rows:
            return True
    return False


def _delete_name(prices: dict, name: str) -> None:
    for rows in prices.values():
        if isinstance(rows, dict) and name in rows:
            del rows[name]


def _store_added_label(labels: dict, item: dict) -> None:
    if item["label"]:
        labels[item["name"]] = item["label"]


def _place_additions(rows: dict, inplace: dict, appended: list, labels: dict) -> dict:
    """取代成功的新品放在舊品項原位；其餘附加在分類最後，並維持表中順序。"""
    rebuilt = {}
    for name, price in rows.items():
        if name in inplace:
            for item in inplace[name]:
                rebuilt[item["name"]] = item["price"]
                _store_added_label(labels, item)
        else:
            rebuilt[name] = price
    for item in appended:
        rebuilt[item["name"]] = item["price"]
        _store_added_label(labels, item)
    return rebuilt


def _sync_catalog(result: AlignResult, book: dict) -> AlignResult:
    """ALIGNED 之後才增刪品項。被移除的舊名與新加入的品項不進 changed／labeled_only／unmapped。"""
    aligned = result.prices
    labels = result.labels
    items = book["items"]
    existing = set()
    for rows in aligned.values():
        if isinstance(rows, dict):
            existing.update(rows)
    planned = set()
    decisions = []
    for ehank, bot_name, category, retire in CATALOG_SYNC:
        if bot_name in existing or bot_name in planned:
            decisions.append({
                "status": "skip",
                "name": bot_name,
                "ehank": ehank,
                "category": category,
                "retire": retire,
                "why": _SKIP_EXISTS,
            })
            continue
        hit = items.get(_norm_name(ehank))
        if hit is None:
            decisions.append({
                "status": "skip",
                "name": bot_name,
                "ehank": ehank,
                "category": category,
                "retire": retire,
                "why": _SKIP_MISSING,
            })
            continue
        chosen = _pick_price(hit, result.basis, book["modes"])
        if chosen is None:
            decisions.append({
                "status": "skip",
                "name": bot_name,
                "ehank": ehank,
                "category": category,
                "retire": retire,
                "why": _SKIP_NO_PRICE,
            })
            continue
        price, label = chosen
        planned.add(bot_name)
        decisions.append({
            "status": "add",
            "name": bot_name,
            "ehank": ehank,
            "category": category,
            "retire": retire,
            "price": price,
            "label": label or "",
        })
    groups = {}
    for row in decisions:
        if row["retire"]:
            groups.setdefault(row["retire"], []).append(row)
    retire_ready = {}
    for old, group in groups.items():
        retire_ready[old] = all(item["status"] == "add" for item in group) and _catalog_has(aligned, old)
    added = []
    skipped = []
    inplace = {}
    appended = {}
    for row in decisions:
        if row["status"] != "add":
            skipped.append({"name": row["name"], "ehank": row["ehank"], "why": row["why"]})
            continue
        added.append({
            "name": row["name"],
            "category": row["category"],
            "price": row["price"],
            "label": row["label"],
            "ehank": row["ehank"],
        })
        old = row["retire"]
        in_place = bool(old and retire_ready.get(old))
        if in_place:
            host = None
            for cat, rows in aligned.items():
                if isinstance(rows, dict) and old in rows:
                    host = cat
                    break
            host = host or row["category"]
            inplace.setdefault(host, {}).setdefault(old, []).append(row)
        else:
            appended.setdefault(row["category"], []).append(row)
    for cat, rows in list(aligned.items()):
        if not isinstance(rows, dict):
            continue
        cat_inplace = inplace.get(cat) or {}
        cat_append = appended.get(cat) or []
        if not cat_inplace and not cat_append:
            continue
        rebuilt = _place_additions(rows, cat_inplace, cat_append, labels)
        rows.clear()
        rows.update(rebuilt)
    retired = []
    retired_names = set()
    for old in _RETIRE_ORDER:
        if not retire_ready.get(old):
            continue
        replaced_by = [row["name"] for row in groups[old] if row["status"] == "add"]
        _delete_name(aligned, old)
        labels.pop(old, None)
        retired.append({"name": old, "replaced_by": replaced_by})
        retired_names.add(old)
    changed = [row for row in result.changed if row["name"] not in retired_names]
    labeled_only = [row for row in result.labeled_only if row["name"] not in retired_names]
    unmapped = [name for name in result.unmapped if name not in retired_names]
    return AlignResult(
        result.code,
        result.basis,
        aligned,
        labels,
        changed,
        labeled_only,
        unmapped,
        added,
        retired,
        skipped,
    )


def align(base_prices: dict, *, basis: str | None = None, repo: Path | None = None) -> AlignResult:
    """回傳新價目，不改傳入的 dict。對齊成功時依 CATALOG_SYNC 加入品項並移除被完整取代的舊品項；off 或讀不到價目表時品名維持原集合。"""
    if basis is None:
        if repo is None:
            repo = repo_root()
        basis = read_basis(repo)
    else:
        basis = resolve_basis(basis)
    if basis == "off":
        return _unchanged(base_prices, "off", "OFF")
    book = read_price_book()
    if book is None:
        return _unchanged(base_prices, basis, "FALLBACK")
    return _sync_catalog(_apply(base_prices, basis, book), book)


def format_report(result: AlignResult) -> str:
    lines = []
    if result.code == "FALLBACK":
        lines.append("讀不到價目表，沿用 prices.json")
    lines.append(f"基準 {result.basis}")
    lines.append(f"改價 {len(result.changed)}")
    for row in result.changed:
        suffix = f"（{row['label']}）" if row["label"] else ""
        lines.append(f"{row['name']} {row['old']}→{row['new']}{suffix}")
    lines.append(f"只加標示 {len(result.labeled_only)}")
    for row in result.labeled_only:
        lines.append(f"{row['name']} {row['price']}（{row['label']}）")
    lines.append(f"對不到 {len(result.unmapped)}")
    lines.extend(result.unmapped)
    lines.append(f"新增 {len(result.added)}")
    for row in result.added:
        suffix = f"（{row['label']}）" if row["label"] else ""
        lines.append(f"{row['category']}｜{row['name']} {row['price']}{suffix}")
    lines.append(f"移除 {len(result.retired)}")
    for row in result.retired:
        lines.append(f"{row['name']}→{'、'.join(row['replaced_by'])}")
    lines.append(f"未新增 {len(result.skipped)}")
    for row in result.skipped:
        lines.append(f"{row['name']}（{row['why']}）")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="ehank_prices.py")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--basis", choices=_BASIS_VALUES)
    args = parser.parse_args(argv)
    if not args.report:
        parser.print_help(sys.stderr)
        return 2
    repo = repo_root()
    base = json.loads((repo / "data" / "prices.json").read_text(encoding="utf-8"))
    result = align(base, basis=args.basis, repo=repo)
    sys.stdout.write(format_report(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
