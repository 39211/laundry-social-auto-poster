import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import "./config";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { fetchGa4ReportRows, resolveGa4ReportDate } from "./ga4ReportRows";

// GA4 cannot tell you if a page is indexed. It can tell you whether a
// session arrived from an AI product, which landing page it hit, and whether
// anyone stayed. Referral visits are not AI citations or search impressions;
// use search-engine reporting separately for those outcomes.
//
// Channel groups in the GA4 UI are a display convenience. This module reads
// sessionSource directly so a missing UI group cannot hide AI traffic, and so
// google.com is never classified as AI.

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const AI_REFERRAL_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "www.perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "grok.com",
  "x.ai"
] as const;

export type TrafficClass = "ai" | "google_organic" | "other";

export interface Ga4SourceSessionRow {
  source: string;
  medium: string;
  sessions: number;
  engaged_sessions: number;
  traffic_class: TrafficClass;
}

export interface Ga4LandingRow {
  page: string;
  source: string;
  sessions: number;
  engaged_sessions: number;
  traffic_class: TrafficClass;
}

export interface Ga4AiTrafficReport {
  date: string;
  property_id: string;
  fetched_at: string;
  totals: {
    sessions: number;
    ai_sessions: number;
    google_organic_sessions: number;
    other_sessions: number;
    ai_engaged_sessions: number;
  };
  by_source: Ga4SourceSessionRow[];
  ai_landing_pages: Ga4LandingRow[];
  /** Every landing page the day's report returned, not just the AI-referred ones. */
  all_landing_pages?: Ga4LandingRow[];
}

function credentials(env: NodeJS.ProcessEnv) {
  const clientId = env.YT_CLIENT_ID ?? "";
  const clientSecret = env.YT_CLIENT_SECRET ?? "";
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

function hostOf(source: string): string {
  return source.trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/\/.*$/u, "");
}

export function classifyTrafficSource(source: string, medium = ""): TrafficClass {
  const host = hostOf(source);
  if ((AI_REFERRAL_HOSTS as readonly string[]).includes(host)) return "ai";
  const organic = medium.toLowerCase() === "organic" || medium.toLowerCase() === "organic-search";
  if (host === "google" || host === "google.com" || host === "www.google.com") {
    return organic ? "google_organic" : "other";
  }
  if (organic && (host === "bing" || host === "bing.com")) return "other";
  return "other";
}

export function summarizeTraffic(rows: Ga4SourceSessionRow[]): Ga4AiTrafficReport["totals"] {
  return {
    sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
    ai_sessions: rows.filter((row) => row.traffic_class === "ai").reduce((sum, row) => sum + row.sessions, 0),
    google_organic_sessions: rows
      .filter((row) => row.traffic_class === "google_organic")
      .reduce((sum, row) => sum + row.sessions, 0),
    other_sessions: rows.filter((row) => row.traffic_class === "other").reduce((sum, row) => sum + row.sessions, 0),
    ai_engaged_sessions: rows
      .filter((row) => row.traffic_class === "ai")
      .reduce((sum, row) => sum + row.engaged_sessions, 0)
  };
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
  if (!response.ok) throw new Error(`GA4 token refresh failed (HTTP ${response.status}).`);
  let payload: { access_token?: string } | null;
  try { payload = await response.json() as { access_token?: string } | null; }
  catch { throw new Error("GA4 token refresh returned invalid JSON."); }
  if (!payload || typeof payload.access_token !== "string" || !payload.access_token.trim()) {
    throw new Error("GA4 token refresh returned no access token.");
  }
  return payload.access_token;
}


export async function fetchGa4AiTraffic(input: {
  date: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<Ga4AiTrafficReport> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const { propertyId, missing } = credentials(env);
  if (missing.length > 0) {
    throw new Error(`GA4 AI traffic is not configured (missing ${missing.join(", ")}).`);
  }
  const date = resolveGa4ReportDate(input.date, new Date(), env.TIMEZONE || "Asia/Taipei");
  const token = await accessToken(fetchImpl, env);
  const sourceRows = await fetchGa4ReportRows(token, propertyId, date, ["sessionSource", "sessionMedium"], fetchImpl);
  const landingRows = await fetchGa4ReportRows(
    token,
    propertyId,
    date,
    ["landingPagePlusQueryString", "sessionSource"],
    fetchImpl
  );

  const by_source: Ga4SourceSessionRow[] = sourceRows
    .map((row) => {
      const source = row.dimensionValues?.[0]?.value || "(direct)";
      const medium = row.dimensionValues?.[1]?.value || "";
      return {
        source,
        medium,
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
        engaged_sessions: Number(row.metricValues?.[1]?.value ?? 0),
        traffic_class: classifyTrafficSource(source, medium)
      };
    })
    .sort((left, right) => right.sessions - left.sessions || left.source.localeCompare(right.source));

  // Every run already spends a second runReport on landingPagePlusQueryString
  // for the whole property, and until 2026-09-10 threw away every row that was
  // not AI -- so the one question the shop actually asks ("which page did people
  // land on?") was fetched daily and binned. Keep the full list; ai_landing_pages
  // stays exactly as it was so nothing downstream changes shape.
  const all_landing_pages: Ga4LandingRow[] = landingRows
    .map((row) => {
      const page = row.dimensionValues?.[0]?.value || "/";
      const source = row.dimensionValues?.[1]?.value || "(direct)";
      return {
        page,
        source,
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
        engaged_sessions: Number(row.metricValues?.[1]?.value ?? 0),
        traffic_class: classifyTrafficSource(source)
      };
    })
    .sort((left, right) => right.sessions - left.sessions || left.page.localeCompare(right.page));

  const ai_landing_pages: Ga4LandingRow[] = all_landing_pages.filter((row) => row.traffic_class === "ai");

  return {
    date,
    property_id: propertyId,
    fetched_at: new Date().toISOString(),
    totals: summarizeTraffic(by_source),
    by_source,
    ai_landing_pages,
    all_landing_pages
  };
}

export function ga4AiTrafficPath(date: string, root = projectRoot()): string {
  return join(root, "data", "insights", "ga4-traffic", `${date}.json`);
}

export async function recordGa4AiTraffic(input: {
  date: string;
  root?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ report: Ga4AiTrafficReport; path: string }> {
  const root = projectRoot(input.root);
  const report = await fetchGa4AiTraffic({ date: input.date, env: input.env, fetchImpl: input.fetchImpl });
  const path = ga4AiTrafficPath(report.date, root);
  await writeJsonAtomic(path, report);
  return { report, path };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date") ?? "yesterday";
  try {
    const { report, path } = await recordGa4AiTraffic({ date, root: getOption(args, "root") });
    console.log(
      JSON.stringify(
        {
          date: report.date,
          totals: report.totals,
          ai_landing_pages: report.ai_landing_pages.length,
          all_landing_pages: report.all_landing_pages?.length ?? 0,
          path: path.replace(/\\/g, "/")
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (getFlag(args, "no-fail")) {
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
