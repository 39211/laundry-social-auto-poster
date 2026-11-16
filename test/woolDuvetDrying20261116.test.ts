import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSitemapLinks, repoRootFromHere } from "../scripts/check-sitemap-links";

const SLUG = "wool-duvet-drying";
const PATH = `/guides/${SLUG}.html`;
const URL = `https://sixiangjialaundry.com${PATH}`;
const LASTMOD = "2026-11-16";
const TITLE = "羊毛被可以烘嗎？先看洗標烘乾符號，不能烘乾的用除溼乾燥｜私享家洗衣店";
const DESCRIPTION =
  "羊毛被可以烘嗎？先看這件洗標上的烘乾符號，不替材質下一定可以烘或一定不能烘的結論。私享家的羊毛被基本上都只能乾洗；洗標不能烘乾的，用店裡的除溼技術快速乾燥。台中全市免費收送、沒有最低消費。";
const H1 = "羊毛被可以烘嗎？怎麼乾？";
const PRICE =
  "價目表上羊毛被 $800 是水洗價；羊毛被基本上只能乾洗，乾洗另計，看過實品再報價。";
const BANNED = [
  "保證",
  "全新",
  "恢復原色",
  "除臭",
  "殺菌",
  "除蟎",
  "防水",
  "賠",
  "退單",
  "不下水",
  "如新",
  "陰乾",
  "本店實拍",
  "烘乾機",
  "晾",
  "曬",
  "白鞋",
  "除霉",
  "FAQPage",
  "HowTo"
];

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), rel), "utf8");
}

function mainOf(html: string): string {
  return html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
}

describe("2026-11-16 羊毛被可以烘嗎", () => {
  const html = read(`seo-overrides${PATH}`);
  const main = mainOf(html);

  it("進 sitemap、llms、answers，lastmod 與 canonical 對得上，且不改舊頁入鏈", () => {
    const report = checkSitemapLinks();
    expect(report.locCount).toBe(224);
    expect(report.missingInbound).toEqual([]);
    expect(report.wrongLastmod).toEqual([]);
    expect(read("seo-overrides/sitemap.xml")).toContain(
      `<loc>${URL}</loc><lastmod>${LASTMOD}</lastmod>`
    );
    expect(html).toContain(`<link rel="canonical" href="${URL}" />`);
    expect(html).toContain(`"dateModified":"${LASTMOD}"`);
    expect(html).toContain(`<time datetime="${LASTMOD}">`);
    expect(html).not.toContain("noindex");
    for (const rel of ["seo-overrides/llms.txt", "seo-overrides/.well-known/llms.txt"]) {
      expect(read(rel), rel).toContain(URL);
    }
    const answers = JSON.parse(read("seo-overrides/answers.json")) as {
      answers: Array<{ id: string; source_url: string; answer: string; local_intent: string }>;
    };
    const hit = answers.answers.find((item) => item.id === `${SLUG}-page-summary`);
    expect(hit?.source_url).toBe(URL);
    expect(hit?.local_intent).toBe("羊毛被可以烘嗎");
    expect(hit?.answer).toContain(PRICE);
    expect(hit?.answer).toContain("只能淡化");
    expect(JSON.stringify(hit)).not.toMatch(/保證|全新|陰乾|除臭|殺菌|除蟎/);
    for (const oldPage of [
      "seo-overrides/guides/wool-duvet-washing.html",
      "seo-overrides/guides/down-duvet-washing.html",
      "seo-overrides/guides/bedding-duvet-cleaning.html",
      "seo-overrides/guides/summer-quilt-washing.html",
      "seo-overrides/guides/blanket-washing.html",
      "seo-overrides/guides/leather-belt-care.html",
      "seo-overrides/hubs/bedding-textile-care.html",
      "seo-overrides/services/duvet-bedding-cleaning.html"
    ]) {
      expect(read(oldPage), oldPage).not.toContain(SLUG);
    }
  });

  it("title、description、H1、首段與 JSON-LD 對得上，且不做 FAQ rich result", () => {
    expect(html.match(/<title>(.*?)<\/title>/)?.[1]).toBe(TITLE);
    expect(html.match(/<meta property="og:title" content="(.*?)"/)?.[1]).toBe(TITLE);
    expect(html.match(/<meta name="twitter:title" content="(.*?)"/)?.[1]).toBe(TITLE);
    expect(html.match(/<meta name="description" content="(.*?)"/)?.[1]).toBe(DESCRIPTION);
    expect(DESCRIPTION).not.toContain("$800");
    expect(html.match(/<meta property="og:description" content="(.*?)"/)?.[1]).toBe(DESCRIPTION);
    expect(html.match(/<meta name="twitter:description" content="(.*?)"/)?.[1]).toBe(DESCRIPTION);
    const h1 = main.match(/<h1>(.*?)<\/h1>/)?.[1] ?? "";
    const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(h1).toBe(H1);
    expect(lead.startsWith(h1)).toBe(true);
    const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}";
    const graph = JSON.parse(raw)["@graph"] as Array<Record<string, unknown>>;
    const types = graph.map((node) => node["@type"]);
    expect(types).toContain("WebPage");
    expect(types).toContain("BreadcrumbList");
    expect(types).not.toContain("FAQPage");
    expect(types).not.toContain("HowTo");
    const webPage = graph.find((node) => node["@type"] === "WebPage");
    expect(webPage?.name).toBe(TITLE);
    expect(webPage?.description).toBe(DESCRIPTION);
    expect(webPage?.dateModified).toBe(LASTMOD);
    expect((main.match(/data-aeo-faq/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(main).not.toContain("<img");
  });

  it("正文只鎖烘與乾燥，價格句全頁兩次，且不踩禁用詞", () => {
    expect(main).toContain("烘乾符號");
    expect(main).toContain("單獨一件清洗、依洗標");
    expect(main).toContain("除溼技術快速乾燥");
    expect(main).toContain("只能淡化");
    expect(main).toContain("特殊處理劑");
    expect(main).toContain("不替任何材質下一定可以烘或一定不能烘的結論");
    expect(main).toContain("台中全市免費收送、沒有最低消費");
    expect(main).toContain("青海路二段365號");
    expect(main).toContain("@454foyks");
    expect(main).toContain("0968327653");
    expect(main).toContain("東海只有收送");
    expect(main).toContain("羊毛被可以水洗嗎");
    expect(main).not.toContain("這幾件事先講清楚");
    expect(main).not.toContain("所以上面這一列不是看過實品前的成交價");
    expect(main).not.toContain("參考價，看過實品再報價");
    expect(main).not.toContain("基本上都只能乾洗");
    expect(main).not.toMatch(/\d+\s*天/);
    expect(main).not.toContain("一個禮拜");
    const faqs = main.match(/<article class="card" data-aeo-faq>[\s\S]*?<\/article>/g) ?? [];
    expect(faqs).toHaveLength(6);
    const body = faqs.reduce((text, block) => text.replace(block, ""), main);
    expect(body.split(PRICE)).toHaveLength(2);
    expect(faqs[5]).toContain(PRICE);
    expect(faqs.slice(0, 5).join("")).not.toContain("$800");
    expect(body.split("台中全市免費收送、沒有最低消費")).toHaveLength(2);
    expect(body.split("單獨一件清洗、依洗標")).toHaveLength(2);
    expect(body.split("不替任何材質下一定可以烘或一定不能烘的結論")).toHaveLength(2);
    expect(body.split("除溼技術快速乾燥")).toHaveLength(2);
    expect(html.split(PRICE)).toHaveLength(3);
    expect(html.match(/\$800/g)).toHaveLength(2);
    for (const word of BANNED) expect(main, word).not.toContain(word);
    expect(main.replaceAll("最低消費", "")).not.toContain("最");
    expect(main.replaceAll("免費收送", "")).not.toContain("免費");
    expect(main.replaceAll("台中全市免費收送", "")).not.toContain("台中全市");
  });
});
