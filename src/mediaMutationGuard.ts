import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./logging";

// R1: a protected media slot is identified by the platform records that own or
// have already used the current asset bytes.
export type SlotLock = {
  source: "scheduled-log" | "ig-cloud-queue" | "posted-log";
  detail: string;
};

export type SlotMediaOverride = { reason: string; actor: string };

type LogRows = { rows: unknown[]; unreadable: boolean };

async function readRowsFailClosed(filePath: string): Promise<LogRows | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { rows: [], unreadable: true };
  }

  try {
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/u, ""));
    if (!Array.isArray(parsed)) return { rows: [], unreadable: true };
    return { rows: parsed, unreadable: false };
  } catch {
    return { rows: [], unreadable: true };
  }
}

function rowObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

// R1: missing log files are not locks; unreadable log files fail closed.
export async function findSlotLocks(root: string, date: string, slot: number): Promise<SlotLock[]> {
  const locks: SlotLock[] = [];
  const scheduledPath = join(root, "data", "scheduled-log", `${date}.json`);
  const scheduled = await readRowsFailClosed(scheduledPath);
  if (scheduled?.unreadable) {
    locks.push({ source: "scheduled-log", detail: "unreadable" });
  } else if (scheduled) {
    for (const rawRow of scheduled.rows) {
      const row = rowObject(rawRow);
      if (row?.slot !== slot || row.platform !== "facebook") continue;
      const idValue = row.scheduled_post_id;
      const id = typeof idValue === "string" || typeof idValue === "number" ? String(idValue).trim() : "";
      locks.push({ source: "scheduled-log", detail: id || "uncertain" });
    }
  }

  const queuePath = join(root, "data", "ig-cloud", "queue", `${date}-slot${slot}.json`);
  try {
    await stat(queuePath);
    locks.push({ source: "ig-cloud-queue", detail: "queued" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      locks.push({ source: "ig-cloud-queue", detail: "unreadable" });
    }
  }

  const postedPath = join(root, "data", "posted-log", `${date}.json`);
  const posted = await readRowsFailClosed(postedPath);
  if (posted?.unreadable) {
    locks.push({ source: "posted-log", detail: "unreadable" });
  } else if (posted) {
    const protectedStatuses = new Set(["success", "posted", "uncertain"]);
    for (const rawRow of posted.rows) {
      const row = rowObject(rawRow);
      if (
        row?.slot !== slot ||
        row.dry_run === true ||
        typeof row.status !== "string" ||
        !protectedStatuses.has(row.status)
      ) {
        continue;
      }
      const platform = typeof row.platform === "string" && row.platform.trim() ? row.platform.trim() : "unknown";
      locks.push({ source: "posted-log", detail: `${platform} ${row.status}` });
    }
  }

  return locks;
}

// R1: the error includes each lock and names the separate override required.
export class SlotLockedError extends Error {
  constructor(date: string, slot: number, locks: SlotLock[], operation: string) {
    const detail = locks.map((lock) => `${lock.source}: ${lock.detail}`).join(", ");
    super(`${date} slot ${slot} media is locked (${detail}); refusing to ${operation}. Override only with --force-regen-scheduled and a reason.`);
    this.name = "SlotLockedError";
  }
}

export async function assertSlotMediaMutable(input: {
  root: string;
  date: string;
  slot: number;
  operation: string;
  override?: SlotMediaOverride;
}): Promise<void> {
  const locks = await findSlotLocks(input.root, input.date, input.slot);
  if (locks.length === 0) return;

  const reason = input.override?.reason.trim() ?? "";
  const actor = input.override?.actor.trim() ?? "";
  if (!reason || !actor) {
    throw new SlotLockedError(input.date, input.slot, locks, input.operation);
  }

  const logPath = join(input.root, "data", "media-mutation-log", `${input.date}.json`);
  let previous: unknown;
  try {
    const raw = await readFile(logPath, "utf8");
    previous = JSON.parse(raw.replace(/^\uFEFF/u, ""));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") previous = [];
    else throw error;
  }
  if (!Array.isArray(previous)) {
    throw new Error(`Media mutation log is not an array: ${logPath}`);
  }

  await writeJsonAtomic(logPath, [
    ...previous,
    {
      date: input.date,
      slot: input.slot,
      operation: input.operation,
      locks,
      reason,
      actor,
      at: new Date().toISOString()
    }
  ]);
}
