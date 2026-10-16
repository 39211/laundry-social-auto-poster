import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_LOC_COUNT,
  NEW_PAGE_PATHS,
  NOINDEX_FOLLOW_LOCAL_PATHS,
  checkSitemapLinks,
  repoRootFromHere,
  sitemapLinkReportFailed
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
