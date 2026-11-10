import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1105_PAGE_LASTMOD,
  NEW_BATCH_1105_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const FULL = "免費收送";
const REF = "參考價，看過實品再報價";

/** 11/05 週四批。價格只能是價目表上的水洗參考價；沒有列的品項不寫數字。 */
const PAGES = [
  {
    slug: "clothing-ink-stain",
    h1: "衣服畫到原子筆怎麼洗？",
    prices: [],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/bag-ink-marks.html"]
  },
  {
    slug: "suede-jacket-cleaning",
    h1: "麂皮衣服怎麼洗？麂皮外套可以水洗嗎？",
    prices: [],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/suede-shoe-cleaning.html", "guides/leather-jacket-care.html"]
  },
  {
    slug: "clothing-color-fading",
    h1: "衣服褪色怎麼辦？可以補色嗎？",
    prices: [],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/clothing-dye-transfer.html"]
  },
  {
    slug: "waterproof-breathable-shoe-care",
    h1: "防水透氣鞋可以水洗嗎？可以烘乾嗎？",
    prices: [],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/shoe-waterproof-treatment.html", "guides/hiking-shoe-cleaning.html"]
  },
  {
    slug: "summer-quilt-washing",
    h1: "涼被可以水洗嗎？可以烘乾嗎？",
    prices: ["$180"],
    hub: "hubs/bedding-textile-care.html",
    inbound: ["guides/blanket-vs-duvet.html"]
  },
  {
    slug: "sweater-cleaning-price",
    h1: "毛衣送洗多少錢？會縮水嗎？",
    prices: ["$150", "$180", "$210", "$240"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/cardigan-cleaning.html", "guides/jacket-cleaning-price.html", "guides/wool-knit-shrink-risk.html"]
  },
  {
    slug: "mattress-protector-washing",
    h1: "保潔墊可以丟洗衣機嗎？可以烘乾嗎？",
    prices: ["$120"],
    hub: "hubs/bedding-textile-care.html",
    inbound: ["services/duvet-bedding-cleaning.html"]
  },
  {
    slug: "shoe-insole-machine-wash",
    h1: "鞋墊可以丟洗衣機嗎？",
    prices: [],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/shoe-insole-check.html", "guides/washing-machine-shoe-risk.html"]
  }
];

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function mainOf(html: string): string {
  return html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
}

function pageNodes(html: string): Array<Record<string, unknown>> {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}";
  return JSON.parse(raw)["@graph"] ?? [];
}

describe("11/05 週四新批 8 頁", () => {
  it("路徑清單與頁面一一對應，共 8 頁", () => {
    expect([...NEW_BATCH_1105_PAGE_PATHS]).toEqual(PAGES.map((page) => `/guides/${page.slug}.html`));
  });

  it("進 sitemap、有 hub 入鏈、lastmod 正確、可被索引", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.locCount).toBe(223);
    for (const page of PAGES) {
      const path = `/guides/${page.slug}.html`;
      expect(report.inbound[path]?.hubs, path).toContain(page.hub);
      const html = read(path.slice(1));
      expect(html).not.toContain("noindex");
      expect(html).not.toContain("草稿");
      expect(html).toContain(`<link rel="canonical" href="https://sixiangjialaundry.com${path}" />`);
      expect(html).toContain(`<time datetime="${NEW_BATCH_1105_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1105_PAGE_LASTMOD}"`);
      expect(read("sitemap.xml")).toContain(
        `<loc>https://sixiangjialaundry.com${path}</loc><lastmod>${NEW_BATCH_1105_PAGE_LASTMOD}</lastmod>`
      );
      for (const inbound of page.inbound) {
        expect(read(inbound), inbound).toContain(path);
      }
    }
  });

  for (const page of PAGES) {
    const path = `guides/${page.slug}.html`;
    describe(page.slug, () => {
      it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在", () => {
        const html = read(path);
        const main = mainOf(html);
        expect(wave9BannedHits(wave9AuditedText(html).replaceAll("04-2452-7411", ""))).toEqual([]);
        for (const needle of [FULL, REF, "https://lin.ee/w8qGVqM", "@454foyks", "0968327653", "04-2452-7411", "東海只有收送", "青海路二段365號"]) {
          expect(main, needle).toContain(needle);
        }
        expect(main.replaceAll(FULL, "")).not.toContain("免費");
        expect(main).toContain("台中洗衣收送");
        expect(main).not.toContain("台中全市");
        expect(main.replaceAll("最低消費", "")).not.toContain("最");
        expect(main).not.toMatch(/賠|補償|保證|全新|殺菌|除臭|消毒/);
        expect(main).not.toMatch(/東海[^。；，]{0,12}(門市|店面)(?!，|。|；)/);
        expect(main).toContain("東海只有收送");
        expect((main.match(/data-editorial="1"/g) ?? []).length).toBeGreaterThanOrEqual(3);
      });

      it("價格只出現價目表上的價，每個數字旁都有參考價句", () => {
        const main = mainOf(read(path));
        const prices = main.match(/\$\d+/g) ?? [];
        const tagged = main.match(/\$\d+，參考價，看過實品再報價/g) ?? [];
        expect(tagged).toHaveLength(prices.length);
        expect([...new Set(prices)].sort()).toEqual([...page.prices].sort());
        expect(main.match(/\$\d+\s*起/g) ?? []).toEqual([]);
      });

      it("首段直接回答；FAQ 問答都在頁面，頁面層 JSON-LD 不放 FAQPage／HowTo", () => {
        const html = read(path);
        const main = mainOf(html);
        const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? "";
        expect(lead.startsWith(page.h1)).toBe(true);
        expect(main).toContain('<table class="comparison-table">');
        expect((main.match(/data-aeo-faq/g) ?? []).length).toBeGreaterThanOrEqual(3);
        const types = pageNodes(html).map((node) => node["@type"]);
        expect(types).toContain("WebPage");
        expect(types).toContain("BreadcrumbList");
        expect(types).not.toContain("FAQPage");
        expect(types).not.toContain("HowTo");
      });

      it("answers.json 有這頁的摘要，來源指向本頁，且不含禁字", () => {
        const answers = JSON.parse(read("answers.json"));
        const items: Array<{ id: string; source_url: string; answer: string }> = answers.answers ?? [];
        const hit = items.find((item) => item.id === `${page.slug}-page-summary`);
        expect(hit?.source_url).toBe(`https://sixiangjialaundry.com/${path}`);
        expect(hit?.answer).toContain(REF);
        const text = JSON.stringify(hit).replaceAll(FULL, "");
        expect(text).not.toMatch(/保證|免費|賠|補償|全新|殺菌|除臭/);
        expect(text).not.toContain("台中全市");
      });
    });
  }
});
