import { describe, expect, it } from "vitest";
import {
  getVideoItemProfile,
  inferVideoItemCategory,
  profileForVideoTopic,
  withVideoItemProfilePrompt
} from "../src/videoItemProfiles";

describe("diversified video item profiles", () => {
  it.each([
    ["襯衫腋下汗漬", "clothing"],
    ["白鞋鞋舌與鞋墊邊", "shoes"],
    ["化妝包拉鍊邊", "bags"],
    ["棉被收納前的濕氣", "bedding"],
    ["皮衣袖口摺痕", "leather"],
    ["襯衫、皮鞋、外套整理提醒", "mixed"],
    ["絨毛娃娃填充物檢查", "mixed"]
  ] as const)("infers %s as %s", (topic, category) => {
    expect(inferVideoItemCategory(topic)).toBe(category);
  });

  it("keeps each category's action and claim guardrails explicit", () => {
    for (const category of ["clothing", "shoes", "bags", "bedding", "leather", "mixed"] as const) {
      const profile = getVideoItemProfile(category);
      expect(profile.prompt_directive.length).toBeGreaterThan(20);
      expect(profile.safe_action.length).toBeGreaterThan(10);
      expect(profile.forbidden_claims.length).toBeGreaterThan(0);
      expect(["saves", "shares", "inquiries"]).toContain(profile.primary_metric);
    }
  });

  it("does not duplicate the profile directive on repeated manifest builds", () => {
    const first = withVideoItemProfilePrompt("one dominant action only", "皮衣袖口");
    const second = withVideoItemProfilePrompt(first, "皮衣袖口");
    expect(second).toBe(first);
    expect(second.match(/Item profile 2026-08-05-v1:/g)).toHaveLength(1);
    expect(profileForVideoTopic("皮衣袖口").category).toBe("leather");
  });
});
