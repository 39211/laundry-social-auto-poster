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
      expect(slot.status).toBe("pending");
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
});
