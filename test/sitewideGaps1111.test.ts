import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "seo-overrides");

function mainOf(rel: string): string {
  const html = readFileSync(join(ROOT, rel), "utf8");
  return (html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "").replace(/<script[\s\S]*?<\/script>/g, "");
}

describe("11/11 全站缺口補齊（B 批）", () => {
  it("樞紐與服務頁的正文都有 LINE 與免費收送句", () => {
    for (const rel of [
      "hubs/bag-care.html",
      "hubs/luxury-garment-care.html",
      "hubs/shoe-care.html",
      "services/business-bulk-laundry.html",
      "services/luxury-garment-cleaning.html"
    ]) {
      const main = mainOf(rel);
      expect(main, rel).toContain("@454foyks");
      expect(main, rel).toContain("0968327653");
      expect(main, rel).toContain("免費收送");
    }
  });

  it("所有在地收送頁的正文都回答「收送要錢嗎」", () => {
    const dir = join(ROOT, "local");
    const pages = readdirSync(dir).filter((name) => name.endsWith("-laundry-pickup.html"));
    expect(pages.length).toBeGreaterThanOrEqual(20);
    for (const name of pages) {
      const main = mainOf(`local/${name}`);
      expect(main, name).toContain("免費收送");
      expect(main, name).toContain("沒有最低消費");
    }
  });

  it("頁尾「洗衣收送要錢嗎？」H2 的 19 頁：直接答案框最後一句也寫免費收送、沒有最低消費（行銷 Q3）", () => {
    const rels = [
      "guides/coin-laundry-vs-pickup.html", "guides/trench-coat-cleaning.html", "guides/wallet-cleaning-check.html", "services/postpartum-center-laundry.html",
      ...["central-district", "dadu", "dali", "daya", "east-district", "houli", "shalu", "shengang", "south-district", "taiping", "tanzi", "west-district", "wufeng", "wuqi", "wuri"].map((d) => `local/${d}-laundry-pickup.html`)
    ];
    expect(rels.length).toBe(19);
    for (const rel of rels) {
      const html = readFileSync(join(ROOT, rel), "utf8");
      const box = html.match(/<div class="answer-box">([\s\S]*?)<\/div>/u);
      expect(box, rel).not.toBeNull();
      expect((box?.[1] ?? "").replace(/<[^>]+>/gu, "").trim().endsWith("免費收送、沒有最低消費。"), rel).toBe(true);
      expect(html, rel).toContain("<h2>洗衣收送要錢嗎？</h2>");
    }
  });
});
