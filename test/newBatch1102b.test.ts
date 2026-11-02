import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_BATCH_1102B_PAGE_LASTMOD,
  NEW_BATCH_1102B_PAGE_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  wave9AuditedText,
  wave9BannedHits
} from "../scripts/check-sitemap-links";

const FULL = "台中全市免費收送、沒有最低消費";
const REF = "參考價，看過實品再報價";

/** 老闆與行銷經理核定的固定句，一字不改。賠償句只能在 FAQ；兩句都不進標題、description、頁面層 JSON-LD。 */
const DAMAGE_SENTENCE = "確認是本店處理造成的損壞，依該件洗護費的 10 倍賠償。送洗前我們會先告知風險，你也可以先傳照片到 LINE 問。";
const SHRINK_SENTENCE = "縮水的衣服可以拿來店裡看，能處理的我們會先說明；能拉回多少要看材質跟縮的程度，不保證回到原本的尺寸。價格看過實品再報價。";

const PAGES = [
  {
    slug: "laundry-damage-risk",
    h1: "衣服送洗會洗壞嗎？哪些衣服風險高、送洗前要先說什麼？",
    sentence: DAMAGE_SENTENCE
  },
  {
    slug: "sweater-shrunk-what-now",
    h1: "毛衣縮水怎麼辦？縮水的衣服洗衣店能不能處理？",
    sentence: SHRINK_SENTENCE
  }
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

/** 頁面上除了固定句本身，其餘文字都要照原本的硬規。 */
function withoutFixed(text: string): string {
  return text.replaceAll(DAMAGE_SENTENCE, "").replaceAll(SHRINK_SENTENCE, "");
}

describe("11/02 第二批 2 頁（洗壞、縮水）", () => {
  it("路徑清單與頁面一一對應，共 2 頁", () => {
    expect([...NEW_BATCH_1102B_PAGE_PATHS]).toEqual(PAGES.map((p) => `/guides/${p.slug}.html`));
  });

  it("進 sitemap、有入鏈、lastmod 正確、可被索引", () => {
    const report = checkSitemapLinks();
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    for (const path of NEW_BATCH_1102B_PAGE_PATHS) {
      expect(report.inbound[path]?.count, path).toBeGreaterThanOrEqual(1);
      const html = read(path.slice(1));
      expect(html).not.toContain("noindex");
      expect(html).not.toContain("草稿");
      expect(html).toContain(`<link rel="canonical" href="https://sixiangjialaundry.com${path}" />`);
      expect(html).toContain(`<time datetime="${NEW_BATCH_1102B_PAGE_LASTMOD}">`);
      expect(html).toContain(`"dateModified":"${NEW_BATCH_1102B_PAGE_LASTMOD}"`);
      expect(read("sitemap.xml")).toContain(
        `<loc>https://sixiangjialaundry.com${path}</loc><lastmod>${NEW_BATCH_1102B_PAGE_LASTMOD}</lastmod>`
      );
    }
  });

  for (const page of PAGES) {
    const path = `guides/${page.slug}.html`;
    describe(page.slug, () => {
      it("固定句一字不改，只出現在 FAQ 或答案處，不進標題、description、頁面層 JSON-LD", () => {
        const html = read(path);
        const main = mainOf(html);
        expect(main).toContain(page.sentence);
        const head = html.slice(0, html.indexOf("<main>"));
        const headWithoutShop = head.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "");
        expect(headWithoutShop).not.toContain(page.sentence);
        expect(headWithoutShop).not.toMatch(/賠/);
        const pageLd = pageNodes(html)
          .filter((n) => n["@type"] === "WebPage" || n["@type"] === "BreadcrumbList")
          .map((n) => JSON.stringify(n))
          .join("");
        expect(pageLd).not.toContain(page.sentence);
        expect(pageLd).not.toMatch(/賠/);
        const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? "";
        expect(lead).not.toContain(page.sentence);
        const h1 = main.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? "";
        expect(h1).toBe(page.h1);
        const faqCards = [...main.matchAll(/<article class="card" data-aeo-faq>([\s\S]*?)<\/article>/g)].map((m) => m[1] ?? "");
        const inFaq = faqCards.filter((c) => c.includes(page.sentence));
        expect(inFaq.length).toBeGreaterThanOrEqual(1);
        if (page.sentence === DAMAGE_SENTENCE) {
          expect(main.split(DAMAGE_SENTENCE).length - 1).toBe(1);
          expect(main.split("賠").length - 1).toBe(1);
          expect(html.split("賠").length - 1).toBe(1);
          expect(main.indexOf(DAMAGE_SENTENCE)).toBeGreaterThan(main.indexOf('id="faq"'));
        }
      });

      it("正文與頁面層 JSON-LD 不踩硬規，聯絡與界線句都在", () => {
        const html = read(path);
        const main = mainOf(html);
        const audited = withoutFixed(wave9AuditedText(html)).replaceAll("04-2452-7411", "");
        expect(wave9BannedHits(audited)).toEqual([]);
        for (const needle of [FULL, REF, "https://lin.ee/w8qGVqM", "@454foyks", "0968327653", "04-2452-7411"]) {
          expect(main, needle).toContain(needle);
        }
        const rest = withoutFixed(main);
        expect(rest.replaceAll(FULL, "")).not.toContain("免費");
        expect(rest.replaceAll("最低消費", "")).not.toContain("最");
        expect(rest).not.toMatch(/賠|補償|保證|全新|殺菌|除臭|消毒|絕不|全額|原價/);
        expect(rest).not.toMatch(/東海[^。；，]{0,12}(門市|店面)(?!，|。|；)/);
        expect(main).toContain("東海只有收送");
        expect(html).not.toMatch(/還原(?!劑)|復原|拉回原尺寸|恢復原狀|救回/);
      });

      it("沒有金額、百分比、天數", () => {
        const main = mainOf(read(path));
        const rest = withoutFixed(main)
          .replaceAll("04-2452-7411", "")
          .replaceAll("0968327653", "")
          .replaceAll("2026-11-02", "")
          .replaceAll("https://lin.ee/w8qGVqM", "");
        expect(rest).not.toMatch(/\$|＄|元|NT|%|％|百分/);
        expect(rest).not.toMatch(/[0-9０-９一二三四五六七八九十兩]+\s*(天|日|個工作)/);
        expect(rest).not.toContain("天");
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

      it("answers.json 有這頁的摘要，來源指向本頁，且不含賠償、保證、還原字樣", () => {
        const answers = JSON.parse(read("answers.json"));
        const items: Array<{ id: string; source_url: string; answer: string }> = answers.answers ?? [];
        const hit = items.find((i) => i.id === `${page.slug}-page-summary`);
        expect(hit?.source_url).toBe(`https://sixiangjialaundry.com/${path}`);
        expect(hit?.answer).toContain(REF);
        const text = JSON.stringify(hit).replaceAll(FULL, "");
        expect(text).not.toMatch(/保證|免費|賠|補償|全新|殺菌|除臭|還原(?!劑)|復原|拉回原尺寸|\$|%/);
      });
    });
  }

  it("縮水頁還原劑只當一般常識寫在 FAQ，不放效果保證", () => {
    const main = mainOf(read("guides/sweater-shrunk-what-now.html"));
    const cards = [...main.matchAll(/<article class="card" data-aeo-faq>([\s\S]*?)<\/article>/g)].map((m) => m[1] ?? "");
    const hit = cards.filter((c) => c.includes("還原劑"));
    expect(hit.length).toBe(1);
    expect(hit[0]).toContain("也可能沒什麼效果");
    expect(main.split("還原劑").length - 1).toBe(2);
  });

  it("洗壞頁寫了洗標、舊傷、污漬來源三件事，且沒有保證不會洗壞", () => {
    const main = mainOf(read("guides/laundry-damage-risk.html"));
    for (const needle of ["洗標", "舊傷", "污漬"]) expect(main).toContain(needle);
    expect(main).not.toContain("保證不會洗壞");
  });
});
