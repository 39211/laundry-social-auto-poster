import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { commentTextFor } from "./firstComment";
import { appendPostLog, hasRecordedPost, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import type { AppConfig, DailySlot, MediaType, PostInput, PostLogEntry } from "./types";

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
// Switching it off, or finding that a live queue has lost its snapshot, does
// not strand a slot: the live publisher takes it back at its slot run
// (reclaimIfCloudCannotPost) and posts the snapshot itself. Pausing the line (npm run pause) also writes PAUSED into the cloud repo, which
// the cloud job checks at start and again right before media_publish; no slot
// changes owner, and both sides wait until the owner clears the pause, which
// runs the cloud job once so slots the pause held back still go out.

export const IG_CLOUD_SCHEMA = "sixiangjia-ig-cloud-snapshot/2";

/** A public repo holding the site's files, used to pin an image to the exact bytes Facebook got. */
export interface IgCloudPinSource {
  repo: string;
  ref: string;
  /** Path of the site root inside the repo, "" or ending in "/". */
  prefix: string;
}

export interface IgCloudSettings {
  repo: string;
  pinSources: IgCloudPinSource[];
}

export interface IgCloudSnapshot {
  schema: typeof IG_CLOUD_SCHEMA;
  date: string;
  slot: number;
  publish_unix: number;
  ig_media_type: MediaType;
  caption: string;
  image_urls: string[];
  /** sha256 of each image as the site served it when Facebook took it; aligned with image_urls. */
  image_sha256s: string[];
  /** The same bytes at a fixed commit (raw.githubusercontent.com), or null; aligned with image_urls. */
  image_urls_pinned: Array<string | null>;
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
  /** Reads the media's public bytes for the fingerprint. */
  fetchImpl?: typeof fetch;
}

// Indirection so tests can stand in for the gh CLI on code paths that do not
// take options (the live publisher's sync); production never reassigns it.
export const igCloudDeps: { gh: GhRunner; sleep: (milliseconds: number) => Promise<void> } = {
  gh: ghRunner,
  sleep: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
};

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

function parsePinSources(value: unknown): IgCloudPinSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = item as Partial<IgCloudPinSource> | null;
    const repo = typeof source?.repo === "string" ? source.repo.trim() : "";
    const ref = typeof source?.ref === "string" ? source.ref.trim() : "";
    const prefix = typeof source?.prefix === "string" ? source.prefix.trim() : "";
    const ok = REPO_NAME.test(repo) && /^[\w./-]+$/.test(ref) && (prefix === "" || /^[\w./-]+\/$/.test(prefix));
    return ok ? [{ repo, ref, prefix }] : [];
  });
}

/** data/ig-cloud.json present = the cloud integration is installed; absent = off, no network calls. */
export async function loadIgCloudSettings(root: string): Promise<IgCloudSettings | undefined> {
  const raw = await readJsonFile<{ repo?: unknown; pin_sources?: unknown } | null>(join(root, "data", "ig-cloud.json"), null);
  const repo = typeof raw?.repo === "string" ? raw.repo.trim() : "";
  return REPO_NAME.test(repo) ? { repo, pinSources: parsePinSources(raw?.pin_sources) } : undefined;
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
    // Filled from the public bytes by fingerprintIgCloudMedia when the slot is
    // handed over; a snapshot without them is never pushed.
    image_sha256s: [],
    image_urls_pinned: [],
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

async function sha256OfUrl(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
}

/**
 * Records which bytes Facebook got, so the cloud posts those or nothing.
 * Facebook copies an image from its public URL when the slot is scheduled;
 * the file at that URL can be replaced before slot time (2026-09-19 slot 2 was,
 * two days after scheduling), and Instagram would then get a different picture.
 * Each image is hashed as the site serves it now, seconds after Facebook took
 * it, and pinned to a fixed commit of a public repo holding the same bytes, so
 * the cloud can still post Facebook's version after a swap. Raw GitHub serves
 * video as octet-stream, so a video is only checked: the site's copy must be
 * the file Facebook was scheduled with, or the slot stays on this PC.
 */
export async function fingerprintIgCloudMedia(
  snapshot: IgCloudSnapshot,
  settings: IgCloudSettings,
  gh: GhRunner,
  fetchImpl: typeof fetch
): Promise<IgCloudSnapshot> {
  const commits: Array<{ source: IgCloudPinSource; sha: string }> = [];
  for (const source of settings.pinSources) {
    const result = await gh(["api", `repos/${source.repo}/commits/${source.ref}`, "--jq", ".sha"]);
    const sha = result.stdout.trim();
    if (result.code === 0 && /^[0-9a-f]{40}$/.test(sha)) commits.push({ source, sha });
  }
  const base = snapshot.public_image_base_url.replace(/\/+$/, "");
  const imageSha256s: string[] = [];
  const pinned: Array<string | null> = [];
  for (const url of snapshot.image_urls) {
    const sha = await sha256OfUrl(url, fetchImpl);
    let pin: string | null = null;
    if (url.startsWith(`${base}/`)) {
      const path = url.slice(base.length + 1);
      for (const { source, sha: commit } of commits) {
        const raw = `https://raw.githubusercontent.com/${source.repo}/${commit}/${source.prefix}${path}`;
        const rawSha = await sha256OfUrl(raw, fetchImpl).catch(() => undefined);
        if (rawSha === sha) {
          pin = raw;
          break;
        }
      }
    }
    imageSha256s.push(sha);
    pinned.push(pin);
  }
  if (snapshot.video_url) {
    const siteSha = await sha256OfUrl(snapshot.video_url, fetchImpl);
    if (siteSha !== snapshot.video_sha256) {
      throw new Error(`the site's video differs from the file Facebook was scheduled with (${siteSha.slice(0, 12)} vs ${String(snapshot.video_sha256).slice(0, 12)})`);
    }
  }
  return { ...snapshot, image_sha256s: imageSha256s, image_urls_pinned: pinned };
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

/** Deletes a file from the repo; resolves false when it was not there. */
async function ghDeleteFile(repo: string, path: string, message: string, gh: GhRunner): Promise<boolean> {
  const existing = await ghGetFile(repo, path, gh);
  if (!existing) return false;
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
  return true;
}

export async function readCloudMode(repo: string, gh: GhRunner): Promise<string | undefined> {
  const result = await gh(["variable", "get", "CLOUD_MODE", "--repo", repo]);
  if (result.code === 0) return result.stdout.trim();
  // A deleted variable is a readable answer: the cloud job runs an unset
  // CLOUD_MODE as off (publisher/due.mjs). Any other failure stays unknown.
  return /variable CLOUD_MODE was not found/i.test(result.stderr) ? "off" : undefined;
}

export interface PushOutcome {
  pushed: boolean;
  reason: string;
  /** What the cloud received, fingerprints included, when pushed. */
  snapshot?: IgCloudSnapshot;
}

// The Taipei slot times the cloud job runs for: the cron list in the cloud
// repo's .github/workflows/ig-publish.yml (11:27/11:50, 11:57/12:20,
// 20:27/20:50). A snapshot at any other time is never selected there, so it
// must stay on this PC. Change both together.
export const IG_CLOUD_RUN_TIMES = ["11:30", "12:00", "20:30"];

function taipeiClock(unixSeconds: number): string {
  return new Date((unixSeconds + 8 * 3600) * 1000).toISOString().slice(11, 16);
}

/**
 * Hands one slot's Instagram post to the cloud. Ownership is claimed locally
 * first and given back only when the push provably did not land: a lost marker
 * can at worst cost a post, never publish it twice. Nothing alerts on that
 * loss today: publish-sentinel.ps1 counts a slot as posted once any platform
 * has posted it, so an Instagram-only gap stays silent.
 */
export async function pushIgCloudSnapshot(
  unfingerprinted: IgCloudSnapshot,
  root: string,
  options: IgCloudOptions = {}
): Promise<PushOutcome> {
  let snapshot = unfingerprinted;
  const settings = await loadIgCloudSettings(root);
  if (!settings) return { pushed: false, reason: "ig-cloud not installed (no data/ig-cloud.json); Instagram stays on this PC" };
  const clock = taipeiClock(snapshot.publish_unix);
  if (!IG_CLOUD_RUN_TIMES.includes(clock)) {
    return {
      pushed: false,
      reason: `slot time ${clock} Taipei has no cloud run (${IG_CLOUD_RUN_TIMES.join(", ")}); Instagram stays on this PC`
    };
  }
  const gh = options.gh ?? igCloudDeps.gh;
  const mode = await readCloudMode(settings.repo, gh);
  if (mode !== "live") {
    return { pushed: false, reason: `cloud mode is ${mode ?? "unreadable"}; Instagram stays on this PC` };
  }
  try {
    snapshot = await fingerprintIgCloudMedia(unfingerprinted, settings, gh, options.fetchImpl ?? fetch);
  } catch (error) {
    return {
      pushed: false,
      reason: `could not pin down the media Facebook got (${error instanceof Error ? error.message : String(error)}); Instagram stays on this PC`
    };
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
  return { pushed: true, reason: "cloud owns Instagram for this slot", snapshot };
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

  // The cloud comments only after a newly published post. Its already_live
  // recovery path records a post after the earlier publish succeeded and does
  // not comment, so leave that slot for the local first-comment step.
  if (result.post_id && result.status === "published") {
    await claimFirstCommentForCloud(root, date, slot, result.post_id, result.comment_id);
  }
  return entry;
}

/** Marks a post's first comment as the cloud's, so the local first-comment step adds none. */
export async function claimFirstCommentForCloud(
  root: string,
  date: string,
  slot: number,
  postId: string,
  commentId?: string
): Promise<void> {
  const logPath = join(root, "data", "first-comments", `${date}.json`);
  const comments = await readJsonFile<Array<{ slot: number }>>(logPath, []);
  if (comments.some((item) => item.slot === slot)) return;
  await writeJsonAtomic(logPath, [
    ...comments,
    { date, slot, media_id: postId, comment_id: commentId ?? "cloud", created_at: new Date().toISOString() }
  ]);
}

function normalizeCaption(text: unknown): string {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * The rule the cloud applies before it publishes (publisher/run.ts
 * findLivePost), applied here before this PC posts a slot it took back: a post
 * with this caption on the account in the last 12 hours is this slot, already
 * live -- the cloud published it and lost its result commit (its job fails,
 * and nothing on main says so). Throws when the list cannot be read: then
 * nothing is posted from here either.
 */
export async function findLiveInstagramPost(
  caption: string,
  config: AppConfig,
  fetchImpl: typeof fetch,
  now: Date = new Date()
): Promise<string | undefined> {
  const query = new URLSearchParams({ fields: "id,caption,timestamp", limit: "15", access_token: config.metaAccessToken ?? "" });
  const response = await fetchImpl(`https://graph.facebook.com/${config.graphApiVersion}/${config.instagramUserId}/media?${query}`);
  const payload = (await response.json()) as
    | { data?: Array<{ id: string; caption?: string; timestamp?: string }>; error?: { message?: string } }
    | null;
  if (!response.ok || !payload || typeof payload !== "object" || payload.error || !Array.isArray(payload.data)) {
    throw new Error(
      `Instagram media list could not be read (${payload?.error?.message ?? response.status}); not posting a taken-back slot blind`
    );
  }
  const want = normalizeCaption(caption);
  const cutoff = now.getTime() - 12 * 60 * 60 * 1000;
  return payload.data.find((item) => normalizeCaption(item.caption) === want && Date.parse(item.timestamp ?? "") >= cutoff)?.id;
}

/** R3: Check whether the cloud already left the taken-back slot's first comment. */
export async function findFirstCommentOnPost(
  postId: string,
  text: string,
  config: AppConfig,
  fetchImpl: typeof fetch
): Promise<string | undefined> {
  const query = new URLSearchParams({ fields: "id,text", limit: "50", access_token: config.metaAccessToken ?? "" });
  const response = await fetchImpl(`https://graph.facebook.com/${config.graphApiVersion}/${postId}/comments?${query}`);
  let payload: { data?: unknown; error?: unknown } | null;
  try {
    payload = (await response.json()) as { data?: unknown; error?: unknown } | null;
  } catch {
    throw new Error(`Instagram comments could not be read (${response.status})`);
  }
  const errorMessage =
    payload && typeof payload === "object" && payload.error && typeof payload.error === "object" &&
    "message" in payload.error && typeof payload.error.message === "string"
      ? payload.error.message
      : undefined;
  if (!response.ok || !payload || typeof payload !== "object" || payload.error || !Array.isArray(payload.data)) {
    throw new Error(`Instagram comments could not be read (${errorMessage ?? response.status})`);
  }
  const wanted = normalizeCaption(text);
  const match = payload.data.find((item) => {
    if (!item || typeof item !== "object") return false;
    return normalizeCaption((item as { text?: unknown }).text) === wanted;
  });
  return match && typeof match === "object" && typeof (match as { id?: unknown }).id === "string"
    ? (match as { id: string }).id
    : undefined;
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

/** A slot this PC took back from a switched-off cloud; it posts the snapshot, i.e. what Facebook got. */
export function igCloudTakenBackPath(root: string, date: string, slot: number): string {
  return join(root, "data", "ig-cloud", "taken-back", `${date}-slot${slot}.json`);
}

export async function readIgCloudTakenBack(root: string, date: string, slot: number): Promise<IgCloudSnapshot | undefined> {
  return readJsonFile<IgCloudSnapshot | undefined>(igCloudTakenBackPath(root, date, slot), undefined);
}

/** Cloud runs not finished yet (queued, waiting or in progress); undefined when the list cannot be read. */
async function activeCloudRuns(repo: string, gh: GhRunner): Promise<number | undefined> {
  const result = await gh(["run", "list", "--repo", repo, "--workflow", "ig-publish", "--json", "status", "--limit", "20"]);
  if (result.code !== 0) return undefined;
  try {
    const runs = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(runs)) return undefined;
    return runs.filter((run) => (run as { status?: unknown } | null)?.status !== "completed").length;
  } catch {
    return undefined;
  }
}

export interface TakeBackOptions extends IgCloudOptions {
  sleep?: (milliseconds: number) => Promise<void>;
  /** Restore after a keep outcome only when the queue held the snapshot before withdrawal (default true). */
  restoreOnKeep?: boolean;
  /** How long to wait for cloud runs already in flight (default 15 minutes). */
  waitMs?: number;
  pollMs?: number;
  /** Pause before looking at the run list a second time, for a run GitHub has not listed yet. */
  settleMs?: number;
}

export type TakeBackOutcome =
  | { status: "taken_back"; reason: string; snapshot: IgCloudSnapshot }
  | { status: "cloud_posted" | "kept"; reason: string };

/**
 * Moves one cloud-owned slot back to this PC without racing a cloud run that
 * may be in flight. The snapshot is withdrawn from the cloud queue and checked
 * gone: a run that has not yet reached its pre-publish check aborts on that,
 * and a run that starts later never sees the slot. Then wait until no cloud run
 * is active, and read the cloud's result once more: a run that got past its
 * check before the withdrawal has usually published and recorded by then. A
 * run that published and then failed to push its result leaves no trace on
 * main, so the publisher looks at the Instagram account itself before posting
 * a taken-back slot (findLiveInstagramPost). Only a slot still without a
 * result moves, and it moves with its snapshot, so this PC posts what Facebook
 * got. Every doubt keeps the marker and later retries; snapshots are restored
 * after a keep unless the live queue was already confirmed absent.
 */
export async function takeBackIgCloudSlot(
  root: string,
  date: string,
  slot: number,
  options: TakeBackOptions = {}
): Promise<TakeBackOutcome> {
  const settings = await loadIgCloudSettings(root);
  const snapshot = await readIgCloudMarker(root, date, slot);
  if (!settings || !snapshot) return { status: "kept", reason: "no cloud marker for this slot" };
  const gh = options.gh ?? igCloudDeps.gh;
  const sleep = options.sleep ?? igCloudDeps.sleep;
  const remotePath = `queue/${date}-slot${slot}.json`;
  // After an attempted withdrawal, kept outcomes restore the snapshot by
  // default. A live queue already confirmed absent by reclaimIfCloudCannotPost
  // has nothing to restore, so that caller opts out and leaves the marker for
  // this PC to retry at the next slot run or catch-up.
  const restored = async (): Promise<string> => {
    if (options.restoreOnKeep === false) {
      return "snapshot was already absent from the cloud queue; nothing was available to restore, and this PC will retry taking it back at its next run (slot time or catch-up)";
    }
    try {
      await ghPutFile(settings.repo, remotePath, `${JSON.stringify(snapshot, null, 2)}\n`, `restore ${date} slot ${slot}`, gh);
      return "snapshot restored to the cloud queue";
    } catch (error) {
      return `snapshot NOT restored to the cloud queue (${error instanceof Error ? error.message : String(error)}); the cloud has nothing to post for this slot, so this PC takes it back at its next run (slot time or catch-up)`;
    }
  };
  const kept = async (reason: string): Promise<TakeBackOutcome> => ({ status: "kept", reason: `${reason}; ${await restored()}` });
  try {
    await ghDeleteFile(settings.repo, remotePath, `take back ${date} slot ${slot}`, gh);
    if (await ghGetFile(settings.repo, remotePath, gh)) {
      return { status: "kept", reason: `${remotePath} is still in the cloud queue` };
    }
  } catch (error) {
    return kept(`could not withdraw ${remotePath} (${error instanceof Error ? error.message : String(error)})`);
  }

  const pollMs = options.pollMs ?? 20_000;
  const polls = Math.max(1, Math.ceil((options.waitMs ?? 15 * 60_000) / pollMs));
  let quiet = false;
  for (let poll = 1; poll <= polls && !quiet; poll += 1) {
    if ((await activeCloudRuns(settings.repo, gh)) === 0) {
      await sleep(options.settleMs ?? 30_000);
      quiet = (await activeCloudRuns(settings.repo, gh)) === 0;
    }
    if (!quiet && poll < polls) await sleep(pollMs);
  }
  if (!quiet) return kept("a cloud run was still active, or the run list could not be read");

  try {
    await syncIgCloudResult(root, date, slot, { gh });
  } catch (error) {
    return kept(`could not read the cloud's result (${error instanceof Error ? error.message : String(error)})`);
  }
  if (hasRecordedPost(await loadPostLog(date, root), slot, "instagram", false)) {
    return { status: "cloud_posted", reason: "the cloud posted it before it was withdrawn" };
  }
  try {
    await writeJsonAtomic(igCloudTakenBackPath(root, date, slot), snapshot);
    await unlink(igCloudMarkerPath(root, date, slot));
  } catch (error) {
    return kept(`could not move the marker (${error instanceof Error ? error.message : String(error)})`);
  }
  return { status: "taken_back", reason: "withdrawn from the cloud; this PC posts what Facebook got", snapshot };
}

/**
 * R1: A cloud-owned slot cannot be posted when CLOUD_MODE is not live or when
 * the live queue has no snapshot for it. At slot time and catch-up, the live
 * publisher checks the switch and queue after the cloud's own runs. An
 * unreadable switch or queue leaves ownership alone, since the cloud may still
 * be able to post and taking it back as well could publish twice.
 */
export async function reclaimIfCloudCannotPost(
  root: string,
  date: string,
  slot: number,
  options: TakeBackOptions = {}
): Promise<TakeBackOutcome | undefined> {
  const settings = await loadIgCloudSettings(root);
  if (!settings || !(await readIgCloudMarker(root, date, slot))) return undefined;
  if (hasRecordedPost(await loadPostLog(date, root), slot, "instagram", false)) return undefined;
  const gh = options.gh ?? igCloudDeps.gh;
  const mode = await readCloudMode(settings.repo, gh);
  if (mode === undefined) return undefined;
  if (mode === "live") {
    try {
      if (await ghGetFile(settings.repo, `queue/${date}-slot${slot}.json`, gh)) return undefined;
    } catch {
      return undefined;
    }
  } else {
    return takeBackIgCloudSlot(root, date, slot, options);
  }
  return takeBackIgCloudSlot(root, date, slot, { ...options, restoreOnKeep: false });
}

/**
 * The Instagram input for a slot taken back from the cloud: Facebook's caption
 * and the bytes Facebook got, checked the way the cloud checks them. An image
 * replaced on the site since is taken from its pinned copy; anything that no
 * longer matches stops the post rather than send Instagram another version.
 */
export async function igInputFromSnapshot(snapshot: IgCloudSnapshot, fetchImpl: typeof fetch): Promise<PostInput> {
  const imageUrls: string[] = [];
  for (const [index, url] of snapshot.image_urls.entries()) {
    const want = snapshot.image_sha256s[index];
    const pinned = snapshot.image_urls_pinned[index];
    if (want && (await sha256OfUrl(url, fetchImpl).catch(() => undefined)) === want) {
      imageUrls.push(url);
    } else if (want && pinned && (await sha256OfUrl(pinned, fetchImpl).catch(() => undefined)) === want) {
      imageUrls.push(pinned);
    } else {
      throw new Error(`image ${index + 1} is no longer the one Facebook got; not posting a version Facebook did not get`);
    }
  }
  if (snapshot.video_url && (await sha256OfUrl(snapshot.video_url, fetchImpl).catch(() => undefined)) !== snapshot.video_sha256) {
    throw new Error("the video is no longer the one Facebook got; not posting a version Facebook did not get");
  }
  const isCarousel = snapshot.ig_media_type === "carousel" || snapshot.ig_media_type === "mixed-carousel";
  return {
    date: snapshot.date,
    slot: snapshot.slot,
    caption: snapshot.caption,
    imageUrl: imageUrls[0] ?? "",
    imageUrls: isCarousel ? imageUrls : undefined,
    mediaType: snapshot.ig_media_type,
    videoUrl: snapshot.video_url ?? undefined
  };
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
    if (off.code !== 0) {
      return `⚠ 雲端 IG 沒能暫停,請到 GitHub ${settings.repo} 的 Settings > Variables 把 CLOUD_MODE 改成 off。`;
    }
    // So that clearing the pause switches the cloud back on -- and only an off
    // this brake set, never one the owner chose on GitHub.
    await writeJsonAtomic(igCloudModeNotePath(root), { set_at: new Date().toISOString(), reason: state.reason });
    return `⚠ 雲端 PAUSED 推不上去(${error instanceof Error ? error.message : String(error)}),已改把 CLOUD_MODE 設成 off;解除暫停時會自動設回 live。`;
  }
}

/** Marks that the pause brake, not the owner, switched CLOUD_MODE off. */
export function igCloudModeNotePath(root: string): string {
  return join(root, "data", "ig-cloud", "mode-off-by-pause.json");
}

/**
 * Clears the cloud side of the pause brake. The cloud only runs at its cron
 * times, so a pause that covered a slot's last run would leave that slot to
 * nobody: when a brake was actually lifted, run the cloud job once now, and it
 * publishes whatever is still inside its four-hour window (the same window the
 * PC's own catch-up has).
 */
export async function resumeIgCloud(root: string, options: IgCloudOptions = {}): Promise<string> {
  const settings = await loadIgCloudSettings(root);
  if (!settings) return "ig-cloud not installed; nothing to resume in the cloud.";
  const gh = options.gh ?? igCloudDeps.gh;
  const lines: string[] = [];
  let lifted = false;
  try {
    lifted = await ghDeleteFile(settings.repo, "PAUSED", "resume", gh);
    lines.push(lifted ? "雲端 IG 已解除暫停。" : "雲端沒有 PAUSED。");
  } catch (error) {
    return `⚠ 雲端的 PAUSED 沒刪掉(${error instanceof Error ? error.message : String(error)}),請到 GitHub ${settings.repo} 刪掉 PAUSED 檔。`;
  }
  const note = igCloudModeNotePath(root);
  if (await readJsonFile<unknown>(note, null)) {
    const on = await gh(["variable", "set", "CLOUD_MODE", "--body", "live", "--repo", settings.repo]);
    if (on.code === 0) {
      await unlink(note).catch(() => undefined);
      lines.push("暫停時關掉的 CLOUD_MODE 已設回 live。");
      lifted = true;
    }
  }
  const mode = await readCloudMode(settings.repo, gh);
  if (mode !== "live") {
    lines.push(
      `⚠ 雲端 CLOUD_MODE 現在是 ${mode ?? "讀不到"},不是 live;雲端接手的格不會發。要恢復請執行:gh variable set CLOUD_MODE --body live --repo ${settings.repo}`
    );
    return lines.join("\n");
  }
  if (lifted) {
    const run = await gh(["workflow", "run", "ig-publish", "--repo", settings.repo]);
    lines.push(
      run.code === 0
        ? "已觸發一次雲端發布:暫停期間到時間、還在四小時內的格,現在會發。超過四小時的不補,和電腦原本的補發一樣。"
        : `⚠ 沒能觸發雲端發布,請到 GitHub ${settings.repo} 的 Actions > ig-publish > Run workflow 按一次。`
    );
  }
  return lines.join("\n");
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
