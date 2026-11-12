import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "../../src/logging";
import { stampDailyContentWrite } from "../../src/contentPlan";
import { retirementSlot } from "./slotRetirementHarness";

export const slot1Date = "2026-11-16";
export async function slot1Root(): Promise<string> {
  const parent = join(process.cwd(), "output/slot1off/tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "stage-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/slot-retirements.json"), await readFile("src/slot-retirements.json"));
  return root;
}
export async function oldSlot1Calendar(root: string, date = slot1Date): Promise<void> {
  // Intentionally use the writer stamp, not the filtering writer: old deployed bytes.
  await writeJsonAtomic(join(root, `data/content-calendar/${date}.json`), stampDailyContentWrite({
    date, timezone: "Asia/Taipei", generated_at: "2026-11-12T00:00:00Z",
    slots: [1, 2].map(slot => retirementSlot(slot, date))
  }, { root }));
}
