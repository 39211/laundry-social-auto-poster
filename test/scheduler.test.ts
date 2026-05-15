import { describe, expect, it } from "vitest";
import { resolveCurrentSlot, getZonedDateParts, DAILY_SCHEDULE } from "../src/scheduler";

describe("scheduler", () => {
  it("resolves the Taipei date and slot", () => {
    const now = new Date("2026-05-15T07:30:00+08:00");
    expect(getZonedDateParts(now)).toEqual({ date: "2026-05-15", time: "07:30" });
    expect(resolveCurrentSlot(now)?.slot).toBe(1);
  });

  it("keeps the requested daily ratio", () => {
    const counts = new Map<string, number>();
    for (const item of DAILY_SCHEDULE) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }

    expect(counts.get("知識文")).toBe(3);
    expect(counts.get("情境文")).toBe(2);
    expect(counts.get("優惠提醒")).toBe(2);
    expect(counts.get("生活洗衣小技巧")).toBe(2);
    expect(counts.get("品牌形象文")).toBe(1);
  });
});
