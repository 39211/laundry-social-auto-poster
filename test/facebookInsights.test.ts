import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  fetchPostedFacebookInsights,
  writeFacebookPostedInsightsReport
} from "../src/facebookInsights";
import { writePostLog } from "../src/logging";
import { facebookInsightsReportPath } from "../src/paths";
import type { AppConfig } from "../src/types";

const config: AppConfig = {
  dryRun: false,
  timezone: "Asia/Taipei",
  graphApiVersion: "v25.0",
  metaAccessToken: "EAA-publishing-token",
  metaAnalyticsAccessToken: "EAA-analytics-token",
  facebookPageId: "123456789012345",
  instagramUserId: "12345678901234567",
  publicSiteBaseUrl: "https://example.com",
  publicImageBaseUrl: "https://example.com",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false
};

describe("Facebook post insights client", () => {
  it("collects current view metrics and engagement summaries without exposing the token in URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-fb-insights-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await writePostLog(date, [{
      date,
      slot: 1,
      platform: "facebook",
      status: "success",
      dry_run: false,
      attempts: 1,
      post_id: "page_123",
      created_at: "2026-05-15T03:30:00.000Z"
    }], root);

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/insights")) {
        return new Response(JSON.stringify({
          data: [
            { name: "post_media_view", values: [{ value: 120 }] },
            { name: "post_total_media_view_unique", values: [{ value: 80 }] }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: "page_123",
        reactions: { summary: { total_count: 7 } },
        comments: { summary: { total_count: 2 } },
        shares: { count: 1 }
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await fetchPostedFacebookInsights({
      since: date,
      until: date,
      root,
      config,
      fetchImpl
    });

    expect(report.source.facebook_posts).toBe(1);
    expect(report.rows[0]).toMatchObject({
      date,
      slot: 1,
      post_id: "page_123",
      insights_ok: true,
      insights: {
        views: 120,
        reach: 80,
        reactions: 7,
        comments: 2,
        shares: 1
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [input, init] of vi.mocked(fetchImpl).mock.calls) {
      expect(String(input)).not.toContain("access_token");
      expect(init).toMatchObject({
        method: "GET",
        headers: { Authorization: "Bearer EAA-analytics-token" }
      });
    }
  });

  it("preserves empty Meta insight data as null instead of zero", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-fb-empty-insights-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await writePostLog(date, [{
      date,
      slot: 1,
      platform: "facebook",
      status: "success",
      dry_run: false,
      attempts: 1,
      post_id: "page_123",
      created_at: "2026-05-15T03:30:00.000Z"
    }], root);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify(url.pathname.endsWith("/insights")
        ? { data: [] }
        : {
            reactions: { summary: { total_count: 0 } },
            comments: { summary: { total_count: 0 } }
          }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await fetchPostedFacebookInsights({
      since: date,
      until: date,
      root,
      config,
      fetchImpl
    });

    expect(report.rows[0]?.insights).toEqual({
      views: null,
      reach: null,
      reactions: 0,
      comments: 0,
      shares: null
    });
  });

  it("writes reports to the Facebook insights directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-fb-insights-write-"));
    const report = {
      since: "2026-05-15",
      until: "2026-05-15",
      generated_at: "2026-05-15T00:00:00.000Z",
      graph_api_version: "v25.0",
      metrics: ["post_media_view"],
      source: { posted_log_dates: [], facebook_posts: 0, skipped_rows: 0 },
      rows: []
    };
    const outputPath = await writeFacebookPostedInsightsReport(report, root);
    expect(outputPath).toBe(facebookInsightsReportPath("2026-05-15", "2026-05-15", root));
  });
});
