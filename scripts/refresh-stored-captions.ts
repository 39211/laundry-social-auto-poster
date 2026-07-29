import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import { loadDailyContent, writeJsonAtomic } from "../src/logging";
import { contentCalendarPath, projectRoot } from "../src/paths";

// Calendars store the caption text generated at the time they were written, so
// every caption fix in contentPlan.ts leaves pre-generated dates carrying the
// old copy -- the same failure the image prompts had. This rewrites only the
// caption fields of stored calendars from today's generator. Reel slots are
// left alone entirely: their captions come from the concept, are already
// current, and the slot may carry an owner review that must keep describing
// exactly what it reviewed.

const root = projectRoot();
const config = getConfig();
const dates = process.argv.slice(2).filter((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
if (dates.length === 0) {
  throw new Error("Pass the dates to refresh: tsx scripts/refresh-stored-captions.ts 2026-07-30 ...");
}

for (const date of dates) {
  const stored = await loadDailyContent(date, root);
  if (!stored) {
    console.log(`${date}: no calendar, skipped`);
    continue;
  }

  const fresh = buildDailyContent(date, config);
  let changed = 0;

  for (const slot of stored.slots) {
    if (slot.media_type === "reel") continue;
    const freshSlot = fresh.slots.find((item) => item.slot === slot.slot);
    if (!freshSlot) continue;
    if (
      slot.instagram_caption === freshSlot.instagram_caption &&
      slot.facebook_caption === freshSlot.facebook_caption
    ) {
      continue;
    }
    slot.instagram_caption = freshSlot.instagram_caption;
    slot.facebook_caption = freshSlot.facebook_caption;
    changed += 1;
  }

  if (changed > 0) {
    await writeJsonAtomic(contentCalendarPath(date, root), stored);
  }
  console.log(`${date}: ${changed} slot caption(s) refreshed`);
}
