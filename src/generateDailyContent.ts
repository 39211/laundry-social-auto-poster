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
    for (const current of existing.slots) {
      if (current.media_type !== "reel" || !current.local_video_path) continue;

      // Only a Reel whose file is actually on disk is worth preserving; a
      // dangling path would pin a slot to a video that cannot publish and
      // make the slot immune to the regeneration that could fix it.
      const videoPath = join(root, ...current.local_video_path.split("/"));
      if (!(await exists(videoPath))) continue;

      const generatedIndex = content.slots.findIndex((item) => item.slot === current.slot);
      if (generatedIndex === -1) {
        // A scheduled noon Reel can outlive the A/B plan that emitted it.
        // Slot 3 is the only omitted slot that regeneration may add back;
        // slot 4 and other unplanned slots stay retired.
        if (current.slot === 3) content.slots.push(current);
        continue;
      }

      if (current.slot <= 2) {
        const generated = content.slots[generatedIndex]!;
        // Keep the reviewed media and replace only the captions. Carrying the
        // old captions caused identical posts to repeat on adjacent days.
        content.slots[generatedIndex] = {
          ...current,
          instagram_caption: generated.instagram_caption,
          facebook_caption: generated.facebook_caption,
        };
      } else {
        // A generated noon template must not overwrite a scheduled Reel;
        // preserve its complete reviewed slot, including both captions.
        content.slots[generatedIndex] = current;
      }
    }
    content.slots.sort((a, b) => a.slot - b.slot);
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
