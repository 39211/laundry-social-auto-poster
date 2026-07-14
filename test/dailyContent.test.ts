import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";

describe("DailyContent schema", () => {
  const config = getConfig({
    ...process.env,
    DRY_RUN: "true",
    PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
  });

  it("builds 2 complete slots", () => {
    const content = buildDailyContent("2026-05-15", config);

    expect(content.date).toBe("2026-05-15");
    expect(content.timezone).toBe("Asia/Taipei");
    expect(content.slots).toHaveLength(2);

    for (const slot of content.slots) {
      expect(slot.slot).toBeGreaterThanOrEqual(1);
      expect(slot.time).toMatch(/^\d{2}:\d{2}$/);
      expect(slot.topic.length).toBeGreaterThan(0);
      expect(slot.instagram_caption).toContain("私享家洗衣店");
      expect(slot.facebook_caption).toContain("私享家洗衣店");
      expect(slot.instagram_caption.split("\n\n")[1]).toBe("私享家洗衣店");
      expect(slot.image_prompt).toContain("Realistic");
      expect(slot.visual_route).toBeTruthy();
      expect(slot.local_image_path).toMatch(/^docs\/assets\/2026-05-15\/slot-\d{2}\.png$/);
      expect(slot.public_image_url).toMatch(/\/assets\/2026-05-15\/slot-\d{2}\.png$/);
      expect(slot.content_plan_source).toBe("legacy-template");
      expect(slot.status).toBe("pending");
    }
  });

  it("uses the 90-day growth playbook for dates in the active plan", () => {
    const content = buildDailyContent("2026-07-11", config);

    expect(content.slots).toHaveLength(2);
    expect(content.slots[0]?.content_plan_source).toBe("growth-playbook");
    expect(content.slots[0]?.topic).toBe("先看懂：白鞋鞋邊泛灰前的檢查");
    expect(content.slots[0]?.format).toBe("image-post");
    expect(content.slots[0]?.views_target).toBe(23);
    expect(content.slots[0]?.follower_target).toBe(1);
    expect(content.slots[0]?.follow_cta).toContain("追蹤");
    expect(content.slots[0]?.seo_sync_page).toBe("/services/white-shoe-cleaning.html");

    for (const slot of content.slots) {
      const caption = slot.instagram_caption;
      expect(caption.split("\n\n")[1]).toBe("私享家洗衣店");
      expect(caption).toContain(slot.follow_cta);
      expect(caption).toContain("#私享家洗衣店");
      expect(caption).toContain("#台中西屯洗衣店");
      expect(caption).not.toContain("畫面維持");
      expect(caption).not.toContain("這支內容會用");
      expect(caption).not.toContain("9:16");
      expect(slot.image_prompt).toContain("Realistic");
      expect(slot.image_prompt).toContain("私享家洗衣店");
    }
  });

  it("does not repeat planned topics across a 14-day content cycle", () => {
    const start = Date.parse("2026-07-02T00:00:00.000Z");
    const dates = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(start + index * 86_400_000);
      return date.toISOString().slice(0, 10);
    });
    const contents = dates.map((date) => buildDailyContent(date, config));
    const slot1Topics = contents.map((content) => content.slots[0]?.topic);
    const slot2Topics = contents.map((content) => content.slots[1]?.topic);

    expect(new Set(slot1Topics).size).toBe(14);
    expect(new Set(slot2Topics).size).toBe(14);
    expect(slot1Topics).not.toContain("白鞋鞋邊與內裡的濕悶痕跡");
    expect(slot2Topics).not.toContain("雨季通勤後的包角與鞋底檢查");
  });

  it("turns new service search routes into natural customer-facing captions", () => {
    const expectedRoutes = [
      ["/guides/shirt-suit-dry-cleaning.html", "襯衫", "#西裝乾洗"],
      ["/guides/bedding-duvet-cleaning.html", "床組", "#床組清洗"],
      ["/guides/plush-doll-cleaning.html", "娃娃", "#娃娃清洗"],
      ["/guides/luxury-dry-cleaning.html", "精品", "#精品乾洗"]
    ] as const;
    const start = Date.parse("2026-07-11T00:00:00.000Z");
    const plannedSlots = Array.from({ length: 90 }, (_, index) => {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      return buildDailyContent(date, config).slots;
    }).flat();

    for (const [route, objectWord, hashtag] of expectedRoutes) {
      const slot = plannedSlots.find((item) => item.seo_sync_page === route);
      expect(slot).toBeDefined();
      if (!slot) continue;
      const paragraphs = slot.facebook_caption.split("\n\n");
      const hashtags = slot.facebook_caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];

      expect(slot.seo_sync_page).toBe(route);
      expect(paragraphs[1]).toBe("私享家洗衣店");
      expect(slot.facebook_caption).toContain(objectWord);
      expect(slot.facebook_caption).toContain(hashtag);
      expect(hashtags.length).toBe(4);
      expect(slot.instagram_caption).not.toBe(slot.facebook_caption);
      expect(slot.instagram_caption).toContain(objectWord);
      expect(slot.instagram_caption).toContain(hashtag);
      expect(slot.facebook_caption).not.toMatch(/畫面維持|這支內容會用|短影音題|轉詢問題|9:16|主視覺|route|SEO/);
    }
  });

  it("keeps all 180 planned FB and IG captions publishable", () => {
    const start = Date.parse("2026-07-11T00:00:00.000Z");
    for (let index = 0; index < 90; index += 1) {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      const content = buildDailyContent(date, config);

      for (const slot of content.slots) {
        for (const caption of [slot.facebook_caption, slot.instagram_caption]) {
          const hashtags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
          expect(caption.split("\n\n")[1]).toBe("私享家洗衣店");
          expect(hashtags).toHaveLength(4);
          expect(caption).not.toMatch(/畫面維持|這支內容會用|短影音題|轉詢問題|9:16|主視覺|route|SEO/);
          expect(caption).not.toMatch(/保證|百分之百|完全去除|恢復全新|一定洗白/);
        }
      }
    }
  });
});
