import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SLOT_HOLDS_FILE_REL,
  SLOT_HOLDS_REQUIRED_REL,
  emptySlotHoldsFile,
  serializeSlotHoldsFile,
  type SlotHoldEntry,
  type SlotHoldsFile
} from "../../src/slotHolds";

export const SLOT_HOLDS_REQUIRED_TEXT =
  "Slot-level publish holds are required in this tree. data/slot-holds.json must exist and parse as version 1; a missing or invalid file fails closed. Initialize with: npm run slot-hold -- init\n";

export async function writeSlotHoldsRequired(root: string, text = SLOT_HOLDS_REQUIRED_TEXT): Promise<string> {
  const path = join(root, SLOT_HOLDS_REQUIRED_REL);
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(path, text, "utf8");
  return path;
}

export function sampleHold(overrides: Partial<SlotHoldEntry> = {}): SlotHoldEntry {
  return {
    date: "2026-10-01",
    slot: 1,
    reason: "luxury visual route undecided",
    set_by: "owner",
    set_at: "2026-09-17T03:00:00.000Z",
    ...overrides
  };
}

export async function writeSlotHoldsFile(root: string, file: SlotHoldsFile): Promise<string> {
  const path = join(root, SLOT_HOLDS_FILE_REL);
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(path, serializeSlotHoldsFile(file), "utf8");
  return path;
}

export async function writeEmptySlotHolds(root: string): Promise<string> {
  return writeSlotHoldsFile(root, emptySlotHoldsFile());
}

export async function writeHolds(root: string, holds: SlotHoldEntry[]): Promise<string> {
  return writeSlotHoldsFile(root, { version: 1, holds });
}

export async function enableSlotHolds(
  root: string,
  holds: SlotHoldEntry[] = []
): Promise<{ requiredPath: string; holdsPath: string }> {
  const requiredPath = await writeSlotHoldsRequired(root);
  const holdsPath = await writeHolds(root, holds);
  return { requiredPath, holdsPath };
}
