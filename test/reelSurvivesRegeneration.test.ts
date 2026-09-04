import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calendarSlotsChecksum, inspectDailyContentIntegrity } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import type { DailySlot } from "../src/types";

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

async function scheduleReelInto(date: string, withFile: boolean): Promise<void> {
  const scheduled = await loadDailyContent(date, root);
  const reelSlot = scheduled!.slots.find((slot) => slot.slot === 2)!;
  reelSlot.media_type = "reel";
  reelSlot.format = "reel";
  reelSlot.topic = "排定的 Reel";
  reelSlot.instagram_caption = "scheduled reel ig caption";
  reelSlot.facebook_caption = "scheduled reel fb caption";
  reelSlot.local_video_path = `docs/assets/${date}/slot-02.mp4`;
  reelSlot.video_prompt = "motion prompt";
  await writeDailyContent(scheduled!, root);
  if (withFile) {
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-02.mp4"), "video bytes", "utf8");
  }
}

function noonReelSlot(date: string): DailySlot {
  return {
    slot: 3,
    time: "12:00",
    category: "情境文",
    topic: "中午排定的 Reel",
    format: "reel",
    media_type: "reel",
    instagram_caption: "noon reel ig caption that must survive",
    facebook_caption: "noon reel fb caption that must survive",
    image_prompt: "noon reel cover",
    visual_route: "shop-inspection",
    traffic_route: "share-worthy-care",
    local_image_path: `docs/assets/${date}/slot-03.png`,
    public_image_url: `https://sixiangjialaundry.com/assets/${date}/slot-03.png`,
    local_video_path: `docs/assets/${date}/slot-03.mp4`,
    video_prompt: "motion prompt",
    status: "pending"
  };
}

async function scheduleNoonReelInto(date: string, withFile: boolean): Promise<void> {
  const scheduled = await loadDailyContent(date, root);
  const noon = noonReelSlot(date);
  scheduled!.slots = [...scheduled!.slots.filter((slot) => slot.slot !== 3), noon].sort(
    (a, b) => a.slot - b.slot
  );
  await writeDailyContent(scheduled!, root);
  if (withFile) {
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-03.mp4"), "video bytes", "utf8");
  }
}

describe("forced regeneration", () => {
  it("carries a scheduled reel slot through instead of reverting it", async () => {
    const date = "2026-08-20";
    await generateDailyContent({ date, root });
    await scheduleReelInto(date, true);

    await generateDailyContent({ date, root, force: true });

    const regenerated = await loadDailyContent(date, root);
    const slot2 = regenerated!.slots.find((slot) => slot.slot === 2)!;
    expect(slot2.media_type).toBe("reel");
    expect(slot2.topic).toBe("排定的 Reel");
    expect(slot2.local_video_path).toBe(`docs/assets/${date}/slot-02.mp4`);
    // Same-number Reel: keep the reviewed media, take captions from the new day.
    expect(slot2.instagram_caption).not.toBe("scheduled reel ig caption");
    expect(slot2.facebook_caption).not.toBe("scheduled reel fb caption");
    // The rest of the day is still the regenerator's to rewrite.
    expect(regenerated!.slots.find((slot) => slot.slot === 1)!.media_type).not.toBe("reel");
  });

  it("does not preserve a reel whose file is gone", async () => {
    // A dangling path would pin the slot to a video that cannot publish and
    // make it immune to the regeneration that could fix it.
    const date = "2026-08-21";
    await generateDailyContent({ date, root });
    await scheduleReelInto(date, false);

    await generateDailyContent({ date, root, force: true });

    const regenerated = await loadDailyContent(date, root);
    expect(regenerated!.slots.find((slot) => slot.slot === 2)!.media_type).not.toBe("reel");
  });

  it("keeps a scheduled noon reel slot as-is through forced regeneration", async () => {
    const date = "2026-08-22";
    await generateDailyContent({ date, root });
    const seeded = await loadDailyContent(date, root);
    const slot1 = seeded!.slots.find((slot) => slot.slot === 1)!;
    const slot2 = seeded!.slots.find((slot) => slot.slot === 2)!;
    slot1.topic = "MUTATED_SLOT_1_MUST_BE_REPLACED";
    slot1.instagram_caption = "mutated-ig-1";
    slot1.facebook_caption = "mutated-fb-1";
    slot2.topic = "MUTATED_SLOT_2_MUST_BE_REPLACED";
    slot2.instagram_caption = "mutated-ig-2";
    slot2.facebook_caption = "mutated-fb-2";
    await writeDailyContent(seeded!, root);
    await scheduleNoonReelInto(date, true);

    const beforeForce = await loadDailyContent(date, root);
    const slot3Before = structuredClone(beforeForce!.slots.find((slot) => slot.slot === 3)!);

    await generateDailyContent({ date, root, force: true });

    const regenerated = await loadDailyContent(date, root);
    expect(regenerated!.slots.map((slot) => slot.slot)).toEqual([1, 2, 3]);
    expect(regenerated!.slots.find((slot) => slot.slot === 3)).toEqual(slot3Before);
    expect(regenerated!.slots.find((slot) => slot.slot === 1)!.topic).not.toBe(
      "MUTATED_SLOT_1_MUST_BE_REPLACED"
    );
    expect(regenerated!.slots.find((slot) => slot.slot === 2)!.topic).not.toBe(
      "MUTATED_SLOT_2_MUST_BE_REPLACED"
    );

    expect(regenerated!.content_checksum).toBe(calendarSlotsChecksum(regenerated!, { root }));
    const withoutSlot3 = {
      date: regenerated!.date,
      timezone: regenerated!.timezone,
      generated_at: regenerated!.generated_at,
      slots: regenerated!.slots.filter((slot) => slot.slot !== 3)
    };
    expect(regenerated!.content_checksum).not.toBe(calendarSlotsChecksum(withoutSlot3, { root }));
    const inspection = inspectDailyContentIntegrity(regenerated!, { root });
    expect(inspection.tampered).toBe(false);
    expect(inspection.reasons).not.toContain("content_checksum mismatch");
  });

  it("does not preserve a noon reel whose file is gone", async () => {
    const date = "2026-08-23";
    await generateDailyContent({ date, root });
    await scheduleNoonReelInto(date, false);

    await generateDailyContent({ date, root, force: true });

    const regenerated = await loadDailyContent(date, root);
    const slot3 = regenerated!.slots.find((slot) => slot.slot === 3);
    expect(slot3?.media_type).not.toBe("reel");
    expect(slot3?.topic).not.toBe("中午排定的 Reel");
  });
});
