import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

const PATH = "services/suit-dry-cleaning.html";

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

describe("洗西裝服務頁價格", () => {
  const html = read(PATH);

  const GROUP = "水洗參考價，看過實品再報價";

  it("背心、精品背心、精品長褲、短中大衣、精品短中大衣用價目表的單一價，各附「水洗參考價，看過實品再報價」", () => {
    for (const price of [
      "西裝背心 $80",
      "長褲 $70",
      "精品背心 $150",
      "精品長褲 $100",
      "精品外套 $200",
      "短大衣 $200",
      "中大衣 $250",
      "長大衣 $300",
      "精品短大衣 $250",
      "精品中大衣 $300"
    ]) {
      const at = html.indexOf(price);
      expect(at, price).toBeGreaterThan(-1);
      const rest = html.slice(at);
      const sentence = rest.slice(0, rest.search(/。|"/) + 1);
      expect(sentence, price).toContain(GROUP);
    }
  });

  it("價目表是單一價的項目不加「起」，頁面不再叫人傳照片問背心或大衣價", () => {
    for (const bad of [/背心\s*\$\d+\s*起/, /長褲\s*\$\d+\s*起/, /外套\s*\$\d+\s*起/, /大衣\s*\$\d+\s*起/, /整燙\s*\$50\s*起/]) {
      expect(html).not.toMatch(bad);
    }
    expect(html).not.toContain("背心、大衣傳照片到 LINE 問");
    expect(html).not.toContain("背心傳照片到 LINE 問");
  });

  it("整燙寫成 $50（限一般衣服，其他衣服另外報價），不再寫「整燙 $50 起」", () => {
    expect(html).toContain("整燙 $50（限一般衣服，其他衣服另外報價）");
    expect(html).not.toContain("整燙 $50 起");
  });

  it("沒有重複的「台中全市台中全市」", () => {
    expect(html).not.toContain("台中全市台中全市");
    expect(html).toContain("免費收送");
    expect(html).not.toContain("台中全市免費收送");
    expect(html.replaceAll("台中全市洗衣收送", "").replaceAll("台中全市收送", "")).not.toContain("台中全市");
  });

  it("頁面層 JSON-LD 仍可解析，聯絡方式與免費句都還在", () => {
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      expect(() => JSON.parse(match[1] ?? "")).not.toThrow();
    }
    for (const needle of ["@454foyks", "0968327653", "04-2452-7411", "免費收送", "參考價，看過實品再報價"]) {
      expect(html, needle).toContain(needle);
    }
  });

  it("dateModified、顯示日期與 sitemap lastmod 一致", () => {
    expect(html).toContain('"dateModified":"2026-11-02"');
    expect(html).toContain('<time datetime="2026-11-02">');
    expect(read("sitemap.xml")).toContain(
      "<loc>https://sixiangjialaundry.com/services/suit-dry-cleaning.html</loc><lastmod>2026-11-02</lastmod>"
    );
  });
});
