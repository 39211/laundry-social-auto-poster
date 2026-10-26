import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";
import { publishPagesAssets } from "../src/publishPages";

const BASE_URL = "https://example.com";
/** 2026-10-20 16:30Z = 2026-10-21 00:30 Asia/Taipei. The run date is the Taipei calendar day. */
const NOW = new Date("2026-10-20T16:30:00.000Z");
const RUN_DATE = "2026-10-21";
const PAST_DATE = "2020-01-01";
const FUTURE_PNG_DATE = "2026-10-24";
const FUTURE_MP4_DATE = "2026-10-22";
const FUTURE_ASSET_MARKERS = [`assets/${FUTURE_PNG_DATE}/`, `assets/${FUTURE_MP4_DATE}/`] as const;
/** 1x1 PNG. The public-site generator decodes the static background hero with sharp. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const roots: string[] = [];

function track(root: string): string {
  roots.push(root);
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeGitRepo(): { root: string; origin: string } {
  const root = track(mkdtempSync(join(tmpdir(), "future-asset-src-")));
  const origin = track(mkdtempSync(join(tmpdir(), "future-asset-origin-")));
  git(origin, ["init", "--bare"]);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["remote", "add", "origin", origin]);
  writeFileSync(join(root, "README.md"), "initial\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "Initial"]);
  git(root, ["push", "-u", "origin", "main"]);
  return { root, origin };
}

function writeAsset(root: string, date: string, name: string, bytes: string): void {
  const dir = join(root, "docs", "assets", date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
}

/** Static heroes the generator references. Synthetic 1x1 PNGs stay in the temp root. */
const STATIC_HERO_PATHS = [
  "assets/services/shoe-bag-care-hero-product.png",
  "assets/services/white-shoe-cleaning-hero-product.png",
  "assets/services/fabric-storage-hero-product.png",
  "assets/services/fabric-storage-duvet-check.png",
  "assets/services/fabric-storage-blanket-pilling.png",
  "assets/services/fabric-storage-inspection.png",
  "assets/backgrounds/premium-laundry-depth.png",
  "assets/backgrounds/local-store-depth.png"
] as const;

function writeStaticHeroes(root: string): void {
  for (const relativePath of STATIC_HERO_PATHS) {
    const file = join(root, "docs", relativePath);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, ONE_PIXEL_PNG);
  }
}

function loc(path: string): string {
  return `${BASE_URL}/${path}`;
}

function sitemapXml(urls: string[]): string {
  const body = urls.map((url) => `  <url><loc>${url}</loc><lastmod>${RUN_DATE}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function writeIndexOverrides(root: string): void {
  const keptGuide = loc("guides/kept.html");
  const todayPng = loc(`assets/${RUN_DATE}/slot-01.png`);
  const pastWebp = loc(`assets/${PAST_DATE}/slot-01.webp`);
  const futurePng = loc(`assets/${FUTURE_PNG_DATE}/slot-01.png`);
  const futurePngTwo = loc(`assets/${FUTURE_PNG_DATE}/slot-02.png`);
  const futureMp4 = loc(`assets/${FUTURE_MP4_DATE}/slot-02.mp4`);
  const urls = [keptGuide, todayPng, pastWebp, futurePng, futurePngTwo, futureMp4];
  const overrideRoot = join(root, "seo-overrides");
  mkdirSync(join(overrideRoot, ".well-known"), { recursive: true });
  mkdirSync(join(root, "docs", "guides"), { recursive: true });
  writeFileSync(join(root, "docs", "guides", "kept.html"), "<!doctype html><title>kept</title>\n");
  writeFileSync(join(overrideRoot, "sitemap.xml"), sitemapXml(urls));
  writeFileSync(join(overrideRoot, "ai-sitemap.xml"), sitemapXml(urls));
  const llms = [todayPng, pastWebp, futurePng, futureMp4, keptGuide].join("\n") + "\n";
  for (const name of ["llms.txt", "llms-lite.txt", "llms-full.txt"]) {
    writeFileSync(join(overrideRoot, name), llms);
  }
  writeFileSync(join(overrideRoot, ".well-known", "llms.txt"), llms);
  writeFileSync(
    join(overrideRoot, "rss.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0">',
      "  <channel>",
      "    <title>kept</title>",
      "    <item>",
      `      <link>${todayPng}</link>`,
      `      <enclosure url="${todayPng}" type="image/png" length="0" />`,
      `      <enclosure url="${pastWebp}" type="image/webp" length="0" />`,
      "    </item>",
      "    <item>",
      `      <link>${keptGuide}</link>`,
      `      <enclosure url="${futurePng}" type="image/png" length="0" />`,
      "    </item>",
      "    <item>",
      `      <link>${futureMp4}</link>`,
      "    </item>",
      "  </channel>",
      "</rss>",
      ""
    ].join("\n")
  );
  writeFileSync(
    join(overrideRoot, "feed.json"),
    `${JSON.stringify(
      {
        version: "https://jsonfeed.org/version/1.1",
        items: [
          { id: "today", url: keptGuide, image: todayPng },
          { id: "past", url: keptGuide, image: pastWebp },
          { id: "future-png", url: keptGuide, image: futurePng },
          { id: "future-mp4", url: keptGuide, image: futureMp4 }
        ]
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(overrideRoot, "llms.jsonl"),
    [todayPng, pastWebp, futurePng, futureMp4].map((url) => JSON.stringify({ url })).join("\n") + "\n"
  );
}

function readText(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1] ?? "");
}

function expectNoFutureAssetMarkers(label: string, text: string): void {
  const hits = FUTURE_ASSET_MARKERS.filter((marker) => text.includes(marker));
  expect(hits, `${label} still publishes future-dated assets`).toEqual([]);
}

function expectKeptAssetMarkers(label: string, text: string): void {
  expect(text, label).toContain(`assets/${RUN_DATE}/slot-01.png`);
  expect(text, label).toContain(`assets/${PAST_DATE}/slot-01.webp`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("future-dated public assets", () => {
  it("keeps assets/YYYY-MM-DD after the Taipei run date out of indexes and the io mirror", async () => {
    const { root } = makeGitRepo();
    const { origin: rootPagesOrigin } = makeGitRepo();
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(
      join(root, "data", "business-profile.json"),
      readFileSync(join(process.cwd(), "data", "business-profile.json"))
    );
    writeAsset(root, FUTURE_PNG_DATE, "slot-01.png", "future png one");
    writeAsset(root, FUTURE_PNG_DATE, "slot-02.png", "future png two");
    writeAsset(root, FUTURE_MP4_DATE, "slot-02.mp4", "future mp4");
    writeAsset(root, RUN_DATE, "slot-01.png", "today png");
    writeAsset(root, PAST_DATE, "slot-01.webp", "past webp");
    writeStaticHeroes(root);
    mkdirSync(join(root, "docs", "posts"), { recursive: true });
    writeFileSync(join(root, "docs", "posts", "index.html"), "<!doctype html><title>posts</title>\n");
    writeIndexOverrides(root);

    await generatePublicSite({
      root,
      siteBaseUrl: `${BASE_URL}/`,
      imageBaseUrl: `${BASE_URL}/`,
      now: NOW
    });

    const docs = join(root, "docs");
    const indexFiles = [
      "sitemap.xml",
      "ai-sitemap.xml",
      "llms.txt",
      "llms-lite.txt",
      "llms-full.txt",
      ".well-known/llms.txt",
      "rss.xml",
      "feed.json",
      "llms.jsonl"
    ];
    for (const path of indexFiles) {
      expectNoFutureAssetMarkers(`docs/${path}`, readText(root, join("docs", path)));
    }
    const sitemapUrls = sitemapLocs(readText(root, "docs/sitemap.xml"));
    expect(sitemapUrls).toContain(loc("guides/kept.html"));
    expect(sitemapUrls).toContain(loc(`assets/${RUN_DATE}/slot-01.png`));
    expect(sitemapUrls).toContain(loc(`assets/${PAST_DATE}/slot-01.webp`));
    expect(sitemapUrls).not.toContain(loc(`assets/${FUTURE_PNG_DATE}/slot-01.png`));
    expect(sitemapUrls).not.toContain(loc(`assets/${FUTURE_PNG_DATE}/slot-02.png`));
    expect(sitemapUrls).not.toContain(loc(`assets/${FUTURE_MP4_DATE}/slot-02.mp4`));
    expectKeptAssetMarkers("docs/llms.txt", readText(root, "docs/llms.txt"));
    expectKeptAssetMarkers("docs/rss.xml", readText(root, "docs/rss.xml"));
    expectKeptAssetMarkers("docs/feed.json", readText(root, "docs/feed.json"));
    expect(existsSync(join(docs, "assets", FUTURE_PNG_DATE, "slot-01.png"))).toBe(true);
    expect(existsSync(join(docs, "assets", FUTURE_MP4_DATE, "slot-02.mp4"))).toBe(true);

    const result = publishPagesAssets(FUTURE_PNG_DATE, root, rootPagesOrigin, NOW, {
      env: { PUBLIC_SITE_BASE_URL: `${BASE_URL}/` }
    });
    expect(result).toContain("Published GitHub Pages assets");

    const sourceTree = git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);
    const mirrorTree = git(rootPagesOrigin, ["ls-tree", "-r", "main", "--name-only"]);
    expect(sourceTree).not.toContain(`docs/assets/${FUTURE_PNG_DATE}/`);
    expect(sourceTree).not.toContain(`docs/assets/${FUTURE_MP4_DATE}/`);
    expect(sourceTree).toContain(`docs/assets/${RUN_DATE}/slot-01.png`);
    expect(sourceTree).toContain(`docs/assets/${PAST_DATE}/slot-01.webp`);
    expect(sourceTree).toContain("docs/assets/backgrounds/premium-laundry-depth.png");
    expect(mirrorTree).not.toContain(`assets/${FUTURE_PNG_DATE}/`);
    expect(mirrorTree).not.toContain(`assets/${FUTURE_MP4_DATE}/`);
    expect(mirrorTree).toContain(`assets/${RUN_DATE}/slot-01.png`);
    expect(mirrorTree).toContain(`assets/${PAST_DATE}/slot-01.webp`);
    expect(mirrorTree).toContain("assets/backgrounds/premium-laundry-depth.png");
    expectNoFutureAssetMarkers("mirrored sitemap.xml", git(rootPagesOrigin, ["show", "main:sitemap.xml"]));
    expectNoFutureAssetMarkers("mirrored ai-sitemap.xml", git(rootPagesOrigin, ["show", "main:ai-sitemap.xml"]));
    expectNoFutureAssetMarkers("mirrored llms.txt", git(rootPagesOrigin, ["show", "main:llms.txt"]));
    expectNoFutureAssetMarkers("mirrored rss.xml", git(rootPagesOrigin, ["show", "main:rss.xml"]));
    expect(existsSync(join(docs, "assets", FUTURE_PNG_DATE, "slot-01.png"))).toBe(true);
    expect(existsSync(join(docs, "assets", FUTURE_PNG_DATE, "slot-02.png"))).toBe(true);
    expect(existsSync(join(docs, "assets", FUTURE_MP4_DATE, "slot-02.mp4"))).toBe(true);
  }, 180000);
});
