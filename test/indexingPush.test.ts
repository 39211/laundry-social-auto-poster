import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseIndexNowSubmission, indexingPush, parseSitemapEntries, pickSubmissionSet } from "../src/indexingPush";

describe("IndexNow submission selection", () => {
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.com/</loc><lastmod>2026-08-31</lastmod></url>
    <url><loc>https://example.com/services/shoe-bag-care.html</loc><lastmod>2026-09-01</lastmod></url>
    <url><loc>https://example.com/guides/older.html</loc><lastmod>2026-08-23</lastmod></url>
  </urlset>`;

  it("submits only URLs whose sitemap lastmod changed on the run date", () => {
    const entries = parseSitemapEntries(sitemap);

    expect(pickSubmissionSet(entries, "2026-09-01")).toEqual([
      "https://example.com/services/shoe-bag-care.html"
    ]);
  });

  it("normalizes whitespace and datetime lastmod values", () => {
    const entries = parseSitemapEntries(`<?xml version="1.0"?><urlset>
      <url><loc> https://example.com/changed </loc><lastmod> 2026-09-01T09:10:00+08:00 </lastmod></url>
    </urlset>`);

    expect(pickSubmissionSet(entries, "2026-09-01")).toEqual(["https://example.com/changed"]);
  });

  it("submits nothing when the sitemap has no URL changed today", () => {
    const entries = parseSitemapEntries(sitemap);

    expect(pickSubmissionSet(entries, "2026-09-02")).toEqual([]);
  });

  it("does not submit a second time when the semantic sitemap was already accepted", () => {
    const entries = parseSitemapEntries(sitemap);

    expect(
      chooseIndexNowSubmission({
        entries,
        date: "2026-09-01",
        sitemapSemanticSha256: "same-sitemap",
        priorSitemapSemanticSha256: "same-sitemap"
      })
    ).toEqual({ urls: [], reason: "sitemap_unchanged_since_last_successful_submission" });
  });

  it("persists an accepted sitemap fingerprint so a same-day second run does not POST", async () => {
    const root = await mkdtemp(join(tmpdir(), "indexing-push-"));
    const baseUrl = "https://example.test";
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "0123456789abcdef0123456789abcdef.txt"), "test-key", "utf8");
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${baseUrl}/sitemap.xml`) return new Response(sitemap, { status: 200 });
      if (url === "https://api.indexnow.org/indexnow") return new Response(null, { status: 200 });
      return new Response("<html><a href=\"/\">home</a> useful content</html>", { status: 200 });
    });
    const fetchImpl = fetchSpy as unknown as typeof fetch;

    try {
      const first = await indexingPush({ root, notifyDate: "2026-09-01", baseUrl, fetchImpl });
      const second = await indexingPush({ root, notifyDate: "2026-09-01", baseUrl, fetchImpl });
      const indexNowPosts = fetchSpy.mock.calls.filter(
        ([input]) => String(input) === "https://api.indexnow.org/indexnow"
      );

      expect(first.submitted).toBe(1);
      expect(second).toMatchObject({ submitted: 0, submission_reason: "sitemap_unchanged_since_last_successful_submission" });
      expect(indexNowPosts).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // The pipeline builds content three days ahead and passes that day as --date.
  // A sitemap lastmod is never a future date, so tying the notification set to
  // --date emptied it on every scheduled run and IndexNow went silent after
  // 2026-09-03 without anything failing.
  it("notifies for the real day even when the content date is the D+3 build day", async () => {
    const root = await mkdtemp(join(tmpdir(), "indexing-push-ahead-"));
    const baseUrl = "https://example.test";
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "0123456789abcdef0123456789abcdef.txt"), "test-key", "utf8");
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${baseUrl}/sitemap.xml`) return new Response(sitemap, { status: 200 });
      if (url === "https://api.indexnow.org/indexnow") return new Response(null, { status: 200 });
      return new Response("<html><a href=\"/\">home</a> useful content</html>", { status: 200 });
    });
    const fetchImpl = fetchSpy as unknown as typeof fetch;

    try {
      const report = await indexingPush({
        root,
        date: "2026-09-04",
        notifyDate: "2026-09-01",
        baseUrl,
        fetchImpl
      });

      expect(report).toMatchObject({
        date: "2026-09-04",
        notify_date: "2026-09-01",
        submitted: 1,
        submission_reason: "sitemap_urls_changed_today"
      });
      expect(
        fetchSpy.mock.calls.filter(([input]) => String(input) === "https://api.indexnow.org/indexnow")
      ).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // The regression guard for the default: the scheduled command only passes
  // --date, so notifyDate has to fall back to the real zoned today. Falling
  // back to the content date instead is what silenced IndexNow.
  it("defaults the notification day to the real today, not to the content date", async () => {
    const root = await mkdtemp(join(tmpdir(), "indexing-push-today-"));
    const baseUrl = "https://example.test";
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "0123456789abcdef0123456789abcdef.txt"), "test-key", "utf8");
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${baseUrl}/sitemap.xml`) return new Response(sitemap, { status: 200 });
      if (url === "https://api.indexnow.org/indexnow") return new Response(null, { status: 200 });
      return new Response("<html><a href=\"/\">home</a> useful content</html>", { status: 200 });
    });
    const fetchImpl = fetchSpy as unknown as typeof fetch;

    // 2026-09-01 13:00 in Asia/Taipei, the day the fixture sitemap changed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T05:00:00Z"));
    try {
      const report = await indexingPush({ root, date: "2026-09-04", baseUrl, fetchImpl });

      expect(report).toMatchObject({
        date: "2026-09-04",
        notify_date: "2026-09-01",
        submitted: 1,
        submission_reason: "sitemap_urls_changed_today"
      });
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });
});
