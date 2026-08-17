import { describe, expect, it } from "vitest";
import { captionsFor } from "../src/scheduleReel";
import type { ReelConcept } from "../src/reelConcepts";

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

describe("captionsFor utm wiring", () => {
  it("輸出含 utm 三件組;拔注入 → 紅", () => {
    const date = "2026-08-17";
    const campaign = `${date}-reel`;
    const captions = captionsFor(concept, 0, date);

    expect(hasUtmTrio(captions.instagram, "instagram", campaign)).toBe(true);
    expect(hasUtmTrio(captions.facebook, "facebook", campaign)).toBe(true);
    expect(captions.instagram).toContain("source=post");
    expect(captions.facebook).toContain("source=post");

    const stripped = captions.instagram.replace(/[?&]utm_[^=]+=[^&\s)]+/g, "");
    expect(hasUtmTrio(stripped, "instagram", campaign)).toBe(false);
    expect(stripped).toContain("source=post");
  });
});
