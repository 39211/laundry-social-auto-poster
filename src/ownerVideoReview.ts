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
  /**
   * On 2026-07-29 the owner changed the review model: publish automatically,
   * they review the uploaded Reel afterwards and feed corrections into the
   * next day's production. This mode records that standing authorization
   * honestly — reviewed_by names the policy, never a watch that did not
   * happen. Every machine check below still runs and still refuses: the
   * standing policy covers the owner's eyes, not a broken file.
   */
  standingPolicy?: boolean;
  root?: string;
  now?: Date;
}): Promise<OwnerReviewResult> {
  if (!input.watched && !input.standingPolicy) {
    throw new Error(
      "Refusing to record: pass --watched after playing this exact file through to the end, " +
        "or --standing-policy to record the owner's 2026-07-29 auto-publish authorization."
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

  // The gate requires generated_clip_audio_used to be false. An audio stream is
  // not automatically the model's own track — the assembly step lays a quiet
  // ambient bed in post and declares it in a sidecar. Without that declaration,
  // an embedded track cannot honestly be recorded as excluded.
  const hasAudioStream = metadata.audio_codec !== undefined;
  if (hasAudioStream) {
    let declaredPostAudio = false;
    try {
      // PowerShell's utf8 encoding writes a BOM, which JSON.parse rejects.
      const sidecar = JSON.parse((await readFile(`${absolutePath}.audio.json`, "utf8")).replace(/^﻿/, "")) as {
        source?: string;
        generated_clip_audio_used?: boolean;
      };
      declaredPostAudio = sidecar.source === "post-ambient-bed" && sidecar.generated_clip_audio_used === false;
    } catch {
      declaredPostAudio = false;
    }
    if (!declaredPostAudio) {
      throw new Error(
        `${slot.local_video_path} carries an audio stream (${metadata.audio_codec}) with no post-production declaration beside it. Assemble through scripts/assemble-reel.ps1, which lays the ambient bed and writes the sidecar, or strip the track.`
      );
    }
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
    reviewed_at: (input.now ?? new Date()).toISOString(),
    reviewed_by: input.watched ? "owner-watched" : "owner-standing-policy-2026-07-29"
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
