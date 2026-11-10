import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertPublicFeatureContract } from "./helpers/publicFeatureContract";

const posts = (JSON.parse(readFileSync("docs/social-posts.json", "utf8")) as {
  posts: Record<string, unknown>[]
}).posts.filter(post => post.slot === 0);

describe("checked-in feature public feed contract", () => {
  it("validates every current feature without treating it as a daily slot", () => {
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) assertPublicFeatureContract(post);
  });
  it.each([
    ["slot", 1], ["feature_reel", false], ["feature_reel", undefined],
    ["category", "daily"], ["media_type", "image"], ["image_path", "wrong.png"],
    ["evidence_type", "unpublished"], ["image_paths", ["wrong.png"]],
    ["image_urls", ["https://example.invalid/wrong.png"]], ["carousel_items", [{}]],
    ["calendar_path", "content-calendar/wrong.json"], ["id", "urn:wrong"],
    ["article_path", "posts/wrong.html"], ["url", "urn:wrong"],
    ["platforms", []], ["date_published", "not-a-date"]
  ])("rejects corrupt %s", (field, value) => {
    expect(() => assertPublicFeatureContract({ ...posts[0], [String(field)]: value })).toThrow();
  });
});
