import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import { PLANNED_OBJECT_CATEGORIES, type PlannedObjectCategory } from "../src/imageDoctrine";
import type { Slot1PlanExtEntry } from "../src/contentPlan";
import type { DailyContent } from "../src/types";

const roots: string[] = [];
const plan = JSON.parse(await readFile("data/slot1-plan-ext.json", "utf8")) as Record<string, Slot1PlanExtEntry>;
// Each date gets an actual persisted production-generated slot below, including
// bedding and notes even when the supplied production window stops earlier.
const refreshDates = Object.keys(plan);

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("refresh stored image prompts", () => {
  it.each(refreshDates)("preserves the stored planned object and category through the production script on %s", async (date) => {
    const root = await mkdtemp(join(tmpdir(), "refresh-planned-object-"));
    roots.push(root);
    await mkdir(join(root, "data"));
    for (const name of ["slot1-plan.json", "slot1-plan-ext.json"]) {
      await copyFile(join("data", name), join(root, "data", name));
    }
    const path = await generateDailyContent({ date, root, force: true });
    const calendar = JSON.parse(await readFile(path, "utf8")) as DailyContent;
    const slot = calendar.slots.find((item) => item.slot === 1)!;
    // Give the stored slot its own approved object so consulting today's plan
    // instead of the persisted slot cannot accidentally satisfy the test.
    const storedObject = `${plan[date]!.object}，僅此已核定物件`;
    slot.planned_object = storedObject;
    const storedCategory = plan[date]!.category as PlannedObjectCategory;
    slot.planned_category = storedCategory;
    slot.image_prompt = "stale hero prompt";
    for (const slide of slot.carousel_items ?? []) slide.image_prompt = "stale slide prompt";
    const untouchedSlot2 = JSON.stringify(calendar.slots.find((item) => item.slot === 2));
    await writeDailyContent(calendar, root);
    // A later plan edit must not replace the category carried by the stored slot.
    const laterPlan = structuredClone(plan);
    laterPlan[date]!.category = storedCategory === "boots" ? "coat" : "boots";
    await writeFile(join(root, "data", "slot1-plan-ext.json"), JSON.stringify(laterPlan));

    execFileSync(process.execPath, [
      "--import", "tsx", resolve("scripts/refresh-stored-image-prompts.ts"), `${date}:1`
    ], { env: { ...process.env, PROJECT_ROOT: root }, encoding: "utf8", timeout: 30_000 });

    const refreshed = await loadDailyContent(date, root);
    expect(refreshed?.tampered).not.toBe(true);
    const actual = refreshed!.slots.find((item) => item.slot === 1)!;
    expect(actual.planned_object).toBe(storedObject);
    expect(actual.planned_category).toBe(storedCategory);
    expect(actual.carousel_items).toHaveLength(plan[date]!.format === "carousel" ? 4 : 1);
    for (const prompt of [actual.image_prompt, ...actual.carousel_items!.map((item) => item.image_prompt)]) {
      expect(prompt).toContain(`OBJECT PASSPORT: exactly this one item: ${storedObject}`);
      expect(prompt).toContain(`SUBJECT CATEGORY: ${PLANNED_OBJECT_CATEGORIES[storedCategory].label}.`);
      expect(prompt.slice(prompt.lastIndexOf("Avoid:"))).toBe(PLANNED_OBJECT_CATEGORIES[storedCategory].negatives);
    }
    expect(JSON.stringify(refreshed!.slots.find((item) => item.slot === 2))).toBe(untouchedSlot2);
  });
});
