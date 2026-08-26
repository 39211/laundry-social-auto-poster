import { describe, expect, it } from "vitest";
import {
  BATCH_ONE,
  BATCH_TWO,
  REEL_CONCEPTS,
  REEL_SCHEDULE,
  conceptStatuses,
  materialOpticsFor,
  promptFor,
  publishDateFor,
  stillPathsFor
} from "../src/reelConcepts";

describe("reel concepts", () => {
  it("covers six distinct object types so no two Reels look alike", () => {
    const types = REEL_CONCEPTS.map((concept) => concept.object_type);
    expect(new Set(types).size).toBe(REEL_CONCEPTS.length);
  });

  it("rules out the vocabulary of a business this is not", () => {
    // The first batch produced laundry baskets and a domestic sofa. This shop
    // collects and delivers; a customer never handles a basket here.
    for (const concept of REEL_CONCEPTS) {
      for (const state of ["before", "after"] as const) {
        const prompt = promptFor(concept, state);
        expect(prompt).toMatch(/No laundry basket/);
        expect(prompt).toMatch(/no washing machine/);
        expect(prompt).toMatch(/no domestic living room/);
        expect(prompt).toMatch(/inspection counter/);
      }
    }
  });

  it("keeps every still on the same look so a regenerated one still cuts in", () => {
    // The subject differs per still; everything after it must not, or a single
    // regenerated image will not match the pair it drops back into.
    const looks = REEL_CONCEPTS.flatMap((concept) =>
      (["before", "after"] as const).map((state) => {
        const prompt = promptFor(concept, state);
        return prompt.slice(prompt.indexOf("Shot on a phone"));
      })
    );
    expect(looks).toHaveLength(REEL_CONCEPTS.length * 2);
    expect(new Set(looks).size).toBe(1);
  });

  it("tells the image model how light behaves on this concept's own material", () => {
    // "光澤不夠真實" was the owner's rejection on 2026-08-27: the shell named
    // the room and the wear but never the material's optics, so canvas, wool
    // and rubber all came back with the same plastic sheen.
    for (const concept of REEL_CONCEPTS) {
      const optics = materialOpticsFor(concept.object_type);
      for (const state of ["before", "after"] as const) {
        expect(promptFor(concept, state)).toContain(optics);
      }
    }
  });

  it("gives different materials different optics, not one shared sentence", () => {
    // Without this, a single generic block would satisfy the test above while
    // leaving every still looking alike again.
    const blocks = REEL_CONCEPTS.map((concept) => materialOpticsFor(concept.object_type));
    expect(new Set(blocks).size).toBe(REEL_CONCEPTS.length);
  });

  it("leaves no placeholder token in a prompt that ships to the image model", () => {
    for (const concept of REEL_CONCEPTS) {
      for (const state of ["before", "after"] as const) {
        const prompt = promptFor(concept, state);
        expect(prompt).not.toContain("[SUBJECT]");
        expect(prompt).not.toContain("[OPTICS]");
      }
    }
  });

  it("gives each concept its own still paths so one can be regenerated alone", () => {
    const paths = REEL_CONCEPTS.flatMap((concept) => Object.values(stillPathsFor(concept)));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("carries a hook, a close and narration for every concept", () => {
    for (const concept of REEL_CONCEPTS) {
      expect(concept.hook.length).toBeGreaterThan(6);
      expect(concept.close.length).toBeGreaterThan(6);
      expect(concept.narration.length).toBeGreaterThan(20);
    }
  });

  it("never has the narration restate the hook", () => {
    // The hook is burned in as a subtitle for the first 2.6 seconds and the
    // narration starts at 0.5s, so a narration that opens with the hook makes
    // the viewer read and hear one sentence at once. Eight of the twelve did.
    for (const concept of REEL_CONCEPTS) {
      const hookBody = concept.hook.replace(/[，。？、]/g, "");
      const narrationBody = concept.narration.replace(/[，。？、]/g, "");
      for (let length = 5; length <= hookBody.length; length += 1) {
        const piece = hookBody.slice(0, length);
        expect(
          narrationBody.includes(piece),
          `${concept.id}: narration repeats the hook's "${piece}"`
        ).toBe(false);
      }
    }
  });

  it("fills the reel with narration without overrunning it", () => {
    // Two failures to avoid, and the old cap only guarded one of them.
    //
    // Overrun: the line is still being spoken when the video ends. The voice
    // runs near 0.25s a character and the TTS call now asks for +10%, so the
    // budget is (reel - start) / (0.25 / 1.10).
    //
    // Underrun: measured silence detection on the shipped reels found every one
    // of them going quiet from around 7s to the end, and a句-gap at 3.4-4.4s --
    // which is exactly where median watch time (4.2s) sits. A 36-character cap
    // on a 14.2s reel guaranteed that hole. The floor is what closes it.
    const REEL_SECONDS = 14.2;
    const NARRATION_STARTS_AT = 0.5;
    const SECONDS_PER_CHAR = 0.25 / 1.1;
    const ceiling = Math.floor((REEL_SECONDS - NARRATION_STARTS_AT) / SECONDS_PER_CHAR);
    const floor = Math.floor(ceiling * 0.75);
    for (const concept of REEL_CONCEPTS) {
      expect(concept.narration.length, `${concept.id} narration overruns the reel`).toBeLessThanOrEqual(ceiling);
      expect(concept.narration.length, `${concept.id} narration leaves the reel silent`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("schedules every concept exactly once, with no gap in the days still ahead", () => {
    expect(REEL_SCHEDULE).toHaveLength(REEL_CONCEPTS.length);
    expect(new Set(REEL_SCHEDULE.map((entry) => entry.conceptId)).size).toBe(REEL_CONCEPTS.length);
    for (const concept of REEL_CONCEPTS) {
      expect(publishDateFor(concept.id)).toBeDefined();
    }

    // History is allowed to contain losses — 07-30/31 and 08-04/05 were lost
    // to calendar clobbers and a disabled publish task, and their Reels moved
    // to the end — but the stretch still ahead must stay one Reel a day with
    // no repeats and no gaps. Advance this boundary when history grows.
    const dates = REEL_SCHEDULE.map((entry) => Date.parse(entry.date)).filter(
      (time) => time >= Date.parse("2026-08-06")
    );
    for (let index = 1; index < dates.length; index += 1) {
      expect(dates[index]! - dates[index - 1]!).toBe(86_400_000);
    }
  });

  it("orders production by deadline, not by the order concepts were written", async () => {
    // Publishing deliberately alternates object types, so the schedule order is
    // not the list order. Producing in list order would build the concept that
    // is needed last, and one failed day would then land on a publishing date.
    const statuses = await conceptStatuses();
    const produced = statuses.map((status) => status.publish_date);
    expect(produced).toEqual([...produced].sort());
    expect(statuses[0]?.id).toBe(REEL_SCHEDULE[0]?.conceptId);
  });

  it("gives no two consecutive publishing days the same object type", () => {
    const types = REEL_SCHEDULE.map(
      (entry) => REEL_CONCEPTS.find((concept) => concept.id === entry.conceptId)?.object_type
    );
    for (let index = 1; index < types.length; index += 1) {
      expect(types[index]).not.toBe(types[index - 1]);
    }
  });
});

// W-STORYSTRUCTURE: hook is an unexplained inspection action, narration delays
// the reveal, close loops back. Built-ins only — extensions are a different
// authoring path and must not inherit these tokens by accident.
const BUILTIN_IDS = [...BATCH_ONE, ...BATCH_TWO];

const STORY_STRUCTURE: Record<
  string,
  {
    retiredHook: string;
    action: RegExp;
    loop: string;
    delayedReveal: string;
    price?: string;
    cta: RegExp;
  }
> = {
  "white-shoe-yellowing": {
    retiredHook: "白鞋泛黃，不是刷得不夠用力",
    action: /先看/,
    loop: "膠",
    delayedReveal: "氧化",
    price: "運動鞋兩百五起",
    cta: /拍|能不能救|台中收送/
  },
  "handbag-handle": {
    retiredHook: "包包最先變舊的地方，是提把",
    action: /先摸/,
    loop: "提把",
    delayedReveal: "手汗",
    price: "一般包六百起",
    cta: /私訊/
  },
  "leather-shoe-rain": {
    retiredHook: "皮鞋淋雨，擦乾就沒事了嗎",
    action: /先看/,
    loop: "水痕",
    delayedReveal: "浮出來",
    price: "皮鞋四百起",
    cta: /拍/
  },
  "plush-doll": {
    retiredHook: "娃娃不是不能洗，是不能亂洗",
    action: /先看/,
    loop: "五官",
    delayedReveal: "脫水",
    cta: /私訊|拍來報價/
  },
  "duvet-storage": {
    retiredHook: "棉被收進櫃子前，先聞一下",
    action: /先聞/,
    loop: "中間",
    delayedReveal: "味道",
    price: "雙人棉被五百",
    cta: /台中收送|免費到府/
  },
  "leather-bag-corner": {
    retiredHook: "精品包最怕的不是髒，是邊角",
    action: /先看/,
    loop: "邊油",
    delayedReveal: "補不回來",
    price: "名牌包一千五起",
    cta: /拍四個角/
  },
  "shirt-collar": {
    retiredHook: "襯衫領口發黃，洗衣精加倍沒有用",
    action: /先看/,
    loop: "領口",
    delayedReveal: "皮脂",
    price: "襯衫七十",
    cta: /私訊/
  },
  "suit-shoulder": {
    retiredHook: "西裝變形，通常從肩線開始",
    action: /先看/,
    loop: "肩",
    delayedReveal: "回不來",
    cta: /台中收送|拍肩線/
  },
  "curtain-hem": {
    retiredHook: "窗簾最髒的地方，你可能沒看過",
    action: /先摸/,
    loop: "下緣",
    delayedReveal: "灰塵",
    cta: /不用自己拆|我們收/
  },
  "luggage-wheel": {
    retiredHook: "行李箱收進櫃子前，先看輪子",
    action: /先看/,
    loop: "輪",
    delayedReveal: "味道",
    cta: /私訊|免費到府/
  },
  "backpack-base": {
    retiredHook: "後背包底部，是全包最髒的一面",
    action: /先看/,
    loop: "底部",
    delayedReveal: "汗鹽",
    price: "背包五百",
    cta: /私訊/
  },
  "canvas-shoe-mud": {
    retiredHook: "帆布鞋沾泥，越用力刷越糟",
    action: /先看/,
    loop: "泥",
    delayedReveal: "織紋",
    price: "帆布鞋兩百五起",
    cta: /拍/
  }
};

function builtinConcepts() {
  return REEL_CONCEPTS.filter((concept) => BUILTIN_IDS.includes(concept.id));
}

describe("reel concept story structure (loop + delayed reveal)", () => {
  it("covers all twelve built-in concepts, not a sample rewrite", () => {
    expect(Object.keys(STORY_STRUCTURE).sort()).toEqual([...BUILTIN_IDS].sort());
    expect(builtinConcepts()).toHaveLength(12);
  });

  it("makes every hook an unexplained inspection action, not the retired generic line", () => {
    for (const concept of builtinConcepts()) {
      const spec = STORY_STRUCTURE[concept.id]!;
      expect(concept.hook, `${concept.id} reverted to retired generic hook`).not.toBe(spec.retiredHook);
      expect(concept.hook, `${concept.id} hook is not an inspection action`).toMatch(spec.action);
      expect(concept.hook, `${concept.id} hook missing loop token "${spec.loop}"`).toContain(spec.loop);
      expect(concept.hook, `${concept.id} hook still names the problem generically`).not.toMatch(
        /最髒|不是髒|變舊/
      );
    }
  });

  it("closes the loop: close echoes the hook token and keeps the CTA fact", () => {
    for (const concept of builtinConcepts()) {
      const spec = STORY_STRUCTURE[concept.id]!;
      expect(concept.close, `${concept.id} close missing loop token "${spec.loop}"`).toContain(spec.loop);
      const spoken = `${concept.close}${concept.narration}`;
      expect(spoken, `${concept.id} dropped the CTA fact`).toMatch(spec.cta);
      if (spec.price) {
        expect(spoken, `${concept.id} dropped price "${spec.price}"`).toContain(spec.price);
      }
    }
  });

  it("delays the reveal: first narration sentence withholds the diagnostic token", () => {
    // Mutation: paste the old white-shoe or leather-bag hook/narration back and
    // the first sentence contains 氧化 / 補不回來 again — this goes red.
    for (const concept of builtinConcepts()) {
      const spec = STORY_STRUCTURE[concept.id]!;
      const end = concept.narration.indexOf("。");
      expect(end, `${concept.id} narration is a single dump`).toBeGreaterThan(0);
      const first = concept.narration.slice(0, end + 1);
      const rest = concept.narration.slice(end + 1);
      expect(first, `${concept.id} answers in the first sentence`).not.toContain(spec.delayedReveal);
      expect(rest, `${concept.id} never reveals "${spec.delayedReveal}"`).toContain(spec.delayedReveal);
    }
  });
});
