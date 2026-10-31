import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getOption, isMain } from "./cli";
// ga4Report imports ./config for its side effect (loads .env); reusing its
// credential and token helpers keeps one OAuth path for the whole read side.
import { Ga4NotConfiguredError, accessToken, credentials } from "./ga4Report";
import { projectRoot } from "./paths";

// LINE clicks per MINUTE, for the invisible source matching (owner decision
// D19: customers never see, choose or type a source code). The shop PC exports
// an anonymous inquiry timeline; scripts/attribution_timematch.py matches the
// two by time. Everything downstream is inference (推測), so this file is strict
// about what counts as measured:
// - a property that does not report in Asia/Taipei is never offset-guessed;
//   the day is written as timezone_mismatch with no rows and total null;
// - an API/HTTP error writes nothing for that day and keeps any older file.

export const LINE_CLICK_MINUTES_SCHEMA = "line-click-minutes/v1";
export const EXPECTED_TIME_ZONE = "Asia/Taipei";
const PAGE_LIMIT = 10000;
const MAX_PAGES = 50;
const DAY_MS = 86_400_000;

export interface MinuteRow {
  minute: string;
  source: string;
  count: number;
}

export interface MinuteDayFile {
  schema: typeof LINE_CLICK_MINUTES_SCHEMA;
  date: string;
  time_zone: string | null;
  fetched_at: string;
  status: "measured" | "timezone_mismatch";
  rows: MinuteRow[];
  /** null when status is not measured: a count never taken in Taipei time is not a zero. */
  total: number | null;
  daily_ledger_total: number | null;
}

export interface DayOutcome {
  date: string;
  status: "measured" | "timezone_mismatch" | "error";
  total?: number | null;
  file?: string;
  reason?: string;
}

interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

interface RunReportPayload {
  rows?: Ga4Row[];
  rowCount?: number;
  metadata?: { timeZone?: string };
  error?: { message?: string; status?: string; code?: number };
}

/** GA4 dateHourMinute "YYYYMMDDHHMM" -> "YYYY-MM-DDTHH:MM+08:00" (only valid for an Asia/Taipei property). */
export function formatGa4Minute(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) throw new Error(`unexpected dateHourMinute value: ${JSON.stringify(value)}`);
  const [, year, month, day, hour, minute] = match;
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > 31 ||
    Number(hour) > 23 ||
    Number(minute) > 59
  ) {
    throw new Error(`unexpected dateHourMinute value: ${JSON.stringify(value)}`);
  }
  return `${year}-${month}-${day}T${hour}:${minute}+08:00`;
}

export function normalizeSource(value: string | undefined): string {
  const text = (value ?? "").trim();
  return text === "" || text === "(not set)" ? "unknown" : text;
}

export function buildMinuteRows(rawRows: Ga4Row[], date: string): MinuteRow[] {
  const merged = new Map<string, MinuteRow>();
  for (const row of rawRows) {
    const minute = formatGa4Minute(row.dimensionValues?.[0]?.value ?? "");
    if (minute.slice(0, 10) !== date) {
      throw new Error(`GA4 returned minute ${minute} outside the requested day ${date}`);
    }
    const source = normalizeSource(row.dimensionValues?.[1]?.value);
    const count = Number(row.metricValues?.[0]?.value ?? Number.NaN);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`GA4 returned a non-integer eventCount for ${minute}`);
    }
    if (count === 0) continue;
    const key = `${minute}\n${source}`;
    const existing = merged.get(key);
    if (existing) existing.count += count;
    else merged.set(key, { minute, source, count });
  }
  return [...merged.values()].sort((a, b) =>
    a.minute < b.minute ? -1 : a.minute > b.minute ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0
  );
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The given date and the n-1 days before it, oldest first. */
export function daysEndingAt(date: string, count: number): string[] {
  const end = Date.parse(`${date}T00:00:00Z`);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(new Date(end - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

/** Yesterday's calendar date in Asia/Taipei (fixed UTC+8, no DST). */
export function yesterdayInTaipei(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000 - DAY_MS).toISOString().slice(0, 10);
}

async function fetchDay(input: {
  date: string;
  propertyId: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<{ timeZone: string | null; rows: Ga4Row[] }> {
  const rows: Ga4Row[] = [];
  let timeZone: string | null | undefined;
  let offset = 0;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) throw new Error(`GA4 runReport for ${input.date} did not finish within ${MAX_PAGES} pages`);
    const response = await input.fetchImpl(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(input.propertyId)}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: input.date, endDate: input.date }],
          dimensions: [{ name: "dateHourMinute" }, { name: "customEvent:source" }],
          metrics: [{ name: "eventCount" }],
          dimensionFilter: {
            filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "line_click" } }
          },
          limit: PAGE_LIMIT,
          offset
        })
      }
    );
    let payload: RunReportPayload;
    try {
      payload = (await response.json()) as RunReportPayload;
    } catch {
      throw new Error(`GA4 runReport for ${input.date} returned non-JSON (HTTP ${response.status})`);
    }
    if (!response.ok || payload.error) {
      throw new Error(
        `GA4 runReport failed for ${input.date}: ${payload.error?.message ?? `HTTP ${response.status}`}`
      );
    }
    if (timeZone === undefined) timeZone = payload.metadata?.timeZone ?? null;
    const pageRows = payload.rows ?? [];
    rows.push(...pageRows);
    offset += pageRows.length;
    // GA4 omits rowCount when there are no rows.
    const rowCount = typeof payload.rowCount === "number" ? payload.rowCount : offset;
    if (pageRows.length === 0 || offset >= rowCount) break;
  }
  return { timeZone: timeZone ?? null, rows };
}

async function readLedgerTotal(root: string, date: string): Promise<number | null> {
  try {
    const text = await readFile(join(root, "data", "leads", `${date.slice(0, 7)}.json`), "utf8");
    const ledger = JSON.parse(text) as { days?: Record<string, { line_clicks_total?: unknown }> };
    const value = ledger.days?.[date]?.line_clicks_total;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Fetches and writes data/leads/clicks/<date>.json for each day.
 * Throws Ga4NotConfiguredError (nothing written) when credentials are missing.
 * exitCode: 3 if any day had a timezone mismatch (needs a person), else 1 if
 * any day failed, else 0.
 */
export async function collectLineClickMinutes(input: {
  date: string;
  days?: number;
  root?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<{ exitCode: number; days: DayOutcome[] }> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const { propertyId, missing } = credentials(env);
  if (missing.length > 0) throw new Ga4NotConfiguredError(missing);

  const root = projectRoot(input.root);
  const dates = daysEndingAt(input.date, input.days ?? 3);

  let token: string;
  try {
    token = await accessToken(fetchImpl, env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, days: dates.map((date) => ({ date, status: "error" as const, reason })) };
  }

  const outcomes: DayOutcome[] = [];
  let hadError = false;
  let mismatch = false;
  for (const date of dates) {
    const file = join(root, "data", "leads", "clicks", `${date}.json`);
    try {
      const fetched = await fetchDay({ date, propertyId, token, fetchImpl });
      const fetchedAt = new Date().toISOString();
      const ledgerTotal = await readLedgerTotal(root, date);
      let doc: MinuteDayFile;
      if (fetched.timeZone !== EXPECTED_TIME_ZONE) {
        mismatch = true;
        doc = {
          schema: LINE_CLICK_MINUTES_SCHEMA,
          date,
          time_zone: fetched.timeZone,
          fetched_at: fetchedAt,
          status: "timezone_mismatch",
          rows: [],
          total: null,
          daily_ledger_total: ledgerTotal
        };
      } else {
        const rows = buildMinuteRows(fetched.rows, date);
        doc = {
          schema: LINE_CLICK_MINUTES_SCHEMA,
          date,
          time_zone: EXPECTED_TIME_ZONE,
          fetched_at: fetchedAt,
          status: "measured",
          rows,
          total: rows.reduce((sum, row) => sum + row.count, 0),
          daily_ledger_total: ledgerTotal
        };
      }
      await writeJsonAtomic(file, doc);
      outcomes.push({ date, status: doc.status, total: doc.total, file });
    } catch (error) {
      hadError = true;
      outcomes.push({ date, status: "error", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { exitCode: mismatch ? 3 : hadError ? 1 : 0, days: outcomes };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date") ?? yesterdayInTaipei();
  if (!isValidDate(date)) {
    console.error(`invalid --date ${JSON.stringify(date)} (expected YYYY-MM-DD)`);
    process.exitCode = 2;
    return;
  }
  const daysText = getOption(args, "days");
  const days = daysText === undefined ? 3 : Number(daysText);
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    console.error(`invalid --days ${JSON.stringify(daysText)} (expected an integer 1-31)`);
    process.exitCode = 2;
    return;
  }
  let result: Awaited<ReturnType<typeof collectLineClickMinutes>>;
  try {
    result = await collectLineClickMinutes({ date, days, root: getOption(args, "root") });
  } catch (error) {
    if (error instanceof Ga4NotConfiguredError) {
      console.error(error.message);
      process.exitCode = 0;
      return;
    }
    throw error;
  }
  console.log(JSON.stringify({ date, days: result.days }, null, 2));
  process.exitCode = result.exitCode;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
