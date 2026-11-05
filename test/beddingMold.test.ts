import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEDDING_MOLD_PAGE_LASTMOD,
  BEDDING_MOLD_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const PATH = BEDDING_MOLD_PAGE_PATHS[0];
const FULL = "免費收送";
const OFFICIAL_PRICES = ["$350", "$500", "$600", "$800"];

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function mainOf(html: string): string {
  return html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? "";
}

function pageNodes(html: string): Array<Record<string, any>> {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}";
  return JSON.parse(raw)["@graph"] ?? [];
}

describe("棉被、羽絨被發霉怎麼辦頁", () => {
  it("進 sitemap、有入鏈、可被索引、沒有草稿標記", () => {
    const report = checkSitemapLinks();
    expect(report.inbound[PATH]?.count).toBeGreaterThanOrEqual(1);
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    const html = read(PATH.slice(1));
    expect(html).not.toContain("noindex");
    expect(html).not.toContain("草稿");
    expect(html).toContain(`<link rel="canonical" href="https://sixiangjialaundry.com${PATH}" />`);
    expect(html).toContain(`<time datetime="${BEDDING_MOLD_PAGE_LASTMOD}">`);
    expect(html).toContain(`"dateModified":"${BEDDING_MOLD_PAGE_LASTMOD}"`);
    expect(read("sitemap.xml")).toContain(
      `<loc>https://sixiangjialaundry.com${PATH}</loc><lastmod>${BEDDING_MOLD_PAGE_LASTMOD}</lastmod>`
    );
  });

  it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在", () => {
    const html = read(PATH.slice(1));
    const main = mainOf(html);
    // 電話是必留聯絡方式，不在禁用詞檢查內；其餘禁用詞（保證、殺菌、除臭、恢復原色、變白、回白…）全頁都不能出現。
    expect(wave9BannedHits(wave9AuditedText(html).replaceAll("04-2452-7411", ""))).toEqual([]);
    for (const needle of [FULL, "參考價，看過實品再報價", "https://lin.ee/w8qGVqM", "@454foyks", "0968327653", "04-2452-7411", "發霉要看過實品再報價"]) {
      expect(main, needle).toContain(needle);
    }
    expect(main.replaceAll(FULL, "")).not.toContain("免費");
    expect(main).toContain("台中洗衣收送");
    expect(main).not.toContain("台中全市");
    expect(main).not.toMatch(/起\s*[，。；]|\$\d+\s*起/);
    expect(main).not.toMatch(/除霉|除臭|除味|殺菌|滅菌|另行報價|保證|一定洗得掉|洗得掉。/);
  });

  it("價格只出現官方價目表的四個棉被價，且首段直接回答", () => {
    const main = mainOf(read(PATH.slice(1)));
    const prices = new Set(main.match(/\$\d+/g) ?? []);
    expect([...prices].sort()).toEqual([...OFFICIAL_PRICES].sort());
    const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(lead.startsWith("棉被、羽絨被發霉怎麼辦？")).toBe(true);
  });

  it("FAQ 的頁面文字與 FAQPage JSON-LD 一一對應，有比較表與步驟", () => {
    const html = read(PATH.slice(1));
    const faq = pageNodes(html).find((n) => n["@type"] === "FAQPage");
    const questions: string[] = (faq?.mainEntity ?? []).map((q: any) => q.name);
    expect(questions.length).toBeGreaterThanOrEqual(3);
    for (const q of questions) expect(mainOf(html), q).toContain(`<h3>${q}</h3>`);
    expect(mainOf(html)).toContain('<table class="comparison-table">');
    const howTo = pageNodes(html).find((n) => n["@type"] === "HowTo");
    expect(howTo?.step?.length).toBeGreaterThanOrEqual(3);
  });

  it("answers.json 有這頁的摘要，來源指向本頁", () => {
    const answers = JSON.parse(read("answers.json"));
    const items: Array<{ id: string; source_url: string }> = answers.answers ?? [];
    const hit = items.find((i) => i.id === "bedding-duvet-mold-page-summary");
    expect(hit?.source_url).toBe(`https://sixiangjialaundry.com${PATH}`);
  });

  it("answers.json 本頁條目不含除霉／除臭／除味／殺菌／滅菌／另行報價等禁字，且用「發霉要看過實品再報價」", () => {
    const answers = JSON.parse(read("answers.json"));
    const items: Array<{ id: string; question?: string; answer?: string }> = answers.answers ?? [];
    const hit = items.find((i) => i.id === "bedding-duvet-mold-page-summary");
    expect(hit).toBeTruthy();
    const text = JSON.stringify(hit).replaceAll("免費收送", "");
    expect(text).not.toMatch(/除霉|除臭|除味|殺菌|滅菌|另行報價|保證|免費/);
    expect(text).not.toContain("台中全市");
    expect(hit?.answer).toContain("發霉要看過實品再報價");
    expect(hit?.answer).toContain("參考價，看過實品再報價");
  });
});
