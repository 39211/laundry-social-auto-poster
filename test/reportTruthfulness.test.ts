import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeDailyContent, writePostLog } from "../src/logging";
import { calculateRollingPublishingSla } from "../src/publishingSla";
import { reviewBatch } from "../src/reelBatchReview";
import { REEL_SCHEDULE } from "../src/reelConcepts";
import { generate72HourReview } from "../src/review72Hours";
import type { DailyContent, Platform, PostLogEntry } from "../src/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function dailyContent(date: string, slotTwoMediaType: "image" | "reel" = "reel"): DailyContent {
  return {
    date,
    timezone: "Asia/Taipei",
    generated_at: `${date}T00:00:00.000Z`,
    slots: [
      {
        slot: 1,
        time: "11:30",
        category: "知識文",
        topic: "報表證據測試一",
        media_type: "image",
        instagram_caption: "測試",
        facebook_caption: "測試",
        image_prompt: "測試",
        visual_route: "shop-inspection",
        traffic_route: "object-proof",
        local_image_path: `docs/assets/${date}/slot-01.png`,
        public_image_url: `https://example.com/${date}/slot-01.png`,
        status: "pending"
      },
      {
        slot: 2,
        time: "19:30",
        category: "情境文",
        topic: "報表證據測試二",
        media_type: slotTwoMediaType,
        instagram_caption: "測試",
        facebook_caption: "測試",
        image_prompt: "測試",
        ...(slotTwoMediaType === "reel"
          ? {
              video_prompt: "測試 Reel",
              local_video_path: `docs/assets/${date}/slot-02.mp4`
            }
          : {}),
        visual_route: "macro-detail",
        traffic_route: "dwell-detail",
        local_image_path: `docs/assets/${date}/slot-02.png`,
        public_image_url: `https://example.com/${date}/slot-02.png`,
        status: "pending"
      }
    ]
  };
}

function post(
  date: string,
  slot: number,
  platform: Platform,
  options: Partial<PostLogEntry> = {}
): PostLogEntry {
  const postId = `${platform}-${date}-${slot}`;
  return {
    date,
    slot,
    platform,
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: postId,
    created_at: `${date}T12:00:00.000Z`,
    ...options
  };
}

function qualifiedInstagramReel(date: string, slot = 2, options: Partial<PostLogEntry> = {}): PostLogEntry {
  const base = post(date, slot, "instagram");
  return {
    ...base,
    published_media_type: "reel",
    video_status: "published",
    video_sha256: "a".repeat(64),
    remote_reel_evidence: {
      remote_id: base.post_id!,
      permalink: `https://www.instagram.com/reel/${base.post_id}`,
      verified_at: `${date}T12:01:00.000Z`,
      remote_media_type: "REELS",
      caption_exact_match: true
    },
    ...options
  };
}

describe("report truthfulness gates", () => {
  it("does not let duplicate, cross-date, or missing-boolean success rows satisfy the rolling SLA", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-report-sla-"));
    roots.push(root);
    const date = "2026-08-18";
    const validFacebook = post(date, 1, "facebook");
    const validInstagram = post(date, 1, "instagram");

    await writePostLog(date, [
      validFacebook,
      { ...validFacebook, post_id: "facebook-duplicate" },
      validInstagram,
      // A row stored in today's file cannot borrow yesterday's date.
      post(date, 2, "facebook", { date: "2026-08-17" }),
      post(date, 2, "instagram"),
      // `dry_run` must be a literal boolean false, not an omitted truthy-looking row.
      { ...post(date, 3, "facebook"), dry_run: undefined } as unknown as PostLogEntry,
      post(date, 3, "instagram", { post_id: "" })
    ], root);

    const report = await calculateRollingPublishingSla(root, new Date("2026-08-19T23:00:00+08:00"));
    expect(report.dual_platform_success_slots).toBe(0);
    expect(report.unverified_platform_claims).toBe(4);
  });

  it("excludes ambiguous transport and Reel fallback from the 72-hour strategy source, and records data gaps", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-report-72h-"));
    roots.push(root);
    const duplicateDate = "2026-07-15";
    const crossDate = "2026-07-16";
    const missingBooleanDate = "2026-07-17";
    const fallbackDate = "2026-07-18";
    for (const date of [duplicateDate, crossDate, missingBooleanDate, fallbackDate]) {
      await writeDailyContent(dailyContent(date), root);
    }

    const duplicateFacebook = post(duplicateDate, 1, "facebook");
    await writePostLog(duplicateDate, [
      duplicateFacebook,
      { ...duplicateFacebook, post_id: "duplicate-facebook" },
      post(duplicateDate, 1, "instagram")
    ], root);
    await writePostLog(crossDate, [
      post(crossDate, 1, "facebook", { date: duplicateDate }),
      post(crossDate, 1, "instagram")
    ], root);
    await writePostLog(missingBooleanDate, [
      { ...post(missingBooleanDate, 1, "facebook"), dry_run: undefined } as unknown as PostLogEntry,
      post(missingBooleanDate, 1, "instagram", { post_id: "" })
    ], root);
    await writePostLog(fallbackDate, [
      post(fallbackDate, 2, "facebook", {
        published_media_type: "image",
        video_status: "VIDEO_DEFERRED"
      }),
      post(fallbackDate, 2, "instagram", {
        published_media_type: "image",
        video_status: "VIDEO_DEFERRED"
      })
    ], root);

    const rows = await generate72HourReview({ root, asOf: new Date("2026-07-25T12:00:00.000Z") });
    expect(rows).toEqual([]);
    const output = JSON.parse(await readFile(join(root, "output", "operations", "72-hour-review.json"), "utf8")) as {
      data_gaps: string[];
    };
    expect(output.data_gaps.join("\n")).toContain(`${duplicateDate} slot 1: FB/IG live transport evidence is missing or ambiguous`);
    expect(output.data_gaps.join("\n")).toContain(`${crossDate} slot 1: FB/IG live transport evidence is missing or ambiguous`);
    expect(output.data_gaps.join("\n")).toContain(`${missingBooleanDate} slot 1: FB/IG live transport evidence is missing or ambiguous`);
    expect(output.data_gaps.join("\n")).toContain(`${fallbackDate} slot 2: planned Reel lacks qualified dual-platform Reel evidence`);
  });

  it("does not turn a duplicate or VIDEO_DEFERRED Instagram row into a Reel strategy sample", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-report-reel-"));
    roots.push(root);
    const date = REEL_SCHEDULE[0]!.date;
    await writeDailyContent(dailyContent(date), root);
    const reel = qualifiedInstagramReel(date);
    await writePostLog(date, [reel, { ...reel, post_id: "duplicate-instagram-reel" }], root);

    const duplicateReport = await reviewBatch({ root, asOf: "2026-08-10" });
    const duplicateOutcome = duplicateReport.outcomes.find((item) => item.date === date);
    expect(duplicateOutcome).toMatchObject({ published: false, verdict: "data_gap" });
    expect(duplicateReport.mature_count).toBe(0);
    expect(duplicateReport.data_gaps.join("\n")).toContain("Instagram live transport evidence is missing or ambiguous");

    await writePostLog(date, [
      post(date, 2, "instagram", {
        published_media_type: "image",
        video_status: "VIDEO_DEFERRED"
      })
    ], root);
    const fallbackReport = await reviewBatch({ root, asOf: "2026-08-10" });
    const fallbackOutcome = fallbackReport.outcomes.find((item) => item.date === date);
    expect(fallbackOutcome).toMatchObject({ published: false, verdict: "data_gap" });
    expect(fallbackReport.mature_count).toBe(0);
    expect(fallbackReport.data_gaps.join("\n")).toContain("fallback or VIDEO_DEFERRED is not a Reel strategy sample");
  });
});
