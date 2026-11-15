import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  postDocumentTitle,
  rewritePostDocumentTitle,
  rewriteWebsiteAlternateName,
  SITE_WEBSITE_ALTERNATE_NAMES
} from "../src/generatePublicSite";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

const STORE = "私享家洗衣店";

describe("postDocumentTitle", () => {
  it("topic 已含店名時不再接一次店名", () => {
    const metaTopic = "雪靴怎麼收｜私享家洗衣店";
    expect(postDocumentTitle(metaTopic, STORE)).toBe(metaTopic);
    expect(postDocumentTitle(metaTopic, STORE)).not.toContain(`| ${STORE}`);
  });

  it("topic 不含店名時才在 title 接上店名", () => {
    expect(postDocumentTitle("鞋邊先看縫線", STORE)).toBe(`鞋邊先看縫線 | ${STORE}`);
  });

  it("全形與半形分隔連寫的品牌尾只留一次", () => {
    expect(
      postDocumentTitle("牛仔褲染到淺色鞋：那一道藍怎麼辦｜私享家洗衣店 | 私享家洗衣店", STORE)
    ).toBe("牛仔褲染到淺色鞋：那一道藍怎麼辦｜私享家洗衣店");
    expect(
      postDocumentTitle("雪靴清洗前後對比：水痕別只擦一處｜台中洗鞋 私享家洗衣店 | 私享家洗衣店", STORE)
    ).toBe("雪靴清洗前後對比：水痕別只擦一處｜台中洗鞋 私享家洗衣店");
  });

  it("rewritePostDocumentTitle 只改 title 標籤", () => {
    const html =
      "<title>天絲床組能直接丟洗衣機？先看洗標｜私享家洗衣店 | 私享家洗衣店</title>" +
      '<meta property="og:title" content="天絲床組能直接丟洗衣機？先看洗標｜私享家洗衣店" />';
    const next = rewritePostDocumentTitle(html, STORE);
    expect(next).toContain("<title>天絲床組能直接丟洗衣機？先看洗標｜私享家洗衣店</title>");
    expect(next).not.toContain("｜私享家洗衣店 | 私享家洗衣店");
    expect(next).toContain(
      '<meta property="og:title" content="天絲床組能直接丟洗衣機？先看洗標｜私享家洗衣店" />'
    );
  });

  it("貼文 title 標籤走 postDocumentTitle，og 與 twitter 仍只用 metaTopic", () => {
    const source = readFileSync(join(repoRootFromHere(), "src", "generatePublicSite.ts"), "utf8");
    expect(source).toContain("<title>${escapeHtml(postDocumentTitle(metaTopic, profile.name))}</title>");
    expect(source).toContain('<meta property="og:title" content="${escapeHtml(metaTopic)}" />');
    expect(source).toContain('<meta name="twitter:title" content="${escapeHtml(metaTopic)}" />');
    expect(source).not.toContain("<title>${escapeHtml(`${metaTopic} | ${profile.name}`)}</title>");
  });
});

describe("N12 site name and favicon", () => {
  const root = repoRootFromHere();

  it("WebSite.alternateName 標語會改成短名陣列", () => {
    expect([...SITE_WEBSITE_ALTERNATE_NAMES]).toEqual(["私享家", "私享家精品洗護", "sixiangjialaundry.com"]);
    const html =
      '{"@type":"WebSite","name":"私享家洗衣店","alternateName":"私享家洗衣店｜台中西屯洗衣・洗鞋洗包・免費收送、沒有最低消費"}';
    expect(rewriteWebsiteAlternateName(html)).toBe(
      '{"@type":"WebSite","name":"私享家洗衣店","alternateName":["私享家","私享家精品洗護","sixiangjialaundry.com"]}'
    );
  });

  it("首頁 WebSite.alternateName 已是短名，title 以店名開頭", () => {
    const html = readFileSync(join(root, "seo-overrides", "index.html"), "utf8");
    expect(html).toContain("<title>私享家洗衣店｜台中全市免費收送、沒有最低消費，洗鞋洗包一件也收</title>");
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"alternateName":["私享家","私享家精品洗護","sixiangjialaundry.com"]');
    expect(html).not.toContain(
      '"alternateName":"私享家洗衣店｜台中西屯洗衣・洗鞋洗包・免費收送、沒有最低消費"'
    );
  });

  it("seo-overrides/favicon.ico 存在且至少有 48×48", () => {
    const file = join(root, "seo-overrides", "favicon.ico");
    expect(existsSync(file)).toBe(true);
    const buf = readFileSync(file);
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    const count = buf.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(1);
    const sizes = Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256);
    expect(sizes.some((size) => size >= 48 && size % 48 === 0)).toBe(true);
  });

});
