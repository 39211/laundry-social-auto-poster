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
// GA4's default channel group now includes "AI Assistant". Read that official
// classification and keep a narrow source-host fallback for older rows or
// properties where the channel label is not yet populated. google.com is never
// classified as AI because Google AI Overviews/AI Mode remain Organic Search.

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
  channel_group: string;
  sessions: number;
  engaged_sessions: number;
  key_events: number;
  traffic_class: TrafficClass;
}

export interface Ga4LandingRow {
  page: string;
  source: string;
  channel_group: string;
  sessions: number;
  engaged_sessions: number;
  key_events: number;
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
    ai_key_events: number;
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

export function classifyTrafficSource(source: string, medium = "", channelGroup = ""): TrafficClass {
  const host = hostOf(source);
  const canonicalHost = host.replace(/^www\./u, "");
  const organic = medium.toLowerCase() === "organic" || medium.toLowerCase() === "organic-search";
  // Google AI Overviews and AI Mode remain Organic Search. Protect that
  // attribution before trusting a conflicting channel-group label.
  if (canonicalHost === "google" || canonicalHost === "google.com") {
    return organic || medium === "" ? "google_organic" : "other";
  }
  if (channelGroup.trim().toLowerCase() === "ai assistant") return "ai";
  if ((AI_REFERRAL_HOSTS as readonly string[]).some((candidate) => candidate.replace(/^www\./u, "") === canonicalHost)) {
    return "ai";
  }
  if (organic && (canonicalHost === "bing" || canonicalHost === "bing.com")) return "other";
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
      .reduce((sum, row) => sum + row.engaged_sessions, 0),
    ai_key_events: rows
      .filter((row) => row.traffic_class === "ai")
      .reduce((sum, row) => sum + row.key_events, 0)
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
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`GA4 token refresh failed: HTTP ${response.status}`);
  }
  const token =
    isNonArrayObject(payload) && typeof payload.access_token === "string" ? payload.access_token : "";
  if (!token) {
    throw new Error(
      response.ok ? "GA4 token refresh failed: API error" : `GA4 token refresh failed: HTTP ${response.status}`
    );
  }
  return token;
}

type ReportRow = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRemoteApiError(payload: unknown): boolean {
  return isNonArrayObject(payload) && isNonArrayObject(payload.error);
}

/** HTTP 200 `{}` is not zero traffic: rowCount must be present on every success page. */
function parseRunReportPage(payload: unknown): { rows: ReportRow[]; rowCount: number } {
  if (!isNonArrayObject(payload)) {
    throw new Error("GA4 runReport failed: schema expected non-array object with rowCount");
  }
  if (!("rowCount" in payload)) {
    throw new Error("GA4 runReport failed: schema missing rowCount");
  }
  const rowCount = payload.rowCount;
  if (typeof rowCount !== "number" || !Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new Error("GA4 runReport failed: schema invalid rowCount");
  }
  if (!("rows" in payload)) {
    if (rowCount === 0) return { rows: [], rowCount };
    throw new Error("GA4 runReport failed: schema missing rows when rowCount > 0");
  }
  if (!Array.isArray(payload.rows)) {
    throw new Error("GA4 runReport failed: schema rows must be an array");
  }
  return { rows: payload.rows as ReportRow[], rowCount };
}

async function runReport(
  token: string,
  propertyId: string,
  date: string,
  dimensions: string[],
  fetchImpl: typeof fetch
): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  const pageSize = 10_000;
  let offset = 0;
  let expectedRowCount: number | undefined;

  while (true) {
    const response = await fetchImpl(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: date, endDate: date }],
          dimensions: dimensions.map((name) => ({ name })),
          metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
          limit: pageSize,
          offset
        })
      }
    );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`GA4 runReport failed: HTTP ${response.status}; response was not JSON`);
    }
    if (!response.ok) {
      throw new Error(`GA4 runReport failed: HTTP ${response.status}`);
    }
    if (hasRemoteApiError(payload)) {
      throw new Error("GA4 runReport failed: API error");
    }

    const page = parseRunReportPage(payload);
    if (expectedRowCount === undefined) {
      expectedRowCount = page.rowCount;
    } else if (page.rowCount !== expectedRowCount) {
      throw new Error("GA4 runReport failed: schema rowCount changed across pages");
    }
    if (rows.length + page.rows.length > expectedRowCount) {
      throw new Error("GA4 runReport failed: schema rows exceed rowCount");
    }
    rows.push(...page.rows);
    if (rows.length === expectedRowCount) return rows;
    if (page.rows.length === 0) {
      throw new Error("GA4 runReport failed: schema incomplete page sequence");
    }
    offset = rows.length;
  }
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
  const sourceRows = await runReport(
    token,
    propertyId,
    input.date,
    ["sessionSource", "sessionMedium", "sessionDefaultChannelGroup"],
    fetchImpl
  );
  const landingRows = await runReport(
    token,
    propertyId,
    input.date,
    ["landingPagePlusQueryString", "sessionSource", "sessionDefaultChannelGroup"],
    fetchImpl
  );

  const by_source: Ga4SourceSessionRow[] = sourceRows
    .map((row) => {
      const source = row.dimensionValues?.[0]?.value || "(direct)";
      const medium = row.dimensionValues?.[1]?.value || "";
      const channelGroup = row.dimensionValues?.[2]?.value || "";
      return {
        source,
        medium,
        channel_group: channelGroup,
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
        engaged_sessions: Number(row.metricValues?.[1]?.value ?? 0),
        key_events: Number(row.metricValues?.[2]?.value ?? 0),
        traffic_class: classifyTrafficSource(source, medium, channelGroup)
      };
    })
    .sort((left, right) => right.sessions - left.sessions || left.source.localeCompare(right.source));

  const ai_landing_pages: Ga4LandingRow[] = landingRows
    .map((row) => {
      const page = row.dimensionValues?.[0]?.value || "/";
      const source = row.dimensionValues?.[1]?.value || "(direct)";
      const channelGroup = row.dimensionValues?.[2]?.value || "";
      return {
        page,
        source,
        channel_group: channelGroup,
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
        engaged_sessions: Number(row.metricValues?.[1]?.value ?? 0),
        key_events: Number(row.metricValues?.[2]?.value ?? 0),
        traffic_class: classifyTrafficSource(source, "", channelGroup)
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

export async function runGa4AiTrafficCli(input: {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
} = {}): Promise<{ skipped: boolean; reason?: string; path?: string }> {
  const args = input.args ?? process.argv.slice(2);
  const log = input.log ?? console.log;
  const date = getOption(args, "date") ?? new Date().toISOString().slice(0, 10);
  try {
    const { report, path } = await recordGa4AiTraffic({
      date,
      root: getOption(args, "root"),
      env: input.env,
      fetchImpl: input.fetchImpl
    });
    log(
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
    return { skipped: false, path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (getFlag(args, "no-fail")) {
      log(JSON.stringify({ skipped: true, reason: message }));
      return { skipped: true, reason: message };
    }
    throw error;
  }
}

if (isMain(import.meta.url)) {
  runGa4AiTrafficCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
