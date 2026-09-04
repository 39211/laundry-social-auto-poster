import { describe, expect, it } from "vitest";
import { linePostRedirectUrl } from "../src/contentPlan";
import { captionsFor } from "../src/scheduleReel";
import { REEL_CONCEPTS, REEL_SCHEDULE, loadExtensions, splitNarrationSentences, type ReelConcept } from "../src/reelConcepts";

const concept: ReelConcept = {
  id: "test-utm-reel",
  object_type: "shoes",
  hook: "麂皮鞋摸起來變硬",
  close: "麂皮鞋 400 起,不確定材質先拍給我。",
  narration: "絨毛倒了就會發硬發亮,那不是髒。",
  before_subject: "a tan suede shoe",
  after_subject: "the same shoe restored"
};

function hasUtmTrio(text: string, source: string, campaign: string): boolean {
  return (
    text.includes(`utm_source=${source}`) &&
    text.includes("utm_medium=social") &&
    text.includes(`utm_campaign=${campaign}`)
  );
}

describe("captionsFor LINE post redirect", () => {
  it("輸出含 source=post 轉導鏈且不疊 utm;拔掉 → 紅", () => {
    const date = "2026-08-17";
    const lineUrl = linePostRedirectUrl();
    const captions = captionsFor(concept, 0, date);

    expect(hasUtmTrio(captions.instagram, "instagram", `${date}-reel`)).toBe(false);
    expect(hasUtmTrio(captions.facebook, "facebook", `${date}-reel`)).toBe(false);
    expect(captions.instagram).toContain(lineUrl);
    expect(captions.facebook).toContain(lineUrl);
    expect(captions.instagram).toContain("source=post");
    expect(captions.facebook).toContain("source=post");

    const stripped = captions.instagram.replaceAll(lineUrl, "");
    expect(stripped.includes(lineUrl)).toBe(false);
    expect(stripped.includes("source=post")).toBe(false);
  });
});

describe("captionsFor re-airing lead (O-F1)", () => {
  it("takes the first sentence even when it ends with ？, not the first 。", () => {
    const questioned: ReelConcept = {
      ...concept,
      narration: "絨毛倒了發硬發亮,那是髒嗎？那不是髒。洗完得把絨面重新刷順才回得來。"
    };
    const rerun = captionsFor(questioned, 1, "2026-08-17");
    expect(rerun.instagram.startsWith("絨毛倒了發硬發亮,那是髒嗎？")).toBe(true);
    // indexOf("。") would swallow through 那不是髒。 and this would go green
    // for the wrong splitter.
    expect(rerun.instagram.startsWith("絨毛倒了發硬發亮,那是髒嗎？那不是髒。")).toBe(false);
  });
});

describe("captionsFor question stacking (B)", () => {
  const CTA_BLOCK = /拍一張(?:私訊|傳 LINE)|說一下數量/;
  const QUESTION_FOR_PLUSH = "家裡有沒有那種一直想洗、又不太敢洗的娃娃？";

  it("keeps ？ to ≤2 across 26 concepts × first/rerun × IG/FB, and CTA has none", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.length).toBe(26);
      for (const concept of REEL_CONCEPTS) {
        for (const airedBefore of [0, 1] as const) {
          const caps = captionsFor(concept, airedBefore, "2026-09-05");
          for (const [platform, text] of [
            ["instagram", caps.instagram],
            ["facebook", caps.facebook]
          ] as const) {
            const qCount = (text.match(/？/g) ?? []).length;
            expect(
              qCount,
              `${concept.id} aired=${airedBefore} ${platform} has ${qCount} ？\n${text}`
            ).toBeLessThanOrEqual(2);
            const ctaBlock = text.split("\n\n").find((block) => CTA_BLOCK.test(block));
            expect(ctaBlock, `${concept.id} ${platform} missing CTA block`).toBeDefined();
            expect(ctaBlock, `${concept.id} ${platform} CTA has ？: ${ctaBlock}`).not.toContain("？");
            expect(ctaBlock, `${concept.id} ${platform} CTA has ?`).not.toContain("?");
          }
        }
      }
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });

  it("skips questionFor when the lead already ends with ？", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      const plush = REEL_CONCEPTS.find((entry) => entry.id === "plush-doll");
      expect(plush).toBeDefined();
      const lead = splitNarrationSentences(plush!.narration)[0] ?? "";
      expect(lead.endsWith("？")).toBe(true);
      const rerun = captionsFor(plush!, 1, "2026-09-05");
      expect(rerun.instagram).not.toContain(QUESTION_FOR_PLUSH);
      expect(rerun.facebook).not.toContain(QUESTION_FOR_PLUSH);
      expect(rerun.instagram.startsWith(lead)).toBe(true);
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });
});
