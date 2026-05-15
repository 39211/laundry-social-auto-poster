import { access } from "node:fs/promises";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { buildDailyContent } from "./contentPlan";
import { docsContentCalendarPath, ensureProjectDirectories, projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import { writeDailyContent } from "./logging";

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
  const calendarPath = docsContentCalendarPath(date, root);

  await ensureProjectDirectories(date, root);

  if (!options.force && (await exists(calendarPath))) {
    return calendarPath;
  }

  const content = buildDailyContent(date, config);
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
