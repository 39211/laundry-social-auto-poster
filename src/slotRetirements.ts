import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { projectRoot } from "./paths";

interface SlotRetirement { slot: number; from: string; reason: string }
export interface RetirementPolicy { retirements: SlotRetirement[]; error?: string }
export interface RetirementDecision { retired: boolean; reason?: string; error?: string }

function validDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

/** Calendar dates already mean Taipei. Instants must carry an explicit offset. */
export function retirementTaipeiDate(value: string | Date): string {
  if (validDate(value)) return value;
  if (typeof value === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error("Retirement date must be YYYY-MM-DD or an instant with timezone");
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid retirement date");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}

/** No cache: deleting an entry restores newly generated days in the next call. */
export function loadSlotRetirements(root = projectRoot(), date?: string): RetirementPolicy {
  try {
    const data = JSON.parse(readFileSync(join(root, "src", "slot-retirements.json"), "utf8").replace(/^\uFEFF/u, "")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("expected an object");
    const policy = data as { version?: unknown; retirements?: unknown };
    if (policy.version !== 1 || !Array.isArray(policy.retirements)) throw new Error("expected version 1 and retirements array");
    for (const entry of policy.retirements as unknown[]) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid retirement entry");
      const row = entry as SlotRetirement;
      if (!Number.isInteger(row.slot) || row.slot < 1 || !validDate(row.from) || typeof row.reason !== "string" || !row.reason.trim()) throw new Error("invalid slot/from/reason");
    }
    return { retirements: policy.retirements as SlotRetirement[] };
  } catch (error) {
    // Missing/corrupt deployment settings must not alter pre-retirement history.
    // This fallback lower bound lives only in the single policy reader.
    const fallbackFrom = "2026-11-16";
    if (date && retirementTaipeiDate(date) < fallbackFrom) return { retirements: [] };
    // Do not echo raw JSON or file contents to operational logs.
    const code = (error as NodeJS.ErrnoException).code;
    return { retirements: [], error: `slot-retirements: ${code ?? "invalid configuration"}; slot 2 is blocked (fail closed)` };
  }
}

const reported = new Set<string>();
/** Single decision used by generation, all execution gates, reports and PS CLI. */
export function slotRetirement(date: string | Date, slot: number, root = projectRoot()): RetirementDecision {
  const calendarDate = retirementTaipeiDate(date);
  const policy = loadSlotRetirements(root, calendarDate);
  if (policy.error) {
    const key = `${root}:${policy.error}`;
    if (!reported.has(key)) { reported.add(key); console.warn(policy.error); }
    return { retired: slot === 2, reason: slot === 2 ? policy.error : undefined, error: policy.error };
  }
  const entry = policy.retirements.find(row => row.slot === slot && calendarDate >= row.from);
  return entry ? { retired: true, reason: `slot ${slot} retired from ${entry.from}: ${entry.reason}` } : { retired: false };
}

export function assertSlotActive(date: string, slot: number, root = projectRoot()): void {
  const decision = slotRetirement(date, slot, root);
  if (decision.retired) throw new Error(`${date}: ${decision.reason}`);
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const root = projectRoot(getOption(args, "root"));
    const date = getOption(args, "date");
    if (!date) throw new Error("Required: --date YYYY-MM-DD");
    const policy = loadSlotRetirements(root, retirementTaipeiDate(date));
    const candidates = [...new Set([1, 2, 3, ...policy.retirements.map(row => row.slot)])];
    console.log(JSON.stringify({ date: retirementTaipeiDate(date), retiredSlots: candidates.filter(slot => slotRetirement(date, slot, root).retired), error: policy.error }));
  } catch {
    console.log(JSON.stringify({ retiredSlots: [2], error: "slot-retirements CLI failed; slot 2 blocked" }));
    process.exitCode = 1;
  }
}
