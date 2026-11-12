import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stampDailyContentWrite } from "../../src/contentPlan";
import { writeJsonAtomic } from "../../src/logging";
import type { DailySlot } from "../../src/types";

export const RETIREMENT_POLICY = { version: 1, retirements: [{ slot: 2, from: "2026-11-16", reason: "owner retirement" }] };
export async function retirementRoot(): Promise<string> {
  await mkdir("output/slot2off/tmp", { recursive: true });
  const root = await mkdtemp(join(process.cwd(), "output/slot2off/tmp/stage-"));
  await writeJsonAtomic(join(root, "src/slot-retirements.json"), RETIREMENT_POLICY);
  return root;
}
export function retirementSlot(slot: number, date: string): DailySlot {
  return { slot, time: slot === 1 ? "11:30" : slot === 2 ? "20:30" : "12:00",
    category: slot === 1 ? "知識文" : "情境文", topic: `fixture ${slot}`, media_type: "image",
    instagram_caption: `unique ${date} fixture ${slot}`, facebook_caption: `unique ${date} fixture ${slot}`,
    image_prompt: "fixture", visual_route: "shop-inspection", traffic_route: "object-proof",
    local_image_path: `docs/assets/${date}/slot-${slot}.jpg`, public_image_url: `https://example.invalid/slot-${slot}.jpg`, status: "pending" };
}
/** Deliberately bypass writeDailyContent to model an already-generated old calendar. */
export async function seedRetirementCalendar(root: string, date: string, numbers = [1, 2]): Promise<void> {
  await mkdir(join(root, `docs/assets/${date}`), { recursive: true });
  await writeFile(join(root, retirementSlot(1, date).local_image_path), "fixture image bytes");
  const content = { date, timezone: "Asia/Taipei", generated_at: "2026-11-10T00:00:00Z", slots: numbers.map(n => retirementSlot(n, date)) };
  await writeJsonAtomic(join(root, `data/content-calendar/${date}.json`), stampDailyContentWrite(content, { root }));
  await writeJsonAtomic(join(root, `data/image-sources/${date}.json`), [{ slot: 1, topic: "fixture 1", image_path: retirementSlot(1, date).local_image_path, source: "fixture" }]);
}
