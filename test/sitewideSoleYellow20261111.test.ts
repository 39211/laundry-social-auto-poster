import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/**
 * 2026-11-11 全站同步：球鞋鞋底、膠邊發黃用上色覆蓋處理（不是洗白），
 * 不得再寫成「只能淡化」。核定句來自 #320 行銷裁定。
 */
const ROOT = repoRootFromHere();
const OVERRIDES = join(ROOT, "seo-overrides");
const COVER = "可以改用上色覆蓋處理";

const FORBIDDEN = [
  /(?:黃在膠邊|膠邊發黃|膠邊黃|鞋邊膠條|膠本身氧化|膠氧化|橡膠氧化|膠邊氧化)(?:(?!上色覆蓋)[^。\n<>"]){0,30}只能淡化/u,
  /膠邊氧化(?:、磨耗)?與?磨耗?只能淡化/u,
  /只能淡化不能回白/u,
  /鞋邊已經轉黃[,，]就先講清楚只能淡化/u
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "scripts") continue;
      walk(p, out);
    } else if (/\.(html|json|txt|md)$/u.test(name)) out.push(p);
  }
  return out;
}

describe("2026-11-11 鞋底發黃：上色覆蓋同步", () => {
  const files = walk(OVERRIDES);

  it("seo-overrides 不再把膠邊、鞋底發黃寫成只能淡化", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${f}: ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it("src 產生器也不再輸出舊句", () => {
    const text = readFileSync(join(ROOT, "src", "generatePublicSite.ts"), "utf8");
    for (const re of FORBIDDEN) expect(text).not.toMatch(re);
  });

  it("兩份 llms.txt 與 answers.json 都有上色覆蓋句", () => {
    for (const rel of ["llms.txt", ".well-known/llms.txt", "answers.json"]) {
      const text = readFileSync(join(OVERRIDES, rel), "utf8");
      expect(text, rel).toContain(COVER);
    }
  });

  it("白鞋頁與白鞋泛黃指南寫了上色覆蓋，且保留 LINE 與電話", () => {
    for (const rel of ["services/white-shoe-cleaning.html", "guides/white-shoe-yellowing.html"]) {
      const text = readFileSync(join(OVERRIDES, rel), "utf8");
      expect(text, rel).toContain(COVER);
      expect(text, rel).toContain("@454foyks");
      expect(text, rel).toContain("0968327653");
    }
  });
});
