import { describe, expect, it } from "vitest";
import { decideDay30, decideDay60, programmeDay } from "../src/programCheckpoint";
import type { LocalReachReport } from "../src/localReach";

function report(overrides: Partial<LocalReachReport>): LocalReachReport {
  return {
    generated_at: "2026-08-09T00:00:00.000Z",
    since: "2026-07-29",
    until: "2026-08-09",
    days: 12,
    reach_total: 0,
    reach_non_follower: 0,
    reach_follower: 0,
    accounts_engaged: 0,
    profile_links_taps: 0,
    followers_now: 1422,
    followers_gained: 0,
    local_follower_share: 0.77,
    inquiries: 0,
    bookings: 0,
    data_gaps: [],
    ...overrides
  };
}

describe("programme checkpoints", () => {
  it("counts programme days from the launch date", () => {
    expect(programmeDay("2026-07-11")).toBe(1);
    expect(programmeDay("2026-08-09")).toBe(30);
    expect(programmeDay("2026-09-08")).toBe(60);
  });

  it("scales at day 30 only when inquiries and engagement both clear the bar", () => {
    expect(decideDay30(report({ inquiries: 2, accounts_engaged: 8 })).verdict).toBe("scale");
    // An inquiry is the signal that matters, so one alone still buys a retest.
    expect(decideDay30(report({ inquiries: 1, accounts_engaged: 0 })).verdict).toBe("adjust");
    expect(decideDay30(report({ inquiries: 0, accounts_engaged: 5 })).verdict).toBe("adjust");
    expect(decideDay30(report({ inquiries: 0, accounts_engaged: 4 })).verdict).toBe("stop");
  });

  it("requires bookings, not just inquiries, to scale at day 60", () => {
    expect(decideDay60(report({ inquiries: 8, bookings: 3, followers_gained: 30 })).verdict).toBe("scale");
    // Inquiries without bookings is traction that has not converted yet.
    expect(decideDay60(report({ inquiries: 8, bookings: 0, followers_gained: 30 })).verdict).toBe("adjust");
    expect(decideDay60(report({ inquiries: 0, bookings: 0 })).verdict).toBe("stop");
  });

  it("treats a missing engagement reading as zero rather than as a pass", () => {
    expect(decideDay30(report({ inquiries: 0, accounts_engaged: null })).verdict).toBe("stop");
  });
});
