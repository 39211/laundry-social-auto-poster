import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  assertPlaybookCaptionQuality,
  buildDailyContent,
  dailySlotFromPlaybook,
  looksLikeGenericSlot2Cta,
  slot2ActionCta
} from "../src/contentPlan";
import { buildGrowthPlaybook, flattenGrowthPlaybook } from "../src/growthPlaybook";

const CONTENT_PLAN_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/contentPlan.ts"), "utf8");
const SLOT2_PARTS_SRC =
  CONTENT_PLAN_SRC.match(/const SLOT2_ACTION_CTA_PARTS[\s\S]*?=\s*\[[\s\S]*?\n\];/)?.[0] ?? "";

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

const ACTION_SENTENCE_RE = /^拍.+和.+兩張傳 LINE，我們先看。$/;

function actionSentenceCount(caption: string): number {
  return caption.split("\n\n").filter((block) => ACTION_SENTENCE_RE.test(block)).length;
}

function isSlot2ClosingBlock(block: string): boolean {
  return (
    block.startsWith("#") ||
    block.startsWith("出處：") ||
    block.startsWith("參考價") ||
    block.includes("/go/line.html") ||
    block.includes("0968327653")
  );
}

/** Non-question, non-closing 拍-asks. Topic hooks that only mention 拍 are not asks. */
function photoInstructionBlocksOutsideContact(caption: string): string[] {
  return caption.split("\n\n").filter((block) => {
    if (isSlot2ClosingBlock(block)) return false;
    if (block.startsWith("追蹤")) return false;
    if (/[？?]\s*$/.test(block)) return false;
    if (!block.includes("拍")) return false;
    if (ACTION_SENTENCE_RE.test(block)) return true;
    return /給我們|幫你|傳來|傳 LINE|私訊|拍一張|拍照|先幫你看/.test(block);
  });
}

function utcDatesInclusive(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

const TABLE_CASES = [
  { topic: "包包提把發黑", a: "包角", b: "內裡" },
  { topic: "白鞋泛黃", a: "鞋面", b: "鞋底" },
  { topic: "外套領口發黃", a: "領口", b: "袖口" },
  { topic: "T恤領口油汗", a: "領口", b: "袖口" },
  { topic: "上衣袖口發黃", a: "領口", b: "袖口" },
  { topic: "衣服收納前悶味", a: "領口", b: "袖口" },
  { topic: "連假衣物整理", a: "領口", b: "袖口" },
  { topic: "窗簾下緣發霉", a: "下緣", b: "掛鉤處" },
  { topic: "娃娃五官髒污", a: "五官", b: "縫線" },
  { topic: "棉被收納前悶味", a: "被角", b: "貼身那一面" },
  { topic: "被子收納前悶味", a: "被角", b: "貼身那一面" },
  { topic: "床單發黃", a: "被角", b: "貼身那一面" },
  { topic: "床包髒污", a: "被角", b: "貼身那一面" },
  { topic: "枕頭油痕", a: "被角", b: "貼身那一面" },
  { topic: "床組受潮", a: "被角", b: "貼身那一面" },
  { topic: "地毯邊緣發黑", a: "邊緣", b: "最常踩的位置" },
  { topic: "行李箱輪子卡住", a: "輪子", b: "把手" },
  { topic: "沙發毯起球", a: "起球處", b: "邊緣" },
  { topic: "梅雨季衣櫃味道先找來源", a: "櫃內最深處", b: "最常放的那一格" },
  { topic: "鞋櫃收納前的乾燥判斷", a: "櫃內最深處", b: "最常放的那一格" },
  { topic: "送洗前先問：健身房衣物不要悶在包裡，門市會先確認什麼", a: "領口", b: "袖口" },
  { topic: "餐聚後外套與包包的味道", a: "領口", b: "袖口" },
  { topic: "送洗前先問：雨後通勤鞋不要悶在包裡，門市會先確認什麼", a: "鞋面", b: "鞋底" },
  { topic: "皮包提把發黑", a: "包角", b: "內裡" }
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
    expect(photoInstructionBlocksOutsideContact(slot2.facebook_caption)).toEqual([expected]);
    expect(photoInstructionBlocksOutsideContact(slot2.instagram_caption)).toEqual([expected]);
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

const SLOT2_2026_09_05_FACEBOOK = [
  "夜市走一圈鞋底邊緣最誠實，先看容易忽略的位置。",
  "鞋底邊那一圈最常被跳過。它決定整雙看起來新不新。",
  "鞋子我會先看鞋墊和後跟內側。腳汗停在那裡，比外面的灰更難處理。",
  "想問問看能處理到什麼程度？拍一張傳 LINE就可以。",
  "你多久整理一次鞋子？",
  "家裡鞋櫃塞滿卻幾雙都沒在穿的那個人，這篇傳給他。",
  "想每週用短影音看懂衣物、鞋包和布品細節，可以先追蹤私享家。",
  "出處：門市當日看件",
  "直接點這裡問:https://sixiangjialaundry.com/go/line.html?source=post (或加 LINE:0968327653)",
  "#私享家洗衣店 #台中西屯洗衣店 #鞋子清潔 #台中生活 #台中洗鞋 #洗鞋推薦 #球鞋清洗 #台中洗衣店 #西屯 #逢甲 #台中"
].join("\n\n");

const SLOT2_2026_09_05_INSTAGRAM = [
  "夜市走一圈鞋底邊緣最誠實，先看容易忽略的位置。",
  "鞋底邊那一圈最常被跳過。它決定整雙看起來新不新。",
  "鞋子我會先看鞋墊和後跟內側。腳汗停在那裡，比外面的灰更難處理。",
  "想問問看能處理到什麼程度？拍一張私訊就可以。",
  "你多久整理一次鞋子？",
  "家裡鞋櫃塞滿卻幾雙都沒在穿的那個人，這篇傳給他。",
  "想每週用短影音看懂衣物、鞋包和布品細節，可以先追蹤私享家。",
  "出處：門市當日看件",
  "直接點這裡問:https://sixiangjialaundry.com/go/line.html?source=post (或加 LINE:0968327653)",
  "#私享家洗衣店 #台中西屯洗衣店 #鞋子清潔 #台中生活 #台中洗鞋 #洗鞋推薦 #球鞋清洗 #台中洗衣店 #西屯 #逢甲 #台中"
].join("\n\n");

const SLOT2_2026_09_06_FACEBOOK = [
  "騎車族雨衣外套分開看，先看容易忽略的位置。",
  "厚一點的布收進櫃子，摸起來乾不代表乾透。中間那層最慢。",
  "我會先摸厚的地方確認乾透了沒。收進去之前那一步，決定下次拿出來的味道。",
  "收之前想先整理一次？傳 LINE跟我們說，台中市區到府收。",
  "你衣櫃裡放最久沒動的是什麼？",
  "衣櫃塞到關不起來的朋友，這篇傳給他。",
  "追蹤私享家，之後會持續整理衣物、寢具和收納前的洗護判斷。",
  "出處：門市當日看件",
  "直接點這裡問:https://sixiangjialaundry.com/go/line.html?source=post (或加 LINE:0968327653)",
  "#私享家洗衣店 #台中西屯洗衣店 #機車通勤 #外套清洗 #衣物送洗 #乾洗 #台中乾洗 #台中洗衣店 #西屯 #逢甲 #台中"
].join("\n\n");

const SLOT2_2026_09_06_INSTAGRAM = [
  "騎車族雨衣外套分開看，先看容易忽略的位置。",
  "厚一點的布收進櫃子，摸起來乾不代表乾透。中間那層最慢。",
  "我會先摸厚的地方確認乾透了沒。收進去之前那一步，決定下次拿出來的味道。",
  "收之前想先整理一次？私訊跟我們說，台中市區到府收。",
  "你衣櫃裡放最久沒動的是什麼？",
  "衣櫃塞到關不起來的朋友，這篇傳給他。",
  "追蹤私享家，之後會持續整理衣物、寢具和收納前的洗護判斷。",
  "出處：門市當日看件",
  "直接點這裡問:https://sixiangjialaundry.com/go/line.html?source=post (或加 LINE:0968327653)",
  "#私享家洗衣店 #台中西屯洗衣店 #機車通勤 #外套清洗 #衣物送洗 #乾洗 #台中乾洗 #台中洗衣店 #西屯 #逢甲 #台中"
].join("\n\n");

describe("slot 2 captions before 2026-09-08 stay frozen", () => {
  it("matches the pre-change 2026-09-05 facebook and instagram snapshots", () => {
    const content = buildDailyContent("2026-09-05", config);
    const slot2 = content.slots.find((slot) => slot.slot === 2)!;
    expect(slot2.facebook_caption).toBe(SLOT2_2026_09_05_FACEBOOK);
    expect(slot2.instagram_caption).toBe(SLOT2_2026_09_05_INSTAGRAM);
  });

  it("matches the pre-change 2026-09-06 facebook and instagram snapshots", () => {
    const content = buildDailyContent("2026-09-06", config);
    const slot2 = content.slots.find((slot) => slot.slot === 2)!;
    expect(slot2.facebook_caption).toBe(SLOT2_2026_09_06_FACEBOOK);
    expect(slot2.instagram_caption).toBe(SLOT2_2026_09_06_INSTAGRAM);
  });

  it("matches the pre-change 2026-09-07 facebook and instagram snapshots", () => {
    const content = buildDailyContent("2026-09-07", config);
    const slot2 = content.slots.find((slot) => slot.slot === 2)!;
    expect(slot2.facebook_caption).toBe(SLOT2_2026_09_07_FACEBOOK);
    expect(slot2.instagram_caption).toBe(SLOT2_2026_09_07_INSTAGRAM);
  });
});

const PHOTO_QUESTION = "你送洗前會先拍照嗎？";

function looksLikeGenericSlot2CtaWithoutQuestionKeep(block: string): boolean {
  if (
    block.startsWith("#") ||
    block.startsWith("出處：") ||
    block.startsWith("參考價") ||
    block.includes("/go/line.html") ||
    block.includes("0968327653")
  ) {
    return false;
  }
  if (block.startsWith("追蹤")) return false;
  if (/(?:這篇)?(?:傳|轉)給他/.test(block) && !/傳 LINE|拍一張|私訊|拍照|先幫你看/.test(block)) {
    return false;
  }
  return /傳 LINE|LINE 傳|私訊|拍照|拍一張|先幫你看/.test(block);
}

function looksLikeGenericSlot2CtaR2(block: string): boolean {
  if (isSlot2ClosingBlock(block)) return false;
  if (block.startsWith("追蹤")) return false;
  if (/[？?]\s*$/.test(block)) return false;
  if (/(?:這篇)?(?:傳|轉)給他/.test(block) && !/傳 LINE|拍一張|私訊|拍照|先幫你看/.test(block)) {
    return false;
  }
  return /傳 LINE|LINE 傳|私訊|拍照|拍一張|先幫你看/.test(block);
}

function slot2ActionCtaWithBareBao(topic: string): string {
  const text = topic.replace(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：/, "");
  if (/鞋|靴|麂皮/.test(text) && text.includes("包")) {
    return "拍鞋底和包角兩張傳 LINE，我們先看。";
  }
  const rows: Array<{ keys: readonly string[]; a: string; b: string }> = [
    { keys: ["衣櫃", "鞋櫃", "櫃"], a: "櫃內最深處", b: "最常放的那一格" },
    { keys: ["棉被", "被子", "床單", "床包", "枕頭", "床組"], a: "被角", b: "貼身那一面" },
    { keys: ["包包", "皮包", "背包", "名牌包", "包款", "包"], a: "包角", b: "內裡" },
    { keys: ["鞋", "靴", "麂皮"], a: "鞋面", b: "鞋底" },
    { keys: ["外套", "西裝", "大衣", "襯衫", "上衣", "T恤", "衣服", "衣物"], a: "領口", b: "袖口" },
    { keys: ["窗簾"], a: "下緣", b: "掛鉤處" },
    { keys: ["娃娃", "玩偶"], a: "五官", b: "縫線" },
    { keys: ["地毯"], a: "邊緣", b: "最常踩的位置" },
    { keys: ["行李箱"], a: "輪子", b: "把手" },
    { keys: ["毯"], a: "起球處", b: "邊緣" }
  ];
  for (const row of rows) {
    if (row.keys.some((key) => text.includes(key))) {
      return `拍${row.a}和${row.b}兩張傳 LINE，我們先看。`;
    }
  }
  return "拍整體和最在意的位置兩張傳 LINE，我們先看。";
}

function slot2ActionCtaWithBareYi(topic: string): string {
  const text = topic.replace(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：/, "");
  if ((/鞋|靴|麂皮/.test(text) && text.includes("包"))) {
    return "拍鞋底和包角兩張傳 LINE，我們先看。";
  }
  const rows: Array<{ keys: readonly string[]; a: string; b: string }> = [
    { keys: ["衣櫃", "鞋櫃", "櫃"], a: "櫃內最深處", b: "最常放的那一格" },
    { keys: ["棉被", "被子", "床單", "床包", "枕頭", "床組"], a: "被角", b: "貼身那一面" },
    { keys: ["包"], a: "包角", b: "內裡" },
    { keys: ["鞋", "靴", "麂皮"], a: "鞋面", b: "鞋底" },
    { keys: ["外套", "西裝", "大衣", "襯衫", "上衣", "T恤", "衣服", "衣物", "衣"], a: "領口", b: "袖口" },
    { keys: ["窗簾"], a: "下緣", b: "掛鉤處" },
    { keys: ["娃娃", "玩偶"], a: "五官", b: "縫線" },
    { keys: ["地毯"], a: "邊緣", b: "最常踩的位置" },
    { keys: ["行李箱"], a: "輪子", b: "把手" },
    { keys: ["毯"], a: "起球處", b: "邊緣" }
  ];
  for (const row of rows) {
    if (row.keys.some((key) => text.includes(key))) {
      return `拍${row.a}和${row.b}兩張傳 LINE，我們先看。`;
    }
  }
  return "拍整體和最在意的位置兩張傳 LINE，我們先看。";
}

describe("K-F1 keeps the photo engagement question", () => {
  const row = flattenGrowthPlaybook(buildGrowthPlaybook()).find(
    (item) => item.date === "2026-09-08" && item.slot === 2
  )!;
  const slot = dailySlotFromPlaybook(
    { ...row, format: "image-post", seo_sync_page: "/guides/photo-before-laundry.html" },
    config
  );
  const expected = slot2ActionCta(slot.topic);

  it("keeps 你送洗前會先拍照嗎？ and puts the action after it", () => {
    expect(looksLikeGenericSlot2Cta(PHOTO_QUESTION)).toBe(false);
    for (const caption of [slot.facebook_caption, slot.instagram_caption]) {
      const blocks = caption.split("\n\n");
      const questionIndex = blocks.indexOf(PHOTO_QUESTION);
      const actionIndex = blocks.indexOf(expected);
      expect(questionIndex).toBeGreaterThan(-1);
      expect(actionIndex).toBeGreaterThan(questionIndex);
      expect(chuanLineOutsideContact(caption)).toBe(1);
      expect(actionSentenceCount(caption)).toBe(1);
    }
  });

  it("mutation: dropping the ？-keep rule treats the photo question as a CTA", () => {
    expect(CONTENT_PLAN_SRC).toMatch(/\[？\?\]\\s\*\$/);
    expect(looksLikeGenericSlot2Cta(PHOTO_QUESTION)).toBe(false);
    expect(looksLikeGenericSlot2CtaWithoutQuestionKeep(PHOTO_QUESTION)).toBe(true);
    const blocks = slot.facebook_caption.split("\n\n");
    expect(blocks).toContain(PHOTO_QUESTION);
    expect(blocks.filter((block) => !looksLikeGenericSlot2CtaWithoutQuestionKeep(block))).not.toContain(
      PHOTO_QUESTION
    );
  });
});

describe("K-F2 does not let bare 衣 or 被 steal the object", () => {
  it("does not map 洗衣店 to collar/cuffs or 被染色 to quilt corners", () => {
    expect(slot2ActionCta("私享家洗衣店的三個位置")).toBe("拍整體和最在意的位置兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("領口被染色")).not.toContain("被角");
  });

  it("mutation: putting bare 衣 back maps 洗衣店 to collar/cuffs", () => {
    expect(SLOT2_PARTS_SRC).toMatch(/const SLOT2_ACTION_CTA_PARTS/);
    expect(SLOT2_PARTS_SRC).not.toMatch(/["']衣["']/);
    expect(SLOT2_PARTS_SRC).not.toMatch(/["']被["']/);
    expect(slot2ActionCta("私享家洗衣店的三個位置")).toBe("拍整體和最在意的位置兩張傳 LINE，我們先看。");
    expect(slot2ActionCtaWithBareYi("私享家洗衣店的三個位置")).toBe("拍領口和袖口兩張傳 LINE，我們先看。");
  });
});

describe("O-F2 full topic, not the 8-character head", () => {
  const cases = [
    {
      topic: "送洗前先問：暑假旅行回來先處理外套，門市會先確認什麼",
      sentence: "拍領口和袖口兩張傳 LINE，我們先看。"
    },
    {
      topic: "送洗前先問：雨後通勤回家不要直接收鞋，門市會先確認什麼",
      sentence: "拍鞋面和鞋底兩張傳 LINE，我們先看。"
    },
    {
      topic: "中秋前：烤肉煙味與連假衣物整理預告",
      sentence: "拍領口和袖口兩張傳 LINE，我們先看。"
    },
    {
      topic: "送洗前先問：婚宴禮服回家先不要塞衣櫃，門市會先確認什麼",
      sentence: "拍櫃內最深處和最常放的那一格兩張傳 LINE，我們先看。"
    },
    {
      topic: "送洗前先問：逢甲西屯人流多的鞋底灰，門市會先確認什麼",
      sentence: "拍鞋面和鞋底兩張傳 LINE，我們先看。"
    },
    {
      topic: "今天情境：雨後通勤回家不要直接收鞋",
      sentence: "拍鞋面和鞋底兩張傳 LINE，我們先看。"
    }
  ] as const;

  it("pins the six truncated-head topics to the object that was cut off", () => {
    for (const row of cases) {
      expect(slot2ActionCta(row.topic), row.topic).toBe(row.sentence);
    }
    expect(slot2ActionCta("送洗前先問：梅雨季衣櫃味道先找來源，門市會先確認什麼")).toBe(
      "拍櫃內最深處和最常放的那一格兩張傳 LINE，我們先看。"
    );
  });
});

describe("O-F5 mixed shoe and bag", () => {
  it("uses 鞋底 and 包角 when both objects are present, not the bag-first table order", () => {
    expect(slot2ActionCta("送洗前先問：七夕約會後白鞋包包檢查，門市會先確認什麼")).toBe(
      "拍鞋底和包角兩張傳 LINE，我們先看。"
    );
    expect(slot2ActionCta("送洗前先問：颱風天後鞋包不要急著曬，門市會先確認什麼")).toBe(
      "拍鞋底和包角兩張傳 LINE，我們先看。"
    );
    expect(slot2ActionCta("七夕約會後白鞋包包檢查")).not.toBe("拍包角和內裡兩張傳 LINE，我們先看。");
  });
});

describe("B 包 is an object, not 包裡, and mixed families take the first one", () => {
  const gymTopic = "送洗前先問：健身房衣物不要悶在包裡，門市會先確認什麼";
  const shoeInBagTopic = "送洗前先問：雨後通勤鞋不要悶在包裡，門市會先確認什麼";

  it("maps 包裡 gym clothes to collar/cuffs and 外套與包包 to the family that appears first", () => {
    expect(slot2ActionCta(gymTopic)).toBe("拍領口和袖口兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("餐聚後外套與包包的味道")).toBe("拍領口和袖口兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("包包與外套的味道")).toBe("拍包角和內裡兩張傳 LINE，我們先看。");
    expect(slot2ActionCta(shoeInBagTopic)).toBe("拍鞋面和鞋底兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("皮包提把發黑")).toBe("拍包角和內裡兩張傳 LINE，我們先看。");
  });

  it("keeps 鞋+包 as 鞋底/包角 even when a third family is in the topic", () => {
    expect(slot2ActionCta("國慶連假前：旅行鞋包與外套整理提醒")).toBe(
      "拍鞋底和包角兩張傳 LINE，我們先看。"
    );
  });

  it("mutation: dropping the 包 negative lookahead maps 10-03 to bag corners", () => {
    expect(CONTENT_PLAN_SRC).toMatch(/包\(\?!\[裡著住起好在進成覆裝\]\)/);
    expect(slot2ActionCta(gymTopic)).toBe("拍領口和袖口兩張傳 LINE，我們先看。");
    expect(slot2ActionCtaWithBareBao(gymTopic)).toBe("拍包角和內裡兩張傳 LINE，我們先看。");
    expect(slot2ActionCta(shoeInBagTopic)).toBe("拍鞋面和鞋底兩張傳 LINE，我們先看。");
    expect(slot2ActionCtaWithBareBao(shoeInBagTopic)).toBe("拍鞋底和包角兩張傳 LINE，我們先看。");
  });
});

describe("K-F4 template path after the playbook window", () => {
  const TEMPLATE_PHOTO_ASK = "搬家後要整理布品，可以拍寢具、窗簾下擺和洗標給我們看。";

  it("closes 2026-11-20 slot 2 with the same action sentence and drops the template photo ask", () => {
    const content = buildDailyContent("2026-11-20", config);
    const slot2 = content.slots.find((slot) => slot.slot === 2)!;
    expect(slot2.content_plan_source).toBe("legacy-template");
    const expected = slot2ActionCta(slot2.topic);
    expect(expected).toMatch(ACTION_SENTENCE_RE);
    expect(lastBodyParagraph(slot2.facebook_caption)).toBe(expected);
    expect(lastBodyParagraph(slot2.instagram_caption)).toBe(expected);
    expect(chuanLineOutsideContact(slot2.facebook_caption)).toBe(1);
    expect(actionSentenceCount(slot2.facebook_caption)).toBe(1);
    expect(photoInstructionBlocksOutsideContact(slot2.facebook_caption)).toEqual([expected]);
    expect(photoInstructionBlocksOutsideContact(slot2.instagram_caption)).toEqual([expected]);
    expect(slot2.facebook_caption).not.toContain(TEMPLATE_PHOTO_ASK);
    expect(looksLikeGenericSlot2Cta(TEMPLATE_PHOTO_ASK)).toBe(true);
  });

  it("mutation: r2 detector leaves the template photo ask in place", () => {
    expect(looksLikeGenericSlot2Cta(TEMPLATE_PHOTO_ASK)).toBe(true);
    expect(looksLikeGenericSlot2CtaR2(TEMPLATE_PHOTO_ASK)).toBe(false);
    const content = buildDailyContent("2026-11-20", config);
    const slot2 = content.slots.find((slot) => slot.slot === 2)!;
    const expected = slot2ActionCta(slot2.topic);
    const r2Blocks = slot2.facebook_caption
      .split("\n\n")
      .filter((block) => !looksLikeGenericSlot2CtaR2(block) || ACTION_SENTENCE_RE.test(block));
    // The live caption already dropped the ask. Re-inserting it after an r2
    // filter is what the template path did in r2: two 拍 instructions.
    const r2Caption = [TEMPLATE_PHOTO_ASK, ...r2Blocks.filter((block) => block !== TEMPLATE_PHOTO_ASK)].join(
      "\n\n"
    );
    expect(photoInstructionBlocksOutsideContact(slot2.facebook_caption)).toEqual([expected]);
    expect(photoInstructionBlocksOutsideContact(r2Caption).length).toBe(2);
  });
});

describe("K-F6/O-F4/K-F5 90-day slot-2 loop", () => {
  const actionCounts = new Map<string, number>();
  const eligibleCaptions: string[] = [];

  it("asserts one action, one 傳 LINE, and one 拍-ask on every eligible caption, and caps variants at half", () => {
    for (const date of utcDatesInclusive("2026-07-11", "2026-11-07")) {
      const content = buildDailyContent(date, config);
      const slot2 = content.slots.find((item) => item.slot === 2)!;
      const eligible = date >= "2026-09-08" && slot2.format !== "reel";
      for (const caption of [slot2.facebook_caption, slot2.instagram_caption]) {
        if (!eligible) {
          expect(actionSentenceCount(caption), `${date} ${slot2.format ?? "image-post"}`).toBe(0);
          continue;
        }
        eligibleCaptions.push(caption);
        const expected = slot2ActionCta(slot2.topic);
        expect(actionSentenceCount(caption), `${date} actions`).toBe(1);
        expect(chuanLineOutsideContact(caption), `${date} 傳 LINE`).toBe(1);
        expect(lastBodyParagraph(caption)).toBe(expected);
        expect(photoInstructionBlocksOutsideContact(caption), `${date} 拍-asks`).toEqual([expected]);
        for (const block of caption.split("\n\n")) {
          if (ACTION_SENTENCE_RE.test(block)) {
            actionCounts.set(block, (actionCounts.get(block) ?? 0) + 1);
          }
        }
      }
    }
    expect(eligibleCaptions.length).toBeGreaterThan(1);
    for (const [sentence, count] of actionCounts) {
      expect(count, sentence).toBeLessThanOrEqual(eligibleCaptions.length / 2);
    }
    const forcedSame = eligibleCaptions.length;
    expect(forcedSame, "all eligible captions forced onto one variant").toBeGreaterThan(
      eligibleCaptions.length / 2
    );
  });
});

describe("K-F8 dead branch and absorbed keys", () => {
  it("does not keep the unreachable last-paragraph /先看/ fallback", () => {
    const detector = CONTENT_PLAN_SRC.match(
      /export function looksLikeGenericSlot2Cta\([\s\S]*?\nfunction withSlot2ActionCta/
    )?.[0] ?? "";
    expect(detector).toContain("looksLikeGenericSlot2Cta");
    expect(detector).not.toMatch(/&&\s*\/先看\//);
    expect(looksLikeGenericSlot2Cta.length).toBe(1);
  });

  it("drops redundant shoe/blanket keys but keeps explicit bag objects", () => {
    expect(SLOT2_PARTS_SRC).toMatch(/["']包包["']/);
    expect(SLOT2_PARTS_SRC).toMatch(/["']皮包["']/);
    expect(SLOT2_PARTS_SRC).toMatch(/["']背包["']/);
    expect(SLOT2_PARTS_SRC).toMatch(/["']名牌包["']/);
    expect(SLOT2_PARTS_SRC).toMatch(/["']包款["']/);
    expect(SLOT2_PARTS_SRC).not.toMatch(/["']球鞋["']/);
    expect(SLOT2_PARTS_SRC).not.toMatch(/["']運動鞋["']/);
    expect(SLOT2_PARTS_SRC).not.toMatch(/["']白鞋["']/);
    expect(SLOT2_PARTS_SRC).not.toMatch(/["']皮鞋["']/);
    expect(SLOT2_PARTS_SRC).not.toMatch(/["']毛毯["']/);
    expect(slot2ActionCta("包包提把發黑")).toBe("拍包角和內裡兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("皮包提把發黑")).toBe("拍包角和內裡兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("白鞋泛黃")).toBe("拍鞋面和鞋底兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("沙發毯起球")).toBe("拍起球處和邊緣兩張傳 LINE，我們先看。");
    expect(slot2ActionCta("棉被收納前悶味")).toBe("拍被角和貼身那一面兩張傳 LINE，我們先看。");
  });
});
