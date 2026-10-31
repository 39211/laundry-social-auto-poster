import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREWASH_PAGE_LASTMOD,
  PREWASH_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const PATH = PREWASH_PAGE_PATHS[0];
const FULL = "台中全市免費收送、沒有最低消費";

type RuleLine = [string | null, string];
type Rule = { id: string; src: string; title: string; lines: RuleLine[] };

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function mainOf(html: string): string {
  return html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? "";
}

function visibleText(html: string): string {
  return mainOf(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function embeddedRules(): { rules: Rule[]; fallback: Rule; quote: Rule } {
  const raw = mainOf(read(PATH.slice(1))).match(/<script type="application\/json" id="prewash-rules">([\s\S]*?)<\/script>/)?.[1];
  expect(raw).toBeTruthy();
  return JSON.parse(raw ?? "{}");
}

describe("送洗前自我檢查頁", () => {
  it("進 sitemap、有 hub 入鏈、可被索引、沒有草稿標記", () => {
    const report = checkSitemapLinks();
    expect(report.inbound[PATH]?.count).toBeGreaterThanOrEqual(1);
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    const html = read(PATH.slice(1));
    expect(html).not.toContain("noindex");
    expect(html).not.toContain("草稿");
    expect(html).toContain(`<link rel="canonical" href="https://sixiangjialaundry.com${PATH}" />`);
    expect(html).toContain(`<time datetime="${PREWASH_PAGE_LASTMOD}">`);
    expect(html).toContain(`"dateModified":"${PREWASH_PAGE_LASTMOD}"`);
    expect(read("sitemap.xml")).toContain(
      `<loc>https://sixiangjialaundry.com${PATH}</loc><lastmod>${PREWASH_PAGE_LASTMOD}</lastmod>`
    );
  });

  it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在，沒有新價格", () => {
    const html = read(PATH.slice(1));
    expect(wave9BannedHits(wave9AuditedText(html))).toEqual([]);
    const main = mainOf(html);
    for (const needle of [FULL, "西屯門市收件", "參考價，看過實品再報價", "https://lin.ee/w8qGVqM", "@454foyks", "怎麼送洗"]) {
      expect(main, needle).toContain(needle);
    }
    expect(main.replaceAll(FULL, "")).not.toContain("免費");
    expect(main).not.toMatch(/\d\s*元|\$\d/);
    expect(main).not.toMatch(/不保證|除臭|醫療滅菌|變全新/);
  });

  it("規則逐字來自官網指南：每個標題與句子都是來源頁可見文字的子字串", () => {
    const { rules, fallback, quote } = embeddedRules();
    expect(rules.length).toBeGreaterThanOrEqual(12);
    for (const rule of [...rules, fallback, quote]) {
      const source = visibleText(read(rule.src));
      expect(rule.lines.length, rule.id).toBeGreaterThan(0);
      for (const [head, text] of rule.lines) {
        if (head) expect(source, `${rule.id} head ${head}`).toContain(head);
        expect(source, `${rule.id} text ${text}`).toContain(text);
      }
    }
  });

  it("每條規則的出處頁都有靜態連結；資料用 textContent 輸出，不用 innerHTML", () => {
    const { rules, quote } = embeddedRules();
    const main = mainOf(read(PATH.slice(1)));
    for (const rule of [...rules, quote]) {
      expect(main, rule.src).toContain(`href="https://sixiangjialaundry.com/${rule.src}"`);
    }
    expect(main).not.toContain("innerHTML");
    expect(main).not.toContain("eval(");
  });
});
