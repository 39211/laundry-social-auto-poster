import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1111C_PAGE_LASTMOD,
  NEW_BATCH_1111C_PAGE_PATHS,
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
    slug: "curtain-mold-cleaning",
    h1: "窗簾發霉怎麼辦？能送洗嗎、要多久、怎麼報價",
    prices: [],
    hub: "hubs/bedding-textile-care.html",
    inbound: ["services/curtain-carpet-cleaning.html", "hubs/local-pickup.html"]
  },
  {
    slug: "backpack-mold-cleaning",
    h1: "書包、背包發霉怎麼辦？能送洗嗎、怎麼估價",
    prices: ["$500"],
    hub: "hubs/bag-care.html",
    inbound: ["guides/bag-cleaning-price.html", "hubs/bag-care.html"]
  },
  {
    slug: "hat-mold-cleaning",
    h1: "帽子發霉怎麼辦？棒球帽、毛帽、皮帽能送洗嗎",
    prices: ["$80", "$300", "$130"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["guides/hat-cleaning.html", "guides/scarf-cleaning.html"]
  },
  {
    slug: "uniform-mold-cleaning",
    h1: "制服發霉怎麼辦？能送洗嗎、要多久、怎麼估價",
    prices: ["$80", "$100", "$70"],
    hub: "hubs/luxury-garment-care.html",
    inbound: ["services/clinic-uniform-laundry.html", "services/uniform-laundry.html", "guides/school-uniform-care.html"]
  },
  {
    slug: "boot-mold-cleaning",
    h1: "靴子發霉怎麼辦？皮靴、麂皮靴還能穿嗎、怎麼估價",
    prices: ["$350", "$450", "$550"],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/boot-shaft-cleaning.html", "guides/suede-shoe-mold.html", "hubs/shoe-care.html"]
  },
  {
    slug: "slipper-mold-cleaning",
    h1: "拖鞋發霉怎麼辦？EVA、勃肯拖鞋還能穿嗎、怎麼估價",
    prices: ["$200"],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/birkenstock-care.html", "guides/sandal-cleaning.html"]
  },
  {
    slug: "canvas-bag-mold-cleaning",
    h1: "帆布包發霉怎麼辦？能送洗嗎、怎麼估價",
    prices: ["$550", "$900", "$500"],
    hub: "hubs/bag-care.html",
    inbound: ["guides/bag-cleaning-price.html", "hubs/bag-care.html"]
  },
  {
    slug: "canvas-shoe-mold-cleaning",
    h1: "帆布鞋發霉怎麼辦？還能穿嗎、洗鞋要多久、怎麼估價",
    prices: ["$250", "$300", "$350"],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/white-shoe-yellowing.html"]
  },
  {
    slug: "luggage-mold-cleaning",
    h1: "行李箱發霉怎麼辦？內袋、拉鍊、輪子能送洗嗎",
    prices: [],
    hub: "hubs/bag-care.html",
    inbound: ["services/luggage-cleaning.html", "hubs/bag-care.html"]
  },
  {
    slug: "snow-boot-mold-cleaning",
    h1: "雪靴發霉怎麼辦？內毛發霉能送洗嗎、怎麼估價",
    prices: [],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/sheepskin-boot-cleaning.html", "guides/boot-shaft-cleaning.html"]
  },
  {
    slug: "carpet-mold-cleaning",
    h1: "地毯發霉怎麼辦？能送洗嗎、要多久、怎麼報價",
    prices: [],
    hub: "hubs/bedding-textile-care.html",
    inbound: ["services/curtain-carpet-cleaning.html", "hubs/bedding-textile-care.html"]
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

describe("11/11 發霉問句第二批 11 頁", () => {
  it("路徑清單與頁面一一對應，共 11 頁", () => {
    expect([...NEW_BATCH_1111C_PAGE_PATHS]).toEqual(PAGES.map((page) => `/guides/${page.slug}.html`));
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
      expect(html).toContain(`<time datetime="${NEW_BATCH_1111C_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1111C_PAGE_LASTMOD}"`);
      expect(html).toContain('id="check-before"');
      expect(html).toContain("送洗前先檢查");
      expect(html).toContain('id="stop-and-send"');
      expect(html).toContain("先停手、改送洗");
      expect(read("sitemap.xml")).toContain(
        `<loc>${url}</loc><lastmod>${NEW_BATCH_1111C_PAGE_LASTMOD}</lastmod>`
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
        // 行銷 Q1：每個含金額的句子（以 。；與表格格為界）句尾帶一次參考價句，不必每個金額各貼一次。
        const sentences = main.replace(/<[^>]+>/g, "\n").split(/[。；\n]/u);
        for (const sentence of sentences.filter((x) => /\$\d+/.test(x))) {
          expect(sentence, sentence).toContain(REF);
          expect((sentence.match(/參考價，看過實品再報價/g) ?? []).length, sentence).toBe(1);
        }
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
        expect(hit?.answer).toContain("看過實品再報價");
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

  it("行銷裁定 M1–M7：title 不寫起算價、洗鞋天數用標準句、不寫沒有急件費、帽子皮帽不先說天數、行李箱與帆布鞋不寫定價邏輯", () => {
    const body = (slug: string) => read(`guides/${slug}.html`);
    const boot = body("boot-mold-cleaning");
    expect(boot).toContain("低靴 $350 參考價｜私享家洗衣店");
    expect(boot).not.toContain("起算價");
    for (const slug of ["boot-mold-cleaning", "slipper-mold-cleaning", "canvas-shoe-mold-cleaning", "snow-boot-mold-cleaning"]) {
      const html = body(slug);
      expect(html, slug).toContain("洗鞋一般約一個禮拜可以拿");
      expect(html, slug).not.toMatch(/5[–-]7 天|急件/u);
    }
    const hat = body("hat-mold-cleaning");
    expect(hat).toContain("布帽、毛帽一般約 7 天可以拿，實際日期收件時確認；皮帽不先說天數，看過實物再說明");
    const luggage = body("luggage-mold-cleaning");
    expect(luggage).toContain("行李箱沒有固定價，傳尺寸與照片到 LINE，看過實品再報價");
    expect(luggage).not.toContain("依尺寸");
    const canvasShoe = body("canvas-shoe-mold-cleaning");
    expect(canvasShoe).toContain("價目表沒有帆布鞋單獨一列，鞋面是布的先對照一般運動鞋 $250，皮或混合材質對照 $300／$350");
    expect(canvasShoe).toContain("帆布鞋（先對照一般運動鞋）");
    expect(canvasShoe).not.toContain("依一般運動鞋");
    const snow = mainOf(body("snow-boot-mold-cleaning"));
    expect(snow).not.toMatch(/看過實品再報價，參考價，看過實品再報價/u);
    const answers: Array<{ id: string; answer: string }> = JSON.parse(read("answers.json")).answers;
    for (const slug of ["boot", "slipper", "canvas-shoe", "snow-boot"]) {
      const a = answers.find((x) => x.id === `${slug}-mold-cleaning-page-summary`)?.answer ?? "";
      expect(a, slug).not.toMatch(/5[–-]7 天|急件/u);
    }
  });
});
