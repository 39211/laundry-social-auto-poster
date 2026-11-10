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
});
