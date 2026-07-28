import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import { writeVideoPromptManifest } from "../src/generateVideo";
import { writeVideoCandidateManifest } from "../src/generateVideoCandidate";

const campaignDates = [
  "2026-07-16",
  "2026-07-17",
  "2026-07-18",
  "2026-07-19",
  "2026-07-20",
  "2026-07-21",
  "2026-07-22"
];

const reelDates = new Set(["2026-07-16", "2026-07-18", "2026-07-21"]);

const campaignScenarios = [
  { date: "2026-07-16", scenario: "busy family", topicIncludes: "家庭", storyIncludes: "小孩", format: "reel" },
  { date: "2026-07-17", scenario: "office worker", topicIncludes: "下班", storyIncludes: "襯衫", format: "real-shop-photo" },
  { date: "2026-07-18", scenario: "large bedding set", topicIncludes: "床組", storyIncludes: "棉被", format: "reel" },
  { date: "2026-07-19", scenario: "luxury garments", topicIncludes: "精品", storyIncludes: "飾件", format: "image-post" },
  { date: "2026-07-20", scenario: "shoes/bags", topicIncludes: "鞋包", storyIncludes: "提把", format: "real-shop-photo" },
  { date: "2026-07-21", scenario: "rainy day", topicIncludes: "下雨", storyIncludes: "雨", format: "reel" },
  {
    date: "2026-07-22",
    scenario: "shop/company bulk laundry",
    topicIncludes: "店家與公司",
    storyIncludes: "制服",
    format: "image-post"
  }
] as const;

describe("Taichung free pickup-delivery campaign", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses one distinct 19:30 pickup-delivery post every day for one week", () => {
    const config = getConfig({
      ...process.env,
      PUBLIC_IMAGE_BASE_URL: "https://39211.github.io",
      GROK_REELS_ENABLED: "true"
    });
    const slots = campaignDates.map((date) => buildDailyContent(date, config).slots[1]!);

    expect(new Set(slots.map((slot) => slot.topic)).size).toBe(7);
    for (const [index, slot] of slots.entries()) {
      const date = campaignDates[index]!;
      const expected = campaignScenarios[index]!;
      expect(slot.time).toBe("19:30");
      expect(slot.format).toBe(expected.format);
      expect(slot.topic).toContain(expected.topicIncludes);
      expect(slot.facebook_caption).toContain(expected.storyIncludes);
      expect(slot.facebook_caption.split("\n\n")[1]).toBe("私享家洗衣店");
      expect(slot.facebook_caption).toContain("台中市全區免費到府收送");
      expect(slot.facebook_caption).toContain("LINE");
      expect(slot.facebook_caption).toContain("#台中洗衣收送");
      expect(slot.facebook_caption).toContain("#免費到府收送");
      expect(slot.seo_sync_page).toBe("/services/taichung-citywide-laundry-pickup.html");
      expect(slot.instagram_caption).not.toBe(slot.facebook_caption);
      expect(slot.facebook_caption.match(/#[\p{L}\p{N}_]+/gu)).toHaveLength(4);
      expect(slot.media_type).toBe(reelDates.has(date) ? "reel" : "image");
      if (reelDates.has(date)) {
        expect(slot.video_prompt).toContain("10-second vertical");
        expect(slot.local_video_path).toMatch(/\.mp4$/);
        expect(slot.public_video_url).toMatch(/\.mp4$/);
      } else {
        expect(slot.video_prompt).toBeUndefined();
        expect(slot.local_video_path).toBeUndefined();
      }
    }
  });

  it("writes a paid-generation manifest only for the planned Reel slot", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://39211.github.io");
    vi.stubEnv("GROK_REELS_ENABLED", "true");
    const root = await mkdtemp(join(tmpdir(), "laundry-video-manifest-"));
    const output = await writeVideoPromptManifest("2026-07-16", root);
    const manifest = JSON.parse(await readFile(output, "utf8")) as Array<Record<string, unknown>>;

    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      date: "2026-07-16",
      slot: 2,
      model: "grok-imagine-video",
      duration_seconds: 10,
      aspect_ratio: "9:16",
      resolution: "720p",
      status: "generation_pending"
    });
  });

  it("never silently downgrades a planned Reel while Grok generation is disabled", () => {
    const config = getConfig({
      ...process.env,
      PUBLIC_IMAGE_BASE_URL: "https://39211.github.io",
      GROK_REELS_ENABLED: "false"
    });
    const slot = buildDailyContent("2026-07-16", config).slots[1]!;

    expect(slot.format).toBe("reel");
    expect(slot.media_type).toBe("reel");
    expect(slot.video_prompt).toContain("10-second vertical");
    expect(slot.local_video_path).toMatch(/\.mp4$/);
  });

  it("keeps slot 1 as normal care knowledge and slot 2 as the only pickup campaign", () => {
    const config = getConfig({
      ...process.env,
      PUBLIC_IMAGE_BASE_URL: "https://39211.github.io",
      GROK_REELS_ENABLED: "true"
    });

    for (const date of campaignDates) {
      const day = buildDailyContent(date, config);
      expect(day.slots).toHaveLength(2);
      expect(day.slots[0]?.time).toBe("11:30");
      expect(day.slots[0]?.category).toBe("知識文");
      expect(day.slots[0]?.facebook_caption).not.toContain("台中市全區免費到府收送");
      expect(day.slots[1]?.time).toBe("19:30");
      expect(day.slots[1]?.category).toBe("情境文");
      expect(day.slots[1]?.facebook_caption).toContain("台中市全區免費到府收送");
    }
  });

  it("uses the v2 reach and conversion pair on 2026-07-25 without an unavailable Reel", () => {
    const config = getConfig({
      ...process.env,
      PUBLIC_IMAGE_BASE_URL: "https://39211.github.io",
      GROK_REELS_ENABLED: "false"
    });
    const day = buildDailyContent("2026-07-25", config);
    const [reach, conversion] = day.slots;

    expect(reach).toMatchObject({
      slot: 1,
      media_type: "image",
      traffic_route: "share-worthy-care",
      content_role: "reach-answer",
      seo_sync_page: "/services/fabric-storage.html"
    });
    expect(reach?.facebook_caption).toContain("領口內側");
    expect(reach?.instagram_caption).toContain("私訊");

    expect(conversion).toMatchObject({
      slot: 2,
      media_type: "image",
      traffic_route: "value-prop-lead",
      content_role: "evidence-conversion",
      seo_sync_page: "/services/taichung-citywide-laundry-pickup.html"
    });
    expect(conversion?.facebook_caption).toContain("台中市全區免費到府收送");
    expect(conversion?.image_prompt).toContain("完整頭部");
    expect(conversion?.image_prompt).toContain("沒有雨、沒有雨傘");
    expect(conversion?.local_video_path).toBeUndefined();
    expect(conversion?.public_video_url).toBeUndefined();
  });

  it("uses a concrete reach and pickup-conversion pair on 2026-07-27", () => {
    const config = getConfig({
      ...process.env,
      PUBLIC_IMAGE_BASE_URL: "https://39211.github.io",
      GROK_REELS_ENABLED: "false"
    });
    const [reach, conversion] = buildDailyContent("2026-07-27", config).slots;

    expect(reach).toMatchObject({
      content_role: "reach-answer",
      media_type: "image",
      seo_sync_page: "/services/shoe-bag-care.html"
    });
    expect(reach?.facebook_caption).toContain("粉痕要先分辨");
    expect(reach?.image_prompt).toContain("沒有斷裂或懸空帶子");

    expect(conversion).toMatchObject({
      content_role: "evidence-conversion",
      media_type: "image",
      seo_sync_page: "/services/taichung-citywide-laundry-pickup.html"
    });
    expect(conversion?.facebook_caption).toContain("台中市全區免費收送");
    expect(conversion?.instagram_caption).toContain("私訊");
    expect(conversion?.image_prompt).toContain("運動上衣已從包內取出");
  });

  it("keeps 2026-07-28 through 2026-08-03 concrete with one daily pickup post", () => {
    const config = getConfig({
      ...process.env,
      PUBLIC_IMAGE_BASE_URL: "https://39211.github.io",
      GROK_REELS_ENABLED: "false"
    });
    const dates = ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03"];

    for (const date of dates) {
      const [reach, pickup] = buildDailyContent(date, config).slots;
      expect(reach?.content_role).toBe("reach-answer");
      expect(pickup?.content_role).toBe("evidence-conversion");
      expect(pickup?.seo_sync_page).toBe("/services/taichung-citywide-laundry-pickup.html");
      expect(pickup?.facebook_caption).toContain("台中市全區免費收送");
      expect(pickup?.instagram_caption).toContain("私訊");
      expect(pickup?.instagram_caption).not.toContain("LINE 諮詢");
      expect(reach?.facebook_caption).not.toContain("先看材質、髒污位置與既有磨損");
      expect(pickup?.facebook_caption).not.toContain("如果你也遇到類似狀況");
      expect(reach?.image_prompt.length).toBeGreaterThan(120);
      expect(pickup?.image_prompt.length).toBeGreaterThan(120);
    }
  });

  it("keeps 7/28 legacy evidence separate, then plans four images plus one gated Grok video per slot", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://39211.github.io");
    vi.stubEnv("GROK_REELS_ENABLED", "false");
    const legacy = buildDailyContent("2026-07-28", getConfig(process.env));
    expect(legacy.slots[0]?.media_package).toBeUndefined();
    expect(legacy.slots[1]?.media_type).toBe("image");

    for (const date of ["2026-07-29", "2026-07-30", "2026-08-01"]) {
      const slots = buildDailyContent(date, getConfig(process.env)).slots;
      expect(slots).toHaveLength(2);
      for (const slot of slots) {
        expect(slot.media_type).toBe("mixed-carousel");
        expect(slot.carousel_items).toHaveLength(4);
        expect(slot.carousel_items?.every((item) => item.image_prompt.includes("photorealistic"))).toBe(true);
        expect(slot.carousel_items?.every((item) => item.image_prompt.includes("No poster layout"))).toBe(true);
        expect(slot.carousel_items?.every((item) => item.image_prompt.includes("no readable text"))).toBe(true);
        expect(slot.media_package).toMatchObject({
          status: "planned_unpublished",
          image_count: 4,
          companion_video_required: true,
          publish_authorized: false,
          included_in_kpi: false
        });
        expect(slot.video_candidate).toMatchObject({
          status: "concept_ready",
          duration_seconds: 12,
          aspect_ratio: "9:16",
          fallback_media_type: "image"
        });
        expect(slot.video_candidate?.memory_hook.length).toBeGreaterThanOrEqual(6);
        expect(slot.video_candidate?.single_action.length).toBeGreaterThan(20);
        expect(slot.video_candidate?.grok_motion_prompt).toContain("one dominant action only");
        expect(slot.video_prompt).toBe(slot.video_candidate?.grok_motion_prompt);
      }

      const slot = slots[1]!;
      expect(slot.carousel_items?.every((item) => item.image_prompt.includes("blue woven"))).toBe(true);
      expect(slot.carousel_items?.every((item) => item.image_prompt.includes("bag"))).toBe(true);
      expect(slot.local_video_path).toMatch(/\.mp4$/);
      expect(slot.public_video_url).toMatch(/\.mp4$/);

      const root = await mkdtemp(join(tmpdir(), "laundry-video-candidate-"));
      const output = await writeVideoCandidateManifest(date, root);
      const manifest = JSON.parse(await readFile(output, "utf8")) as Array<Record<string, unknown>>;
      expect(manifest).toHaveLength(2);
      expect(manifest[0]).toMatchObject({
        date,
        slot: 1,
        generation_route: "grok-imagine-video-1.5",
        preferred_submission_route: "blocked-pending-approved-official-route",
        generation_authorized: false,
        handoff_status: "handoff_pending",
        asset_package: "four-images-plus-companion-video",
        image_count: 4,
        current_publish_media_type: "mixed-carousel",
        final_master_resolution: "1080x1920",
        generated_clip_audio_used: false,
        publish_authorized: false,
        included_in_kpi: false,
        fallback_media_type: "image",
        grok_review_required: true,
        sol_review_required: true
      });
    }
  });
});
