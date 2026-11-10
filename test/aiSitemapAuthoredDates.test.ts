import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncAiSitemapAuthoredDates } from "../src/aiSitemapAuthoredDates";
import { generatePublicSite } from "../src/generatePublicSite";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("AI sitemap authored dates", () => {
  it.each([
    ["https://example.com/", false],
    ["https://example.com/project/", false],
    ["https://example.com/project/", true]
  ] as const)("normalizes dates only for matching authored pages (%s, selective=%s)", async (base, selective) => {
    const root = await mkdtemp(join(tmpdir(), "ai-authored-dates-"));
    roots.push(root);
    await mkdir(join(root, "data"), { recursive: true });
    await cp(join(process.cwd(), "data/business-profile.json"), join(root, "data/business-profile.json"));
    await mkdir(join(root, "seo-overrides/guides"), { recursive: true });
    await mkdir(join(root, "docs/guides"), { recursive: true });
    const html = '<html><head><script type="application/ld+json">{"dateModified":"2026-07-21"}</script></head><body>Authored</body></html>';
    await writeFile(join(root, "seo-overrides/guides/authored.html"), html);
    await writeFile(join(root, "seo-overrides/index.html"), html);
    const entry = (url: string) => `  <url><loc>${url}</loc><lastmod>2025-01-01</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`;
    const urls = [base, `${base}guides/authored.html`, `${base}guides/missing.html`, `https://foreign.example/${base.includes("/project/") ? "project/" : ""}guides/authored.html`, "https://example.com/project-other/guides/authored.html"];
    if (base.includes("/project/")) urls.push("https://example.com/guides/authored.html");
    const source = `<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(entry).join("\n")}\n</urlset>\n`;
    await writeFile(join(root, "seo-overrides/ai-sitemap.xml"), source);
    const sentinel = "<urlset>\n<url><loc>https://example.com/posts/old.html</loc></url>\n<url><loc>https://example.com/price-list.html</loc></url>\n</urlset>";
    await writeFile(join(root, "docs/sitemap.xml"), sentinel);
    await writeFile(join(root, "docs/guides/authored.html"), "unselected authored page must not be overwritten");
    await generatePublicSite({ root, siteBaseUrl: base, imageBaseUrl: base, now: "2026-07-22T00:00:00.000Z", ...(selective ? { onlyDocsPaths: ["ai-sitemap.xml"] } : {}) });
    // Exact bytes protect membership, ordering, and every piece of XML metadata.
    const expected = source.replace(entry(urls[0]!), entry(urls[0]!).replace("2025-01-01", "2026-07-21"))
      .replace(entry(urls[1]!), entry(urls[1]!).replace("2025-01-01", "2026-07-21"));
    expect(await readFile(join(root, "docs/ai-sitemap.xml"), "utf8")).toBe(expected);
    expect(await readFile(join(root, "seo-overrides/ai-sitemap.xml"), "utf8")).toBe(source);
    if (selective) {
      expect(await readFile(join(root, "docs/sitemap.xml"), "utf8")).toBe(sentinel);
      expect(await readFile(join(root, "docs/guides/authored.html"), "utf8")).toBe("unselected authored page must not be overwritten");
    }
  });

  it.each(["https://example.com/project", "https://example.com/project/"])("maps either project root spelling with base %s", (base) => {
    const entry = (url: string) => `<url><loc>${url}</loc><lastmod>2025-01-01</lastmod><priority>0.7</priority></url>`;
    const roots = ["https://example.com/project", "https://example.com/project/"];
    const negatives = [
      "https://example.com/project-other",
      "https://example.com/project-other/",
      "https://foreign.example/project",
      "https://example.com/project?preview=1",
      "https://example.com/project/#section",
      "https://example.com/"
    ];
    const missingLastmod = "<url><loc>https://example.com/project</loc><priority>0.8</priority></url>";
    const source = roots.concat(negatives).map(entry).join("\n") + missingLastmod;
    const expected = roots.map((url) => entry(url).replace("2025-01-01", "2026-07-21"))
      .concat(negatives.map(entry)).join("\n") + missingLastmod;
    expect(syncAiSitemapAuthoredDates(source, base, new Map([["index.html", "2026-07-21"]]))).toBe(expected);
  });

});
