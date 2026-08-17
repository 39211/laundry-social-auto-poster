import { describe, expect, it } from "vitest";
import { commentTextFor } from "../src/firstComment";

function hasUtmTrio(text: string, source: string, campaign: string): boolean {
  return (
    text.includes(`utm_source=${source}`) &&
    text.includes("utm_medium=social") &&
    text.includes(`utm_campaign=${campaign}`)
  );
}

describe("commentTextFor utm wiring", () => {
  it("輸出含 utm 三件組;拔注入 → 紅", () => {
    const date = "2026-08-17";
    const slot = 2;
    const campaign = `${date}-slot${slot}`;
    const text = commentTextFor("鞋子發黃該怎麼辦", date, slot);

    expect(hasUtmTrio(text, "instagram", campaign)).toBe(true);
    expect(text).toContain("source=ig-comment");

    const stripped = text.replace(/[?&]utm_[^=]+=[^&\s)]+/g, "");
    expect(hasUtmTrio(stripped, "instagram", campaign)).toBe(false);
    expect(stripped).toContain("source=ig-comment");
  });
});
