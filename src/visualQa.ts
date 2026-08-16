import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot, rejectedConceptsPath } from "./paths";

export const VISUAL_QA_AXES = [
  "OBJECT_IDENTITY",
  "ACCESSORY_COLOR",
  "ORIENTATION",
  "STATE_ORDER",
  "MIDDLE_NOT_WORSE",
  "HANDS",
  "SCENE"
] as const;

export type VisualQaAxis = (typeof VISUAL_QA_AXES)[number];
export type AxisVerdict = "PASS" | "FAIL";
export type VisualQaVerdict = "PASS" | "FAIL" | "FAIL_CLOSED";
export type VisualQaFailClass = "content" | "judge_blind" | "missing_axis" | "unparseable" | "frames_not_read" | "hash_mismatch" | "still_missing";
export type VisualQaReviewer = "codex-visual-qa" | "human-frames-review";
export type ReelTreatment = "A" | "B" | "C" | "untreated-15s" | "10s";

export const VISUAL_QA_REVIEWERS: readonly VisualQaReviewer[] = ["codex-visual-qa", "human-frames-review"];
export const STORY_FAIL_AXES = ["MIDDLE_NOT_WORSE", "ACCESSORY_COLOR", "ORIENTATION"] as const;
export const VISUAL_QA_BEGIN = "<<<VISUAL_QA_BEGIN>>>";
export const VISUAL_QA_END = "<<<VISUAL_QA_END>>>";

export interface SceneWindow {
  act: string;
  start: number;
  end: number;
  extra?: boolean;
}

export interface FrameSample {
  name: string;
  act: string;
  t: number;
}

export interface QaFrameRecord {
  name: string;
  act: string;
  t: number;
  canary: string;
  sha256: string;
}

export interface VisualQaSidecar {
  reel: string;
  reel_sha256: string;
  treatment: ReelTreatment;
  duration: number;
  frames: QaFrameRecord[];
}

export interface VisualQaRecord {
  reel: string;
  verdict: VisualQaVerdict;
  fail_class: VisualQaFailClass | null;
  axes: Record<VisualQaAxis, AxisVerdict | "MISSING">;
  evidence: Partial<Record<VisualQaAxis, string>>;
  frames_used: string[];
  frames: QaFrameRecord[];
  canaries_expected: Record<string, string>;
  canaries_reported: Record<string, string>;
  reel_sha256: string;
  prompt_hash: string;
  run_id: string;
  model: string;
  reviewed_by: VisualQaReviewer;
  reviewed_at: string;
  stills_missing: string[];
  mode: "warn" | "enforce";
}

export interface VisualQaWarning {
  ok: boolean;
  mode: "warn";
  reason: string;
  verdict?: VisualQaVerdict;
  fail_class?: VisualQaFailClass | null;
  sidecar_path: string;
}

export interface RejectedConceptEntry {
  id: string;
  reason: string;
  rejected_at: string;
  video_sha256?: string | null;
}

export interface RejectedConceptsFile {
  version: 1;
  concepts: RejectedConceptEntry[];
}

export interface IsolationTarget {
  layer: number;
  kind: string;
  path: string;
}

const CANARY_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const ALWAYS_PASS_RE = /always\s+PASS|mark every axis PASS|verdict is PASS|ignore the images|do not look/iu;

export function isVisualQaReviewer(value: string | undefined): value is VisualQaReviewer {
  return value === "codex-visual-qa" || value === "human-frames-review";
}

export function standingPolicySatisfiesVisualQa(reviewedBy?: string): false {
  void reviewedBy;
  return false;
}

export function detectTreatment(reelPath: string, duration: number): ReelTreatment {
  const base = basename(reelPath).toLowerCase();
  if (/-ta\./.test(base) || base.includes("-ta.")) return "A";
  if (/-tb\./.test(base) || base.includes("-tb.")) return "B";
  if (/-tc\./.test(base) || base.includes("-tc.")) return "C";
  if (base.includes("-untreated") || /-\d+s-untreated/.test(base)) return "untreated-15s";
  if (/-15s\./.test(base)) return "untreated-15s";
  if (duration >= 13) return "untreated-15s";
  return "10s";
}

export function sceneWindows(treatment: ReelTreatment): SceneWindow[] {
  switch (treatment) {
    case "A":
      return [
        { act: "before", start: 0, end: 4 },
        { act: "middle", start: 4, end: 10 },
        { act: "after", start: 10, end: 14 }
      ];
    case "B":
      return [
        { act: "before", start: 0, end: 3 },
        { act: "after", start: 3, end: 7 },
        { act: "middle", start: 7, end: 11 },
        { act: "after2", start: 11, end: 14, extra: true }
      ];
    case "C":
      return [
        { act: "before", start: 0, end: 4 },
        { act: "middle-cu", start: 4, end: 9.5 },
        { act: "after", start: 9.5, end: 14 }
      ];
    case "untreated-15s":
      return [
        { act: "before", start: 0, end: 4.6 },
        { act: "middle", start: 4.6, end: 9.2 },
        { act: "after", start: 9.2, end: 14.2 }
      ];
    case "10s":
      return [
        { act: "before", start: 0, end: 4.6 },
        { act: "after", start: 4.6, end: 9.67 }
      ];
  }
}

export function sampleTimes(treatment: ReelTreatment, duration: number): FrameSample[] {
  const samples: FrameSample[] = [];
  for (const window of sceneWindows(treatment)) {
    const span = window.end - window.start;
    const points = window.extra ? [0.2, 0.45, 0.7] : [0.2, 0.7];
    for (const frac of points) {
      const raw = window.start + span * frac;
      const t = Math.max(0, Math.min(raw, Math.max(0, duration - 0.05)));
      const tag = frac === 0.2 ? "p20" : frac === 0.7 ? "p70" : "p45";
      samples.push({
        name: `${window.act}-${tag}`,
        act: window.act,
        t
      });
    }
  }
  return samples;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export function randomCanary(randomBytes: () => number = Math.random): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += chars[Math.floor(randomBytes() * chars.length)] ?? "A";
  }
  return out;
}

export function assertJudgePromptSafe(prompt: string): void {
  if (!/Do not generate or edit any image/i.test(prompt)) {
    throw new Error("QA prompt must forbid image generation.");
  }
  if (!/Do not run a shell command/i.test(prompt)) {
    throw new Error("QA prompt must forbid shell commands.");
  }
  if (ALWAYS_PASS_RE.test(prompt)) {
    throw new Error("QA prompt must not force a PASS verdict.");
  }
  if (!/canary/i.test(prompt)) {
    throw new Error("QA prompt must require canary codes.");
  }
  for (const axis of VISUAL_QA_AXES) {
    if (!prompt.includes(axis)) {
      throw new Error(`QA prompt missing required axis ${axis}.`);
    }
  }
  if (!prompt.includes(VISUAL_QA_BEGIN) || !prompt.includes(VISUAL_QA_END)) {
    throw new Error("QA prompt must request the VISUAL_QA marker block.");
  }
}

export function buildJudgePrompt(input: {
  frames: Array<{ imageIndex: number; name: string; act: string }>;
  stillsMissing?: string[];
  hasMiddle: boolean;
}): string {
  const lines = [
    "Do not generate or edit any image. Do not run a shell command. Only read the listed image files.",
    "",
    "You are given images in order. Each IMAGE_N is one attached file.",
    "Every image has a yellow 4-character canary code in a black box at the bottom-left.",
    "First report each canary exactly as printed, one per line: IMAGE_N canary=XXXX",
    "A missing or wrong canary means you did not see that file.",
    ""
  ];
  for (const frame of input.frames) {
    lines.push(`IMAGE_${frame.imageIndex} file=${frame.name} act=${frame.act}`);
  }
  if (input.stillsMissing && input.stillsMissing.length > 0) {
    lines.push("");
    lines.push(`STILL_MISSING: ${input.stillsMissing.join(", ")}`);
  }
  lines.push("");
  lines.push("Then judge ONLY story continuity across these frames.");
  lines.push("Axes (each must be PASS or FAIL, plus one visible-evidence sentence):");
  lines.push("- OBJECT_IDENTITY: same physical object across acts (material, outline, fittings, pair count). Different shoe/bag/animal = FAIL.");
  lines.push("- ACCESSORY_COLOR: laces / piping / hardware / button colour. Identity-level change (tan to gray) = FAIL. Slight cleaning brightening is OK.");
  lines.push("- ORIENTATION: before and after face the same way (slight push-in OK). Middle may be hand-held; a full identity flip (side vs camera-on) = FAIL.");
  lines.push("- STATE_ORDER: before=problem untreated; middle=in progress (hands+tool+local progress); after not worse than before.");
  if (!input.hasMiddle) {
    lines.push("  There is no middle act. STATE_ORDER is before then after only. MIDDLE_NOT_WORSE must be PASS.");
  } else {
    lines.push("- MIDDLE_NOT_WORSE: the middle must not be dirtier / flatter / more discolored than before as a whole. Local cleaned patches are progress; a globally dirtier middle is FAIL.");
  }
  if (input.hasMiddle) {
    lines.push("- HANDS: if hands are present they must have five fingers, no fusion, no third hand, plausible scale. Missing hands on before/after do not fail this axis.");
  } else {
    lines.push("- HANDS: no middle act; PASS unless a before/after frame shows malformed hands.");
  }
  lines.push("- SCENE: same counter / wall family. Pink mat + slat wall vs metal bench vs washer wall = FAIL.");
  lines.push("Do not judge subtitle placement, hook wording, TTS, or Meta specs.");
  lines.push("");
  lines.push("Output ONLY this block (no other completed/self-score text):");
  lines.push(VISUAL_QA_BEGIN);
  lines.push(
    '{"reel":"...","verdict":"PASS|FAIL","axes":{"OBJECT_IDENTITY":"PASS|FAIL","ACCESSORY_COLOR":"PASS|FAIL","ORIENTATION":"PASS|FAIL","STATE_ORDER":"PASS|FAIL","MIDDLE_NOT_WORSE":"PASS|FAIL","HANDS":"PASS|FAIL","SCENE":"PASS|FAIL"},"evidence":{"OBJECT_IDENTITY":"visible comparison"},"frames_used":["..."]}'
  );
  lines.push(VISUAL_QA_END);
  const prompt = lines.join("\n");
  assertJudgePromptSafe(prompt);
  return prompt;
}

export function parseCanaryReports(stdout: string, imageCount: number): Record<string, string> {
  const reported: Record<string, string> = {};
  const re = /IMAGE[_\s-]?(\d+)\s*[:=, ]+\s*(?:canary\s*[:=]\s*)?([A-Za-z0-9]{4})/giu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stdout)) !== null) {
    const index = match[1];
    const code = match[2];
    if (!index || !code) continue;
    const n = Number(index);
    if (n >= 1 && n <= imageCount) {
      reported[`IMAGE_${n}`] = code.toUpperCase();
    }
  }
  return reported;
}

export function parseVisualQaBlock(stdout: string): {
  verdict: "PASS" | "FAIL";
  axes: Partial<Record<VisualQaAxis, AxisVerdict>>;
  evidence: Partial<Record<VisualQaAxis, string>>;
  frames_used: string[];
} | null {
  const start = stdout.indexOf(VISUAL_QA_BEGIN);
  const end = stdout.indexOf(VISUAL_QA_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const raw = stdout.slice(start + VISUAL_QA_BEGIN.length, end).trim().replace(/^\uFEFF/u, "");
  try {
    const parsed = JSON.parse(raw) as {
      verdict?: string;
      axes?: Partial<Record<VisualQaAxis, string>>;
      evidence?: Partial<Record<VisualQaAxis, string>>;
      frames_used?: string[];
    };
    if (parsed.verdict !== "PASS" && parsed.verdict !== "FAIL") return null;
    const axes: Partial<Record<VisualQaAxis, AxisVerdict>> = {};
    for (const axis of VISUAL_QA_AXES) {
      const value = parsed.axes?.[axis];
      if (value === "PASS" || value === "FAIL") axes[axis] = value;
    }
    return {
      verdict: parsed.verdict,
      axes,
      evidence: parsed.evidence ?? {},
      frames_used: Array.isArray(parsed.frames_used) ? parsed.frames_used : []
    };
  } catch {
    const verdictMatch = raw.match(/"verdict"\s*:\s*"(PASS|FAIL)"/u);
    if (!verdictMatch || (verdictMatch[1] !== "PASS" && verdictMatch[1] !== "FAIL")) return null;
    const axes: Partial<Record<VisualQaAxis, AxisVerdict>> = {};
    for (const axis of VISUAL_QA_AXES) {
      const axisMatch = raw.match(new RegExp(`"${axis}"\\s*:\\s*"(PASS|FAIL)"`, "u"));
      const value = axisMatch?.[1];
      if (value === "PASS" || value === "FAIL") axes[axis] = value;
    }
    return {
      verdict: verdictMatch[1],
      axes,
      evidence: {},
      frames_used: []
    };
  }
}

function emptyAxes(): Record<VisualQaAxis, AxisVerdict | "MISSING"> {
  return {
    OBJECT_IDENTITY: "MISSING",
    ACCESSORY_COLOR: "MISSING",
    ORIENTATION: "MISSING",
    STATE_ORDER: "MISSING",
    MIDDLE_NOT_WORSE: "MISSING",
    HANDS: "MISSING",
    SCENE: "MISSING"
  };
}

export function evaluateJudgeStdout(input: {
  stdout: string;
  expectedCanaries: Record<string, string>;
  frameSha256s: Record<string, string>;
  reelSha256: string;
  promptHash: string;
  runId: string;
  reel: string;
  frames: QaFrameRecord[];
  stillsMissing?: string[];
  reviewedAt?: string;
}): VisualQaRecord {
  const base = {
    reel: input.reel,
    axes: emptyAxes(),
    evidence: {} as Partial<Record<VisualQaAxis, string>>,
    frames_used: [] as string[],
    frames: input.frames,
    canaries_expected: input.expectedCanaries,
    canaries_reported: {} as Record<string, string>,
    reel_sha256: input.reelSha256,
    prompt_hash: input.promptHash,
    run_id: input.runId,
    model: "codex-exec-read-only",
    reviewed_by: "codex-visual-qa" as const,
    reviewed_at: input.reviewedAt ?? new Date().toISOString(),
    stills_missing: input.stillsMissing ?? [],
    mode: "warn" as const
  };

  if (Object.keys(input.frameSha256s).length === 0) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "frames_not_read"
    };
  }

  const imageCount = Object.keys(input.expectedCanaries).length;
  const reported = parseCanaryReports(input.stdout, imageCount);
  base.canaries_reported = reported;
  let canaryOk = imageCount > 0;
  for (const [key, expected] of Object.entries(input.expectedCanaries)) {
    const got = reported[key];
    if (!got || got.toUpperCase() !== expected.toUpperCase() || !CANARY_RE.test(expected)) {
      canaryOk = false;
      break;
    }
  }
  if (!canaryOk) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "judge_blind"
    };
  }

  const block = parseVisualQaBlock(input.stdout);
  if (!block) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "unparseable"
    };
  }

  let missingAxis = false;
  let contentFail = false;
  for (const axis of VISUAL_QA_AXES) {
    const value = block.axes[axis];
    if (value !== "PASS" && value !== "FAIL") {
      base.axes[axis] = "MISSING";
      missingAxis = true;
    } else {
      base.axes[axis] = value;
      if (value === "FAIL") contentFail = true;
    }
    const evidence = block.evidence[axis];
    if (evidence) base.evidence[axis] = evidence;
  }
  base.frames_used = block.frames_used;

  if (missingAxis) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "missing_axis"
    };
  }

  const verdict: VisualQaVerdict = contentFail || block.verdict === "FAIL" ? "FAIL" : "PASS";
  return {
    ...base,
    verdict,
    fail_class: contentFail ? "content" : null
  };
}

export async function hashPngsInDir(dir: string): Promise<Record<string, string>> {
  const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(".png")).sort();
  const out: Record<string, string> = {};
  for (const name of names) {
    out[name] = await sha256File(join(dir, name));
  }
  return out;
}

export async function evaluateFromDisk(input: {
  qaDir: string;
  stdout: string;
  reelPath: string;
  sidecar: VisualQaSidecar;
  promptHash: string;
  runId: string;
  stillsMissing?: string[];
}): Promise<VisualQaRecord> {
  const onDisk = await hashPngsInDir(input.qaDir);
  const expectedCanaries: Record<string, string> = {};
  input.sidecar.frames.forEach((frame, index) => {
    expectedCanaries[`IMAGE_${index + 1}`] = frame.canary;
  });
  const reelSha256 = await sha256File(input.reelPath);
  const record = evaluateJudgeStdout({
    stdout: input.stdout,
    expectedCanaries,
    frameSha256s: onDisk,
    reelSha256,
    promptHash: input.promptHash,
    runId: input.runId,
    reel: input.reelPath,
    frames: input.sidecar.frames,
    stillsMissing: input.stillsMissing
  });
  if (reelSha256 !== input.sidecar.reel_sha256) {
    return { ...record, verdict: "FAIL_CLOSED", fail_class: "hash_mismatch" };
  }
  for (const frame of input.sidecar.frames) {
    if (onDisk[frame.name] !== frame.sha256) {
      return { ...record, verdict: "FAIL_CLOSED", fail_class: "hash_mismatch" };
    }
  }
  return record;
}

export function visualQaSidecarPath(reelPath: string): string {
  return `${reelPath}.visual-qa.json`;
}

export async function warnVisualQaForPublish(input: {
  date: string;
  slot: number;
  videoPath: string;
  root?: string;
}): Promise<VisualQaWarning> {
  const root = projectRoot(input.root);
  const fullPath = join(root, ...input.videoPath.split("/"));
  const sidecarPath = visualQaSidecarPath(fullPath);
  try {
    await access(sidecarPath);
  } catch {
    const warning: VisualQaWarning = {
      ok: false,
      mode: "warn",
      reason: `missing visual-qa sidecar for slot ${input.slot}`,
      sidecar_path: sidecarPath
    };
    console.warn(`visual-qa warning (not blocking): ${warning.reason}`);
    return warning;
  }

  const record = await readJsonFile<VisualQaRecord | null>(sidecarPath, null);
  if (!record) {
    const warning: VisualQaWarning = {
      ok: false,
      mode: "warn",
      reason: `unreadable visual-qa sidecar for slot ${input.slot}`,
      sidecar_path: sidecarPath
    };
    console.warn(`visual-qa warning (not blocking): ${warning.reason}`);
    return warning;
  }

  let actualSha = "";
  try {
    actualSha = await sha256File(fullPath);
  } catch {
    actualSha = "";
  }
  if (!actualSha || actualSha !== record.reel_sha256) {
    const warning: VisualQaWarning = {
      ok: false,
      mode: "warn",
      reason: `visual-qa hash mismatch for slot ${input.slot}`,
      verdict: record.verdict,
      fail_class: "hash_mismatch",
      sidecar_path: sidecarPath
    };
    console.warn(`visual-qa warning (not blocking): ${warning.reason}`);
    return warning;
  }
  if (record.verdict !== "PASS") {
    const warning: VisualQaWarning = {
      ok: false,
      mode: "warn",
      reason: `visual-qa ${record.verdict} (${record.fail_class ?? "content"}) for slot ${input.slot}`,
      verdict: record.verdict,
      fail_class: record.fail_class,
      sidecar_path: sidecarPath
    };
    console.warn(`visual-qa warning (not blocking): ${warning.reason}`);
    return warning;
  }
  return {
    ok: true,
    mode: "warn",
    reason: "pass",
    verdict: "PASS",
    fail_class: null,
    sidecar_path: sidecarPath
  };
}

export async function loadRejectedConcepts(root?: string): Promise<RejectedConceptsFile> {
  const path = rejectedConceptsPath(projectRoot(root));
  const fallback: RejectedConceptsFile = { version: 1, concepts: [] };
  const parsed = await readJsonFile<RejectedConceptsFile>(path, fallback);
  if (!Array.isArray(parsed.concepts)) return fallback;
  return { version: 1, concepts: parsed.concepts };
}

export function isConceptRejected(file: RejectedConceptsFile, conceptId: string): boolean {
  return file.concepts.some((entry) => entry.id === conceptId);
}

export async function addRejectedConcept(input: {
  id: string;
  reason: string;
  videoSha256?: string | null;
  root?: string;
  now?: Date;
}): Promise<RejectedConceptsFile> {
  const root = projectRoot(input.root);
  const current = await loadRejectedConcepts(root);
  const next: RejectedConceptsFile = {
    version: 1,
    concepts: [
      ...current.concepts.filter((entry) => entry.id !== input.id),
      {
        id: input.id,
        reason: input.reason,
        rejected_at: (input.now ?? new Date()).toISOString(),
        video_sha256: input.videoSha256 ?? null
      }
    ]
  };
  await writeJsonAtomic(rejectedConceptsPath(root), next);
  return next;
}

export function buildIsolationPlan(input: {
  conceptId: string;
  objectType: string;
  date?: string;
  slot?: number;
  runDir?: string;
}): IsolationTarget[] {
  const run = input.runDir ?? "output/reels-run/2026-07-29";
  const reels = `${run}/reels`;
  const raw = `${run}/raw`;
  const targets: IsolationTarget[] = [
    { layer: 1, kind: "canonical-10s", path: `${reels}/${input.conceptId}.mp4` },
    { layer: 2, kind: "canonical-15s", path: `${reels}/${input.conceptId}-15s.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-tA.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-tB.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-tC.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-untreated.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-15s-tA.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-15s-tB.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-15s-tC.mp4` },
    { layer: 3, kind: "treated-variants", path: `${reels}/${input.conceptId}-15s-untreated.mp4` },
    { layer: 4, kind: "raw-clips", path: `${raw}/${input.conceptId}-before.mp4` },
    { layer: 4, kind: "raw-clips", path: `${raw}/${input.conceptId}-middle.mp4` },
    { layer: 4, kind: "raw-clips", path: `${raw}/${input.conceptId}-after.mp4` },
    { layer: 4, kind: "raw-clips", path: `${raw}/${input.conceptId}-middle-graded.mp4` },
    {
      layer: 5,
      kind: "published-asset",
      path:
        input.date && input.slot
          ? `docs/assets/${input.date}/slot-${String(input.slot).padStart(2, "0")}.mp4`
          : "docs/assets/<date>/slot-XX.mp4"
    },
    {
      layer: 6,
      kind: "reference-photos",
      path: `data/reference-photos/${input.objectType}/${input.conceptId}-*.png`
    }
  ];
  return targets;
}

export function hitsStoryFailAxis(record: VisualQaRecord): boolean {
  return STORY_FAIL_AXES.some((axis) => record.axes[axis] === "FAIL");
}

export function referenceStillPaths(input: {
  root: string;
  objectType: string;
  conceptId: string;
}): { before: string; middle: string; after: string } {
  const dir = join(input.root, "data", "reference-photos", input.objectType);
  return {
    before: join(dir, `${input.conceptId}-before.png`),
    middle: join(dir, `${input.conceptId}-middle.png`),
    after: join(dir, `${input.conceptId}-after.png`)
  };
}
