import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import {
  inspectDailyContentIntegrity,
  stampDailyContentWrite,
  type StampedDailyContent
} from "./contentPlan";
import {
  approvedLogPath,
  contentCalendarPath,
  dailyContextPath,
  docsContentCalendarPath,
  imageSourcesPath,
  postedLogPath,
  projectRoot,
  videoRepairQueuePath,
  videoReviewsPath,
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

export interface LoadDailyContentOptions {
  today?: string;
}

export async function loadDailyContent(
  date: string,
  root = projectRoot(),
  options: LoadDailyContentOptions = {}
): Promise<StampedDailyContent | undefined> {
  const content =
    (await readJsonFile<StampedDailyContent | undefined>(contentCalendarPath(date, root), undefined)) ??
    (await readJsonFile<StampedDailyContent | undefined>(docsContentCalendarPath(date, root), undefined));
  if (!content) return undefined;
  // Slot 3 is the optional noon Reel for dual-length A/B days. Existing
  // calendars stay at 2 slots; new days and healed A/B days may carry 3.
  if (!Array.isArray(content.slots) || content.slots.length < 2 || content.slots.length > 3) {
    throw new Error(`Invalid daily content for ${date}: expected 2 or 3 slots.`);
  }
  const inspection = inspectDailyContentIntegrity(content, { today: options.today, root });
  if (inspection.tampered) {
    return { ...content, tampered: true };
  }
  return content;
}

export async function writeDailyContent(content: DailyContent, root = projectRoot()): Promise<void> {
  await writeJsonAtomic(contentCalendarPath(content.date, root), stampDailyContentWrite(content, { root }));
}

export function calendarTamperEvidencePath(date: string, root = projectRoot()): string {
  return join(root, "output", "operations", `calendar-tamper-${date}.json`);
}

export interface CalendarTamperDetection {
  present: boolean;
  tampered: boolean;
  shouldRebuild: boolean;
  reasons: string[];
  evidencePath?: string;
  weak?: boolean;
}

export async function detectAndRecordCalendarTamper(
  date: string,
  root = projectRoot(),
  options: LoadDailyContentOptions = {}
): Promise<CalendarTamperDetection> {
  const content = await readJsonFile<StampedDailyContent | undefined>(
    contentCalendarPath(date, root),
    undefined
  );
  if (!content) {
    return { present: false, tampered: false, shouldRebuild: false, reasons: [], weak: false };
  }
  const inspection = inspectDailyContentIntegrity(content, { today: options.today, root });
  if (!inspection.shouldRebuild) {
    return {
      present: true,
      tampered: inspection.tampered,
      shouldRebuild: false,
      reasons: inspection.reasons,
      weak: inspection.weak
    };
  }
  const evidencePath = calendarTamperEvidencePath(date, root);
  await writeJsonAtomic(evidencePath, {
    date,
    detected_at: new Date().toISOString(),
    reasons: inspection.reasons,
    action: "rebuild_from_plan",
    tampered_copy: content
  });
  return {
    present: true,
    tampered: true,
    shouldRebuild: true,
    reasons: inspection.reasons,
    evidencePath,
    weak: inspection.weak
  };
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

export interface AiredReelVideoSha {
  date: string;
  slot: number;
  video_sha256: string;
}

type PostLogEntryWithVideoSha = PostLogEntry & { video_sha256?: unknown };

function postedVideoSha(entry: PostLogEntry): string | undefined {
  const value = (entry as PostLogEntryWithVideoSha).video_sha256;
  if (typeof value !== "string") return undefined;
  const sha = value.trim().toLowerCase();
  return sha.length > 0 ? sha : undefined;
}

/**
 * A live Reel that actually went out. Hash is not required here: historical
 * posted-log rows predate video_sha256. The 21-day window fills those from
 * video-reviews for the same date+slot; it does not invent a hash when both
 * sources are empty, and it never treats a review-only (never aired) row as
 * an airing.
 */
export function isLiveAiredReelEntry(entry: PostLogEntry): boolean {
  if (entry.dry_run) return false;
  if (!["success", "posted", "uncertain"].includes(entry.status)) return false;
  if (entry.video_status === "VIDEO_DEFERRED") return false;
  return (
    entry.video_status === "published" ||
    entry.published_media_type === "reel" ||
    entry.published_media_type === "mixed-carousel"
  );
}

export function postedVideoShaFields(videoSha256: string | undefined): { video_sha256?: string } {
  return videoSha256 ? { video_sha256: videoSha256 } : {};
}

export function findDuplicateAiredReelVideo(
  videoSha256: string,
  aired: AiredReelVideoSha[],
  currentDate: string,
  currentSlot: number
): AiredReelVideoSha | undefined {
  const wanted = videoSha256.trim().toLowerCase();
  if (!wanted) return undefined;
  return aired.find(
    (item) =>
      item.video_sha256 === wanted && (item.date !== currentDate || item.slot !== currentSlot)
  );
}

type ReviewShaRecord = { slot?: unknown; video_sha256?: unknown };

async function loadVideoReviewShasBySlot(date: string, root: string): Promise<Map<number, string>> {
  const records = await readJsonFile<ReviewShaRecord[]>(videoReviewsPath(date, root), []);
  const bySlot = new Map<number, string>();
  if (!Array.isArray(records)) return bySlot;
  for (const record of records) {
    const slot = typeof record.slot === "number" ? record.slot : Number(record.slot);
    if (!Number.isInteger(slot) || slot < 1) continue;
    const sha = typeof record.video_sha256 === "string" ? record.video_sha256.trim().toLowerCase() : "";
    if (!sha) continue;
    if (!bySlot.has(slot)) bySlot.set(slot, sha);
  }
  return bySlot;
}

function airedReelVideoSha(
  entry: PostLogEntry,
  reviewShas: Map<number, string>
): string | undefined {
  return postedVideoSha(entry) ?? reviewShas.get(entry.slot);
}

export async function loadRecentAiredReelVideoShas(
  date: string,
  root: string,
  windowDays: number
): Promise<AiredReelVideoSha[]> {
  const aired: AiredReelVideoSha[] = [];
  const seen = new Set<string>();
  for (let back = 0; back < windowDays; back += 1) {
    const past = new Date(`${date}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() - back);
    const pastDate = past.toISOString().slice(0, 10);
    const entries = await loadPostLog(pastDate, root);
    const reviewShas = await loadVideoReviewShasBySlot(pastDate, root);
    for (const entry of entries) {
      if (!isLiveAiredReelEntry(entry)) continue;
      const videoSha256 = airedReelVideoSha(entry, reviewShas);
      if (!videoSha256) continue;
      const key = `${entry.date || pastDate}:${entry.slot}:${videoSha256}`;
      if (seen.has(key)) continue;
      seen.add(key);
      aired.push({ date: entry.date || pastDate, slot: entry.slot, video_sha256: videoSha256 });
    }
  }
  return aired;
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
    // "uncertain" counts as recorded: the post may be live, so the only safe
    // reading is "do not publish this again"; a human clears it after checking
    // the platform's own dashboard.
    return !entry.dry_run && ["success", "posted", "uncertain"].includes(entry.status);
  });
}

/**
 * Approval that publishing may act on. A forced approval is a human override
 * recorded for audit; it is consent to exist in the log, not consent to
 * publish. hasApprovedPost keeps answering "was anything approved" for
 * idempotence checks; this answers the only question publishing may ask.
 */
export function hasPublishableApproval(
  entries: ApprovalLogEntry[],
  slot: number,
  platform: Platform
): boolean {
  return entries.some(
    (entry) =>
      entry.slot === slot &&
      entry.platform === platform &&
      entry.status === "approved" &&
      !entry.forced
  );
}

export function hasApprovedPost(entries: ApprovalLogEntry[], slot: number, platform: Platform): boolean {
  return entries.some(
    (entry) => entry.slot === slot && entry.platform === platform && entry.status === "approved"
  );
}

async function inspectCalendarCli(args: string[]): Promise<void> {
  const date = getOption(args, "date");
  if (!date) throw new Error("--date is required for --inspect-calendar.");
  const result = await detectAndRecordCalendarTamper(date, getOption(args, "root"), {
    today: getOption(args, "today")
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.shouldRebuild) process.exit(2);
}

function isLoggingCalendarCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return /(?:^|[/\\])logging\.(ts|js)$/i.test(entry) || isMain(import.meta.url);
}

if (isLoggingCalendarCli() && getFlag(process.argv.slice(2), "inspect-calendar")) {
  inspectCalendarCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
