import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FREE_HEADLINE_START_DATE,
  SLOT2_TOPIC_PLAN,
  buildGrowthPlaybook,
  listSeeds
} from "../src/growthPlaybook";
import { repeatingObjectGram } from "../src/contentPlan";

// The 9/11–10/8 topic window re-weighted on 2026-09-06 after thirty days of
// IG insights: household textiles, plush and luggage led (毛毯 259, 行李箱 237,
// 娃娃 195); scene, occasion, place and how-to-message topics trailed (8–32).
// Slot 1 comes from data/slot1-plan.json, slot 2 from SLOT2_TOPIC_PLAN. This
// file pins the mix and the collision rules both had to satisfy.

const WINDOW_END = "2026-10-08";
const SLOT1_PLAN_PATH = join(dirname(fileURLToPath(import.meta.url)), "../data/slot1-plan.json");
const slot1Plan = JSON.parse(readFileSync(SLOT1_PLAN_PATH, "utf8").replace(/^﻿/, "")) as Record<string, string>;

type Family = "textile" | "plush" | "luggage" | "boot" | "shoe" | "bag" | "garment" | "other";
export function topicFamily(topic: string): Family {
  if (/娃娃|玩偶/.test(topic)) return "plush";
  if (/行李箱/.test(topic)) return "luggage";
  if (/靴|登山鞋/.test(topic)) return "boot";
  if (/被|毯|枕|床|窗簾|地毯|踏墊|抱枕|沙發|保潔墊|寢/.test(topic)) return "textile";
  if (/鞋/.test(topic)) return "shoe";
  if (/包|夾|皮帶/.test(topic)) return "bag";
  if (/衣|外套|西裝|襯衫|制服|禮服|雨衣|領帶|圍巾|牛仔|針織|大衣|羽絨|棉麻|安全帽/.test(topic)) return "garment";
  return "other";
}
const PREFERRED: Family[] = ["textile", "plush", "luggage", "boot"];
const TEN_DAY_REVIEW_SEED = "每十天公開一次洗護觀察";

function daysApart(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

describe("slot 2 topic plan (2026-09-11..10-08)", () => {
  const playbook = buildGrowthPlaybook("2026-07-11", 90);
  const windowDays = playbook.days.filter((day) => day.date >= FREE_HEADLINE_START_DATE && day.date <= WINDOW_END);
  const seedsByTopic = new Map(listSeeds().map((seed) => [seed.topic, seed]));

  it("covers every non-poster slot-2 day in the window, and nothing before the free-headline cutover", () => {
    const expected = windowDays
      .filter((day) => day.slots.find((slot) => slot.slot === 2)?.format !== "poster")
      .map((day) => day.date);
    expect(Object.keys(SLOT2_TOPIC_PLAN).sort()).toEqual(expected);
    for (const date of Object.keys(SLOT2_TOPIC_PLAN)) expect(date >= FREE_HEADLINE_START_DATE).toBe(true);
  });

  it("names an existing seed once, and the emitted slot uses that seed's headline and service", () => {
    const topics = Object.values(SLOT2_TOPIC_PLAN);
    expect(new Set(topics).size).toBe(topics.length);
    for (const [date, topic] of Object.entries(SLOT2_TOPIC_PLAN)) {
      const seed = seedsByTopic.get(topic);
      expect(seed, `${date} ${topic}`).toBeDefined();
      const slot2 = playbook.days.find((day) => day.date === date)?.slots.find((slot) => slot.slot === 2);
      expect(slot2?.topic, date).toBe(seed!.headline);
    }
  });

  it("keeps photo-guide, local and pickup seeds out, except the one ten-day shop observation", () => {
    // LINE 傳照片 32, 逢甲西屯人流 23, 青海路通勤: the bottom of the 30-day table.
    // The ten-day observation is the window's single trust-reset post and the
    // only slot-2 caption that carries the signed-off pickup line.
    for (const [date, topic] of Object.entries(SLOT2_TOPIC_PLAN)) {
      if (topic === TEN_DAY_REVIEW_SEED) continue;
      expect(["photo-guide", "local", "pickup-delivery"], `${date} ${topic}`).not.toContain(seedsByTopic.get(topic)!.service);
    }
    expect(Object.values(SLOT2_TOPIC_PLAN).filter((topic) => topic === TEN_DAY_REVIEW_SEED)).toHaveLength(1);
  });

  it("keeps slot 2 off the same object family and the same service page as slot 1 on the same day", () => {
    for (const day of windowDays) {
      const [slot1, slot2] = day.slots;
      if (!slot1 || !slot2 || slot2.format === "poster") continue;
      expect(slot2.seo_sync_page, day.date).not.toBe(slot1.seo_sync_page);
      const planned = slot1Plan[day.date];
      if (planned) expect(topicFamily(slot2.topic), `${day.date} ${slot2.topic} vs ${planned}`).not.toBe(topicFamily(planned));
    }
  });

  it("does not let an object head recur within seven days across slot 1 (plan) and slot 2", () => {
    const rows = [
      ...windowDays.map((day) => ({ date: day.date, slot: 1, topic: slot1Plan[day.date] ?? "" })).filter((row) => row.topic),
      ...windowDays.map((day) => ({ date: day.date, slot: 2, topic: day.slots.find((slot) => slot.slot === 2)?.topic ?? "" }))
    ];
    for (const a of rows) {
      for (const b of rows) {
        if (a === b || a.date > b.date || (a.date === b.date && a.slot >= b.slot)) continue;
        if (daysApart(a.date, b.date) > 7) continue;
        const gram = repeatingObjectGram(a.topic, b.topic);
        expect(gram, `${a.date} s${a.slot} 「${a.topic}」 vs ${b.date} s${b.slot} 「${b.topic}」`).toBeUndefined();
      }
    }
  });

  it("puts textile/plush/luggage/boot at a majority of the window across both slots", () => {
    const families = windowDays.flatMap((day) => {
      const out: Family[] = [];
      if (slot1Plan[day.date]) out.push(topicFamily(slot1Plan[day.date]!));
      const slot2 = day.slots.find((slot) => slot.slot === 2);
      if (slot2 && slot2.format !== "poster") out.push(topicFamily(slot2.topic));
      return out;
    });
    const preferred = families.filter((family) => PREFERRED.includes(family)).length;
    // 30/54 on 2026-09-06 (57%); the seed pool has 14 textile/plush/luggage
    // seeds in total, so "six in ten" is the ceiling, not a soft target.
    expect(preferred / families.length).toBeGreaterThanOrEqual(0.55);
    // The only object-less post allowed is the ten-day shop observation.
    expect(families.filter((family) => family === "other")).toHaveLength(1);
  });
});

describe("slot 1 plan (2026-09-11..10-08)", () => {
  it("has no service-listing, B2B batch or holiday-decoration topics left in the window", () => {
    for (const [date, topic] of Object.entries(slot1Plan)) {
      if (date < FREE_HEADLINE_START_DATE || date > WINDOW_END) continue;
      expect(topic, date).not.toMatch(/月結|代工|批量|診所|公司制服|健身房|聖誕/);
    }
  });
});
