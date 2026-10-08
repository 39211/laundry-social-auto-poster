import { randomInt as cryptoRandomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { DAILY_SCHEDULE } from "./scheduler";

export interface PublishTimeSlot {
  slot: number;
  time: string;
  arm?: string;
}

export interface DailyPublishTimes {
  date: string;
  experiment?: unknown;
  assigned_at?: unknown;
  slots: PublishTimeSlot[];
  [key: string]: unknown;
}

interface ExperimentWindow {
  start: string;
  end: string;
  arm?: string;
}

interface ExperimentConfig {
  name: string;
  start_date: string;
  end_date: string;
  slots: number[];
  probability_afternoon: number;
  afternoon_window?: { start: string; end: string };
  windows?: Record<string, ExperimentWindow>;
  min_gap_minutes: number;
}

export interface EnsurePublishTimesOptions {
  randomInt?: (min: number, max: number) => number;
  now?: Date;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function defaultSlotTime(slot: number): string {
  const schedule = DAILY_SCHEDULE.find((item) => item.slot === slot);
  if (!schedule) throw new Error(`Unknown slot: ${slot}`);
  return schedule.time;
}

function dailyPath(date: string, root: string): string {
  return join(root, "data", "publish-times", `${date}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function parseDailyPublishTimes(raw: unknown, date: string): DailyPublishTimes {
  if (!isRecord(raw) || raw.date !== date || !Array.isArray(raw.slots)) {
    throw new Error("date must match the filename and slots must be an array");
  }
  const seenSlots = new Set<number>();
  raw.slots.forEach((item, index) => {
    if (!isRecord(item) || !Number.isInteger(item.slot)) {
      throw new Error(`slots[${index}].slot must be an integer`);
    }
    if (seenSlots.has(item.slot as number)) {
      throw new Error(`slots[${index}].slot duplicates slot ${item.slot as number}`);
    }
    seenSlots.add(item.slot as number);
    if (typeof item.time !== "string" || !TIME_PATTERN.test(item.time)) {
      throw new Error(`slots[${index}].time must be HH:MM`);
    }
  });
  return raw as unknown as DailyPublishTimes;
}

export function readPublishTimes(date: string, root: string): DailyPublishTimes | null {
  const filePath = dailyPath(date, root);
  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    console.warn(`Invalid publish-time file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  try {
    return parseDailyPublishTimes(JSON.parse(rawText) as unknown, date);
  } catch (error) {
    console.warn(`Invalid publish-time file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function getSlotPublishTime(date: string, slot: number, root: string): string {
  const publishTimes = readPublishTimes(date, root);
  return publishTimes?.slots.find((item) => item.slot === slot)?.time ?? defaultSlotTime(slot);
}

function parseExperiment(value: unknown): ExperimentConfig | null {
  if (!isRecord(value) || !Array.isArray(value.slots)) return null;
  if (value.windows !== undefined && !isRecord(value.windows)) return null;
  const windows = value.windows as Record<string, unknown> | undefined;
  if (windows && Object.keys(windows).some((key) => !/^(?:0|-?[1-9]\d*)$/u.test(key))) return null;
  if (
    typeof value.name !== "string" ||
    typeof value.start_date !== "string" ||
    typeof value.end_date !== "string" ||
    !validDate(value.start_date) ||
    !validDate(value.end_date) ||
    !value.slots.every(Number.isInteger) ||
    typeof value.probability_afternoon !== "number" ||
    value.probability_afternoon < 0 || value.probability_afternoon > 1 ||
    typeof value.min_gap_minutes !== "number" ||
    !Number.isInteger(value.min_gap_minutes) ||
    value.min_gap_minutes < 0
  ) return null;

  for (const slot of value.slots as number[]) {
    const slotKey = String(slot);
    const hasSlotWindow = windows !== undefined && Object.prototype.hasOwnProperty.call(windows, slotKey);
    const windowValue = hasSlotWindow ? windows[slotKey] : value.afternoon_window;
    if (!isRecord(windowValue)) return null;
    const start = windowValue.start;
    const end = windowValue.end;
    if (
      typeof start !== "string" || !TIME_PATTERN.test(start) ||
      typeof end !== "string" || !TIME_PATTERN.test(end) ||
      start > end ||
      (hasSlotWindow && windowValue.arm !== undefined && (typeof windowValue.arm !== "string" || windowValue.arm.length === 0))
    ) return null;
  }
  return value as unknown as ExperimentConfig;
}

function minutesOfDay(time: string): number {
  const [hour = Number.NaN, minute = Number.NaN] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function timeOfDay(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function hasCommittedExperimentPost(date: string, root: string, experimentSlots: Set<number>): boolean {
  for (const logName of ["scheduled-log", "posted-log"]) {
    const filePath = join(root, "data", logName, `${date}.json`);
    let entries: unknown;
    try {
      entries = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") continue;
      console.warn(`Cannot check ${logName} for ${date}; leaving publish times unchanged: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
    if (!Array.isArray(entries)) {
      console.warn(`Cannot check ${logName} for ${date}; leaving publish times unchanged: expected an array`);
      return true;
    }
    if (entries.some((entry) =>
      isRecord(entry) && Number.isInteger(entry.slot) && experimentSlots.has(entry.slot as number) && !entry.dry_run
    )) {
      console.warn(`${logName} already has a non-dry-run experiment slot for ${date}; leaving publish times unchanged`);
      return true;
    }
  }
  return false;
}

function randomInteger(randomInt: (min: number, max: number) => number, min: number, maxInclusive: number): number {
  const value = randomInt(min, maxInclusive + 1);
  if (!Number.isInteger(value) || value < min || value > maxInclusive) {
    throw new Error(`randomInt returned ${value}, outside [${min}, ${maxInclusive}]`);
  }
  return value;
}

function createAssignment(
  date: string,
  config: ExperimentConfig,
  randomInt: (min: number, max: number) => number,
  now: Date
): DailyPublishTimes {
  const sortedSlots = [...config.slots].sort((a, b) => a - b);
  const isTestArm = new Map<number, boolean>();
  const arms = new Map<number, string>();
  const windows = new Map<number, ExperimentWindow>();
  for (const slot of sortedSlots) {
    const isTest = randomInt(0, 1_000_000) < config.probability_afternoon * 1_000_000;
    isTestArm.set(slot, isTest);
    const slotWindow = config.windows?.[String(slot)];
    const window = slotWindow ?? config.afternoon_window!;
    windows.set(slot, {
      start: window.start,
      end: window.end,
      arm: slotWindow?.arm ?? "afternoon"
    });
    arms.set(slot, isTest ? (slotWindow?.arm ?? "afternoon") : "usual");
  }

  const slot1 = sortedSlots.includes(1) ? 1 : undefined;
  const slot2 = sortedSlots.includes(2) ? 2 : undefined;
  const bothTestArms = slot1 !== undefined && slot2 !== undefined && isTestArm.get(slot1) === true && isTestArm.get(slot2) === true;
  const times = new Map<number, string>();
  for (const slot of sortedSlots) {
    if (!isTestArm.get(slot)) {
      times.set(slot, defaultSlotTime(slot));
      continue;
    }
    const window = windows.get(slot)!;
    const windowStart = minutesOfDay(window.start);
    const windowEnd = minutesOfDay(window.end);
    if (bothTestArms && slot === slot1) {
      const orderingGap = Math.max(config.min_gap_minutes, 1);
      const latestFirst = Math.min(windowEnd, minutesOfDay(windows.get(slot2!)!.end) - orderingGap);
      if (latestFirst < windowStart) throw new Error("Per-slot test windows cannot satisfy min_gap_minutes and slot ordering");
      times.set(slot, timeOfDay(randomInteger(randomInt, windowStart, latestFirst)));
    } else if (bothTestArms && slot === slot2) {
      const firstTime = minutesOfDay(times.get(slot1!)!);
      const orderingGap = Math.max(config.min_gap_minutes, 1);
      const earliestSecond = Math.max(windowStart, firstTime + orderingGap);
      if (earliestSecond > windowEnd) throw new Error("Per-slot test windows cannot satisfy min_gap_minutes and slot ordering");
      times.set(slot, timeOfDay(randomInteger(randomInt, earliestSecond, windowEnd)));
    } else {
      times.set(slot, timeOfDay(randomInteger(randomInt, windowStart, windowEnd)));
    }
  }

  if (slot1 !== undefined && slot2 !== undefined && minutesOfDay(times.get(slot1)!) >= minutesOfDay(times.get(slot2)!)) {
    throw new Error("Experiment assignment would place slot 1 at or after slot 2");
  }
  return {
    date,
    experiment: config.name,
    assigned_at: now.toISOString(),
    slots: sortedSlots.map((slot) => ({ slot, time: times.get(slot)!, arm: arms.get(slot)! }))
  };
}

export async function ensurePublishTimes(
  date: string,
  root: string,
  options: EnsurePublishTimesOptions = {}
): Promise<DailyPublishTimes | null> {
  const filePath = dailyPath(date, root);
  const originalBytes = existsSync(filePath) ? readFileSync(filePath) : null;
  const existing = readPublishTimes(date, root);
  if (existing) return existing;

  let config: ExperimentConfig | null = null;
  try {
    config = parseExperiment(JSON.parse(readFileSync(join(root, "data", "publish-time-experiment.json"), "utf8")) as unknown);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    console.warn(`Cannot read publish-time experiment config: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!config) {
    console.warn("Cannot read publish-time experiment config: invalid format");
    return null;
  }
  if (!validDate(date) || date < config.start_date || date > config.end_date) return null;
  if (hasCommittedExperimentPost(date, root, new Set(config.slots))) return null;

  const assignment = createAssignment(date, config, options.randomInt ?? cryptoRandomInt, options.now ?? new Date());
  const existingBeforeWrite = readPublishTimes(date, root);
  if (existingBeforeWrite) return existingBeforeWrite;
  const directory = join(root, "data", "publish-times");
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${basename(filePath)}.${process.pid}.${cryptoRandomInt(0, 0x1_0000_0000).toString(16)}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(assignment, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    // Recheck at the commit point. Rename is atomic on the same volume; on
    // Windows an already-created destination also makes rename fail safely.
    const appeared = readPublishTimes(date, root);
    if (appeared) return appeared;
    if (existsSync(filePath) && (originalBytes === null || !readFileSync(filePath).equals(originalBytes))) {
      return readPublishTimes(date, root);
    }
    try {
      await rename(temporary, filePath);
    } catch (error) {
      const winner = readPublishTimes(date, root);
      if (winner) return winner;
      if (existsSync(filePath)) return null;
      throw error;
    }
    return assignment;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
