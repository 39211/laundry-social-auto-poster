import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { projectRoot } from "./paths";
import { REEL_CONCEPTS, loadExtensions } from "./reelConcepts";
import { getZonedDateParts } from "./scheduler";
import { voiceFor } from "./tts";

export const UNKNOWN_CONCEPT_EXIT = 2;
export const DEFAULT_RUN_REL = join("output", "reels-run", "2026-07-29");

export interface ReelReburnVoice {
  label: string;
  voiceId: string;
}

export interface ReelReburnPlan {
  id: string;
  hook: string;
  close: string;
  narration: string;
  variant_assets: string[];
  voice: ReelReburnVoice;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPTION_NAMES = ["date", "run", "root"] as const;

function optionSkipIndexes(args: string[]): Set<number> {
  const skip = new Set<number>();
  for (const name of OPTION_NAMES) {
    const flag = `--${name}`;
    const index = args.indexOf(flag);
    if (index >= 0) {
      skip.add(index);
      skip.add(index + 1);
    }
    const inline = `--${name}=`;
    args.forEach((arg, i) => {
      if (arg.startsWith(inline)) skip.add(i);
    });
  }
  args.forEach((arg, i) => {
    if (arg.startsWith("--") && !skip.has(i)) skip.add(i);
  });
  return skip;
}

/** Positional concept ids; comma lists and repeated args both work. */
export function parseConceptIds(args: string[]): string[] {
  const skip = optionSkipIndexes(args);
  const ids: string[] = [];
  for (const [index, arg] of args.entries()) {
    if (skip.has(index) || arg.startsWith("--")) continue;
    for (const piece of arg.split(",")) {
      const id = piece.trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

export function listVariantAssets(reelsDir: string, conceptId: string): string[] {
  if (!existsSync(reelsDir)) return [];
  const exact = `${conceptId}.mp4`;
  const dashed = `${conceptId}-`;
  return readdirSync(reelsDir)
    .filter((name) => name === exact || (name.startsWith(dashed) && name.endsWith(".mp4")))
    .sort();
}

export function resolveRunDir(runDir: string | undefined, root = projectRoot()): string {
  return resolve(root, runDir ?? DEFAULT_RUN_REL);
}

export function buildReburnPlans(input: {
  ids: string[];
  date?: string;
  runDir?: string;
  root?: string;
}): { plans: ReelReburnPlan[]; unknown: string[]; available: string[]; date: string; runDir: string } {
  const root = projectRoot(input.root);
  loadExtensions(root);
  const date = input.date ?? getZonedDateParts(new Date(), getConfig().timezone).date;
  if (!DATE_RE.test(date)) {
    throw new Error("--date must be YYYY-MM-DD");
  }
  const runDir = resolveRunDir(input.runDir, root);
  const reelsDir = join(runDir, "reels");
  const available = REEL_CONCEPTS.map((concept) => concept.id);
  const unknown = input.ids.filter((id) => !REEL_CONCEPTS.some((concept) => concept.id === id));
  const rotation = voiceFor(date, 3);
  const voice: ReelReburnVoice = { label: rotation.label, voiceId: rotation.voiceId };
  const plans: ReelReburnPlan[] = [];
  for (const id of input.ids) {
    const concept = REEL_CONCEPTS.find((entry) => entry.id === id);
    if (!concept) continue;
    plans.push({
      id: concept.id,
      hook: concept.hook,
      close: concept.close,
      narration: concept.narration,
      variant_assets: listVariantAssets(reelsDir, concept.id),
      voice
    });
  }
  return { plans, unknown, available, date, runDir };
}

function printUnknown(unknown: string[], available: string[]): void {
  console.error(`Unknown concept: ${unknown.join(", ")}. Known: ${available.join(", ")}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ids = parseConceptIds(args);
  if (ids.length === 0) {
    console.error("Usage: reel-reburn-plan <id>[,<id>…] [--date YYYY-MM-DD] [--run <run-dir>]");
    process.exitCode = 1;
    return;
  }

  const result = buildReburnPlans({
    ids,
    date: getOption(args, "date"),
    runDir: getOption(args, "run"),
    root: getOption(args, "root")
  });

  if (result.unknown.length > 0) {
    printUnknown(result.unknown, result.available);
    process.exitCode = UNKNOWN_CONCEPT_EXIT;
    return;
  }

  const payload = result.plans.length === 1 ? result.plans[0] : result.plans;
  console.log(JSON.stringify(payload, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
