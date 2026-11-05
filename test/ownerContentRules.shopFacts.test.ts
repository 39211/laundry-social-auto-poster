import { describe, expect, it } from "vitest";
import { checkSlotAgainstOwnerRules } from "../src/ownerContentRules";

const turnaround = (text: string) =>
  checkSlotAgainstOwnerRules({ slot: 1, media_type: "image", facebook_caption: text }).filter(
    (violation) => violation.rule === "turnaround"
  );

describe("turnaround rule on the shop's own facts (H3)", () => {
  it("the owner's full turnaround list in one sentence is not a violation", () => {
    expect(
      turnaround("交期：一般衣物 5-7 天、鞋 7 天、難乾的大件 10-14 天、皮件包 14 天。台中市免費到府收送，一件也收。")
    ).toEqual([]);
  });

  it("the same list with 'about' wording and an en dash is not a violation", () => {
    expect(turnaround("一般衣物約 5–7 天、鞋子約 7 天、難乾的大件約 10–14 天、皮件包約 14 天。")).toEqual([]);
  });

  it("each item alone is still fine", () => {
    expect(turnaround("鞋子 7 天。")).toEqual([]);
    expect(turnaround("皮件包 14 天。")).toEqual([]);
    expect(turnaround("一般衣物 5-7 天。")).toEqual([]);
  });

  it("an invented span next to a true one still blocks", () => {
    const hits = turnaround("交期：鞋 7 天、一般衣物 3 天。");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.severity === "block")).toBe(true);
  });

  it("a wrong span for one item inside the full list still blocks", () => {
    const hits = turnaround("交期：一般衣物 5-7 天、鞋 3 天、難乾的大件 10-14 天、皮件包 14 天。");
    expect(hits.some((hit) => hit.severity === "block")).toBe(true);
  });

  it("a mixed-item claim with one span still blocks", () => {
    const hits = turnaround("棉被、鞋子大約 7 天可以拿回。");
    expect(hits.some((hit) => hit.severity === "block")).toBe(true);
  });
});
