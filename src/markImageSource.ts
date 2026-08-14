import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { hashImageFile, loadImagePromptManifest, promptHashFor } from "./imageStamp";
import { loadDailyContent, loadImageSources, writeImageSources } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { ImageSourceRecord } from "./types";

// Exported so tests can drive the real writer. While this only existed as a
// CLI entry point the tests hand-wrote the JSON it produces, and a mutation
// that deleted the entire stamping step left all 213 of them green.
export async function markImageSource(options: {
  root?: string;
  date?: string;
  slot?: number;
  source?: string;
  imagePath?: string;
} = {}): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const root = projectRoot(options.root ?? getOption(args, "root"));
  const date =
    options.date || getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const slot = options.slot ?? getNumberOption(args, "slot");
  const source = options.source ?? getOption(args, "source");
  const imagePath = options.imagePath ?? getOption(args, "path");

  if (!slot) throw new Error("--slot is required.");
  if (!source) throw new Error("--source is required.");

  const content = await loadDailyContent(date, root);
  const dailySlot = content?.slots.find((item) => item.slot === slot);
  if (!dailySlot) throw new Error(`No slot ${slot} found for ${date}.`);
  const assets = imageAssetsForSlot(dailySlot);
  if (assets.length > 1 && !imagePath) {
    throw new Error("--path is required for carousel slots so every slide receives its own source record.");
  }
  const target = imagePath ?? assets[0]?.local_image_path;
  if (!target || !assets.some((asset) => asset.local_image_path === target)) {
    throw new Error(`Image path does not belong to slot ${slot}: ${target ?? "(missing)"}`);
  }

  const all = await loadImageSources(date, root);
  const imageSha = await hashImageFile(root, target);
  if (!imageSha) throw new Error(`Cannot stamp an image that does not exist: ${target}`);
  const promptSha = promptHashFor(await loadImagePromptManifest(root, date), target);

  // Write-once over unchanged bytes. Re-running this command on a file that has
  // not been regenerated is exactly the move that would let a stale image be
  // relabelled with today's topic, and the approval gate trusts this record --
  // so the refusal has to live here, where the bytes are in hand.
  const existing = all.find((entry) => entry.slot === slot && entry.image_path === target);
  if (existing && existing.image_sha256 === imageSha) {
    if (existing.topic === dailySlot.topic && existing.prompt_sha256 === promptSha) {
      console.log(`Already marked and unchanged, leaving as is: ${target}`);
      return;
    }
    throw new Error(
      `Refusing to re-stamp ${target}: the file is byte-identical to the one already recorded ` +
        `(topic 「${existing.topic ?? "(none)"}」), so nothing about how it was made can have ` +
        `changed. Regenerate the image if the topic changed.`
    );
  }

  const entries = all.filter((entry) => !(entry.slot === slot && entry.image_path === target));
  const record: ImageSourceRecord = {
    date,
    slot,
    source,
    image_path: target,
    marked_at: new Date().toISOString(),
    topic: dailySlot.topic,
    prompt_sha256: promptSha,
    image_sha256: imageSha
  };
  entries.push(record);
  entries.sort((a, b) => a.slot - b.slot || a.image_path.localeCompare(b.image_path));
  await writeImageSources(date, entries, root);
  console.log(`Marked slot ${slot} image source as ${source}: ${target}`);
}

if (isMain(import.meta.url)) {
  markImageSource({}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
