import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { dailyContextPath, ensureProjectDirectories, projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import { writeDailyContext } from "./logging";
import type { DailyContext } from "./types";

export interface GenerateDailyContextOptions {
  date?: string;
  force?: boolean;
  root?: string;
}

export async function generateDailyContext(options: GenerateDailyContextOptions = {}): Promise<string> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const date = options.date || getZonedDateParts(new Date(), config.timezone).date;
  await ensureProjectDirectories(date, root);

  const context: DailyContext = {
    date,
    timezone: config.timezone,
    generated_at: new Date().toISOString(),
    weather: {
      location: "Taichung",
      summary: "July humidity and commute dust can make shoes, bag corners, collars, and bedding hold odor faster.",
      care_bridge: "Use realistic shop-counter inspection angles; weather is caption context, not the image subject."
    },
    local_hooks: [
      "No major holiday is configured for this date.",
      "Use everyday laundry-care situations unless an item-specific care consequence is concrete."
    ],
    warnings: []
  };

  await writeDailyContext(context, root);
  return dailyContextPath(date, root);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const output = await generateDailyContext({
    date: getOption(args, "date"),
    force: getFlag(args, "force"),
    root: getOption(args, "root")
  });
  console.log(`Daily context ready: ${output}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
