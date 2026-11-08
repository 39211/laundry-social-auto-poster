import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postDocumentTitle } from "../src/generatePublicSite";
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

  it("貼文 title 標籤走 postDocumentTitle，og 與 twitter 仍只用 metaTopic", () => {
    const source = readFileSync(join(repoRootFromHere(), "src", "generatePublicSite.ts"), "utf8");
    expect(source).toContain("<title>${escapeHtml(postDocumentTitle(metaTopic, profile.name))}</title>");
    expect(source).toContain('<meta property="og:title" content="${escapeHtml(metaTopic)}" />');
    expect(source).toContain('<meta name="twitter:title" content="${escapeHtml(metaTopic)}" />');
    expect(source).not.toContain("<title>${escapeHtml(`${metaTopic} | ${profile.name}`)}</title>");
  });
});
