import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { padSlot, projectRoot } from "./paths";

/** Same SHA-256 algorithm written into run.json by generateGrokVideo. */
export function hashVideoPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

export function videoRunReportPath(date: string, slot: number, root = projectRoot()): string {
  return join(root, "data", "video-runs", date, `slot-${padSlot(slot)}`, "run.json");
}

export type ReelFreshnessCode =
  | "fresh"
  | "missing_run"
  | "invalid_run"
  | "incomplete"
  | "target_mismatch"
  | "prompt_mismatch";

export interface ReelFreshnessAssessment {
  ok: boolean;
  code: ReelFreshnessCode;
  /** English error text for publish validation / CLI. */
  message: string;
  /** Traditional Chinese label for operations dashboard media_state. */
  media_state: string;
  /** Traditional Chinese next step when not fresh. */
  next_action: string;
  run_path: string;
  expected_prompt_hash: string;
  run_prompt_hash?: string;
  run_status?: string;
  run_target_path?: string;
}

export interface AssessReelRunFreshnessInput {
  date: string;
  slot: number;
  videoPrompt: string;
  targetPath: string;
  root?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared Reel run/prompt freshness check for publish validation and the ops dashboard.
 * A complete run must exist, target the current slot path, and match the current video_prompt hash.
 */
export async function assessReelRunFreshness(
  input: AssessReelRunFreshnessInput
): Promise<ReelFreshnessAssessment> {
  const root = projectRoot(input.root);
  const runPath = videoRunReportPath(input.date, input.slot, root);
  const expectedPromptHash = hashVideoPrompt(input.videoPrompt);
  const base = {
    run_path: runPath,
    expected_prompt_hash: expectedPromptHash,
    next_action: "重新生成 Reel"
  };

  if (!(await fileExists(runPath))) {
    return {
      ...base,
      ok: false,
      code: "missing_run",
      message: `Reel run report is missing for slot ${input.slot}: ${runPath}`,
      media_state: "缺 Reel 產製紀錄"
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(runPath, "utf8"));
  } catch (error) {
    return {
      ...base,
      ok: false,
      code: "invalid_run",
      message: `Reel run report is invalid JSON for slot ${input.slot}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      media_state: "Reel 產製紀錄損壞"
    };
  }

  if (!isRecord(raw)) {
    return {
      ...base,
      ok: false,
      code: "invalid_run",
      message: `Reel run report must be a JSON object for slot ${input.slot}: ${runPath}`,
      media_state: "Reel 產製紀錄損壞"
    };
  }

  const runStatus = typeof raw.status === "string" ? raw.status : undefined;
  const runPromptHash = typeof raw.prompt_hash === "string" ? raw.prompt_hash : undefined;
  const runTargetPath = typeof raw.target_path === "string" ? raw.target_path : undefined;

  if (runStatus !== "complete") {
    return {
      ...base,
      ok: false,
      code: "incomplete",
      message: `Reel run is not complete for slot ${input.slot} (status=${runStatus ?? "missing"}). Regenerate the Reel before publish.`,
      media_state: "Reel 產製未完成",
      run_status: runStatus,
      run_prompt_hash: runPromptHash,
      run_target_path: runTargetPath
    };
  }

  if (runTargetPath !== input.targetPath) {
    return {
      ...base,
      ok: false,
      code: "target_mismatch",
      message: `Reel run target_path mismatch for slot ${input.slot}: run has ${
        runTargetPath ?? "(missing)"
      }, slot expects ${input.targetPath}. Stale creative or wrong run — regenerate the Reel.`,
      media_state: "Reel 路徑不一致",
      run_status: runStatus,
      run_prompt_hash: runPromptHash,
      run_target_path: runTargetPath
    };
  }

  if (runPromptHash !== expectedPromptHash) {
    return {
      ...base,
      ok: false,
      code: "prompt_mismatch",
      message: `Reel prompt hash mismatch for slot ${input.slot}: run prompt_hash=${
        runPromptHash ?? "(missing)"
      }, current video_prompt hash=${expectedPromptHash}. Stale creative/prompt mismatch — regenerate the Reel before publish.`,
      media_state: "Reel 創意已過期",
      run_status: runStatus,
      run_prompt_hash: runPromptHash,
      run_target_path: runTargetPath
    };
  }

  return {
    ...base,
    ok: true,
    code: "fresh",
    message: "Reel run matches the current prompt and target path.",
    media_state: "就緒",
    next_action: "完成",
    run_status: runStatus,
    run_prompt_hash: runPromptHash,
    run_target_path: runTargetPath
  };
}

export function assertReelRunFresh(assessment: ReelFreshnessAssessment): void {
  if (!assessment.ok) {
    throw new Error(assessment.message);
  }
}
