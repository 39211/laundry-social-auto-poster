import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertLocalSitemapHasNoFutureLastmod, auditSitemap } from "../src/auditSitemap";

const BASE_URL = "https://example.com";
const REQUIRED_PATHS = [
  "/",
  "/services/taichung-citywide-laundry-pickup.html",
  "/services/shoe-bag-care.html",
  "/local/qinghai-road-shoe-cleaning.html"
];

async function writeAuditFixture(root: string, lastmods: string[] = []): Promise<void> {
  const docsRoot = join(root, "docs");
  await mkdir(docsRoot, { recursive: true });
  const entries = REQUIRED_PATHS.map((path, index) => {
    const url = path === "/" ? `${BASE_URL}/` : `${BASE_URL}${path}`;
    const lastmod = lastmods[index] ?? lastmods.at(-1);
    return `  <url><loc>${url}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  }).join("\n");
  await Promise.all([
    writeFile(
      join(docsRoot, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
      "utf8"
    ),
    writeFile(join(docsRoot, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`, "utf8")
  ]);
}

describe("auditSitemap", () => {
  it("fails when a sitemap lastmod is after today in the configured timezone", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-sitemap-future-lastmod-"));
    // Still 2026-08-29 in UTC, but already 2026-08-30 in Asia/Taipei.
    const now = new Date("2026-08-29T16:30:00.000Z");
    await writeAuditFixture(root, ["2026-08-31", "2026-08-30", "2026-08-29"]);

    const result = await auditSitemap({ root, baseUrl: BASE_URL, now });
    const check = result.checks.find((item) => item.name === "no-future-lastmod");

    expect(result.status).toBe("fail");
    expect(result.generated_at).toBe(now.toISOString());
    expect(check).toMatchObject({ status: "fail" });
    expect(check?.detail).toContain("2026-08-31");
  });

  it("passes the lastmod check for today, past dates, and no lastmod", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-sitemap-current-lastmod-"));
    const now = new Date("2026-08-29T16:30:00.000Z");
    await writeAuditFixture(root, ["2026-08-30", "2026-08-29", "2026-01-01"]);

    const datedResult = await auditSitemap({ root, baseUrl: BASE_URL, now });
    expect(datedResult.status).toBe("pass");
    expect(datedResult.checks.find((item) => item.name === "no-future-lastmod")).toMatchObject({ status: "pass" });

    await writeAuditFixture(root);
    const undatedResult = await auditSitemap({ root, baseUrl: BASE_URL, now });
    expect(undatedResult.status).toBe("pass");
    expect(undatedResult.checks.find((item) => item.name === "no-future-lastmod")).toMatchObject({
      status: "pass",
      detail: "0 lastmod values are on or before 2026-08-30."
    });
  });

  it("fails when the local sitemap is current but the live sitemap still has a future lastmod", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-sitemap-live-future-lastmod-"));
    const now = new Date("2026-08-29T16:30:00.000Z");
    await writeAuditFixture(root, ["2026-08-30", "2026-08-29"]);
    const liveEntries = REQUIRED_PATHS.map((path, index) => {
      const url = path === "/" ? `${BASE_URL}/` : `${BASE_URL}${path}`;
      const lastmod = index === 0 ? "2026-08-31" : "2026-08-30";
      return `  <url><loc>${url}</loc><lastmod>${lastmod}</lastmod></url>`;
    }).join("\n");
    const liveXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${liveEntries}\n</urlset>\n`;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/sitemap.xml")) {
        return new Response(liveXml, { status: 200, headers: { "content-type": "application/xml" } });
      }
      return new Response("<!doctype html><title>indexable</title>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }) as unknown as typeof fetch;

    const result = await auditSitemap({ root, baseUrl: BASE_URL, now, live: true, fetchImpl });

    expect(result.checks.find((item) => item.name === "no-future-lastmod")).toMatchObject({ status: "pass" });
    expect(result.checks.find((item) => item.name === "live-no-future-lastmod")).toMatchObject({ status: "fail" });
    expect(result.checks.find((item) => item.name === "live-no-future-lastmod")?.detail).toContain("2026-08-31");
    expect(result.status).toBe("fail");
  });

  it("throws a sync publish gate on a future lastmod without writing sitemap-health.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-sitemap-assert-future-"));
    const now = new Date("2026-08-29T16:30:00.000Z");
    await writeAuditFixture(root, ["2026-08-31"]);

    expect(() => assertLocalSitemapHasNoFutureLastmod(root, now)).toThrow(/2026-08-31/);
    expect(existsSync(join(root, "output", "operations", "sitemap-health.json"))).toBe(false);
  });

  it("lets Taipei today through the sync lastmod gate and rejects Taipei tomorrow", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-sitemap-assert-today-"));
    // Still 2026-08-29 in UTC, already 2026-08-30 in Asia/Taipei.
    const now = new Date("2026-08-29T16:30:00.000Z");
    await writeAuditFixture(root, ["2026-08-30", "2026-08-29"]);

    expect(() => assertLocalSitemapHasNoFutureLastmod(root, now)).not.toThrow();

    await writeAuditFixture(root, ["2026-08-31"]);
    expect(() => assertLocalSitemapHasNoFutureLastmod(root, now)).toThrow(/after 2026-08-30/);
  });

  it("throws on a missing or empty local sitemap without writing sitemap-health.json", () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-sitemap-assert-missing-"));
    mkdirSync(join(root, "docs"), { recursive: true });

    expect(() => assertLocalSitemapHasNoFutureLastmod(root)).toThrow(/docs\/sitemap\.xml is missing/);
    expect(existsSync(join(root, "output", "operations", "sitemap-health.json"))).toBe(false);

    writeFileSync(join(root, "docs", "sitemap.xml"), "  \n");
    expect(() => assertLocalSitemapHasNoFutureLastmod(root)).toThrow(/docs\/sitemap\.xml is empty/);
    expect(existsSync(join(root, "output", "operations", "sitemap-health.json"))).toBe(false);
  });
});
