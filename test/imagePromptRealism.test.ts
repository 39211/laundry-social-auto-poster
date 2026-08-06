import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import { sanitizeImagePrompt } from "../src/generateImage";

// The account's images kept coming out as boutique product shots of brand-new
// items while every caption talked about wear, damp and stains. Both halves of
// the fix are held here: prompts built today ask for honest use, and prompts
// stored in old calendars are rewritten on their way into the image manifest.

const config = getConfig();
const dates = Array.from({ length: 20 }, (_, offset) =>
  new Date(Date.UTC(2026, 7, 10 + offset)).toISOString().slice(0, 10)
);

describe("image prompt realism", () => {
  it("asks for honest wear on every freshly built prompt", () => {
    for (const date of dates) {
      for (const slot of buildDailyContent(date, config).slots.filter((s) => s.slot <= 2)) {
        const prompts = [
          slot.image_prompt,
          ...(slot.carousel_items ?? []).map((item) => item.image_prompt)
        ].filter((prompt): prompt is string => Boolean(prompt));
        expect(prompts.length).toBeGreaterThan(0);
        for (const prompt of prompts) {
          if (prompt.startsWith("Reel cover still")) continue;
          expect(prompt).toContain("honest everyday use");
          expect(prompt).toContain("must not look brand new");
          expect(prompt).not.toMatch(/Premium|Apple-like|editorial spacing/);
        }
      }
    }
  });

  it("rewrites the retired boutique styling out of stored calendar prompts", () => {
    const stale =
      "Realistic square shop photo for 私享家洗衣店: 鞋櫃前的檢查. 手部檢查材質或邊角。 " +
      "Premium Taiwanese laundry and shoe-care shop mood, clean counter, clear object detail, " +
      "restrained Apple-like spacing when poster-like, no fake logo, no readable text, no watermark.";
    const rewritten = sanitizeImagePrompt(stale);
    expect(rewritten).not.toContain("Premium Taiwanese");
    expect(rewritten).not.toContain("Apple-like");
    expect(rewritten).toContain("honest everyday use");
    expect(rewritten).toContain("鞋櫃前的檢查");
  });

  it("leaves already-clean prompts alone", () => {
    const clean = "Ordinary square shop photo. Shot on a phone by shop staff, honest everyday use.";
    expect(sanitizeImagePrompt(clean)).toBe(clean);
  });
});
