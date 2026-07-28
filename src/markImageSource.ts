import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, loadImageSources, writeImageSources } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { ImageSourceRecord } from "./types";

async function markImageSource(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const root = projectRoot(getOption(args, "root"));
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const slot = getNumberOption(args, "slot");
  const source = getOption(args, "source");
  const imagePath = getOption(args, "path");

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

  const entries = (await loadImageSources(date, root)).filter(
    (entry) => !(entry.slot === slot && entry.image_path === target)
  );
  const record: ImageSourceRecord = {
    date,
    slot,
    source,
    image_path: target,
    marked_at: new Date().toISOString()
  };
  entries.push(record);
  entries.sort((a, b) => a.slot - b.slot || a.image_path.localeCompare(b.image_path));
  await writeImageSources(date, entries, root);
  console.log(`Marked slot ${slot} image source as ${source}: ${target}`);
}

if (isMain(import.meta.url)) {
  markImageSource().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
