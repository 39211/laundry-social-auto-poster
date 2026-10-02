import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateAbTestPlan, loadAbTestPlan, type AbDayPlan } from "../src/abTestPlan";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import {
  INDEX_GROWTH_CATALOG,
  ngramJaccard,
  normalizeDiagnosticText,
  pageDiagnosticText,
  validateIndexGrowthPages,
  type IndexGrowthPageDefinition
} from "../src/indexGrowthPages";
import { collectReferencedPublicAssetPaths } from "../src/publishPages";
import { REEL_CONCEPTS, loadExtensions } from "../src/reelConcepts";
import { getZonedDateParts } from "../src/scheduler";

const FORTNIGHT_START = "2026-08-27";
const FORTNIGHT_DAYS = 14;
const SHOE_OBJECT_TYPES = new Set([
  "white-shoe",
  "canvas-shoe",
  "leather-shoe",
  "suede",
  "kids-shoe",
  "hiking-boot",
  "shoe"
]);

function addUtcDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function conceptById(id: string): { id: string; object_type: string } | undefined {
  return REEL_CONCEPTS.find((concept) => concept.id === id);
}

function objectFamily(conceptId: string): string {
  const concept = conceptById(conceptId);
  if (concept) {
    if (SHOE_OBJECT_TYPES.has(concept.object_type) || concept.object_type.endsWith("-shoe")) return "shoe";
    return concept.object_type;
  }
  if (/(shoe|suede|boot|sneaker|heel)/i.test(conceptId)) return "shoe";
  const prefix = conceptId.split("-")[0] ?? conceptId;
  return prefix;
}

function isShoeConcept(conceptId: string): boolean {
  return objectFamily(conceptId) === "shoe";
}

describe("noon rotation pressure: 14 consecutive days from the shoe-lead rebuild", () => {
  loadExtensions();

  it("keeps the opening six noon slots as distinct shoe types", async () => {
    const plan = await loadAbTestPlan();
    const window = plan.filter((day) => day.date >= FORTNIGHT_START).slice(0, 6);
    expect(window.map((day) => day.date)).toEqual([
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01"
    ]);
    const noonIds = window.map((day) => day.noon.conceptId);
    expect(noonIds.every(isShoeConcept)).toBe(true);
    expect(new Set(noonIds).size).toBe(6);
  });

  it("does not repeat the same noon concept inside a 14-day window after the rebuild", async () => {
    const plan = await loadAbTestPlan();
    const fromRebuild = plan.filter((day) => day.date >= FORTNIGHT_START);
    expect(fromRebuild.length).toBeGreaterThanOrEqual(FORTNIGHT_DAYS);

    const collisions: string[] = [];
    for (let index = 0; index < fromRebuild.length; index += 1) {
      const day = fromRebuild[index];
      if (!day) continue;
      const windowStart = addUtcDays(day.date, -(FORTNIGHT_DAYS - 1));
      const prior = fromRebuild.filter((other) => other.date >= windowStart && other.date < day.date);
      const repeat = prior.find((other) => other.noon.conceptId === day.noon.conceptId);
      if (repeat) {
        collisions.push(`${day.noon.conceptId} on ${repeat.date} and ${day.date}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("does not place the same object family on two adjacent noon days after the opening shoe run", async () => {
    const plan = await loadAbTestPlan();
    const afterShoes = plan.filter((day) => day.date >= "2026-09-02");
    const adjacent: string[] = [];
    for (let index = 1; index < afterShoes.length; index += 1) {
      const previous = afterShoes[index - 1];
      const current = afterShoes[index];
      if (!previous || !current) continue;
      const left = objectFamily(previous.noon.conceptId);
      const right = objectFamily(current.noon.conceptId);
      if (left === right) {
        adjacent.push(`${previous.date}/${current.date} family=${left}`);
      }
    }
    expect(adjacent).toEqual([]);
  });

  it("simulates 14 consecutive playbook days across the August/September boundary", () => {
    const config = getConfig({
      ...process.env,
      DRY_RUN: "true",
      PUBLIC_IMAGE_BASE_URL: "https://example.invalid"
    });
    const dates = Array.from({ length: FORTNIGHT_DAYS }, (_, index) => addUtcDays("2026-08-31", index));
    expect(dates[0]).toBe("2026-08-31");
    expect(dates[1]).toBe("2026-09-01");

    const contents = dates.map((date) => buildDailyContent(date, config));
    const slot1Topics = contents.map((content) => content.slots[0]?.topic ?? "");
    const slot2Topics = contents.map((content) => content.slots[1]?.topic ?? "");
    expect(slot1Topics.every(Boolean)).toBe(true);
    expect(new Set(slot1Topics).size).toBe(FORTNIGHT_DAYS);
    expect(new Set(slot2Topics).size).toBe(FORTNIGHT_DAYS);

    const taipei = getZonedDateParts(new Date("2026-08-31T16:00:00.000Z"), "Asia/Taipei");
    expect(taipei.date).toBe("2026-09-01");
    const boundary = buildDailyContent(taipei.date, config);
    expect(boundary.date).toBe("2026-09-01");
    expect(boundary.timezone).toBe("Asia/Taipei");
  });

  it("documents fail-open: corrupt or non-array ab-test-plan.json becomes an empty plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "sxj-ab-corrupt-"));
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data", "ab-test-plan.json"), "{not-json");
    expect(await loadAbTestPlan(root)).toEqual([]);

    writeFileSync(join(root, "data", "ab-test-plan.json"), JSON.stringify({ date: "2026-09-01" }));
    expect(await loadAbTestPlan(root)).toEqual([]);
  });
});

describe("volume pressure on generation and indexing paths", () => {
  it("builds 100 consecutive daily packages without dropping dates or repeating slot-1 topics in any 14-day window", () => {
    const config = getConfig({
      ...process.env,
      DRY_RUN: "true",
      PUBLIC_IMAGE_BASE_URL: "https://example.invalid"
    });
    const start = "2026-07-11";
    const topics: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const date = addUtcDays(start, index);
      const content = buildDailyContent(date, config);
      expect(content.date).toBe(date);
      expect(content.slots.length).toBeGreaterThanOrEqual(2);
      const topic = content.slots[0]?.topic;
      expect(topic).toBeTruthy();
      topics.push(topic ?? "");
    }
    expect(topics).toHaveLength(100);
    expect(topics.every(Boolean)).toBe(true);

    const windowRepeats: string[] = [];
    for (let index = 0; index < topics.length; index += 1) {
      const recent = topics.slice(Math.max(0, index - 13), index);
      if (recent.includes(topics[index] ?? "")) {
        windowRepeats.push(`${addUtcDays(start, index)} repeats ${topics[index]}`);
      }
    }
    expect(windowRepeats).toEqual([]);
  });

  it("does not silently drop accepted pages when 120 hostile catalog rows fail closed", () => {
    const base = INDEX_GROWTH_CATALOG.find((page) => page.slug === "suede-shoe-cleaning");
    if (!base) throw new Error("missing suede fixture");
    const pages: IndexGrowthPageDefinition[] = Array.from({ length: 120 }, (_, index) => ({
      ...structuredClone(base),
      slug: `volume-${index}`,
      path: `guides/volume-${index}.html`,
      title: `量壓頁 ${index}`,
      h1: `量壓頁 ${index}`,
      publish_state: "accepted",
      citation_answer: `量壓獨立答案 ${index} 不要濕擦。`,
      summary: `量壓獨立答案 ${index} 不要濕擦。`,
      local_intent: `量壓意圖 ${index}`,
      canonical_intent_slug: `volume-${index}`
    }));

    const started = performance.now();
    const result = validateIndexGrowthPages(pages, { today: "2026-09-03" });
    const elapsedMs = performance.now() - started;

    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(15_000);
    expect(() => {
      if (result.ok) throw new Error("volume catalog must not pass");
    }).not.toThrow();
  });

  it("pairwise diagnostic similarity over 80 texts stays within a few seconds and does not drop pairs", () => {
    const accepted = INDEX_GROWTH_CATALOG.filter((page) => page.publish_state === "accepted");
    const texts = Array.from({ length: 80 }, (_, index) => {
      const page = accepted[index % accepted.length];
      if (!page) throw new Error("empty catalog");
      return `${normalizeDiagnosticText(pageDiagnosticText(page))}${index}`;
    });

    const started = performance.now();
    let comparisons = 0;
    let max = 0;
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const score = ngramJaccard(texts[i] ?? "", texts[j] ?? "");
        comparisons += 1;
        if (score > max) max = score;
      }
    }
    const elapsedMs = performance.now() - started;
    expect(comparisons).toBe((80 * 79) / 2);
    expect(elapsedMs).toBeLessThan(8_000);
    expect(max).toBeGreaterThan(0);
  });

  it("collects 150 referenced assets without dropping allowlisted files", () => {
    const docsRoot = mkdtempSync(join(tmpdir(), "sxj-volume-assets-"));
    const refs = Array.from({ length: 150 }, (_, index) => {
      const date = addUtcDays("2026-01-01", index % 28);
      return `assets/${date}/slot-${String(index).padStart(3, "0")}.png`;
    });
    writeFileSync(join(docsRoot, "index.html"), refs.map((path) => `<img src="${path}">`).join("\n"));
    const found = collectReferencedPublicAssetPaths(docsRoot, ["index.html"]);
    expect(found).toHaveLength(150);
    expect(found).toEqual([...refs].sort());
  });

  it("generateAbTestPlan for 40 days never pairs the same concept on one day", () => {
    loadExtensions();
    const plan: AbDayPlan[] = generateAbTestPlan("2026-08-02", 40);
    expect(plan.length).toBeGreaterThan(0);
    for (const day of plan) {
      expect(day.noon.conceptId).not.toBe(day.evening.conceptId);
    }
  });
});

describe("leap-day and DST-free Taipei clock edges", () => {
  it("walks across 2024-02-29 without inventing 2024-02-30", () => {
    expect(addUtcDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addUtcDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addUtcDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("Asia/Taipei has no DST around the March/November boundaries", () => {
    const march = getZonedDateParts(new Date("2026-03-08T16:30:00.000Z"), "Asia/Taipei");
    const november = getZonedDateParts(new Date("2026-11-01T16:30:00.000Z"), "Asia/Taipei");
    expect(march.date).toBe("2026-03-09");
    expect(march.time).toBe("00:30");
    expect(november.date).toBe("2026-11-02");
    expect(november.time).toBe("00:30");
  });
});

describe("checked-in plan file is readable JSON", () => {
  it("parses the committed ab-test-plan as an array of dated noon/evening halves", async () => {
    const raw = await readFile("data/ab-test-plan.json", "utf8");
    const plan = JSON.parse(raw) as AbDayPlan[];
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(FORTNIGHT_DAYS);
    for (const day of plan) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.noon.conceptId.length).toBeGreaterThan(0);
      expect(day.evening.conceptId.length).toBeGreaterThan(0);
    }
  });
});
