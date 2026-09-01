import { getFlag, getOption, isMain } from "./cli";
// Importing config for its side effect: it loads .env.
import "./config";
import { writeJsonAtomic } from "./logging";
import { getZonedDateParts } from "./scheduler";
import { projectRoot } from "./paths";
import { join } from "node:path";

// Read side of the Search Console indexing/query story, same shape as
// ga4Report.ts's read side: the write side (sitemap, IndexNow) has been live
// for a while, but nothing ever asked Google what actually showed up in
// search results for it. Reuses the YouTube/GBP OAuth client with a separate
// GSC_REFRESH_TOKEN, same reasoning as GA4 -- re-consenting for read-only
// Search Console access must never be able to touch the upload or posting
// scopes already working.
//
// Search Analytics data is not final the moment a day ends -- Google's own
// guidance is roughly 2-3 days of lag before a day's numbers stop moving.
// Querying "yesterday" daily would keep rewriting a still-settling number and
// make day-over-day deltas noise. This always queries GSC_DATA_LAG_DAYS (3)
// days back and stores the result keyed by that query date, not the day the
// script happened to run -- so a stored date's numbers do not change once
// grabbed a second time later.
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DATA_LAG_DAYS = 3;

export interface GscQueryRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscDayReport {
  date: string;
  site_url: string;
  fetched_at: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  top_queries: GscQueryRow[];
  top_pages: GscQueryRow[];
  /**
   * GSC query/page pairs. Unlike the two independent top lists above, this is
   * the only evidence that a specific search query actually reached a
   * specific URL. Consumers must not infer that relationship by array order.
   */
  top_query_pages: GscQueryRow[];
}

export class GscNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`GSC read side is not configured (missing ${missing.join(", ")}). Setup: docs-internal/gsc-search-analytics-setup.md`);
    this.name = "GscNotConfiguredError";
  }
}

function credentials(env: NodeJS.ProcessEnv = process.env) {
  // Its own client rather than reusing YT_CLIENT_ID: that client's Cloud
  // project is not one this account can manage (Search Console API could not
  // be enabled on it from this session), so GSC gets the client whose project
  // is actually reachable -- the same one GBP already uses.
  const clientId = env.GSC_CLIENT_ID ?? "";
  const clientSecret = env.GSC_CLIENT_SECRET ?? "";
  const refreshToken = env.GSC_REFRESH_TOKEN ?? "";
  const siteUrl = env.GSC_SITE_URL ?? "";
  const missing = [
    ["GSC_CLIENT_ID", clientId],
    ["GSC_CLIENT_SECRET", clientSecret],
    ["GSC_REFRESH_TOKEN", refreshToken],
    ["GSC_SITE_URL", siteUrl]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);
  return { clientId, clientSecret, refreshToken, siteUrl, missing };
}

export function isGscConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
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
      `GSC token refresh failed: ${payload.error_description ?? payload.error ?? response.status}. ` +
        `If this says invalid_grant, the consent was revoked -- redo the OAuth flow.`
    );
  }
  return payload.access_token;
}

async function queryDimension(
  fetchImpl: typeof fetch,
  token: string,
  siteUrl: string,
  date: string,
  dimensions: Array<"query" | "page">
): Promise<GscQueryRow[]> {
  const res = await fetchImpl(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: date,
        endDate: date,
        dimensions,
        rowLimit: 25
      })
    }
  );
  const body = (await res.json()) as { rows?: GscQueryRow[]; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`GSC searchAnalytics.query (${dimensions.join("+")}) failed: ${body.error?.message ?? res.status}`);
  }
  return body.rows ?? [];
}

// Per-query rows are privacy-filtered: GSC drops rare queries from the
// dimensioned breakdown, so summing top_queries undercounts the site's real
// total. A dimension-less query returns the one true aggregate row.
async function queryTotals(
  fetchImpl: typeof fetch,
  token: string,
  siteUrl: string,
  date: string
): Promise<{ clicks: number; impressions: number; ctr: number; position: number }> {
  const res = await fetchImpl(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: date, endDate: date, dimensions: [] })
    }
  );
  const body = (await res.json()) as { rows?: GscQueryRow[]; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`GSC searchAnalytics.query (totals) failed: ${body.error?.message ?? res.status}`);
  }
  const row = body.rows?.[0];
  return row
    ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

export function gscDataLagDays(): number {
  return DATA_LAG_DAYS;
}

export function gscSearchAnalyticsPath(date: string, root = projectRoot()): string {
  return join(root, "data", "insights", "gsc", `${date}.json`);
}

export async function fetchGscDayReport(input: {
  date: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<GscDayReport> {
  const env = input.env ?? process.env;
  const { missing, siteUrl } = credentials(env);
  if (missing.length > 0) throw new GscNotConfiguredError(missing);
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await accessToken(fetchImpl, env);

  const [totals, queryRows, pageRows, queryPageRows] = await Promise.all([
    queryTotals(fetchImpl, token, siteUrl, input.date),
    queryDimension(fetchImpl, token, siteUrl, input.date, ["query"]),
    queryDimension(fetchImpl, token, siteUrl, input.date, ["page"]),
    queryDimension(fetchImpl, token, siteUrl, input.date, ["query", "page"])
  ]);

  return {
    date: input.date,
    site_url: siteUrl,
    fetched_at: new Date().toISOString(),
    totals,
    top_queries: queryRows,
    top_pages: pageRows,
    top_query_pages: queryPageRows
  };
}

export async function recordGscDayReport(input: {
  date: string;
  root?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<{ status: "recorded" | "unmeasured"; date: string; reason?: string }> {
  const root = projectRoot(input.root);
  try {
    const report = await fetchGscDayReport({ date: input.date, fetchImpl: input.fetchImpl, env: input.env });
    await writeJsonAtomic(gscSearchAnalyticsPath(input.date, root), report);
    return { status: "recorded", date: input.date };
  } catch (error) {
    return { status: "unmeasured", date: input.date, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const explicitDate = getOption(args, "date");
  const date =
    explicitDate ??
    (() => {
      const tzNow = new Date(Date.now() - DATA_LAG_DAYS * 86_400_000);
      return getZonedDateParts(tzNow).date;
    })();
  const result = await recordGscDayReport({ date, root: getOption(args, "root") });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "unmeasured" && !getFlag(args, "no-fail")) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
