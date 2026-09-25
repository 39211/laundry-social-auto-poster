import { describe, expect, it } from "vitest";
import { rateForSpeed, ttsInputText, voiceFor } from "../src/tts";

describe("narration voice (Taiwanese Mandarin, 2026-09-26)", () => {
  it("speaks 曉臻 on every date and slot", () => {
    for (const [date, slot] of [["2026-09-29", 2], ["2026-09-30", 3], ["2026-10-05", 1]] as const) {
      expect(voiceFor(date, slot).voiceId).toBe("zh-TW-HsiaoChenNeural");
    }
  });

  it("feeds the synthesiser a homophone for the heteronyms it reads the mainland way", () => {
    expect(ttsInputText("再劃圓刷帆布跟提把,一層一層薄薄上")).toBe("再劃圓刷凡布跟提把,一層一層博博上");
    // untouched text comes back unchanged, so subtitles built from it stay honest
    expect(ttsInputText("夾層用小刷子刷")).toBe("夾層用小刷子刷");
  });

  it("turns the pipeline's speed multiplier into an edge-tts rate", () => {
    expect(rateForSpeed(1.1)).toBe("+10%");
    expect(rateForSpeed(1)).toBe("+0%");
    expect(rateForSpeed(0.95)).toBe("-5%");
  });
});
