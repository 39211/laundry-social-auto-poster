import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import "./config";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";

// GA4 cannot tell you if a page is indexed. It can tell you whether a
// session arrived from an AI product, which landing page it hit, and whether
// anyone stayed. Those three numbers are the only GEO "it worked" evidence
// this property can collect without a paid citation tool.
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
    return organic || medium === "" ? "google_organic" : "other";
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
  const payload = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!payload.access_token) {
    throw new Error(`GA4 token refresh failed: ${payload.error_description ?? payload.error ?? response.status}`);
  }
  return payload.access_token;
}

async function runReport(
  token: string,
  propertyId: string,
  date: string,
  dimensions: string[],
  fetchImpl: typeof fetch
): Promise<{ dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[]> {
  const response = await fetchImpl(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: date, endDate: date }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
        limit: 200
      })
    }
  );
  const payload = (await response.json()) as {
    rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    error?: { message?: string };
  };
  if (payload.error) throw new Error(`GA4 runReport failed: ${payload.error.message}`);
  return payload.rows ?? [];
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
  const token = await accessToken(fetchImpl, env);
  const sourceRows = await runReport(token, propertyId, input.date, ["sessionSource", "sessionMedium"], fetchImpl);
  const landingRows = await runReport(
    token,
    propertyId,
    input.date,
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

  const ai_landing_pages: Ga4LandingRow[] = landingRows
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
    .filter((row) => row.traffic_class === "ai")
    .sort((left, right) => right.sessions - left.sessions || left.page.localeCompare(right.page));

  return {
    date: input.date,
    property_id: propertyId,
    fetched_at: new Date().toISOString(),
    totals: summarizeTraffic(by_source),
    by_source,
    ai_landing_pages
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
  const date = getOption(args, "date") ?? new Date().toISOString().slice(0, 10);
  try {
    const { report, path } = await recordGa4AiTraffic({ date, root: getOption(args, "root") });
    console.log(
      JSON.stringify(
        {
          date: report.date,
          totals: report.totals,
          ai_landing_pages: report.ai_landing_pages.length,
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
