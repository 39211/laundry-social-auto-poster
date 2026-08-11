import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postCurrentSlot } from "../src/postCurrentSlot";

// The 199 tests this suite joins say nothing about whether the publish guards
// hold: deleting the repeat gate, the manifest gate, the fingerprint check or
// the single-flight lock left every one of them green. These three are written
// the other way round -- each one fails if its guard is removed, so they are
// worth the runtime.

const DATE = "2026-09-20";
const YESTERDAY = "2026-09-19";
// The same-day guard fires before the ones under test, so the clock has to sit
// inside the slot's publish window for these assertions to reach their target.
const NOW = new Date("2026-09-20T12:00:00+08:00");

function slot(n: number, caption: string) {
  return {
    slot: n,
    time: "12:00",
    topic: "白鞋泛黃",
    format: "reel",
    media_type: "reel" as const,
    instagram_caption: caption,
    facebook_caption: caption,
    local_image_path: `docs/assets/${DATE}/slot-0${n}.png`,
    local_video_path: `docs/assets/${DATE}/slot-0${n}.mp4`,
  };
}

async function seedDay(root: string, date: string, captions: string[]) {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    JSON.stringify({
      date,
      // The schema requires two or three slots, so a filler keeps the day
      // valid while each test varies only the slot it is actually about.
      slots: [
        ...captions.map((c, i) => slot(i + 1, c)),
        slot(captions.length + 1, `填充檔位 ${date},與任何測試無關。`),
      ],
    }),
    "utf8"
  );
}

describe("publish guards", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "guards-"));
    process.env.DRY_RUN = "false";
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a caption that already published live within the last seven days", async () => {
    const caption = "白鞋泛黃,不是刷得不夠用力。\n\n問題多半在中底和鞋邊。";
    await seedDay(root, YESTERDAY, [caption]);
    await seedDay(root, DATE, [caption]);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${YESTERDAY}.json`),
      JSON.stringify([
        { date: YESTERDAY, slot: 1, platform: "instagram", status: "success", post_id: "1", dry_run: false },
      ]),
      "utf8"
    );

    await expect(
      postCurrentSlot({ date: DATE, slot: 1, root, now: NOW })
    ).rejects.toThrow(/byte-identical/);
  });

  it("lets a caption through when the identical earlier one never went live", async () => {
    // The guard must distinguish "we published this" from "we drafted this".
    // Without this case the first test would also pass a guard that simply
    // refuses every repeated caption, published or not.
    const caption = "白鞋泛黃,不是刷得不夠用力。\n\n問題多半在中底和鞋邊。";
    await seedDay(root, YESTERDAY, [caption]);
    await seedDay(root, DATE, [caption]);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${YESTERDAY}.json`),
      JSON.stringify([
        { date: YESTERDAY, slot: 1, platform: "instagram", status: "failed", dry_run: false },
      ]),
      "utf8"
    );

    await expect(
      postCurrentSlot({ date: DATE, slot: 1, root, now: NOW })
    ).rejects.not.toThrow(/byte-identical/);
  });

  it("refuses to publish when the fingerprint file exists but has no entry for the slot", async () => {
    await seedDay(root, DATE, ["一段獨一無二的文案,不與任何一天相同。"]);
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await writeFile(
      join(root, "data", "approved-log", `${DATE}.fingerprints.json`),
      JSON.stringify({}),
      "utf8"
    );

    await expect(
      postCurrentSlot({ date: DATE, slot: 1, root, now: NOW })
    ).rejects.toThrow(/no approval fingerprint/);
  });

  // A fourth test for "a dry run leaves no fingerprint sidecar" was written and
  // then removed: autoApprove throws on this fixture before it ever reaches the
  // write, so the test passed whether the guard was there or not. A green that
  // survives deleting the thing it guards is worse than no test. The leak's
  // actual consequence -- an empty sidecar disabling the check -- is what the
  // test above covers, and that one does fail when its guard is removed.
});
