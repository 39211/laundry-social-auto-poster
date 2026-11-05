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
//
// Dates before PUBLISHED_CUTOFF were already published, so their plan entries
// are frozen (data/** is not edited to make a test pass). Where the
// as-published plan breaks a rule below, the break is listed here by date so
// the rule still binds every other date -- and every date from the cutoff on --
// in full.
const PUBLISHED_CUTOFF = "2026-11-06";

// Plan entries that were rewritten as statements before they aired (T-4b):
//   09-19 被單上一片一片的黃，先分汗、霉、還是洗劑殘留
//   09-20 地毯踩久那股味，捲起來前先看底面有沒有潮
//   09-22 枕頭芯先分記憶棉、羽絨還是纖維，再看能不能水洗
//   09-23 抱枕套和沙發套一起洗，先看洗標和布種免得色差
const PUBLISHED_STATEMENT_HEADLINE_DATES: readonly string[] = ["2026-09-19", "2026-09-20", "2026-09-22", "2026-09-23"];

// Published object-head repeats inside 15 days (T-4b):
//   10-01 電熱毯套可以拆下來洗嗎？先看拆法和洗標這 2 件事
//   re-ran 09-21 電熱毯套可以拆下來洗嗎？先看拆法和洗標這兩件事
const PUBLISHED_REPEAT_EXCEPTIONS: ReadonlyArray<{ date: string; earlier: string; gram: string }> = [
  { date: "2026-10-01", earlier: "2026-09-21", gram: "電熱毯" }
];

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 86_400_000;
}

describe("question headlines from slot1-plan", () => {
  const questionDates = Object.entries(plan).filter(([date, topic]) => date >= "2026-09-05" && isQuestionHeadline(topic));

  it("covers every planned date from 09-05 onward", () => {
    const remaining = Object.entries(plan).filter(([date]) => date >= "2026-09-05");
    expect(remaining.length).toBeGreaterThanOrEqual(34);
    const exempt = new Set(PUBLISHED_STATEMENT_HEADLINE_DATES);
    for (const [date, topic] of remaining) {
      if (exempt.has(date)) continue;
      expect(isQuestionHeadline(topic), `${date} is not a question: ${topic}`).toBe(true);
    }
    expect(questionDates.length).toBe(remaining.length - exempt.size);
  });

  it("keeps the published exceptions dated, before the cutoff, and still real", () => {
    for (const date of PUBLISHED_STATEMENT_HEADLINE_DATES) {
      expect(date < PUBLISHED_CUTOFF, `${date} is not before ${PUBLISHED_CUTOFF}`).toBe(true);
      expect(date >= "2026-09-05", `${date} is outside the question-headline window`).toBe(true);
      const topic = plan[date];
      expect(topic, `${date} is missing from slot1-plan`).toBeDefined();
      expect(isQuestionHeadline(topic!), `${date} is a question again; drop its exception`).toBe(false);
    }
    for (const { date, earlier, gram } of PUBLISHED_REPEAT_EXCEPTIONS) {
      expect(date < PUBLISHED_CUTOFF, `${date} is not before ${PUBLISHED_CUTOFF}`).toBe(true);
      expect(earlier < date, `${earlier} must precede ${date}`).toBe(true);
      expect(daysBetween(earlier, date)).toBeLessThanOrEqual(15);
      expect(plan[date], `${date} is missing from slot1-plan`).toBeDefined();
      expect(plan[earlier], `${earlier} is missing from slot1-plan`).toBeDefined();
      expect(topicRepeatsInWindow(plan[date]!, [plan[earlier]!]), `${date} vs ${earlier}`).toBe(gram);
    }
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
      const date = dates[i]!;
      // Only the dated partner is excused; the date is still checked against
      // every other planned question in its window.
      const excused = new Set(
        PUBLISHED_REPEAT_EXCEPTIONS.filter((entry) => entry.date === date).map((entry) => entry.earlier)
      );
      const window = dates
        .slice(0, i)
        .filter((other) => daysBetween(other, date) <= 15)
        .filter((other) => !excused.has(other))
        .map((other) => plan[other]!);
      const gram = topicRepeatsInWindow(plan[date]!, window);
      expect(gram, `${date} repeats 「${gram}」 inside 15 days`).toBeUndefined();
    }
  });
});
