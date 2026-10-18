import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";
import { assertPublicPostsMatchSources, type ConsistencyPost, type DiscoveryPost } from "./helpers/publicPostConsistency";

describe("public post source consistency", () => {
  const root = mkdtempSync(join(tmpdir(), "public-post-consistency-"));
  const docsRoot = join(root, "docs");
  const baseUrl = "https://example.com";
  let posts: ConsistencyPost[];
  let discovery: DiscoveryPost[];

  beforeAll(async () => {
    const json = async (path: string, value: unknown) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, JSON.stringify(value), "utf8");
    };
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "business-profile.json"), await readFile(join(process.cwd(), "data", "business-profile.json")));
    const date = "2026-09-14";
    await json(join(root, "data", "content-calendar", `${date}.json`), {
      date, timezone: "Asia/Taipei", generated_at: `${date}T00:00:00Z`,
      slots: [{ slot: 1, time: "11:30", category: "knowledge", topic: "每日白鞋檢查", facebook_caption: "每日 FB", instagram_caption: "每日 IG", image_prompt: "fixture", local_image_path: `docs/assets/${date}/slot-01.png`, public_image_url: "", status: "pending" }]
    });
    await json(join(root, "data", "approved-log", `${date}.json`), ["facebook", "instagram"].map((platform) => ({ date, slot: 1, platform, status: "approved", approved_by: "Test", created_at: `${date}T00:00:00Z` })));
    // A feature-only day deliberately has no daily content-calendar file.
    await json(join(root, "data", "feature-reels", "2026-09-15.json"), {
      date: "2026-09-15", slug: "shoe-story", youtube_title: "鞋子 & 包包 <檢查>", facebook_caption: "特色 FB & <洗護>\n\n第二段洗護說明", instagram_caption: "特色 IG"
    });
    await json(join(root, "data", "feature-posted-log", "2026-09-15.json"), [{ slug: "shoe-story", platform: "facebook", status: "success", post_id: "123_456", at: "2026-09-15T06:00:00Z" }]);
    await json(join(root, "data", "feature-reels", "2026-09-16.json"), {
      date: "2026-09-16", slug: "video-story", youtube_title: "洗護影片", facebook_caption: "特色影片 FB", instagram_caption: "特色影片 IG"
    });
    await json(join(root, "data", "feature-posted-log", "2026-09-16.json"), [{ slug: "video-story", platform: "youtube", status: "success", post_id: "FeatureVid12", at: "2026-09-16T06:00:00Z" }]);
    await generatePublicSite({ root, baseUrl, now: "2026-09-17T00:00:00Z" });
    posts = JSON.parse(await readFile(join(docsRoot, "social-posts.json"), "utf8")).posts;
    discovery = JSON.parse(await readFile(join(docsRoot, "ai-discovery.json"), "utf8")).published_posts;
  });

  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it("accepts generated daily and feature-only days, including a feature without a thumbnail", async () => {
    expect(posts).toHaveLength(3);
    await assertPublicPostsMatchSources(docsRoot, posts, discovery, baseUrl);
  });

  it.each([
    ["missing daily slot", { slot: 99 }],
    ["daily topic drift", { topic: "錯誤主題" }],
    ["daily Facebook drift", { facebook_caption: "錯誤 FB" }],
    ["daily Instagram drift", { instagram_caption: "錯誤 IG" }],
    ["daily image drift", { image_path: "assets/wrong.png" }],
    ["daily disguised as feature", { feature_reel: true }]
  ] as const)("rejects %s even when discovery agrees", async (_name, change) => {
    const mutated = posts.map((post) => post.slot === 1 ? { ...post, ...change } : post);
    const mirrored = discovery.map((post) => post.slot === 1 ? { ...post, ...change } : post);
    await expect(assertPublicPostsMatchSources(docsRoot, mutated, mirrored, baseUrl)).rejects.toThrow();
  });

  it.each([
    ["feature flag removed", { feature_reel: false }],
    ["feature occupying a daily slot", { slot: 1 }],
    ["wrong feature identity", { id: "urn:sixiangjia:feature:2026-09-14:shoe-story" }],
    ["wrong feature source", { calendar_path: "content-calendar/2026-09-15.json" }],
    ["wrong feature article", { article_path: "posts/2026-09-15-slot-00.html" }],
    ["wrong feature origin", { article_url: "https://other.example/posts/2026-09-15-feature-shoe-story.html" }],
    ["feature Facebook drift", { facebook_caption: "錯誤特色 FB" }]
  ] as const)("rejects %s even when discovery agrees", async (_name, change) => {
    const mutated = posts.map((post) => post.feature_reel ? { ...post, ...change } : post);
    const mirrored = discovery.map((post) => post.slot === 0 ? { ...post, ...change } : post);
    await expect(assertPublicPostsMatchSources(docsRoot, mutated, mirrored, baseUrl)).rejects.toThrow();
  });

  it("rejects feature discovery drift", async () => {
    await expect(assertPublicPostsMatchSources(docsRoot, posts, discovery.map((post) => post.slot === 0 ? { ...post, instagram_caption: "錯誤" } : post), baseUrl)).rejects.toThrow();
  });

  it("rejects feature thumbnail drift even when discovery agrees", async () => {
    const change = { image_url: "https://other.example/wrong.jpg" };
    const mutated = posts.map((post) => post.feature_reel && post.image_url ? { ...post, ...change } : post);
    const mirrored = discovery.map((post) => post.slot === 0 && post.image_url ? { ...post, ...change } : post);
    await expect(assertPublicPostsMatchSources(docsRoot, mutated, mirrored, baseUrl)).rejects.toThrow();
  });

  it("accepts CRLF HTML checkout with LF JSON captions without ignoring text drift", async () => {
    const feature = posts.find((post) => post.feature_reel)!;
    const path = join(docsRoot, feature.article_path!);
    const saved = await readFile(path, "utf8");
    try {
      await writeFile(path, saved.replace(/\r?\n/gu, "\r\n"));
      await assertPublicPostsMatchSources(docsRoot, posts, discovery, baseUrl);
      await writeFile(path, saved.replaceAll("第二段洗護說明", "錯誤的第二段").replace(/\r?\n/gu, "\r\n"));
      await expect(assertPublicPostsMatchSources(docsRoot, posts, discovery, baseUrl)).rejects.toThrow();
    } finally {
      await writeFile(path, saved);
    }
  });

  it.each(["page", "feed"] as const)("rejects a missing feature %s artifact", async (artifact) => {
    const feature = posts.find((post) => post.feature_reel)!;
    const path = join(docsRoot, artifact === "page" ? feature.article_path! : "feed.json");
    const saved = await readFile(path);
    try {
      if (artifact === "page") await rm(path);
      else await writeFile(path, JSON.stringify({ items: [] }));
      await expect(assertPublicPostsMatchSources(docsRoot, posts, discovery, baseUrl)).rejects.toThrow();
    } finally {
      await writeFile(path, saved);
    }
  });
});
