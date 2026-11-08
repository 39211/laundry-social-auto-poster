import { deliverPendingFacebookAlerts } from "./facebookLostAlert";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { assertLiveMetaConfig, assertPublicImageBaseUrl, getConfig } from "./config";
import {
  buildGitHubPagesCarouselImageUrl,
  buildGitHubPagesImageUrl,
  buildGitHubPagesVideoUrl
} from "./githubPages";
import {
  hasPublishableApproval,
  loadApprovalLog,
  loadDailyContent,
  loadPostLog,
  readJsonFile,
  writeJsonAtomic
} from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot, scheduledLogPath } from "./paths";
import { postFacebookCarousel, postFacebookPhoto, postFacebookReel } from "./postFacebook";
import { resolveSlotPublishMedia } from "./postCurrentSlot";
import { pauseMessage, readPause } from "./pause";
import { NonRetryableError } from "./retry";
import { ensurePublishTimes, getSlotPublishTime } from "./publishTimes";
import type { AppConfig, DailySlot, PostInput, PostResult } from "./types";

// Pre-schedules a future day's Facebook posts into Meta's own queue
// (published=false / video_state=SCHEDULED), so the machine can be dead at
// slot time and the Page still publishes. Owner directive 2026-08-24: keep a
// rolling three-day scheduled buffer on the platforms themselves ("這個才叫
// 穩定發布"). Instagram's Graph API has no scheduling (containers expire in
// 24h), so Instagram stays on the local at-slot-time publisher; the interlock
// in postCurrentSlot keeps the two paths from double-posting Facebook.
//
// Every media byte is transferred to Meta at scheduling time (unpublished
// photo uploads, Reel file_url pull), so the public Pages site being up at
// publish time is NOT required either.

export interface ScheduledLogEntry {
  date: string;
  slot: number;
  platform: "facebook";
  scheduled_post_id: string;
  scheduled_publish_time: number;
  published_media_type: "image" | "carousel" | "reel";
  video_sha256?: string;
  /**
   * The schedule call did not confirm (response lost, no id): the post may or
   * may not be in Meta's queue. Recorded so that neither the next rolling run
   * nor the live path at slot time sends it again; scheduled_post_id is "".
   */
  status?: "uncertain";
  error?: string;
  created_at: string;
  /** Set when an uncertain row was later confirmed by finding the post on the Page (A7-3). */
  reconciled_at?: string;
}

export async function loadScheduledLog(date: string, root = projectRoot()): Promise<ScheduledLogEntry[]> {
  return readJsonFile<ScheduledLogEntry[]>(scheduledLogPath(date, root), []);
}

// Only schedule-ahead writes this file, one run at a time from one machine,
// so a read-modify-write with the atomic writer is enough; no cross-process
// lock like posted-log needs (its writers race the sentinel).
async function appendScheduledLog(entry: ScheduledLogEntry, root = projectRoot()): Promise<void> {
  const filePath = scheduledLogPath(entry.date, root);
  const entries = await readJsonFile<ScheduledLogEntry[]>(filePath, []);
  entries.push(entry);
  await writeJsonAtomic(filePath, entries);
}

// The live path sends Facebook a REEL for a mixed-carousel slot whose video
// is publishable (postCurrentSlot's platformInputs: isReel || isMixedCarousel
// => "reel"). The first live schedule run queued a plain carousel for exactly
// that shape, silently dropping the approved video from the Facebook side --
// this mapping is the single source of truth for what gets queued, mirrored
// by a direct unit test so the parity cannot quietly drift again. A deferred
// mixed-carousel never reaches this mapping as "mixed-carousel": resolve
// already downgraded it to "carousel".
export function facebookScheduleKind(
  resolvedMediaType: string | undefined
): "image" | "carousel" | "reel" {
  if (resolvedMediaType === "reel" || resolvedMediaType === "mixed-carousel") return "reel";
  if (resolvedMediaType === "carousel") return "carousel";
  return "image";
}

function slotPublishUnixTime(date: string, slotNumber: number, root: string, timezoneOffset = "+08:00"): number {
  const time = getSlotPublishTime(date, slotNumber, root);
  return Math.floor(new Date(`${date}T${time}:00${timezoneOffset}`).getTime() / 1000);
}

// Same backstop postCurrentSlot runs: refuse a caption byte-identical to one
// that already published live in the last seven days (the 08-07..08-11
// four-duplicate incident). Scheduling ahead must not reintroduce it.
async function assertCaptionNotRepeated(slot: DailySlot, date: string, root: string): Promise<void> {
  const caption = (slot.instagram_caption ?? "").trim();
  if (!caption) return;
  const { createHash } = await import("node:crypto");
  const captionHash = createHash("sha256").update(caption).digest("hex");
  for (let back = 1; back <= 7; back += 1) {
    const past = new Date(`${date}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() - back);
    const pastDate = past.toISOString().slice(0, 10);
    const pastContent = await loadDailyContent(pastDate, root).catch(() => null);
    if (!pastContent) continue;
    const pastPosts = await loadPostLog(pastDate, root).catch(() => []);
    for (const pastSlot of pastContent.slots) {
      const pastCaption = (pastSlot.instagram_caption ?? "").trim();
      if (!pastCaption) continue;
      if (createHash("sha256").update(pastCaption).digest("hex") !== captionHash) continue;
      const wentLive = pastPosts.some(
        (post) =>
          post.slot === pastSlot.slot && !post.dry_run && ["success", "posted"].includes(post.status)
      );
      if (wentLive) {
        throw new Error(
          `Slot ${slot.slot} caption is byte-identical to ${pastDate} slot ${pastSlot.slot}, which published live. Refusing to schedule it.`
        );
      }
    }
  }
}

export interface ScheduleAheadResult {
  date: string;
  slot: number;
  action: "scheduled" | "skipped" | "uncertain" | "deferred" | "reconciled" | "lost";
  reason?: string;
  scheduled_post_id?: string;
  scheduled_publish_time?: number;
}

const DEFERRED_REEL_REFUSAL = /^Refusing image fallback for reel slot \d+: /u;

/** True only for resolveSlotPublishMedia's planned-Reel refusal, never for other errors. */
function isDeferredReelRefusal(error: unknown): error is Error {
  return error instanceof Error && error.constructor === Error && DEFERRED_REEL_REFUSAL.test(error.message);
}

// ---------------------------------------------------------------------------
// A7-3 (2026-10-29): both 11/01 Facebook posts were lost. The image URLs were
// not deployed yet when the schedule call ran, Meta answered "Missing or
// invalid image file" at the commit point, the rows stayed "uncertain"
// forever and nobody was told. Two defences:
//  1. preflight the public image URLs BEFORE the commit point, and defer
//     (no scheduled-log row) when they are not publicly served yet;
//  2. reconcile existing uncertain rows against the Page itself: confirm,
//     reschedule (only while the slot is >= 15 min away), or raise a loud
//     ALERT. A past post is never auto-published; back-fill is the owner's.
// ---------------------------------------------------------------------------

const PREFLIGHT_TIMEOUT_MS = 10_000;
const GRAPH_LOOKUP_TIMEOUT_MS = 20_000;
const GRAPH_ORIGIN = "https://graph.facebook.com/";
const GRAPH_MAX_PAGES = 5;
const LIVE_PATH_FLOOR_SECONDS = 15 * 60;
const RECONCILE_SCHEDULED_TOLERANCE_SECONDS = 60;
const RECONCILE_CREATED_TOLERANCE_SECONDS = 20 * 60;
const CAPTION_MATCH_CHARACTERS = 40;
const RESCHEDULED_REASON = "rescheduled: the earlier unconfirmed schedule was not found on the Page";

class RequestTimeoutError extends Error {}

/**
 * fetchImpl with a hard deadline. Races a timer as well as aborting, so even a
 * fetch implementation that ignores the signal cannot hang the run.
 */
async function fetchWithTimeout<T = Response>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume?: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    const request = fetchImpl(url, { ...init, signal: controller.signal }).then(async response =>
      consume ? consume(response) : response as unknown as T);
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (controller.signal.aborted) throw new RequestTimeoutError(`timed out after ${timeoutMs} ms`);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release; the probe only needs status and headers.
  }
}

/** Returns a short failure description, or undefined when the URL serves an image. */
async function probeImageUrl(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string | undefined> {
  try {
    let response = await fetchWithTimeout(fetchImpl, url, { method: "HEAD" }, timeoutMs);
    let accepted = response.status === 200;
    if (response.status === 405 || response.status === 501) {
      // HEAD not allowed: ask for one byte instead. A server that honours the
      // range answers 206, one that ignores it answers 200; both mean "served".
      await discardBody(response);
      response = await fetchWithTimeout(
        fetchImpl,
        url,
        { method: "GET", headers: { Range: "bytes=0-0" } },
        timeoutMs
      );
      accepted = response.status === 200 || response.status === 206;
    }
    const contentType = (response.headers.get("content-type") ?? "").trim();
    await discardBody(response);
    if (!accepted) return String(response.status);
    if (!/^image\//iu.test(contentType)) return `content-type ${contentType || "missing"}`;
    return undefined;
  } catch (error) {
    if (error instanceof RequestTimeoutError) return `timeout after ${timeoutMs} ms`;
    return "network error";
  }
}

export interface ImagePreflightFailure {
  url: string;
  failure: string;
}

/** First URL that is not publicly served as an image, or undefined when all are. */
export async function preflightImageUrls(
  urls: string[],
  fetchImpl: typeof fetch,
  timeoutMs = PREFLIGHT_TIMEOUT_MS
): Promise<ImagePreflightFailure | undefined> {
  for (const url of urls) {
    const failure = await probeImageUrl(url, fetchImpl, timeoutMs);
    if (failure !== undefined) return { url, failure };
  }
  return undefined;
}

interface GraphPagePost {
  id?: string;
  created_time?: string;
  scheduled_publish_time?: number | string;
  message?: string;
  caption?: string;
  timestamp?: string;
  queued?: boolean;
}

interface GraphPostList {
  data?: GraphPagePost[];
  paging?: { next?: string };
  error?: unknown;
}

// Every error raised here is deliberately generic: Graph error bodies and the
// request URL (which carries access_token) must never reach a log line.
async function readGraphPostList(firstUrl: string, fetchImpl: typeof fetch): Promise<GraphPagePost[]> {
  const posts: GraphPagePost[] = [];
  let next: string | undefined = firstUrl;
  for (let page = 0; next && page < GRAPH_MAX_PAGES; page += 1) {
    let response: Response;
    let payload: GraphPostList | null;
    try {
      // Keep the same deadline/AbortController active until the body is parsed.
      ({ response, payload } = await fetchWithTimeout(fetchImpl, next, { method: "GET" }, GRAPH_LOOKUP_TIMEOUT_MS,
        async result => ({ response: result, payload: await result.json() as GraphPostList | null })));
    } catch {
      throw new Error("Graph lookup failed or returned an unreadable body");
    }
    if (!response.ok || !payload || typeof payload !== "object" || payload.error || !Array.isArray(payload.data)) {
      throw new Error(`Graph lookup failed (HTTP ${response.status})`);
    }
    if (payload.paging !== undefined && (!payload.paging || typeof payload.paging !== "object" || Array.isArray(payload.paging))) {
      throw new Error("Graph lookup returned malformed pagination");
    }
    if (payload.data.some((post) => !post || typeof post !== "object" || typeof post.id !== "string" || !post.id)) {
      throw new Error("Graph lookup returned malformed post rows");
    }
    posts.push(...payload.data);
    const candidate: unknown = payload.paging?.next;
    if (candidate !== undefined && (typeof candidate !== "string" || !candidate.startsWith(GRAPH_ORIGIN))) {
      throw new Error("Graph pagination could not be completed");
    }
    next = candidate;
  }
  if (next) throw new Error("Graph lookup exceeded the pagination limit");
  return posts;
}

async function fetchPagePosts(config: AppConfig, fetchImpl: typeof fetch, sinceUnix: number): Promise<GraphPagePost[]> {
  const base = `${GRAPH_ORIGIN}${config.graphApiVersion}/${config.facebookPageId}`;
  const fields = "id,created_time,scheduled_publish_time,message";
  const scheduled = new URL(`${base}/scheduled_posts`);
  scheduled.searchParams.set("fields", fields);
  scheduled.searchParams.set("limit", "100");
  scheduled.searchParams.set("access_token", config.metaAccessToken ?? "");
  const feed = new URL(`${base}/feed`);
  feed.searchParams.set("fields", fields);
  feed.searchParams.set("since", String(Math.max(0, Math.floor(sinceUnix))));
  feed.searchParams.set("limit", "100");
  feed.searchParams.set("access_token", config.metaAccessToken ?? "");
  const queued = await readGraphPostList(scheduled.toString(), fetchImpl);
  const published = await readGraphPostList(feed.toString(), fetchImpl);
  return [...queued.map((post) => ({ ...post, queued: true })), ...published];
}

export type PublicationEvidence =
  | { state: "published"; postId: string }
  | { state: "absent" | "pending" | "unknown" };

/** Uses the existing bounded, paginated Page reader; no local ledger proves absence. */
export async function readPublicationEvidence(args: {
  config: AppConfig; fetchImpl: typeof fetch; platform: "facebook" | "instagram";
  caption: string; slotTime: number;
}): Promise<PublicationEvidence> {
  const { config, fetchImpl, platform, caption, slotTime } = args;
  if (!caption.trim()) return { state: "unknown" };
  try {
    let posts: GraphPagePost[];
    if (platform === "facebook") {
      posts = await fetchPagePosts(config, fetchImpl, slotTime - 24 * 3600);
    } else {
      const url = new URL(`${GRAPH_ORIGIN}${config.graphApiVersion}/${config.instagramUserId}/media`);
      url.searchParams.set("fields", "id,caption,timestamp");
      url.searchParams.set("limit", "100");
      url.searchParams.set("access_token", config.metaAccessToken ?? "");
      posts = await readGraphPostList(url.toString(), fetchImpl);
    }
    // An empty/incomplete observation can hide the target post. Validate every
    // row before even accepting a positive match; it is never negative proof.
    if (!posts.length || posts.some(post => {
      const text = post.message ?? post.caption;
      return typeof text !== "string" || !normalizeText(text) ||
        toUnixSeconds(post.scheduled_publish_time ?? post.created_time ?? post.timestamp) === undefined;
    })) return { state: "unknown" };
    const exactCaption = normalizeText(caption);
    const matches = posts.filter(post => {
      const actual = normalizeText(post.message ?? post.caption ?? "");
      return !!actual && (actual.startsWith(captionPrefix(caption)) || exactCaption.startsWith(actual));
    });
    // A queued match or a match whose time cannot be established is never absence.
    const published = matches.find(post => !post.queued && normalizeText(post.message ?? post.caption ?? "") === exactCaption && (() => {
      const at = toUnixSeconds(post.scheduled_publish_time ?? post.created_time ?? post.timestamp);
      return at !== undefined && at >= slotTime - 20 * 60 && at < slotTime + 4 * 3600;
    })());
    if (published?.id) return { state: "published", postId: published.id };
    if (matches.length) return { state: "pending" };
    return { state: "absent" };
  } catch { return { state: "unknown" }; }
}

function toUnixSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d+$/u.test(text)) return Number(text);
  // Graph writes offsets as +0000; make them ISO (+00:00) before parsing.
  const millis = Date.parse(text.replace(/([+-]\d{2})(\d{2})$/u, "$1:$2"));
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : undefined;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/gu, "\n").trim();
}

function captionPrefix(caption: string): string {
  // Code points, not UTF-16 units, so a CJK/emoji caption is not cut mid-character.
  return Array.from(normalizeText(caption)).slice(0, CAPTION_MATCH_CHARACTERS).join("");
}

function findMatchingPost(posts: GraphPagePost[], slotTime: number, caption: string): GraphPagePost | undefined {
  const prefix = captionPrefix(caption);
  return posts.find((post) => {
    if (typeof post.id !== "string" || !post.id) return false;
    const scheduledAt = toUnixSeconds(post.scheduled_publish_time);
    const createdAt = toUnixSeconds(post.created_time);
    const timeMatches =
      (scheduledAt !== undefined && Math.abs(scheduledAt - slotTime) <= RECONCILE_SCHEDULED_TOLERANCE_SECONDS) ||
      (createdAt !== undefined && Math.abs(createdAt - slotTime) <= RECONCILE_CREATED_TOLERANCE_SECONDS);
    if (!timeMatches) return false;
    return normalizeText(typeof post.message === "string" ? post.message : "").startsWith(prefix);
  });
}

function taipeiTime(unixSeconds: number): string {
  return `${new Date((unixSeconds + 8 * 3600) * 1000).toISOString().slice(0, 16).replace("T", " ")} (Asia/Taipei)`;
}

async function writeLostAlert(root: string, date: string, slot: number, slotTime: number, reason?: string): Promise<string> {
  const fileName = `fb-lost-${date}-slot${slot}.json`;
  const dir = join(root, "output", "alerts");
  await mkdir(dir, { recursive: true });
  // No caption text, no token: date, slot, time and reason only.
  await writeJsonAtomic(join(dir, fileName), {
    alert: "FB_LOST",
    platform: "facebook",
    date,
    slot,
    scheduled_publish_time: slotTime,
    scheduled_time: taipeiTime(slotTime),
    reason:
      reason ??
      "Facebook scheduling was never confirmed and no matching post is on the Page; the slot time has passed " +
      "or is under 15 minutes away, so it was not published automatically. Back-fill is the owner's decision.",
    detected_at: new Date().toISOString()
  });
  return `output/alerts/${fileName}`;
}

export interface ReconcileOutcome {
  /** Slots fully decided by reconciliation (reconciled / lost / still uncertain). */
  handled: Map<number, ScheduleAheadResult>;
  /** Slots whose uncertain row was removed; the normal path schedules them again. */
  rescheduled: Set<number>;
}

export async function reconcileUncertainRows(args: {
  date: string;
  root: string;
  config: AppConfig;
  fetchImpl: typeof fetch;
  now: Date;
  slots: DailySlot[];
  allowReschedule?: boolean;
}): Promise<ReconcileOutcome> {
  const { date, root, config, fetchImpl, now, slots } = args;
  const outcome: ReconcileOutcome = { handled: new Map(), rescheduled: new Set() };
  const entries = await loadScheduledLog(date, root);
  // A slot that also has a confirmed row is already scheduled; leave it alone.
  const uncertain = entries.filter(
    (entry) =>
      entry.status === "uncertain" &&
      !entries.some((other) => other.slot === entry.slot && other.status !== "uncertain")
  );
  if (uncertain.length === 0) return outcome;

  const slotTimeOf = (row: ScheduledLogEntry): number =>
    typeof row.scheduled_publish_time === "number" && Number.isFinite(row.scheduled_publish_time) && row.scheduled_publish_time > 0
      ? row.scheduled_publish_time
      : slotPublishUnixTime(date, row.slot, root);

  let posts: GraphPagePost[] | undefined;
  try {
    const since = Math.min(...uncertain.map(slotTimeOf)) - 2 * 24 * 3600;
    posts = await fetchPagePosts(config, fetchImpl, since);
  } catch {
    // Intentionally not logged: the message could echo request details.
    posts = undefined;
  }

  const nowUnix = Math.floor(now.getTime() / 1000);
  let next = entries.slice();
  let changed = false;

  for (const slotNumber of [...new Set(uncertain.map((row) => row.slot))]) {
    const rows = uncertain.filter((row) => row.slot === slotNumber);
    const first = rows[0];
    if (!first) continue;
    const slotTime = slotTimeOf(first);
    const tooLate = slotTime - nowUnix < LIVE_PATH_FLOOR_SECONDS;
    const base = { date, slot: slotNumber, scheduled_publish_time: slotTime };

    if (!posts) {
      outcome.handled.set(slotNumber, { ...base, action: "uncertain", reason: "reconcile_unavailable" });
      if (tooLate) {
        // Console only was the 10/29 failure mode ("nobody was told"), and a
        // Graph outage or an expired token is exactly when this branch runs.
        // Write the same alert file FB_LOST uses so --notify-staff reaches the
        // staff group once (receipt + idempotency key); a later confirmed row
        // marks it resolved.
        const alertPath = await writeLostAlert(
          root,
          date,
          slotNumber,
          slotTime,
          "Facebook scheduling was never confirmed and the Page could not be checked; the slot time has passed or is " +
            "under 15 minutes away, so it was not published automatically. Check the Page; back-fill is the owner's decision."
        );
        console.error(
          `ALERT FB_UNCONFIRMED ${date} slot ${slotNumber}: Facebook scheduling for ${taipeiTime(slotTime)} was never ` +
            "confirmed and the Page could not be checked. Look at the Page now; nothing is published automatically. " +
            `Alert file: ${alertPath}`
        );
      } else {
        console.warn(
          `WARN FB_RECONCILE_UNAVAILABLE ${date} slot ${slotNumber}: could not ask the Page whether the unconfirmed ` +
            "post exists; row kept, the next schedule-ahead run checks again."
        );
      }
      continue;
    }

    const slot = slots.find((candidate) => candidate.slot === slotNumber);
    if (!slot) {
      outcome.handled.set(slotNumber, {
        ...base,
        action: "uncertain",
        reason: "reconcile_unavailable: slot not in the content calendar"
      });
      continue;
    }

    const match = findMatchingPost(posts, slotTime, slot.facebook_caption ?? "");
    if (match?.id) {
      const confirmed: ScheduledLogEntry = {
        date: first.date,
        slot: first.slot,
        platform: "facebook",
        scheduled_post_id: match.id,
        scheduled_publish_time: slotTime,
        published_media_type: first.published_media_type,
        ...(first.video_sha256 ? { video_sha256: first.video_sha256 } : {}),
        created_at: first.created_at,
        reconciled_at: new Date().toISOString()
      };
      let replaced = false;
      next = next.flatMap((entry) => {
        if (!rows.includes(entry)) return [entry];
        if (replaced) return [];
        replaced = true;
        return [confirmed];
      });
      changed = true;
      outcome.handled.set(slotNumber, { ...base, action: "reconciled", scheduled_post_id: match.id });
      continue;
    }

    if (!tooLate && rows.some((row) => row.published_media_type === "reel")) {
      // A Reel queued with video_state=SCHEDULED is not a Page post until it
      // publishes, so /scheduled_posts and /feed cannot show it: "not found"
      // is not evidence of absence, and rescheduling queued a second Reel.
      // Keep the row (the live path then leaves Facebook alone); after slot
      // time the feed confirms it or FB_LOST alerts the staff.
      outcome.handled.set(slotNumber, { ...base, action: "uncertain", reason: "reel_not_verifiable_before_publish" });
      continue;
    }
    if (!tooLate && args.allowReschedule === false) {
      outcome.handled.set(slotNumber, { ...base, action: "uncertain", reason: "audit_only_not_confirmed_yet" });
      continue;
    }
    if (!tooLate) {
      // Confirmed absent on the Page and Meta can still take it: drop the row
      // so the normal path (with preflight) schedules it once more.
      next = next.filter((entry) => !rows.includes(entry));
      changed = true;
      outcome.rescheduled.add(slotNumber);
      continue;
    }

    const alertPath = await writeLostAlert(root, date, slotNumber, slotTime);
    console.error(
      `ALERT FB_LOST ${date} slot ${slotNumber}: the Facebook post for ${taipeiTime(slotTime)} was never confirmed and ` +
        "is not on the Page; the slot time has passed or is under 15 minutes away, so it is NOT published " +
        `automatically (back-fill is the owner's decision). Alert file: ${alertPath}`
    );
    outcome.handled.set(slotNumber, {
      ...base,
      action: "lost",
      reason: "not on the Page; slot time passed or under 15 minutes away; owner decides on back-fill"
    });
  }

  if (changed) await writeJsonAtomic(scheduledLogPath(date, root), next);
  return outcome;
}

export async function scheduleAheadFacebook(input: {
  date: string;
  root?: string;
  config?: AppConfig;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Image preflight timeout per request; default 10 s. Tests shorten it. */
  preflightTimeoutMs?: number;
  /** Read Page evidence only; never create or retry a post. */
  auditOnly?: boolean;
}): Promise<ScheduleAheadResult[]> {
  const root = projectRoot(input.root);
  const config = input.config ?? getConfig();
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const preflightTimeoutMs = input.preflightTimeoutMs ?? PREFLIGHT_TIMEOUT_MS;

  const paused = await readPause(root);
  if (paused && !input.auditOnly) {
    throw new Error(pauseMessage(paused));
  }

  if (!config.dryRun) {
    assertLiveMetaConfig(config);
    if (!input.auditOnly) assertPublicImageBaseUrl(config);
  }

  const content = await loadDailyContent(input.date, root);
  if (!content) throw new Error(`No content calendar for ${input.date}; generate the day first.`);

  if (!input.auditOnly) await ensurePublishTimes(input.date, root);
  const approvals = await loadApprovalLog(input.date, root);
  // Settle every uncertain row of this date against the Page first (A7-3).
  // Dry runs never touch Graph; their uncertain rows read as "already scheduled".
  const reconciliation: ReconcileOutcome = config.dryRun
    ? { handled: new Map(), rescheduled: new Set() }
    : await reconcileUncertainRows({ date: input.date, root, config, fetchImpl, now, slots: content.slots, allowReschedule: !input.auditOnly });
  if (input.auditOnly) return [...reconciliation.handled.values()];
  const alreadyScheduled = await loadScheduledLog(input.date, root);
  const alreadyPosted = await loadPostLog(input.date, root);
  const results: ScheduleAheadResult[] = [];

  for (const slot of content.slots) {
    const publishAt = slotPublishUnixTime(input.date, slot.slot, root);
    const secondsOut = publishAt - Math.floor(now.getTime() / 1000);

    const settled = reconciliation.handled.get(slot.slot);
    if (settled) {
      results.push(settled);
      continue;
    }
    if (alreadyScheduled.some((entry) => entry.slot === slot.slot)) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "already scheduled" });
      continue;
    }
    if (alreadyPosted.some((entry) => entry.slot === slot.slot && entry.platform === "facebook" && !entry.dry_run)) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "already posted live" });
      continue;
    }
    // Meta's floor is 10 minutes; anything closer belongs to the live path.
    if (secondsOut < 15 * 60) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "publish time too close; live path owns it" });
      continue;
    }
    if (secondsOut > 29 * 24 * 3600) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "beyond Meta's 29-day window" });
      continue;
    }
    if (!hasPublishableApproval(approvals, slot.slot, "facebook")) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "no publishable facebook approval" });
      continue;
    }

    await assertCaptionNotRepeated(slot, input.date, root);
    // resolveSlotPublishMedia now throws for a planned Reel whose video is not
    // publishable (16132772: never post a still where a Reel was planned). That
    // refusal is right for the live path; here it must not abort the other slots
    // of the day, so it becomes the same "skipped" row the deferred branch below
    // already produces -- the live path decides that slot later.
    let resolvedMedia: Awaited<ReturnType<typeof resolveSlotPublishMedia>>;
    try {
      resolvedMedia = await resolveSlotPublishMedia(slot, input.date, root);
    } catch (error) {
      // Only the resolver's own refusal is a "deferred Reel". Anything else --
      // a missing cover image (assertLocalImagesExist runs before the refusal),
      // an fs error, a programmer fault -- must still abort the run: a swallowed
      // fault would look like one quietly unscheduled slot.
      if (!isDeferredReelRefusal(error)) throw error;
      const reason = error.message;
      results.push({
        date: input.date,
        slot: slot.slot,
        action: "skipped",
        reason: `reel video not publishable yet (${reason}); live path owns it`
      });
      continue;
    }

    const imageAssets = imageAssetsForSlot(slot);
    const imageUrls = imageAssets.map(
      (asset) =>
        asset.public_image_url ||
        buildGitHubPagesCarouselImageUrl(config.publicImageBaseUrl, input.date, slot.slot, asset.slide)
    );
    const imageUrl =
      imageUrls[0] || slot.public_image_url || buildGitHubPagesImageUrl(config.publicImageBaseUrl, input.date, slot.slot);
    const isReel = resolvedMedia.mediaType === "reel";
    const isMixedCarousel = resolvedMedia.mediaType === "mixed-carousel";
    const isCarousel = resolvedMedia.mediaType === "carousel" || isMixedCarousel;
    const videoUrl =
      isReel || isMixedCarousel
        ? slot.public_video_url || buildGitHubPagesVideoUrl(config.publicImageBaseUrl, input.date, slot.slot)
        : undefined;

    const postInput: PostInput = {
      date: input.date,
      slot: slot.slot,
      caption: slot.facebook_caption,
      imageUrl,
      imageUrls: isCarousel ? imageUrls : undefined,
      mediaType: isReel || isMixedCarousel ? "reel" : isCarousel ? "carousel" : "image",
      videoUrl,
      scheduledPublishTime: publishAt
    };

    // Companion video not ready => the carousel is what gets scheduled, same
    // fallback the live path takes. A Reel slot with no publishable video is
    // NOT downgraded silently at schedule time: skip and leave it to the live
    // path, where heal/catch-up still have hours to repair it.
    //
    // Judged on the CALENDAR's media_type, not resolvedMedia's: a deferred
    // reel comes back from resolveSlotPublishMedia already downgraded to
    // "image", so testing the resolved type let the first live run (8/25)
    // queue static images into two future Reel slots -- exactly the silent
    // downgrade this branch exists to refuse.
    if (slot.media_type === "reel" && resolvedMedia.videoDeferred) {
      results.push({
        date: input.date,
        slot: slot.slot,
        action: "skipped",
        reason: `reel video not publishable yet (${resolvedMedia.videoDeferredReason ?? "unknown"}); live path owns it`
      });
      continue;
    }

    const publishedMediaType = facebookScheduleKind(resolvedMedia.mediaType);

    if (config.dryRun) {
      results.push({
        date: input.date,
        slot: slot.slot,
        action: "scheduled",
        reason: "dry-run",
        scheduled_post_id: `dry-run-scheduled-${input.date}-${slot.slot}`,
        scheduled_publish_time: publishAt
      });
      continue;
    }

    // Preflight (A7-3): Meta fetches photo URLs during the schedule call, which
    // is the commit point. An image that is not publicly served yet (Pages not
    // deployed) produced "Missing or invalid image file" there and an
    // uncertain row on 2026-10-29. Check first; if any URL is not a public
    // image, do not call Facebook and write no row, so the next run (or the
    // live path at slot time) tries again. Reels: Meta pulls the video before
    // the commit point, where a failure already throws loudly.
    const preflightUrls =
      publishedMediaType === "carousel" ? imageUrls : publishedMediaType === "image" ? [imageUrl] : [];
    const notPublic = await preflightImageUrls(preflightUrls, fetchImpl, preflightTimeoutMs);
    if (notPublic) {
      results.push({
        date: input.date,
        slot: slot.slot,
        action: "deferred",
        reason: `image_not_public: ${notPublic.failure} (${notPublic.url})`,
        scheduled_publish_time: publishAt
      });
      continue;
    }

    // A schedule call that did not confirm may still have queued the post in
    // Meta. Aborting without a row (the old behaviour) let the next rolling
    // run queue the slot a second time, and the live path publish it a third
    // time at slot time. Record it as uncertain instead: both treat any row as
    // "already scheduled". A failure before the commit point still throws.
    let result: PostResult | undefined;
    let unconfirmed: string | undefined;
    try {
      result =
        publishedMediaType === "reel"
          ? await postFacebookReel(postInput, config, fetchImpl)
          : publishedMediaType === "carousel"
            ? await postFacebookCarousel(postInput, config, fetchImpl)
            : await postFacebookPhoto(postInput, config, fetchImpl);
      if (!result.post_id) unconfirmed = `Facebook scheduling for slot ${slot.slot} returned no post id.`;
    } catch (error) {
      if (!(error instanceof NonRetryableError)) throw error;
      unconfirmed = error.message;
    }
    if (unconfirmed !== undefined || !result?.post_id) {
      const error = unconfirmed ?? `Facebook scheduling for slot ${slot.slot} returned no post id.`;
      await appendScheduledLog(
        {
          date: input.date,
          slot: slot.slot,
          platform: "facebook",
          scheduled_post_id: "",
          scheduled_publish_time: publishAt,
          published_media_type: publishedMediaType,
          video_sha256: resolvedMedia.videoSha256,
          status: "uncertain",
          error,
          created_at: new Date().toISOString()
        },
        root
      );
      results.push({ date: input.date, slot: slot.slot, action: "uncertain", reason: error, scheduled_publish_time: publishAt });
      continue;
    }

    await appendScheduledLog(
      {
        date: input.date,
        slot: slot.slot,
        platform: "facebook",
        scheduled_post_id: result.post_id,
        scheduled_publish_time: publishAt,
        published_media_type: publishedMediaType,
        video_sha256: resolvedMedia.videoSha256,
        created_at: new Date().toISOString()
      },
      root
    );
    results.push({
      date: input.date,
      slot: slot.slot,
      action: "scheduled",
      ...(reconciliation.rescheduled.has(slot.slot) ? { reason: RESCHEDULED_REASON } : {}),
      scheduled_post_id: result.post_id,
      scheduled_publish_time: publishAt
    });
  }

  // Uncertain rows for slots no longer in the calendar still get reported.
  for (const [slotNumber, settled] of reconciliation.handled) {
    if (!content.slots.some((slot) => slot.slot === slotNumber)) results.push(settled);
  }

  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  if (!date) throw new Error("--date YYYY-MM-DD is required.");
  if (!getFlag(args, "live")) {
    process.env.DRY_RUN = "true";
  }
  const root = projectRoot(getOption(args, "root"));
  const results = await scheduleAheadFacebook({ date, root, auditOnly: getFlag(args, "audit-only") });
  if (getFlag(args, "notify-staff")) {
    const notification = await deliverPendingFacebookAlerts({ root, date });
    if (notification.pending > 0) { console.error(`STAFF_ALERT_PENDING ${date}: ${notification.pending}`); process.exitCode = 1; }
  }
  console.log(JSON.stringify(results, null, 2));
  // Exit 1 so the run reads as failed wherever the exit code is looked at
  // (scripts/schedule-ahead-daily.ps1 only counts rows today; the publish-day
  // sentinel and day-audit still raise the slot as not posted). A person has
  // to look at the Page's scheduled posts for these slots.
  // Deferred alone is not a failed run (exit 0), but it is always printed.
  for (const row of results.filter((entry) => entry.action === "deferred")) {
    console.log(
      `DEFERRED FB ${date} slot ${row.slot}: ${row.reason ?? "image_not_public"}. Not sent to Facebook; ` +
        "the next schedule-ahead run or the live path at slot time tries again."
    );
  }
  const unconfirmed = results.filter((row) => row.action === "uncertain");
  if (unconfirmed.length > 0) {
    console.error(
      `${date}: Facebook scheduling unconfirmed for slot ${unconfirmed.map((row) => row.slot).join(", ")}; ` +
        "recorded as uncertain so nothing sends it again blindly. The next schedule-ahead run for this date asks the " +
        "Page and confirms it, schedules it again, or raises ALERT FB_LOST. Check the Page's scheduled posts."
    );
    process.exitCode = 1;
  }
  const lost = results.filter((row) => row.action === "lost");
  if (lost.length > 0) {
    console.error(
      `${date}: Facebook post LOST for slot ${lost.map((row) => row.slot).join(", ")}; see output/alerts/. ` +
        "Not published automatically; the owner decides on back-fill."
    );
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
