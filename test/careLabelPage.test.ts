import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARE_LABEL_PAGE_LASTMOD,
  CARE_LABEL_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const PATH = CARE_LABEL_PAGE_PATHS[0];
const PDF_URL = "https://sixiangjialaundry.com/guides/care-label-text-cheatsheet.pdf";
const FULL = "台中全市免費收送、沒有最低消費";

function pageHtml(): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", PATH.slice(1)), "utf8");
}

describe("洗標符號文字指南", () => {
  it("進 sitemap、有 hub 入鏈、可被索引、沒有草稿標記", () => {
    const report = checkSitemapLinks();
    expect(report.inbound[PATH]?.count).toBeGreaterThanOrEqual(1);
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    const html = pageHtml();
    expect(html).not.toContain("noindex");
    expect(html).not.toContain("草稿");
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(html).toContain(`<link rel="canonical" href="https://sixiangjialaundry.com${PATH}" />`);
    expect(html).toContain(`<time datetime="${CARE_LABEL_PAGE_LASTMOD}">`);
    expect(html).toContain(`"dateModified":"${CARE_LABEL_PAGE_LASTMOD}"`);
    const xml = readFileSync(join(repoRootFromHere(), "seo-overrides", "sitemap.xml"), "utf8");
    expect(xml).toContain(
      `<loc>https://sixiangjialaundry.com${PATH}</loc><lastmod>${CARE_LABEL_PAGE_LASTMOD}</lastmod>`
    );
  });

  it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在", () => {
    const html = pageHtml();
    expect(wave9BannedHits(wave9AuditedText(html))).toEqual([]);
    const main = html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
    for (const needle of [FULL, "西屯門市收件", "參考價，看過實品再報價", "https://lin.ee/w8qGVqM", "@454foyks", "怎麼送洗"]) {
      expect(main, needle).toContain(needle);
    }
    expect(main.replaceAll(FULL, "")).not.toContain("免費");
    expect(main).not.toMatch(/\d\s*元|\$\d/);
    expect(main).not.toMatch(/完全符合|通過.{0,6}認證|符合 ?CNS/);
  });

  it("只用文字描述符號：表格 15 列、沒有符號圖片，PDF 實檔存在且頁面連到它", () => {
    const html = pageHtml();
    const main = html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
    expect(main.match(/<tr><th scope="row">/g)).toHaveLength(15);
    expect(main.match(/<img\b/g)).toHaveLength(1);
    expect(main).toContain(`href="${PDF_URL}"`);
    const pdf = join(repoRootFromHere(), "seo-overrides", "guides", "care-label-text-cheatsheet.pdf");
    expect(existsSync(pdf)).toBe(true);
    expect(readFileSync(pdf).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
