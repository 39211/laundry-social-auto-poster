import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateRollingPublishingSla, resolveSlaCheckpoint, slaTimesForSlot } from "../src/publishingSla";

const DATE = "2026-10-06";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "publishing-sla-times-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function assignSlotOne(time: string): Promise<void> {
  await mkdir(join(root, "data", "publish-times"), { recursive: true });
  await writeFile(join(root, "data", "publish-times", `${DATE}.json`), JSON.stringify({
    date: DATE,
    experiment: "afternoon-vs-usual-2026-10",
    assigned_at: "2026-10-03T13:40:12.345Z",
    slots: [{ slot: 1, time, arm: "afternoon" }]
  }));
}

describe("publishing SLA follows the assigned slot time", () => {
  it("keeps the default checkpoints when the date has no assignment", () => {
    expect(slaTimesForSlot(1, DATE, root)).toEqual({ preflight: "10:45", overdue: "11:45" });
    expect(resolveSlaCheckpoint(new Date(`${DATE}T10:45:00+08:00`), "Asia/Taipei", root)).toMatchObject({ slot: 1, mode: "preflight" });
  });

  it("moves preflight and overdue checkpoints with the daily assignment", async () => {
    await assignSlotOne("14:12");
    expect(slaTimesForSlot(1, DATE, root)).toEqual({ preflight: "13:27", overdue: "14:27" });
    expect(resolveSlaCheckpoint(new Date(`${DATE}T13:27:00+08:00`), "Asia/Taipei", root)).toMatchObject({
      slot: 1,
      mode: "preflight",
      expected_time: "13:27"
    });
    expect(resolveSlaCheckpoint(new Date(`${DATE}T14:27:00+08:00`), "Asia/Taipei", root)).toMatchObject({
      slot: 1,
      mode: "overdue",
      expected_time: "14:27"
    });
  });

  it("excludes an assigned afternoon slot from the current rolling due count", async () => {
    await assignSlotOne("14:12");
    const result = await calculateRollingPublishingSla(root, new Date(`${DATE}T12:30:00+08:00`));
    expect(result.due_slots).toBe(40); // Thirteen prior days plus today's still-usual slot 3.
  });
});
