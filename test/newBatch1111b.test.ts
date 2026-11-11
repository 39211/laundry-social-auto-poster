import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1111B_PAGE_LASTMOD,
  NEW_BATCH_1111B_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const FULL = "免費收送";
const REF = "參考價，看過實品再報價";

/** 11/11 第二批：價格意圖 7 頁。金額只用 data/prices.json 且與官網價目表一致的列（涼鞋 $200、高爾夫球鞋 $400，老闆 11/11 03:16 確認；prices.json 已改成同值）。 */
const PAGES = [
  { slug: "taichung-shoe-cleaning-price", prices: [150, 200, 250, 300, 350, 400, 600], hub: "hubs/shoe-care.html", inbound: ["services/shoe-bag-care.html", "guides/leather-shoe-cleaning-price.html", "guides/taichung-shoe-cleaning-how-to-choose.html"] },
  { slug: "boot-hiking-shoe-cleaning-price", prices: [350, 450, 500, 550], hub: "hubs/shoe-care.html", inbound: ["guides/boot-shaft-cleaning.html", "guides/hiking-shoe-cleaning.html", "guides/sheepskin-boot-cleaning.html"] },
  { slug: "leather-garment-cleaning-price", prices: [300, 400, 600, 700, 800, 1200, 2000], hub: "hubs/luxury-garment-care.html", inbound: ["guides/leather-jacket-care.html", "guides/leather-pants-skirt.html", "guides/leather-mold-treatment.html"] },
  { slug: "everyday-clothes-cleaning-price", prices: [60, 70, 80, 100], hub: "hubs/luxury-garment-care.html", inbound: ["guides/shirt-suit-dry-cleaning.html", "guides/denim-jeans-cleaning.html", "services/clinic-uniform-laundry.html"] },
  { slug: "dress-skirt-gown-cleaning-price", prices: [80, 100, 120, 150, 180, 200, 450], hub: "hubs/luxury-garment-care.html", inbound: ["services/evening-gown-cleaning.html", "guides/day-dress-cleaning.html", "guides/pleated-skirt-care.html"] },
  { slug: "bedding-blanket-sleeping-bag-cleaning-price", prices: [30, 120, 150, 180, 200, 250, 300, 400], hub: "hubs/bedding-textile-care.html", inbound: ["guides/blanket-washing.html", "guides/sleeping-bag-cleaning.html", "guides/mattress-protector-washing.html"] },
  { slug: "bag-mold-cleaning-price", prices: [500, 550, 600, 900, 1500, 2500], hub: "hubs/bag-care.html", inbound: ["guides/luxury-bag-mold.html", "guides/bag-cleaning-price.html", "guides/leather-mold-treatment.html"] }
];

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), rel), "utf8");
}
function ov(rel: string): string {
  return read(join("seo-overrides", rel));
}
function mainOf(html: string): string {
  return html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
}
function pageNodes(html: string): Array<Record<string, unknown>> {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}";
  return JSON.parse(raw)["@graph"] ?? [];
}
/** 官方價目：data/prices.json 攤平後的 品項→金額。 */
function priceTable(): Map<string, number> {
  const raw = JSON.parse(read("data/prices.json")) as Record<string, unknown>;
  const out = new Map<string, number>();
  for (const group of Object.values(raw)) {
    if (group && typeof group === "object") for (const [k, v] of Object.entries(group as Record<string, number>)) out.set(k, v);
  }
  return out;
}

describe("11/11 第二批價格意圖 7 頁", () => {
  it("路徑清單與頁面一一對應，共 7 頁", () => {
    expect([...NEW_BATCH_1111B_PAGE_PATHS]).toEqual(PAGES.map((p) => `/guides/${p.slug}.html`));
  });

  it("進 sitemap、llms、有 hub 入鏈、lastmod 正確、可被索引、站內有 3 條入鏈", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.locCount).toBe(223);
    const llms = ov("llms.txt");
    const wellKnown = ov(".well-known/llms.txt");
    for (const page of PAGES) {
      const path = `/guides/${page.slug}.html`;
      const url = `https://sixiangjialaundry.com${path}`;
      expect(report.inbound[path]?.hubs, path).toContain(page.hub);
      const html = ov(path.slice(1));
      expect(html).not.toContain("noindex");
      expect(html).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html).toContain(`<time datetime="${NEW_BATCH_1111B_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1111B_PAGE_LASTMOD}"`);
      expect(ov("sitemap.xml")).toContain(`<loc>${url}</loc><lastmod>${NEW_BATCH_1111B_PAGE_LASTMOD}</lastmod>`);
      expect(llms).toContain(url);
      expect(wellKnown).toContain(url);
      for (const inbound of page.inbound) expect(ov(inbound), inbound).toContain(path);
    }
  });

  it("title、description、H1 不和既有頁重複", () => {
    const seen = new Map<string, string>();
    for (const page of PAGES) {
      const html = ov(`guides/${page.slug}.html`);
      for (const key of [html.match(/<title>(.*?)<\/title>/)?.[1], html.match(/<meta name="description" content="(.*?)"/)?.[1], html.match(/<h1>(.*?)<\/h1>/)?.[1]]) {
        expect(key, page.slug).toBeTruthy();
        expect(seen.has(key as string), `${page.slug} 與 ${seen.get(key as string)} 重複`).toBe(false);
        seen.set(key as string, page.slug);
      }
    }
  });

  for (const page of PAGES) {
    const path = `guides/${page.slug}.html`;
    describe(page.slug, () => {
      it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在", () => {
        const html = ov(path);
        const main = mainOf(html);
        // 行銷裁定 M1 指定的否定句「不保證全部乾淨」是核定句，先拿掉再查禁字；其餘「保證」仍禁。
        const audited = wave9AuditedText(html).replaceAll("04-2452-7411", "").replaceAll("不保證全部乾淨", "");
        expect(wave9BannedHits(audited)).toEqual([]);
        for (const needle of [FULL, REF, "https://lin.ee/w8qGVqM", "@454foyks", "0968327653", "04-2452-7411", "東海只有收送", "青海路二段365號", "台中洗衣收送"]) {
          expect(main, needle).toContain(needle);
        }
        expect(main.replaceAll(FULL, "")).not.toContain("免費");
        expect(main).not.toContain("台中全市");
        expect(main.replaceAll("最低消費", "")).not.toContain("最");
        expect(main.replaceAll("不保證全部乾淨", "")).not.toMatch(/賠|補償|保證|全新|殺菌|除臭|消毒/);
        expect(main).not.toMatch(/東海[^。；，]{0,12}(門市|店面)(?!，|。|；)/);
        expect(main).not.toContain("上色覆蓋");
        // 工程CEO：只准寫「防潑水」或「防水透氣」，不寫單獨的「防水」
        expect(html.replaceAll("防水透氣", "").replaceAll("防潑水", "")).not.toContain("防水");
        expect(main).not.toContain("皮包");
        expect(main).toContain("只能淡化");
        expect((main.match(/data-editorial="1"/g) ?? []).length).toBeGreaterThanOrEqual(3);
        expect(html).toContain("LINE 官方 @454foyks，或 LINE 0968327653");
      });

      it("每個金額都在官方價目、旁邊有參考價句、整頁金額集合與宣告一致", () => {
        const main = mainOf(ov(path));
        const prices = main.match(/\$\d+/g) ?? [];
        const tagged = main.match(/\$\d+( 起)?，參考價，看過實品再報價/g) ?? [];
        expect(tagged).toHaveLength(prices.length);
        expect([...new Set(prices.map((p) => Number(p.slice(1))))].sort((a, b) => a - b)).toEqual([...page.prices].sort((a, b) => a - b));
        const official = new Set(priceTable().values());
        for (const p of page.prices) expect(official.has(p), `${page.slug} $${p} 不在 prices.json`).toBe(true);
        // 「起」只准出現在站上本來就寫「起」的名牌包
        for (const m of main.matchAll(/\$(\d+) 起/g)) expect(m[1], page.slug).toBe("1500");
      });

      it("表格每一列的品項與金額和 prices.json 對得上", () => {
        const main = mainOf(ov(path));
        const table = main.match(/<section class="section" id="price-table">[\s\S]*?<\/section>/)?.[0] ?? "";
        const official = priceTable();
        const alias: Record<string, string> = { "低靴": "低靴子", "中靴": "中靴子", "高靴": "高靴子", "床單被套（薄）": "床單被套薄", "床單被套（厚）": "床單被套厚", "毛毯（單人）": "毛毯單人", "毛毯（雙人）": "毛毯雙人" };
        let rows = 0;
        for (const m of table.matchAll(/<tr><td>([^<]+)<\/td><td>\$(\d+)(?: 起)?，參考價，看過實品再報價<\/td>/g)) {
          const name = alias[m[1]!] ?? m[1]!;
          rows += 1;
          expect(official.get(name), `${page.slug} ${m[1]}`).toBe(Number(m[2]));
        }
        expect(rows).toBeGreaterThanOrEqual(5);
      });

      it("首段直接回答、FAQ 都在頁面，頁面層 JSON-LD 不放 FAQPage／HowTo", () => {
        const html = ov(path);
        const main = mainOf(html);
        const h1 = main.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? "";
        const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? "";
        expect(lead.startsWith(h1)).toBe(true);
        expect(main).toContain("直接答案");
        expect(main).toContain('<table class="comparison-table">');
        expect((main.match(/data-aeo-faq/g) ?? []).length).toBeGreaterThanOrEqual(4);
        const types = pageNodes(html).map((node) => node["@type"]);
        expect(types).toContain("WebPage");
        expect(types).toContain("BreadcrumbList");
        expect(types).not.toContain("FAQPage");
        expect(types).not.toContain("HowTo");
        // 沒有殘留骨架（外套頁）的字
        const headNoLd = html.slice(0, html.indexOf("<main>")).replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "").replace(/<style>[\s\S]*?<\/style>/, "");
        expect(headNoLd).not.toContain("外套");
      });

      it("answers.json 有這頁的摘要，來源指向本頁，且不含禁字", () => {
        const answers = JSON.parse(ov("answers.json"));
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

describe("11/11 涼鞋、高爾夫球鞋價格對齊官網價目表", () => {
  it("prices.json 涼鞋 200、高爾夫球鞋 400，不再留 150", () => {
    const table = priceTable();
    expect(table.get("涼鞋")).toBe(200);
    expect(table.get("高爾夫球鞋")).toBe(400);
  });

  it("官網價目頁與洗鞋頁寫的是 $200／$400", () => {
    for (const rel of ["services/taichung-laundry-price-list.html", "services/shoe-bag-care.html"]) {
      const html = ov(rel);
      expect(html, rel).toMatch(/涼鞋 \$200/);
      expect(html, rel).toMatch(/高爾夫球鞋 \$400/);
      expect(html, rel).not.toMatch(/(涼鞋|高爾夫球鞋)\s*\$150/);
    }
  });

  it("洗鞋價格頁價目表有涼鞋 $200、高爾夫球鞋 $400，且都帶參考價句", () => {
    const main = mainOf(ov("guides/taichung-shoe-cleaning-price.html"));
    expect(main).toContain(`<tr><td>涼鞋</td><td>$200，${REF}</td>`);
    expect(main).toContain(`<tr><td>高爾夫球鞋</td><td>$400，${REF}</td>`);
    expect(main).not.toContain("涼鞋、高爾夫球鞋不在上表");
  });
});

describe("行銷裁定 M1–M4（PR #325）", () => {
  it("M1：洗鞋頁 FAQ 改成「麂皮鞋可以送洗嗎？」，不再問水洗", () => {
    const main = mainOf(ov("guides/taichung-shoe-cleaning-price.html"));
    expect(main).toContain("麂皮鞋可以送洗嗎？");
    expect(main).toContain(`可以。麂皮鞋清潔參考價 $400，${REF}。麂皮盡量少碰水，不能下水強洗，髒污盡量加強處理，不保證全部乾淨；`);
    expect(main).not.toContain("麂皮鞋能水洗嗎");
    expect(main).not.toMatch(/麂皮鞋水洗參考價/);
  });

  it("M2：洗鞋頁價目表麂皮鞋列備註", () => {
    const main = mainOf(ov("guides/taichung-shoe-cleaning-price.html"));
    expect(main).toMatch(/<tr><td>麂皮鞋<\/td><td>\$400，[^<]*<\/td><td>清潔參考價；麂皮盡量少碰水<\/td>/);
  });

  it("M3：皮衣價格頁（含 description、JSON-LD 頁面節點、answers.json）不寫水洗參考價", () => {
    const html = ov("guides/leather-garment-cleaning-price.html");
    const main = mainOf(html);
    expect(main).not.toContain("水洗");
    expect(main).toContain("清潔參考價");
    expect(main).toContain("<th>清潔參考價</th>");
    expect(main).not.toContain("水洗價，乾洗");
    expect(main).toContain("乾洗、柔洗與發霉特殊污漬另計");
    const desc = html.match(/<meta name="description" content="(.*?)"/)?.[1] ?? "";
    expect(desc).not.toContain("水洗");
    const webPage = pageNodes(html).find((node) => node["@type"] === "WebPage");
    expect(JSON.stringify(webPage)).not.toContain("水洗");
    const answers = JSON.parse(ov("answers.json")).answers as Array<{ id: string; answer: string }>;
    expect(answers.find((a) => a.id === "leather-garment-cleaning-price-page-summary")?.answer).not.toContain("水洗");
    // title 不動
    expect(html).toContain("<title>皮衣送洗多少錢？");
  });

  it("M4：寢具頁大件天數改成「至少 10–14 天」", () => {
    const main = mainOf(ov("guides/bedding-blanket-sleeping-bag-cleaning-price.html"));
    expect(main.match(/毛毯、睡袋等大件至少 10–14 天，實際日期收件時確認/g)?.length).toBe(2);
    expect(main).not.toContain("寢具大件一般約");
  });

  it("寢具搜尋與分享摘要保留薄床單及單人毛毯的價格條件", () => {
    const html = ov("guides/bedding-blanket-sleeping-bag-cleaning-price.html");
    const webPage = pageNodes(html).find((node) => node["@type"] === "WebPage");
    const descriptions = [
      html.match(/<meta name="description" content="([^"]*)"/)?.[1],
      html.match(/<meta property="og:description" content="([^"]*)"/)?.[1],
      html.match(/<meta name="twitter:description" content="([^"]*)"/)?.[1],
      webPage?.description
    ];
    for (const description of descriptions) {
      expect(description).toContain("薄床單被套 $150");
      expect(description).toContain("單人毛毯 $200");
      expect(description).not.toContain("參考價：床單被套 $150");
      expect(description).toBe(descriptions[0]);
    }
    const titles = [
      html.match(/<title>([^<]*)<\/title>/)?.[1],
      html.match(/<meta property="og:title" content="([^"]*)"/)?.[1],
      html.match(/<meta name="twitter:title" content="([^"]*)"/)?.[1],
      webPage?.name
    ];
    for (const title of titles) {
      expect(title).toContain("？單人毛毯 $200");
      expect(title).not.toContain("？毛毯 $200");
      expect(title).toBe(titles[0]);
    }
  });
});
