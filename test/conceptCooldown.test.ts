import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONCEPT_COOLDOWN_DAYS, REEL_SCHEDULE, loadExtensions } from "../src/reelConcepts";

// Until 2026-08-15 a concept could be scheduled once and never again. That made
// the run exactly as long as the concept list, and on 08-14 the list was spent:
// the line had no next day at all, and no amount of replanning could produce
// one. The owner replaced it with a 21-day cooldown, because what protects a
// reader from déjà vu is distance, not permanent retirement.

let root: string;
let baseline: number;

/** The day after whatever is currently last, which is the only date accepted. */
function nextDate(offsetDays = 0): string {
  const last = REEL_SCHEDULE[REEL_SCHEDULE.length - 1]!.date;
  const d = new Date(Date.parse(`${last}T00:00:00Z`) + (offsetDays + 1) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** A concept whose last outing was exactly `gap` days before the next slot. */
function conceptUsedDaysAgo(gap: number): string | undefined {
  const target = new Date(Date.parse(`${nextDate()}T00:00:00Z`) - gap * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return REEL_SCHEDULE.find((s) => s.date === target)?.conceptId;
}

async function tryScheduling(conceptId: string): Promise<boolean> {
  await writeFile(
    join(root, "data", "reel-concepts-extension.json"),
    JSON.stringify({ concepts: [], schedule: [{ date: nextDate(), conceptId }] }),
    "utf8"
  );
  const before = REEL_SCHEDULE.length;
  loadExtensions(root);
  const accepted = REEL_SCHEDULE.length > before;
  if (accepted) REEL_SCHEDULE.length = before; // leave the shared table as found
  return accepted;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cooldown-"));
  await mkdir(join(root, "data"), { recursive: true });
  // The built-ins alone span less than a cooldown, so there would be no
  // concept sitting exactly 21 days back to test against. Load the project's
  // real schedule first, then measure from there.
  loadExtensions(process.cwd());
  baseline = REEL_SCHEDULE.length;
});

afterEach(async () => {
  REEL_SCHEDULE.length = baseline;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("the concept cooldown", () => {
  it("allows a concept whose last outing is exactly the cooldown away", async () => {
    const concept = conceptUsedDaysAgo(CONCEPT_COOLDOWN_DAYS);
    expect(concept).toBeTruthy();

    expect(await tryScheduling(concept!)).toBe(true);
  });

  it("refuses one used a day too recently", async () => {
    const concept = conceptUsedDaysAgo(CONCEPT_COOLDOWN_DAYS - 1);
    expect(concept).toBeTruthy();

    expect(await tryScheduling(concept!)).toBe(false);
  });

  it("refuses yesterday's concept, which is what the rule is really for", async () => {
    const concept = conceptUsedDaysAgo(1);
    expect(concept).toBeTruthy();

    expect(await tryScheduling(concept!)).toBe(false);
  });
});
