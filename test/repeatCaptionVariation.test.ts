import { describe, expect, it } from "vitest";
import { captionsFor } from "../src/scheduleReel";
import { LINE_CONTACT } from "../src/contentPlan";
import { REEL_SCHEDULE, loadExtensions, priorAirings, type ReelConcept } from "../src/reelConcepts";

// The 8/16 insight rows measured what an unchanged rerun costs: 精品包 217→93
// views, 後背包 202→92. The cooldown spaces reruns 21 days apart; these tests
// pin the other half of the fix — the second airing must not reprint the
// first one's caption, and the shared caption rules (tappable link, price
// line, hashtag ladder) must survive both arrangements.

const concept: ReelConcept = {
  id: "test-suede",
  object_type: "shoes",
  hook: "麂皮鞋摸起來變硬",
  close: "麂皮鞋 400 起,不確定材質先拍給我。",
  narration:
    "絨毛倒了就會發硬發亮,那不是髒。洗完得把整片絨面重新刷順才回得來,用濕布擦只會把它壓得更平。",
  before_subject: "a tan suede shoe",
  after_subject: "the same shoe restored",
};

describe("re-airing caption variation", () => {
  const first = captionsFor(concept, 0);
  const rerun = captionsFor(concept, 1);

  it("writes a different caption for the second airing", () => {
    expect(rerun.instagram).not.toBe(first.instagram);
    expect(rerun.facebook).not.toBe(first.facebook);
  });

  it("changes the fold: first airing leads with the hook, the rerun with the diagnostic", () => {
    expect(first.instagram.startsWith("麂皮鞋摸起來變硬。")).toBe(true);
    expect(rerun.instagram.startsWith("絨毛倒了就會發硬發亮,那不是髒。")).toBe(true);
  });

  it("invents nothing: the rerun still carries the same hook and full narration text", () => {
    expect(rerun.instagram).toContain("麂皮鞋摸起來變硬。");
    expect(rerun.instagram).toContain("那不是髒。");
    expect(rerun.instagram).toContain("用濕布擦只會把它壓得更平。");
  });

  it("keeps the shared caption rules alive in both arrangements", () => {
    for (const caption of [first.instagram, rerun.instagram, first.facebook, rerun.facebook]) {
      expect(caption).toContain(LINE_CONTACT);
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
