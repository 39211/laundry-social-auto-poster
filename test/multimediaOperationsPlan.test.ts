import { describe, expect, it } from "vitest";
import { buildMultimediaOperationsPlan } from "../src/multimediaOperationsPlan";

describe("multimedia operations plan", () => {
  it("plans two unpublished four-image plus video packages per day from 2026-07-29", () => {
    const plan = buildMultimediaOperationsPlan(new Date("2026-07-28T12:00:00.000Z"));

    expect(plan.effective_date).toBe("2026-07-29");
    expect(plan.state).toEqual({
      handoff_ready: true,
      generated: false,
      validated: false,
      publish_authorized: false,
      included_in_kpi: false
    });
    expect(plan.days[0]?.date).toBe("2026-07-29");
    expect(plan.days.at(-1)?.date).toBe("2026-10-08");
    expect(plan.days).toHaveLength(72);

    for (const day of plan.days) {
      expect(day.slots).toHaveLength(2);
      for (const slot of day.slots) {
        expect(slot.image_count).toBe(4);
        expect(slot.video_required).toBe(true);
        expect(slot.publish_authorized).toBe(false);
        expect(slot.included_in_kpi).toBe(false);
        expect(slot.tts_script).toContain("LINE");
      }
    }
  });
});
