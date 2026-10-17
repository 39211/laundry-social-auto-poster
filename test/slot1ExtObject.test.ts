import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  SAME_GARMENT_CONTINUITY,
  buildCarouselImagePrompts,
  buildDailyContent,
  dailySlotFromPlaybook,
  resolveSlot1WithPlan,
  type Slot1PlanExtEntry
} from "../src/contentPlan";
import { extendedTopicSlot1 } from "../src/growthPlaybook";
import { generateDailyContent } from "../src/generateDailyContent";
import type { DailyContent } from "../src/types";

const roots: string[] = [];
const config = getConfig({ ...process.env, DRY_RUN: "true" });
const plan = JSON.parse(await readFile("data/slot1-plan-ext.json", "utf8")) as Record<string, Slot1PlanExtEntry>;
const conflictingIdentity = /\b(?:black|navy|short|nylon|polyester|beige|twill|work jacket|cotton|coyote|faux-fur|fur-look|tan)\b/i;

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot1-ext-object-"));
  roots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  await copyFile("data/slot1-plan.json", join(root, "data", "slot1-plan.json"));
  await copyFile("data/slot1-plan-ext.json", join(root, "data", "slot1-plan-ext.json"));
  return root;
}

describe("slot1 extension object", () => {
  // Removing propagation or prompt forwarding must break these persisted production calendars.
  it.each(["2026-10-23", "2026-10-24"])(
    "calendar and image prompts retain the exact planned object on %s",
    async (date) => {
      const root = await fixtureRoot();
      const path = await generateDailyContent({ date, root, force: true });
      const calendar = JSON.parse(await readFile(path, "utf8")) as DailyContent;
      const slot = calendar.slots.find((item) => item.slot === 1)!;
      const object = plan[date]!.object;
      expect(slot.content_plan_source).toBe("slot1-plan-ext");
      expect(slot).toHaveProperty("planned_object", object);
      expect(slot.topic).toBe(plan[date]!.topic);
      expect(slot.carousel_items).toHaveLength(date === "2026-10-23" ? 4 : 1);
      expect(slot.media_type).toBe(date === "2026-10-23" ? "mixed-carousel" : "image");
      for (const prompt of [slot.image_prompt, ...slot.carousel_items!.map((item) => item.image_prompt)]) {
        expect(prompt).toContain(`OBJECT PASSPORT: exactly this one item: ${object}`);
        expect(prompt).not.toMatch(conflictingIdentity);
        for (const segment of ["WEAR FIRST", "MATERIAL OPTICS:", "COMPOSITION", "LIGHTING:", "STYLE:", "CAMERA:", "COLOR:"])
          expect(prompt).toContain(segment);
      }
      for (const slide of slot.carousel_items!.slice(1)) expect(slide.image_prompt).toContain(SAME_GARMENT_CONTINUITY);
      expect(calendar.slots.find((item) => item.slot === 2)).not.toHaveProperty("planned_object");
    }
  );

  it("drops the object when a seven-day collision sends the topic back to rotation", async () => {
    const root = await fixtureRoot();
    const entry = plan["2026-10-23"]!;
    const decision = resolveSlot1WithPlan("2026-10-23", undefined, undefined, [entry.topic], entry);
    expect(decision.fallbackReason).toContain("repeats");
    expect(decision.source).not.toBe("slot1-plan-ext");
    expect(decision.slot).not.toHaveProperty("planned_object");
    const slot = buildDailyContent("2026-10-23", config, {
      root, applySlot1Plan: true, airedTopics: [entry.topic]
    }).slots.find((item) => item.slot === 1)!;
    expect(slot.topic).not.toBe(entry.topic);
    expect(slot).not.toHaveProperty("planned_object");
    expect(slot.image_prompt).not.toContain(entry.object);
  });

  it.each(["2026-10-08", "2026-10-22", "2026-11-06"])("does not add an object outside the extension on %s", async (date) => {
    const root = await fixtureRoot();
    const calendar = buildDailyContent(date, config, { root, applySlot1Plan: true });
    for (const slot of calendar.slots) expect(slot).not.toHaveProperty("planned_object");
  });

  it("uses the planned object on the single-image fallback without a carousel", () => {
    const entry = plan["2026-10-24"]!;
    const slot = { ...extendedTopicSlot1("2026-07-12", entry.topic, "single")!, planned_object: entry.object };
    const daily = dailySlotFromPlaybook(slot, config, "slot1-plan-ext", true);
    expect(daily.carousel_items).toBeUndefined();
    expect(daily.image_prompt).toContain(`OBJECT PASSPORT: exactly this one item: ${entry.object}`);
    expect(daily.image_prompt).not.toMatch(conflictingIdentity);
  });

  it("uses the planned passport on the legacy carousel path and preserves continuity", () => {
    const entry = plan["2026-10-23"]!;
    const prompts = buildCarouselImagePrompts({
      date: "2026-09-08", topic: entry.topic, planned_object: entry.object
    });
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      expect(prompt).toContain(`OBJECT PASSPORT: exactly this one item: ${entry.object}`);
      expect(prompt).not.toMatch(conflictingIdentity);
    }
    for (const prompt of prompts.slice(1)) expect(prompt).toContain(SAME_GARMENT_CONTINUITY);
  });

  it("keeps inferred pickup subjects and material optics out of a planned winter duvet", () => {
    const entry = plan["2026-10-28"]!;
    const prompts = buildCarouselImagePrompts({
      date: "2026-10-28", topic: entry.topic, planned_object: entry.object,
      seo_sync_page: "/services/taichung-citywide-laundry-pickup.html"
    });
    for (const prompt of prompts) {
      expect(prompt).toContain(entry.object);
      expect(prompt).not.toMatch(/warm-white|navy piping|cotton percale|duvet cover/i);
    }
  });
});
