import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTISAN, REEL_CONCEPTS, promptFor } from "../src/reelConcepts";

// On 2026-08-15 the craftsman was added to two prompt constants and shipped
// with a commit message saying he appeared in two of the three acts. He
// appeared in none of them: the production script gets its before/after
// prompts through `reel-concepts --prompts`, which calls promptFor, and
// promptFor read neither constant. The constants were dead code, the reel came
// out with no person in it, and nothing failed — the script exited 0 and the
// video played.
//
// So these test the wiring, not the wording. A constant nobody calls is worth
// exactly nothing, and that is not visible by reading the constant.

const anyConcept = REEL_CONCEPTS[0]!;

describe("the craftsman reaches the prompts production actually uses", () => {
  it("is in the after prompt, which is where the judgement is delivered", () => {
    const after = promptFor(anyConcept, "after");

    expect(after).toContain(ARTISAN);
  });

  it("is not in the before prompt, which is the customer's problem", () => {
    const before = promptFor(anyConcept, "before");

    expect(before).not.toContain(ARTISAN);
  });

  it("keeps the after act an edit of the before, so the object cannot change", () => {
    const after = promptFor(anyConcept, "after");

    // Continuity comes from editing rather than regenerating. Losing this is
    // how a fourteen-second reel ends up showing two different jackets.
    expect(after).toContain("Edit the supplied BEFORE image");
    expect(after).toContain(anyConcept.after_subject);
  });

  it("puts the craftsman in every concept's after prompt, not just one", () => {
    const missing = REEL_CONCEPTS.filter((c) => !promptFor(c, "after").includes(ARTISAN));

    expect(missing.map((c) => c.id)).toEqual([]);
  });

  // The middle act's prompts live inline in the production PowerShell, which
  // promptFor never touches -- which is exactly where the first "he's in two
  // acts" claim died, twice: once as dead constants, once when only the
  // fallback prompt was fixed and the primary edit prompt kept "one adult
  // hand". A wiring test that reads the script is the only thing that sees it.
  it("names the craftsman in both middle prompts of the production script", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "produce-next-reel.ps1"), "utf8");

    const anchors = script.match(/craftsman's hands/g) ?? [];
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    expect(script).not.toMatch(/Add one adult hand/i);
  });
});
