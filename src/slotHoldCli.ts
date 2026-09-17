import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getNumberOption, getOption, isMain } from "./cli";
import { projectRoot } from "./paths";
import {
  detectSlotHoldsEnabled,
  emptySlotHoldsFile,
  formatPlatformQueued,
  formatSlotHoldsInvalid,
  isEnoent,
  listQueuedPlatforms,
  loadSlotHolds,
  serializeSlotHoldsFile,
  slotHoldsFilePath,
  slotHoldsLockPath,
  validateSlotHoldsDocument,
  type SlotHoldEntry,
  type SlotHoldsFile
} from "./slotHolds";

const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 50;

export interface SlotHoldCliHooks {
  afterFirstRead?: (raw: string | undefined) => Promise<void>;
}

export const slotHoldCliHooks: SlotHoldCliHooks = {};

function usage(): string {
  return [
    "Usage:",
    "  npm run slot-hold -- init [--root <path>]",
    "  npm run slot-hold -- add --date YYYY-MM-DD --slot 1|2|3 --reason <text> --by <who> [--root <path>]",
    "  npm run slot-hold -- remove --date YYYY-MM-DD --slot 1|2|3 --reason <text> [--root <path>]",
    "  npm run slot-hold -- list [--date YYYY-MM-DD] [--root <path>]"
  ].join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCurrentRaw(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      await writeFile(lockPath, `${new Date().toISOString()}\n`, { flag: "wx" });
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - started >= LOCK_WAIT_MS) {
        const ageMs = await stat(lockPath)
          .then((info) => Date.now() - info.mtimeMs)
          .catch(() => 0);
        throw new Error(
          `Timed out waiting for slot-holds lock ${lockPath} (already existed for ${Math.round(ageMs / 1000)}s)`
        );
      }
      await sleep(LOCK_POLL_MS);
    }
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await unlink(lockPath).catch(() => undefined);
}

async function mutateSlotHoldsFile(
  root: string,
  mutate: (current: SlotHoldsFile | undefined) => SlotHoldsFile,
  mode: "init" | "update"
): Promise<void> {
  const filePath = slotHoldsFilePath(root);
  const lockPath = slotHoldsLockPath(root);
  const tmpPath = join(dirname(filePath), `slot-holds.json.${process.pid}.tmp`);
  await mkdir(dirname(filePath), { recursive: true });
  await acquireLock(lockPath);
  try {
    const firstRaw = await readCurrentRaw(filePath);
    if (slotHoldCliHooks.afterFirstRead) await slotHoldCliHooks.afterFirstRead(firstRaw);
    if (firstRaw === undefined && mode === "update" && (await detectSlotHoldsEnabled(root))) {
      throw new Error(
        `${formatSlotHoldsInvalid("data/slot-holds.json is missing")} Repair data/slot-holds.json by hand before add/remove.`
      );
    }
    const current = firstRaw === undefined ? undefined : currentFileOrEmpty(firstRaw).file;
    const next = mutate(current);
    const serialized = serializeSlotHoldsFile(next);
    const revalidated = validateSlotHoldsDocument(serialized);
    if (revalidated.status === "invalid") {
      throw new Error(formatSlotHoldsInvalid(revalidated.error));
    }

    await writeFile(tmpPath, Buffer.from(serialized, "utf8"));
    const secondRaw = await readCurrentRaw(filePath);
    if (firstRaw !== secondRaw) {
      await unlink(tmpPath).catch(() => undefined);
      throw new Error(
        `Aborting slot-holds write: ${filePath} changed after the first read (lock ${lockPath})`
      );
    }
    await rename(tmpPath, filePath);
  } finally {
    await unlink(tmpPath).catch(() => undefined);
    await releaseLock(lockPath);
  }
}

function requireDate(args: string[]): string {
  const date = getOption(args, "date");
  if (!date) throw new Error("--date is required.");
  return date;
}

function requireSlot(args: string[]): 1 | 2 | 3 {
  const slot = getNumberOption(args, "slot");
  if (slot !== 1 && slot !== 2 && slot !== 3) throw new Error("--slot must be 1, 2, or 3.");
  return slot;
}

function requireText(args: string[], name: string): string {
  const value = getOption(args, name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function currentFileOrEmpty(raw: string | undefined): { file: SlotHoldsFile; raw?: string } {
  if (raw === undefined) return { file: emptySlotHoldsFile() };
  const parsed = validateSlotHoldsDocument(raw);
  if (parsed.status === "invalid") {
    throw new Error(`${formatSlotHoldsInvalid(parsed.error)} Repair data/slot-holds.json by hand before add/remove.`);
  }
  return { file: { version: 1, holds: parsed.holds }, raw };
}

export async function runSlotHoldCli(argv: string[]): Promise<void> {
  const commandIndex = argv.findIndex((arg) => !arg.startsWith("-"));
  const command = commandIndex >= 0 ? argv[commandIndex] : undefined;
  const args = commandIndex >= 0 ? argv.filter((_, index) => index !== commandIndex) : argv;
  const root = projectRoot(getOption(args, "root"));
  const filePath = slotHoldsFilePath(root);

  if (command === "init") {
    await mutateSlotHoldsFile(
      root,
      (current) => {
        if (current) throw new Error(`Refusing to init: ${filePath} already exists.`);
        return emptySlotHoldsFile();
      },
      "init"
    );
    console.log(`Initialized empty slot holds at ${filePath}`);
    return;
  }

  if (command === "list") {
    const loaded = await loadSlotHolds(root);
    if (loaded.status === "invalid") {
      console.error(formatSlotHoldsInvalid(loaded.error));
      throw new Error(formatSlotHoldsInvalid(loaded.error));
    }
    const date = getOption(args, "date");
    const rows = date ? loaded.holds.filter((entry) => entry.date === date) : loaded.holds;
    console.log(JSON.stringify({ version: 1, holds: rows }, null, 2));
    return;
  }

  if (command === "add") {
    const date = requireDate(args);
    const slot = requireSlot(args);
    const reason = requireText(args, "reason");
    const setBy = requireText(args, "by");
    await mutateSlotHoldsFile(
      root,
      (current) => {
        const file = current ?? emptySlotHoldsFile();
        if (file.holds.some((entry) => entry.date === date && entry.slot === slot && entry.reason === reason)) {
          throw new Error(`Hold already exists for ${date} slot ${slot} reason ${JSON.stringify(reason)}.`);
        }
        return {
          version: 1,
          holds: [
            ...file.holds,
            {
              date,
              slot,
              reason,
              set_by: setBy,
              set_at: new Date().toISOString()
            } satisfies SlotHoldEntry
          ]
        };
      },
      "update"
    );

    const queued = await listQueuedPlatforms(root, date, slot);
    if (queued.length > 0) {
      for (const hit of queued) console.error(formatPlatformQueued(hit.platform, hit.id));
      console.error(
        `Slot ${date} ${slot} is already on a platform queue. Delete the scheduled post in Meta Business Suite / YouTube Studio. Automatic unschedule is out of scope.`
      );
      process.exitCode = 1;
    } else {
      console.log(`Added hold for ${date} slot ${slot}: ${reason}`);
    }
    return;
  }

  if (command === "remove") {
    const date = requireDate(args);
    const slot = requireSlot(args);
    const reason = requireText(args, "reason");
    await mutateSlotHoldsFile(
      root,
      (current) => {
        const file = current ?? emptySlotHoldsFile();
        const nextHolds = file.holds.filter(
          (entry) => !(entry.date === date && entry.slot === slot && entry.reason === reason)
        );
        if (nextHolds.length === file.holds.length) {
          throw new Error(`No hold found for ${date} slot ${slot} reason ${JSON.stringify(reason)}.`);
        }
        return { version: 1, holds: nextHolds };
      },
      "update"
    );
    console.log(`Removed hold for ${date} slot ${slot}: ${reason}`);
    return;
  }

  throw new Error(command ? `Unknown command: ${command}\n${usage()}` : usage());
}

async function main(): Promise<void> {
  await runSlotHoldCli(process.argv.slice(2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
