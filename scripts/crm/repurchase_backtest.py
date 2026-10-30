#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C4: repurchase (CRM) segmentation and a rolling 6-month / 3-month backtest.

This tool is read-only and only produces lists. It never contacts customers.

Read-only data access
    Only single SELECT statements are run against the Access MDB, through the
    existing connector:
        sys.path.insert(0, r"C:/FXwash")
        from ai_engine import db_manager
        con = db_manager.get_conn()

Data keys
    Did = intake slip (order) id. One order holds many pieces; every row of a
          Did shares the same Cid and Indate.
    Dno = per-piece id.
    Pieces are deduplicated by the composite key (Did, Dno), normalised and
    stripped. When the same key is in both Det and Deh, the Deh row wins.
    Exact duplicates inside one table collapse to one row. Rows with a blank
    Dno are always kept.

Selectors (all evaluated at each month-end cutoff T on the same population:
customers with a visit in the 6 months before T)
    baseline       everyone in the population
    due            1 <= due score < 3 and days since last visit <= 365
    topk           top K by due score, K = size of the due list
    recent_30_90   last visit 30-90 days before T
    multi_lapsing  >= 3 visits and 0.8 x cycle <= days since last <= 2.0 x cycle
                   (cycle capped at 365 days; days since last <= 365)
    The contact CSV uses the rule with the highest mean lift (ties go to due).

Privacy
    The markdown report and stdout contain aggregates only.
    The per-customer contact list (cid, name, phone) is written ONLY as a CSV
    under --private-dir. If --private-dir is inside --repo-root, it must be
    inside <repo-root>/data (git-ignored).

Usage (from the repo root):
    python -B -X utf8 scripts\\crm\\repurchase_backtest.py ^
        --repo-root C:\\Users\\cyc39\\laundry-repo ^
        --private-dir C:\\Users\\cyc39\\laundry-repo\\data\\crm

    Offline run:
        --source json --json path\\to\\data.json   (add --dry-run to write nothing)

JSON format for offline runs and tests:
    {"pieces":     [{"did","dno","cid","indate","dclass","tpay","price","qty"}, ...],  # treated as Deh
     "det_pieces": [ same keys ... ],                                                  # optional, treated as Det
     "customers":  [{"cid","name","mtel","tel"}, ...]}
    "indate" may be ROC "YYY.MM.DD" or ISO "YYYY-MM-DD".

Exit codes: 0 = ok, 1 = error.
"""
from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import json
import math
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping, Sequence

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
EXIT_OK = 0
EXIT_ERROR = 1

ROC_OFFSET = 1911
BACKTEST_START = dt.date(2024, 4, 30)
ACTIVE_DAYS = 183           # active_6m: last visit in (T-183d, T]
DORMANT_DAYS = 365          # dormant_12m+: last visit <= T-365d
OUTCOME_DAYS = 90           # outcome window (T, T+90d]
CYCLE_CAP_DAYS = 365
DUE_MIN = 1.0
DUE_MAX = 3.0
DUE_MAX_DAYS_SINCE = 365
COMING_DUE_DAYS = 14
FALLBACK_CYCLE_DAYS = 90.0  # used only if no customer has >= 2 visits
FIRST_TIMER_BURN_IN_DAYS = 183
HOUSE_TOP_FRACTION = 0.005
HOUSE_MIN_VISITS_PER_YEAR = 150.0
UNCLASSIFIED = "(未分類)"
DEFAULT_BEDDING_KEYWORDS = ("寢具", "棉被", "被", "床", "毯", "枕", "bedding")
DEFAULT_PRIVATE_DIR = r"C:\Users\cyc39\laundry-repo\data\crm"
FXWASH_PATH = r"C:/FXwash"

# Pre-declared alternative selectors
RECENT_MIN_DAYS = 30
RECENT_MAX_DAYS = 90
MULTI_MIN_VISITS = 3
MULTI_MIN_RATIO = 0.8
MULTI_MAX_RATIO = 2.0
_EPS = 1e-9

SELECTOR_NAMES = ("baseline", "due", "topk", "recent_30_90", "multi_lapsing")
RULE_ORDER = ("due", "topk", "recent_30_90", "multi_lapsing")   # tie-break order: due first
SELECTOR_LABELS = {
    "baseline": "基準：近 6 個月有來店的全部客人",
    "due": "到期規則（1 ≤ 分數 < 3）",
    "topk": "分數前 K 名（K＝到期人數）",
    "recent_30_90": "最近一次來店在 30–90 天前",
    "multi_lapsing": "來店 ≥3 次且距上次為週期的 0.8–2.0 倍",
}

SEGMENTS = ("new", "repeat", "loyal")
ACTIVITIES = ("active_6m", "lapsed_6_12m", "dormant_12m+")
SEGMENT_LABELS = {
    "new": "新客（1 次）",
    "repeat": "回頭客（2–4 次）",
    "loyal": "常客（≥5 次）",
}
ACTIVITY_LABELS = {
    "active_6m": "近 6 個月有來",
    "lapsed_6_12m": "6–12 個月未來",
    "dormant_12m+": "12 個月以上未來",
}

CSV_WARNING = (
    "# do not send without owner approval / 未經店主同意請勿傳送任何訊息；"
    "本檔含個資，僅限店內使用，請勿上傳或分享"
)
NOTE_NO_RULE_BETTER = "回測沒有任何規則比全體基準準，名單僅供參考"
NOTE_NO_BACKTEST = "回測資料不足，無法比較規則，名單僅供參考"
CSV_COLUMNS = [
    "cid", "name", "phone", "segment", "main_class", "visits", "last_visit",
    "days_since_last", "cycle_days", "due_score", "reason", "rule",
]


# --------------------------------------------------------------------------
# Data classes
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Piece:
    did: str
    cid: str
    date: dt.date
    dclass: str
    value: float
    dno: str = ""


@dataclass
class Visit:
    date: dt.date
    value: float = 0.0
    classes: Counter = field(default_factory=Counter)


@dataclass
class RawData:
    deh_rows: list
    det_rows: list
    customers: dict          # cid -> {"name", "mtel", "tel"}
    source: str


@dataclass
class CustomerState:
    cid: str
    n_visits: int
    first_visit: dt.date
    last_visit: dt.date
    days_since: int
    segment: str
    activity: str
    main_class: str
    is_bedding: bool
    cycle: float
    cycle_source: str        # personal | default | bedding_default
    score: float | None
    due_now: bool
    coming_due: bool
    total_value: float


@dataclass
class Snapshot:
    as_of: dt.date
    states: list
    default_cycle: float
    bedding_cycle: float


@dataclass(frozen=True)
class SelectorMetrics:
    size: int
    hits: int
    precision: float | None
    recall: float | None
    lift: float | None


@dataclass(frozen=True)
class CutoffResult:
    cutoff: dt.date
    population: int
    returners: int
    base_rate: float | None
    baseline: SelectorMetrics
    due: SelectorMetrics
    topk: SelectorMetrics
    recent_30_90: SelectorMetrics
    multi_lapsing: SelectorMetrics


@dataclass(frozen=True)
class SelectorSummary:
    mean_size: float | None
    mean_hits: float | None
    mean_precision: float | None
    mean_recall: float | None
    mean_lift: float | None
    pooled_precision: float | None
    pooled_lift: float | None


@dataclass(frozen=True)
class CohortRow:
    month: str
    n: int
    returned: int
    rate: float | None
    early: bool


@dataclass
class FirstTimerResult:
    cohorts: list
    overall_n: int
    overall_returned: int
    overall_rate: float | None
    burn_in_until: dt.date | None


@dataclass
class Analysis:
    as_of: dt.date
    data_start: dt.date
    data_last: dt.date
    source: str
    piece_stats: dict
    pieces_after_as_of: int
    n_customers: int
    house_count: int
    house_visits: int
    cutoff_results: list
    summary: dict
    first_timer: FirstTimerResult
    current: dict
    contact_rule: str = "due"
    contact_rule_lift: float | None = None
    contact_beats_baseline: bool = False
    contact_list: list = field(default_factory=list)


# --------------------------------------------------------------------------
# Small pure helpers
# --------------------------------------------------------------------------
def parse_roc_date(value) -> dt.date | None:
    """Parse a ROC (Minguo) date 'YYY.MM.DD' -> date. Blank/malformed -> None."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    s = str(value).strip()
    if not s:
        return None
    parts = s.split(".")
    if len(parts) != 3:
        return None
    try:
        y, m, d = (int(p.strip()) for p in parts)
    except ValueError:
        return None
    if y <= 0:
        return None
    try:
        return dt.date(y + ROC_OFFSET, m, d)
    except ValueError:
        return None


def parse_any_date(value) -> dt.date | None:
    """ISO 'YYYY-MM-DD' or ROC 'YYY.MM.DD'. Blank/malformed -> None."""
    if value is None:
        return None
    if isinstance(value, dt.date):
        return parse_roc_date(value)
    s = str(value).strip()
    if not s:
        return None
    if "-" in s:
        try:
            return dt.date.fromisoformat(s[:10])
        except ValueError:
            return None
    return parse_roc_date(s)


def to_number(value) -> float:
    """Lenient numeric conversion; blank/invalid -> 0.0."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        out = float(value)
    else:
        try:
            out = float(str(value).strip().replace(",", ""))
        except ValueError:
            return 0.0
    return out if math.isfinite(out) else 0.0


def normalize_id(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def piece_value(tpay, price, qty) -> float:
    """Tpay if > 0, else Price * Qty (Qty blank/0 counts as 1)."""
    t = to_number(tpay)
    if t > 0:
        return t
    p = to_number(price)
    q = to_number(qty)
    if q <= 0:
        q = 1.0
    return max(p * q, 0.0)


def is_bedding_class(name: str, keywords: Sequence[str] = DEFAULT_BEDDING_KEYWORDS) -> bool:
    if not name:
        return False
    low = name.lower()
    return any(k and k.lower() in low for k in keywords)


def is_placeholder_cid(cid: str) -> bool:
    s = (cid or "").strip()
    return s == "" or set(s) == {"0"}


def segment_for_count(n: int) -> str | None:
    if n <= 0:
        return None
    if n == 1:
        return "new"
    if n <= 4:
        return "repeat"
    return "loyal"


def activity_for_days(days_since: int) -> str:
    if days_since < ACTIVE_DAYS:
        return "active_6m"
    if days_since < DORMANT_DAYS:
        return "lapsed_6_12m"
    return "dormant_12m+"


def personal_cycle(dates: Sequence[dt.date], default: float,
                   cap: int = CYCLE_CAP_DAYS) -> float | None:
    """dates: sorted, distinct visit dates. >=3 -> median gap; 2 -> the gap; 1 -> default."""
    n = len(dates)
    if n == 0:
        return None
    if n == 1:
        return float(default)
    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    c = gaps[0] if n == 2 else statistics.median(gaps)
    return float(min(max(c, 1), cap))


def due_score(days_since: int, cycle: float | None) -> float | None:
    if cycle is None or cycle <= 0:
        return None
    return days_since / cycle


def is_due_now(score: float | None, days_since: int) -> bool:
    return (score is not None and DUE_MIN <= score < DUE_MAX
            and days_since <= DUE_MAX_DAYS_SINCE)


def is_coming_due(days_since: int, cycle: float | None,
                  horizon: int = COMING_DUE_DAYS) -> bool:
    score = due_score(days_since, cycle)
    if score is None or score >= DUE_MIN or days_since > DUE_MAX_DAYS_SINCE:
        return False
    return (days_since + horizon) / cycle >= DUE_MIN


def is_recent_30_90(days_since: int) -> bool:
    """Last visit 30-90 days before T (both ends inclusive)."""
    return RECENT_MIN_DAYS <= days_since <= RECENT_MAX_DAYS


def is_multi_lapsing(n_visits: int, days_since: int, cycle: float | None) -> bool:
    """>= 3 visits and 0.8*cycle <= days_since <= 2.0*cycle (cycle capped at 365, days <= 365)."""
    if n_visits < MULTI_MIN_VISITS or cycle is None or cycle <= 0:
        return False
    if days_since > DUE_MAX_DAYS_SINCE:
        return False
    c = min(cycle, CYCLE_CAP_DAYS)
    return (MULTI_MIN_RATIO * c - _EPS) <= days_since <= (MULTI_MAX_RATIO * c + _EPS)


def main_class(visits: Iterable[Visit]) -> str:
    total = Counter()
    for v in visits:
        total.update(v.classes)
    if not total:
        return UNCLASSIFIED
    return sorted(total.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def month_end(year: int, month: int) -> dt.date:
    return dt.date(year, month, calendar.monthrange(year, month)[1])


def month_end_cutoffs(start: dt.date, last_date: dt.date,
                      outcome_days: int = OUTCOME_DAYS) -> list:
    """Month-end cutoffs T >= start whose window (T, T+outcome] is fully observed."""
    out = []
    y, m = start.year, start.month
    t = month_end(y, m)
    while t + dt.timedelta(days=outcome_days) <= last_date:
        if t >= start:
            out.append(t)
        m += 1
        if m > 12:
            m, y = 1, y + 1
        t = month_end(y, m)
    return out


def _mean(values: Iterable) -> float | None:
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def _ratio(num: float, den: float) -> float | None:
    return num / den if den else None


# --------------------------------------------------------------------------
# Pieces -> visits
# --------------------------------------------------------------------------
def dedupe_pieces(deh_rows: Sequence[Mapping], det_rows: Sequence[Mapping]):
    """Dedupe garment rows by the composite key (Did, Dno); the Deh row wins over Det.

    Did = intake slip (order) id, Dno = per-piece id; both normalised and stripped.
    Rows sharing (Did, Dno) inside one table (exact duplicates) collapse to one row.
    Rows with a blank Dno are always kept.
    Returns (rows, number_of_rows_removed).
    """
    merged: dict = {}
    total = 0
    for src, rows in (("det", det_rows), ("deh", deh_rows)):
        for i, row in enumerate(rows):
            total += 1
            did = normalize_id(row.get("did"))
            dno = normalize_id(row.get("dno"))
            key = ("piece", did, dno) if dno else ("row", src, i)
            merged[key] = row
    return list(merged.values()), total - len(merged)


def build_pieces(deh_rows: Sequence[Mapping], det_rows: Sequence[Mapping]):
    rows, dups = dedupe_pieces(deh_rows, det_rows)
    pieces, bad_dates = [], 0
    for row in rows:
        d = parse_any_date(row.get("indate"))
        if d is None:
            bad_dates += 1
            continue
        pieces.append(Piece(
            did=normalize_id(row.get("did")),
            cid=normalize_id(row.get("cid")),
            date=d,
            dclass=(str(row.get("dclass") or "").strip() or UNCLASSIFIED),
            value=piece_value(row.get("tpay"), row.get("price"), row.get("qty")),
            dno=normalize_id(row.get("dno")),
        ))
    stats = {
        "rows_deh": len(deh_rows), "rows_det": len(det_rows),
        "duplicates_removed": dups, "bad_dates": bad_dates, "pieces": len(pieces),
    }
    return pieces, stats


def group_visits(pieces: Iterable[Piece], as_of: dt.date | None = None) -> dict:
    """Visit = distinct (cid, intake date). Returns cid -> visits sorted by date."""
    acc: dict = defaultdict(dict)
    for p in pieces:
        if as_of is not None and p.date > as_of:
            continue
        v = acc[p.cid].get(p.date)
        if v is None:
            v = Visit(date=p.date)
            acc[p.cid][p.date] = v
        v.value += p.value
        v.classes[p.dclass or UNCLASSIFIED] += 1
    return {cid: sorted(d.values(), key=lambda x: x.date) for cid, d in acc.items()}


def detect_house_accounts(visits_by_cid: Mapping, top_fraction: float = HOUSE_TOP_FRACTION,
                          min_per_year: float = HOUSE_MIN_VISITS_PER_YEAR) -> set:
    """Placeholder ids, plus accounts in the top fraction by visits AND > min_per_year."""
    house = {c for c in visits_by_cid if is_placeholder_cid(c)}
    ranked = sorted(((len(v), c) for c, v in visits_by_cid.items() if c not in house and v),
                    key=lambda t: (-t[0], t[1]))
    if not ranked:
        return house
    k = max(1, math.ceil(len(ranked) * top_fraction))
    for n, c in ranked[:k]:
        vs = visits_by_cid[c]
        span_days = (vs[-1].date - vs[0].date).days + 1
        years = max(span_days / 365.25, 1.0)
        if n / years > min_per_year:
            house.add(c)
    return house


# --------------------------------------------------------------------------
# Snapshot at T
# --------------------------------------------------------------------------
def compute_default_cycles(dates_by_cid: Mapping, main_by_cid: Mapping,
                           bedding_keywords: Sequence[str] = DEFAULT_BEDDING_KEYWORDS):
    """(general default, bedding default) = median personal cycle of >=2-visit customers."""
    general, bedding = [], []
    for cid, ds in dates_by_cid.items():
        if len(ds) >= 2:
            c = personal_cycle(ds, 0.0)
            general.append(c)
            if is_bedding_class(main_by_cid.get(cid, ""), bedding_keywords):
                bedding.append(c)
    g = float(statistics.median(general)) if general else FALLBACK_CYCLE_DAYS
    b = float(statistics.median(bedding)) if bedding else g
    return g, b


def build_snapshot(visits_by_cid: Mapping, as_of: dt.date, exclude=frozenset(),
                   bedding_keywords: Sequence[str] = DEFAULT_BEDDING_KEYWORDS) -> Snapshot:
    hist = {}
    for cid, vs in visits_by_cid.items():
        if cid in exclude:
            continue
        upto = [v for v in vs if v.date <= as_of]
        if upto:
            hist[cid] = upto
    mains = {c: main_class(vs) for c, vs in hist.items()}
    dates = {c: [v.date for v in vs] for c, vs in hist.items()}
    gen, bed = compute_default_cycles(dates, mains, bedding_keywords)
    states = []
    for cid in sorted(hist):
        vs, ds = hist[cid], dates[cid]
        bedding = is_bedding_class(mains[cid], bedding_keywords)
        cyc = personal_cycle(ds, bed if bedding else gen)
        if len(ds) >= 2:
            source = "personal"
        else:
            source = "bedding_default" if bedding else "default"
        days = (as_of - ds[-1]).days
        score = due_score(days, cyc)
        states.append(CustomerState(
            cid=cid, n_visits=len(ds), first_visit=ds[0], last_visit=ds[-1],
            days_since=days, segment=segment_for_count(len(ds)),
            activity=activity_for_days(days), main_class=mains[cid], is_bedding=bedding,
            cycle=cyc, cycle_source=source, score=score,
            due_now=is_due_now(score, days), coming_due=is_coming_due(days, cyc),
            total_value=sum(v.value for v in vs),
        ))
    return Snapshot(as_of=as_of, states=states, default_cycle=gen, bedding_cycle=bed)


# --------------------------------------------------------------------------
# Backtest
# --------------------------------------------------------------------------
def select_top_k(states: Sequence[CustomerState], k: int) -> list:
    if k <= 0:
        return []
    ranked = sorted(states, key=lambda s: (
        -(s.score if s.score is not None else -math.inf), -s.days_since, s.cid))
    return ranked[:k]


def select_recent_30_90(pop: Sequence[CustomerState]) -> list:
    return [s for s in pop if is_recent_30_90(s.days_since)]


def select_multi_lapsing(pop: Sequence[CustomerState]) -> list:
    return [s for s in pop if is_multi_lapsing(s.n_visits, s.days_since, s.cycle)]


def selector_metrics(selected: Sequence[CustomerState], returned: set,
                     n_returners: int, base_rate: float | None) -> SelectorMetrics:
    size = len(selected)
    hits = sum(1 for s in selected if s.cid in returned)
    precision = _ratio(hits, size)
    recall = _ratio(hits, n_returners)
    lift = (precision / base_rate) if (precision is not None and base_rate) else None
    return SelectorMetrics(size, hits, precision, recall, lift)


def evaluate_cutoff(visits_by_cid: Mapping, cutoff: dt.date, exclude=frozenset(),
                    bedding_keywords: Sequence[str] = DEFAULT_BEDDING_KEYWORDS,
                    outcome_days: int = OUTCOME_DAYS,
                    active_days: int = ACTIVE_DAYS) -> CutoffResult:
    snap = build_snapshot(visits_by_cid, cutoff, exclude, bedding_keywords)
    pop = [s for s in snap.states if s.days_since < active_days]
    end = cutoff + dt.timedelta(days=outcome_days)
    returned = {s.cid for s in pop
                if any(cutoff < v.date <= end for v in visits_by_cid[s.cid])}
    n_ret = len(returned)
    base = _ratio(n_ret, len(pop))
    due = [s for s in pop if s.due_now]
    topk = select_top_k(pop, len(due))
    return CutoffResult(
        cutoff=cutoff, population=len(pop), returners=n_ret, base_rate=base,
        baseline=selector_metrics(pop, returned, n_ret, base),
        due=selector_metrics(due, returned, n_ret, base),
        topk=selector_metrics(topk, returned, n_ret, base),
        recent_30_90=selector_metrics(select_recent_30_90(pop), returned, n_ret, base),
        multi_lapsing=selector_metrics(select_multi_lapsing(pop), returned, n_ret, base),
    )


def summarize_backtest(results: Sequence[CutoffResult]) -> dict:
    total_pop = sum(r.population for r in results)
    total_ret = sum(r.returners for r in results)
    pooled_base = _ratio(total_ret, total_pop)
    out = {
        "n_cutoffs": len(results),
        "mean_base_rate": _mean(r.base_rate for r in results),
        "pooled_base_rate": pooled_base,
    }
    for name in SELECTOR_NAMES:
        ms = [getattr(r, name) for r in results]
        size = sum(m.size for m in ms)
        hits = sum(m.hits for m in ms)
        pp = _ratio(hits, size)
        out[name] = SelectorSummary(
            mean_size=_mean(m.size for m in ms),
            mean_hits=_mean(m.hits for m in ms),
            mean_precision=_mean(m.precision for m in ms),
            mean_recall=_mean(m.recall for m in ms),
            mean_lift=_mean(m.lift for m in ms),
            pooled_precision=pp,
            pooled_lift=(pp / pooled_base) if (pp is not None and pooled_base) else None,
        )
    return out


def choose_best_selector(summary: Mapping) -> tuple:
    """Rule with the highest mean lift among RULE_ORDER; ties (and no data) go to 'due'.

    Returns (rule_name, mean_lift_or_None).
    """
    best, best_lift = "due", None
    for name in RULE_ORDER:
        m = summary.get(name)
        lift = None if m is None else m.mean_lift
        if lift is None:
            continue
        if best_lift is None or lift > best_lift:
            best, best_lift = name, lift
    return best, best_lift


def first_timer_return(visits_by_cid: Mapping, last_date: dt.date, exclude=frozenset(),
                       outcome_days: int = OUTCOME_DAYS, data_start: dt.date | None = None,
                       burn_in_days: int = FIRST_TIMER_BURN_IN_DAYS) -> FirstTimerResult:
    """Share of customers who return within outcome_days of their first visit.

    Only first visits whose window is complete (first + outcome <= last_date) count.
    First visits before data_start + burn_in_days are shown but excluded from the
    overall rate (they may be older customers seen first at the start of the data).
    """
    burn_until = data_start + dt.timedelta(days=burn_in_days) if data_start else None
    td = dt.timedelta(days=outcome_days)
    agg: dict = defaultdict(lambda: [0, 0, False])
    on = orr = 0
    for cid, vs in visits_by_cid.items():
        if cid in exclude:
            continue
        dates = [v.date for v in vs if v.date <= last_date]
        if not dates:
            continue
        first = dates[0]
        if first + td > last_date:
            continue
        returned = any(first < d <= first + td for d in dates[1:])
        row = agg[f"{first.year:04d}-{first.month:02d}"]
        row[0] += 1
        row[1] += int(returned)
        if burn_until is not None and first < burn_until:
            row[2] = True
        else:
            on += 1
            orr += int(returned)
    cohorts = [CohortRow(k, n, r, _ratio(r, n), e) for k, (n, r, e) in sorted(agg.items())]
    return FirstTimerResult(cohorts, on, orr, _ratio(orr, on), burn_until)


# --------------------------------------------------------------------------
# Current outputs
# --------------------------------------------------------------------------
def last_n_months(as_of: dt.date, n: int = 24) -> list:
    y, m = as_of.year, as_of.month
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(out))


def visit_count_bucket(n: int) -> str:
    if n <= 4:
        return str(n)
    if n <= 9:
        return "5-9"
    if n <= 19:
        return "10-19"
    return "20+"


VISIT_BUCKETS = ("1", "2", "3", "4", "5-9", "10-19", "20+")


def _by_score(states: Iterable[CustomerState]) -> list:
    return sorted(states, key=lambda s: (-(s.score or 0.0), s.cid))


def contact_list_for(snapshot: Snapshot, rule: str) -> list:
    """Current contact list for a rule.

    due: due now or coming due within 14 days (all customers; unchanged from round 1).
    Other rules: applied to customers active in the last 6 months, as in the backtest.
    """
    states = snapshot.states
    if rule == "due":
        return _by_score(s for s in states if s.due_now or s.coming_due)
    pop = [s for s in states if s.days_since < ACTIVE_DAYS]
    if rule == "topk":
        return select_top_k(pop, sum(1 for s in pop if s.due_now))
    if rule == "recent_30_90":
        return _by_score(select_recent_30_90(pop))
    if rule == "multi_lapsing":
        return _by_score(select_multi_lapsing(pop))
    raise ValueError(f"unknown rule: {rule}")


def current_summary(visits_by_cid: Mapping, as_of: dt.date, exclude=frozenset(),
                    bedding_keywords: Sequence[str] = DEFAULT_BEDDING_KEYWORDS) -> dict:
    snap = build_snapshot(visits_by_cid, as_of, exclude, bedding_keywords)
    states = snap.states
    seg_act = {s: {a: 0 for a in ACTIVITIES} for s in SEGMENTS}
    val_sum = {s: 0.0 for s in SEGMENTS}
    val_n = {s: 0 for s in SEGMENTS}
    dist = Counter()
    for st in states:
        seg_act[st.segment][st.activity] += 1
        val_sum[st.segment] += st.total_value
        val_n[st.segment] += st.n_visits
        dist[visit_count_bucket(st.n_visits)] += 1
    tot_n = sum(val_n.values())
    avg_value = {s: (int(round(val_sum[s] / val_n[s])) if val_n[s] else None) for s in SEGMENTS}
    avg_value["all"] = int(round(sum(val_sum.values()) / tot_n)) if tot_n else None

    personal = [st for st in states if st.cycle_source == "personal"]
    cycle_rows = [("全部（來店 ≥2 次）", len(personal),
                   float(statistics.median([s.cycle for s in personal])) if personal else None)]
    by_class: dict = defaultdict(list)
    for st in personal:
        by_class[st.main_class].append(st.cycle)
    for cls, cs in sorted(by_class.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        cycle_rows.append((f"主要品項：{cls}", len(cs), float(statistics.median(cs))))
    n_bed = sum(1 for s in personal if s.is_bedding)
    cycle_rows.append(("寢具為主客人（單次客預設）", n_bed, snap.bedding_cycle))
    cycle_rows.append(("單次客一般預設", len(personal), snap.default_cycle))

    month_counter = Counter()
    for cid, vs in visits_by_cid.items():
        if cid in exclude:
            continue
        for v in vs:
            if v.date <= as_of:
                month_counter[(v.date.year, v.date.month)] += 1
    monthly = []
    for (y, m) in last_n_months(as_of, 24):
        partial = (y == as_of.year and m == as_of.month and as_of != month_end(y, m))
        monthly.append((f"{y:04d}-{m:02d}", month_counter.get((y, m), 0), partial))

    candidates = _by_score(s for s in states if s.due_now or s.coming_due)
    return {
        "snapshot": snap,
        "seg_act": seg_act,
        "avg_value": avg_value,
        "cycle_rows": cycle_rows,
        "visit_dist": [(b, dist.get(b, 0)) for b in VISIT_BUCKETS],
        "monthly": monthly,
        "candidates": candidates,
        "n_due": sum(1 for s in states if s.due_now),
        "n_coming": sum(1 for s in states if s.coming_due),
    }


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------
def run_analysis(raw: RawData, as_of: dt.date | None = None,
                 bedding_keywords: Sequence[str] = DEFAULT_BEDDING_KEYWORDS,
                 backtest_start: dt.date = BACKTEST_START) -> Analysis:
    pieces, pstats = build_pieces(raw.deh_rows, raw.det_rows)
    if not pieces:
        raise ValueError("no garment rows with a valid intake date")
    data_start = min(p.date for p in pieces)
    data_max = max(p.date for p in pieces)
    if as_of is None:
        as_of = data_max
    if as_of < data_start:
        raise ValueError("--as-of is earlier than the first intake date")
    after = sum(1 for p in pieces if p.date > as_of)
    visits = group_visits(pieces, as_of)
    data_last = max(v.date for vs in visits.values() for v in vs)
    house = detect_house_accounts(visits)
    house_visits = sum(len(visits[c]) for c in house)
    cutoffs = month_end_cutoffs(backtest_start, data_last)
    results = [evaluate_cutoff(visits, t, house, bedding_keywords) for t in cutoffs]
    summary = summarize_backtest(results)
    current = current_summary(visits, as_of, house, bedding_keywords)
    rule, lift = choose_best_selector(summary)
    return Analysis(
        as_of=as_of, data_start=data_start, data_last=data_last, source=raw.source,
        piece_stats=pstats, pieces_after_as_of=after,
        n_customers=len(current["snapshot"].states),
        house_count=len(house), house_visits=house_visits,
        cutoff_results=results, summary=summary,
        first_timer=first_timer_return(visits, data_last, house, data_start=data_start),
        current=current,
        contact_rule=rule,
        contact_rule_lift=lift,
        contact_beats_baseline=(lift is not None and lift > 1.0),
        contact_list=contact_list_for(current["snapshot"], rule),
    )


def contact_note(a: Analysis) -> str | None:
    if a.summary["n_cutoffs"] == 0:
        return NOTE_NO_BACKTEST
    if not a.contact_beats_baseline:
        return NOTE_NO_RULE_BETTER
    return None


# --------------------------------------------------------------------------
# Formatting (aggregates only)
# --------------------------------------------------------------------------
def fmt_pct(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:.1f}%"


def fmt_x(x: float | None) -> str:
    return "—" if x is None else f"{x:.2f}"


def fmt_num(x: float | None, nd: int = 1) -> str:
    return "—" if x is None else f"{x:.{nd}f}"


def _md(text: str) -> str:
    return str(text).replace("|", "/").replace("\n", " ")


def backtest_conclusion(s: Mapping, n_due: int, n_coming: int) -> str:
    if s["n_cutoffs"] == 0:
        return (f"結論：資料期間不足（截止日後需滿 {OUTCOME_DAYS} 天），本次無法完成回測；"
                f"目前「已到回訪週期」{n_due} 人、14 天內到期 {n_coming} 人。")
    best, best_lift = choose_best_selector(s)
    b, d = s["baseline"], s["due"]
    label = SELECTOR_LABELS[best]
    parts = [f"結論：{s['n_cutoffs']} 個月份滾動回測中，"]
    if best_lift is None:
        parts.append("所有規則的名單在各月皆為空，無法比較；")
    else:
        bm = s[best]
        parts.append(f"依平均提升，回測最好的規則是「{label}」（平均命中率 {fmt_pct(bm.mean_precision)}、"
                     f"平均提升 {fmt_x(bm.mean_lift)} 倍；全體基準平均命中率 {fmt_pct(b.mean_precision)}）。")
    if d.mean_lift is None:
        parts.append("「到期規則」各月名單皆為空，無法評估。")
    elif d.mean_lift < 1.0:
        parts.append(f"「到期規則」平均命中率 {fmt_pct(d.mean_precision)}、平均提升 {fmt_x(d.mean_lift)} 倍，"
                     "並沒有比直接聯絡「近 6 個月有來店的全部客人」更準。")
    elif d.mean_lift == 1.0:
        parts.append(f"「到期規則」平均提升 {fmt_x(d.mean_lift)} 倍，與聯絡「近 6 個月有來店的全部客人」相同。")
    else:
        parts.append(f"「到期規則」平均命中率 {fmt_pct(d.mean_precision)}、平均提升 {fmt_x(d.mean_lift)} 倍，"
                     "高於全體基準。")
    if best_lift is None or best_lift <= 1.0:
        parts.append(f"{NOTE_NO_RULE_BETTER}。")
    parts.append(f"聯絡名單採用「{label}」。")
    return "".join(parts)


def conclusion_sentence(a: Analysis) -> str:
    return backtest_conclusion(a.summary, a.current["n_due"], a.current["n_coming"])


def render_report(a: Analysis) -> str:
    s, cur, ft = a.summary, a.current, a.first_timer
    ps = a.piece_stats
    L = [conclusion_sentence(a), ""]
    L.append(f"# 回購分群與回測報告（資料截至 {a.as_of.isoformat()}）")
    L.append("")
    L.append(f"- 資料期間：收件日 {a.data_start.isoformat()} ～ {a.data_last.isoformat()}"
             f"（原始為民國日期，已換算西元）；資料來源：{a.source}（僅唯讀查詢）。")
    L.append(f"- 分析客數：{a.n_customers} 位；已排除公司／散客／內部帳號 {a.house_count} 個"
             f"（合計 {a.house_visits} 次來店，另計不列入分析）。")
    L.append(f"- 衣物件數：去重後 {ps['pieces']} 件（以「收件單號＋單件編號」去重，現行與歷史重複或完全相同的列 "
             f"{ps['duplicates_removed']} 列已合併；收件日無法辨識 {ps['bad_dates']} 件已略過；"
             f"晚於截止日 {a.pieces_after_as_of} 件未計）。")
    L.append("- 一次「來店」＝同一位客人同一收件日；週期＝該客人相鄰兩次來店間隔的中位數（上限 365 天）。")
    L.append("- 以下皆為歷史資料的相關性觀察，不代表因果；名單命中率不等於聯絡後的實際成效。")
    L.append("- 本報告只含彙總數字，不含任何客戶編號、姓名或電話；本工具未傳送任何訊息給客戶。")
    L.append("")

    L.append("## 1. 回測平均：各名單規則比較（母體＝截止日前 6 個月有來店的客人，結果＝之後 90 天內是否回店）")
    L.append("")
    if s["n_cutoffs"] == 0:
        L.append("資料期間不足，無完整的 90 天觀察窗，無法回測。")
    else:
        best, _ = choose_best_selector(s)
        L.append(f"回測月份：{s['n_cutoffs']} 個（{a.cutoff_results[0].cutoff.isoformat()} ～ "
                 f"{a.cutoff_results[-1].cutoff.isoformat()} 各月月底）；平均基準回店率 "
                 f"{fmt_pct(s['mean_base_rate'])}。")
        L.append("")
        L.append("| 名單規則 | 平均人數 | 平均命中 | 平均命中率 | 合併命中率 | 平均召回率 | 平均提升（倍） |")
        L.append("|---|---:|---:|---:|---:|---:|---:|")
        for key in SELECTOR_NAMES:
            m = s[key]
            label = SELECTOR_LABELS[key] + ("（平均提升最高）" if key == best and key != "baseline"
                                            and m.mean_lift is not None else "")
            L.append(f"| {label} | {fmt_num(m.mean_size)} | {fmt_num(m.mean_hits)} | "
                     f"{fmt_pct(m.mean_precision)} | {fmt_pct(m.pooled_precision)} | "
                     f"{fmt_pct(m.mean_recall)} | {fmt_x(m.mean_lift)} |")
        L.append("")
        L.append("兩條替代規則是在看到「到期規則」不如基準後才加入，但門檻在第一次跑之前就寫定，沒有依回測結果調整；名單人數為 0 的月份不計入該規則的平均命中率與平均提升。")
    L.append("")

    L.append("## 2. 各月回測明細")
    L.append("")
    if a.cutoff_results:
        L.append("| 截止日 | 活躍客 | 90 天內回店 | 基準回店率 | 到期名單 | 命中 | 命中率 | 召回率 | 提升 "
                 "| 前 K 名命中率 | 前 K 名提升 | 30–90 天 人數 | 30–90 天 提升 | 多次逾期 人數 | 多次逾期 提升 |")
        L.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        for r in a.cutoff_results:
            L.append(f"| {r.cutoff.isoformat()} | {r.population} | {r.returners} | {fmt_pct(r.base_rate)} | "
                     f"{r.due.size} | {r.due.hits} | {fmt_pct(r.due.precision)} | {fmt_pct(r.due.recall)} | "
                     f"{fmt_x(r.due.lift)} | {fmt_pct(r.topk.precision)} | {fmt_x(r.topk.lift)} | "
                     f"{r.recent_30_90.size} | {fmt_x(r.recent_30_90.lift)} | "
                     f"{r.multi_lapsing.size} | {fmt_x(r.multi_lapsing.lift)} |")
    else:
        L.append("（無）")
    L.append("")

    L.append("## 3. 新客 90 天回店率（依首次來店月份，最近 12 個完整月份）")
    L.append("")
    L.append(f"整體：{ft.overall_n} 位新客中 {ft.overall_returned} 位在首次來店後 90 天內回店，"
             f"回店率 {fmt_pct(ft.overall_rate)}"
             + (f"（不含 {ft.burn_in_until.isoformat()} 前首次出現者，因可能是資料起始前的舊客）。"
                if ft.burn_in_until else "。"))
    L.append("")
    if ft.cohorts:
        L.append("| 首次來店月份 | 新客數 | 90 天內回店 | 回店率 |")
        L.append("|---|---:|---:|---:|")
        for c in ft.cohorts[-12:]:
            mark = "（資料初期）" if c.early else ""
            L.append(f"| {c.month}{mark} | {c.n} | {c.returned} | {fmt_pct(c.rate)} |")
    L.append("")

    L.append(f"## 4. 目前客群（截至 {a.as_of.isoformat()}）")
    L.append("")
    L.append("| 分層 | " + " | ".join(ACTIVITY_LABELS[x] for x in ACTIVITIES) + " | 合計 | 平均每次消費（元） |")
    L.append("|---|---:|---:|---:|---:|---:|")
    col_tot = {x: 0 for x in ACTIVITIES}
    for seg in SEGMENTS:
        row = cur["seg_act"][seg]
        for x in ACTIVITIES:
            col_tot[x] += row[x]
        av = cur["avg_value"][seg]
        L.append(f"| {SEGMENT_LABELS[seg]} | " + " | ".join(str(row[x]) for x in ACTIVITIES)
                 + f" | {sum(row.values())} | {'—' if av is None else av} |")
    av = cur["avg_value"]["all"]
    L.append("| 合計 | " + " | ".join(str(col_tot[x]) for x in ACTIVITIES)
             + f" | {sum(col_tot.values())} | {'—' if av is None else av} |")
    L.append("")
    L.append("來店次數分布（人數）：" + "、".join(f"{b} 次 {n}" for b, n in cur["visit_dist"]) + "。")
    L.append("")
    note = contact_note(a)
    L.append(f"聯絡候選（僅存於私人目錄、不進版本控制）：採用「{SELECTOR_LABELS[a.contact_rule]}」，"
             f"共 {len(a.contact_list)} 人（選擇方式：回測平均提升最高的規則，同分時用到期規則）。"
             f"另供參考：已到回訪週期 {cur['n_due']} 人、14 天內到期 {cur['n_coming']} 人。"
             "未經店主同意請勿傳送任何訊息。")
    if note:
        L.append("")
        L.append(f"注意：{note}。")
    L.append("")

    L.append("## 5. 回訪週期中位數（天）")
    L.append("")
    L.append("| 範圍 | 客數 | 週期中位數 |")
    L.append("|---|---:|---:|")
    for label, n, med in cur["cycle_rows"]:
        L.append(f"| {_md(label)} | {n} | {fmt_num(med)} |")
    L.append("")

    L.append("## 6. 近 24 個月每月來店次數（看季節性）")
    L.append("")
    L.append("| 月份 | 來店次數 | 月份 | 來店次數 |")
    L.append("|---|---:|---|---:|")
    months = [(f"{m}{'（未滿月）' if p else ''}", n) for m, n, p in cur["monthly"]]
    half = (len(months) + 1) // 2
    for i in range(half):
        left = months[i]
        right = months[i + half] if i + half < len(months) else ("", "")
        L.append(f"| {left[0]} | {left[1]} | {right[0]} | {right[1]} |")
    L.append("")

    L.append("## 名詞說明")
    L.append("")
    L.append("- 收件單號（Did）＝一張收件單，可含多件衣物；單件編號（Dno）＝每一件衣物的編號。"
             "衣物以「收件單號＋單件編號」去重，歷史（Deh）與現行（Det）重複時以歷史表（Deh）為準。")
    L.append("- 到期分數＝距上次來店天數 ÷ 個人週期；「已到期」＝分數介於 1 與 3 之間（不含 3）且距上次 ≤ 365 天；"
             "「14 天內到期」＝目前分數 < 1、14 天後將 ≥ 1。")
    L.append("- 替代規則（事先訂定）：「最近一次來店在 30–90 天前」＝距上次 30～90 天（含）；"
             "「多次且逾期」＝來店 ≥3 次，且距上次天數介於週期的 0.8～2.0 倍（含，週期上限 365 天）。")
    L.append("- 單次客沒有個人週期，用「來店 ≥2 次客人的週期中位數」；主要品項為寢具者改用寢具客的週期中位數。")
    L.append("- 命中率＝名單中 90 天內回店人數 ÷ 名單人數；召回率＝名單命中 ÷ 全部回店人數；"
             "提升＝命中率 ÷ 當月基準回店率；合併命中率＝各月命中總和 ÷ 名單人數總和。")
    L.append("- 限制：資料自系統啟用日起算，早期新客可能其實是舊客；公司／散客帳號以規則判定，可能有遺漏；"
             "內部帳號判定使用全期資料。")
    return "\n".join(L) + "\n"


def format_summary(a: Analysis) -> str:
    s, cur = a.summary, a.current
    seg = {k: sum(cur["seg_act"][k].values()) for k in SEGMENTS}
    active = sum(cur["seg_act"][k]["active_6m"] for k in SEGMENTS)
    lines = [
        f"[C4] {conclusion_sentence(a)}",
        f"[C4] 資料期間 {a.data_start.isoformat()} ~ {a.data_last.isoformat()}（as-of {a.as_of.isoformat()}，來源 {a.source}）",
        f"[C4] 分析客數 {a.n_customers}；排除公司/散客/內部帳號 {a.house_count} 個；"
        f"去重件數 {a.piece_stats['pieces']}（合併重複 {a.piece_stats['duplicates_removed']}）；"
        f"日期無法辨識 {a.piece_stats['bad_dates']}",
    ]
    if s["n_cutoffs"]:
        lines.append(f"[C4] 回測 {s['n_cutoffs']} 個月（平均人數／平均命中率／合併命中率／平均召回率／平均提升）：")
        for name in SELECTOR_NAMES:
            m = s[name]
            lines.append(f"[C4]   {SELECTOR_LABELS[name]}：{fmt_num(m.mean_size)}／{fmt_pct(m.mean_precision)}／"
                         f"{fmt_pct(m.pooled_precision)}／{fmt_pct(m.mean_recall)}／{fmt_x(m.mean_lift)} 倍")
    else:
        lines.append("[C4] 回測：資料期間不足，無完整 90 天窗")
    ft = a.first_timer
    lines.append(f"[C4] 新客 90 天回店率 {fmt_pct(ft.overall_rate)}（{ft.overall_returned}/{ft.overall_n}）")
    lines.append(f"[C4] 分層：新客 {seg['new']}／回頭客 {seg['repeat']}／常客 {seg['loyal']}；近 6 個月活躍 {active}")
    note = contact_note(a)
    lines.append(f"[C4] 聯絡名單：採用「{SELECTOR_LABELS[a.contact_rule]}」{len(a.contact_list)} 人；"
                 f"已到期 {cur['n_due']}、14 天內到期 {cur['n_coming']}（未傳送任何訊息）"
                 + (f"；{note}" if note else ""))
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------
def phone_for(mtel, tel) -> str:
    m = "" if mtel is None else str(mtel).strip()
    t = "" if tel is None else str(tel).strip()
    return m or t


def _csv_safe(value) -> str:
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def candidate_reason(st: CustomerState) -> str:
    base = f"距上次 {st.days_since} 天／週期 {st.cycle:.0f} 天"
    if st.cycle_source != "personal":
        base += "（單次客，用預設週期）"
    if st.due_now:
        return f"已到回訪週期：{base}"
    days_left = max(0, math.ceil(st.cycle - st.days_since))
    return f"{days_left} 天內到期：{base}"


def contact_reason(rule: str, st: CustomerState) -> str:
    if rule == "due":
        return candidate_reason(st)
    base = f"距上次 {st.days_since} 天／週期 {st.cycle:.0f} 天"
    if rule == "topk":
        sc = "—" if st.score is None else f"{st.score:.2f}"
        return f"到期分數前 K 名（分數 {sc}）：{base}"
    if rule == "recent_30_90":
        return f"最近一次來店在 30–90 天前：{base}"
    if rule == "multi_lapsing":
        ratio = st.days_since / st.cycle if st.cycle else 0.0
        return f"來店 {st.n_visits} 次、距上次為週期 {ratio:.1f} 倍：{base}"
    return base


def _atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding=encoding, newline="") as f:
        f.write(text)
    os.replace(tmp, path)


def write_contact_csv(path: Path, candidates: Sequence[CustomerState], customers: Mapping,
                      rule: str = "due", note: str | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    warning = CSV_WARNING + (f"；{note}" if note else "")
    with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
        f.write(warning + "\r\n")
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for st in candidates:
            info = customers.get(st.cid, {})
            w.writerow([
                _csv_safe(st.cid), _csv_safe((info.get("name") or "").strip()),
                _csv_safe(phone_for(info.get("mtel"), info.get("tel"))),
                st.segment, _csv_safe(st.main_class), st.n_visits,
                st.last_visit.isoformat(), st.days_since, f"{st.cycle:.1f}",
                "" if st.score is None else f"{st.score:.2f}", contact_reason(rule, st), rule,
            ])
    os.replace(tmp, path)


def report_path(repo_root: Path, as_of: dt.date) -> Path:
    return repo_root / "reports" / "crm" / f"crm-backtest-{as_of.isoformat()}.md"


def contact_csv_path(private_dir: Path, as_of: dt.date) -> Path:
    return private_dir / f"crm-contact-candidates-{as_of.isoformat()}.csv"


def check_private_dir(private_dir: Path, repo_root: Path) -> None:
    """Inside the repo, the private dir must be inside <repo-root>/data (git-ignored)."""
    if private_dir.is_relative_to(repo_root / "reports"):
        raise ValueError("--private-dir must not be inside <repo-root>/reports")
    if private_dir.is_relative_to(repo_root) and not private_dir.is_relative_to(repo_root / "data"):
        raise ValueError("--private-dir inside the repo must be inside <repo-root>/data (git-ignored)")


# --------------------------------------------------------------------------
# Data loading (the only place that touches the MDB)
# --------------------------------------------------------------------------
_PIECE_SQL_COLS = "Did, Dno, Cid, Indate, Dclass, Tpay, Price, Qty"
_PIECE_KEYS = ("did", "dno", "cid", "indate", "dclass", "tpay", "price", "qty")
_SELECT_RE = re.compile(r"^SELECT\b", re.IGNORECASE)


def _run_select(cur, sql: str) -> list:
    """Run exactly one SELECT statement. Anything else raises RuntimeError."""
    stmt = str(sql).strip()
    while stmt.endswith(";"):
        stmt = stmt[:-1].rstrip()
    if not _SELECT_RE.match(stmt) or ";" in stmt:
        raise RuntimeError("read-only guard: only a single SELECT statement is allowed")
    cur.execute(stmt)
    names = [d[0].lower() for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def _norm_piece_row(row: Mapping) -> dict:
    r = {str(k).lower(): v for k, v in row.items()}
    return {k: r.get(k) for k in _PIECE_KEYS}


def _norm_customers(rows: Iterable[Mapping]) -> dict:
    out = {}
    for row in rows:
        r = {str(k).lower(): v for k, v in row.items()}
        cid = normalize_id(r.get("cid"))
        out[cid] = {"name": r.get("name", r.get("cname")) or "",
                    "mtel": r.get("mtel") or "", "tel": r.get("tel") or ""}
    return out


def load_from_mdb() -> RawData:
    sys.path.insert(0, FXWASH_PATH)
    from ai_engine import db_manager  # noqa: E402  (existing connector, pyodbc inside)
    con = db_manager.get_conn()
    try:
        cur = con.cursor()
        deh = _run_select(cur, f"SELECT {_PIECE_SQL_COLS} FROM Deh")
        det = _run_select(cur, f"SELECT {_PIECE_SQL_COLS} FROM Det")
        cus = _run_select(cur, "SELECT Cid, Cname, Mtel, Tel FROM Cus")
    finally:
        try:
            con.close()
        except Exception:
            pass
    return RawData([_norm_piece_row(r) for r in deh], [_norm_piece_row(r) for r in det],
                   _norm_customers(cus), "Access MDB（Deh＋Det）")


def load_from_json(path: Path) -> RawData:
    with open(path, encoding="utf-8") as f:
        obj = json.load(f)
    if not isinstance(obj, dict):
        raise ValueError("JSON root must be an object")
    return RawData([_norm_piece_row(r) for r in obj.get("pieces", [])],
                   [_norm_piece_row(r) for r in obj.get("det_pieces", [])],
                   _norm_customers(obj.get("customers", [])), "JSON 離線檔")


def load_data(source: str, json_path: str | None) -> RawData:
    if source == "json":
        if not json_path:
            raise ValueError("--source json requires --json <path>")
        return load_from_json(Path(json_path))
    if source == "mdb":
        return load_from_mdb()
    raise ValueError(f"unknown source: {source}")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="C4 repurchase segmentation + backtest (read-only).")
    p.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[2]))
    p.add_argument("--private-dir", default=DEFAULT_PRIVATE_DIR)
    p.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: latest intake date)")
    p.add_argument("--dry-run", action="store_true", help="compute and print summary only")
    p.add_argument("--source", choices=("mdb", "json"), default="mdb")
    p.add_argument("--json", dest="json_path", default=None)
    p.add_argument("--bedding-keywords", default=",".join(DEFAULT_BEDDING_KEYWORDS))
    p.add_argument("--backtest-start", default=BACKTEST_START.isoformat())
    return p


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:
        return EXIT_OK if e.code in (0, None) else EXIT_ERROR
    try:
        repo_root = Path(args.repo_root).resolve()
        private_dir = Path(args.private_dir).resolve()
        check_private_dir(private_dir, repo_root)
        as_of = None
        if args.as_of:
            as_of = parse_any_date(args.as_of)
            if as_of is None:
                raise ValueError("--as-of must be YYYY-MM-DD")
        start = parse_any_date(args.backtest_start)
        if start is None:
            raise ValueError("--backtest-start must be YYYY-MM-DD")
        keywords = tuple(k.strip() for k in args.bedding_keywords.split(",") if k.strip())

        raw = load_data(args.source, args.json_path)
        analysis = run_analysis(raw, as_of, keywords, start)
        print(format_summary(analysis))
        if args.dry_run:
            print("[C4] dry-run：未寫入任何檔案。")
            return EXIT_OK

        rpath = report_path(repo_root, analysis.as_of)
        cpath = contact_csv_path(private_dir, analysis.as_of)
        write_contact_csv(cpath, analysis.contact_list, raw.customers,
                          rule=analysis.contact_rule, note=contact_note(analysis))
        _atomic_write_text(rpath, render_report(analysis))
        print(f"[C4] 報告：{rpath}")
        print(f"[C4] 聯絡候選名單（私人，勿外傳）：{cpath}")
        return EXIT_OK
    except Exception as e:  # report only the error type/message, never data rows
        print(f"[C4] ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(errors="replace")
            except Exception:
                pass
    sys.exit(main())