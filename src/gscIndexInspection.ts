import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import { getConfig } from "./config";

// Which of our pages Google has actually indexed, straight from the URL
// Inspection API, one verdict per sitemap URL. The sitemap report already said
// "submitted: 24, indexed: 0" (2026-08-21) but only as a single opaque number;
// this records WHERE each page sits (unknown / discovered / crawled-not-indexed
// / indexed) so the daily report can show movement day over day, and so a page
// stuck in one state for a week is visible instead of averaged away.
//
// Read-only by design: the inspection endpoint works with the
// webmasters.readonly scope this machine's GSC_REFRESH_TOKEN already carries
// (docs-internal/gsc-search-analytics-setup.md). There is no API to REQUEST
// indexing for normal pages — that stays a Search Console UI action — so this
// module measures and never mutates.

export interface UrlInspectionRow {
  url: string;
  /** e.g. PASS / NEUTRAL / FAIL / VERDICT_UNSPECIFIED, from indexStatusResult.verdict */
  verdict: string;
  /** e.g. "Submitted and indexed", "Discovered - currently not indexed" */
  coverage_state: string;
  robots_txt_state: string;
  indexing_state: string;
  last_crawl_time: string | null;
  page_fetch_state: string;
  google_canonical: string | null;
  user_canonical: string | null;
  /** HTTP error surface when a single inspection failed; row kept for honesty. */
  error?: string;
}

export interface IndexInspectionReport {
  date: string;
  site_url: string;
  generated_at: string;
  total: number;
  /** coverage_state -> count, the day's one-line summary. */
  states: Record<string, number>;
  indexed_count: number;
  rows: UrlInspectionRow[];
}

interface GscCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  siteUrl: string;
}

function credentials(env: NodeJS.ProcessEnv): GscCredentials {
  const clientId = env.GSC_CLIENT_ID ?? "";
  const clientSecret = env.GSC_CLIENT_SECRET ?? "";
  const refreshToken = env.GSC_REFRESH_TOKEN ?? "";
  const siteUrl = env.GSC_SITE_URL ?? "";
  const missing = [
    !clientId && "GSC_CLIENT_ID",
    !clientSecret && "GSC_CLIENT_SECRET",
    !refreshToken && "GSC_REFRESH_TOKEN",
    !siteUrl && "GSC_SITE_URL"
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`GSC index inspection is not configured; missing ${missing.join(", ")}.`);
  }
  return { clientId, clientSecret, refreshToken, siteUrl };
}

async function accessToken(creds: GscCredentials, fetcher: typeof fetch, timeoutMs: number): Promise<string> {
  let response: Response;
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token"
      }).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`GSC token refresh failed or timed out after ${timeoutMs}ms: ${reason}`);
  }
  if (!response.ok) {
    throw new Error(`GSC token refresh failed: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("GSC token refresh returned no access_token.");
  return payload.access_token;
}

/**
 * The sitemap is the definition of "pages we ask Google to index", so the
 * inspection list comes from the local docs/sitemap.xml rather than a second
 * hand-maintained list that would drift from it. Post pages carry noindex by
 * deliberate choice and are absent from the sitemap, so they are absent here
 * too — inspecting them would only report the noindex we wrote ourselves.
 */
export function sitemapPageUrls(root = projectRoot()): string[] {
  const xml = readFileSync(join(root, "docs", "sitemap.xml"), "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
  // Service images share the sitemap with pages; an image URL has no index
  // verdict of its own, so only page documents are inspected.
  return urls.filter((url) => !/\.(png|jpg|jpeg|webp|mp4)$/i.test(url));
}

/**
 * One URL Inspection call per sitemap page, sequentially. Every call carries a
 * deadline: on 2026-09-04 23:15 a single call that never returned held the loop
 * for the Scheduled Task's whole PT10M limit (zero rows written, 267014
 * TERMINATED), and the seo-exposure-review that follows in gsc-collect.ps1 never
 * ran, so the day's verdict was lost. A stalled call now becomes one
 * "inspection-failed" row and the loop moves on.
 */
export const DEFAULT_INSPECTION_TIMEOUT_MS = 20_000;
/** Parallel inspections; 4 keeps 89 URLs at ~2.5 min and stays well inside the API's per-minute quota. */
export const DEFAULT_INSPECTION_CONCURRENCY = 4;

export async function inspectUrls(input: {
  urls: string[];
  root?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Per-request deadline for the token refresh and each inspection call. */
  requestTimeoutMs?: number;
  /** How many inspection calls run at once; results keep sitemap order. */
  concurrency?: number;
}): Promise<IndexInspectionReport> {
  const fetcher = input.fetchImpl ?? fetch;
  const timeoutMs = input.requestTimeoutMs ?? DEFAULT_INSPECTION_TIMEOUT_MS;
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_INSPECTION_CONCURRENCY);
  const creds = credentials(input.env ?? process.env);
  const token = await accessToken(creds, fetcher, timeoutMs);
  const now = input.now ?? new Date();

  // Each call costs ~7 s at Google's end regardless of what we do; 89 sitemap
  // URLs in sequence is ~10.5 min, past the Scheduled Task's PT10M. A small
  // worker pool keeps the wall clock under the limit; rows keep sitemap order.
  const rows: UrlInspectionRow[] = new Array(input.urls.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < input.urls.length) {
      const index = next;
      next += 1;
      rows[index] = await inspectOne(input.urls[index]!);
    }
  };

  async function inspectOne(url: string): Promise<UrlInspectionRow> {
    let response: Response;
    try {
      response = await fetcher("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inspectionUrl: url, siteUrl: creds.siteUrl }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        url,
        verdict: "ERROR",
        coverage_state: "inspection-failed",
        robots_txt_state: "",
        indexing_state: "",
        last_crawl_time: null,
        page_fetch_state: "",
        google_canonical: null,
        user_canonical: null,
        error: `request failed or timed out after ${timeoutMs}ms: ${reason}`.slice(0, 300)
      };
    }
    if (!response.ok) {
      return {
        url,
        verdict: "ERROR",
        coverage_state: "inspection-failed",
        robots_txt_state: "",
        indexing_state: "",
        last_crawl_time: null,
        page_fetch_state: "",
        google_canonical: null,
        user_canonical: null,
        error: `HTTP ${response.status} ${await response.text()}`.slice(0, 300)
      };
    }
    const payload = (await response.json()) as {
      inspectionResult?: {
        indexStatusResult?: {
          verdict?: string;
          coverageState?: string;
          robotsTxtState?: string;
          indexingState?: string;
          lastCrawlTime?: string;
          pageFetchState?: string;
          googleCanonical?: string;
          userCanonical?: string;
        };
      };
    };
    const status = payload.inspectionResult?.indexStatusResult ?? {};
    return {
      url,
      verdict: status.verdict ?? "VERDICT_UNSPECIFIED",
      coverage_state: status.coverageState ?? "unknown",
      robots_txt_state: status.robotsTxtState ?? "",
      indexing_state: status.indexingState ?? "",
      last_crawl_time: status.lastCrawlTime ?? null,
      page_fetch_state: status.pageFetchState ?? "",
      google_canonical: status.googleCanonical ?? null,
      user_canonical: status.userCanonical ?? null
    };
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, input.urls.length) }, () => worker()));

  const states: Record<string, number> = {};
  for (const row of rows) {
    states[row.coverage_state] = (states[row.coverage_state] ?? 0) + 1;
  }
  // "Indexed" only when Google says the page is in the index — the coverage
  // strings all start with "Submitted and indexed" / "Indexed, not submitted
  // in sitemap" for indexed pages. Matching the word alone would also match
  // "not indexed", which is the opposite claim.
  const indexed = rows.filter((row) => /^(submitted and indexed|indexed\b)/i.test(row.coverage_state)).length;

  return {
    date: getZonedDateParts(now, getConfig().timezone).date,
    site_url: creds.siteUrl,
    generated_at: now.toISOString(),
    total: rows.length,
    states,
    indexed_count: indexed,
    rows
  };
}

export function indexInspectionPath(date: string, root = projectRoot()): string {
  return join(root, "data", "insights", "gsc-index", `${date}.json`);
}

export async function recordIndexInspection(input: {
  root?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ report: IndexInspectionReport; path: string }> {
  const root = projectRoot(input.root);
  const urls = sitemapPageUrls(root);
  const report = await inspectUrls({ urls, root, now: input.now, env: input.env, fetchImpl: input.fetchImpl });
  const path = indexInspectionPath(report.date, root);
  await writeJsonAtomic(path, report);
  return { report, path };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noFail = getFlag(args, "no-fail");
  try {
    const { report, path } = await recordIndexInspection({ root: getOption(args, "root") });
    console.log(
      JSON.stringify(
        {
          date: report.date,
          total: report.total,
          indexed_count: report.indexed_count,
          states: report.states,
          path: path.replace(/\\/g, "/")
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (noFail) {
      console.log(JSON.stringify({ skipped: true, reason: message }));
      return;
    }
    throw error;
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
