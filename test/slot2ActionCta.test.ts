import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  assertPlaybookCaptionQuality,
  buildDailyContent,
  slot2ActionCta
} from "../src/contentPlan";
import { buildGrowthPlaybook, flattenGrowthPlaybook } from "../src/growthPlaybook";

const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_SITE_BASE_URL: "https://sixiangjialaundry.com",
  PUBLIC_IMAGE_BASE_URL: "https://sixiangjialaundry.com",
  META_ACCESS_TOKEN: "x",
  FB_PAGE_ID: "x",
  IG_USER_ID: "x"
});

function lastBodyParagraph(caption: string): string {
  const blocks = caption.split("\n\n");
  const stop = blocks.findIndex(
    (block) =>
      block.startsWith("#") ||
      block.startsWith("出處：") ||
      block.startsWith("參考價") ||
      block.includes("/go/line.html") ||
      block.includes("0968327653")
  );
  const body = stop === -1 ? blocks : blocks.slice(0, stop);
  return body[body.length - 1] ?? "";
}

function chuanLineOutsideContact(caption: string): number {
  return caption
    .split("\n\n")
    .filter((block) => !block.includes("/go/line.html") && !block.includes("0968327653"))
    .join("\n\n")
    .split("傳 LINE").length - 1;
}

const TABLE_CASES = [
  { topic: "包包提把發黑", a: "包角", b: "內裡" },
  { topic: "白鞋泛黃", a: "鞋面", b: "鞋底" },
  { topic: "外套領口發黃", a: "領口", b: "袖口" },
  { topic: "窗簾下緣發霉", a: "下緣", b: "掛鉤處" },
  { topic: "娃娃五官髒污", a: "五官", b: "縫線" },
  { topic: "棉被收納前悶味", a: "被角", b: "貼身那一面" },
  { topic: "地毯邊緣發黑", a: "邊緣", b: "最常踩的位置" },
  { topic: "行李箱輪子卡住", a: "輪子", b: "把手" },
  { topic: "毛毯起球處理", a: "起球處", b: "邊緣" }
] as const;

// Captured with tsx + the same config above, before the slot-2 action CTA
// landed. Method: print facebook/instagram captions for 2026-09-07 slot 2,
// then pin the strings. Date gate removal must make this comparison fail.
const SLOT2_2026_09_07_FACEBOOK = [
  "開學前制服外套和白鞋，先看容易忽略的位置。",
  "白鞋放久了會黃，不是因為髒。那是材質本身在氧化。",
  "白鞋我會先確認是表面髒還是材質本身變色。這兩種能做到的程度差很多。",
  "不確定還救不救得回來？拍一張傳 LINE給我們，先幫你看。",
  "你都怎麼洗白鞋？",
  "那個總說「再穿一次就拿去洗」的朋友，這篇傳給他。",
  "追蹤私享家，之後會持續整理鞋子、包包和白鞋的日常照護判斷。",
  "出處：門市當日看件",
  "直接點這裡問:https://sixiangjialaundry.com/go/line.html?source=post (或加 LINE:0968327653)",
  "#私享家洗衣店 #台中西屯洗衣店 #開學季 #白鞋清潔 #台中洗鞋 #洗鞋推薦 #球鞋清洗 #台中洗衣店 #西屯 #逢甲 #台中"
].join("\n\n");

const SLOT2_2026_09_07_INSTAGRAM = [
  "開學前制服外套和白鞋，先看容易忽略的位置。",
  "白鞋放久了會黃，不是因為髒。那是材質本身在氧化。",
  "白鞋我會先確認是表面髒還是材質本身變色。這兩種能做到的程度差很多。",
  "不確定還救不救得回來？拍一張私訊給我們，先幫你看。",
  "你都怎麼洗白鞋？",
  "那個總說「再穿一次就拿去洗」的朋友，這篇傳給他。",
  "追蹤私享家，之後會持續整理鞋子、包包和白鞋的日常照護判斷。",
  "出處：門市當日看件",
  "直接點這裡問:https://sixiangjialaundry.com/go/line.html?source=post (或加 LINE:0968327653)",
  "#私享家洗衣店 #台中西屯洗衣店 #開學季 #白鞋清潔 #台中洗鞋 #洗鞋推薦 #球鞋清洗 #台中洗衣店 #西屯 #逢甲 #台中"
].join("\n\n");

describe("slot2ActionCta", () => {
  it("maps each object class to the two named parts", () => {
    for (const row of TABLE_CASES) {
      const sentence = slot2ActionCta(row.topic);
      expect(sentence, row.topic).toBe(`拍${row.a}和${row.b}兩張傳 LINE，我們先看。`);
      expect(sentence).toContain("，");
      expect(sentence.endsWith("。")).toBe(true);
      expect(sentence).toContain("LINE");
      expect(sentence).not.toMatch(/\$|保證/);
    }
  });

  it("falls back to the whole-item pair when the object is unknown", () => {
    expect(slot2ActionCta("沙發套發霉了嗎")).toBe("拍整體和最在意的位置兩張傳 LINE，我們先看。");
  });
});

describe("slot 2 playbook captions from 2026-09-08", () => {
  const content = buildDailyContent("2026-09-08", config);
  const slot2 = content.slots.find((slot) => slot.slot === 2)!;
  const slot1 = content.slots.find((slot) => slot.slot === 1)!;
  const slot3 = content.slots.find((slot) => slot.slot === 3);
  const expected = slot2ActionCta(slot2.topic);
  const playbookSlot = flattenGrowthPlaybook(buildGrowthPlaybook()).find(
    (row) => row.date === "2026-09-08" && row.slot === 2
  )!;

  it("ends the facebook and instagram body with the R2 sentence and passes quality", () => {
    expect(slot2.format).not.toBe("reel");
    expect(expected).toBe("拍包角和內裡兩張傳 LINE，我們先看。");
    expect(lastBodyParagraph(slot2.facebook_caption)).toBe(expected);
    expect(lastBodyParagraph(slot2.instagram_caption)).toBe(expected);
    expect(() => assertPlaybookCaptionQuality(playbookSlot, slot2.facebook_caption)).not.toThrow();
    expect(() => assertPlaybookCaptionQuality(playbookSlot, slot2.instagram_caption)).not.toThrow();
  });

  it("keeps the engagement question and puts the action after it as the next closer", () => {
    for (const caption of [slot2.facebook_caption, slot2.instagram_caption]) {
      const blocks = caption.split("\n\n");
      const questionIndex = blocks.findIndex((block) => block.includes("？") && !block.includes("傳 LINE"));
      const actionIndex = blocks.indexOf(expected);
      expect(questionIndex).toBeGreaterThan(-1);
      expect(actionIndex).toBeGreaterThan(questionIndex);
      expect(blocks[actionIndex + 1]?.startsWith("出處：") || blocks[actionIndex + 1]?.startsWith("參考價")).toBe(
        true
      );
    }
  });

  it("allows 傳 LINE at most once outside the contact line", () => {
    expect(chuanLineOutsideContact(slot2.facebook_caption)).toBe(1);
    expect(chuanLineOutsideContact(slot2.instagram_caption)).toBe(1);
    expect(slot2.facebook_caption.includes("拍一張傳 LINE")).toBe(false);
    expect(slot2.instagram_caption.includes("拍一張私訊")).toBe(false);
  });

  it("does not rewrite slot 1 or the noon reel", () => {
    expect(slot1.facebook_caption).toContain("拍一張傳 LINE");
    expect(slot1.facebook_caption).not.toContain("兩張傳 LINE，我們先看。");
    expect(slot1.instagram_caption).toContain("私訊");
    expect(slot1.instagram_caption).not.toContain("兩張傳 LINE，我們先看。");
    if (slot3) {
      expect(slot3.facebook_caption).not.toContain("兩張傳 LINE，我們先看。");
      expect(slot3.instagram_caption).not.toContain("兩張傳 LINE，我們先看。");
    }
  });
});

describe("slot 2 captions before 2026-09-08 stay frozen", () => {
  it("matches the pre-change 2026-09-07 facebook and instagram snapshots", () => {
    const content = buildDailyContent("2026-09-07", config);
    const slot2 = content.slots.find((slot) => slot.slot === 2)!;
    expect(slot2.facebook_caption).toBe(SLOT2_2026_09_07_FACEBOOK);
    expect(slot2.instagram_caption).toBe(SLOT2_2026_09_07_INSTAGRAM);
  });
});
