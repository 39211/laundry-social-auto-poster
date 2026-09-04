import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linePostRedirectUrl } from "../src/contentPlan";
import { captionsFor } from "../src/scheduleReel";
import {
  REEL_CONCEPTS,
  REEL_SCHEDULE,
  loadExtensions,
  priorAirings,
  splitNarrationSentences,
  type ReelConcept
} from "../src/reelConcepts";

// The 8/16 insight rows measured what an unchanged rerun costs: 精品包 217→93
// views, 後背包 202→92. The cooldown spaces reruns 21 days apart; these tests
// pin the other half of the fix — the second airing must not reprint the
// first one's caption, and the shared caption rules (tappable link, price
// line, hashtag ladder) must survive both arrangements.
//
// O-F1: captionsFor must split on the same sentence boundary as subtitles
// (splitNarrationSentences). A hardcoded narration copy would keep passing
// after the live first sentence became a ？.

describe("re-airing caption variation", () => {
  const baselineConcepts = REEL_CONCEPTS.length;
  const baselineSchedule = REEL_SCHEDULE.length;
  let concept: ReelConcept;
  let firstSentence: string;
  let first: { instagram: string; facebook: string };
  let rerun: { instagram: string; facebook: string };

  beforeAll(() => {
    loadExtensions();
    const live = REEL_CONCEPTS.find((entry) => entry.id === "suede-shoe-nap");
    if (!live) {
      throw new Error("suede-shoe-nap missing after loadExtensions");
    }
    concept = live;
    firstSentence = splitNarrationSentences(concept.narration)[0] ?? "";
    first = captionsFor(concept, 0, "2026-08-17");
    rerun = captionsFor(concept, 1, "2026-08-17");
  });

  afterAll(() => {
    REEL_CONCEPTS.length = baselineConcepts;
    REEL_SCHEDULE.length = baselineSchedule;
  });

  it("writes a different caption for the second airing", () => {
    expect(rerun.instagram).not.toBe(first.instagram);
    expect(rerun.facebook).not.toBe(first.facebook);
  });

  it("changes the fold: first airing leads with the hook, the rerun with the first narration sentence", () => {
    expect(first.instagram.startsWith(`${concept.hook}。`)).toBe(true);
    expect(firstSentence.endsWith("？"), `live opener is not a question: ${firstSentence}`).toBe(true);
    expect(rerun.instagram.startsWith(firstSentence)).toBe(true);
    // Mutation: captionsFor back to indexOf("。") swallows the rest of the
    // first period-terminated span, so the rerun would start with that longer
    // lead instead of the ？ sentence alone.
    const periodAt = concept.narration.indexOf("。");
    expect(periodAt).toBeGreaterThan(firstSentence.length - 1);
    const periodLead = concept.narration.slice(0, periodAt + 1);
    expect(periodLead.startsWith(firstSentence)).toBe(true);
    expect(periodLead.length).toBeGreaterThan(firstSentence.length);
    expect(rerun.instagram.startsWith(periodLead)).toBe(false);
  });

  it("invents nothing: the rerun still carries the same hook and full narration text", () => {
    const rest = splitNarrationSentences(concept.narration).slice(1).join("");
    expect(rerun.instagram).toContain(`${concept.hook}。`);
    expect(rerun.instagram).toContain(firstSentence);
    expect(rest.length).toBeGreaterThan(0);
    expect(rerun.instagram).toContain(rest);
  });

  it("keeps the shared caption rules alive in both arrangements", () => {
    for (const caption of [first.instagram, rerun.instagram, first.facebook, rerun.facebook]) {
      expect(caption).toContain(linePostRedirectUrl());
      expect(caption).toContain("0968327653");
      // The hashtag ladder upgrade appends intent and local tags beyond the
      // four generic seeds — it only happens inside withSharedCaptionRules,
      // so its output is the witness that the rules ran on this arrangement.
      // (The price line is conditional on the price table and legitimately
      // absent for suede, so it cannot serve as a witness.)
      const tagBlock = caption.split("\n\n").find((block) => block.startsWith("#")) ?? "";
      expect(tagBlock.split(/\s+/u).length).toBeGreaterThan(4);
      expect(tagBlock).toContain("#洗鞋");
    }
  });
});

describe("priorAirings", () => {
  it("counts only schedule entries strictly before the date", () => {
    loadExtensions();
    const counted = new Map<string, string[]>();
    for (const entry of REEL_SCHEDULE) {
      counted.set(entry.conceptId, [...(counted.get(entry.conceptId) ?? []), entry.date]);
    }
    const repeated = [...counted.entries()].find(([, dates]) => dates.length >= 2);
    expect(repeated, "the 59-day schedule re-airs at least one concept").toBeDefined();
    const [conceptId, dates] = repeated!;
    const sorted = [...dates].sort();
    expect(priorAirings(conceptId, sorted[0]!)).toBe(0);
    expect(priorAirings(conceptId, sorted[1]!)).toBe(1);
    // On the day itself the airing has not happened yet.
    expect(priorAirings(conceptId, sorted[0]!)).toBe(0);
  });
});
