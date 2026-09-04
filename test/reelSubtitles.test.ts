import { describe, expect, it } from "vitest";
import {
  ORPHAN_CHARS,
  SUB_MAX_CHARS,
  buildAss,
  narrationAss,
  splitNarration,
  timeSegments,
} from "../src/reelSubtitles";
import { REEL_CONCEPTS, loadExtensions } from "../src/reelConcepts";

// The VideoForge-Pro trial (2026-08-16) found the defects these tests pin:
// a scratch splitter dropped one clause and duplicated another on this exact
// narration, their timing divided the duration evenly regardless of line
// length, and their PlayRes was landscape 1920x1080 on our portrait reels.
const DOWN_JACKET_NARRATION =
  "那是手腕的油脂日積月累壓進纖維裡，不是表面的髒。整件下水才會勻，只搓袖口反而會留下一圈更深的印子。";

describe("splitNarration", () => {
  it("is lossless on every real concept narration", () => {
    loadExtensions();
    expect(REEL_CONCEPTS.length).toBeGreaterThanOrEqual(24);
    for (const concept of REEL_CONCEPTS) {
      const segments = splitNarration(concept.narration);
      // Design: join back to the whitespace-normalized source, not raw input.
      const normalized = concept.narration.replace(/\s+/gu, " ").trim();
      expect(segments.join(""), concept.id).toBe(normalized);
      expect(segments.length, concept.id).toBeGreaterThanOrEqual(2);
      for (const segment of segments) {
        expect(segment.length, concept.id).toBeLessThanOrEqual(SUB_MAX_CHARS + ORPHAN_CHARS);
      }
    }
  });

  it("neither drops nor duplicates clauses on the narration that broke the scratch splitter", () => {
    const segments = splitNarration(DOWN_JACKET_NARRATION);
    expect(segments).toEqual([
      "那是手腕的油脂日積月累壓進纖維",
      "裡，不是表面的髒。",
      "整件下水才會勻，",
      "只搓袖口反而會留下一圈更深的印子。",
    ]);
    // The scratch version emitted the same clause twice; a healthy split of
    // this text has no repeats.
    expect(new Set(segments).size).toBe(segments.length);
  });

  it("merges a 1-2 character tail into the previous line instead of flashing it", () => {
    // 17 characters with the only break at the very end: a naive split leaves
    // a two-character cue on screen for a fraction of a second.
    const segments = splitNarration("一二三四五六七八九十甲乙丙丁戊子。");
    expect(segments).toEqual(["一二三四五六七八九十甲乙丙丁戊子。"]);
  });

  it("returns no segments for empty narration", () => {
    expect(splitNarration("")).toEqual([]);
    expect(splitNarration("   ")).toEqual([]);
  });

  it("joins back to the whitespace-normalized source, not the raw input", () => {
    const raw = "甲  乙\n丙";
    const segments = splitNarration(raw);
    expect(segments.join("")).toBe("甲 乙 丙");
    expect(segments.join("")).not.toBe(raw);
  });

  it("forces a new card after ？ so the answer is not packed onto the question", () => {
    // 能洗嗎？(4) + 能洗，(3) = 7 ≤ SUB_MAX_CHARS, so the old packer merged them.
    const segments = splitNarration("能洗嗎？能洗，");
    expect(segments[0]).toBe("能洗嗎？");
    expect(segments.join("")).toBe("能洗嗎？能洗，");
    for (const segment of segments) {
      if (segment.includes("？") || segment.includes("?")) {
        expect(segment.endsWith("？") || segment.endsWith("?"), segment).toBe(true);
      }
    }
  });

  it("ends every live card that contains ？ with ？", () => {
    loadExtensions();
    expect(REEL_CONCEPTS.length).toBeGreaterThanOrEqual(24);
    for (const concept of REEL_CONCEPTS) {
      const segments = splitNarration(concept.narration);
      expect(segments.join(""), concept.id).toBe(concept.narration.replace(/\s+/gu, " ").trim());
      for (const segment of segments) {
        if (segment.includes("？") || segment.includes("?")) {
          expect(
            segment.endsWith("？") || segment.endsWith("?"),
            `${concept.id} question card does not end with ？: ${segment}`
          ).toBe(true);
        }
      }
    }
  });
});

describe("timeSegments", () => {
  const long = "四".repeat(20);
  const short = "五".repeat(5);

  it("allocates seconds by character share, not evenly per segment", () => {
    const cues = timeSegments([long, short], { delaySeconds: 0.5, audioSeconds: 10 });
    // 20 of 25 characters -> 8 of 10 seconds. An even split would say 5.
    expect(cues[0]!.end - cues[0]!.start).toBeCloseTo(8, 5);
    expect(cues[1]!.end - cues[1]!.start).toBeCloseTo(2, 5);
  });

  it("starts at the narration delay and ends exactly when the audio ends", () => {
    const cues = timeSegments([long, short], { delaySeconds: 0.5, audioSeconds: 10 });
    expect(cues[0]!.start).toBeCloseTo(0.5, 5);
    expect(cues[cues.length - 1]!.end).toBeCloseTo(10.5, 5);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]!.start).toBeCloseTo(cues[i - 1]!.end, 5);
    }
  });

  it("scales the whole timeline onto a shorter video instead of dropping tail cues", () => {
    const scaled = timeSegments([long, short], {
      delaySeconds: 0.5,
      audioSeconds: 10,
      videoSeconds: 8,
    });
    expect(scaled).toHaveLength(2);
    expect(scaled.map((cue) => cue.text).join("")).toBe(long + short);
    expect(scaled[0]!.start).toBeCloseTo(0.5 * (8 / 10.5), 5);
    expect(scaled[1]!.start).toBeCloseTo(scaled[0]!.end, 5);
    expect(scaled[1]!.end).toBeCloseTo(8, 5);
    // Character share is preserved after the scale (20/25 of the compressed span).
    expect(scaled[0]!.end - scaled[0]!.start).toBeCloseTo(8 * (8 / 10.5), 5);
  });

  it("leaves timing alone when the video is long enough for every cue", () => {
    const cues = timeSegments([long, short], {
      delaySeconds: 0.5,
      audioSeconds: 10,
      videoSeconds: 14,
    });
    expect(cues).toHaveLength(2);
    expect(cues[0]!.start).toBeCloseTo(0.5, 5);
    expect(cues[1]!.end).toBeCloseTo(10.5, 5);
  });

  it("refuses a non-positive audio duration", () => {
    expect(() => timeSegments(["一"], { delaySeconds: 0, audioSeconds: 0 })).toThrow();
  });
});

describe("buildAss", () => {
  it("targets the portrait reel frame, not VideoForge's landscape default", () => {
    const ass = buildAss([{ text: "測試", start: 0.5, end: 3.2 }]);
    expect(ass).toContain("PlayResX: 720");
    expect(ass).toContain("PlayResY: 1280");
    expect(ass).not.toContain("1920");
    // Bottom-centre boxed style, clear of the drawtext hook at the top.
    expect(ass).toMatch(/Style: Narration,Microsoft JhengHei,40,.*,3,6,0,2,20,20,84,1/);
  });

  it("formats timestamps as H:MM:SS.cc including the rounding carry", () => {
    const ass = buildAss([
      { text: "一", start: 0.5, end: 3.204 },
      { text: "二", start: 3.999, end: 65.5 },
    ]);
    expect(ass).toContain("Dialogue: 0,0:00:00.50,0:00:03.20,Narration");
    expect(ass).toContain("Dialogue: 0,0:00:04.00,0:01:05.50,Narration");
  });

  it("rounds half-centisecond boundaries through integer centiseconds", () => {
    const ass = buildAss([{ text: "邊", start: 1.005, end: 59.995 }]);
    expect(ass).toContain("Dialogue: 0,0:00:01.01,0:01:00.00,Narration");
  });

  it("neutralizes braces so text cannot open a libass override block", () => {
    const ass = buildAss([{ text: "a{b}c", start: 0, end: 1 }]);
    expect(ass).toContain("a（b）c");
    expect(ass).not.toContain("{b}");
  });
});

describe("narrationAss", () => {
  it("produces the full cue chain for the real down-jacket narration and TTS duration", () => {
    const { ass, cues } = narrationAss({
      narration: DOWN_JACKET_NARRATION,
      delaySeconds: 0.5,
      audioSeconds: 9.312,
      videoSeconds: 14.0,
    });
    expect(cues).toHaveLength(4);
    expect(cues[0]!.start).toBeCloseTo(0.5, 5);
    expect(cues[3]!.end).toBeCloseTo(9.812, 3);
    expect((ass.match(/^Dialogue:/gmu) ?? []).length).toBe(4);
  });
});
