import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { projectRoot } from "./paths";
import { REEL_SCHEDULE, loadExtensions } from "./reelConcepts";
import { getZonedDateParts } from "./scheduler";

// Dual-length A/B plan: each day posts two Reels (noon slot 3 + evening slot 2)
// with crossed variants so 10s and 15s can be compared across the same concepts
// without same-day contamination.

export type AbVariant = "10s" | "15s";

export interface AbSlotPlan {
  conceptId: string;
  variant: AbVariant;
}

export interface AbDayPlan {
  date: string;
  noon: AbSlotPlan;
  evening: AbSlotPlan;
}

export function abTestPlanPath(root = projectRoot()): string {
  return join(root, "data", "ab-test-plan.json");
}

export async function loadAbTestPlan(root = projectRoot()): Promise<AbDayPlan[]> {
  const path = abTestPlanPath(root);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as AbDayPlan[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveAbTestPlan(plan: AbDayPlan[], root = projectRoot()): Promise<void> {
  const path = abTestPlanPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** Odd calendar day → noon 10s / evening 15s; even day swaps. */
export function variantsForDate(date: string): { noon: AbVariant; evening: AbVariant } {
  if (dayOfMonth(date) % 2 === 1) {
    return { noon: "10s", evening: "15s" };
  }
  return { noon: "15s", evening: "10s" };
}

/**
 * Pairing rule (hard constraints):
 * - Evening uses REEL_SCHEDULE concept for that date.
 * - Noon uses the next scheduled concept after that date (advance pull).
 * - Two concepts per day are always different.
 * - Same concept never runs both 10s and 15s on the same day (each concept
 *   appears at most once per day; its other variant lands on another day via
 *   the day-of-month cross).
 * - Variants cross daily by calendar day parity.
 */
export function generateAbTestPlan(from: string, days: number): AbDayPlan[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`--days must be a positive integer, got ${days}`);
  }
  const schedule = [...REEL_SCHEDULE].sort((a, b) => a.date.localeCompare(b.date));
  if (schedule.length < 2) {
    throw new Error("REEL_SCHEDULE needs at least two entries to pair noon and evening concepts.");
  }

  const plan: AbDayPlan[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(from, offset);
    const eveningEntry = schedule.find((item) => item.date === date)
      ?? schedule.find((item) => item.date >= date);
    if (!eveningEntry) break;

    const eveningIndex = schedule.findIndex((item) => item.date === eveningEntry.date && item.conceptId === eveningEntry.conceptId);
    const noonEntry = schedule[eveningIndex + 1] ?? schedule[(eveningIndex + 1) % schedule.length];
    if (!noonEntry || noonEntry.conceptId === eveningEntry.conceptId) {
      throw new Error(`Cannot pair distinct concepts for ${date}.`);
    }

    const variants = variantsForDate(date);
    plan.push({
      date,
      noon: { conceptId: noonEntry.conceptId, variant: variants.noon },
      evening: { conceptId: eveningEntry.conceptId, variant: variants.evening }
    });
  }
  return plan;
}

export function planForDate(plan: AbDayPlan[], date: string): AbDayPlan | undefined {
  return plan.find((item) => item.date === date);
}

export function planSlot(
  day: AbDayPlan | undefined,
  slot: number
): AbSlotPlan | undefined {
  if (!day) return undefined;
  if (slot === 2) return day.evening;
  if (slot === 3) return day.noon;
  return undefined;
}

/** Slot number that carries the given plan half. */
export function slotForPlanHalf(half: "noon" | "evening"): number {
  return half === "noon" ? 3 : 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  loadExtensions(projectRoot(getOption(args, "root")));
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "generate")) {
    const from = getOption(args, "from") ?? getZonedDateParts(new Date(), getConfig().timezone).date;
    const days = getNumberOption(args, "days") ?? 14;
    const plan = generateAbTestPlan(from, days);
    await saveAbTestPlan(plan, root);
    console.log(JSON.stringify({ written: abTestPlanPath(root), days: plan.length, plan }, null, 2));
    return;
  }

  const plan = await loadAbTestPlan(root);
  console.log(JSON.stringify(plan, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
