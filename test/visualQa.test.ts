import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { validatePublishableReel } from "../src/generateVideo";
import { visualQaAcceptedReviewer } from "../src/videoReviewGate";
import {
  assertCarouselJudgePromptSafe,
  assertJudgePromptSafe,
  buildCarouselJudgePrompt,
  buildIsolationPlan,
  buildJudgePrompt,
  CAROUSEL_OBS_RETRY_MAX_ATTEMPTS,
  CAROUSEL_QA_AXES,
  detectCarouselRubricIncoherence,
  detectTreatment,
  evaluateCarouselJudgeStdout,
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
  runCarouselJudgeWithMissingObservationRetry,
  shouldRetryCarouselJudge,
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
    expect(prompt).toMatch(/Emit exactly 4 OBS lines \(OBS_1 through OBS_4\)/);
    expect(prompt).toMatch(/Missing or extra OBS lines make the run invalid even if every axis is PASS/);
    expect(prompt).not.toContain("ACCESSORY_COLOR");
    expect(prompt).not.toContain("MIDDLE_NOT_WORSE");
  });

  it("names the exact OBS count for a two-slide set", () => {
    const prompt = buildCarouselJudgePrompt({
      slides: [
        { imageIndex: 1, name: "slide-01.png", slide: 1 },
        { imageIndex: 2, name: "slide-02.png", slide: 2 }
      ],
      topic: "衣物送洗前先看材質"
    });
    expect(prompt).toMatch(/Emit exactly 2 OBS lines \(OBS_1 through OBS_2\)/);
    expect(prompt).not.toMatch(/Emit exactly 4 OBS lines/);
  });

  it("mutation: dropping the exact-OBS-count demand is rejected", () => {
    const prompt = buildCarouselJudgePrompt({
      slides: carouselFourSlides(),
      topic: "衣物送洗前先看材質"
    });
    const mutated = prompt.replace(/Emit exactly \d+ OBS lines[^\n]*/u, "");
    expect(mutated).not.toMatch(/Emit exactly \d+ OBS lines/);
    expect(() => assertCarouselJudgePromptSafe(mutated)).toThrow(/OBSERVE block/);
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

describe("carousel OBS emitter retry", () => {
  it("retries only missing_observation, and only before the last attempt", () => {
    expect(CAROUSEL_OBS_RETRY_MAX_ATTEMPTS).toBe(2);
    expect(shouldRetryCarouselJudge("missing_observation", 1)).toBe(true);
    expect(shouldRetryCarouselJudge("missing_observation", 2)).toBe(false);
    expect(shouldRetryCarouselJudge("content", 1)).toBe(false);
    expect(shouldRetryCarouselJudge("unparseable", 1)).toBe(false);
    expect(shouldRetryCarouselJudge("judge_blind", 1)).toBe(false);
    expect(shouldRetryCarouselJudge("missing_axis", 1)).toBe(false);
    expect(shouldRetryCarouselJudge(null, 1)).toBe(false);
  });

  it("retries once when the first carousel judge omits OBS, then keeps the second verdict", async () => {
    const calls: number[] = [];
    const { record, attempts } = await runCarouselJudgeWithMissingObservationRetry(async (attempt) => {
      calls.push(attempt);
      if (attempt === 1) return { fail_class: "missing_observation" as const };
      return { fail_class: null };
    });
    expect(calls).toEqual([1, 2]);
    expect(attempts).toBe(2);
    expect(record.fail_class).toBeNull();
  });

  it("does not retry a content fail or a first-try PASS", async () => {
    const contentCalls: number[] = [];
    const content = await runCarouselJudgeWithMissingObservationRetry(async (attempt) => {
      contentCalls.push(attempt);
      return { fail_class: "content" as const };
    });
    expect(contentCalls).toEqual([1]);
    expect(content.attempts).toBe(1);
    expect(content.record.fail_class).toBe("content");

    const passCalls: number[] = [];
    const passed = await runCarouselJudgeWithMissingObservationRetry(async (attempt) => {
      passCalls.push(attempt);
      return { fail_class: null };
    });
    expect(passCalls).toEqual([1]);
    expect(passed.attempts).toBe(1);
    expect(passed.record.fail_class).toBeNull();
  });

  it("keeps FAIL_CLOSED after a second missing OBS (does not pass-open)", async () => {
    const { record, attempts } = await runCarouselJudgeWithMissingObservationRetry(async () => ({
      fail_class: "missing_observation" as const
    }));
    expect(attempts).toBe(2);
    expect(record.fail_class).toBe("missing_observation");
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
    expect(cliSrc).toContain("runCarouselJudgeWithMissingObservationRetry");
    expect(cliSrc).toContain("injectedStdout");
    expect(cliSrc).toContain('-s", "read-only"');
    expect(cliSrc).toContain('"-i"');
    expect(cliSrc).not.toMatch(/Generate exactly two images/u);
    const fnStart = cliSrc.indexOf("async function handleCarousel");
    const fnEnd = cliSrc.indexOf("async function main");
    const fn = cliSrc.slice(fnStart, fnEnd);
    const injectedIdx = fn.indexOf("if (injectedStdout)");
    const retryIdx = fn.indexOf("runCarouselJudgeWithMissingObservationRetry");
    expect(injectedIdx).toBeGreaterThan(-1);
    expect(retryIdx).toBeGreaterThan(injectedIdx);
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
    expect(out).toMatch(/Emit exactly 4 OBS lines \(OBS_1 through OBS_4\)/);
  });
});
