import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Observe real I/O: the historical publication-details pass may read once,
// but the retirement filter must not add another read for active candidates.
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
// No witness may load credentials, including when a production guard is mutated.
vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));

import { stampDailyContentWrite } from "../src/contentPlan";
import { generatePublicSite } from "../src/generatePublicSite";
import { writeJsonAtomic } from "../src/logging";
import { oldSlot1Calendar, slot1Date, slot1Root } from "./helpers/slot1RetirementHarness";
import { retirementSlot } from "./helpers/slotRetirementHarness";

let root: string;
beforeEach(async () => {
  root = await slot1Root();
  vi.stubEnv("PROJECT_ROOT", root);
  vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid");
  vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://example.invalid");
  vi.stubEnv("PUBLIC_GA4_MEASUREMENT_ID", "G-OFFLINE123");
  vi.stubEnv("INDEXNOW_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline public-site witness"); }));
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data/business-profile.json"), await readFile("data/business-profile.json"));
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function seedCalendar(date: string, approved = [1, 2, 3]): Promise<void> {
  await oldSlot1Calendar(root, date);
  const path = join(root, `data/content-calendar/${date}.json`);
  const calendar = JSON.parse(await readFile(path, "utf8"));
  calendar.slots.push(retirementSlot(3, date));
  await writeJsonAtomic(path, stampDailyContentWrite(calendar, { root }));
  await writeJsonAtomic(join(root, `data/approved-log/${date}.json`), approved.flatMap(slot =>
    ["facebook", "instagram"].map(platform => ({
      date, slot, platform, status: "approved", approved_by: "offline fixture", created_at: `${date}T00:00:00Z`
    }))));
}

function generate(date: string): Promise<string[]> {
  return generatePublicSite({ root, baseUrl: "https://example.invalid", now: `${date}T15:00:00+08:00` });
}

async function publicSlots(date: string): Promise<number[]> {
  const index = JSON.parse(await readFile(join(root, "docs/social-posts.json"), "utf8"));
  const calendar = JSON.parse(await readFile(join(root, `docs/content-calendar/${date}.json`), "utf8"));
  const slots = index.posts.map((post: { slot: number }) => post.slot);
  expect(calendar.slots.map((slot: { slot: number }) => slot.slot)).toEqual(slots);
  return slots;
}

async function publicBytes(relative = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, "docs", relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await publicBytes(path));
    else result[path] = (await readFile(join(root, "docs", path))).toString("base64");
  }
  return result;
}

function postedReads(date: string): number {
  return vi.mocked(readFile).mock.calls.filter(([path]) => path === join(root, `data/posted-log/${date}.json`)).length;
}

describe("slot 1 retirement public-site posted-log isolation", () => {
  it("F1 historical bad JSON matches missing-log public bytes without an extra retirement read", async () => {
    const date = "2026-10-01";
    await seedCalendar(date);
    vi.clearAllMocks();
    await generate(date);
    const missingReads = postedReads(date);
    const missingBytes = await publicBytes();
    expect(await publicSlots(date)).toEqual([1, 2, 3]);

    await mkdir(join(root, "data/posted-log"), { recursive: true });
    await writeFile(join(root, `data/posted-log/${date}.json`), '[{"slot":1},]');
    vi.clearAllMocks();
    await generate(date);
    expect(postedReads(date)).toBe(1);
    expect(missingReads).toBe(1);
    expect(await publicBytes()).toEqual(missingBytes);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it("F1 retired bad JSON succeeds and omits retired slots while retaining active slot 3", async () => {
    await seedCalendar(slot1Date);
    await mkdir(join(root, "data/posted-log"), { recursive: true });
    await writeFile(join(root, `data/posted-log/${slot1Date}.json`), '[{"slot":1},]');
    await generate(slot1Date);
    expect(await publicSlots(slot1Date)).toEqual([3]);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it.each(["success", "posted"])("F1 one actual %s row retains retired slot 1", async status => {
    await seedCalendar(slot1Date);
    await writeJsonAtomic(join(root, `data/posted-log/${slot1Date}.json`), [{
      date: slot1Date, slot: 1, platform: "facebook", status, dry_run: false,
      post_id: "offline-post", created_at: `${slot1Date}T03:30:00Z`
    }]);
    await generate(slot1Date);
    expect(await publicSlots(slot1Date)).toEqual([1, 3]);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it.each(["non-array", "read error"])("F1 retired %s log fails closed without stopping generation", async kind => {
    await seedCalendar(slot1Date);
    const path = join(root, `data/posted-log/${slot1Date}.json`);
    await mkdir(join(root, "data/posted-log"), { recursive: true });
    if (kind === "read error") await mkdir(path);
    else await writeFile(path, '{"slot":1,"status":"success","dry_run":false}');
    await generate(slot1Date);
    expect(await publicSlots(slot1Date)).toEqual([3]);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it.each([
    { status: "success", dry_run: true },
    { status: "failed", dry_run: false }
  ])("F1 $status dry_run=$dry_run cannot resurrect retired slot 1", async row => {
    await seedCalendar(slot1Date);
    await writeJsonAtomic(join(root, `data/posted-log/${slot1Date}.json`), [{ slot: 1, ...row }]);
    await generate(slot1Date);
    expect(await publicSlots(slot1Date)).toEqual([3]);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it("F1 unapproved retired slots do not trigger a retirement log read", async () => {
    await seedCalendar(slot1Date, [3]);
    vi.clearAllMocks();
    await generate(slot1Date);
    expect(await publicSlots(slot1Date)).toEqual([3]);
    expect(postedReads(slot1Date)).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);
});
