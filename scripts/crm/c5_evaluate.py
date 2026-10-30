#!/usr/bin/env python3
"""C5: evaluate the check-in test (read-only).

Usage:
  python c5_evaluate.py --assignment <private csv> --test-id C5-2026-11 \
      --as-of YYYY-MM-DD [--source mdb|json --json f] [--staff-list <private csv>]

Primary outcome (pre-specified): return within 90 days after the assignment
date, contact group counted as assigned (intention-to-treat).
Secondary: 28/56-day windows and per-protocol (contacted_at filled).

Output: <repo-root>/reports/crm/c5-<test_id>-result-<as_of>.md (aggregates only).
Exit codes: 0 ok, 1 error, 2 refused.
"""
from __future__ import annotations

import argparse
import datetime as dt
import math
import sys
from dataclasses import dataclass
from fractions import Fraction
from math import comb
from pathlib import Path
from statistics import NormalDist
from typing import Callable, Mapping, Sequence

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import c5_assign as A  # noqa: E402

EXIT_OK, EXIT_ERROR, EXIT_REFUSED = A.EXIT_OK, A.EXIT_ERROR, A.EXIT_REFUSED

WINDOWS = (28, 56, 90)
PRIMARY_WINDOW = 90
ALPHA = 0.05
POWER = 0.80
ASSUMED_CONTROL_RATE = 0.554     # C4 backtest: multi_lapsing 90-day return rate
TARGET_DIFF = 0.10               # difference we would like to be able to detect
NOT_ELAPSED = "未滿期"
Z95 = NormalDist().inv_cdf(0.975)
DEFAULT_REPO_ROOT = SCRIPT_DIR.parents[1]


# --------------------------------------------------------------------------
# Statistics (stdlib only)
# --------------------------------------------------------------------------
def wilson_interval(x: int, n: int, z: float = Z95) -> tuple[float, float] | None:
    if n <= 0:
        return None
    p = x / n
    z2 = z * z
    denom = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return max(0.0, center - half), min(1.0, center + half)


def newcombe_interval(x1: int, n1: int, x2: int, n2: int,
                      z: float = Z95) -> tuple[float, float] | None:
    """Newcombe (1998) method 10 hybrid score interval for p1 - p2."""
    w1, w2 = wilson_interval(x1, n1, z), wilson_interval(x2, n2, z)
    if w1 is None or w2 is None:
        return None
    p1, p2 = x1 / n1, x2 / n2
    (l1, u1), (l2, u2) = w1, w2
    d = p1 - p2
    lo = d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)
    hi = d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)
    return max(-1.0, lo), min(1.0, hi)


def fisher_exact_two_sided(a: int, b: int, c: int, d: int) -> float:
    """Two-sided Fisher exact p for [[a, b], [c, d]] (sum of tables with P <= P_obs)."""
    if min(a, b, c, d) < 0:
        raise ValueError("cells must be non-negative")
    r1, r2, c1 = a + b, c + d, a + c
    n = r1 + r2
    if n == 0:
        return 1.0
    lo, hi = max(0, c1 - r2), min(r1, c1)

    def weight(x: int) -> int:
        return comb(r1, x) * comb(r2, c1 - x)

    obs = weight(a)
    total = sum(w for w in (weight(x) for x in range(lo, hi + 1)) if w <= obs)
    return min(1.0, float(Fraction(total, comb(n, c1))))


def _z(alpha: float, power: float) -> tuple[float, float]:
    nd = NormalDist()
    return nd.inv_cdf(1 - alpha / 2), nd.inv_cdf(power)


def detectable_difference(n1: int, n2: int, p0: float = ASSUMED_CONTROL_RATE,
                          alpha: float = ALPHA, power: float = POWER) -> float | None:
    """Smallest upward difference p1 - p0 detectable with the given n.

    Normal approximation for two independent proportions, two-sided, no
    continuity correction. None if not detectable even at p1 = 1.
    """
    if n1 <= 0 or n2 <= 0 or not 0 < p0 < 1:
        return None
    za, zb = _z(alpha, power)

    def margin(p1: float) -> float:
        pbar = (n1 * p1 + n2 * p0) / (n1 + n2)
        need = (za * math.sqrt(pbar * (1 - pbar) * (1 / n1 + 1 / n2))
                + zb * math.sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n2))
        return (p1 - p0) - need

    if margin(1.0) < 0:
        return None
    lo, hi = p0, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if margin(mid) >= 0:
            hi = mid
        else:
            lo = mid
    return hi - p0


def required_n_per_arm(p0: float = ASSUMED_CONTROL_RATE, diff: float = TARGET_DIFF,
                       alpha: float = ALPHA, power: float = POWER) -> int | None:
    p1 = p0 + diff
    if not (0 < p0 < 1 and 0 < p1 < 1) or diff == 0:
        return None
    za, zb = _z(alpha, power)
    pbar = (p0 + p1) / 2
    num = (za * math.sqrt(2 * pbar * (1 - pbar))
           + zb * math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) ** 2
    return math.ceil(num / diff ** 2)


# --------------------------------------------------------------------------
# Outcomes
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class ArmResult:
    n: int
    returned: int | None      # None when the window has not fully elapsed
    elapsed: bool
    window_end: dt.date | None

    @property
    def rate(self) -> float | None:
        if not self.elapsed or self.n == 0 or self.returned is None:
            return None
        return self.returned / self.n


@dataclass(frozen=True)
class Comparison:
    window: int
    contact: ArmResult
    control: ArmResult
    diff: float | None
    ci: tuple[float, float] | None
    p: float | None

    @property
    def elapsed(self) -> bool:
        return self.contact.elapsed and self.control.elapsed


@dataclass
class EvalResult:
    as_of: dt.date
    observed_until: dt.date
    assigned_min: dt.date
    assigned_max: dt.date
    n_contact: int
    n_control: int
    staff_given: bool
    n_contacted: int
    n_staff_outside: int
    no_history: int
    itt: dict
    pp: dict | None


@dataclass
class VisitData:
    dates_by_cid: dict
    data_last: dt.date | None
    normalize: Callable[[str], str]


def returned_within(dates: Sequence[dt.date], start: dt.date, window: int) -> bool:
    end = start + dt.timedelta(days=window)
    return any(start < d <= end for d in dates)


def arm_outcome(rows: Sequence[A.AssignmentRow], dates_by_cid: Mapping, window: int,
                observed_until: dt.date) -> ArmResult:
    if not rows:
        return ArmResult(0, None, False, None)
    end = max(r.assigned_on for r in rows) + dt.timedelta(days=window)
    if end > observed_until:
        return ArmResult(len(rows), None, False, end)
    hits = sum(1 for r in rows if returned_within(dates_by_cid.get(r.cid, ()), r.assigned_on, window))
    return ArmResult(len(rows), hits, True, end)


def compare(window: int, contact: ArmResult, control: ArmResult) -> Comparison:
    if not (contact.elapsed and control.elapsed) or contact.n == 0 or control.n == 0:
        return Comparison(window, contact, control, None, None, None)
    x1, n1, x2, n2 = contact.returned, contact.n, control.returned, control.n
    return Comparison(window, contact, control, x1 / n1 - x2 / n2,
                      newcombe_interval(x1, n1, x2, n2),
                      fisher_exact_two_sided(x1, n1 - x1, x2, n2 - x2))


def analyze(rows: Sequence[A.AssignmentRow], dates_by_cid: Mapping, as_of: dt.date,
            data_last: dt.date | None, contacted: set | None = None) -> EvalResult:
    observed_until = min(as_of, data_last) if data_last else dt.date.min
    contact_rows = [r for r in rows if r.group == A.GROUP_CONTACT]
    control_rows = [r for r in rows if r.group == A.GROUP_CONTROL]
    contact_ids = {r.cid for r in contact_rows}
    itt = {w: compare(w, arm_outcome(contact_rows, dates_by_cid, w, observed_until),
                      arm_outcome(control_rows, dates_by_cid, w, observed_until))
           for w in WINDOWS}
    pp = None
    n_contacted = n_outside = 0
    if contacted is not None:
        pp_rows = [r for r in contact_rows if r.cid in contacted]
        n_contacted = len(pp_rows)
        n_outside = len(contacted - contact_ids)
        pp = {w: compare(w, arm_outcome(pp_rows, dates_by_cid, w, observed_until),
                         arm_outcome(control_rows, dates_by_cid, w, observed_until))
              for w in WINDOWS}
    return EvalResult(
        as_of=as_of, observed_until=observed_until,
        assigned_min=min(r.assigned_on for r in rows), assigned_max=max(r.assigned_on for r in rows),
        n_contact=len(contact_rows), n_control=len(control_rows),
        staff_given=contacted is not None, n_contacted=n_contacted, n_staff_outside=n_outside,
        no_history=sum(1 for r in rows if not dates_by_cid.get(r.cid)),
        itt=itt, pp=pp)


# --------------------------------------------------------------------------
# Rendering (aggregates only)
# --------------------------------------------------------------------------
def pct(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:.1f}%"


def pp_str(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:+.1f} 個百分點"


def ci_str(ci: tuple[float, float] | None, signed: bool = False) -> str:
    if ci is None:
        return "—"
    f = (lambda v: f"{v * 100:+.1f}") if signed else (lambda v: f"{v * 100:.1f}")
    return f"{f(ci[0])} 到 {f(ci[1])}"


def arm_cell(arm: ArmResult) -> str:
    if not arm.elapsed:
        when = f"（{arm.window_end.isoformat()} 後才滿）" if arm.window_end else ""
        return f"{NOT_ELAPSED}{when}"
    return (f"{arm.returned}/{arm.n}（{pct(arm.rate)}；"
            f"95% CI {ci_str(wilson_interval(arm.returned, arm.n))}%）")


def conclusion_line(res: EvalResult) -> str:
    c = res.itt[PRIMARY_WINDOW]
    if not c.elapsed:
        end = c.contact.window_end or c.control.window_end
        when = f"（要到 {end.isoformat()} 且資料涵蓋到該日）" if end else ""
        return (f"結論：90 天主要指標{NOT_ELAPSED}{when}，目前不能下任何結論；"
                f"以下已滿期的窗口僅供參考。")
    if c.p is None:
        return "結論：資料不足（有一組人數為 0），無法比較。"
    a, b = c.contact.rate, c.control.rate
    detail = (f"問候組 90 天回訪率 {pct(a)}、對照組 {pct(b)}（差 {pp_str(c.diff)}，"
              f"95% 信賴區間 {ci_str(c.ci, True)} 個百分點，Fisher p={c.p:.3f}）")
    if c.p >= ALPHA:
        return (f"結論：差異不顯著／樣本太小：{detail}；不能說問候有效，也不能說無效。")
    direction = "高" if c.diff > 0 else "低"
    return (f"結論：在這一批隨機分組中，問候組 90 天回訪率比對照組{direction}，達 5% 顯著水準：{detail}；"
            f"這只是單一批小樣本，建議用下一批再確認後再決定是否擴大。")


def _window_table(title: str, comps: Mapping[int, Comparison], contact_label: str) -> list[str]:
    lines = [f"## {title}", "",
             f"| 窗口 | {contact_label} 回訪 | 對照組 回訪 | 差異 | 差異 95% CI（Newcombe，百分點） | Fisher 雙尾 p |",
             "|---|---|---|---:|---|---:|"]
    for w in WINDOWS:
        c = comps[w]
        label = f"{w} 天" + ("（主要）" if w == PRIMARY_WINDOW else "")
        if not c.elapsed:
            lines.append(f"| {label} | {arm_cell(c.contact)} | {arm_cell(c.control)} | {NOT_ELAPSED} | {NOT_ELAPSED} | {NOT_ELAPSED} |")
        else:
            p = "—" if c.p is None else f"{c.p:.4f}"
            lines.append(f"| {label} | {arm_cell(c.contact)} | {arm_cell(c.control)} | "
                         f"{pp_str(c.diff)} | {ci_str(c.ci, True)} | {p} |")
    lines.append("")
    return lines


def render_report(test_id: str, res: EvalResult) -> str:
    primary = res.itt[PRIMARY_WINDOW]
    lines = [conclusion_line(res), "", f"# C5 問候測試結果（{test_id}，評估日 {res.as_of.isoformat()}）", ""]
    assigned = (res.assigned_min.isoformat() if res.assigned_min == res.assigned_max
                else f"{res.assigned_min.isoformat()} 到 {res.assigned_max.isoformat()}")
    observed = "無資料" if res.observed_until == dt.date.min else res.observed_until.isoformat()
    lines += [
        f"- 分組日期：{assigned}；問候組 {res.n_contact} 人、對照組 {res.n_control} 人。",
        f"- 資料觀察到：{observed}（取評估日與資料最後一天較早者；窗口結束日超過此日即標「{NOT_ELAPSED}」）。",
        "- 回訪定義：分組日之後（不含當天）到窗口最後一天之間，有任何一次來店收件。",
        f"- 主要指標（事先指定）：{PRIMARY_WINDOW} 天回訪率，問候組以全部分到的人計算（意向治療，ITT）。"
        "28／56 天與「只算有問候到的人」都只是參考，不另做多重比較校正。",
        "- 本報告只有彙總數字，不含任何姓名、電話或顧客編號。",
        "",
    ]
    lines += _window_table("主要分析：意向治療（問候組＝全部分到的人）", res.itt, "問候組")
    lines += ["## 參考分析：只算有問候到的人（per-protocol）", ""]
    if not res.staff_given:
        lines += ["未提供店員名單（--staff-list），本節略過。", ""]
    else:
        lines += [f"- 店員名單中 contacted_at 有填的問候組人數：{res.n_contacted}／{res.n_contact}",
                  "- 注意：有接到問候的人可能本來就比較容易回來，這一節不是隨機比較，不能當作效果證據。"]
        if res.n_staff_outside:
            lines.append(f"- 店員名單中有 {res.n_staff_outside} 個編號不在問候組，已忽略，請店主查明。")
        lines.append("")
        lines += _window_table("per-protocol 各窗口", res.pp, "有問候到")
    if res.no_history:
        lines += [f"> 注意：有 {res.no_history} 位分組對象在資料中查無任何來店紀錄，可能是編號對不上，請先查明再採信結果。", ""]

    det = detectable_difference(res.n_contact, res.n_control)
    need = required_n_per_arm()
    lines += ["## 樣本數與檢定力", "",
              f"- 方法：兩獨立比例的常態近似，雙尾 α={ALPHA}、檢定力 {POWER:.0%}，不含連續性校正；"
              f"對照組回訪率假設為 C4 回測的 {ASSUMED_CONTROL_RATE:.1%}。"]
    if det is None:
        lines.append(f"- 以目前問候組 {res.n_contact} 人、對照組 {res.n_control} 人，即使問候組回訪率到 100% 也不一定測得出來。")
    else:
        lines.append(f"- 以目前問候組 {res.n_contact} 人、對照組 {res.n_control} 人，問候組要比對照組高約 "
                     f"{det * 100:.0f} 個百分點以上，才有八成把握測得出來；比這小的差距很可能被當成「不顯著」。")
    if need:
        lines.append(f"- 要穩定測出 {TARGET_DIFF * 100:.0f} 個百分點的差距，每組約需 {need} 人。")
    if need and min(res.n_contact, res.n_control) < need:
        lines += ["- 建議：每個月用新的 test_id（例如 C5-2026-12、C5-2027-01）各分一批，已分組過的人不要重複進入"
                  "（c5_assign.py --exclude-assignment），累積多批後再合併評估；合併時要依批次分層"
                  "（例如 Cochran–Mantel–Haenszel），不要把各批人數直接相加。"]
    if primary.elapsed and primary.p is not None and primary.p >= ALPHA:
        lines.append("- 差異不顯著時，不能說問候「造成」回訪增加或減少。")
    lines.append("")
    return "\n".join(lines)


def report_path(repo_root: Path, test_id: str, as_of: dt.date) -> Path:
    return Path(repo_root) / "reports" / "crm" / f"c5-{test_id}-result-{as_of.isoformat()}.md"


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------
def load_visit_dates(source: str, json_path: str | None, as_of: dt.date) -> VisitData:
    """Read visits through C4's read-only loaders; return dates only."""
    c4 = A._load_c4()
    raw = c4.load_data(source, json_path)
    built = c4.build_pieces(raw.deh_rows, raw.det_rows)
    pieces = built[0] if isinstance(built, tuple) else built
    visits = c4.group_visits(pieces, as_of=as_of)
    dates_by_cid: dict = {}
    last: dt.date | None = None
    for cid, vs in visits.items():
        ds = sorted({v.date for v in vs if v.date is not None and v.date <= as_of})
        if ds:
            dates_by_cid[c4.normalize_id(cid)] = ds
            last = ds[-1] if last is None or ds[-1] > last else last
    return VisitData(dates_by_cid, last, c4.normalize_id)


def read_staff_contacted(path: Path) -> set:
    """Read only the cid and contacted_at columns; return cids with contacted_at filled."""
    reader = A._dict_reader(Path(path))
    if "cid" not in reader.fieldnames or "contacted_at" not in reader.fieldnames:
        raise A.InputError("店員名單缺少 cid 或 contacted_at 欄位")
    out = set()
    for row in reader:
        cid = (row.get("cid") or "").strip().lstrip("'")
        if cid and (row.get("contacted_at") or "").strip():
            out.add(cid)
    return out


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="C5 評估（唯讀）")
    p.add_argument("--assignment", required=True, help="私人分組檔 CSV")
    p.add_argument("--test-id", required=True)
    p.add_argument("--as-of", required=True, help="評估日 YYYY-MM-DD")
    p.add_argument("--source", choices=("mdb", "json"), default="mdb")
    p.add_argument("--json", default=None, help="--source json 時的檔案")
    p.add_argument("--staff-list", default=None, help="私人店員名單（只讀 cid、contacted_at）")
    p.add_argument("--repo-root", default=str(DEFAULT_REPO_ROOT))
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        test_id = A.validate_test_id(args.test_id)
        as_of = A.parse_iso_date(args.as_of, "--as-of")
        if args.source == "json" and not args.json:
            raise A.InputError("--source json 需要 --json")
        rows = A.read_assignment(Path(args.assignment))
        if not rows:
            raise A.Refused("分組檔沒有任何人")
        ids = {r.test_id for r in rows if r.test_id}
        if ids and ids != {test_id}:
            raise A.Refused("分組檔的 test_id 與 --test-id 不符")

        data = load_visit_dates(args.source, args.json, as_of)
        norm = data.normalize
        rows = [A.AssignmentRow(r.test_id, norm(r.cid.lstrip("'")), r.group, r.assigned_on, r.salt_k)
                for r in rows]
        contacted = None
        if args.staff_list:
            contacted = {norm(c) for c in read_staff_contacted(Path(args.staff_list))}

        res = analyze(rows, data.dates_by_cid, as_of, data.data_last, contacted)
        text = render_report(test_id, res)
        out = report_path(Path(args.repo_root).resolve(), test_id, as_of)
        A.atomic_write_text(out, text, "utf-8")
        print(text.splitlines()[0])
        print(f"報告：{out}")
        return EXIT_OK
    except A.Refused as exc:
        print(f"拒絕：{exc}", file=sys.stderr)
        return EXIT_REFUSED
    except A.InputError as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return EXIT_ERROR
    except OSError as exc:
        print(f"錯誤：檔案存取失敗（{exc.strerror}）", file=sys.stderr)
        return EXIT_ERROR
    except Exception as exc:  # noqa: BLE001  (loader/driver failures; no row data printed)
        print(f"錯誤：讀取資料失敗（{type(exc).__name__}）", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())