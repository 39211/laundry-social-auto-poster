import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
// Types only, deliberately. A value import from youtubeAnalytics.ts drags in
// logging.ts -> contentPlan.ts, whose module body throws when
// PUBLIC_SITE_BASE_URL is unset -- so a degraded environment would kill the
// checker at import time, exactly when it is supposed to speak up. The report
// path is therefore duplicated below and pinned to youtubeAnalyticsPath by a
// test instead.
import type { YouTubeAnalyticsReport, YouTubeAnalyticsVideoRow } from "./youtubeAnalytics";

// Independent health check over data/insights/youtube/<date>.json. It reads
// what the collector wrote; it never re-collects and never rewrites the report.
//
// Why it exists: when videos.list succeeds but every per-video Analytics call
// fails (the yt-analytics.readonly scope dropped, say) and the same-day file
// already holds fully measured rows from an earlier run, the collector's merge
// keeps those older rows -- correct, that is the point of the merge -- but the
// resulting file reads status "measured", no reason, run_failed false, exit 0.
// The only trace left is merged_existing_rows == videos.length, and nothing
// looked at it. The merge stays as it is (stop-loss decision); this file is the
// separate pair of eyes.

export const DEFAULT_MAX_REPORT_AGE_HOURS = 26;

// Same shapes reasonFromError / reasonSeverity treat as an auth failure in
// youtubeAnalytics.ts. \b keeps "1403" or a duration of 401 seconds out.
const AUTH_FAILURE_PATTERN = /\b40[13]\b|insufficient|scope/i;
const REPORT_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DETAIL_MESSAGE_LIMIT = 160;

const METRIC_FIELDS = [
  "views",
  "estimated_minutes_watched",
  "average_view_duration_seconds",
  "average_view_percentage"
] as const;

export type YouTubeHealthCode =
  | "report_missing"
  | "report_unreadable"
  | "report_stale"
  | "auth_scope_failure"
  | "no_fresh_measurements"
  | "run_failed";

// Toast order: the leading finding is the one a human should act on first.
const CODE_SEVERITY: Record<YouTubeHealthCode, number> = {
  report_missing: 60,
  report_unreadable: 50,
  report_stale: 40,
  auth_scope_failure: 30,
  no_fresh_measurements: 20,
  run_failed: 10
};

const CODE_TOAST: Record<YouTubeHealthCode, string> = {
  report_missing: "今天的 YouTube 數據檔沒生出來,收集器等於沒跑。",
  report_unreadable: "YouTube 數據檔讀不了,今天的數據狀態不明,快看 log。",
  report_stale: "YouTube 數據檔超過 26 小時沒更新,排程可能停了。",
  auth_scope_failure:
    "YouTube Analytics 權限掉了(401/403),跑 npm run youtube-auth 重新授權 yt-analytics.readonly。",
  no_fresh_measurements:
    "YouTube 今天一支都沒量到,檔案全是舊值,status 卻寫 measured——別把它當今天的數據。",
  run_failed: "YouTube 數據收集失敗,看 run_failure_reason。"
};

export interface YouTubeHealthFinding {
  code: YouTubeHealthCode;
  detail: string;
}

export interface YouTubeAnalyticsHealthResult {
  date: string;
  path: string;
  ok: boolean;
  checked_at: string;
  age_hours: number | null;
  baseline_date?: string;
  findings: YouTubeHealthFinding[];
  summary: string;
  toast: string;
}

/** Must stay equal to youtubeAnalytics.ts youtubeAnalyticsPath; a test asserts it. */
export function youtubeAnalyticsReportPath(date: string, root = projectRoot()): string {
  return join(root, "data", "insights", "youtube", `${date}.json`);
}

export interface YouTubeHealthBaseline {
  date: string;
  videos: YouTubeAnalyticsVideoRow[];
}

function truncate(message: string): string {
  const collapsed = message.replace(/\s+/gu, " ").trim();
  return collapsed.length > DETAIL_MESSAGE_LIMIT
    ? `${collapsed.slice(0, DETAIL_MESSAGE_LIMIT - 1)}…`
    : collapsed;
}

function looksLikeAuthFailure(message: string | undefined): boolean {
  return Boolean(message) && AUTH_FAILURE_PATTERN.test(message as string);
}

// Byte-identical in the sense that matters here: the four metric numbers, in a
// fixed order, serialised the same way. Titles and statuses are allowed to move.
function metricsFingerprint(video: YouTubeAnalyticsVideoRow): string {
  return JSON.stringify(METRIC_FIELDS.map((field) => video[field] ?? null));
}

function hasAnyMetricValue(video: YouTubeAnalyticsVideoRow): boolean {
  return METRIC_FIELDS.some((field) => video[field] !== null && video[field] !== undefined);
}

type BaselineComparison = "identical" | "differs" | "unavailable";

function compareToBaseline(
  videos: YouTubeAnalyticsVideoRow[],
  baseline: YouTubeHealthBaseline | undefined
): BaselineComparison {
  if (!baseline || baseline.videos.length === 0 || videos.length === 0) return "unavailable";
  const byId = new Map(baseline.videos.map((video) => [video.video_id, video]));
  let compared = 0;
  for (const video of videos) {
    const previous = byId.get(video.video_id);
    if (!previous) return "unavailable";
    if (metricsFingerprint(video) !== metricsFingerprint(previous)) return "differs";
    if (hasAnyMetricValue(video)) compared += 1;
  }
  // All-null metrics on both sides carry no information; do not call that a match.
  return compared > 0 ? "identical" : "unavailable";
}

function collectAuthFailureMessages(report: YouTubeAnalyticsReport): {
  messages: string[];
  videoIds: string[];
} {
  const messages: string[] = [];
  const videoIds: string[] = [];
  for (const message of [report.run_failure_reason, report.reason]) {
    if (looksLikeAuthFailure(message) && message) messages.push(message);
  }
  for (const video of report.videos ?? []) {
    const hit = [video.reason, video.status_reason].find((message) => looksLikeAuthFailure(message));
    if (hit) {
      messages.push(hit);
      videoIds.push(video.video_id);
    }
  }
  return { messages, videoIds };
}

function summarise(result: Omit<YouTubeAnalyticsHealthResult, "summary" | "toast">, videoCount: number, status: string): string {
  if (result.ok) {
    return `youtube-analytics-health ${result.date}: OK (videos=${videoCount}, status=${status}, age=${formatAge(result.age_hours)})`;
  }
  const codes = result.findings.map((finding) => finding.code).join(",");
  return `youtube-analytics-health ${result.date}: FAIL ${result.findings.length} finding(s) [${codes}] (videos=${videoCount}, status=${status}, age=${formatAge(result.age_hours)})`;
}

function formatAge(ageHours: number | null): string {
  return ageHours === null ? "unknown" : `${ageHours.toFixed(1)}h`;
}

/**
 * Pure verdict over one already-read report. Every IO decision (which file,
 * which baseline, how old) is made by the caller so tests can drive the exact
 * combinations the collector can produce.
 */
export function evaluateYouTubeAnalyticsHealth(input: {
  date: string;
  path: string;
  report?: YouTubeAnalyticsReport;
  readError?: string;
  ageHours: number | null;
  baseline?: YouTubeHealthBaseline;
  maxAgeHours?: number;
  checkedAt?: string;
}): YouTubeAnalyticsHealthResult {
  const maxAgeHours = input.maxAgeHours ?? DEFAULT_MAX_REPORT_AGE_HOURS;
  const findings: YouTubeHealthFinding[] = [];
  const report = input.report;
  const videos = report?.videos ?? [];
  const status = report?.status ?? "unknown";

  if (input.readError) {
    findings.push({ code: "report_unreadable", detail: truncate(input.readError) });
  } else if (!report) {
    findings.push({
      code: "report_missing",
      detail: `no report at ${input.path}; the collector wrote nothing for ${input.date}`
    });
  } else {
    if (input.ageHours !== null && input.ageHours > maxAgeHours) {
      findings.push({
        code: "report_stale",
        detail: `report file last written ${input.ageHours.toFixed(1)}h ago (limit ${maxAgeHours}h)`
      });
    }

    const auth = collectAuthFailureMessages(report);
    if (auth.messages.length > 0) {
      const sample = auth.videoIds.slice(0, 3).join(", ");
      const scope = auth.videoIds.length > 0 ? `${auth.videoIds.length} video(s)` : "run level";
      findings.push({
        code: "auth_scope_failure",
        detail: `${scope}${sample ? ` (${sample}${auth.videoIds.length > 3 ? ", …" : ""})` : ""} reported an auth/scope failure: ${truncate(auth.messages[0] as string)}`
      });
    }

    // The reported defect. merged_existing_rows == videos.length means every
    // single row's metrics came off disk, so this run measured nothing at all --
    // yet status/reason/run_failed can still read clean. Fresh measurements
    // always win the merge at equal quality, so a healthy run cannot land here.
    const mergedExistingRows = report.merged_existing_rows ?? 0;
    if (videos.length > 0 && mergedExistingRows === videos.length) {
      const comparison = compareToBaseline(videos, input.baseline);
      // Byte-identity against the previous report corroborates the freeze; it
      // cannot gate the finding, because the kept rows usually come from an
      // earlier run of the SAME day and legitimately differ from yesterday.
      const evidence =
        comparison === "identical"
          ? `metrics byte-identical to ${input.baseline?.date}`
          : comparison === "differs"
            ? `metrics differ from ${input.baseline?.date}`
            : "no comparable earlier report";
      findings.push({
        code: "no_fresh_measurements",
        detail: `merged_existing_rows=${mergedExistingRows} equals videos=${videos.length}; every row kept its stored metrics while the report reads status=${report.status}, run_failed=${report.run_failed}; ${evidence}`
      });
    }

    if (report.run_failed) {
      findings.push({
        code: "run_failed",
        detail: truncate(report.run_failure_reason ?? report.reason ?? "run_failed with no reason recorded")
      });
    }
  }

  findings.sort((left, right) => CODE_SEVERITY[right.code] - CODE_SEVERITY[left.code]);

  const base: Omit<YouTubeAnalyticsHealthResult, "summary" | "toast"> = {
    date: input.date,
    path: input.path,
    ok: findings.length === 0,
    checked_at: input.checkedAt ?? new Date().toISOString(),
    age_hours: input.ageHours,
    findings
  };
  if (input.baseline) base.baseline_date = input.baseline.date;

  const lead = findings[0];
  const toast = lead
    ? `${CODE_TOAST[lead.code]}${findings.length > 1 ? `(共 ${findings.length} 項)` : ""}`
    : `YouTube 數據檔正常 (${videos.length} 支, status=${status})。`;

  return { ...base, summary: summarise(base, videos.length, status), toast };
}

function asReport(value: unknown): YouTubeAnalyticsReport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const report = value as YouTubeAnalyticsReport;
  if (!Array.isArray(report.videos)) return undefined;
  return report;
}

async function readReport(
  path: string,
  readFileImpl: typeof readFile
): Promise<{ report?: YouTubeAnalyticsReport; readError?: string; missing?: boolean }> {
  let raw: string;
  try {
    raw = await readFileImpl(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    return { readError: `cannot read ${path}: ${(error as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/u, ""));
  } catch (error) {
    return { readError: `invalid JSON in ${path}: ${(error as Error).message}` };
  }
  const report = asReport(parsed);
  if (!report) return { readError: `unexpected report shape in ${path}: no videos array` };
  return { report };
}

// Best-effort: the newest report strictly older than `date`. Corroboration
// only, so every failure here degrades to "no baseline" rather than an alarm.
async function findBaseline(
  directory: string,
  date: string,
  deps: { readdirImpl: typeof readdir; readFileImpl: typeof readFile }
): Promise<YouTubeHealthBaseline | undefined> {
  let names: string[];
  try {
    names = await deps.readdirImpl(directory);
  } catch {
    return undefined;
  }
  const candidates = names
    .map((name) => REPORT_FILE_PATTERN.exec(name)?.[1])
    .filter((candidate): candidate is string => Boolean(candidate) && (candidate as string) < date)
    .sort();
  const previous = candidates[candidates.length - 1];
  if (!previous) return undefined;
  const { report } = await readReport(join(directory, `${previous}.json`), deps.readFileImpl);
  if (!report) return undefined;
  return { date: previous, videos: report.videos };
}

export async function checkYouTubeAnalyticsHealth(input: {
  date: string;
  root?: string;
  now?: Date;
  maxAgeHours?: number;
  readFileImpl?: typeof readFile;
  readdirImpl?: typeof readdir;
  statImpl?: typeof stat;
}): Promise<YouTubeAnalyticsHealthResult> {
  const root = projectRoot(input.root);
  const path = youtubeAnalyticsReportPath(input.date, root);
  const readFileImpl = input.readFileImpl ?? readFile;
  const readdirImpl = input.readdirImpl ?? readdir;
  const statImpl = input.statImpl ?? stat;
  const now = input.now ?? new Date();

  const { report, readError, missing } = await readReport(path, readFileImpl);

  let ageHours: number | null = null;
  if (!missing) {
    try {
      const info = await statImpl(path);
      ageHours = Math.max(0, (now.getTime() - info.mtimeMs) / 3_600_000);
    } catch {
      ageHours = null;
    }
  }

  const baseline = report
    ? await findBaseline(dirname(path), input.date, { readdirImpl, readFileImpl })
    : undefined;

  return evaluateYouTubeAnalyticsHealth({
    date: input.date,
    path,
    report,
    readError,
    ageHours,
    baseline,
    maxAgeHours: input.maxAgeHours,
    checkedAt: now.toISOString()
  });
}

export async function runCli(
  args: string[],
  deps: {
    now?: Date;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
    readFileImpl?: typeof readFile;
    readdirImpl?: typeof readdir;
    statImpl?: typeof stat;
  } = {}
): Promise<{ result: YouTubeAnalyticsHealthResult; exitCode: number }> {
  const now = deps.now ?? new Date();
  const date = getOption(args, "date") ?? getZonedDateParts(now, "Asia/Taipei").date;
  const stdout = deps.stdout ?? console.log;
  const stderr = deps.stderr ?? console.error;

  const result = await checkYouTubeAnalyticsHealth({
    date,
    root: getOption(args, "root"),
    now,
    maxAgeHours: getNumberOption(args, "max-age-hours"),
    readFileImpl: deps.readFileImpl,
    readdirImpl: deps.readdirImpl,
    statImpl: deps.statImpl
  });

  if (getFlag(args, "json")) {
    stdout(JSON.stringify(result, null, 2));
  }
  stdout(result.summary);
  for (const finding of result.findings) {
    stderr(`[youtube-analytics-health] ${finding.code}: ${finding.detail}`);
  }
  // Machine-readable line for scripts/youtube-analytics.ps1 -> Show-Toast.
  stdout(`TOAST|${result.toast}`);

  return { result, exitCode: result.ok ? 0 : 1 };
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
