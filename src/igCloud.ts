import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { commentTextFor } from "./firstComment";
import { appendPostLog, hasRecordedPost, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import type { AppConfig, DailySlot, MediaType, PostLogEntry } from "./types";

// Instagram has no API scheduling, so it used to publish live from this PC at
// slot time. On 2026-09-29 the PC restarted at 20:24, nobody logged back in,
// Task Scheduler skipped Laundry-Publish-2030 ("user not logged on"), and the
// Reel Facebook had queued three days earlier never reached Instagram -- the
// account where the views are. Owner, 2026-10-01: Instagram goes to the cloud,
// permanently, and everything follows what Facebook got.
//
// So when schedule-ahead queues a slot on Facebook, it also pushes a snapshot of
// exactly what Facebook received to the private repo 39211/laundry-ig-cloud. A
// GitHub Actions job there publishes that snapshot to Instagram at slot time,
// whether or not this PC is on. The local marker in data/ig-cloud/queue/ means
// "the cloud owns Instagram for this slot": the live publisher must not post
// Instagram for it, only record the cloud's result.
//
// The cloud repo's CLOUD_MODE variable is the switch. Snapshots are pushed only
// while it is "live"; otherwise Instagram stays on this PC exactly as before.
// Pausing the line (npm run pause) also writes PAUSED into the cloud repo, which
// the cloud job checks at start and again right before media_publish; no slot
// changes owner, and both sides wait until the owner clears the pause.

export const IG_CLOUD_SCHEMA = "sixiangjia-ig-cloud-snapshot/1";

export interface IgCloudSettings {
  repo: string;
}

export interface IgCloudSnapshot {
  schema: typeof IG_CLOUD_SCHEMA;
  date: string;
  slot: number;
  publish_unix: number;
  ig_media_type: MediaType;
  caption: string;
  image_urls: string[];
  video_url: string | null;
  video_bytes: number | null;
  video_sha256: string | null;
  first_comment: string;
  graph_api_version: string;
  facebook_page_id: string;
  instagram_location_id: string | null;
  public_image_base_url: string;
  fb_scheduled_post_id: string;
  created_at: string;
  /** A slot Facebook already published, sent to Instagram later at publish_unix (on or after its date). */
  backfill?: true;
}

export interface IgCloudResult {
  date: string;
  slot: number;
  mode: string;
  status: "published" | "already_live" | "uncertain" | "shadow_ok";
  post_id?: string;
  comment_id?: string;
  error?: string;
}

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[]) => Promise<GhResult>;

export const ghRunner: GhRunner = (args) =>
  new Promise((resolve) => {
    execFile(
      "gh",
      args,
      { windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    );
  });

export interface IgCloudOptions {
  gh?: GhRunner;
}

// Indirection so tests can stand in for the gh CLI on code paths that do not
// take options (the live publisher's sync); production never reassigns it.
export const igCloudDeps: { gh: GhRunner } = { gh: ghRunner };

/** data/ig-cloud.json present = the cloud integration is installed; absent = off, no network calls. */
export async function loadIgCloudSettings(root: string): Promise<IgCloudSettings | undefined> {
  const raw = await readJsonFile<Partial<IgCloudSettings> | null>(join(root, "data", "ig-cloud.json"), null);
  const repo = typeof raw?.repo === "string" ? raw.repo.trim() : "";
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? { repo } : undefined;
}

export function igCloudMarkerPath(root: string, date: string, slot: number): string {
  return join(root, "data", "ig-cloud", "queue", `${date}-slot${slot}.json`);
}

export async function readIgCloudMarker(root: string, date: string, slot: number): Promise<IgCloudSnapshot | undefined> {
  return readJsonFile<IgCloudSnapshot | undefined>(igCloudMarkerPath(root, date, slot), undefined);
}

/** Instagram media type for a resolved slot, the same mapping postCurrentSlot uses for its Instagram input. */
export function igMediaTypeFor(resolvedMediaType: MediaType | undefined): MediaType {
  if (resolvedMediaType === "reel") return "reel";
  if (resolvedMediaType === "mixed-carousel") return "mixed-carousel";
  if (resolvedMediaType === "carousel") return "carousel";
  return "image";
}

export function buildIgCloudSnapshot(input: {
  date: string;
  slot: DailySlot;
  publishUnix: number;
  igMediaType: MediaType;
  imageUrls: string[];
  videoUrl?: string;
  videoBytes?: number;
  videoSha256?: string;
  config: AppConfig;
  fbScheduledPostId: string;
  now?: Date;
  backfill?: boolean;
}): IgCloudSnapshot {
  const hasVideo = input.igMediaType === "reel" || input.igMediaType === "mixed-carousel";
  return {
    schema: IG_CLOUD_SCHEMA,
    date: input.date,
    slot: input.slot.slot,
    publish_unix: input.publishUnix,
    ig_media_type: input.igMediaType,
    // Owner, 2026-10-01: 文案、貼文、影片發佈全部都要按照 FB 的來.
    caption: input.slot.facebook_caption,
    image_urls: input.igMediaType === "reel" ? [] : input.imageUrls,
    video_url: hasVideo ? (input.videoUrl ?? null) : null,
    video_bytes: hasVideo ? (input.videoBytes ?? null) : null,
    video_sha256: hasVideo ? (input.videoSha256 ?? null) : null,
    first_comment: commentTextFor(input.slot.topic ?? "", input.date, input.slot.slot),
    graph_api_version: input.config.graphApiVersion,
    facebook_page_id: input.config.facebookPageId ?? "",
    instagram_location_id: input.config.instagramLocationId ?? null,
    public_image_base_url: input.config.publicImageBaseUrl,
    fb_scheduled_post_id: input.fbScheduledPostId,
    created_at: (input.now ?? new Date()).toISOString(),
    ...(input.backfill ? { backfill: true as const } : {})
  };
}

function isNotFound(result: GhResult): boolean {
  return /HTTP 404|Not Found/i.test(`${result.stderr}\n${result.stdout}`);
}

async function ghGetFile(
  repo: string,
  path: string,
  gh: GhRunner
): Promise<{ sha: string; text: string } | undefined> {
  const result = await gh(["api", `repos/${repo}/contents/${path}`]);
  if (result.code !== 0) {
    if (isNotFound(result)) return undefined;
    throw new Error(`gh api GET ${path} failed: ${result.stderr.trim().slice(0, 200)}`);
  }
  const body = JSON.parse(result.stdout) as { sha?: string; content?: string };
  return { sha: body.sha ?? "", text: Buffer.from(body.content ?? "", "base64").toString("utf8") };
}

async function ghPutFile(repo: string, path: string, text: string, message: string, gh: GhRunner): Promise<void> {
  const existing = await ghGetFile(repo, path, gh);
  const args = [
    "api",
    "-X",
    "PUT",
    `repos/${repo}/contents/${path}`,
    "-f",
    `message=${message}`,
    "-f",
    `content=${Buffer.from(text, "utf8").toString("base64")}`
  ];
  if (existing) args.push("-f", `sha=${existing.sha}`);
  const result = await gh(args);
  if (result.code !== 0) throw new Error(`gh api PUT ${path} failed: ${result.stderr.trim().slice(0, 200)}`);
}

async function ghDeleteFile(repo: string, path: string, message: string, gh: GhRunner): Promise<void> {
  const existing = await ghGetFile(repo, path, gh);
  if (!existing) return;
  const result = await gh([
    "api",
    "-X",
    "DELETE",
    `repos/${repo}/contents/${path}`,
    "-f",
    `message=${message}`,
    "-f",
    `sha=${existing.sha}`
  ]);
  if (result.code !== 0 && !isNotFound(result)) {
    throw new Error(`gh api DELETE ${path} failed: ${result.stderr.trim().slice(0, 200)}`);
  }
}

export async function readCloudMode(repo: string, gh: GhRunner): Promise<string | undefined> {
  const result = await gh(["variable", "get", "CLOUD_MODE", "--repo", repo]);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

export interface PushOutcome {
  pushed: boolean;
  reason: string;
}

/**
 * Hands one slot's Instagram post to the cloud. Ownership is claimed locally
 * first and given back only when the push provably did not land: a lost marker
 * can at worst cost a post (the sentinel then alerts), never publish it twice.
 */
export async function pushIgCloudSnapshot(
  snapshot: IgCloudSnapshot,
  root: string,
  options: IgCloudOptions = {}
): Promise<PushOutcome> {
  const settings = await loadIgCloudSettings(root);
  if (!settings) return { pushed: false, reason: "ig-cloud not installed (no data/ig-cloud.json); Instagram stays on this PC" };
  const gh = options.gh ?? igCloudDeps.gh;
  const mode = await readCloudMode(settings.repo, gh);
  if (mode !== "live") {
    return { pushed: false, reason: `cloud mode is ${mode ?? "unreadable"}; Instagram stays on this PC` };
  }
  const marker = igCloudMarkerPath(root, snapshot.date, snapshot.slot);
  const remotePath = `queue/${snapshot.date}-slot${snapshot.slot}.json`;
  await writeJsonAtomic(marker, snapshot);
  try {
    await ghPutFile(settings.repo, remotePath, `${JSON.stringify(snapshot, null, 2)}\n`, `queue ${snapshot.date} slot ${snapshot.slot}`, gh);
  } catch (error) {
    let landed: boolean | undefined;
    try {
      landed = Boolean(await ghGetFile(settings.repo, remotePath, gh));
    } catch {
      landed = undefined;
    }
    if (landed === false) {
      await unlink(marker).catch(() => undefined);
      throw error;
    }
    if (landed === undefined) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; could not confirm whether the snapshot landed, so the cloud keeps this slot. Check ${settings.repo}/queue.`
      );
    }
  }
  return { pushed: true, reason: "cloud owns Instagram for this slot" };
}

function cloudEntry(snapshot: IgCloudSnapshot, result: IgCloudResult): PostLogEntry | undefined {
  const base = {
    date: snapshot.date,
    slot: snapshot.slot,
    platform: "instagram" as const,
    dry_run: false,
    attempts: 0,
    published_media_type: snapshot.ig_media_type,
    video_status:
      snapshot.ig_media_type === "reel" || snapshot.ig_media_type === "mixed-carousel"
        ? ("published" as const)
        : ("not_planned" as const),
    ...(snapshot.video_sha256 ? { video_sha256: snapshot.video_sha256 } : {}),
    created_at: new Date().toISOString()
  };
  if ((result.status === "published" || result.status === "already_live") && result.post_id) {
    return { ...base, status: "success", post_id: result.post_id };
  }
  if (result.status === "uncertain") {
    return { ...base, status: "uncertain", error: `cloud: ${result.error ?? "publish outcome uncertain"}` };
  }
  return undefined;
}

/**
 * Records the cloud's Instagram result for a slot this PC handed off. Returns
 * the posted-log entry it wrote, or undefined when there is nothing new.
 */
export async function syncIgCloudResult(
  root: string,
  date: string,
  slot: number,
  options: IgCloudOptions = {}
): Promise<PostLogEntry | undefined> {
  const snapshot = await readIgCloudMarker(root, date, slot);
  const settings = await loadIgCloudSettings(root);
  if (!snapshot || !settings) return undefined;
  const existing = await loadPostLog(date, root);
  if (hasRecordedPost(existing, slot, "instagram", false)) return undefined;

  const file = await ghGetFile(settings.repo, `results/${date}-slot${slot}.json`, options.gh ?? igCloudDeps.gh);
  if (!file) return undefined;
  const result = JSON.parse(file.text) as IgCloudResult;
  if (result.date !== date || result.slot !== slot || result.mode !== "live") return undefined;
  const entry = cloudEntry(snapshot, result);
  if (!entry) return undefined;
  await appendPostLog(entry, root);

  // The cloud owns the first comment on its posts. Record the slot as handled
  // even before the cloud reports a comment id (it commits the post first and
  // the comment seconds later): otherwise the local first-comment step, which
  // runs right after this, would add a second comment to the same post.
  if (result.post_id && entry.status === "success") {
    const logPath = join(root, "data", "first-comments", `${date}.json`);
    const comments = await readJsonFile<Array<{ slot: number }>>(logPath, []);
    if (!comments.some((item) => item.slot === slot)) {
      await writeJsonAtomic(logPath, [
        ...comments,
        { date, slot, media_id: result.post_id, comment_id: result.comment_id ?? "cloud", created_at: new Date().toISOString() }
      ]);
    }
  }
  return entry;
}

/**
 * Gives every not-yet-due cloud slot back to this PC: deletes the snapshot
 * from the cloud queue first, then the local marker. Manual only (npm run
 * ig-cloud -- --release), for a Facebook post someone cancelled by hand. The
 * pause brake does NOT use this: moving ownership while a cloud run may be in
 * flight is how a slot gets published twice.
 */
export async function releaseIgCloudSnapshots(
  root: string,
  options: IgCloudOptions & { now?: Date } = {}
): Promise<{ released: string[]; failed: string[] }> {
  const settings = await loadIgCloudSettings(root);
  const released: string[] = [];
  const failed: string[] = [];
  if (!settings) return { released, failed };
  const gh = options.gh ?? igCloudDeps.gh;
  const nowUnix = Math.floor((options.now ?? new Date()).getTime() / 1000);
  let names: string[] = [];
  try {
    names = (await readdir(join(root, "data", "ig-cloud", "queue"))).filter((name) => name.endsWith(".json"));
  } catch {
    return { released, failed };
  }
  for (const name of names) {
    const snapshot = await readJsonFile<IgCloudSnapshot | undefined>(join(root, "data", "ig-cloud", "queue", name), undefined);
    if (!snapshot || snapshot.publish_unix <= nowUnix) continue;
    try {
      await ghDeleteFile(settings.repo, `queue/${name}`, `release ${name}`, gh);
      await unlink(join(root, "data", "ig-cloud", "queue", name));
      released.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { released, failed };
}

/**
 * The pause brake, mirrored to the cloud. data/PAUSED.json lives on this PC and
 * the cloud never sees it, so the same brake is written as PAUSED in the cloud
 * repo; the cloud job checks it at start and again right before media_publish.
 * Ownership does not move: every slot stays where it was, and both sides stay
 * stopped until the owner clears the pause.
 */
export async function pauseIgCloud(
  root: string,
  state: { reason: string; since: string; paused_by: string },
  options: IgCloudOptions = {}
): Promise<string> {
  const settings = await loadIgCloudSettings(root);
  if (!settings) return "ig-cloud not installed; nothing to pause in the cloud.";
  const gh = options.gh ?? igCloudDeps.gh;
  try {
    await ghPutFile(settings.repo, "PAUSED", `${JSON.stringify(state, null, 2)}\n`, `pause: ${state.reason}`, gh);
    return `雲端 IG 也已暫停(${settings.repo} 的 PAUSED)。解除:npm run pause -- --clear`;
  } catch (error) {
    const off = await gh(["variable", "set", "CLOUD_MODE", "--body", "off", "--repo", settings.repo]);
    return off.code === 0
      ? `⚠ 雲端 PAUSED 推不上去(${error instanceof Error ? error.message : String(error)}),已改把 CLOUD_MODE 設成 off。解除暫停後要手動把 CLOUD_MODE 設回 live。`
      : `⚠ 雲端 IG 沒能暫停,請到 GitHub ${settings.repo} 的 Settings > Variables 把 CLOUD_MODE 改成 off。`;
  }
}

/** Clears the cloud side of the pause brake. */
export async function resumeIgCloud(root: string, options: IgCloudOptions = {}): Promise<string> {
  const settings = await loadIgCloudSettings(root);
  if (!settings) return "ig-cloud not installed; nothing to resume in the cloud.";
  try {
    await ghDeleteFile(settings.repo, "PAUSED", "resume", options.gh ?? igCloudDeps.gh);
    return "雲端 IG 已解除暫停。";
  } catch (error) {
    return `⚠ 雲端的 PAUSED 沒刪掉(${error instanceof Error ? error.message : String(error)}),請到 GitHub ${settings.repo} 刪掉 PAUSED 檔。`;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));
  const settings = await loadIgCloudSettings(root);
  if (!settings) throw new Error("data/ig-cloud.json is missing; the cloud integration is not installed.");

  if (getFlag(args, "status")) {
    console.log(`repo: ${settings.repo}`);
    console.log(`CLOUD_MODE: ${(await readCloudMode(settings.repo, igCloudDeps.gh)) ?? "(unreadable)"}`);
    let names: string[] = [];
    try {
      names = (await readdir(join(root, "data", "ig-cloud", "queue"))).filter((name) => name.endsWith(".json")).sort();
    } catch {
      names = [];
    }
    console.log(`cloud-owned slots on this PC: ${names.length ? names.join(", ") : "(none)"}`);
    return;
  }

  if (getFlag(args, "sync")) {
    const date = getOption(args, "date");
    if (!date) throw new Error("--sync needs --date YYYY-MM-DD");
    for (const slot of [1, 2, 3]) {
      if (!(await readIgCloudMarker(root, date, slot))) continue;
      const entry = await syncIgCloudResult(root, date, slot);
      console.log(`${date} slot ${slot}: ${entry ? `${entry.status} ${entry.post_id ?? ""}` : "nothing new"}`);
    }
    return;
  }

  if (getFlag(args, "release")) {
    const { released, failed } = await releaseIgCloudSnapshots(root);
    console.log(`released ${released.length}: ${released.join(", ") || "-"}; failed: ${failed.join(", ") || "-"}`);
    if (failed.length) process.exitCode = 1;
    return;
  }

  if (getFlag(args, "snapshot")) {
    const date = getOption(args, "date");
    if (!date) throw new Error("--snapshot needs --date YYYY-MM-DD");
    const { snapshotScheduledDay } = await import("./igCloudBackfill");
    const publishAtRaw = getOption(args, "publish-at");
    const publishAt = publishAtRaw ? new Date(publishAtRaw) : undefined;
    if (publishAt && Number.isNaN(publishAt.getTime())) throw new Error(`--publish-at is not a date: ${publishAtRaw}`);
    const lines = await snapshotScheduledDay({ date, root, slot: getNumberOption(args, "slot"), publishAt });
    for (const line of lines) console.log(line);
    return;
  }

  throw new Error(
    "Use --status, --sync --date D, --snapshot --date D [--slot N] [--publish-at ISO], or --release."
  );
}

// Exported for tests that pin the snapshot bytes the cloud receives.
export function snapshotDigest(snapshot: IgCloudSnapshot): string {
  return sha256(JSON.stringify(snapshot));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
