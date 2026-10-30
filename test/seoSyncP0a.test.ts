import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";

const BASE_URL = "https://example.com";
const OPEN_MARKER = "<!-- SXJ:RECENT_POSTS -->";
const CLOSE_MARKER = "<!-- /SXJ:RECENT_POSTS -->";
const THICK_CAPTION = [
  "白鞋鞋邊一圈灰，多半是髒不是黃。",
  "先看膠邊：灰是可以清的髒，黃是氧化，只能淡化、不保證回白。鞋內有濕悶味就先通風、取出鞋墊，不要高溫烘。",
  "拍整體、鞋邊近照與鞋內，傳 LINE 門市先看材質，再說能整理到什麼程度。台中市可約免費收送。"
].join("\n\n");

type SlotOverride = {
  topic?: string;
  facebook_caption?: string;
  instagram_caption?: string;
};

const roots: string[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "seo-sync-p0a-"));
  roots.push(root);
  return root;
}

async function writeBusinessProfile(root: string): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  const profile = await readFile(join(process.cwd(), "data", "business-profile.json"), "utf8");
  await writeFile(join(root, "data", "business-profile.json"), profile, "utf8");
}

function makeSlot(date: string, slot: 1 | 2, override: SlotOverride = {}) {
  const defaultCaption = slot === 1 ? THICK_CAPTION : "短文";
  return {
    slot,
    time: slot === 1 ? "11:30" : "19:30",
    category: slot === 1 ? "knowledge" : "situation",
    topic: override.topic ?? (slot === 1 ? "白鞋鞋邊檢查" : "包角檢查"),
    instagram_caption: override.instagram_caption ?? defaultCaption,
    facebook_caption: override.facebook_caption ?? defaultCaption,
    image_prompt: "fixture image prompt",
    visual_route: slot === 1 ? "shop-inspection" : "macro-detail",
    traffic_route: slot === 1 ? "object-proof" : "value-prop-lead",
    search_intent: slot === 1 ? "problem-diagnosis" : "trust-proof",
    target_queries: ["台中洗鞋店", "白鞋清潔"],
    evidence_type: "first-party-inspection",
    local_image_path: "fixture-image.png",
    public_image_url: "",
    status: "pending",
    date
  };
}

async function writeCalendar(
  root: string,
  date: string,
  overrides: Record<1 | 2, SlotOverride> = { 1: {}, 2: {} }
): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
  const calendar = {
    date,
    timezone: "Asia/Taipei",
    generated_at: date + "T00:00:00.000Z",
    slots: [makeSlot(date, 1, overrides[1]), makeSlot(date, 2, overrides[2])]
  };
  const serialized = JSON.stringify(calendar, null, 2) + "\n";
  await Promise.all([
    writeFile(join(root, "data", "content-calendar", date + ".json"), serialized, "utf8"),
    writeFile(join(root, "docs", "content-calendar", date + ".json"), serialized, "utf8")
  ]);
}

async function writeApprovalLog(root: string, date: string): Promise<void> {
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  const entries = [1, 2].flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date,
      slot,
      platform,
      status: "approved",
      approved_by: "SEO Sync P0A test",
      note: "Fixture approval",
      created_at: date + "T02:20:00.000Z"
    }))
  );
  await writeFile(
    join(root, "data", "approved-log", date + ".json"),
    JSON.stringify(entries, null, 2) + "\n",
    "utf8"
  );
}

async function seedOneDay(
  root: string,
  overrides: Record<1 | 2, SlotOverride> = { 1: {}, 2: {} }
): Promise<void> {
  await writeBusinessProfile(root);
  await writeCalendar(root, "2026-07-02", overrides);
  await writeApprovalLog(root, "2026-07-02");
}

async function generate(root: string): Promise<void> {
  await generatePublicSite({
    root,
    siteBaseUrl: BASE_URL + "/",
    imageBaseUrl: BASE_URL + "/",
    now: "2026-07-03T03:00:00.000Z"
  });
}

function sitemapLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gu), (match) => match[1] ?? "");
}

function bytesOutsideMarkers(html: string): string {
  const openAt = html.indexOf(OPEN_MARKER);
  const closeAt = html.indexOf(CLOSE_MARKER);
  if (openAt < 0 || closeAt < openAt) throw new Error("fixture markers are not ordered");
  return html.slice(0, openAt + OPEN_MARKER.length) + html.slice(closeAt);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SEO-SYNC-P0A", () => {
  it("indexes thick articles only across article robots, sitemaps, and RSS", async () => {
    const root = newRoot();
    await seedOneDay(root, {
      1: { topic: "鞋邊厚文章", facebook_caption: THICK_CAPTION, instagram_caption: THICK_CAPTION },
      2: { topic: "短貼文", facebook_caption: "短文", instagram_caption: "短文" }
    });
    await generate(root);

    const docs = join(root, "docs");
    const thickUrl = BASE_URL + "/posts/2026-07-02-slot-01.html";
    const thinUrl = BASE_URL + "/posts/2026-07-02-slot-02.html";
    const [thick, thin, hub, sitemap, aiSitemap, rss] = await Promise.all([
      readFile(join(docs, "posts", "2026-07-02-slot-01.html"), "utf8"),
      readFile(join(docs, "posts", "2026-07-02-slot-02.html"), "utf8"),
      readFile(join(docs, "posts", "index.html"), "utf8"),
      readFile(join(docs, "sitemap.xml"), "utf8"),
      readFile(join(docs, "ai-sitemap.xml"), "utf8"),
      readFile(join(docs, "rss.xml"), "utf8")
    ]);

    expect(thick).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(thin).toContain('name="robots" content="noindex, follow, max-image-preview:large"');
    expect(sitemapLocs(sitemap)).toContain(thickUrl);
    expect(sitemapLocs(sitemap)).not.toContain(thinUrl);
    expect(sitemapLocs(aiSitemap)).toContain(thickUrl);
    expect(sitemapLocs(aiSitemap)).not.toContain(thinUrl);
    expect(rss).toContain(thickUrl);
    expect(hub).toContain('name="robots" content="index, follow, max-image-preview:large"');
  });

  it("keeps the existing sitemap cap while retaining every eligible article in discovery counts", async () => {
    const root = newRoot();
    await writeBusinessProfile(root);
    for (let dayOffset = 0; dayOffset < 16; dayOffset += 1) {
      const date = new Date(Date.UTC(2026, 5, 2 + dayOffset)).toISOString().slice(0, 10);
      const firstCaption = THICK_CAPTION + "\n\nfixture article 1 " + date + " ".repeat(80);
      const secondCaption = THICK_CAPTION + "\n\nfixture article 2 " + date + " ".repeat(80);
      await writeCalendar(root, date, {
        1: { topic: "厚文 1 " + date, facebook_caption: firstCaption, instagram_caption: firstCaption },
        2: { topic: "厚文 2 " + date, facebook_caption: secondCaption, instagram_caption: secondCaption }
      });
      await writeApprovalLog(root, date);
    }
    await generate(root);

    const [sitemap, discoveryText] = await Promise.all([
      readFile(join(root, "docs", "sitemap.xml"), "utf8"),
      readFile(join(root, "docs", "ai-discovery.json"), "utf8")
    ]);
    const discovery = JSON.parse(discoveryText) as {
      content_contract: {
        daily_article_policy: {
          indexable_article_count: number;
          sitemap_max_indexable_posts: number;
          sitemap_indexable_post_count: number;
        };
      };
    };
    const postUrls = sitemapLocs(sitemap).filter((url) => /\/posts\/\d{4}-\d{2}-\d{2}-slot-\d{2}\.html$/u.test(url));

    expect(discovery.content_contract.daily_article_policy).toMatchObject({
      indexable_article_count: 32,
      sitemap_max_indexable_posts: 30,
      sitemap_indexable_post_count: 30
    });
    expect(postUrls).toHaveLength(30);
    expect(postUrls).toContain(BASE_URL + "/posts/2026-06-17-slot-02.html");
    expect(postUrls).not.toContain(BASE_URL + "/posts/2026-06-02-slot-01.html");
  });

  it("unions every override sitemap URL with generated indexable article URLs", async () => {
    const root = newRoot();
    await seedOneDay(root);
    const overrideRoot = join(root, "seo-overrides");
    await mkdir(overrideRoot, { recursive: true });
    const overrideUrl = BASE_URL + "/guides/hand-maintained.html";
    await writeFile(
      join(overrideRoot, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>' + overrideUrl +
        "</loc><lastmod>2026-06-30</lastmod></url></urlset>\n",
      "utf8"
    );
    await writeFile(
      join(overrideRoot, "index.html"),
      "<html>" + OPEN_MARKER + "old block" + CLOSE_MARKER + "</html>",
      "utf8"
    );
    await generate(root);

    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    expect(sitemapLocs(sitemap)).toContain(overrideUrl);
    expect(sitemapLocs(sitemap)).toContain(BASE_URL + "/posts/2026-07-02-slot-01.html");
  });

  it("drops below-gate post URLs that an override sitemap lists", async () => {
    const root = newRoot();
    await seedOneDay(root, {
      1: { facebook_caption: THICK_CAPTION, instagram_caption: THICK_CAPTION },
      2: { facebook_caption: "短文", instagram_caption: "短文" }
    });
    const overrideRoot = join(root, "seo-overrides");
    await mkdir(overrideRoot, { recursive: true });
    const overrideUrl = BASE_URL + "/guides/hand-maintained.html";
    const thinPostUrl = BASE_URL + "/posts/2026-07-02-slot-02.html";
    await writeFile(
      join(overrideRoot, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>' + overrideUrl +
        "</loc></url><url><loc>" + thinPostUrl + "</loc></url></urlset>\n",
      "utf8"
    );
    await generate(root);

    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const sitemapUrls = sitemapLocs(sitemap);
    expect(sitemapUrls).toContain(overrideUrl);
    expect(sitemapUrls).toContain(BASE_URL + "/posts/2026-07-02-slot-01.html");
    expect(sitemapUrls).not.toContain(thinPostUrl);
  });

  it("keeps generated indexable article URLs when a sitemap and indexable HTML override are present", async () => {
    const root = newRoot();
    await seedOneDay(root);
    const overrideRoot = join(root, "seo-overrides");
    await mkdir(join(overrideRoot, "guides"), { recursive: true });
    const overrideUrl = BASE_URL + "/guides/hand-maintained.html";
    await writeFile(
      join(overrideRoot, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>' + overrideUrl +
        "</loc><lastmod>2026-06-30</lastmod></url></urlset>\n",
      "utf8"
    );
    await writeFile(join(overrideRoot, "guides", "hand-maintained.html"), "<html>guide</html>", "utf8");
    await generate(root);

    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    expect(sitemapLocs(sitemap)).toContain(overrideUrl);
    expect(sitemapLocs(sitemap)).toContain(BASE_URL + "/posts/2026-07-02-slot-01.html");
  });

  it("keeps generated indexable article URLs when sitemap HTML overrides have no listable URL", async () => {
    const root = newRoot();
    await seedOneDay(root);
    const overrideRoot = join(root, "seo-overrides");
    await mkdir(overrideRoot, { recursive: true });
    const overrideUrl = BASE_URL + "/guides/hand-maintained.html";
    await writeFile(
      join(overrideRoot, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>' + overrideUrl +
        "</loc><lastmod>2026-06-30</lastmod></url></urlset>\n",
      "utf8"
    );
    await writeFile(join(overrideRoot, "price-list.html"), "<html>excluded noindex stub</html>", "utf8");
    await generate(root);

    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    expect(sitemapLocs(sitemap)).toContain(overrideUrl);
    expect(sitemapLocs(sitemap)).toContain(BASE_URL + "/posts/2026-07-02-slot-01.html");
  });

  it("keeps generated indexable article URLs when sitemap HTML overrides canonicalize elsewhere", async () => {
    const root = newRoot();
    await seedOneDay(root);
    const overrideRoot = join(root, "seo-overrides");
    await mkdir(join(overrideRoot, "guides"), { recursive: true });
    const overrideUrl = BASE_URL + "/guides/hand-maintained.html";
    const canonicalizedUrl = BASE_URL + "/guides/canonical-elsewhere.html";
    await writeFile(
      join(overrideRoot, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>' + overrideUrl +
        "</loc><lastmod>2026-06-30</lastmod></url></urlset>\n",
      "utf8"
    );
    await writeFile(
      join(overrideRoot, "guides", "canonical-elsewhere.html"),
      '<link rel="canonical" href="' + BASE_URL + '/services/shoe-bag-care.html">',
      "utf8"
    );
    await generate(root);

    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    expect(sitemapLocs(sitemap)).toContain(overrideUrl);
    expect(sitemapLocs(sitemap)).toContain(BASE_URL + "/posts/2026-07-02-slot-01.html");
    expect(sitemapLocs(sitemap)).not.toContain(canonicalizedUrl);
  });

  it("drops generated URLs whose override HTML canonicalizes elsewhere", async () => {
    const root = newRoot();
    await seedOneDay(root);
    await generate(root);

    const initialSitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const generatedUrl = sitemapLocs(initialSitemap).find((url) => /^\/services\/[^/]+\.html$/u.test(new URL(url).pathname));
    expect(generatedUrl).toBeDefined();
    if (!generatedUrl) throw new Error("fixture generated sitemap has no /services/*.html URL");

    const overrideRoot = join(root, "seo-overrides");
    const overridePath = new URL(generatedUrl).pathname.replace(/^\/+/, "");
    const overrideUrl = BASE_URL + "/guides/hand-maintained.html";
    await mkdir(join(overrideRoot, "services"), { recursive: true });
    await writeFile(
      join(overrideRoot, "sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>' + overrideUrl + "</loc></url></urlset>\n",
      "utf8"
    );
    await writeFile(
      join(overrideRoot, overridePath),
      '<link rel="canonical" href="' + overrideUrl + '">',
      "utf8"
    );
    await generate(root);

    const finalSitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const finalUrls = sitemapLocs(finalSitemap);
    expect(finalUrls).toContain(overrideUrl);
    expect(finalUrls).toContain(BASE_URL + "/posts/2026-07-02-slot-01.html");
    expect(finalUrls).not.toContain(generatedUrl);
  });

  it("injects the latest post into a marked override and preserves all bytes outside the markers", async () => {
    const root = newRoot();
    await seedOneDay(root, {
      1: { topic: "最新鞋包 <測試> & 角落" },
      2: { topic: "較早的短文", facebook_caption: "短文", instagram_caption: "短文" }
    });
    const overrideRoot = join(root, "seo-overrides");
    await mkdir(overrideRoot, { recursive: true });
    const before =
      "<!doctype html>\n<header data-keep=\"前段 & 原樣\">A</header>\n" +
      OPEN_MARKER +
      "<section>2026-09-27 的舊貼文卡片</section>" +
      CLOSE_MARKER +
      "\n<footer data-keep=\"後段\">Z</footer>\n";
    await writeFile(join(overrideRoot, "index.html"), before, "utf8");
    await generate(root);

    const home = await readFile(join(root, "docs", "index.html"), "utf8");
    expect(bytesOutsideMarkers(home)).toBe(bytesOutsideMarkers(before));
    expect(home).toContain(BASE_URL + "/posts/2026-07-02-slot-01.html");
    expect(home).toContain("最新鞋包 &lt;測試&gt; &amp; 角落");
    expect(home).not.toContain("<h3>最新鞋包 <測試> & 角落</h3>");
    expect(home.match(/<!-- SXJ:RECENT_POSTS -->/gu)).toHaveLength(1);
    expect(home.match(/<!-- \/SXJ:RECENT_POSTS -->/gu)).toHaveLength(1);
  });

  it.each([
    ["no markers", "prefix legacy post area suffix"],
    ["unpaired marker", "prefix " + OPEN_MARKER + " legacy post area suffix"],
    ["two pairs", OPEN_MARKER + "one" + CLOSE_MARKER + OPEN_MARKER + "two" + CLOSE_MARKER]
  ])("leaves override bytes unchanged and warns for %s", async (_caseName, before) => {
    const root = newRoot();
    await seedOneDay(root);
    const overrideRoot = join(root, "seo-overrides");
    await mkdir(overrideRoot, { recursive: true });
    await writeFile(join(overrideRoot, "index.html"), before, "utf8");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await generate(root);

    expect(await readFile(join(root, "docs", "index.html"), "utf8")).toBe(before);
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/SXJ:RECENT_POSTS.*not injected/iu));
  });

  it("keeps all approved posts in feed.json even when the SEO thickness gate filters a thin article", async () => {
    const root = newRoot();
    await seedOneDay(root, {
      1: { facebook_caption: THICK_CAPTION, instagram_caption: THICK_CAPTION },
      2: { facebook_caption: "短文", instagram_caption: "短文" }
    });
    await generate(root);

    const feed = JSON.parse(await readFile(join(root, "docs", "feed.json"), "utf8")) as { items: unknown[] };
    // The pre-change fixture has two approved posts; feed membership is intentionally thickness-independent.
    expect(feed.items.length).toBeGreaterThanOrEqual(2);
  });
});
