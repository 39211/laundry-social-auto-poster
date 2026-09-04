import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
// Importing config for its side effect: it loads .env, and this module reads
// credentials straight from process.env.
import "./config";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

// Nightly YouTube Analytics collector for the 72h loop. Impressions and CTR
// exist only in YouTube Studio; the Analytics API does not expose them, so
// those fields are the literal "not-available-via-api" rather than 0.
// Unmeasured days are marked unmeasured -- never zero-filled.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const WINDOW_DAYS = 28;
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
export const IMPRESSIONS_NOT_AVAILABLE = "not-available-via-api" as const;

export interface YouTubeLogEntry {
  date?: string;
  slot?: number;
  video_id?: string;
  title?: string;
  uploaded_at?: string;
  scheduled_publish_at?: string;
  video_status?: string;
}

export interface YouTubeAnalyticsVideoRow {
  video_id: string;
  title: string;
  published_at: string;
  privacy_status: string;
  upload_status: string;
  views: number;
  estimated_minutes_watched: number;
  average_view_duration_seconds: number;
  average_view_percentage: number;
  impressions: typeof IMPRESSIONS_NOT_AVAILABLE;
}

export interface YouTubeAnalyticsReport {
  date: string;
  fetched_at: string;
  status: "measured" | "unmeasured";
  reason?: string;
  videos: YouTubeAnalyticsVideoRow[];
}

class GoogleHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`HTTP ${status}: ${message.slice(0, 200)}`);
    this.status = status;
    this.name = "GoogleHttpError";
  }
}

function credentials(env: NodeJS.ProcessEnv): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  missing: string[];
} {
  const clientId = env.YT_CLIENT_ID ?? "";
  const clientSecret = env.YT_CLIENT_SECRET ?? "";
  const refreshToken = env.YT_REFRESH_TOKEN ?? "";
  const missing = [
    ["YT_CLIENT_ID", clientId],
    ["YT_CLIENT_SECRET", clientSecret],
    ["YT_REFRESH_TOKEN", refreshToken]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);
  return { clientId, clientSecret, refreshToken, missing };
}

function addUtcDays(isoDate: string, days: number): string {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function youtubeLogWindowStart(endDate: string): string {
  return addUtcDays(endDate, -(WINDOW_DAYS - 1));
}

export function youtubeAnalyticsPath(date: string, root = projectRoot()): string {
  return join(root, "data", "insights", "youtube", `${date}.json`);
}

function publishedAt(entry: YouTubeLogEntry): string {
  return entry.scheduled_publish_at || entry.uploaded_at || "";
}

function publishedDay(entry: YouTubeLogEntry): string {
  const raw = publishedAt(entry);
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw.slice(0, 10);
  return getZonedDateParts(dt, "Asia/Taipei").date;
}

function parseGoogleMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // fall through to the raw body
  }
  return text;
}

function reasonFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    (error instanceof GoogleHttpError && error.status === 403) ||
    /insufficient|scope/i.test(message)
  ) {
    return `${message}. Next: run npm run youtube-auth to re-consent youtube.upload youtube.readonly yt-analytics.readonly.`;
  }
  return message;
}

function unmeasuredReport(date: string, fetched_at: string, reason: string): YouTubeAnalyticsReport {
  // R1: failure is unmeasured. Do not write 0 here -- test ②/⑤ pin this.
  return {
    date,
    fetched_at,
    status: "unmeasured",
    reason,
    videos: []
  };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`request timed out after ${timeoutMs}ms: ${message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new GoogleHttpError(response.status, parseGoogleMessage(text) || text);
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`YouTube response was not JSON: ${text.slice(0, 200)}`);
  }
}

// File-local token exchange. postYouTube.accessToken is not exported; this
// copy is for youtubeAnalytics.ts only and must not be reused as a shared
// OAuth helper.
async function accessToken(
  fetchImpl: typeof fetch,
  creds: { clientId: string; clientSecret: string; refreshToken: string },
  timeoutMs: number
): Promise<string> {
  const payload = (await fetchJson(
    fetchImpl,
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token"
      })
    },
    timeoutMs
  )) as { access_token?: string; error_description?: string; error?: string };
  if (!payload.access_token) {
    throw new Error(
      `YouTube token refresh failed: ${payload.error_description ?? payload.error ?? "no access_token"}`
    );
  }
  return payload.access_token;
}

function metricFromRow(
  headers: Array<{ name?: string }> | undefined,
  row: unknown[] | undefined,
  name: string
): number {
  if (!headers || !row) return 0;
  const index = headers.findIndex((header) => header.name === name);
  if (index < 0) return 0;
  const parsed = Number(row[index]);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadWindowEntries(root: string, endDate: string): Promise<YouTubeLogEntry[]> {
  const dir = join(root, "data", "youtube-log");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const startDate = youtubeLogWindowStart(endDate);
  const entries: YouTubeLogEntry[] = [];
  const seen = new Set<string>();
  const files = names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name))
    .map((name) => name.slice(0, 10))
    .filter((date) => date >= startDate && date <= endDate)
    .sort();
  for (const date of files) {
    const parsed = await readJsonFile<unknown>(join(dir, `${date}.json`), []);
    const rows = Array.isArray(parsed) ? parsed : [];
    for (const row of rows as YouTubeLogEntry[]) {
      const videoId = row.video_id?.trim();
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      entries.push(row);
    }
  }
  return entries;
}

async function fetchVideoRow(input: {
  entry: YouTubeLogEntry;
  endDate: string;
  token: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<YouTubeAnalyticsVideoRow> {
  const videoId = input.entry.video_id as string;
  let startDate = publishedDay(input.entry) || input.endDate;
  if (startDate > input.endDate) startDate = input.endDate;

  const analyticsUrl = new URL(ANALYTICS_URL);
  analyticsUrl.searchParams.set("ids", "channel==MINE");
  analyticsUrl.searchParams.set("startDate", startDate);
  analyticsUrl.searchParams.set("endDate", input.endDate);
  analyticsUrl.searchParams.set(
    "metrics",
    "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage"
  );
  analyticsUrl.searchParams.set("dimensions", "video");
  analyticsUrl.searchParams.set("filters", `video==${videoId}`);

  const videosUrl = new URL(VIDEOS_URL);
  videosUrl.searchParams.set("part", "statistics,status");
  videosUrl.searchParams.set("id", videoId);

  const auth = { Authorization: `Bearer ${input.token}` };
  const [analyticsPayload, videosPayload] = await Promise.all([
    fetchJson(input.fetchImpl, analyticsUrl.toString(), { headers: auth }, input.timeoutMs),
    fetchJson(input.fetchImpl, videosUrl.toString(), { headers: auth }, input.timeoutMs)
  ]);

  const analytics = analyticsPayload as {
    columnHeaders?: Array<{ name?: string }>;
    rows?: unknown[][];
  };
  const row = analytics.rows?.[0];
  const item = (videosPayload as {
    items?: Array<{
      statistics?: { viewCount?: string };
      status?: { privacyStatus?: string; uploadStatus?: string };
    }>;
  }).items?.[0];

  return {
    video_id: videoId,
    title: input.entry.title ?? "",
    published_at: publishedAt(input.entry),
    privacy_status: item?.status?.privacyStatus ?? "",
    upload_status: item?.status?.uploadStatus ?? "",
    views: metricFromRow(analytics.columnHeaders, row, "views"),
    estimated_minutes_watched: metricFromRow(analytics.columnHeaders, row, "estimatedMinutesWatched"),
    average_view_duration_seconds: metricFromRow(analytics.columnHeaders, row, "averageViewDuration"),
    average_view_percentage: metricFromRow(analytics.columnHeaders, row, "averageViewPercentage"),
    impressions: IMPRESSIONS_NOT_AVAILABLE
  };
}

export async function collectYouTubeAnalytics(input: {
  date: string;
  root?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}): Promise<YouTubeAnalyticsReport> {
  const root = projectRoot(input.root);
  const date = input.date;
  const fetched_at = new Date().toISOString();
  const timeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  const env = input.env ?? process.env;
  const path = youtubeAnalyticsPath(date, root);

  const persist = async (report: YouTubeAnalyticsReport): Promise<YouTubeAnalyticsReport> => {
    await writeJsonAtomic(path, report);
    return report;
  };

  try {
    const entries = await loadWindowEntries(root, date);
    if (entries.length === 0) {
      return persist({ date, fetched_at, status: "measured", videos: [] });
    }

    const creds = credentials(env);
    if (creds.missing.length > 0) {
      return persist(
        unmeasuredReport(
          date,
          fetched_at,
          `YouTube Analytics is not configured (missing ${creds.missing.join(", ")}). ` +
            `Next: run npm run youtube-auth to grant youtube.upload youtube.readonly yt-analytics.readonly.`
        )
      );
    }

    const token = await accessToken(fetchImpl, creds, timeoutMs);
    const videos: YouTubeAnalyticsVideoRow[] = [];
    for (const entry of entries) {
      videos.push(
        await fetchVideoRow({
          entry,
          endDate: date,
          token,
          fetchImpl,
          timeoutMs
        })
      );
    }
    return persist({ date, fetched_at, status: "measured", videos });
  } catch (error) {
    return persist(unmeasuredReport(date, fetched_at, reasonFromError(error)));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date") ?? getZonedDateParts(new Date(), "Asia/Taipei").date;
  const report = await collectYouTubeAnalytics({
    date,
    root: getOption(args, "root")
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "unmeasured" && !getFlag(args, "no-fail")) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
