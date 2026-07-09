import { readdir } from "node:fs/promises";
import type { AppConfig, DailySlot, PostLogEntry } from "./types";
import { loadDailyContent, loadPostLog, writeJsonAtomic } from "./logging";
import { instagramInsightsReportPath, postedLogDirectory, projectRoot } from "./paths";

export const DEFAULT_INSTAGRAM_MEDIA_INSIGHT_METRICS = [
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions"
] as const;

export interface InstagramInsightsOptions {
  postId: string;
  config: AppConfig;
  metrics?: string[];
  fetchImpl?: typeof fetch;
}

export interface InstagramInsightsResult {
  post_id: string;
  requested_at: string;
  graph_api_version: string;
  endpoint: string;
  metrics: string[];
  insights_status: number;
  insights_ok: boolean;
  raw: unknown;
  error?: string;
}

export interface InstagramPostedInsightRow {
  date: string;
  slot: number;
  post_id: string;
  status: PostLogEntry["status"];
  attempts: number;
  created_at: string;
  topic?: string;
  visual_route?: DailySlot["visual_route"];
  traffic_route?: DailySlot["traffic_route"];
  hashtags: string[];
  caption_length?: number;
  insights_status: number;
  insights_ok: boolean;
  metrics: Record<string, unknown>;
  error?: string;
  raw: unknown;
}

export interface InstagramPostedInsightsReport {
  since: string;
  until: string;
  generated_at: string;
  graph_api_version: string;
  metrics: string[];
  source: {
    posted_log_dates: string[];
    instagram_posts: number;
    skipped_rows: number;
  };
  rows: InstagramPostedInsightRow[];
}

export interface InstagramPostedInsightsOptions {
  since: string;
  until: string;
  config: AppConfig;
  root?: string;
  metrics?: string[];
  fetchImpl?: typeof fetch;
}

interface MetaErrorPayload {
  error?: { message?: string };
}

function hasCredential(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return !/^(\[.*\]|<.*>|your[-_].*|example.*|xxx.*|changeme|todo|set|present|redacted|true|false|\*+)$/i.test(
    trimmed
  );
}

function normalizeMetrics(metrics: string[] | undefined): string[] {
  const values = metrics && metrics.length > 0 ? metrics : [...DEFAULT_INSTAGRAM_MEDIA_INSIGHT_METRICS];
  const normalized = values.map((metric) => metric.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("At least one Instagram insight metric is required.");
  }
  return [...new Set(normalized)];
}

function assertDateRange(since: string, until: string): void {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(since)) throw new Error("--since must use YYYY-MM-DD.");
  if (!datePattern.test(until)) throw new Error("--until must use YYYY-MM-DD.");
  if (since > until) throw new Error("--since must be before or equal to --until.");
}

function isSuccessfulLiveInstagramPost(row: PostLogEntry): row is PostLogEntry & { post_id: string } {
  return (
    row.platform === "instagram" &&
    !row.dry_run &&
    Boolean(row.post_id) &&
    ["success", "posted"].includes(row.status)
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function metricValue(metric: unknown): unknown {
  const record = asRecord(metric);
  if (!record) return null;

  const totalValue = asRecord(record.total_value);
  if (totalValue && "value" in totalValue) return totalValue.value;

  const values = Array.isArray(record.values) ? record.values : [];
  const latest = asRecord(values.at(-1));
  return latest && "value" in latest ? latest.value : null;
}

export function simplifyInstagramInsights(raw: unknown): Record<string, unknown> {
  const record = asRecord(raw);
  const data = Array.isArray(record?.data) ? record.data : [];
  const metrics: Record<string, unknown> = {};

  for (const metric of data) {
    const metricRecord = asRecord(metric);
    const name = typeof metricRecord?.name === "string" ? metricRecord.name : undefined;
    if (name) metrics[name] = metricValue(metricRecord);
  }

  return metrics;
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

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function fetchInstagramMediaInsights(options: InstagramInsightsOptions): Promise<InstagramInsightsResult> {
  const postId = options.postId.trim();
  if (!postId) {
    throw new Error("--post-id is required.");
  }
  const accessToken = options.config.metaAnalyticsAccessToken || options.config.metaAccessToken;
  if (!hasCredential(accessToken)) {
    throw new Error("META_ANALYTICS_ACCESS_TOKEN or META_ACCESS_TOKEN is required for read-only Instagram insights.");
  }

  const metrics = normalizeMetrics(options.metrics);
  const endpoint = `https://graph.facebook.com/${options.config.graphApiVersion}/${postId}/insights`;
  const url = new URL(endpoint);
  url.searchParams.set("metric", metrics.join(","));

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const raw = await readJson(response);
  const metaError = raw as MetaErrorPayload;

  return {
    post_id: postId,
    requested_at: new Date().toISOString(),
    graph_api_version: options.config.graphApiVersion,
    endpoint,
    metrics,
    insights_status: response.status,
    insights_ok: response.ok && !metaError?.error,
    raw,
    error: metaError?.error?.message
  };
}

export async function fetchPostedInstagramInsights(
  options: InstagramPostedInsightsOptions
): Promise<InstagramPostedInsightsReport> {
  assertDateRange(options.since, options.until);

  const root = projectRoot(options.root);
  const metrics = normalizeMetrics(options.metrics);
  const postedLogDates = await postedLogDatesInRange(options.since, options.until, root);
  const rows: InstagramPostedInsightRow[] = [];
  let instagramPosts = 0;
  let skippedRows = 0;

  for (const date of postedLogDates) {
    const [postLog, dailyContent] = await Promise.all([loadPostLog(date, root), loadDailyContent(date, root)]);
    const slotByNumber = new Map(dailyContent?.slots.map((slot) => [slot.slot, slot]));

    for (const post of postLog) {
      if (!isSuccessfulLiveInstagramPost(post)) {
        skippedRows += post.platform === "instagram" ? 1 : 0;
        continue;
      }

      instagramPosts += 1;
      const slot = slotByNumber.get(post.slot);
      const insight = await fetchInstagramMediaInsights({
        postId: post.post_id,
        config: options.config,
        metrics,
        fetchImpl: options.fetchImpl
      });

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
        hashtags: slot?.instagram_caption.match(/#[\p{L}\p{N}_]+/gu) ?? [],
        caption_length: slot?.instagram_caption.length,
        insights_status: insight.insights_status,
        insights_ok: insight.insights_ok,
        metrics: simplifyInstagramInsights(insight.raw),
        error: insight.error,
        raw: insight.raw
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
      instagram_posts: instagramPosts,
      skipped_rows: skippedRows
    },
    rows
  };
}

export async function writeInstagramPostedInsightsReport(
  report: InstagramPostedInsightsReport,
  root = projectRoot(),
  outputPath = instagramInsightsReportPath(report.since, report.until, root)
): Promise<string> {
  await writeJsonAtomic(outputPath, report);
  return outputPath;
}
