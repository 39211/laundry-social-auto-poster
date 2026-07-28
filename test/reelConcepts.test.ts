import { describe, expect, it } from "vitest";
import { REEL_CONCEPTS, promptFor, stillPathsFor } from "../src/reelConcepts";

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
    expect(looks).toHaveLength(12);
    expect(new Set(looks).size).toBe(1);
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
});
