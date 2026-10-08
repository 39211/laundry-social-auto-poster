import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_SCHEDULE } from "../src/scheduler";

// The calendar said slot 2 published at 19:30. The publish window, the catch-up
// chain, the patrol and the registered triggers all said 20:30. Nothing was
// broken enough to fail: the day just looked overdue for an hour every evening,
// and on 2026-08-15 that sent me chasing a missed publish that had not happened
// yet.
//
// Two clocks is the defect. These pin them to one.

const SCHEDULE_TIME = Object.fromEntries(DAILY_SCHEDULE.map((s) => [s.slot, s.time]));

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

describe("slot times come from one place", () => {
  it("agrees with the evening slot the machinery actually enforces", () => {
    expect(SCHEDULE_TIME[2]).toBe("20:30");
  });

  it("is not re-hardcoded in the playbook that writes the calendar", () => {
    // buildSlot used to carry its own literal, which is how the two drifted.
    const source = read("src/growthPlaybook.ts");
    const buildSlot = source.slice(source.indexOf("function buildSlot"));
    const body = buildSlot.slice(0, buildSlot.indexOf("\n}\n"));

    expect(body).toContain("findSlotByNumber");
    expect(body).not.toMatch(/"(19|20):30"/);
  });

  it("has one PowerShell default table matching DAILY_SCHEDULE and shared by all four callers", () => {
    const shared = read("scripts/publish-slot-times.ps1");
    const table = shared.match(/function Get-DefaultSlotTimes\s*\{([^}]*)\}/)?.[1] ?? "";
    const entries = table.match(/\d+\s*=\s*\[TimeSpan\]"\d{2}:\d{2}"/g) ?? [];
    const parsed = Object.fromEntries(entries.map((entry) => {
      const match = entry.match(/(\d+)\s*=\s*\[TimeSpan\]"(\d{2}:\d{2})"/);
      if (!match) throw new Error(`unparseable default slot time: ${entry}`);
      return [Number(match[1]), match[2]];
    }));

    expect(parsed).toEqual(SCHEDULE_TIME);
    expect(entries).toHaveLength(DAILY_SCHEDULE.length);

    for (const script of [
      "scripts/catchup-publish.ps1",
      "scripts/watchdog-patrol.ps1",
      "scripts/publish-sentinel.ps1",
      "scripts/publish-time-gate.ps1"
    ]) {
      const source = read(script);
      expect(source).toMatch(/\.\s*(?:\(Join-Path \$PSScriptRoot "publish-slot-times\.ps1"\)|\$slotTimesLibrary)/u);
      expect(source).not.toMatch(/\$[Ss]lotTimes\s*=\s*@\{[^}]*\d\s*=\s*\[TimeSpan\]"\d{2}:\d{2}"/su);
    }
  });

  it("does not tell readers a cadence the pipeline does not run", () => {
    for (const file of ["src/generatePublicSite.ts", "src/growthPlaybook.ts"]) {
      expect(read(file)).not.toContain("11:30 and 19:30");
      expect(read(file)).not.toContain("11:30 觸及或可收藏的知識內容，19:30");
    }
  });
});
