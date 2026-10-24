import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import type { AbDayPlan } from "../src/abTestPlan";

const DATE = "2026-09-30";
const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_SITE_BASE_URL: "https://example.invalid",
  PUBLIC_IMAGE_BASE_URL: "https://example.invalid"
});

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "paused-noon-content-"));
  roots.push(root);
  return root;
}

function dayPlan(date: string, noonPaused: boolean, eveningPaused = false): AbDayPlan {
  return {
    date,
    noon: { conceptId: "noon-concept", variant: "10s", ...(noonPaused ? { paused: true } : {}) },
    evening: {
      conceptId: "evening-concept",
      variant: "15s",
      ...(eveningPaused ? { paused: true } : {})
    }
  };
}

function dayPlanWithoutNoon(date: string): AbDayPlan {
  return {
    date,
    evening: { conceptId: "evening-concept", variant: "15s" }
  } as unknown as AbDayPlan;
}

describe("buildDailyContent noon pause", () => {
  it("omits slot 3 when the date's noon half is paused", async () => {
    const root = await tempRoot();
    const content = buildDailyContent(DATE, config, {
      root,
      abPlan: [dayPlan(DATE, true)]
    });

    expect(content.slots.map((slot) => slot.slot)).toEqual([1, 2]);
    expect(content.slots.some((slot) => slot.slot === 3)).toBe(false);
  });

  it("keeps all three schedule slots when noon exists and is not paused", async () => {
    const root = await tempRoot();
    const content = buildDailyContent(DATE, config, {
      root,
      abPlan: [dayPlan(DATE, false)]
    });

    expect(content.slots.map((slot) => slot.slot)).toEqual([1, 2, 3]);
    expect(content.slots.find((slot) => slot.slot === 3)?.time).toBe("12:00");
  });

  it("keeps only slots 1 and 2 when the date has no A/B plan", async () => {
    const root = await tempRoot();
    const content = buildDailyContent(DATE, config, { root, abPlan: [] });

    expect(content.slots.map((slot) => slot.slot)).toEqual([1, 2]);
  });

  it("keeps only slots 1 and 2 when the date's A/B plan has no noon half", async () => {
    const root = await tempRoot();
    const content = buildDailyContent(DATE, config, {
      root,
      abPlan: [dayPlanWithoutNoon(DATE)]
    });

    expect(content.slots.map((slot) => slot.slot)).toEqual([1, 2]);
  });

  it("keeps the existing evening-paused slot 2 behavior while omitting paused noon", async () => {
    const root = await tempRoot();
    const content = buildDailyContent(DATE, config, {
      root,
      abPlan: [dayPlan(DATE, true, true)]
    });
    const slot2 = content.slots.find((slot) => slot.slot === 2);

    expect(slot2).toBeDefined();
    expect(slot2?.content_plan_source).toBe("growth-playbook");
    expect(content.slots.some((slot) => slot.slot === 3)).toBe(false);

    const templateRoot = await tempRoot();
    const templateDate = "2099-12-31";
    const templateContent = buildDailyContent(templateDate, config, {
      root: templateRoot,
      abPlan: [dayPlan(templateDate, true, true)]
    });
    const templateSlot2 = templateContent.slots.find((slot) => slot.slot === 2);
    expect(templateSlot2?.content_plan_source).toBe("legacy-template");
    expect(templateContent.slots.some((slot) => slot.slot === 3)).toBe(false);
  });
});
