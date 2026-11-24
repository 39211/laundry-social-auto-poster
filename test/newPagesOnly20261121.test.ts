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
    expect(report.locCount).toBe(369);
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
    /** 2026-11-23 GSC 未索引與影片補齊：22 個 /videos/ 頁＋8 篇新指南也是新頁。 */
    newFiles.add("videos/index.html");
    for (const slug of [
      "duvet-inner-drying-check", "down-jacket-cuff-cleaning", "leather-bag-mold-darkening",
      "snow-boot-water-mark-cleaning", "light-shoe-drying-yellowing", "wool-coat-hotpot-stain",
      "wool-sweater-pilling-care", "single-pair-shoe-pickup", "concierge-contactless-pickup",
      "single-item-laundry-pickup", "canvas-shoe-wash-full-process", "bag-mold-dont-wipe-first",
      "white-tee-chocolate-icecream-stain", "turtleneck-collar-makeup-stain", "sequin-dress-cleaning-check",
      "tencel-bedding-care-label", "seasonal-storage-collar-cuff-check", "qipao-storage-yellow-spots",
      "dry-cleaning-solvent-explained", "jeans-dye-transfer-on-shoes", "cashmere-scarf-shrunk-hardened"
    ]) {
      newFiles.add(`videos/${slug}.html`);
    }
    for (const slug of [
      "padded-cotton-jacket-care", "corduroy-garment-care", "mohair-alpaca-coat-care", "shearling-coat-care",
      "wool-duvet-sun-drying", "nylon-jacket-oil-stain", "backpack-cleaning-price", "shoe-spin-dry-risk", "synthetic-leather-peeling-care", "faux-suede-water-wash", "blanket-tumble-dry-guide", "luggage-cleaning-service-price", "suede-bag-dye-transfer-on-clothes", "down-jacket-storage-mold-spots", "taichung-curtain-cleaning-pickup", "taichung-carpet-cleaning-pickup", "taichung-plush-doll-laundry-shop", "duvet-mold-can-it-be-used", "garment-inner-lining-care", "xitun-fengjia-shoe-cleaning-pickup",
      "suede-jacket-water-wash-or-dry-clean", "suede-jacket-mold-and-oil-stain", "suede-jacket-cleaning-price", "suede-garment-shirt-skirt-care",
      "blanket-washing-machine-size-limit", "blanket-cleaning-price", "wool-duvet-dry-cleaning-price", "down-duvet-mold-and-sun-drying", "blanket-mold-odor-cleaning",
      "plush-doll-cleaning-price", "large-plush-doll-washing", "plush-doll-washing-machine-risk", "plush-doll-battery-music-box-care", "claw-machine-keychain-plush-cleaning",
      "leather-jacket-mold-cleaning-price", "leather-jacket-alcohol-wipe-risk", "leather-skirt-pants-washing-guide",
      "duvet-quilt-cleaning-price", "ironing-pressing-price", "down-jacket-cleaning-price",
      "where-to-iron-clothes-taichung", "suit-and-dress-steam-pressing", "shirt-ironing-wrinkle-and-starch",
      "pu-leather-jacket-peeling-fix", "faux-leather-bag-strap-peeling", "bag-leather-sticky-humidity-clean", "bag-inside-lining-sticky-peeling",
      "clothing-fading-recolor-vs-clean", "white-clothes-dyed-by-dark-laundry", "ballpoint-pen-ink-on-clothes", "jeans-dye-transfer-on-shoes-and-bags",
      "birkenstock-cork-suede-footbed-clean", "suede-shoe-rain-water-stains", "mesh-and-knit-sneaker-cleaning-price", "taichung-beitun-nantun-shoe-pickup",
      "bag-mold-cleaning-cost-and-limit", "vachetta-leather-water-stain-care", "nylon-canvas-backpack-mold-wash",
      "taichung-clothes-laundry-pickup-guide", "taichung-luxury-clothes-dry-cleaning", "gore-tex-jacket-dry-clean-or-wash", "down-jacket-washing-machine-clump",
      "luggage-cleaning-cost-by-size", "taichung-clothing-alteration-pickup", "plush-doll-specialty-shop-taichung",
      "mattress-protector-machine-wash-and-dry",
      "duvet-washing-machine-vs-laundry-shop",
      "wool-blanket-water-wash-vs-dry-clean",
      "down-duvet-machine-wash-and-price",
      "cotton-duvet-mold-laundry-service",
      "trench-coat-washing-machine-risk",
      "wool-coat-water-wash-shrink-guide",
      "sweater-shrink-unshrink-limit",
      "silk-shirt-and-dress-washing-guide",
      "clothes-mold-laundry-can-it-be-washed",
      "padded-jacket-clump-after-wash",
      "dryer-machine-shoe-drying-risk",
      "shoes-dyeing-socks-why-and-fix",
      "glued-insole-how-to-clean-shoes",
      "synthetic-leather-shoe-peeling-check",
      "nubuck-vs-suede-shoe-care-guide",
      "school-backpack-washing-machine-risk",
      "hiking-backpack-cleaning-service",
      "wallet-sticky-and-mold-cleaning",
      "bag-peeling-vs-clean-limit",
      "bag-zipper-stuck-and-hardware-tarnish",
      "what-is-dry-cleaning-and-price",
      "color-bleeding-and-dye-transfer-meaning",
      "taichung-curtain-laundry-price-and-pickup",
      "fengyuan-donghai-laundry-and-shoe-pickup"
    ]) {
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
