import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config";
import { imageAssetsForSlot } from "../src/mediaAssets";
import {
  buildDailyContent,
  topicRepeatsInWindow,
  type Slot1PlanExtEntry
} from "../src/contentPlan";
import { isQuestionHeadline, serviceForTopic } from "../src/growthPlaybook";

const plan = JSON.parse(readFileSync("data/slot1-plan-ext.json", "utf8")) as Record<string, Slot1PlanExtEntry>;
const formatExperiment = JSON.parse(readFileSync("data/slot1-format-experiment.json", "utf8")) as {
  name: string;
  start_date: string;
  end_date: string;
  slots: Array<{ date: string; format: string; family: string }>;
  preregistered: Record<string, string>;
};
const dates = Object.keys(plan).sort();
const expectedDates = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 9, 23 + index));
  return date.toISOString().slice(0, 10);
});
const oldPlan = JSON.parse(readFileSync("data/slot1-plan.json", "utf8")) as Record<string, string>;
const lockDirectory = "data/day-locks";
const dayLocks = readdirSync(lockDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(join(lockDirectory, name), "utf8")) as { slot1?: { topic?: string } });
const existingTopics = [
  ...Object.values(oldPlan),
  ...dayLocks.map((lock) => lock.slot1?.topic).filter((topic): topic is string => Boolean(topic))
];
const familyOrder = ["home-textile", "season-weather", "pickup-delivery", "shoes", "luxury-leather"] as const;
const legalFamilies = new Set<string>(familyOrder);
const legalFormats = new Set(["carousel", "single"]);
const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
});
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot1-ext-plan-"));
  roots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  return root;
}

function cjkFourGrams(topic: string): Set<string> {
  const grams = new Set<string>();
  for (const run of topic.match(/[\u3400-\u9fff]{4,}/gu) ?? []) {
    for (let index = 0; index + 4 <= run.length; index += 1) grams.add(run.slice(index, index + 4));
  }
  return grams;
}

describe("slot1 extension plan data", () => {
  it("has exactly one legal entry for each consecutive date", () => {
    expect(dates).toEqual(expectedDates);
    for (const [date, entry] of Object.entries(plan)) {
      expect(date).toMatch(/^2026-\d\d-\d\d$/u);
      expect(entry.topic.trim()).not.toBe("");
      expect(entry.object.trim()).not.toBe("");
      expect(legalFormats.has(entry.format)).toBe(true);
      expect(legalFamilies.has(entry.family)).toBe(true);
      if (entry.note !== undefined) expect(typeof entry.note).toBe("string");
      if (entry.needs_review !== undefined) expect(typeof entry.needs_review).toBe("boolean");
    }
  });

  it("alternates seven carousel and seven single days", () => {
    expect(Object.values(plan).filter((entry) => entry.format === "carousel")).toHaveLength(7);
    expect(Object.values(plan).filter((entry) => entry.format === "single")).toHaveLength(7);
    expect(dates.map((date) => plan[date]!.format)).toEqual(
      dates.map((_, index) => (index % 2 === 0 ? "carousel" : "single"))
    );
    expect(plan["2026-10-23"]?.format).toBe("carousel");
  });

  it("meets every seven-day family quota window", () => {
    for (let start = 0; start <= dates.length - 7; start += 1) {
      const window = dates.slice(start, start + 7).map((date) => plan[date]!.family);
      const counts = new Map(familyOrder.map((family) => [family, window.filter((item) => item === family).length]));
      expect(counts.get("home-textile"), dates[start]).toBeGreaterThanOrEqual(2);
      expect(counts.get("home-textile"), dates[start]).toBeLessThanOrEqual(3);
      expect(counts.get("season-weather"), dates[start]).toBeGreaterThanOrEqual(1);
      expect(counts.get("season-weather"), dates[start]).toBeLessThanOrEqual(2);
      expect(counts.get("pickup-delivery"), dates[start]).toBe(1);
      expect(counts.get("shoes"), dates[start]).toBe(1);
      expect(counts.get("luxury-leather"), dates[start]).toBeLessThanOrEqual(1);
    }
  });

  it("includes a plush doll topic and uses question headlines without price or distance claims", () => {
    expect(Object.values(plan).some((entry) =>
      entry.family === "home-textile" && /絨毛|娃娃|玩偶/u.test(entry.topic)
    )).toBe(true);
    for (const [date, entry] of Object.entries(plan)) {
      expect(isQuestionHeadline(entry.topic), date).toBe(true);
      expect(entry.topic, date).not.toMatch(/價格|價錢|\d+\s*(?:元|塊)|距離|公里|公尺|里程/u);
    }
  });

  it("avoids repeated four-character Chinese phrases across existing and extension topics", () => {
    const topics = Object.values(plan).map((entry) => entry.topic);
    for (let index = 0; index < topics.length; index += 1) {
      const topic = topics[index]!;
      expect(topicRepeatsInWindow(topic, [...existingTopics, ...topics.slice(0, index)])).toBeUndefined();
      const grams = cjkFourGrams(topic);
      for (const other of [...existingTopics, ...topics.slice(0, index)]) {
        const otherGrams = cjkFourGrams(other);
        expect([...grams].filter((gram) => otherGrams.has(gram)), topic + " repeats against " + other).toEqual([]);
      }
    }
  });

  it("marks both different luxury brand/model anchors for review", () => {
    const luxury = Object.entries(plan).filter(([, entry]) => entry.family === "luxury-leather");
    expect(luxury).toHaveLength(2);
    expect(luxury.every(([, entry]) => entry.needs_review === true)).toBe(true);
    expect(luxury[0]?.[1].topic).toMatch(/Chanel Classic Flap/u);
    expect(luxury[1]?.[1].topic).toMatch(/Gucci Jackie 1961/u);
    expect(serviceForTopic(luxury[0]![1].topic)).toBe("luxury-dry");
    expect(serviceForTopic(luxury[1]![1].topic)).toBe("luxury-dry");
    expect(serviceForTopic(plan["2026-10-25"]!.topic)).toBe("pickup-delivery");
    expect(serviceForTopic(plan["2026-11-01"]!.topic)).toBe("pickup-delivery");
  });

  it("keeps the registered format groups identical to the extension plan", () => {
    expect(formatExperiment.name).toBe("slot1-format-single-vs-carousel-2026-10");
    expect(formatExperiment.start_date).toBe("2026-10-23");
    expect(formatExperiment.end_date).toBe("2026-11-05");
    expect(formatExperiment.slots).toEqual(dates.map((date) => ({
      date,
      format: plan[date]!.format,
      family: plan[date]!.family
    })));
    expect(formatExperiment.preregistered.primary_metric).toContain("72 hours");
    expect(formatExperiment.preregistered.secondary_metric).toContain("report only");
    expect(formatExperiment.preregistered.analysis_unit).toContain("single-image group");
    expect(formatExperiment.preregistered.decision_rule).toContain("p < 0.10");
    expect(formatExperiment.preregistered.notes).toContain("stratify");
  });
});

describe("slot1 extension integration", () => {
  it("adopts extension carousel and single rows, with a single cover item and no package", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "data", "slot1-plan-ext.json"), JSON.stringify({
      "2026-10-23": plan["2026-10-23"],
      "2026-10-24": plan["2026-10-24"]
    }), "utf8");
    for (const date of ["2026-10-23", "2026-10-24"]) {
      const slot = buildDailyContent(date, config, { root, applySlot1Plan: true }).slots.find((item) => item.slot === 1)!;
      expect(slot.content_plan_source).toBe("slot1-plan-ext");
      expect(slot.topic).toBe(plan[date]!.topic);
      if (date === "2026-10-23") {
        expect(["carousel", "mixed-carousel"]).toContain(slot.media_type);
        expect(slot.media_package).toBeTruthy();
        expect(slot.carousel_items?.length).toBeGreaterThan(1);
      } else {
        expect(slot.media_type).toBe("image");
        expect(slot.media_package).toBeUndefined();
        expect(slot.carousel_items).toHaveLength(1);
        expect(slot.carousel_items?.[0]?.slide).toBe(1);
        expect(slot.local_image_path).toBe(slot.carousel_items?.[0]?.local_image_path);
        expect(imageAssetsForSlot(slot)).toHaveLength(1);
        expect(imageAssetsForSlot(slot)[0]?.local_image_path).toBe(slot.local_image_path);
      }
    }
  });

  it("falls back through the rotation and records the as-aired gram on collision", async () => {
    const root = await tempRoot();
    const entry = plan["2026-10-23"]!;
    await writeFile(join(root, "data", "slot1-plan-ext.json"), JSON.stringify({ "2026-10-23": entry }), "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const content = buildDailyContent("2026-10-23", config, {
        root,
        applySlot1Plan: true,
        airedTopics: [entry.topic]
      });
      const slot = content.slots.find((item) => item.slot === 1)!;
      expect(slot.content_plan_source).toBe("growth-playbook");
      expect(slot.topic).not.toBe(entry.topic);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("repeats"));
    } finally {
      warn.mockRestore();
    }
  });

  it.each(["2026-10-22", "2026-11-06"])("keeps the pre-extension slot byte-for-byte without an entry on %s", async (date) => {
    const root = await tempRoot();
    await writeFile(join(root, "data", "slot1-plan-ext.json"), JSON.stringify({}), "utf8");
    const before = buildDailyContent(date, config, { root }).slots.find((item) => item.slot === 1);
    const after = buildDailyContent(date, config, { root, applySlot1Plan: true }).slots.find((item) => item.slot === 1);
    expect(after).toEqual(before);
  });

  it("ignores an extension entry inside the old plan window and preserves its special", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "data", "slot1-plan-ext.json"), JSON.stringify({
      "2026-09-25": { ...plan["2026-10-23"], topic: "外套不應覆寫中秋門市實拍？改看其他細節" }
    }), "utf8");
    const slot = buildDailyContent("2026-09-25", config, { root, applySlot1Plan: true }).slots.find((item) => item.slot === 1)!;
    expect(slot.content_plan_source).toBe("growth-playbook");
    expect(slot.topic).not.toContain("不應覆寫中秋");
  });

  it("ignores an extension entry on a regular day inside the old plan window", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "data", "slot1-plan-ext.json"), JSON.stringify({
      "2026-09-24": { ...plan["2026-10-23"], topic: "外套不應進入舊窗口？核對不同位置" }
    }), "utf8");
    const slot = buildDailyContent("2026-09-24", config, { root, applySlot1Plan: true }).slots.find((item) => item.slot === 1)!;
    expect(slot.content_plan_source).toBe("growth-playbook");
    expect(slot.topic).not.toContain("不應進入舊窗口");
  });
});
