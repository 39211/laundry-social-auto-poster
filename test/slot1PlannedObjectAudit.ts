import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDailyContent, contradictorySubject, type Slot1PlanExtEntry } from "../src/contentPlan";
import { getConfig } from "../src/config";

const plan = JSON.parse(readFileSync("data/slot1-plan-ext.json", "utf8")) as Record<string, Slot1PlanExtEntry>;
const config = getConfig({ ...process.env, DRY_RUN: "true" });
const rows = Object.entries(plan).map(([date, entry]) => {
  const slot = buildDailyContent(date, config, {
    root: process.cwd(), applySlot1Plan: true, today: "2026-10-17"
  }).slots.find((item) => item.slot === 1)!;
  assert.equal(slot.planned_object, entry.object, `${date}: the accepted extension must own the object`);
  assert.equal(slot.carousel_items?.length, entry.format === "carousel" ? 4 : 1);
  const prompts = [slot.image_prompt, ...slot.carousel_items!.map((item) => item.image_prompt)];
  const conflicts = prompts.flatMap((prompt, index) => {
    const clash = contradictorySubject(slot.topic, prompt);
    return clash ? [{ field: index === 0 ? "image_prompt" : `slide-${index}`, ...clash }] : [];
  });
  for (const prompt of prompts) assert.ok(prompt.includes(entry.object), `${date}: missing planned object`);
  const negatives = [...new Set(prompts.map((prompt) => prompt.slice(prompt.lastIndexOf("Avoid:"))))];
  const tool = slot.image_prompt.match(/; ([^;]+) rests at the frame edge as a foreground occlusion/)?.[1];
  const category = slot.image_prompt.match(/SUBJECT CATEGORY: ([^.]+)\./)?.[1];
  return { date, format: entry.format, object: entry.object, category: category ?? null,
    tool: tool ?? null, negatives, promptFields: prompts.length, conflicts, prompts };
});
const report = { rows, promptFields: rows.reduce((total, row) => total + row.promptFields, 0),
  conflicts: rows.flatMap((row) => row.conflicts.map((clash) => ({ date: row.date, ...clash }))) };
const output = join(tmpdir(), process.argv[2] ?? "slot1-planned-object-audit-r2.json");
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, days: rows.length, promptFields: report.promptFields, conflicts: report.conflicts }));
if (!process.argv.includes("--allow-conflicts")) assert.deepEqual(report.conflicts, []);
