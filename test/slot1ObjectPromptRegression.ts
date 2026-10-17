import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDailyContent } from "../src/contentPlan";
import { getConfig } from "../src/config";

// Capture BEFORE editing production, compare AFTER. All generated evidence lives under tmpdir().
const mode = process.argv[2];
assert.ok(mode === "capture" || mode === "compare", "usage: tsx test/slot1ObjectPromptRegression.ts capture|compare");
const snapshotPath = join(tmpdir(), "slot1-object-prompts-baseline.json");
const reportPath = join(tmpdir(), "slot1-object-prompts-comparison.json");
const config = getConfig({ ...process.env, DRY_RUN: "true" });
const legacyDates = Array.from({ length: 22 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
const futureDates = Object.keys(JSON.parse(readFileSync("data/slot1-plan-ext.json", "utf8")) as Record<string, unknown>);
const dates = [...legacyDates, ...futureDates];
const prompts: Record<string, string> = {};
for (const date of dates) {
  const calendar = buildDailyContent(date, config, {
    root: process.cwd(), applySlot1Plan: true, applyAiredCooldown: true, today: "2026-10-17"
  });
  for (const slot of calendar.slots.filter((item) => item.slot === 1 || item.slot === 2)) {
    prompts[`${date}/slot-${slot.slot}/image_prompt`] = slot.image_prompt;
    for (const item of slot.carousel_items ?? []) prompts[`${date}/slot-${slot.slot}/slide-${item.slide}`] = item.image_prompt;
  }
}
const storedDates = legacyDates.filter((date) => existsSync(join("data", "content-calendar", `${date}.json`)));
const missingDates = legacyDates.filter((date) => !storedDates.includes(date));
if (mode === "capture") {
  writeFileSync(snapshotPath, JSON.stringify({
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), prompts, storedDates, missingDates
  }));
  console.log(JSON.stringify({ mode, snapshotPath, dates: dates.length, promptFields: Object.keys(prompts).length, storedDates, missingDates }));
} else {
  const baseline = JSON.parse(readFileSync(snapshotPath, "utf8")) as { sha: string; prompts: Record<string, string> };
  const keys = [...new Set([...Object.keys(baseline.prompts), ...Object.keys(prompts)])];
  const differences = keys.filter((key) => !Buffer.from(baseline.prompts[key] ?? "", "utf8").equals(Buffer.from(prompts[key] ?? "", "utf8")));
  const legacyKeys = keys.filter((key) => legacyDates.includes(key.split("/")[0]!));
  const legacyDifferences = differences.filter((key) => legacyKeys.includes(key));
  const report = { baselineSha: baseline.sha, regeneratedDays: legacyDates.length, slots: legacyDates.length * 2,
    promptFields: legacyKeys.length, byteDifferences: legacyDifferences, futureDifferences: differences.filter((key) => !legacyKeys.includes(key)),
    storedDates, missingDates };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.deepEqual(legacyDifferences, [], "pre-extension production prompts must remain byte-identical");
}
