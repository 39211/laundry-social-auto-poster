import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  fetchInstagramMediaInsights,
  fetchPostedInstagramInsights,
  writeInstagramPostedInsightsReport
} from "../src/instagramInsights";
import { writePostLog } from "../src/logging";
import { instagramInsightsReportPath } from "../src/paths";
import type { AppConfig } from "../src/types";

const config: AppConfig = {
  dryRun: false,
  timezone: "Asia/Taipei",
  graphApiVersion: "v25.0",
  metaAccessToken: "EAAabcdefghijklmnopqrstuvwxyz1234567890",
  facebookPageId: "123456789012345",
  instagramUserId: "12345678901234567",
  publicSiteBaseUrl: "https://example.github.io/laundry-social-auto-poster",
  publicImageBaseUrl: "https://example.github.io/laundry-social-auto-poster",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false
};

describe("Instagram media insights client", () => {
  it("fetches media insights with a read-only GET and bearer token", async () => {
    const payload = {
      data: [
        {
          name: "reach",
          values: [{ value: 10 }]
        }
      ]
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

    const result = await fetchInstagramMediaInsights({
      postId: "18097273807967885",
      config,
      metrics: ["reach", "saved"],
      fetchImpl
    });

    expect(result.insights_ok).toBe(true);
    expect(result.raw).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(String(url)).toBe("https://graph.facebook.com/v25.0/18097273807967885/insights?metric=reach%2Csaved");
    expect(String(url)).not.toContain("access_token");
    expect(init).toMatchObject({
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`
      }
    });
  });

  it("uses the conservative default media metrics", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;

    await fetchInstagramMediaInsights({
      postId: "18097273807967885",
      config,
      fetchImpl
    });

    const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(decodeURIComponent(String(url))).toContain("metric=reach,likes,comments,shares,saved,total_interactions");
  });

  it("returns raw Meta errors without inventing metrics", async () => {
    const payload = {
      error: {
        message: "(#10) Application does not have permission for this action"
      }
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 400 })) as unknown as typeof fetch;

    const result = await fetchInstagramMediaInsights({
      postId: "18097273807967885",
      config,
      fetchImpl
    });

    expect(result.insights_ok).toBe(false);
    expect(result.insights_status).toBe(400);
    expect(result.error).toBe(payload.error.message);
    expect(result.raw).toEqual(payload);
  });

  it("requires a real Meta access token", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      fetchInstagramMediaInsights({
        postId: "18097273807967885",
        config: { ...config, metaAccessToken: "[REDACTED]" },
        fetchImpl
      })
    ).rejects.toThrow("META_ACCESS_TOKEN is required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches posted Instagram insights with content labels for analysis", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ig-insights-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await writePostLog(
      date,
      [
        {
          date,
          slot: 1,
          platform: "instagram",
          status: "success",
          dry_run: false,
          attempts: 1,
          post_id: "18097273807967885",
          created_at: "2026-05-15T03:30:00.000Z"
        },
        {
          date,
          slot: 2,
          platform: "instagram",
          status: "failed",
          dry_run: false,
          attempts: 1,
          error: "media not ready",
          created_at: "2026-05-15T11:30:00.000Z"
        },
        {
          date,
          slot: 1,
          platform: "facebook",
          status: "success",
          dry_run: false,
          attempts: 1,
          post_id: "page_123",
          created_at: "2026-05-15T03:30:00.000Z"
        }
      ],
      root
    );
    const payload = {
      data: [
        { name: "reach", values: [{ value: 88 }] },
        { name: "saved", values: [{ value: 6 }] }
      ]
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

    const report = await fetchPostedInstagramInsights({
      since: date,
      until: date,
      root,
      config,
      metrics: ["reach", "saved"],
      fetchImpl
    });

    expect(report.source).toMatchObject({
      posted_log_dates: [date],
      instagram_posts: 1,
      skipped_rows: 1
    });
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    if (!row) throw new Error("Expected one Instagram insight row.");

    expect(row).toMatchObject({
      date,
      slot: 1,
      post_id: "18097273807967885",
      insights_ok: true,
      metrics: {
        reach: 88,
        saved: 6
      }
    });
    expect(row.topic).toBeTruthy();
    expect(row.visual_route).toBeTruthy();
    expect(row.traffic_route).toBeTruthy();
    expect(row.hashtags).toContain("#私享家洗衣店");
    expect(row.caption_length).toBeGreaterThan(50);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(String(url)).toBe("https://graph.facebook.com/v25.0/18097273807967885/insights?metric=reach%2Csaved");
    expect(init).toMatchObject({
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`
      }
    });
  });

  it("writes posted Instagram insights reports to the ignored data directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ig-insights-write-"));
    const report = {
      since: "2026-05-15",
      until: "2026-05-15",
      generated_at: "2026-05-15T00:00:00.000Z",
      graph_api_version: "v25.0",
      metrics: ["reach"],
      source: {
        posted_log_dates: [],
        instagram_posts: 0,
        skipped_rows: 0
      },
      rows: []
    };

    const outputPath = await writeInstagramPostedInsightsReport(report, root);

    expect(outputPath).toBe(instagramInsightsReportPath("2026-05-15", "2026-05-15", root));
  });
});
