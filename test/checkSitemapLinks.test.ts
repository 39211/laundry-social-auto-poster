import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectedLocCountFromOverrides,
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
  WAVE4_MERGED_PAGE_PATHS,
  WAVE4_PAGE_PATHS,
  WRITER_VOICE_MARKERS,
  checkSitemapLinks,
  faqJsonLdPageReferenceOffenders,
  SITEWIDE_BANNED_MARKERS,
  sitewideBannedOffenders,
  layer1BannedPhraseHits,
  repoRootFromHere,
  sitemapLinkReportFailed,
  wave3WriterVoiceHits,
  wave4BannedHits,
  writerVoiceHits
} from "../scripts/check-sitemap-links";

/**
 * main 的 sitemap 對這些頁的 lastmod（生產腳本內建的期望值較舊）。
 * 其中 /guides/down-jacket-cleaning.html 是 AEO325 排除頁（維持生產版，頁面內日期 2026-10-18），
 * sitemap 仍照 main 為 2026-10-22。
 */
const MAIN_REFRESHED_LASTMOD: Readonly<Record<string, string>> = {
  "/guides/boot-shaft-cleaning.html": "2026-10-22",
  "/guides/nubuck-shoe-cleaning.html": "2026-10-22",
  "/guides/hiking-shoe-cleaning.html": "2026-10-22",
  "/guides/sticky-bag-lining.html": "2026-10-26",
  "/guides/velvet-shoe-cleaning.html": "2026-10-22",
  "/guides/dress-shoe-polish-buildup.html": "2026-10-22",
  "/guides/suede-bag-care.html": "2026-10-26",
  "/guides/bag-hardware-tarnish.html": "2026-10-22",
  "/services/ironing-pressing.html": "2026-10-26",
  "/guides/down-vest-cleaning.html": "2026-10-22",
  "/guides/denim-jeans-cleaning.html": "2026-10-22",
  "/guides/pu-leather-peeling.html": "2026-10-26",
  "/guides/leather-belt-care.html": "2026-10-26",
  "/guides/down-jacket-cleaning.html": "2026-10-22"
};

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
    expect(report.locCount).toBe(expectedLocCountFromOverrides());
    expect(report.locCount).toBeGreaterThan(100);
    expect(report.postsCount).toBe(0);
    expect(report.missing).toEqual([]);
    expect(report.duplicateLocs).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.unexpectedInSitemap).toEqual([]);
    // 生產腳本內建的 lastmod 期望是舊值。main 之後對這 14 頁做過內容更新（第 5 波更新 2026-10-22、
    // 第 7 波／GSC 更新 2026-10-26），sitemap 與頁面內日期都跟著更新。這裡把期望值釘成 main 的值，
    // 清單一個都不能多、不能少，日期也不能變；其餘頁面的 lastmod 檢查照舊（空陣列）。
    expect([...report.wrongLastmod].sort()).toEqual(Object.keys(MAIN_REFRESHED_LASTMOD).sort());
    const sitemapXml = readFileSync(join(repoRootFromHere(), "seo-overrides", "sitemap.xml"), "utf8");
    for (const [path, date] of Object.entries(MAIN_REFRESHED_LASTMOD)) {
      expect(sitemapXml, path).toContain(`<loc>https://sixiangjialaundry.com${path}</loc><lastmod>${date}</lastmod>`);
      if (path === "/guides/down-jacket-cleaning.html") continue; // AEO325 排除頁：頁面日期 2026-10-18，見下方註解
      const html = readFileSync(join(repoRootFromHere(), "seo-overrides", path.slice(1)), "utf8");
      expect(html, path).toContain(`"dateModified":"${date}"`);
      expect(html, path).toContain(`<time datetime="${date}">`);
    }
    expect(report.missingInbound).toEqual([]);
    // 失敗條件除了上面已逐頁釘住的 lastmod 之外，其餘全部照舊判斷。
    expect(sitemapLinkReportFailed({ ...report, wrongLastmod: [] })).toBe(false);
    expect(NEW_PAGE_PATHS).toHaveLength(73);
    expect(WAVE2_PAGE_PATHS).toHaveLength(5);
    expect(WAVE3_PAGE_PATHS).toHaveLength(4);
    expect(WAVE3_MERGED_PAGE_PATHS).toHaveLength(3);
    expect(WAVE3_VOICE_PAGE_PATHS).toHaveLength(7);
    expect(WAVE4_PAGE_PATHS).toHaveLength(3);
    expect(WAVE4_MERGED_PAGE_PATHS).toHaveLength(6);
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
    expect(report.inbound["/guides/casual-shoe-cleaning.html"]?.hubs).toContain("hubs/shoe-care.html");
    expect(report.inbound["/guides/suit-pants-crease.html"]?.hubs).toContain("hubs/luxury-garment-care.html");
    expect(report.inbound["/guides/crossbody-bag-strap.html"]?.hubs).toContain("hubs/bag-care.html");
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

  it("第 4 波新頁、併入段落與問答沒有禁詞，掃描不排除任何句子", () => {
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
      "這裡",
      "不寫",
      "改看",
      "仍看",
      "留在",
      "換頁",
      "這句"
    ]);
    const root = repoRootFromHere();
    const hits: string[] = [];
    const scope = [...WAVE4_PAGE_PATHS, ...WAVE4_MERGED_PAGE_PATHS];
    for (const path of WAVE4_PAGE_PATHS) {
      const html = readFileSync(join(root, "seo-overrides", path.slice(1)), "utf8");
      const found = wave4BannedHits(html);
      if (found.length > 0) hits.push(`${path}: ${found.join("、")}`);
    }
    for (const path of WAVE4_MERGED_PAGE_PATHS) {
      const html = readFileSync(join(root, "seo-overrides", path.slice(1)), "utf8");
      const blocks = [...html.matchAll(/<section\b[^>]*\bdata-merged-block="[^"]+"[^>]*>[\s\S]*?<\/section>/g)].map(
        (match) => match[0] ?? ""
      );
      if (blocks.length < 1) hits.push(`${path}: 缺少併入段落`);
      for (const block of blocks) {
        const found = wave4BannedHits(block);
        if (found.length > 0) hits.push(`${path} 併入段落: ${found.join("、")}`);
      }
    }
    const answers = JSON.parse(readFileSync(join(root, "seo-overrides", "answers.json"), "utf8")) as {
      answers: Array<{ id: string; question: string; answer: string; source_url: string }>;
    };
    const scopeUrls = scope.map((path) => `https://sixiangjialaundry.com${path}`);
    for (const entry of answers.answers) {
      const onScope = scopeUrls.some((url) => entry.source_url === url || entry.source_url.startsWith(`${url}#`));
      if (!onScope) continue;
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

describe("全站禁詞「只補」", () => {
  it("清單鎖定", () => {
    expect(SITEWIDE_BANNED_MARKERS).toEqual(["只補"]);
  });
  it("seo-overrides 每個檔都沒有，不剔除任何句子", () => {
    expect(sitewideBannedOffenders()).toEqual([]);
  });
});

describe("sitemap 網址數從 seo-overrides 內容算，不寫死", () => {
  const copyOverrides = (): string => {
    const root = mkdtempSync(join(tmpdir(), "sitemap-count-"));
    cpSync(join(repoRootFromHere(), "seo-overrides"), join(root, "seo-overrides"), { recursive: true });
    return root;
  };
  // 已知的 14 頁 lastmod 差異另有斷言；這裡排除它，確保紅燈只能來自網址數。
  const withoutKnownLastmod = (report: ReturnType<typeof checkSitemapLinks>) => ({ ...report, wrongLastmod: [] });
  const sitemapOf = (root: string): string => join(root, "seo-overrides", "sitemap.xml");

  it("目前的 sitemap 數量等於可索引覆寫頁數", () => {
    const root = repoRootFromHere();
    const report = checkSitemapLinks(root);
    expect(report.locCount).toBe(expectedLocCountFromOverrides(root));
    expect(sitemapLinkReportFailed(withoutKnownLastmod(report), root)).toBe(false);
  });

  it("sitemap 少一條就紅", () => {
    const root = copyOverrides();
    try {
      const xml = readFileSync(sitemapOf(root), "utf8");
      const entry = xml.match(/<url>[\s\S]*?<\/url>\s*/)?.[0] ?? "";
      expect(entry).not.toBe("");
      writeFileSync(sitemapOf(root), xml.replace(entry, ""));
      const report = checkSitemapLinks(root);
      expect(report.locCount).toBe(expectedLocCountFromOverrides(root) - 1);
      expect(sitemapLinkReportFailed(withoutKnownLastmod(report), root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sitemap 多一條就紅（多的是 noindex 頁，檔案存在也一樣）", () => {
    const root = copyOverrides();
    try {
      const noindexPath = NOINDEX_FOLLOW_LOCAL_PATHS[0];
      const xml = readFileSync(sitemapOf(root), "utf8");
      const extra = `<url><loc>https://sixiangjialaundry.com${noindexPath}</loc><lastmod>2026-10-01</lastmod></url>\n`;
      writeFileSync(sitemapOf(root), xml.replace("</urlset>", `${extra}</urlset>`));
      const report = checkSitemapLinks(root);
      expect(report.locCount).toBe(expectedLocCountFromOverrides(root) + 1);
      expect(sitemapLinkReportFailed(withoutKnownLastmod(report), root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("新增一頁可索引的覆寫頁但沒進 sitemap 就紅", () => {
    const root = copyOverrides();
    try {
      const source = readFileSync(join(root, "seo-overrides", "guides", "blanket-vs-duvet.html"), "utf8");
      writeFileSync(
        join(root, "seo-overrides", "guides", "copy-not-in-sitemap.html"),
        source.replace(/(<link\b[^>]*rel="canonical"[^>]*href=")[^"]*(")/, "$1https://sixiangjialaundry.com/guides/copy-not-in-sitemap.html$2")
      );
      const report = checkSitemapLinks(root);
      expect(report.locCount).toBe(expectedLocCountFromOverrides(root) - 1);
      expect(sitemapLinkReportFailed(withoutKnownLastmod(report), root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// 以下是 main 版 checkSitemapLinks.test.ts 與 seo-overrides 內容有關的斷言（B5 第 5／7／8 波頁面）。
// 路徑清單與 lastmod 取自 main 的 scripts/check-sitemap-links.ts；這裡不改腳本，所以用本檔區域常數。
describe("main 同步進來的 B5 第 7／8 波頁面（內容斷言）", () => {
  const WAVE7_PATHS = [
    "/guides/dress-shirt-starch-risk.html",
    "/guides/blanket-vs-duvet.html",
    "/guides/pet-hair-on-coat.html",
    "/guides/how-laundry-quote-works.html",
    "/services/office-shirt-subscription.html",
    "/hubs/commercial-laundry.html",
    "/guides/makeup-on-bag-lining.html",
    "/guides/leather-vest-cleaning.html"
  ];
  const WAVE8_LASTMOD = "2026-10-27";
  const WAVE8_PATHS = [
    "/guides/shoe-collar-foam-check.html",
    "/guides/shoe-lace-eyelet-check.html",
    "/guides/shoe-toe-cap-wear.html",
    "/guides/shoe-counter-lining-wear.html",
    "/guides/new-shoe-dye-ruboff.html",
    "/guides/bag-clasp-stuck-check.html",
    "/guides/wool-sweater-pilling.html",
    "/guides/leather-jacket-elbow-crease.html",
    "/guides/garment-lining-detach.html"
  ];
  const read = (rel: string): string => readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");

  it("第 7、8 波頁面都在 sitemap，且各有至少一條 hub 入鏈", () => {
    const xml = read("sitemap.xml");
    const hubDir = join(repoRootFromHere(), "seo-overrides", "hubs");
    const hubText = readdirSync(hubDir)
      .filter((name) => name.endsWith(".html"))
      .map((name) => readFileSync(join(hubDir, name), "utf8"))
      .join("\n");
    for (const path of [...WAVE7_PATHS, ...WAVE8_PATHS]) {
      expect(xml, path).toContain(`<loc>https://sixiangjialaundry.com${path}</loc>`);
      if (path === "/hubs/commercial-laundry.html") continue;
      expect(hubText.includes(`href="${path}"`) || hubText.includes(`href="https://sixiangjialaundry.com${path}"`), `${path} hub 入鏈`).toBe(true);
    }
    expect(read("hubs/commercial-laundry.html")).toContain("/hubs/luxury-garment-care.html");
  });

  it("第 8 波 9 頁：聯絡與價格資訊、日期、sitemap lastmod", () => {
    const price = read("services/taichung-laundry-price-list.html");
    for (const path of WAVE8_PATHS) {
      const html = read(path.slice(1));
      const main = html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
      expect(main, path).toContain("台中全市免費收送、沒有最低消費");
      expect(main, path).toContain("門市在台中市西屯區");
      expect(main, path).toContain("西屯門市收件");
      expect(main, path).toContain("參考價，看過實品再報價");
      expect(main, path).toContain("https://lin.ee/w8qGVqM");
      expect(main, path).toContain("@454foyks");
      expect(main, path).toContain("怎麼送洗");
      for (const amount of main.match(/[\u4e00-\u9fffA-Z0-9]+ \$\d+/g) ?? []) {
        expect(price, `${path} ${amount}`).toContain(amount);
      }
      expect(html, path).toContain(`<time datetime="${WAVE8_LASTMOD}">`);
      expect(html, path).toContain(`"dateModified":"${WAVE8_LASTMOD}"`);
      expect(read("sitemap.xml"), path).toContain(`<loc>https://sixiangjialaundry.com${path}</loc><lastmod>${WAVE8_LASTMOD}</lastmod>`);
    }
  });

  it("第 8 波 9 頁：店家 JSON-LD 帶 LINE @454foyks 與市話／手機，每處修繕都有 LINE 問句", () => {
    const ask = "能不能做、怎麼算，傳照片到 LINE @454foyks 問";
    for (const path of WAVE8_PATHS) {
      const html = read(path.slice(1));
      const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "";
      const graph = (JSON.parse(raw) as { "@graph": Array<Record<string, unknown>> })["@graph"];
      const business = graph.find((node) => node["@type"] === "DryCleaningOrLaundry");
      const blurbs = `${business?.["description"] ?? ""}\n${business?.["disambiguatingDescription"] ?? ""}`;
      for (const term of ["僅西屯", "0968", "04-2452"]) expect(blurbs.includes(term), `${path} ${term}`).toBe(false);
      expect(business?.["disambiguatingDescription"], path).toContain("門市在西屯");
      expect(business?.["disambiguatingDescription"], path).toContain("LINE @454foyks");
      expect(business?.["telephone"], path).toBe("+886-4-2452-7411");
      expect(JSON.stringify(business?.["contactPoint"]), path).toContain("+886-4-2452-7411");
      expect(JSON.stringify(business?.["contactPoint"]), path).toContain("+886-968-327-653");
      const footer = html.split("<footer")[1] ?? "";
      expect(footer, path).toContain("門市在西屯");
      expect(footer, path).toContain("04-2452-7411");
      expect(footer, path).toContain("0968-327-653");
      const repairHits: string[] = [];
      let cursor = 0;
      while (cursor < html.length) {
        const at = html.indexOf("修繕", cursor);
        if (at < 0) break;
        if (!html.slice(at, at + 80).includes(ask)) repairHits.push(`${path} @${at}`);
        cursor = at + 2;
      }
      expect(repairHits, path).toEqual([]);
      expect(html, path).not.toContain("我們會修");
    }
    const clasp = read("guides/bag-clasp-stuck-check.html");
    expect(clasp).toContain("名牌包 $1500 起");
    expect(clasp).not.toMatch(/名牌包 \$1500(?! 起)/);
  });
});
