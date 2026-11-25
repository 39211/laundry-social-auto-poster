import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

const APPROVED_FIRST =
  "台中到府收件、洗好送回：台中全市免費收送、沒有最低消費，一件也收。";
const APPROVED_DESCRIPTION =
  "台中到府收件、洗好送回：台中全市免費收送、沒有最低消費，一件也收。先用 LINE 傳照片確認材質狀態，再約收件時間（LINE 官方 @454foyks，或 LINE 0968327653）。洗鞋一般約一個禮拜可以拿。參考價，看過實品再報價。";
const PICKUP_TITLE = "衣服送洗怎麼約？台中全市免費收送、沒有最低消費，一件也收｜私享家洗衣店";
const ALT = "私享家 旗艦總店";

function readOverride(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function metaContent(html: string, marker: string): string {
  const tag = html.match(new RegExp(`<meta\\b[^>]*${marker}[^>]*>`, "u"))?.[0] ?? "";
  return tag.match(/content="([^"]*)"/u)?.[1] ?? "";
}

function graph(html: string): Array<Record<string, unknown>> {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1] ?? "{}";
  const data = JSON.parse(raw) as { "@graph"?: Array<Record<string, unknown>> };
  return data["@graph"] ?? [];
}

function businessNode(html: string): Record<string, unknown> {
  const node = graph(html).find((item) => item["@type"] === "DryCleaningOrLaundry");
  if (!node) throw new Error("missing DryCleaningOrLaundry node");
  return node;
}

describe("N20 2026-11-26 豪鑫核准：另名與收送頁 description", () => {
  it("公開 business-profile 補 alternate_names「私享家 旗艦總店」，不改 name", () => {
    const profile = JSON.parse(readOverride("business-profile.json")) as {
      name: string;
      google_business_profile_name: string;
      alternate_names: string[];
    };
    expect(profile.name).toBe("私享家洗衣店");
    expect(profile.google_business_profile_name).toBe("私享家洗衣店");
    expect(profile.alternate_names).toContain(ALT);
  });

  it("首頁與收送頁 LocalBusiness（DryCleaningOrLaundry）name 不變，alternateName 含旗艦總店", () => {
    for (const path of ["index.html", "services/taichung-citywide-laundry-pickup.html"]) {
      const node = businessNode(readOverride(path));
      expect(node.name, path).toBe("私享家洗衣店");
      expect(node.alternateName, path).toEqual(expect.arrayContaining([ALT]));
    }
  });

  it("收送頁 title 不動；description 四欄首句為核准句，正文不含舊首句", () => {
    const html = readOverride("services/taichung-citywide-laundry-pickup.html");
    const pageNode = graph(html).find((item) => item["@type"] === "WebPage");
    expect(html.match(/<title>([^<]*)<\/title>/u)?.[1]).toBe(PICKUP_TITLE);
    expect(metaContent(html, 'property="og:title"')).toBe(PICKUP_TITLE);
    expect(metaContent(html, 'name="twitter:title"')).toBe(PICKUP_TITLE);
    expect(pageNode?.name).toBe(PICKUP_TITLE);
    expect(metaContent(html, 'name="description"')).toBe(APPROVED_DESCRIPTION);
    expect(metaContent(html, 'property="og:description"')).toBe(APPROVED_DESCRIPTION);
    expect(metaContent(html, 'name="twitter:description"')).toBe(APPROVED_DESCRIPTION);
    expect(pageNode?.description).toBe(APPROVED_DESCRIPTION);
    expect(APPROVED_DESCRIPTION.startsWith(APPROVED_FIRST)).toBe(true);
    expect(html).not.toContain("衣服送洗怎麼約？台中全市免費收送、沒有最低消費，洗衣、洗鞋、洗包一件也收。");
    expect(html).toContain('<h1 data-reveal="" style="flex:1 1 560px;margin:0;font-size:clamp(48px,8vw,132px);line-height:0.98;letter-spacing:-0.045em;font-weight:900">免費收送，<br><span style="color:var(--color-accent)">一件也收。</span></h1>');
  });
});
