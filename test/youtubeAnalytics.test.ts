import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectYouTubeAnalytics,
  IMPRESSIONS_NOT_AVAILABLE,
  youtubeAnalyticsPath
} from "../src/youtubeAnalytics";

const DATE = "2026-09-05";
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

function measuredFetch(): typeof fetch {
  return (async (url: string | URL) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "token" });
    }
    if (target.includes("youtubeanalytics.googleapis.com")) {
      return jsonResponse({
        columnHeaders: ANALYTICS_HEADERS,
        rows: [["abc123", 12, 3, 45, 67.5]]
      });
    }
    if (target.includes("/youtube/v3/videos")) {
      return jsonResponse({
        items: [
          {
            id: "abc123",
            statistics: { viewCount: "99" },
            status: { privacyStatus: "public", uploadStatus: "processed" }
          }
        ]
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

describe("YouTube Analytics collector", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yt-analytics-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a measured report with API fields and Studio-only impressions as a string", async () => {
    await writeLog(root, DATE, [
      {
        date: DATE,
        slot: 2,
        video_id: "abc123",
        title: "白鞋泛黃｜台中洗鞋",
        uploaded_at: "2026-09-01T12:00:00.000Z",
        scheduled_publish_at: "2026-09-01T12:45:00Z"
      }
    ]);
    await writeLog(root, "2026-08-08", [
      {
        date: "2026-08-08",
        slot: 2,
        video_id: "outside-window",
        title: "too old",
        uploaded_at: "2026-08-08T12:00:00.000Z"
      }
    ]);

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: measuredFetch()
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
      views: 12,
      estimated_minutes_watched: 3,
      average_view_duration_seconds: 45,
      average_view_percentage: 67.5,
      impressions: IMPRESSIONS_NOT_AVAILABLE
    });
    expect(report.videos[0]?.impressions).toBe("not-available-via-api");
    expect(report.videos[0]?.impressions).not.toBe(0);

    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("measured");
    expect(saved.videos[0].impressions).toBe("not-available-via-api");
    expect(saved.videos[0].views).toBe(12);
  });

  it("marks 403 insufficient scope as unmeasured and returns without throwing", async () => {
    await writeLog(root, DATE, [
      {
        date: DATE,
        slot: 2,
        video_id: "abc123",
        title: "short",
        uploaded_at: "2026-09-05T04:00:00.000Z"
      }
    ]);
    const insufficient = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return jsonResponse({ access_token: "token" });
      }
      return jsonResponse(
        { error: { code: 403, message: "Request had insufficient authentication scopes." } },
        403
      );
    }) as unknown as typeof fetch;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: insufficient
    });

    expect(report.status).toBe("unmeasured");
    expect(report.reason).toMatch(/403/);
    expect(report.reason).toMatch(/insufficient authentication scopes/i);
    expect(report.videos).toEqual([]);
    expect(report).not.toHaveProperty("views");

    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("unmeasured");
    expect(saved.videos).toEqual([]);
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

  it("marks a hung request unmeasured and finishes inside 5 seconds", async () => {
    await writeLog(root, DATE, [
      {
        date: DATE,
        slot: 2,
        video_id: "abc123",
        title: "short",
        uploaded_at: "2026-09-05T04:00:00.000Z"
      }
    ]);
    const started = Date.now();
    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: hangingFetch(),
      requestTimeoutMs: 50
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(report.status).toBe("unmeasured");
    expect(report.reason).toMatch(/timed out after 50ms/);
    expect(report.videos).toEqual([]);
  });

  it("never writes 0 on a 403 (mutation: change unmeasured to 0 and this goes red)", async () => {
    await writeLog(root, DATE, [
      {
        date: DATE,
        slot: 2,
        video_id: "abc123",
        title: "short",
        uploaded_at: "2026-09-05T04:00:00.000Z"
      }
    ]);
    const insufficient = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return jsonResponse({ access_token: "token" });
      }
      return jsonResponse(
        { error: { code: 403, message: "Request had insufficient authentication scopes." } },
        403
      );
    }) as unknown as typeof fetch;

    const report = await collectYouTubeAnalytics({
      date: DATE,
      root,
      env: CONFIGURED,
      fetchImpl: insufficient
    });

    // Discriminator: the 403 path must emit the unmeasured status token from
    // unmeasuredReport(), not a numeric 0 that would look like "no views".
    expect(report.status).toBe("unmeasured");
    expect(report.status).not.toEqual(0);
    expect(report.videos).toEqual([]);
    expect(Object.values(report).some((value) => value === 0)).toBe(false);
    const saved = JSON.parse(await readFile(youtubeAnalyticsPath(DATE, root), "utf8"));
    expect(saved.status).toBe("unmeasured");
    expect(JSON.stringify(saved)).not.toMatch(/"status"\s*:\s*0/);
    expect(JSON.stringify(saved)).not.toMatch(/"views"\s*:\s*0/);
  });
});
