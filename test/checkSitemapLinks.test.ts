import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_LOC_COUNT,
  NEW_PAGE_PATHS,
  NOINDEX_FOLLOW_LOCAL_PATHS,
  WAVE2_PAGE_PATHS,
  FAQ_JSONLD_PAGE_REFERENCE_MARKERS,
  LAYER1_BANNED_PHRASES,
  LAYER1_PHRASE_PAGE_PATHS,
  WAVE3_EXTRA_WRITER_VOICE_MARKERS,
  WAVE3_MERGED_PAGE_PATHS,
  WAVE3_PAGE_PATHS,
  WAVE3_VOICE_PAGE_PATHS,
  WAVE4_BANNED_MARKERS,
  WAVE4_PAGE_PATHS,
  WRITER_VOICE_MARKERS,
  checkSitemapLinks,
  faqJsonLdPageReferenceOffenders,
  layer1BannedPhraseHits,
  repoRootFromHere,
  sitemapLinkReportFailed,
  wave3WriterVoiceHits,
  wave4BannedHits,
  writerVoiceHits
} from "../scripts/check-sitemap-links";

// 我們賣的是服務，也沒有自己的評分資料：seo-overrides 的 JSON-LD 不可出現這些型別。
// 2026-10 GSC 產品摘要錯誤（itemOffered 被標成 Product）就是這樣漏過的；產生器測試只管產生的頁。
const BANNED_JSONLD_TYPES = ["Product", "AggregateRating", "Review"];

function overrideHtmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return overrideHtmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

function bannedJsonLdTypes(html: string): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const type = (node as Record<string, unknown>)["@type"];
    for (const t of Array.isArray(type) ? type : [type]) {
      if (typeof t === "string" && BANNED_JSONLD_TYPES.includes(t)) found.push(t);
    }
    Object.values(node).forEach(visit);
  };
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    visit(JSON.parse(match[1] ?? ""));
  }
  return found;
}

describe("seo-overrides B4＋B5 sitemap 與 hub 入鏈", () => {
  it("每個 sitemap URL 都有檔，B2＋B3＋B4-a＋B4-b＋B5 第 1 波共 73 個新頁各有至少一條 hub 入鏈", () => {
    const report = checkSitemapLinks();

    expect(report.parseOk).toBe(true);
    expect(report.locCount).toBe(EXPECTED_LOC_COUNT);
    expect(report.postsCount).toBe(0);
    expect(report.missing).toEqual([]);
    expect(report.duplicateLocs).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.unexpectedInSitemap).toEqual([]);
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(sitemapLinkReportFailed(report)).toBe(false);
    expect(NEW_PAGE_PATHS).toHaveLength(73);
    expect(WAVE2_PAGE_PATHS).toHaveLength(5);
    expect(WAVE3_PAGE_PATHS).toHaveLength(4);
    expect(WAVE3_MERGED_PAGE_PATHS).toHaveLength(3);
    expect(WAVE3_VOICE_PAGE_PATHS).toHaveLength(7);
    expect(WAVE4_PAGE_PATHS).toHaveLength(10);
    expect(NOINDEX_FOLLOW_LOCAL_PATHS).toHaveLength(16);
    const root = repoRootFromHere();
    for (const path of NOINDEX_FOLLOW_LOCAL_PATHS) {
      const html = readFileSync(join(root, "seo-overrides", path.slice(1)), "utf8");
      expect(html, path).toContain('<meta name="robots" content="noindex, follow" />');
      expect(html, path).toContain('<meta name="googlebot" content="noindex, follow" />');
      expect(html, path).toContain(`<link rel="canonical" href="https://sixiangjialaundry.com${path}" />`);
      expect(html, path).not.toContain('content="index, follow');
    }
    for (const path of NEW_PAGE_PATHS) {
      expect(report.inbound[path]?.count).toBeGreaterThanOrEqual(1);
    }
    expect(report.inbound["/guides/down-clump-after-wash.html"]?.count).toBeGreaterThanOrEqual(1);
    expect(report.inbound["/guides/leather-bag-care.html"]?.count).toBeGreaterThanOrEqual(1);
    expect(report.inbound["/guides/knit-shoe-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/luxury-bag-storage.html"]?.hubs).toContain("hubs/bag-care.html");
    expect(report.inbound["/local/qingshui-laundry-pickup.html"]?.hubs).toContain("hubs/local-pickup.html");
    expect(report.inbound["/guides/velvet-shoe-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/suede-bag-care.html"]?.hubs).toContain("hubs/bag-care.html");
    expect(report.inbound["/guides/dry-cleaning-explained.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/sleeping-bag-cleaning.html"]?.hubs).toContain("hubs/bedding-textile-care.html");
    expect(report.inbound["/services/evening-gown-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/local/houli-laundry-pickup.html"]?.hubs).toContain("hubs/local-pickup.html");
    expect(report.inbound["/services/secondhand-luxury-shop-cleaning.html"]?.hubs).toContain("hubs/bag-care.html");
    expect(report.inbound["/services/sequin-rhinestone-clothing-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/services/ironing-pressing.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/spot-test-before-cleaning.html"]?.hubs).toEqual(
      expect.arrayContaining(["hubs/luxury-garment-care.html", "hubs/shoe-care.html"])
    );
    expect(report.inbound["/guides/kids-shoe-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/sandal-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/high-heel-structure.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/down-vest-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/scarf-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/cardigan-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/denim-jeans-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/day-dress-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/pu-leather-peeling.html"]?.hubs).toContain("hubs/bag-care.html");
    expect(report.inbound["/guides/golf-shoe-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/shoe-insole-check.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/leather-pants-skirt.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/pleated-skirt-care.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/iron-scorch-mark.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/doll-shoe-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/hat-cleaning.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/leather-glove-care.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/leather-belt-care.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/bedsheet-set-cleaning.html"]?.hubs).toContain("hubs/bedding-textile-care.html");
    expect(report.inbound["/guides/curtain-lining-blackout.html"]?.hubs).toContain("hubs/bedding-textile-care.html");
    expect(report.inbound["/guides/carpet-fiber-types.html"]?.hubs).toContain("hubs/bedding-textile-care.html");
    expect(report.inbound["/guides/plush-filling-clump.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/casual-shoe-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/suit-pants-crease.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/down-duvet-vs-jacket.html"]?.hubs).toContain("hubs/bedding-textile-care.html");
    expect(report.inbound["/guides/pillow-cleaning-check.html"]?.hubs).toContain("hubs/bedding-textile-care.html");
    expect(report.inbound["/guides/crossbody-bag-strap.html"]?.hubs).toContain("hubs/bag-care.html");
    expect(report.inbound["/guides/dry-clean-vs-wet-clean.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    const xml = readFileSync(join(root, "seo-overrides", "sitemap.xml"), "utf8");
    for (const path of LAYER1_PHRASE_PAGE_PATHS) {
      expect(xml, path).toContain(`<loc>https://sixiangjialaundry.com${path}</loc><lastmod>2026-10-14</lastmod>`);
    }
  });

  it("層 1 四頁沒有禁詞：錢頁、這裡、編價格", () => {
    expect(LAYER1_BANNED_PHRASES).toEqual(["錢頁", "這裡", "編價格"]);
    expect(LAYER1_PHRASE_PAGE_PATHS).toEqual([
      "/local/nantun-laundry-pickup.html",
      "/local/donghai-laundry-pickup.html",
      "/guides/trench-coat-cleaning.html",
      "/guides/leather-mold-treatment.html"
    ]);
    const root = repoRootFromHere();
    const hits: string[] = [];
    for (const path of LAYER1_PHRASE_PAGE_PATHS) {
      const html = readFileSync(join(root, "seo-overrides", path.slice(1)), "utf8");
      const found = layer1BannedPhraseHits(html);
      if (found.length > 0) hits.push(`${path}: ${found.join("、")}`);
    }
    expect(hits).toEqual([]);
  });

  it("第 2 波新頁與問答沒有寫手用語：不寫、這裡、重寫、改看、仍看、留在、換頁", () => {
    expect(WRITER_VOICE_MARKERS).toEqual(["不寫", "這裡", "重寫", "改看", "仍看", "留在", "換頁"]);
    const root = repoRootFromHere();
    const hits: string[] = [];
    for (const path of WAVE2_PAGE_PATHS) {
      const html = readFileSync(join(root, "seo-overrides", path.slice(1)), "utf8");
      const found = writerVoiceHits(html);
      if (found.length > 0) hits.push(`${path}: ${found.join("、")}`);
    }
    const answers = JSON.parse(readFileSync(join(root, "seo-overrides", "answers.json"), "utf8")) as {
      answers: Array<{ id: string; question: string; answer: string; source_url: string }>;
    };
    const wave2Urls = new Set(WAVE2_PAGE_PATHS.map((path) => `https://sixiangjialaundry.com${path}`));
    for (const entry of answers.answers) {
      if (!wave2Urls.has(entry.source_url)) continue;
      const found = writerVoiceHits(`${entry.question}\n${entry.answer}`);
      if (found.length > 0) hits.push(`${entry.id}: ${found.join("、")}`);
    }
    expect(hits).toEqual([]);
  });

  it("第 3 波新頁與問答沒有寫手用語：第 2 波七詞，再加上這頁、本頁、這句、一口價、另看", () => {
    expect(WAVE3_EXTRA_WRITER_VOICE_MARKERS).toEqual(["這頁", "本頁", "這句", "一口價", "另看"]);
    const root = repoRootFromHere();
    const hits: string[] = [];
    for (const path of WAVE3_VOICE_PAGE_PATHS) {
      const html = readFileSync(join(root, "seo-overrides", path.slice(1)), "utf8");
      const found = wave3WriterVoiceHits(html);
      if (found.length > 0) hits.push(`${path}: ${found.join("、")}`);
    }
    const answers = JSON.parse(readFileSync(join(root, "seo-overrides", "answers.json"), "utf8")) as {
      answers: Array<{ id: string; question: string; answer: string; source_url: string }>;
    };
    const wave3Urls = WAVE3_VOICE_PAGE_PATHS.map((path) => `https://sixiangjialaundry.com${path}`);
    for (const entry of answers.answers) {
      const onVoicePage = wave3Urls.some((url) => entry.source_url === url || entry.source_url.startsWith(`${url}#`));
      if (!onVoicePage) continue;
      const found = wave3WriterVoiceHits(`${entry.question}\n${entry.answer}`);
      if (found.length > 0) hits.push(`${entry.id}: ${found.join("、")}`);
    }
    expect(hits).toEqual([]);
  });

  it("第 4 波新頁與問答沒有禁詞，修繕原句除外", () => {
    expect(WAVE4_BANNED_MARKERS).toEqual([
      "本頁",
      "這頁",
      "另看",
      "最常",
      "最常見",
      "每天",
      "一口價",
      "編價格",
      "錢頁",
      "重寫",
      "同一頁",
      "這裡只",
      "不寫",
      "這裡",
      "改看",
      "仍看",
      "留在",
      "換頁",
      "這句"
    ]);
    const root = repoRootFromHere();
    const hits: string[] = [];
    for (const path of WAVE4_PAGE_PATHS) {
      const html = readFileSync(join(root, "seo-overrides", path.slice(1)), "utf8");
      const found = wave4BannedHits(html);
      if (found.length > 0) hits.push(`${path}: ${found.join("、")}`);
    }
    const answers = JSON.parse(readFileSync(join(root, "seo-overrides", "answers.json"), "utf8")) as {
      answers: Array<{ id: string; question: string; answer: string; source_url: string }>;
    };
    const wave4Urls = new Set(WAVE4_PAGE_PATHS.map((path) => `https://sixiangjialaundry.com${path}`));
    for (const entry of answers.answers) {
      if (!wave4Urls.has(entry.source_url)) continue;
      const found = wave4BannedHits(`${entry.question}\n${entry.answer}`);
      if (found.length > 0) hits.push(`${entry.id}: ${found.join("、")}`);
    }
    expect(hits).toEqual([]);
  });

  it("FAQ JSON-LD 的問題與答案不含本頁或這頁", () => {
    expect(FAQ_JSONLD_PAGE_REFERENCE_MARKERS).toEqual(["本頁", "這頁"]);
    expect(faqJsonLdPageReferenceOffenders()).toEqual([]);
  });

  it("seo-overrides 每個 HTML 的 JSON-LD 都沒有 Product、AggregateRating、Review", () => {
    const root = repoRootFromHere();
    const files = overrideHtmlFiles(join(root, "seo-overrides"));
    expect(files.length).toBeGreaterThanOrEqual(110);
    const offenders = files
      .map((file) => ({ file: relative(root, file).split("\\").join("/"), types: bannedJsonLdTypes(readFileSync(file, "utf8")) }))
      .filter((entry) => entry.types.length > 0)
      .map((entry) => `${entry.file}: ${[...new Set(entry.types)].join(",")} ×${entry.types.length}`);
    expect(offenders).toEqual([]);
  });
});
