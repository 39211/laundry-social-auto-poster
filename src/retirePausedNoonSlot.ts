import { access, mkdir, readdir, rename, rmdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { loadAbTestPlan, planForDate, planSlot } from "./abTestPlan";
import { getFlag, getOption, isMain } from "./cli";
import { loadApprovalLog, loadDailyContent, loadPostLog, writeDailyContent } from "./logging";
import { loadScheduledLog } from "./scheduleAhead";
import { projectRoot } from "./paths";
import type { DailyContent } from "./types";

export interface RetirePausedNoonSlotOptions {
  date: string;
  root?: string;
  apply?: boolean;
}

export interface RetirePausedNoonSlotResult {
  status: "skipped" | "planned" | "applied";
  date: string;
  reasons?: string[];
  movedAssets?: string[];
}

interface AssetMove {
  source: string;
  destination: string;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function dateSlot3Images(root: string, date: string): Promise<string[]> {
  const directory = join(root, "docs", "assets", date);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && /^slot-03.*\.png$/iu.test(entry.name))
    .map((entry) => join(directory, entry.name));
}

function isDateSlot3Marker(path: string, date: string): boolean {
  const normalized = path.replace(/\\/gu, "/");
  return normalized.includes(date) && /(?:^|[\/_.-])slot[-_ ]?0?3(?=$|[\/_.-])/iu.test(normalized);
}

async function igCloudSlot3Markers(root: string, date: string): Promise<string[]> {
  const directory = join(root, "data", "ig-cloud");
  const matches: string[] = [];

  async function scan(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && current === directory) return;
      throw error;
    }

    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await scan(path);
      } else if (entry.isFile()) {
        const relative = path.slice(directory.length + 1);
        if (isDateSlot3Marker(relative, date)) matches.push(relative);
      }
    }
  }

  await scan(directory);
  return matches;
}

async function unusedDestination(directory: string, source: string): Promise<string> {
  const name = basename(source);
  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;

  for (let suffix = 0; ; suffix += 1) {
    const candidate = join(directory, suffix === 0 ? name : `${stem}-${suffix}${extension}`);
    try {
      await access(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }
}

function skipped(date: string, reasons: string[]): RetirePausedNoonSlotResult {
  console.log(`[retire-slot3] skip ${date}: ${reasons.join("; ")}`);
  return { status: "skipped", date, reasons };
}

/** Plan or retire one slot 3 without an active noon plan half. */
export async function retirePausedNoonSlot(
  options: RetirePausedNoonSlotOptions
): Promise<RetirePausedNoonSlotResult> {
  if (!isDate(options.date)) throw new Error(`--date must be a real YYYY-MM-DD date, got ${options.date}`);

  const { date } = options;
  const root = projectRoot(options.root);
  let dayPlan;
  let content;
  let approvals;
  let posts;
  let scheduled;
  let markers;
  let images;

  try {
    const [abPlan, loadedContent, loadedApprovals, loadedPosts, loadedScheduled, loadedMarkers, loadedImages] =
      await Promise.all([
        loadAbTestPlan(root),
        loadDailyContent(date, root),
        loadApprovalLog(date, root),
        loadPostLog(date, root),
        loadScheduledLog(date, root),
        igCloudSlot3Markers(root, date),
        dateSlot3Images(root, date)
      ]);
    dayPlan = planForDate(abPlan, date);
    content = loadedContent;
    approvals = loadedApprovals;
    posts = loadedPosts;
    scheduled = loadedScheduled;
    markers = loadedMarkers;
    images = loadedImages;
  } catch (error) {
    return skipped(date, [`preflight could not verify local evidence: ${String(error)}`]);
  }

  const reasons: string[] = [];
  if (planSlot(dayPlan, 3) !== undefined) {
    reasons.push("A/B noon has an active planSlot(dayPlan, 3) half");
  }

  if (!content) {
    reasons.push("calendar is missing");
  } else if (content.tampered) {
    reasons.push("calendar integrity check failed");
  }

  const slot3 = content?.slots.find((slot) => slot.slot === 3);
  if (!slot3) {
    reasons.push("calendar has no slot 3");
  } else if (slot3.local_video_path) {
    reasons.push("slot 3 has a local_video_path");
  }

  if (approvals?.some((entry) => entry.slot === 3)) {
    reasons.push("approved-log contains a slot 3 approval row");
  }
  if (posts?.some((entry) => entry.slot === 3)) {
    reasons.push("posted-log contains a slot 3 row, including dry runs");
  }
  if (scheduled?.some((entry) => entry.slot === 3)) {
    reasons.push("scheduled-log contains a slot 3 row");
  }
  if (markers?.length) {
    reasons.push(`ig-cloud has slot 3 marker(s): ${markers.join(", ")}`);
  }
  if (reasons.length > 0) return skipped(date, reasons);

  const assetDirectory = join(root, "docs", "assets", date);
  const staleDirectory = join(assetDirectory, "_stale");
  const moves: AssetMove[] = [];
  try {
    for (const source of images ?? []) {
      moves.push({ source, destination: await unusedDestination(staleDirectory, source) });
    }
  } catch (error) {
    return skipped(date, [`could not plan safe asset moves: ${String(error)}`]);
  }

  if (!options.apply) {
    const assetNames = moves.length ? moves.map((move) => basename(move.source)).join(", ") : "none";
    console.log(`[retire-slot3] dry-run ${date}: remove calendar slot 3; move ${assetNames} to docs/assets/${date}/_stale/`);
    return { status: "planned", date, movedAssets: [] };
  }

  const updated: DailyContent = {
    ...content!,
    slots: content!.slots.filter((slot) => slot.slot !== 3)
  };
  const moved: AssetMove[] = [];
  try {
    if (moves.length > 0) await mkdir(staleDirectory, { recursive: true });
    for (const move of moves) {
      await rename(move.source, move.destination);
      moved.push(move);
    }
    await writeDailyContent(updated, root);
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const move of moved.reverse()) {
      try {
        await rename(move.destination, move.source);
      } catch (rollbackError) {
        rollbackErrors.push(`${move.destination}: ${String(rollbackError)}`);
      }
    }
    if (moves.length > 0) await rmdir(staleDirectory).catch(() => undefined);
    if (rollbackErrors.length > 0) {
      throw new Error(`Retirement failed and asset rollback was incomplete: ${rollbackErrors.join("; ")}; original error: ${String(error)}`);
    }
    throw error;
  }

  const movedAssets = moved.map((move) => move.destination);
  console.log(
    `[retire-slot3] applied ${date}: removed slot 3 from calendar; moved ${movedAssets.length} asset(s) to docs/assets/${date}/_stale/`
  );
  return { status: "applied", date, movedAssets };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  if (!date) throw new Error("--date YYYY-MM-DD is required.");
  await retirePausedNoonSlot({
    date,
    root: getOption(args, "root"),
    apply: getFlag(args, "apply")
  });
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
