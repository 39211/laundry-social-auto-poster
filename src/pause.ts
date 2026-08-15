import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { projectRoot } from "./paths";

/**
 * The owner's brake.
 *
 * There was no way to stop this pipeline. Deleting the day's approval log
 * looked like one, but the catch-up chain re-runs approval when a slot is
 * unapproved, so the deletion is undone within the hour. Disabling the
 * scheduled tasks looked like one, but the morning watchdog deliberately
 * re-enables any Laundry-* task it finds disabled. Both brakes were racing
 * automation that was built to win.
 *
 * So the brake is a file that nothing automated ever removes. Approval refuses
 * to approve while it exists and publishing refuses to publish, which covers
 * both the scheduled path and any manual command. Only a person clears it.
 *
 * A brake nobody can see is its own outage, so the nightly audit reports a
 * pause that has been held for more than a day.
 */

export interface PauseState {
  reason: string;
  since: string;
  paused_by: string;
}

export function pausePath(root: string): string {
  return join(root, "data", "PAUSED.json");
}

function unreadablePause(): PauseState {
  return { reason: "(pause file is unreadable)", since: "(unknown)", paused_by: "(unknown)" };
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function readPause(root: string): Promise<PauseState | undefined> {
  let raw: string;
  try {
    raw = await readFile(pausePath(root), "utf8");
  } catch (error) {
    // Only a missing file is "not paused". Permission, I/O, or a path that
    // exists but cannot be read still means someone tried to stop the line.
    if (isEnoent(error)) return undefined;
    return unreadablePause();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The first read already proved the file is there. A second read cannot
    // make a malformed brake safer, and it can fail-open if that read errors.
    return unreadablePause();
  }

  // A legal JSON primitive used to fail-open: parse succeeded and this guard
  // returned undefined as if nobody had set the brake.
  if (!parsed || typeof parsed !== "object") return unreadablePause();
  if (Array.isArray(parsed)) return unreadablePause();

  // Narrowed to bare `object`, which has no index signature, so reading the
  // fields off it does not compile. Runtime was already correct here -- tsx
  // does not typecheck, so this only showed up under `tsc --noEmit`.
  const fields = parsed as Partial<Record<keyof PauseState, unknown>>;
  return {
    reason: typeof fields.reason === "string" ? fields.reason : "(no reason recorded)",
    since: typeof fields.since === "string" ? fields.since : "(unknown)",
    paused_by: typeof fields.paused_by === "string" ? fields.paused_by : "(unknown)"
  };
}

export function pauseMessage(state: PauseState): string {
  return `發布已被暫停(${state.since} 由 ${state.paused_by}):${state.reason}。清除方式:npm run pause -- --clear`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "clear")) {
    try {
      await unlink(pausePath(root));
      console.log("Pause cleared. The next scheduled run will approve and publish normally.");
    } catch {
      console.log("No pause was set.");
    }
    return;
  }

  if (getFlag(args, "status")) {
    const state = await readPause(root);
    console.log(state ? pauseMessage(state) : "Not paused.");
    return;
  }

  const reason = getOption(args, "reason");
  if (!reason) {
    throw new Error(
      "--reason is required, so that whoever finds this tomorrow knows why the line is stopped."
    );
  }
  const state: PauseState = {
    reason,
    since: new Date().toISOString(),
    paused_by: getOption(args, "by") ?? "owner"
  };
  await writeFile(pausePath(root), JSON.stringify(state, null, 2), "utf8");
  console.log(`Paused. Nothing will be approved or published until you run: npm run pause -- --clear`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
