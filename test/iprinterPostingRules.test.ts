import { describe, expect, it } from "vitest";
import {
  PROVENANCE_LINE,
  linePostRedirectUrl,
  withNextEpisodeTeaser,
  withProvenanceLine,
  withSharedCaptionRules
} from "../src/contentPlan";
import { buildShortMetadata } from "../src/postYouTube";

const LINE_POST = linePostRedirectUrl();

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
    expect(price).toBeGreaterThan(-1);
    expect(price).toBeLessThan(provenance);
    expect(provenance).toBeLessThan(line);
    expect(line).toBeLessThan(hashtags);
    expect(caption.split(PROVENANCE_LINE)).toHaveLength(2);
  });

  it("is idempotent: a caption that already carries 出處 does not get a second one", () => {
    const once = withProvenanceLine(baseCaption);
    expect(withProvenanceLine(once)).toBe(once);
    expect(once.split("出處：")).toHaveLength(2);
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
