import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1111_PAGE_LASTMOD,
  NEW_BATCH_1111_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const FULL = "免費收送";
const REF = "參考價，看過實品再報價";
const NOT_BRAND_CARE = "不是品牌授權、指定或合作洗護";
const LEAK_REPAIR = "屬修繕，不包含在清潔內；能不能處理、是否另計，要看過實品由門市說明。";

/** 11/09 入冬冬衣。金額只沿用價目表已有的水洗參考價，並緊接參考價句。 */
const PAGES = [
  {
    slug: "suit-mold-cleaning",
    h1: "西裝外套發霉怎麼辦？能不能送洗、要多久、怎麼估價",
    prices: ["$70", "$80"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["services/suit-dry-cleaning.html", "guides/clothing-mold-airing.html", "guides/shirt-suit-dry-cleaning.html"]
  },
  {
    slug: "down-jacket-mold-cleaning",
    h1: "羽絨外套發霉怎麼辦？能送洗嗎、羽絨會不會結塊",
    prices: ["$280"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["services/down-jacket-cleaning.html", "guides/down-clump-after-wash.html", "guides/down-jacket-cleaning.html"]
  },
  {
    slug: "plush-doll-mold-cleaning",
    h1: "娃娃發霉還有救嗎？先別丟洗衣機",
    prices: [],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/plush-doll-cleaning.html", "guides/clothing-mold-airing.html", "services/taichung-citywide-laundry-pickup.html"]
  },
  {
    slug: "wool-coat-mold-cleaning",
    h1: "羊毛大衣發霉怎麼辦？能送洗嗎、要多久、怎麼估價",
    prices: ["$200", "$250", "$300"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["services/wool-coat-cleaning.html", "guides/wool-coat-dry-clean.html", "guides/clothing-mold-airing.html"]
  },
  {
    slug: "sweater-mold-cleaning",
    h1: "毛衣發霉怎麼洗？會縮水嗎、要多久、多少錢",
    prices: ["$150", "$180"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/sweater-cleaning-price.html", "guides/wool-knit-shrink-risk.html", "guides/clothing-mold-airing.html"]
  },
  {
    slug: "leather-belt-mold",
    h1: "皮帶發霉還有救嗎？能洗嗎、多少錢",
    prices: ["$400"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/leather-jacket-care.html", "guides/clothing-mold-airing.html", "guides/leather-mold-treatment.html"]
  },
  {
    slug: "suede-shoe-mold",
    h1: "麂皮鞋發霉怎麼辦？不要濕擦、不要硬刷",
    prices: ["$400"],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/suede-shoe-cleaning.html", "guides/shoe-mold-surface-check.html", "guides/nubuck-shoe-cleaning.html"]
  },
  {
    slug: "shirt-collar-mold-spots",
    h1: "襯衫領口發霉黑點怎麼洗？先分霉點、汗黃、漿膜",
    prices: ["$70"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/dress-shirt-starch-risk.html", "guides/collar-sweat-yellow.html", "guides/clothing-mold-airing.html"]
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

describe("11/11 發霉問句 8 頁", () => {
  it("路徑清單與頁面一一對應，共 8 頁", () => {
    expect([...NEW_BATCH_1111_PAGE_PATHS]).toEqual(PAGES.map((page) => `/guides/${page.slug}.html`));
  });

  it("進 sitemap、llms、有 hub 入鏈、lastmod 正確、可被索引", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.locCount).toBe(216);
    const llms = read("llms.txt");
    const wellKnown = read(".well-known/llms.txt");
    for (const page of PAGES) {
      const path = `/guides/${page.slug}.html`;
      const url = `https://sixiangjialaundry.com${path}`;
      expect(report.inbound[path]?.hubs, path).toContain(page.hub);
      const html = read(path.slice(1));
      expect(html).not.toContain("noindex");
      expect(html).not.toContain("草稿");
      expect(html).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html).toContain(`<time datetime="${NEW_BATCH_1111_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1111_PAGE_LASTMOD}"`);
      expect(html).toContain('id="check-before"');
      expect(html).toContain("送洗前先檢查");
      expect(html).toContain('id="stop-and-send"');
      expect(html).toContain("先停手、改送洗");
      expect(read("sitemap.xml")).toContain(
        `<loc>${url}</loc><lastmod>${NEW_BATCH_1111_PAGE_LASTMOD}</lastmod>`
      );
      expect(llms).toContain(url);
      expect(wellKnown).toContain(url);
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
        const audited = wave9AuditedText(html).replaceAll("04-2452-7411", "");
        const hits = wave9BannedHits(audited).filter((marker) => {
          if (page.slug !== "knit-shoulder-bump-stretch" || marker !== "保證") return true;
          return /(?<!不)保證/.test(audited);
        });
        expect(hits).toEqual([]);
        for (const needle of [FULL, REF, "https://lin.ee/w8qGVqM", "@454foyks", "0968327653", "04-2452-7411", "東海只有收送", "青海路二段365號"]) {
          expect(main, needle).toContain(needle);
        }
        expect(main.replaceAll(FULL, "")).not.toContain("免費");
        expect(main).toContain("台中洗衣收送");
        expect(main).not.toContain("台中全市");
        expect(main.replaceAll("最低消費", "")).not.toContain("最");
        const guaranteeBan = page.slug === "knit-shoulder-bump-stretch" ? /(?<!不)保證/ : /保證/;
        expect(main).not.toMatch(new RegExp(`賠|補償|${guaranteeBan.source}|全新|殺菌|除臭|消毒`));
        expect(main).not.toMatch(/東海[^。；，]{0,12}(門市|店面)(?!，|。|；)/);
        expect(main).toContain("東海只有收送");
        expect(main.replaceAll(NOT_BRAND_CARE, "")).not.toMatch(/合作|授權|經銷|原廠/);
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

  it("預設答案是只能淡化，不寫上色覆蓋（老闆 11/11 更正）", () => {
    for (const page of PAGES) {
      const main = mainOf(read(`guides/${page.slug}.html`));
      expect(main, page.slug).not.toContain("上色覆蓋");
      expect(main, page.slug).toContain("只能淡化");
    }
  });
});
