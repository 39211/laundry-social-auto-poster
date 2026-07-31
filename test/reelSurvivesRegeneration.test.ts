import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadDailyContent, writeDailyContent } from "../src/logging";

// 2026-07-30 published nothing and 2026-07-31 lost its Reel because a forced
// morning regeneration rebuilt the day from the playbook and reverted slot 2
// to a carousel whose slides were never produced. The regenerator is not the
// only writer of a calendar: schedule-reel fills slot 2 with reviewed media
// days ahead, and that slot has to survive whoever regenerates on top of it.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "reel-survives-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("forced regeneration", () => {
  it("carries a scheduled reel slot through instead of reverting it", async () => {
    const date = "2026-08-20";
    await generateDailyContent({ date, root });

    const scheduled = await loadDailyContent(date, root);
    const reelSlot = scheduled!.slots.find((slot) => slot.slot === 2)!;
    reelSlot.media_type = "reel";
    reelSlot.format = "reel";
    reelSlot.topic = "排定的 Reel";
    reelSlot.local_video_path = `docs/assets/${date}/slot-02.mp4`;
    reelSlot.video_prompt = "motion prompt";
    await writeDailyContent(scheduled!, root);

    await generateDailyContent({ date, root, force: true });

    const regenerated = await loadDailyContent(date, root);
    const slot2 = regenerated!.slots.find((slot) => slot.slot === 2)!;
    expect(slot2.media_type).toBe("reel");
    expect(slot2.topic).toBe("排定的 Reel");
    expect(slot2.local_video_path).toBe(`docs/assets/${date}/slot-02.mp4`);
    // The rest of the day is still the regenerator's to rewrite.
    expect(regenerated!.slots.find((slot) => slot.slot === 1)!.media_type).not.toBe("reel");
  });
});
