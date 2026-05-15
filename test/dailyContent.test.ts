import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";

describe("DailyContent schema", () => {
  it("builds 10 complete slots", () => {
    const content = buildDailyContent(
      "2026-05-15",
      getConfig({
        ...process.env,
        DRY_RUN: "true",
        PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
      })
    );

    expect(content.date).toBe("2026-05-15");
    expect(content.timezone).toBe("Asia/Taipei");
    expect(content.slots).toHaveLength(10);

    for (const slot of content.slots) {
      expect(slot.slot).toBeGreaterThanOrEqual(1);
      expect(slot.time).toMatch(/^\d{2}:\d{2}$/);
      expect(slot.topic.length).toBeGreaterThan(0);
      expect(slot.instagram_caption).toContain("私享家洗衣店");
      expect(slot.facebook_caption).toContain("私享家洗衣店");
      expect(slot.image_prompt).toContain("no");
      expect(slot.local_image_path).toMatch(/^docs\/assets\/2026-05-15\/slot-\d{2}\.png$/);
      expect(slot.public_image_url).toMatch(/\/assets\/2026-05-15\/slot-\d{2}\.png$/);
      expect(slot.status).toBe("pending");
    }
  });
});
