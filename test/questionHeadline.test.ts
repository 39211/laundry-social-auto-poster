import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent, topicRepeatsInWindow } from "../src/contentPlan";
import { isQuestionHeadline } from "../src/growthPlaybook";

const config = getConfig();
const plan = JSON.parse(readFileSync("data/slot1-plan.json", "utf8")) as Record<string, string>;

// 2026-09-04: the owner approved question-form headlines for every planned
// slot-1 date from 09-05 on (iprinter rule: one question spans h1, Reel card
// and YouTube title). A planned question must reach the calendar verbatim --
// no phase label in front, no format tail after the question mark.
describe("question headlines from slot1-plan", () => {
  const questionDates = Object.entries(plan).filter(([date, topic]) => date >= "2026-09-05" && isQuestionHeadline(topic));

  it("covers every planned date from 09-05 onward", () => {
    const remaining = Object.entries(plan).filter(([date]) => date >= "2026-09-05");
    expect(questionDates.length).toBe(remaining.length);
    expect(questionDates.length).toBeGreaterThanOrEqual(34);
  });

  it("keeps the planned question as the verbatim slot-1 topic and hook on non-holiday days", () => {
    for (const [date, headline] of questionDates) {
      const content = buildDailyContent(date, config, { root: process.cwd(), applySlot1Plan: true });
      const slot = content.slots.find((item) => item.slot === 1)!;
      if (!isQuestionHeadline(slot.topic)) {
        // A hand-authored holiday special outranks the plan (中秋, 國慶); nothing else may.
        expect(slot.topic, `${date} lost its question headline`).toMatch(/當天|連假/u);
        continue;
      }
      expect(slot.topic, date).toBe(headline);
      expect(slot.topic, date).not.toMatch(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：/u);
      // cleanHook closes a statement with 。 but leaves a question mark alone.
      const expectedHook = /[？?]$/u.test(headline) ? headline : `${headline}。`;
      const firstBlock = slot.facebook_caption.split("\n\n")[0] ?? "";
      expect(firstBlock, `${date} hook`).toBe(expectedHook);
      expect(slot.instagram_caption.split("\n\n")[0], `${date} IG hook`).toBe(expectedHook);
      expect(firstBlock).not.toContain("？。");
      for (const caption of [slot.facebook_caption, slot.instagram_caption]) {
        expect(caption).not.toMatch(/保證|百分之百|完全去除|恢復全新|一定洗白/u);
      }
    }
  });

  it("no two planned questions inside a 15-day window share an object head", () => {
    const dates = questionDates.map(([date]) => date).sort();
    for (let i = 0; i < dates.length; i += 1) {
      const window = dates
        .slice(0, i)
        .filter((other) => (Date.parse(dates[i]!) - Date.parse(other)) / 86_400_000 <= 15)
        .map((other) => plan[other]!);
      const gram = topicRepeatsInWindow(plan[dates[i]!]!, window);
      expect(gram, `${dates[i]} repeats 「${gram}」 inside 15 days`).toBeUndefined();
    }
  });
});
