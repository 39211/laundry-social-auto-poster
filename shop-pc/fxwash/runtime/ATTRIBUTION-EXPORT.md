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

# Inquiry timeline (B2-8a)

**What it writes.** The same run also writes `data\conversions\inquiry-timeline-<week>.json`, right after the main file.
- It is not written with `--dry-run`, or when there is nothing to export.
- It carries the same `as_of`, `revision` and `status` as the main file of that run.

**What it holds.** One entry per inquiry of the main file (one per customer-day). For each view, the label counts equal the main file's totals. Each entry has:
- `first_minute`: the first message, to the minute, in Taipei time.
- `follow_minute`: a LINE "add friend" (follow) up to 120 minutes before the first message, or null.
- `returning`: whether the same customer wrote on an earlier day still in the ledger.
- `source_code`: the code the main file counts, or `unknown`.
- `I7` / `B7`: the inquiry's status label.

`follows_without_inquiry` lists the minutes of follows in that week with no message within 120 minutes after.

**Anonymous.** The file has no LINE ids, user keys, inquiry ids, event ids, Cid, names, phones, message text or per-customer counts. The ai PC rejects any timeline that contains such a key or a LINE id.

**推測 only.** The ai PC matches these minutes against website LINE-button clicks by time. Everything derived from that match is an inference (推測), never a fact about a customer. Customers see nothing new and never type a code.

**Main file unaffected.** `follow_observed` rows never change `source-to-order-<week>.json`.

**If the timeline cannot be written.** The export prints `[TIMELINE_ERROR] <type>` and keeps its exit code.

# Retention (B2-6)

**Command.** From `C:\LaundryStores\fxwash`:
`python -I -S -B runtime\attribution_retention.py --root .`
- Optional settings:
  - `--retention-days 90` (default 90; values below 30 are refused)
  - `--lock-wait 10` (seconds)
  - `--pos-json pieces.json` (used only if a week must be exported first)
- Add `--dry-run` to see one line of counts without changing anything.

**Schedule.** Run it every Monday right after the export, with the same Task Scheduler setup.

**Exit codes.**
- 0: done. This includes "nothing to remove".
- 1: error. Nothing was pruned; read stderr.
- 2: bad arguments, for example retention below 30 days.
- 3: the ledger lock was busy. The ledger was not changed; just run it again later.

**What is kept forever.** The weekly files `data\conversions\source-to-order-<week>.json` and their `history\`.
- Before a week loses any rows, it must have a weekly file computed at least 14 days after that week ended.
- If that file is missing or too early, the tool exports the week first. If that export fails, it prunes nothing.

**What is removed.** Raw rows in `data\inquiries.jsonl` older than the cutoff.
- The cutoff is today minus 90 days, rounded down to a Monday. Only whole weeks are removed.
- No backup copy is kept.

**What older rows stay anyway.**
- Each customer's latest binding rows that are still in effect.
- Corrections and bookings that belong to newer inquiries.
- Rows the tool cannot classify safely.

**Log.** Each run appends one line of counts to `data\attribution\prune-log.jsonl`. The running webhook notices the rewrite through `data\inquiries.jsonl.gen` and reloads by itself.