"""Retention for the LINE attribution ledger (B2-6).

Raw rows in data/inquiries.jsonl are kept for `retention_days` (default 90).
Older rows are removed. Only the weekly summaries written by
attribution_export.py remain (data/conversions/source-to-order-<week>.json).

Safety rules:
  * Cutoff = (today in Asia/Taipei - retention_days), rounded DOWN to Monday 00:00.
    Only whole ISO weeks are pruned.
  * Every week that loses an inquiry must already have a summary computed at
    least MATURITY_HORIZON (14 days, from the exporter) after the week ended.
    If it does not, the week is exported first, in-process. If that fails,
    nothing is pruned (exit 1).
  * Rows later attributions depend on are kept:
      - for each user, the row that opened the binding interval still open at
        the cutoff (confirmed and observed), so build_timelines() gives the same
        intervals for every time after the cutoff. This is verified per user;
        when it cannot be proven, all binding rows of that user are kept;
      - corrections, bookings and tombstones that belong to kept inquiries;
      - anything recorded on or after the cutoff, and anything that cannot be
        classified (foreign scope, other key, unknown schema or kind);
      - corrupt lines whose coverage gap reaches past the cutoff.
  * Same `.lock` protocol as the webhook (O_CREAT|O_EXCL, stale-lock rule),
    bounded wait. Atomic rewrite: temp file in the same directory, fsync,
    os.replace, then the generation file is bumped. No backup of removed rows.
  * Output and logs contain counts only.

stdlib only. Exit codes: 0 ok, 1 error (nothing pruned), 2 bad arguments,
3 lock not acquired (ledger unchanged).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

try:
    import attribution_export as ax
except ImportError:  # run as a script under -I: the script dir is not on sys.path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import attribution_export as ax

asvc = ax.asvc

UTC = timezone.utc
TAG = "[ATTRIBUTION_RETENTION]"
DEFAULT_RETENTION_DAYS = 90
MIN_RETENTION_DAYS = 30
DEFAULT_LOCK_WAIT = 10.0
MAX_LOCK_WAIT = 600.0
MATURITY_HORIZON = ax.MATURITY_HORIZON
EXIT_OK, EXIT_ERROR, EXIT_USAGE, EXIT_BUSY = 0, 1, 2, 3

MESSAGE_KIND = "message_observed"
TOMBSTONE_KIND = "unsend_tombstone"
CORRECTION_KIND = "source_corrected"
CORRUPT_LABEL = "corrupt_line"
_CORRUPT_GAP_KINDS = frozenset({"corrupt_line", "corrupt_last_line"})
_O_BINARY = getattr(os, "O_BINARY", 0)
_REPLACE_RETRIES = 20
_REPLACE_SLEEP = 0.05


class RetentionError(Exception):
    """Fatal, user-facing error. Messages never contain customer data."""


# ---------------------------------------------------------------------------
# Cutoff
# ---------------------------------------------------------------------------

def week_floor(d: date) -> date:
    return d - timedelta(days=d.weekday())


def compute_cutoff(now: datetime, retention_days: int) -> datetime:
    """Monday 00:00 Taipei of the ISO week holding (today - retention_days), in UTC.

    It is never later than the start of the week in which the longest attribution
    window may still be open, so a row inside an open window is never pruned.
    """
    today = now.astimezone(ax.TZ).date()
    cutoff = ax.day_start(week_floor(today - timedelta(days=int(retention_days))))
    open_from = ax.day_start(week_floor((now - MATURITY_HORIZON).astimezone(ax.TZ).date()))
    return min(cutoff, open_from)


# ---------------------------------------------------------------------------
# Planning (pure)
# ---------------------------------------------------------------------------

@dataclass
class Plan:
    cutoff: datetime
    data: bytes                       # new ledger bytes
    kept: dict                        # row type -> count
    removed: dict                     # row type -> count
    weeks_pruned: list                # ISO weeks that lost at least one row
    required_weeks: list              # ISO weeks that lose inquiries -> summary needed

    @property
    def removed_total(self) -> int:
        return sum(self.removed.values())

    @property
    def kept_total(self) -> int:
        return sum(self.kept.values())


def _row_old(obj: dict, cutoff: datetime) -> bool:
    """True when every timestamp of the row lies before the cutoff."""
    ts = ax.parse_ts(obj.get("ts"))
    if ts is None or ts >= cutoff:
        return False
    rec = ax.parse_ts(obj.get("recorded_at"))
    if rec is not None and rec >= cutoff:
        return False
    if obj.get("event_kind") in ax.BINDING_KINDS:
        eff = ax.parse_ts(obj.get("effective_at"))
        if eff is not None and eff >= cutoff:
            return False
    return True


def _binding_at(r: dict) -> datetime:
    return ax.parse_ts(r.get("effective_at")) or r["_ts"]


def _binding_ck(r: dict) -> Optional[str]:
    status = r.get("identity_status") if isinstance(r.get("identity_status"), str) else "invalid"
    ck = r.get("cid_key")
    return ck if status == "single" and isinstance(ck, str) else None


def _openers(pre_rows: list) -> set:
    """event_ids of rows that opened the intervals still open after pre_rows."""
    confirmed, observed, _ = ax.build_timelines(pre_rows)
    ids: set = set()
    for store, kind in ((confirmed, "binding_confirmed"), (observed, "binding_observed")):
        for ivs in store.values():
            for iv in ivs:
                if iv.end != ax.FAR_FUTURE:
                    continue
                match = [r for r in pre_rows if r["event_kind"] == kind
                         and _binding_at(r) == iv.start and _binding_ck(r) == iv.cid_key]
                if match:
                    ids.add(max(match, key=lambda r: r["event_id"])["event_id"])
    return ids


def _tail(rows: list, cutoff: datetime) -> tuple:
    """Intervals that still matter after the cutoff (end > cutoff), both stores."""
    confirmed, observed, _ = ax.build_timelines(rows)

    def cut(store: dict) -> list:
        return sorted((u, iv.start, iv.end, iv.cid_key or "")
                      for u, ivs in store.items() for iv in ivs if iv.end > cutoff)
    return cut(confirmed), cut(observed)


def _removable_bindings(rows: list, cutoff: datetime, old: set) -> set:
    by_user: dict = {}
    for r in rows:
        if r["event_kind"] in ax.BINDING_KINDS and isinstance(r.get("user_key"), str):
            by_user.setdefault(r["user_key"], []).append(r)
    remove: set = set()
    for brs in by_user.values():
        candidates = [r for r in brs if r["event_id"] in old]
        if not candidates:
            continue
        forced = [r for r in brs if r["event_id"] not in old]
        keep_ids = _openers([r for r in brs if _binding_at(r) < cutoff])
        kept = forced + [r for r in candidates if r["event_id"] in keep_ids]
        if _tail(brs, cutoff) != _tail(kept, cutoff):
            continue  # cannot prove equivalence: keep every binding row of this user
        remove |= {r["event_id"] for r in candidates if r["event_id"] not in keep_ids}
    return remove


def _split_raw(data: bytes) -> list:
    """[(line_no, raw_bytes)] with the same numbering as attribution_export."""
    terminated = data.endswith(b"\n")
    parts = data.split(b"\n")
    if terminated:
        parts = parts[:-1]
    return [(idx + 1, raw) for idx, raw in enumerate(parts) if raw.rstrip(b"\r").strip()]


def _bump(counter: dict, label: str) -> None:
    counter[label] = counter.get(label, 0) + 1


def plan_prune(data: bytes, *, cutoff: datetime, shop_id: str, oa_scope: str,
               hash_key_version: str) -> Plan:
    """Decide line by line what stays. Pure: no I/O."""
    ledger = ax.parse_ledger(data, as_of=ax.FAR_FUTURE, shop_id=shop_id, oa_scope=oa_scope,
                             hash_key_version=hash_key_version)
    rows = ledger.rows
    old = {r["event_id"] for r in rows if _row_old(r, cutoff)}

    def inquiry_of(r: dict) -> Optional[str]:
        if not isinstance(r.get("user_key"), str):
            return None
        return ax.make_inquiry_id(shop_id, oa_scope, r["user_key"], ax.taipei_day(r["_ts"]))

    remove = {r["event_id"] for r in rows if r["event_kind"] == MESSAGE_KIND and r["event_id"] in old}
    kept_msgs = [r for r in rows if r["event_kind"] == MESSAGE_KIND and r["event_id"] not in remove]
    kept_keys = {r["message_key"] for r in kept_msgs if isinstance(r.get("message_key"), str)}
    kept_inqs = {inquiry_of(r) for r in kept_msgs} - {None}

    for r in rows:
        kind, eid = r["event_kind"], r["event_id"]
        if eid not in old or kind == MESSAGE_KIND or kind in ax.BINDING_KINDS:
            continue
        if kind == TOMBSTONE_KIND:
            if r.get("message_key") not in kept_keys:
                remove.add(eid)
        elif kind == CORRECTION_KIND or kind in ax.BOOKING_KINDS:
            ids = {r.get("inquiry_id")}
            if kind in ax.BOOKING_KINDS:
                ids.add(inquiry_of(r))
            if not (ids & kept_inqs):
                remove.add(eid)
        # Unknown kinds: kept (conservative).
    remove |= _removable_bindings(rows, cutoff, old)

    removed_inq_ids = {inquiry_of(r) for r in rows
                       if r["event_kind"] == MESSAGE_KIND and r["event_id"] in remove} - {None}
    inqs = ax.build_inquiries(rows, shop_id, oa_scope)
    required = sorted({ax.week_label(inq.t_i) for iid, inq in inqs.items() if iid in removed_inq_ids})

    corrupt_remove = {g.line_no for g in ledger.gaps
                      if g.kind in _CORRUPT_GAP_KINDS and g.line_no is not None and g.end < cutoff}

    kept: dict = {}
    removed: dict = {}
    weeks: set = set()
    out = []
    for line_no, raw in _split_raw(data):
        obj = ax._decode_row(raw.rstrip(b"\r"))
        if obj is None:
            if line_no in corrupt_remove:
                _bump(removed, CORRUPT_LABEL)
                continue
            _bump(kept, CORRUPT_LABEL)
            out.append(raw)
            continue
        label = asvc._safe_label(obj.get("event_kind"), 40, default="unknown")
        if obj["event_id"] in remove and _row_old(obj, cutoff):
            _bump(removed, label)
            weeks.add(ax.week_label(ax.parse_ts(obj.get("ts"))))
            continue
        _bump(kept, label)
        out.append(raw)
    new_data = b"".join(raw + b"\n" for raw in out)
    return Plan(cutoff, new_data, kept, removed, sorted(weeks), required)


# ---------------------------------------------------------------------------
# Weekly summaries
# ---------------------------------------------------------------------------

def summary_state(root: Path, week: str, settings: Any, now: datetime) -> str:
    """ok | missing | immature | invalid for the latest revision of `week`.

    The computation time is the document's `as_of` (the exporter's "now"). It
    must be >= week end + MATURITY_HORIZON and not later than `now`.
    """
    path = ax.output_path(root, week)
    if not path.exists():
        return "missing"
    try:
        doc = json.loads(path.read_bytes().decode("utf-8"))
    except Exception:
        return "invalid"
    if not isinstance(doc, dict) or doc.get("cohort_week") != week:
        return "invalid"
    if doc.get("policy_version") != ax.POLICY_VERSION:
        return "invalid"
    if doc.get("shop_id") != settings.shop_id or doc.get("oa_scope") != settings.oa_scope:
        return "invalid"
    rev = doc.get("revision")
    if isinstance(rev, bool) or not isinstance(rev, int) or rev < 1:
        return "invalid"
    as_of = ax.parse_ts(doc.get("as_of"))
    if as_of is None or as_of > now:
        return "invalid"
    _, week_end = ax.iso_week_bounds(week)
    if as_of < week_end + MATURITY_HORIZON:
        return "immature"
    return "ok"


# ---------------------------------------------------------------------------
# Lock, atomic rewrite, generation
# ---------------------------------------------------------------------------

def _lock_age(lock_path: Path) -> float:
    try:
        return time.time() - os.stat(lock_path).st_mtime
    except OSError:
        return -1.0


def acquire_lock(lock_path: Path, wait: float, stale_seconds: float) -> Optional[int]:
    """Same protocol as AttributionLedger. Returns fd, or None after `wait` seconds."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + max(float(wait), 0.0)
    broke_stale = False
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY | _O_BINARY, 0o600)
        except (FileExistsError, PermissionError):
            if not broke_stale and _lock_age(lock_path) > stale_seconds:
                broke_stale = True
                try:
                    os.remove(str(lock_path))
                except OSError:
                    pass
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            time.sleep(min(0.05, remaining))
            continue
        try:
            os.write(fd, ("pid=%d prune\n" % os.getpid()).encode("ascii"))
        except OSError:
            pass
        return fd


def release_lock(fd: int, lock_path: Path) -> None:
    try:
        os.close(fd)
    except OSError:
        pass
    for _ in range(3):
        try:
            os.remove(str(lock_path))
            return
        except FileNotFoundError:
            return
        except OSError:
            time.sleep(0.01)


def _replace_with_retry(src: Path, dst: Path) -> None:
    # Windows refuses os.replace while a reader (e.g. the exporter) has dst open.
    for attempt in range(_REPLACE_RETRIES):
        try:
            os.replace(str(src), str(dst))
            return
        except PermissionError:
            if attempt == _REPLACE_RETRIES - 1:
                raise
            time.sleep(_REPLACE_SLEEP)


def _atomic_replace(dst: Path, data: bytes) -> None:
    tmp = dst.with_name(".%s.prune-%d.tmp" % (dst.name, os.getpid()))
    try:
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC | _O_BINARY, 0o600)
        try:
            asvc._write_all(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
        _replace_with_retry(tmp, dst)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


def generation_path(data_dir: Any) -> Path:
    return Path(data_dir) / (asvc.LEDGER_FILENAME + asvc.GENERATION_SUFFIX)


def bump_generation(data_dir: Any) -> int:
    new = max(asvc.read_ledger_generation(data_dir), 0) + 1
    _atomic_replace(generation_path(data_dir), ("%d\n" % new).encode("ascii"))
    return new


def replace_ledger_locked(data_dir: Any, new_bytes: bytes) -> int:
    """Caller holds the .lock. Atomic rewrite, then bump the generation."""
    data_dir = Path(data_dir)
    _atomic_replace(data_dir / asvc.LEDGER_FILENAME, new_bytes)
    return bump_generation(data_dir)


def prune_log_path(root: Path) -> Path:
    return root / "data" / "attribution" / "prune-log.jsonl"


def append_prune_log(root: Path, record: dict) -> None:
    path = prune_log_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = (json.dumps(record, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
    with open(path, "ab") as handle:
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

@dataclass
class Outcome:
    code: int
    line: str
    report: dict = field(default_factory=dict)


def _fmt_counts(counts: dict) -> str:
    return ",".join("%s=%d" % (k, counts[k]) for k in sorted(counts)) or "none"


def _report(plan: Plan, exported: list, generation: Optional[int]) -> dict:
    return {
        "cutoff": plan.cutoff.astimezone(ax.TZ).date().isoformat(),
        "kept": dict(plan.kept), "removed": dict(plan.removed),
        "kept_total": plan.kept_total, "removed_total": plan.removed_total,
        "weeks_pruned": len(plan.weeks_pruned) if plan.removed_total else 0,
        "weeks_exported_first": list(exported),
        "generation": generation,
    }


def _summary_line(mode: str, rep: dict) -> str:
    return ("%s %s cutoff=%s kept=%d [%s] removed=%d [%s] weeks_pruned=%d "
            "weeks_exported_first=%d generation=%s" % (
                TAG, mode, rep["cutoff"], rep["kept_total"], _fmt_counts(rep["kept"]),
                rep["removed_total"], _fmt_counts(rep["removed"]), rep["weeks_pruned"],
                len(rep["weeks_exported_first"]),
                "-" if rep["generation"] is None else rep["generation"]))


def _export_weeks(root: Path, weeks: list, now: datetime, pos_loader: Optional[Callable],
                  settings: Any) -> list:
    if pos_loader is None:
        raise RetentionError("POS input unavailable; rerun with --pos-json; nothing pruned")
    rows, through, completeness = pos_loader()
    rows = list(rows)
    done = []
    for week in weeks:
        res = ax.export_week(root, week, now, rows, pos_through=through,
                             pos_completeness=completeness)
        if res.code != 0:
            raise RetentionError("export of a week to prune failed (exit %d); nothing pruned" % res.code)
        if summary_state(root, week, settings, now) != "ok":
            raise RetentionError("exported summary is not matured; nothing pruned")
        done.append(week)
    return done


def _run(root: Path, now: datetime, retention_days: int, dry_run: bool, lock_wait: float,
         pos_loader: Optional[Callable], stale_seconds: float) -> Outcome:
    data_dir = root / "data"
    ledger_path = data_dir / asvc.LEDGER_FILENAME
    if not ledger_path.exists():
        return Outcome(EXIT_OK, TAG + " nothing to prune: no ledger")
    settings = ax.load_settings(root)
    key, reason = asvc._read_secret(settings.secret_path)
    if key is None:
        raise RetentionError("HMAC secret unavailable (%s)" % reason)
    hkv = ax.hash_key_version(key)
    cutoff = compute_cutoff(now, retention_days)

    def make_plan() -> Plan:
        return plan_prune(ledger_path.read_bytes(), cutoff=cutoff, shop_id=settings.shop_id,
                          oa_scope=settings.oa_scope, hash_key_version=hkv)

    def missing(plan: Plan) -> list:
        return [w for w in plan.required_weeks if summary_state(root, w, settings, now) != "ok"]

    if dry_run:
        plan = make_plan()
        rep = _report(plan, missing(plan), None)
        return Outcome(EXIT_OK, _summary_line("dry-run (nothing written)", rep), rep)

    lock_path = data_dir / (asvc.LEDGER_FILENAME + ".lock")
    busy = TAG + " ledger busy: lock not acquired within %gs; ledger unchanged" % lock_wait
    fd = acquire_lock(lock_path, lock_wait, stale_seconds)
    if fd is None:
        return Outcome(EXIT_BUSY, busy)
    locked_at = time.monotonic()
    exported: list = []
    generation = None
    try:
        plan = make_plan()
        need = missing(plan)
        if need:
            # Never export while holding the lock: the webhook waits at most 2 s.
            release_lock(fd, lock_path)
            fd = None
            exported = _export_weeks(root, need, now, pos_loader, settings)
            fd = acquire_lock(lock_path, lock_wait, stale_seconds)
            if fd is None:
                return Outcome(EXIT_BUSY, busy + " (%d weekly summaries refreshed)" % len(exported))
            locked_at = time.monotonic()
            plan = make_plan()
            if missing(plan):
                raise RetentionError("a week to prune still lacks a matured summary; nothing pruned")
        if plan.removed_total:
            if time.monotonic() - locked_at > stale_seconds / 2:
                raise RetentionError("planning took too long under the lock; nothing pruned")
            generation = replace_ledger_locked(data_dir, plan.data)
    finally:
        if fd is not None:
            release_lock(fd, lock_path)
    rep = _report(plan, exported, generation)
    record = {
        "schema_version": 1, "at": ax.fmt(now), "retention_days": retention_days,
        "cutoff": rep["cutoff"], "kept": rep["kept"], "removed": rep["removed"],
        "kept_total": rep["kept_total"], "removed_total": rep["removed_total"],
        "weeks_pruned": rep["weeks_pruned"], "weeks_exported_first": len(exported),
        "generation": generation,
    }
    append_prune_log(root, record)
    mode = "pruned" if plan.removed_total else "nothing to remove"
    return Outcome(EXIT_OK, _summary_line(mode, rep), rep)


def run_retention(root: Any, *, now: Optional[datetime] = None,
                  retention_days: int = DEFAULT_RETENTION_DAYS, dry_run: bool = False,
                  lock_wait: float = DEFAULT_LOCK_WAIT, pos_loader: Optional[Callable] = None,
                  stale_lock_seconds: float = asvc.STALE_LOCK_SECONDS) -> Outcome:
    """Library entry point. Never prints. pos_loader() -> (rows, through, completeness)."""
    if isinstance(retention_days, bool) or not isinstance(retention_days, int) \
            or retention_days < MIN_RETENTION_DAYS:
        return Outcome(EXIT_USAGE, TAG + " refused: retention days must be an integer >= %d"
                       % MIN_RETENTION_DAYS)
    now = now or datetime.now(UTC)
    try:
        return _run(Path(root), now, retention_days, dry_run, float(lock_wait), pos_loader,
                    float(stale_lock_seconds))
    except (ax.ExportError, RetentionError) as exc:
        return Outcome(EXIT_ERROR, TAG + " error: " + str(exc))
    except Exception as exc:  # never print exception text: it may carry data
        return Outcome(EXIT_ERROR, TAG + " error: " + type(exc).__name__)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parser() -> argparse.ArgumentParser:
    default_root = str(Path(__file__).resolve().parent.parent)
    p = argparse.ArgumentParser(description="Retention for data/inquiries.jsonl (B2-6).")
    p.add_argument("--root", default=default_root, help="fxwash root (default: parent of runtime/)")
    p.add_argument("--prune", action="store_true", help="optional; pruning is the only action")
    p.add_argument("--retention-days", dest="retention_days", type=int, default=DEFAULT_RETENTION_DAYS)
    p.add_argument("--dry-run", dest="dry_run", action="store_true", help="print counts, write nothing")
    p.add_argument("--lock-wait", dest="lock_wait", type=float, default=DEFAULT_LOCK_WAIT,
                   help="seconds to wait for the ledger lock (default 10)")
    p.add_argument("--pos-json", dest="pos_json", default=None,
                   help="offline POS pieces, used only if a week must be exported first")
    p.add_argument("--as-of", dest="as_of", default=None, help="ISO time (default: now)")
    return p


def main(argv: Optional[list] = None) -> int:
    args = _parser().parse_args(argv)
    if args.retention_days < MIN_RETENTION_DAYS:
        print(TAG + " refused: --retention-days must be >= %d" % MIN_RETENTION_DAYS, file=sys.stderr)
        return EXIT_USAGE
    if not (0.0 <= args.lock_wait <= MAX_LOCK_WAIT):
        print(TAG + " refused: --lock-wait must be between 0 and %d" % MAX_LOCK_WAIT, file=sys.stderr)
        return EXIT_USAGE
    now = ax.parse_ts(args.as_of) if args.as_of else datetime.now(UTC)
    if now is None:
        print(TAG + " refused: invalid --as-of", file=sys.stderr)
        return EXIT_USAGE
    root = Path(args.root)
    if args.pos_json:
        pos_path = Path(args.pos_json)

        def loader() -> tuple:
            return ax.load_pos_json(pos_path)
    else:
        def loader() -> tuple:
            snap = ax.read_connector_snapshot(root)
            return (ax.load_pos_rows_from_connector(snap), ax.snapshot_through(snap),
                    ax.POS_DET_UNVERIFIED)
    out = run_retention(root, now=now, retention_days=args.retention_days, dry_run=args.dry_run,
                        lock_wait=args.lock_wait, pos_loader=loader)
    print(out.line, file=sys.stdout if out.code == EXIT_OK else sys.stderr)
    return out.code


if __name__ == "__main__":
    sys.exit(main())
