import { describe, expect, it } from "vitest";
import { contradictorySubject } from "../src/contentPlan";

// The cross-check used to know exactly one thing: shoe topics versus five
// canonical shoe phrases. Change a duvet topic while its prompt still asked for
// sneakers and every witness agreed — ERROR-BOOK A1/A7 stayed open for every
// non-shoe family, which both review seats called out (grok D3, luna D1).
//
// Two constraints are load-bearing and each gets its own guard here:
// contradiction-only (a prompt naming the right family in its own words must
// pass, or every Reel cover blocks), and compound-word topic matching (bare 被
// is the passive marker, bare 衣 lives inside 洗衣店).

describe("family-level contradictions", () => {
  it("blocks a duvet caption over a prompt that asks for sneakers", () => {
    const clash = contradictorySubject(
      "可收藏：棉被收納前的濕氣與睡眠味，送洗前先看三個位置",
      "photorealistic phone photo of off-white canvas low-top sneakers on a pink cutting mat"
    );

    expect(clash).toBeTruthy();
    expect(clash!.expected).toBe("寢具類");
    expect(clash!.found.toLowerCase()).toContain("sneaker");
  });

  it("blocks a down-jacket caption over a duvet prompt, resolving the 羽絨 ambiguity", () => {
    const clash = contradictorySubject(
      "羽絨外套袖口發黑，送洗前先看這裡",
      "a folded warm-white cotton duvet with navy piping on the inspection counter"
    );

    expect(clash).toBeTruthy();
    expect(clash!.expected).toBe("衣物類");
  });

  it("blocks a luggage caption over a handbag prompt", () => {
    const clash = contradictorySubject(
      "行李箱收進櫃子前，先看輪子",
      "a brown leather handbag resting on a pale grey surface"
    );

    expect(clash).toBeTruthy();
    expect(clash!.expected).toBe("行李箱");
  });

  it("does not read the passive 被 as bedding", () => {
    // The first version of this test used a shoe topic (帆布鞋鞋口被遮住) and
    // could not discriminate: 鞋類 sits earlier in the family table, so it
    // claimed the topic before bedding was ever consulted, and a bare-被
    // bedding pattern passed the test anyway. The shape that actually trips
    // the trap is a topic whose only family word comes AFTER bedding in the
    // table -- 制服被染色 matches bare 被 first, reads as bedding, and a
    // uniform prompt then looks like a cross-family contradiction.
    const clash = contradictorySubject(
      "制服被染色了怎麼辦，送洗前先看這裡",
      "a white school uniform shirt with a pink dye stain on the counter"
    );

    expect(clash).toBeUndefined();
  });

  it("passes a prompt that names the right family in its own words", () => {
    // Reel covers describe their subject freely; demanding canonical phrasing
    // would block every one of them.
    const clash = contradictorySubject(
      "可收藏：棉被收納前的濕氣與睡眠味",
      "one corner of a folded white quilted duvet lying on a plain pale surface"
    );

    expect(clash).toBeUndefined();
  });

  it("does not let the quilted adjective vouch for bedding", () => {
    // "quilted" describes down jackets as readily as duvets. A bedding caption
    // over a prompt that only says "quilted jacket" names the wrong family.
    const clash = contradictorySubject(
      "棉被收納前的三個檢查",
      "a navy quilted jacket sleeve resting on the counter"
    );

    expect(clash).toBeTruthy();
    expect(clash!.expected).toBe("寢具類");
    expect(clash!.found.toLowerCase()).toContain("jacket");
  });

  it("stays silent when the prompt names no family at all", () => {
    const clash = contradictorySubject(
      "棉被收納前的三個檢查",
      "a softly lit close-up of fabric texture on a work surface"
    );

    expect(clash).toBeUndefined();
  });

  it("keeps the fine-grained shoe check the family layer cannot see", () => {
    // 白鞋 caption over a canvas prompt: both are shoes, so only the canonical
    // layer catches it — the 2026-08-14 accident.
    const clash = contradictorySubject(
      "白鞋鞋邊泛灰前的檢查",
      "photo of off-white canvas low-top sneakers on a mat"
    );

    expect(clash).toBeTruthy();
    expect(clash!.found).toContain("canvas");
  });
});
