import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1109_PAGE_LASTMOD,
  NEW_BATCH_1109_PAGE_PATHS,
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
    slug: "ski-snow-jacket-cleaning",
    h1: "雪衣、滑雪外套怎麼洗？出國回來要送洗嗎？",
    prices: ["$180", "$280"],
    hub: "hubs/luxury-garment-care.html",
    inbound: [
      "guides/gore-tex-jacket-cleaning.html",
      "guides/sleeping-bag-cleaning.html",
      "guides/insulated-down-pants-care.html"
    ]
  },
  {
    slug: "sherpa-teddy-fleece-jacket",
    h1: "羊羔絨、泰迪絨外套怎麼洗？洗完會結塊變硬嗎？",
    prices: ["$180"],
    hub: "hubs/luxury-garment-care.html",
    inbound: [
      "guides/wool-coat-dry-clean.html",
      "guides/blanket-vs-duvet.html",
      "guides/jacket-cleaning-price.html"
    ]
  },
  {
    slug: "fleece-jacket-pilling",
    h1: "刷毛、搖粒絨外套起球、變硬怎麼辦？",
    prices: ["$180"],
    hub: "hubs/luxury-garment-care.html",
    inbound: [
      "guides/wool-sweater-pilling.html",
      "guides/cardigan-cleaning.html",
      "guides/jacket-cleaning-price.html"
    ]
  },
  {
    slug: "faux-fur-collar-cleaning",
    h1: "外套毛領、帽緣毛怎麼洗？可以拆下來嗎？",
    prices: ["$180", "$280", "$300"],
    hub: "hubs/luxury-garment-care.html",
    inbound: [
      "guides/pet-hair-on-coat.html",
      "guides/coat-cuff-wear.html",
      "guides/down-jacket-cleaning.html"
    ]
  },
  {
    slug: "luxury-down-jacket-cleaning",
    h1: "精品羽絨外套可以送洗嗎？",
    prices: ["$280"],
    hub: "hubs/luxury-garment-care.html",
    inbound: [
      "guides/down-jacket-cleaning.html",
      "guides/luxury-dry-cleaning.html",
      "guides/jacket-cleaning-price.html"
    ]
  },
  {
    slug: "down-jacket-feather-leak",
    h1: "羽絨外套一直漏毛正常嗎？送洗會更嚴重嗎？",
    prices: ["$280"],
    hub: "hubs/luxury-garment-care.html",
    inbound: [
      "guides/down-jacket-cleaning.html",
      "guides/down-clump-after-wash.html",
      "guides/down-vest-cleaning.html"
    ]
  },
  {
    slug: "knit-shoulder-bump-stretch",
    h1: "毛衣掛完肩膀凸起、洗完變長怎麼辦？",
    prices: [],
    hub: "hubs/luxury-garment-care.html",
    inbound: [
      "guides/wool-knit-shrink-risk.html",
      "guides/sweater-shrunk-what-now.html",
      "guides/knit-snag-check.html"
    ]
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

describe("11/09 入冬冬衣 7 頁", () => {
  it("路徑清單與頁面一一對應，共 7 頁", () => {
    expect([...NEW_BATCH_1109_PAGE_PATHS]).toEqual(PAGES.map((page) => `/guides/${page.slug}.html`));
  });

  it("進 sitemap、llms、有 hub 入鏈、lastmod 正確、可被索引", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.locCount).toBe(241);
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
      expect(html).toContain(`<time datetime="${NEW_BATCH_1109_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1109_PAGE_LASTMOD}"`);
      expect(html).toContain('id="check-before"');
      expect(html).toContain("送洗前先檢查");
      expect(html).toContain('id="stop-and-send"');
      expect(html).toContain("先停手、改送洗");
      expect(read("sitemap.xml")).toContain(
        `<loc>${url}</loc><lastmod>${NEW_BATCH_1109_PAGE_LASTMOD}</lastmod>`
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

  it("行銷改字：精品羽絨不寫品牌，漏毛不寫改衣金額，雪衣寫防潑水界線", () => {
    const brandNeedles = [
      "加拿大" + "鵝",
      "Mon" + "cler",
      "Canada" + " Goose",
      "盟可" + "睞",
      "盟可" + "瞰",
      "The North" + " Face"
    ];
    const bundle = [
      read("guides/luxury-down-jacket-cleaning.html"),
      read("answers.json"),
      read("llms.txt"),
      read(".well-known/llms.txt")
    ].join("\n");
    for (const needle of brandNeedles) {
      expect(bundle, needle).not.toContain(needle);
    }
    const luxury = mainOf(read("guides/luxury-down-jacket-cleaning.html"));
    expect(luxury).toContain(NOT_BRAND_CARE);
    expect(luxury).not.toContain("$200");
    const leak = mainOf(read("guides/down-jacket-feather-leak.html"));
    expect(leak).toContain(LEAK_REPAIR);
    expect(leak).not.toMatch(/60\s*元|\$60|修改衣服/);
    const ski = mainOf(read("guides/ski-snow-jacket-cleaning.html"));
    expect(ski).toContain("清潔不等於恢復防潑水或防水透氣性能");
    expect(ski).not.toMatch(/頭盔|雪靴|雪衣價|防泼水/);
  });
});
