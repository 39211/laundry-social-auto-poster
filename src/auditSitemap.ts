import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

const REQUIRED_PATHS = [
  "/",
  "/services/taichung-citywide-laundry-pickup.html",
  "/services/shoe-bag-care.html",
  "/local/qinghai-road-shoe-cleaning.html"
];

export interface SitemapAuditResult {
  generated_at: string;
  status: "pass" | "fail";
  sitemap_url: string;
  discovered_urls: number;
  checks: Array<{ name: string; status: "pass" | "fail"; detail: string }>;
}

function sitemapLastmodDates(xml: string): string[] {
  return [...xml.matchAll(/<lastmod>\s*(\d{4}-\d{2}-\d{2})[^<]*<\/lastmod>/g)]
    .map((match) => match[1])
    .filter((date): date is string => Boolean(date));
}

function futureLastmodDates(xml: string, today: string): string[] {
  return Array.from(new Set(sitemapLastmodDates(xml).filter((date) => date > today))).sort();
}

export async function auditSitemap(options: {
  root?: string;
  baseUrl?: string;
  live?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<SitemapAuditResult> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const now = options.now ?? new Date();
  const today = getZonedDateParts(now, config.timezone).date;
  const baseUrl = (options.baseUrl ?? config.publicSiteBaseUrl).replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) throw new Error("A public HTTPS base URL is required for Sitemap audit.");
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const localXml = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
  const robots = await readFile(join(root, "docs", "robots.txt"), "utf8");
  const locs = [...localXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((url): url is string => Boolean(url));
  const lastmodDates = sitemapLastmodDates(localXml);
  const futureLastmods = futureLastmodDates(localXml, today);
  const checks: SitemapAuditResult["checks"] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, status: ok ? "pass" : "fail", detail });
  };

  add("xml-root", localXml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), "Valid Sitemap urlset namespace.");
  add("non-empty", locs.length > 0, `${locs.length} local URLs discovered.`);
  add("no-duplicates", new Set(locs).size === locs.length, `${locs.length - new Set(locs).size} duplicate URLs.`);
  add("same-origin", locs.every((url) => url === `${baseUrl}/` || url.startsWith(`${baseUrl}/`)), "All URLs use the configured canonical origin.");
  add(
    "no-future-lastmod",
    futureLastmods.length === 0,
    futureLastmods.length > 0
      ? `Future lastmod values after ${today}: ${futureLastmods.join(", ")}.`
      : `${lastmodDates.length} lastmod values are on or before ${today}.`
  );
  for (const path of REQUIRED_PATHS) {
    const expected = path === "/" ? `${baseUrl}/` : `${baseUrl}${path}`;
    add(`required:${path}`, locs.includes(expected), expected);
  }
  add("robots-reference", robots.includes(`Sitemap: ${sitemapUrl}`), `robots.txt references ${sitemapUrl}.`);

  if (options.live) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(sitemapUrl, { method: "GET", redirect: "follow" });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    add("live-sitemap-http", response.ok, `HTTP ${response.status}`);
    add("live-sitemap-content-type", /(?:application|text)\/xml/i.test(contentType), contentType || "missing content-type");
    add("live-sitemap-body", body.includes("<urlset") && body.includes(`${baseUrl}/`), `${body.length} bytes`);
    const liveFutureLastmods = futureLastmodDates(body, today);
    add(
      "live-no-future-lastmod",
      liveFutureLastmods.length === 0,
      liveFutureLastmods.length > 0
        ? `Live sitemap future lastmod values after ${today}: ${liveFutureLastmods.join(", ")}.`
        : `Live sitemap has no lastmod values after ${today}.`
    );

    for (const path of REQUIRED_PATHS) {
      const url = path === "/" ? `${baseUrl}/` : `${baseUrl}${path}`;
      const pageResponse = await fetchImpl(url, { method: "GET", redirect: "follow" });
      const pageBody = await pageResponse.text();
      add(
        `live-page:${path}`,
        pageResponse.ok && !/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(pageBody),
        `HTTP ${pageResponse.status}; indexable=${!pageBody.includes("noindex")}`
      );
    }
  }

  const result: SitemapAuditResult = {
    generated_at: now.toISOString(),
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    sitemap_url: sitemapUrl,
    discovered_urls: locs.length,
    checks
  };
  await writeJsonAtomic(join(root, "output", "operations", "sitemap-health.json"), result);
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = await auditSitemap({
    root: getOption(args, "root"),
    baseUrl: getOption(args, "base-url"),
    live: getFlag(args, "live")
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "fail") process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
