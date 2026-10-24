import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCarouselImagePrompts, buildDailyContent } from "../src/contentPlan";
import { getConfig } from "../src/config";
import type { DailyContent } from "../src/types";

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
const storedPrompts: Record<string, string> = {};
const storedReelSlots: string[] = [];
const storedRefusedSlots: Array<{ date: string; slot: number; fresh: number; stored: number }> = [];
let storedSlots = 0;
for (const date of storedDates) {
  const stored = JSON.parse(readFileSync(join("data", "content-calendar", `${date}.json`), "utf8")) as DailyContent;
  for (const slot of stored.slots.filter((item) => item.slot === 1 || item.slot === 2)) {
    if (slot.media_type === "reel") {
      storedReelSlots.push(`${date}/slot-${slot.slot}`);
      continue; // The refresh script refuses reels, whose stills belong to the reviewed video.
    }
    const rebuilt = buildCarouselImagePrompts({
      date, slot: slot.slot, topic: slot.topic, planned_object: slot.planned_object,
      planned_category: slot.planned_category,
      caption: [slot.facebook_caption, slot.instagram_caption, slot.topic].filter(Boolean).join("\n"),
      seo_sync_page: slot.seo_sync_page
    });
    if (rebuilt.length < (slot.carousel_items?.length ?? 1)) {
      storedRefusedSlots.push({ date, slot: slot.slot, fresh: rebuilt.length, stored: slot.carousel_items!.length });
      continue; // Match the production refresh refusal without rewriting this calendar.
    }
    storedSlots += 1;
    storedPrompts[`${date}/slot-${slot.slot}/image_prompt`] = rebuilt[0]!;
    for (const [index, item] of (slot.carousel_items ?? []).entries()) {
      storedPrompts[`${date}/slot-${slot.slot}/slide-${item.slide}`] = rebuilt[index]!;
    }
  }
}
if (mode === "capture") {
  writeFileSync(snapshotPath, JSON.stringify({
    sha: process.env.SLOT1_PROMPT_BASELINE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    prompts, storedPrompts, storedDates, missingDates
  }));
  console.log(JSON.stringify({ mode, snapshotPath, dates: dates.length, promptFields: Object.keys(prompts).length,
    storedSlots, storedPromptFields: Object.keys(storedPrompts).length, storedDates, missingDates }));
} else {
  const baseline = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    sha: string; prompts: Record<string, string>; storedPrompts: Record<string, string>
  };
  const keys = [...new Set([...Object.keys(baseline.prompts), ...Object.keys(prompts)])];
  const differences = keys.filter((key) => !Buffer.from(baseline.prompts[key] ?? "", "utf8").equals(Buffer.from(prompts[key] ?? "", "utf8")));
  const legacyKeys = keys.filter((key) => legacyDates.includes(key.split("/")[0]!));
  const legacyDifferences = differences.filter((key) => legacyKeys.includes(key));
  const slot2Differences = differences.filter((key) => key.includes("/slot-2/"));
  const storedKeys = [...new Set([...Object.keys(baseline.storedPrompts), ...Object.keys(storedPrompts)])];
  const storedDifferences = storedKeys.filter((key) =>
    !Buffer.from(baseline.storedPrompts[key] ?? "", "utf8").equals(Buffer.from(storedPrompts[key] ?? "", "utf8")));
  const report = { baselineSha: baseline.sha, regeneratedDays: legacyDates.length, slots: legacyDates.length * 2,
    promptFields: legacyKeys.length, byteDifferences: legacyDifferences, slot2ByteDifferences: slot2Differences,
    futureDifferences: differences.filter((key) => !legacyKeys.includes(key)),
    storedDates, missingDates, storedSlots, storedPromptFields: storedKeys.length,
    storedByteDifferences: storedDifferences, storedReelSlots, storedRefusedSlots };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.deepEqual(legacyDifferences, [], "pre-extension production prompts must remain byte-identical");
  assert.deepEqual(slot2Differences, [], "slot 2 production prompts must remain byte-identical on every date");
  assert.deepEqual(storedDifferences, [], "prompts rebuilt from stored pre-extension slots must remain byte-identical");
}
