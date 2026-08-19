import { createHash, createHmac } from "node:crypto";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { CALENDAR_WRITTEN_BY, readCalendarHmacKey, type StampedDailyContent } from "./contentPlan";
import { loadDailyContent, readJsonFile, writeDailyContent } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { DailySlot } from "./types";

// Locks a day's slot 1 once its images exist, and restores it when something
// rewrites the calendar afterwards. On 2026-08-07 the morning automation
// swapped slot 1's topic from the one the images were generated for to a
// recycled off-plan topic, and the day published a makeup-bag caption over
// school-shoe photos. Reels already heal from REEL_SCHEDULE; slot 1 has no
// schedule to heal from, so the day's own locked snapshot is the reference.
//
// The lock is created exactly once per date -- first come wins -- and only
// captures slot 1 (the image post). Slot 2/3 belong to the reel heal.

const DAY_LOCK_SCHEMA_VERSION = 1;
const CALENDAR_CHECKSUM = /^[a-f0-9]{16}$/;
const SHA256_CHECKSUM = /^[a-f0-9]{64}$/;

interface DayLock {
  schema_version: typeof DAY_LOCK_SCHEMA_VERSION;
  date: string;
  locked_at: string;
  calendar_checksum: string;
  slot1_checksum: string;
  lock_checksum: string;
  slot1: DailySlot;
}

interface CanonicalDayBinding {
  date: string;
  calendarChecksum: string;
  slot1: DailySlot;
  slot1Checksum: string;
}

interface DayLockProof {
  date: string;
  calendarChecksum: string;
  lockChecksum: string;
}

function lockPath(date: string, root: string): string {
  return join(root, "data", "day-locks", `${date}.json`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") throw new Error("Day-lock proof contains a non-JSON value.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function checksumSlot1(slot1: DailySlot): string {
  return createHash("sha256").update(canonicalJson(slot1)).digest("hex");
}

function lockChecksumPayload(lock: Omit<DayLock, "lock_checksum">): string {
  return canonicalJson(lock);
}

function checksumLock(lock: Omit<DayLock, "lock_checksum">, root: string): string {
  const key = readCalendarHmacKey(root);
  if (!key) {
    throw new Error("Day lock cannot be verified because the calendar HMAC key is unavailable.");
  }
  return createHmac("sha256", key).update(lockChecksumPayload(lock)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function failInvalidLock(date: string): never {
  throw new Error(
    `Existing day lock for ${date} is malformed, tampered, or does not bind the canonical calendar; refusing an unverified lock.`
  );
}

function canonicalDayBinding(date: string, content: StampedDailyContent, root: string): CanonicalDayBinding {
  if (content.date !== date) {
    throw new Error(`Calendar for ${date} has a mismatched embedded date (${content.date}); refusing day-lock verification.`);
  }
  if (content.written_by !== CALENDAR_WRITTEN_BY || !CALENDAR_CHECKSUM.test(content.content_checksum ?? "")) {
    throw new Error(`Calendar for ${date} lacks a canonical immutable checksum; refusing day-lock verification.`);
  }
  // A calendar can otherwise hide a second slot 1 behind Array.find(). The
  // lock must bind one unambiguous publish tuple, not whichever row appeared
  // first in attacker-controlled JSON.
  const slot1s = content.slots.filter((slot) => slot.slot === 1);
  if (slot1s.length !== 1) {
    throw new Error(`Calendar for ${date} must contain exactly one slot 1 before it can be day-locked.`);
  }
  const slot1 = slot1s[0]!;
  return {
    date,
    calendarChecksum: content.content_checksum!,
    slot1,
    slot1Checksum: checksumSlot1(slot1)
  };
}

function makeDayLock(binding: CanonicalDayBinding, root: string): DayLock {
  const unsigned = {
    schema_version: DAY_LOCK_SCHEMA_VERSION,
    date: binding.date,
    locked_at: new Date().toISOString(),
    calendar_checksum: binding.calendarChecksum,
    slot1_checksum: binding.slot1Checksum,
    slot1: binding.slot1
  } satisfies Omit<DayLock, "lock_checksum">;
  return { ...unsigned, lock_checksum: checksumLock(unsigned, root) };
}

function parseVerifiedDayLock(value: unknown, date: string, root: string): DayLock {
  if (!isRecord(value)) return failInvalidLock(date);
  const lock = value as Partial<DayLock>;
  if (
    lock.schema_version !== DAY_LOCK_SCHEMA_VERSION ||
    lock.date !== date ||
    !isTimestamp(lock.locked_at) ||
    !isRecord(lock.slot1) ||
    lock.slot1.slot !== 1 ||
    typeof lock.calendar_checksum !== "string" ||
    !CALENDAR_CHECKSUM.test(lock.calendar_checksum) ||
    typeof lock.slot1_checksum !== "string" ||
    !SHA256_CHECKSUM.test(lock.slot1_checksum) ||
    typeof lock.lock_checksum !== "string" ||
    !SHA256_CHECKSUM.test(lock.lock_checksum)
  ) {
    return failInvalidLock(date);
  }
  const verified = lock as DayLock;
  if (verified.slot1_checksum !== checksumSlot1(verified.slot1)) return failInvalidLock(date);
  const { lock_checksum: _storedChecksum, ...unsigned } = verified;
  if (verified.lock_checksum !== checksumLock(unsigned, root)) return failInvalidLock(date);
  return verified;
}

function assertCurrentBinding(lock: DayLock, binding: CanonicalDayBinding): void {
  if (
    lock.calendar_checksum !== binding.calendarChecksum ||
    lock.slot1_checksum !== binding.slot1Checksum ||
    canonicalJson(lock.slot1) !== canonicalJson(binding.slot1)
  ) {
    failInvalidLock(binding.date);
  }
}

async function readVerifiedDayLock(date: string, root: string): Promise<DayLock> {
  let raw: unknown;
  try {
    raw = await readJsonFile<unknown>(lockPath(date, root), undefined);
  } catch {
    return failInvalidLock(date);
  }
  if (raw === undefined) return failInvalidLock(date);
  return parseVerifiedDayLock(raw, date, root);
}

async function readDayLockProof(date: string, root: string, requireCurrentBinding: boolean): Promise<DayLockProof> {
  const lock = await readVerifiedDayLock(date, root);
  if (requireCurrentBinding) {
    const content = await loadDailyContent(date, root);
    if (!content || content.tampered) failInvalidLock(date);
    assertCurrentBinding(lock, canonicalDayBinding(date, content, root));
  }
  return {
    date: lock.date,
    calendarChecksum: lock.calendar_checksum,
    lockChecksum: lock.lock_checksum
  };
}

function proofMarker(kind: "DAY_LOCK_VERIFIED" | "DAY_LOCK_HEAL_VERIFIED", action: string, proof: DayLockProof): string {
  return `${kind} date=${proof.date} action=${action} calendar_checksum=${proof.calendarChecksum} lock_checksum=${proof.lockChecksum}`;
}

export async function lockDay(date: string, root = projectRooted()): Promise<string> {
  const content = await loadDailyContent(date, root);
  if (content?.tampered) {
    throw new Error(`Calendar integrity for ${date} is marked tampered; refusing to create or update a day lock.`);
  }
  if (!content) return "no slot 1 to lock";
  const binding = canonicalDayBinding(date, content, root);
  const slot1 = binding.slot1;
  // Never freeze an incomplete package: a lock taken before the images exist
  // makes every later heal restore the broken snapshot (luna, high).
  if (slot1.local_image_path) {
    try {
      const { stat } = await import("node:fs/promises");
      const info = await stat(join(root, ...slot1.local_image_path.split("/")));
      if (info.size === 0) return "slot 1 image is empty; not locking";
    } catch {
      return "slot 1 image missing; not locking";
    }
  }
  // flag wx = atomic check-and-create: two concurrent lockDay calls cannot
  // both win, so first-writer-wins actually holds (luna, high).
  const { writeFile, mkdir } = await import("node:fs/promises");
  const target = lockPath(date, root);
  await mkdir(join(root, "data", "day-locks"), { recursive: true });
  try {
    await writeFile(
      target,
      JSON.stringify(makeDayLock(binding, root), null, 2),
      { flag: "wx" }
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = await readVerifiedDayLock(date, root);
      assertCurrentBinding(existing, binding);
      return "already locked";
    }
    throw error;
  }
  return "locked";
}

export async function healDay(date: string, root = projectRooted()): Promise<string> {
  let rawLock: unknown;
  try {
    rawLock = await readJsonFile<unknown>(lockPath(date, root), undefined);
  } catch {
    return failInvalidLock(date);
  }
  if (rawLock === undefined) return "no lock";
  const content = await loadDailyContent(date, root);
  if (!content) return "no calendar";
  if (content.tampered) {
    throw new Error(`Calendar integrity for ${date} is marked tampered; refusing to heal or rewrite the calendar.`);
  }
  const binding = canonicalDayBinding(date, content, root);
  const lock = parseVerifiedDayLock(rawLock, date, root);
  const slot1 = binding.slot1;
  // Full-slot comparison: both review families showed that comparing only
  // topic + instagram_caption lets a rewrite of facebook_caption, image
  // paths or media_type pass as intact and publish a split-brain package.
  if (JSON.stringify(slot1) === JSON.stringify(lock.slot1)) {
    return "intact";
  }
  // Re-read immediately before writing: the first read may be seconds old and
  // another process may have legitimately updated slot 2/3 in between; writing
  // the stale whole-calendar back would clobber their work (luna, high).
  const fresh = (await loadDailyContent(date, root)) ?? content;
  if (fresh.tampered) {
    throw new Error(`Calendar integrity for ${date} is marked tampered; refusing to heal or rewrite the calendar.`);
  }
  canonicalDayBinding(date, fresh, root);
  const restored = {
    ...fresh,
    slots: fresh.slots.map((slot) => (slot.slot === 1 ? lock.slot1 : slot))
  };
  await writeDailyContent(restored, root);
  return `restored slot 1 to "${lock.slot1.topic.slice(0, 24)}" (was "${slot1.topic.slice(0, 24)}")`;
}

function projectRooted(): string {
  return projectRoot();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));
  const config = getConfig();
  const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
  const healing = getFlag(args, "heal");
  const result = healing ? await healDay(date, root) : await lockDay(date, root);
  console.log(`${date}: ${result}`);
  if (!healing && (result === "locked" || result === "already locked")) {
    const proof = await readDayLockProof(date, root, true);
    const action = result === "locked" ? "locked" : "already-locked";
    console.log(proofMarker("DAY_LOCK_VERIFIED", action, proof));
  }
  if (healing && (result === "intact" || result.startsWith("restored slot 1 to "))) {
    const proof = await readDayLockProof(date, root, false);
    const action = result === "intact" ? "intact" : "restored";
    console.log(proofMarker("DAY_LOCK_HEAL_VERIFIED", action, proof));
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
