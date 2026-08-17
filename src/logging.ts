import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import {
  approvedLogPath,
  contentCalendarPath,
  dailyContextPath,
  docsContentCalendarPath,
  imageSourcesPath,
  postedLogPath,
  projectRoot,
  videoRepairQueuePath,
  videoSourcesPath
} from "./paths";
import type {
  ApprovalLogEntry,
  DailyContent,
  DailyContext,
  ImageSourceRecord,
  Platform,
  PostLogEntry,
  VideoRepairQueueEntry,
  VideoSourceRecord
} from "./types";

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/u, "")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

const JSON_LOCK_TIMEOUT_MS = 10_000;
const JSON_LOCK_STALE_MS = 30_000;

async function withJsonFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();

  while (true) {
    let handle: FileHandle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      const lockAgeMs = await stat(lockPath)
        .then((info) => Date.now() - info.mtimeMs)
        .catch(() => 0);
      if (lockAgeMs > JSON_LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= JSON_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for JSON log lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }

    try {
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, "utf8");
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export async function loadDailyContent(date: string, root = projectRoot()): Promise<DailyContent | undefined> {
  const content =
    (await readJsonFile<DailyContent | undefined>(contentCalendarPath(date, root), undefined)) ??
    (await readJsonFile<DailyContent | undefined>(docsContentCalendarPath(date, root), undefined));
  if (!content) return undefined;
  // Slot 3 is the optional noon Reel for dual-length A/B days. Existing
  // calendars stay at 2 slots; new days and healed A/B days may carry 3.
  if (!Array.isArray(content.slots) || content.slots.length < 2 || content.slots.length > 3) {
    throw new Error(`Invalid daily content for ${date}: expected 2 or 3 slots.`);
  }
  return content;
}

export async function writeDailyContent(content: DailyContent, root = projectRoot()): Promise<void> {
  await writeJsonAtomic(contentCalendarPath(content.date, root), content);
}

export async function loadPostLog(date: string, root = projectRoot()): Promise<PostLogEntry[]> {
  return readJsonFile<PostLogEntry[]>(postedLogPath(date, root), []);
}

export async function writePostLog(date: string, entries: PostLogEntry[], root = projectRoot()): Promise<void> {
  await writeJsonAtomic(postedLogPath(date, root), entries);
}

export async function appendPostLog(entry: PostLogEntry, root = projectRoot()): Promise<void> {
  const filePath = postedLogPath(entry.date, root);
  await withJsonFileLock(filePath, async () => {
    const entries = await readJsonFile<PostLogEntry[]>(filePath, []);
    entries.push(entry);
    await writeJsonAtomic(filePath, entries);
  });
}

export async function loadApprovalLog(date: string, root = projectRoot()): Promise<ApprovalLogEntry[]> {
  return readJsonFile<ApprovalLogEntry[]>(approvedLogPath(date, root), []);
}

export async function writeApprovalLog(
  date: string,
  entries: ApprovalLogEntry[],
  root = projectRoot()
): Promise<void> {
  await writeJsonAtomic(approvedLogPath(date, root), entries);
}

export async function appendApprovalLog(entry: ApprovalLogEntry, root = projectRoot()): Promise<void> {
  const filePath = approvedLogPath(entry.date, root);
  await withJsonFileLock(filePath, async () => {
    const entries = (await readJsonFile<ApprovalLogEntry[]>(filePath, [])).filter(
      (item) => !(item.slot === entry.slot && item.platform === entry.platform)
    );
    entries.push(entry);
    entries.sort((a, b) => a.slot - b.slot || a.platform.localeCompare(b.platform));
    await writeJsonAtomic(filePath, entries);
  });
}

export async function loadDailyContext(date: string, root = projectRoot()): Promise<DailyContext | undefined> {
  return readJsonFile<DailyContext | undefined>(dailyContextPath(date, root), undefined);
}

export async function writeDailyContext(context: DailyContext, root = projectRoot()): Promise<void> {
  await writeJsonAtomic(dailyContextPath(context.date, root), context);
}

export async function loadImageSources(date: string, root = projectRoot()): Promise<ImageSourceRecord[]> {
  return readJsonFile<ImageSourceRecord[]>(imageSourcesPath(date, root), []);
}

export async function writeImageSources(
  date: string,
  entries: ImageSourceRecord[],
  root = projectRoot()
): Promise<void> {
  await writeJsonAtomic(imageSourcesPath(date, root), entries);
}

export async function loadVideoSources(date: string, root = projectRoot()): Promise<VideoSourceRecord[]> {
  return readJsonFile<VideoSourceRecord[]>(videoSourcesPath(date, root), []);
}

export async function writeVideoSources(
  date: string,
  entries: VideoSourceRecord[],
  root = projectRoot()
): Promise<void> {
  await writeJsonAtomic(videoSourcesPath(date, root), entries);
}

export async function loadVideoRepairQueue(root = projectRoot()): Promise<VideoRepairQueueEntry[]> {
  return readJsonFile<VideoRepairQueueEntry[]>(videoRepairQueuePath(root), []);
}

export async function upsertVideoRepairQueue(
  entry: VideoRepairQueueEntry,
  root = projectRoot()
): Promise<void> {
  const filePath = videoRepairQueuePath(root);
  await withJsonFileLock(filePath, async () => {
    const entries = await readJsonFile<VideoRepairQueueEntry[]>(filePath, []);
    const existingIndex = entries.findIndex(
      (item) => item.source_date === entry.source_date && item.source_slot === entry.source_slot
    );
    if (existingIndex >= 0) {
      const existing = entries[existingIndex]!;
      if (existing.status !== "RESOLVED") entries[existingIndex] = { ...existing, ...entry };
    } else entries.push(entry);
    entries.sort((a, b) => a.source_date.localeCompare(b.source_date) || a.source_slot - b.source_slot);
    await writeJsonAtomic(filePath, entries);
  });
}

// After-the-fact correction of stored defer_kind verdicts that a later ruling
// turned obsolete. Only the unexpected -> expected direction exists, because a
// fault verdict is the one that raises alarms and is therefore the only one
// worth withdrawing; reclassified_at keeps a corrected entry distinguishable
// from one that was classified this way on detection.
export async function reclassifyVideoRepairQueue(
  shouldReclassify: (entry: VideoRepairQueueEntry) => boolean,
  reclassifiedAt: string,
  root = projectRoot()
): Promise<VideoRepairQueueEntry[]> {
  const filePath = videoRepairQueuePath(root);
  return withJsonFileLock(filePath, async () => {
    const entries = await readJsonFile<VideoRepairQueueEntry[]>(filePath, []);
    const changed: VideoRepairQueueEntry[] = [];
    for (const entry of entries) {
      if (entry.defer_kind !== "unexpected" || !shouldReclassify(entry)) continue;
      entry.defer_kind = "expected";
      entry.reclassified_at = reclassifiedAt;
      changed.push(entry);
    }
    if (changed.length > 0) await writeJsonAtomic(filePath, entries);
    return changed;
  });
}

export async function resolveVideoRepairQueue(
  sourceDate: string,
  sourceSlot: number,
  replacementDate: string,
  replacementSlot: number,
  root = projectRoot()
): Promise<void> {
  const filePath = videoRepairQueuePath(root);
  await withJsonFileLock(filePath, async () => {
    const entries = await readJsonFile<VideoRepairQueueEntry[]>(filePath, []);
    const existing = entries.find(
      (item) => item.source_date === sourceDate && item.source_slot === sourceSlot
    );
    if (!existing) {
      throw new Error(`Video repair item not found: ${sourceDate} slot ${sourceSlot}.`);
    }
    existing.status = "RESOLVED";
    existing.resolved_at = new Date().toISOString();
    existing.replacement_date = replacementDate;
    existing.replacement_slot = replacementSlot;
    await writeJsonAtomic(filePath, entries);
  });
}

export async function markVideoRepairReady(
  sourceDate: string,
  sourceSlot: number,
  replacementDate: string,
  replacementSlot: number,
  root = projectRoot()
): Promise<void> {
  const filePath = videoRepairQueuePath(root);
  await withJsonFileLock(filePath, async () => {
    const entries = await readJsonFile<VideoRepairQueueEntry[]>(filePath, []);
    const existing = entries.find(
      (item) => item.source_date === sourceDate && item.source_slot === sourceSlot
    );
    if (!existing) {
      throw new Error(`Video repair item not found: ${sourceDate} slot ${sourceSlot}.`);
    }
    existing.status = "VIDEO_DEFERRED";
    existing.replacement_ready_at = new Date().toISOString();
    existing.replacement_candidate_date = replacementDate;
    existing.replacement_candidate_slot = replacementSlot;
    await writeJsonAtomic(filePath, entries);
  });
}

export function hasRecordedPost(
  entries: PostLogEntry[],
  slot: number,
  platform: Platform,
  dryRun: boolean
): boolean {
  return entries.some((entry) => {
    if (entry.slot !== slot || entry.platform !== platform) return false;
    if (entry.status === "missed") return true;
    if (dryRun) return entry.dry_run && ["success", "dry_run"].includes(entry.status);
    return !entry.dry_run && ["success", "posted"].includes(entry.status);
  });
}

export function hasApprovedPost(entries: ApprovalLogEntry[], slot: number, platform: Platform): boolean {
  return entries.some(
    (entry) => entry.slot === slot && entry.platform === platform && entry.status === "approved"
  );
}
