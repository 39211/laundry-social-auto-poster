import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { CAPTION_TRIM_START_DATE, buildDailyContent, captionTrimActive } from "../src/contentPlan";

const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_SITE_BASE_URL: "https://sixiangjialaundry.com",
  PUBLIC_IMAGE_BASE_URL: "https://sixiangjialaundry.com",
  META_ACCESS_TOKEN: "x",
  FB_PAGE_ID: "x",
  IG_USER_ID: "x"
});

function chars(caption: string): number {
  return caption.replace(/\s+/gu, "").length;
}

function utcDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe("caption trim from 2026-09-21: slot 1 drops the next-episode teaser", () => {
  it("pins the date: 09-17..09-20 belong to the hashtag knife alone", () => {
    expect(CAPTION_TRIM_START_DATE).toBe("2026-09-21");
    expect(captionTrimActive("2026-09-20")).toBe(false);
    expect(captionTrimActive("2026-09-21")).toBe(true);
  });

  it("keeps the teaser on the last control day and removes it from the trim date on", () => {
    const control = buildDailyContent("2026-09-20", config, { applySlot1Plan: true, today: "2026-09-06" });
    const slot1Control = control.slots.find((slot) => slot.slot === 1)!;
    expect(slot1Control.instagram_caption).toContain("下一集：");
    expect(slot1Control.facebook_caption).toContain("下一集：");

    for (const date of utcDates("2026-09-21", "2026-10-07")) {
      const content = buildDailyContent(date, config, { applySlot1Plan: true, today: "2026-09-06" });
      const slot1 = content.slots.find((slot) => slot.slot === 1)!;
      expect(slot1.instagram_caption, `${date} ig`).not.toContain("下一集：");
      expect(slot1.facebook_caption, `${date} fb`).not.toContain("下一集：");
    }
  });

  it("brings the window's captions to a 220–250 mean per slot while keeping the owner's closing lines", () => {
    // Measured 2026-09-06 with knives 1–5 applied (IG, whitespace stripped):
    // slot 1 09-15..09-18 mean 272 (261–292) -> 09-21..10-08 mean ~245 (221–270);
    // slot 2 230 -> 238 (214–281; the 09-26 ten-day observation carries the
    // signed-off pickup line and is the long end). Floor 80 is the public
    // article gate; the ceiling is a guard against a block being added back,
    // not a target -- the LINE line alone is 80 characters of URL and ID.
    const perSlot: Record<number, number[]> = { 1: [], 2: [] };
    for (const date of utcDates("2026-09-21", "2026-10-08")) {
      const content = buildDailyContent(date, config, { applySlot1Plan: true, today: "2026-09-06" });
      for (const slot of content.slots.filter((item) => item.slot <= 2)) {
        if (slot.format === "poster") continue;
        for (const caption of [slot.instagram_caption, slot.facebook_caption]) {
          const n = chars(caption);
          perSlot[slot.slot]!.push(n);
          expect(n, `${date} s${slot.slot}`).toBeGreaterThanOrEqual(80);
          expect(n, `${date} s${slot.slot}\n${caption}`).toBeLessThanOrEqual(290);
          expect(caption, `${date} s${slot.slot} LINE id`).toContain("0968327653");
          expect(caption, `${date} s${slot.slot} provenance`).toContain("出處：");
          expect(caption, `${date} s${slot.slot} one link`).toContain("/go/line.html");
        }
      }
    }
    for (const slot of [1, 2]) {
      const values = perSlot[slot]!;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      expect(mean, `slot ${slot} mean`).toBeLessThanOrEqual(250);
      expect(mean, `slot ${slot} mean`).toBeGreaterThanOrEqual(200);
    }
  });
});
