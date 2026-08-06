import { describe, expect, it } from "vitest";
import { DAILY_SCHEDULE, getZonedDateParts, resolveCurrentSlot } from "../src/scheduler";

describe("scheduler", () => {
  it("resolves the Taipei date and first slot", () => {
    const now = new Date("2026-05-15T11:30:00+08:00");
    expect(getZonedDateParts(now)).toEqual({ date: "2026-05-15", time: "11:30" });
    expect(resolveCurrentSlot(now)?.slot).toBe(1);
  });

  it("keeps the dual-reel A/B cadence (image + evening reel + noon reel)", () => {
    expect(DAILY_SCHEDULE).toEqual([
      { slot: 1, time: "11:30", category: "知識文" },
      { slot: 2, time: "20:30", category: "情境文" },
      { slot: 3, time: "12:00", category: "情境文" }
    ]);
  });
});
