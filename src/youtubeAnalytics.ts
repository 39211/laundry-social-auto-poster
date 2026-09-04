import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
// Importing config for its side effect: it loads .env, and this module reads
// credentials straight from process.env.
import "./config";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

// Nightly YouTube Analytics collector. Writes data/insights/youtube/<date>.json.
// No consumer currently reads that directory; wiring it into the 72h loop is
// later work. Impressions and CTR exist only in YouTube Studio; the Analytics
// API does not expose them, so those fields are the literal
// "not-available-via-api" rather than a number. Unmeasured and not-yet-ready
// values stay null -- never zero-filled.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const WINDOW_DAYS = 28;
const VIDEO_STATUS_BATCH_SIZE = 50;
const ANALYTICS_START_LOOKBACK_DAYS = 2;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_COLLECTION_BUDGET_MS = 480_000;
export const IMPRESSIONS_NOT_AVAILABLE = "not-available-via-api" as const;

const METRIC_COLUMNS = [
  ["views", "views"],
  ["estimatedMinutesWatched", "estimated_minutes_watched"],
  ["averageViewDuration", "average_view_duration_seconds"],
  ["averageViewPercentage", "average_view_percentage"]
] as const;

export type YouTubeMetricsStatus = "measured" | "pending" | "unmeasured";
export type YouTubeReportStatus = "measured" | "partial" | "unmeasured";

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
  privacy_status: string | null;
  upload_status: string | null;
  metrics_status: YouTubeMetricsStatus;
  views: number | null;
  estimated_minutes_watched: number | null;
  average_view_duration_seconds: number | null;
  average_view_percentage: number | null;
  impressions: typeof IMPRESSIONS_NOT_AVAILABLE;
  reason?: string;
  status_reason?: string;
}

type VideoStatusRecord = {
  privacy_status: string | null;
  upload_status: string | null;
  status_reason?: string;
};

export interface YouTubeAnalyticsReport {
  date: string;
  fetched_at: string;
  status: YouTubeReportStatus;
  reason?: string;
  videos: YouTubeAnalyticsVideoRow[];
  merged_existing_rows?: number;
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

// Analytics reports.query cuts days in Pacific time. Using the Taipei publish
// day as startDate permanently drops the first PT day, so each single-video
// query starts two calendar days before the Taipei publish day (or the 28-day
// log window start when publish time is missing).
function analyticsQueryStartDate(entry: YouTubeLogEntry, endDate: string): string {
  const published = publishedDay(entry);
  const start = published
    ? addUtcDays(published, -ANALYTICS_START_LOOKBACK_DAYS)
    : youtubeLogWindowStart(endDate);
  return start > endDate ? endDate : start;
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

function isAbortOrTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError";
}

function formatCaughtError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name && error.name !== "Error" && !error.message.includes(error.name)) {
      return `${error.name}: ${error.message}`;
    }
    return error.message;
  }
  return String(error);
}

function reasonFromError(error: unknown): string {
  const message = formatCaughtError(error);
  const status = error instanceof GoogleHttpError ? error.status : undefined;
  if (status === 401 || status === 403 || /insufficient|scope/i.test(message)) {
    return `${message}. Next: run npm run youtube-auth to re-consent youtube.upload youtube.readonly yt-analytics.readonly.`;
  }
  return message;
}

function isFullyMeasured(video: YouTubeAnalyticsVideoRow): boolean {
  return video.metrics_status === "measured" && !video.status_reason;
}

// Same-run skeleton placeholders ("collection in progress") are not keepable
// measurements. Rank them with unmeasured so a later persist of this run
// (token failure, etc.) wins as the newer same-rank row instead of the
// skeleton feeding back through disk as pending > unmeasured.
function videoQuality(video: YouTubeAnalyticsVideoRow): number {
  if (isFullyMeasured(video)) return 3;
  if (video.metrics_status === "measured") return 2;
  if (video.metrics_status === "pending" && video.reason !== "collection in progress") return 1;
  return 0;
}

function deriveReportStatus(videos: YouTubeAnalyticsVideoRow[]): YouTubeReportStatus {
  if (videos.length === 0) return "measured";
  let fullyMeasured = 0;
  let anyMeasuredMetrics = false;
  for (const video of videos) {
    if (isFullyMeasured(video)) fullyMeasured += 1;
    if (video.metrics_status === "measured") anyMeasuredMetrics = true;
  }
  if (fullyMeasured === videos.length) return "measured";
  if (anyMeasuredMetrics) return "partial";
  return "unmeasured";
}

function reasonSeverity(message: string): number {
  if (/401|403|insufficient|scope|youtube-auth|re-consent/i.test(message)) return 4;
  if (/budget exhausted/i.test(message)) return 2;
  if (/analytics rows not available yet/i.test(message)) return 1;
  return 3;
}

function worseReason(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return reasonSeverity(left) >= reasonSeverity(right) ? left : right;
}

function composeReportReason(videos: YouTubeAnalyticsVideoRow[]): string | undefined {
  const failed = videos.filter(
    (video) => Boolean(video.status_reason) || video.metrics_status !== "measured"
  );
  if (failed.length === 0) return undefined;
  let best: string | undefined;
  let bestSev = -1;
  for (const video of failed) {
    const message = worseReason(video.status_reason, video.reason);
    if (!message) continue;
    const sev = reasonSeverity(message);
    if (sev > bestSev) {
      best = message;
      bestSev = sev;
    }
  }
  if (!best) return undefined;
  return `${best} (${failed.length} videos failed)`;
}

function asVideoRow(value: unknown): YouTubeAnalyticsVideoRow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const video = value as YouTubeAnalyticsVideoRow;
  if (typeof video.video_id !== "string" || video.video_id.length === 0) return undefined;
  return video;
}

async function readExistingVideos(path: string): Promise<YouTubeAnalyticsVideoRow[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/u, "")) as { videos?: unknown };
    if (!Array.isArray(parsed.videos)) return [];
    const rows: YouTubeAnalyticsVideoRow[] = [];
    for (const item of parsed.videos) {
      const video = asVideoRow(item);
      if (video) rows.push(video);
    }
    return rows;
  } catch {
    return [];
  }
}

function mergeVideoRows(
  existing: YouTubeAnalyticsVideoRow[],
  current: YouTubeAnalyticsVideoRow[]
): { videos: YouTubeAnalyticsVideoRow[]; mergedExistingRows: number } {
  const currentById = new Map<string, YouTubeAnalyticsVideoRow>();
  for (const video of current) {
    if (video.video_id) currentById.set(video.video_id, video);
  }
  const seen = new Set<string>();
  const videos: YouTubeAnalyticsVideoRow[] = [];
  let mergedExistingRows = 0;

  for (const old of existing) {
    if (!old.video_id || seen.has(old.video_id)) continue;
    seen.add(old.video_id);
    const next = currentById.get(old.video_id);
    if (!next) {
      videos.push(old);
      mergedExistingRows += 1;
      continue;
    }
    if (videoQuality(old) > videoQuality(next)) {
      videos.push(old);
      mergedExistingRows += 1;
    } else {
      videos.push(next);
    }
  }

  for (const next of current) {
    if (!next.video_id || seen.has(next.video_id)) continue;
    seen.add(next.video_id);
    videos.push(next);
  }

  return { videos, mergedExistingRows };
}

function nullMetricFields(): Pick<
  YouTubeAnalyticsVideoRow,
  "views" | "estimated_minutes_watched" | "average_view_duration_seconds" | "average_view_percentage"
> {
  return {
    views: null,
    estimated_minutes_watched: null,
    average_view_duration_seconds: null,
    average_view_percentage: null
  };
}

function placeholderRow(entry: YouTubeLogEntry, reason: string): YouTubeAnalyticsVideoRow {
  return {
    video_id: (entry.video_id ?? "").trim(),
    title: entry.title ?? "",
    published_at: publishedAt(entry),
    privacy_status: null,
    upload_status: null,
    metrics_status: "pending",
    ...nullMetricFields(),
    impressions: IMPRESSIONS_NOT_AVAILABLE,
    reason
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
    if (isAbortOrTimeout(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`request timed out after ${timeoutMs}ms: ${message}`);
    }
    throw error;
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
// OAuth helper. If either copy drifts, token refresh can succeed in upload
// and fail in analytics (or the reverse) until both are updated together.
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

function parseMetricValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function metricsFromAnalyticsPayload(payload: unknown): {
  metrics_status: YouTubeMetricsStatus;
  views: number | null;
  estimated_minutes_watched: number | null;
  average_view_duration_seconds: number | null;
  average_view_percentage: number | null;
  reason?: string;
} {
  const analytics = payload as {
    columnHeaders?: Array<{ name?: string }>;
    rows?: unknown[][];
  };
  const headers = analytics.columnHeaders;
  const rows = analytics.rows;
  if (!rows || rows.length === 0) {
    return {
      metrics_status: "pending",
      ...nullMetricFields(),
      reason: "analytics rows not available yet"
    };
  }
  const row = rows[0];
  if (!headers || !row) {
    return {
      metrics_status: "unmeasured",
      ...nullMetricFields(),
      reason: "analytics row was missing headers or values"
    };
  }

  const parsed: Record<(typeof METRIC_COLUMNS)[number][1], number> = {
    views: Number.NaN,
    estimated_minutes_watched: Number.NaN,
    average_view_duration_seconds: Number.NaN,
    average_view_percentage: Number.NaN
  };

  for (const [column, field] of METRIC_COLUMNS) {
    const index = headers.findIndex((header) => header.name === column);
    if (index < 0) {
      return {
        metrics_status: "unmeasured",
        ...nullMetricFields(),
        reason: `missing metric column ${column}`
      };
    }
    const value = parseMetricValue(row[index]);
    if (value === null) {
      return {
        metrics_status: "unmeasured",
        ...nullMetricFields(),
        reason: `non-numeric ${column}`
      };
    }
    parsed[field] = value;
  }

  return {
    metrics_status: "measured",
    views: parsed.views,
    estimated_minutes_watched: parsed.estimated_minutes_watched,
    average_view_duration_seconds: parsed.average_view_duration_seconds,
    average_view_percentage: parsed.average_view_percentage
  };
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

async function fetchVideoStatuses(input: {
  ids: string[];
  token: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  budgetMs: number;
  startedMs: number;
  nowMs: () => number;
}): Promise<Map<string, VideoStatusRecord>> {
  const map = new Map<string, VideoStatusRecord>();
  const auth = { Authorization: `Bearer ${input.token}` };

  const request = async (idParam: string): Promise<unknown> => {
    const videosUrl = new URL(VIDEOS_URL);
    videosUrl.searchParams.set("part", "status");
    videosUrl.searchParams.set("id", idParam);
    return fetchJson(input.fetchImpl, videosUrl.toString(), { headers: auth }, input.timeoutMs);
  };

  const applySuccessPayload = (batchIds: string[], payload: unknown): void => {
    const items =
      (
        payload as {
          items?: Array<{ id?: string; status?: { privacyStatus?: string; uploadStatus?: string } }>;
        }
      ).items ?? [];
    const found = new Set<string>();
    for (const item of items) {
      if (!item.id) continue;
      found.add(item.id);
      map.set(item.id, {
        privacy_status: item.status?.privacyStatus ?? null,
        upload_status: item.status?.uploadStatus ?? null
      });
    }
    for (const id of batchIds) {
      if (!found.has(id)) {
        map.set(id, { privacy_status: "not-found", upload_status: "not-found" });
      }
    }
  };

  const markRequestFailure = (batchIds: string[], error: unknown): void => {
    const status_reason = reasonFromError(error);
    for (const id of batchIds) {
      map.set(id, { privacy_status: null, upload_status: null, status_reason });
    }
  };

  for (let offset = 0; offset < input.ids.length; offset += VIDEO_STATUS_BATCH_SIZE) {
    const slice = input.ids.slice(offset, offset + VIDEO_STATUS_BATCH_SIZE);
    if (input.nowMs() - input.startedMs >= input.budgetMs) {
      for (const id of input.ids.slice(offset)) {
        map.set(id, { privacy_status: null, upload_status: null, status_reason: "budget exhausted" });
      }
      break;
    }
    try {
      applySuccessPayload(slice, await request(slice.join(",")));
    } catch (error) {
      markRequestFailure(slice, error);
    }
  }

  return map;
}

async function fetchAnalyticsMetrics(input: {
  entry: YouTubeLogEntry;
  endDate: string;
  token: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<ReturnType<typeof metricsFromAnalyticsPayload>> {
  const videoId = (input.entry.video_id ?? "").trim();
  const analyticsUrl = new URL(ANALYTICS_URL);
  analyticsUrl.searchParams.set("ids", "channel==MINE");
  analyticsUrl.searchParams.set("startDate", analyticsQueryStartDate(input.entry, input.endDate));
  analyticsUrl.searchParams.set("endDate", input.endDate);
  analyticsUrl.searchParams.set(
    "metrics",
    "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage"
  );
  analyticsUrl.searchParams.set("dimensions", "video");
  analyticsUrl.searchParams.set("filters", `video==${videoId}`);

  const payload = await fetchJson(
    input.fetchImpl,
    analyticsUrl.toString(),
    { headers: { Authorization: `Bearer ${input.token}` } },
    input.timeoutMs
  );
  return metricsFromAnalyticsPayload(payload);
}

export async function collectYouTubeAnalytics(input: {
  date: string;
  root?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  collectionBudgetMs?: number;
  nowMs?: () => number;
}): Promise<YouTubeAnalyticsReport> {
  const root = projectRoot(input.root);
  const date = input.date;
  const fetched_at = new Date().toISOString();
  const timeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const budgetMs = input.collectionBudgetMs ?? DEFAULT_COLLECTION_BUDGET_MS;
  const nowMs = input.nowMs ?? Date.now;
  const fetchImpl = input.fetchImpl ?? fetch;
  const env = input.env ?? process.env;
  const path = youtubeAnalyticsPath(date, root);
  const startedMs = nowMs();

  const persist = async (
    report: YouTubeAnalyticsReport,
    failureReason?: string
  ): Promise<YouTubeAnalyticsReport> => {
    const existing = await readExistingVideos(path);
    const { videos: mergedVideos, mergedExistingRows } = mergeVideoRows(existing, report.videos);
    const status: YouTubeReportStatus =
      mergedVideos.length === 0 && failureReason ? "unmeasured" : deriveReportStatus(mergedVideos);
    const next: YouTubeAnalyticsReport = {
      date,
      fetched_at,
      status,
      videos: mergedVideos,
      merged_existing_rows: mergedExistingRows
    };
    const reason = composeReportReason(mergedVideos) ?? failureReason;
    if (reason) next.reason = reason;
    await writeJsonAtomic(path, next);
    return next;
  };

  const persistFromVideos = async (
    videos: YouTubeAnalyticsVideoRow[]
  ): Promise<YouTubeAnalyticsReport> => {
    return persist({ date, fetched_at, status: deriveReportStatus(videos), videos });
  };

  let videos: YouTubeAnalyticsVideoRow[] | undefined;

  try {
    const entries = await loadWindowEntries(root, date);
    if (entries.length === 0) {
      return persistFromVideos([]);
    }

    const creds = credentials(env);
    if (creds.missing.length > 0) {
      const reason =
        `YouTube Analytics is not configured (missing ${creds.missing.join(", ")}). ` +
        `Next: run npm run youtube-auth to grant youtube.upload youtube.readonly yt-analytics.readonly.`;
      videos = entries.map((entry) =>
        placeholderRow(entry, reason)
      );
      for (const video of videos) {
        video.metrics_status = "unmeasured";
      }
      return persistFromVideos(videos);
    }

    videos = entries.map((entry) => placeholderRow(entry, "collection in progress"));
    await persistFromVideos(videos);

    let token: string;
    try {
      token = await accessToken(fetchImpl, creds, timeoutMs);
    } catch (error) {
      const reason = reasonFromError(error);
      for (const video of videos) {
        video.metrics_status = "unmeasured";
        video.reason = reason;
        Object.assign(video, nullMetricFields());
      }
      return persistFromVideos(videos);
    }

    const statuses = await fetchVideoStatuses({
      ids: videos.map((video) => video.video_id),
      token,
      fetchImpl,
      timeoutMs,
      budgetMs,
      startedMs,
      nowMs
    });
    for (const video of videos) {
      const status = statuses.get(video.video_id);
      video.privacy_status = status?.privacy_status ?? null;
      video.upload_status = status?.upload_status ?? null;
      if (status?.status_reason) {
        video.status_reason = status.status_reason;
      }
    }
    await persistFromVideos(videos);

    for (let index = 0; index < videos.length; index += 1) {
      const current = videos[index];
      const entry = entries[index];
      if (!current || !entry) continue;

      if (nowMs() - startedMs >= budgetMs) {
        for (let rest = index; rest < videos.length; rest += 1) {
          const leftover = videos[rest];
          if (!leftover) continue;
          leftover.metrics_status = "pending";
          leftover.reason = "budget exhausted";
          Object.assign(leftover, nullMetricFields());
        }
        return persistFromVideos(videos);
      }

      try {
        const metrics = await fetchAnalyticsMetrics({
          entry,
          endDate: date,
          token,
          fetchImpl,
          timeoutMs
        });
        current.metrics_status = metrics.metrics_status;
        current.views = metrics.views;
        current.estimated_minutes_watched = metrics.estimated_minutes_watched;
        current.average_view_duration_seconds = metrics.average_view_duration_seconds;
        current.average_view_percentage = metrics.average_view_percentage;
        current.impressions = IMPRESSIONS_NOT_AVAILABLE;
        if (metrics.reason) current.reason = metrics.reason;
        else delete current.reason;
      } catch (error) {
        current.metrics_status = "unmeasured";
        Object.assign(current, nullMetricFields());
        current.impressions = IMPRESSIONS_NOT_AVAILABLE;
        current.reason = reasonFromError(error);
      }
      await persistFromVideos(videos);
    }

    return persistFromVideos(videos);
  } catch (error) {
    const reason = reasonFromError(error);
    if (videos && videos.length > 0) {
      for (const video of videos) {
        if (video.metrics_status === "pending" && video.reason === "collection in progress") {
          video.metrics_status = "unmeasured";
          video.reason = reason;
          Object.assign(video, nullMetricFields());
        }
      }
      return persistFromVideos(videos);
    }
    return persist({ date, fetched_at, status: "unmeasured", videos: [] }, reason);
  }
}

export async function runCli(
  args: string[],
  deps: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
    now?: Date;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
  } = {}
): Promise<{ report: YouTubeAnalyticsReport; exitCode: number }> {
  const date = getOption(args, "date") ?? getZonedDateParts(deps.now ?? new Date(), "Asia/Taipei").date;
  const report = await collectYouTubeAnalytics({
    date,
    root: getOption(args, "root"),
    env: deps.env,
    fetchImpl: deps.fetchImpl,
    requestTimeoutMs: deps.requestTimeoutMs
  });
  (deps.stdout ?? console.log)(JSON.stringify(report, null, 2));
  if ((report.merged_existing_rows ?? 0) > 0) {
    (deps.stderr ?? console.error)(
      `[youtube-analytics] merged ${report.merged_existing_rows} existing rows`
    );
  }
  const exitCode = report.status === "unmeasured" && !getFlag(args, "no-fail") ? 1 : 0;
  return { report, exitCode };
}

async function main(): Promise<void> {
  const { exitCode } = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
