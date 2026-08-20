import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { loadDailyContent, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot, videoReviewsPath } from "./paths";
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
//
// F29: produce-next-reel re-runs this writer over days that may already hold a
// human verdict. The writer owns only its schedule stamps: an approved or
// rejected record for the same asset keeps every field it did not author, and
// when the asset genuinely changed (sha or prompt), review resets to pending
// while the old verdict moves into `superseded` so the reject trail survives.

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

// A decode error in any frame makes ffmpeg print to stderr; an empty stderr is
// a full clean decode. This is the machine half of "someone actually looked".
async function assertFullDecode(filePath: string): Promise<void> {
  const { stderr } = await execFileAsync("ffmpeg", [
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
  /**
   * Verdicts recorded against earlier assets of this slot, appended (oldest
   * first) each time a re-schedule replaced the asset they judged. Append-only.
   */
  superseded?: Array<Record<string, unknown>>;
}

/**
 * An approved or rejected verdict re-stamped with schedule metadata at
 * re-schedule time. Verdict fields ride through untouched via the index
 * signature; only the schedule stamps are this writer's to refresh.
 */
export interface PreservedVerdictEntry {
  [key: string]: unknown;
  date: string;
  slot: number;
  video_path: string;
  video_sha256: string;
  prompt_hash: string;
  status: string;
  recorded_at: string;
  recorded_by: typeof STANDING_POLICY_METADATA_BY;
  superseded?: Array<Record<string, unknown>>;
}

export type VideoReviewFileEntry =
  | VideoReviewRecord
  | StandingPolicyMetadataRecord
  | PreservedVerdictEntry;

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
  /** An existing publish-gate-satisfying approval was kept for this asset. */
  preserved_existing_approval?: boolean;
  /** F29: an existing approved/rejected verdict for the same asset was kept. */
  preserved_existing_verdict?: boolean;
  /** F29: a new asset reset review to pending; the old verdict is in `superseded`. */
  superseded_previous_verdict?: boolean;
}

export function isStandingPolicyStamp(entry: {
  reviewed_by?: string;
}): boolean {
  return entry.reviewed_by === STANDING_POLICY_REVIEWER;
}

export function reviewSatisfiesPublishGate(entry: {
  status?: unknown;
  grok_review?: unknown;
  sol_review?: unknown;
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

export type StandingPolicyMergeOutcome = "fresh" | "preserved_verdict" | "superseded_verdict";

// A corrupt non-array `superseded` is still audit data; carry it as one entry
// rather than silently dropping it.
function normalizeHistory(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  return [value as Record<string, unknown>];
}

/**
 * F29: flatten everything a rewrite of a slot is about to displace, oldest
 * first: each record's own `superseded` history, plus every displaced record
 * that is not this writer's own pending scaffolding (status "pending").
 * `keep` marks the record that stays current and is therefore not folded.
 * No verdict — and no unrecognisable hand-written record — is ever dropped.
 */
export function collectDisplacedHistory(
  records: VideoReviewFileEntry[],
  keep?: VideoReviewFileEntry
): Array<Record<string, unknown>> {
  const history: Array<Record<string, unknown>> = [];
  for (const record of records) {
    const { superseded, ...rest }: Record<string, unknown> = { ...record };
    history.push(...normalizeHistory(superseded));
    if (record !== keep && rest.status !== "pending") history.push(rest);
  }
  return history;
}

/**
 * F29: decide what a standing-policy re-stamp may write over a slot's existing
 * records. This writer authors schedule stamps (recorded_at, recorded_by,
 * video_path) and pending review scaffolding — never verdicts. Among duplicate
 * records for the slot a verdict (approved/rejected) wins over pending
 * scaffolding. A verdict for the same asset (sha and prompt unchanged) keeps
 * every field this writer did not author; a verdict for a different asset
 * resets to pending with the old verdict appended to `superseded`. Anything
 * displaced that is not clean pending scaffolding rides along in `superseded`.
 */
export function mergeStandingPolicyMetadata(
  sameSlotRecords: VideoReviewFileEntry[],
  metadata: StandingPolicyMetadataRecord
): { entry: VideoReviewFileEntry; outcome: StandingPolicyMergeOutcome } {
  const primary =
    sameSlotRecords.find((record) => record.status === "approved" || record.status === "rejected") ??
    sameSlotRecords[0];
  if (!primary) return { entry: metadata, outcome: "fresh" };

  const status = primary.status;
  if (status !== "approved" && status !== "rejected") {
    const history = collectDisplacedHistory(sameSlotRecords);
    return {
      entry: history.length > 0 ? { ...metadata, superseded: history } : metadata,
      outcome: "fresh"
    };
  }

  // Runtime records are looser than the declared types (rejected verdicts,
  // review_note, restore annotations); a loose clone lets every field the
  // writer did not author ride through untouched.
  const { superseded: _primaryHistory, ...primaryRest }: Record<string, unknown> = { ...primary };
  const history = collectDisplacedHistory(sameSlotRecords, primary);

  const sameAsset =
    primary.video_sha256 === metadata.video_sha256 &&
    primary.prompt_hash === metadata.prompt_hash;
  if (sameAsset) {
    return {
      entry: {
        ...primaryRest,
        status,
        date: metadata.date,
        slot: metadata.slot,
        video_path: metadata.video_path,
        video_sha256: metadata.video_sha256,
        prompt_hash: metadata.prompt_hash,
        recorded_at: metadata.recorded_at,
        recorded_by: metadata.recorded_by,
        ...(history.length > 0 ? { superseded: history } : {})
      },
      outcome: "preserved_verdict"
    };
  }

  return {
    entry: { ...metadata, superseded: [...history, primaryRest] },
    outcome: "superseded_verdict"
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

// There is no cross-process lock on the review file (hand edits and other
// writers race any read-modify-write). Callers must read `records` as late as
// possible — every await between read and write is a window in which another
// writer's record would be silently clobbered.
async function replaceSlotEntry(input: {
  path: string;
  slot: number;
  records: VideoReviewFileEntry[];
  entry: VideoReviewFileEntry;
}): Promise<void> {
  const next = input.records.filter((record) => record.slot !== input.slot);
  next.push(input.entry);
  next.sort((a, b) => a.slot - b.slot);
  await writeJsonAtomic(input.path, next);
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
    // Hash before reading the review file: a missing or unreadable video fails
    // loudly here with nothing written, and the read-to-write window stays as
    // small as the merge itself (see replaceSlotEntry).
    const metadata = buildStandingPolicyMetadata({
      date: input.date,
      slot: input.slot,
      videoPath: loaded.videoPath,
      videoSha256: await sha256File(loaded.absolutePath),
      promptHash: hashVideoPrompt(loaded.prompt),
      recordedAt
    });
    const path = videoReviewsPath(input.date, root);
    const records = await readJsonFile<VideoReviewFileEntry[]>(path, []);
    const sameSlot = records.filter((entry) => entry.slot === input.slot);
    const { entry, outcome } = mergeStandingPolicyMetadata(sameSlot, metadata);
    await replaceSlotEntry({ path, slot: input.slot, records, entry });
    return {
      record: entry,
      preserved_existing_approval:
        outcome === "preserved_verdict" && reviewSatisfiesPublishGate(entry) ? true : undefined,
      preserved_existing_verdict: outcome === "preserved_verdict" ? true : undefined,
      superseded_previous_verdict: outcome === "superseded_verdict" ? true : undefined
    };
  }

  await assertFullDecode(loaded.absolutePath);
  const metadata = await probeVideo(loaded.absolutePath);
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

  // F29: the owner's watch may legitimately override an earlier verdict, but
  // the displaced verdict (and any superseded history) stays in the trail.
  const path = videoReviewsPath(input.date, root);
  const records = await readJsonFile<VideoReviewFileEntry[]>(path, []);
  const displaced = collectDisplacedHistory(records.filter((entry) => entry.slot === input.slot));
  const entry: VideoReviewRecord =
    displaced.length > 0 ? { ...record, superseded: displaced } : record;
  await replaceSlotEntry({ path, slot: input.slot, records, entry });

  return {
    record: entry,
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
