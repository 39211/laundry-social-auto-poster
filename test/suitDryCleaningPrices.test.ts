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

  it("不再出現背心、精品長褲、短大衣、中大衣的數字，改成傳照片到 LINE 問", () => {
    for (const banned of [/背心\s*\$\d+/, /精品長褲\s*\$\d+/, /短大衣\s*\$\d+/, /中大衣\s*\$\d+/]) {
      expect(html).not.toMatch(banned);
    }
    expect(html).toContain("傳照片到 LINE 問");
  });

  it("整燙寫成 $50（限一般衣服，其他衣服另外報價），不再寫「整燙 $50 起」", () => {
    expect(html).toContain("整燙 $50（限一般衣服，其他衣服另外報價）");
    expect(html).not.toContain("整燙 $50 起");
  });

  it("頁面層 JSON-LD 仍可解析，聯絡方式與免費句都還在", () => {
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      expect(() => JSON.parse(match[1] ?? "")).not.toThrow();
    }
    for (const needle of ["@454foyks", "0968327653", "04-2452-7411", "台中全市免費收送、沒有最低消費", "參考價，看過實品再報價"]) {
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
