import { describe, expect, it } from "vitest";
import {
  buildPerformanceOptimizationPlan
} from "../src/performanceOptimization";
import type { OperationsSummary } from "../src/operationsDashboard";
import type { Review72HourRow } from "../src/review72Hours";

function row(topic: string, reach: number, mediaType = "image"): Review72HourRow {
  return {
    date: "2026-07-20",
    slot: 1,
    topic,
    media_type: mediaType,
    published_at: "2026-07-20T03:00:00.000Z",
    eligible_at: "2026-07-23T03:00:00.000Z",
    metrics: {
      reach,
      saved: 0,
      shares: 0,
      line_clicks: null,
      inquiries: null,
      bookings: null,
      revenue_twd: null
    },
    data_quality: ["LINE clicks unavailable"]
  };
}

const summary: OperationsSummary = {
  current_day: 18,
  total_days: 90,
  today_views_target: 100,
  today_follower_target: 2,
  due_slots: 34,
  generated_due_slots: 32,
  approved_due_slots: 24,
  seo_due_slots: 24,
  published_due_slots: 22,
  generated_rate: 32 / 34,
  approval_rate: 24 / 34,
  seo_rate: 24 / 34,
  publish_rate: 22 / 34,
  published_platform_posts: 46,
  platform_view_rows: 22,
  kpi_coverage: 22 / 46
};

describe("performance optimization plan", () => {
  it("turns 72-hour evidence into null-safe directional decisions", () => {
    const plan = buildPerformanceOptimizationPlan({
      reviewRows: [
        row("店家與公司的大量衣物也能一次收", 92),
        row("白鞋鞋邊與內裡的濕悶痕跡", 76),
        row("先看懂：白襯衫領口與腋下泛黃", 73, "carousel"),
        row("忙到沒手再搬洗衣籃的家庭日常", 30)
      ],
      summary,
      generatedAt: "2026-07-28T00:00:00.000Z"
    }) as {
      status: string;
      measurement: {
        reach: { median: number; p75: number; next_30_day_median_target: number };
        conversion_source_coverage: { line_clicks: number; bookings: number };
      };
      evidence_led_content_clusters: Array<{ id: string; max_reach: number }>;
      kpi_framework: { primary: Array<{ metric: string; baseline: number | null }> };
      seo_aio_geo: { implementation_rules: string[] };
    };

    expect(plan.status).toBe("partial_measurement_ready_for_directional_decisions");
    expect(plan.measurement.reach).toMatchObject({
      median: 74.5,
      p75: 76,
      next_30_day_median_target: 76
    });
    expect(plan.measurement.conversion_source_coverage).toMatchObject({
      line_clicks: 0,
      bookings: 0
    });
    expect(plan.evidence_led_content_clusters[0]).toMatchObject({
      id: "business_bulk",
      max_reach: 92
    });
    expect(plan.kpi_framework.primary.find((item) => item.metric === "Bookings attributed to content")?.baseline).toBeNull();
    expect(plan.seo_aio_geo.implementation_rules).toContain(
      "Avoid creating separate thin pages for every keyword variation."
    );
  });
});
