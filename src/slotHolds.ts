import { readFile } from "node:fs/promises";
import * as fsp from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile } from "./logging";
import { scheduledLogPath } from "./paths";

export const SLOT_HOLDS_REQUIRED_REL = "config/slot-holds.required";
export const SLOT_HOLDS_FILE_REL = "data/slot-holds.json";
export const SLOT_HOLDS_LOCK_REL = "data/slot-holds.json.lock";

export interface SlotHoldEntry {
  date: string;
  slot: 1 | 2 | 3;
  reason: string;
  set_by: string;
  set_at: string;
}

export interface SlotHoldsFile {
  version: 1;
  holds: SlotHoldEntry[];
}

export type SlotHoldsResult =
  | { status: "ok"; holds: SlotHoldEntry[] }
  | { status: "invalid"; holds: SlotHoldEntry[]; error: string };

export interface QueuedPlatformHit {
  platform: "facebook" | "youtube";
  id: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function slotHoldsRequiredPath(root: string): string {
  return join(root, SLOT_HOLDS_REQUIRED_REL);
}

export function slotHoldsFilePath(root: string): string {
  return join(root, SLOT_HOLDS_FILE_REL);
}

export function slotHoldsLockPath(root: string): string {
  return join(root, SLOT_HOLDS_LOCK_REL);
}

export function youtubeLogPath(date: string, root: string): string {
  return join(root, "data", "youtube-log", `${date}.json`);
}

export function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatSlotHoldsInvalid(error: string): string {
  return `SLOT-HOLDS INVALID: ${error}`;
}

export function formatSlotHeld(date: string, slot: number, reasons: string[]): string {
  return `SLOT HELD ${date} slot ${slot}: ${reasons.join("; ")}`;
}

export function formatHeldButQueued(date: string, slot: number, platform: string): string {
  return `HELD_BUT_QUEUED ${date} slot ${slot} ${platform}`;
}

export function formatPlatformQueued(platform: string, id: string): string {
  return `SLOT-HOLD PLATFORM-QUEUED ${platform} ${id}`;
}

export const slotHoldsIo = {
  stat: (path: string) => fsp.stat(path)
};

export async function detectSlotHoldsEnabled(root: string): Promise<boolean> {
  // Only ENOENT means "not enabled". Permission, busy, or any other stat
  // failure is treated as enabled so a broken marker cannot fail open.
  try {
    await slotHoldsIo.stat(slotHoldsRequiredPath(root));
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    return true;
  }
}

function isValidCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSlotNumber(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

export function validateSlotHoldsDocument(raw: string): SlotHoldsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "invalid", holds: [], error: `JSON parse failed: ${errorText(error)}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", holds: [], error: "document must be a JSON object" };
  }

  const doc = parsed as { version?: unknown; holds?: unknown };
  if (doc.version !== 1) {
    return { status: "invalid", holds: [], error: `version must be 1, got ${JSON.stringify(doc.version)}` };
  }
  if (!Array.isArray(doc.holds)) {
    return { status: "invalid", holds: [], error: "holds must be an array" };
  }

  const holds: SlotHoldEntry[] = [];
  const seen = new Set<string>();
  for (const [index, item] of doc.holds.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { status: "invalid", holds: [], error: `holds[${index}] must be an object` };
    }
    const entry = item as Partial<Record<keyof SlotHoldEntry, unknown>>;
    if (!isValidCalendarDate(typeof entry.date === "string" ? entry.date : "")) {
      return { status: "invalid", holds: [], error: `holds[${index}].date must be YYYY-MM-DD` };
    }
    if (!isSlotNumber(entry.slot)) {
      return { status: "invalid", holds: [], error: `holds[${index}].slot must be 1, 2, or 3` };
    }
    if (!isNonEmptyString(entry.reason)) {
      return { status: "invalid", holds: [], error: `holds[${index}].reason must be a non-empty string` };
    }
    if (!isNonEmptyString(entry.set_by)) {
      return { status: "invalid", holds: [], error: `holds[${index}].set_by must be a non-empty string` };
    }
    if (!isNonEmptyString(entry.set_at) || !ISO_RE.test(entry.set_at) || Number.isNaN(Date.parse(entry.set_at))) {
      return { status: "invalid", holds: [], error: `holds[${index}].set_at must be an ISO timestamp` };
    }
    const key = `${entry.date}\0${entry.slot}\0${entry.reason}`;
    if (seen.has(key)) {
      return {
        status: "invalid",
        holds: [],
        error: `duplicate hold for ${entry.date} slot ${entry.slot} reason ${JSON.stringify(entry.reason)}`
      };
    }
    seen.add(key);
    holds.push({
      date: entry.date as string,
      slot: entry.slot as 1 | 2 | 3,
      reason: entry.reason as string,
      set_by: entry.set_by as string,
      set_at: entry.set_at as string
    });
  }

  return { status: "ok", holds };
}

export function emptySlotHoldsFile(): SlotHoldsFile {
  return { version: 1, holds: [] };
}

export function serializeSlotHoldsFile(file: SlotHoldsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export async function loadSlotHolds(root: string): Promise<SlotHoldsResult> {
  const enabled = await detectSlotHoldsEnabled(root);
  let raw: string;
  try {
    raw = await readFile(slotHoldsFilePath(root), "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      if (!enabled) return { status: "ok", holds: [] };
      return { status: "invalid", holds: [], error: `${SLOT_HOLDS_FILE_REL} is missing` };
    }
    return {
      status: "invalid",
      holds: [],
      error: `cannot read ${SLOT_HOLDS_FILE_REL}: ${errorText(error)}`
    };
  }

  if (raw.trim() === "") {
    return { status: "invalid", holds: [], error: `${SLOT_HOLDS_FILE_REL} is empty` };
  }
  return validateSlotHoldsDocument(raw);
}

export function isSlotHeld(result: SlotHoldsResult, date: string, slot: number): boolean {
  if (result.status === "invalid") return true;
  return result.holds.some((entry) => entry.date === date && entry.slot === slot);
}

export function holdReasons(result: SlotHoldsResult, date: string, slot: number): string[] {
  if (result.status === "invalid") return [result.error];
  return result.holds.filter((entry) => entry.date === date && entry.slot === slot).map((entry) => entry.reason);
}

export async function listQueuedPlatforms(
  root: string,
  date: string,
  slot: number
): Promise<QueuedPlatformHit[]> {
  const hits: QueuedPlatformHit[] = [];
  const scheduled = await readJsonFile<Array<{ slot?: number; scheduled_post_id?: string }>>(
    scheduledLogPath(date, root),
    []
  );
  for (const entry of scheduled) {
    if (entry.slot === slot && typeof entry.scheduled_post_id === "string" && entry.scheduled_post_id.length > 0) {
      hits.push({ platform: "facebook", id: entry.scheduled_post_id });
    }
  }

  const youtube = await readJsonFile<Array<{ slot?: number; video_id?: string }>>(youtubeLogPath(date, root), []);
  for (const entry of youtube) {
    if (entry.slot === slot && typeof entry.video_id === "string" && entry.video_id.length > 0) {
      hits.push({ platform: "youtube", id: entry.video_id });
    }
  }
  return hits;
}

export function printSlotHoldsInvalid(error: string): void {
  console.error(formatSlotHoldsInvalid(error));
}

export function printSlotHeld(date: string, slot: number, reasons: string[]): void {
  console.error(formatSlotHeld(date, slot, reasons));
}

export function printHeldButQueued(date: string, slot: number, hits: QueuedPlatformHit[]): void {
  for (const hit of hits) {
    console.error(formatHeldButQueued(date, slot, hit.platform));
  }
}

export async function announceHeldSlot(
  result: SlotHoldsResult,
  root: string,
  date: string,
  slot: number
): Promise<void> {
  if (result.status === "invalid") {
    printSlotHoldsInvalid(result.error);
    return;
  }
  printSlotHeld(date, slot, holdReasons(result, date, slot));
  printHeldButQueued(date, slot, await listQueuedPlatforms(root, date, slot));
}

export async function inspectSlotHold(
  root: string,
  date: string,
  slot: number
): Promise<{ result: SlotHoldsResult; invalid: boolean; held: boolean }> {
  const result = await loadSlotHolds(root);
  return {
    result,
    invalid: result.status === "invalid",
    held: isSlotHeld(result, date, slot)
  };
}

export async function refuseHeldSlot(root: string, date: string, slot: number): Promise<void> {
  const { result, invalid, held } = await inspectSlotHold(root, date, slot);
  if (result.status === "invalid") {
    printSlotHoldsInvalid(result.error);
    throw new Error(formatSlotHoldsInvalid(result.error));
  }
  if (held) {
    await announceHeldSlot(result, root, date, slot);
    throw new Error(formatSlotHeld(date, slot, holdReasons(result, date, slot)));
  }
}
