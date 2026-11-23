import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPostPageHtml } from "../src/generatePublicSite";
import { resolvePostTopicCare } from "../src/postTopicCare";

// Public feed captured 2026-11-10. Only the 30 posts then listed in the public
// sitemap are included; sitemap membership is not proof of Google indexing.
const index = JSON.parse(readFileSync(new URL("./fixtures/seo-topic-repair/public-index.json", import.meta.url), "utf8"));
const nodes = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)![1]!)["@graph"];

describe("dot topic repair against the public November post cohort", () => {
  for (const post of index.article_posts) {
    it(`renders ${post.article_path} with matching copy and schema`, () => {
      const care = resolvePostTopicCare(post);
      expect(care, post.topic).toBeDefined();
      const html = buildPostPageHtml(post, index);
      const graph = nodes(html);
      const article = graph.find((node: any) => node["@type"] === "BlogPosting");
      expect(article.description).toContain(care!.description);
      expect(article.articleSection).toBe(care!.family);
      expect(article.keywords).toEqual([...new Set(care!.keywords)]);
      expect(html).toContain(`rel="canonical" href="${post.article_url}"`);
      expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"');
      expect(html).not.toContain("問題類型：");
      expect(html).not.toContain('id="boundaries"');
      for (const point of care!.checkpoints) expect(html.split(point).length - 1).toBe(1);
      const caption = html.match(/<figcaption>(.*?)<\/figcaption>/u)![1]!;
      expect((caption.match(/私享家洗衣店/gu) ?? []).length).toBe(1);
      expect((html.match(/<title>(.*?)<\/title>/u)![1]!.match(/私享家洗衣店/gu) ?? []).length).toBe(1);
      for (const paragraph of care!.paragraphs) expect(html).toContain(paragraph);
      const faq = graph.find((node: any) => node["@type"] === "FAQPage");
      for (const item of faq.mainEntity) {
        expect(html).toContain(item.name);
        expect(html).toContain(item.acceptedAnswer.text);
      }
      expect(article.dateModified).toBe("2026-11-10");
    });
  }
  it("gives each of the 30 published topics a distinct substantive body", () => {
    const bodies = index.article_posts.map((post: { topic: string }) => resolvePostTopicCare(post)!.paragraphs.join("\n"));
    expect(new Set(bodies).size).toBe(index.article_posts.length);
  });
  it("keeps unrelated bedding keywords and suit FAQ out of the damp coat article", () => {
    const post = index.article_posts.find((item: any) => item.article_path === "posts/2026-11-02-slot-01.html");
    const html = buildPostPageHtml(post, index);
    expect(html).not.toContain("西裝多久乾洗");
    expect(html).not.toContain("台中棉被清洗");
    expect(html).toContain("內裡");
  });
});
