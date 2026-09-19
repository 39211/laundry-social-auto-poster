import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDailyContent } from "../src/logging";
import { markImageSource } from "../src/markImageSource";
import { parseScheduleCliArgs, reelBackupDir, restoreReelSlot, scheduleReel } from "../src/scheduleReel";

// 2026-09-04: `schedule-reel --date --concept plush-doll` without --slot took
// the default slot 2 and overwrote an approved evening carousel (cover bytes,
// calendar entry, a copied clip). These tests pin the three things that stop
// that from recurring: the CLI refuses to guess the slot, scheduleReel refuses
// an approved or published non-Reel slot unless forced, and --restore puts an
// overwritten slot back byte for byte from the backup taken before the write.

const DATE = "2026-09-24";
const CONCEPT = "leather-bag-corner";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ORIGINAL_COVER = Buffer.concat([PNG_MAGIC, Buffer.from("approved-evening-carousel-cover")]);
const REEL_COVER = Buffer.concat([PNG_MAGIC, Buffer.from("reel-before-still")]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function imageSlot(slot: number, topic: string) {
  return {
    slot,
    time: slot === 1 ? "11:30" : slot === 2 ? "20:30" : "12:00",
    category: slot === 1 ? "知識文" : "情境文",
    topic,
    format: "image-post" as const,
    media_type: "image" as const,
    instagram_caption: `${topic} caption`,
    facebook_caption: `${topic} caption`,
    image_prompt: `Realistic shop photo for ${topic}.`,
    visual_route: "macro-detail" as const,
    traffic_route: "object-proof" as const,
    local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`,
    public_image_url: `https://example.com/docs/assets/${DATE}/slot-0${slot}.png`,
    status: "pending" as const
  };
}

async function seedRoot(options: { approveSlot2: boolean }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "schedule-reel-guard-"));
  // fake reel library: scheduleReel only reads these files and copies their bytes
  const reels = join(root, "output", "reels-run", "2026-07-29", "reels");
  const refs = join(root, "output", "reels-run", "2026-07-29", "references");
  await mkdir(reels, { recursive: true });
  await mkdir(refs, { recursive: true });
  await writeFile(join(reels, `${CONCEPT}.mp4`), Buffer.from("fake-reel-bytes"));
  await writeFile(join(reels, `${CONCEPT}.mp4.audio.json`), JSON.stringify({ narration: "x" }));
  await writeFile(join(refs, `${CONCEPT}-before.png`), REEL_COVER);

  const slots = [imageSlot(1, "白鞋鞋帶發灰"), imageSlot(2, "帆布包提把發黑")];
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    `${JSON.stringify({ date: DATE, timezone: "Asia/Taipei", generated_at: `${DATE}T00:00:00.000Z`, slots }, null, 2)}\n`
  );
  await mkdir(join(root, "data", "image-prompts"), { recursive: true });
  await writeFile(
    join(root, "data", "image-prompts", `${DATE}.json`),
    JSON.stringify(
      slots.map((slot) => ({
        slot: slot.slot,
        slide: 1,
        topic: slot.topic,
        prompt: slot.image_prompt,
        target_path: slot.local_image_path,
        public_image_url: slot.public_image_url,
        visual_route: "macro-detail"
      }))
    )
  );
  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  await writeFile(join(root, "docs", "assets", DATE, "slot-01.png"), Buffer.concat([PNG_MAGIC, Buffer.from("slot1")]));
  await writeFile(join(root, "docs", "assets", DATE, "slot-02.png"), ORIGINAL_COVER);
  for (const slot of slots) {
    await markImageSource({ root, date: DATE, slot: slot.slot, source: "gpt-image-2", imagePath: slot.local_image_path });
  }
  if (options.approveSlot2) {
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await writeFile(
      join(root, "data", "approved-log", `${DATE}.json`),
      JSON.stringify(
        ["facebook", "instagram"].map((platform) => ({
          date: DATE,
          slot: 2,
          platform,
          status: "approved",
          approved_by: "test",
          created_at: `${DATE}T00:00:00.000Z`
        }))
      )
    );
  }
  return root;
}

async function slot2(root: string) {
  const content = await loadDailyContent(DATE, root);
  return content?.slots.find((item) => item.slot === 2);
}

describe("schedule-reel slot guard", () => {
  it("CLI refuses to guess the slot; noon and evening must be named", () => {
    expect(() => parseScheduleCliArgs(["--date", DATE, "--concept", CONCEPT])).toThrow(/--slot 2\|3/);
    expect(parseScheduleCliArgs(["--date", DATE, "--concept", CONCEPT, "--slot", "3"])).toMatchObject({
      date: DATE,
      conceptId: CONCEPT,
      slot: 3,
      force: false
    });
    expect(parseScheduleCliArgs(["--date", DATE, "--concept", CONCEPT, "--slot", "2", "--force", "--variant", "15s"])).toMatchObject({
      slot: 2,
      force: true,
      variant: "15s"
    });
  });

  it("refuses to overwrite an approved non-Reel slot and leaves everything untouched", async () => {
    const root = await seedRoot({ approveSlot2: true });
    const before = await slot2(root);
    await expect(scheduleReel({ date: DATE, conceptId: CONCEPT, slot: 2, root })).rejects.toThrow(
      /Refusing to schedule leather-bag-corner into 2026-09-24 slot 2: that slot is an approved image post/
    );
    expect(await slot2(root)).toEqual(before);
    expect(await readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).toEqual(ORIGINAL_COVER);
    expect(await exists(join(root, "docs", "assets", DATE, "slot-02.mp4"))).toBe(false);
    expect(await exists(reelBackupDir(DATE, root))).toBe(false);
  });

  it("schedules into an unapproved slot without --force (heal's normal path) and backs the slot up first", async () => {
    const root = await seedRoot({ approveSlot2: false });
    await scheduleReel({ date: DATE, conceptId: CONCEPT, slot: 2, root });
    expect((await slot2(root))?.media_type).toBe("reel");
    expect(await readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).toEqual(REEL_COVER);
    expect(await readFile(join(reelBackupDir(DATE, root), "slot-02.png"))).toEqual(ORIGINAL_COVER);
  });

  it("--force overwrites, and --restore puts the slot back byte for byte", async () => {
    const root = await seedRoot({ approveSlot2: true });
    const original = await slot2(root);
    const originalManifest = JSON.parse(await readFile(join(root, "data", "image-prompts", `${DATE}.json`), "utf8"));
    const originalSources = JSON.parse(await readFile(join(root, "data", "image-sources", `${DATE}.json`), "utf8"));

    await scheduleReel({ date: DATE, conceptId: CONCEPT, slot: 2, root, force: true });
    expect((await slot2(root))?.media_type).toBe("reel");
    expect(await readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).toEqual(REEL_COVER);
    expect(await exists(join(root, "docs", "assets", DATE, "slot-02.mp4"))).toBe(true);
    const snapshot = JSON.parse(await readFile(join(reelBackupDir(DATE, root), "slot-02.slot.json"), "utf8"));
    expect(snapshot.slot).toEqual(original);

    // a second schedule into the same slot must not replace the snapshot with the Reel
    await scheduleReel({ date: DATE, conceptId: CONCEPT, slot: 2, root, force: true });
    expect(JSON.parse(await readFile(join(reelBackupDir(DATE, root), "slot-02.slot.json"), "utf8")).slot).toEqual(original);

    const { restored } = await restoreReelSlot({ date: DATE, slotNumber: 2, root });
    expect(restored).toContain("calendar slot");
    expect(await slot2(root)).toEqual(original);
    expect(await readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).toEqual(ORIGINAL_COVER);
    expect(await exists(join(root, "docs", "assets", DATE, "slot-02.mp4"))).toBe(false);
    expect(await exists(join(root, "docs", "assets", DATE, "slot-02.mp4.audio.json"))).toBe(false);
    expect(JSON.parse(await readFile(join(root, "data", "image-prompts", `${DATE}.json`), "utf8"))).toEqual(originalManifest);
    expect(JSON.parse(await readFile(join(root, "data", "image-sources", `${DATE}.json`), "utf8"))).toEqual(originalSources);
    const videoSources = JSON.parse(await readFile(join(root, "data", "video-sources", `${DATE}.json`), "utf8"));
    expect(videoSources.some((row: { slot: number }) => row.slot === 2)).toBe(false);
    expect(await exists(join(root, "data", "video-runs", DATE, "slot-02", "run.json"))).toBe(false);
  });

  it("--restore refuses when there is no backup to restore from", async () => {
    const root = await seedRoot({ approveSlot2: false });
    await expect(restoreReelSlot({ date: DATE, slotNumber: 2, root })).rejects.toThrow(/No reel backup/);
  });
});
