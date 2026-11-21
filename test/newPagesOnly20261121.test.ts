import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSitemapLinks, repoRootFromHere } from "../scripts/check-sitemap-links";

/** 從 Draft #327、#328、#330、#334、#340 拆出、且目前 main 還沒有的新頁。 */
const PAGES = [
  { pr: 327, slug: "curtain-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "backpack-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "hat-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "uniform-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "boot-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "slipper-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "canvas-bag-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "canvas-shoe-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "luggage-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "snow-boot-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 327, slug: "carpet-mold-cleaning", lastmod: "2026-11-11" },
  { pr: 328, slug: "curtain-cleaning-price", lastmod: "2026-11-11" },
  { pr: 328, slug: "carpet-cleaning-price", lastmod: "2026-11-11" },
  { pr: 328, slug: "luxury-garment-cleaning-price", lastmod: "2026-11-11" },
  { pr: 328, slug: "uniform-cleaning-price", lastmod: "2026-11-11" },
  { pr: 328, slug: "slipper-cleaning-price", lastmod: "2026-11-11" },
  { pr: 330, slug: "luxury-laundry-shop-how-to-choose", lastmod: "2026-11-11" },
  { pr: 330, slug: "curtain-carpet-laundry-shop-how-to-choose", lastmod: "2026-11-11" },
  { pr: 330, slug: "taichung-bag-cleaning-how-to-choose", lastmod: "2026-11-11" },
  { pr: 330, slug: "laundry-pickup-process-turnaround", lastmod: "2026-11-11" },
  { pr: 334, slug: "suede-water-hardened", lastmod: "2026-11-12" },
  { pr: 334, slug: "shoes-dyed-by-jeans", lastmod: "2026-11-12" },
  { pr: 334, slug: "leather-shoe-crease-limit", lastmod: "2026-11-12" },
  { pr: 334, slug: "stroller-cleaning", lastmod: "2026-11-12" },
  { pr: 334, slug: "suede-faux-suede-fabric", lastmod: "2026-11-12" },
  { pr: 340, slug: "wool-duvet-drying", lastmod: "2026-11-16" }
] as const;

const BANNED_IN_MAIN = [
  "保證",
  "全新",
  "恢復原色",
  "除臭",
  "殺菌",
  "除蟎",
  "防水",
  "賠",
  "退單",
  "不下水",
  "如新",
  "陰乾",
  "本店實拍",
  "白鞋",
  "小白鞋"
] as const;

const WOOL_PRICE =
  "價目表上羊毛被 $800 是水洗參考價；羊毛被基本上只能乾洗，乾洗另計，看過實品再報價。";

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), rel), "utf8");
}

function mainOf(html: string): string {
  return html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
}

function htmlFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) htmlFiles(full, acc);
    else if (name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

describe("2026-11-21 只上新頁", () => {
  it("26 頁進 sitemap、llms、answers，且不要求既有頁加入鏈", () => {
    const report = checkSitemapLinks();
    expect(report.locCount).toBe(252);
    expect(report.missing).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.duplicateLocs).toEqual([]);
    const sitemap = read("seo-overrides/sitemap.xml");
    const llms = read("seo-overrides/llms.txt");
    const wellKnown = read("seo-overrides/.well-known/llms.txt");
    const answers = JSON.parse(read("seo-overrides/answers.json")) as {
      answers: Array<{ id: string; source_url: string; answer: string; keywords?: string[] }>;
    };
    const slugs = new Set(PAGES.map((page) => page.slug));
    expect(slugs.size).toBe(26);
    for (const page of PAGES) {
      const url = `https://sixiangjialaundry.com/guides/${page.slug}.html`;
      expect(sitemap, page.slug).toContain(`<loc>${url}</loc><lastmod>${page.lastmod}</lastmod>`);
      expect(llms, page.slug).toContain(url);
      expect(wellKnown, page.slug).toContain(url);
      const hit = answers.answers.find((item) => item.id === `${page.slug}-page-summary`);
      expect(hit?.source_url, page.slug).toBe(url);
      expect(JSON.stringify(hit), page.slug).not.toMatch(/白鞋|小白鞋|陰乾|除霉|保證|除臭|殺菌/);
    }
  });

  it("新頁正文沒有禁字，金額旁有參考價與看過實品再報價，既有頁沒有被加進這些網址", () => {
    const newFiles = new Set(PAGES.map((page) => `guides/${page.slug}.html`));
    /** 2026-11-22 點擊加強的 3 個新頁也是新頁，可以連到這 26 頁；既有頁仍然一條都不能加。 */
    for (const slug of ["birkenstock-eva-slipper-odor", "leather-bag-surface-sticky", "clothing-alteration-price"]) {
      newFiles.add(`guides/${slug}.html`);
    }
    for (const page of PAGES) {
      const html = read(`seo-overrides/guides/${page.slug}.html`);
      const main = mainOf(html);
      expect(main.length, page.slug).toBeGreaterThan(0);
      for (const word of BANNED_IN_MAIN) expect(main, `${page.slug} ${word}`).not.toContain(word);
      expect(html, page.slug).not.toContain("除霉");
      expect(html, page.slug).not.toContain("上色覆蓋");
      expect(html, page.slug).not.toContain("page-toc");
      if (main.includes("$")) {
        expect(main, page.slug).toContain("參考價");
        expect(main, page.slug).toContain("看過實品再報價");
      }
    }
    const root = repoRootFromHere();
    const leaks: string[] = [];
    for (const file of htmlFiles(join(root, "seo-overrides"))) {
      const rel = file.slice(root.length + 1).replaceAll("\\", "/");
      if (rel.startsWith("seo-overrides/") && newFiles.has(rel.slice("seo-overrides/".length))) continue;
      const text = readFileSync(file, "utf8");
      for (const page of PAGES) {
        if (text.includes(`/guides/${page.slug}.html`)) leaks.push(`${rel} -> ${page.slug}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("禁字刪改落在指定句子，羊毛被價格句帶參考價", () => {
    const canvas = read("seo-overrides/guides/canvas-shoe-mold-cleaning.html");
    expect(mainOf(canvas)).not.toContain("white-shoe-yellowing");
    expect(canvas).toContain("台中西屯 帆布鞋發霉 鞋舌 鞋墊");
    const snow = mainOf(read("seo-overrides/guides/snow-boot-mold-cleaning.html"));
    expect(snow).toContain("靴子放在通風處，慢慢讓它乾，不要用熱風。");
    const wool = read("seo-overrides/guides/wool-duvet-drying.html");
    expect(wool.split(WOOL_PRICE)).toHaveLength(3);
    const answers = JSON.parse(read("seo-overrides/answers.json")) as {
      answers: Array<{ id: string; answer: string; keywords: string[] }>;
    };
    const canvasAnswer = answers.answers.find((item) => item.id === "canvas-shoe-mold-cleaning-page-summary");
    expect(canvasAnswer?.keywords).not.toContain("小白鞋發霉");
    const woolAnswer = answers.answers.find((item) => item.id === "wool-duvet-drying-page-summary");
    expect(woolAnswer?.answer).toContain(WOOL_PRICE);
  });
});
