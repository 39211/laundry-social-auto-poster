import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { validatePublishableReel } from "../src/generateVideo";
import { handleCarousel, runCarouselLiveCli } from "../src/visualQaCli";
import { visualQaAcceptedReviewer } from "../src/videoReviewGate";
import {
  assertCarouselJudgePromptSafe,
  assertJudgePromptSafe,
  buildCarouselJudgePrompt,
  buildIsolationPlan,
  buildJudgePrompt,
  CAROUSEL_QA_AXES,
  carouselJudgeAttemptLimit,
  carouselJudgePromptForAttempt,
  collectCarouselJudgeStdout,
  detectCarouselRubricIncoherence,
  detectTreatment,
  evaluateCarouselFromDisk,
  evaluateCarouselJudgeStdout,
  hashText,
  runCarouselJudgeLive,
  shouldRetryCarouselJudge,
  evaluateFromDisk,
  evaluateJudgeStdout,
  hitsStoryFailAxis,
  isConceptRejected,
  loadRejectedConcepts,
  parseCanaryReports,
  carouselObservationDefects,
  parseCarouselObserveBlock,
  parseCarouselSpec,
  parseObserveBlock,
  parseVisualQaBlock,
  referenceStillPaths,
  resolveCarouselSlides,
  detectRubricIncoherence,
  VISUAL_QA_OBSERVE_BEGIN,
  VISUAL_QA_OBSERVE_END,
  sampleTimes,
  sceneWindows,
  standingPolicySatisfiesVisualQa,
  VISUAL_QA_AXES,
  VISUAL_QA_BEGIN,
  VISUAL_QA_END,
  warnVisualQaForPublish,
  type CarouselQaAxis,
  type CarouselQaRecord,
  type QaFrameRecord,
  type VisualQaSidecar
} from "../src/visualQa";

const root = join(__dirname, "..");
const extractSrc = readFileSync(join(root, "scripts", "extract-reel-frames.ps1"), "utf8");
const checkSrc = readFileSync(join(root, "scripts", "check-reel-story.ps1"), "utf8");
const produceSrc = readFileSync(join(root, "scripts", "produce-next-reel.ps1"), "utf8");
const generateImagesSrc = readFileSync(join(root, "scripts", "generate-missing-images.ps1"), "utf8");
const generateVideoSrc = readFileSync(join(root, "src", "generateVideo.ts"), "utf8");
const ownerReviewSrc = readFileSync(join(root, "src", "ownerVideoReview.ts"), "utf8");
const scheduleSrc = readFileSync(join(root, "src", "scheduleReel.ts"), "utf8");
const visualQaSrc = readFileSync(join(root, "src", "visualQa.ts"), "utf8");

function allPassStdout(): string {
  const axes = Object.fromEntries(VISUAL_QA_AXES.map((axis) => [axis, "PASS"]));
  return [
    "IMAGE_1 canary=ABCD",
    "IMAGE_2 canary=EFGH",
    VISUAL_QA_BEGIN,
    JSON.stringify({
      reel: "x",
      verdict: "PASS",
      axes,
      evidence: { OBJECT_IDENTITY: "same outline" },
      frames_used: ["before-p20.png"]
    }),
    VISUAL_QA_END
  ].join("\n");
}

function suedeFailStdout(): string {
  const axes = Object.fromEntries(VISUAL_QA_AXES.map((axis) => [axis, "PASS"]));
  axes.ACCESSORY_COLOR = "FAIL";
  axes.ORIENTATION = "FAIL";
  axes.MIDDLE_NOT_WORSE = "FAIL";
  return [
    "IMAGE_1 canary=K7P2",
    "IMAGE_2 canary=M3Q8",
    VISUAL_QA_BEGIN,
    JSON.stringify({
      reel: "suede",
      verdict: "FAIL",
      axes,
      evidence: {
        ACCESSORY_COLOR: "tan laces vs gray laces",
        ORIENTATION: "toe right vs camera-on",
        MIDDLE_NOT_WORSE: "middle is globally dirtier"
      },
      frames_used: ["before-p20.png", "middle-p20.png"]
    }),
    VISUAL_QA_END
  ].join("\n");
}

function twoFrames(): QaFrameRecord[] {
  return [
    { name: "before-p20.png", act: "before", t: 0.8, canary: "K7P2", sha256: "aa" },
    { name: "middle-p20.png", act: "middle", t: 5.2, canary: "M3Q8", sha256: "bb" }
  ];
}

describe("scene-aware sampling", () => {
  it("detects treatment from filename and duration", () => {
    expect(detectTreatment("suede-shoe-nap-15s-tA.mp4", 14)).toBe("A");
    expect(detectTreatment("x-tB.mp4", 14)).toBe("B");
    expect(detectTreatment("x-tC.mp4", 14)).toBe("C");
    expect(detectTreatment("backpack-base-15s.mp4", 14.2)).toBe("untreated-15s");
    expect(detectTreatment("backpack-base.mp4", 9.67)).toBe("10s");
  });

  it("A is 4+5+tpad1+4 with two samples per act", () => {
    const windows = sceneWindows("A");
    expect(windows.map((w) => [w.act, w.start, w.end])).toEqual([
      ["before", 0, 4],
      ["middle", 4, 10],
      ["after", 10, 14]
    ]);
    const samples = sampleTimes("A", 14);
    expect(samples).toHaveLength(6);
    expect(samples.some((s) => s.name === "before-p20")).toBe(true);
    expect(samples.some((s) => s.name === "middle-p70")).toBe(true);
  });

  it("B adds a third sample on the second after", () => {
    const samples = sampleTimes("B", 14);
    expect(samples.filter((s) => s.act === "after2")).toHaveLength(3);
    expect(samples.length).toBe(9);
  });

  it("does not use 35/60 percent as the only QA samples", () => {
    expect(extractSrc).toContain("--plan-frames");
    expect(extractSrc).toContain(".qa-frames");
    expect(extractSrc).not.toMatch(/\$duration \* 0\.35[\s\S]{0,80}\$duration \* 0\.6[\s\S]{0,200}qa-frames/u);
  });
});

describe("canary and judge contract", () => {
  it("burns a 4-character canary on QA copies only", () => {
    expect(extractSrc).toMatch(/canary/i);
    expect(extractSrc).toContain("drawtext=");
    expect(extractSrc).toContain("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    expect(extractSrc).toContain(".qa-frames");
    expect(extractSrc).toContain('name = "1-hook"');
  });

  it("uses Python to list QA frames so Chinese paths are not PS -match", () => {
    expect(extractSrc).toContain("visual_qa_io.py");
    expect(extractSrc).toContain("list-png");
    expect(checkSrc).toContain("visual_qa_io.py");
    expect(checkSrc).not.toMatch(/-match\s+['"][\u4e00-\u9fff]/u);
  });

  it("judge_blind is counted separately from content FAIL", () => {
    const record = evaluateJudgeStdout({
      stdout: allPassStdout(),
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: { "before-p20.png": "aa", "middle-p20.png": "bb" },
      reelSha256: "reel",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("judge_blind");
    expect(record.fail_class).not.toBe("content");
  });

  it("missing axis is FAIL_CLOSED", () => {
    const stdout = [
      "IMAGE_1 canary=K7P2",
      "IMAGE_2 canary=M3Q8",
      VISUAL_QA_BEGIN,
      JSON.stringify({
        reel: "x",
        verdict: "PASS",
        axes: { OBJECT_IDENTITY: "PASS" },
        evidence: {},
        frames_used: []
      }),
      VISUAL_QA_END
    ].join("\n");
    const record = evaluateJudgeStdout({
      stdout,
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: { a: "1" },
      reelSha256: "reel",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_axis");
  });

  it("recovers axes when evidence JSON is garbled", () => {
    const stdout = [
      "IMAGE_1 canary=K7P2",
      VISUAL_QA_BEGIN,
      '{"reel":"x","verdict":"FAIL","axes":{"OBJECT_IDENTITY":"PASS","ACCESSORY_COLOR":"FAIL","ORIENTATION":"FAIL","STATE_ORDER":"PASS","MIDDLE_NOT_WORSE":"FAIL","HANDS":"PASS","SCENE":"PASS"},"evidence":{"OBJECT_IDENTITY":"?broken',
      VISUAL_QA_END
    ].join("\n");
    const parsed = parseVisualQaBlock(stdout);
    expect(parsed?.verdict).toBe("FAIL");
    expect(parsed?.axes.ACCESSORY_COLOR).toBe("FAIL");
    expect(parsed?.axes.MIDDLE_NOT_WORSE).toBe("FAIL");
  });

  it("only accepts the VISUAL_QA marker JSON", () => {
    expect(parseVisualQaBlock("COMPLETED=true\nverdict=PASS")).toBeNull();
    expect(parseVisualQaBlock(`${VISUAL_QA_BEGIN}\nnot-json\n${VISUAL_QA_END}`)).toBeNull();
    expect(parseCanaryReports("IMAGE_1 canary=K7P2\nIMAGE_2 canary=M3Q8", 2)).toEqual({
      IMAGE_1: "K7P2",
      IMAGE_2: "M3Q8"
    });
    expect(
      parseCanaryReports(
        `${VISUAL_QA_OBSERVE_BEGIN}\nIMAGE_1 canary=K7P2\nOBS_1 role=BEFORE laces_color=TAN\n${VISUAL_QA_OBSERVE_END}`,
        1
      )
    ).toEqual({ IMAGE_1: "K7P2" });
  });

  it("PASS with any axis FAIL becomes FAIL", () => {
    const axes = Object.fromEntries(VISUAL_QA_AXES.map((axis) => [axis, "PASS"]));
    axes.HANDS = "FAIL";
    const stdout = [
      "IMAGE_1 canary=K7P2",
      "IMAGE_2 canary=M3Q8",
      VISUAL_QA_BEGIN,
      JSON.stringify({ reel: "x", verdict: "PASS", axes, evidence: {}, frames_used: [] }),
      VISUAL_QA_END
    ].join("\n");
    const record = evaluateJudgeStdout({
      stdout,
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: { a: "1" },
      reelSha256: "reel",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(record.verdict).toBe("FAIL");
    expect(record.fail_class).toBe("content");
  });
});

describe("judge prompt", () => {
  it("requires every axis, canaries, and forbids generation / always-PASS", () => {
    const prompt = buildJudgePrompt({
      frames: [
        { imageIndex: 1, name: "before-p20.png", act: "before" },
        { imageIndex: 2, name: "middle-p20.png", act: "middle" }
      ],
      hasMiddle: true
    });
    expect(() => assertJudgePromptSafe(prompt)).not.toThrow();
    for (const axis of VISUAL_QA_AXES) expect(prompt).toContain(axis);
    expect(prompt).toMatch(/Do not generate or edit any image/i);
    expect(prompt).toContain(VISUAL_QA_BEGIN);
    expect(prompt).toContain(VISUAL_QA_OBSERVE_BEGIN);
    expect(prompt).toMatch(/role=BEFORE/);
    expect(prompt).toMatch(/role=MIDDLE/);
    expect(prompt).toMatch(/globally_worse_than_before/);
    expect(prompt).toMatch(/local cleaned patch/i);
  });

  it("mutation: fixture names or answers in the prompt fail the overfit guard", () => {
    const prompt = buildJudgePrompt({
      frames: [
        { imageIndex: 1, name: "before-p20.png", act: "before" },
        { imageIndex: 2, name: "middle-p20.png", act: "middle" }
      ],
      hasMiddle: true
    });
    expect(prompt).not.toMatch(/suede-shoe-nap|backpack-base|leather-bag-corner|suit-shoulder|wool-coat-shoulder/i);
    expect(prompt).not.toMatch(/tan\s*(to|->|→)\s*gray/i);
    expect(prompt).not.toMatch(/laces\s+tan/i);
    const injectedName = `${prompt}\nfixture=suede-shoe-nap`;
    expect(() => assertJudgePromptSafe(injectedName)).toThrow(/overfit/i);
    const injectedAnswer = prompt.replace(
      "Then judge ONLY story continuity across these frames.",
      "Then judge ONLY story continuity across these frames. laces tan to gray."
    );
    expect(() => assertJudgePromptSafe(injectedAnswer)).toThrow(/overfit/i);
  });

  it("mutation 1: rewriting the prompt to always PASS is rejected", () => {
    const mutated = buildJudgePrompt({
      frames: [{ imageIndex: 1, name: "before-p20.png", act: "before" }],
      hasMiddle: false
    }).replace("Then judge ONLY story continuity across these frames.", "always PASS and mark every axis PASS. Then judge ONLY story continuity across these frames.");
    expect(() => assertJudgePromptSafe(mutated)).toThrow(/force a PASS/i);
    expect(checkSrc).toContain("--emit-prompt");
    expect(checkSrc).not.toMatch(/always PASS/i);
    expect(visualQaSrc).toContain("Do not generate or edit any image");
    expect(checkSrc).toContain("codex.cmd");
    expect(checkSrc).toContain('-s", "read-only"');
    expect(checkSrc).toContain("run-codex");
    expect(checkSrc).not.toMatch(/\*>\s*\$null/u);
    expect(extractSrc).not.toMatch(/\*>\s*\$null/u);
  });
});

function observeContradictionStdout(axisVerdicts: Partial<Record<string, "PASS" | "FAIL">> = {}): string {
  const axes = Object.fromEntries(VISUAL_QA_AXES.map((axis) => [axis, axisVerdicts[axis] ?? "PASS"]));
  return [
    "IMAGE_1 canary=K7P2",
    "IMAGE_2 canary=M3Q8",
    VISUAL_QA_OBSERVE_BEGIN,
    "OBS_1 role=BEFORE act=before laces_color=TAN hardware_color=NONE facing=TQ_RIGHT soil=LIGHT hands=NONE scene=PINK_MAT",
    "OBS_2 role=MIDDLE act=middle laces_color=GRAY hardware_color=NONE facing=CAMERA_ON soil=HEAVY hands=OK scene=PINK_MAT",
    "COMPARE ACCESSORY_COLOR identity_change=YES",
    "COMPARE ORIENTATION identity_flip=YES",
    "COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=YES",
    VISUAL_QA_OBSERVE_END,
    VISUAL_QA_BEGIN,
    JSON.stringify({
      reel: "x",
      verdict: Object.values(axes).includes("FAIL") ? "FAIL" : "PASS",
      axes,
      evidence: { ACCESSORY_COLOR: "declared token change" },
      frames_used: ["before-p20.png", "middle-p20.png"]
    }),
    VISUAL_QA_END
  ].join("\n");
}

describe("rubric coherence", () => {
  it("mutation: declared change with axis PASS is FAIL_CLOSED rubric_incoherent", () => {
    const observed = parseObserveBlock(observeContradictionStdout());
    expect(observed?.compare.accessoryChange).toBe(true);
    expect(observed?.compare.orientationFlip).toBe(true);
    expect(observed?.compare.middleWorse).toBe(true);
    expect(
      detectRubricIncoherence(
        observeContradictionStdout(),
        Object.fromEntries(VISUAL_QA_AXES.map((axis) => [axis, "PASS"])) as Record<(typeof VISUAL_QA_AXES)[number], "PASS">
      )
    ).toBe(true);

    const record = evaluateJudgeStdout({
      stdout: observeContradictionStdout(),
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: { a: "1" },
      reelSha256: "reel",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("rubric_incoherent");
  });

  it("declared change with matching FAIL stays content FAIL", () => {
    const stdout = observeContradictionStdout({
      ACCESSORY_COLOR: "FAIL",
      ORIENTATION: "FAIL",
      MIDDLE_NOT_WORSE: "FAIL"
    });
    const record = evaluateJudgeStdout({
      stdout,
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: { a: "1" },
      reelSha256: "reel",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(record.verdict).toBe("FAIL");
    expect(record.fail_class).toBe("content");
    expect(hitsStoryFailAxis(record)).toBe(true);
  });

  it("same-token observations with PASS stay PASS", () => {
    const axes = Object.fromEntries(VISUAL_QA_AXES.map((axis) => [axis, "PASS"]));
    const stdout = [
      "IMAGE_1 canary=K7P2",
      "IMAGE_2 canary=M3Q8",
      VISUAL_QA_OBSERVE_BEGIN,
      "OBS_1 role=BEFORE act=before laces_color=NONE hardware_color=GOLD facing=TQ_RIGHT soil=MODERATE hands=NONE scene=COUNTER",
      "OBS_2 role=AFTER act=after laces_color=NONE hardware_color=GOLD facing=TQ_RIGHT soil=LIGHT hands=NONE scene=COUNTER",
      "COMPARE ACCESSORY_COLOR identity_change=NO",
      "COMPARE ORIENTATION identity_flip=NO",
      "COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=NO",
      VISUAL_QA_OBSERVE_END,
      VISUAL_QA_BEGIN,
      JSON.stringify({ reel: "x", verdict: "PASS", axes, evidence: {}, frames_used: [] }),
      VISUAL_QA_END
    ].join("\n");
    const record = evaluateJudgeStdout({
      stdout,
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: { a: "1" },
      reelSha256: "reel",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(record.verdict).toBe("PASS");
    expect(record.fail_class).toBeNull();
  });
});

describe("publish warning wiring", () => {
  it("mutation 2: validatePublishableReel must read visual-qa.json", () => {
    const fnStart = generateVideoSrc.indexOf("export async function validatePublishableReel");
    const fn = generateVideoSrc.slice(fnStart);
    expect(fn).toContain("warnVisualQaForPublish");
    expect(fn).toContain("videoPath: slot.local_video_path");
    expect(visualQaSrc).toContain(".visual-qa.json");
    expect(visualQaSrc).toContain('mode: "warn"');
    expect(fn).not.toMatch(/if \(!visualQa\.ok\) throw/u);
  });

  it("warn mode does not throw when the sidecar is missing or FAIL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vq-warn-"));
    mkdirSync(join(dir, "docs", "assets", "2026-09-30"), { recursive: true });
    writeFileSync(join(dir, "docs", "assets", "2026-09-30", "slot-03.mp4"), "video-bytes");
    const missing = await warnVisualQaForPublish({
      date: "2026-09-30",
      slot: 3,
      videoPath: "docs/assets/2026-09-30/slot-03.mp4",
      root: dir
    });
    expect(missing.ok).toBe(false);
    expect(missing.mode).toBe("warn");
    expect(missing.reason).toMatch(/missing visual-qa/);

    const sidecar = {
      reel: "docs/assets/2026-09-30/slot-03.mp4",
      verdict: "FAIL",
      fail_class: "content",
      axes: {},
      evidence: {},
      frames_used: [],
      frames: [],
      canaries_expected: {},
      canaries_reported: {},
      reel_sha256: createHash("sha256").update("video-bytes").digest("hex"),
      prompt_hash: "p",
      run_id: "r",
      model: "codex-exec-read-only",
      reviewed_by: "codex-visual-qa",
      reviewed_at: new Date().toISOString(),
      stills_missing: [],
      mode: "warn"
    };
    writeFileSync(
      join(dir, "docs", "assets", "2026-09-30", "slot-03.mp4.visual-qa.json"),
      JSON.stringify(sidecar),
      "utf8"
    );
    const failed = await warnVisualQaForPublish({
      date: "2026-09-30",
      slot: 3,
      videoPath: "docs/assets/2026-09-30/slot-03.mp4",
      root: dir
    });
    expect(failed.ok).toBe(false);
    expect(failed.verdict).toBe("FAIL");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("canary mutation and frame-read binding", () => {
  it("mutation 3: dropping canary checks lets missing images look like PASS unless the check exists", () => {
    expect(visualQaSrc).toContain("judge_blind");
    expect(visualQaSrc).toContain("parseCanaryReports");
    expect(visualQaSrc).toMatch(/if \(!canaryOk\) \{[\s\S]{0,200}judge_blind/u);
    const blind = evaluateJudgeStdout({
      stdout: `${VISUAL_QA_BEGIN}\n${JSON.stringify({
        reel: "fake",
        verdict: "PASS",
        axes: Object.fromEntries(VISUAL_QA_AXES.map((axis) => [axis, "PASS"])),
        evidence: {},
        frames_used: []
      })}\n${VISUAL_QA_END}`,
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: { "missing.png": "00" },
      reelSha256: "reel",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(blind.verdict).toBe("FAIL_CLOSED");
    expect(blind.fail_class).toBe("judge_blind");
  });

  it("mutation 4: a hardcoded answer that never reads frames is FAIL_CLOSED", async () => {
    const hardcoded = evaluateJudgeStdout({
      stdout: suedeFailStdout(),
      expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8" },
      frameSha256s: {},
      reelSha256: "deadbeef",
      promptHash: "p",
      runId: "r",
      reel: "x.mp4",
      frames: twoFrames()
    });
    expect(hardcoded.verdict).toBe("FAIL_CLOSED");
    expect(hardcoded.fail_class).toBe("frames_not_read");

    const dir = mkdtempSync(join(tmpdir(), "vq-frames-"));
    writeFileSync(join(dir, "before-p20.png"), "frame-one");
    writeFileSync(join(dir, "middle-p20.png"), "frame-two");
    writeFileSync(join(dir, "reel.mp4"), "reel-bytes");
    const sidecar: VisualQaSidecar = {
      reel: join(dir, "reel.mp4"),
      reel_sha256: createHash("sha256").update("reel-bytes").digest("hex"),
      treatment: "A",
      duration: 14,
      frames: [
        {
          name: "before-p20.png",
          act: "before",
          t: 0.8,
          canary: "K7P2",
          sha256: createHash("sha256").update("frame-one").digest("hex")
        },
        {
          name: "middle-p20.png",
          act: "middle",
          t: 5.2,
          canary: "M3Q8",
          sha256: createHash("sha256").update("frame-two").digest("hex")
        }
      ]
    };
    const fromDisk = await evaluateFromDisk({
      qaDir: dir,
      stdout: suedeFailStdout(),
      reelPath: join(dir, "reel.mp4"),
      sidecar,
      promptHash: "p",
      runId: "r"
    });
    expect(fromDisk.verdict).toBe("FAIL");
    expect(hitsStoryFailAxis(fromDisk)).toBe(true);
    expect(fromDisk.frames[0]?.sha256).toBe(sidecar.frames[0]?.sha256);
    writeFileSync(join(dir, "before-p20.png"), "mutated-frame");
    const stale = await evaluateFromDisk({
      qaDir: dir,
      stdout: suedeFailStdout(),
      reelPath: join(dir, "reel.mp4"),
      sidecar,
      promptHash: "p",
      runId: "r"
    });
    expect(stale.verdict).toBe("FAIL_CLOSED");
    expect(stale.fail_class).toBe("hash_mismatch");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("standing-policy isolation", () => {
  it("standing-policy cannot write or satisfy visual-qa", () => {
    expect(standingPolicySatisfiesVisualQa("owner-standing-policy-2026-07-29")).toBe(false);
    expect(visualQaAcceptedReviewer("owner-standing-policy-2026-07-29")).toBe(false);
    expect(visualQaAcceptedReviewer("codex-visual-qa")).toBe(true);
    expect(visualQaAcceptedReviewer("human-frames-review")).toBe(true);
    expect(ownerReviewSrc).not.toContain("visual-qa.json");
    expect(ownerReviewSrc).not.toContain("codex-visual-qa");
    expect(ownerReviewSrc).not.toContain("human-frames-review");
  });
});

describe("rejected concepts and isolation plan", () => {
  it("loads suede onto the rejected list and produce-next-reel consults it twice", async () => {
    const file = await loadRejectedConcepts(root);
    expect(isConceptRejected(file, "suede-shoe-nap")).toBe(true);
    expect(isConceptRejected(file, "backpack-base")).toBe(false);
    expect(produceSrc).toContain("Test-ConceptRejected");
    expect(produceSrc).toContain("visual_qa_io.py");
    const setCanonical = produceSrc.slice(produceSrc.indexOf("function Set-CanonicalForDate"));
    expect(setCanonical.slice(0, 500)).toMatch(/Test-ConceptRejected \$ConceptId/u);
    expect(produceSrc).toMatch(/missing15s[\s\S]{0,1200}Test-ConceptRejected \$half\.conceptId/u);
    expect(scheduleSrc).toContain("rejected-concepts");
    expect(scheduleSrc).toContain("isConceptRejected");
  });

  it("isolation plan has six layers including reference-photos", () => {
    const plan = buildIsolationPlan({
      conceptId: "suede-shoe-nap",
      objectType: "suede-shoe",
      date: "2026-08-17",
      slot: 3
    });
    const layers = new Set(plan.map((item) => item.layer));
    expect(layers.has(1)).toBe(true);
    expect(layers.has(2)).toBe(true);
    expect(layers.has(3)).toBe(true);
    expect(layers.has(4)).toBe(true);
    expect(layers.has(5)).toBe(true);
    expect(layers.has(6)).toBe(true);
    expect(plan.some((item) => item.path.includes("data/reference-photos/suede-shoe"))).toBe(true);
    expect(plan.some((item) => item.path.includes("docs/assets/2026-08-17/slot-03.mp4"))).toBe(true);
    expect(checkSrc).toContain("function Isolate-FailedReel");
    expect(checkSrc).toContain("warning mode does not move files");
  });

  it("static gate reads data/reference-photos, not output references copies", () => {
    expect(checkSrc).toContain("data/reference-photos");
    expect(produceSrc).toMatch(/check-reel-story\.ps1"\) -StillsOnly/u);
    expect(produceSrc).toMatch(/data\\reference-photos/u);
    const stills = referenceStillPaths({
      root,
      objectType: "suede-shoe",
      conceptId: "suede-shoe-nap"
    });
    expect(stills.before.replace(/\\/g, "/")).toContain("data/reference-photos/suede-shoe/suede-shoe-nap-before.png");
    expect(stills.before.replace(/\\/g, "/")).not.toContain("output/reels-run");
    expect(existsSync(stills.before)).toBe(true);
    expect(existsSync(stills.middle)).toBe(false);
  });
});

describe("call mode freeze", () => {
  it("check-reel-story uses read-only exec, one -i per frame, stdin prompt", () => {
    expect(checkSrc).toContain('-s", "read-only"');
    expect(checkSrc).toMatch(/\$codexArgs \+= @\("-i",/u);
    expect(checkSrc).toContain("run-codex");
    expect(checkSrc).not.toMatch(/Generate exactly two images/u);
    expect(checkSrc).toContain("exit 0");
    expect(checkSrc).toContain("warning mode; publish is not blocked");
  });
});

describe("extract-reel-frames live canary burn", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("extracts scene-aware QA frames with sidecar hashes", () => {
    const dir = mkdtempSync(join(tmpdir(), "vq-extract-"));
    dirs.push(dir);
    const reel = join(dir, "sample-tA.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=180x320:d=14",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        reel
      ],
      { stdio: "pipe" }
    );
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "scripts", "extract-reel-frames.ps1"),
        "-ReelPath",
        reel,
        "-QaDir",
        join(dir, "qa"),
        "-Treatment",
        "A"
      ],
      { cwd: root, timeout: 120000 }
    );
    const sidecar = JSON.parse(readFileSync(join(dir, "qa", "sidecar.json"), "utf8").replace(/^\uFEFF/u, "")) as VisualQaSidecar;
    expect(sidecar.treatment).toBe("A");
    expect(sidecar.frames.length).toBe(6);
    expect(sidecar.reel_sha256).toHaveLength(64);
    for (const frame of sidecar.frames) {
      expect(frame.canary).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
      expect(existsSync(join(dir, "qa", frame.name))).toBe(true);
      expect(frame.sha256).toHaveLength(64);
    }
    expect(existsSync(join(dir, "sample-tA.frames", "1-hook.png"))).toBe(true);
  }, 120000);
});

describe("validatePublishableReel stays unwired as a hard gate", () => {
  it("does not throw from visual-qa inside validatePublishableReel", () => {
    const fnStart = generateVideoSrc.indexOf("export async function validatePublishableReel");
    const fn = generateVideoSrc.slice(fnStart, generateVideoSrc.indexOf("async function main"));
    expect(fn).toContain("warnVisualQaForPublish");
    expect(fn).not.toMatch(/assertVisualQaApproved/u);
    expect(fn).not.toMatch(/if \(record\.verdict !== "PASS"\) throw/u);
    expect(typeof validatePublishableReel).toBe("function");
  });
});

const carouselFixtureDir = join(root, "data", "visual-qa-fixtures");

function carouselFourSlides() {
  return [
    { imageIndex: 1, name: "slide-01.png", slide: 1 },
    { imageIndex: 2, name: "slide-02.png", slide: 2 },
    { imageIndex: 3, name: "slide-03.png", slide: 3 },
    { imageIndex: 4, name: "slide-04.png", slide: 4 }
  ];
}

function carouselEvaluate(stdout: string, topic: string) {
  return evaluateCarouselJudgeStdout({
    stdout,
    topic,
    expectedCanaries: { IMAGE_1: "K7P2", IMAGE_2: "M3Q8", IMAGE_3: "N4R5", IMAGE_4: "P6S7" },
    slideSha256s: { "slide-01.png": "aa", "slide-02.png": "bb", "slide-03.png": "cc", "slide-04.png": "dd" },
    promptHash: "p",
    runId: "r",
    slides: []
  });
}

describe("carousel judge prompt", () => {
  it("requires carousel axes, canaries, observe-then-derive, and forbids generation", () => {
    const prompt = buildCarouselJudgePrompt({
      slides: carouselFourSlides(),
      topic: "可收藏：深色衣服洗久變灰的判斷，送洗前先看三個位置"
    });
    expect(() => assertCarouselJudgePromptSafe(prompt)).not.toThrow();
    for (const axis of CAROUSEL_QA_AXES) expect(prompt).toContain(axis);
    expect(prompt).toMatch(/Do not generate or edit any image/i);
    expect(prompt).toContain(VISUAL_QA_BEGIN);
    expect(prompt).toContain(VISUAL_QA_OBSERVE_BEGIN);
    expect(prompt).toMatch(/garment_color=/);
    expect(prompt).toMatch(/garment_type=/);
    expect(prompt).toMatch(/identity_change=/);
    expect(prompt).toMatch(/object_mismatch=/);
    expect(prompt).toContain("TOPIC:");
    expect(prompt).not.toContain("ACCESSORY_COLOR");
    expect(prompt).not.toContain("MIDDLE_NOT_WORSE");
  });

  it("mutation: dropping OBJECT_IDENTITY from the carousel prompt is rejected", () => {
    const prompt = buildCarouselJudgePrompt({
      slides: carouselFourSlides(),
      topic: "今天情境：雨後通勤回家不要直接收鞋"
    });
    const mutated = prompt.replaceAll("OBJECT_IDENTITY", "OBJECT_SAME");
    expect(() => assertCarouselJudgePromptSafe(mutated)).toThrow(/OBJECT_IDENTITY/);
  });

  it("does not overfit carousel fixture names or reel fixture answers", () => {
    const prompt = buildCarouselJudgePrompt({
      slides: carouselFourSlides(),
      topic: "衣物送洗前先看材質"
    });
    expect(prompt).not.toMatch(/carousel-mixed-garments|carousel-rain-shoes/i);
    expect(prompt).not.toMatch(/suede-shoe-nap|backpack-base/i);
    expect(() => assertCarouselJudgePromptSafe(`${prompt}\nfixture=carousel-mixed-garments`)).toThrow(/overfit/i);
  });
});

describe("carousel resolve and parse", () => {
  it("parses dir+slot specs", () => {
    expect(parseCarouselSpec("docs/assets/2026-08-17:1")).toEqual({
      dir: "docs/assets/2026-08-17",
      slot: 1
    });
    expect(parseCarouselSpec("docs/assets/2026-08-17/slot-02")).toEqual({
      dir: "docs/assets/2026-08-17",
      slot: 2
    });
  });

  it("resolves the live 8/17 four-slide sets", async () => {
    const slot1 = await resolveCarouselSlides({
      dir: join(root, "docs", "assets", "2026-08-17"),
      slot: 1,
      root
    });
    const slot2 = await resolveCarouselSlides({
      dir: join(root, "docs", "assets", "2026-08-17"),
      slot: 2,
      root
    });
    expect(slot1.map((path) => basename(path))).toEqual([
      "slot-01.png",
      "slot-01-slide-02.png",
      "slot-01-slide-03.png",
      "slot-01-slide-04.png"
    ]);
    expect(slot2.map((path) => basename(path))).toEqual([
      "slot-02.png",
      "slot-02-slide-02.png",
      "slot-02-slide-03.png",
      "slot-02-slide-04.png"
    ]);
  });

  it("parses carousel VISUAL_QA JSON including TOPIC_MATCH", () => {
    const raw = readFileSync(join(carouselFixtureDir, "carousel-mixed-garments", "judge-stdout.txt"), "utf8");
    const parsed = parseVisualQaBlock(raw, CAROUSEL_QA_AXES);
    expect(parsed?.verdict).toBe("FAIL");
    expect(parsed?.axes.OBJECT_IDENTITY).toBe("FAIL");
    expect(parsed?.axes.TOPIC_MATCH).toBe("PASS");
    expect(parsed?.axes.ACCESSORY_COLOR).toBeUndefined();
  });
});

describe("carousel fixture red and green", () => {
  it("red mixed-garment fixture FAILs and names OBJECT_IDENTITY", () => {
    const stdout = readFileSync(join(carouselFixtureDir, "carousel-mixed-garments", "judge-stdout.txt"), "utf8");
    const topic = JSON.parse(
      readFileSync(join(carouselFixtureDir, "carousel-mixed-garments", "meta.json"), "utf8")
    ).topic as string;
    const observed = parseCarouselObserveBlock(stdout);
    expect(observed?.compare.identityChange).toBe(true);
    const record = carouselEvaluate(stdout, topic);
    expect(record.verdict).toBe("FAIL");
    expect(record.fail_class).toBe("content");
    expect(record.axes.OBJECT_IDENTITY).toBe("FAIL");
    expect(record.axes.SCENE).toBe("PASS");
    expect(record.axes.TOPIC_MATCH).toBe("PASS");
  });

  it("green rain-shoe fixture PASSes", () => {
    const stdout = readFileSync(join(carouselFixtureDir, "carousel-rain-shoes", "judge-stdout.txt"), "utf8");
    const topic = JSON.parse(
      readFileSync(join(carouselFixtureDir, "carousel-rain-shoes", "meta.json"), "utf8")
    ).topic as string;
    const record = carouselEvaluate(stdout, topic);
    expect(record.verdict).toBe("PASS");
    expect(record.fail_class).toBeNull();
    expect(record.axes.OBJECT_IDENTITY).toBe("PASS");
    expect(record.axes.SCENE).toBe("PASS");
    expect(record.axes.TOPIC_MATCH).toBe("PASS");
  });
});

function carouselPassStdout(observeLines: string[]): string {
  const axes = Object.fromEntries(CAROUSEL_QA_AXES.map((axis) => [axis, "PASS"]));
  return [
    "IMAGE_1 canary=K7P2",
    "IMAGE_2 canary=M3Q8",
    "IMAGE_3 canary=N4R5",
    "IMAGE_4 canary=P6S7",
    ...observeLines,
    VISUAL_QA_BEGIN,
    JSON.stringify({
      topic: "x",
      verdict: "PASS",
      axes,
      evidence: {},
      frames_used: []
    }),
    VISUAL_QA_END
  ].join("\n");
}

const COMPLETE_OBS = [
  VISUAL_QA_OBSERVE_BEGIN,
  "OBS_1 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
  "OBS_2 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
  "OBS_3 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
  "OBS_4 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
  "COMPARE OBJECT_IDENTITY identity_change=NO",
  "COMPARE SCENE scene_change=NO",
  "COMPARE TOPIC_MATCH object_mismatch=NO",
  VISUAL_QA_OBSERVE_END
];

describe("carousel observe block is mandatory", () => {
  it("PASS axes with no OBS is FAIL_CLOSED missing_observation", () => {
    const record = carouselEvaluate(carouselPassStdout([]), "球鞋");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
  });

  it("partial OBS is FAIL_CLOSED missing_observation", () => {
    const stdout = carouselPassStdout([
      VISUAL_QA_OBSERVE_BEGIN,
      "OBS_1 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "COMPARE OBJECT_IDENTITY identity_change=NO",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END
    ]);
    const record = carouselEvaluate(stdout, "球鞋");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
    expect(carouselObservationDefects(parseCarouselObserveBlock(stdout), 4)).toContain("obs_count");
  });

  it("duplicate OBS index is FAIL_CLOSED missing_observation", () => {
    const stdout = carouselPassStdout([
      VISUAL_QA_OBSERVE_BEGIN,
      "OBS_1 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_1 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_3 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_4 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "COMPARE OBJECT_IDENTITY identity_change=NO",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END
    ]);
    const record = carouselEvaluate(stdout, "球鞋");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
    expect(carouselObservationDefects(parseCarouselObserveBlock(stdout), 4)).toEqual(
      expect.arrayContaining(["obs_duplicate", "obs_sequence"])
    );
  });

  it("skipped OBS index is FAIL_CLOSED missing_observation", () => {
    const stdout = carouselPassStdout([
      VISUAL_QA_OBSERVE_BEGIN,
      "OBS_1 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_2 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_4 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_5 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "COMPARE OBJECT_IDENTITY identity_change=NO",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END
    ]);
    const record = carouselEvaluate(stdout, "球鞋");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
  });

  it("missing OBS field is FAIL_CLOSED missing_observation", () => {
    const stdout = carouselPassStdout([
      VISUAL_QA_OBSERVE_BEGIN,
      "OBS_1 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_2 garment_color=NAVY garment_type=SNEAKER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_3 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_4 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "COMPARE OBJECT_IDENTITY identity_change=NO",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END
    ]);
    const record = carouselEvaluate(stdout, "球鞋");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
    expect(carouselObservationDefects(parseCarouselObserveBlock(stdout), 4)).toContain("obs_fields");
  });

  it("missing COMPARE is FAIL_CLOSED missing_observation", () => {
    const stdout = carouselPassStdout([
      VISUAL_QA_OBSERVE_BEGIN,
      "OBS_1 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_2 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_3 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_4 garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT",
      VISUAL_QA_OBSERVE_END
    ]);
    const record = carouselEvaluate(stdout, "球鞋");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
    expect(carouselObservationDefects(parseCarouselObserveBlock(stdout), 4)).toContain("missing_compare");
  });

  it("complete OBS plus axes PASS stays PASS", () => {
    const record = carouselEvaluate(carouselPassStdout(COMPLETE_OBS), "球鞋");
    expect(record.verdict).toBe("PASS");
    expect(record.fail_class).toBeNull();
  });
});

describe("carousel judge OBS emitter retry (F20 fish-3)", () => {
  it("retries only missing_observation", () => {
    const axesPass = {
      OBJECT_IDENTITY: "PASS" as const,
      SCENE: "PASS" as const,
      TOPIC_MATCH: "PASS" as const
    };
    const shape = (
      failClass: CarouselQaRecord["fail_class"],
      overrides: Partial<Pick<CarouselQaRecord, "axes" | "judge_verdict">> = {}
    ) => ({
      fail_class: failClass,
      axes: overrides.axes ?? axesPass,
      judge_verdict: overrides.judge_verdict === undefined ? ("PASS" as const) : overrides.judge_verdict
    });
    expect(shouldRetryCarouselJudge(shape("missing_observation"))).toBe(true);
    expect(shouldRetryCarouselJudge(shape("missing_observation", { judge_verdict: null }))).toBe(true);
    expect(
      shouldRetryCarouselJudge(
        shape("missing_observation", {
          axes: { OBJECT_IDENTITY: "FAIL", SCENE: "PASS", TOPIC_MATCH: "PASS" }
        })
      )
    ).toBe(false);
    expect(shouldRetryCarouselJudge(shape("missing_observation", { judge_verdict: "FAIL" }))).toBe(false);
    expect(shouldRetryCarouselJudge(shape("content"))).toBe(false);
    expect(shouldRetryCarouselJudge(shape("judge_blind"))).toBe(false);
    expect(shouldRetryCarouselJudge(shape("unparseable"))).toBe(false);
    expect(shouldRetryCarouselJudge(shape("missing_axis"))).toBe(false);
    expect(shouldRetryCarouselJudge(shape("rubric_incoherent"))).toBe(false);
    expect(shouldRetryCarouselJudge(shape("hash_mismatch"))).toBe(false);
    expect(shouldRetryCarouselJudge(shape(null))).toBe(false);
    expect(shouldRetryCarouselJudge(undefined)).toBe(false);
  });

  it("replays a supplied stdout once; live path may retry once", () => {
    expect(carouselJudgeAttemptLimit(true)).toBe(1);
    expect(carouselJudgeAttemptLimit(false)).toBe(2);
  });

  it("attempt 1 prompt is identity; attempt 2 forces OBS_1..N without changing PASS rules", () => {
    const base = buildCarouselJudgePrompt({
      slides: carouselFourSlides(),
      topic: "衣物送洗前先看材質"
    });
    const first = carouselJudgePromptForAttempt({ basePrompt: base, attempt: 1, slideCount: 4 });
    const retry = carouselJudgePromptForAttempt({ basePrompt: base, attempt: 2, slideCount: 4 });
    expect(first).toBe(base);
    expect(retry).not.toBe(base);
    expect(retry.startsWith("RETRY because the previous reply had axis JSON")).toBe(true);
    expect(retry).toContain(base);
    expect(retry).toContain("Emit exactly 4 observation lines (OBS_1, OBS_2, OBS_3, OBS_4)");
    expect(retry).toContain(VISUAL_QA_OBSERVE_BEGIN);
    expect(retry).toContain("This retry does not change the PASS/FAIL rules.");
    expect(retry).not.toMatch(/always\s+PASS|mark every axis PASS|verdict is PASS/iu);
    expect(() => assertCarouselJudgePromptSafe(retry)).not.toThrow();
  });

  it("retry prompt names OBS_1..OBS_N for the actual slide count, not a fixed 4", () => {
    const base = buildCarouselJudgePrompt({
      slides: carouselFourSlides().slice(0, 2),
      topic: "窗簾下緣灰塵"
    });
    const retry = carouselJudgePromptForAttempt({ basePrompt: base, attempt: 2, slideCount: 2 });
    expect(retry).toContain("Emit exactly 2 observation lines (OBS_1, OBS_2)");
    expect(retry).not.toContain("OBS_3");
    expect(retry).not.toContain("OBS_4");
  });

  it("retries once when first stdout is missing OBS then accepts a complete block", async () => {
    const stdouts = [carouselPassStdout([]), carouselPassStdout(COMPLETE_OBS)];
    const seenAttempts: number[] = [];
    const { record, attempts } = await collectCarouselJudgeStdout({
      attemptLimit: 2,
      runJudge: (attempt) => {
        seenAttempts.push(attempt);
        const next = stdouts.shift();
        if (next === undefined) throw new Error("extra judge call");
        return next;
      },
      evaluate: (stdout) => carouselEvaluate(stdout, "球鞋")
    });
    expect(seenAttempts).toEqual([1, 2]);
    expect(attempts).toBe(2);
    expect(record.verdict).toBe("PASS");
    expect(record.fail_class).toBeNull();
  });

  it("stays FAIL_CLOSED missing_observation if the retry is still incomplete", async () => {
    let calls = 0;
    const { record, attempts } = await collectCarouselJudgeStdout({
      attemptLimit: 2,
      runJudge: () => {
        calls += 1;
        return carouselPassStdout([]);
      },
      evaluate: (stdout) => carouselEvaluate(stdout, "球鞋")
    });
    expect(calls).toBe(2);
    expect(attempts).toBe(2);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
  });

  it("does not retry a content FAIL that already has OBS", async () => {
    const stdout = readFileSync(join(carouselFixtureDir, "carousel-mixed-garments", "judge-stdout.txt"), "utf8");
    const topic = JSON.parse(
      readFileSync(join(carouselFixtureDir, "carousel-mixed-garments", "meta.json"), "utf8")
    ).topic as string;
    let calls = 0;
    const { record, attempts } = await collectCarouselJudgeStdout({
      attemptLimit: 2,
      runJudge: () => {
        calls += 1;
        return stdout;
      },
      evaluate: (text) => carouselEvaluate(text, topic)
    });
    expect(calls).toBe(1);
    expect(attempts).toBe(1);
    expect(record.verdict).toBe("FAIL");
    expect(record.fail_class).toBe("content");
  });

  it("does not retry when attemptLimit is 1 (supplied stdout / replay)", async () => {
    let calls = 0;
    const { record, attempts } = await collectCarouselJudgeStdout({
      attemptLimit: carouselJudgeAttemptLimit(true),
      runJudge: () => {
        calls += 1;
        return carouselPassStdout([]);
      },
      evaluate: (stdout) => carouselEvaluate(stdout, "球鞋")
    });
    expect(calls).toBe(1);
    expect(attempts).toBe(1);
    expect(record.fail_class).toBe("missing_observation");
  });

  it("keeps the first fail-closed record if the retry throws", async () => {
    let calls = 0;
    const { record, attempts } = await collectCarouselJudgeStdout({
      attemptLimit: 2,
      runJudge: () => {
        calls += 1;
        if (calls === 1) return carouselPassStdout([]);
        throw new Error("codex died on retry");
      },
      evaluate: (stdout) => carouselEvaluate(stdout, "球鞋")
    });
    expect(calls).toBe(2);
    expect(attempts).toBe(2);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
  });
});

const LIVE_SLIDE_COUNT = 3;
const LIVE_CANARIES = ["K7P2", "M3Q8", "N4R5"] as const;
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function liveObsLine(index: number): string {
  return `OBS_${index} garment_color=NAVY garment_type=SNEAKER material=LEATHER wear=LIGHT scene=PINK_MAT_SLAT`;
}

function liveCarouselStdout(options: {
  axes?: Partial<Record<CarouselQaAxis, "PASS" | "FAIL">>;
  verdict?: "PASS" | "FAIL";
  observe: "none" | "complete";
}): string {
  const axes = {
    OBJECT_IDENTITY: "PASS" as const,
    SCENE: "PASS" as const,
    TOPIC_MATCH: "PASS" as const,
    ...options.axes
  };
  const lines = LIVE_CANARIES.map((canary, index) => `IMAGE_${index + 1} canary=${canary}`);
  if (options.observe === "complete") {
    lines.push(
      VISUAL_QA_OBSERVE_BEGIN,
      ...Array.from({ length: LIVE_SLIDE_COUNT }, (_, index) => liveObsLine(index + 1)),
      "COMPARE OBJECT_IDENTITY identity_change=NO",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END
    );
  }
  lines.push(
    VISUAL_QA_BEGIN,
    JSON.stringify({
      topic: "x",
      verdict: options.verdict ?? "PASS",
      axes,
      evidence: {},
      frames_used: []
    }),
    VISUAL_QA_END
  );
  return lines.join("\n");
}

describe("carousel live judge retry behavior", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function prepareLive() {
    const qaDir = mkdtempSync(join(tmpdir(), "vq-carousel-live-"));
    dirs.push(qaDir);
    const sha256 = createHash("sha256").update(TINY_PNG).digest("hex");
    const slides = LIVE_CANARIES.map((canary, index) => {
      const name = `slide-${String(index + 1).padStart(2, "0")}.png`;
      writeFileSync(join(qaDir, name), TINY_PNG);
      return {
        name,
        slide: index + 1,
        source: `source-${index + 1}.png`,
        canary,
        sha256
      };
    });
    const sidecar = { topic: "球鞋", date: "2026-09-28", slot: 1, slides };
    const basePrompt = buildCarouselJudgePrompt({
      slides: slides.map((slide) => ({ imageIndex: slide.slide, name: slide.name, slide: slide.slide })),
      topic: sidecar.topic
    });
    return { qaDir, slides, sidecar, basePrompt, promptHash: hashText(basePrompt) };
  }

  function fakeJudge(stdouts: string[]) {
    const calls: Array<{ attempt: number; prompt: string; images: string[]; stdoutPath: string }> = [];
    const runJudge = (req: { attempt: number; prompt: string; images: string[]; stdoutPath: string }) => {
      calls.push({ ...req, images: [...req.images] });
      const next = stdouts[calls.length - 1];
      if (next === undefined) throw new Error(`unexpected judge call ${calls.length}`);
      writeFileSync(req.stdoutPath, next, "utf8");
    };
    return { calls, runJudge };
  }

  it("T1 axis FAIL with incomplete OBS is not retried", async () => {
    const fixture = prepareLive();
    const first = liveCarouselStdout({
      observe: "none",
      axes: { OBJECT_IDENTITY: "FAIL" },
      verdict: "PASS"
    });
    const second = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record, attempts } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t1",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(attempts).toBe(1);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_observation");
    expect(record.axes.OBJECT_IDENTITY).toBe("FAIL");
    expect(record.judge_verdict).toBe("PASS");
    expect(record.judge_attempt).toBe(1);
  });

  it("T2 top-level FAIL with incomplete OBS is not retried", async () => {
    const fixture = prepareLive();
    const first = liveCarouselStdout({ observe: "none", verdict: "FAIL" });
    const second = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t2",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(record.judge_verdict).toBe("FAIL");
    expect(record.verdict).not.toBe("PASS");
    expect(record.judge_attempt).toBe(1);
  });

  it("T3 allowed retry records provenance and keeps the first stdout", async () => {
    const fixture = prepareLive();
    const first = liveCarouselStdout({ observe: "none" });
    const second = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record, attempts } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t3",
      promptHash: fixture.promptHash,
      runJudge
    });
    const retryPrompt = carouselJudgePromptForAttempt({
      basePrompt: fixture.basePrompt,
      attempt: 2,
      slideCount: LIVE_SLIDE_COUNT
    });
    expect(calls).toHaveLength(2);
    expect(attempts).toBe(2);
    expect(record.verdict).toBe("PASS");
    expect(record.judge_attempt).toBe(2);
    expect(calls[0]?.prompt).toBe(fixture.basePrompt);
    expect(calls[1]?.prompt).toBe(retryPrompt);
    expect(calls[1]?.prompt).toContain(`OBS_${LIVE_SLIDE_COUNT}`);
    expect(calls[1]?.prompt).not.toContain(`OBS_${LIVE_SLIDE_COUNT + 1}`);
    expect(calls[0]?.stdoutPath).not.toBe(calls[1]?.stdoutPath);
    expect(readFileSync(calls[0]!.stdoutPath, "utf8")).toBe(first);
    const log = record.judge_attempt_log ?? [];
    expect(log).toHaveLength(2);
    expect(log[0]?.prompt_sha256).toBe(hashText(calls[0]!.prompt));
    expect(log[1]?.prompt_sha256).toBe(hashText(calls[1]!.prompt));
    expect(log[0]?.stdout_sha256).toBe(hashText(first));
    expect(log[1]?.stdout_sha256).toBe(hashText(second));
    expect(log[0]?.stdout_file).not.toBe(log[1]?.stdout_file);
    expect(log[0]?.stdout_file).toBe(basename(calls[0]!.stdoutPath));
    expect(log[1]?.stdout_file).toBe(basename(calls[1]!.stdoutPath));
    expect(record.prompt_hash).toBe(fixture.promptHash);
    expect(readFileSync(join(fixture.qaDir, "judge-prompt-retry.txt"), "utf8")).toBe(retryPrompt);
  });

  it("T4 content FAIL on the retry stays FAIL", async () => {
    const fixture = prepareLive();
    const first = liveCarouselStdout({ observe: "none" });
    const second = liveCarouselStdout({
      observe: "complete",
      axes: { OBJECT_IDENTITY: "FAIL" },
      verdict: "FAIL"
    });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record, attempts } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t4",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(2);
    expect(attempts).toBe(2);
    expect(record.verdict).toBe("FAIL");
    expect(record.fail_class).toBe("content");
    expect(record.judge_attempt).toBe(2);
  });

  it("T5 supplied stdoutFile does not call runJudge", async () => {
    const fixture = prepareLive();
    const stdout = liveCarouselStdout({ observe: "complete" });
    const stdoutFile = join(fixture.qaDir, "supplied-judge-stdout.txt");
    writeFileSync(stdoutFile, stdout, "utf8");
    const { calls, runJudge } = fakeJudge([stdout]);
    const { record, attempts } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t5",
      promptHash: fixture.promptHash,
      stdoutFile,
      runJudge
    });
    expect(calls).toHaveLength(0);
    expect(attempts).toBe(1);
    expect(record.judge_attempt).toBe(1);
    expect(record.judge_attempt_log?.[0]?.stdout_file).toBe("supplied-judge-stdout.txt");
    expect(record.judge_attempt_log?.[0]?.prompt_sha256).toBe(hashText(fixture.basePrompt));
    expect(record.judge_attempt_log?.[0]?.stdout_sha256).toBe(hashText(stdout));
  });

  it("T6 second runJudge writes stdout then throws keeps the first record", async () => {
    const fixture = prepareLive();
    const first = liveCarouselStdout({ observe: "none" });
    const second = "IMAGE_1 canary=K7P2\npartial crash stdout\n";
    const calls: Array<{ attempt: number; prompt: string; images: string[]; stdoutPath: string }> = [];
    const runJudge = (req: { attempt: number; prompt: string; images: string[]; stdoutPath: string }) => {
      calls.push({ ...req, images: [...req.images] });
      if (calls.length === 1) {
        writeFileSync(req.stdoutPath, first, "utf8");
        return;
      }
      writeFileSync(req.stdoutPath, second, "utf8");
      throw new Error("judge crashed after writing stdout");
    };
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t6",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.judge_attempt).toBe(1);
    const log = record.judge_attempt_log ?? [];
    expect(log).toHaveLength(2);
    expect(log[1]?.error).toBe("judge_failed");
    expect(log[1]?.verdict).toBeNull();
    expect(log[1]?.fail_class).toBeNull();
    expect(log[1]?.stdout_sha256).toBe(hashText(second));
    expect(log[1]?.prompt_sha256).toBe(hashText(calls[1]!.prompt));
    expect(log[1]?.stdout_file).toBe(basename(calls[1]!.stdoutPath));
  });

  it("T7 first runJudge throw propagates and returns no record", async () => {
    const fixture = prepareLive();
    const boom = new Error("judge boom");
    await expect(
      runCarouselJudgeLive({
        basePrompt: fixture.basePrompt,
        slides: fixture.slides,
        qaDir: fixture.qaDir,
        sidecar: fixture.sidecar,
        runId: "t7",
        promptHash: fixture.promptHash,
        runJudge: () => {
          throw boom;
        }
      })
    ).rejects.toBe(boom);
  });

  it("T8 replay of incomplete OBS does not call runJudge and attempts once", async () => {
    const fixture = prepareLive();
    const stdout = liveCarouselStdout({ observe: "none" });
    const stdoutFile = join(fixture.qaDir, "supplied-judge-stdout.txt");
    writeFileSync(stdoutFile, stdout, "utf8");
    const { calls, runJudge } = fakeJudge([stdout]);
    const { attempts } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t8",
      promptHash: fixture.promptHash,
      stdoutFile,
      runJudge
    });
    expect(calls).toHaveLength(0);
    expect(attempts).toBe(1);
  });

  it("T9 runJudge images are the canary copies in qaDir", async () => {
    const fixture = prepareLive();
    const stdout = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([stdout]);
    await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t9",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.images).toEqual(fixture.slides.map((slide) => join(fixture.qaDir, slide.name)));
  });

  it("T10 SCENE FAIL with incomplete OBS is not retried", async () => {
    const fixture = prepareLive();
    const first = liveCarouselStdout({
      observe: "none",
      axes: { SCENE: "FAIL" },
      verdict: "PASS"
    });
    const second = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t10",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(record.verdict).not.toBe("PASS");
  });

  it("T11 TOPIC_MATCH FAIL with incomplete OBS is not retried", async () => {
    const fixture = prepareLive();
    const first = liveCarouselStdout({
      observe: "none",
      axes: { TOPIC_MATCH: "FAIL" },
      verdict: "PASS"
    });
    const second = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t11",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(record.verdict).not.toBe("PASS");
  });

  it("T12 COMPARE identity_change YES without OBS lines is not retried", async () => {
    const fixture = prepareLive();
    const axes = {
      OBJECT_IDENTITY: "PASS" as const,
      SCENE: "PASS" as const,
      TOPIC_MATCH: "PASS" as const
    };
    const first = [
      ...LIVE_CANARIES.map((canary, index) => `IMAGE_${index + 1} canary=${canary}`),
      VISUAL_QA_OBSERVE_BEGIN,
      "COMPARE OBJECT_IDENTITY identity_change=YES",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END,
      VISUAL_QA_BEGIN,
      JSON.stringify({ topic: "x", verdict: "PASS", axes, evidence: {}, frames_used: [] }),
      VISUAL_QA_END
    ].join("\n");
    const second = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t12",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(record.judge_declared_change).toBe(true);
    expect(record.verdict).not.toBe("PASS");
    expect(record.fail_class).toBe("missing_observation");
  });

  it("T13 malformed JSON with nested verdict before top-level FAIL is unparseable", async () => {
    const fixture = prepareLive();
    const first = [
      ...LIVE_CANARIES.map((canary, index) => `IMAGE_${index + 1} canary=${canary}`),
      VISUAL_QA_BEGIN,
      '{"evidence":{"OBJECT_IDENTITY":"nested","verdict":"PASS"},"verdict":"FAIL","axes":{"OBJECT_IDENTITY":"PASS","SCENE":"PASS","TOPIC_MATCH":"PASS"},"frames_used":[],}',
      VISUAL_QA_END
    ].join("\n");
    const second = liveCarouselStdout({ observe: "complete" });
    const { calls, runJudge } = fakeJudge([first, second]);
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t13",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("unparseable");
  });

  it("T14 two VISUAL_QA blocks are unparseable", async () => {
    const fixture = prepareLive();
    const extraAxes = {
      OBJECT_IDENTITY: "PASS" as const,
      SCENE: "PASS" as const,
      TOPIC_MATCH: "PASS" as const
    };
    const stdout = [
      liveCarouselStdout({ observe: "complete" }),
      VISUAL_QA_BEGIN,
      JSON.stringify({ topic: "y", verdict: "FAIL", axes: extraAxes, evidence: {}, frames_used: [] }),
      VISUAL_QA_END
    ].join("\n");
    const { calls, runJudge } = fakeJudge([stdout, liveCarouselStdout({ observe: "complete" })]);
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t14",
      promptHash: fixture.promptHash,
      runJudge
    });
    expect(calls).toHaveLength(1);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("unparseable");
  });

  function passAxes() {
    return {
      OBJECT_IDENTITY: "PASS" as const,
      SCENE: "PASS" as const,
      TOPIC_MATCH: "PASS" as const
    };
  }

  function compareOnlyStdout(compareLines: string[], jsonRaw?: string): string {
    return [
      ...LIVE_CANARIES.map((canary, index) => `IMAGE_${index + 1} canary=${canary}`),
      VISUAL_QA_OBSERVE_BEGIN,
      ...compareLines,
      VISUAL_QA_OBSERVE_END,
      VISUAL_QA_BEGIN,
      jsonRaw ??
        JSON.stringify({ topic: "x", verdict: "PASS", axes: passAxes(), evidence: {}, frames_used: [] }),
      VISUAL_QA_END
    ].join("\n");
  }

  async function runOnce(runId: string, first: string, second = liveCarouselStdout({ observe: "complete" as const })) {
    const fixture = prepareLive();
    const { calls, runJudge } = fakeJudge([first, second]);
    const result = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId,
      promptHash: fixture.promptHash,
      runJudge
    });
    return { ...result, calls };
  }

  it("T15 COMPARE OBJECT_IDENTITY duplicated YES then NO is unparseable and not retried", async () => {
    const { calls, record } = await runOnce(
      "t15",
      compareOnlyStdout([
        "COMPARE OBJECT_IDENTITY identity_change=YES",
        "COMPARE OBJECT_IDENTITY identity_change=NO",
        "COMPARE SCENE scene_change=NO",
        "COMPARE TOPIC_MATCH object_mismatch=NO"
      ])
    );
    expect(calls).toHaveLength(1);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("unparseable");
  });

  it("T16 COMPARE SCENE duplicated NO then YES is unparseable and not retried", async () => {
    const { calls, record } = await runOnce(
      "t16",
      compareOnlyStdout([
        "COMPARE OBJECT_IDENTITY identity_change=NO",
        "COMPARE SCENE scene_change=NO",
        "COMPARE SCENE scene_change=YES",
        "COMPARE TOPIC_MATCH object_mismatch=NO"
      ])
    );
    expect(calls).toHaveLength(1);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("unparseable");
  });

  it("T27 COMPARE TOPIC_MATCH duplicated YES then NO is unparseable and not retried", async () => {
    const { calls, record } = await runOnce(
      "t27",
      compareOnlyStdout([
        "COMPARE OBJECT_IDENTITY identity_change=NO",
        "COMPARE SCENE scene_change=NO",
        "COMPARE TOPIC_MATCH object_mismatch=YES",
        "COMPARE TOPIC_MATCH object_mismatch=NO"
      ])
    );
    expect(calls).toHaveLength(1);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("unparseable");
  });

  it("T17 one COMPARE line per axis is not treated as ambiguous", async () => {
    const { calls, record } = await runOnce("t17", liveCarouselStdout({ observe: "complete" }));
    expect(calls).toHaveLength(1);
    expect(record.verdict).toBe("PASS");
    expect(record.fail_class).not.toBe("unparseable");
  });

  it("T18 COMPARE SCENE scene_change YES without OBS lines is not retried", async () => {
    const { calls, record } = await runOnce(
      "t18",
      compareOnlyStdout([
        "COMPARE OBJECT_IDENTITY identity_change=NO",
        "COMPARE SCENE scene_change=YES",
        "COMPARE TOPIC_MATCH object_mismatch=NO"
      ])
    );
    expect(calls).toHaveLength(1);
    expect(record.judge_declared_change).toBe(true);
    expect(record.verdict).not.toBe("PASS");
  });

  it("T19 COMPARE TOPIC_MATCH object_mismatch YES without OBS lines is not retried", async () => {
    const { calls, record } = await runOnce(
      "t19",
      compareOnlyStdout([
        "COMPARE OBJECT_IDENTITY identity_change=NO",
        "COMPARE SCENE scene_change=NO",
        "COMPARE TOPIC_MATCH object_mismatch=YES"
      ])
    );
    expect(calls).toHaveLength(1);
    expect(record.judge_declared_change).toBe(true);
    expect(record.verdict).not.toBe("PASS");
  });

  it("T20 valid JSON with nested verdict string is not unparseable", async () => {
    const axes = passAxes();
    const jsonRaw = JSON.stringify({
      topic: "x",
      verdict: "PASS",
      axes,
      evidence: { OBJECT_IDENTITY: 'nested says "verdict":"PASS" here' },
      frames_used: [],
      shadow: { verdict: "PASS" }
    });
    const stdout = [
      ...LIVE_CANARIES.map((canary, index) => `IMAGE_${index + 1} canary=${canary}`),
      VISUAL_QA_OBSERVE_BEGIN,
      ...Array.from({ length: LIVE_SLIDE_COUNT }, (_, index) => liveObsLine(index + 1)),
      "COMPARE OBJECT_IDENTITY identity_change=NO",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END,
      VISUAL_QA_BEGIN,
      jsonRaw,
      VISUAL_QA_END
    ].join("\n");
    const { record } = await runOnce("t20", stdout);
    expect(record.fail_class).not.toBe("unparseable");
  });

  it("T21 malformed JSON with duplicate SCENE key is unparseable", async () => {
    const jsonRaw = [
      "{",
      '"topic":"x",',
      '"verdict":"PASS",',
      '"axes":{"OBJECT_IDENTITY":"PASS","SCENE":"PASS","TOPIC_MATCH":"PASS","SCENE":"FAIL"},',
      '"evidence":{},',
      '"frames_used":[],',
      "}"
    ].join("");
    const first = [
      ...LIVE_CANARIES.map((canary, index) => `IMAGE_${index + 1} canary=${canary}`),
      VISUAL_QA_BEGIN,
      jsonRaw,
      VISUAL_QA_END
    ].join("\n");
    const { calls, record } = await runOnce("t21", first);
    expect(calls).toHaveLength(1);
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("unparseable");
  });

  it("T22 attempt 2 missing stdout file is stdout_unreadable", async () => {
    const fixture = prepareLive();
    const calls: number[] = [];
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t22",
      promptHash: fixture.promptHash,
      runJudge: (req) => {
        calls.push(req.attempt);
        if (req.attempt === 1) {
          writeFileSync(req.stdoutPath, liveCarouselStdout({ observe: "none" }), "utf8");
        }
      }
    });
    const entry = record.judge_attempt_log?.find((item) => item.attempt === 2);
    expect(calls).toEqual([1, 2]);
    expect(entry?.error).toBe("stdout_unreadable");
    expect(entry?.stdout_sha256).toBeNull();
  });

  it("T23 attempt 2 evaluate throw is evaluate_failed", async () => {
    const fixture = prepareLive();
    let evaluations = 0;
    const { record } = await runCarouselJudgeLive({
      basePrompt: fixture.basePrompt,
      slides: fixture.slides,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      runId: "t23",
      promptHash: fixture.promptHash,
      runJudge: (req) => {
        const stdout =
          req.attempt === 1
            ? liveCarouselStdout({ observe: "none" })
            : liveCarouselStdout({ observe: "complete" });
        writeFileSync(req.stdoutPath, stdout, "utf8");
      },
      evaluateFromDisk: async (input) => {
        evaluations += 1;
        if (evaluations === 2) throw new Error("injected evaluate failure");
        return evaluateCarouselFromDisk(input);
      }
    });
    const entry = record.judge_attempt_log?.find((item) => item.attempt === 2);
    expect(evaluations).toBe(2);
    expect(entry?.error).toBe("evaluate_failed");
  });

  function fakeCodex(stdouts: string[]) {
    const calls: Array<{ root: string; prompt: string; images: string[]; stdoutPath: string }> = [];
    const runCodex = (args: { root: string; prompt: string; images: string[]; stdoutPath: string }) => {
      calls.push({
        root: args.root,
        prompt: args.prompt,
        images: [...args.images],
        stdoutPath: args.stdoutPath
      });
      const next = stdouts[calls.length - 1];
      if (next === undefined) throw new Error(`unexpected codex call ${calls.length}`);
      writeFileSync(args.stdoutPath, next, "utf8");
    };
    return { calls, runCodex };
  }

  it("C1 retry hands attempt-2 prompt and the given root to runCodex", async () => {
    const fixture = prepareLive();
    const cliRoot = join(fixture.qaDir, "cli-root");
    const { calls, runCodex } = fakeCodex([
      liveCarouselStdout({ observe: "none" }),
      liveCarouselStdout({ observe: "complete" })
    ]);
    await runCarouselLiveCli({
      root: cliRoot,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      slides: fixture.slides,
      topic: fixture.sidecar.topic,
      runId: "c1",
      runCodex
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.prompt).toBe(
      carouselJudgePromptForAttempt({
        basePrompt: fixture.basePrompt,
        attempt: 2,
        slideCount: fixture.slides.length
      })
    );
    expect(calls[1]?.root).toBe(cliRoot);
  });

  it("C2 runCodex writes args.stdoutPath and the retry PASS sticks", async () => {
    const fixture = prepareLive();
    const { runCodex } = fakeCodex([
      liveCarouselStdout({ observe: "none" }),
      liveCarouselStdout({ observe: "complete" })
    ]);
    const { record } = await runCarouselLiveCli({
      root: fixture.qaDir,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      slides: fixture.slides,
      topic: fixture.sidecar.topic,
      runId: "c2",
      runCodex
    });
    expect(record.verdict).toBe("PASS");
    expect(record.judge_attempt).toBe(2);
  });

  it("C3 runCodex images are the canary copies in qaDir", async () => {
    const fixture = prepareLive();
    const { calls, runCodex } = fakeCodex([liveCarouselStdout({ observe: "complete" })]);
    await runCarouselLiveCli({
      root: fixture.qaDir,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      slides: fixture.slides,
      topic: fixture.sidecar.topic,
      runId: "c3",
      runCodex
    });
    expect(calls[0]?.images).toEqual(fixture.slides.map((slide) => join(fixture.qaDir, slide.name)));
  });

  it("C4 stdoutFile replay does not call runCodex", async () => {
    const fixture = prepareLive();
    const stdout = liveCarouselStdout({ observe: "complete" });
    const stdoutFile = join(fixture.qaDir, "supplied-judge-stdout.txt");
    writeFileSync(stdoutFile, stdout, "utf8");
    let calls = 0;
    const { record } = await runCarouselLiveCli({
      root: fixture.qaDir,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      slides: fixture.slides,
      topic: fixture.sidecar.topic,
      runId: "c4",
      stdoutFile,
      runCodex: () => {
        calls += 1;
      }
    });
    expect(calls).toBe(0);
    expect(record.judge_attempt).toBe(1);
  });

  it("C5 judge-prompt.txt is the base prompt and prompt_hash matches that file", async () => {
    const fixture = prepareLive();
    const { runCodex } = fakeCodex([liveCarouselStdout({ observe: "complete" })]);
    const { record } = await runCarouselLiveCli({
      root: fixture.qaDir,
      qaDir: fixture.qaDir,
      sidecar: fixture.sidecar,
      slides: fixture.slides,
      topic: fixture.sidecar.topic,
      runId: "c5",
      runCodex
    });
    const written = readFileSync(join(fixture.qaDir, "judge-prompt.txt"), "utf8");
    expect(written).toBe(fixture.basePrompt);
    expect(record.prompt_hash).toBe(hashText(written));
  });
});

describe("carousel mutations", () => {
  it("mutation: removing OBJECT_IDENTITY from the verdict is FAIL_CLOSED missing_axis", () => {
    const stdout = [
      "IMAGE_1 canary=K7P2",
      "IMAGE_2 canary=M3Q8",
      "IMAGE_3 canary=N4R5",
      "IMAGE_4 canary=P6S7",
      VISUAL_QA_BEGIN,
      JSON.stringify({
        topic: "x",
        verdict: "PASS",
        axes: { SCENE: "PASS", TOPIC_MATCH: "PASS" },
        evidence: {},
        frames_used: []
      }),
      VISUAL_QA_END
    ].join("\n");
    const record = carouselEvaluate(stdout, "衣物");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("missing_axis");
    expect(record.axes.OBJECT_IDENTITY).toBe("MISSING");
  });

  it("mutation: dropping canaries is judge_blind", () => {
    const axes = Object.fromEntries(CAROUSEL_QA_AXES.map((axis) => [axis, "PASS"]));
    const stdout = [
      VISUAL_QA_BEGIN,
      JSON.stringify({ topic: "x", verdict: "PASS", axes, evidence: {}, frames_used: [] }),
      VISUAL_QA_END
    ].join("\n");
    const record = carouselEvaluate(stdout, "衣物");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("judge_blind");
  });

  it("declared type mix with OBJECT_IDENTITY PASS is rubric_incoherent", () => {
    const stdout = [
      "IMAGE_1 canary=K7P2",
      "IMAGE_2 canary=M3Q8",
      "IMAGE_3 canary=N4R5",
      "IMAGE_4 canary=P6S7",
      VISUAL_QA_OBSERVE_BEGIN,
      "OBS_1 garment_color=NAVY garment_type=TEE material=KNIT wear=HEAVY scene=PINK_MAT_SLAT",
      "OBS_2 garment_color=CREAM garment_type=SHIRT material=WOVEN wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_3 garment_color=BLUE garment_type=SHIRT material=WOVEN wear=LIGHT scene=PINK_MAT_SLAT",
      "OBS_4 garment_color=BLUE garment_type=SHIRT material=WOVEN wear=LIGHT scene=PINK_MAT_SLAT",
      "COMPARE OBJECT_IDENTITY identity_change=YES",
      "COMPARE SCENE scene_change=NO",
      "COMPARE TOPIC_MATCH object_mismatch=NO",
      VISUAL_QA_OBSERVE_END,
      VISUAL_QA_BEGIN,
      JSON.stringify({
        topic: "x",
        verdict: "PASS",
        axes: { OBJECT_IDENTITY: "PASS", SCENE: "PASS", TOPIC_MATCH: "PASS" },
        evidence: {},
        frames_used: []
      }),
      VISUAL_QA_END
    ].join("\n");
    expect(
      detectCarouselRubricIncoherence(
        stdout,
        Object.fromEntries(CAROUSEL_QA_AXES.map((axis) => [axis, "PASS"])) as Record<CarouselQaAxis, "PASS">,
        "深色衣服"
      )
    ).toBe(true);
    const record = carouselEvaluate(stdout, "深色衣服");
    expect(record.verdict).toBe("FAIL_CLOSED");
    expect(record.fail_class).toBe("rubric_incoherent");
  });
});

describe("carousel warn-mode wiring", () => {
  it("generate-missing-images calls carousel QA after a complete slot and does not block", () => {
    expect(generateImagesSrc).toContain("Invoke-CarouselVisualQaWarning");
    expect(generateImagesSrc).toContain("Carousel visual-qa (warning)");
    expect(generateImagesSrc).toContain("--carousel");
    expect(generateImagesSrc).toContain("slot-$pad.visual-qa.json");
    expect(generateImagesSrc).toContain("warning mode; publish is not blocked");
    expect(generateImagesSrc).toContain("warning mode continues");
    expect(generateImagesSrc).toContain("Test-CarouselSlotComplete");
    expect(generateImagesSrc).toContain("Ensure-CarouselVisualQa");
    expect(generateImagesSrc).toContain("[switch]$QaOnly");
    expect(generateImagesSrc).toContain("topic tempfile write failed");
    expect(generateImagesSrc).toContain("visual-qa.json write failed");
    expect(generateImagesSrc).not.toMatch(/if \(\$record\.verdict -ne ["']PASS["']\)/u);
    expect(generateImagesSrc).not.toMatch(/exit 2/u);
  });

  it("live 8/17 calibration snapshots still discriminate", () => {
    const red = JSON.parse(
      readFileSync(join(carouselFixtureDir, "carousel-mixed-garments", "live.visual-qa.json"), "utf8")
    ) as { verdict: string; axes: Record<string, string> };
    const green = JSON.parse(
      readFileSync(join(carouselFixtureDir, "carousel-rain-shoes", "live.visual-qa.json"), "utf8")
    ) as { verdict: string; fail_class: string | null; axes: Record<string, string> };
    expect(red.verdict).toBe("FAIL");
    expect(red.axes.OBJECT_IDENTITY).toBe("FAIL");
    expect(green.verdict).toBe("PASS");
    expect(green.fail_class).toBeNull();
    expect(green.axes.OBJECT_IDENTITY).toBe("PASS");
  });
});

describe("carousel CLI surface", () => {
  it("visualQaCli accepts --carousel emit-prompt for a file list", () => {
    const cliSrc = readFileSync(join(root, "src", "visualQaCli.ts"), "utf8");
    expect(cliSrc).toContain("handleCarousel");
    expect(cliSrc).toContain("--carousel");
    expect(cliSrc).toContain("buildCarouselJudgePrompt");
    expect(cliSrc).toContain('-s", "read-only"');
    expect(cliSrc).toContain('"-i"');
    expect(cliSrc).not.toMatch(/Generate exactly two images/u);
    const out = execFileSync(
      process.execPath,
      [
        join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        join(root, "src", "visualQaCli.ts"),
        "--carousel",
        "--emit-prompt",
        "--files",
        "slide-01.png,slide-02.png,slide-03.png,slide-04.png",
        "--topic",
        "衣物送洗"
      ],
      { cwd: root, encoding: "utf8" }
    );
    expect(out).toContain("OBJECT_IDENTITY");
    expect(out).toContain("TOPIC_MATCH");
    expect(out).toContain("PROMPT_HASH=");
    expect(out).toMatch(/Do not generate or edit any image/i);
  });
});

describe("carousel handleCarousel wiring", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function prepareCli() {
    const dir = mkdtempSync(join(tmpdir(), "vq-carousel-cli-"));
    dirs.push(dir);
    const sourceDir = join(dir, "sources");
    const qaDir = join(dir, "qa");
    mkdirSync(sourceDir, { recursive: true });
    const sources = [1, 2, 3].map((index) => {
      const file = join(sourceDir, `source-${index}.png`);
      writeFileSync(file, TINY_PNG);
      return file;
    });
    return { dir, qaDir, sources, outPath: join(dir, "out.json") };
  }

  async function fakeBurn(input: { sources: string[]; qaDir: string; canaries?: string[] }) {
    mkdirSync(input.qaDir, { recursive: true });
    const sha256 = createHash("sha256").update(TINY_PNG).digest("hex");
    return input.sources.map((source, index) => {
      const canary = input.canaries?.[index] ?? LIVE_CANARIES[index] ?? "AAAA";
      const name = `slide-${String(index + 1).padStart(2, "0")}.png`;
      writeFileSync(join(input.qaDir, name), TINY_PNG);
      return { name, slide: index + 1, source, canary, sha256 };
    });
  }

  it("T24 handleCarousel forwards runCodexJudge", async () => {
    const fixture = prepareCli();
    await expect(
      handleCarousel(
        [
          "--files",
          fixture.sources.join(","),
          "--topic",
          "球鞋 generate exactly",
          "--qa-dir",
          fixture.qaDir,
          "--out",
          fixture.outPath
        ],
        fixture.dir,
        fakeBurn
      )
    ).rejects.toThrow("QA prompt contains image-generation language; refusing to call Codex.");
  });

  it("T25 handleCarousel forwards stdoutFile and does not call runCodex", async () => {
    const fixture = prepareCli();
    const stdoutFile = join(fixture.dir, "supplied-stdout.txt");
    writeFileSync(stdoutFile, liveCarouselStdout({ observe: "complete" }), "utf8");
    await handleCarousel(
      [
        "--files",
        fixture.sources.join(","),
        "--topic",
        "球鞋 generate exactly",
        "--qa-dir",
        fixture.qaDir,
        "--stdout-file",
        stdoutFile,
        "--out",
        fixture.outPath,
        "--run-id",
        "t25-stdout-forward"
      ],
      fixture.dir,
      fakeBurn
    );
    const record = JSON.parse(readFileSync(fixture.outPath, "utf8")) as {
      verdict: string;
      fail_class: string | null;
    };
    expect(record.verdict).toBe("PASS");
    expect(record.fail_class).toBeNull();
  });

  it("T26 handleCarousel forwards runId onto the record", async () => {
    const fixture = prepareCli();
    const stdoutFile = join(fixture.dir, "supplied-stdout.txt");
    writeFileSync(stdoutFile, liveCarouselStdout({ observe: "complete" }), "utf8");
    await handleCarousel(
      [
        "--files",
        fixture.sources.join(","),
        "--topic",
        "球鞋 generate exactly",
        "--qa-dir",
        fixture.qaDir,
        "--stdout-file",
        stdoutFile,
        "--out",
        fixture.outPath,
        "--run-id",
        "carousel-run-t26"
      ],
      fixture.dir,
      fakeBurn
    );
    const record = JSON.parse(readFileSync(fixture.outPath, "utf8")) as { run_id: string };
    expect(record.run_id).toBe("carousel-run-t26");
  });

  it("T28 handleCarousel succeeds with a generated runId when --run-id is omitted", async () => {
    const fixture = prepareCli();
    const stdoutFile = join(fixture.dir, "supplied-stdout.txt");
    writeFileSync(stdoutFile, liveCarouselStdout({ observe: "complete" }), "utf8");
    await handleCarousel(
      [
        "--files",
        fixture.sources.join(","),
        "--topic",
        "球鞋 generate exactly",
        "--qa-dir",
        fixture.qaDir,
        "--stdout-file",
        stdoutFile,
        "--out",
        fixture.outPath
      ],
      fixture.dir,
      fakeBurn
    );
    const record = JSON.parse(readFileSync(fixture.outPath, "utf8")) as {
      run_id: string;
      verdict: string;
    };
    expect(record.verdict).toBe("PASS");
    expect(record.run_id).toMatch(/^carousel-qa-\d+$/);
  });
});
