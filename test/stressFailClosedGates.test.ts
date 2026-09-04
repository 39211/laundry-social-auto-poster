import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalSitemapHasNoFutureLastmod } from "../src/auditSitemap";
import { getConfig } from "../src/config";
import { listMissingCalendarImages, validatePublishableImages } from "../src/generateImage";
import {
  INDEX_GROWTH_CATALOG,
  citationAnswerLength,
  hubGroupFor,
  resolveAcceptedIndexGrowthPages,
  validateIndexGrowthPages,
  type IndexGrowthPageDefinition
} from "../src/indexGrowthPages";
import {
  MAX_REFERENCED_PUBLIC_ASSETS,
  assertMirroredReferencedAssets,
  collectReferencedPublicAssetPaths,
  isAllowlistedAssetFile,
  publishPagesAssets
} from "../src/publishPages";
import { getZonedDateParts } from "../src/scheduler";

const TODAY = "2026-09-03";

function catalogPage(slug: string): IndexGrowthPageDefinition {
  const page = INDEX_GROWTH_CATALOG.find((item) => item.slug === slug);
  if (!page) throw new Error(`missing catalog page ${slug}`);
  return structuredClone(page);
}

function uniqueClone(
  base: IndexGrowthPageDefinition,
  overrides: Partial<IndexGrowthPageDefinition>
): IndexGrowthPageDefinition {
  const slug = overrides.slug ?? `${base.slug}-clone`;
  return {
    ...structuredClone(base),
    path: `guides/${slug}.html`,
    title: `${slug} 標題`,
    h1: `${slug} 主標`,
    citation_answer: `${slug} 獨立答案不要濕擦。`,
    summary: `${slug} 獨立答案不要濕擦。`,
    local_intent: `${slug} 意圖`,
    canonical_intent_slug: slug,
    ...overrides,
    slug
  };
}

describe("index-growth publication gates under hostile input", () => {
  it("refuses missing, unknown, and whitespace publish_state instead of treating them as accepted", () => {
    const base = catalogPage("suede-shoe-cleaning");
    const cases: Array<{ label: string; page: IndexGrowthPageDefinition }> = [
      { label: "missing", page: uniqueClone(base, { slug: "missing-state" }) },
      { label: "unknown-capital", page: uniqueClone(base, { slug: "capital-state", publish_state: "ACCEPTED" as IndexGrowthPageDefinition["publish_state"] }) },
      { label: "published", page: uniqueClone(base, { slug: "published-state", publish_state: "published" as IndexGrowthPageDefinition["publish_state"] }) },
      { label: "padded", page: uniqueClone(base, { slug: "padded-state", publish_state: " accepted" as IndexGrowthPageDefinition["publish_state"] }) }
    ];
    delete (cases[0]!.page as { publish_state?: string }).publish_state;

    for (const item of cases) {
      const result = validateIndexGrowthPages([item.page], { today: TODAY });
      expect(result.ok, item.label).toBe(false);
      expect(
        result.failures.some((failure) => failure.code === "publish-state"),
        `${item.label}: ${JSON.stringify(result.failures)}`
      ).toBe(true);
      expect(() => resolveAcceptedIndexGrowthPages([item.page], { today: TODAY })).toThrow(/index growth pages failed validation/);
    }
  });

  it("refuses duplicate accepted slugs and does not project either page", () => {
    const left = catalogPage("suede-shoe-cleaning");
    const right = uniqueClone(left, { slug: left.slug, path: "guides/other.html" });
    const result = validateIndexGrowthPages([left, right], { today: TODAY });
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.code === "duplicate-field")).toBe(true);
    expect(() => resolveAcceptedIndexGrowthPages([left, right], { today: TODAY })).toThrow(/duplicate/);
  });

  it("refuses missing provenance and empty source_refs on an otherwise accepted page", () => {
    const page = uniqueClone(catalogPage("canvas-shoe-mud"), {
      slug: "no-provenance",
      citation_source_refs: [],
      steps: catalogPage("canvas-shoe-mud").steps.map((step) => ({ ...step, source_refs: [] })),
      sections: (catalogPage("canvas-shoe-mud").sections ?? []).map((section) => ({ ...section, source_refs: [] })),
      faqs: catalogPage("canvas-shoe-mud").faqs.map((faq) => ({ ...faq, source_refs: [] }))
    });
    const result = validateIndexGrowthPages([page], { today: TODAY });
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.code === "missing-source-refs")).toBe(true);
    expect(() => resolveAcceptedIndexGrowthPages([page], { today: TODAY })).toThrow(/source_refs/);
  });

  it("refuses a missing validator today instead of using wall-clock", () => {
    const result = validateIndexGrowthPages(INDEX_GROWTH_CATALOG, {});
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.code === "volatile-lastmod")).toBe(true);
  });

  it("refuses lastmod after Asia/Taipei month-boundary midnight", () => {
    const page = uniqueClone(catalogPage("suede-shoe-cleaning"), {
      slug: "month-boundary",
      content_lastmod: "2026-09-01",
      content_revision: "2026-09-01#1"
    });
    const taipeiMonthStart = getZonedDateParts(new Date("2026-08-31T16:00:00.000Z"), "Asia/Taipei");
    expect(taipeiMonthStart.date).toBe("2026-09-01");

    const stillAugust = validateIndexGrowthPages([page], { today: "2026-08-31" });
    expect(stillAugust.ok).toBe(false);
    expect(stillAugust.failures.some((failure) => failure.code === "volatile-lastmod")).toBe(true);

    const onBoundary = validateIndexGrowthPages([page], { today: taipeiMonthStart.date });
    expect(onBoundary.failures.some((failure) => failure.code === "volatile-lastmod" && failure.slugs?.includes("month-boundary"))).toBe(
      false
    );
  });

  it("counts emoji as Unicode code points and refuses an oversized Chinese citation", () => {
    expect(citationAnswerLength("👟👟👟👟")).toBe(4);
    expect(citationAnswerLength("麂皮　變硬\n不要濕擦")).toBe(8);

    const oversized = "這是一段超過五十個字的超長中文答案".repeat(8);
    expect(citationAnswerLength(oversized)).toBeGreaterThan(50);
    const page = uniqueClone(catalogPage("suede-shoe-cleaning"), {
      slug: "too-long-citation",
      citation_answer: oversized,
      summary: oversized
    });
    const result = validateIndexGrowthPages([page], { today: TODAY });
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.code === "citation-length")).toBe(true);
  });

  it("does not throw on replacement characters or mixed-script hostile strings; still fail-closed on missing identity", () => {
    const page = uniqueClone(catalogPage("suede-shoe-cleaning"), {
      slug: "fffd-hostile",
      title: `標題\uFFFD<script>alert(1)</script>`,
      h1: `主標\uFFFD`,
      description: `描述\u0000零位元組`,
      citation_answer: "不要濕擦；先乾刷看方向。",
      summary: "不要濕擦；先乾刷看方向。"
    });
    expect(() => validateIndexGrowthPages([page], { today: TODAY })).not.toThrow();
    const result = validateIndexGrowthPages([page], { today: TODAY });
    expect(result.ok).toBe(false);
  });

  it("documents fail-open: impossible calendar lastmods matching YYYY-MM-DD are accepted", () => {
    const page = uniqueClone(catalogPage("suede-shoe-cleaning"), {
      slug: "leap-fake",
      content_lastmod: "2026-02-29",
      content_revision: "2026-02-29#1"
    });
    const result = validateIndexGrowthPages([page], { today: "2026-03-01" });
    const lastmodFailures = result.failures.filter((failure) => failure.code === "volatile-lastmod");
    expect(lastmodFailures).toEqual([]);
  });

  it("documents fail-open: an empty catalog with a valid today is accepted", () => {
    const result = validateIndexGrowthPages([], { today: TODAY });
    expect(result.ok).toBe(true);
    expect(resolveAcceptedIndexGrowthPages([], { today: TODAY })).toEqual([]);
  });

  it("documents fail-open: missing hub_group falls back to decisions", () => {
    expect(hubGroupFor({ slug: "never-seen-slug-xyz" })).toBe("decisions");
    const page = uniqueClone(catalogPage("suede-shoe-cleaning"), { slug: "no-hub" });
    delete (page as { hub_group?: string }).hub_group;
    const result = validateIndexGrowthPages([page], { today: TODAY });
    expect(result.failures.some((failure) => /hub_group/.test(failure.message))).toBe(false);
  });
});

describe("sitemap and Pages publish gates under hostile input", () => {
  it("refuses a missing, empty, or future-lastmod sitemap at Taipei month boundary", () => {
    const missingRoot = mkdtempSync(join(tmpdir(), "sxj-sitemap-missing-"));
    expect(() => assertLocalSitemapHasNoFutureLastmod(missingRoot)).toThrow(/sitemap\.xml is missing/);

    const emptyRoot = mkdtempSync(join(tmpdir(), "sxj-sitemap-empty-"));
    mkdirSync(join(emptyRoot, "docs"), { recursive: true });
    writeFileSync(join(emptyRoot, "docs", "sitemap.xml"), "   \n");
    expect(() => assertLocalSitemapHasNoFutureLastmod(emptyRoot)).toThrow(/sitemap\.xml is empty/);

    const futureRoot = mkdtempSync(join(tmpdir(), "sxj-sitemap-future-"));
    mkdirSync(join(futureRoot, "docs"), { recursive: true });
    writeFileSync(
      join(futureRoot, "docs", "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.invalid/</loc><lastmod>2026-09-01</lastmod></url>\n</urlset>\n`
    );
    const stillAugust = new Date("2026-08-31T15:30:00.000Z");
    expect(getZonedDateParts(stillAugust, "Asia/Taipei").date).toBe("2026-08-31");
    expect(() => assertLocalSitemapHasNoFutureLastmod(futureRoot, stillAugust)).toThrow(/lastmod after 2026-08-31/);

    const taipeiSeptember = new Date("2026-08-31T16:00:00.000Z");
    expect(getZonedDateParts(taipeiSeptember, "Asia/Taipei").date).toBe("2026-09-01");
    expect(() => assertLocalSitemapHasNoFutureLastmod(futureRoot, taipeiSeptember)).not.toThrow();
  });

  it("rejects path-traversal, encoded, and oversized asset references instead of dropping them", () => {
    expect(isAllowlistedAssetFile("assets/2026-09-01/../../.env")).toBe(false);
    expect(isAllowlistedAssetFile("assets/2026-09-01/slot-01.png\0.jpg")).toBe(false);
    expect(isAllowlistedAssetFile("assets%2F2026-09-01%2Fslot-01.png")).toBe(false);
    expect(isAllowlistedAssetFile("assets/2026-09-01/slot-01.svg")).toBe(false);
    expect(isAllowlistedAssetFile("assets/not-a-date/slot-01.png")).toBe(false);
    expect(isAllowlistedAssetFile("assets/2026-09-01/slot-01.png")).toBe(true);

    const docsRoot = mkdtempSync(join(tmpdir(), "sxj-assets-hostile-"));
    writeFileSync(
      join(docsRoot, "index.html"),
      `<img src="assets/2026-09-01/../../secrets.png"><img src="assets/2026-09-01/slot-01.svg">`
    );
    expect(() => collectReferencedPublicAssetPaths(docsRoot, ["index.html"])).toThrow(/non-allowlisted assets/);

    writeFileSync(join(docsRoot, "escaped.html"), String.raw`<img src="assets\2026-09-01\slot-01.webp">`);
    expect(() => collectReferencedPublicAssetPaths(docsRoot, ["escaped.html"])).toThrow(
      /escaped or encoded assets path separators/
    );

    const missingRoot = mkdtempSync(join(tmpdir(), "sxj-assets-missing-"));
    mkdirSync(join(missingRoot, "assets", "2026-09-01"), { recursive: true });
    writeFileSync(join(missingRoot, "index.html"), `<img src="assets/2026-09-01/slot-01.png">`);
    expect(() =>
      assertMirroredReferencedAssets(missingRoot, join(missingRoot, "mirror"), ["assets/2026-09-01/slot-01.png"], [
        "index.html"
      ])
    ).toThrow(/missing source asset/);
  });

  it("refuses more than MAX_REFERENCED_PUBLIC_ASSETS instead of silently dropping extras", () => {
    const root = mkdtempSync(join(tmpdir(), "sxj-asset-budget-"));
    const origin = mkdtempSync(join(tmpdir(), "sxj-asset-budget-origin-"));
    execFileSync("git", ["init", "--bare"], { cwd: origin, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["branch", "-M", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", origin], { cwd: root, stdio: "ignore" });
    writeFileSync(join(root, "README.md"), "init\n");
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: root, stdio: "ignore" });

    mkdirSync(join(root, "docs", "assets", "2026-01-01"), { recursive: true });
    const refs = Array.from({ length: MAX_REFERENCED_PUBLIC_ASSETS + 1 }, (_, index) => {
      const name = `slot-${String(index).padStart(4, "0")}.png`;
      writeFileSync(join(root, "docs", "assets", "2026-01-01", name), "x");
      return `assets/2026-01-01/${name}`;
    });
    writeFileSync(join(root, "docs", "index.html"), refs.map((path) => `<img src="${path}">`).join("\n"));
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "content-calendar", "2026-01-01.json"), '{"slots":[]}\n');
    writeFileSync(
      join(root, "docs", "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.invalid/</loc><lastmod>2026-01-01</lastmod></url>\n</urlset>\n`
    );

    expect(() => publishPagesAssets("2026-01-01", root, "", new Date("2026-01-02T00:00:00.000Z"))).toThrow(
      /exceed the selective-mirror budget/
    );
  }, 30_000);

  it("documents fail-open: missing knowledge/ or scripts/ is omitted from publish instead of refusing", () => {
    const root = mkdtempSync(join(tmpdir(), "sxj-missing-hub-"));
    const origin = mkdtempSync(join(tmpdir(), "sxj-missing-hub-origin-"));
    execFileSync("git", ["init", "--bare"], { cwd: origin, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["branch", "-M", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", origin], { cwd: root, stdio: "ignore" });
    writeFileSync(join(root, "README.md"), "init\n");
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: root, stdio: "ignore" });

    mkdirSync(join(root, "docs", "assets", "2026-01-01"), { recursive: true });
    mkdirSync(join(root, "docs", "content-calendar"), { recursive: true });
    writeFileSync(join(root, "docs", "index.html"), "<!doctype html><title>ok</title>\n");
    writeFileSync(join(root, "docs", "content-calendar", "2026-01-01.json"), '{"slots":[]}\n');
    writeFileSync(join(root, "docs", "assets", "2026-01-01", "slot-01.png"), "x");
    writeFileSync(
      join(root, "docs", "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.invalid/</loc><lastmod>2026-01-01</lastmod></url>\n</urlset>\n`
    );

    const result = publishPagesAssets("2026-01-01", root, "", new Date("2026-01-02T00:00:00.000Z"));
    expect(result).toMatch(/Published GitHub Pages assets|No GitHub Pages changes/);
  }, 30_000);
});

describe("publishable image gates under corrupt media", () => {
  const DATE = "2026-09-01";

  async function writeDay(
    root: string,
    options: { bytes: Buffer; source?: string; topic?: string }
  ): Promise<void> {
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await mkdir(join(root, "data", "image-sources"), { recursive: true });
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    const topic = options.topic ?? "白鞋鞋邊泛灰前的檢查";
    const slots = [1, 2].map((slot) => {
      const imagePath = `docs/assets/${DATE}/slot-0${slot}.png`;
      return {
        slot,
        time: slot === 1 ? "11:30" : "19:30",
        category: slot === 1 ? "知識文" : "情境文",
        topic: slot === 1 ? topic : "雨後通勤回家不要直接收鞋",
        instagram_caption: "caption",
        facebook_caption: "caption",
        image_prompt: "prompt",
        visual_route: "macro-detail" as const,
        traffic_route: "object-proof" as const,
        local_image_path: imagePath,
        public_image_url: `https://example.invalid/assets/${DATE}/slot-0${slot}.png`,
        status: "pending"
      };
    });
    await writeFile(
      join(root, "data", "content-calendar", `${DATE}.json`),
      JSON.stringify({
        date: DATE,
        timezone: "Asia/Taipei",
        generated_at: `${DATE}T00:00:00.000Z`,
        slots
      })
    );
    const sources = [];
    for (const slot of slots) {
      await writeFile(join(root, slot.local_image_path), options.bytes);
      sources.push({
        date: DATE,
        slot: slot.slot,
        source: options.source ?? "gpt-image-2",
        image_path: slot.local_image_path,
        marked_at: `${DATE}T01:00:00.000Z`,
        topic: slot.topic
      });
    }
    await writeFile(join(root, "data", "image-sources", `${DATE}.json`), JSON.stringify(sources));
  }

  it("refuses a missing source record and an empty file", async () => {
    const missingSource = mkdtempSync(join(tmpdir(), "sxj-img-src-"));
    await writeDay(missingSource, { bytes: Buffer.from("not-empty"), source: "unknown-model" });
    await expect(validatePublishableImages(DATE, missingSource)).rejects.toThrow(/Missing gpt-image-2 source records/);

    const emptyFile = mkdtempSync(join(tmpdir(), "sxj-img-empty-"));
    await writeDay(emptyFile, { bytes: Buffer.alloc(0) });
    const missing = await listMissingCalendarImages(DATE, emptyFile);
    expect(missing.some((item) => item.reason === "empty")).toBe(true);
    await expect(validatePublishableImages(DATE, emptyFile)).rejects.toThrow(/empty|Missing image assets/);
  });

  it("documents fail-open: a one-byte non-PNG with a gpt-image-2 stamp is treated as publishable", async () => {
    const root = mkdtempSync(join(tmpdir(), "sxj-img-1byte-"));
    await writeDay(root, { bytes: Buffer.from([0x00]) });
    await expect(validatePublishableImages(DATE, root)).resolves.toBeUndefined();
    const missing = await listMissingCalendarImages(DATE, root);
    expect(missing).toEqual([]);
  });
});

describe("config key hostility for live vs dry-run", () => {
  it("refuses a live site measurement ID that is missing or not G-shaped", () => {
    const missing = getConfig({ ...process.env, PUBLIC_GA4_MEASUREMENT_ID: "", DRY_RUN: "true" });
    expect(missing.ga4MeasurementId).toBeUndefined();

    const junk = getConfig({ ...process.env, PUBLIC_GA4_MEASUREMENT_ID: "not-a-ga4-id", DRY_RUN: "true" });
    expect(junk.ga4MeasurementId).toBeUndefined();

    const ok = getConfig({ ...process.env, PUBLIC_GA4_MEASUREMENT_ID: "G-ABC123", DRY_RUN: "true" });
    expect(ok.ga4MeasurementId).toBe("G-ABC123");
  });
});
