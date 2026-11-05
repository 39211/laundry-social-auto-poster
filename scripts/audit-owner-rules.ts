// Read-only audit of the owner's content rules over a date range of calendars.
//
//   npx tsx scripts/audit-owner-rules.ts --from 2026-10-01 --to 2026-11-07 [--root <dir>]
//
// Reads data/content-calendar/<date>.json as raw JSON (no loaders with side
// effects), runs checkSlotAgainstOwnerRules on every slot, prints per-date
// counts and each hit, and writes output/owner-rules/audit-<from>-<to>.json.
// It never touches calendars, approval logs or anything under data/.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkSlotAgainstOwnerRules, type OwnerRuleViolation } from "../src/ownerContentRules";
import { projectRoot } from "../src/paths";

interface DateResult {
  date: string;
  status: "ok" | "missing" | "unreadable";
  error?: string;
  slots: Array<{ slot: number; violations: OwnerRuleViolation[] }>;
}

function argValue(args: string[], name: string): string | undefined {
  const flag = `--${name}`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) return args[i + 1];
    if (arg !== undefined && arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

function isValidDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (out.length > 3660) throw new Error("Date range is longer than ten years; refusing.");
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let priceListCache: number[] | undefined;
async function priceListAmounts(root: string): Promise<number[]> {
  if (priceListCache) return priceListCache;
  const found = new Set<number>();
  const walk = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 20) found.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(walk);
  };
  try { walk(JSON.parse(await readFile(join(root, "data", "prices.json"), "utf8"))); } catch { /* no list: amounts block */ }
  priceListCache = [...found];
  return priceListCache;
}

async function auditDate(root: string, date: string): Promise<DateResult> {
  const amounts = await priceListAmounts(root);
  const path = join(root, "data", "content-calendar", `${date}.json`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { date, status: "missing", slots: [] };
    return { date, status: "unreadable", error: String(error), slots: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { date, status: "unreadable", error: `invalid JSON: ${String(error)}`, slots: [] };
  }
  if (!isObject(parsed) || !Array.isArray(parsed.slots)) {
    return { date, status: "unreadable", error: "calendar has no slots array", slots: [] };
  }
  const slots = parsed.slots.filter(isObject).map((slot, index) => ({
    slot: typeof slot.slot === "number" ? slot.slot : index + 1,
    violations: checkSlotAgainstOwnerRules(slot, { priceListAmounts: amounts })
  }));
  return { date, status: "ok", slots };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const from = argValue(args, "from");
  const to = argValue(args, "to");
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    console.error("Usage: npx tsx scripts/audit-owner-rules.ts --from YYYY-MM-DD --to YYYY-MM-DD [--root <dir>]");
    process.exitCode = 2;
    return;
  }
  const root = projectRoot(argValue(args, "root"));

  const results: DateResult[] = [];
  for (const date of datesBetween(from, to)) results.push(await auditDate(root, date));

  const byRule: Record<string, number> = {};
  let block = 0;
  let warn = 0;
  for (const result of results) {
    if (result.status !== "ok") {
      console.log(`${result.date}  (${result.status}${result.error ? `: ${result.error}` : ""})`);
      continue;
    }
    const all = result.slots.flatMap((slot) => slot.violations);
    const dayBlock = all.filter((v) => v.severity === "block").length;
    const dayWarn = all.length - dayBlock;
    block += dayBlock;
    warn += dayWarn;
    console.log(`${result.date}  slots=${result.slots.length}  block=${dayBlock}  warn=${dayWarn}`);
    for (const slot of result.slots) {
      for (const v of slot.violations) {
        byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
        console.log(`  ${result.date}  slot ${slot.slot}  ${v.rule} (${v.severity})  ${v.field}  「${v.excerpt}」`);
      }
    }
  }

  const totals = {
    dates_in_range: results.length,
    dates_checked: results.filter((r) => r.status === "ok").length,
    dates_missing: results.filter((r) => r.status === "missing").length,
    dates_unreadable: results.filter((r) => r.status === "unreadable").length,
    block,
    warn,
    by_rule: byRule
  };
  console.log(`\nTotal: block=${block} warn=${warn} by rule ${JSON.stringify(byRule)}`);

  const outDir = join(root, "output", "owner-rules");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `audit-${from}-${to}.json`);
  await writeFile(
    outPath,
    JSON.stringify({ from, to, generated_at: new Date().toISOString(), read_only: true, totals, dates: results }, null, 2),
    "utf8"
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
