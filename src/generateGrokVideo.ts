import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { writeVideoPromptManifest, type VideoPromptManifestItem } from "./generateVideo";
import { loadVideoSources, readJsonFile, writeJsonAtomic, writeVideoSources } from "./logging";
import { projectRoot, videoPromptManifestPath } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { VideoSourceRecord } from "./types";
import { assertMetaReelMetadata, normalizeMetaReel, probeVideo } from "./videoMedia";
import { hashVideoPrompt } from "./videoRunFreshness";

const XAI_API_ROOT = "https://api.x.ai/v1";

interface XaiCreateResponse {
  request_id?: string;
  error?: string | { message?: string };
}

interface XaiVideoResult {
  status?: "pending" | "done" | "expired" | "failed";
  video?: { url?: string; duration?: number; respect_moderation?: boolean };
  model?: string;
  progress?: number;
  error?: string | { message?: string };
}

export interface GrokVideoRequest {
  model: "grok-imagine-video";
  prompt: string;
  duration: 10;
  aspect_ratio: "9:16";
  resolution: "720p";
}

function boolValue(value: string | undefined): boolean {
  return ["1", "true", "yes", "y", "on"].includes((value ?? "").toLowerCase());
}

export async function resolveXaiApiKey(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const direct = env.XAI_API_KEY?.trim();
  if (direct) return direct;

  const configuredFile = env.XAI_CREDENTIAL_ENV_FILE?.trim();
  const defaultFile = env.USERPROFILE ? join(env.USERPROFILE, "AI", "New project 2", ".env") : "";
  const candidate = configuredFile || defaultFile;
  if (!candidate) return undefined;

  const filePath = isAbsolute(candidate) ? candidate : resolve(candidate);
  try {
    const values = parseDotenv(await readFile(filePath));
    return values.XAI_API_KEY?.trim() || undefined;
  } catch (error) {
    if (configuredFile) {
      throw new Error(
        `Unable to read XAI_CREDENTIAL_ENV_FILE at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return undefined;
  }
}

function errorMessage(error: XaiCreateResponse["error"] | XaiVideoResult["error"]): string {
  if (!error) return "unknown xAI error";
  if (typeof error === "string") return error;
  return error.message ?? JSON.stringify(error);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function buildGrokVideoRequest(item: VideoPromptManifestItem): GrokVideoRequest {
  return {
    model: "grok-imagine-video",
    prompt: item.prompt,
    duration: 10,
    aspect_ratio: "9:16",
    resolution: "720p"
  };
}

async function fetchJson<T>(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, init);
  const payload = (await response.json()) as T;
  if (!response.ok) throw new Error(`xAI request failed with ${response.status}`);
  return payload;
}

async function pollVideo(
  requestId: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  sleep: (delayMs: number) => Promise<void>
): Promise<XaiVideoResult> {
  for (let attempt = 1; attempt <= 144; attempt += 1) {
    const result = await fetchJson<XaiVideoResult>(
      `${XAI_API_ROOT}/videos/${encodeURIComponent(requestId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      fetchImpl
    );
    if (result.status === "done" && result.video?.url) return result;
    if (result.status === "failed" || result.status === "expired") {
      throw new Error(`xAI video ${result.status}: ${errorMessage(result.error)}`);
    }
    await sleep(5000);
  }
  throw new Error(`xAI video generation timed out for request ${requestId}`);
}

async function downloadVideo(url: string, targetPath: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`xAI video download failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("xAI returned an empty video file");
  await writeFile(targetPath, bytes);
}

async function writeRunReport(
  root: string,
  item: VideoPromptManifestItem,
  report: Record<string, unknown>
): Promise<void> {
  const runDir = join(root, "data", "video-runs", item.date, `slot-${String(item.slot).padStart(2, "0")}`);
  await mkdir(runDir, { recursive: true });
  await writeJsonAtomic(join(runDir, "run.json"), report);
}

async function generateOne(
  item: VideoPromptManifestItem,
  root: string,
  apiKey: string,
  force: boolean,
  fetchImpl: typeof fetch,
  sleep: (delayMs: number) => Promise<void>
): Promise<VideoSourceRecord> {
  const finalPath = join(root, ...item.target_path.split("/"));
  if ((await exists(finalPath)) && !force) {
    const existing = (await loadVideoSources(item.date, root)).find(
      (entry) => entry.slot === item.slot && entry.video_path === item.target_path
    );
    if (existing) return existing;
    throw new Error(`${item.target_path} already exists without a matching video source record.`);
  }

  await mkdir(dirname(finalPath), { recursive: true });
  if ((await exists(finalPath)) && force) {
    await rename(finalPath, finalPath.replace(/\.mp4$/, `.backup-${Date.now()}.mp4`));
  }

  const requestBody = buildGrokVideoRequest(item);
  const promptHash = hashVideoPrompt(item.prompt);
  const runDir = join(root, "data", "video-runs", item.date, `slot-${String(item.slot).padStart(2, "0")}`);
  await mkdir(runDir, { recursive: true });
  const sourcePath = join(runDir, `source-${Date.now()}.mp4`);
  const normalizedPath = `${finalPath}.tmp.mp4`;

  try {
    const created = await fetchJson<XaiCreateResponse>(
      `${XAI_API_ROOT}/videos/generations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      },
      fetchImpl
    );
    if (!created.request_id) throw new Error(`xAI did not return request_id: ${errorMessage(created.error)}`);

    const result = await pollVideo(created.request_id, apiKey, fetchImpl, sleep);
    await downloadVideo(result.video?.url ?? "", sourcePath, fetchImpl);
    await normalizeMetaReel(sourcePath, normalizedPath);
    const metadata = await probeVideo(normalizedPath);
    assertMetaReelMetadata(metadata);
    await rename(normalizedPath, finalPath);

    const record: VideoSourceRecord = {
      date: item.date,
      slot: item.slot,
      source: "grok-imagine-video",
      model: result.model ?? requestBody.model,
      video_path: item.target_path,
      request_id: created.request_id,
      source_route: "xai-api",
      source_reference: created.request_id,
      duration_seconds: metadata.duration_seconds,
      width: metadata.width,
      height: metadata.height,
      frame_rate: metadata.frame_rate,
      video_codec: metadata.video_codec,
      audio_codec: metadata.audio_codec,
      marked_at: new Date().toISOString()
    };
    const entries = (await loadVideoSources(item.date, root)).filter((entry) => entry.slot !== item.slot);
    entries.push(record);
    entries.sort((a, b) => a.slot - b.slot);
    await writeVideoSources(item.date, entries, root);
    await writeRunReport(root, item, {
      status: "complete",
      request_id: created.request_id,
      model: record.model,
      prompt_hash: promptHash,
      target_path: item.target_path,
      source_path: sourcePath.replace(`${root}\\`, ""),
      metadata,
      completed_at: record.marked_at
    });
    return record;
  } catch (error) {
    await rm(normalizedPath, { force: true });
    await writeRunReport(root, item, {
      status: "failed",
      prompt_hash: promptHash,
      target_path: item.target_path,
      error: error instanceof Error ? error.message : String(error),
      failed_at: new Date().toISOString()
    });
    throw error;
  }
}

export async function generateGrokVideos(options: {
  date: string;
  slot?: number;
  root?: string;
  live?: boolean;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<VideoSourceRecord[]> {
  const root = projectRoot(options.root);
  await writeVideoPromptManifest(options.date, root);
  const manifest = await readJsonFile<VideoPromptManifestItem[]>(videoPromptManifestPath(options.date, root), []);
  const selected = options.slot ? manifest.filter((item) => item.slot === options.slot) : manifest;
  if (selected.length === 0) return [];

  if (!options.live) {
    throw new Error("Grok video generation is paid and disabled by default. Use --live only after setting XAI_VIDEO_BILLING_ACK=true.");
  }
  const env = options.env ?? process.env;
  if (!boolValue(env.XAI_VIDEO_BILLING_ACK)) {
    throw new Error("XAI_VIDEO_BILLING_ACK=true is required before paid Grok video generation.");
  }
  const apiKey = await resolveXaiApiKey(env);
  if (!apiKey) {
    throw new Error(
      "XAI_API_KEY is required for official Grok video generation. It may be set directly or supplied through XAI_CREDENTIAL_ENV_FILE."
    );
  }

  const records: VideoSourceRecord[] = [];
  for (const item of selected) {
    records.push(
      await generateOne(
        item,
        root,
        apiKey,
        options.force ?? false,
        options.fetchImpl ?? fetch,
        options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)))
      )
    );
  }
  return records;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));
  const manifestPath = await writeVideoPromptManifest(date, root);

  if (!getFlag(args, "live")) {
    const manifest = await readFile(manifestPath, "utf8");
    console.log(`Grok video handoff ready (no paid API call): ${manifestPath}`);
    console.log(manifest);
    return;
  }

  const records = await generateGrokVideos({
    date,
    slot: getNumberOption(args, "slot"),
    root,
    live: true,
    force: getFlag(args, "force")
  });
  console.log(JSON.stringify(records, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
