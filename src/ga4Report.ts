import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
// Importing config for its side effect: it loads .env, and this module reads
// credentials straight from process.env.
import "./config";
import { readJsonFile } from "./logging";
import { projectRoot } from "./paths";

// The read side of measurement. The write side has been live since the coded
// redirect page went up -- gtag fires line_click with the source parameter --
// but nothing ever asked Google for the result, so every report in this
// project defaulted line_click to 0 and several reviews read that zero as
// "nobody clicked". A zero that was never fetched is not evidence.
//
// Deliberately no SDK: the Data API is one POST, and @google-analytics/data
// pulls in gRPC and a service-account flow. Reusing the OAuth client that
// already uploads to YouTube means the owner grants one extra scope instead
// of provisioning a service account and sharing a property with it.

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface Ga4SourceRow {
  source: string;
  line_clicks: number;
}

export interface Ga4DayReport {
  date: string;
  property_id: string;
  fetched_at: string;
  total_line_clicks: number;
  by_source: Ga4SourceRow[];
}

export class Ga4NotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `GA4 read side is not configured (missing ${missing.join(", ")}). ` +
        `line_click stays unmeasured -- do not record it as 0. Setup: docs-internal/ga4-setup.md`
    );
    this.name = "Ga4NotConfiguredError";
  }
}

function credentials(env: NodeJS.ProcessEnv = process.env) {
  const clientId = env.YT_CLIENT_ID ?? "";
  const clientSecret = env.YT_CLIENT_SECRET ?? "";
  // A separate refresh token from the YouTube one on purpose: re-consenting
  // for analytics must never be able to invalidate the upload path that is
  // already working.
  const refreshToken = env.GA4_REFRESH_TOKEN ?? "";
  const propertyId = env.GA4_PROPERTY_ID ?? "";
  const missing = [
    ["YT_CLIENT_ID", clientId],
    ["YT_CLIENT_SECRET", clientSecret],
    ["GA4_REFRESH_TOKEN", refreshToken],
    ["GA4_PROPERTY_ID", propertyId]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);
  return { clientId, clientSecret, refreshToken, propertyId, missing };
}

export function isGa4Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return credentials(env).missing.length === 0;
}

async function accessToken(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv): Promise<string> {
  const { clientId, clientSecret, refreshToken } = credentials(env);
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = (await response.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!payload.access_token) {
    throw new Error(
      `GA4 token refresh failed: ${payload.error_description ?? payload.error ?? response.status}. ` +
        `If this says invalid_grant, the consent was revoked -- redo docs-internal/ga4-setup.md.`
    );
  }
  return payload.access_token;
}

/**
 * One day of line_click, broken down by the source parameter the coded links
 * carry. Throws rather than returning zeros when the read side is not set up:
 * an unconfigured reader returning 0 is the exact failure this file exists to
 * end.
 */
export async function fetchLineClicks(input: {
  date: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<Ga4DayReport> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const { propertyId, missing } = credentials(env);
  if (missing.length > 0) throw new Ga4NotConfiguredError(missing);

  const token = await accessToken(fetchImpl, env);
  const response = await fetchImpl(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: input.date, endDate: input.date }],
        dimensions: [{ name: "customEvent:source" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: { fieldName: "eventName", stringFilter: { value: "line_click" } }
        },
        limit: 100
      })
    }
  );
  const payload = (await response.json()) as {
    rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    error?: { message?: string };
  };
  if (!response.ok || payload.error) {
    throw new Error(`GA4 runReport failed: ${payload.error?.message ?? response.status}`);
  }

  const bySource: Ga4SourceRow[] = (payload.rows ?? []).map((row) => ({
    // "(not set)" is what GA4 returns for clicks on links that carry no source
    // parameter. Keeping it visible is the point: it measures how much of the
    // traffic is unattributable, which is a number worth watching on its own.
    source: row.dimensionValues?.[0]?.value || "(not set)",
    line_clicks: Number(row.metricValues?.[0]?.value ?? 0)
  }));
  bySource.sort((a, b) => b.line_clicks - a.line_clicks);

  return {
    date: input.date,
    property_id: propertyId,
    fetched_at: new Date().toISOString(),
    total_line_clicks: bySource.reduce((sum, row) => sum + row.line_clicks, 0),
    by_source: bySource
  };
}

interface LedgerDay {
  source_clicks?: Record<string, number>;
  source_clicks_status?: string;
  inquiries?: number | null;
  [key: string]: unknown;
}

interface LedgerFile {
  month?: string;
  days?: Record<string, LedgerDay>;
  [key: string]: unknown;
}

/**
 * Writes the day's clicks into the leads ledger. When the read side is not
 * configured the day is marked "unmeasured" rather than zero-filled, so a
 * later reader can always tell the difference between nobody clicked and
 * nobody asked.
 */
export async function recordLineClicksToLedger(input: {
  date: string;
  root?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<{ status: "recorded" | "unmeasured"; total?: number; reason?: string }> {
  const root = projectRoot(input.root);
  const month = input.date.slice(0, 7);
  const ledgerPath = join(root, "data", "leads", `${month}.json`);
  const ledger = await readJsonFile<LedgerFile>(ledgerPath, { month, days: {} });
  ledger.days ??= {};
  const day: LedgerDay = ledger.days[input.date] ?? {};

  let result: { status: "recorded" | "unmeasured"; total?: number; reason?: string };
  try {
    const report = await fetchLineClicks({ date: input.date, fetchImpl: input.fetchImpl, env: input.env });
    day.source_clicks = Object.fromEntries(report.by_source.map((row) => [row.source, row.line_clicks]));
    day.source_clicks_status = "measured";
    result = { status: "recorded", total: report.total_line_clicks };
  } catch (error) {
    delete day.source_clicks;
    day.source_clicks_status = "unmeasured";
    result = { status: "unmeasured", reason: error instanceof Error ? error.message : String(error) };
  }

  ledger.days[input.date] = day;
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date") ?? new Date().toISOString().slice(0, 10);
  const result = await recordLineClicksToLedger({ date, root: getOption(args, "root") });
  console.log(JSON.stringify({ date, ...result }, null, 2));
  if (result.status === "unmeasured") process.exitCode = 0; // reporting tool, not a gate
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
