import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); });
import { inspectDailyContentIntegrity } from "../src/contentPlan";
import { loadDailyContent, detectAndRecordCalendarTamper, writeDailyContent } from "../src/logging";
import { listMissingCalendarImages, validateImageAssets } from "../src/generateImage";
import { lockDay, healDay } from "../src/dayLock";
import { loadSlotRetirements, slotRetirement } from "../src/slotRetirements";
import { RETIREMENT_POLICY, retirementRoot, seedRetirementCalendar } from "./helpers/slotRetirementHarness";

let root: string;
const date = "2026-11-16";
beforeEach(async () => { root = await retirementRoot(); vi.stubEnv("PROJECT_ROOT", root); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
describe("slot retirement policy and calendar", () => {
  it("uses Taipei midnight for UTC and offset instants, keeping the November 15 boundary", () => {
    expect(slotRetirement("2026-11-15", 2, root).retired).toBe(false);
    expect(slotRetirement("2026-11-16", 2, root).retired).toBe(true);
    expect(slotRetirement(new Date("2026-11-15T15:59:59Z"), 2, root).retired).toBe(false);
    expect(slotRetirement(new Date("2026-11-15T16:00:00Z"), 2, root).retired).toBe(true);
    expect(slotRetirement("2026-11-15T11:00:00-05:00", 2, root).retired).toBe(true);
    expect(slotRetirement("2026-11-16", 1, root).retired).toBe(false);
    expect(slotRetirement("2027-01-01", 3, root).retired).toBe(false);
  });
  it.each(["missing", "{broken", "{}", '{"version":1,"retirements":[{"slot":2,"from":"2026-02-30","reason":"x"}]}'])
    ("fails closed with diagnostics for %s, leaving slots 1 and 3 usable", async raw => {
      const file = join(root, "src/slot-retirements.json");
      if (raw === "missing") await unlink(file); else await writeFile(file, raw);
      expect(loadSlotRetirements(root).error).toMatch(/fail closed/);
      expect(slotRetirement(date, 2, root).retired).toBe(true);
      // r3 revokes N2: historical decisions are unchanged even with damaged settings.
      expect(slotRetirement("2026-11-15", 2, root)).toEqual({ retired: false });
      expect(slotRetirement(date, 1, root).retired).toBe(false);
      expect(slotRetirement("2026-11-15", 1, root).retired).toBe(false);
      expect(slotRetirement(date, 3, root).retired).toBe(false);
    });
  it("restores the slot on the next read when the owner deletes the entry", async () => {
    expect(slotRetirement(date, 2, root).retired).toBe(true);
    await writeFile(join(root, "src/slot-retirements.json"), JSON.stringify({ ...RETIREMENT_POLICY, retirements: [] }));
    expect(slotRetirement(date, 2, root).retired).toBe(false);
  });
  it("accepts a correctly stamped one-slot day through tamper detection, day-lock and image validation", async () => {
    await seedRetirementCalendar(root, date, [1]);
    expect((await loadDailyContent(date, root))?.slots.map(s => s.slot)).toEqual([1]);
    expect(await detectAndRecordCalendarTamper(date, root, { today: date })).toMatchObject({ tampered: false, shouldRebuild: false });
    expect(await listMissingCalendarImages(date, root)).toEqual([]);
    await expect(validateImageAssets(date, root)).resolves.toBeUndefined();
    expect(await lockDay(date, root)).toBe("locked");
    expect(await healDay(date, root)).toBe("intact");
  });
  it("projects an old calendar containing slot 2 only after raw integrity verification; no missing-image false alarm", async () => {
    await seedRetirementCalendar(root, date);
    const path = join(root, `data/content-calendar/${date}.json`);
    const original = await readFile(path, "utf8");
    const content = (await loadDailyContent(date, root))!;
    expect(content.slots.map(s => s.slot)).toEqual([1]);
    expect(inspectDailyContentIntegrity(content, { root, today: date }).tampered).toBe(false);
    expect(await listMissingCalendarImages(date, root)).toEqual([]);
    expect(await readFile(path, "utf8")).toBe(original);
    const corrupted = JSON.parse(original); corrupted.slots[0].topic = "unauthorized edit";
    await writeFile(path, JSON.stringify(corrupted));
    expect((await loadDailyContent(date, root))?.tampered).toBe(true);
    expect(await detectAndRecordCalendarTamper(date, root, { today: date })).toMatchObject({ tampered: true, shouldRebuild: true });
  });
  it("writeDailyContent never persists a retired slot but keeps slot 3", async () => {
    await seedRetirementCalendar(root, "2026-11-15", [1, 2, 3]);
    const content = (await loadDailyContent("2026-11-15", root))!;
    await writeDailyContent({ ...content, date }, root);
    const raw = JSON.parse(await readFile(join(root, `data/content-calendar/${date}.json`), "utf8"));
    expect(raw.slots.map((s: { slot: number }) => s.slot)).toEqual([1, 3]);
  });
});
