# Weekly attribution export (B2-3)

**Run it every Monday, by hand for now.** From `C:\LaundryStores\fxwash`:
`python -I -S -B runtime\attribution_export.py --root . --week 2026-W44`
- Leave out `--week` to export last week (Asia/Taipei, Monday 00:00 to the next Monday 00:00).
- Add `--dry-run` to see the one-line summary without writing anything.
- Use `--pos-json pieces.json` to work from an offline list of pieces instead of the eHank MDB.

**Scheduled task (later).** Run the same command every Monday at 09:00 with Task Scheduler. Exit codes: 0 = written, 1 = error (read stderr), 2 = nothing to export.

**What it writes.** `data\conversions\source-to-order-<week>.json`
- Each run creates a new `revision`. The previous revision is copied to `history\`.
- Re-running the same week later is expected: pending inquiries mature over 7 days (I7) or up to 14 days (B7).

**How to read each row (one per source code, plus `unknown`).**
- `inquiries`: customer-days. One LINE user on one Taipei calendar day counts as one inquiry. It is not a count of unique customers or orders.
- `I7`: the inquiry had at least one POS receipt within 7 days after the inquiry.
- `B7`: the inquiry had at least one POS receipt within 7 days after its staff-confirmed Cid binding.
- I7 and B7 are two parallel views. Never add them together, and never call either one "orders" or "sales".
- For each view, these always add up to `inquiries`: received + pending_window + unknown_inquiries + matured_no_receipt.
- `unknown`: there is no confirmed binding, a conflict, a date-only boundary, or a data gap. `reason_counts` says why. One inquiry can have several reasons.

**`status: lower_bound`** means "at least this many". The real number may be higher. This is normal while:
- windows are still open,
- the ledger has a gap, or
- POS completeness is unproven (the eHank Det snapshot always counts as unproven).

Only `complete` means every input was covered. Never read a `lower_bound` zero as "no customers came".

**Privacy.** The file holds counts only, with no LINE ids, Cid, names, phones or message text. Never edit `inquiries.jsonl` by hand.