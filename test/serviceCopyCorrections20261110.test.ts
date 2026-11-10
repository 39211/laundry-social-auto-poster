import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), "seo-overrides", path), "utf8");
const schemaBlocks = (html: string) => {
  const matches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (matches.length === 0) throw new Error("Missing JSON-LD");
  return matches.map((match) => {
    const raw = match[1];
    if (raw === undefined) throw new Error("Missing JSON-LD body");
    return JSON.parse(raw);
  });
};

describe("2026-11-10 public service copy corrections", () => {
  it("keeps combination wash subtotals and identifies optional extra charges", () => {
    const html = read("services/taichung-laundry-price-list.html");
    expect(html).toContain("水洗參考價小計；實際以門市看過物件後的報價為主。乾洗、柔洗、特殊髒污與修補另行報價。");
    expect(html).not.toContain("水洗參考價小計；實際以門市看過物件後的報價為主。清潔與洗護費另計。");
    for (const price of ["580", "750", "800"]) expect(html).toContain(price);
    expect(() => schemaBlocks(html)).not.toThrow();
  });

  it("uses weekday and Saturday hours consistently in FAQ schema and visible copy", () => {
    const html = read("services/taichung-citywide-laundry-pickup.html");
    const hours = "週一至週五 10:00–20:00、週六 12:00–18:00、週日公休";
    expect(html.split(hours).length - 1).toBe(2);
    expect(html.split("可收時段由門市依當日安排回覆").length - 1).toBe(2);
    expect(html).not.toContain("營業時間 10:00–20:00、週日公休");
    expect(html).not.toContain("營業時間 10:00–20:00 內約定");
    expect(JSON.stringify(schemaBlocks(html))).toContain(hours);
    const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    expect(visible).toContain(hours);
    expect(visible).toContain("可收時段由門市依當日安排回覆");
  });

  it("does not tell readers to pull apart quilting or infer a dry core from touch", () => {
    const html = read("services/fabric-storage.html");
    expect(html).not.toContain("拉開絎縫");
    expect(html.split("不要拆縫或拉開縫線").length - 1).toBe(2);
    expect(html).toContain("觸感也不能單獨證明內芯乾透");
    expect(html).toContain("無法確認內部乾透時先不要密封");
    expect(() => schemaBlocks(html)).not.toThrow();
  });
});
