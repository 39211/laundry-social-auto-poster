import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface FeaturePostedLogEntry {
  platform?: unknown;
  slug?: unknown;
  status?: unknown;
  post_id?: unknown;
  scheduled_publish_at?: unknown;
  at?: unknown;
}

export interface FeaturePostedLogDate {
  date: string;
  rows: FeaturePostedLogEntry[];
}

export interface FeaturePostedLogRange {
  dates: FeaturePostedLogDate[];
  skippedFiles: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Read feature publication rows in an inclusive date range. Bad files are skipped independently. */
export async function readFeaturePostedLogRange(
  root: string,
  since: string,
  until: string
): Promise<FeaturePostedLogRange> {
  const directory = join(root, "data", "feature-posted-log");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dates: [], skippedFiles: 0 };
    throw error;
  }

  const dates = names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name))
    .map((name) => name.slice(0, 10))
    .filter((date) => date >= since && date <= until)
    .sort();
  const result: FeaturePostedLogDate[] = [];
  let skippedFiles = 0;

  for (const date of dates) {
    try {
      const raw = await readFile(join(directory, `${date}.json`), "utf8");
      const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/u, ""));
      if (!Array.isArray(parsed)) {
        skippedFiles += 1;
        continue;
      }
      result.push({
        date,
        rows: parsed.filter(isRecord) as FeaturePostedLogEntry[]
      });
    } catch {
      skippedFiles += 1;
    }
  }

  return { dates: result, skippedFiles };
}

export async function readFeatureReelYoutubeTitle(root: string, date: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(root, "data", "feature-reels", `${date}.json`), "utf8");
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/u, ""));
    if (!isRecord(parsed)) return undefined;
    return typeof parsed.youtube_title === "string" && parsed.youtube_title.trim()
      ? parsed.youtube_title
      : undefined;
  } catch {
    return undefined;
  }
}
