import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REEL_CONCEPTS } from "../src/reelConcepts";
import { REEL_MOTION_PROMPT } from "../src/scheduleReel";

const produceSrc = readFileSync(join(__dirname, "..", "scripts", "produce-next-reel.ps1"), "utf8");
const scheduleSrc = readFileSync(join(__dirname, "..", "src", "scheduleReel.ts"), "utf8");

const RETIRED_GENERIC_PHRASES = [
  "visibly greyed and yellowed",
  "surface wear",
  "visibly grimy",
  "fur flattened and dulled grey",
  "cover slightly limp and dull",
  "edge coating worn and abraded",
  "collar band and inner collar edge yellowed",
  "shoulder line collapsed and lapel edge creased",
  "dust ingrained along the fold",
  "wheels and lower panel visibly grimy",
  "ground grime across the bottom panel",
  "dried mud worked into the woven fabric",
  "handle darkened and slightly glossy where it is gripped",
  "faint dried rain marks across both vamps"
];

const REQUIRED_EVENT_TOKENS: Record<string, string[]> = {
  "white-shoe-yellowing": ["foxing", "amber", "abrasion"],
  "handbag-handle": ["honey", "rivet", "edge-paint"],
  "leather-shoe-rain": ["tide-line", "vamp", "salt"],
  "plush-doll": ["mat", "neck seam", "catchlight"],
  "duvet-storage": ["loft", "quilting", "fold"],
  "leather-bag-corner": ["arris", "scuff", "rub ring"],
  "shirt-collar": ["sebum", "collar band", "cuff-fold"],
  "suit-shoulder": ["pad ridge", "lapel", "shine"],
  "curtain-hem": ["hem fold", "dust", "sun-fade"],
  "luggage-wheel": ["wheel", "grit", "lower panel"],
  "backpack-base": ["base", "crust", "salt"],
  "canvas-shoe-mud": ["mud", "foxing", "woven"]
};

describe("director doctrine phase 1: REEL_MOTION_PROMPT", () => {
  it("keeps duration and aspect out of the calendar stamp prose", () => {
    expect(REEL_MOTION_PROMPT).not.toMatch(/Duration:\s*5 seconds/i);
    expect(REEL_MOTION_PROMPT).not.toMatch(/Aspect ratio:\s*9:16/i);
    expect(REEL_MOTION_PROMPT).not.toMatch(/Resolution:\s*720p/i);
    expect(scheduleSrc).not.toMatch(/Duration: 5 seconds\. Aspect ratio: 9:16\. Resolution: 720p\./);
  });

  it("keeps only the core bans, not a shared hand/morphing tail", () => {
    expect(REEL_MOTION_PROMPT).toMatch(/Do not clean/i);
    expect(REEL_MOTION_PROMPT).toMatch(/Do not add or remove anything/i);
    expect(REEL_MOTION_PROMPT).toMatch(/Do not add people/i);
    expect(REEL_MOTION_PROMPT).toMatch(/readable text/i);
    expect(REEL_MOTION_PROMPT).not.toMatch(/No hands in close-up/i);
    expect(REEL_MOTION_PROMPT).not.toMatch(/No morphing, warping, flicker/i);
  });

  it("does not pin the retired 664c8ddd stamp hash as the current prompt", () => {
    const current = createHash("sha256").update(REEL_MOTION_PROMPT).digest("hex");
    expect(current).toMatch(/^[a-f0-9]{64}$/);
    expect(current).not.toBe("664c8dddfdf51455b53a295b519d39b9176e33bfcb9831802e18adfdc4f85c36");
  });
});

describe("director doctrine phase 1: still subjects are specific events", () => {
  it("retires the generic wear phrases on every built-in concept", () => {
    for (const concept of REEL_CONCEPTS) {
      const blob = `${concept.before_subject} ${concept.after_subject}`;
      for (const phrase of RETIRED_GENERIC_PHRASES) {
        expect(blob, `${concept.id} still uses retired generic "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it("names a concrete wear event per object type, not one sample rewrite", () => {
    expect(Object.keys(REQUIRED_EVENT_TOKENS).sort()).toEqual(
      REEL_CONCEPTS.map((concept) => concept.id).sort()
    );
    for (const concept of REEL_CONCEPTS) {
      const tokens = REQUIRED_EVENT_TOKENS[concept.id] ?? [];
      for (const token of tokens) {
        expect(
          concept.before_subject.toLowerCase(),
          `${concept.id} before_subject missing event token "${token}"`
        ).toContain(token.toLowerCase());
      }
      expect(concept.before_subject.length).toBeGreaterThan(80);
    }
  });
});

describe("director doctrine phase 1: produce-next-reel act bans and physics", () => {
  it("splits bans per act instead of one shared tail", () => {
    expect(produceSrc).toContain("function Get-ActBans");
    expect(produceSrc).toMatch(/Get-ActBans \$state/);
    expect(produceSrc).not.toContain(
      "Keep every object in its original position and its original condition. Do not clean, repair, alter or transform the object beyond what the supplied image already shows."
    );
    expect(produceSrc).not.toMatch(/\$template\.prompt = "No music, no on-screen text/);

    const beforeCase = produceSrc.slice(
      produceSrc.indexOf('"before" {', produceSrc.indexOf("function Get-ActBans"))
    );
    const beforeBody = beforeCase.slice(0, beforeCase.indexOf('"middle"'));
    expect(beforeBody).toMatch(/Do not clean/i);
    expect(beforeBody).not.toMatch(/finger|Hands stay|extra hand/i);

    const middleCase = produceSrc.slice(produceSrc.indexOf('"middle" {', produceSrc.indexOf("function Get-ActBans")));
    const middleBody = middleCase.slice(0, middleCase.indexOf('"after"'));
    expect(middleBody).toMatch(/Hands stay anatomically correct/i);
    expect(middleBody).toMatch(/tool/i);
  });

  it("writes object-specific core physics instead of generic weight and shadow", () => {
    expect(produceSrc).toContain("function Get-CorePhysics");
    expect(produceSrc).toMatch(/Get-CorePhysics \$objectType/);
    expect(produceSrc).not.toContain(
      "The object has weight and a continuous contact shadow that stays attached to it"
    );
    for (const objectType of [
      "white-shoe",
      "handbag",
      "leather-shoe",
      "plush-doll",
      "duvet",
      "leather-bag",
      "shirt",
      "suit",
      "curtain",
      "luggage",
      "backpack",
      "canvas-shoe"
    ]) {
      expect(produceSrc, `missing Get-CorePhysics case for ${objectType}`).toContain(`"${objectType}"`);
    }
    expect(produceSrc).toMatch(/wet edge creeps along the amber line/);
    expect(produceSrc).toMatch(/rain tide-line millimetre by millimetre/);
    expect(produceSrc).toMatch(/yellow sebum ring wets darker/);
  });

  it("still does not put duration or aspect into the clip prompt prose", () => {
    const promptAssign = produceSrc.slice(produceSrc.indexOf("$template.prompt ="));
    const promptBlock = promptAssign.slice(0, 1800);
    expect(promptBlock).not.toMatch(/Duration:\s*5 seconds/);
    expect(promptBlock).not.toMatch(/Aspect ratio:\s*9:16/);
    expect(promptBlock).toContain("[Overall look]");
    expect(promptBlock).toContain("[Material]");
    expect(promptBlock).toContain("[Light]");
    expect(promptBlock).toContain("[Core physics]");
  });
});
