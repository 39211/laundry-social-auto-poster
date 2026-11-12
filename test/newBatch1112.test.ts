import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1112_PAGE_LASTMOD,
  NEW_BATCH_1112_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const FULL = "免費收送";
const CITY = "台中全市免費收送、沒有最低消費";
const REF = "參考價，看過實品再報價";
const SEE = "價格看過實品再報";
const SHOE_TIME = "洗鞋一般約一個禮拜可以拿，實際日期收件時確認";
const CLOTH_TIME = "一般約 7 天可以拿，實際日期收件時確認";
const REPAIR = "屬修繕，不包含在清潔內；能不能處理、是否另計，要看過實品由門市說明。";
const BIG = "推車或比較大件的物品至少 10～14 天才能交件";

/** 11/12 週四新頁。毛衣洗完變大、變長、變硬不另開：既有肩線頁的 title 與 H2 已是該問句。 */
const PAGES = [
  {
    slug: "suede-water-hardened",
    h1: "麂皮碰水變硬怎麼辦？",
    prices: ["$400"],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/suede-shoe-cleaning.html", "guides/suede-jacket-cleaning.html", "guides/nubuck-shoe-cleaning.html"],
    outbound: [
      "/guides/suede-shoe-cleaning.html",
      "/guides/suede-jacket-cleaning.html",
      "/guides/suede-bag-care.html",
      "/guides/nubuck-shoe-cleaning.html"
    ]
  },
  {
    slug: "shoes-dyed-by-jeans",
    h1: "鞋子被牛仔褲染色怎麼辦？",
    prices: ["$80", "$250", "$400"],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/new-shoe-dye-ruboff.html", "guides/clothing-dye-transfer.html", "guides/denim-jeans-cleaning.html"],
    outbound: [
      "/guides/new-shoe-dye-ruboff.html",
      "/guides/clothing-dye-transfer.html",
      "/guides/denim-jeans-cleaning.html"
    ]
  },
  {
    slug: "leather-shoe-crease-limit",
    h1: "皮鞋摺痕能不能處理？",
    prices: ["$400"],
    hub: "hubs/shoe-care.html",
    inbound: [
      "guides/dress-shoe-polish-buildup.html",
      "guides/leather-jacket-elbow-crease.html",
      "guides/leather-sneaker-care.html"
    ],
    outbound: [
      "/guides/dress-shoe-polish-buildup.html",
      "/guides/leather-jacket-elbow-crease.html",
      "/guides/leather-sneaker-care.html"
    ]
  },
  {
    slug: "stroller-cleaning",
    h1: "嬰兒推車、娃娃推車怎麼清洗？",
    prices: [],
    hub: "hubs/bedding-textile-care.html",
    inbound: ["services/taichung-citywide-laundry-pickup.html", "guides/photo-before-laundry.html"],
    outbound: ["/services/taichung-citywide-laundry-pickup.html", "/guides/photo-before-laundry.html"]
  },
  {
    slug: "suede-faux-suede-fabric",
    h1: "麂皮、仿麂皮、麂皮絨怎麼分？",
    prices: ["$400"],
    hub: "hubs/shoe-care.html",
    inbound: ["guides/suede-shoe-cleaning.html", "guides/velvet-shoe-cleaning.html", "guides/suede-jacket-cleaning.html"],
    outbound: [
      "/guides/suede-shoe-cleaning.html",
      "/guides/suede-jacket-cleaning.html",
      "/guides/suede-bag-care.html",
      "/guides/nubuck-shoe-cleaning.html",
      "/guides/velvet-shoe-cleaning.html"
    ]
  }
] as const;

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

function meta(html: string, name: string): string {
  return html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] ?? "";
}

describe("11/12 週四新頁 5 頁", () => {
  it("路徑清單與頁面一一對應，共 5 頁", () => {
    expect([...NEW_BATCH_1112_PAGE_PATHS]).toEqual(PAGES.map((page) => `/guides/${page.slug}.html`));
  });

  it("進 sitemap、llms、有 hub 入鏈、lastmod 正確、可被索引", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.locCount).toBe(228);
    const llms = read("llms.txt");
    const wellKnown = read(".well-known/llms.txt");
    for (const page of PAGES) {
      const path = `/guides/${page.slug}.html`;
      const url = `https://sixiangjialaundry.com${path}`;
      expect(report.inbound[path]?.hubs, path).toContain(page.hub);
      const html = read(path.slice(1));
      expect(html).not.toContain("noindex");
      expect(html).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html).toContain(`<time datetime="${NEW_BATCH_1112_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1112_PAGE_LASTMOD}"`);
      expect(html).toContain('id="check-before"');
      expect(html).toContain("送洗前先檢查");
      expect(html).toContain('id="stop-and-send"');
      expect(html).toContain("先停手、改送洗");
      expect(read("sitemap.xml")).toContain(`<loc>${url}</loc><lastmod>${NEW_BATCH_1112_PAGE_LASTMOD}</lastmod>`);
      expect(llms).toContain(url);
      expect(wellKnown).toContain(url);
      for (const inbound of page.inbound) expect(read(inbound), inbound).toContain(path);
      for (const outbound of page.outbound) expect(html, outbound).toContain(outbound);
    }
  });

  it("title、description、H1 不和全站既有頁重複", () => {
    const seen = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, name.name);
        if (name.isDirectory()) walk(full);
        else if (name.name.endsWith(".html")) {
          const html = readFileSync(full, "utf8");
          const rel = full.slice(join(repoRootFromHere(), "seo-overrides").length + 1);
          for (const key of [
            html.match(/<title>(.*?)<\/title>/)?.[1],
            meta(html, "description"),
            html.match(/<h1>(.*?)<\/h1>/)?.[1]
          ]) {
            if (!key) continue;
            const prior = seen.get(key);
            expect(prior === undefined || prior === rel, `${rel} 與 ${prior} 重複：${key}`).toBe(true);
            seen.set(key, rel);
          }
        }
      }
    };
    walk(join(repoRootFromHere(), "seo-overrides"));
  });

  for (const page of PAGES) {
    const path = `guides/${page.slug}.html`;
    describe(page.slug, () => {
      it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在", () => {
        const html = read(path);
        const main = mainOf(html);
        const audited = wave9AuditedText(html).replaceAll("04-2452-7411", "");
        expect(wave9BannedHits(audited)).toEqual([]);
        expect(html).toContain("LINE 官方 @454foyks，或 LINE 0968327653");
        for (const needle of [
          FULL,
          CITY,
          REF,
          "https://lin.ee/w8qGVqM",
          "@454foyks",
          "0968327653",
          "04-2452-7411",
          "東海只有收送",
          "東海沒有門市",
          "青海路二段365號",
          "只能淡化",
          "示意圖（AI 生成）"
        ]) {
          expect(main, needle).toContain(needle);
        }
        expect(main.replaceAll(CITY, "").replaceAll(FULL, "")).not.toContain("免費");
        expect(main.replaceAll(CITY, "")).not.toContain("台中全市");
        expect(main.replaceAll("最低消費", "").replaceAll("至少", "")).not.toContain("最");
        expect(main).not.toMatch(/賠|補償|保證|全新|殺菌|除臭|消毒|抗菌|陰乾|不下水|一口價|上色覆蓋|實拍/);
        expect(main).not.toMatch(/東海[^。；，]{0,12}(門市|店面)(?!，|。|；)/);
        expect(main.replaceAll("防潑水", "").replaceAll("防水透氣", "")).not.toContain("防水");
        expect((main.match(/data-editorial="1"/g) ?? []).length).toBeGreaterThanOrEqual(3);
        expect(main).toContain("台中洗衣收送");
      });

      it("價格只出現價目表上的價，每個數字旁都有參考價句", () => {
        const main = mainOf(read(path));
        const prices = main.match(/\$\d+/g) ?? [];
        const tagged = main.match(/\$\d+，參考價，看過實品再報價/g) ?? [];
        expect(tagged).toHaveLength(prices.length);
        expect([...new Set(prices)].sort()).toEqual([...page.prices].sort());
        expect(main).not.toMatch(/\$\d+\s*起/);
        expect(main).not.toMatch(/優惠|折扣/);
      });

      it("首段直接回答；FAQ 問答都在頁面，頁面層 JSON-LD 不放 FAQPage／HowTo", () => {
        const html = read(path);
        const main = mainOf(html);
        const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? "";
        expect(lead.startsWith(page.h1)).toBe(true);
        expect(main).toContain("直接答案");
        expect(main).toContain('<table class="comparison-table">');
        const faqs = [...main.matchAll(/<article class="card" data-aeo-faq><h3>([^<]+)<\/h3><p>([\s\S]*?)<\/p><\/article>/g)];
        expect(faqs.length).toBeGreaterThanOrEqual(4);
        for (const faq of faqs) {
          const answer = faq[2] ?? "";
          expect(answer.length, faq[1]).toBeGreaterThan(20);
          expect(answer, faq[1]).not.toMatch(/如上|前面|前述|見上/);
        }
        const types = pageNodes(html).map((node) => node["@type"]);
        expect(types).toContain("WebPage");
        expect(types).toContain("BreadcrumbList");
        expect(types).not.toContain("FAQPage");
        expect(types).not.toContain("HowTo");
      });

      it("answers.json 有這頁的摘要，來源指向本頁，且不含禁字", () => {
        const answers = JSON.parse(read("answers.json")) as {
          answers: Array<{ id: string; source_url: string; answer: string }>;
        };
        const hit = answers.answers.find((item) => item.id === `${page.slug}-page-summary`);
        expect(hit?.source_url).toBe(`https://sixiangjialaundry.com/${path}`);
        expect(hit?.answer).toContain(REF);
        const text = JSON.stringify(hit).replaceAll(CITY, "").replaceAll(FULL, "");
        expect(text).not.toMatch(/保證|免費|賠|補償|全新|殺菌|除臭/);
        expect(text).not.toContain("台中全市");
      });
    });
  }

  it("皮鞋摺痕頁寫明清洗不能消除，修繕句完整", () => {
    const main = mainOf(read("guides/leather-shoe-crease-limit.html"));
    expect(main).toContain("清洗不能把走路彎出來的摺痕消除");
    expect(main).toContain(REPAIR);
    expect(main).toContain(SHOE_TIME);
    expect(main).not.toContain("上色覆蓋");
  });

  it("推車頁只用老闆親口事實，不報未確認的價格", () => {
    const main = mainOf(read("guides/stroller-cleaning.html"));
    expect(main).toContain("整台送來店裡，清洗時才拆解、把布拆下來洗");
    expect(main).toContain("手工溫柔清洗，不用機洗");
    expect(main).toContain(BIG);
    expect(main).toContain(SEE);
    expect(main).not.toMatch(/\$\d/);
    expect(main).not.toContain("陰乾");
    expect(main).not.toContain("汽座");
  });

  it("鞋類頁用洗鞋交期，衣物交期不拿來代替洗鞋", () => {
    for (const slug of ["suede-water-hardened", "shoes-dyed-by-jeans", "leather-shoe-crease-limit", "suede-faux-suede-fabric"]) {
      expect(mainOf(read(`guides/${slug}.html`)), slug).toContain(SHOE_TIME);
    }
    expect(mainOf(read("guides/suede-water-hardened.html"))).toContain(CLOTH_TIME);
    expect(mainOf(read("guides/shoes-dyed-by-jeans.html"))).toContain(CLOTH_TIME);
  });

  it("既有麂皮鞋頁仍保有「麂皮變硬怎麼辦」FAQ，新頁 H1 只收碰水", () => {
    expect(read("guides/suede-shoe-cleaning.html")).toContain("<h3>麂皮變硬怎麼辦？</h3>");
    const fresh = read("guides/suede-water-hardened.html");
    expect(fresh).not.toContain("<h1>麂皮變硬怎麼辦");
    expect(fresh).toContain("<h1>麂皮碰水變硬怎麼辦？</h1>");
  });

  it("毛衣洗完變大、變長、變硬不另開頁，既有肩線頁已是該問句", () => {
    const html = read("guides/knit-shoulder-bump-stretch.html");
    expect(html).toContain("毛衣洗完變大、變長、變硬怎麼辦");
    expect(html).toContain("<h2>毛衣洗完變大、變長或變硬怎麼辦？</h2>");
    expect(NEW_BATCH_1112_PAGE_PATHS.join("\n")).not.toContain("sweater");
  });
});
