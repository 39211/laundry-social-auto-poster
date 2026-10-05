import { describe, expect, it } from "vitest";
import {
  EXPECTED_LOC_COUNT,
  NEW_PAGE_PATHS,
  checkSitemapLinks,
  sitemapLinkReportFailed
} from "../scripts/check-sitemap-links";

describe("seo-overrides sitemap 與 hub 入鏈", () => {
  it("每個 sitemap URL 都有檔，23 個新頁各有至少一條 hub 入鏈", () => {
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
    expect(NEW_PAGE_PATHS).toHaveLength(23);
    for (const path of NEW_PAGE_PATHS) {
      expect(report.inbound[path]?.count).toBeGreaterThanOrEqual(1);
    }
    expect(report.inbound["/guides/down-clump-after-wash.html"]?.count).toBeGreaterThanOrEqual(1);
    expect(report.inbound["/guides/leather-bag-care.html"]?.count).toBeGreaterThanOrEqual(1);
  });
});
