import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { readJsonFile, writeJsonAtomic } from "./logging";
import { padSlot, projectRoot, rejectedConceptsPath, relativeCarouselAssetPath } from "./paths";

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
export type VisualQaFailClass =
  | "content"
  | "judge_blind"
  | "missing_axis"
  | "unparseable"
  | "frames_not_read"
  | "hash_mismatch"
  | "still_missing"
  | "rubric_incoherent"
  | "missing_observation";
export type VisualQaReviewer = "codex-visual-qa" | "human-frames-review";
export type ReelTreatment = "A" | "B" | "C" | "untreated-15s" | "10s";

export const VISUAL_QA_REVIEWERS: readonly VisualQaReviewer[] = ["codex-visual-qa", "human-frames-review"];
export const STORY_FAIL_AXES = ["MIDDLE_NOT_WORSE", "ACCESSORY_COLOR", "ORIENTATION"] as const;
export const CAROUSEL_QA_AXES = ["OBJECT_IDENTITY", "SCENE", "TOPIC_MATCH"] as const;
export type CarouselQaAxis = (typeof CAROUSEL_QA_AXES)[number];
export const VISUAL_QA_BEGIN = "<<<VISUAL_QA_BEGIN>>>";
export const VISUAL_QA_END = "<<<VISUAL_QA_END>>>";
export const VISUAL_QA_OBSERVE_BEGIN = "<<<OBSERVE_BEGIN>>>";
export const VISUAL_QA_OBSERVE_END = "<<<OBSERVE_END>>>";

const JUDGE_PROMPT_OVERFIT_RE =
  /suede-shoe-nap|backpack-base|leather-bag-corner|suit-shoulder|wool-coat-shoulder|carousel-mixed-garments|carousel-rain-shoes|tan\s*(to|->|→)\s*gray|laces\s+tan|米\s*(→|->)\s*灰|BK9C|6N5B|GTBC|B7UW|U5ER|SJ8K/iu;

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

export interface CarouselSlideRecord {
  name: string;
  slide: number;
  source: string;
  canary: string;
  sha256: string;
}

export interface CarouselQaSidecar {
  topic: string;
  date?: string;
  slot?: number;
  slides: CarouselSlideRecord[];
}

export interface CarouselQaRecord {
  topic: string;
  date?: string;
  slot?: number;
  verdict: VisualQaVerdict;
  fail_class: VisualQaFailClass | null;
  axes: Record<CarouselQaAxis, AxisVerdict | "MISSING">;
  evidence: Partial<Record<CarouselQaAxis, string>>;
  frames_used: string[];
  slides: CarouselSlideRecord[];
  sources: string[];
  canaries_expected: Record<string, string>;
  canaries_reported: Record<string, string>;
  prompt_hash: string;
  run_id: string;
  model: string;
  reviewed_by: VisualQaReviewer;
  reviewed_at: string;
  mode: "warn" | "enforce";
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

function assertSharedJudgePromptSafety(prompt: string): void {
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
  if (!prompt.includes(VISUAL_QA_BEGIN) || !prompt.includes(VISUAL_QA_END)) {
    throw new Error("QA prompt must request the VISUAL_QA marker block.");
  }
  if (!prompt.includes(VISUAL_QA_OBSERVE_BEGIN) || !prompt.includes(VISUAL_QA_OBSERVE_END)) {
    throw new Error("QA prompt must request the OBSERVE marker block.");
  }
  if (JUDGE_PROMPT_OVERFIT_RE.test(prompt)) {
    throw new Error("QA prompt must not overfit fixture names or answers.");
  }
}

export function assertJudgePromptSafe(prompt: string): void {
  assertSharedJudgePromptSafety(prompt);
  for (const axis of VISUAL_QA_AXES) {
    if (!prompt.includes(axis)) {
      throw new Error(`QA prompt missing required axis ${axis}.`);
    }
  }
}

export function assertCarouselJudgePromptSafe(prompt: string): void {
  assertSharedJudgePromptSafety(prompt);
  for (const axis of CAROUSEL_QA_AXES) {
    if (!prompt.includes(axis)) {
      throw new Error(`QA prompt missing required axis ${axis}.`);
    }
  }
}

export function frameRoleFromAct(act: string): "BEFORE" | "MIDDLE" | "AFTER" | "UNKNOWN" {
  const lower = act.toLowerCase();
  if (lower.includes("middle")) return "MIDDLE";
  if (lower.includes("before")) return "BEFORE";
  if (lower.includes("after")) return "AFTER";
  return "UNKNOWN";
}

export function buildJudgePrompt(input: {
  frames: Array<{ imageIndex: number; name: string; act: string; t?: number }>;
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
    const role = frameRoleFromAct(frame.act);
    const timePart = typeof frame.t === "number" ? ` t=${frame.t}` : "";
    lines.push(`IMAGE_${frame.imageIndex} file=${frame.name} act=${frame.act} role=${role}${timePart}`);
  }
  if (input.stillsMissing && input.stillsMissing.length > 0) {
    lines.push("");
    lines.push(`STILL_MISSING: ${input.stillsMissing.join(", ")}`);
  }
  lines.push("");
  lines.push("Then judge ONLY story continuity across these frames.");
  lines.push("Roles: BEFORE = untreated start; MIDDLE = in-progress; AFTER = finished.");
  lines.push("Judge by role labels, not file order alone. Two frames with the same role are one act.");
  lines.push("");
  lines.push("STEP 1 is mandatory. Declare one observation line per attached image BEFORE any axis verdict.");
  lines.push("Use closed tokens only. Do not skip a field. Do not copy on-screen captions as proof.");
  lines.push("Prefix must be OBS_N (not IMAGE_N) so canary lines stay distinct.");
  lines.push("OBS_N role=BEFORE|MIDDLE|AFTER act=... laces_color=TOKEN hardware_color=TOKEN facing=TOKEN soil=TOKEN hands=NONE|OK|BAD scene=TOKEN");
  lines.push("Color tokens: NONE BLACK WHITE GRAY TAN BROWN RED BLUE GOLD SILVER OTHER");
  lines.push("Facing tokens: TQ_RIGHT TQ_LEFT CAMERA_ON TOP_DOWN OTHER");
  lines.push("Soil tokens (WHOLE object dirt/mottle/darkening, not one patch): CLEAN LIGHT MODERATE HEAVY");
  lines.push("Then write COMPARE lines derived ONLY from those declarations:");
  lines.push("COMPARE ACCESSORY_COLOR identity_change=YES|NO");
  lines.push("COMPARE ORIENTATION identity_flip=YES|NO");
  lines.push("COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=YES|NO");
  lines.push("");
  lines.push("Derivation (you must follow; do not override a YES with a story):");
  lines.push("- ACCESSORY_COLOR identity_change=YES if any visible laces_color or hardware_color token differs across frames (ignore NONE). Same token that looks brighter after cleaning = NO. A different token is identity-level, not cleaning.");
  lines.push("- ORIENTATION identity_flip=YES if BEFORE facing differs from AFTER facing, OR any MIDDLE facing family differs from BEFORE (TQ_* vs CAMERA_ON vs TOP_DOWN). Same token with a slight crop or push-in = NO.");
  lines.push("- MIDDLE_NOT_WORSE globally_worse_than_before=YES if any MIDDLE soil is heavier than the heaviest BEFORE soil (CLEAN<LIGHT<MODERATE<HEAVY). Compare the MIDDLE set against the BEFORE set only. AFTER is not the comparison target.");
  lines.push("- A local cleaned patch does not set globally_worse_than_before=NO when the rest of the object is heavier, darker, or more mottled. Narration is not evidence.");
  if (!input.hasMiddle) {
    lines.push("- There is no MIDDLE role. COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=NO. STATE_ORDER is BEFORE then AFTER only.");
  }
  lines.push("- If a COMPARE flag is YES, that axis MUST be FAIL. PASS on that axis is invalid.");
  lines.push("");
  lines.push("STEP 2: derive each axis from STEP 1 (PASS or FAIL plus one visible-evidence sentence):");
  lines.push("- OBJECT_IDENTITY: same physical object across acts (material, outline, fittings, pair count). Different shoe/bag/animal = FAIL.");
  lines.push("- ACCESSORY_COLOR: FAIL if COMPARE identity_change=YES. Slight cleaning brightening of the same token is OK.");
  lines.push("- ORIENTATION: FAIL if COMPARE identity_flip=YES.");
  lines.push("- STATE_ORDER: BEFORE=problem untreated; MIDDLE=in progress (hands+tool+local progress); AFTER not worse than BEFORE.");
  if (!input.hasMiddle) {
    lines.push("  There is no middle act. STATE_ORDER is before then after only. MIDDLE_NOT_WORSE must be PASS.");
  } else {
    lines.push("- MIDDLE_NOT_WORSE: FAIL if COMPARE globally_worse_than_before=YES. Local cleaned patches are progress; they must not cover a globally dirtier MIDDLE.");
  }
  if (input.hasMiddle) {
    lines.push("- HANDS: if hands are present they must have five fingers, no fusion, no third hand, plausible scale. Missing hands on before/after do not fail this axis.");
  } else {
    lines.push("- HANDS: no middle act; PASS unless a before/after frame shows malformed hands.");
  }
  lines.push("- SCENE: same counter / wall family. Pink mat + slat wall vs metal bench vs washer wall = FAIL.");
  lines.push("Do not judge subtitle placement, hook wording, TTS, or Meta specs.");
  lines.push("");
  lines.push("Output ONLY these two blocks (no other completed/self-score text):");
  lines.push(VISUAL_QA_OBSERVE_BEGIN);
  lines.push("OBS_N role=... act=... laces_color=... hardware_color=... facing=... soil=... hands=... scene=...");
  lines.push("COMPARE ACCESSORY_COLOR identity_change=YES|NO");
  lines.push("COMPARE ORIENTATION identity_flip=YES|NO");
  lines.push("COMPARE MIDDLE_NOT_WORSE globally_worse_than_before=YES|NO");
  lines.push(VISUAL_QA_OBSERVE_END);
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
  const re = /IMAGE[_\s-]?(\d+)\s*[:=, ]+\s*canary\s*[:=]\s*([A-Za-z0-9]{4})/giu;
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

export function parseVisualQaBlock(
  stdout: string,
  axisList: readonly string[] = VISUAL_QA_AXES
): {
  verdict: "PASS" | "FAIL";
  axes: Partial<Record<string, AxisVerdict>>;
  evidence: Partial<Record<string, string>>;
  frames_used: string[];
} | null {
  const start = stdout.indexOf(VISUAL_QA_BEGIN);
  const end = stdout.indexOf(VISUAL_QA_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const raw = stdout.slice(start + VISUAL_QA_BEGIN.length, end).trim().replace(/^\uFEFF/u, "");
  try {
    const parsed = JSON.parse(raw) as {
      verdict?: string;
      axes?: Partial<Record<string, string>>;
      evidence?: Partial<Record<string, string>>;
      frames_used?: string[];
    };
    if (parsed.verdict !== "PASS" && parsed.verdict !== "FAIL") return null;
    const axes: Partial<Record<string, AxisVerdict>> = {};
    for (const axis of axisList) {
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
    const axes: Partial<Record<string, AxisVerdict>> = {};
    for (const axis of axisList) {
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

export interface FrameObservation {
  image: string;
  role: string;
  act: string;
  laces_color: string;
  hardware_color: string;
  facing: string;
  soil: string;
}

export interface ObserveCompare {
  accessoryChange?: boolean;
  orientationFlip?: boolean;
  middleWorse?: boolean;
}

export interface ParsedObserveBlock {
  frames: FrameObservation[];
  compare: ObserveCompare;
}

const YES_RE = /^(YES|TRUE|Y|1)$/iu;
const TOKEN_RE = /([a-z_]+)=([A-Za-z0-9_+-]+)/giu;

function truthyToken(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (YES_RE.test(value)) return true;
  if (/^(NO|FALSE|N|0)$/iu.test(value)) return false;
  return undefined;
}

function colorFamily(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z]/gu, "");
  if (!t || t === "NONE" || t === "NA" || t === "ABSENT" || t === "UNREADABLE") return null;
  if (["TAN", "BEIGE", "CAMEL", "KHAKI", "SAND"].includes(t)) return "TAN";
  if (["GRAY", "GREY", "SILVER", "CHARCOAL"].includes(t)) return "GRAY";
  if (["BROWN", "CHOCOLATE", "COFFEE"].includes(t)) return "BROWN";
  if (["GOLD", "BRASS"].includes(t)) return "GOLD";
  return t;
}

function facingFamily(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z_]/gu, "");
  if (!t || t === "OTHER" || t === "NONE" || t === "NA") return null;
  if (t.startsWith("TQ_RIGHT") || t === "THREEQUARTERRIGHT") return "TQ_RIGHT";
  if (t.startsWith("TQ_LEFT") || t === "THREEQUARTERLEFT") return "TQ_LEFT";
  if (t.includes("CAMERA") || t === "CAMERA_ON") return "CAMERA_ON";
  if (t.includes("TOP")) return "TOP_DOWN";
  return t;
}

function soilRank(token: string): number | null {
  const t = token.toUpperCase().replace(/[^A-Z]/gu, "");
  if (t === "CLEAN" || t === "CLEAR") return 0;
  if (t === "LIGHT" || t === "FAINT") return 1;
  if (t === "MODERATE" || t === "MOTTLED" || t === "UNEVEN") return 2;
  if (t === "HEAVY" || t === "DIRTY" || t === "DARK") return 3;
  return null;
}

function parseTokenMap(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    const key = match[1];
    const value = match[2];
    if (!key || !value) continue;
    out[key.toLowerCase()] = value;
  }
  return out;
}

export function parseObserveBlock(stdout: string): ParsedObserveBlock | null {
  const start = stdout.indexOf(VISUAL_QA_OBSERVE_BEGIN);
  const end = stdout.indexOf(VISUAL_QA_OBSERVE_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const raw = stdout.slice(start + VISUAL_QA_OBSERVE_BEGIN.length, end);
  const frames: FrameObservation[] = [];
  const compare: ObserveCompare = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const imageMatch = trimmed.match(/^(?:OBS|FRAME|IMAGE)[_\s-]?(\d+)\b/iu);
    if (imageMatch) {
      const tokens = parseTokenMap(trimmed);
      frames.push({
        image: `IMAGE_${imageMatch[1]}`,
        role: (tokens.role ?? "").toUpperCase(),
        act: (tokens.act ?? "").toLowerCase(),
        laces_color: tokens.laces_color ?? tokens.lacescolor ?? "",
        hardware_color: tokens.hardware_color ?? tokens.hardwarecolor ?? "",
        facing: tokens.facing ?? "",
        soil: tokens.soil ?? tokens.soil_overall ?? ""
      });
      continue;
    }
    const compareMatch = trimmed.match(/^COMPARE\s+(ACCESSORY_COLOR|ORIENTATION|MIDDLE_NOT_WORSE)\b(.*)$/iu);
    if (!compareMatch) continue;
    const axis = compareMatch[1]?.toUpperCase();
    const tokens = parseTokenMap(compareMatch[2] ?? trimmed);
    if (axis === "ACCESSORY_COLOR") {
      compare.accessoryChange = truthyToken(
        tokens.identity_change ?? tokens.identitychange ?? tokens.changed
      );
    } else if (axis === "ORIENTATION") {
      compare.orientationFlip = truthyToken(
        tokens.identity_flip ?? tokens.identityflip ?? tokens.flip
      );
    } else if (axis === "MIDDLE_NOT_WORSE") {
      compare.middleWorse = truthyToken(
        tokens.globally_worse_than_before ?? tokens.globally_worse ?? tokens.worse
      );
    }
  }
  if (frames.length === 0 && compare.accessoryChange === undefined && compare.orientationFlip === undefined && compare.middleWorse === undefined) {
    return null;
  }
  return { frames, compare };
}

function accessoryTokensDiffer(frames: FrameObservation[]): boolean {
  const laceFamilies = new Set<string>();
  const hardwareFamilies = new Set<string>();
  for (const frame of frames) {
    const lace = colorFamily(frame.laces_color);
    const hardware = colorFamily(frame.hardware_color);
    if (lace) laceFamilies.add(lace);
    if (hardware) hardwareFamilies.add(hardware);
  }
  return laceFamilies.size > 1 || hardwareFamilies.size > 1;
}

function facingFlips(frames: FrameObservation[]): boolean {
  const before = frames
    .filter((frame) => frame.role === "BEFORE" || frame.act.includes("before"))
    .map((frame) => facingFamily(frame.facing))
    .filter((value): value is string => Boolean(value));
  const middle = frames
    .filter((frame) => frame.role === "MIDDLE" || frame.act.includes("middle"))
    .map((frame) => facingFamily(frame.facing))
    .filter((value): value is string => Boolean(value));
  const after = frames
    .filter((frame) => frame.role === "AFTER" || frame.act.includes("after"))
    .map((frame) => facingFamily(frame.facing))
    .filter((value): value is string => Boolean(value));
  const beforeFamily = before[0];
  if (beforeFamily && after[0] && after[0] !== beforeFamily) return true;
  return Boolean(beforeFamily && middle.some((value) => value !== beforeFamily));
}

function middleSoilWorse(frames: FrameObservation[]): boolean {
  const beforeRanks = frames
    .filter((frame) => frame.role === "BEFORE" || frame.act.includes("before"))
    .map((frame) => soilRank(frame.soil))
    .filter((value): value is number => value !== null);
  const middleRanks = frames
    .filter((frame) => frame.role === "MIDDLE" || frame.act.includes("middle"))
    .map((frame) => soilRank(frame.soil))
    .filter((value): value is number => value !== null);
  if (beforeRanks.length === 0 || middleRanks.length === 0) return false;
  return Math.max(...middleRanks) > Math.max(...beforeRanks);
}

export function detectRubricIncoherence(
  stdout: string,
  axes: Record<VisualQaAxis, AxisVerdict | "MISSING">
): boolean {
  const observed = parseObserveBlock(stdout);
  if (!observed) return false;
  const accessoryChange = observed.compare.accessoryChange === true || accessoryTokensDiffer(observed.frames);
  if (accessoryChange && axes.ACCESSORY_COLOR === "PASS") return true;
  const orientationFlip = observed.compare.orientationFlip === true || facingFlips(observed.frames);
  if (orientationFlip && axes.ORIENTATION === "PASS") return true;
  const middleWorse = observed.compare.middleWorse === true || middleSoilWorse(observed.frames);
  if (middleWorse && axes.MIDDLE_NOT_WORSE === "PASS") return true;
  return false;
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

  if (detectRubricIncoherence(input.stdout, base.axes)) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "rubric_incoherent"
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

export function carouselSlideFileNames(slot: number, maxSlides = 4): string[] {
  const names: string[] = [];
  for (let slide = 1; slide <= maxSlides; slide += 1) {
    names.push(basename(relativeCarouselAssetPath("x", slot, slide)));
  }
  return names;
}

export function parseCarouselSpec(value: string | undefined): { dir?: string; slot?: number } {
  if (!value) return {};
  const trimmed = value.trim();
  const colon = trimmed.match(/^(.*):(\d+)$/u);
  if (colon?.[1] && colon[2]) {
    return { dir: colon[1], slot: Number(colon[2]) };
  }
  const named = trimmed.match(/^(.*)[/\\]slot-(\d+)/iu);
  if (named?.[1] && named[2]) {
    return { dir: named[1], slot: Number(named[2]) };
  }
  return { dir: trimmed };
}

export function carouselQaRecordPath(dir: string, slot: number): string {
  return join(dir, `slot-${padSlot(slot)}.visual-qa.json`);
}

export async function resolveCarouselSlides(input: {
  dir?: string;
  slot?: number;
  files?: string[];
  root?: string;
}): Promise<string[]> {
  if (input.files && input.files.length > 0) {
    const resolved = input.files
      .map((file) => file.trim())
      .filter(Boolean)
      .map((file) => (isAbsolute(file) ? file : join(input.root ?? process.cwd(), file)));
    if (resolved.length < 2 || resolved.length > 4) {
      throw new Error("Carousel QA needs 2-4 slide PNG files.");
    }
    for (const file of resolved) {
      await access(file);
    }
    return resolved;
  }
  if (!input.dir || !input.slot) {
    throw new Error("Carousel QA needs --dir and --slot, or --files.");
  }
  const dir = isAbsolute(input.dir) ? input.dir : join(input.root ?? process.cwd(), input.dir);
  const found: string[] = [];
  for (const name of carouselSlideFileNames(input.slot)) {
    const filePath = join(dir, name);
    try {
      await access(filePath);
      found.push(filePath);
    } catch {
      break;
    }
  }
  if (found.length < 2 || found.length > 4) {
    throw new Error(`Carousel slot ${input.slot} needs 2-4 slide PNGs in ${dir}; found ${found.length}.`);
  }
  return found;
}

export function buildCarouselJudgePrompt(input: {
  slides: Array<{ imageIndex: number; name: string; slide: number }>;
  topic: string;
}): string {
  const lines = [
    "Do not generate or edit any image. Do not run a shell command. Only read the listed image files.",
    "",
    "You are given carousel slides in order. Each IMAGE_N is one attached file.",
    "Every image has a yellow 4-character canary code in a black box at the bottom-left.",
    "First report each canary exactly as printed, one per line: IMAGE_N canary=XXXX",
    "A missing or wrong canary means you did not see that file.",
    "",
    `TOPIC: ${input.topic.trim() || "(none)"}`,
    ""
  ];
  for (const slide of input.slides) {
    lines.push(`IMAGE_${slide.imageIndex} file=${slide.name} slide=${slide.slide}`);
  }
  lines.push("");
  lines.push("Then judge ONLY whether these slides show one physical object on one counter family for this topic.");
  lines.push("");
  lines.push("STEP 1 is mandatory. Declare one observation line per attached image BEFORE any axis verdict.");
  lines.push("Use closed tokens only. Do not skip a field. Do not copy on-screen captions as proof.");
  lines.push("Prefix must be OBS_N (not IMAGE_N) so canary lines stay distinct.");
  lines.push("OBS_N garment_color=TOKEN garment_type=TOKEN material=TOKEN wear=TOKEN scene=TOKEN");
  lines.push("Color tokens: BLACK NAVY GRAY WHITE CREAM BEIGE TAN BROWN BLUE RED TWO_TONE OTHER");
  lines.push("Type tokens: TEE SHIRT KNIT PANTS DRESS COAT SNEAKER BOOT BAG OTHER");
  lines.push("Material tokens: KNIT WOVEN LEATHER SUEDE RUBBER MIXED OTHER");
  lines.push("Wear tokens: CLEAN LIGHT MODERATE HEAVY");
  lines.push("Scene tokens: PINK_MAT_SLAT METAL_BENCH WASHER_WALL OTHER");
  lines.push("Use TWO_TONE when the featured object itself has two body colors. A left/right pair is one object.");
  lines.push("Then write COMPARE lines derived ONLY from those declarations:");
  lines.push("COMPARE OBJECT_IDENTITY identity_change=YES|NO");
  lines.push("COMPARE SCENE scene_change=YES|NO");
  lines.push("COMPARE TOPIC_MATCH object_mismatch=YES|NO");
  lines.push("");
  lines.push("Derivation (you must follow; do not override a YES with a story):");
  lines.push("- OBJECT_IDENTITY identity_change=YES if garment_type tokens are not the same family, OR garment_color families differ.");
  lines.push("  Type families: TEE is not SHIRT is not KNIT is not SNEAKER is not BOOT is not BAG. SHOE/SNEAKER/FOOTWEAR count as SNEAKER.");
  lines.push("  Color families: NAVY/BLACK=DARK; CREAM/BEIGE/TAN/WHITE=LIGHT; BLUE=BLUE; GRAY=GRAY; BROWN=BROWN; RED=RED; TWO_TONE=TWO_TONE.");
  lines.push("  TWO_TONE plus DARK and/or LIGHT on SNEAKER or BOOT is still one two-tone pair (identity_change=NO). A third color family is YES.");
  lines.push("  Material or wear token differences alone do not set identity_change=YES when type family and color family stay the same.");
  lines.push("  KNIT/WOVEN vs LEATHER/SUEDE/RUBBER is a coarse material change and MUST set identity_change=YES.");
  lines.push("- SCENE scene_change=YES if scene tokens are not the same family (PINK_MAT_SLAT vs METAL_BENCH vs WASHER_WALL).");
  lines.push("- TOPIC_MATCH object_mismatch=YES if the declared type family set does not match the object word in TOPIC.");
  lines.push("  Topic families: 衣/衣服/衣物/襯衫/外套/T恤/針織/褲 → garment; 鞋/雨鞋/球鞋/靴/拖鞋 → footwear; 包/袋/背包 → bag.");
  lines.push("  If TOPIC has no object word, object_mismatch=NO.");
  lines.push("- If a COMPARE flag is YES, that axis MUST be FAIL. PASS on that axis is invalid.");
  lines.push("");
  lines.push("STEP 2: derive each axis from STEP 1 (PASS or FAIL plus one visible-evidence sentence):");
  lines.push("- OBJECT_IDENTITY: same physical object across slides (color family, type family, coarse material). Mixed different garments or mixed garment+footwear = FAIL.");
  lines.push("- SCENE: same counter / wall family. Pink mat + slat wall vs metal bench vs washer wall = FAIL.");
  lines.push("- TOPIC_MATCH: the set of objects matches the topic object word. Shoes on a garment topic, or clothes on a footwear topic = FAIL.");
  lines.push("Do not judge subtitle placement, hook wording, TTS, or Meta specs.");
  lines.push("");
  lines.push("Output ONLY these two blocks (no other completed/self-score text):");
  lines.push(VISUAL_QA_OBSERVE_BEGIN);
  lines.push("OBS_N garment_color=... garment_type=... material=... wear=... scene=...");
  lines.push("COMPARE OBJECT_IDENTITY identity_change=YES|NO");
  lines.push("COMPARE SCENE scene_change=YES|NO");
  lines.push("COMPARE TOPIC_MATCH object_mismatch=YES|NO");
  lines.push(VISUAL_QA_OBSERVE_END);
  lines.push(VISUAL_QA_BEGIN);
  lines.push(
    '{"topic":"...","verdict":"PASS|FAIL","axes":{"OBJECT_IDENTITY":"PASS|FAIL","SCENE":"PASS|FAIL","TOPIC_MATCH":"PASS|FAIL"},"evidence":{"OBJECT_IDENTITY":"visible comparison"},"frames_used":["..."]}'
  );
  lines.push(VISUAL_QA_END);
  const prompt = lines.join("\n");
  assertCarouselJudgePromptSafe(prompt);
  return prompt;
}

export interface CarouselFrameObservation {
  image: string;
  garment_color: string;
  garment_type: string;
  material: string;
  wear: string;
  scene: string;
}

export interface CarouselObserveCompare {
  identityChange?: boolean;
  sceneChange?: boolean;
  topicMismatch?: boolean;
}

export interface ParsedCarouselObserveBlock {
  frames: CarouselFrameObservation[];
  compare: CarouselObserveCompare;
}

function carouselTypeToken(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z]/gu, "");
  if (!t || t === "OTHER" || t === "NONE" || t === "NA") return null;
  if (["TEE", "TSHIRT", "TSHIRTS"].includes(t)) return "TEE";
  if (["SHIRT", "BLOUSE"].includes(t)) return "SHIRT";
  if (["KNIT", "SWEATER"].includes(t)) return "KNIT";
  if (["PANTS", "TROUSERS"].includes(t)) return "PANTS";
  if (["DRESS"].includes(t)) return "DRESS";
  if (["COAT", "JACKET"].includes(t)) return "COAT";
  if (["SNEAKER", "SNEAKERS", "SHOE", "SHOES", "FOOTWEAR", "TRAINER", "TRAINERS"].includes(t)) {
    return "SNEAKER";
  }
  if (["BOOT", "BOOTS", "RAINBOOT", "RAINBOOTS"].includes(t)) return "BOOT";
  if (["BAG", "POUCH", "BACKPACK"].includes(t)) return "BAG";
  if (["GARMENT", "CLOTHES", "CLOTHING"].includes(t)) return "SHIRT";
  return t;
}

function carouselColorFamilyToken(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z]/gu, "");
  if (!t || t === "OTHER" || t === "NONE" || t === "NA") return null;
  if (["NAVY", "BLACK", "DARK"].includes(t)) return "DARK";
  if (["CREAM", "BEIGE", "TAN", "WHITE", "LIGHT", "IVORY", "SAND"].includes(t)) return "LIGHT";
  if (["TWOTONE", "NAVYCREAM"].includes(t)) return "TWO_TONE";
  if (["BLUE", "LIGHTBLUE"].includes(t)) return "BLUE";
  if (["GRAY", "GREY", "CHARCOAL"].includes(t)) return "GRAY";
  if (["BROWN", "CHOCOLATE"].includes(t)) return "BROWN";
  if (["RED"].includes(t)) return "RED";
  return t;
}

function carouselMaterialFamily(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z]/gu, "");
  if (!t || t === "OTHER" || t === "NONE" || t === "NA" || t === "MIXED") return null;
  if (["KNIT", "WOVEN", "CLOTH", "FABRIC", "COTTON"].includes(t)) return "CLOTH";
  if (["LEATHER", "SUEDE", "RUBBER", "CANVAS"].includes(t)) return "FOOTWEAR_MAT";
  return t;
}

function carouselSceneFamily(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z_]/gu, "");
  if (!t || t === "OTHER" || t === "NONE" || t === "NA") return null;
  if (t.includes("PINK") || t.includes("SLAT") || t.includes("MAT")) return "PINK_MAT_SLAT";
  if (t.includes("METAL") || t.includes("BENCH")) return "METAL_BENCH";
  if (t.includes("WASHER") || t.includes("LAUNDRY")) return "WASHER_WALL";
  return t;
}

function carouselTopicFamily(topic: string): "GARMENT" | "FOOTWEAR" | "BAG" | null {
  if (/鞋|靴|拖鞋/u.test(topic)) return "FOOTWEAR";
  if (/包|袋/u.test(topic) && !/衣/u.test(topic)) return "BAG";
  if (/衣|衫|T恤|外套|大衣|針織|褲/u.test(topic)) return "GARMENT";
  return null;
}

function carouselTypeTopicFamily(typeToken: string): "GARMENT" | "FOOTWEAR" | "BAG" | null {
  const t = carouselTypeToken(typeToken);
  if (!t) return null;
  if (["TEE", "SHIRT", "KNIT", "PANTS", "DRESS", "COAT"].includes(t)) return "GARMENT";
  if (["SNEAKER", "BOOT"].includes(t)) return "FOOTWEAR";
  if (t === "BAG") return "BAG";
  return null;
}

function carouselIdentityChanged(frames: CarouselFrameObservation[]): boolean {
  const types = new Set<string>();
  const colors = new Set<string>();
  const materials = new Set<string>();
  for (const frame of frames) {
    const type = carouselTypeToken(frame.garment_type);
    const color = carouselColorFamilyToken(frame.garment_color);
    const material = carouselMaterialFamily(frame.material);
    if (type) types.add(type);
    if (color) colors.add(color);
    if (material) materials.add(material);
  }
  if (types.size > 1) return true;
  if (materials.size > 1) return true;
  if (colors.has("TWO_TONE")) {
    colors.delete("TWO_TONE");
    const footwearOnly = [...types].every((type) => type === "SNEAKER" || type === "BOOT");
    if (footwearOnly) {
      colors.delete("DARK");
      colors.delete("LIGHT");
    }
  }
  const footwearOnly = [...types].every((type) => type === "SNEAKER" || type === "BOOT");
  if (footwearOnly && [...colors].every((color) => color === "DARK" || color === "LIGHT") && colors.size <= 2) {
    return false;
  }
  return colors.size > 1;
}

function carouselSceneChanged(frames: CarouselFrameObservation[]): boolean {
  const scenes = new Set<string>();
  for (const frame of frames) {
    const scene = carouselSceneFamily(frame.scene);
    if (scene) scenes.add(scene);
  }
  return scenes.size > 1;
}

function carouselTopicMismatched(frames: CarouselFrameObservation[], topic: string): boolean {
  const expected = carouselTopicFamily(topic);
  if (!expected) return false;
  const got = new Set<"GARMENT" | "FOOTWEAR" | "BAG">();
  for (const frame of frames) {
    const family = carouselTypeTopicFamily(frame.garment_type);
    if (family) got.add(family);
  }
  if (got.size === 0) return false;
  return [...got].some((family) => family !== expected);
}

const CAROUSEL_OBS_FIELDS = ["garment_color", "garment_type", "material", "wear", "scene"] as const;

export function carouselObservationDefects(
  observed: ParsedCarouselObserveBlock | null,
  expectedCount: number
): string[] {
  if (!observed) return ["missing_observe_block"];
  const defects: string[] = [];
  const indices = observed.frames.map((frame) => Number(String(frame.image).replace(/\D/g, "")));
  if (observed.frames.length !== expectedCount) defects.push("obs_count");
  if (new Set(indices).size !== indices.length) defects.push("obs_duplicate");
  const expected = Array.from({ length: expectedCount }, (_, index) => index + 1);
  const sorted = [...indices].sort((a, b) => a - b);
  if (sorted.length !== expected.length || sorted.some((value, index) => value !== expected[index])) {
    defects.push("obs_sequence");
  }
  for (const frame of observed.frames) {
    const missing = CAROUSEL_OBS_FIELDS.some((field) => !String(frame[field] ?? "").trim());
    if (missing) {
      defects.push("obs_fields");
      break;
    }
  }
  if (
    observed.compare.identityChange === undefined ||
    observed.compare.sceneChange === undefined ||
    observed.compare.topicMismatch === undefined
  ) {
    defects.push("missing_compare");
  }
  return [...new Set(defects)];
}

export function parseCarouselObserveBlock(stdout: string): ParsedCarouselObserveBlock | null {
  const start = stdout.indexOf(VISUAL_QA_OBSERVE_BEGIN);
  const end = stdout.indexOf(VISUAL_QA_OBSERVE_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const raw = stdout.slice(start + VISUAL_QA_OBSERVE_BEGIN.length, end);
  const frames: CarouselFrameObservation[] = [];
  const compare: CarouselObserveCompare = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const imageMatch = trimmed.match(/^(?:OBS|FRAME|IMAGE)[_\s-]?(\d+)\b/iu);
    if (imageMatch) {
      const tokens = parseTokenMap(trimmed);
      frames.push({
        image: `IMAGE_${imageMatch[1]}`,
        garment_color: tokens.garment_color ?? tokens.garmentcolor ?? tokens.color ?? "",
        garment_type: tokens.garment_type ?? tokens.garmenttype ?? tokens.type ?? "",
        material: tokens.material ?? "",
        wear: tokens.wear ?? tokens.soil ?? "",
        scene: tokens.scene ?? ""
      });
      continue;
    }
    const compareMatch = trimmed.match(/^COMPARE\s+(OBJECT_IDENTITY|SCENE|TOPIC_MATCH)\b(.*)$/iu);
    if (!compareMatch) continue;
    const axis = compareMatch[1]?.toUpperCase();
    const tokens = parseTokenMap(compareMatch[2] ?? trimmed);
    if (axis === "OBJECT_IDENTITY") {
      compare.identityChange = truthyToken(tokens.identity_change ?? tokens.identitychange ?? tokens.changed);
    } else if (axis === "SCENE") {
      compare.sceneChange = truthyToken(tokens.scene_change ?? tokens.scenechange ?? tokens.changed);
    } else if (axis === "TOPIC_MATCH") {
      compare.topicMismatch = truthyToken(tokens.object_mismatch ?? tokens.objectmismatch ?? tokens.mismatch);
    }
  }
  if (
    frames.length === 0 &&
    compare.identityChange === undefined &&
    compare.sceneChange === undefined &&
    compare.topicMismatch === undefined
  ) {
    return null;
  }
  return { frames, compare };
}

export function detectCarouselRubricIncoherence(
  stdout: string,
  axes: Record<CarouselQaAxis, AxisVerdict | "MISSING">,
  topic = ""
): boolean {
  const observed = parseCarouselObserveBlock(stdout);
  if (!observed) return false;
  const identityChange =
    observed.compare.identityChange === true || carouselIdentityChanged(observed.frames);
  if (identityChange && axes.OBJECT_IDENTITY === "PASS") return true;
  const sceneChange = observed.compare.sceneChange === true || carouselSceneChanged(observed.frames);
  if (sceneChange && axes.SCENE === "PASS") return true;
  const topicMismatch =
    observed.compare.topicMismatch === true || carouselTopicMismatched(observed.frames, topic);
  if (topicMismatch && axes.TOPIC_MATCH === "PASS") return true;
  return false;
}

function emptyCarouselAxes(): Record<CarouselQaAxis, AxisVerdict | "MISSING"> {
  return {
    OBJECT_IDENTITY: "MISSING",
    SCENE: "MISSING",
    TOPIC_MATCH: "MISSING"
  };
}

export function evaluateCarouselJudgeStdout(input: {
  stdout: string;
  topic: string;
  expectedCanaries: Record<string, string>;
  slideSha256s: Record<string, string>;
  promptHash: string;
  runId: string;
  slides: CarouselSlideRecord[];
  sources?: string[];
  date?: string;
  slot?: number;
  reviewedAt?: string;
}): CarouselQaRecord {
  const base = {
    topic: input.topic,
    date: input.date,
    slot: input.slot,
    axes: emptyCarouselAxes(),
    evidence: {} as Partial<Record<CarouselQaAxis, string>>,
    frames_used: [] as string[],
    slides: input.slides,
    sources: input.sources ?? input.slides.map((slide) => slide.source),
    canaries_expected: input.expectedCanaries,
    canaries_reported: {} as Record<string, string>,
    prompt_hash: input.promptHash,
    run_id: input.runId,
    model: "codex-exec-read-only",
    reviewed_by: "codex-visual-qa" as const,
    reviewed_at: input.reviewedAt ?? new Date().toISOString(),
    mode: "warn" as const
  };

  if (Object.keys(input.slideSha256s).length === 0) {
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

  const block = parseVisualQaBlock(input.stdout, CAROUSEL_QA_AXES);
  if (!block) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "unparseable"
    };
  }

  let missingAxis = false;
  let contentFail = false;
  for (const axis of CAROUSEL_QA_AXES) {
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

  const expectedObs = Object.keys(input.expectedCanaries).length || input.slides.length;
  const obsDefects = carouselObservationDefects(parseCarouselObserveBlock(input.stdout), expectedObs);
  if (obsDefects.length > 0) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "missing_observation"
    };
  }

  if (detectCarouselRubricIncoherence(input.stdout, base.axes, input.topic)) {
    return {
      ...base,
      verdict: "FAIL_CLOSED",
      fail_class: "rubric_incoherent"
    };
  }

  const verdict: VisualQaVerdict = contentFail || block.verdict === "FAIL" ? "FAIL" : "PASS";
  return {
    ...base,
    verdict,
    fail_class: contentFail ? "content" : null
  };
}

export async function evaluateCarouselFromDisk(input: {
  qaDir: string;
  stdout: string;
  sidecar: CarouselQaSidecar;
  promptHash: string;
  runId: string;
}): Promise<CarouselQaRecord> {
  const onDisk = await hashPngsInDir(input.qaDir);
  const expectedCanaries: Record<string, string> = {};
  input.sidecar.slides.forEach((slide, index) => {
    expectedCanaries[`IMAGE_${index + 1}`] = slide.canary;
  });
  const record = evaluateCarouselJudgeStdout({
    stdout: input.stdout,
    topic: input.sidecar.topic,
    expectedCanaries,
    slideSha256s: onDisk,
    promptHash: input.promptHash,
    runId: input.runId,
    slides: input.sidecar.slides,
    sources: input.sidecar.slides.map((slide) => slide.source),
    date: input.sidecar.date,
    slot: input.sidecar.slot
  });
  for (const slide of input.sidecar.slides) {
    if (onDisk[slide.name] !== slide.sha256) {
      return { ...record, verdict: "FAIL_CLOSED", fail_class: "hash_mismatch" };
    }
  }
  return record;
}

/** Live carousel judge may retry once; a supplied stdout file is replay-only. */
export const CAROUSEL_JUDGE_LIVE_ATTEMPT_LIMIT = 2;

/**
 * F20 fish-3: the carousel gate fail-closes on missing OBS (correct).
 * Retry only that shape — axes present, observation block absent/incomplete.
 * Any other fail_class, PASS, or content FAIL stays first-shot.
 */
export function shouldRetryCarouselJudge(
  record: Pick<CarouselQaRecord, "fail_class"> | null | undefined
): boolean {
  return record?.fail_class === "missing_observation";
}

export function carouselJudgeAttemptLimit(stdoutSupplied: boolean): number {
  return stdoutSupplied ? 1 : CAROUSEL_JUDGE_LIVE_ATTEMPT_LIMIT;
}

export async function collectCarouselJudgeStdout(input: {
  runJudge: () => Promise<string> | string;
  evaluate: (stdout: string) => Promise<CarouselQaRecord> | CarouselQaRecord;
  attemptLimit: number;
}): Promise<{ record: CarouselQaRecord; attempts: number; stdout: string }> {
  const limit = Math.max(1, Math.floor(input.attemptLimit));
  let stdout = "";
  let record: CarouselQaRecord | undefined;
  let attempts = 0;
  while (attempts < limit) {
    attempts += 1;
    try {
      stdout = await input.runJudge();
      record = await input.evaluate(stdout);
    } catch (err) {
      if (record && shouldRetryCarouselJudge(record)) break;
      throw err;
    }
    if (!shouldRetryCarouselJudge(record)) break;
  }
  if (!record) {
    throw new Error("carousel judge produced no record");
  }
  return { record, attempts, stdout };
}

function ffmpegFontfile(): string {
  const consola = "C:/Windows/Fonts/consola.ttf";
  const arial = "C:/Windows/Fonts/arial.ttf";
  const chosen = existsSync(consola) ? consola : arial;
  return chosen.replace(/^([A-Za-z]):/u, "$1\\:");
}

export async function burnCarouselCanaries(input: {
  sources: string[];
  qaDir: string;
  canaries?: string[];
}): Promise<CarouselSlideRecord[]> {
  await mkdir(input.qaDir, { recursive: true });
  const font = ffmpegFontfile();
  const slides: CarouselSlideRecord[] = [];
  for (const [index, source] of input.sources.entries()) {
    const canary = input.canaries?.[index] ?? randomCanary();
    const name = `slide-${String(index + 1).padStart(2, "0")}.png`;
    const dest = join(input.qaDir, name);
    const draw = `drawtext=fontfile='${font}':text='${canary}':x=16:y=h-56:fontsize=36:fontcolor=yellow:box=1:boxcolor=black@0.88:boxborderw=8`;
    await execFileAsync("ffmpeg", ["-v", "error", "-y", "-i", source, "-vf", draw, dest]);
    slides.push({
      name,
      slide: index + 1,
      source,
      canary,
      sha256: await sha256File(dest)
    });
  }
  return slides;
}
