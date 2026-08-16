import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  fetchInstagramMediaInsights,
  fetchPostedInstagramInsights,
  INSTAGRAM_COMMON_MEDIA_INSIGHT_METRICS,
  INSTAGRAM_REELS_MEDIA_INSIGHT_METRICS,
  simplifyInstagramInsights,
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
  metaAnalyticsAccessToken: "EAAabcdefghijklmnopqrstuvwxyz1234567890",
  facebookPageId: "123456789012345",
  instagramUserId: "12345678901234567",
  publicSiteBaseUrl: "https://example.github.io/laundry-social-auto-poster",
  publicImageBaseUrl: "https://example.github.io/laundry-social-auto-poster",
  publicRootPagesRepo: "",
  verifyPublicImageUrl: false
};

// Real Graph envelope from data/insights/instagram/2026-05-14_to_2026-08-11.json
// for post_id 18182049823393008 after Reels metrics were mixed into one GET.
const REELS_METRIC_UNSUPPORTED_ERROR = {
  error: {
    message:
      "(#100) The Media Insights API does not support the ig_reels_avg_watch_time, ig_reels_video_view_total_time metric for this media product type.",
    type: "OAuthException",
    code: 100,
    fbtrace_id: "AO8p8ySCekabZXGvIZU_He1"
  }
};

const COMMON_INSIGHT_PAYLOAD = {
  data: [
    { name: "views", values: [{ value: 87 }] },
    { name: "reach", values: [{ value: 46 }] },
    { name: "likes", values: [{ value: 0 }] },
    { name: "comments", values: [{ value: 0 }] },
    { name: "shares", values: [{ value: 0 }] },
    { name: "saved", values: [{ value: 0 }] },
    { name: "total_interactions", values: [{ value: 0 }] }
  ]
};

const REELS_INSIGHT_PAYLOAD = {
  data: [
    { name: "ig_reels_avg_watch_time", values: [{ value: 3900 }] },
    { name: "ig_reels_video_view_total_time", values: [{ value: 120000 }] }
  ]
};

function insightUrls(fetchImpl: typeof fetch): string[] {
  return vi
    .mocked(fetchImpl)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.includes("/insights"));
}

function decodedMetricParam(url: string): string {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/[?&]metric=([^&]+)/);
  return match?.[1] ?? "";
}

function platformFetch(options: { mediaProductType?: string; publishedAsReel?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/insights")) {
      const metrics = decodedMetricParam(url);
      const askedReels = INSTAGRAM_REELS_MEDIA_INSIGHT_METRICS.some((metric) => metrics.includes(metric));
      const askedCommon = INSTAGRAM_COMMON_MEDIA_INSIGHT_METRICS.some((metric) => metrics.includes(metric));
      if (askedReels && askedCommon) {
        return new Response(JSON.stringify(REELS_METRIC_UNSUPPORTED_ERROR), { status: 400 });
      }
      if (askedReels && !options.publishedAsReel && options.mediaProductType?.toUpperCase() !== "REELS") {
        return new Response(JSON.stringify(REELS_METRIC_UNSUPPORTED_ERROR), { status: 400 });
      }
      if (askedReels) return new Response(JSON.stringify(REELS_INSIGHT_PAYLOAD), { status: 200 });
      return new Response(JSON.stringify(COMMON_INSIGHT_PAYLOAD), { status: 200 });
    }
    if (url.includes("fields=media_product_type")) {
      return new Response(
        JSON.stringify({
          id: "18182049823393008",
          media_product_type: options.mediaProductType ?? "FEED"
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as unknown as typeof fetch;
}

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
        Authorization: `Bearer ${config.metaAnalyticsAccessToken}`
      }
    });
  });

  it("prefers the analytics token without changing the publishing token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;

    await fetchInstagramMediaInsights({
      postId: "18097273807967885",
      config: {
        ...config,
        metaAccessToken: "EAA-publishing-token",
        metaAnalyticsAccessToken: "EAA-analytics-token"
      },
      metrics: ["reach"],
      fetchImpl
    });

    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(init).toMatchObject({
      headers: {
        Authorization: "Bearer EAA-analytics-token"
      }
    });
  });

  it("uses the conservative default media metrics", async () => {
    const fetchImpl = platformFetch({ mediaProductType: "FEED" });

    await fetchInstagramMediaInsights({
      postId: "18097273807967885",
      config,
      fetchImpl
    });

    const urls = insightUrls(fetchImpl);
    expect(urls).toHaveLength(1);
    expect(decodedMetricParam(urls[0] ?? "")).toBe(INSTAGRAM_COMMON_MEDIA_INSIGHT_METRICS.join(","));
    expect(decodedMetricParam(urls[0] ?? "")).not.toContain("ig_reels");
  });

  it("does not put Reels-only metrics on a non-Reel insights URL", async () => {
    const fetchImpl = platformFetch();

    const result = await fetchInstagramMediaInsights({
      postId: "18182049823393008",
      config,
      publishedMediaType: "carousel",
      fetchImpl
    });

    const urls = insightUrls(fetchImpl);
    expect(urls).toHaveLength(1);
    expect(decodedMetricParam(urls[0] ?? "")).toBe(INSTAGRAM_COMMON_MEDIA_INSIGHT_METRICS.join(","));
    expect(urls[0]).not.toMatch(/ig_reels/);
    expect(result.insights_ok).toBe(true);
    expect(result.insights_status).toBe(200);
    expect(result.error).toBeUndefined();
    expect(result.raw).toEqual(COMMON_INSIGHT_PAYLOAD);
    expect(simplifyInstagramInsights(result.raw)).toMatchObject({ views: 87, reach: 46 });
    expect(vi.mocked(fetchImpl).mock.calls.some(([url]) => String(url).includes("fields=media_product_type"))).toBe(
      false
    );
  });

  it("looks up media_product_type when posted-log type is unknown and skips Reels metrics for FEED", async () => {
    const fetchImpl = platformFetch({ mediaProductType: "FEED" });

    const result = await fetchInstagramMediaInsights({
      postId: "18182049823393008",
      config,
      fetchImpl
    });

    const lookupUrl = vi
      .mocked(fetchImpl)
      .mock.calls.map(([url]) => String(url))
      .find((url) => url.includes("fields=media_product_type"));
    expect(lookupUrl).toBe("https://graph.facebook.com/v25.0/18182049823393008?fields=media_product_type");
    expect(String(lookupUrl)).not.toContain("access_token");

    const urls = insightUrls(fetchImpl);
    expect(urls).toHaveLength(1);
    expect(decodedMetricParam(urls[0] ?? "")).not.toContain("ig_reels");
    expect(result.insights_ok).toBe(true);
    expect(simplifyInstagramInsights(result.raw)).toMatchObject({ views: 87, reach: 46 });
  });

  it("requests Reels metrics in a second GET and merges both groups for a Reel", async () => {
    const fetchImpl = platformFetch({ publishedAsReel: true });

    const result = await fetchInstagramMediaInsights({
      postId: "18212771827351093",
      config,
      publishedMediaType: "reel",
      fetchImpl
    });

    const urls = insightUrls(fetchImpl);
    expect(urls).toHaveLength(2);
    expect(decodedMetricParam(urls[0] ?? "")).toBe(INSTAGRAM_COMMON_MEDIA_INSIGHT_METRICS.join(","));
    expect(decodedMetricParam(urls[0] ?? "")).not.toContain("ig_reels");
    expect(decodedMetricParam(urls[1] ?? "")).toBe(INSTAGRAM_REELS_MEDIA_INSIGHT_METRICS.join(","));
    expect(result.insights_ok).toBe(true);
    expect(result.metrics).toEqual([
      ...INSTAGRAM_COMMON_MEDIA_INSIGHT_METRICS,
      ...INSTAGRAM_REELS_MEDIA_INSIGHT_METRICS
    ]);
    expect(simplifyInstagramInsights(result.raw)).toEqual({
      views: 87,
      reach: 46,
      likes: 0,
      comments: 0,
      shares: 0,
      saved: 0,
      total_interactions: 0,
      ig_reels_avg_watch_time: 3900,
      ig_reels_video_view_total_time: 120000
    });
  });

  it("reproduces the #100 wholesale rejection when Reels metrics are mixed into one non-Reel GET", async () => {
    const mixed = [
      ...INSTAGRAM_COMMON_MEDIA_INSIGHT_METRICS,
      ...INSTAGRAM_REELS_MEDIA_INSIGHT_METRICS
    ].join(",");
    const fetchImpl = platformFetch();
    const mixedUrl = `https://graph.facebook.com/v25.0/18182049823393008/insights?metric=${encodeURIComponent(mixed)}`;
    const response = await fetchImpl(mixedUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.metaAnalyticsAccessToken}` }
    });
    const raw = await response.json();

    expect(response.status).toBe(400);
    expect(raw).toEqual(REELS_METRIC_UNSUPPORTED_ERROR);
    expect((raw as { error: { code: number; message: string } }).error.code).toBe(100);
    expect((raw as { error: { message: string } }).error.message).toContain("(#100)");
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
        config: { ...config, metaAccessToken: "[REDACTED]", metaAnalyticsAccessToken: "" },
        fetchImpl
      })
    ).rejects.toThrow("META_ANALYTICS_ACCESS_TOKEN or META_ACCESS_TOKEN is required");
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
        Authorization: `Bearer ${config.metaAnalyticsAccessToken}`
      }
    });
  });

  it("uses posted-log published_media_type to split Reel vs non-Reel insight requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-ig-insights-split-"));
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
          published_media_type: "carousel",
          post_id: "18182049823393008",
          created_at: "2026-08-11T03:31:14.643Z"
        },
        {
          date,
          slot: 2,
          platform: "instagram",
          status: "success",
          dry_run: false,
          attempts: 1,
          published_media_type: "reel",
          post_id: "18212771827351093",
          created_at: "2026-08-11T11:31:00.000Z"
        }
      ],
      root
    );

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const metrics = decodedMetricParam(url);
      if (url.includes("18182049823393008") && /ig_reels/.test(metrics)) {
        return new Response(JSON.stringify(REELS_METRIC_UNSUPPORTED_ERROR), { status: 400 });
      }
      if (/ig_reels/.test(metrics)) {
        return new Response(JSON.stringify(REELS_INSIGHT_PAYLOAD), { status: 200 });
      }
      return new Response(JSON.stringify(COMMON_INSIGHT_PAYLOAD), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await fetchPostedInstagramInsights({
      since: date,
      until: date,
      root,
      config,
      fetchImpl
    });

    expect(report.rows).toHaveLength(2);
    const carousel = report.rows.find((row) => row.post_id === "18182049823393008");
    const reel = report.rows.find((row) => row.post_id === "18212771827351093");
    if (!carousel || !reel) throw new Error("Expected carousel and reel insight rows.");

    expect(carousel.insights_ok).toBe(true);
    expect(carousel.metrics).toMatchObject({ views: 87, reach: 46 });
    expect(carousel.metrics.ig_reels_avg_watch_time).toBeUndefined();

    expect(reel.insights_ok).toBe(true);
    expect(reel.metrics).toMatchObject({
      views: 87,
      reach: 46,
      ig_reels_avg_watch_time: 3900,
      ig_reels_video_view_total_time: 120000
    });

    const carouselUrls = insightUrls(fetchImpl).filter((url) => url.includes("18182049823393008"));
    const reelUrls = insightUrls(fetchImpl).filter((url) => url.includes("18212771827351093"));
    expect(carouselUrls).toHaveLength(1);
    expect(decodedMetricParam(carouselUrls[0] ?? "")).not.toContain("ig_reels");
    expect(reelUrls).toHaveLength(2);
    expect(decodedMetricParam(reelUrls[0] ?? "")).not.toContain("ig_reels");
    expect(decodedMetricParam(reelUrls[1] ?? "")).toBe(INSTAGRAM_REELS_MEDIA_INSIGHT_METRICS.join(","));
    expect(
      vi.mocked(fetchImpl).mock.calls.some(([url]) => String(url).includes("fields=media_product_type"))
    ).toBe(false);
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
