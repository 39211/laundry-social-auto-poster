import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1111E_PAGE_LASTMOD,
  NEW_BATCH_1111E_PAGE_PATHS,
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
    slug: "luxury-laundry-shop-how-to-choose",
    dir: "guides",
    h1: "台中精品洗衣店怎麼挑？精品衣服送洗前先問這五件事",
    prices: ["$100", "$120", "$200", "$210", "$300"],
    hub: "hubs/luxury-garment-care.html",
    stopH: "挑店與送洗前先別這樣做",
    inbound: ["services/luxury-garment-cleaning.html", "guides/dry-cleaning-guide.html", "guides/luxury-dry-cleaning.html", "guides/luxury-garment-cleaning-price.html"]
  },
  {
    slug: "curtain-carpet-laundry-shop-how-to-choose",
    dir: "guides",
    h1: "洗窗簾、洗地毯的洗衣店怎麼挑？送洗前先問這五件事",
    prices: [],
    hub: "hubs/bedding-textile-care.html",
    stopH: "挑店與送洗前先別這樣做",
    inbound: ["services/curtain-carpet-cleaning.html", "guides/curtain-cleaning-price.html", "guides/carpet-cleaning-price.html", "guides/curtain-mold-cleaning.html"]
  },
  {
    slug: "taichung-bag-cleaning-how-to-choose",
    dir: "guides",
    h1: "台中洗包包推薦怎麼挑？送洗前先問材質、五金、價目與交期",
    prices: ["$1000", "$400", "$500", "$550", "$600", "$900"],
    hub: "hubs/bag-care.html",
    stopH: "挑店與送洗前先別這樣做",
    inbound: ["hubs/bag-care.html", "services/luxury-bag-cleaning.html", "guides/leather-bag-care.html", "services/shoe-bag-care.html"]
  },
  {
    slug: "laundry-pickup-process-turnaround",
    dir: "guides",
    h1: "衣服送洗怎麼送？台中送洗流程、要多久、多少錢",
    prices: ["$150", "$250", "$500", "$70"],
    hub: "hubs/local-pickup.html",
    stopH: "送洗前先別這樣做",
    inbound: ["services/taichung-citywide-laundry-pickup.html", "guides/how-laundry-quote-works.html", "guides/photo-before-laundry.html", "guides/taichung-laundry-service-search.html"]
  },
  {
    slug: "dali-shoe-cleaning",
    dir: "local",
    h1: "大里洗鞋怎麼送？成功路的日常鞋和仁化的工作鞋分開約",
    prices: ["$150", "$250", "$300", "$350", "$400"],
    hub: "hubs/shoe-care.html",
    stopH: "約收之前，這幾件事先別做",
    inbound: ["local/dali-laundry-pickup.html", "guides/taichung-shoe-cleaning-how-to-choose.html", "hubs/local-pickup.html"]
  },
  {
    slug: "taiping-shoe-cleaning",
    dir: "local",
    h1: "太平洗鞋怎麼送？勤益租屋的球鞋和長億家庭的童鞋分開約",
    prices: ["$150", "$250", "$350"],
    hub: "hubs/shoe-care.html",
    stopH: "約收之前，這幾件事先別做",
    inbound: ["local/taiping-laundry-pickup.html", "guides/kids-shoe-cleaning.html", "hubs/local-pickup.html"]
  },
  {
    slug: "wuri-shoe-cleaning",
    dir: "local",
    h1: "烏日洗鞋怎麼送？學田、三和住家約時間窗，站區不是收件點",
    prices: ["$150", "$250", "$300", "$350", "$400"],
    hub: "hubs/shoe-care.html",
    stopH: "約收之前，這幾件事先別做",
    inbound: ["local/wuri-laundry-pickup.html", "guides/taichung-shoe-cleaning-how-to-choose.html", "hubs/local-pickup.html"]
  },
  {
    slug: "fengyuan-shoe-cleaning",
    dir: "local",
    h1: "豐原洗鞋怎麼送？通勤皮鞋和透天全家的鞋分開約",
    prices: ["$150", "$250", "$350", "$400"],
    hub: "hubs/shoe-care.html",
    stopH: "約收之前，這幾件事先別做",
    inbound: ["local/fengyuan-laundry-pickup.html", "guides/taichung-shoe-cleaning-how-to-choose.html", "hubs/local-pickup.html"]
  },
  {
    slug: "tanzi-shoe-cleaning",
    dir: "local",
    h1: "潭子洗鞋怎麼送？車站、慈濟與加工區的鞋分開約",
    prices: ["$150", "$250", "$350", "$400"],
    hub: "hubs/shoe-care.html",
    stopH: "約收之前，這幾件事先別做",
    inbound: ["local/tanzi-laundry-pickup.html", "guides/taichung-shoe-cleaning-how-to-choose.html", "hubs/local-pickup.html"]
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

describe("11/11 發霉問句第二波 9 頁（挑店、流程、區域洗鞋）", () => {
  it("路徑清單與頁面一一對應，共 9 頁", () => {
    expect([...NEW_BATCH_1111E_PAGE_PATHS]).toEqual(PAGES.map((page) => `/${page.dir}/${page.slug}.html`));
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
      const path = `/${page.dir}/${page.slug}.html`;
      const url = `https://sixiangjialaundry.com${path}`;
      expect(report.inbound[path]?.hubs, path).toContain(page.hub);
      const html = read(path.slice(1));
      expect(html).not.toContain("noindex");
      expect(html).not.toContain("草稿");
      expect(html).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html).toContain(`<time datetime="${NEW_BATCH_1111E_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1111E_PAGE_LASTMOD}"`);
      expect(html).toContain('id="check-before"');
      expect(html).toContain("送洗前先檢查");
      expect(html).toContain('id="stop-and-send"');
      expect(html).toContain(page.stopH);
      expect(read("sitemap.xml")).toContain(
        `<loc>${url}</loc><lastmod>${NEW_BATCH_1111E_PAGE_LASTMOD}</lastmod>`
      );
      expect(llms).toContain(url);
      expect(wellKnown).toContain(url);
      for (const inbound of page.inbound) {
        expect(read(inbound), inbound).toContain(path);
      }
    }
  });

  for (const page of PAGES) {
    const path = `${page.dir}/${page.slug}.html`;
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
      const main = mainOf(read(`${page.dir}/${page.slug}.html`));
      expect(main, page.slug).not.toContain("上色覆蓋");
      expect(main, page.slug).toContain("只能淡化");
    }
  });

  it("行銷裁定 M1：meta 與 JSON-LD 的聯絡句用「LINE 官方 @454foyks，或 LINE 0968327653」", () => {
    for (const page of PAGES) {
      const html = read(`${page.dir}/${page.slug}.html`);
      expect(html, page.slug).not.toContain("LINE @454foyks／0968327653");
      expect(html, page.slug).toContain("LINE 官方 @454foyks，或 LINE 0968327653");
    }
  });

  it("皮革／麂皮／起／防水用語：不寫水洗價、不寫單獨防水、起只給名牌包（全站規則）", () => {
    for (const page of PAGES) {
      const html = read(`${page.dir}/${page.slug}.html`);
      expect(html, page.slug).not.toMatch(/防水(?!透氣)/u);
      expect(html, page.slug).not.toContain("名牌包 $1500 起；皆為水洗參考價");
      expect(mainOf(html).match(/\$\d+\s*起/g) ?? [], page.slug).toEqual([]);
    }
  });
});
