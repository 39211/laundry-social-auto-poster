import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSitemapLinks, repoRootFromHere } from "../scripts/check-sitemap-links";

/** 2026-11-22 點擊加強：3 個新頁，只用站上已有事實與價目表金額。既有頁不加入鏈。 */
const PAGES = [
  {
    slug: "birkenstock-eva-slipper-odor",
    title: "勃肯 EVA 拖鞋會臭嗎？味道從哪來、能不能送洗｜私享家洗衣店",
    prices: ["$200", "$350", "$400"]
  },
  {
    slug: "leather-bag-surface-sticky",
    title: "皮包表面黏黏的怎麼辦？先分手汗、保養油、合成皮老化與油邊｜私享家洗衣店",
    prices: ["$600", "$1000", "$1500"]
  },
  {
    slug: "clothing-alteration-price",
    title: "台中修改衣服多少錢？改衣 $60 起，現場由師傅報價｜送洗順便改｜私享家洗衣店",
    prices: ["$60", "$50"]
  }
] as const;

/** 新頁連到第 10–14 名的既有頁（只改新頁）。 */
const NEW_TO_OLD = [
  ["taichung-bag-cleaning-how-to-choose", "/guides/bag-cleaning-price.html"],
  ["taichung-bag-cleaning-how-to-choose", "/guides/suede-bag-care.html"],
  ["luxury-garment-cleaning-price", "/guides/dry-cleaning-guide.html"],
  ["laundry-pickup-process-turnaround", "/guides/mattress-protector-washing.html"],
  ["wool-duvet-drying", "/guides/mattress-protector-washing.html"],
  ["leather-bag-surface-sticky", "/guides/bag-cleaning-price.html"],
  ["suede-faux-suede-fabric", "/guides/suede-bag-care.html"],
  ["luxury-laundry-shop-how-to-choose", "/guides/dry-cleaning-guide.html"]
] as const;

/** 新頁之間的入鏈，每個新頁至少一條。 */
const NEW_TO_NEW = [
  ["slipper-cleaning-price", "birkenstock-eva-slipper-odor"],
  ["slipper-mold-cleaning", "birkenstock-eva-slipper-odor"],
  ["taichung-bag-cleaning-how-to-choose", "leather-bag-surface-sticky"],
  ["luxury-garment-cleaning-price", "clothing-alteration-price"],
  ["laundry-pickup-process-turnaround", "clothing-alteration-price"]
] as const;

const BANNED = [
  "保證", "全新", "恢復原色", "除臭", "殺菌", "除蟎", "防水", "賠", "退單", "不下水",
  "100%", "如新", "陰乾", "本店實拍", "白鞋", "小白鞋", "除霉", "上色覆蓋"
] as const;

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

function guide(slug: string): string {
  return read(`seo-overrides/guides/${slug}.html`);
}

describe("2026-11-22 點擊加強新頁", () => {
  it("3 頁進 sitemap、llms、answers，lastmod 2026-11-22", () => {
    const report = checkSitemapLinks();
    expect(report.locCount).toBe(379);
    expect(report.missing).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(report.duplicateLocs).toEqual([]);
    const sitemap = read("seo-overrides/sitemap.xml");
    const llms = read("seo-overrides/llms.txt");
    const wellKnown = read("seo-overrides/.well-known/llms.txt");
    const answers = JSON.parse(read("seo-overrides/answers.json")) as {
      answers: Array<{ id: string; source_url: string; answer: string }>;
    };
    expect(answers.answers).toHaveLength(630);
    for (const page of PAGES) {
      const url = `https://sixiangjialaundry.com/guides/${page.slug}.html`;
      expect(sitemap, page.slug).toContain(`<loc>${url}</loc><lastmod>2026-11-22</lastmod>`);
      expect(llms, page.slug).toContain(url);
      expect(wellKnown, page.slug).toContain(url);
      const hit = answers.answers.filter((item) => item.id === `${page.slug}-page-summary`);
      expect(hit, page.slug).toHaveLength(1);
      expect(hit[0]?.source_url, page.slug).toBe(url);
      expect(hit[0]?.answer, page.slug).toContain("看過實品再報價");
      for (const word of BANNED) expect(hit[0]?.answer, `${page.slug} ${word}`).not.toContain(word);
    }
  });

  it("title 四欄同句、canonical 指向自己、dateModified 是 2026-11-22", () => {
    for (const page of PAGES) {
      const html = guide(page.slug);
      const url = `https://sixiangjialaundry.com/guides/${page.slug}.html`;
      expect(html.match(/<title>([^<]*)<\/title>/)?.[1], page.slug).toBe(page.title);
      expect(html, page.slug).toContain(`<meta property="og:title" content="${page.title}" />`);
      expect(html, page.slug).toContain(`<meta name="twitter:title" content="${page.title}" />`);
      expect(html, page.slug).toContain(`"name":"${page.title}"`);
      expect(html, page.slug).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html, page.slug).toContain('"dateModified":"2026-11-22"');
      expect(html, page.slug).not.toContain("slipper-cleaning-price.html#");
      expect(html, page.slug).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    }
  });

  it("正文沒有禁字；金額只用價目表上的數字，旁邊有參考價與看過實品再報價", () => {
    for (const page of PAGES) {
      const html = guide(page.slug);
      const main = mainOf(html);
      expect(main.length, page.slug).toBeGreaterThan(0);
      for (const word of BANNED) expect(main, `${page.slug} ${word}`).not.toContain(word);
      expect(html, page.slug).not.toContain("page-toc");
      expect(main, page.slug).toContain("參考價");
      expect(main, page.slug).toContain("看過實品再報價");
      const amounts = new Set(main.match(/\$\d+/g) ?? []);
      expect([...amounts].sort(), page.slug).toEqual([...page.prices].sort());
    }
    const eva = mainOf(guide("birkenstock-eva-slipper-odor"));
    expect(eva).toContain("不承諾除味");
    expect(eva).toContain("全 EVA 款沒有軟木鞋床");
    const alteration = mainOf(guide("clothing-alteration-price"));
    expect(alteration).toContain("改衣 $60 起，實際價格現場由師傅報價");
    expect(alteration).toContain("沒有逐項的改衣價格");
    const sticky = mainOf(guide("leather-bag-surface-sticky"));
    expect(sticky).toContain("水洗參考價，乾洗、柔洗另計");
    expect(sticky).toContain("無法靠清洗恢復");
  });

  it("新頁連到第 10–14 名的既有頁，也有新頁互連；既有頁沒有連到這 3 頁", () => {
    for (const [from, href] of NEW_TO_OLD) {
      expect(mainOf(guide(from)), `${from} -> ${href}`).toContain(`href="https://sixiangjialaundry.com${href}"`);
    }
    for (const [from, to] of NEW_TO_NEW) {
      expect(mainOf(guide(from)), `${from} -> ${to}`).toContain(
        `href="https://sixiangjialaundry.com/guides/${to}.html"`
      );
    }
    const allowed = new Set([
      ...PAGES.map((page) => page.slug),
      "slipper-cleaning-price",
      "slipper-mold-cleaning",
      "taichung-bag-cleaning-how-to-choose",
      "luxury-garment-cleaning-price",
      "laundry-pickup-process-turnaround",
      "synthetic-leather-peeling-care",
      "garment-inner-lining-care",
      "suede-jacket-water-wash-or-dry-clean",
      "suede-jacket-mold-and-oil-stain",
      "suede-jacket-cleaning-price",
      "suede-garment-shirt-skirt-care",
      "blanket-washing-machine-size-limit",
      "blanket-cleaning-price",
      "wool-duvet-dry-cleaning-price",
      "down-duvet-mold-and-sun-drying",
      "blanket-mold-odor-cleaning",
      "plush-doll-cleaning-price",
      "large-plush-doll-washing",
      "plush-doll-washing-machine-risk",
      "plush-doll-battery-music-box-care",
      "claw-machine-keychain-plush-cleaning",
      "leather-jacket-mold-cleaning-price",
      "leather-jacket-alcohol-wipe-risk",
      "leather-skirt-pants-washing-guide",
      "duvet-quilt-cleaning-price",
      "ironing-pressing-price",
      "down-jacket-cleaning-price",
      "where-to-iron-clothes-taichung",
      "suit-and-dress-steam-pressing",
      "shirt-ironing-wrinkle-and-starch",
      "pu-leather-jacket-peeling-fix",
      "faux-leather-bag-strap-peeling",
      "bag-leather-sticky-humidity-clean",
      "bag-inside-lining-sticky-peeling",
      "clothing-fading-recolor-vs-clean",
      "white-clothes-dyed-by-dark-laundry",
      "ballpoint-pen-ink-on-clothes",
      "jeans-dye-transfer-on-shoes-and-bags",
      "birkenstock-cork-suede-footbed-clean",
      "suede-shoe-rain-water-stains",
      "mesh-and-knit-sneaker-cleaning-price",
      "taichung-beitun-nantun-shoe-pickup",
      "bag-mold-cleaning-cost-and-limit",
      "vachetta-leather-water-stain-care",
      "nylon-canvas-backpack-mold-wash",
      "taichung-clothes-laundry-pickup-guide",
      "taichung-luxury-clothes-dry-cleaning",
      "gore-tex-jacket-dry-clean-or-wash",
      "down-jacket-washing-machine-clump",
      "luggage-cleaning-cost-by-size",
      "taichung-clothing-alteration-pickup",
      "plush-doll-specialty-shop-taichung",
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
    ]);
    const root = repoRootFromHere();
    const leaks: string[] = [];
    for (const file of htmlFiles(join(root, "seo-overrides"))) {
      const rel = file.slice(root.length + 1).replaceAll("\\", "/");
      const m = rel.match(/^seo-overrides\/guides\/([^/]+)\.html$/);
      if (m && allowed.has(m[1] as string)) continue;
      const text = readFileSync(file, "utf8");
      for (const page of PAGES) {
        if (text.includes(`/guides/${page.slug}.html`)) leaks.push(`${rel} -> ${page.slug}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
