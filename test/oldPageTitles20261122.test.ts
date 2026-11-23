import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/** 2026-11-22 豪鑫核准的舊頁 title／description。四欄同句；金額必須是價目表上的數字。 */
const PAGES = [
  {
    path: "guides/blanket-washing.html",
    title: "毛毯可以烘乾嗎？可以丟洗衣機嗎｜毛毯單人 $200、雙人 $400 參考價｜私享家洗衣店",
    description:
      "毛毯可以烘乾嗎？烘乾要看洗標，洗標沒有明寫可烘乾就不要烘。可以丟洗衣機嗎？先看洗標與厚度：薄毛毯可先試，厚毯、羊毛毯或洗不動的建議送洗，洗後中間層要乾透。私享家洗衣店（台中西屯）毛毯單人 $200、雙人 $400，水洗參考價，乾洗、柔洗另計，看過實品再報價。"
  },
  {
    path: "guides/leather-pants-skirt.html",
    title: "皮褲、皮裙怎麼洗？可以水洗嗎｜皮褲 $700、皮裙 $600 參考價｜私享家洗衣店",
    description:
      "皮褲、皮裙怎麼洗、可以水洗嗎？不能只因為是皮褲就泡水，膝摺、塗層和裡布要先看，彈性皮和已經裂開的塗層先問門市。皮褲 $700、皮裙 $600，水洗參考價，乾洗、柔洗另計，看過實品再報價。補色屬修繕，不包含在清潔內。"
  }
] as const;

const PRICE_LIST_LINES = ["毛毯單人 $200", "毛毯雙人 $400", "皮褲 $700", "皮裙 $600"] as const;

const BANNED = ["保證", "全新", "恢復原色", "除臭", "殺菌", "除蟎", "防水", "賠", "退單", "不下水", "100%", "如新", "陰乾", "本店實拍"] as const;

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function metaContent(html: string, marker: string): string {
  const tag = html.match(new RegExp(`<meta\\b[^>]*${marker}[^>]*>`, "u"))?.[0] ?? "";
  return tag.match(/content="([^"]*)"/u)?.[1] ?? "";
}

describe("2026-11-22 舊頁 title／description", () => {
  for (const page of PAGES) {
    it(`${page.path} 四欄同句、沒有禁字`, () => {
      const html = read(page.path);
      const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1] ?? "{}";
      const nodes = (JSON.parse(raw) as { "@graph": Array<{ "@type"?: string; name?: string; description?: string }> })["@graph"];
      const webPage = nodes.find((node) => node["@type"] === "WebPage");
      expect(html.match(/<title>([^<]*)<\/title>/u)?.[1]).toBe(page.title);
      expect(metaContent(html, 'property="og:title"')).toBe(page.title);
      expect(metaContent(html, 'name="twitter:title"')).toBe(page.title);
      expect(webPage?.name).toBe(page.title);
      expect(metaContent(html, 'name="description"')).toBe(page.description);
      expect(metaContent(html, 'property="og:description"')).toBe(page.description);
      expect(metaContent(html, 'name="twitter:description"')).toBe(page.description);
      expect(webPage?.description).toBe(page.description);
      for (const word of BANNED) {
        expect(page.title, word).not.toContain(word);
        expect(page.description, word).not.toContain(word);
      }
      expect(page.description).toContain("水洗參考價，乾洗、柔洗另計");
      expect(page.description).toContain("看過實品再報價");
    });
  }

  it("金額都在價目表上", () => {
    const list = read("services/taichung-laundry-price-list.html");
    for (const line of PRICE_LIST_LINES) expect(list, line).toContain(line);
  });

  it("皮褲皮裙頁有可見的直接回答段，帶參考價與看過實品再報價", () => {
    const main = read("guides/leather-pants-skirt.html").match(/<main>([\s\S]*?)<\/main>/u)?.[1] ?? "";
    expect(main).toContain(
      "<p>皮褲、皮裙可以水洗嗎？不能只因為是皮褲、皮裙就泡水，膝摺、塗層和裡布要先看；彈性皮和已經裂開的塗層，先問門市。皮褲 $700、皮裙 $600，水洗參考價，乾洗、柔洗另計，參考價，看過實品再報價。補色屬修繕，不包含在清潔內。</p>"
    );
  });
});
