import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
const script = readFileSync("seo-overrides/scripts/sxj-r10-20261103/posts-data.js", "utf8");
const html = readFileSync("seo-overrides/index.html", "utf8");
describe("R10 live article adapter", () => {
  it("makes newly published articles available to the real homepage filter names", async () => {
    const topics = ["牛津皮鞋", "皮包", "羽絨被", "窗簾", "嬰兒推車", "汽座", "羽絨外套", "冬季床包"];
    const expected = ["accessories", "accessories", "home", "home", "baby", "baby", "clothing", "home"];
    const current = { article_posts: topics.map((topic, i) => ({topic, date:"2026-11-03", article_path:`posts/new-${i}.html`})) };
    const context: any = {window:{}, location:{origin:"https://sixiangjialaundry.com"}, URL,
      fetch: async (url: string) => ({ok:true, json: async () => url === "/social-posts.json" ? current : []})};
    vm.runInNewContext(script, context);
    const posts = await context.window.SXJPosts.load();
    topics.forEach((title, i) => {
      const post = posts.find((p: any) => p.title === title);
      expect(post.category).toBe(expected[i]);
      expect(html).toContain(`data-post-filter="${post.category}"`);
    });
  });
});
