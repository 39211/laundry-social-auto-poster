import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/** O10：既有鞋頁補小白鞋／球鞋／網狀球鞋用詞。title／H1／首段對照 CSV；兩則 meta 採行銷必改句。 */
const PAGES = [
  {
    path: "guides/white-shoe-yellowing.html",
    title: "小白鞋變黃怎麼辦？布面、膠邊與鞋底判斷｜私享家洗衣店",
    h1: "小白鞋泛黃怎麼辦？先分清布面、膠邊與鞋底",
    meta: "小白鞋變黃，先分清泛黃在布面、膠邊還是鞋底，再依材質與鞋況判斷。膠邊氧化不一定能去除，別漂白硬刷，也別整雙使用同一種刷法。",
    lead: "小白鞋泛黃時，可以先看變黃的是布面、膠邊還是鞋底；位置與材質不同，適合的處理方式也可能不同。"
  },
  {
    path: "services/white-shoe-cleaning.html",
    title: "白鞋清潔｜小白鞋泛黃、鞋邊與內裡整理｜台中私享家",
    h1: "白鞋清潔：小白鞋泛黃、鞋邊與內裡整理",
    meta: "台中西屯白鞋清潔，小白鞋泛黃、鞋邊髒污與內裡整理，先看材質及實際鞋況再評估。免費收送、沒有最低消費。參考價，看過實品再報價。",
    lead: "日常穿的小白鞋，若出現泛黃、鞋邊髒污或內裡需要整理，可先依鞋面材質與實際鞋況評估清潔方式。"
  },
  {
    path: "guides/mesh-shoe-cleaning.html",
    title: "網狀球鞋怎麼洗？網布透氣層與脫膠先看｜私享家洗衣店",
    h1: "網狀球鞋怎麼洗？先看網布透氣層與脫膠狀況",
    meta: "網狀球鞋怎麼洗？先看網布透氣層、接合處與脫膠狀況，再判斷清潔方式。結果依材質與損況而定，不保證變全新。參考價，看過實品再報價。",
    lead: "網狀球鞋怎麼洗，不能只看表面髒不髒；先確認網布透氣層與接合處狀況，再決定怎麼清潔。"
  },
  {
    path: "guides/athletic-shoe-mixed-materials.html",
    title: "球鞋怎麼清潔？運動鞋網布、膠邊與內裡分開看｜私享家",
    h1: "球鞋清潔：運動鞋網布、膠邊與內裡為什麼不能同一種刷法？",
    meta: "球鞋常有網布、膠邊與內裡等不同材質。運動鞋清潔先分清部位，再依材質與鞋況選擇處理方式。",
    lead: "平常說的球鞋，一雙就可能結合網布、膠邊與內裡等不同材質；清潔時要分開判斷各部位，不能整雙都用同一種刷法。"
  },
  {
    path: "guides/canvas-shoe-mud.html",
    title: "帆布鞋沾泥怎麼清洗？先等乾再判斷｜私享家洗衣店",
    h1: "帆布鞋沾泥怎麼清洗？先等泥乾，再判斷處理方式",
    meta: "帆布鞋沾泥要立刻刷嗎？濕刷會把泥推進織紋、讓纖維起毛，先通風等乾再看。可用 LINE 傳近照，結果依材質與損況而定。私享家洗衣店（台中市西屯區青海路二段365號）。",
    lead: "帆布鞋沾泥後，先別急著加水清洗；等泥乾後，再看帆布表面、縫線與鞋邊的狀況，判斷下一步。"
  }
] as const;

const HUB_SENTENCE = "小白鞋、球鞋、帆布鞋先看材質，再依鞋況閱讀對應指南。";
const HUB_LINKS = [
  "https://sixiangjialaundry.com/guides/white-shoe-yellowing.html",
  "https://sixiangjialaundry.com/guides/mesh-shoe-cleaning.html",
  "https://sixiangjialaundry.com/guides/athletic-shoe-mixed-materials.html",
  "https://sixiangjialaundry.com/guides/canvas-shoe-mud.html"
] as const;
const PROMISE_WORDS = ["洗白", "漂白", "變全新", "台中全市", "除霉"] as const;

function readOverride(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function tagText(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[1] ?? "";
}

function metaContent(html: string, marker: string): string {
  const tag = html.match(new RegExp(`<meta\\b[^>]*${marker}[^>]*>`, "i"))?.[0] ?? "";
  return tag.match(/content="([^"]*)"/)?.[1] ?? "";
}

function webPage(html: string): { name?: string; description?: string } {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}";
  const graph = (JSON.parse(raw) as { "@graph"?: Array<{ "@type"?: string; name?: string; description?: string }> })[
    "@graph"
  ];
  return graph?.find((node) => node["@type"] === "WebPage") ?? {};
}

describe("O10 既有鞋頁口語用詞", () => {
  for (const page of PAGES) {
    it(`${page.path} 的 title、H1、meta、首段對上 CSV`, () => {
      const html = readOverride(page.path);
      const title = tagText(html, /<title>([^<]*)<\/title>/);
      const h1 = tagText(html, /<h1>([^<]*)<\/h1>/);
      const meta = metaContent(html, 'name="description"');
      const lead = tagText(html, /<p class="lead"[^>]*>([\s\S]*?)<\/p>/);
      const pageNode = webPage(html);
      expect(title).toBe(page.title);
      expect(h1).toBe(page.h1);
      expect(meta).toBe(page.meta);
      expect(lead).toBe(page.lead);
      expect(metaContent(html, 'property="og:title"')).toBe(page.title);
      expect(metaContent(html, 'name="twitter:title"')).toBe(page.title);
      expect(metaContent(html, 'property="og:description"')).toBe(page.meta);
      expect(metaContent(html, 'name="twitter:description"')).toBe(page.meta);
      expect(pageNode.name).toBe(page.title);
      expect(pageNode.description).toBe(page.meta);
      const surface = `${title}\n${h1}\n${meta}\n${lead}`
        .replaceAll("別漂白硬刷", "")
        .replaceAll("不保證變全新", "");
      for (const word of PROMISE_WORDS) {
        expect(surface, word).not.toContain(word);
      }
      expect(html).not.toContain("台中全市");
      expect(html).not.toContain("除霉");
    });
  }

  it("白鞋變黃頁保留運動鞋水洗參考價 $250，且不把洗白寫進首段", () => {
    const html = readOverride("guides/white-shoe-yellowing.html");
    expect(html).toContain("一般運動鞋水洗參考價 $250");
    expect(html).toContain("參考價，看過實品再報價");
  });

  it("網布鞋頁仍寫明不保證變全新", () => {
    expect(readOverride("guides/mesh-shoe-cleaning.html")).toContain("不保證變全新");
  });

  it("白鞋服務頁仍提醒不要直接漂白，收送句不含台中全市", () => {
    const html = readOverride("services/white-shoe-cleaning.html");
    expect(html).toContain("不建議直接漂白或硬刷");
    expect(html).toContain("免費收送、沒有最低消費");
    expect(html).not.toContain("台中全市");
  });

  it("鞋 hub 只加一句導覽與四個內鏈，不改 title、H1 與價目", () => {
    const html = readOverride("hubs/shoe-care.html");
    expect(tagText(html, /<title>([^<]*)<\/title>/)).toBe("洗鞋材質總覽｜網布皮革麂皮先分｜私享家洗衣");
    expect(tagText(html, /<h1>([^<]*)<\/h1>/)).toBe(
      "洗鞋材質總覽：先分材質，再看 $250 的參考價。參考價，看過實品再報價。"
    );
    expect(tagText(html, /<p class="lead"[^>]*>([\s\S]*?)<\/p>/)).toBe(
      "私享家洗衣店（台中西屯）洗鞋先分材質，不把整雙鞋當成同一種布。一般運動鞋清潔參考價 $250、皮類運動鞋 $300、混合運動鞋 $350、名牌鞋 $600。參考價，看過實品再報價。不保證變全新，也不承諾除臭。東海沒有門市，免費收送、沒有最低消費。"
    );
    const paragraph = html.match(
      /<p class="section-copy">小白鞋、球鞋、帆布鞋先看材質，再依鞋況閱讀對應指南。([\s\S]*?)<\/p>/
    )?.[0];
    expect(paragraph).toBeDefined();
    expect(paragraph).toContain(HUB_SENTENCE);
    expect(paragraph?.match(/<a\b/g)).toHaveLength(HUB_LINKS.length);
    for (const href of HUB_LINKS) {
      expect(paragraph).toContain(`href="${href}"`);
    }
    expect(html).not.toContain("台中全市");
    expect(html).not.toContain("除霉");
  });
});
