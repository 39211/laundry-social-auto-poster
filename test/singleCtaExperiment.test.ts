import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { SINGLE_CTA_EXPERIMENT_START, buildDailyContent, singleCtaExperimentActive } from "../src/contentPlan";
import { REEL_CONCEPTS } from "../src/reelConcepts";
import { captionsFor } from "../src/scheduleReel";

// H1 single-CTA experiment: from SINGLE_CTA_EXPERIMENT_START every caption
// keeps exactly one ask (the photo / LINE action). The engagement question,
// the share invite and the follow line are gone on both platforms.
// Before the start date the old stacked closers are unchanged, so the ledger
// comparison has a clean cut-over instead of a drifting template.

const ASK_LINE_RE = /私訊|傳 LINE|LINE 傳|拍一張|給我們|幫你看|傳給他|追蹤/;

function askBlocks(caption: string): string[] {
  return caption
    .split("\n\n")
    .filter((block) => !block.startsWith("#") && !block.startsWith("參考價") && !block.startsWith("出處"))
    .filter((block) => !block.includes("go/line.html"))
    // Owner-signed pickup value line (沒有低消 / 一件也收) is a fact block the
    // slot-2 rules keep whole; it is not the experiment's variable.
    .filter((block) => !/沒有低消|一件也收/.test(block))
    .filter((block) => ASK_LINE_RE.test(block));
}

describe("single-CTA experiment", () => {
  const config = getConfig();

  it("switches on at the start date and not before", () => {
    expect(singleCtaExperimentActive("2026-09-09")).toBe(false);
    expect(singleCtaExperimentActive(SINGLE_CTA_EXPERIMENT_START)).toBe(true);
  });

  it("drops question, share invite and follow line from carousels on and after the start date", () => {
    for (const date of [SINGLE_CTA_EXPERIMENT_START, "2026-09-14"]) {
      const content = buildDailyContent(date, config);
      for (const slot of content.slots.filter((s) => s.slot <= 2)) {
        for (const caption of [slot.instagram_caption, slot.facebook_caption]) {
          expect(caption).not.toContain(slot.follow_cta);
          expect(caption).not.toMatch(/追蹤私享家/);
          expect(caption).not.toMatch(/(?:傳|轉)給他/);
          // One ask block, no more.
          expect(askBlocks(caption)).toHaveLength(1);
          // Facts stay: provenance line and hashtags.
          expect(caption).toContain("出處：");
          expect(caption).toContain("#私享家洗衣店");
        }
      }
    }
  });

  it("keeps the stacked closers the day before the start date", () => {
    const content = buildDailyContent("2026-09-09", config);
    for (const slot of content.slots.filter((s) => s.slot <= 2)) {
      expect(slot.instagram_caption).toContain(slot.follow_cta);
    }
    expect(content.slots.some((s) => /(?:傳|轉)給他/.test(s.instagram_caption))).toBe(true);
  });

  it("applies to reel captions by date", () => {
    const concept = REEL_CONCEPTS[0]!;
    const before = captionsFor(concept, 0, "2026-09-09");
    const after = captionsFor(concept, 0, SINGLE_CTA_EXPERIMENT_START);
    expect(before.instagram).toContain("私享家洗衣店｜台中市區免費到府收送");
    expect(after.instagram).not.toContain("私享家洗衣店｜台中市區免費到府收送");
    expect(after.facebook).not.toContain("私享家洗衣店｜台中市區免費到府收送");
    expect(after.instagram).not.toMatch(/(?:傳|轉)給他/);
    expect(after.facebook).not.toMatch(/(?:傳|轉)給他/);
    expect(askBlocks(after.instagram)).toHaveLength(1);
  });
});
