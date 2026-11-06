import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

const TITLE = "合成皮掉屑怎麼處理？脫皮先停手，能做與不能做｜私享家洗衣店";
const OPENING =
  "合成皮若已老化掉屑、脫皮，無法靠清洗恢復；先別反覆擦拭，拍照傳到 LINE 問，能否處理需看過實品再說明。";
const PICKUP = "免費收送、沒有最低消費";
const BANNED = [
  "換皮",
  "改色",
  "另估",
  "能處理的是清掉碎屑、避免擴大",
  "是否能修補需看實品",
  "台中全市",
  "洗白",
  "修繕",
  "另計",
  "修補",
  "能不能做、怎麼算",
  "避免擴大"
] as const;

function readRepo(rel: string): Promise<string> {
  return readFile(join(repoRootFromHere(), rel), "utf8");
}

function pageNodes(html: string): Array<Record<string, unknown>> {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}";
  const parsed = JSON.parse(raw) as { "@graph"?: Array<Record<string, unknown>> };
  return parsed["@graph"] ?? [];
}

function mainOf(html: string): string {
  return html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? "";
}

describe("合成皮掉屑指南措辭", () => {
  it("title 與首段第一句照核准稿", async () => {
    const html = await readRepo("seo-overrides/guides/pu-leather-peeling.html");
    expect(html).toContain(`<title>${TITLE}</title>`);
    expect(html).toContain(`property="og:title" content="${TITLE}"`);
    expect(html).toContain(`name="twitter:title" content="${TITLE}"`);
    const webpage = pageNodes(html).find((node) => node["@type"] === "WebPage");
    expect(webpage?.name).toBe(TITLE);
    const lead = mainOf(html).match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    const firstParagraph = mainOf(html).match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(lead.startsWith(OPENING)).toBe(true);
    expect(firstParagraph.startsWith(OPENING)).toBe(true);
    expect(lead.match(/^[^。]*。/)?.[0]).toBe(OPENING);
  });

  it("正文保留清洗限制，不承諾復原、不再掉屑、洗白或全新，收送只寫免費收送", async () => {
    const html = await readRepo("seo-overrides/guides/pu-leather-peeling.html");
    const main = mainOf(html);
    for (const phrase of BANNED) {
      expect(html, phrase).not.toContain(phrase);
    }
    expect(main).toContain("無法靠清洗恢復");
    expect(main).toContain("清洗補不回");
    expect(main).toContain("不保證不再掉屑");
    expect(main).toContain("不保證恢復");
    expect(main).toMatch(/不保證[^。]{0,40}變全新/);
    expect(main).toContain(PICKUP);
    expect(main).not.toContain("台中全市");
    let cursor = 0;
    while (cursor < main.length) {
      const at = main.indexOf("全新", cursor);
      if (at < 0) break;
      expect(main.slice(Math.max(0, at - 24), at)).toContain("不保證");
      cursor = at + 2;
    }
    cursor = 0;
    while (cursor < main.length) {
      const at = main.indexOf("不再掉屑", cursor);
      if (at < 0) break;
      expect(main.slice(Math.max(0, at - 16), at)).toContain("不保證");
      cursor = at + 4;
    }
  });

  it("FAQ 可見答案與 JSON-LD 一致，且不含修補報價", async () => {
    const html = await readRepo("seo-overrides/guides/pu-leather-peeling.html");
    const faq = pageNodes(html).find((node) => node["@type"] === "FAQPage") as
      | { mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }> }
      | undefined;
    const items = faq?.mainEntity ?? [];
    expect(items.length).toBeGreaterThanOrEqual(8);
    for (const item of items) {
      const text = item.acceptedAnswer?.text ?? "";
      expect(mainOf(html), item.name).toContain(`<h3>${item.name ?? ""}</h3>`);
      expect(mainOf(html), text).toContain(`<p>${text}</p>`);
      for (const phrase of BANNED) {
        expect(text, phrase).not.toContain(phrase);
      }
    }
  });

  it("answers.json 這頁摘要以同一句開頭", async () => {
    const answers = JSON.parse(await readRepo("seo-overrides/answers.json")) as {
      answers: Array<{ id: string; question: string; answer: string }>;
    };
    const entry = answers.answers.find((item) => item.id === "pu-leather-peeling-page-summary");
    expect(entry?.answer.startsWith(OPENING)).toBe(true);
    const blob = `${entry?.question ?? ""}\n${entry?.answer ?? ""}`;
    for (const phrase of BANNED) {
      expect(blob, phrase).not.toContain(phrase);
    }
    expect(blob).toContain("不保證不再掉屑");
    expect(blob).toMatch(/不保證[^。]{0,40}變全新/);
  });

  it("generatePublicSite 把這頁原樣寫進 docs", async () => {
    const repo = repoRootFromHere();
    const root = await mkdtemp(join(tmpdir(), "pu-leather-peeling-"));
    await mkdir(join(root, "data"), { recursive: true });
    await mkdir(join(root, "seo-overrides", "guides"), { recursive: true });
    await cp(join(repo, "data", "business-profile.json"), join(root, "data", "business-profile.json"));
    await cp(
      join(repo, "seo-overrides", "guides", "pu-leather-peeling.html"),
      join(root, "seo-overrides", "guides", "pu-leather-peeling.html")
    );
    await generatePublicSite({
      root,
      baseUrl: "https://sixiangjialaundry.com",
      now: "2026-11-06T02:00:00.000Z",
      onlyDocsPaths: ["guides/pu-leather-peeling.html"]
    });
    const generated = await readFile(join(root, "docs", "guides", "pu-leather-peeling.html"), "utf8");
    const source = await readFile(join(repo, "seo-overrides", "guides", "pu-leather-peeling.html"), "utf8");
    expect(generated).toBe(source);
    expect(generated).toContain(`<title>${TITLE}</title>`);
    expect(generated).toContain(OPENING);
  });
});
