import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, loadImageSources, writeImageSources } from "./logging";
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

  if (!slot) throw new Error("--slot is required.");
  if (!source) throw new Error("--source is required.");

  const content = await loadDailyContent(date, root);
  const dailySlot = content?.slots.find((item) => item.slot === slot);
  if (!dailySlot) throw new Error(`No slot ${slot} found for ${date}.`);

  const entries = (await loadImageSources(date, root)).filter((entry) => entry.slot !== slot);
  const record: ImageSourceRecord = {
    date,
    slot,
    source,
    image_path: dailySlot.local_image_path,
    marked_at: new Date().toISOString()
  };
  entries.push(record);
  entries.sort((a, b) => a.slot - b.slot);
  await writeImageSources(date, entries, root);
  console.log(`Marked slot ${slot} image source as ${source}.`);
}

if (isMain(import.meta.url)) {
  markImageSource().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
