import { describe, expect, it } from "vitest";
import {
  EXPECTED_LOC_COUNT,
  NEW_PAGE_PATHS,
  checkSitemapLinks,
  sitemapLinkReportFailed
} from "../scripts/check-sitemap-links";

describe("seo-overrides B4 sitemap 與 hub 入鏈", () => {
  it("每個 sitemap URL 都有檔，B2＋B3＋B4-a＋B4-b 共 63 個新頁各有至少一條 hub 入鏈", () => {
    const report = checkSitemapLinks();

    expect(report.parseOk).toBe(true);
    expect(report.locCount).toBe(EXPECTED_LOC_COUNT);
    expect(report.postsCount).toBe(0);
    expect(report.missing).toEqual([]);
    expect(report.duplicateLocs).toEqual([]);
    expect(report.missingFromSitemap).toEqual([]);
    expect(report.wrongLastmod).toEqual([]);
    expect(report.missingInbound).toEqual([]);
    expect(sitemapLinkReportFailed(report)).toBe(false);
    expect(NEW_PAGE_PATHS).toHaveLength(63);
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
  });
});
