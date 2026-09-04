import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectYouTubeAnalytics,
  IMPRESSIONS_NOT_AVAILABLE,
  runCli,
  youtubeAnalyticsPath,
  type YouTubeAnalyticsVideoRow
} from "../src/youtubeAnalytics";

const DATE = "2026-09-05";
const IN_WINDOW_DATE = "2026-08-09"; // DATE - 27, inside a 28-day inclusive window
const OUT_WINDOW_DATE = "2026-08-08"; // DATE - 28, outside that window
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function analyticsUrl(target: string): URL {
  return new URL(target);
}

function videoIdFromFilters(target: string): string {
  return analyticsUrl(target).searchParams.get("filters")?.replace(/^video==/, "") ?? "";
}

type FetchTrace = {
  analyticsUrls: URL[];
  videoParts: string[];
};

function emptyTrace(): FetchTrace {
  return { analyticsUrls: [], videoParts: [] };
}

function assertFetchTrace(trace: FetchTrace, endDate = DATE): void {
  for (const part of trace.videoParts) {
    expect(part).toBe("status");
    expect(part).not.toContain("statistics");
  }
  for (const parsed of trace.analyticsUrls) {
    const videoId = parsed.searchParams.get("filters")?.replace(/^video==/, "") ?? "";
    expect(parsed.searchParams.get("ids")).toBe("channel==MINE");
    expect(parsed.searchParams.get("dimensions")).toBe("video");
    expect(parsed.searchParams.get("filters")).toBe(`video==${videoId}`);
    expect(parsed.searchParams.get("startDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.searchParams.get("endDate")).toBe(endDate);
  }
}

function assertUnmeasuredNumericFields(video: YouTubeAnalyticsVideoRow | undefined): void {
  expect(video).toBeDefined();
  expect(video?.views).toBeNull();
  expect(video?.estimated_minutes_watched).toBeNull();
  expect(video?.average_view_duration_seconds).toBeNull();
  expect(video?.average_view_percentage).toBeNull();
  expect(video?.views).not.toBe(0);
  expect(video?.estimated_minutes_watched).not.toBe(0);
  expect(video?.average_view_duration_seconds).not.toBe(0);
  expect(video?.average_view_percentage).not.toBe(0);
}

function measuredAnalyticsRow(videoId: string, views = 12): unknown {
  return {
    columnHeaders: ANALYTICS_HEADERS,
    rows: [[videoId, views, 3, 45, 67.5]]
  };
}

let fetchTrace: FetchTrace = emptyTrace();

function googleFetch(handlers: {
  token?: () => Promise<Response> | Response;
  analytics?: (url: URL, init?: RequestInit) => Promise<Response> | Response;
  videos?: (ids: string[], init?: RequestInit) => Promise<Response> | Response;
}): typeof fetch {
  const trace = fetchTrace;
  return (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return handlers.token ? handlers.token() : jsonResponse({ access_token: "token" });
    }
    if (target.includes("youtubeanalytics.googleapis.com")) {
      const parsed = analyticsUrl(target);
      const videoId = videoIdFromFilters(target);
      trace.analyticsUrls.push(parsed);
      if (handlers.analytics) return handlers.analytics(parsed, init);
      return jsonResponse(measuredAnalyticsRow(videoId));
    }
    if (target.includes("/youtube/v3/videos")) {
      const parsed = new URL(target);
      trace.videoParts.push(parsed.searchParams.get("part") ?? "");
      const ids = (parsed.searchParams.get("id") ?? "").split(",").filter(Boolean);
      if (handlers.videos) return handlers.videos(ids, init);
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

function hangingFetch(): typeof fetch {
  return (async (_url: string | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason ?? new Error("aborted"));
      });
    })) as unknown as typeof fetch;
}

function createFakeClock(startMs = 0): {
  nowMs: () => number;
  advance: (deltaMs: number) => void;
} {
  let now = startMs;
  return {
    nowMs: () => now,
    advance: (deltaMs: number) => {
      now += deltaMs;
    }
  };
}

async function writeLog(root: string, date: string, entries: unknown[]): Promise<void> {
  const dir = join(root, "data", "youtube-log");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${date}.json`), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function writeCorruptWindowLog(targetRoot: string): Promise<void> {
  const dir = join(targetRoot, "data", "youtube-log");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${DATE}.json`), "{not-json\n", "utf8");
}

function logEntry(videoId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: DATE,
    slot: 2,
    video_id: videoId,
    title: extra.title ?? videoId,
    uploaded_at: extra.uploaded_at ?? "2026-09-01T12:00:00.000Z",
    scheduled_publish_at: extra.scheduled_publish_at ?? "2026-09-01T12:45:00Z",
    ...extra
  };
}

async function readSavedReport(targetRoot: string): Promise<{
  date: string;
  fetched_at: string;
  status: string;
  reason?: string;
  merged_existing_rows?: number;
  videos: YouTubeAnalyticsVideoRow[];
}> {
  return JSON.parse(await readFile(youtubeAnalyticsPath(DATE, targetRoot), "utf8")) as {
    date: string;
    fetched_at: string;
    status: string;
    reason?: string;
    merged_existing_rows?: number;
    videos: YouTubeAnalyticsVideoRow[];
  };
}

function list403() {
  return jsonResponse(
    { error: { code: 403, message: "Request had insufficient authentication scopes." } },
    403
  );
}

describe("YouTube Analytics collector", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yt-analytics-"));
    fetchTrace = emptyTrace();
  });

  afterEach(async () => {
    assertFetchTrace(fetchTrace);
    await rm(root, { recursive: true, force: true });
  });

  it("writes a measured report with API fields and Studio-only impressions as a string", async () => {
    const analyticsUrls: URL[] = [];
    const videoListCalls: string[][] = [];
    await writeLog(root, DATE, [logEntry("abc123", { title: "白鞋泛黃｜台中洗鞋" })]);
    await writeLog(root, OUT_WINDOW_DATE, [logEntry("outside-window", { title: "too old" })]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          analyticsUrls.push(url);
          return jsonResponse(measuredAnalyticsRow("abc123"));
        },
        videos: (ids) => {
          videoListCalls.push(ids);
          return jsonResponse({
            items: ids.map((id) => ({
              id,
              status: { privacyStatus: "public", uploadStatus: "processed" }
            }))
          });
        }
      })
    });

    expect(report.status).toBe("measured");
    expect(report.date).toBe(DATE);
    expect(report.videos).toHaveLength(1);
    expect(report.videos[0]).toEqual({
      video_id: "abc123",
      title: "白鞋泛黃｜台中洗鞋",
      published_at: "2026-09-01T12:45:00Z",
      privacy_status: "public",
      upload_status: "processed",
      metrics_status: "measured",
      views: 12,
      estimated_minutes_watched: 3,
      average_view_duration_seconds: 45,
      average_view_percentage: 67.5,
      impressions: IMPRESSIONS_NOT_AVAILABLE
    });
    expect(report.videos[0]?.impressions).toBe("not-available-via-api");
    expect(report.videos[0]?.impressions).not.toBe(0);
    expect(report.videos[0]?.views).toBe(12);
    expect(analyticsUrls).toHaveLength(1);
    const startDate = analyticsUrls[0]?.searchParams.get("startDate");
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startDate && startDate <= "2026-08-31").toBe(true);
    expect(videoListCalls).toEqual([["abc123"]]);

    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("measured");
    expect(saved.videos[0].impressions).toBe("not-available-via-api");
    expect(saved.videos[0].views).toBe(12);
    expect(saved.videos[0].metrics_status).toBe("measured");
  });

  it("marks 200-with-no-rows pending (nulls, not 0) and the report partial when another video measured", async () => {
    await writeLog(root, DATE, [
      logEntry("ready"),
      logEntry("waiting", { title: "same-day upload" })
    ]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "waiting") {
            return jsonResponse({ columnHeaders: ANALYTICS_HEADERS });
          }
          return jsonResponse(measuredAnalyticsRow(videoId, 9));
        }
      })
    });

    expect(report.status).toBe("partial");
    expect(report.reason).toMatch(/analytics rows not available yet/);
    expect(report.reason).toMatch(/1 videos failed/);
    expect(report.videos).toHaveLength(2);
    expect(report.videos[0]?.video_id).toBe("ready");
    expect(report.videos[0]?.metrics_status).toBe("measured");
    expect(report.videos[0]?.views).toBe(9);
    expect(report.videos[1]?.video_id).toBe("waiting");
    expect(report.videos[1]?.metrics_status).toBe("pending");
    expect(report.videos[1]?.reason).toBe("analytics rows not available yet");
    expect(report.videos[1]?.views).toBeNull();
    expect(report.videos[1]?.estimated_minutes_watched).toBeNull();
    expect(report.videos[1]?.average_view_duration_seconds).toBeNull();
    expect(report.videos[1]?.average_view_percentage).toBeNull();
    expect(report.videos[1]?.views).not.toBe(0);
    expect(report.videos[1]?.estimated_minutes_watched).not.toBe(0);
    expect(report.videos[1]?.average_view_duration_seconds).not.toBe(0);
    expect(report.videos[1]?.average_view_percentage).not.toBe(0);

    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("partial");
    expect(saved.videos[1].views).toBeNull();
    expect(saved.videos[1].views).not.toBe(0);
    expect(saved.videos[1].metrics_status).toBe("pending");
  });

  it("marks missing or non-numeric metric columns unmeasured with nulls, not 0", async () => {
    await writeLog(root, DATE, [logEntry("bad-col"), logEntry("bad-num")]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "bad-col") {
            return jsonResponse({
              columnHeaders: ANALYTICS_HEADERS.filter((header) => header.name !== "views"),
              rows: [[videoId, 3, 45, 67.5]]
            });
          }
          return jsonResponse({
            columnHeaders: ANALYTICS_HEADERS,
            rows: [[videoId, "not-a-number", 3, 45, 67.5]]
          });
        }
      })
    });

    expect(report.status).toBe("unmeasured");
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    expect(report.videos[0]?.reason).toMatch(/missing metric column views/);
    assertUnmeasuredNumericFields(report.videos[0]);
    expect(report.videos[1]?.metrics_status).toBe("unmeasured");
    expect(report.videos[1]?.reason).toMatch(/non-numeric views/);
    assertUnmeasuredNumericFields(report.videos[1]);
  });

  it("marks 403 insufficient scope on one video unmeasured and returns without throwing", async () => {
    await writeLog(root, DATE, [logEntry("abc123", { title: "short" })]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: () =>
          jsonResponse(
            { error: { code: 403, message: "Request had insufficient authentication scopes." } },
            403
          )
      })
    });

    expect(report.status).toBe("unmeasured");
    expect(report.reason).toMatch(/403/);
    expect(report.reason).toMatch(/insufficient authentication scopes/i);
    expect(report.videos).toHaveLength(1);
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    assertUnmeasuredNumericFields(report.videos[0]);
    expect(report).not.toHaveProperty("views");

    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("unmeasured");
    expect(saved.videos[0].views).toBeNull();
    expect(JSON.stringify(saved)).not.toMatch(/"views"\s*:\s*0/);
  });

  it("treats an empty youtube-log window as measured with no videos", async () => {
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    const unused = (async () => {
      throw new Error("empty window must not call Google");
    }) as unknown as typeof fetch;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: unused
    });

    expect(report.status).toBe("measured");
    expect(report.videos).toEqual([]);
    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved).toMatchObject({ date: DATE, status: "measured", videos: [] });
  });

  it("marks a hung analytics request unmeasured on that video and finishes inside 5 seconds", async () => {
    await writeLog(root, DATE, [logEntry("abc123", { title: "short" })]);
    const clock = createFakeClock();
    const started = Date.now();
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (_url, init) => hangingFetch()("https://youtubeanalytics.googleapis.com/v2/reports", init)
      }),
      requestTimeoutMs: 50,
      collectionBudgetMs: Number.MAX_SAFE_INTEGER,
      nowMs: clock.nowMs
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(report.status).toBe("unmeasured");
    expect(report.videos).toHaveLength(1);
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    expect(report.videos[0]?.reason).toMatch(/timed out after 50ms/);
    assertUnmeasuredNumericFields(report.videos[0]);
  });

  it("keeps a TypeError fetch failed distinct from a timeout", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: () => {
          throw new TypeError("fetch failed");
        }
      })
    });

    expect(report.status).toBe("unmeasured");
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    expect(report.videos[0]?.reason).toMatch(/fetch failed/);
    expect(report.videos[0]?.reason).toMatch(/TypeError/);
    expect(report.videos[0]?.reason).not.toMatch(/timed out/);
    assertUnmeasuredNumericFields(report.videos[0]);
  });

  it("isolates a single-video HTTP 500 so the rest of the report still measures", async () => {
    await writeLog(root, DATE, [logEntry("vid1"), logEntry("vid2"), logEntry("vid3")]);
    const videoListCalls: string[][] = [];

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "vid2") {
            return jsonResponse({ error: { code: 500, message: "backend error" } }, 500);
          }
          return jsonResponse(measuredAnalyticsRow(videoId));
        },
        videos: (ids) => {
          videoListCalls.push(ids);
          return jsonResponse({
            items: ids.map((id) => ({
              id,
              status: { privacyStatus: "public", uploadStatus: "processed" }
            }))
          });
        }
      })
    });

    expect(report.status).toBe("partial");
    expect(report.reason).toMatch(/500/);
    expect(report.reason).toMatch(/1 videos failed/);
    expect(report.videos).toHaveLength(3);
    expect(report.videos[0]?.metrics_status).toBe("measured");
    expect(report.videos[0]?.views).toBe(12);
    expect(report.videos[1]?.video_id).toBe("vid2");
    expect(report.videos[1]?.metrics_status).toBe("unmeasured");
    expect(report.videos[1]?.reason).toMatch(/500/);
    assertUnmeasuredNumericFields(report.videos[1]);
    expect(report.videos[2]?.metrics_status).toBe("measured");
    expect(report.videos[2]?.views).toBe(12);
    expect(videoListCalls[0]).toEqual(["vid1", "vid2", "vid3"]);
  });

  it("marks the whole report unmeasured when token refresh fails", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);
    let analyticsCalls = 0;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        token: () => jsonResponse({ error: "invalid_grant", error_description: "token revoked" }, 400),
        analytics: () => {
          analyticsCalls += 1;
          return jsonResponse(measuredAnalyticsRow("abc123"));
        }
      })
    });

    expect(report.status).toBe("unmeasured");
    expect(report.reason).toMatch(/token revoked|400/);
    expect(analyticsCalls).toBe(0);
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    assertUnmeasuredNumericFields(report.videos[0]);
  });

  it("marks the whole report unmeasured when YouTube credentials are missing", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);
    const unused = (async () => {
      throw new Error("missing credentials must not call Google");
    }) as unknown as typeof fetch;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: unused
    });

    expect(report.status).toBe("unmeasured");
    expect(report.reason).toMatch(/not configured/);
    expect(report.reason).toMatch(/YT_CLIENT_ID/);
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    assertUnmeasuredNumericFields(report.videos[0]);
  });

  it("includes a log dated date-27 and excludes date-28", async () => {
    await writeLog(root, DATE, [logEntry("today")]);
    await writeLog(root, IN_WINDOW_DATE, [logEntry("in-window", { title: "day-27" })]);
    await writeLog(root, OUT_WINDOW_DATE, [logEntry("out-window", { title: "day-28" })]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({})
    });

    const ids = report.videos.map((video) => video.video_id).sort();
    expect(ids).toContain("today");
    expect(ids).toContain("in-window");
    expect(ids).not.toContain("out-window");
    expect(report.videos).toHaveLength(2);
  });

  it("writes not-found only when videos.list 2xx omits the id", async () => {
    await writeLog(root, DATE, [logEntry("solo")]);
    await writeLog(root, "2026-09-04", [logEntry("other")]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: (ids) =>
          jsonResponse({
            items: ids
              .filter((id) => id !== "solo")
              .map((id) => ({
                id,
                status: { privacyStatus: "unlisted", uploadStatus: "processed" }
              }))
          })
      })
    });

    const solo = report.videos.find((video) => video.video_id === "solo");
    const other = report.videos.find((video) => video.video_id === "other");
    expect(solo?.privacy_status).toBe("not-found");
    expect(solo?.upload_status).toBe("not-found");
    expect(solo?.status_reason).toBeUndefined();
    expect(solo?.metrics_status).toBe("measured");
    expect(other?.privacy_status).toBe("unlisted");
    expect(report.status).toBe("measured");
  });

  it("does not swallow videos.list 403 as not-found and refuses measured", async () => {
    await writeLog(root, DATE, [logEntry("vid1"), logEntry("vid2")]);
    let analyticsCalls = 0;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: () =>
          jsonResponse(
            { error: { code: 403, message: "Request had insufficient authentication scopes." } },
            403
          ),
        analytics: (url) => {
          analyticsCalls += 1;
          return jsonResponse(measuredAnalyticsRow(videoIdFromFilters(url.toString())));
        }
      })
    });

    expect(analyticsCalls).toBe(2);
    expect(report.status).not.toBe("measured");
    expect(report.status).toBe("partial");
    expect(report.reason).toBeTruthy();
    expect(report.reason).toMatch(/403/);
    expect(report.reason).toMatch(/2 videos failed/);
    expect(report.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    for (const video of report.videos) {
      expect(video.privacy_status).toBeNull();
      expect(video.upload_status).toBeNull();
      expect(video.status_reason).toMatch(/403/);
      expect(video.status_reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
      expect(video.metrics_status).toBe("measured");
      expect(video.views).toBe(12);
    }
  });

  it("does not retry videos.list per id when a batch hangs", async () => {
    await writeLog(root, DATE, [logEntry("a"), logEntry("b"), logEntry("c")]);
    let videoListCalls = 0;
    let analyticsCalls = 0;
    const clock = createFakeClock();

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: (_ids, init) => {
          videoListCalls += 1;
          return hangingFetch()("https://www.googleapis.com/youtube/v3/videos", init);
        },
        analytics: (url) => {
          analyticsCalls += 1;
          return jsonResponse(measuredAnalyticsRow(videoIdFromFilters(url.toString())));
        }
      }),
      requestTimeoutMs: 50,
      collectionBudgetMs: Number.MAX_SAFE_INTEGER,
      nowMs: clock.nowMs
    });

    expect(videoListCalls).toBe(1);
    expect(analyticsCalls).toBe(3);
    expect(report.status).not.toBe("measured");
    for (const video of report.videos) {
      expect(video.privacy_status).toBeNull();
      expect(video.upload_status).toBeNull();
      expect(video.status_reason).toMatch(/timed out after 50ms/);
      expect(video.metrics_status).toBe("measured");
    }
  });

  it("skips later videos.list batches when the status-phase budget is exhausted", async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `v${String(index).padStart(2, "0")}`);
    await writeLog(
      root,
      DATE,
      ids.map((id) => logEntry(id))
    );
    let videoListCalls = 0;
    const clock = createFakeClock();
    const budgetMs = 100;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: (batchIds) => {
          videoListCalls += 1;
          clock.advance(budgetMs + 1);
          return jsonResponse({
            items: batchIds.map((id) => ({
              id,
              status: { privacyStatus: "public", uploadStatus: "processed" }
            }))
          });
        }
      }),
      collectionBudgetMs: budgetMs,
      nowMs: clock.nowMs
    });

    expect(videoListCalls).toBe(1);
    expect(report.videos).toHaveLength(51);
    expect(report.videos[0]?.privacy_status).toBe("public");
    expect(report.videos[0]?.status_reason).toBeUndefined();
    expect(report.videos[50]?.privacy_status).toBeNull();
    expect(report.videos[50]?.upload_status).toBeNull();
    expect(report.videos[50]?.status_reason).toBe("budget exhausted");
  });

  it("persists the first measured video before later analytics requests", async () => {
    await writeLog(root, DATE, [logEntry("vid1"), logEntry("vid2"), logEntry("vid3")]);
    let midRunReportText: string | undefined;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: async (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "vid2") {
            midRunReportText = await readFile(youtubeAnalyticsPath(DATE, root), "utf8");
          }
          return jsonResponse(measuredAnalyticsRow(videoId));
        }
      })
    });

    expect(report.status).toBe("measured");
    expect(midRunReportText).toBeDefined();
    const mid = JSON.parse(midRunReportText ?? "") as {
      videos: Array<{ video_id: string; metrics_status: string }>;
    };
    expect(mid.videos).toHaveLength(3);
    expect(mid.videos[0]?.video_id).toBe("vid1");
    expect(mid.videos[0]?.metrics_status).toBe("measured");
    expect(mid.videos[1]?.video_id).toBe("vid2");
    expect(mid.videos[1]?.metrics_status).toBe("pending");
    expect(mid.videos[2]?.video_id).toBe("vid3");
    expect(mid.videos[2]?.metrics_status).toBe("pending");
  });

  it("merges a later unmeasured run into existing measured rows and reports merged_existing_rows", async () => {
    await writeLog(root, DATE, [logEntry("keep1"), logEntry("keep2")]);
    const first = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({})
    });
    expect(first.status).toBe("measured");
    expect(first.videos).toHaveLength(2);

    let stdoutText = "";
    const stderrLines: string[] = [];
    const { report, exitCode } = await runCli(["--root", root, "--date", DATE], {
      env: CONFIGURED,
      fetchImpl: googleFetch({
        token: () => jsonResponse({ error: "invalid_grant", error_description: "token revoked" }, 400)
      }),
      stdout: (line) => {
        stdoutText += line;
      },
      stderr: (line) => {
        stderrLines.push(line);
      }
    });

    expect(report.status).toBe("measured");
    expect(report.merged_existing_rows).toBe(2);
    expect(report.videos).toHaveLength(2);
    expect(report.videos.every((video) => video.metrics_status === "measured")).toBe(true);
    expect(report.videos.find((video) => video.video_id === "keep1")?.views).toBe(12);
    expect(exitCode).toBe(0);
    const printed = JSON.parse(stdoutText) as { merged_existing_rows?: number; persisted?: boolean };
    expect(printed.merged_existing_rows).toBe(2);
    expect(printed.persisted).toBeUndefined();
    expect(stderrLines).toContain("[youtube-analytics] merged 2 existing rows");
    const saved = await readSavedReport(root);
    expect(saved.status).toBe("measured");
    expect(saved.merged_existing_rows).toBe(2);
    expect(saved.videos).toHaveLength(2);
    expect(saved.videos.every((video) => video.metrics_status === "measured")).toBe(true);
  });

  it("keeps the previous three measured rows and appends a fourth pending video", async () => {
    await writeLog(root, DATE, [logEntry("v1"), logEntry("v2"), logEntry("v3")]);
    const first = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({})
    });
    expect(first.status).toBe("measured");
    expect(first.videos).toHaveLength(3);

    await writeLog(root, DATE, [logEntry("v1"), logEntry("v2"), logEntry("v3"), logEntry("v4")]);
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "v4") {
            return jsonResponse({ columnHeaders: ANALYTICS_HEADERS });
          }
          return jsonResponse(measuredAnalyticsRow(videoId, 21));
        }
      })
    });

    expect(report.videos).toHaveLength(4);
    expect(report.videos.map((video) => video.video_id)).toEqual(["v1", "v2", "v3", "v4"]);
    expect(report.videos[0]?.views).toBe(21);
    expect(report.videos[1]?.views).toBe(21);
    expect(report.videos[2]?.views).toBe(21);
    expect(report.videos[3]?.metrics_status).toBe("pending");
    expect(report.videos[3]?.reason).toBe("analytics rows not available yet");
    expect(report.status).toBe("partial");
    const saved = await readSavedReport(root);
    expect(saved.videos).toHaveLength(4);
    expect(saved.status).toBe("partial");
  });

  it("marks leftover videos pending with budget exhausted and still writes the file", async () => {
    await writeLog(root, DATE, [logEntry("first"), logEntry("second")]);
    const clock = createFakeClock();
    const budgetMs = 500;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          clock.advance(budgetMs + 1);
          return jsonResponse(measuredAnalyticsRow(videoIdFromFilters(url.toString())));
        }
      }),
      collectionBudgetMs: budgetMs,
      nowMs: clock.nowMs
    });

    expect(report.status).toBe("partial");
    expect(report.reason).toMatch(/budget exhausted/);
    expect(report.reason).toMatch(/1 videos failed/);
    expect(report.videos[0]?.metrics_status).toBe("measured");
    expect(report.videos[0]?.views).toBe(12);
    expect(report.videos[1]?.metrics_status).toBe("pending");
    expect(report.videos[1]?.reason).toBe("budget exhausted");
    assertUnmeasuredNumericFields(report.videos[1]);

    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8")) as {
      status: string;
      videos: Array<{ metrics_status: string; reason?: string; views: number | null }>;
    };
    expect(saved.status).toBe("partial");
    expect(saved.videos[0]?.metrics_status).toBe("measured");
    expect(saved.videos[0]?.views).toBe(12);
    expect(saved.videos[1]?.metrics_status).toBe("pending");
    expect(saved.videos[1]?.reason).toBe("budget exhausted");
    expect(saved.videos[1]?.views).toBeNull();
  });

  it("runCli --no-fail exits 0 and still writes the file when collection is unmeasured", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);
    const { report, exitCode } = await runCli(["--root", root, "--date", DATE, "--no-fail"], {
      env: CONFIGURED,
      fetchImpl: googleFetch({
        token: () => jsonResponse({ error: "invalid_grant", error_description: "token revoked" }, 400)
      }),
      stdout: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(report.status).toBe("unmeasured");
    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("unmeasured");
    expect(saved.videos[0].views).toBeNull();
  });

  it("runCli without --no-fail sets exitCode 1 and still writes the file", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);
    const previous = process.exitCode;
    const { report, exitCode } = await runCli(["--root", root, "--date", DATE], {
      env: CONFIGURED,
      fetchImpl: googleFetch({
        token: () => jsonResponse({ error: "invalid_grant", error_description: "token revoked" }, 400)
      }),
      stdout: () => undefined
    });

    expect(exitCode).toBe(1);
    expect(process.exitCode).toBe(previous);
    expect(report.status).toBe("unmeasured");
    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("unmeasured");
  });

  it("writes a pending skeleton before the first network call when no report exists", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);
    let skeleton: {
      status: string;
      videos: Array<{ metrics_status: string; reason?: string; views: number | null }>;
    } | undefined;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        token: async () => {
          skeleton = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8")) as {
            status: string;
            videos: Array<{ metrics_status: string; reason?: string; views: number | null }>;
          };
          return jsonResponse({ access_token: "token" });
        }
      })
    });

    expect(skeleton).toBeDefined();
    expect(skeleton?.status).toBe("unmeasured");
    expect(skeleton?.videos).toHaveLength(1);
    expect(skeleton?.videos[0]?.metrics_status).toBe("pending");
    expect(skeleton?.videos[0]?.reason).toBe("collection in progress");
    expect(skeleton?.videos[0]?.views).toBeNull();
    expect(report.status).toBe("measured");
  });

  it("persists video statuses before the first analytics request", async () => {
    await writeLog(root, DATE, [logEntry("vid1"), logEntry("vid2")]);
    let mid:
      | {
          videos: Array<{
            video_id: string;
            privacy_status: string | null;
            upload_status: string | null;
            metrics_status: string;
          }>;
        }
      | undefined;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: async (url) => {
          if (!mid) {
            mid = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8")) as {
              videos: Array<{
                video_id: string;
                privacy_status: string | null;
                upload_status: string | null;
                metrics_status: string;
              }>;
            };
          }
          return jsonResponse(measuredAnalyticsRow(videoIdFromFilters(url.toString())));
        }
      })
    });

    expect(report.status).toBe("measured");
    expect(mid).toBeDefined();
    expect(mid?.videos).toHaveLength(2);
    expect(mid?.videos[0]?.video_id).toBe("vid1");
    expect(mid?.videos[0]?.privacy_status).toBe("public");
    expect(mid?.videos[0]?.upload_status).toBe("processed");
    expect(mid?.videos[0]?.metrics_status).toBe("pending");
    expect(mid?.videos[1]?.privacy_status).toBe("public");
    expect(mid?.videos[1]?.metrics_status).toBe("pending");
  });

  it("appends the re-consent hint when analytics returns HTTP 401", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: () => jsonResponse({ error: { code: 401, message: "Invalid Credentials" } }, 401)
      })
    });

    expect(report.status).toBe("unmeasured");
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    expect(report.videos[0]?.reason).toMatch(/401/);
    expect(report.videos[0]?.reason).toMatch(/Invalid Credentials/);
    expect(report.videos[0]?.reason).not.toMatch(/insufficient|scope/i);
    expect(report.videos[0]?.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    expect(report.reason).toMatch(/401/);
    expect(report.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    assertUnmeasuredNumericFields(report.videos[0]);
  });

  it("appends the re-consent hint when the error mentions insufficient scopes without HTTP 401/403", async () => {
    await writeLog(root, DATE, [logEntry("abc123")]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: () => {
          throw new Error("Request had insufficient authentication scopes.");
        }
      })
    });

    expect(report.status).toBe("unmeasured");
    expect(report.videos[0]?.metrics_status).toBe("unmeasured");
    expect(report.videos[0]?.reason).toMatch(/insufficient authentication scopes/i);
    expect(report.videos[0]?.reason).not.toMatch(/HTTP 401|HTTP 403/);
    expect(report.videos[0]?.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    expect(report.reason).toMatch(/insufficient authentication scopes/i);
    expect(report.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    assertUnmeasuredNumericFields(report.videos[0]);
  });

  it("marks videos.list 403 with successful analytics partial, not unmeasured", async () => {
    await writeLog(root, DATE, [logEntry("v1"), logEntry("v2"), logEntry("v3")]);

    const { report, exitCode } = await runCli(["--root", root, "--date", DATE], {
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: () =>
          jsonResponse(
            { error: { code: 403, message: "Request had insufficient authentication scopes." } },
            403
          )
      }),
      stdout: () => undefined
    });

    expect(report.status).toBe("partial");
    expect(report.status).not.toBe("unmeasured");
    expect(report.status).not.toBe("measured");
    expect(exitCode).toBe(0);
    expect(report.reason).toMatch(/403/);
    expect(report.reason).toMatch(/3 videos failed/);
    expect(report.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    expect(report.videos).toHaveLength(3);
    for (const video of report.videos) {
      expect(video.metrics_status).toBe("measured");
      expect(video.status_reason).toMatch(/403/);
      expect(video.views).toBe(12);
    }
    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8")) as {
      status: string;
    };
    expect(saved.status).toBe("partial");
  });

  it("picks the 403 re-consent reason over analytics-rows-not-available at the top level", async () => {
    await writeLog(root, DATE, [logEntry("a"), logEntry("b"), logEntry("c")]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "a") {
            return jsonResponse({ columnHeaders: ANALYTICS_HEADERS });
          }
          if (videoId === "b") {
            return jsonResponse(
              { error: { code: 403, message: "Request had insufficient authentication scopes." } },
              403
            );
          }
          return jsonResponse(measuredAnalyticsRow(videoId));
        }
      })
    });

    expect(report.status).toBe("partial");
    expect(report.videos[0]?.metrics_status).toBe("pending");
    expect(report.videos[0]?.reason).toBe("analytics rows not available yet");
    expect(report.videos[1]?.metrics_status).toBe("unmeasured");
    expect(report.videos[1]?.reason).toMatch(/403/);
    expect(report.videos[2]?.metrics_status).toBe("measured");
    expect(report.reason).toMatch(/403/);
    expect(report.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    expect(report.reason).toMatch(/2 videos failed/);
    expect(report.reason).not.toMatch(/^analytics rows not available yet/);
  });

  it("keeps a 403-night measured row when the next run is pending for that video", async () => {
    await writeLog(root, DATE, [logEntry("v1"), logEntry("v2"), logEntry("v3")]);

    const first = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: () => list403()
      })
    });
    expect(first.status).toBe("partial");
    const firstSaved = await readSavedReport(root);
    expect(firstSaved.status).toBe("partial");
    expect(firstSaved.videos).toHaveLength(3);
    expect(firstSaved.videos.every((video) => video.metrics_status === "measured")).toBe(true);
    expect(firstSaved.videos.every((video) => Boolean(video.status_reason))).toBe(true);
    expect(firstSaved.videos[0]?.views).toBe(12);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "v3") {
            return jsonResponse({ columnHeaders: ANALYTICS_HEADERS });
          }
          return jsonResponse(measuredAnalyticsRow(videoId, 99));
        }
      })
    });

    expect(second.status).toBe("partial");
    expect(second.merged_existing_rows).toBe(1);
    expect(second.videos).toHaveLength(3);
    const saved = await readSavedReport(root);
    expect(saved.fetched_at).not.toBe(firstSaved.fetched_at);
    expect(saved.status).toBe("partial");
    expect(saved.videos).toHaveLength(3);
    expect(saved.videos.find((video) => video.video_id === "v1")?.views).toBe(99);
    expect(saved.videos.find((video) => video.video_id === "v1")?.status_reason).toBeUndefined();
    expect(saved.videos.find((video) => video.video_id === "v2")?.views).toBe(99);
    const kept = saved.videos.find((video) => video.video_id === "v3");
    expect(kept?.metrics_status).toBe("measured");
    expect(kept?.views).toBe(12);
    expect(kept?.status_reason).toMatch(/403/);
  });

  it("keeps same-day rows that left the current log window", async () => {
    await writeLog(root, DATE, [logEntry("v1"), logEntry("v2"), logEntry("v3")]);
    const first = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "v3") {
            return jsonResponse({ columnHeaders: ANALYTICS_HEADERS });
          }
          return jsonResponse(measuredAnalyticsRow(videoId, 12));
        }
      })
    });
    expect(first.status).toBe("partial");
    expect(first.videos).toHaveLength(3);
    expect(first.videos.filter((video) => video.metrics_status === "measured")).toHaveLength(2);

    await writeLog(root, DATE, [logEntry("v1")]);
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: () => jsonResponse(measuredAnalyticsRow("v1", 44))
      })
    });

    expect(report.videos).toHaveLength(3);
    expect(report.merged_existing_rows).toBe(2);
    expect(report.videos.map((video) => video.video_id)).toEqual(["v1", "v2", "v3"]);
    expect(report.videos[0]?.views).toBe(44);
    expect(report.videos[1]?.metrics_status).toBe("measured");
    expect(report.videos[1]?.views).toBe(12);
    expect(report.videos[2]?.metrics_status).toBe("pending");
    expect(report.status).toBe("partial");
    const saved = await readSavedReport(root);
    expect(saved.videos).toHaveLength(3);
    expect(saved.status).toBe("partial");
  });

  it("keeps existing rows when the current window is empty, and writes measured/0 when no file exists", async () => {
    await writeLog(root, DATE, [logEntry("v1"), logEntry("v2"), logEntry("v3")]);
    const first = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "v3") {
            return jsonResponse({ columnHeaders: ANALYTICS_HEADERS });
          }
          return jsonResponse(measuredAnalyticsRow(videoId));
        }
      })
    });
    expect(first.status).toBe("partial");
    expect(first.videos).toHaveLength(3);

    await writeLog(root, DATE, []);
    const unused = (async () => {
      throw new Error("empty window must not call Google");
    }) as unknown as typeof fetch;
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: unused
    });
    expect(report.videos).toHaveLength(3);
    expect(report.merged_existing_rows).toBe(3);
    expect(report.status).toBe("partial");
    const saved = await readSavedReport(root);
    expect(saved.videos).toHaveLength(3);
    expect(saved.status).toBe("partial");

    await rm(youtubeAnalyticsPath(DATE, root), { force: true });
    const empty = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: unused
    });
    expect(empty.status).toBe("measured");
    expect(empty.videos).toEqual([]);
    expect(empty.merged_existing_rows).toBe(0);
    const emptySaved = await readSavedReport(root);
    expect(emptySaved).toMatchObject({ date: DATE, status: "measured", videos: [] });
  });

  it("writes unmeasured with a reason when loadWindowEntries throws and no report exists", async () => {
    await writeCorruptWindowLog(root);
    const unused = (async () => {
      throw new Error("loadWindowEntries failure must not call Google");
    }) as unknown as typeof fetch;

    const { report, exitCode } = await runCli(["--root", root, "--date", DATE], {
      env: CONFIGURED,
      fetchImpl: unused,
      stdout: () => undefined
    });

    expect(exitCode).toBe(1);
    expect(report.status).toBe("unmeasured");
    expect(report.videos).toEqual([]);
    expect(report.reason).toMatch(/JSON|Unexpected token/i);
    const saved = await readSavedReport(root);
    expect(saved.status).toBe("unmeasured");
    expect(saved.videos).toEqual([]);
    expect(saved.reason).toMatch(/JSON|Unexpected token/i);
    expect(saved).not.toHaveProperty("reason", undefined);
  });

  it("keeps two fully measured rows and surfaces the loadWindowEntries error as top-level reason", async () => {
    const existingRows: YouTubeAnalyticsVideoRow[] = ["keep1", "keep2"].map((videoId) => ({
      video_id: videoId,
      title: videoId,
      published_at: "2026-09-01T12:00:00.000Z",
      privacy_status: "public",
      upload_status: "processed",
      metrics_status: "measured",
      views: 12,
      estimated_minutes_watched: 3,
      average_view_duration_seconds: 45,
      average_view_percentage: 67.5,
      impressions: IMPRESSIONS_NOT_AVAILABLE
    }));
    await mkdir(join(root, "data", "insights", "youtube"), { recursive: true });
    await writeFile(
      youtubeAnalyticsPath(DATE, root),
      `${JSON.stringify(
        {
          date: DATE,
          fetched_at: "2026-09-05T00:00:00.000Z",
          status: "measured",
          videos: existingRows
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeCorruptWindowLog(root);
    const unused = (async () => {
      throw new Error("loadWindowEntries failure must not call Google");
    }) as unknown as typeof fetch;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: unused
    });

    expect(report.videos).toHaveLength(2);
    expect(report.videos.every((video) => video.metrics_status === "measured" && !video.reason)).toBe(true);
    expect(report.status).toBe("measured");
    expect(report.reason).toMatch(/JSON|Unexpected token/i);
    const saved = await readSavedReport(root);
    expect(saved.videos).toHaveLength(2);
    expect(saved.status).toBe("measured");
    expect(saved.reason).toMatch(/JSON|Unexpected token/i);
    expect(saved.videos.map((video) => video.video_id)).toEqual(["keep1", "keep2"]);
  });

  it("recomputes measured from fully measured rows when the existing status field is illegal", async () => {
    await writeLog(root, DATE, [logEntry("v1"), logEntry("v2"), logEntry("v3")]);
    await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({})
    });
    const path = youtubeAnalyticsPath(DATE, root);
    const existing = JSON.parse(await readFile(path, "utf8")) as {
      status?: string;
      videos: YouTubeAnalyticsVideoRow[];
    };
    existing.status = "not-a-status";
    await writeFile(path, `${JSON.stringify(existing, null, 2)}\n`, "utf8");

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        token: () => jsonResponse({ error: "invalid_grant", error_description: "token revoked" }, 400)
      })
    });

    expect(report.videos).toHaveLength(3);
    expect(report.videos.every((video) => video.metrics_status === "measured" && !video.status_reason)).toBe(
      true
    );
    expect(report.status).toBe("measured");
    expect(report.merged_existing_rows).toBe(3);
    const saved = await readSavedReport(root);
    expect(saved.status).toBe("measured");
    expect(saved.videos).toHaveLength(3);
  });

  it("treats a corrupt same-day JSON file as empty and writes the current report", async () => {
    await writeLog(root, DATE, [logEntry("fresh")]);
    const path = youtubeAnalyticsPath(DATE, root);
    await mkdir(join(root, "data", "insights", "youtube"), { recursive: true });
    await writeFile(path, "{not-json", "utf8");

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({})
    });

    expect(report.status).toBe("measured");
    expect(report.videos).toHaveLength(1);
    expect(report.videos[0]?.video_id).toBe("fresh");
    expect(report.videos[0]?.views).toBe(12);
    expect(report.merged_existing_rows).toBe(0);
    const saved = await readSavedReport(root);
    expect(saved.status).toBe("measured");
    expect(saved.videos[0]?.video_id).toBe("fresh");
  });

  it("picks auth-scope reasons over HTTP 500 at the top level", async () => {
    await writeLog(root, DATE, [logEntry("auth"), logEntry("http")]);
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "auth") {
            return jsonResponse(
              { error: { code: 403, message: "Request had insufficient authentication scopes." } },
              403
            );
          }
          return jsonResponse({ error: { code: 500, message: "backend error" } }, 500);
        }
      })
    });
    expect(report.status).toBe("unmeasured");
    expect(report.reason).toMatch(/403/);
    expect(report.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    expect(report.reason).not.toMatch(/^HTTP 500/);
  });

  it("picks HTTP 500 over budget exhausted at the top level", async () => {
    await writeLog(root, DATE, [logEntry("http"), logEntry("budget")]);
    const clock = createFakeClock();
    const budgetMs = 100;
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "http") {
            clock.advance(budgetMs + 1);
            return jsonResponse({ error: { code: 500, message: "backend error" } }, 500);
          }
          return jsonResponse(measuredAnalyticsRow(videoId));
        }
      }),
      collectionBudgetMs: budgetMs,
      nowMs: clock.nowMs
    });
    expect(report.videos[0]?.reason).toMatch(/500/);
    expect(report.videos[1]?.reason).toBe("budget exhausted");
    expect(report.reason).toMatch(/500/);
    expect(report.reason).not.toMatch(/^budget exhausted/);
  });

  it("picks budget exhausted over analytics-rows-not-available at the top level", async () => {
    await writeLog(root, DATE, [logEntry("rows"), logEntry("budget")]);
    const clock = createFakeClock();
    const budgetMs = 100;
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          const videoId = videoIdFromFilters(url.toString());
          if (videoId === "rows") {
            clock.advance(budgetMs + 1);
            return jsonResponse({ columnHeaders: ANALYTICS_HEADERS });
          }
          return jsonResponse(measuredAnalyticsRow(videoId));
        }
      }),
      collectionBudgetMs: budgetMs,
      nowMs: clock.nowMs
    });
    expect(report.videos[0]?.reason).toBe("analytics rows not available yet");
    expect(report.videos[1]?.reason).toBe("budget exhausted");
    expect(report.reason).toMatch(/budget exhausted/);
    expect(report.reason).not.toMatch(/^analytics rows not available yet/);
  });

  it("picks the more severe per-video reason when status_reason is HTTP 500 and reason is 403", async () => {
    await writeLog(root, DATE, [logEntry("both")]);
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: () => jsonResponse({ error: { code: 500, message: "backend error" } }, 500),
        analytics: () =>
          jsonResponse(
            { error: { code: 403, message: "Request had insufficient authentication scopes." } },
            403
          )
      })
    });
    expect(report.videos[0]?.status_reason).toMatch(/500/);
    expect(report.videos[0]?.reason).toMatch(/403/);
    expect(report.reason).toMatch(/403/);
    expect(report.reason).toMatch(/youtube-auth|re-consent|youtube\.readonly/i);
    expect(report.reason).not.toMatch(/^HTTP 500/);
  });
});
