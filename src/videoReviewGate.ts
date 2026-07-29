import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { loadDailyContent, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot, videoReviewsPath } from "./paths";
import { hashVideoPrompt } from "./videoRunFreshness";

export interface VideoReviewRecord {
  date: string;
  slot: number;
  video_path: string;
  video_sha256: string;
  prompt_hash: string;
  review_round: number;
  full_decode: "pass";
  all_frame_physics_review: "pass";
  grok_review: "pass";
  sol_review: "pass";
  separate_zh_tw_tts_review: "pass";
  generated_clip_audio_used: false;
  status: "approved";
  reviewed_at: string;
  /**
   * "owner-watched": the owner played this exact file through to the end.
   * "owner-standing-policy-2026-07-29": published under the owner's standing
   * auto-publish authorization; the owner reviews the uploaded Reel afterwards
   * and corrections feed the next day's production. The record must say which
   * one actually happened.
   */
  reviewed_by?: "owner-watched" | "owner-standing-policy-2026-07-29";
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function recordVideoReview(input: {
  date: string;
  slot: number;
  reviewRound: number;
  root?: string;
  now?: Date;
}): Promise<VideoReviewRecord> {
  const root = projectRoot(input.root);
  const content = await loadDailyContent(input.date, root);
  const slot = content?.slots.find((item) => item.slot === input.slot);
  if (!slot?.local_video_path || !slot.video_prompt) {
    throw new Error(`Video slot ${input.slot} is missing a final path or prompt for ${input.date}.`);
  }
  if (input.reviewRound < 1 || input.reviewRound > 3) {
    throw new Error("--review-round must be between 1 and 3.");
  }

  const videoPath = join(root, ...slot.local_video_path.split("/"));
  const record: VideoReviewRecord = {
    date: input.date,
    slot: input.slot,
    video_path: slot.local_video_path,
    video_sha256: await sha256File(videoPath),
    prompt_hash: hashVideoPrompt(slot.video_prompt),
    review_round: input.reviewRound,
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
  return record;
}

export async function assertVideoReviewApproved(input: {
  date: string;
  slot: number;
  videoPath: string;
  videoPrompt: string;
  root?: string;
}): Promise<void> {
  const root = projectRoot(input.root);
  const records = await readJsonFile<VideoReviewRecord[]>(videoReviewsPath(input.date, root), []);
  const record = records.find((entry) => entry.slot === input.slot);
  if (!record) throw new Error(`Dual video review is missing for slot ${input.slot}.`);
  if (record.status !== "approved" || record.grok_review !== "pass" || record.sol_review !== "pass") {
    throw new Error(`Grok and Sol video review did not both pass for slot ${input.slot}.`);
  }
  if (
    record.full_decode !== "pass" ||
    record.all_frame_physics_review !== "pass" ||
    record.separate_zh_tw_tts_review !== "pass" ||
    record.generated_clip_audio_used !== false
  ) {
    throw new Error(`Technical, physics, or TTS review did not pass for slot ${input.slot}.`);
  }
  if (record.video_path !== input.videoPath || record.prompt_hash !== hashVideoPrompt(input.videoPrompt)) {
    throw new Error(`Video review is stale for slot ${input.slot}.`);
  }
  const actualHash = await sha256File(join(root, ...input.videoPath.split("/")));
  if (record.video_sha256 !== actualHash) {
    throw new Error(`Reviewed video file changed after approval for slot ${input.slot}.`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot");
  const reviewRound = getNumberOption(args, "review-round");
  if (!date || !slot || !reviewRound) {
    throw new Error("--date, --slot, and --review-round are required.");
  }
  const requiredPassFlags = [
    "full-decode-pass",
    "all-frame-physics-pass",
    "grok-review-pass",
    "sol-review-pass",
    "tts-review-pass",
    "generated-clip-audio-excluded"
  ];
  const missing = requiredPassFlags.filter((flag) => !getFlag(args, flag));
  if (missing.length > 0) {
    throw new Error(`Refusing to record approval; missing explicit evidence flags: ${missing.join(", ")}`);
  }
  const record = await recordVideoReview({
    date,
    slot,
    reviewRound,
    root: getOption(args, "root")
  });
  console.log(JSON.stringify(record, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
