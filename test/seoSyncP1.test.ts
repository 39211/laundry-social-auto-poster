import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";

const BASE_URL = "https://example.com";
const DATE = "2026-07-02";
const GENERATED_AT = "2026-07-03T03:00:00.000Z";
const THICK_CAPTION = [
  "白鞋鞋邊一圈灰，多半是髒不是黃。",
  "先看膠邊：灰是可以清的髒，黃是氧化，只能淡化、不保證回白。鞋內有濕悶味就先通風、取出鞋墊，不要高溫烘。",
  "拍整體、鞋邊近照與鞋內，傳 LINE 門市先看材質，再說能整理到什麼程度。台中市全區可約免費收送。"
].join("\n\n");

const roots: string[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "seo-sync-p1-"));
  roots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function seedCalendar(root: string): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  const profile = await readFile(join(process.cwd(), "data", "business-profile.json"), "utf8");
  await writeFile(join(root, "data", "business-profile.json"), profile, "utf8");
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
  const slots = [1, 2].map((slot) => ({
    slot,
    time: slot === 1 ? "11:30" : "19:30",
    category: slot === 1 ? "knowledge" : "situation",
    topic: slot === 1 ? "白鞋鞋邊檢查" : "包角檢查",
    instagram_caption: THICK_CAPTION,
    facebook_caption: THICK_CAPTION,
    image_prompt: "fixture image prompt",
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    search_intent: "problem-diagnosis",
    target_queries: ["台中洗鞋店", "白鞋清潔"],
    evidence_type: "first-party-inspection",
    local_image_path: "fixture-image.png",
    public_image_url: "",
    status: "pending",
    date: DATE
  }));
  const calendar = { date: DATE, timezone: "Asia/Taipei", generated_at: `${DATE}T00:00:00.000Z`, slots };
  const serialized = JSON.stringify(calendar, null, 2) + "\n";
  await Promise.all([
    writeFile(join(root, "data", "content-calendar", `${DATE}.json`), serialized, "utf8"),
    writeFile(join(root, "docs", "content-calendar", `${DATE}.json`), serialized, "utf8")
  ]);
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  const approvals = [1, 2].flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date: DATE,
      slot,
      platform,
      status: "approved",
      approved_by: "SEO Sync P1 test",
      note: "Fixture approval",
      created_at: `${DATE}T02:20:00.000Z`
    }))
  );
  await writeJson(join(root, "data", "approved-log", `${DATE}.json`), approvals);
}

async function generate(root: string, now = GENERATED_AT): Promise<void> {
  await generatePublicSite({
    root,
    siteBaseUrl: `${BASE_URL}/`,
    imageBaseUrl: `${BASE_URL}/`,
    now
  });
}

async function postHtml(root: string, filename = `${DATE}-slot-01.html`): Promise<string> {
  return readFile(join(root, "docs", "posts", filename), "utf8");
}

async function writePublicationLog(root: string, directory: string, filename: string, entries: unknown): Promise<void> {
  await writeJson(join(root, "data", directory, filename), entries);
}

function videoObjectFrom(html: string): Record<string, unknown> | undefined {
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1];
  if (!jsonLd) return undefined;
  const parsed = JSON.parse(jsonLd) as { "@graph"?: Array<Record<string, unknown>> };
  return parsed["@graph"]?.find((entry) => entry["@type"] === "VideoObject");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SEO-SYNC-P1 public publication sync", () => {
  it("embeds a public YouTube upload and its VideoObject metadata", async () => {
    const root = newRoot();
    await seedCalendar(root);
    await writePublicationLog(root, "youtube-log", `${DATE}.json`, [
      { date: DATE, slot: 1, video_id: "AbCdEfGh123", title: "來源標題", uploaded_at: "2026-07-02T04:10:00Z" }
    ]);
    await generate(root);

    const html = await postHtml(root);
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/AbCdEfGh123"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(`href="https://www.youtube.com/shorts/AbCdEfGh123"`);
    expect(html).toContain("在 YouTube 觀看");
    expect(videoObjectFrom(html)).toMatchObject({
      "@type": "VideoObject",
      name: `${DATE} 11:30 白鞋鞋邊檢查`,
      thumbnailUrl: "https://i.ytimg.com/vi/AbCdEfGh123/hqdefault.jpg",
      uploadDate: "2026-07-02T04:10:00.000Z",
      embedUrl: "https://www.youtube-nocookie.com/embed/AbCdEfGh123"
    });
  });

  it("keeps a future scheduled YouTube upload off the page", async () => {
    const root = newRoot();
    await seedCalendar(root);
    await writePublicationLog(root, "youtube-log", `${DATE}.json`, [
      {
        date: DATE,
        slot: 1,
        video_id: "FutureVid123",
        title: "尚未公開",
        uploaded_at: "2026-07-02T04:10:00Z",
        scheduled_publish_at: "2026-07-03T04:00:00Z"
      }
    ]);
    await generate(root);

    const html = await postHtml(root);
    expect(html).not.toContain("youtube-nocookie.com/embed/FutureVid123");
    expect(html).not.toContain("youtube.com/shorts/FutureVid123");
    expect(html).not.toContain('"@type":"VideoObject"');
  });

  it("embeds a scheduled YouTube upload once its publish time has arrived", async () => {
    const root = newRoot();
    await seedCalendar(root);
    await writePublicationLog(root, "youtube-log", `${DATE}.json`, [
      {
        date: DATE,
        slot: 1,
        video_id: "DueVideo1234",
        title: "已到公開時間",
        uploaded_at: "2026-07-02T04:10:00Z",
        scheduled_publish_at: "2026-07-03T02:45:00Z"
      }
    ]);
    await generate(root);

    const html = await postHtml(root);
    expect(html).toContain("youtube-nocookie.com/embed/DueVideo1234");
    expect(videoObjectFrom(html)).toMatchObject({ uploadDate: "2026-07-03T02:45:00.000Z" });
  });

  it("links a successful Facebook post by its page and post ids", async () => {
    const root = newRoot();
    await seedCalendar(root);
    await writePublicationLog(root, "posted-log", `${DATE}.json`, [
      { date: DATE, slot: 1, platform: "facebook", status: "success", dry_run: false, post_id: "123456789_987654321" }
    ]);
    await generate(root);

    const html = await postHtml(root);
    expect(html).toContain('href="https://www.facebook.com/123456789/posts/987654321"');
    expect(html).toContain("在 Facebook 看原文");
  });

  it("publishes feature reels in the hub, JSON feed, and both sitemaps", async () => {
    const root = newRoot();
    await seedCalendar(root);
    await writeJson(join(root, "data", "feature-reels", `${DATE}.json`), {
      date: DATE,
      slug: "white-shoe-story",
      video_url: "https://cdn.example.com/feature.mp4",
      local_video_path: "",
      facebook_caption:
        "白鞋清潔先確認鞋面與膠邊狀態。\n\n門市依材質選擇清潔方式，先說明可處理的範圍與限制。不同材質、氧化程度與磨損位置都會改變整理結果，不會承諾一定回到全白。\n\n送件前拍整體、鞋面近照與膠邊細節，私享家會先看材質與痕跡，再說明能整理到什麼程度。台中市全區可約免費收送，清潔費依物件狀態另計。",
      instagram_caption: "短版社群文案",
      youtube_title: "白鞋鞋邊清潔紀錄",
      youtube_description: "門市先看材質與鞋邊氧化程度。",
      youtube_tags: ["白鞋清潔"]
    });
    await writePublicationLog(root, "feature-posted-log", `${DATE}.json`, [
      {
        platform: "youtube",
        slug: "white-shoe-story",
        status: "scheduled",
        post_id: "FeatureVid12",
        scheduled_publish_at: "2026-07-02T05:00:00Z",
        at: "2026-07-02T04:30:00Z"
      },
      {
        platform: "facebook",
        slug: "white-shoe-story",
        status: "success",
        post_id: "123456789_555666777",
        at: "2026-07-02T04:35:00Z"
      }
    ]);
    await generate(root);

    const filename = `${DATE}-feature-white-shoe-story.html`;
    const url = `${BASE_URL}/posts/${filename}`;
    const [feature, hub, feedText, sitemap, aiSitemap] = await Promise.all([
      postHtml(root, filename),
      readFile(join(root, "docs", "posts", "index.html"), "utf8"),
      readFile(join(root, "docs", "feed.json"), "utf8"),
      readFile(join(root, "docs", "sitemap.xml"), "utf8"),
      readFile(join(root, "docs", "ai-sitemap.xml"), "utf8")
    ]);
    const feed = JSON.parse(feedText) as { items: Array<{ url: string; title: string }> };
    expect(feature).toContain("白鞋鞋邊清潔紀錄");
    expect(feature).toContain("youtube-nocookie.com/embed/FeatureVid12");
    expect(feature).toContain("facebook.com/123456789/posts/555666777");
    expect(hub).toContain(url);
    expect(feed.items).toContainEqual(expect.objectContaining({ url, title: "白鞋鞋邊清潔紀錄" }));
    expect(sitemap).toContain(url);
    expect(aiSitemap).toContain(url);
  });

  it("does not generate a future-dated feature reel even if its log says success", async () => {
    const root = newRoot();
    await seedCalendar(root);
    const futureDate = "2026-07-04";
    await writeJson(join(root, "data", "feature-reels", `${futureDate}.json`), {
      date: futureDate,
      slug: "future-feature",
      video_url: "https://cdn.example.com/future.mp4",
      facebook_caption: THICK_CAPTION,
      instagram_caption: THICK_CAPTION,
      youtube_title: "未來日期影片"
    });
    await writePublicationLog(root, "feature-posted-log", `${futureDate}.json`, [
      { platform: "facebook", slug: "future-feature", status: "success", post_id: "123456789_222333444", at: "2026-07-02T04:35:00Z" }
    ]);
    await generate(root);

    const [hub, feedText, sitemap, aiSitemap] = await Promise.all([
      readFile(join(root, "docs", "posts", "index.html"), "utf8"),
      readFile(join(root, "docs", "feed.json"), "utf8"),
      readFile(join(root, "docs", "sitemap.xml"), "utf8"),
      readFile(join(root, "docs", "ai-sitemap.xml"), "utf8")
    ]);
    expect(hub).not.toContain("2026-07-04-feature-future-feature.html");
    expect(feedText).not.toContain("未來日期影片");
    expect(sitemap).not.toContain("2026-07-04-feature-future-feature.html");
    expect(aiSitemap).not.toContain("2026-07-04-feature-future-feature.html");
  });

  it("leaves a post with no publication records byte-identical to the pre-sync renderer", async () => {
    const root = newRoot();
    await seedCalendar(root);
    await generate(root);
    const html = await postHtml(root);
    const digest = createHash("sha256").update(html, "utf8").digest("hex");
    expect(digest).toBe("f648f67fc4dacf337588b1efc343a2e5b4a84d1ae4ab4681b6f1c6f2d3d7d120");
  });
});
