import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE_ORIGIN = "https://sixiangjialaundry.com";
export const EXPECTED_LOC_COUNT = 119;

/** B2 波 B 11 條＋波 A 12 條，加上 B3 20 條。sitemap 應為 76＋23＋20＝119 條。 */
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
  "/local/qingshui-laundry-pickup.html"
] as const;

export const NEW_PAGE_LASTMOD = "2026-10-06";

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
};

export function repoRootFromHere(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
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
  const lastmodByPath = new Map(entries.map((entry) => [pathnameOf(entry.loc), entry.lastmod]));
  for (const path of NEW_PAGE_PATHS) {
    const hubs = hrefs.get(path) ?? [];
    inbound[path] = { count: hubs.length, hubs };
    if (hubs.length < 1) missingInbound.push(path);
    if (!lastmodByPath.has(path)) missingFromSitemap.push(path);
    else if (lastmodByPath.get(path) !== NEW_PAGE_LASTMOD) wrongLastmod.push(path);
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
    missingFromSitemap
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
    `wrong_lastmod ${JSON.stringify(report.wrongLastmod)}`,
    "inbound:"
  ];
  for (const path of NEW_PAGE_PATHS) {
    const hit = report.inbound[path];
    lines.push(`${path}\t${hit?.count ?? 0}\t${(hit?.hubs ?? []).join(",")}`);
  }
  lines.push(`missing_inbound ${JSON.stringify(report.missingInbound)}`);
  return lines.join("\n");
}

export function sitemapLinkReportFailed(report: SitemapLinkReport): boolean {
  return (
    !report.parseOk ||
    report.locCount !== EXPECTED_LOC_COUNT ||
    report.postsCount !== 0 ||
    report.missing.length > 0 ||
    report.duplicateLocs.length > 0 ||
    report.missingInbound.length > 0 ||
    report.wrongLastmod.length > 0 ||
    report.missingFromSitemap.length > 0
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
