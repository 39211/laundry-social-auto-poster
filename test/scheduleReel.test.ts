import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { linePostRedirectUrl } from "../src/contentPlan";
import { loadDailyContent } from "../src/logging";
import { burnedNarrationFor, captionsFor, scheduleReel } from "../src/scheduleReel";
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
  const FOLLOW_LINE = "私享家洗衣店｜台中市區免費到府收送";
  const QUESTION_FOR_PLUSH = "家裡有沒有那種一直想洗、又不太敢洗的娃娃？";
  const QUESTION_FOR_DUVET = "你家的棉被大概多久整理一次？";
  const QUESTION_FOR_BAG = "哪一件是你最不敢自己動手處理的？";
  const SHARE_HANDBAG_HANDLE = "身邊有人的包提把也開始發黏嗎？這篇傳給他。";
  const SHARE_LEATHER_BAG_CORNER = "身邊有人的包正在磨邊角嗎？這篇傳給他。";
  const SHARE_INVITE_FALLBACK = "這篇可以轉給他。";
  const QUESTION_FALLBACK = "你最近最想先處理哪一件？";
  const SHOE_OBJECT_TYPES = new Set([
    "white-shoe",
    "leather-shoe",
    "canvas-shoe",
    "suede-shoe",
    "high-heel",
    "kids-shoe",
    "hiking-boot",
    "leather-boot"
  ]);
  const SHARE_INVITE_BY_OBJECT: Record<string, string> = {
    duvet: "家裡那位總說「棉被還可以再放一下」的人，這篇可以轉給他。",
    "plush-doll": "認識那種娃娃捨不得丟、又不敢洗的人嗎？傳給他。",
    "leather-bag": SHARE_LEATHER_BAG_CORNER,
    handbag: SHARE_LEATHER_BAG_CORNER,
    "white-shoe": "認識那種白鞋放到發黃還沒處理的人嗎？傳給他。",
    "leather-shoe": "身邊有人的皮鞋淋過雨還沒處理嗎？這篇傳給他。",
    "canvas-shoe": "身邊有人的帆布鞋泥乾了還放著嗎？這篇傳給他。",
    "suede-shoe": "身邊有人的麂皮鞋摸起來變硬了嗎？這篇傳給他。",
    "high-heel": "身邊有人的高跟鞋跟頭磨白了嗎？這篇傳給他。",
    "kids-shoe": "身邊有人的童鞋鞋頭已經磨花了嗎？這篇傳給他。",
    "hiking-boot": "身邊有人的登山鞋底還卡著乾泥嗎？這篇傳給他。",
    "leather-boot": "身邊有人的靴子放一季就發霉了嗎？這篇傳給他。",
    shirt: "家裡那位襯衫領口都黃了還在穿的人，這篇可以轉給他。",
    suit: "身邊有人的西裝肩線已經開始塌了嗎？這篇傳給他。",
    curtain: "家裡那位窗簾下緣積灰都沒拆過的人，這篇可以轉給他。",
    luggage: "身邊有人的行李箱輪子還卡著灰嗎？這篇傳給他。",
    backpack: "身邊有人的後背包底部從來沒洗過嗎？這篇傳給他。",
    "down-jacket": "身邊有人的羽絨外套袖口已經發黑了嗎？這篇傳給他。",
    "wool-coat": "家裡那位大衣肩線積了一層灰還繼續掛著的人，這篇可以轉給他。",
    "leather-belt": "身邊有人的皮帶摺痕已經發白裂了嗎？這篇傳給他。",
    "mattress-pad": "家裡那位保潔墊出現黃圈還繼續用的人，這篇可以轉給他。",
    blanket: "身邊有人的毛毯起球摸起來變粗了嗎？這篇傳給他。",
    denim: "身邊有人的牛仔褲膝蓋已經鬆掉了嗎？這篇傳給他。",
    wallet: "身邊有人的長夾邊角開始起毛了嗎？這篇傳給他。",
    sweater: "身邊有人的毛衣腋下出現黃斑了嗎？這篇傳給他。"
  };
  const QUESTION_BY_OBJECT: Record<string, string> = {
    duvet: QUESTION_FOR_DUVET,
    "plush-doll": QUESTION_FOR_PLUSH,
    handbag: QUESTION_FOR_BAG,
    "leather-bag": QUESTION_FOR_BAG,
    "white-shoe": "你那雙白鞋放多久沒穿了？",
    "leather-shoe": "你那雙皮鞋淋雨之後，有沒有再處理過？",
    "canvas-shoe": "你那雙帆布鞋的泥，是等乾了再清，還是濕的時候就刷？",
    "suede-shoe": "你那雙麂皮鞋摸起來變硬的時候，你會先怎麼處理？",
    "high-heel": "高跟鞋跟頭磨白之後，你是繼續穿還是先收起來？",
    "kids-shoe": "家裡那雙童鞋鞋頭磨花了，你會先洗還是直接換？",
    "hiking-boot": "登山鞋底卡了乾泥，你回來會先清嗎？",
    "leather-boot": "靴子在櫃子放一季，拿出來你會先看皮面嗎？",
    shirt: "你的襯衫比較常出問題的，是領口還是袖口？",
    suit: "你那件西裝，肩線還站得住嗎？",
    curtain: "家裡窗簾下緣那一折，你上次是什麼時候清的？",
    luggage: "旅行回來的行李箱，你會先清輪子再收嗎？",
    backpack: "你最常用的後背包，底部有多久沒看過了？",
    "down-jacket": "羽絨外套袖口發黑的時候，你會整件送還是只搓袖口？",
    "wool-coat": "大衣收進櫃子前，你會先拍掉肩線上的灰嗎？",
    "leather-belt": "皮帶那一格摺痕發白了，你還會繼續扣同一格嗎？",
    "mattress-pad": "保潔墊出現黃圈之後，你會跟被子一起送嗎？",
    blanket: "毛毯起球摸起來變粗的時候，你會先修還是繼續蓋？",
    denim: "牛仔褲膝蓋鬆掉以後，你還會繼續穿嗎？",
    wallet: "長夾邊角開始起毛的時候，你會先補還是再拖？",
    sweater: "毛衣腋下那塊黃，你是當季就洗，還是收到換季？"
  };

  function shareInviteExpected(entry: ReelConcept): string {
    if (entry.id === "handbag-handle") {
      return SHARE_HANDBAG_HANDLE;
    }
    const share = SHARE_INVITE_BY_OBJECT[entry.object_type];
    expect(share, `missing share invite for object_type ${entry.object_type}`).toBeDefined();
    return share!;
  }

  function questionForExpected(entry: ReelConcept): string {
    const question = QUESTION_BY_OBJECT[entry.object_type];
    expect(question, `missing question for object_type ${entry.object_type}`).toBeDefined();
    return question!;
  }

  function shareBlockOf(text: string): string | undefined {
    return text.split("\n\n").find((block) => /傳給他|轉給他/.test(block));
  }

  function ctaBlockOf(text: string): string | undefined {
    return text.split("\n\n").find((block) => CTA_BLOCK.test(block));
  }

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

  it("skips questionFor when any opening sentence contains ？", () => {
    // Intentional: a future concept whose first sentence is a statement and a
    // later opening sentence contains ？ also skips questionFor.
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

  it("keeps a share invite on every FB caption, first airing and rerun", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.length).toBe(26);
      for (const live of REEL_CONCEPTS) {
        for (const airedBefore of [0, 1] as const) {
          const caps = captionsFor(live, airedBefore, "2026-09-05");
          const shareBlock = shareBlockOf(caps.instagram);
          expect(
            shareBlock,
            `${live.id} aired=${airedBefore} IG missing share invite`
          ).toBeDefined();
          const fbBlocks = caps.facebook.split("\n\n");
          const fbShare = shareBlockOf(caps.facebook);
          const fbCta = ctaBlockOf(caps.facebook);
          expect(
            fbShare,
            `${live.id} aired=${airedBefore} FB missing share invite ${shareBlock}`
          ).toBeDefined();
          expect(fbShare).toBe(shareBlock);
          expect(fbCta, `${live.id} aired=${airedBefore} FB missing CTA`).toBeDefined();
          expect(
            fbBlocks.indexOf(fbShare!),
            `${live.id} aired=${airedBefore} FB share not immediately after CTA`
          ).toBe(fbBlocks.indexOf(fbCta!) + 1);
          expect(
            fbBlocks.indexOf(FOLLOW_LINE),
            `${live.id} aired=${airedBefore} FOLLOW_LINE not immediately after share`
          ).toBe(fbBlocks.indexOf(fbShare!) + 1);
        }
      }
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });

  it("gives handbag-handle a share invite distinct from leather-bag-corner", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.length).toBe(26);
      const handbag = REEL_CONCEPTS.find((entry) => entry.id === "handbag-handle");
      const leather = REEL_CONCEPTS.find((entry) => entry.id === "leather-bag-corner");
      expect(handbag).toBeDefined();
      expect(leather).toBeDefined();
      for (const live of REEL_CONCEPTS) {
        for (const airedBefore of [0, 1] as const) {
          const caps = captionsFor(live, airedBefore, "2026-09-05");
          const share = shareBlockOf(caps.instagram);
          const ctaIg = ctaBlockOf(caps.instagram);
          const ctaFb = ctaBlockOf(caps.facebook);
          expect(share, `${live.id} aired=${airedBefore} missing share`).toBeDefined();
          expect(ctaIg, `${live.id} aired=${airedBefore} IG missing CTA`).toBeDefined();
          expect(ctaFb, `${live.id} aired=${airedBefore} FB missing CTA`).toBeDefined();
          expect(shareBlockOf(caps.facebook)).toBe(share);
          if (live.id === "handbag-handle") {
            expect(share).toBe(SHARE_HANDBAG_HANDLE);
            expect(share).not.toContain("邊角");
            expect(ctaIg).toContain("先幫你看提把");
            expect(ctaFb).toContain("先幫你看提把");
            expect(ctaIg).not.toContain("邊角");
          }
          if (live.id === "leather-bag-corner") {
            expect(share).toBe(SHARE_LEATHER_BAG_CORNER);
            expect(ctaIg).toContain("先看邊角");
            expect(ctaFb).toContain("先看邊角");
            expect(ctaIg).not.toContain("先幫你看提把");
          }
        }
      }
      const handbagShare = shareBlockOf(captionsFor(handbag!, 0, "2026-09-05").facebook);
      const leatherShare = shareBlockOf(captionsFor(leather!, 0, "2026-09-05").facebook);
      expect(handbagShare).not.toBe(leatherShare);
      expect(handbagShare).not.toContain("邊角");
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });

  it("inserts questionFor after CTA when opening has no ？, and skips it on all live 26", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.length).toBe(26);
      for (const live of REEL_CONCEPTS) {
        const expectedQuestion = questionForExpected(live);
        for (const airedBefore of [0, 1] as const) {
          const caps = captionsFor(live, airedBefore, "2026-09-05");
          expect(
            caps.instagram,
            `${live.id} aired=${airedBefore} IG should skip questionFor`
          ).not.toContain(expectedQuestion);
          expect(
            caps.facebook,
            `${live.id} aired=${airedBefore} FB should skip questionFor`
          ).not.toContain(expectedQuestion);
        }
      }
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }

    const synthetic: ReelConcept = {
      id: "synthetic-statement-only",
      object_type: "duvet",
      hook: "棉被中間層還沒乾",
      close: "中間層沒乾就有味道，台中收送",
      narration: "表面乾了就能收進櫃子。中間那層不一定乾。帶著濕氣收，下一季打開就是那個味道。",
      before_subject: "a folded duvet with compressed loft",
      after_subject: "the same duvet with loft returned"
    };
    expect(synthetic.hook).not.toMatch(/[？?]/);
    expect(synthetic.narration).not.toMatch(/[？?]/);
    const expected = questionForExpected(synthetic);
    expect(expected).toBe(QUESTION_FOR_DUVET);

    for (const airedBefore of [0, 1] as const) {
      const caps = captionsFor(synthetic, airedBefore, "2026-09-05");
      for (const [platform, text] of [
        ["instagram", caps.instagram],
        ["facebook", caps.facebook]
      ] as const) {
        const blocks = text.split("\n\n");
        const cta = ctaBlockOf(text);
        expect(cta, `synthetic aired=${airedBefore} ${platform} missing CTA`).toBeDefined();
        expect(
          blocks,
          `synthetic aired=${airedBefore} ${platform} missing questionFor`
        ).toContain(expected);
        expect(
          blocks.indexOf(expected),
          `synthetic aired=${airedBefore} ${platform} questionFor not immediately after CTA`
        ).toBe(blocks.indexOf(cta!) + 1);
      }
    }
  });

  it("gives handbag-handle a handle CTA distinct from leather-bag-corner", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      const handbag = REEL_CONCEPTS.find((entry) => entry.id === "handbag-handle");
      const leather = REEL_CONCEPTS.find((entry) => entry.id === "leather-bag-corner");
      expect(handbag).toBeDefined();
      expect(leather).toBeDefined();
      const handbagCaps = captionsFor(handbag!, 0, "2026-09-05");
      const leatherCaps = captionsFor(leather!, 0, "2026-09-05");
      expect(handbagCaps.instagram).toContain("先幫你看提把");
      expect(handbagCaps.facebook).toContain("先幫你看提把");
      expect(handbagCaps.instagram).not.toContain("先看邊角");
      expect(leatherCaps.instagram).toContain("先看邊角");
      expect(leatherCaps.facebook).toContain("先看邊角");
      expect(leatherCaps.instagram).not.toContain("先幫你看提把");
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });

  it("share invite contains 鞋 only for shoe-family object_types", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.length).toBe(26);
      for (const live of REEL_CONCEPTS) {
        for (const airedBefore of [0, 1] as const) {
          const caps = captionsFor(live, airedBefore, "2026-09-05");
          for (const [platform, text] of [
            ["instagram", caps.instagram],
            ["facebook", caps.facebook]
          ] as const) {
            const share = shareBlockOf(text);
            expect(share, `${live.id} aired=${airedBefore} ${platform} missing share`).toBeDefined();
            if (SHOE_OBJECT_TYPES.has(live.object_type)) {
              continue;
            }
            expect(
              share,
              `${live.id} (${live.object_type}) aired=${airedBefore} ${platform} share mentions 鞋: ${share}`
            ).not.toContain("鞋");
          }
        }
      }
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });

  it("every object_type has its own share invite and question, never the generic default", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.length).toBe(26);
      const seenTypes = new Set<string>();
      for (const live of REEL_CONCEPTS) {
        seenTypes.add(live.object_type);
        expect(
          SHARE_INVITE_BY_OBJECT[live.object_type],
          `${live.id} object_type ${live.object_type} missing share map`
        ).toBeDefined();
        expect(
          QUESTION_BY_OBJECT[live.object_type],
          `${live.id} object_type ${live.object_type} missing question map`
        ).toBeDefined();
        const expectedShare = shareInviteExpected(live);
        const expectedQuestion = questionForExpected(live);
        expect(expectedShare).not.toBe(SHARE_INVITE_FALLBACK);
        expect(expectedQuestion).not.toBe(QUESTION_FALLBACK);
        expect(expectedShare, `${live.id} share starts with a claim word`).not.toMatch(/^(起|保證|一定)/);
        expect(expectedQuestion, `${live.id} question starts with a claim word`).not.toMatch(
          /^(起|保證|一定)/
        );

        for (const airedBefore of [0, 1] as const) {
          const caps = captionsFor(live, airedBefore, "2026-09-05");
          for (const [platform, text] of [
            ["instagram", caps.instagram],
            ["facebook", caps.facebook]
          ] as const) {
            expect(
              shareBlockOf(text),
              `${live.id} aired=${airedBefore} ${platform} share fell to default`
            ).toBe(expectedShare);
          }
        }

        const synthetic: ReelConcept = {
          ...live,
          hook: "這件先放著看材質",
          narration: "表面看起來還沒怎樣。裡面那層不一定。"
        };
        expect(synthetic.hook).not.toMatch(/[？?]/);
        expect(synthetic.narration).not.toMatch(/[？?]/);
        const syntheticCaps = captionsFor(synthetic, 0, "2026-09-05");
        for (const [platform, text] of [
          ["instagram", syntheticCaps.instagram],
          ["facebook", syntheticCaps.facebook]
        ] as const) {
          const blocks = text.split("\n\n");
          const cta = ctaBlockOf(text);
          expect(cta, `${live.object_type} ${platform} synthetic missing CTA`).toBeDefined();
          expect(
            blocks,
            `${live.object_type} ${platform} synthetic missing questionFor`
          ).toContain(expectedQuestion);
          expect(
            blocks.indexOf(expectedQuestion),
            `${live.object_type} ${platform} synthetic questionFor not immediately after CTA`
          ).toBe(blocks.indexOf(cta!) + 1);
          expect(text).not.toContain(QUESTION_FALLBACK);
        }
        expect(shareBlockOf(syntheticCaps.instagram)).toBe(expectedShare);
        expect(shareBlockOf(syntheticCaps.instagram)).not.toBe(SHARE_INVITE_FALLBACK);
      }
      expect([...seenTypes].sort()).toEqual(Object.keys(SHARE_INVITE_BY_OBJECT).sort());
      expect([...seenTypes].sort()).toEqual(Object.keys(QUESTION_BY_OBJECT).sort());
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BURNED_CAPTION_DATE = "2026-10-02";
const BURNED_CAPTION_CONCEPT = "plush-doll";
const BURNED_OLD_LEAD = "娃娃能洗,但洗法差很多。";
const BURNED_OLD_ASS = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  `Dialogue: 0,0:00:00.37,0:00:02.60,Narration,,0,0,0,,${BURNED_OLD_LEAD}`,
  "Dialogue: 0,0:00:02.60,0:00:04.46,Narration,,0,0,0,,怕的不是水,是脫水。"
].join("\n");

function officialReelsDir(): string | undefined {
  const candidates = [
    join(process.cwd(), "output", "reels-run", "2026-07-29", "reels"),
    join(process.cwd(), "..", "..", "..", "output", "reels-run", "2026-07-29", "reels")
  ];
  return candidates.find((dir) => existsSync(dir));
}

function burnedRegistryPath(): string {
  return join(process.cwd(), "data", "reel-burned-narrations.json");
}

function loadBurnedRegistryFile(): {
  narrations: Record<string, string>;
  generated_from: Record<string, { commit: string; source: string }>;
} {
  return JSON.parse(readFileSync(burnedRegistryPath(), "utf8").replace(/^\uFEFF/u, "")) as {
    narrations: Record<string, string>;
    generated_from: Record<string, { commit: string; source: string }>;
  };
}

function registryNarration(id: string): string {
  const text = loadBurnedRegistryFile().narrations[id];
  if (!text) throw new Error(`registry missing ${id}`);
  return text;
}

async function seedBurnedCaptionRoot(options: {
  ass?: string;
  conceptId?: string;
  date?: string;
}): Promise<string> {
  const conceptId = options.conceptId ?? BURNED_CAPTION_CONCEPT;
  const date = options.date ?? BURNED_CAPTION_DATE;
  const root = await mkdtemp(join(tmpdir(), "schedule-reel-burned-"));
  const reels = join(root, "output", "reels-run", "2026-07-29", "reels");
  const refs = join(root, "output", "reels-run", "2026-07-29", "references");
  await mkdir(reels, { recursive: true });
  await mkdir(refs, { recursive: true });
  await writeFile(join(reels, `${conceptId}.mp4`), Buffer.from("fake-reel-bytes"));
  await writeFile(
    join(reels, `${conceptId}.mp4.audio.json`),
    JSON.stringify({
      narration: true,
      generated_clip_audio_used: false,
      source: "post-ambient-bed"
    })
  );
  if (options.ass !== undefined) {
    await writeFile(join(reels, `${conceptId}.ass`), options.ass, "utf8");
  }
  await writeFile(
    join(refs, `${conceptId}-before.png`),
    Buffer.concat([PNG_MAGIC, Buffer.from("cover")])
  );

  const slots = [1, 2].map((slot) => ({
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: slot === 1 ? "知識文" : "情境文",
    topic: slot === 1 ? "白鞋鞋帶發灰" : "帆布包提把發黑",
    format: "image-post",
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "prompt",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${date}/slot-0${slot}.png`,
    public_image_url: "",
    status: "pending"
  }));
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    `${JSON.stringify(
      {
        date,
        timezone: "Asia/Taipei",
        generated_at: `${date}T00:00:00.000Z`,
        slots
      },
      null,
      2
    )}\n`
  );
  await mkdir(join(root, "docs", "assets", date), { recursive: true });
  return root;
}

describe("burned narration captions (SXJ-REELQ r7)", () => {
  it("uses burned .ass narration as caption lead and records narration_source burned", async () => {
    const live = REEL_CONCEPTS.find((entry) => entry.id === BURNED_CAPTION_CONCEPT);
    expect(live).toBeDefined();
    const conceptLead = splitNarrationSentences(live!.narration)[0] ?? "";
    expect(conceptLead.endsWith("？")).toBe(true);
    expect(conceptLead).not.toBe(BURNED_OLD_LEAD);

    const root = await seedBurnedCaptionRoot({ ass: BURNED_OLD_ASS });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      await scheduleReel({
        date: BURNED_CAPTION_DATE,
        conceptId: BURNED_CAPTION_CONCEPT,
        slot: 2,
        root
      });
    } finally {
      spy.mockRestore();
    }

    const slot = (await loadDailyContent(BURNED_CAPTION_DATE, root))?.slots.find((item) => item.slot === 2) as
      | { instagram_caption: string; facebook_caption: string; narration_source?: string; narration_first_sentence?: string }
      | undefined;
    expect(slot).toBeDefined();
    expect(slot!.instagram_caption.startsWith(BURNED_OLD_LEAD)).toBe(true);
    expect(slot!.facebook_caption.startsWith(BURNED_OLD_LEAD)).toBe(true);
    expect(slot!.instagram_caption.startsWith(conceptLead)).toBe(false);
    expect(slot!.narration_source).toBe("burned");
    expect(slot!.narration_first_sentence).toBe(BURNED_OLD_LEAD);
    expect(logs.some((line) => line.includes("narration_source: burned"))).toBe(true);
    expect(logs.some((line) => line.includes(`narration_first_sentence: ${BURNED_OLD_LEAD}`))).toBe(true);
  });

  it("falls back to the registry narration when the reel has no .ass", async () => {
    const live = REEL_CONCEPTS.find((entry) => entry.id === BURNED_CAPTION_CONCEPT);
    expect(live).toBeDefined();
    const conceptLead = splitNarrationSentences(live!.narration)[0] ?? "";
    expect(conceptLead.endsWith("？")).toBe(true);
    const registryText = registryNarration(BURNED_CAPTION_CONCEPT);
    const registryLead = splitNarrationSentences(registryText)[0] ?? registryText;
    expect(registryLead).toBe(BURNED_OLD_LEAD);
    expect(registryLead).not.toBe(conceptLead);

    const root = await seedBurnedCaptionRoot({});
    await scheduleReel({
      date: BURNED_CAPTION_DATE,
      conceptId: BURNED_CAPTION_CONCEPT,
      slot: 2,
      root
    });

    const reel = join(root, "output", "reels-run", "2026-07-29", "reels", `${BURNED_CAPTION_CONCEPT}.mp4`);
    expect(burnedNarrationFor(reel)).toBe(registryText);

    const slot = (await loadDailyContent(BURNED_CAPTION_DATE, root))?.slots.find((item) => item.slot === 2) as
      | { instagram_caption: string; narration_source?: string; narration_first_sentence?: string }
      | undefined;
    expect(slot).toBeDefined();
    expect(slot!.instagram_caption.startsWith(registryLead)).toBe(true);
    expect(slot!.instagram_caption.startsWith(conceptLead)).toBe(false);
    expect(slot!.narration_source).toBe("registry");
    expect(slot!.narration_first_sentence).toBe(registryLead);
  });

  it("restores Dialogue text after stripping override tags and \\N, in time order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burned-ass-parse-"));
    const reel = join(dir, "clip.mp4");
    await writeFile(reel, Buffer.from("x"));
    await writeFile(
      join(dir, "clip.ass"),
      [
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:02.00,0:00:03.50,Narration,,0,0,0,,{\\i1}第二卡{\\i0}",
        "Dialogue: 0,0:00:00.50,0:00:02.00,Narration,,0,0,0,,{\\b1}舊句{\\b0}陳述\\N旁白。"
      ].join("\n"),
      "utf8"
    );
    expect(burnedNarrationFor(reel)).toBe("舊句陳述旁白。第二卡");
  });

  it("reads a string narration field from .audio.json when no .ass exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burned-audio-json-"));
    const reel = join(dir, "clip.mp4");
    await writeFile(reel, Buffer.from("x"));
    await writeFile(
      `${reel}.audio.json`,
      JSON.stringify({ narration: "音檔旁白全文。第二句。", source: "post-ambient-bed" }),
      "utf8"
    );
    expect(burnedNarrationFor(reel)).toBe("音檔旁白全文。第二句。");
  });

  it("ignores boolean narration flags on .audio.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burned-audio-flag-"));
    const reel = join(dir, "clip.mp4");
    await writeFile(reel, Buffer.from("x"));
    await writeFile(
      `${reel}.audio.json`,
      JSON.stringify({ narration: true, source: "post-ambient-bed" }),
      "utf8"
    );
    expect(burnedNarrationFor(reel)).toBeUndefined();
  });

  const officialDir = officialReelsDir();
  const officialIt = officialDir ? it : it.skip;

  officialIt("reads official run .ass for all 26 concepts via burnedNarrationFor", () => {
    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.length).toBe(26);
      expect(officialDir).toBeDefined();
      const rows: string[] = [];
      for (const concept of REEL_CONCEPTS) {
        const reel = join(officialDir!, `${concept.id}.mp4`);
        const burned = burnedNarrationFor(reel);
        const burnedLead = burned ? splitNarrationSentences(burned)[0] ?? burned : "";
        const conceptLead = splitNarrationSentences(concept.narration)[0] ?? concept.narration;
        const match = burned ? burnedLead === conceptLead : "no-ass";
        rows.push(`${concept.id}\t${burnedLead || "(none)"}\t${conceptLead}\t${match}`);
        if (existsSync(join(officialDir!, `${concept.id}.ass`)) || existsSync(`${reel}.ass`)) {
          expect(burned, `${concept.id} has .ass but burnedNarrationFor returned empty`).toBeTruthy();
        }
      }
      // Printed so the NOTES table is the same run as this assertion, not a second parse.
      console.log(`OFFICIAL_ASS_TABLE\n${rows.join("\n")}`);
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });
});

const DOWN_JACKET_DATE = "2026-09-08";
const DOWN_JACKET_CONCEPT = "down-jacket-cuff";
const DOWN_JACKET_REGISTRY_LEAD = "那是手腕的油脂日積月累壓進纖維裡,不是表面的髒。";

describe("burned narration registry (SXJ-REELQ r8)", () => {
  it("registry has 26 non-empty narrations, matching official .ass when that run dir exists", () => {
    expect(existsSync(burnedRegistryPath()), "data/reel-burned-narrations.json missing").toBe(true);
    const registry = loadBurnedRegistryFile();
    const ids = Object.keys(registry.narrations);
    expect(ids).toHaveLength(26);
    expect(Object.keys(registry.generated_from)).toHaveLength(26);
    for (const id of ids) {
      expect(registry.narrations[id]?.trim(), `${id} empty`).toBeTruthy();
      expect(registry.generated_from[id]?.commit, `${id} missing commit`).toMatch(/^[0-9a-f]{40}$/);
      expect(["ass", "git"]).toContain(registry.generated_from[id]?.source);
    }

    const officialDir = officialReelsDir();
    if (!officialDir) {
      console.log(
        "SKIP Q4 registry-vs-ass: official run dir not found (cwd/output/reels-run/2026-07-29/reels or ../../../output/reels-run/2026-07-29/reels)"
      );
      return;
    }
    for (const id of ids) {
      const reel = join(officialDir, `${id}.mp4`);
      const hasAss = existsSync(join(officialDir, `${id}.ass`)) || existsSync(`${reel}.ass`);
      if (!hasAss) continue;
      expect(burnedNarrationFor(reel), `${id} .ass parse`).toBe(registry.narrations[id]);
    }
  });

  it("burnedNarrationFor returns registry text and scheduleReel records narration_source registry", async () => {
    const registryText = registryNarration(DOWN_JACKET_CONCEPT);
    const registryLead = splitNarrationSentences(registryText)[0] ?? registryText;
    expect(registryLead).toBe(DOWN_JACKET_REGISTRY_LEAD);

    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      const live = REEL_CONCEPTS.find((entry) => entry.id === DOWN_JACKET_CONCEPT);
      expect(live).toBeDefined();
      const conceptLead = splitNarrationSentences(live!.narration)[0] ?? "";
      expect(conceptLead).not.toBe(registryLead);

      const root = await seedBurnedCaptionRoot({
        conceptId: DOWN_JACKET_CONCEPT,
        date: DOWN_JACKET_DATE
      });
      const reel = join(root, "output", "reels-run", "2026-07-29", "reels", `${DOWN_JACKET_CONCEPT}.mp4`);
      expect(burnedNarrationFor(reel)).toBe(registryText);

      await scheduleReel({
        date: DOWN_JACKET_DATE,
        conceptId: DOWN_JACKET_CONCEPT,
        slot: 2,
        root
      });
      const slot = (await loadDailyContent(DOWN_JACKET_DATE, root))?.slots.find((item) => item.slot === 2) as
        | { instagram_caption: string; narration_source?: string; narration_first_sentence?: string }
        | undefined;
      expect(slot).toBeDefined();
      expect(slot!.narration_source).toBe("registry");
      expect(slot!.narration_first_sentence).toBe(registryLead);
      expect(slot!.instagram_caption.startsWith(registryLead)).toBe(true);
      expect(slot!.instagram_caption.startsWith(conceptLead)).toBe(false);
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });

  it("09-08 down-jacket-cuff rerun caption lead is the registry old sentence", async () => {
    const registryText = registryNarration(DOWN_JACKET_CONCEPT);
    const registryLead = splitNarrationSentences(registryText)[0] ?? registryText;
    expect(registryLead).toBe(DOWN_JACKET_REGISTRY_LEAD);

    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    try {
      expect(REEL_CONCEPTS.some((entry) => entry.id === DOWN_JACKET_CONCEPT)).toBe(true);
      const root = await seedBurnedCaptionRoot({
        conceptId: DOWN_JACKET_CONCEPT,
        date: DOWN_JACKET_DATE
      });
      await scheduleReel({
        date: DOWN_JACKET_DATE,
        conceptId: DOWN_JACKET_CONCEPT,
        slot: 2,
        root
      });
      const slot = (await loadDailyContent(DOWN_JACKET_DATE, root))?.slots.find((item) => item.slot === 2) as
        | { instagram_caption: string; narration_source?: string }
        | undefined;
      expect(slot).toBeDefined();
      expect(slot!.narration_source).toBe("registry");
      expect(slot!.instagram_caption.startsWith(DOWN_JACKET_REGISTRY_LEAD)).toBe(true);
    } finally {
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });

  it("mutation: hiding the registry file drops no-ass ids back to the live concept", async () => {
    const registryText = registryNarration(DOWN_JACKET_CONCEPT);
    const registryLead = splitNarrationSentences(registryText)[0] ?? registryText;
    expect(registryLead).toBe(DOWN_JACKET_REGISTRY_LEAD);

    const baselineConcepts = REEL_CONCEPTS.length;
    const baselineSchedule = REEL_SCHEDULE.length;
    loadExtensions();
    const live = REEL_CONCEPTS.find((entry) => entry.id === DOWN_JACKET_CONCEPT);
    expect(live).toBeDefined();
    const conceptLead = splitNarrationSentences(live!.narration)[0] ?? "";
    expect(conceptLead.endsWith("？")).toBe(true);
    expect(conceptLead).not.toBe(registryLead);

    const empty = await mkdtemp(join(tmpdir(), "no-burned-registry-"));
    const previousRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = empty;
    try {
      const root = await seedBurnedCaptionRoot({
        conceptId: DOWN_JACKET_CONCEPT,
        date: DOWN_JACKET_DATE
      });
      const reel = join(root, "output", "reels-run", "2026-07-29", "reels", `${DOWN_JACKET_CONCEPT}.mp4`);
      expect(burnedNarrationFor(reel)).toBeUndefined();

      await scheduleReel({
        date: DOWN_JACKET_DATE,
        conceptId: DOWN_JACKET_CONCEPT,
        slot: 2,
        root
      });
      const slot = (await loadDailyContent(DOWN_JACKET_DATE, root))?.slots.find((item) => item.slot === 2) as
        | { instagram_caption: string; narration_source?: string; narration_first_sentence?: string }
        | undefined;
      expect(slot).toBeDefined();
      expect(slot!.narration_source).toBe("concept");
      expect(slot!.narration_first_sentence).toBe(conceptLead);
      expect(slot!.instagram_caption.startsWith(DOWN_JACKET_REGISTRY_LEAD)).toBe(false);
      expect(slot!.instagram_caption.startsWith(conceptLead)).toBe(true);
    } finally {
      if (previousRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = previousRoot;
      REEL_CONCEPTS.length = baselineConcepts;
      REEL_SCHEDULE.length = baselineSchedule;
    }
  });
});
