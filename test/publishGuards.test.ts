import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { generateDailyContent } from "../src/generateDailyContent";

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

  it("regeneration keeps a scheduled reel's validation fields and replaces only its captions", async () => {
    // The duplicate-caption fix first carried media_type and local_video_path
    // across and dropped public_video_url and video_prompt, which
    // validatePublishableReel requires. A reviewed reel would have failed
    // validation and published its cover image instead, saying nothing.
    const scheduled = {
      ...slot(2, "昨天寫的文案,不該跟著影片過來。"),
      media_type: "reel" as const,
      local_video_path: `docs/assets/${DATE}/slot-02.mp4`,
      public_video_url: "https://example.test/slot-02.mp4",
      video_prompt: "the exact motion prompt the freshness gate checks",
    };
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await writeFile(
      join(root, "data", "content-calendar", `${DATE}.json`),
      JSON.stringify({ date: DATE, slots: [slot(1, "填充"), scheduled, slot(3, "填充")] }),
      "utf8"
    );
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", DATE, "slot-02.mp4"), "video", "utf8");

    await generateDailyContent({ date: DATE, root, force: true });

    const after = JSON.parse(
      await readFile(join(root, "data", "content-calendar", `${DATE}.json`), "utf8")
    ) as { slots: Record<string, unknown>[] };
    const kept = after.slots.find((s) => s.slot === 2)!;
    expect(kept.public_video_url).toBe("https://example.test/slot-02.mp4");
    expect(kept.video_prompt).toBe("the exact motion prompt the freshness gate checks");
    expect(kept.local_video_path).toBe(`docs/assets/${DATE}/slot-02.mp4`);
    expect(kept.instagram_caption).not.toBe("昨天寫的文案,不該跟著影片過來。");
  });

  it("a commit-point failure blocks the catch-up chain from publishing again", async () => {
    // The 08-11 containment exists because commit failures were recorded as
    // "failed", which hasRecordedPost reads as "never went out" -- so catch-up
    // republished a post that was already live. "uncertain" must read as
    // recorded, and plain failures must still allow the retry.
    const { hasRecordedPost } = await import("../src/logging");
    const uncertain = [
      { date: DATE, slot: 2, platform: "instagram", status: "uncertain", dry_run: false, attempts: 3, created_at: "" },
    ] as never[];
    const failed = [
      { date: DATE, slot: 2, platform: "instagram", status: "failed", dry_run: false, attempts: 3, created_at: "" },
    ] as never[];
    expect(hasRecordedPost(uncertain, 2, "instagram", false)).toBe(true);
    expect(hasRecordedPost(failed, 2, "instagram", false)).toBe(false);
  });
});
