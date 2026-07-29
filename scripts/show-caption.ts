import { getOption } from "../src/cli";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";

const args = process.argv.slice(2);
const date = getOption(args, "date") ?? "2026-08-14";
const wanted = Number(getOption(args, "slot") ?? "1");

for (const slot of buildDailyContent(date, getConfig()).slots) {
  if (slot.slot !== wanted) continue;
  console.log(`=== ${date} slot ${slot.slot} (${slot.media_type}) ===\n`);
  console.log(slot.instagram_caption);
}
