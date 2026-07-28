import { readdir } from "node:fs/promises";
import type { AppConfig, DailySlot, PostLogEntry } from "./types";
import { loadDailyContent, loadPostLog, writeJsonAtomic } from "./logging";
import { facebookInsightsReportPath, postedLogDirectory, projectRoot } from "./paths";

export const DEFAULT_FACEBOOK_POST_INSIGHT_METRICS = [
  "post_media_view",
  "post_total_media_view_unique"
] as const;

interface GraphPayload {
  data?: unknown;
  error?: { message?: string };
  reactions?: { summary?: { total_count?: unknown } };
  comments?: { summary?: { total_count?: unknown } };
  shares?: { count?: unknown };
}

interface GraphResult {
  status: number;
  ok: boolean;
  raw: GraphPayload;
  error?: string;
}

export interface FacebookInsightRow {
  date: string;
  slot: number;
  post_id: string;
  status: PostLogEntry["status"];
  attempts: number;
  created_at: string;
  topic?: string;
  visual_route?: DailySlot["visual_route"];
  traffic_route?: DailySlot["traffic_route"];
  insights_status: number;
  interactions_status: number;
  insights_ok: boolean;
  insights: Record<string, number | null>;
  error?: string;
  raw: {
    insights: unknown;
    interactions: unknown;
  };
}

export interface FacebookInsightsReport {
  since: string;
  until: string;
  generated_at: string;
  graph_api_version: string;
  metrics: string[];
  source: {
    posted_log_dates: string[];
    facebook_posts: number;
    skipped_rows: number;
  };
  rows: FacebookInsightRow[];
}

export interface FacebookPostedInsightsOptions {
  since: string;
  until: string;
  config: AppConfig;
  root?: string;
  metrics?: string[];
  fetchImpl?: typeof fetch;
}

function hasCredential(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return !/^(\[.*\]|<.*>|your[-_].*|example.*|xxx.*|changeme|todo|set|present|redacted|true|false|\*+)$/i.test(
    trimmed
  );
}

function normalizeMetrics(metrics: string[] | undefined): string[] {
  const values = metrics && metrics.length > 0 ? metrics : [...DEFAULT_FACEBOOK_POST_INSIGHT_METRICS];
  const normalized = values.map((metric) => metric.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error("At least one Facebook insight metric is required.");
  return [...new Set(normalized)];
}

function assertDateRange(since: string, until: string): void {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(since)) throw new Error("--since must use YYYY-MM-DD.");
  if (!datePattern.test(until)) throw new Error("--until must use YYYY-MM-DD.");
  if (since > until) throw new Error("--since must be before or equal to --until.");
}

function isSuccessfulLiveFacebookPost(row: PostLogEntry): row is PostLogEntry & { post_id: string } {
  return (
    row.platform === "facebook" &&
    !row.dry_run &&
    Boolean(row.post_id) &&
    ["success", "posted"].includes(row.status)
  );
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function metricValue(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const totalValue = record.total_value;
  if (totalValue && typeof totalValue === "object" && !Array.isArray(totalValue)) {
    return numeric((totalValue as Record<string, unknown>).value);
  }
  const values = Array.isArray(record.values) ? record.values : [];
  const latest = values.at(-1);
  return latest && typeof latest === "object" && !Array.isArray(latest)
    ? numeric((latest as Record<string, unknown>).value)
    : null;
}

function simplifyPostInsights(raw: GraphPayload): Record<string, number | null> {
  const result: Record<string, number | null> = {
    views: null,
    reach: null
  };
  const data = Array.isArray(raw.data) ? raw.data : [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (name === "post_media_view") result.views = metricValue(record);
    if (name === "post_total_media_view_unique") result.reach = metricValue(record);
  }
  return result;
}

async function readGraph(
  pathname: string,
  params: Record<string, string>,
  accessToken: string,
  version: string,
  fetchImpl: typeof fetch
): Promise<GraphResult> {
  const url = new URL(`https://graph.facebook.com/${version}/${pathname.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await response.text();
  let raw: GraphPayload;
  try {
    raw = text ? (JSON.parse(text) as GraphPayload) : {};
  } catch {
    raw = {};
  }
  return {
    status: response.status,
    ok: response.ok && !raw.error,
    raw,
    error: raw.error?.message
  };
}

async function postedLogDatesInRange(since: string, until: string, root: string): Promise<string[]> {
  try {
    const entries = await readdir(postedLogDirectory(root));
    return entries
      .filter((entry) => /^\d{4}-\d{2}-\d{2}\.json$/.test(entry))
      .map((entry) => entry.replace(/\.json$/, ""))
      .filter((date) => date >= since && date <= until)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function fetchPostedFacebookInsights(
  options: FacebookPostedInsightsOptions
): Promise<FacebookInsightsReport> {
  assertDateRange(options.since, options.until);
  const root = projectRoot(options.root);
  const metrics = normalizeMetrics(options.metrics);
  const accessToken = options.config.metaAnalyticsAccessToken || options.config.metaAccessToken;
  if (!hasCredential(accessToken)) {
    throw new Error("META_ANALYTICS_ACCESS_TOKEN or META_ACCESS_TOKEN is required for read-only Facebook insights.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const postedLogDates = await postedLogDatesInRange(options.since, options.until, root);
  const rows: FacebookInsightRow[] = [];
  let facebookPosts = 0;
  let skippedRows = 0;

  for (const date of postedLogDates) {
    const [postLog, dailyContent] = await Promise.all([loadPostLog(date, root), loadDailyContent(date, root)]);
    const slotByNumber = new Map(dailyContent?.slots.map((slot) => [slot.slot, slot]));
    for (const post of postLog) {
      if (!isSuccessfulLiveFacebookPost(post)) {
        skippedRows += post.platform === "facebook" ? 1 : 0;
        continue;
      }
      facebookPosts += 1;
      const [postInsights, interactions] = await Promise.all([
        readGraph(
          `${post.post_id}/insights`,
          { metric: metrics.join(",") },
          accessToken!,
          options.config.graphApiVersion,
          fetchImpl
        ),
        readGraph(
          post.post_id,
          { fields: "id,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares" },
          accessToken!,
          options.config.graphApiVersion,
          fetchImpl
        )
      ]);
      const slot = slotByNumber.get(post.slot);
      const insightValues = simplifyPostInsights(postInsights.raw);
      insightValues.reactions = numeric(interactions.ok ? interactions.raw.reactions?.summary?.total_count : null);
      insightValues.comments = numeric(interactions.ok ? interactions.raw.comments?.summary?.total_count : null);
      insightValues.shares = numeric(interactions.ok ? interactions.raw.shares?.count : null);
      const errors = [postInsights.error, interactions.error].filter(Boolean);

      rows.push({
        date,
        slot: post.slot,
        post_id: post.post_id,
        status: post.status,
        attempts: post.attempts,
        created_at: post.created_at,
        topic: slot?.topic,
        visual_route: slot?.visual_route,
        traffic_route: slot?.traffic_route,
        insights_status: postInsights.status,
        interactions_status: interactions.status,
        insights_ok: postInsights.ok && interactions.ok,
        insights: insightValues,
        ...(errors.length > 0 ? { error: errors.join(" | ") } : {}),
        raw: {
          insights: postInsights.raw,
          interactions: interactions.raw
        }
      });
    }
  }

  return {
    since: options.since,
    until: options.until,
    generated_at: new Date().toISOString(),
    graph_api_version: options.config.graphApiVersion,
    metrics,
    source: {
      posted_log_dates: postedLogDates,
      facebook_posts: facebookPosts,
      skipped_rows: skippedRows
    },
    rows
  };
}

export async function writeFacebookPostedInsightsReport(
  report: FacebookInsightsReport,
  root = projectRoot(),
  outputPath = facebookInsightsReportPath(report.since, report.until, root)
): Promise<string> {
  await writeJsonAtomic(outputPath, report);
  return outputPath;
}
