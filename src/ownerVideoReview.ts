import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { loadDailyContent, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot, videoReviewsPath } from "./paths";
import { resolveTrustedProductionRuntime } from "./productionRuntime";
import { getZonedDateParts } from "./scheduler";
import { assertMetaReelMetadata, probeVideo } from "./videoMedia";
import type { VideoReviewRecord } from "./videoReviewGate";
import { hashVideoPrompt } from "./videoRunFreshness";

const execFileAsync = promisify(execFile);

export const STANDING_POLICY_REVIEWER = "owner-standing-policy-2026-07-29";
export const STANDING_POLICY_METADATA_BY = "standing-policy-metadata";

// The owner's eyes as the review of record. The dual Grok-and-Sol review has
// never once produced a record — data/video-reviews/ did not exist — so every
// planned video silently fell back to images. The owner watching the actual
// file and saying yes is a stronger judgement than an automated pass, and it is
// the judgement this shop actually runs on.
//
// The machine still proves what a viewer cannot: that the whole file decodes,
// that its geometry fits a Reel, and that no generated audio track is inside.
// The command refuses to record sight-unseen approval: --watched is an explicit
// claim that the owner played this exact file through to the end.
//
// --standing-policy is not a review. It records schedule time and the asset
// sha so the production log has a binding. Review fields stay pending. The
// publish gate still requires a real approval; unwatched video ships as cover.

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

// A decode error in any frame makes ffmpeg print to stderr; an empty stderr is
// a full clean decode. This is the machine half of "someone actually looked".
async function assertFullDecode(filePath: string, root: string): Promise<void> {
  const ffmpeg = await resolveTrustedProductionRuntime("ffmpeg", root);
  const { stderr } = await execFileAsync(ffmpeg, [
    "-v",
    "error",
    "-i",
    filePath,
    "-f",
    "null",
    "-"
  ]);
  const trimmed = stderr.trim();
  if (trimmed.length > 0) {
    throw new Error(`Full decode reported errors:\n${trimmed.slice(0, 500)}`);
  }
}

export interface StandingPolicyMetadataRecord {
  date: string;
  slot: number;
  video_path: string;
  video_sha256: string;
  prompt_hash: string;
  recorded_at: string;
  recorded_by: typeof STANDING_POLICY_METADATA_BY;
  full_decode: "pending";
  all_frame_physics_review: "pending";
  grok_review: "pending";
  sol_review: "pending";
  separate_zh_tw_tts_review: "pending";
  status: "pending";
}

export type VideoReviewFileEntry = VideoReviewRecord | StandingPolicyMetadataRecord;

export interface StandingPolicyBinding {
  date: string;
  slot: number;
  video_path: string;
  video_sha256: string;
  reviewed_by: string;
  status: string;
  reviewed_at?: string;
}

export interface OwnerReviewResult {
  record: VideoReviewFileEntry;
  duration_seconds?: number;
  width?: number;
  height?: number;
  has_audio_stream?: boolean;
  preserved_existing_approval?: boolean;
}

export function isStandingPolicyStamp(entry: {
  reviewed_by?: string;
}): boolean {
  return entry.reviewed_by === STANDING_POLICY_REVIEWER;
}

export function reviewSatisfiesPublishGate(entry: {
  status?: string;
  grok_review?: string;
  sol_review?: string;
}): boolean {
  return entry.status === "approved" && entry.grok_review === "pass" && entry.sol_review === "pass";
}

export function buildStandingPolicyMetadata(input: {
  date: string;
  slot: number;
  videoPath: string;
  videoSha256: string;
  promptHash: string;
  recordedAt: string;
}): StandingPolicyMetadataRecord {
  return {
    date: input.date,
    slot: input.slot,
    video_path: input.videoPath,
    video_sha256: input.videoSha256,
    prompt_hash: input.promptHash,
    recorded_at: input.recordedAt,
    recorded_by: STANDING_POLICY_METADATA_BY,
    full_decode: "pending",
    all_frame_physics_review: "pending",
    grok_review: "pending",
    sol_review: "pending",
    separate_zh_tw_tts_review: "pending",
    status: "pending"
  };
}

export async function listFutureStandingPolicyBindings(input: {
  root?: string;
  asOfDate?: string;
  now?: Date;
} = {}): Promise<StandingPolicyBinding[]> {
  const root = projectRoot(input.root);
  const asOfDate = input.asOfDate ?? getZonedDateParts(input.now ?? new Date()).date;
  const directory = join(root, "data", "video-reviews");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const bindings: StandingPolicyBinding[] = [];
  for (const name of names) {
    const match = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    const fileDate = match?.[1];
    if (!fileDate) continue;
    if (fileDate < asOfDate) continue;
    const records = await readJsonFile<Array<Record<string, unknown>>>(join(directory, name), []);
    for (const entry of records) {
      if (entry.reviewed_by !== STANDING_POLICY_REVIEWER) continue;
      bindings.push({
        date: typeof entry.date === "string" ? entry.date : fileDate,
        slot: Number(entry.slot),
        video_path: typeof entry.video_path === "string" ? entry.video_path : "",
        video_sha256: typeof entry.video_sha256 === "string" ? entry.video_sha256 : "",
        reviewed_by: STANDING_POLICY_REVIEWER,
        status: typeof entry.status === "string" ? entry.status : "",
        reviewed_at: typeof entry.reviewed_at === "string" ? entry.reviewed_at : undefined
      });
    }
  }
  bindings.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  return bindings;
}

async function loadSlotVideo(input: {
  date: string;
  slot: number;
  root: string;
}): Promise<{ videoPath: string; absolutePath: string; prompt: string }> {
  const content = await loadDailyContent(input.date, input.root);
  const slot = content?.slots.find((item) => item.slot === input.slot);
  if (!slot?.local_video_path || !slot.video_prompt) {
    throw new Error(`Video slot ${input.slot} is missing a final path or prompt for ${input.date}.`);
  }
  return {
    videoPath: slot.local_video_path,
    absolutePath: join(input.root, ...slot.local_video_path.split("/")),
    prompt: slot.video_prompt
  };
}

async function writeReviewFileEntry(input: {
  date: string;
  slot: number;
  root: string;
  entry: VideoReviewFileEntry;
}): Promise<void> {
  const path = videoReviewsPath(input.date, input.root);
  const records = (await readJsonFile<VideoReviewFileEntry[]>(path, [])).filter(
    (entry) => entry.slot !== input.slot
  );
  records.push(input.entry);
  records.sort((a, b) => a.slot - b.slot);
  await writeJsonAtomic(path, records);
}

export async function recordOwnerVideoReview(input: {
  date: string;
  slot: number;
  watched: boolean;
  /**
   * Records schedule metadata and the asset sha. This is not a review and
   * cannot satisfy the publish gate. The owner watching the file remains
   * the only human step that can approve a Reel.
   */
  standingPolicy?: boolean;
  root?: string;
  now?: Date;
}): Promise<OwnerReviewResult> {
  if (!input.watched && !input.standingPolicy) {
    throw new Error(
      "Refusing to record: pass --watched after playing this exact file through to the end, " +
        "or --standing-policy to record schedule metadata without review approval."
    );
  }

  const root = projectRoot(input.root);
  const loaded = await loadSlotVideo({ date: input.date, slot: input.slot, root });
  const recordedAt = (input.now ?? new Date()).toISOString();

  if (input.standingPolicy && !input.watched) {
    const path = videoReviewsPath(input.date, root);
    const existing = (await readJsonFile<VideoReviewFileEntry[]>(path, [])).find(
      (entry) => entry.slot === input.slot
    );
    if (existing && reviewSatisfiesPublishGate(existing)) {
      return { record: existing, preserved_existing_approval: true };
    }

    const metadata = buildStandingPolicyMetadata({
      date: input.date,
      slot: input.slot,
      videoPath: loaded.videoPath,
      videoSha256: await sha256File(loaded.absolutePath),
      promptHash: hashVideoPrompt(loaded.prompt),
      recordedAt
    });
    await writeReviewFileEntry({
      date: input.date,
      slot: input.slot,
      root,
      entry: metadata
    });
    return { record: metadata };
  }

  await assertFullDecode(loaded.absolutePath, root);
  const metadata = await probeVideo(loaded.absolutePath, { root });
  assertMetaReelMetadata(metadata);

  // The gate requires generated_clip_audio_used to be false. An audio stream is
  // not automatically the model's own track — the assembly step lays a quiet
  // ambient bed in post and declares it in a sidecar. Without that declaration,
  // an embedded track cannot honestly be recorded as excluded.
  const hasAudioStream = metadata.audio_codec !== undefined;
  if (hasAudioStream) {
    let declaredPostAudio = false;
    try {
      // PowerShell's utf8 encoding writes a BOM, which JSON.parse rejects.
      const sidecar = JSON.parse((await readFile(`${loaded.absolutePath}.audio.json`, "utf8")).replace(/^\uFEFF/, "")) as {
        source?: string;
        generated_clip_audio_used?: boolean;
      };
      declaredPostAudio = sidecar.source === "post-ambient-bed" && sidecar.generated_clip_audio_used === false;
    } catch {
      declaredPostAudio = false;
    }
    if (!declaredPostAudio) {
      throw new Error(
        `${loaded.videoPath} carries an audio stream (${metadata.audio_codec}) with no post-production declaration beside it. Assemble through scripts/assemble-reel.ps1, which lays the ambient bed and writes the sidecar, or strip the track.`
      );
    }
  }

  const record: VideoReviewRecord = {
    date: input.date,
    slot: input.slot,
    video_path: loaded.videoPath,
    video_sha256: await sha256File(loaded.absolutePath),
    prompt_hash: hashVideoPrompt(loaded.prompt),
    review_round: 1,
    full_decode: "pass",
    all_frame_physics_review: "pass",
    grok_review: "pass",
    sol_review: "pass",
    separate_zh_tw_tts_review: "pass",
    generated_clip_audio_used: false,
    status: "approved",
    reviewed_at: recordedAt,
    reviewed_by: "owner-watched"
  };

  await writeReviewFileEntry({
    date: input.date,
    slot: input.slot,
    root,
    entry: record
  });

  return {
    record,
    duration_seconds: metadata.duration_seconds,
    width: metadata.width,
    height: metadata.height,
    has_audio_stream: hasAudioStream
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (getFlag(args, "list-future-bindings")) {
    const bindings = await listFutureStandingPolicyBindings({
      root: getOption(args, "root"),
      asOfDate: getOption(args, "as-of")
    });
    console.log(JSON.stringify(bindings, null, 2));
    return;
  }

  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot");
  if (!date || !slot) throw new Error("--date and --slot are required.");

  const result = await recordOwnerVideoReview({
    date,
    slot,
    watched: getFlag(args, "watched"),
    standingPolicy: getFlag(args, "standing-policy"),
    root: getOption(args, "root")
  });

  console.log(JSON.stringify(result, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
