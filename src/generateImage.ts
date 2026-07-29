import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { imagePromptManifestPath, projectRoot } from "./paths";
import { generateDailyContent } from "./generateDailyContent";
import { loadDailyContent, loadImageSources, writeJsonAtomic } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { getZonedDateParts } from "./scheduler";
import type { VisualRoute } from "./types";

interface ImagePromptManifestItem {
  slot: number;
  slide: number;
  topic: string;
  prompt: string;
  visual_route: VisualRoute;
  target_path: string;
  public_image_url: string;
}

// The boutique look was retired from the prompt code, but calendars written
// before that carry the old prompt text verbatim, and this manifest is built
// from the calendar -- so the look kept coming back on every pre-generated
// date. Those calendars cannot be regenerated (their slot 2 may hold a
// reviewed, scheduled Reel), so the stale styling is rewritten here, at the
// point every image prompt passes through.
//
// The wear line exists because "preserve original condition" on a rendered
// image means brand new: today's post about damp shoe linings went out with a
// spotless boutique product shot. A care shop photographs items customers
// actually brought in.
const RETIRED_STYLE =
  /Premium Taiwanese laundry[^.]*Apple-like spacing[^.]*\.|restrained Apple-like spacing[^.]*\./g;

const PHONE_REALISM_REWRITE =
  "Shot on a phone by shop staff inside an ordinary Taiwanese laundry shop, handheld with slight " +
  "natural camera shake and imperfect framing, tiled floor and metal racks visible, fluorescent " +
  "ceiling light mixed with window daylight. The featured item shows honest everyday use consistent " +
  "with the topic - dust, scuffs, creases or slight discolouration where the topic describes them - " +
  "and must not look brand new or freshly styled. Not cinematic, not studio lighting, not glossy, " +
  "no boutique or showroom interior, no stock-photo feel, no laundry basket as a featured object, " +
  "no fake logo, no readable text, no watermark.";

export function sanitizeImagePrompt(prompt: string): string {
  if (!RETIRED_STYLE.test(prompt)) {
    RETIRED_STYLE.lastIndex = 0;
    return prompt;
  }
  RETIRED_STYLE.lastIndex = 0;
  return `${prompt.replace(RETIRED_STYLE, "").replace(/\s+/g, " ").trim()} ${PHONE_REALISM_REWRITE}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeImagePromptManifest(date: string, root = projectRoot()): Promise<string> {
  await generateDailyContent({ date, root });
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const manifest: ImagePromptManifestItem[] = content.slots.flatMap((slot) =>
    imageAssetsForSlot(slot).map((asset) => ({
      slot: slot.slot,
      slide: asset.slide,
      topic: slot.topic,
      prompt: sanitizeImagePrompt(asset.image_prompt),
      visual_route: slot.visual_route,
      target_path: asset.local_image_path,
      public_image_url: asset.public_image_url
    }))
  );

  const output = imagePromptManifestPath(date, root);
  await writeJsonAtomic(output, manifest);
  return output;
}

export async function validateImageAssets(date: string, root = projectRoot()): Promise<void> {
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const missing: string[] = [];
  for (const slot of content.slots) {
    for (const asset of imageAssetsForSlot(slot)) {
      const fullPath = join(root, ...asset.local_image_path.split("/"));
      if (!(await fileExists(fullPath))) {
        missing.push(asset.local_image_path);
        continue;
      }
      const info = await stat(fullPath);
      if (info.size === 0) missing.push(`${asset.local_image_path} (empty)`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing image assets:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  }
}

export async function validatePublishableImages(date: string, root = projectRoot()): Promise<void> {
  await validateImageAssets(date, root);
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const sources = await loadImageSources(date, root);
  const missingSources = content.slots.flatMap((slot) =>
    imageAssetsForSlot(slot)
      .filter(
        (asset) =>
        !sources.some(
          (source) =>
            source.slot === slot.slot &&
            source.source === "gpt-image-2" &&
            source.image_path === asset.local_image_path
        )
      )
      .map((asset) => `slot ${slot.slot} slide ${asset.slide}: ${asset.local_image_path}`)
  );

  if (missingSources.length > 0) {
    throw new Error(`Missing gpt-image-2 source records:\n${missingSources.map((item) => `- ${item}`).join("\n")}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "validate") || getFlag(args, "validate-images")) {
    await validateImageAssets(date, root);
    console.log(`All image assets exist for ${date}.`);
    return;
  }

  if (getFlag(args, "validate-publishable")) {
    await validatePublishableImages(date, root);
    console.log(`All publishable image assets are ready for ${date}.`);
    return;
  }

  const output = await writeImagePromptManifest(date, root);
  console.log(`Image prompt manifest ready: ${output}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
