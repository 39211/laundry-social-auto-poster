import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, readJsonFile, writeDailyContent, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { DailySlot } from "./types";

// Locks a day's slot 1 once its images exist, and restores it when something
// rewrites the calendar afterwards. On 2026-08-07 the morning automation
// swapped slot 1's topic from the one the images were generated for to a
// recycled off-plan topic, and the day published a makeup-bag caption over
// school-shoe photos. Reels already heal from REEL_SCHEDULE; slot 1 has no
// schedule to heal from, so the day's own locked snapshot is the reference.
//
// The lock is created exactly once per date -- first come wins -- and only
// captures slot 1 (the image post). Slot 2/3 belong to the reel heal.

interface DayLock {
  date: string;
  locked_at: string;
  slot1: DailySlot;
}

function lockPath(date: string, root: string): string {
  return join(root, "data", "day-locks", `${date}.json`);
}

export async function lockDay(date: string, root = projectRooted()): Promise<string> {
  const existing = await readJsonFile<DayLock | null>(lockPath(date, root), null);
  if (existing) return "already locked";
  const content = await loadDailyContent(date, root);
  const slot1 = content?.slots.find((slot) => slot.slot === 1);
  if (!slot1) return "no slot 1 to lock";
  await writeJsonAtomic(lockPath(date, root), {
    date,
    locked_at: new Date().toISOString(),
    slot1
  } satisfies DayLock);
  return "locked";
}

export async function healDay(date: string, root = projectRooted()): Promise<string> {
  const lock = await readJsonFile<DayLock | null>(lockPath(date, root), null);
  if (!lock) return "no lock";
  const content = await loadDailyContent(date, root);
  if (!content) return "no calendar";
  const slot1 = content.slots.find((slot) => slot.slot === 1);
  if (!slot1) return "no slot 1";
  if (slot1.topic === lock.slot1.topic && slot1.instagram_caption === lock.slot1.instagram_caption) {
    return "intact";
  }
  const restored = {
    ...content,
    slots: content.slots.map((slot) => (slot.slot === 1 ? lock.slot1 : slot))
  };
  await writeDailyContent(restored, root);
  return `restored slot 1 to "${lock.slot1.topic.slice(0, 24)}" (was "${slot1.topic.slice(0, 24)}")`;
}

function projectRooted(): string {
  return projectRoot();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));
  const config = getConfig();
  const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
  const result = getFlag(args, "heal") ? await healDay(date, root) : await lockDay(date, root);
  console.log(`${date}: ${result}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
