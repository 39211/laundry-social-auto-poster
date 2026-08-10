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
  const content = await loadDailyContent(date, root);
  const slot1 = content?.slots.find((slot) => slot.slot === 1);
  if (!slot1) return "no slot 1 to lock";
  // Never freeze an incomplete package: a lock taken before the images exist
  // makes every later heal restore the broken snapshot (luna, high).
  if (slot1.local_image_path) {
    try {
      const { stat } = await import("node:fs/promises");
      const info = await stat(join(root, ...slot1.local_image_path.split("/")));
      if (info.size === 0) return "slot 1 image is empty; not locking";
    } catch {
      return "slot 1 image missing; not locking";
    }
  }
  // flag wx = atomic check-and-create: two concurrent lockDay calls cannot
  // both win, so first-writer-wins actually holds (luna, high).
  const { writeFile, mkdir } = await import("node:fs/promises");
  const target = lockPath(date, root);
  await mkdir(join(root, "data", "day-locks"), { recursive: true });
  try {
    await writeFile(
      target,
      JSON.stringify({ date, locked_at: new Date().toISOString(), slot1 } satisfies DayLock, null, 2),
      { flag: "wx" }
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "already locked";
    throw error;
  }
  return "locked";
}

export async function healDay(date: string, root = projectRooted()): Promise<string> {
  const lock = await readJsonFile<DayLock | null>(lockPath(date, root), null);
  if (!lock) return "no lock";
  const content = await loadDailyContent(date, root);
  if (!content) return "no calendar";
  const slot1 = content.slots.find((slot) => slot.slot === 1);
  if (!slot1) return "no slot 1";
  // Full-slot comparison: both review families showed that comparing only
  // topic + instagram_caption lets a rewrite of facebook_caption, image
  // paths or media_type pass as intact and publish a split-brain package.
  if (JSON.stringify(slot1) === JSON.stringify(lock.slot1)) {
    return "intact";
  }
  // Re-read immediately before writing: the first read may be seconds old and
  // another process may have legitimately updated slot 2/3 in between; writing
  // the stale whole-calendar back would clobber their work (luna, high).
  const fresh = (await loadDailyContent(date, root)) ?? content;
  const restored = {
    ...fresh,
    slots: fresh.slots.map((slot) => (slot.slot === 1 ? lock.slot1 : slot))
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
