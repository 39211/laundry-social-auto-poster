import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";

// Reads 30 days of generated captions and reports what repeats. A phrase that
// appears on every post is invisible while writing one caption and obvious to
// anyone who follows the account for a week.

const config = getConfig();
const dates: string[] = [];
for (let offset = 0; offset < 30; offset += 1) {
  dates.push(new Date(Date.UTC(2026, 7, 10 + offset)).toISOString().slice(0, 10));
}

let total = 0;
let noQuestion = 0;
let brandSecond = 0;
let photoAsk = 0;
const blockCounts = new Map<string, number>();

for (const date of dates) {
  for (const slot of buildDailyContent(date, config).slots) {
    const caption = slot.instagram_caption ?? "";
    const blocks = caption.split("\n\n");
    total += 1;
    if (!caption.includes("？")) noQuestion += 1;
    if (blocks[1] === "私享家洗衣店") brandSecond += 1;
    if (/先拍/.test(caption)) photoAsk += 1;
    for (const block of blocks) {
      if (block.startsWith("#") || block.length < 12) continue;
      blockCounts.set(block, (blockCounts.get(block) ?? 0) + 1);
    }
  }
}

console.log(`slots audited: ${total}`);
console.log(`no question anywhere: ${noQuestion}`);
console.log(`brand name in block 2: ${brandSecond}`);
console.log(`first ask is "photograph it": ${photoAsk}`);
console.log(`\nmost repeated blocks:`);
for (const [text, count] of [...blockCounts].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  if (count < 2) break;
  console.log(`  ${String(count).padStart(3)}x  ${text.slice(0, 46)}`);
}

// A phrase repeated between two blocks of the same caption is more obvious to
// the reader than one repeated across days, because both copies are on screen
// at once.
const collisions = new Map<string, number>();
for (const date of dates) {
  for (const slot of buildDailyContent(date, config).slots) {
    const blocks = (slot.instagram_caption ?? "")
      .split("\n\n")
      .filter((block) => !block.startsWith("#") && !block.startsWith("追蹤"));
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i] ?? "";
        const b = blocks[j] ?? "";
        for (let start = 0; start + 6 <= a.length; start += 1) {
          const piece = a.slice(start, start + 6);
          if (/[，。？、｜#]/.test(piece)) continue;
          if (b.includes(piece)) collisions.set(piece, (collisions.get(piece) ?? 0) + 1);
        }
      }
    }
  }
}

console.log(`\nphrases repeated inside one caption:`);
if (collisions.size === 0) {
  console.log("  none");
} else {
  for (const [piece, count] of [...collisions].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(count).padStart(3)}x  ${piece}`);
  }
}

const sample = buildDailyContent("2026-08-12", config).slots[0]?.instagram_caption ?? "";
console.log(`\nfeed preview (first 125 chars, "|" is a paragraph break):`);
console.log(sample.slice(0, 125).replace(/\n\n/g, " | "));
