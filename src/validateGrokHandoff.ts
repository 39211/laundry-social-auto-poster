import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import {
  assertMetaReelMetadata,
  fullDecodeVideo,
  probeVideo,
  type VideoMetadata
} from "./videoMedia";

interface HashedAsset {
  file: string;
  bytes: number;
  sha256: string;
}

interface HandoffManifest {
  schema_version: string;
  handoff_id: string;
  status: "handoff_ready";
  state: {
    handoff_ready: true;
    generated: false;
    technical_validated: false;
    creative_validated: false;
    publish_authorized: false;
  };
  authorization: {
    automated_generation_authorized: false;
    manual_web_submission: "owner_action_required" | "owner_authorized";
  };
  pipeline: {
    assignment_status: "unassigned" | "standalone_test";
    date: null;
    slot: null;
    import_ready: false;
  };
  shot: {
    input: HashedAsset;
    prompt: HashedAsset;
    expected_download: string;
  };
  postproduction_audio: {
    tts_file: string;
    bytes: number;
    sha256: string;
  };
}

interface ManualRunRecord {
  status: "not_submitted" | "submitted" | "processing" | "downloaded" | "failed";
  page_or_post_url: string | null;
  source_reference: string | null;
  expected_download: string;
  download_sha256: string | null;
}

export interface HandoffValidationReport {
  schema_version: "1.0";
  handoff_id: string;
  status: "handoff_ready" | "returned_clip_technical_pass" | "invalid";
  checked_at: string;
  state: {
    handoff_ready: boolean;
    generated: boolean;
    technical_validated: boolean;
    creative_validated: false;
    pipeline_assigned: boolean;
    standalone_test: boolean;
    publish_authorized: false;
    publish_ready: false;
  };
  checks: {
    manifest_semantics: boolean;
    input_hash: boolean;
    prompt_hash: boolean;
    tts_hash: boolean;
    manual_record_consistent: boolean;
    returned_clip_present: boolean;
    returned_clip_full_decode: boolean;
    returned_clip_meta_technical: boolean;
  };
  blockers: string[];
  returned_clip?: {
    file: string;
    bytes: number;
    sha256: string;
    metadata: VideoMetadata;
  };
}

export interface ValidateGrokHandoffOptions {
  handoffDir: string;
  root?: string;
  writeReport?: boolean;
  now?: Date;
  probe?: typeof probeVideo;
  decode?: typeof fullDecodeVideo;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readRequiredJson<T>(filePath: string): Promise<T> {
  try {
    return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/u, "")) as T;
  } catch (error) {
    throw new Error(
      `Required handoff JSON is missing or invalid: ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function resolveInside(base: string, pathText: string): string {
  const candidate = resolve(base, ...pathText.replaceAll("\\", "/").split("/"));
  const rel = relative(base, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Handoff path escapes its directory: ${pathText}`);
  }
  return candidate;
}

async function validateAsset(base: string, asset: HashedAsset): Promise<boolean> {
  const filePath = resolveInside(base, asset.file);
  if (!(await fileExists(filePath))) return false;
  const info = await stat(filePath);
  return info.size === asset.bytes && (await sha256File(filePath)) === asset.sha256;
}

function hasValidManifestSemantics(manifest: HandoffManifest): boolean {
  const manualSubmissionState =
    manifest.authorization.manual_web_submission === "owner_action_required" ||
    manifest.authorization.manual_web_submission === "owner_authorized";
  const pipelineState =
    manifest.pipeline.assignment_status === "unassigned" ||
    manifest.pipeline.assignment_status === "standalone_test";
  return (
    manifest.status === "handoff_ready" &&
    manifest.state.handoff_ready === true &&
    manifest.state.generated === false &&
    manifest.state.technical_validated === false &&
    manifest.state.creative_validated === false &&
    manifest.state.publish_authorized === false &&
    manifest.authorization.automated_generation_authorized === false &&
    manualSubmissionState &&
    pipelineState &&
    manifest.pipeline.date === null &&
    manifest.pipeline.slot === null &&
    manifest.pipeline.import_ready === false
  );
}

export async function validateGrokHandoff(
  options: ValidateGrokHandoffOptions
): Promise<HandoffValidationReport> {
  const root = projectRoot(options.root);
  const handoffDir = isAbsolute(options.handoffDir)
    ? resolve(options.handoffDir)
    : resolve(root, options.handoffDir);
  const rel = relative(root, handoffDir);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Handoff directory must stay inside the project root: ${handoffDir}`);
  }

  const manifest = await readRequiredJson<HandoffManifest>(
    join(handoffDir, "data", "grok-web-handoff-manifest-v01.json")
  );
  const manual = await readRequiredJson<ManualRunRecord>(
    join(handoffDir, "data", "manual-run-record-v01.json")
  );

  const manifestSemantics = hasValidManifestSemantics(manifest);
  const inputHash = await validateAsset(handoffDir, manifest.shot.input);
  const promptHash = await validateAsset(handoffDir, manifest.shot.prompt);
  const ttsHash = await validateAsset(handoffDir, {
    file: manifest.postproduction_audio.tts_file,
    bytes: manifest.postproduction_audio.bytes,
    sha256: manifest.postproduction_audio.sha256
  });
  const manualConsistent =
    manual.expected_download === manifest.shot.expected_download &&
    (manual.status === "not_submitted" ||
      manual.status === "submitted" ||
      manual.status === "processing" ||
      manual.status === "downloaded" ||
      manual.status === "failed");

  const clipPath = resolveInside(handoffDir, manifest.shot.expected_download);
  const clipPresent = await fileExists(clipPath);
  const blockers: string[] = [];
  if (!manifestSemantics) blockers.push("manifest_state_semantics_invalid");
  if (!inputHash) blockers.push("input_asset_hash_mismatch");
  if (!promptHash) blockers.push("prompt_asset_hash_mismatch");
  if (!ttsHash) blockers.push("tts_asset_hash_mismatch");
  if (!manualConsistent) blockers.push("manual_record_inconsistent");
  if (manifest.pipeline.assignment_status === "unassigned") blockers.push("pipeline_target_unassigned");

  let fullDecode = false;
  let metaTechnical = false;
  let returnedClip: HandoffValidationReport["returned_clip"];

  if (!clipPresent) {
    blockers.push("returned_clip_missing");
  } else if (
    manual.status !== "downloaded" ||
    !(manual.source_reference ?? manual.page_or_post_url)?.trim()
  ) {
    blockers.push("returned_clip_provenance_not_recorded");
  } else {
    const bytes = (await stat(clipPath)).size;
    const sha256 = await sha256File(clipPath);
    if (manual.download_sha256 && manual.download_sha256 !== sha256) {
      blockers.push("returned_clip_hash_mismatch");
    } else {
      const probe = options.probe ?? probeVideo;
      const decode = options.decode ?? fullDecodeVideo;
      try {
        const metadata = await probe(clipPath);
        assertMetaReelMetadata(metadata);
        metaTechnical = true;
        await decode(clipPath);
        fullDecode = true;
        returnedClip = {
          file: manifest.shot.expected_download,
          bytes,
          sha256,
          metadata
        };
      } catch (error) {
        blockers.push(
          `returned_clip_technical_failure:${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  const packageReady = manifestSemantics && inputHash && promptHash && ttsHash && manualConsistent;
  const technicalValidated = clipPresent && fullDecode && metaTechnical;
  const status = !packageReady || (clipPresent && !technicalValidated)
    ? "invalid"
    : technicalValidated
      ? "returned_clip_technical_pass"
      : "handoff_ready";
  const report: HandoffValidationReport = {
    schema_version: "1.0",
    handoff_id: manifest.handoff_id,
    status,
    checked_at: (options.now ?? new Date()).toISOString(),
    state: {
      handoff_ready: packageReady,
      generated: clipPresent,
      technical_validated: technicalValidated,
      creative_validated: false,
      pipeline_assigned: false,
      standalone_test: manifest.pipeline.assignment_status === "standalone_test",
      publish_authorized: false,
      publish_ready: false
    },
    checks: {
      manifest_semantics: manifestSemantics,
      input_hash: inputHash,
      prompt_hash: promptHash,
      tts_hash: ttsHash,
      manual_record_consistent: manualConsistent,
      returned_clip_present: clipPresent,
      returned_clip_full_decode: fullDecode,
      returned_clip_meta_technical: metaTechnical
    },
    blockers,
    ...(returnedClip ? { returned_clip: returnedClip } : {})
  };

  if (options.writeReport) {
    await writeJsonAtomic(join(handoffDir, "qa", "handoff-validation-v01.json"), report);
  }
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const handoffDir = getOption(args, "handoff");
  if (!handoffDir) throw new Error("--handoff is required.");

  const report = await validateGrokHandoff({
    handoffDir,
    root: getOption(args, "root"),
    writeReport: getFlag(args, "write-report")
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "invalid") process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
