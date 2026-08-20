import { access } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { buildDailyContent } from "./contentPlan";
import { contentCalendarPath, ensureProjectDirectories, projectRoot } from "./paths";
import { generateDailyContext } from "./generateDailyContext";
import { getZonedDateParts } from "./scheduler";
import { loadDailyContent, writeDailyContent } from "./logging";

export interface GenerateDailyContentOptions {
  date?: string;
  force?: boolean;
  root?: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function generateDailyContent(options: GenerateDailyContentOptions = {}): Promise<string> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const date = options.date || getZonedDateParts(new Date(), config.timezone).date;
  const calendarPath = contentCalendarPath(date, root);

  await ensureProjectDirectories(date, root);
  await generateDailyContext({ date, root, force: options.force });

  if (!options.force && (await exists(calendarPath))) {
    return calendarPath;
  }

  const content = buildDailyContent(date, config, { root, applyAiredCooldown: true, applySlot1Plan: true });

  // A scheduled Reel survives regeneration, forced or not. schedule-reel
  // places a reviewed video into slot 2 days ahead of publishing, and a force
  // regeneration -- Codex's own morning flow runs one -- was rebuilding the
  // day from the playbook and silently reverting that slot to a carousel whose
  // slides were never produced: 2026-07-30 lost both posts and 2026-07-31 lost
  // its Reel exactly this way. Regeneration owns the day's plan; it does not
  // own a slot another workflow already filled with reviewed, published-ready
  // media.
  const existing = await loadDailyContent(date, root);
  if (existing) {
    for (const [index, slot] of content.slots.entries()) {
      const current = existing.slots.find((item) => item.slot === slot.slot);
      if (current?.media_type === "reel" && current.local_video_path) {
        // Only a reel whose file is actually on disk is worth preserving; a
        // dangling path would pin a slot to a video that cannot publish and
        // make the slot immune to the regeneration that could fix it.
        const videoPath = join(root, ...current.local_video_path.split("/"));
        const videoExists = await exists(videoPath);
        if (videoExists) {
          // Replace the words, keep everything else. Keeping the whole slot
          // meant a video scheduled from yesterday's slot 3 into today's slot 2
          // brought its caption along, so five days of August published four
          // pairs of byte-identical posts one day apart -- and the plan for
          // 08-13/08-14 had already queued a fifth.
          //
          // Listing the media fields to carry over is the wrong way round: the
          // first attempt at this carried media_type and local_video_path and
          // dropped public_video_url and video_prompt, both of which
          // validatePublishableReel requires. A reviewed Reel would have failed
          // validation and published its cover image instead, silently. The
          // scheduled slot stays intact and only the captions -- the fields
          // that caused the duplication -- come from the new generation.
          content.slots[index] = {
            ...current,
            instagram_caption: slot.instagram_caption,
            facebook_caption: slot.facebook_caption,
          };
        }
      }
    }
  }

  // Force already rebuilt non-reel slots. Move their old bytes before the new
  // calendar lands, otherwise generate-missing-images sees the old files and
  // reports the day complete. Dynamic import avoids the cycle with generateImage
  // (that module calls this one to ensure a calendar exists).
  if (existing) {
    const { invalidateSlotImagesIfTopicChanged } = await import("./generateImage");
    for (const next of content.slots) {
      const previous = existing.slots.find((item) => item.slot === next.slot);
      if (!previous) continue;
      await invalidateSlotImagesIfTopicChanged({ date, root, previous, next });
    }
  }

  await writeDailyContent(content, root);
  return calendarPath;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const output = await generateDailyContent({
    date: getOption(args, "date"),
    force: getFlag(args, "force"),
    root: getOption(args, "root")
  });
  console.log(`Daily content ready: ${output}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
