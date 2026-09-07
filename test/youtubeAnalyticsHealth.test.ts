import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectYouTubeAnalytics,
  IMPRESSIONS_NOT_AVAILABLE,
  youtubeAnalyticsPath,
  type YouTubeAnalyticsReport,
  type YouTubeAnalyticsVideoRow
} from "../src/youtubeAnalytics";
import {
  checkYouTubeAnalyticsHealth,
  evaluateYouTubeAnalyticsHealth,
  runCli,
  youtubeAnalyticsReportPath
} from "../src/youtubeAnalyticsHealth";

const DATE = "2026-09-05";
const PREVIOUS_DATE = "2026-09-04";
const CONFIGURED = {
  YT_CLIENT_ID: "client",
  YT_CLIENT_SECRET: "secret",
  YT_REFRESH_TOKEN: "refresh"
} as NodeJS.ProcessEnv;

const ANALYTICS_HEADERS = [
  { name: "video", columnType: "DIMENSION", dataType: "STRING" },
  { name: "views", columnType: "METRIC", dataType: "INTEGER" },
  { name: "estimatedMinutesWatched", columnType: "METRIC", dataType: "INTEGER" },
  { name: "averageViewDuration", columnType: "METRIC", dataType: "INTEGER" },
  { name: "averageViewPercentage", columnType: "METRIC", dataType: "FLOAT" }
];

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "yt-health-"));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function googleFetch(handlers: {
  analytics?: (videoId: string) => Response;
  videos?: (ids: string[]) => Response;
} = {}): typeof fetch {
  return (async (url: string | URL) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "token" });
    }
    if (target.includes("youtubeanalytics.googleapis.com")) {
      const videoId =
        new URL(target).searchParams.get("filters")?.replace(/^video==/u, "") ?? "";
      if (handlers.analytics) return handlers.analytics(videoId);
      return jsonResponse({
        columnHeaders: ANALYTICS_HEADERS,
        rows: [[videoId, 99, 9, 90, 90.5]]
      });
    }
    if (target.includes("/youtube/v3/videos")) {
      const ids = (new URL(target).searchParams.get("id") ?? "").split(",").filter(Boolean);
      if (handlers.videos) return handlers.videos(ids);
      return jsonResponse({
        items: ids.map((id) => ({
          id,
          status: { privacyStatus: "public", uploadStatus: "processed" }
        }))
      });
    }
    throw new Error(`unexpected url: ${target}`);
  }) as unknown as typeof fetch;
}

// Exactly what the collector sees when the yt-analytics.readonly scope is gone:
// the token still mints, videos.list still answers, every Analytics call 403s.
function analyticsForbidden(): Response {
  return jsonResponse(
    { error: { message: "Request had insufficient authentication scopes." } },
    403
  );
}

async function writeLog(entries: unknown[], date = DATE): Promise<void> {
  const dir = join(root, "data", "youtube-log");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${date}.json`), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function logEntry(videoId: string): Record<string, unknown> {
  return {
    date: DATE,
    slot: 2,
    video_id: videoId,
    title: videoId,
    uploaded_at: "2026-09-01T12:00:00.000Z",
    scheduled_publish_at: "2026-09-01T12:45:00Z"
  };
}

function measuredRow(videoId: string, views: number): YouTubeAnalyticsVideoRow {
  return {
    video_id: videoId,
    title: videoId,
    published_at: "2026-09-01T12:45:00Z",
    privacy_status: "public",
    upload_status: "processed",
    metrics_status: "measured",
    views,
    estimated_minutes_watched: views * 2,
    average_view_duration_seconds: 41,
    average_view_percentage: 63.5,
    impressions: IMPRESSIONS_NOT_AVAILABLE
  };
}

function reportOf(
  videos: YouTubeAnalyticsVideoRow[],
  overrides: Partial<YouTubeAnalyticsReport> = {}
): YouTubeAnalyticsReport {
  return {
    date: DATE,
    fetched_at: "2026-09-05T14:05:00.000Z",
    status: "measured",
    run_failed: false,
    videos,
    merged_existing_rows: 0,
    ...overrides
  };
}

async function writeReport(report: YouTubeAnalyticsReport, date = DATE): Promise<string> {
  const path = youtubeAnalyticsPath(date, root);
  await mkdir(join(root, "data", "insights", "youtube"), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}

async function readSavedReport(date = DATE): Promise<YouTubeAnalyticsReport> {
  return JSON.parse(
    await readFile(youtubeAnalyticsPath(date, root), "utf8")
  ) as YouTubeAnalyticsReport;
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

describe("youtube analytics health: the all-analytics-403 blind spot", () => {
  // The finding this file exists for. Same-day file already holds fully
  // measured rows; this run's Analytics calls all 403; the merge keeps the old
  // rows (by design, not changed here) and the report reads perfectly healthy.
  async function runTheBlindSpot(): Promise<YouTubeAnalyticsReport> {
    await writeLog([logEntry("vid-a"), logEntry("vid-b")]);
    await writeReport(reportOf([measuredRow("vid-a", 12), measuredRow("vid-b", 34)]));
    await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({ analytics: () => analyticsForbidden() }),
      stdout: () => undefined
    });
    return readSavedReport();
  }

  it("leaves no run-level signal in the report the collector writes", async () => {
    const saved = await runTheBlindSpot();

    // Everything a reader would normally check says the day is fine.
    expect(saved.status).toBe("measured");
    expect(saved.run_failed).toBe(false);
    expect(saved.run_failure_reason).toBeUndefined();
    expect(saved.reason).toBeUndefined();
    for (const video of saved.videos) {
      expect(video.metrics_status).toBe("measured");
      expect(video.reason).toBeUndefined();
      expect(video.status_reason).toBeUndefined();
    }
    // The stored numbers survived untouched, and the only trace of the outage
    // is this counter.
    expect(saved.videos.map((video) => video.views)).toEqual([12, 34]);
    expect(saved.merged_existing_rows).toBe(saved.videos.length);
  });

  it("is flagged by the health check", async () => {
    await runTheBlindSpot();

    const health = await checkYouTubeAnalyticsHealth({
      date: DATE,
      root,
      now: new Date("2026-09-05T23:10:00.000Z")
    });

    expect(health.ok).toBe(false);
    expect(codes(health.findings)).toContain("no_fresh_measurements");
    expect(health.findings[0]?.detail).toContain("merged_existing_rows=2");
    expect(health.findings[0]?.detail).toContain("status=measured");
    expect(health.summary).toContain("FAIL");
    expect(health.toast).toContain("一支都沒量到");
  });

  it("exits non-zero and prints a toast line through the CLI", async () => {
    await runTheBlindSpot();
    const out: string[] = [];
    const err: string[] = [];

    const { exitCode, result } = await runCli(["--date", DATE, "--root", root], {
      now: new Date("2026-09-05T23:10:00.000Z"),
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line)
    });

    expect(exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(out.some((line) => line.startsWith("TOAST|"))).toBe(true);
    expect(out.some((line) => line.includes("FAIL"))).toBe(true);
    expect(err.join("\n")).toContain("no_fresh_measurements");
  });

  // Discrimination: remove the outage and the same check must go green, or the
  // finding above proves nothing.
  it("stays green on the same day when the analytics calls succeed", async () => {
    await writeLog([logEntry("vid-a"), logEntry("vid-b")]);
    await writeReport(reportOf([measuredRow("vid-a", 12), measuredRow("vid-b", 34)]));
    await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch(),
      stdout: () => undefined
    });

    const saved = await readSavedReport();
    expect(saved.merged_existing_rows).toBe(0);
    expect(saved.videos.map((video) => video.views)).toEqual([99, 99]);

    const out: string[] = [];
    const { exitCode, result } = await runCli(["--date", DATE, "--root", root], {
      now: new Date("2026-09-05T23:10:00.000Z"),
      stdout: (line) => out.push(line),
      stderr: () => undefined
    });

    expect(result.findings).toEqual([]);
    expect(exitCode).toBe(0);
    expect(out.some((line) => line.includes("OK"))).toBe(true);
  });

  // Same outage, but nothing measured was on disk to hide behind: the 403
  // reason survives on the rows, so the auth finding fires instead.
  it("reports the auth failure when there is no stored row to mask it", async () => {
    await writeLog([logEntry("vid-a")]);
    await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({ analytics: () => analyticsForbidden() }),
      stdout: () => undefined
    });

    const health = await checkYouTubeAnalyticsHealth({
      date: DATE,
      root,
      now: new Date("2026-09-05T23:10:00.000Z")
    });

    expect(health.ok).toBe(false);
    expect(codes(health.findings)).toContain("auth_scope_failure");
    expect(health.toast).toContain("youtube-auth");
  });
});

describe("youtube analytics health: file-level checks", () => {
  it("flags a report older than the age limit", async () => {
    const path = await writeReport(reportOf([measuredRow("vid-a", 12)]));
    const old = new Date("2026-09-04T02:00:00.000Z");
    await utimes(path, old, old);

    const health = await checkYouTubeAnalyticsHealth({
      date: DATE,
      root,
      now: new Date("2026-09-05T23:10:00.000Z")
    });

    expect(codes(health.findings)).toContain("report_stale");
    expect(health.age_hours).toBeGreaterThan(26);
    expect(health.toast).toContain("26 小時");
  });

  it("does not flag a report inside the age limit", async () => {
    const path = await writeReport(reportOf([measuredRow("vid-a", 12)]));
    const recent = new Date("2026-09-05T23:00:00.000Z");
    await utimes(path, recent, recent);

    const health = await checkYouTubeAnalyticsHealth({
      date: DATE,
      root,
      now: new Date("2026-09-05T23:10:00.000Z")
    });

    expect(health.ok).toBe(true);
    expect(health.age_hours).toBeLessThan(1);
  });

  it("flags a missing report", async () => {
    const health = await checkYouTubeAnalyticsHealth({ date: DATE, root });
    expect(codes(health.findings)).toEqual(["report_missing"]);
    expect(health.age_hours).toBeNull();
  });

  it("flags an unreadable report instead of passing it as healthy", async () => {
    await mkdir(join(root, "data", "insights", "youtube"), { recursive: true });
    await writeFile(youtubeAnalyticsPath(DATE, root), "{not-json\n", "utf8");

    const health = await checkYouTubeAnalyticsHealth({ date: DATE, root });
    expect(codes(health.findings)).toEqual(["report_unreadable"]);
  });

  it("flags a report whose videos key is not an array", async () => {
    await mkdir(join(root, "data", "insights", "youtube"), { recursive: true });
    await writeFile(
      youtubeAnalyticsPath(DATE, root),
      JSON.stringify({ date: DATE, status: "measured", videos: null }),
      "utf8"
    );

    const health = await checkYouTubeAnalyticsHealth({ date: DATE, root });
    expect(codes(health.findings)).toEqual(["report_unreadable"]);
  });

  it("names the previous day's report when the kept metrics match it byte for byte", async () => {
    await writeReport(reportOf([measuredRow("vid-a", 12)]), PREVIOUS_DATE);
    await writeReport(
      reportOf([measuredRow("vid-a", 12)], { merged_existing_rows: 1 })
    );

    const health = await checkYouTubeAnalyticsHealth({
      date: DATE,
      root,
      now: new Date("2026-09-05T23:10:00.000Z")
    });

    expect(codes(health.findings)).toContain("no_fresh_measurements");
    expect(health.baseline_date).toBe(PREVIOUS_DATE);
    expect(health.findings[0]?.detail).toContain(`byte-identical to ${PREVIOUS_DATE}`);
  });

  it("still flags the freeze when the previous day's numbers differ", async () => {
    await writeReport(reportOf([measuredRow("vid-a", 5)]), PREVIOUS_DATE);
    await writeReport(
      reportOf([measuredRow("vid-a", 12)], { merged_existing_rows: 1 })
    );

    const health = await checkYouTubeAnalyticsHealth({
      date: DATE,
      root,
      now: new Date("2026-09-05T23:10:00.000Z")
    });

    expect(codes(health.findings)).toContain("no_fresh_measurements");
    expect(health.findings[0]?.detail).toContain(`differ from ${PREVIOUS_DATE}`);
  });
});

describe("youtube analytics health: independence from the collector module", () => {
  // The checker copies the report path rather than importing it, so that a
  // missing .env cannot kill it at import time. This is the guard against the
  // copy drifting away from the collector's own path.
  it("resolves the same report path the collector writes", () => {
    expect(youtubeAnalyticsReportPath(DATE, root)).toBe(youtubeAnalyticsPath(DATE, root));
    expect(youtubeAnalyticsReportPath(PREVIOUS_DATE, root)).toBe(
      youtubeAnalyticsPath(PREVIOUS_DATE, root)
    );
  });

  it("imports no module that reads config at load time", async () => {
    const source = await readFile(
      new URL("../src/youtubeAnalyticsHealth.ts", import.meta.url),
      "utf8"
    );
    const valueImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gmu)].map(
      (match) => match[1]
    );
    expect(valueImports.sort()).toEqual(["./cli", "./paths", "./scheduler", "node:fs/promises", "node:path"]);
  });
});

describe("youtube analytics health: verdict rules", () => {
  const base = { date: DATE, path: "report.json", ageHours: 1 };

  it("passes a clean report", () => {
    const health = evaluateYouTubeAnalyticsHealth({
      ...base,
      report: reportOf([measuredRow("vid-a", 12)])
    });
    expect(health.ok).toBe(true);
    expect(health.summary).toContain("OK");
    expect(health.toast).toContain("正常");
  });

  it("does not flag an empty window as a frozen merge", () => {
    const health = evaluateYouTubeAnalyticsHealth({
      ...base,
      report: reportOf([], { merged_existing_rows: 0 })
    });
    expect(health.ok).toBe(true);
  });

  it("flags run_failed even when every row still reads measured", () => {
    const health = evaluateYouTubeAnalyticsHealth({
      ...base,
      report: reportOf([measuredRow("vid-a", 12)], {
        run_failed: true,
        run_failure_reason: "token refresh failed"
      })
    });
    expect(codes(health.findings)).toContain("run_failed");
    expect(health.findings.at(-1)?.detail).toContain("token refresh failed");
  });

  it("flags a 403 hiding in a row's status_reason", () => {
    const row = measuredRow("vid-a", 12);
    row.status_reason = "HTTP 403: The caller does not have permission";
    const health = evaluateYouTubeAnalyticsHealth({ ...base, report: reportOf([row]) });
    expect(codes(health.findings)).toEqual(["auth_scope_failure"]);
    expect(health.findings[0]?.detail).toContain("vid-a");
  });

  it("does not read an unrelated number as an auth failure", () => {
    const row = measuredRow("vid-a", 12);
    row.reason = "analytics rows not available yet (1403 pending)";
    const health = evaluateYouTubeAnalyticsHealth({ ...base, report: reportOf([row]) });
    expect(codes(health.findings)).not.toContain("auth_scope_failure");
  });

  it("orders the toast by the finding a human should act on first", () => {
    const row = measuredRow("vid-a", 12);
    row.reason = "HTTP 401: Invalid Credentials";
    const health = evaluateYouTubeAnalyticsHealth({
      ...base,
      ageHours: 40,
      report: reportOf([row], { merged_existing_rows: 1, run_failed: true })
    });
    expect(codes(health.findings)).toEqual([
      "report_stale",
      "auth_scope_failure",
      "no_fresh_measurements",
      "run_failed"
    ]);
    expect(health.toast).toContain("26 小時");
    expect(health.toast).toContain("共 4 項");
  });

  it("treats an all-null baseline match as no baseline at all", () => {
    const empty: YouTubeAnalyticsVideoRow = {
      ...measuredRow("vid-a", 0),
      metrics_status: "unmeasured",
      views: null,
      estimated_minutes_watched: null,
      average_view_duration_seconds: null,
      average_view_percentage: null
    };
    const health = evaluateYouTubeAnalyticsHealth({
      ...base,
      report: reportOf([empty], { merged_existing_rows: 1 }),
      baseline: { date: PREVIOUS_DATE, videos: [empty] }
    });
    expect(health.findings[0]?.detail).toContain("no comparable earlier report");
  });
});
