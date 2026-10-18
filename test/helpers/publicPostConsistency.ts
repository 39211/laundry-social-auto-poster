import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

export interface ConsistencyPost {
  id: string;
  date: string;
  slot: number;
  topic: string;
  facebook_caption: string;
  instagram_caption: string;
  image_path: string;
  image_url: string;
  feature_reel?: boolean;
  category?: string;
  media_type?: string;
  calendar_path?: string;
  calendar_url?: string;
  article_path?: string;
  article_url?: string;
}

export type DiscoveryPost = Pick<ConsistencyPost,
  "id" | "date" | "slot" | "topic" | "facebook_caption" | "instagram_caption"
> & { image_url?: string };

// Tests share this gate so negative fixtures exercise the checked-in artifact check.
export async function assertPublicPostsMatchSources(
  docsRoot: string,
  posts: ConsistencyPost[],
  discoveryPosts: DiscoveryPost[],
  baseUrl: string
): Promise<void> {
  const discoveryByKey = new Map(discoveryPosts.map((post) => [`${post.date}-${post.slot}`, post]));
  expect(discoveryByKey.size).toBe(posts.length);
  const calendars = new Map<string, { slots: Array<Record<string, unknown>> }>();
  for (const post of posts) {
    const key = `${post.date}-${post.slot}`;
    expect(discoveryByKey.get(key), key).toMatchObject({
      id: post.id,
      topic: post.topic,
      facebook_caption: post.facebook_caption,
      instagram_caption: post.instagram_caption,
      // Discovery intentionally omits an absent feature thumbnail.
      ...(post.feature_reel === true && !post.image_url ? {} : { image_url: post.image_url })
    });
    if (post.feature_reel === true) {
      expect(discoveryByKey.get(key)?.image_url ?? "", key).toBe(post.image_url);
      // Feature sources/logs are private runtime data, not daily calendars.
      // Validate the independent identity and its checked-in public artifacts.
      const identity = /^urn:sixiangjia:feature:(\d{4}-\d{2}-\d{2}):([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(post.id);
      expect(identity, key).not.toBeNull();
      expect(identity?.[1], key).toBe(post.date);
      expect(post.slot, key).toBe(0);
      expect(post.category, key).toBe("feature-reel");
      expect(post.media_type, key).toBe("reel");
      expect(post.calendar_path, key).toBe(`feature-reels/${post.date}.json`);
      expect(post.calendar_url, key).toBe("");
      expect(post.image_path, key).toBe("");
      const articlePath = `posts/${post.date}-feature-${identity?.[2]}.html`;
      expect(post.article_path, key).toBe(articlePath);
      expect(post.article_url, key).toBe(new URL(articlePath, `${baseUrl.replace(/\/+$/u, "")}/`).href);
      const html = await readFile(join(docsRoot, articlePath), "utf8");
      const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
      expect(html, key).toContain(`<link rel="canonical" href="${escape(post.article_url!)}"`);
      expect(html, key).toContain(`<h1>${escape(post.topic)}</h1>`);
      // Git's Windows checkout converts HTML to CRLF; JSON string values retain LF.
      // Normalize only line endings and keep every caption character significant.
      expect(html.replace(/\r\n/gu, "\n"), key).toContain(
        `<p class="post-caption">${escape(post.facebook_caption).replace(/\r\n/gu, "\n")}</p>`
      );
      const htmlImage = html.match(/<meta property="og:image" content="([^"]*)"/u)?.[1] ?? "";
      expect(htmlImage, key).toBe(escape(post.image_url));
      const feed = JSON.parse(await readFile(join(docsRoot, "feed.json"), "utf8")) as { items: Array<{ id: string; image?: string }> };
      expect(feed.items.filter((item) => item.id === post.id), key).toEqual([expect.objectContaining({
        url: post.article_url, title: post.topic, content_text: post.facebook_caption,
        _sixiangjia: expect.objectContaining({ slot: 0, category: "feature-reel" })
      })]);
      expect(feed.items.find((item) => item.id === post.id)?.image ?? "", key).toBe(post.image_url);
      continue;
    }
    expect([1, 2, 3], key).toContain(post.slot);
    if (!calendars.has(post.date)) {
      calendars.set(
        post.date,
        JSON.parse(await readFile(join(docsRoot, "content-calendar", `${post.date}.json`), "utf8")) as {
          slots: Array<Record<string, unknown>>;
        }
      );
    }
    const slot = calendars.get(post.date)?.slots.find((item) => item.slot === post.slot);
    expect(slot, key).toBeDefined();
    expect(slot?.topic, key).toBe(post.topic);
    expect(slot?.facebook_caption, key).toBe(post.facebook_caption);
    expect(slot?.instagram_caption, key).toBe(post.instagram_caption);
    if (slot?.media_type !== "mixed-carousel") {
      expect(String(slot?.local_image_path ?? "").replace(/^docs\//u, ""), key).toBe(post.image_path);
    }
  }
}
