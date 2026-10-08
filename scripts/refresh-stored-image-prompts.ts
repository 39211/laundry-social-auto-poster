import { buildCarouselImagePrompts, canonicalSeoSyncPage } from "../src/contentPlan";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import { projectRoot } from "../src/paths";

// The sibling of scripts/refresh-stored-captions.ts, for the other half of the
// stored output. A calendar keeps the image prompt that was generated the day
// it was written, and src/generateImage.ts builds the manifest from that stored
// text -- so a fix to the object table in contentPlan.ts changes nothing for
// any date already on disk. 2026-09-10: 抱枕 and 枕頭 had been falling into the
// bedding row and 沙發 into the untyped fallback, so three already-generated
// days were carrying prompts that described a duvet for a cushion topic.
//
// Only the named slots are touched, reel slots are refused outright, and the
// prompt is rebuilt from the slot that is stored -- its own topic, caption and
// SEO page -- never from what the generator would plan for that date today. By
// D+1 the rotation has moved on, so rebuilding from a fresh plan would quietly
// swap the reviewed topic for a different one.
//
//   npx tsx scripts/refresh-stored-image-prompts.ts 2026-09-14:2 2026-09-12:1
//   npx tsx scripts/refresh-stored-image-prompts.ts 2026-09-14:2 --dry-run

const root = projectRoot();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// A calendar written by anything other than writeDailyContent keeps the stamp
// it had before the edit, and every later load reports tampered:true. --restamp
// rewrites a day whose prompts are already correct, purely to reseal it.
const restamp = args.includes("--restamp");
const targets = args
  .filter((arg) => /^\d{4}-\d{2}-\d{2}:\d+$/.test(arg))
  .map((arg) => {
    const [date, slot] = arg.split(":");
    return { date: date!, slot: Number(slot) };
  });

if (targets.length === 0) {
  throw new Error("Pass date:slot pairs, e.g. tsx scripts/refresh-stored-image-prompts.ts 2026-09-14:2");
}

const byDate = new Map<string, number[]>();
for (const target of targets) {
  byDate.set(target.date, [...(byDate.get(target.date) ?? []), target.slot]);
}

let failures = 0;

for (const [date, slots] of byDate) {
  const stored = await loadDailyContent(date, root);
  if (!stored) {
    console.log(`${date}: no calendar, skipped`);
    failures += 1;
    continue;
  }
  let changed = 0;

  for (const slotNumber of slots) {
    const slot = stored.slots.find((item) => item.slot === slotNumber);
    if (!slot) {
      console.log(`${date} slot ${slotNumber}: not in the calendar`);
      failures += 1;
      continue;
    }
    if (slot.media_type === "reel") {
      console.log(`${date} slot ${slotNumber}: reel slot, refused (its stills belong to the reviewed video)`);
      failures += 1;
      continue;
    }

    // Built from the slot that is actually stored, not from what the generator
    // would plan for this date today: by D+1 the rotation has moved on and a
    // fresh plan carries a different topic entirely. The topic, the caption and
    // the SEO page all stay exactly as reviewed; only the prompt derived from
    // them is recomputed.
    const caption = [slot.facebook_caption, slot.instagram_caption, slot.topic]
      .filter((part): part is string => Boolean(part))
      .join("\n");
    const prompts = buildCarouselImagePrompts({
      date,
      slot: slot.slot,
      topic: slot.topic,
      caption,
      seo_sync_page: canonicalSeoSyncPage(slot.seo_sync_page)
    });
    if (prompts.length === 0) {
      console.log(`${date} slot ${slotNumber}: the generator produced no prompts`);
      failures += 1;
      continue;
    }

    const slides = slot.carousel_items?.length ?? 1;
    if (prompts.length < slides) {
      console.log(`${date} slot ${slotNumber}: REFUSED, ${prompts.length} fresh prompts for ${slides} stored slides`);
      failures += 1;
      continue;
    }

    const before = JSON.stringify({ hero: slot.image_prompt, items: slot.carousel_items });
    const wasHero = slot.image_prompt;
    slot.image_prompt = prompts[0];
    if (slot.carousel_items) {
      slot.carousel_items = slot.carousel_items.map((item, index) => ({
        ...item,
        image_prompt: prompts[index] ?? item.image_prompt
      }));
    }
    const after = JSON.stringify({ hero: slot.image_prompt, items: slot.carousel_items });
    if (before === after && !restamp) {
      console.log(`${date} slot ${slotNumber}: already current`);
      continue;
    }
    if (before === after) {
      changed += 1;
      console.log(`${date} slot ${slotNumber}: unchanged, rewriting to reseal the calendar stamp`);
      continue;
    }
    changed += 1;
    const passport = (text: string | undefined): string =>
      (text ?? "").replace(/^OBJECT PASSPORT: ([^;]+);.*$/s, "$1").slice(0, 110);
    console.log(`${date} slot ${slotNumber}: refreshed (${slides} slide(s))`);
    console.log(`  topic: ${slot.topic}`);
    console.log(`  was  : ${passport(wasHero)}`);
    console.log(`  now  : ${passport(slot.image_prompt)}`);
  }

  if (changed > 0 && !dryRun) {
    // writeDailyContent, never writeJsonAtomic: the calendar carries an HMAC
    // stamp over its own contents, so a raw write leaves the old stamp against
    // new text and every later loadDailyContent returns tampered:true --
    // auto-approve then refuses the whole day with "tampered calendar refused".
    await writeDailyContent(stored, root);
    console.log(`${date}: wrote ${changed} slot(s)`);
  } else if (changed > 0) {
    console.log(`${date}: dry run, ${changed} slot(s) would be written`);
  }
}

if (failures > 0) process.exitCode = 1;
