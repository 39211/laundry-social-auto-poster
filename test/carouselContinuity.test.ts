import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  SAME_GARMENT_CONTINUITY,
  CAROUSEL_SCENE_LOCK,
  buildCarouselImagePrompts,
  buildDailyContent,
  carouselInspectionShots,
  garmentPassportFromTopic
} from "../src/contentPlan";

const DARK_TOPIC = "可收藏:深色衣服洗久變灰的判斷,送洗前先看三個位置";
const DARK_TOPIC_FULLWIDTH = "可收藏：深色衣服洗久變灰的判斷，送洗前先看三個位置";

const CHECKPOINT_CAPTION = [
  "白鞋鞋邊開始泛灰,送洗前先看這三個位置。",
  "第一個看鞋邊那圈膠條。",
  "第二個看布面靠鞋頭的地方。",
  "第三個看鞋帶孔周圍。"
].join("\n");

const ENUM_CAPTION = "送洗前先看三個位置。領口、袖口和內層比表面先累積。";

function continuityGaps(prompts: string[], passport: string): string[] {
  const gaps: string[] = [];
  if (prompts.length !== 4) gaps.push(`count:${prompts.length}`);
  for (let index = 1; index < 4; index += 1) {
    const prompt = prompts[index] ?? "";
    if (!prompt.includes(passport)) gaps.push(`slide-${index + 1}:passport`);
    if (!prompt.includes(SAME_GARMENT_CONTINUITY)) gaps.push(`slide-${index + 1}:same-garment`);
  }
  return gaps;
}

function darkPrompts(caption = DARK_TOPIC): string[] {
  return buildCarouselImagePrompts({
    date: "2026-08-18",
    slot: 1,
    topic: DARK_TOPIC,
    caption
  });
}

describe("carousel object passport", () => {
  it("locks 深色衣服 as a dark cotton tee and states that lock in the passport", () => {
    const half = garmentPassportFromTopic(DARK_TOPIC);
    const full = garmentPassportFromTopic(DARK_TOPIC_FULLWIDTH);
    for (const passport of [half, full]) {
      expect(passport).toContain("OBJECT PASSPORT:");
      expect(passport).toContain("dark cotton tee");
      expect(passport).toContain("object locked as dark cotton tee");
      expect(passport).toContain("not a shirt");
      expect(passport).toMatch(/shoulder line/);
      expect(passport).toMatch(/side seams/);
    }
  });

  it("puts the full passport and same-garment sentence on slides 2-4", () => {
    const prompts = darkPrompts();
    const passport = garmentPassportFromTopic(DARK_TOPIC);
    expect(prompts).toHaveLength(4);
    expect(prompts[0]).toContain(passport);
    expect(prompts[0]).toContain("dark cotton tee");
    expect(continuityGaps(prompts, passport)).toEqual([]);
  });

  it("locks the same pink-mat counter and wall family on every slide", () => {
    const prompts = darkPrompts();
    for (const prompt of prompts) {
      expect(prompt).toContain(CAROUSEL_SCENE_LOCK);
      expect(prompt).toContain("pink cutting mat");
    }
  });
});

describe("carousel narrative shots", () => {
  it("uses default closer / problem / after shots when the caption has no position list", () => {
    const shots = carouselInspectionShots(DARK_TOPIC, DARK_TOPIC);
    expect(shots[0]).toMatch(/Overall closer look/i);
    expect(shots[1]).toMatch(/problem area/i);
    expect(shots[2]).toMatch(/after-treatment|before\/after/i);

    const prompts = darkPrompts(DARK_TOPIC);
    expect(prompts[1]).toMatch(/Overall closer look/i);
    expect(prompts[2]).toMatch(/problem area/i);
    expect(prompts[3]).toMatch(/after-treatment|before\/after/i);
    expect(prompts[1]).not.toContain("checkpoint 1:");
  });

  it("maps a numbered three-position caption onto slides 2-4 in order", () => {
    const shots = carouselInspectionShots(CHECKPOINT_CAPTION, "可收藏：白鞋鞋邊泛灰前的檢查，送洗前先看三個位置");
    expect(shots[0]).toContain("checkpoint 1:");
    expect(shots[0]).toMatch(/foxing|midsole/i);
    expect(shots[1]).toContain("checkpoint 2:");
    expect(shots[1]).toMatch(/toe/i);
    expect(shots[2]).toContain("checkpoint 3:");
    expect(shots[2]).toMatch(/eyelet|lace/i);

    const prompts = buildCarouselImagePrompts({
      date: "2026-08-18",
      slot: 1,
      topic: "可收藏：白鞋鞋邊泛灰前的檢查，送洗前先看三個位置",
      caption: CHECKPOINT_CAPTION
    });
    expect(prompts[1]).toContain("checkpoint 1:");
    expect(prompts[1]).toMatch(/foxing|midsole/i);
    expect(prompts[2]).toContain("checkpoint 2:");
    expect(prompts[2]).toMatch(/toe/i);
    expect(prompts[3]).toContain("checkpoint 3:");
    expect(prompts[3]).toMatch(/eyelet|lace/i);
    expect(continuityGaps(prompts, garmentPassportFromTopic("可收藏：白鞋鞋邊泛灰前的檢查，送洗前先看三個位置"))).toEqual(
      []
    );
  });

  it("drops handle checkpoints on a shoe object and pads with defaults", () => {
    const caption = [
      "室內鞋汗味，送洗前先看三個位置。",
      "鞋子和包包最容易被忽略的地方，通常不是正面，而是鞋邊、提把、包角、內裡。"
    ].join("\n");
    const shots = carouselInspectionShots(caption, "室內鞋汗味");
    expect(shots.join("\n")).not.toMatch(/handle/i);
    expect(shots.join("\n")).not.toMatch(/bag corners/i);
    expect(shots.some((shot) => /after-treatment|before\/after/i.test(shot))).toBe(true);
    const prompts = buildCarouselImagePrompts({
      date: "2026-08-23",
      slot: 1,
      topic: "室內鞋汗味",
      caption
    });
    expect(prompts[1]).not.toMatch(/checkpoint \d+: handle/i);
    expect(prompts[2]).not.toMatch(/checkpoint \d+: handle/i);
    expect(prompts[3]).not.toMatch(/checkpoint \d+: handle/i);
  });

  // Over-filter guard: widening SHOE_FOREIGN_SPOTS to also eat inner lining / insole
  // must turn this red. Those are shoe-native spots, not bag parts.
  it("keeps inner lining and insole checkpoints on a shoe object instead of default shots", () => {
    const caption = [
      "室內鞋汗味，送洗前先看三個位置。",
      "第一個看內裡。",
      "第二個看鞋墊。",
      "第三個看鞋口。"
    ].join("\n");
    const shots = carouselInspectionShots(caption, "室內鞋汗味");
    expect(shots[0]).toContain("checkpoint 1: inner lining");
    expect(shots[1]).toContain("checkpoint 2: insole");
    expect(shots[2]).toContain("checkpoint 3: shoe opening");
    expect(shots.join("\n")).not.toMatch(/Overall closer look/i);
    expect(shots.join("\n")).not.toMatch(/problem area/i);
    expect(shots.join("\n")).not.toMatch(/after-treatment|before\/after/i);

    const prompts = buildCarouselImagePrompts({
      date: "2026-08-23",
      slot: 1,
      topic: "室內鞋汗味",
      caption
    });
    expect(prompts[1]).toContain("checkpoint 1: inner lining");
    expect(prompts[2]).toContain("checkpoint 2: insole");
    expect(prompts[3]).toContain("checkpoint 3: shoe opening");
    expect(prompts[1]).not.toMatch(/Overall closer look/i);
  });

  it("keeps handle checkpoints on a bag object", () => {
    const caption = "下班最常背的包先看提把。包角和邊油是先磨掉的地方。送洗前先看三個位置。";
    const topic = "今天情境：下班最常背的包先看提把";
    const shots = carouselInspectionShots(caption, topic);
    expect(shots.join("\n")).toMatch(/handle/i);
    const prompts = buildCarouselImagePrompts({
      date: "2026-08-20",
      slot: 2,
      topic,
      caption
    });
    expect(prompts.some((prompt) => /checkpoint \d+: handle/i.test(prompt))).toBe(true);
  });

  it("maps an enumerated 三個位置 list onto the three later slides", () => {
    const shots = carouselInspectionShots(ENUM_CAPTION, DARK_TOPIC);
    expect(shots[0]).toMatch(/collar/i);
    expect(shots[1]).toMatch(/cuff/i);
    expect(shots[2]).toMatch(/lining/i);

    const prompts = darkPrompts(ENUM_CAPTION);
    expect(prompts[1]).toContain("checkpoint 1:");
    expect(prompts[1]).toMatch(/collar/i);
    expect(prompts[2]).toMatch(/cuff/i);
    expect(prompts[3]).toMatch(/lining/i);
  });
});

describe("carousel continuity mutation proof", () => {
  it("fails the same checker after the passport prefix is stripped", () => {
    const prompts = darkPrompts();
    const passport = garmentPassportFromTopic(DARK_TOPIC);
    expect(continuityGaps(prompts, passport)).toEqual([]);

    const stripped = prompts.map((prompt, index) => (index === 0 ? prompt : prompt.replaceAll(passport, "")));
    expect(stripped[1]).not.toContain(passport);
    expect(stripped[2]).not.toContain(passport);
    expect(stripped[3]).not.toContain(passport);
    const gaps = continuityGaps(stripped, passport);
    expect(gaps.some((gap) => gap.endsWith(":passport"))).toBe(true);
    expect(gaps.filter((gap) => gap.endsWith(":passport"))).toEqual([
      "slide-2:passport",
      "slide-3:passport",
      "slide-4:passport"
    ]);
  });

  it("fails the same checker after the same-garment sentence is stripped", () => {
    const prompts = darkPrompts();
    const passport = garmentPassportFromTopic(DARK_TOPIC);
    expect(continuityGaps(prompts, passport)).toEqual([]);

    const stripped = prompts.map((prompt) => prompt.replaceAll(SAME_GARMENT_CONTINUITY, ""));
    expect(stripped[1]).not.toContain(SAME_GARMENT_CONTINUITY);
    expect(stripped[2]).not.toContain(SAME_GARMENT_CONTINUITY);
    expect(stripped[3]).not.toContain(SAME_GARMENT_CONTINUITY);
    const gaps = continuityGaps(stripped, passport);
    expect(gaps.some((gap) => gap.endsWith(":same-garment"))).toBe(true);
    expect(gaps.filter((gap) => gap.endsWith(":same-garment"))).toEqual([
      "slide-2:same-garment",
      "slide-3:same-garment",
      "slide-4:same-garment"
    ]);
  });
});

describe("F20 fish-2 generic 外套 passport is injected into carousel prompts", () => {
  const COAT_TOPIC = "先看懂：外套領口的皮脂痕跡";

  it("names the work-jacket default on every slide and forbids down jackets and shirts", () => {
    const passport = garmentPassportFromTopic(COAT_TOPIC);
    expect(passport).toMatch(/beige cotton work jacket/i);
    expect(passport).toMatch(/not a down jacket/i);
    expect(passport).toMatch(/not a dress shirt/i);
    expect(passport).not.toMatch(/everyday fabric jacket/i);

    const prompts = buildCarouselImagePrompts({
      date: "2026-08-18",
      slot: 1,
      topic: COAT_TOPIC
    });
    expect(prompts).toHaveLength(4);
    expect(continuityGaps(prompts, passport)).toEqual([]);
    for (const prompt of prompts) {
      expect(prompt).toMatch(/beige cotton work jacket/i);
      expect(prompt).toMatch(/not a down jacket/i);
      expect(prompt).toMatch(/not a dress shirt/i);
      expect(prompt).not.toMatch(/everyday fabric jacket/i);
    }
  });
});

describe("carousel continuity wiring through the daily builder", () => {
  it("writes passport and same-garment into tomorrow's generated carousel_items", () => {
    const content = buildDailyContent("2026-08-18", getConfig());
    const carousels = content.slots.filter((slot) => (slot.carousel_items?.length ?? 0) === 4);
    expect(carousels.length).toBeGreaterThan(0);
    for (const slot of carousels) {
      const prompts = (slot.carousel_items ?? []).map((item) => item.image_prompt);
      const passport = garmentPassportFromTopic(slot.topic);
      expect(continuityGaps(prompts, passport)).toEqual([]);
      expect(slot.image_prompt).toBe(prompts[0]);
      for (const prompt of prompts) {
        expect(prompt).toContain(CAROUSEL_SCENE_LOCK);
        expect(prompt).toContain("pink cutting mat");
      }
    }
  });
});
