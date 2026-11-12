import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyContent } from "../src/contentPlan";
import type { AppConfig } from "../src/types";

vi.hoisted(() => { vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); });
const config = { timezone: "Asia/Taipei", publicImageBaseUrl: "https://example.invalid", publicSiteBaseUrl: "https://example.invalid" } as AppConfig;
let root: string;
beforeEach(async () => {
  await mkdir("output/slot2off/tmp", { recursive: true });
  root = await mkdtemp(join(process.cwd(), "output/slot2off/tmp/generation-"));
  vi.stubEnv("PROJECT_ROOT", root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/slot-retirements.json"), await readFile(join(process.cwd(), "src/slot-retirements.json"), "utf8"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("slot retirement generation", () => {
  it("keeps November 15 slot 2 and removes November 16 slot 2 even with active AB", () => {
    const plan = ["2026-11-15", "2026-11-16"].map(date => ({
      date, noon: { conceptId: "shirt-collar", variant: "10s" as const, paused: true },
      evening: { conceptId: "shirt-collar", variant: "15s" as const }
    }));
    expect(buildDailyContent("2026-11-15", config, { root, abPlan: plan }).slots.map(s => s.slot)).toEqual([1, 2]);
    expect(buildDailyContent("2026-11-16", config, { root, abPlan: plan }).slots.map(s => s.slot)).toEqual([]);
  });
  it("does not resurrect the paused evening image fallback; keeps optional slot 3", () => {
    const date = "2026-11-16";
    const content = buildDailyContent(date, config, { root, abPlan: [{ date,
      noon: { conceptId: "shirt-collar", variant: "10s" },
      evening: { conceptId: "shirt-collar", variant: "15s", paused: true }
    }] });
    expect(content.slots.map(s => s.slot)).toEqual([3]);
  });
  it("regenerates slot 2 again after removing the retirement entry", async () => {
    await writeFile(join(root, "src/slot-retirements.json"), JSON.stringify({ version: 1, retirements: [] }));
    expect(buildDailyContent("2026-11-16", config, { root }).slots.map(s => s.slot)).toEqual([1, 2]);
  });
  it("generates neither daily slot when the retirement file is corrupt", async () => {
    await writeFile(join(root, "src/slot-retirements.json"), "broken");
    expect(buildDailyContent("2026-11-16", config, { root }).slots.map(s => s.slot)).toEqual([]);
  });
});
