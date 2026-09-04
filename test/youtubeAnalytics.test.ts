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

function assertAnalyticsQuery(target: string, videoId: string, endDate = DATE): URL {
  const parsed = analyticsUrl(target);
  expect(parsed.searchParams.get("ids")).toBe("channel==MINE");
  expect(parsed.searchParams.get("dimensions")).toBe("video");
  expect(parsed.searchParams.get("filters")).toBe(`video==${videoId}`);
  expect(parsed.searchParams.get("startDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(parsed.searchParams.get("endDate")).toBe(endDate);
  return parsed;
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

function googleFetch(handlers: {
  token?: () => Promise<Response> | Response;
  analytics?: (url: URL, init?: RequestInit) => Promise<Response> | Response;
  videos?: (ids: string[]) => Promise<Response> | Response;
}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return handlers.token ? handlers.token() : jsonResponse({ access_token: "token" });
    }
    if (target.includes("youtubeanalytics.googleapis.com")) {
      const parsed = analyticsUrl(target);
      const videoId = videoIdFromFilters(target);
      assertAnalyticsQuery(target, videoId);
      if (handlers.analytics) return handlers.analytics(parsed, init);
      return jsonResponse(measuredAnalyticsRow(videoId));
    }
    if (target.includes("/youtube/v3/videos")) {
      const parsed = new URL(target);
      expect(parsed.searchParams.get("part")).toBe("status");
      expect(parsed.searchParams.get("part")).not.toContain("statistics");
      const ids = (parsed.searchParams.get("id") ?? "").split(",").filter(Boolean);
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

function hangingFetch(): typeof fetch {
  return (async (_url: string | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason ?? new Error("aborted"));
      });
    })) as unknown as typeof fetch;
}

async function writeLog(root: string, date: string, entries: unknown[]): Promise<void> {
  const dir = join(root, "data", "youtube-log");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${date}.json`), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
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

describe("YouTube Analytics collector", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yt-analytics-"));
  });

  afterEach(async () => {
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
    const started = Date.now();
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (_url, init) => hangingFetch()("https://youtubeanalytics.googleapis.com/v2/reports", init)
      }),
      requestTimeoutMs: 50
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

  it("sets not-found when videos.list items are empty and falls back to per-id after a batch failure", async () => {
    await writeLog(root, DATE, [logEntry("solo")]);
    await writeLog(root, "2026-09-04", [logEntry("other")]);
    let batchCalls = 0;
    let perIdCalls = 0;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        videos: (ids) => {
          if (ids.length > 1) {
            batchCalls += 1;
            return jsonResponse({ error: { message: "batch failed" } }, 500);
          }
          perIdCalls += 1;
          if (ids[0] === "solo") return jsonResponse({ items: [] });
          return jsonResponse({
            items: [{ id: ids[0], status: { privacyStatus: "unlisted", uploadStatus: "processed" } }]
          });
        }
      })
    });

    expect(batchCalls).toBe(1);
    expect(perIdCalls).toBe(2);
    const solo = report.videos.find((video) => video.video_id === "solo");
    const other = report.videos.find((video) => video.video_id === "other");
    expect(solo?.privacy_status).toBe("not-found");
    expect(solo?.upload_status).toBe("not-found");
    expect(solo?.metrics_status).toBe("measured");
    expect(other?.privacy_status).toBe("unlisted");
  });

  it("marks leftover videos pending with budget exhausted and still writes the file", async () => {
    await writeLog(root, DATE, [logEntry("first"), logEntry("second")]);
    let now = 0;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: googleFetch({
        analytics: (url) => {
          now = 1_000;
          return jsonResponse(measuredAnalyticsRow(videoIdFromFilters(url.toString())));
        }
      }),
      collectionBudgetMs: 500,
      nowMs: () => now
    });

    expect(report.status).toBe("partial");
    expect(report.videos[0]?.metrics_status).toBe("measured");
    expect(report.videos[0]?.views).toBe(12);
    expect(report.videos[1]?.metrics_status).toBe("pending");
    expect(report.videos[1]?.reason).toBe("budget exhausted");
    assertUnmeasuredNumericFields(report.videos[1]);
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
});
