#!/usr/bin/env python3
"""C5: assign the C4 "multi_lapsing" list to contact/control groups.

Usage:
  python c5_assign.py --candidates <csv> --test-id C5-2026-11 \
      --private-dir <dir> --repo-root <root> [--dry-run]

This script never sends anything. It only writes:
  * private CSVs under --private-dir (guarded by C4's check_private_dir),
  * one aggregate-only Markdown summary under <repo-root>/reports/crm.

Assignment rule (deterministic and verifiable):
  group = "contact" if int(sha256(f"{salt}:{cid}").hexdigest(), 16) % 2 == 0 else "control"
  salt  = test_id for k = 0, and f"{test_id}#{k}" for re-draws k = 1..50.
The first k whose groups pass the balance check is used and recorded.

Exit codes: 0 ok, 1 error, 2 refused.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import math
import os
import re
import statistics
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_REFUSED = 2

MAX_REDRAW = 50
MAX_SIZE_DIFF = 2
MAX_MEAN_REL_DIFF = 0.25

GROUP_CONTACT = "contact"
GROUP_CONTROL = "control"
GROUPS = (GROUP_CONTACT, GROUP_CONTROL)
GROUP_LABELS = {GROUP_CONTACT: "問候組", GROUP_CONTROL: "對照組"}

DEFAULT_EXPECTED_RULE = "multi_lapsing"

STAFF_HEADER_LINE = "# 只供店員手動問候用;未經店主核准問候文字前不要傳任何訊息;本檔含個資,勿外傳"
ASSIGNMENT_HEADER_LINE = "# C5 分組結果;含顧客編號,只放私人資料夾,勿外傳"
ASSIGNMENT_COLUMNS = ["test_id", "cid", "group", "assigned_on", "salt_k"]
STAFF_COLUMNS = ["cid", "name", "phone", "last_visit", "main_class", "contacted_at"]
REQUIRED_CANDIDATE_COLUMNS = (
    "cid", "name", "phone", "main_class", "visits",
    "last_visit", "days_since_last", "cycle_days",
)

TEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

SCRIPT_DIR = Path(__file__).resolve().parent
CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


class Refused(Exception):
    """A safety rule blocked the run (exit 2)."""


class InputError(Exception):
    """Bad input or environment (exit 1)."""


@dataclass(frozen=True)
class Candidate:
    cid: str
    name: str
    phone: str
    main_class: str
    visits: int
    last_visit: str
    days_since_last: int
    cycle_days: float
    rule: str = ""


@dataclass(frozen=True)
class BalanceInfo:
    size_diff: int
    visits_rel_diff: float
    days_rel_diff: float


@dataclass(frozen=True)
class AssignmentRow:
    test_id: str
    cid: str
    group: str
    assigned_on: dt.date
    salt_k: int | None


# --------------------------------------------------------------------------
# C4 reuse
# --------------------------------------------------------------------------
def _load_c4():
    """Import C4 (scripts/crm/repurchase_backtest.py) from this directory."""
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    import repurchase_backtest  # noqa: PLC0415
    return repurchase_backtest


def _norm(p: Path) -> Path:
    return Path(os.path.normcase(str(Path(p).resolve())))


def _inside(child: Path, parent: Path) -> bool:
    try:
        _norm(child).relative_to(_norm(parent))
        return True
    except ValueError:
        return False


def local_private_dir_check(private_dir: Path, repo_root: Path) -> None:
    """Mirror of C4's rule: inside the repo, only <repo>/data is allowed."""
    if _inside(private_dir, repo_root) and not _inside(private_dir, Path(repo_root) / "data"):
        raise Refused("私人資料夾在 repo 內但不在 <repo>/data 底下，拒絕寫入個資")


def guard_private_dir(private_dir: Path, repo_root: Path) -> None:
    """C4's check_private_dir first, then the local mirror (belt and braces)."""
    try:
        c4 = _load_c4()
    except Exception as exc:  # noqa: BLE001
        raise InputError(f"無法載入 C4 的 repurchase_backtest.py：{type(exc).__name__}") from None
    try:
        c4.check_private_dir(Path(private_dir).resolve(), Path(repo_root).resolve())
    except (Exception, SystemExit) as exc:  # noqa: BLE001
        raise Refused(f"C4 私人資料夾檢查拒絕：{exc}") from None
    local_private_dir_check(Path(private_dir), Path(repo_root))


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def validate_test_id(test_id: str) -> str:
    if not TEST_ID_RE.match(test_id or ""):
        raise InputError("test-id 只能用英數字、- 和 _（例如 C5-2026-11）")
    return test_id


def parse_iso_date(value: str, label: str) -> dt.date:
    try:
        return dt.date.fromisoformat((value or "").strip())
    except ValueError:
        raise InputError(f"{label} 必須是 YYYY-MM-DD") from None


def strip_comment_lines(text: str) -> str:
    """Drop leading lines that start with '#' (warning comments)."""
    while text.startswith("#"):
        nl = text.find("\n")
        if nl < 0:
            return ""
        text = text[nl + 1:]
    return text


def _dict_reader(path: Path) -> csv.DictReader:
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        raise InputError(f"{Path(path).name} 不是 UTF-8 編碼（若用 Excel 存檔，請存成 CSV UTF-8）") from None
    except OSError as exc:
        raise InputError(f"無法讀取 {Path(path).name}：{exc.strerror}") from None
    reader = csv.DictReader(io.StringIO(strip_comment_lines(text), newline=""))
    reader.fieldnames = [f.strip() for f in (reader.fieldnames or [])]
    return reader


def _number(value: str, field: str, idx: int, as_int: bool):
    s = (value or "").strip().lstrip("'")
    try:
        x = float(s)
    except ValueError:
        raise InputError(f"第 {idx} 筆資料的 {field} 不是數字") from None
    if not math.isfinite(x):
        raise InputError(f"第 {idx} 筆資料的 {field} 不是有限數字")
    return int(round(x)) if as_int else x


def csv_safe(value) -> str:
    s = "" if value is None else str(value)
    return "'" + s if s.startswith(CSV_FORMULA_PREFIXES) else s


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline="") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _mean(xs: Sequence[float]) -> float | None:
    return statistics.fmean(xs) if xs else None


def _median(xs: Sequence[float]) -> float | None:
    return statistics.median(xs) if xs else None


def fmt1(x: float | None) -> str:
    return "—" if x is None else f"{x:.1f}"


def fmt_rel(x: float) -> str:
    return "無法計算" if math.isinf(x) else f"{x * 100:.1f}%"


def md_cell(text: str) -> str:
    return str(text).replace("|", "／").replace("\n", " ").strip() or "(空白)"


# --------------------------------------------------------------------------
# Reading inputs
# --------------------------------------------------------------------------
def read_candidates(path: Path) -> list[Candidate]:
    reader = _dict_reader(path)
    missing = [c for c in REQUIRED_CANDIDATE_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise InputError(f"候選名單缺少欄位：{', '.join(missing)}")
    out: list[Candidate] = []
    seen: set[str] = set()
    for idx, row in enumerate(reader, start=1):
        cid = (row.get("cid") or "").strip()
        if not cid:
            raise InputError(f"第 {idx} 筆資料沒有 cid")
        if cid in seen:
            raise InputError(f"第 {idx} 筆資料的 cid 重複")
        seen.add(cid)
        out.append(Candidate(
            cid=cid,
            name=(row.get("name") or "").strip(),
            phone=(row.get("phone") or "").strip(),
            main_class=(row.get("main_class") or "").strip(),
            visits=_number(row.get("visits"), "visits", idx, True),
            last_visit=(row.get("last_visit") or "").strip(),
            days_since_last=_number(row.get("days_since_last"), "days_since_last", idx, True),
            cycle_days=_number(row.get("cycle_days"), "cycle_days", idx, False),
            rule=(row.get("rule") or "").strip(),
        ))
    return out


def read_assignment(path: Path) -> list[AssignmentRow]:
    reader = _dict_reader(path)
    for col in ("cid", "group", "assigned_on"):
        if col not in reader.fieldnames:
            raise InputError(f"分組檔缺少欄位：{col}")
    rows: list[AssignmentRow] = []
    seen: set[str] = set()
    for idx, row in enumerate(reader, start=1):
        cid = (row.get("cid") or "").strip()
        group = (row.get("group") or "").strip()
        if not cid:
            raise InputError(f"分組檔第 {idx} 筆沒有 cid")
        if cid in seen:
            raise InputError(f"分組檔第 {idx} 筆 cid 重複")
        if group not in GROUPS:
            raise InputError(f"分組檔第 {idx} 筆的 group 不是 contact/control")
        seen.add(cid)
        k_raw = (row.get("salt_k") or "").strip()
        rows.append(AssignmentRow(
            test_id=(row.get("test_id") or "").strip(),
            cid=cid,
            group=group,
            assigned_on=parse_iso_date(row.get("assigned_on") or "", f"分組檔第 {idx} 筆 assigned_on"),
            salt_k=int(k_raw) if k_raw.isdigit() else None,
        ))
    return rows


# --------------------------------------------------------------------------
# Assignment
# --------------------------------------------------------------------------
def salt_for(test_id: str, k: int) -> str:
    return test_id if k == 0 else f"{test_id}#{k}"


def assign_group(test_id: str, cid: str, k: int = 0) -> str:
    digest = hashlib.sha256(f"{salt_for(test_id, k)}:{cid}".encode("utf-8")).hexdigest()
    return GROUP_CONTACT if int(digest, 16) % 2 == 0 else GROUP_CONTROL


def draw_groups(cands: Iterable[Candidate], test_id: str, k: int) -> dict[str, str]:
    return {c.cid: assign_group(test_id, c.cid, k) for c in cands}


def rel_diff(a: float, b: float) -> float:
    """|a-b| relative to the smaller mean (the stricter choice)."""
    if a == b:
        return 0.0
    lo = min(abs(a), abs(b))
    return math.inf if lo == 0 else abs(a - b) / lo


def balance_check(cands: Sequence[Candidate], groups: Mapping[str, str]) -> tuple[bool, BalanceInfo]:
    a = [c for c in cands if groups[c.cid] == GROUP_CONTACT]
    b = [c for c in cands if groups[c.cid] == GROUP_CONTROL]
    size_diff = abs(len(a) - len(b))
    if not a or not b:
        return False, BalanceInfo(size_diff, math.inf, math.inf)
    v = rel_diff(_mean([c.visits for c in a]), _mean([c.visits for c in b]))
    d = rel_diff(_mean([c.days_since_last for c in a]), _mean([c.days_since_last for c in b]))
    ok = size_diff <= MAX_SIZE_DIFF and v <= MAX_MEAN_REL_DIFF and d <= MAX_MEAN_REL_DIFF
    return ok, BalanceInfo(size_diff, v, d)


def draw(cands: Sequence[Candidate], test_id: str,
         max_redraw: int = MAX_REDRAW) -> tuple[int, dict[str, str]]:
    """First k in 0..max_redraw whose groups pass the balance check."""
    for k in range(0, max_redraw + 1):
        groups = draw_groups(cands, test_id, k)
        ok, _ = balance_check(cands, groups)
        if ok:
            return k, groups
    raise Refused(f"k=0..{max_redraw} 都無法達到平衡條件，不分組（人數太少或差異太大）")


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------
def group_stats(cands: Sequence[Candidate], groups: Mapping[str, str]) -> dict:
    out = {}
    for g in GROUPS:
        m = [c for c in cands if groups[c.cid] == g]
        out[g] = {
            "n": len(m),
            "visits": (_mean([c.visits for c in m]), _median([c.visits for c in m])),
            "days": (_mean([c.days_since_last for c in m]), _median([c.days_since_last for c in m])),
            "cycle": (_mean([c.cycle_days for c in m]), _median([c.cycle_days for c in m])),
            "classes": Counter(c.main_class or "(未分類)" for c in m),
        }
    return out


def conclusion_line(n_contact: int, n_control: int, k: int) -> str:
    return (f"結論：已把 {n_contact + n_control} 人隨機分成問候組 {n_contact} 人、對照組 {n_control} 人"
            f"（重抽序號 k={k}），兩組基本特徵差距在設定範圍內；本程式沒有傳送任何訊息，"
            f"問候文字須經店主核准後才能由店員手動使用。")


def render_summary(test_id: str, assigned_on: dt.date, k: int, cands: Sequence[Candidate],
                   groups: Mapping[str, str], excluded: int = 0) -> str:
    st = group_stats(cands, groups)
    _, info = balance_check(cands, groups)
    a, b = st[GROUP_CONTACT], st[GROUP_CONTROL]
    lines = [
        conclusion_line(a["n"], b["n"], k),
        "",
        f"# C5 分組摘要（{test_id}）",
        "",
        f"- 分組日期：{assigned_on.isoformat()}",
        f"- 分組方式：SHA-256(\"{salt_for(test_id, k)}:<cid>\") 轉成整數後除以 2，餘 0 為問候組、餘 1 為對照組。",
        f"- 重抽序號 k={k}（k=0 用原始 test_id；k≥1 在 test_id 後加「#k」）。任何人都可用同樣輸入重算驗證。",
        f"- 平衡條件：兩組人數差 ≤ {MAX_SIZE_DIFF}；平均來店次數、平均距上次來店天數的相對差 ≤ {MAX_MEAN_REL_DIFF:.0%}（以較小的平均為分母）。",
        f"- 實際差距：人數差 {info.size_diff}；平均來店次數相對差 {fmt_rel(info.visits_rel_diff)}；"
        f"平均距上次來店天數相對差 {fmt_rel(info.days_rel_diff)}。",
    ]
    if excluded:
        lines.append(f"- 已排除先前批次分組過的人數：{excluded}")
    lines += [
        "- 本報告只有彙總數字，不含姓名、電話或顧客編號。本程式不會自動傳送任何訊息。",
        "",
        "## 各組人數",
        "",
        "| 組別 | 人數 |",
        "|---|---:|",
        f"| 問候組 | {a['n']} |",
        f"| 對照組 | {b['n']} |",
        "",
        "## 基本特徵",
        "",
        "| 指標 | 問候組平均 | 問候組中位數 | 對照組平均 | 對照組中位數 |",
        "|---|---:|---:|---:|---:|",
    ]
    for key, label in (("visits", "來店次數"), ("days", "距上次來店天數"), ("cycle", "個人週期（天）")):
        lines.append(f"| {label} | {fmt1(a[key][0])} | {fmt1(a[key][1])} | {fmt1(b[key][0])} | {fmt1(b[key][1])} |")
    lines += ["", "## 主要品類組成", "", "| 主要品類 | 問候組 | 對照組 |", "|---|---:|---:|"]
    total = a["classes"] + b["classes"]
    for cls, _ in sorted(total.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"| {md_cell(cls)} | {a['classes'].get(cls, 0)} | {b['classes'].get(cls, 0)} |")
    lines.append("")
    return "\n".join(lines)


def render_assignment_csv(test_id: str, assigned_on: dt.date, k: int,
                          cands: Sequence[Candidate], groups: Mapping[str, str]) -> str:
    buf = io.StringIO()
    buf.write(ASSIGNMENT_HEADER_LINE + "\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(ASSIGNMENT_COLUMNS)
    for c in sorted(cands, key=lambda x: x.cid):
        w.writerow([test_id, csv_safe(c.cid), groups[c.cid], assigned_on.isoformat(), k])
    return buf.getvalue()


def render_staff_csv(cands: Sequence[Candidate], groups: Mapping[str, str]) -> str:
    buf = io.StringIO()
    buf.write(STAFF_HEADER_LINE + "\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(STAFF_COLUMNS)
    for c in sorted(cands, key=lambda x: x.cid):
        if groups[c.cid] == GROUP_CONTACT:
            w.writerow([csv_safe(c.cid), csv_safe(c.name), csv_safe(c.phone),
                        csv_safe(c.last_visit), csv_safe(c.main_class), ""])
    return buf.getvalue()


def output_paths(test_id: str, private_dir: Path, repo_root: Path) -> dict[str, Path]:
    return {
        "assignment": Path(private_dir) / f"c5-{test_id}-assignment.csv",
        "staff": Path(private_dir) / f"c5-{test_id}-staff-contact-list.csv",
        "summary": Path(repo_root) / "reports" / "crm" / f"c5-{test_id}-assignment-summary.md",
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="C5 分組（不傳送任何訊息）")
    p.add_argument("--candidates", required=True, help="C4 私人候選名單 CSV")
    p.add_argument("--test-id", required=True, help="例如 C5-2026-11")
    p.add_argument("--private-dir", required=True, help="私人輸出資料夾")
    p.add_argument("--repo-root", required=True, help="repo 根目錄")
    p.add_argument("--assign-date", default=None, help="分組日期 YYYY-MM-DD（預設今天）")
    p.add_argument("--expected-rule", default=DEFAULT_EXPECTED_RULE,
                   help='候選名單 rule 欄必須等於此值；傳 "" 可停用檢查')
    p.add_argument("--exclude-assignment", action="append", default=[],
                   help="先前批次的分組檔，裡面的人不再分組（可重複）")
    p.add_argument("--dry-run", action="store_true", help="只計算並印出彙總，不寫任何檔案")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        test_id = validate_test_id(args.test_id)
        assigned_on = (parse_iso_date(args.assign_date, "--assign-date")
                       if args.assign_date else dt.date.today())
        repo_root = Path(args.repo_root).resolve()
        private_dir = Path(args.private_dir).resolve()
        guard_private_dir(private_dir, repo_root)

        cands = read_candidates(Path(args.candidates))
        if args.expected_rule:
            bad = sum(1 for c in cands if c.rule != args.expected_rule)
            if bad:
                raise Refused(f"候選名單有 {bad} 列的 rule 不是 {args.expected_rule}，拒絕分組")

        excluded_ids: set[str] = set()
        for prev in args.exclude_assignment:
            excluded_ids |= {r.cid for r in read_assignment(Path(prev))}
        before = len(cands)
        cands = [c for c in cands if c.cid not in excluded_ids]
        excluded = before - len(cands)
        if len(cands) < 2:
            raise Refused("可分組人數少於 2，不分組")

        k, groups = draw(cands, test_id)
        n_contact = sum(1 for g in groups.values() if g == GROUP_CONTACT)
        n_control = len(groups) - n_contact
        summary = render_summary(test_id, assigned_on, k, cands, groups, excluded)
        paths = output_paths(test_id, private_dir, repo_root)

        if args.dry_run:
            print(conclusion_line(n_contact, n_control, k))
            print(f"問候組 {n_contact} 人，對照組 {n_control} 人，k={k}，排除 {excluded} 人")
            print("（試跑：沒有寫入任何檔案）")
            return EXIT_OK

        existing = [p.name for p in paths.values() if p.exists()]
        if existing:
            raise Refused("輸出檔已存在，不覆寫（避免蓋掉店員填的紀錄）：" + ", ".join(existing))

        atomic_write_text(paths["assignment"],
                          render_assignment_csv(test_id, assigned_on, k, cands, groups), "utf-8-sig")
        atomic_write_text(paths["staff"], render_staff_csv(cands, groups), "utf-8-sig")
        atomic_write_text(paths["summary"], summary, "utf-8")

        print(conclusion_line(n_contact, n_control, k))
        print(f"問候組 {n_contact} 人，對照組 {n_control} 人，k={k}，排除 {excluded} 人")
        print(f"私人分組檔：{paths['assignment']}")
        print(f"私人店員名單：{paths['staff']}")
        print(f"公開摘要：{paths['summary']}")
        return EXIT_OK
    except Refused as exc:
        print(f"拒絕：{exc}", file=sys.stderr)
        return EXIT_REFUSED
    except InputError as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return EXIT_ERROR
    except OSError as exc:
        print(f"錯誤：檔案存取失敗（{exc.strerror}）", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())