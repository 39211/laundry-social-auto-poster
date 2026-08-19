import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  resolveTrustedProductionRuntime,
  type RuntimeResolverOptions
} from "./productionRuntime";

const execFileAsync = promisify(execFile);

export type VideoCommandRunner = (
  executable: string,
  arguments_: string[],
  options?: { maxBuffer?: number }
) => Promise<{ stdout: string; stderr: string }>;

export interface VideoRuntimeOptions extends RuntimeResolverOptions {
  /** Project root whose immutable runtime allowlist is authoritative. */
  root?: string;
  /** Pure command seam for unit tests; production uses node:child_process. */
  execFile?: VideoCommandRunner;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  sample_rate?: string;
  duration?: string;
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
    format_name?: string;
  };
}

export interface VideoMetadata {
  duration_seconds: number;
  width: number;
  height: number;
  frame_rate: number;
  video_codec: string;
  audio_codec?: string;
  audio_sample_rate?: number;
  format_name: string;
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function commandRunner(options: VideoRuntimeOptions): VideoCommandRunner {
  return options.execFile ?? (execFileAsync as VideoCommandRunner);
}

export async function probeVideo(filePath: string, options: VideoRuntimeOptions = {}): Promise<VideoMetadata> {
  const ffprobe = await resolveTrustedProductionRuntime("ffprobe", options.root ?? process.cwd(), options);
  const { stdout } = await commandRunner(options)(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,duration",
    "-of",
    "json",
    filePath
  ]);
  const payload = JSON.parse(stdout) as FfprobePayload;
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  const audio = payload.streams?.find((stream) => stream.codec_type === "audio");
  if (!video) throw new Error(`Video stream is missing: ${filePath}`);

  const duration = Number(payload.format?.duration ?? video.duration ?? 0);
  return {
    duration_seconds: duration,
    width: video.width ?? 0,
    height: video.height ?? 0,
    frame_rate: parseFrameRate(video.avg_frame_rate),
    video_codec: video.codec_name ?? "",
    audio_codec: audio?.codec_name,
    audio_sample_rate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    format_name: payload.format?.format_name ?? ""
  };
}

export async function fullDecodeVideo(filePath: string, options: VideoRuntimeOptions = {}): Promise<void> {
  const ffmpeg = await resolveTrustedProductionRuntime("ffmpeg", options.root ?? process.cwd(), options);
  await commandRunner(options)(
    ffmpeg,
    ["-v", "error", "-i", filePath, "-map", "0:v:0", "-f", "null", "-"],
    { maxBuffer: 4 * 1024 * 1024 }
  );
}

export function assertMetaReelMetadata(metadata: VideoMetadata): void {
  const errors: string[] = [];
  const ratio = metadata.height > 0 ? metadata.width / metadata.height : 0;

  if (metadata.duration_seconds < 4 || metadata.duration_seconds > 60) {
    errors.push(`duration ${metadata.duration_seconds.toFixed(2)}s must be between 4s and 60s`);
  }
  if (metadata.width < 540 || metadata.height < 960) {
    errors.push(`resolution ${metadata.width}x${metadata.height} must be at least 540x960`);
  }
  if (Math.abs(ratio - 9 / 16) > 0.01) {
    errors.push(`aspect ratio ${metadata.width}:${metadata.height} must be 9:16`);
  }
  if (metadata.frame_rate < 23 || metadata.frame_rate > 60) {
    errors.push(`frame rate ${metadata.frame_rate.toFixed(2)} must be between 23 and 60 fps`);
  }
  if (!new Set(["h264", "hevc"]).has(metadata.video_codec)) {
    errors.push(`video codec ${metadata.video_codec || "missing"} must be H.264 or HEVC`);
  }
  if (metadata.audio_codec && metadata.audio_codec !== "aac") {
    errors.push(`audio codec ${metadata.audio_codec} must be AAC when audio is present`);
  }
  if (metadata.audio_sample_rate && metadata.audio_sample_rate !== 48_000) {
    errors.push(`audio sample rate ${metadata.audio_sample_rate} must be 48000 Hz`);
  }

  if (errors.length > 0) throw new Error(`Invalid Meta Reel media:\n- ${errors.join("\n- ")}`);
}

export async function normalizeMetaReel(
  inputPath: string,
  outputPath: string,
  options: VideoRuntimeOptions = {}
): Promise<void> {
  const ffmpeg = await resolveTrustedProductionRuntime("ffmpeg", options.root ?? process.cwd(), options);
  await commandRunner(options)(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      outputPath
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );
}
