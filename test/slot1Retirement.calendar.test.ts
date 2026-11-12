import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent, inspectDailyContentIntegrity } from "../src/contentPlan";
import { buildGrowthPlaybook } from "../src/growthPlaybook";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadDailyContent, detectAndRecordCalendarTamper, writeDailyContent, writeJsonAtomic } from "../src/logging";
import { listMissingCalendarImages, validateImageAssets, validatePublishableImages, writeImagePromptManifest } from "../src/generateImage";
import { buildSlotImagePlan } from "../src/slotImagePlan";
import { lockDay, healDay } from "../src/dayLock";
import { slotRetirement } from "../src/slotRetirements";
import { slot1Root, slot1Date as date, oldSlot1Calendar } from "./helpers/slot1RetirementHarness";

let root: string;
beforeEach(async () => {
  root = await slot1Root(); vi.stubEnv("PROJECT_ROOT", root);
  vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://example.invalid");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline witness"); }));
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("slot 1 policy and calendar", () => {
  it("R1 Taipei midnight boundary keeps 11/15 and retires 11/16 including UTC and negative offsets", () => {
    for (const slot of [1, 2]) {
      for (const instant of ["2026-11-15", "2026-11-15T15:59:59Z", "2026-11-15T10:59:59-05:00"])
        expect(slotRetirement(instant, slot, root).retired, `${instant} slot ${slot}`).toBe(false);
      for (const instant of [date, "2026-11-15T16:00:00Z", "2026-11-15T11:00:00-05:00", new Date("2026-11-15T16:00:00Z")])
        expect(slotRetirement(instant, slot, root).retired).toBe(true);
    }
    expect(slotRetirement(date, 3, root).retired).toBe(false);
  });
  it("R1 historical generation matches the unmodified baseline envelopes byte for byte", async () => {
    const records = JSON.parse(await readFile("test/fixtures/slot1off/historical-generation.json", "utf8"));
    for (const [day, baseline] of Object.entries(records)) {
      const { generated_at, content_checksum, ...content } = buildDailyContent(day, getConfig(), { root, abPlan: [] });
      expect(JSON.stringify(content), day).toBe(JSON.stringify(baseline));
    }
  });
  it.each(["missing", "{broken", "{}", '{"version":1,"retirements":[{"slot":1,"from":"2026-02-30","reason":"x"}]}'])
    ("R2 %s policy fails closed for both daily slots, without altering historical dates", async raw => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const path = join(root, "src/slot-retirements.json");
      if (raw === "missing") await unlink(path); else await writeFile(path, raw);
      for (const slot of [1, 2]) {
        expect(slotRetirement(date, slot, root)).toMatchObject({ retired: true, error: expect.stringContaining("fail closed") });
        expect(slotRetirement("2026-11-15", slot, root)).toEqual({ retired: false });
      }
      expect(slotRetirement(date, 3, root).retired).toBe(false);
      expect(warn).toHaveBeenCalled();
      expect(buildDailyContent(date, getConfig(), { root, abPlan: [] }).slots).toEqual([]);
    });
  it("R3 plans, AB fallback, and growth playbook cannot resurrect a retired slot; optional slot 3 survives", async () => {
    await writeJsonAtomic(join(root, "data/slot1-plan.json"), { [date]: "登山鞋" });
    await writeJsonAtomic(join(root, "data/slot1-plan-ext.json"), { [date]: { object: "行李箱", category: "unknown" } });
    const warn = vi.spyOn(console, "warn");
    for (const paused of [false, true]) {
      const content = buildDailyContent(date, getConfig(), { root, applySlot1Plan: true, applyAiredCooldown: true,
        abPlan: [{ date, noon: { conceptId: "shirt-collar", variant: "10s", paused: true }, evening: { conceptId: "shirt-collar", variant: "15s", paused } }] });
      expect(content.slots).toEqual([]); expect(content.retired_slots).toEqual([1, 2]);
    }
    expect(buildDailyContent(date, getConfig(), { root, abPlan: [{ date, noon: { conceptId: "shirt-collar", variant: "10s" }, evening: { conceptId: "shirt-collar", variant: "15s" } }] }).slots.map(s => s.slot)).toEqual([3]);
    // Planning templates can describe historical cadence; only actual calendar
    // production may decide which of those slots will exist on a given date.
    expect(["2026-11-15", date, "2026-11-17"].map(day => buildDailyContent(day, getConfig(), { root, abPlan: [] }).slots.map(s => s.slot))).toEqual([[1, 2], [], []]);
    expect(warn).not.toHaveBeenCalled();
  });
  it("R3 zero-slot calendar passes generation, integrity, images and day-lock without warnings or rebuild", async () => {
    const warn = vi.spyOn(console, "warn");
    await generateDailyContent({ root, date });
    const path = join(root, `data/content-calendar/${date}.json`);
    const before = await readFile(path, "utf8");
    const content = (await loadDailyContent(date, root))!;
    expect(content.slots).toEqual([]); expect(content.retired_slots).toEqual([1, 2]);
    expect(inspectDailyContentIntegrity(content, { root, today: date }).tampered).toBe(false);
    expect(await detectAndRecordCalendarTamper(date, root, { today: date })).toMatchObject({ present: true, tampered: false, shouldRebuild: false, reasons: [] });
    expect(await listMissingCalendarImages(date, root)).toEqual([]);
    await expect(validateImageAssets(date, root)).resolves.toBeUndefined();
    await expect(validatePublishableImages(date, root)).resolves.toBeUndefined();
    expect(await buildSlotImagePlan(date, root)).toMatchObject({ items: [], blockers: [] });
    const manifest = await writeImagePromptManifest(date, root);
    expect(JSON.parse(await readFile(manifest, "utf8"))).toEqual([]);
    expect(await lockDay(date, root)).toContain("no lock"); expect(await healDay(date, root)).toContain("no lock");
    expect(await readFile(join(root, `data/day-locks/${date}.json`), "utf8").catch(() => "")).toBe("");
    expect(await readFile(path, "utf8")).toBe(before); expect(warn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("R3 old two-slot calendar is projected only after integrity and releases a stale day-lock", async () => {
    await oldSlot1Calendar(root);
    const path = join(root, `data/content-calendar/${date}.json`), before = await readFile(path, "utf8");
    expect((await loadDailyContent(date, root))?.slots).toEqual([]);
    expect((await loadDailyContent(date, root, { includeRetiredSlots: true }))?.slots).toHaveLength(2);
    await writeJsonAtomic(join(root, `data/day-locks/${date}.json`), { date, slot1: JSON.parse(before).slots[0] });
    expect(await healDay(date, root)).toContain("no lock");
    expect(await readFile(join(root, `data/day-locks/${date}.json`), "utf8").catch(() => "")).toBe("");
    expect(await readFile(path, "utf8")).toBe(before);
    const tampered = JSON.parse(before); tampered.slots[0].topic = "tampered";
    await writeFile(path, JSON.stringify(tampered));
    expect((await loadDailyContent(date, root))?.tampered).toBe(true);
  });
  it("R2 removing only slot 1 restores new generation and topic rotation, while saved zero days stay valid", async () => {
    await generateDailyContent({ root, date });
    const policy = JSON.parse(await readFile(join(root, "src/slot-retirements.json"), "utf8"));
    policy.retirements = policy.retirements.filter((row: {slot: number}) => row.slot !== 1);
    await writeJsonAtomic(join(root, "src/slot-retirements.json"), policy);
    expect((await loadDailyContent(date, root))?.slots).toEqual([]);
    const next = "2026-11-17";
    await writeJsonAtomic(join(root, "data/slot1-plan-ext.json"), { [next]: { object: "登山鞋", category: "shoe", format: "single" } });
    await generateDailyContent({ root, date: next });
    expect((await loadDailyContent(next, root))?.slots.map(s => s.slot)).toEqual([1]);
    await expect(healDay(next, root)).resolves.toBe("no lock");
    await writeDailyContent((await loadDailyContent(date, root))!, root);
    expect((await loadDailyContent(date, root))?.slots).toEqual([]);
  });
});
