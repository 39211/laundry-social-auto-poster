import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDailyContent, buildCarouselImagePrompts, contradictorySubject, type Slot1PlanExtEntry } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import * as doctrine from "../src/imageDoctrine";
import { getConfig } from "../src/config";
import type { DailyContent } from "../src/types";

const plan = JSON.parse(await readFile("data/slot1-plan-ext.json", "utf8")) as Record<string, Slot1PlanExtEntry>;
const rows = Object.entries(plan);
const roots: string[] = [];
const config = getConfig({ ...process.env, DRY_RUN: "true" });
const quantityRestriction = /\b(?:a\s+)?second\s+(?!hand\b)[\w-]+/i;
const familyLabels: Partial<Record<doctrine.ObjectFamily, string>> = {
  shoe: "鞋類", bag: "包袋類", garment: "衣物類", bedding: "寢具類", plush: "絨毛娃娃"
};
const foreignNegativeTerms: Record<doctrine.ObjectFamily, RegExp> = {
  garment: /\b(?:pair|shoe|bag|hardware|duvet|doll)\b/i,
  shoe: /\b(?:bag|hardware|garment|mannequin|duvet|doll)\b/i,
  bag: /\b(?:pair|shoe|garment|mannequin|duvet|doll)\b/i,
  bedding: /\b(?:pair|shoe|bag|hardware|garment|mannequin|doll)\b/i,
  plush: /\b(?:pair|shoe|bag|hardware|garment|mannequin|duvet)\b/i,
  other: /\b(?:pair|shoe|bag|hardware|garment|mannequin|duvet|doll)\b/i
};

// Read the unchanged production gate's literal; do not duplicate its regexes.
const gateSource = ts.createSourceFile("contentPlan.ts", await readFile("src/contentPlan.ts", "utf8"), ts.ScriptTarget.Latest, true);
let gateLiteral: string | undefined;
function findGate(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(gateSource) === "SUBJECT_FAMILIES") gateLiteral = node.initializer?.getText(gateSource);
  ts.forEachChild(node, findGate);
}
findGate(gateSource);
if (!gateLiteral) throw new Error("Production SUBJECT_FAMILIES literal not found");
const gateFamilies = runInNewContext(gateLiteral) as Array<{ label: string; markers: RegExp }>;

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot1-ext-category-"));
  roots.push(root);
  await mkdir(join(root, "data"));
  for (const name of ["slot1-plan.json", "slot1-plan-ext.json"]) await copyFile(join("data", name), join(root, "data", name));
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("slot1 explicit category", () => {
  it("vocabulary labels match exactly their production approval family", () => {
    expect(doctrine.PLANNED_OBJECT_CATEGORIES).toBeDefined();
    expect(Object.keys(doctrine.PLANNED_OBJECT_CATEGORIES)).toEqual(expect.arrayContaining([
      "coat", "jacket", "sweater", "shirt", "jeans", "trousers", "dress", "suit", "uniform",
      "bedding", "handbag", "shoes", "boots", "plush", "rug", "note", "garments-in-bag"
    ]));
    for (const [key, rule] of Object.entries(doctrine.PLANNED_OBJECT_CATEGORIES)) {
      const matching = gateFamilies.filter((family) => family.markers.test(rule.label)).map((family) => family.label);
      expect(matching, key).toEqual(familyLabels[rule.family] ? [familyLabels[rule.family]] : []);
    }
    expect(doctrine.PLANNED_OBJECT_CATEGORIES.note.negatives).toContain("readable text on the object");
  });

  it("every extension plan row declares a vocabulary category", () => {
    for (const [date, entry] of rows) {
      expect(entry.category, date).toBeTypeOf("string");
      expect(Object.hasOwn(doctrine.PLANNED_OBJECT_CATEGORIES, entry.category!), date).toBe(true);
    }
  });

  it.each(rows)("persists category and validates every production prompt on %s", async (date, entry) => {
    const root = await fixtureRoot();
    const path = await generateDailyContent({ date, root, force: true });
    const calendar = JSON.parse(await readFile(path, "utf8")) as DailyContent;
    const slot = calendar.slots.find((item) => item.slot === 1)!;
    expect(slot.content_plan_source).toBe("slot1-plan-ext");
    expect(slot.planned_object).toBe(entry.object);
    expect(slot.planned_category).toBe(entry.category);
    const rule = doctrine.PLANNED_OBJECT_CATEGORIES[entry.category as keyof typeof doctrine.PLANNED_OBJECT_CATEGORIES];
    expect(rule).toBeDefined();
    expect(slot.carousel_items).toHaveLength(entry.format === "carousel" ? 4 : 1);
    for (const [index, prompt] of [slot.image_prompt, ...slot.carousel_items!.map((item) => item.image_prompt)].entries()) {
      expect(prompt).toContain(entry.object);
      expect(prompt).toContain(`SUBJECT CATEGORY: ${rule.label}.`);
      expect(contradictorySubject(slot.topic, prompt)).toBeUndefined();
      const negatives = prompt.slice(prompt.lastIndexOf("Avoid:"));
      expect(negatives).toBe(rule.negatives);
      expect(negatives).not.toMatch(foreignNegativeTerms[rule.family]);
      if (index < 2) expect(prompt).toContain(`${doctrine.familyTool(rule.family)} rests at the frame edge`);
      for (const family of Object.keys(familyLabels) as doctrine.ObjectFamily[]) {
        if (family !== rule.family && doctrine.familyTool(family) !== doctrine.familyTool(rule.family)) expect(prompt).not.toContain(doctrine.familyTool(family));
      }
      if (entry.category === "garments-in-bag") expect(prompt).not.toMatch(quantityRestriction);
    }
    expect(calendar.slots.find((item) => item.slot === 2)).not.toHaveProperty("planned_category");
  });

  it.each(["missing", "unknown"])("keeps the entire extension with neutral prompts for a %s category", async (failure) => {
    const root = await fixtureRoot();
    const altered = structuredClone(plan);
    const [date, entry] = rows.find(([, item]) => item.format === "carousel")!;
    if (failure === "missing") delete altered[date]!.category;
    else altered[date]!.category = "not-a-category";
    await writeFile(join(root, "data/slot1-plan-ext.json"), JSON.stringify(altered));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [day, expected] of rows) {
      const slot = buildDailyContent(day, config, { root, applySlot1Plan: true }).slots.find((item) => item.slot === 1)!;
      expect(slot.content_plan_source, day).toBe("slot1-plan-ext");
      expect(slot.topic, day).toBe(expected.topic);
      expect(slot.planned_object, day).toBe(expected.object);
      if (day !== date) continue;
      for (const prompt of [slot.image_prompt, ...slot.carousel_items!.map((item) => item.image_prompt)]) {
        expect(prompt).toContain(entry.object);
        expect(prompt).not.toContain("SUBJECT CATEGORY:");
        expect(prompt.slice(prompt.lastIndexOf("Avoid:"))).not.toMatch(quantityRestriction);
        expect(prompt.slice(prompt.lastIndexOf("Avoid:"))).toBe(doctrine.NEUTRAL_PLANNED_OBJECT.negatives);
      }
      expect(slot.image_prompt).toContain(`${doctrine.familyTool("other")} rests at the frame edge`);
    }
    expect(warn.mock.calls.some((args) => String(args[0]).includes(date) && /category/.test(String(args[0])))).toBe(true);
  });

  it.each([
    ["jacket", "一件深藍色羽絨衣，口袋邊與袖口泛黑"],
    ["bedding", "一個深綠色露營睡袋，內裡帶潮感"],
    ["rug", "一張短毛地毯，四周包邊脫線"],
    ["jeans", "一條深藍色直筒牛仔褲，褲腳有灰塵"]
  ])("uses only declared %s despite incidental object words", (category, object) => {
    const date = rows[0]![0];
    const rule = doctrine.PLANNED_OBJECT_CATEGORIES[category as keyof typeof doctrine.PLANNED_OBJECT_CATEGORIES];
    const prompts = buildCarouselImagePrompts({ date, topic: "外套先查領口", planned_object: object, planned_category: category });
    for (const prompt of prompts) {
      expect(prompt).toContain(object);
      expect(prompt).toContain(`SUBJECT CATEGORY: ${rule.label}.`);
      expect(prompt.slice(prompt.lastIndexOf("Avoid:"))).toBe(rule.negatives);
    }
  });

  it("filters inspection checkpoints by the declared family rather than the topic", () => {
    const input = { date: rows[0]![0], topic: "精品包先看這 2 個位置", planned_object: "已核定物件",
      caption: "第一個看：提把\n第二個看：包角\n第三個看：領口" };
    const shoes = buildCarouselImagePrompts({ ...input, planned_category: "shoes" });
    expect(shoes.slice(1).join("\n")).not.toMatch(/checkpoint \d+: (?:handle|bag corners)\./);
    const jacket = buildCarouselImagePrompts({ ...input, planned_category: "jacket" });
    expect(jacket[1]).toContain("checkpoint 1: handle.");
    expect(jacket[2]).toContain("checkpoint 2: bag corners.");
  });
});
