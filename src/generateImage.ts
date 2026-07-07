import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { imagePromptManifestPath, projectRoot } from "./paths";
import { generateDailyContent } from "./generateDailyContent";
import { loadDailyContent, loadImageSources, writeJsonAtomic } from "./logging";
import { getZonedDateParts } from "./scheduler";
import type { VisualRoute } from "./types";

interface ImagePromptManifestItem {
  slot: number;
  topic: string;
  prompt: string;
  visual_route: VisualRoute;
  target_path: string;
  public_image_url: string;
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

  const manifest: ImagePromptManifestItem[] = content.slots.map((slot) => ({
    slot: slot.slot,
    topic: slot.topic,
    prompt: slot.image_prompt,
    visual_route: slot.visual_route,
    target_path: slot.local_image_path,
    public_image_url: slot.public_image_url
  }));

  const output = imagePromptManifestPath(date, root);
  await writeJsonAtomic(output, manifest);
  return output;
}

export async function validateImageAssets(date: string, root = projectRoot()): Promise<void> {
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const missing: string[] = [];
  for (const slot of content.slots) {
    const fullPath = join(root, ...slot.local_image_path.split("/"));
    if (!(await fileExists(fullPath))) {
      missing.push(slot.local_image_path);
      continue;
    }
    const info = await stat(fullPath);
    if (info.size === 0) missing.push(`${slot.local_image_path} (empty)`);
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
  const missingSources = content.slots
    .filter(
      (slot) =>
        !sources.some(
          (source) =>
            source.slot === slot.slot &&
            source.source === "gpt-image-2" &&
            source.image_path === slot.local_image_path
        )
    )
    .map((slot) => `slot ${slot.slot}: ${slot.local_image_path}`);

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
