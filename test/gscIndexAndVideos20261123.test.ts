import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_LOC_COUNT,
  SITEWIDE_BANNED_MARKERS,
  checkSitemapLinks,
  repoRootFromHere,
  sitemapLinkReportFailed
} from "../scripts/check-sitemap-links";

const SITE = "https://sixiangjialaundry.com";

const VIDEO_WATCH_PAGES = [
  { slug: "duvet-inner-drying-check", ytId: "70qUns7icUY" },
  { slug: "down-jacket-cuff-cleaning", ytId: "94f_Tr9g4NE" },
  { slug: "leather-bag-mold-darkening", ytId: "YgRlFBdPYa0" },
  { slug: "snow-boot-water-mark-cleaning", ytId: "Nac9mIuxBUg" },
  { slug: "light-shoe-drying-yellowing", ytId: "v0_YcbbmG9Y" },
  { slug: "wool-coat-hotpot-stain", ytId: "DOEwnXazKKM" },
  { slug: "wool-sweater-pilling-care", ytId: "74jq98-izu4" },
  { slug: "single-pair-shoe-pickup", ytId: "kgBHPX1tWQY" },
  { slug: "concierge-contactless-pickup", ytId: "Qy1-aADQyU4" },
  { slug: "single-item-laundry-pickup", ytId: "M_foOtCsgj8" },
  { slug: "canvas-shoe-wash-full-process", ytId: "ubpuqVpwp5c" },
  { slug: "bag-mold-dont-wipe-first", ytId: "oF3OETEwQiU" },
  { slug: "white-tee-chocolate-icecream-stain", ytId: "NGwAcxyxmk8" },
  { slug: "turtleneck-collar-makeup-stain", ytId: "Nvg7eYjoVIU" },
  { slug: "sequin-dress-cleaning-check", ytId: "wbYmrir3nVY" },
  { slug: "tencel-bedding-care-label", ytId: "y99XlWOQkRo" },
  { slug: "seasonal-storage-collar-cuff-check", ytId: "B11NlB3fH5w" },
  { slug: "qipao-storage-yellow-spots", ytId: "oF2jCsJ-yjE" },
  { slug: "dry-cleaning-solvent-explained", ytId: "m_uOiRjKDiI" },
  { slug: "jeans-dye-transfer-on-shoes", ytId: "NU0xz8t-6xE" },
  { slug: "cashmere-scarf-shrunk-hardened", ytId: "E8uMcMmxvC8" }
] as const;

const NEW_GUIDE_SLUGS = [
  "padded-cotton-jacket-care",
  "corduroy-garment-care",
  "mohair-alpaca-coat-care",
  "shearling-coat-care",
  "wool-duvet-sun-drying",
  "nylon-jacket-oil-stain",
  "backpack-cleaning-price",
  "shoe-spin-dry-risk",
  "synthetic-leather-peeling-care",
  "faux-suede-water-wash",
  "blanket-tumble-dry-guide",
  "luggage-cleaning-service-price",
  "suede-bag-dye-transfer-on-clothes",
  "down-jacket-storage-mold-spots",
  "taichung-curtain-cleaning-pickup",
  "taichung-carpet-cleaning-pickup",
  "taichung-plush-doll-laundry-shop",
  "duvet-mold-can-it-be-used",
  "garment-inner-lining-care",
  "xitun-fengjia-shoe-cleaning-pickup"
] as const;

const LOW_CTR_UPGRADED_PATHS = [
  "guides/curtain-cleaning.html",
  "guides/wool-duvet-washing.html",
  "guides/dry-cleaning-guide.html",
  "local/donghai-laundry-pickup.html",
  "local/nantun-laundry-pickup.html",
  "local/north-district-laundry-pickup.html",
  "local/beitun-shoe-cleaning.html",
  "guides/clothing-alteration-with-laundry.html",
  "guides/bedding-duvet-cleaning.html",
  "guides/backpack-cleaning-check.html",
  "local/fengyuan-laundry-pickup.html",
  "guides/rainy-shoe-care.html",
  "guides/dry-cleaning-explained.html",
  "guides/coin-laundry-vs-pickup.html"
] as const;

const STUCK_CORE_PATHS = [
  "/services/taichung-citywide-laundry-pickup.html",
  "/services/taichung-xitun-laundry.html",
  "/services/business-bulk-laundry.html",
  "/services/duvet-bedding-cleaning.html",
  "/services/fabric-storage.html",
  "/guides/taichung-laundry-service-search.html"
] as const;

const JOURNAL_ARCHIVE_URLS = [
  `${SITE}/journal/2026-07/`,
  `${SITE}/journal/2026-08/`,
  `${SITE}/journal/2026-09/`,
  `${SITE}/journal/2026-10/`,
  `${SITE}/journal/2026-11/`
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
  "小白鞋",
  "除霉",
  "上色覆蓋",
  "100%",
  "本頁",
  "這頁"
] as const;

function readOv(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function mainOf(html: string): string {
  return html.match(/<main>([\s\S]*?)<\/main>/u)?.[1] ?? "";
}

function parseGraph(html: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)) {
    const parsed = JSON.parse(m[1] ?? "{}") as { "@graph"?: Array<Record<string, unknown>> };
    if (Array.isArray(parsed["@graph"])) nodes.push(...parsed["@graph"]);
  }
  return nodes;
}

describe("2026-11-23 GSC 未索引與影片觀賞頁補齊", () => {
  it("sitemap.xml 通過完整性檢查，納入 22 支影片頁、8 篇新指南與 5 筆月刊存檔", () => {
    const report = checkSitemapLinks();
    expect(report.locCount).toBe(299);
    expect(EXPECTED_LOC_COUNT).toBe(299);
    expect(sitemapLinkReportFailed(report)).toBe(false);

    const sitemap = readOv("sitemap.xml");
    expect(sitemap).toContain(`<loc>${SITE}/videos/</loc>`);
    for (const v of VIDEO_WATCH_PAGES) {
      expect(sitemap, v.slug).toContain(`<loc>${SITE}/videos/${v.slug}.html</loc>`);
    }
    for (const slug of NEW_GUIDE_SLUGS) {
      expect(sitemap, slug).toContain(`<loc>${SITE}/guides/${slug}.html</loc>`);
    }
    for (const url of JOURNAL_ARCHIVE_URLS) {
      expect(sitemap, url).toContain(`<loc>${url}</loc><lastmod>`);
    }
  });

  it("21 支影片觀賞頁均具備首屏 iframe、單一完整 VideoObject、self canonical 與無禁詞", () => {
    const hubHtml = readOv("videos/index.html");
    const hubMain = mainOf(hubHtml);
    expect(hubHtml).toContain(`<link rel="canonical" href="${SITE}/videos/" />`);
    expect(hubHtml).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(hubHtml).not.toContain("page-toc");
    for (const word of BANNED_IN_MAIN) expect(hubMain, `hub ${word}`).not.toContain(word);
    for (const word of SITEWIDE_BANNED_MARKERS) expect(hubHtml, `hub ${word}`).not.toContain(word);

    for (const v of VIDEO_WATCH_PAGES) {
      const rel = `videos/${v.slug}.html`;
      expect(existsSync(join(repoRootFromHere(), "seo-overrides", rel)), rel).toBe(true);
      const html = readOv(rel);
      const main = mainOf(html);
      const url = `${SITE}/videos/${v.slug}.html`;

      expect(hubMain, v.slug).toContain(`href="${url}"`);
      expect(html, v.slug).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html, v.slug).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
      expect(html.match(/<h1\b/gu), v.slug).toHaveLength(1);
      expect(html, v.slug).not.toContain("page-toc");

      // Eager above-the-fold player iframe
      const iframeMatch = html.match(
        new RegExp(`<iframe[^>]+src="https://www\\.youtube-nocookie\\.com/embed/${v.ytId}[^"]*"[^>]*>`, "u")
      );
      expect(iframeMatch, v.slug).not.toBeNull();
      expect(iframeMatch?.[0] ?? "", v.slug).not.toContain('loading="lazy"');

      // Single VideoObject with required fields, no Product/AggregateRating/Review
      const graph = parseGraph(html);
      const jsonText = JSON.stringify(graph);
      expect(jsonText, v.slug).not.toMatch(/"(?:Product|AggregateRating|Review)"/);
      const videoNodes = graph.filter((n) => n["@type"] === "VideoObject");
      expect(videoNodes, v.slug).toHaveLength(1);
      const vo = videoNodes[0]!;
      expect(vo["name"], v.slug).toBeTruthy();
      expect(vo["description"], v.slug).toBeTruthy();
      expect(vo["thumbnailUrl"], v.slug).toBeTruthy();
      expect(vo["uploadDate"], v.slug).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(vo["duration"], v.slug).toMatch(/^PT\d+S$/u);
      expect(vo["embedUrl"], v.slug).toBe(`https://www.youtube-nocookie.com/embed/${v.ytId}`);
      expect(vo["publisher"], v.slug).toEqual({ "@id": `${SITE}/#business` });

      for (const word of BANNED_IN_MAIN) expect(main, `${v.slug} ${word}`).not.toContain(word);
      for (const word of SITEWIDE_BANNED_MARKERS) expect(html, `${v.slug} ${word}`).not.toContain(word);
    }
  });

  it("video-sitemap.xml 包含全部 21 支影片觀賞頁與對應播放器網址", () => {
    const vs = readOv("video-sitemap.xml");
    expect(vs).toContain('xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"');
    const locs = [...vs.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((m) => m[1]);
    expect(locs).toHaveLength(21);
    for (const v of VIDEO_WATCH_PAGES) {
      expect(locs, v.slug).toContain(`${SITE}/videos/${v.slug}.html`);
      expect(vs, v.slug).toContain(`<video:player_loc>https://www.youtube-nocookie.com/embed/${v.ytId}</video:player_loc>`);
    }
  });

  it("8 篇新指南均符合禁詞與價格規範，且 6 個未收錄核心頁都獲得新頁內鏈支持", () => {
    const allNewMainContents: string[] = [mainOf(readOv("videos/index.html"))];
    for (const v of VIDEO_WATCH_PAGES) {
      allNewMainContents.push(mainOf(readOv(`videos/${v.slug}.html`)));
    }
    for (const slug of NEW_GUIDE_SLUGS) {
      const html = readOv(`guides/${slug}.html`);
      const main = mainOf(html);
      const url = `${SITE}/guides/${slug}.html`;
      allNewMainContents.push(main);

      expect(html, slug).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html, slug).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
      expect(html.match(/<h1\b/gu), slug).toHaveLength(1);
      expect(html, slug).not.toContain("page-toc");
      for (const word of BANNED_IN_MAIN) expect(main, `${slug} ${word}`).not.toContain(word);
      for (const word of SITEWIDE_BANNED_MARKERS) expect(html, `${slug} ${word}`).not.toContain(word);
      const graph = parseGraph(html);
      expect(JSON.stringify(graph), slug).not.toMatch(/"(?:Product|AggregateRating|Review)"/);
      if (main.includes("$")) {
        expect(main, slug).toContain("參考價");
        expect(main, slug).toContain("看過實品再報價");
      }
    }

    const combinedMain = allNewMainContents.join("\n");
    for (const corePath of STUCK_CORE_PATHS) {
      expect(combinedMain, corePath).toContain(`href="${SITE}${corePath}"`);
    }
  });

  it("llms.txt 兩份檔完全一致並納入 30 頁；answers.json 含 528 筆且無禁詞", () => {
    const llms = readOv("llms.txt");
    const wellKnown = readOv(".well-known/llms.txt");
    expect(llms).toBe(wellKnown);
    expect(llms).toContain(`${SITE}/videos/`);
    for (const v of VIDEO_WATCH_PAGES) expect(llms, v.slug).toContain(`${SITE}/videos/${v.slug}.html`);
    for (const slug of NEW_GUIDE_SLUGS) expect(llms, slug).toContain(`${SITE}/guides/${slug}.html`);

    const ans = JSON.parse(readOv("answers.json")) as {
      answers: Array<{ id: string; source_url: string; answer: string }>;
    };
    expect(ans.answers).toHaveLength(550);
    const urls = new Set(ans.answers.map((a) => a.source_url));
    expect(urls.has(`${SITE}/videos/`)).toBe(true);
    for (const v of VIDEO_WATCH_PAGES) expect(urls.has(`${SITE}/videos/${v.slug}.html`), v.slug).toBe(true);
    for (const slug of NEW_GUIDE_SLUGS) expect(urls.has(`${SITE}/guides/${slug}.html`), slug).toBe(true);
    const ids = new Set(ans.answers.map((a) => a.id));
    for (const geoId of [
      "aeo-geo-taichung-shoe-price",
      "aeo-geo-taichung-bag-clean",
      "aeo-geo-curtain-carpet-pickup",
      "aeo-geo-synthetic-leather-peeling",
      "aeo-geo-blanket-wool-duvet-dry",
      "aeo-geo-xitun-fengjia-shoe-pickup",
      "aeo-geo-brand-voice-disambiguation",
      "aeo-geo-plush-doll-shop-taichung",
      "aeo-geo-birkenstock-odor-eva-suede",
      "aeo-geo-duvet-mold-usable"
    ]) {
      expect(ids.has(geoId), geoId).toBe(true);
    }
  });

  it("14 個高曝光低 CTR 舊頁改寫後 title／description 四欄一致且無禁詞", () => {
    for (const rel of LOW_CTR_UPGRADED_PATHS) {
      const html = readOv(rel);
      const t = html.match(/<title>([^<]*)<\/title>/u)?.[1] ?? "";
      const ogT = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/u)?.[1] ?? "";
      const twT = html.match(/<meta\s+name="twitter:title"\s+content="([^"]*)"/u)?.[1] ?? "";
      const d = html.match(/<meta\s+name="description"\s+content="([^"]*)"/u)?.[1] ?? "";
      const ogD = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/u)?.[1] ?? "";
      const twD = html.match(/<meta\s+name="twitter:description"\s+content="([^"]*)"/u)?.[1] ?? "";
      const graph = parseGraph(html);
      const wp = graph.find((n) => n["@type"] === "WebPage");
      expect(t.length, rel).toBeGreaterThan(10);
      expect(ogT, rel).toBe(t);
      expect(twT, rel).toBe(t);
      expect(wp?.["name"], rel).toBe(t);
      expect(d.length, rel).toBeGreaterThan(20);
      expect(ogD, rel).toBe(d);
      expect(twD, rel).toBe(d);
      expect(wp?.["description"], rel).toBe(d);
      for (const word of BANNED_IN_MAIN) {
        expect(t, `${rel} title ${word}`).not.toContain(word);
        expect(d, `${rel} desc ${word}`).not.toContain(word);
      }
    }
  });
});
