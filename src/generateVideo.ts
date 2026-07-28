import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { generateDailyContent } from "./generateDailyContent";
import { loadDailyContent, loadVideoSources, writeJsonAtomic } from "./logging";
import { projectRoot, videoPromptManifestPath } from "./paths";
import { getZonedDateParts } from "./scheduler";
import { validatePublishableImages } from "./generateImage";
import { assertMetaReelMetadata, probeVideo } from "./videoMedia";
import { assertReelRunFresh, assessReelRunFreshness } from "./videoRunFreshness";
import { assertVideoReviewApproved } from "./videoReviewGate";
import type { DailySlot } from "./types";

export interface VideoPromptManifestItem {
  date: string;
  slot: number;
  topic: string;
  prompt: string;
  model: "grok-imagine-video";
  duration_seconds: 10;
  aspect_ratio: "9:16";
  resolution: "720p";
  target_path: string;
  public_video_url: string;
  status: "generation_pending";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeVideoPromptManifest(date: string, root = projectRoot()): Promise<string> {
  await generateDailyContent({ date, root });
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const items: VideoPromptManifestItem[] = content.slots
    .filter((slot) => slot.media_type === "reel")
    .map((slot) => {
      if (!slot.video_prompt || !slot.local_video_path) {
        throw new Error(`Reel slot ${slot.slot} is missing video prompt or target path for ${date}.`);
      }
      return {
        date,
        slot: slot.slot,
        topic: slot.topic,
        prompt: slot.video_prompt,
        model: "grok-imagine-video",
        duration_seconds: 10,
        aspect_ratio: "9:16",
        resolution: "720p",
        target_path: slot.local_video_path,
        public_video_url: slot.public_video_url ?? "",
        status: "generation_pending"
      };
    });

  const output = videoPromptManifestPath(date, root);
  await writeJsonAtomic(output, items);
  return output;
}

export async function validatePublishableMedia(date: string, root = projectRoot()): Promise<void> {
  await validatePublishableImages(date, root);
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  for (const slot of content.slots.filter(
    (item) => item.media_type === "reel" || item.media_type === "mixed-carousel"
  )) {
    await validatePublishableReel(slot, date, root);
  }
}

/**
 * Hard gate for one planned Reel. Publishing calls this directly so a cover
 * image can never satisfy a Reel slot by itself.
 */
export async function validatePublishableReel(
  slot: DailySlot,
  date: string,
  root = projectRoot()
): Promise<void> {
  if (slot.media_type !== "reel" && slot.media_type !== "mixed-carousel") {
    throw new Error(`Slot ${slot.slot} is not configured with publishable video.`);
  }
  if (!slot.local_video_path) throw new Error(`Video slot ${slot.slot} has no local video path.`);
  if (!slot.public_video_url?.startsWith("https://")) {
    throw new Error(`Video slot ${slot.slot} has no public HTTPS video URL.`);
  }

  const fullPath = join(root, ...slot.local_video_path.split("/"));
  if (!(await fileExists(fullPath)) || (await stat(fullPath)).size === 0) {
    throw new Error(`Video is missing for slot ${slot.slot}: ${slot.local_video_path}`);
  }

  const sources = await loadVideoSources(date, root);
  const source = sources.find(
    (entry) =>
      entry.slot === slot.slot &&
      entry.source === "grok-imagine-video" &&
      entry.video_path === slot.local_video_path
  );
  if (!source) throw new Error(`Grok video source record is missing for slot ${slot.slot}: ${slot.local_video_path}`);

  if (!slot.video_prompt) {
    throw new Error(`Video slot ${slot.slot} is missing video_prompt; cannot verify creative freshness.`);
  }
  const freshness = await assessReelRunFreshness({
    date,
    slot: slot.slot,
    videoPrompt: slot.video_prompt,
    targetPath: slot.local_video_path,
    root
  });
  assertReelRunFresh(freshness);

  const metadata = await probeVideo(fullPath);
  assertMetaReelMetadata(metadata);
  await assertVideoReviewApproved({
    date,
    slot: slot.slot,
    videoPath: slot.local_video_path,
    videoPrompt: slot.video_prompt,
    root
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "validate") || getFlag(args, "validate-publishable")) {
    await validatePublishableMedia(date, root);
    console.log(`All publishable image and Reel assets are ready for ${date}.`);
    return;
  }

  const output = await writeVideoPromptManifest(date, root);
  console.log(`Video prompt manifest ready: ${output}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
