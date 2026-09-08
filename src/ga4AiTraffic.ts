import { join } from "node:path";
import { getOption, isMain } from "./cli";
// Importing config for its side effect: it loads .env, and this module reads
// credentials straight from process.env.
import "./config";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";

// Which AI answer engines send people here, and what they land on.
//
// The obvious way to measure this is a GA4 custom channel group, but that is
// an Admin API write and this machine's GA4 credential carries only
// analytics.readonly -- and the Admin API is not enabled in the Cloud project
// that credential belongs to, which this Google account cannot reach to enable
// (docs-internal/ga4-setup.md, and the same client mismatch recorded for GSC).
// Creating the channel group therefore needs someone in the GA4 web UI.
//
// The Data API, however, answers with the credential we already have. So this
// module does the classification locally instead of asking GA4 to do it: same
// number, no admin scope, no console work, and the rules live in code where
// they can be tested rather than in a UI form nobody can diff.
//
// Two things this deliberately does NOT do:
//  - It does not report an AI referral as zero when the read side is broken.
//    An unconfigured reader returning 0 is indistinguishable from "no AI sent
//    anyone", which is the failure this project already fixed once for
//    line_click. It throws instead.
//  - It does not count bare google.com or openai.com as AI traffic. Those hosts
//    also serve ordinary search and documentation; folding them in would
//    inflate the number with traffic that is not an answer-engine referral.

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface AiEngineRule {
  /** Stable key used in the report and in downstream comparisons. */
  engine: string;
  /** Matched against GA4's sessionSource, which is a bare host for referrals. */
  match: RegExp;
}

// Host-anchored on purpose: `chatgpt.com` and `www.chatgpt.com` are the same
// engine, but `notchatgpt.example.com` is not.
export const AI_ENGINE_RULES: AiEngineRule[] = [
  { engine: "chatgpt", match: /^(www\.)?(chatgpt\.com|chat\.openai\.com)$/i },
  { engine: "perplexity", match: /^(www\.)?perplexity\.ai$/i },
  { engine: "claude", match: /^(www\.)?claude\.ai$/i },
  { engine: "gemini", match: /^gemini\.google\.com$/i },
  { engine: "copilot", match: /^copilot\.microsoft\.com$/i },
  { engine: "grok", match: /^(www\.)?(grok\.com|x\.ai)$/i }
];

/** The engine a GA4 sessionSource belongs to, or null when it is not one. */
export function classifyAiSource(source: string): string | null {
  const host = source.trim().toLowerCase();
  if (!host) return null;
  for (const rule of AI_ENGINE_RULES) {
    if (rule.match.test(host)) return rule.engine;
  }
  return null;
}

export interface AiTrafficRow {
  engine: string;
  source: string;
  sessions: number;
  engaged_sessions: number;
  landing_pages: string[];
}

export interface AiTrafficReport {
  property_id: string;
  start_date: string;
  end_date: string;
  fetched_at: string;
  total_sessions: number;
  ai_sessions: number;
  rows: AiTrafficRow[];
  /** True when the property returned no AI referral at all in the window. */
  no_ai_referrals: boolean;
}

export class Ga4AiNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `GA4 read side is not configured (missing ${missing.join(", ")}). ` +
        `AI referrals stay unmeasured -- do not record them as 0. Setup: docs-internal/ga4-setup.md`
    );
    this.name = "Ga4AiNotConfiguredError";
  }
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
  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!payload.access_token) {
    throw new Error(
      `GA4 token refresh failed: ${payload.error_description ?? payload.error ?? response.status}. ` +
        `If this says invalid_grant, the consent was revoked -- redo docs-internal/ga4-setup.md.`
    );
  }
  return payload.access_token;
}

interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

/**
 * Sessions from AI answer engines in a window, split by engine and landing
 * page. Throws when the read side is not configured rather than reporting
 * zero, so "nobody asked" can never be mistaken for "nobody came".
 */
export async function fetchAiTraffic(input: {
  startDate?: string;
  endDate?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<AiTrafficReport> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const { propertyId, missing } = credentials(env);
  if (missing.length > 0) throw new Ga4AiNotConfiguredError(missing);

  const startDate = input.startDate ?? "28daysAgo";
  const endDate = input.endDate ?? "today";
  const token = await accessToken(fetchImpl, env);

  const response = await fetchImpl(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionSource" }, { name: "landingPage" }],
        metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
        limit: 500
      })
    }
  );
  const payload = (await response.json()) as { rows?: Ga4Row[]; error?: { message?: string } };
  if (payload.error) {
    throw new Error(`GA4 runReport failed: ${payload.error.message}`);
  }

  const byEngine = new Map<string, AiTrafficRow>();
  let totalSessions = 0;

  for (const row of payload.rows ?? []) {
    const source = row.dimensionValues?.[0]?.value ?? "";
    const landing = row.dimensionValues?.[1]?.value ?? "";
    const sessions = Number(row.metricValues?.[0]?.value ?? 0);
    const engaged = Number(row.metricValues?.[1]?.value ?? 0);
    totalSessions += sessions;

    const engine = classifyAiSource(source);
    if (!engine) continue;

    const existing = byEngine.get(engine);
    if (existing) {
      existing.sessions += sessions;
      existing.engaged_sessions += engaged;
      if (landing && !existing.landing_pages.includes(landing)) existing.landing_pages.push(landing);
    } else {
      byEngine.set(engine, {
        engine,
        source: source.toLowerCase(),
        sessions,
        engaged_sessions: engaged,
        landing_pages: landing ? [landing] : []
      });
    }
  }

  const rows = [...byEngine.values()].sort((a, b) => b.sessions - a.sessions);
  for (const row of rows) row.landing_pages.sort();
  const aiSessions = rows.reduce((sum, row) => sum + row.sessions, 0);

  return {
    property_id: propertyId,
    start_date: startDate,
    end_date: endDate,
    fetched_at: new Date().toISOString(),
    total_sessions: totalSessions,
    ai_sessions: aiSessions,
    rows,
    no_ai_referrals: rows.length === 0
  };
}

export function aiTrafficReportPath(endDate: string, root = projectRoot()): string {
  return join(root, "data", "insights", "ai-traffic", `${endDate}.json`);
}

export async function recordAiTraffic(input: {
  startDate?: string;
  endDate?: string;
  root?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<{ report: AiTrafficReport; path: string }> {
  const root = projectRoot(input.root);
  const report = await fetchAiTraffic(input);
  // The window's end is what dates the file; "today" is resolved by GA4, so
  // fall back to the fetch date rather than writing a file called today.json.
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(report.end_date)
    ? report.end_date
    : report.fetched_at.slice(0, 10);
  const path = aiTrafficReportPath(stamp, root);
  await writeJsonAtomic(path, report);
  return { report, path };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { report, path } = await recordAiTraffic({
    startDate: getOption(args, "start"),
    endDate: getOption(args, "end"),
    root: getOption(args, "root")
  });
  console.log(
    JSON.stringify(
      {
        window: `${report.start_date} -> ${report.end_date}`,
        total_sessions: report.total_sessions,
        ai_sessions: report.ai_sessions,
        engines: report.rows.map((row) => ({
          engine: row.engine,
          sessions: row.sessions,
          engaged_sessions: row.engaged_sessions,
          landing_pages: row.landing_pages
        })),
        no_ai_referrals: report.no_ai_referrals,
        path: path.replace(/\\/g, "/")
      },
      null,
      2
    )
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
