import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1111D_PAGE_LASTMOD,
  NEW_BATCH_1111D_PAGE_PATHS,
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
    slug: "curtain-cleaning-price",
    h1: "窗簾送洗價格怎麼算？台中洗窗簾沒有固定價，要拍什麼才能報價",
    prices: ["$150", "$500"],
    hub: "hubs/bedding-textile-care.html",
    stopH: "報價前先別這樣做",
    inbound: ["services/curtain-carpet-cleaning.html", "guides/curtain-mold-cleaning.html", "services/taichung-laundry-price-list.html"]
  },
  {
    slug: "carpet-cleaning-price",
    h1: "洗地毯價格怎麼算？台中地毯送洗沒有固定價，先看乾不乾",
    prices: ["$200", "$400"],
    hub: "hubs/bedding-textile-care.html",
    stopH: "報價前先別這樣做",
    inbound: ["services/curtain-carpet-cleaning.html", "guides/carpet-mold-cleaning.html", "services/taichung-laundry-price-list.html"]
  },
  {
    slug: "luxury-garment-cleaning-price",
    h1: "精品衣服送洗多少錢？精品襯衫、外套、洋裝、大衣價格怎麼分",
    prices: ["$100", "$110", "$120", "$130", "$150", "$180", "$200", "$210", "$230", "$240", "$250", "$300", "$350", "$90"],
    hub: "hubs/luxury-garment-care.html",
    stopH: "送洗前先別這樣做",
    inbound: ["services/luxury-garment-cleaning.html", "guides/luxury-dry-cleaning.html", "services/taichung-laundry-price-list.html"]
  },
  {
    slug: "uniform-cleaning-price",
    h1: "制服送洗多少錢？護士服、醫師服、學生制服價格怎麼分",
    prices: ["$100", "$150", "$60", "$70", "$80"],
    hub: "hubs/bedding-textile-care.html",
    stopH: "送洗前先別這樣做",
    inbound: ["services/uniform-laundry.html", "services/clinic-uniform-laundry.html", "guides/school-uniform-care.html", "guides/uniform-mold-cleaning.html"]
  },
  {
    slug: "slipper-cleaning-price",
    h1: "拖鞋送洗多少錢？一般拖鞋與勃肯拖鞋怎麼分",
    prices: ["$150", "$200", "$350", "$400"],
    hub: "hubs/shoe-care.html",
    stopH: "送洗前先別這樣做",
    inbound: ["guides/birkenstock-care.html", "guides/slipper-mold-cleaning.html", "guides/sandal-cleaning.html"]
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

describe("11/11 發霉問句價格與報價問句 5 頁", () => {
  it("路徑清單與頁面一一對應，共 5 頁", () => {
    expect([...NEW_BATCH_1111D_PAGE_PATHS]).toEqual(PAGES.map((page) => `/guides/${page.slug}.html`));
  });

  it("進 sitemap、llms、有 hub 入鏈、lastmod 正確、可被索引", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.locCount).toBe(232);
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
      expect(html).toContain(`<time datetime="${NEW_BATCH_1111D_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1111D_PAGE_LASTMOD}"`);
      expect(html).toContain('id="check-before"');
      expect(html).toContain("送洗前先檢查");
      expect(html).toContain('id="stop-and-send"');
      expect(html).toContain(page.stopH);
      expect(read("sitemap.xml")).toContain(
        `<loc>${url}</loc><lastmod>${NEW_BATCH_1111D_PAGE_LASTMOD}</lastmod>`
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

  it("行銷裁定 M1：meta 與 JSON-LD 的聯絡句用「LINE 官方 @454foyks，或 LINE 0968327653」", () => {
    for (const page of PAGES) {
      const html = read(`guides/${page.slug}.html`);
      expect(html, page.slug).not.toContain("LINE @454foyks／0968327653");
      expect(html, page.slug).toContain("LINE 官方 @454foyks，或 LINE 0968327653");
    }
  });

  it("皮革／麂皮／起／防水用語：不寫水洗價、不寫單獨防水、起只給名牌包（全站規則）", () => {
    for (const page of PAGES) {
      const html = read(`guides/${page.slug}.html`);
      expect(html, page.slug).not.toMatch(/防水(?!透氣)/u);
      expect(html, page.slug).not.toContain("名牌包 $1500 起；皆為水洗參考價");
      expect(mainOf(html).match(/\$\d+\s*起/g) ?? [], page.slug).toEqual([]);
    }
  });
});
