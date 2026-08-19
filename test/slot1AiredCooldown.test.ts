import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  SLOT1_AIRED_REPEAT_WINDOW_DAYS,
  buildDailyContent,
  recentAiredTopics,
  repeatingObjectGram,
  resolveSlot1AgainstAired
} from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import { buildGrowthPlaybook } from "../src/growthPlaybook";

const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
});

const DATE = "2026-08-19";
const AIRED = "2026-08-14";
const WHITE_SHOE = "可收藏：白鞋鞋邊泛灰前的檢查，送洗前先看三個位置";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
  );
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot1-aired-"));
  roots.push(root);
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "data", "posted-log"), { recursive: true });
  return root;
}

function playbookSlot1(date: string) {
  const day = buildGrowthPlaybook().days.find((item) => item.date === date);
  const slot = day?.slots.find((item) => item.slot === 1);
  if (!slot) throw new Error(`no playbook slot 1 for ${date}`);
  return slot;
}

async function writeCalendar(root: string, date: string, topic: string): Promise<void> {
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    JSON.stringify({
      date,
      timezone: "Asia/Taipei",
      generated_at: new Date().toISOString(),
      slots: [{ slot: 1, topic }]
    }),
    "utf8"
  );
}

async function writePosted(
  root: string,
  date: string,
  entries: Array<{ slot: number; status: string; dry_run?: boolean }>
): Promise<void> {
  await writeFile(
    join(root, "data", "posted-log", `${date}.json`),
    JSON.stringify(
      entries.map((entry) => ({
        date,
        slot: entry.slot,
        platform: "facebook",
        status: entry.status,
        dry_run: entry.dry_run ?? false,
        attempts: 1,
        created_at: new Date().toISOString()
      }))
    ),
    "utf8"
  );
}

describe("slot 1 generation cooldown reads as-aired history", () => {
  it("uses the same seven-day window as the approval gate", () => {
    expect(SLOT1_AIRED_REPEAT_WINDOW_DAYS).toBe(7);
  });

  it("the 8/19 holiday override still names 白鞋 — that is the collision this exists for", () => {
    expect(playbookSlot1(DATE).topic).toContain("白鞋");
    expect(repeatingObjectGram(playbookSlot1(DATE).topic, WHITE_SHOE)).toBeTruthy();
  });

  it("ignores a calendar-only collision: unpublished plans are not aired history", async () => {
    const root = await tempRoot();
    await writeCalendar(root, AIRED, WHITE_SHOE);

    expect(recentAiredTopics(DATE, SLOT1_AIRED_REPEAT_WINDOW_DAYS, root)).toEqual([]);

    const content = buildDailyContent(DATE, config, { root, applyAiredCooldown: true });
    const slot1 = content.slots.find((slot) => slot.slot === 1);
    expect(slot1?.topic).toBe(playbookSlot1(DATE).topic);
  });

  it("does not treat failed or dry-run posted-log rows as aired", async () => {
    const root = await tempRoot();
    await writeCalendar(root, AIRED, WHITE_SHOE);
    await writePosted(root, AIRED, [
      { slot: 1, status: "failed" },
      { slot: 1, status: "success", dry_run: true }
    ]);

    expect(recentAiredTopics(DATE, SLOT1_AIRED_REPEAT_WINDOW_DAYS, root)).toEqual([]);
  });

  it("collects the calendar topic of a slot that actually published", async () => {
    const root = await tempRoot();
    await writeCalendar(root, AIRED, WHITE_SHOE);
    await writePosted(root, AIRED, [{ slot: 1, status: "success" }]);

    expect(recentAiredTopics(DATE, SLOT1_AIRED_REPEAT_WINDOW_DAYS, root)).toEqual([WHITE_SHOE]);
  });

  it("counts uncertain the same way hasRecordedPost does — the post may already be live", async () => {
    const root = await tempRoot();
    await writeCalendar(root, AIRED, WHITE_SHOE);
    await writePosted(root, AIRED, [{ slot: 1, status: "uncertain" }]);

    expect(recentAiredTopics(DATE, SLOT1_AIRED_REPEAT_WINDOW_DAYS, root)).toEqual([WHITE_SHOE]);
  });

  it("swaps 8/19 slot 1 off the 8/14 aired 白鞋", async () => {
    const root = await tempRoot();
    await writeCalendar(root, AIRED, WHITE_SHOE);
    await writePosted(root, AIRED, [{ slot: 1, status: "success" }]);

    const content = buildDailyContent(DATE, config, { root, applyAiredCooldown: true });
    const slot1 = content.slots.find((slot) => slot.slot === 1);
    expect(slot1).toBeTruthy();
    expect(slot1!.topic).not.toBe(playbookSlot1(DATE).topic);
    expect(repeatingObjectGram(slot1!.topic, WHITE_SHOE)).toBeUndefined();
  });

  it("does not swap when applyAiredCooldown is off, even if posted-log would collide", async () => {
    const root = await tempRoot();
    await writeCalendar(root, AIRED, WHITE_SHOE);
    await writePosted(root, AIRED, [{ slot: 1, status: "success" }]);

    const content = buildDailyContent(DATE, config, { root });
    expect(content.slots.find((slot) => slot.slot === 1)?.topic).toBe(playbookSlot1(DATE).topic);
  });

  it("resolveSlot1AgainstAired keeps a topic that does not collide", () => {
    const slot = playbookSlot1("2026-08-21");
    const resolved = resolveSlot1AgainstAired(slot, [WHITE_SHOE]);
    expect(repeatingObjectGram(slot.topic, WHITE_SHOE)).toBeUndefined();
    expect(resolved.topic).toBe(slot.topic);
    expect(resolved.date).toBe("2026-08-21");
  });

  it("generateDailyContent applies the as-aired cooldown", async () => {
    const root = await tempRoot();
    await writeCalendar(root, AIRED, WHITE_SHOE);
    await writePosted(root, AIRED, [{ slot: 1, status: "success" }]);

    await generateDailyContent({ date: DATE, root, force: true });
    const written = JSON.parse(
      await readFile(join(root, "data", "content-calendar", `${DATE}.json`), "utf8")
    ) as { slots: Array<{ slot: number; topic: string }> };
    const slot1 = written.slots.find((slot) => slot.slot === 1);
    expect(slot1).toBeTruthy();
    expect(slot1!.topic).not.toBe(playbookSlot1(DATE).topic);
    expect(repeatingObjectGram(slot1!.topic, WHITE_SHOE)).toBeUndefined();
  });
});
