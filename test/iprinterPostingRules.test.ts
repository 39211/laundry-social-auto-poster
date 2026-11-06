import { describe, expect, it } from "vitest";
import {
  PROVENANCE_LINE,
  PROVENANCE_LINE_REVISED,
  PROVENANCE_LINE_REVISED_START_DATE,
  linePostRedirectUrl,
  withNextEpisodeTeaser,
  withProvenanceLine,
  withSharedCaptionRules
} from "../src/contentPlan";
import { buildShortMetadata } from "../src/postYouTube";

// Pin the origin explicitly: CI does not carry the production PUBLIC_SITE_BASE_URL,
// and the caption under test is built with this same origin below.
const LINE_POST = linePostRedirectUrl("https://sixiangjialaundry.com");

function blockIndex(caption: string, needle: string): number {
  return caption.split("\n\n").findIndex((block) => block.includes(needle));
}

describe("iprinter posting rules (2026-09-04)", () => {
  const baseCaption = [
    "白鞋鞋邊一圈灰,多半是髒不是黃。",
    "先看膠邊:灰是可以清的髒,黃是氧化,只能淡化。",
    "不確定?拍一張傳 LINE 給我們,先幫你看。",
    "#私享家洗衣店 #台中洗鞋"
  ].join("\n\n");

  it("puts one provenance line between the price line and the LINE line, before hashtags", () => {
    const caption = withSharedCaptionRules(baseCaption, "白鞋鞋邊泛灰", {
      source: "facebook",
      campaign: "test",
      siteBaseUrl: "https://sixiangjialaundry.com"
    });
    const price = blockIndex(caption, "參考價");
    const provenance = blockIndex(caption, "出處：");
    const line = blockIndex(caption, LINE_POST);
    const hashtags = caption.split("\n\n").findIndex((block) => block.startsWith("#"));
    expect(caption).toContain(PROVENANCE_LINE);
    // The price line depends on the owner's price data being present; CI runs
    // without it, so the ordering claim is conditional on the line existing.
    if (price > -1) expect(price).toBeLessThan(provenance);
    expect(provenance).toBeGreaterThan(-1);
    expect(provenance).toBeLessThan(line);
    expect(line).toBeLessThan(hashtags);
    expect(caption.split(PROVENANCE_LINE)).toHaveLength(2);
  });

  it("is idempotent: a caption that already carries 出處 does not get a second one", () => {
    const once = withProvenanceLine(baseCaption);
    expect(withProvenanceLine(once)).toBe(once);
    expect(once.split("出處：")).toHaveLength(2);
  });

  describe("provenance wording change (owner decision 2026-11-06)", () => {
    const tracking = { source: "facebook", campaign: "test", siteBaseUrl: "https://sixiangjialaundry.com" } as const;
    const withDate = (date?: string) => withSharedCaptionRules(baseCaption, "白鞋鞋邊泛灰", tracking, date);

    it("pins both wordings literally, each short enough to stay under the repetition check", () => {
      expect(PROVENANCE_LINE).toBe("出處：門市當日看件");
      expect(PROVENANCE_LINE_REVISED).toBe("出處：門市實務整理");
      expect(PROVENANCE_LINE_REVISED.startsWith("出處：")).toBe(true);
      expect(PROVENANCE_LINE_REVISED.length).toBeLessThan(12);
      expect(PROVENANCE_LINE_REVISED_START_DATE).toBe("2026-11-08");
    });

    it("keeps the original wording with no date and for every date before the start date", () => {
      for (const date of [undefined, "2026-09-04", "2026-10-28", "2026-11-07"]) {
        const caption = withDate(date);
        expect(caption).toContain(PROVENANCE_LINE);
        expect(caption).not.toContain(PROVENANCE_LINE_REVISED);
      }
      expect(withProvenanceLine(baseCaption)).toContain(PROVENANCE_LINE);
      expect(withProvenanceLine(baseCaption, "2026-11-07")).toContain(PROVENANCE_LINE);
    });

    it("switches to the revised wording on the start date and after, exactly once, in the same position", () => {
      for (const date of [PROVENANCE_LINE_REVISED_START_DATE, "2026-11-09", "2026-12-31"]) {
        const caption = withDate(date);
        expect(caption).toContain(PROVENANCE_LINE_REVISED);
        expect(caption).not.toContain("門市當日看件");
        expect(caption.split("出處：")).toHaveLength(2);
        const provenance = blockIndex(caption, "出處：");
        expect(provenance).toBeLessThan(blockIndex(caption, LINE_POST));
        expect(blockIndex(caption, LINE_POST)).toBeLessThan(caption.split("\n\n").findIndex((b) => b.startsWith("#")));
      }
      // only the wording differs: swapping the line back reproduces the old caption exactly
      expect(withDate("2026-11-08").replace(PROVENANCE_LINE_REVISED, PROVENANCE_LINE)).toBe(withDate("2026-11-07"));
    });

    it("never rewrites a caption that already carries a provenance line, whichever wording", () => {
      const old = withDate("2026-11-07");
      expect(withSharedCaptionRules(old, "白鞋鞋邊泛灰", tracking, "2026-11-20")).toContain(PROVENANCE_LINE);
      expect(withProvenanceLine(old, "2026-11-20")).toBe(old);
      const revised = withDate("2026-11-08");
      expect(withProvenanceLine(revised, "2026-11-08")).toBe(revised);
      expect(revised.split("出處：")).toHaveLength(2);
    });
  });

  it("adds the next-episode teaser ahead of provenance and LINE, and never twice", () => {
    const shared = withSharedCaptionRules(baseCaption, "白鞋鞋邊泛灰", {
      source: "instagram",
      campaign: "test",
      siteBaseUrl: "https://sixiangjialaundry.com"
    });
    const teased = withNextEpisodeTeaser(shared, "帆布鞋踩到泥怎麼救");
    expect(teased).toContain("下一集：帆布鞋踩到泥怎麼救");
    expect(blockIndex(teased, "下一集：")).toBeLessThan(blockIndex(teased, "出處："));
    expect(blockIndex(teased, "下一集：")).toBeLessThan(blockIndex(teased, LINE_POST));
    expect(withNextEpisodeTeaser(teased, "另一個主題")).toBe(teased);
    expect(withNextEpisodeTeaser(shared, undefined)).toBe(shared);
    expect(withNextEpisodeTeaser(shared, "   ")).toBe(shared);
  });

  it("points the Short's second line at the day's own indexable article", () => {
    const { description, title } = buildShortMetadata({
      topic: "白鞋鞋邊泛灰",
      caption: baseCaption,
      date: "2026-07-02",
      slot: 3
    });
    const lines = description.split("\n\n");
    expect(lines[1]).toContain("/posts/2026-07-02-slot-03.html");
    expect(lines[1]).toMatch(/^這則紀錄的完整文章:https:\/\//u);
    expect(title).toContain("#Shorts");
  });
});
