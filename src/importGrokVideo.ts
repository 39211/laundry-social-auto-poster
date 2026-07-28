import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import {
  writeVideoCandidateManifest,
  type VideoCandidateManifestItem
} from "./generateVideoCandidate";
import { writeVideoPromptManifest, type VideoPromptManifestItem } from "./generateVideo";
import { loadVideoSources, readJsonFile, writeJsonAtomic, writeVideoSources } from "./logging";
import { projectRoot, videoCandidateManifestPath, videoPromptManifestPath } from "./paths";
import type { VideoSourceRecord } from "./types";
import { assertMetaReelMetadata, normalizeMetaReel, probeVideo, type VideoMetadata } from "./videoMedia";
import { hashVideoPrompt } from "./videoRunFreshness";

export interface ImportGrokVideoOptions {
  date: string;
  slot: number;
  inputPath: string;
  sourceReference: string;
  model?: string;
  sourceRoute?: "grok-web-manual" | "hermes-xai-oauth";
  root?: string;
  normalize?: typeof normalizeMetaReel;
  probe?: typeof probeVideo;
  now?: Date;
}

interface ImportTarget {
  prompt: string;
  target_path: string;
}

async function resolveImportTarget(date: string, slot: number, root: string): Promise<ImportTarget> {
  await writeVideoPromptManifest(date, root);
  const reelManifest = await readJsonFile<VideoPromptManifestItem[]>(videoPromptManifestPath(date, root), []);
  const reelItem = reelManifest.find((entry) => entry.slot === slot);
  if (reelItem) return reelItem;

  await writeVideoCandidateManifest(date, root);
  const candidateManifest = await readJsonFile<VideoCandidateManifestItem[]>(
    videoCandidateManifestPath(date, root),
    []
  );
  const candidate = candidateManifest.find((entry) => entry.slot === slot);
  if (!candidate) throw new Error(`No video manifest item found for ${date} slot ${slot}.`);
  return {
    prompt: candidate.grok_motion_prompt,
    target_path: candidate.formal_video_target_path
  };
}

function assertVerticalSource(metadata: VideoMetadata): void {
  const ratio = metadata.height > 0 ? metadata.width / metadata.height : 0;
  if (metadata.duration_seconds <= 0 || Math.abs(ratio - 9 / 16) > 0.01) {
    throw new Error(
      `Manual Grok source must be a non-empty 9:16 video before normalization; received ${metadata.width}x${metadata.height}, ${metadata.duration_seconds.toFixed(2)}s.`
    );
  }
}

export async function importGrokVideo(options: ImportGrokVideoOptions): Promise<VideoSourceRecord> {
  const root = projectRoot(options.root);
  const inputPath = isAbsolute(options.inputPath) ? resolve(options.inputPath) : resolve(root, options.inputPath);
  await access(inputPath);
  if ((await stat(inputPath)).size === 0) throw new Error(`Manual Grok source is empty: ${inputPath}`);
  if (!options.sourceReference.trim()) throw new Error("A Grok project/post reference is required for provenance.");

  const item = await resolveImportTarget(options.date, options.slot, root);

  const targetPath = join(root, ...item.target_path.split("/"));
  try {
    await access(targetPath);
    throw new Error(`Refusing to overwrite existing Reel: ${item.target_path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const normalize = options.normalize ?? normalizeMetaReel;
  const probe = options.probe ?? probeVideo;
  const sourceMetadata = await probe(inputPath);
  assertVerticalSource(sourceMetadata);
  await mkdir(dirname(targetPath), { recursive: true });
  const normalizedPath = `${targetPath}.tmp.mp4`;
  try {
    await normalize(inputPath, normalizedPath);
    const metadata = await probe(normalizedPath);
    assertMetaReelMetadata(metadata);
    await rename(normalizedPath, targetPath);

    const markedAt = (options.now ?? new Date()).toISOString();
    const record: VideoSourceRecord = {
      date: options.date,
      slot: options.slot,
      source: "grok-imagine-video",
      model: options.model ?? "grok-imagine-video-web",
      video_path: item.target_path,
      request_id: options.sourceReference,
      source_route: options.sourceRoute ?? "grok-web-manual",
      source_reference: options.sourceReference,
      duration_seconds: metadata.duration_seconds,
      width: metadata.width,
      height: metadata.height,
      frame_rate: metadata.frame_rate,
      video_codec: metadata.video_codec,
      audio_codec: metadata.audio_codec,
      marked_at: markedAt
    };
    const entries = (await loadVideoSources(options.date, root)).filter((entry) => entry.slot !== options.slot);
    entries.push(record);
    entries.sort((a, b) => a.slot - b.slot);
    await writeVideoSources(options.date, entries, root);

    await writeJsonAtomic(
      join(root, "data", "video-runs", options.date, `slot-${String(options.slot).padStart(2, "0")}`, "run.json"),
      {
        status: "complete",
        source_route: record.source_route,
        source_reference: record.source_reference,
        source_file: basename(inputPath),
        model: record.model,
        prompt_hash: hashVideoPrompt(item.prompt),
        target_path: item.target_path,
        metadata,
        completed_at: markedAt
      }
    );
    return record;
  } catch (error) {
    await rm(normalizedPath, { force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot");
  const inputPath = getOption(args, "input");
  const sourceReference = getOption(args, "source-reference");
  if (!date || !slot || !inputPath || !sourceReference) {
    throw new Error("--date, --slot, --input, and --source-reference are required.");
  }
  if (getFlag(args, "force")) throw new Error("Manual Grok import does not support --force; preserve existing Reel evidence.");

  const record = await importGrokVideo({
    date,
    slot,
    inputPath,
    sourceReference,
    model: getOption(args, "model"),
    sourceRoute:
      getOption(args, "source-route") === "hermes-xai-oauth"
        ? "hermes-xai-oauth"
        : "grok-web-manual",
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
