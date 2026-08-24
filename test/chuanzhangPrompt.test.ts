import { describe, expect, it } from "vitest";
import { buildChuanzhangMotionPrompt, CHUANZHANG_RAW_SECONDS } from "../src/chuanzhangPrompt";
import { buildGrowthPlaybook } from "../src/growthPlaybook";

// The owner accepted two videos generated with exactly this structure on
// 2026-08-25 (slot-1 sneakers, slot-2 gown) after rejecting the old
// single-paragraph English prompts as 太AI. These tests pin the accepted
// shape so the generator cannot quietly drift back.

const SAMPLE = buildChuanzhangMotionPrompt({
  objectZh: "鞋子",
  family: "shoe",
  scene: "inspection-counter",
  firstFrameZh: "固定直式微距中近景；完整鞋子位於乾淨檢查台前景，無文字。",
  actionZh: "同一隻成人手只把右腳鞋旋轉約三十度，讓鞋口朝向鏡頭；左腳鞋全程不動。",
  endStateZh: "露出的細節正對鏡頭,"
});

describe("buildChuanzhangMotionPrompt structure", () => {
  it("opens with the fixed no-BGM line before everything else", () => {
    expect(SAMPLE.startsWith("不要出现BGM，不要出现字幕")).toBe(true);
  });

  it("carries the four control blocks in doctrine order, before the shots", () => {
    const order = ["【全局画质】", "【物件材質】", "【灯光与风格】", "【核心物理】", "@image1", "【镜头1", "【镜头2"];
    const positions = order.map((mark) => SAMPLE.indexOf(mark));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("declares exactly two internally timed shots with the shot-count warning", () => {
    expect(SAMPLE).toContain("严格只有2个镜头");
    expect(SAMPLE).toContain("【镜头1｜0.0-3.0秒】");
    expect(SAMPLE).toContain("【镜头2｜3.0-10.0秒】");
    expect(SAMPLE).not.toContain("【镜头3");
  });

  it("keeps the one-dominant-action contract and the physics/text warnings the quality gate checks", () => {
    expect(SAMPLE).toContain("one dominant action only");
    expect(SAMPLE).toContain("五指健全");
    expect(SAMPLE).toContain("物件恆定");
    expect(SAMPLE).toContain("無重複物件");
    expect(SAMPLE).toContain("穿模或變形");
    expect(SAMPLE).toContain("不得出現任何文字、標誌或浮水印");
  });

  it("bans the retired fixed tails: no in-text duration, ratio or legacy opener", () => {
    expect(SAMPLE).not.toContain("Create one continuous");
    expect(SAMPLE).not.toMatch(/Duration:\s*\d/);
    expect(SAMPLE).not.toContain("Aspect ratio:");
    expect(SAMPLE).not.toContain("9:16。");
  });
});

describe("generic companion candidates emit doctrine prompts at the 10s floor", () => {
  it("a post-floor playbook day uses the chuanzhang format for both slot families", () => {
    const playbook = buildGrowthPlaybook();
    const lateDays = playbook.days.filter((day) => day.date >= "2026-08-26");
    expect(lateDays.length).toBeGreaterThan(0);
    let checked = 0;
    for (const day of lateDays.slice(0, 4)) {
      for (const slot of day.slots) {
        const candidate = slot.video_candidate;
        if (!candidate) continue;
        checked += 1;
        expect(candidate.duration_seconds).toBe(CHUANZHANG_RAW_SECONDS);
        expect(candidate.grok_motion_prompt.startsWith("不要出现BGM")).toBe(true);
        expect(candidate.grok_motion_prompt).toContain("【核心物理】");
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
