import { expect } from "vitest";

/** Feature posts originate in feature-reels, not the daily calendar's slots.
 * This is a public-artifact shape check, not proof of private approval records.
 * Publication authorization remains covered by generator fixture tests.
 */
export function assertPublicFeatureContract(post: Record<string, unknown>): void {
  const key = `${post.date}-${post.slot}`;
  expect(post.slot, key).toBe(0);
  expect(post.feature_reel, key).toBe(true);
  expect(post.category, key).toBe("feature-reel");
  expect(post.media_type, key).toBe("reel");
  expect(post.evidence_type, key).toBe("published-feature-reel");
  expect(post.image_path, key).toBe("");
  expect(post.image_paths, key).toEqual([]);
  expect(post.image_urls, key).toEqual([]);
  expect(post.carousel_items, key).toEqual([]);
  expect(post.calendar_path, key).toBe(`feature-reels/${post.date}.json`);
  expect(typeof post.id, key).toBe("string");
  const prefix = `urn:sixiangjia:feature:${post.date}:`;
  expect(String(post.id).startsWith(prefix), key).toBe(true);
  const slug = String(post.id).slice(prefix.length);
  expect(slug, key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  expect(post.article_path, key).toBe(`posts/${post.date}-feature-${slug}.html`);
  expect(post.url, key).toBe(post.id);
  expect(Array.isArray(post.platforms), key).toBe(true);
  expect((post.platforms as unknown[]).length, key).toBeGreaterThan(0);
  expect(Number.isFinite(Date.parse(String(post.date_published))), key).toBe(true);
}
