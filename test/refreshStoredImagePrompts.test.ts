import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import type { DailyContent } from "../src/types";

const roots: string[] = [];
const plan = JSON.parse(await readFile("data/slot1-plan-ext.json", "utf8")) as Record<string, { object: string; format: string }>;

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("refresh stored image prompts", () => {
  it.each(["2026-10-31", "2026-11-01"])("preserves the stored planned object through the production script on %s", async (date) => {
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
    slot.image_prompt = "stale hero prompt";
    for (const slide of slot.carousel_items ?? []) slide.image_prompt = "stale slide prompt";
    const untouchedSlot2 = JSON.stringify(calendar.slots.find((item) => item.slot === 2));
    await writeDailyContent(calendar, root);

    execFileSync(process.execPath, [
      "--import", "tsx", resolve("scripts/refresh-stored-image-prompts.ts"), `${date}:1`
    ], { env: { ...process.env, PROJECT_ROOT: root }, encoding: "utf8", timeout: 30_000 });

    const refreshed = await loadDailyContent(date, root);
    expect(refreshed?.tampered).not.toBe(true);
    const actual = refreshed!.slots.find((item) => item.slot === 1)!;
    expect(actual.planned_object).toBe(storedObject);
    expect(actual.carousel_items).toHaveLength(plan[date]!.format === "carousel" ? 4 : 1);
    for (const prompt of [actual.image_prompt, ...actual.carousel_items!.map((item) => item.image_prompt)]) {
      expect(prompt).toContain(`OBJECT PASSPORT: exactly this one item: ${storedObject}`);
    }
    expect(JSON.stringify(refreshed!.slots.find((item) => item.slot === 2))).toBe(untouchedSlot2);
  });
});
