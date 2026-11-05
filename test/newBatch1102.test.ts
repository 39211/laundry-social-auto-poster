import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1102_PAGE_LASTMOD,
  NEW_BATCH_1102_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const FULL = "免費收送";
const REF = "參考價，看過實品再報價";

/** 每頁引用的價格，只能是官方價目表上的價。名牌包只寫「$1500 起」。 */
const PAGES = [
  { slug: "wool-duvet-washing", h1: "羊毛被可以水洗嗎？能曬太陽、烘乾嗎？", prices: ["$800"], bag: false },
  { slug: "down-duvet-washing", h1: "羽絨被可以水洗嗎？多久洗一次、能曬太陽嗎？", prices: ["$600"], bag: false },
  { slug: "blanket-washing", h1: "毛毯可以丟洗衣機嗎？毛毯怎麼洗、能烘乾嗎？", prices: ["$200", "$400"], bag: false },
  { slug: "jacket-cleaning-price", h1: "外套送洗多少錢？薄外套、厚外套、羽絨外套、長大衣價格怎麼分？", prices: ["$150", "$180", "$200", "$280", "$300", "$350"], bag: false },
  { slug: "bag-cleaning-price", h1: "包包清洗多少錢？背包、一般包、皮包、名牌包價格差在哪？", prices: ["$1000", "$1500", "$2500", "$500", "$600"], bag: true },
  { slug: "suit-water-wash-risk", h1: "西裝可以水洗嗎？水洗會怎樣、多久乾洗一次？", prices: ["$50", "$70"], bag: false },
  { slug: "dry-cleaning-shrink-risk", h1: "乾洗會縮水嗎？哪些衣服乾洗也可能變形、掉色？", prices: [], bag: false },
  { slug: "leather-shoe-cleaning-price", h1: "皮鞋可以送洗嗎？皮鞋清潔多少錢、會不會洗壞？", prices: ["$300", "$350", "$400", "$550", "$600"], bag: false }
];

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

describe("11/02 新批 8 頁", () => {
  it("路徑清單與頁面一一對應，共 8 頁", () => {
    expect([...NEW_BATCH_1102_PAGE_PATHS]).toEqual(PAGES.map((p) => `/guides/${p.slug}.html`));
  });

  it("進 sitemap、有入鏈、lastmod 正確、可被索引", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    for (const path of NEW_BATCH_1102_PAGE_PATHS) {
      expect(report.inbound[path]?.count, path).toBeGreaterThanOrEqual(1);
      const html = read(path.slice(1));
      expect(html).not.toContain("noindex");
      expect(html).not.toContain("草稿");
      expect(html).toContain(`<link rel="canonical" href="https://sixiangjialaundry.com${path}" />`);
      expect(html).toContain(`<time datetime="${NEW_BATCH_1102_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1102_PAGE_LASTMOD}"`);
      expect(read("sitemap.xml")).toContain(
        `<loc>https://sixiangjialaundry.com${path}</loc><lastmod>${NEW_BATCH_1102_PAGE_LASTMOD}</lastmod>`
      );
    }
  });

  for (const page of PAGES) {
    const path = `guides/${page.slug}.html`;
    describe(page.slug, () => {
      it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在", () => {
        const html = read(path);
        const main = mainOf(html);
        expect(wave9BannedHits(wave9AuditedText(html).replaceAll("04-2452-7411", ""))).toEqual([]);
        for (const needle of [FULL, REF, "https://lin.ee/w8qGVqM", "@454foyks", "0968327653", "04-2452-7411"]) {
          expect(main, needle).toContain(needle);
        }
        expect(main.replaceAll(FULL, "")).not.toContain("免費");
        expect(main.replaceAll("台中全市洗衣收送", "").replaceAll("台中全市收送", "")).not.toContain("台中全市");
        expect(main.replaceAll("最低消費", "")).not.toContain("最");
        expect(main).not.toMatch(/賠|補償|保證|全新|殺菌|除臭|消毒/);
        expect(main).not.toMatch(/東海[^。；，]{0,12}(門市|店面)(?!，|。|；)/);
        expect(main).toContain("東海只有收送");
      });

      it("價格只出現官方價目表的價，「起」只用在名牌包", () => {
        const main = mainOf(read(path));
        const prices = new Set(main.match(/\$\d+/g) ?? []);
        expect([...prices].sort()).toEqual([...page.prices].sort());
        const qi = main.match(/\$\d+\s*起/g) ?? [];
        if (page.bag) {
          expect(qi.length).toBeGreaterThanOrEqual(1);
          expect(new Set(qi)).toEqual(new Set(["$1500 起"]));
        } else {
          expect(qi).toEqual([]);
        }
        expect(main).not.toMatch(/\$\d+\s*起(?<!\$1500 起)/);
      });

      it("首段直接回答；FAQ 問答都在頁面，頁面層 JSON-LD 不放 FAQPage／HowTo", () => {
        const html = read(path);
        const main = mainOf(html);
        const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? "";
        expect(lead.startsWith(page.h1)).toBe(true);
        expect(main).toContain('<table class="comparison-table">');
        expect((main.match(/data-aeo-faq/g) ?? []).length).toBeGreaterThanOrEqual(3);
        const types = pageNodes(html).map((n) => n["@type"]);
        expect(types).toContain("WebPage");
        expect(types).toContain("BreadcrumbList");
        expect(types).not.toContain("FAQPage");
        expect(types).not.toContain("HowTo");
      });

      it("answers.json 有這頁的摘要，來源指向本頁，且不含禁字", () => {
        const answers = JSON.parse(read("answers.json"));
        const items: Array<{ id: string; source_url: string; answer: string }> = answers.answers ?? [];
        const hit = items.find((i) => i.id === `${page.slug}-page-summary`);
        expect(hit?.source_url).toBe(`https://sixiangjialaundry.com/${path}`);
        expect(hit?.answer).toContain(REF);
        const text = JSON.stringify(hit).replaceAll(FULL, "");
        expect(text).not.toMatch(/保證|免費|賠|補償|全新|殺菌|除臭/);
        expect(text).not.toContain("台中全市");
      });
    });
  }

  it("名牌包永遠寫「$1500 起」，皮件交期寫約 14 天", () => {
    const main = mainOf(read("guides/bag-cleaning-price.html"));
    expect(main).toContain("$1500 起");
    expect(main).toContain("約 14 天");
  });
});
