import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE_ORIGIN = "https://sixiangjialaundry.com";

/**
 * 2026-10-07 同意：這 16 個遠區收送套版改 noindex,follow，移出 sitemap。
 * 檔案不刪、hub 入鏈保留；canonical 維持各頁 self。
 */
export const NOINDEX_FOLLOW_LOCAL_PATHS = [
  "/local/central-district-laundry-pickup.html",
  "/local/east-district-laundry-pickup.html",
  "/local/south-district-laundry-pickup.html",
  "/local/dadu-laundry-pickup.html",
  "/local/dali-laundry-pickup.html",
  "/local/daya-laundry-pickup.html",
  "/local/fengyuan-laundry-pickup.html",
  "/local/houli-laundry-pickup.html",
  "/local/qingshui-laundry-pickup.html",
  "/local/shalu-laundry-pickup.html",
  "/local/shengang-laundry-pickup.html",
  "/local/taiping-laundry-pickup.html",
  "/local/tanzi-laundry-pickup.html",
  "/local/wufeng-laundry-pickup.html",
  "/local/wuqi-laundry-pickup.html",
  "/local/wuri-laundry-pickup.html"
] as const;

/** B2 23 條＋B3 20 條＋B4-a 17 條＋B4-b 3 條＋B5 第 1 波 10 條。其中 16 條遠區收送不進 sitemap，其餘仍須在列且 lastmod 不變。 */
export const NEW_PAGE_PATHS = [
  "/local/dali-laundry-pickup.html",
  "/local/taiping-laundry-pickup.html",
  "/local/wuri-laundry-pickup.html",
  "/local/tanzi-laundry-pickup.html",
  "/local/daya-laundry-pickup.html",
  "/local/shalu-laundry-pickup.html",
  "/guides/boot-shaft-cleaning.html",
  "/guides/wallet-cleaning-check.html",
  "/guides/trench-coat-cleaning.html",
  "/guides/coin-laundry-vs-pickup.html",
  "/services/postpartum-center-laundry.html",
  "/services/uniform-laundry.html",
  "/services/wool-coat-cleaning.html",
  "/services/clinic-uniform-laundry.html",
  "/local/beitun-shoe-cleaning.html",
  "/local/nantun-shoe-cleaning.html",
  "/guides/mesh-shoe-cleaning.html",
  "/guides/leather-sneaker-care.html",
  "/guides/leather-bag-care.html",
  "/guides/silk-garment-cleaning.html",
  "/guides/cashmere-knit-care.html",
  "/guides/collar-sweat-yellow.html",
  "/guides/down-clump-after-wash.html",
  "/guides/knit-shoe-cleaning.html",
  "/guides/patent-leather-shoe-care.html",
  "/guides/nubuck-shoe-cleaning.html",
  "/guides/clear-sole-yellowing.html",
  "/guides/hiking-shoe-cleaning.html",
  "/guides/sheepskin-boot-cleaning.html",
  "/guides/coated-canvas-bag-care.html",
  "/guides/vachetta-leather-darkening.html",
  "/guides/lambskin-bag-care.html",
  "/guides/bag-edge-paint-cracking.html",
  "/guides/sticky-bag-lining.html",
  "/guides/luxury-bag-storage.html",
  "/guides/straw-bag-care.html",
  "/local/south-district-laundry-pickup.html",
  "/local/west-district-laundry-pickup.html",
  "/local/east-district-laundry-pickup.html",
  "/local/central-district-laundry-pickup.html",
  "/local/fengyuan-laundry-pickup.html",
  "/local/wufeng-laundry-pickup.html",
  "/local/qingshui-laundry-pickup.html",
  "/guides/shoe-drying-heat-risk.html",
  "/guides/dry-cleaning-explained.html",
  "/guides/clothing-dye-transfer.html",
  "/guides/velvet-shoe-cleaning.html",
  "/local/wuqi-laundry-pickup.html",
  "/local/dadu-laundry-pickup.html",
  "/local/shengang-laundry-pickup.html",
  "/local/houli-laundry-pickup.html",
  "/guides/satin-shoe-cleaning.html",
  "/guides/dress-shoe-polish-buildup.html",
  "/guides/suede-bag-care.html",
  "/guides/bag-hardware-tarnish.html",
  "/guides/light-leather-bag-yellowing.html",
  "/guides/gore-tex-jacket-cleaning.html",
  "/guides/sleeping-bag-cleaning.html",
  "/guides/linen-garment-care.html",
  "/services/evening-gown-cleaning.html",
  "/services/secondhand-luxury-shop-cleaning.html",
  "/services/sequin-rhinestone-clothing-cleaning.html",
  "/services/ironing-pressing.html",
  "/guides/spot-test-before-cleaning.html",
  "/guides/down-vest-cleaning.html",
  "/guides/scarf-cleaning.html",
  "/guides/cardigan-cleaning.html",
  "/guides/kids-shoe-cleaning.html",
  "/guides/sandal-cleaning.html",
  "/guides/high-heel-structure.html",
  "/guides/denim-jeans-cleaning.html",
  "/guides/day-dress-cleaning.html",
  "/guides/pu-leather-peeling.html"
] as const;

export const NEW_PAGE_LASTMOD = "2026-10-06";

/** B5 第 2 波 5 頁。lastmod 用上線日，不回寫第 1 波的 2026-10-06。 */
export const WAVE2_PAGE_LASTMOD = "2026-10-12";

export const WAVE2_PAGE_PATHS = [
  "/guides/golf-shoe-cleaning.html",
  "/guides/leather-pants-skirt.html",
  "/guides/pleated-skirt-care.html",
  "/guides/iron-scorch-mark.html",
  "/guides/shoe-insole-check.html"
] as const;

/** B5 第 3 波留下的 4 頁。lastmod 用這次上線日，不回寫前兩波。 */
export const WAVE3_PAGE_LASTMOD = "2026-10-14";

export const WAVE3_PAGE_PATHS = [
  "/guides/doll-shoe-cleaning.html",
  "/guides/hat-cleaning.html",
  "/guides/leather-glove-care.html",
  "/guides/leather-belt-care.html"
] as const;

/** 第 3 波併進去的既有頁。禁詞掃描要涵蓋整頁，不另計 sitemap。 */
export const WAVE3_MERGED_PAGE_PATHS = [
  "/guides/white-shoe-yellowing.html",
  "/guides/suede-bag-care.html",
  "/guides/hiking-shoe-cleaning.html"
] as const;

export const WAVE3_VOICE_PAGE_PATHS = [...WAVE3_PAGE_PATHS, ...WAVE3_MERGED_PAGE_PATHS] as const;

/** B5 第 4 波留下的 3 頁。lastmod 用這次上線日，不回寫前三波。 */
export const WAVE4_PAGE_LASTMOD = "2026-10-15";

export const WAVE4_PAGE_PATHS = [
  "/guides/casual-shoe-cleaning.html",
  "/guides/suit-pants-crease.html",
  "/guides/crossbody-bag-strap.html"
] as const;

/** 第 4 波併進既有頁。不另計 sitemap 條數；lastmod 與頁面 dateModified 改為 2026-10-15。 */
export const WAVE4_MERGED_PAGE_PATHS = [
  "/guides/dry-cleaning-explained.html",
  "/guides/carpet-cleaning.html",
  "/guides/plush-doll-cleaning.html",
  "/guides/curtain-cleaning.html",
  "/guides/bedding-duvet-cleaning.html",
  "/guides/down-jacket-cleaning.html"
] as const;

/** 修繕界線。禁詞掃描不剔除任何句子。 */
export const REPAIR_BOUNDARY_SENTENCE =
  "屬修繕，不包含在清潔內；能不能處理、是否另計，要看過實品由門市說明。";

/** 第 4 波新頁、併入段落與對應問答不得出現。掃描時不先拿掉任何句子。 */
export const WAVE4_BANNED_MARKERS = [
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
] as const;

/**
 * 第 3 波把判斷併進既有頁。這兩頁原屬第 1 波，sitemap lastmod 跟著 dateModified 改為 2026-10-14。
 * 白鞋泛黃不在 NEW_PAGE_PATHS，sitemap 直接改 lastmod。
 */
export const MERGED_PAGE_LASTMOD_OVERRIDES: Readonly<Record<string, string>> = {
  "/guides/hiking-shoe-cleaning.html": "2026-10-14",
  "/guides/suede-bag-care.html": "2026-10-14"
};

/**
 * 層 1 清文案後，風衣頁仍在 NEW_PAGE_PATHS，sitemap lastmod 跟著 dateModified 改為 2026-10-14。
 * 不改 NEW_PAGE_LASTMOD，避免把第 1 波其餘頁一起改掉。
 * 南屯、東海、皮衣發霉不在追蹤名單，sitemap 直接改 lastmod。
 */
export const LAYER1_LASTMOD_OVERRIDES: Readonly<Record<string, string>> = {
  "/guides/trench-coat-cleaning.html": "2026-10-14"
};

/** 客人看得到的寫手用語。第 2 波新頁與新問答不得出現。 */
export const WRITER_VOICE_MARKERS = ["不寫", "這裡", "重寫", "改看", "仍看", "留在", "換頁"] as const;

/** 第 3 波再加自指用語與「另看」。第 2 波頁面不回溯這些字。 */
export const WAVE3_EXTRA_WRITER_VOICE_MARKERS = ["這頁", "本頁", "這句", "一口價", "另看"] as const;

/**
 * 層 1 四頁禁詞。全站內文仍有「這裡」；「錢頁」「編價格」已在 2026-10-15 清掉。
 * 整頁零命中只鎖這四頁，不回溯其他頁的「這裡」。
 */
export const LAYER1_PHRASE_PAGE_PATHS = [
  "/local/nantun-laundry-pickup.html",
  "/local/donghai-laundry-pickup.html",
  "/guides/trench-coat-cleaning.html",
  "/guides/leather-mold-treatment.html"
] as const;

export const LAYER1_BANNED_PHRASES = ["錢頁", "這裡", "編價格"] as const;

/**
 * 2026-10-15：FAQ 問答改成單則可引用。這些追蹤頁的 sitemap lastmod
 * 跟著 dateModified 改，不回寫 NEW_PAGE_LASTMOD。
 */
export const FAQ_SELF_CONTAINED_LASTMOD = "2026-10-15";

export const FAQ_SELF_CONTAINED_PAGE_PATHS = [
  "/guides/boot-shaft-cleaning.html",
  "/guides/wallet-cleaning-check.html",
  "/guides/coin-laundry-vs-pickup.html",
  "/services/postpartum-center-laundry.html",
  "/services/uniform-laundry.html",
  "/services/wool-coat-cleaning.html",
  "/services/clinic-uniform-laundry.html",
  "/local/beitun-shoe-cleaning.html",
  "/local/nantun-shoe-cleaning.html",
  "/guides/mesh-shoe-cleaning.html",
  "/guides/leather-sneaker-care.html",
  "/guides/leather-bag-care.html",
  "/guides/silk-garment-cleaning.html",
  "/guides/cashmere-knit-care.html",
  "/guides/collar-sweat-yellow.html",
  "/guides/down-clump-after-wash.html",
  "/guides/clear-sole-yellowing.html",
  "/guides/bag-edge-paint-cracking.html",
  "/guides/sticky-bag-lining.html",
  "/local/west-district-laundry-pickup.html",
  "/guides/dress-shoe-polish-buildup.html",
  "/guides/bag-hardware-tarnish.html",
  "/guides/light-leather-bag-yellowing.html",
  "/guides/gore-tex-jacket-cleaning.html",
  "/services/evening-gown-cleaning.html",
  "/services/secondhand-luxury-shop-cleaning.html",
  "/services/sequin-rhinestone-clothing-cleaning.html",
  "/guides/scarf-cleaning.html",
  "/guides/cardigan-cleaning.html",
  "/guides/kids-shoe-cleaning.html",
  "/guides/high-heel-structure.html",
  "/guides/denim-jeans-cleaning.html",
  "/guides/day-dress-cleaning.html",
  "/guides/pu-leather-peeling.html"
] as const;

/** FAQ JSON-LD 的問題與答案被單獨引用時，不能靠「本頁／這頁」才讀得懂。 */
export const FAQ_JSONLD_PAGE_REFERENCE_MARKERS = ["本頁", "這頁"] as const;

export function writerVoiceHits(text: string): string[] {
  return WRITER_VOICE_MARKERS.filter((marker) => text.includes(marker));
}

export function layer1BannedPhraseHits(text: string): string[] {
  return LAYER1_BANNED_PHRASES.filter((phrase) => text.includes(phrase));
}

export function faqJsonLdPageReferenceHits(text: string): string[] {
  return FAQ_JSONLD_PAGE_REFERENCE_MARKERS.filter((marker) => text.includes(marker));
}

function collectFaqQuestions(node: unknown, out: Array<{ name: string; text: string }>): void {
  if (Array.isArray(node)) {
    node.forEach((item) => collectFaqQuestions(item, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("FAQPage") && Array.isArray(record.mainEntity)) {
    for (const entity of record.mainEntity) {
      if (!entity || typeof entity !== "object") continue;
      const question = entity as Record<string, unknown>;
      const answer = question.acceptedAnswer;
      const text =
        answer && typeof answer === "object" && typeof (answer as { text?: unknown }).text === "string"
          ? (answer as { text: string }).text
          : "";
      out.push({ name: typeof question.name === "string" ? question.name : "", text });
    }
  }
  for (const value of Object.values(record)) collectFaqQuestions(value, out);
}

export function faqJsonLdPageReferenceOffenders(root = repoRootFromHere()): string[] {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      const html = readFileSync(full, "utf8");
      for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(match[1] ?? "");
        } catch {
          offenders.push(`${full}: JSON-LD 無法解析`);
          continue;
        }
        const questions: Array<{ name: string; text: string }> = [];
        collectFaqQuestions(parsed, questions);
        for (const question of questions) {
          const found = faqJsonLdPageReferenceHits(`${question.name}\n${question.text}`);
          if (found.length > 0) {
            const rel = full.slice(root.length).split("\\").join("/");
            offenders.push(`${rel}: ${found.join("、")}｜${question.name}`);
          }
        }
      }
    }
  };
  walk(join(root, "seo-overrides"));
  return offenders;
}

export function wave3WriterVoiceHits(text: string): string[] {
  return [...WRITER_VOICE_MARKERS, ...WAVE3_EXTRA_WRITER_VOICE_MARKERS].filter((marker) => text.includes(marker));
}

export function wave4BannedHits(text: string): string[] {
  return WAVE4_BANNED_MARKERS.filter((marker) => text.includes(marker));
}

export type SitemapLinkReport = {
  parseOk: boolean;
  locCount: number;
  postsCount: number;
  missing: string[];
  duplicateLocs: string[];
  inbound: Record<string, { count: number; hubs: string[] }>;
  missingInbound: string[];
  wrongLastmod: string[];
  missingFromSitemap: string[];
  unexpectedInSitemap: string[];
};

export function repoRootFromHere(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * 預期的 sitemap 網址數，從 seo-overrides 內容算出，不寫死：
 * 每個 .html 若不是 noindex、且 canonical（沒寫就當自己）指向自己的網址，就必須在 sitemap。
 * 目錄首頁（foo/index.html）的網址是 foo/；canonical 指向 foo/ 視為自己。
 */
export function expectedLocCountFromOverrides(root = repoRootFromHere()): number {
  const base = join(root, "seo-overrides");
  const robotsNoindex = (html: string): boolean =>
    (html.match(/<meta\b[^>]*>/gi) ?? []).some(
      (tag) => /\bname\s*=\s*["'](?:robots|googlebot)["']/i.test(tag) && /noindex/i.test(tag)
    );
  const canonicalOf = (html: string): string | undefined =>
    (html.match(/<link\b[^>]*>/gi) ?? [])
      .filter((tag) => /\brel\s*=\s*["']canonical["']/i.test(tag))
      .map((tag) => tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1])
      .filter((href): href is string => Boolean(href))
      .at(-1);
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      const rel = full.slice(base.length + 1).split("\\").join("/");
      const selfUrl =
        rel === "index.html"
          ? `${SITE_ORIGIN}/`
          : rel.endsWith("/index.html")
            ? `${SITE_ORIGIN}/${rel.slice(0, -"index.html".length)}`
            : `${SITE_ORIGIN}/${rel}`;
      const html = readFileSync(full, "utf8");
      if (robotsNoindex(html)) continue;
      const canonical = canonicalOf(html);
      if (canonical && new URL(canonical, selfUrl).href !== selfUrl) continue;
      count += 1;
    }
  };
  walk(base);
  return count;
}

function pathnameOf(loc: string): string {
  const url = new URL(loc);
  return url.pathname;
}

function fileCandidates(root: string, pathname: string): string[] {
  const rel = pathname === "/" ? "index.html" : pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
  return [join(root, "seo-overrides", rel), join(root, "docs", rel), join(root, rel)];
}

function parseSitemap(xml: string): Array<{ loc: string; lastmod: string }> {
  if (!xml.includes("<urlset") || !xml.includes("</urlset>")) {
    throw new Error("sitemap 不是 urlset");
  }
  const open = xml.match(/<url>/g)?.length ?? 0;
  const close = xml.match(/<\/url>/g)?.length ?? 0;
  if (open !== close) {
    throw new Error(`<url> 標籤不平衡：${open} / ${close}`);
  }
  const entries = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<\/url>/g)].map(
    (match) => ({ loc: match[1] ?? "", lastmod: match[2] ?? "" })
  );
  if (entries.length !== open) {
    throw new Error(`可解析的 <url> 為 ${entries.length}，<url> 標籤為 ${open}`);
  }
  return entries;
}

function hubHrefs(root: string): Map<string, string[]> {
  const hubDir = join(root, "seo-overrides", "hubs");
  const byPath = new Map<string, string[]>();
  for (const name of readdirSync(hubDir)) {
    if (!name.endsWith(".html")) continue;
    const html = readFileSync(join(hubDir, name), "utf8");
    const hub = `hubs/${name}`;
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1] ?? "";
      let pathname = "";
      if (href.startsWith(SITE_ORIGIN)) {
        pathname = new URL(href).pathname;
      } else if (href.startsWith("/")) {
        pathname = href.split(/[?#]/)[0] ?? "";
      }
      if (!pathname) continue;
      const hubs = byPath.get(pathname) ?? [];
      hubs.push(hub);
      byPath.set(pathname, hubs);
    }
  }
  return byPath;
}

export function checkSitemapLinks(root = repoRootFromHere()): SitemapLinkReport {
  const xml = readFileSync(join(root, "seo-overrides", "sitemap.xml"), "utf8");
  const entries = parseSitemap(xml);
  const locs = entries.map((entry) => entry.loc);
  const seen = new Set<string>();
  const duplicateLocs: string[] = [];
  for (const loc of locs) {
    if (seen.has(loc)) duplicateLocs.push(loc);
    seen.add(loc);
  }
  const missing: string[] = [];
  for (const loc of locs) {
    const pathname = pathnameOf(loc);
    if (!fileCandidates(root, pathname).some((file) => existsSync(file))) {
      missing.push(pathname);
    }
  }
  const hrefs = hubHrefs(root);
  const inbound: SitemapLinkReport["inbound"] = {};
  const missingInbound: string[] = [];
  const wrongLastmod: string[] = [];
  const missingFromSitemap: string[] = [];
  const unexpectedInSitemap: string[] = [];
  const noindexFollow = new Set<string>(NOINDEX_FOLLOW_LOCAL_PATHS);
  const lastmodByPath = new Map(entries.map((entry) => [pathnameOf(entry.loc), entry.lastmod]));
  const faqSelfContainedLastmod = new Set<string>(FAQ_SELF_CONTAINED_PAGE_PATHS);
  const wave4MergedLastmod = new Set<string>(WAVE4_MERGED_PAGE_PATHS);
  const tracked = [
    ...NEW_PAGE_PATHS.map((path) => ({
      path,
      lastmod: wave4MergedLastmod.has(path)
        ? WAVE4_PAGE_LASTMOD
        : faqSelfContainedLastmod.has(path)
          ? FAQ_SELF_CONTAINED_LASTMOD
          : LAYER1_LASTMOD_OVERRIDES[path] ?? MERGED_PAGE_LASTMOD_OVERRIDES[path] ?? NEW_PAGE_LASTMOD
    })),
    ...WAVE2_PAGE_PATHS.map((path) => ({ path, lastmod: WAVE2_PAGE_LASTMOD })),
    ...WAVE3_PAGE_PATHS.map((path) => ({ path, lastmod: WAVE3_PAGE_LASTMOD })),
    ...WAVE4_PAGE_PATHS.map((path) => ({ path, lastmod: WAVE4_PAGE_LASTMOD }))
  ];
  for (const { path, lastmod } of tracked) {
    const hubs = hrefs.get(path) ?? [];
    inbound[path] = { count: hubs.length, hubs };
    if (hubs.length < 1) missingInbound.push(path);
    if (noindexFollow.has(path)) {
      if (lastmodByPath.has(path)) unexpectedInSitemap.push(path);
      continue;
    }
    if (!lastmodByPath.has(path)) missingFromSitemap.push(path);
    else if (lastmodByPath.get(path) !== lastmod) wrongLastmod.push(path);
  }
  const trackedPathSet = new Set<string>(tracked.map((item) => item.path));
  for (const path of WAVE4_MERGED_PAGE_PATHS) {
    if (trackedPathSet.has(path)) continue;
    if (!lastmodByPath.has(path)) missingFromSitemap.push(path);
    else if (lastmodByPath.get(path) !== WAVE4_PAGE_LASTMOD) wrongLastmod.push(path);
  }
  return {
    parseOk: true,
    locCount: locs.length,
    postsCount: locs.filter((loc) => pathnameOf(loc).includes("/posts/")).length,
    missing,
    duplicateLocs,
    inbound,
    missingInbound,
    wrongLastmod,
    missingFromSitemap,
    unexpectedInSitemap
  };
}

export function formatSitemapLinkReport(report: SitemapLinkReport): string {
  const lines = [
    `parse_ok ${report.parseOk}`,
    `loc_count ${report.locCount}`,
    `posts_count ${report.postsCount}`,
    `missing ${JSON.stringify(report.missing)}`,
    `duplicate_locs ${JSON.stringify(report.duplicateLocs)}`,
    `missing_from_sitemap ${JSON.stringify(report.missingFromSitemap)}`,
    `unexpected_in_sitemap ${JSON.stringify(report.unexpectedInSitemap)}`,
    `wrong_lastmod ${JSON.stringify(report.wrongLastmod)}`,
    "inbound:"
  ];
  for (const path of [...NEW_PAGE_PATHS, ...WAVE2_PAGE_PATHS, ...WAVE3_PAGE_PATHS, ...WAVE4_PAGE_PATHS]) {
    const hit = report.inbound[path];
    lines.push(`${path}\t${hit?.count ?? 0}\t${(hit?.hubs ?? []).join(",")}`);
  }
  lines.push(`missing_inbound ${JSON.stringify(report.missingInbound)}`);
  return lines.join("\n");
}

export function sitemapLinkReportFailed(report: SitemapLinkReport, root = repoRootFromHere()): boolean {
  return (
    !report.parseOk ||
    report.locCount !== expectedLocCountFromOverrides(root) ||
    report.postsCount !== 0 ||
    report.missing.length > 0 ||
    report.duplicateLocs.length > 0 ||
    report.missingInbound.length > 0 ||
    report.wrongLastmod.length > 0 ||
    report.missingFromSitemap.length > 0 ||
    report.unexpectedInSitemap.length > 0
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    const report = checkSitemapLinks();
    console.log(formatSitemapLinkReport(report));
    if (sitemapLinkReportFailed(report)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

/** 全站禁詞：seo-overrides 每個檔都掃，不剔除任何句子。2026-10-15 行銷審 #186 加「只補」。 */
export const SITEWIDE_BANNED_MARKERS = ["只補"] as const;

export function sitewideBannedOffenders(root = repoRootFromHere()): string[] {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const text = readFileSync(full, "utf8");
      const found = SITEWIDE_BANNED_MARKERS.filter((marker) => text.includes(marker));
      if (found.length > 0) offenders.push(`${full.slice(root.length).split("\\").join("/")}: ${found.join("、")}`);
    }
  };
  walk(join(root, "seo-overrides"));
  return offenders;
}
