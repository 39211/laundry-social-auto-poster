import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_LOC_COUNT,
  checkSitemapLinks,
  repoRootFromHere,
  sitemapLinkReportFailed
} from "../scripts/check-sitemap-links";

const SITE = "https://sixiangjialaundry.com";

const SLUGS = [
  "valet-laundry-pricing-guide",
  "fine-laundry-vs-regular-wash",
  "cloth-shoe-washing-guide",
  "wool-duvet-accidentally-washed",
  "trench-coat-tumble-dry-limit",
  "what-is-wool-felting",
  "genuine-leather-bag-wash-limit",
  "leather-jacket-wash-or-not",
  "pants-tumble-dry-shrink",
  "wool-cotton-quilt-washing"
] as const;

const BANNED = [
  "恢復原色",
  "變全新",
  "如新",
  "像新的一樣",
  "除臭",
  "殺菌",
  "滅菌",
  "除霉",
  "保證",
  "100%",
  "最好",
  "第一",
  "唯一",
  "洗乾淨",
  "煥然一新",
  "不下水",
  "陰乾",
  "台中全市",
  "全新",
  "除蟎",
  "防水",
  "賠",
  "退單",
  "本店實拍",
  "白鞋",
  "小白鞋",
  "上色覆蓋",
  "本頁",
  "這頁",
  "只補"
] as const;

function readOv(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function mainOf(html: string): string {
  return html.match(/<main>([\s\S]*?)<\/main>/u)?.[1] ?? "";
}

describe("2026-11-26 週四指南 10 頁", () => {
  it("sitemap 為 379，新頁 lastmod 是 2026-11-26", () => {
    const report = checkSitemapLinks();
    expect(report.locCount).toBe(379);
    expect(EXPECTED_LOC_COUNT).toBe(379);
    expect(sitemapLinkReportFailed(report)).toBe(false);
    const sitemap = readOv("sitemap.xml");
    for (const slug of SLUGS) {
      expect(sitemap, slug).toContain(`<loc>${SITE}/guides/${slug}.html</loc><lastmod>2026-11-26</lastmod>`);
    }
  });

  it("每頁可獨立閱讀，價格、收送與禁詞符合規範", () => {
    const prices = JSON.parse(readFileSync(join(repoRootFromHere(), "data", "prices.json"), "utf8")) as Record<
      string,
      Record<string, number> | string
    >;
    const allowed = new Set<string>();
    for (const [cat, val] of Object.entries(prices)) {
      if (cat === "note" || typeof val !== "object" || !val) continue;
      for (const price of Object.values(val)) allowed.add(`$${price}`);
    }
    const llms = readOv("llms.txt");
    expect(llms).toBe(readOv(".well-known/llms.txt"));
    const knowledge = readOv("knowledge/index.html");
    const discovery = JSON.parse(readOv("ai-discovery.json")) as {
      recommended_read_order: string[];
      support_pages: Array<{ slug: string; url: string }>;
    };
    const answers = JSON.parse(readOv("answers.json")) as {
      answers: Array<{ source_url: string; question: string; answer: string }>;
    };
    expect(answers.answers).toHaveLength(630);

    for (const slug of SLUGS) {
      const html = readOv(`guides/${slug}.html`);
      const main = mainOf(html);
      const url = `${SITE}/guides/${slug}.html`;
      const title = html.match(/<title>([^<]*)<\/title>/u)?.[1] ?? "";
      const description = html.match(/<meta name="description" content="([^"]*)"/u)?.[1] ?? "";
      expect(html, slug).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html.match(/<h1\b/gu), slug).toHaveLength(1);
      expect(html, slug).not.toContain("<video");
      expect(html, slug).not.toContain("<iframe");
      expect(main, slug).toContain("一律先看洗標，照洗標做。");
      expect(main, slug).toContain("東海只有收送");
      expect(main, slug).toContain("青海路二段365號");
      expect(main, slug).toContain("台中市全區免費收送、沒有最低消費");
      expect(main, slug).toContain("@454foyks");
      expect(main, slug).toContain("04-2452-7411");
      expect(main, slug).toContain("看過實品再報價");
      expect(main.match(/data-aeo-faq/gu)?.length ?? 0, slug).toBeGreaterThanOrEqual(3);
      expect(knowledge, slug).toContain(`href="${url}"`);
      expect(llms, slug).toContain(url);
      expect(discovery.recommended_read_order, slug).toContain(url);
      expect(discovery.support_pages.some((page) => page.slug === slug && page.url === url), slug).toBe(true);

      const dollars = main.match(/\$\d+/g) ?? [];
      if (dollars.length > 0) {
        expect(main, slug).toContain("參考價");
        for (const price of dollars) expect(allowed.has(price), `${slug} ${price}`).toBe(true);
      }
      for (const word of BANNED) {
        expect(main, `${slug} main ${word}`).not.toContain(word);
        expect(title, `${slug} title ${word}`).not.toContain(word);
        expect(description, `${slug} description ${word}`).not.toContain(word);
      }

      const entry = answers.answers.find((item) => item.source_url === url);
      expect(entry, slug).toBeTruthy();
      for (const word of BANNED) {
        expect(entry?.question, `${slug} q ${word}`).not.toContain(word);
        expect(entry?.answer, `${slug} a ${word}`).not.toContain(word);
      }
    }
  });
});
