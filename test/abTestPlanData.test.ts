import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AbDayPlan } from "../src/abTestPlan";

// data/ab-test-plan.json is production input: produce-next-reel schedules
// every unpaused half it finds. These rules are the ones a human applied by
// hand when the evening Reel was resumed on 2026-09-06; pinning them keeps a
// later edit from re-introducing the collisions the pause had hidden.

const PLAN_PATH = join(dirname(fileURLToPath(import.meta.url)), "../data/ab-test-plan.json");
const REJECTED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../data/rejected-concepts.json");

/** Evening Reel resumed on this date; before it every evening half is paused (capacity 7->3, 2026-08-15). */
const EVENING_RESUME_DATE = "2026-09-12";
/** A concept must not air twice (any slot) within this many days. */
const GAP_DAYS = 8;

function loadPlan(): AbDayPlan[] {
  return JSON.parse(readFileSync(PLAN_PATH, "utf8").replace(/^﻿/, "")) as AbDayPlan[];
}

function loadRejectedIds(): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(REJECTED_PATH, "utf8").replace(/^﻿/, "")) as {
      concepts?: Array<{ id: string }>;
    };
    return new Set((parsed.concepts ?? []).map((concept) => concept.id));
  } catch {
    return new Set();
  }
}

function daysBetween(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

describe("ab-test-plan data: evening Reel resume", () => {
  const plan = loadPlan();
  const unpausedEvenings = plan.filter((day) => day.evening && !day.evening.paused);

  it("keeps every evening before the resume date paused (the 7-to-3 window stays intact)", () => {
    const before = plan.filter((day) => day.date >= "2026-08-15" && day.date < EVENING_RESUME_DATE);
    expect(before.length).toBeGreaterThan(0);
    for (const day of before) {
      expect(day.evening.paused, day.date).toBe(true);
    }
  });

  it("resumes the evening Reel on a real cadence: at least one unpaused evening from the resume date", () => {
    expect(unpausedEvenings.filter((day) => day.date >= EVENING_RESUME_DATE).length).toBeGreaterThanOrEqual(1);
  });

  it("never pairs an unpaused evening with the same concept as that day's noon", () => {
    for (const day of unpausedEvenings) {
      expect(day.evening.conceptId, day.date).not.toBe(day.noon.conceptId);
    }
  });

  it("uses only 10s cuts for resumed evenings (15s Reels were frozen on 2026-08-22)", () => {
    for (const day of unpausedEvenings.filter((item) => item.date >= EVENING_RESUME_DATE)) {
      expect(day.evening.variant, day.date).toBe("10s");
    }
  });

  it("does not resume a concept on the rejected list", () => {
    const rejected = loadRejectedIds();
    for (const day of unpausedEvenings) {
      expect(rejected.has(day.evening.conceptId), `${day.date} ${day.evening.conceptId}`).toBe(false);
    }
  });

  it(`keeps every resumed evening concept at least ${GAP_DAYS} days from its other airings`, () => {
    const airings = plan.flatMap((day) => {
      const rows: Array<{ date: string; conceptId: string; half: "noon" | "evening" }> = [
        { date: day.date, conceptId: day.noon.conceptId, half: "noon" }
      ];
      if (day.evening && !day.evening.paused) rows.push({ date: day.date, conceptId: day.evening.conceptId, half: "evening" });
      return rows;
    });
    for (const day of unpausedEvenings.filter((item) => item.date >= EVENING_RESUME_DATE)) {
      const clashes = airings.filter(
        (row) =>
          row.conceptId === day.evening.conceptId &&
          !(row.date === day.date && row.half === "evening") &&
          daysBetween(row.date, day.date) <= GAP_DAYS
      );
      expect(clashes, `${day.date} ${day.evening.conceptId} also airs ${clashes.map((c) => `${c.date}/${c.half}`).join(",")}`).toEqual([]);
    }
  });
});
