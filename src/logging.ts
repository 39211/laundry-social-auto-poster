import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { contentCalendarPath, docsContentCalendarPath, postedLogPath, projectRoot } from "./paths";
import type { DailyContent, Platform, PostLogEntry } from "./types";

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function loadDailyContent(date: string, root = projectRoot()): Promise<DailyContent | undefined> {
  const content =
    (await readJsonFile<DailyContent | undefined>(docsContentCalendarPath(date, root), undefined)) ??
    (await readJsonFile<DailyContent | undefined>(contentCalendarPath(date, root), undefined));
  if (!content) return undefined;
  if (!Array.isArray(content.slots) || content.slots.length !== 10) {
    throw new Error(`Invalid daily content for ${date}: expected 10 slots.`);
  }
  return content;
}

export async function writeDailyContent(content: DailyContent, root = projectRoot()): Promise<void> {
  await Promise.all([
    writeJsonAtomic(docsContentCalendarPath(content.date, root), content),
    writeJsonAtomic(contentCalendarPath(content.date, root), content)
  ]);
}

export async function loadPostLog(date: string, root = projectRoot()): Promise<PostLogEntry[]> {
  return readJsonFile<PostLogEntry[]>(postedLogPath(date, root), []);
}

export async function writePostLog(date: string, entries: PostLogEntry[], root = projectRoot()): Promise<void> {
  await writeJsonAtomic(postedLogPath(date, root), entries);
}

export async function appendPostLog(entry: PostLogEntry, root = projectRoot()): Promise<void> {
  const entries = await loadPostLog(entry.date, root);
  entries.push(entry);
  await writePostLog(entry.date, entries, root);
}

export function hasRecordedPost(
  entries: PostLogEntry[],
  slot: number,
  platform: Platform,
  dryRun: boolean
): boolean {
  return entries.some((entry) => {
    if (entry.slot !== slot || entry.platform !== platform) return false;
    if (dryRun) return entry.dry_run && ["success", "dry_run"].includes(entry.status);
    return !entry.dry_run && ["success", "posted"].includes(entry.status);
  });
}
