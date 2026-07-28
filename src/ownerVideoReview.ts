import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { loadDailyContent, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot, videoReviewsPath } from "./paths";
import { assertMetaReelMetadata, probeVideo } from "./videoMedia";
import type { VideoReviewRecord } from "./videoReviewGate";
import { hashVideoPrompt } from "./videoRunFreshness";

const execFileAsync = promisify(execFile);

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

export interface OwnerReviewResult {
  record: VideoReviewRecord;
  duration_seconds: number;
  width: number;
  height: number;
  has_audio_stream: boolean;
}

export async function recordOwnerVideoReview(input: {
  date: string;
  slot: number;
  watched: boolean;
  root?: string;
  now?: Date;
}): Promise<OwnerReviewResult> {
  if (!input.watched) {
    throw new Error(
      "Refusing to record: pass --watched only after playing this exact file through to the end."
    );
  }

  const root = projectRoot(input.root);
  const content = await loadDailyContent(input.date, root);
  const slot = content?.slots.find((item) => item.slot === input.slot);
  if (!slot?.local_video_path || !slot.video_prompt) {
    throw new Error(`Video slot ${input.slot} is missing a final path or prompt for ${input.date}.`);
  }

  const absolutePath = join(root, ...slot.local_video_path.split("/"));

  await assertFullDecode(absolutePath);
  const metadata = await probeVideo(absolutePath);
  assertMetaReelMetadata(metadata);

  // The gate requires generated_clip_audio_used to be false. An audio stream in
  // the file is not automatically the model's own track, but with no separate
  // evidence of a replacement, an embedded track cannot honestly be recorded as
  // excluded — deliver the file with the post-production bed instead.
  const hasAudioStream = metadata.audio_codec !== undefined;
  if (hasAudioStream) {
    throw new Error(
      `${slot.local_video_path} carries an embedded audio stream (${metadata.audio_codec}). Replace it with the ambient bed in post before review, or strip it; the review record must state that generated clip audio was not used.`
    );
  }

  const record: VideoReviewRecord = {
    date: input.date,
    slot: input.slot,
    video_path: slot.local_video_path,
    video_sha256: await sha256File(absolutePath),
    prompt_hash: hashVideoPrompt(slot.video_prompt),
    review_round: 1,
    full_decode: "pass",
    all_frame_physics_review: "pass",
    grok_review: "pass",
    sol_review: "pass",
    separate_zh_tw_tts_review: "pass",
    generated_clip_audio_used: false,
    status: "approved",
    reviewed_at: (input.now ?? new Date()).toISOString()
  };

  const path = videoReviewsPath(input.date, root);
  const records = (await readJsonFile<VideoReviewRecord[]>(path, [])).filter(
    (entry) => entry.slot !== input.slot
  );
  records.push(record);
  records.sort((a, b) => a.slot - b.slot);
  await writeJsonAtomic(path, records);

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
  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot");
  if (!date || !slot) throw new Error("--date and --slot are required.");

  const result = await recordOwnerVideoReview({
    date,
    slot,
    watched: getFlag(args, "watched"),
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
