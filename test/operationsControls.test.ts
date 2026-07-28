import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordConversionEvent } from "../src/conversionFunnel";
import { writeDailyContent, writePostLog } from "../src/logging";
import { calculateRollingPublishingSla, resolveSlaCheckpoint } from "../src/publishingSla";
import { generate72HourReview } from "../src/review72Hours";
import type { DailyContent, PostLogEntry } from "../src/types";

function successfulPosts(date: string, slot: number, createdAt: string): PostLogEntry[] {
  return (["facebook", "instagram"] as const).map((platform) => ({
    date,
    slot,
    platform,
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: `${platform}-${date}-${slot}`,
    created_at: createdAt
  }));
}

describe("publishing SLA and 72-hour review controls", () => {
  beforeEach(() => vi.stubEnv("TIMEZONE", "Asia/Taipei"));
  afterEach(() => vi.unstubAllEnvs());

  it("maps the four daily SLA checkpoints to the correct slot and mode", () => {
    expect(resolveSlaCheckpoint(new Date("2026-07-22T10:45:00+08:00"))).toMatchObject({ slot: 1, mode: "preflight" });
    expect(resolveSlaCheckpoint(new Date("2026-07-22T11:45:00+08:00"))).toMatchObject({ slot: 1, mode: "overdue" });
    expect(resolveSlaCheckpoint(new Date("2026-07-22T18:45:00+08:00"))).toMatchObject({ slot: 2, mode: "preflight" });
    expect(resolveSlaCheckpoint(new Date("2026-07-22T19:45:00+08:00"))).toMatchObject({ slot: 2, mode: "overdue" });
  });

  it("calculates dual-platform fulfillment without counting one-platform posts", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-sla-"));
    await writePostLog("2026-07-21", [
      ...successfulPosts("2026-07-21", 1, "2026-07-21T03:30:00.000Z"),
      successfulPosts("2026-07-21", 2, "2026-07-21T11:30:00.000Z")[0]!
    ], root);
    const report = await calculateRollingPublishingSla(root, new Date("2026-07-22T10:00:00+08:00"));
    expect(report.due_slots).toBe(26);
    expect(report.dual_platform_success_slots).toBe(1);
    expect(report.fulfillment_rate).toBeCloseTo(1 / 26);
  });

  it("reviews only posts older than 72 hours and keeps unavailable metrics as null", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-review-"));
    const date = "2026-07-18";
    const content: DailyContent = {
      date,
      timezone: "Asia/Taipei",
      generated_at: "2026-07-18T00:00:00.000Z",
      slots: [{
        slot: 1,
        time: "11:30",
        category: "知識文",
        topic: "測試貼文",
        media_type: "image",
        instagram_caption: "測試",
        facebook_caption: "測試",
        image_prompt: "測試",
        visual_route: "shop-inspection",
        traffic_route: "object-proof",
        local_image_path: "docs/assets/2026-07-18/slot-01.png",
        public_image_url: "https://example.com/slot-01.png",
        status: "pending"
      }, {
        slot: 2,
        time: "19:30",
        category: "情境文",
        topic: "未發佈",
        media_type: "image",
        instagram_caption: "測試",
        facebook_caption: "測試",
        image_prompt: "測試",
        visual_route: "macro-detail",
        traffic_route: "dwell-detail",
        local_image_path: "docs/assets/2026-07-18/slot-02.png",
        public_image_url: "https://example.com/slot-02.png",
        status: "pending"
      }]
    };
    await writeDailyContent(content, root);
    await writePostLog(date, successfulPosts(date, 1, "2026-07-18T04:00:00.000Z"), root);
    await recordConversionEvent({
      event_type: "booking",
      event_date: "2026-07-21",
      content_date: date,
      slot: 1,
      platform: "unknown",
      source: "store-backfill",
      count: 1
    }, root);
    await mkdir(join(root, "data", "insights", "instagram"), { recursive: true });
    await writeFile(join(root, "data", "insights", "instagram", "sample.json"), JSON.stringify({ rows: [] }));
    await writeFile(
      join(root, "data", "insights", "instagram", "z-older.json"),
      JSON.stringify({
        generated_at: "2026-07-20T00:00:00.000Z",
        rows: [{ date, slot: 1, metrics: { reach: 1 } }]
      })
    );
    await writeFile(
      join(root, "data", "insights", "instagram", "a-newer.json"),
      JSON.stringify({
        generated_at: "2026-07-21T00:00:00.000Z",
        rows: [{ date, slot: 1, metrics: { reach: 20 } }]
      })
    );
    await mkdir(join(root, "data", "insights", "facebook"), { recursive: true });
    await writeFile(
      join(root, "data", "insights", "facebook", "latest.json"),
      JSON.stringify({
        generated_at: "2026-07-21T00:00:00.000Z",
        rows: [{ date, slot: 1, insights: { reach: 30 } }]
      })
    );

    const rows = await generate72HourReview({ root, asOf: new Date("2026-07-22T05:00:00.000Z") });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metrics).toMatchObject({ reach: 50, saved: null, shares: null, line_clicks: null, bookings: 1 });
    expect(rows[0]?.data_quality).toContain("LINE clicks unavailable: GA4 export/backfill missing");
  });
});
