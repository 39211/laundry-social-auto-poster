import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { calendarRetiredSlots, inspectDailyContentIntegrity } from "./contentPlan";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { assertLiveMetaConfig, assertPublicImageBaseUrl, getConfig } from "./config";
import { generateDailyContent } from "./generateDailyContent";
import { validatePublishableReel } from "./generateVideo";
import {
  buildGitHubPagesCarouselImageUrl,
  buildGitHubPagesImageUrl,
  buildGitHubPagesVideoUrl,
  verifyPublicAssetUrl,
  verifyPublicImageUrl
} from "./githubPages";
import {
  appendPostLog,
  findDuplicateAiredReelVideo,
  hasApprovedPost,
  hasPublishableApproval,
  hasRecordedPost,
  loadApprovalLog,
  loadDailyContent,
  loadImageSources,
  loadPostLog,
  loadRecentAiredReelVideoShas,
  loadVideoRepairQueue,
  postedVideoShaFields,
  resolveVideoRepairQueue,
  upsertVideoRepairQueue
} from "./logging";
import {
  imagesChangedSinceStamp,
  imagesDifferFromApproval,
  inspectApprovedImageDigestFile,
  isApprovedSlotDigestMap
} from "./imageStamp";
import { imageAssetsForSlot } from "./mediaAssets";
import { pauseMessage, readPause } from "./pause";
import { projectRoot } from "./paths";
import { postFacebookCarousel, postFacebookPhoto, postFacebookReel } from "./postFacebook";
import { postInstagramCarousel, postInstagramPhoto, postInstagramReel } from "./postInstagram";
import { NonRetryableError, withRetry } from "./retry";
import { claimRecoveryRetry, finishRecovery, markRecoveryManual, preparePublicationRecovery, type RecoveryDecision, type RecoveryInput } from "./publishRecovery";
import type { StaffAlertSender } from "./facebookLostAlert";
import { loadAbTestPlan, planForDate, planSlot, type AbVariant } from "./abTestPlan";
import { CONCEPT_COOLDOWN_DAYS } from "./reelConcepts";
import { DAILY_SCHEDULE, findSlotByNumber, getZonedDateParts, resolveCurrentSlot } from "./scheduler";
import { slotRetirement } from "./slotRetirements";
import { getSlotPublishTime } from "./publishTimes";
import type {
  AppConfig,
  DailySlot,
  MediaType,
  Platform,
  PostInput,
  PostLogEntry,
  PostResult,
  VideoDeferKind
} from "./types";

export interface PostCurrentSlotOptions {
  now?: string | Date;
  date?: string;
  slot?: number;
  dryRun?: boolean;
  allDue?: boolean;
  root?: string;
  verifyPublicImageUrl?: boolean;
  preflightOnly?: boolean;
  fetchImpl?: typeof fetch;
  recoverySender?: StaffAlertSender;
  backfill?: boolean;
}

async function assertLocalImagesExist(slot: DailySlot, root: string): Promise<void> {
  for (const asset of imageAssetsForSlot(slot)) {
    try {
      await access(join(root, ...asset.local_image_path.split("/")));
    } catch {
      throw new Error(
        `Image is missing for slot ${slot.slot}: ${asset.local_image_path}. Run the Codex imagegen automation first.`
      );
    }
  }
}

interface ResolvedPublishMedia {
  mediaType: MediaType;
  videoDeferred: boolean;
  videoDeferKind?: VideoDeferKind;
  videoDeferredReason?: string;
  videoSha256?: string;
}

// The mixed-carousel companion-video line was retired on 2026-08-17
// (docs-internal/OPTIMIZE-LOOP-20260817.md, 13:20 absorption ruling), so "no
// accepted/current video exists" describes the normal state of an image-first
// slot. Real generation failures ("Generation ... " reasons) never start this
// way and must keep escalating as faults.
const RETIRED_VIDEO_ABSENCE_REASON =
  /^No (?:accepted|current) slot \d+ (?:(?:repair|companion) )?(?:video|replacement)\b/;

export function isRetiredVideoAbsenceReason(reason: string): boolean {
  return RETIRED_VIDEO_ABSENCE_REASON.test(reason);
}

// Mixed-carousel companion video may fall back to the approved images: that is
// the design. A planned Reel must not. Cover-image fallback is how 8/27-29
// wrote posted-log success for stills that were supposed to be video.
// Validation gates raise a plain Error; programmer faults arrive as an Error
// subclass or a non-Error throw, and a filesystem error other than "not found"
// means the file check itself failed rather than the file being absent.
// A retired-line absence reason outranks its wrapper: recording it as a fault
// would escalate a production line that no longer exists on every review round.
export function slotRequiresPublishedVideo(slot: DailySlot): boolean {
  return slot.media_type === "reel" || slot.slot === 3;
}

export function classifyVideoFailure(error: unknown): VideoDeferKind {
  const reason = error instanceof Error ? error.message : String(error);
  if (isRetiredVideoAbsenceReason(reason)) return "expected";
  if (!(error instanceof Error)) return "unexpected";
  if (error.constructor !== Error) return "unexpected";
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && code !== "ENOENT") return "unexpected";
  return "expected";
}

export async function resolveSlotPublishMedia(
  slot: DailySlot,
  date: string,
  root: string
): Promise<ResolvedPublishMedia> {
  await assertLocalImagesExist(slot, root);
  if (slot.media_type !== "reel" && slot.media_type !== "mixed-carousel") {
    return { mediaType: slot.media_type ?? "image", videoDeferred: false };
  }

  try {
    const localPath = slot.local_video_path;
    if (!localPath) throw new Error(`Video path is missing for slot ${slot.slot}.`);
    try {
      await access(join(root, ...localPath.split("/")));
    } catch {
      throw new Error(`Video file is missing for slot ${slot.slot}: ${localPath}.`);
    }
    await validatePublishableReel(slot, date, root);
    const { createHash } = await import("node:crypto");
    const videoSha256 = createHash("sha256").update(await readFile(join(root, ...localPath.split("/")))).digest("hex");
    const aired = await loadRecentAiredReelVideoShas(date, root, CONCEPT_COOLDOWN_DAYS);
    const duplicate = findDuplicateAiredReelVideo(videoSha256, aired, date, slot.slot);
    if (duplicate) {
      throw new Error(`same video aired on ${duplicate.date} slot ${duplicate.slot}`);
    }
    return { mediaType: slot.media_type, videoDeferred: false, videoSha256 };
  } catch (error) {
    if (slotRequiresPublishedVideo(slot)) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Refusing image fallback for reel slot ${slot.slot}: ${reason}`);
    }
    return {
      mediaType: slot.media_type === "mixed-carousel" ? "carousel" : "image",
      videoDeferred: true,
      videoDeferKind: classifyVideoFailure(error),
      videoDeferredReason: error instanceof Error ? error.message : String(error)
    };
  }
}

function resultToLog(
  date: string,
  slot: number,
  result: PostResult,
  media: ResolvedPublishMedia,
  abVariant?: AbVariant
): PostLogEntry {
  return {
    date,
    slot,
    platform: result.platform,
    status: result.status,
    dry_run: result.dry_run,
    attempts: result.attempts,
    published_media_type: result.platform === "facebook" && media.mediaType === "mixed-carousel"
      ? "reel"
      : media.mediaType,
    video_status: media.videoDeferred
      ? "VIDEO_DEFERRED"
      : media.mediaType === "reel" || media.mediaType === "mixed-carousel"
        ? "published"
        : "not_planned",
    video_defer_kind: media.videoDeferKind,
    video_deferred_reason: media.videoDeferredReason,
    ...postedVideoShaFields(media.videoDeferred ? undefined : media.videoSha256),
    ...(abVariant ? { ab_variant: abVariant } : {}),
    post_id: result.post_id,
    created_at: new Date().toISOString()
  };
}

// Slot-lock markers. Before each live publish the slot lock is rewritten to
// name the platform in flight; when a post may be live but the posted log has
// no row for it, the lock is kept and marked UNRECORDED_PUBLISH. A lock naming
// a platform the posted log does not record is never reclaimed as stale:
// "stale" used to mean "crashed run, safe to retry", but a run that stopped
// between Meta's accept and the log write is exactly the double-publish case.
const UNRECORDED_PUBLISH_MARKER = "UNRECORDED_PUBLISH";
const IN_FLIGHT_MARKER = "IN_FLIGHT";

interface SlotLockMarker {
  marker: typeof UNRECORDED_PUBLISH_MARKER | typeof IN_FLIGHT_MARKER;
  platform: Platform;
  line: string;
}

function parseSlotLockMarkers(text: string): SlotLockMarker[] {
  const markers: SlotLockMarker[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^(UNRECORDED_PUBLISH|IN_FLIGHT) (facebook|instagram)(?:\s|$)/.exec(line);
    if (match) {
      markers.push({
        marker: match[1] as SlotLockMarker["marker"],
        platform: match[2] as Platform,
        line
      });
    }
  }
  return markers;
}

// Replace the lock's content without ever leaving it empty or half-written: a
// failed write keeps the previous marker, which is the fail-closed outcome.
async function writeSlotLockState(lockFile: string, lines: string[]): Promise<void> {
  const { rename, unlink, writeFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const tempPath = `${lockFile}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${lines.join("\n")}\n`, "utf8");
    await rename(tempPath, lockFile);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

function sameLogRow(a: PostLogEntry, b: PostLogEntry): boolean {
  return (
    a.slot === b.slot &&
    a.platform === b.platform &&
    a.status === b.status &&
    a.created_at === b.created_at &&
    a.post_id === b.post_id
  );
}

// A transient posted-log failure (JSON-lock timeout, Windows EPERM/EBUSY on
// rename) must not turn into a missing or "failed" row. appendPostLog can also
// reject after its rename landed, so a retry first checks the row is not
// already there instead of appending a duplicate.
async function appendPostLogDurably(entry: PostLogEntry, root: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt - 1)));
      const current = await loadPostLog(entry.date, root).catch(() => undefined);
      if (current?.some((row) => sameLogRow(row, entry))) return;
    }
    try {
      await appendPostLog(entry, root);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function postPlatform(
  platform: Platform,
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch
): Promise<PostResult> {
  const publish = input.mediaType === "reel"
    ? platform === "facebook" ? postFacebookReel : postInstagramReel
    : input.mediaType === "mixed-carousel"
      ? platform === "instagram"
        ? postInstagramCarousel
        : postFacebookReel
    : input.mediaType === "carousel"
      ? platform === "facebook" ? postFacebookCarousel : postInstagramCarousel
      : platform === "facebook" ? postFacebookPhoto : postInstagramPhoto;
  // Live retries must pass platform readback and the persistent one-retry budget.
  const { value, attempts } = await withRetry(() => publish(input, config, fetchImpl), config.dryRun ? 3 : 1);
  return { ...value, attempts };
}

/**
 * A live publish only happens inside its slot's window: from the scheduled
 * time to four hours after it, matching the catch-up recovery window. On
 * 2026-08-05 a midnight automation used this same tooling to publish off-plan
 * content at 01:45 and 03:07 — hours nobody schedules for and nobody reviews.
 * The window is enforced here, at the last common gate before Meta, so no
 * caller can publish at 2 a.m. by accident or by initiative. Dry runs and
 * preflights are exempt; a deliberate off-schedule repair passes
 * ALLOW_OFF_SCHEDULE_PUBLISH=true explicitly.
 */
export function assertInsidePublishWindow(
  slotNumber: number,
  config: AppConfig,
  now: Date = new Date(),
  date = getZonedDateParts(now, config.timezone).date,
  root = projectRoot()
): void {
  if (process.env.ALLOW_OFF_SCHEDULE_PUBLISH === "true") return;
  const schedule = findSlotByNumber(slotNumber);
  if (!schedule) return;
  const slotTime = getSlotPublishTime(date, slotNumber, root);
  const { time } = getZonedDateParts(now, config.timezone);
  const [nowH = 0, nowM = 0] = time.split(":").map(Number);
  const [slotH = 0, slotM = 0] = slotTime.split(":").map(Number);
  const minutesNow = nowH * 60 + nowM;
  const minutesSlot = slotH * 60 + slotM;
  if (minutesNow < minutesSlot || minutesNow > minutesSlot + 240) {
    throw new Error(
      `Refusing to live-publish slot ${slotNumber} at ${time}: its window is ${slotTime} to four hours after. ` +
        "Off-schedule publishing reaches fewer people and bypasses the day's review; set ALLOW_OFF_SCHEDULE_PUBLISH=true only for a deliberate manual repair."
    );
  }
}

/**
 * Older content calendars only had slots 1 and 2. Slot 3 (noon dual-Reel) is
 * optional on those days: missing means "no noon file today", not a publish
 * failure. Slots 1 and 2 still fail hard when absent.
 */
export type CalendarSlotPresence = "present" | "absent_skip" | "absent_fail";

export function classifyCalendarSlotPresence(
  slotNumber: number,
  hasSlot: boolean
): CalendarSlotPresence {
  if (hasSlot) return "present";
  if (slotNumber === 3) return "absent_skip";
  return "absent_fail";
}

async function postOneSlot(
  slot: DailySlot,
  config: AppConfig,
  date: string,
  root: string,
  fetchImpl: typeof fetch,
  preflightOnly = false,
  abVariant?: AbVariant,
  now: Date = new Date(),
  recoverySender?: StaffAlertSender,
  runtimeStartedAt = Date.now(),
  backfill = false
): Promise<PostLogEntry[]> {
  // The brake comes before the publish window, the lock, and every other
  // check: whatever else is true, a paused line does not put anything in front
  // of a customer. Dry runs and preflights are allowed through, since they
  // publish nothing and are how you inspect a paused day.
  if (!config.dryRun && !preflightOnly) {
    const paused = await readPause(root);
    if (paused) throw new NonRetryableError(pauseMessage(paused));
  }
  // Single-flight per date+slot: scheduler retries, the patrol and a manual
  // run can overlap; two publishers that both read "no success yet" would
  // both post to Meta and both succeed (luna, high). flag wx makes the
  // check-and-claim atomic; a stale lock (>30 min) is treated as a crashed
  // run and reclaimed.
  let releaseLock: (() => Promise<void>) | undefined;
  // Set while this run holds the slot lock (live runs only).
  let heldLockFile: string | undefined;
  // UNRECORDED_PUBLISH lines added by this run. They are rewritten with every
  // later lock update, so the next platform's IN_FLIGHT line cannot drop them.
  const pinnedLockLines: string[] = [];
  const markLockInFlight = async (platform: Platform): Promise<void> => {
    if (!heldLockFile) return;
    await writeSlotLockState(heldLockFile, [
      ...pinnedLockLines,
      `${IN_FLIGHT_MARKER} ${platform} since ${new Date().toISOString()}`
    ]);
  };
  // The attempt that just failed published nothing: drop its IN_FLIGHT line.
  // If this write fails the line stays, which can only block (fail-closed).
  const clearLockInFlight = async (): Promise<void> => {
    if (!heldLockFile) return;
    await writeSlotLockState(
      heldLockFile,
      pinnedLockLines.length > 0 ? pinnedLockLines : [new Date().toISOString()]
    ).catch(() => undefined);
  };
  const pinUnrecordedPublish = async (
    platform: Platform,
    postId: string | undefined,
    outcome: string,
    logError: unknown
  ): Promise<string> => {
    const reason = logError instanceof Error ? logError.message : String(logError);
    pinnedLockLines.push(
      `${UNRECORDED_PUBLISH_MARKER} ${platform} post_id=${postId ?? "unknown"} at ${new Date().toISOString()}`
    );
    // Keep the lock: releasing it is what let the next run publish again.
    releaseLock = undefined;
    let pinNote = "";
    if (heldLockFile) {
      try {
        await writeSlotLockState(heldLockFile, pinnedLockLines);
      } catch (pinError) {
        pinNote =
          ` (Marking the lock also failed: ${pinError instanceof Error ? pinError.message : String(pinError)}.` +
          ` It still carries this platform's IN_FLIGHT line, which blocks later runs the same way.)`;
      }
    }
    return (
      `${platform} ${date} slot ${slot.slot} ${outcome} (post_id ${postId ?? "unknown"}) but the posted log could not be written: ${reason}. ` +
      `The slot stays locked: check the Page, record the post in the posted log by hand, then delete ${heldLockFile ?? "the slot lock"}.${pinNote}`
    );
  };
  if (!config.dryRun && !preflightOnly) {
    const { mkdir, writeFile, stat: statFile, unlink } = await import("node:fs/promises");
    const lockDir = join(root, "data", "publish-locks");
    await mkdir(lockDir, { recursive: true });
    const lockFile = join(lockDir, `${date}-slot${slot.slot}.lock`);
    try {
      await writeFile(lockFile, new Date().toISOString(), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const held = await readFile(lockFile, "utf8").catch((readError: NodeJS.ErrnoException) => {
          if (readError.code === "ENOENT") return "";
          throw readError;
        });
        const markers = parseSlotLockMarkers(held);
        const recordedNow = markers.length > 0 ? await loadPostLog(date, root) : [];
        const open = markers.filter(
          (marker) => !hasRecordedPost(recordedNow, slot.slot, marker.platform, false)
        );
        const unrecorded = open.filter((marker) => marker.marker === UNRECORDED_PUBLISH_MARKER);
        if (unrecorded.length > 0) {
          throw new NonRetryableError(
            `${date} slot ${slot.slot} went out but the posted log has no record of it (${unrecorded.map((m) => m.line).join("; ")}). ` +
              `Check the Page, record the post in the posted log by hand, then delete ${lockFile}. Refusing to publish it again.`
          );
        }
        const age = Date.now() - (await statFile(lockFile)).mtimeMs;
        if (age < 30 * 60 * 1000) {
          throw new Error(`Another publisher holds the lock for ${date} slot ${slot.slot} (${Math.round(age / 1000)}s old); refusing to double-publish.`);
        }
        if (open.length > 0) {
          throw new NonRetryableError(
            `${date} slot ${slot.slot}: a run stopped while publishing ${open.map((m) => m.platform).join(", ")} and the posted log has no record (${open.map((m) => m.line).join("; ")}). ` +
              `The post may be live: check the Page, record it or confirm it is absent, then delete ${lockFile}.`
          );
        }
        await unlink(lockFile);
        await writeFile(lockFile, new Date().toISOString(), { flag: "wx" });
      } else {
        throw error;
      }
    }
    heldLockFile = lockFile;
    releaseLock = async () => {
      try {
        await unlink(lockFile);
      } catch {
        // A missing lock file at release is harmless.
      }
    };
  }
  const recoveryInputs = new Map<Platform, RecoveryInput>();
  const recovery = new Map<Platform, RecoveryDecision>();
  try {
  if (!config.dryRun && !preflightOnly) {
    for (const platform of ["facebook", "instagram"] as const) {
      const input = { root, date, slot, platform, config, now, fetchImpl, sender: recoverySender, startedAt: runtimeStartedAt, backfill };
      recoveryInputs.set(platform, input);
      const decision = await preparePublicationRecovery(input);
      if (decision) {
        recovery.set(platform, decision);
        if (decision.action === "confirmed") {
          // Recording an existing platform post is not a new publish. It must
          // survive an expired retry window or unavailable original assets.
          const entry: PostLogEntry = { date, slot: slot.slot, platform, status: "success", dry_run: false,
            attempts: 0, post_id: decision.postId, created_at: now.toISOString() };
          await appendPostLogDurably(entry, root);
          await finishRecovery(input, decision, entry);
          recovery.delete(platform);
        }
      }
    }
    try { if (!backfill) assertInsidePublishWindow(slot.slot, config, now, date, root); }
    catch (windowError) {
      const recorded = await loadPostLog(date, root);
      if (!["facebook", "instagram"].every(platform => recorded.some(row => row.slot === slot.slot &&
        row.platform === platform && !row.dry_run && ["success", "posted"].includes(row.status)))) throw windowError;
      return (["facebook", "instagram"] as const).map(platform => ({ date, slot: slot.slot, platform,
        status: "skipped", dry_run: false, attempts: 0, ...(abVariant ? { ab_variant: abVariant } : {}), created_at: now.toISOString() }));
    }
  }
  // The approval fingerprint pins WHAT was approved: a slot rewritten after
  // its approval must not publish on the old grant (luna, high). Absent
  // sidecar = legacy day, no check; present sidecar with a different hash =
  // refuse and say so.
  if (!config.dryRun && !preflightOnly) {
    const { createHash } = await import("node:crypto");
    const fpRaw = await readFile(join(root, "data", "approved-log", `${date}.fingerprints.json`), "utf8").catch(() => null);
    if (fpRaw) {
      const fingerprints = JSON.parse(fpRaw) as Record<string, string>;
      const expected = fingerprints[String(slot.slot)];
      const actual = createHash("sha256").update(JSON.stringify(slot)).digest("hex");
      // A sidecar that exists but has no entry for this slot used to pass: the
      // `expected &&` short-circuit turned a missing fingerprint into consent.
      // That is backwards -- the sidecar's presence is the claim that this day
      // was fingerprinted, so a gap in it is the one thing that should stop a
      // publish rather than wave it through.
      if (!expected) {
        throw new Error(
          `Slot ${slot.slot} has no approval fingerprint although ${date} has a fingerprint file; re-run auto-approve before publishing.`
        );
      }
      if (expected !== actual) {
        throw new Error(
          `Slot ${slot.slot} content changed after approval (fingerprint mismatch); re-run auto-approve before publishing.`
        );
      }
    }

    // The fingerprint hashes the calendar slot, which does not contain a single
    // byte of any image, and the catch-up chain does not re-approve a day that
    // already has an approval log. So swapping a picture after approval was
    // invisible everywhere. This asks only whether the bytes moved since they
    // were stamped -- proving provenance stays at approval, because re-asking it
    // here would strand every day approved before stamps existed.
    // Compared against what approval recorded, not against the source records.
    // A source record is written by the marking command and can be written
    // again, so approve -> swap -> re-stamp -> publish stayed green against it:
    // the file always matched the most recent thing anyone had said about it.
    // The approval snapshot is written once, by approval, and no other command
    // touches it.
    // Only a missing file is a pre-snapshot day. A file that is there but
    // unreadable, or that has no key for this slot, is not "old" -- it is a
    // snapshot we cannot use, and must not fall back to the weaker check.
    const assets = imageAssetsForSlot(slot);
    const digestFile = await inspectApprovedImageDigestFile(root, date);
    let swapped: string[];
    if (digestFile.kind === "unusable") {
      throw new Error(
        `Slot ${slot.slot} image-digest file for ${date} is damaged or not a plain object; refusing to treat it as a pre-snapshot day.`
      );
    }
    if (digestFile.kind === "ready") {
      const slotKey = String(slot.slot);
      if (!Object.hasOwn(digestFile.snapshot, slotKey)) {
        throw new Error(
          `Slot ${slot.slot} has no image-digest entry although ${date} has a digest file; re-run auto-approve before publishing.`
        );
      }
      const slotDigest: unknown = digestFile.snapshot[slotKey];
      if (!isApprovedSlotDigestMap(slotDigest)) {
        throw new Error(
          `Slot ${slot.slot} image-digest entry is not a digest map; refusing to publish.`
        );
      }
      swapped = await imagesDifferFromApproval(root, slot, assets, digestFile.snapshot);
    } else {
      swapped = await imagesChangedSinceStamp(root, slot, assets, await loadImageSources(date, root));
    }
    if (swapped.length > 0) {
      throw new Error(
        `Slot ${slot.slot} images changed after approval:\n` +
          swapped.map((line) => `  - ${line}`).join("\n") +
          `\nRe-run auto-approve before publishing.`
      );
    }
  }
  // Nothing checked whether this exact post had already gone out. Between
  // 08-07 and 08-11 the account published the same reel with the same caption
  // four times, each pair a day apart, because a scheduled reel carried its
  // caption from one day's noon slot into the next day's evening slot. Reach
  // fell from 169 to the 26-87 range over the same window. The caption side is
  // fixed at generation now; this is the backstop that refuses to put an
  // identical post out twice regardless of how it got here.
  if (!config.dryRun && !preflightOnly) {
    const caption = (slot.instagram_caption ?? "").trim();
    if (caption) {
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
          const sameCaption =
            createHash("sha256").update(pastCaption).digest("hex") === captionHash;
          if (!sameCaption) continue;
          const wentLive = pastPosts.some(
            (post) =>
              post.slot === pastSlot.slot &&
              !post.dry_run &&
              ["success", "posted"].includes(post.status)
          );
          if (wentLive) {
            throw new Error(
              `Slot ${slot.slot} caption is byte-identical to ${pastDate} slot ${pastSlot.slot}, which published live. Refusing to repeat it; rewrite the caption or regenerate the day.`
            );
          }
        }
      }
    }
  }

  const resolvedMedia = await resolveSlotPublishMedia(slot, date, root);
  const imageAssets = imageAssetsForSlot(slot);
  const imageUrls = imageAssets.map(
    (asset) =>
      asset.public_image_url ||
      buildGitHubPagesCarouselImageUrl(config.publicImageBaseUrl, date, slot.slot, asset.slide)
  );
  const imageUrl = imageUrls[0] || slot.public_image_url || buildGitHubPagesImageUrl(config.publicImageBaseUrl, date, slot.slot);
  const isReel = resolvedMedia.mediaType === "reel";
  const isMixedCarousel = resolvedMedia.mediaType === "mixed-carousel";
  const isCarousel = resolvedMedia.mediaType === "carousel" || isMixedCarousel;
  const videoUrl = isReel || isMixedCarousel
    ? slot.public_video_url || buildGitHubPagesVideoUrl(config.publicImageBaseUrl, date, slot.slot)
    : undefined;
  const publicMediaUrl = videoUrl ?? imageUrl;

  const verifyMedia = async () => {
    if (config.verifyPublicImageUrl) {
      if (isReel) await verifyPublicAssetUrl(publicMediaUrl, fetchImpl);
      else {
        for (const url of imageUrls) await verifyPublicImageUrl(url, fetchImpl);
        if (isMixedCarousel && videoUrl) await verifyPublicAssetUrl(videoUrl, fetchImpl);
      }
    }
  };
  if (preflightOnly || config.dryRun) await verifyMedia();

  const existing = await loadPostLog(date, root);
  const approvals = await loadApprovalLog(date, root);
  const outputs: PostLogEntry[] = [];
  const platformInputs: Array<{ platform: Platform; input: PostInput }> = [
    {
      platform: "facebook",
      input: {
        date,
        slot: slot.slot,
        caption: slot.facebook_caption,
        imageUrl,
        imageUrls: isCarousel ? imageUrls : undefined,
        mediaType: isReel || isMixedCarousel ? "reel" : isCarousel ? "carousel" : "image",
        videoUrl
      }
    },
    {
      platform: "instagram",
      input: {
        date,
        slot: slot.slot,
        caption: slot.instagram_caption,
        imageUrl,
        imageUrls: isCarousel ? imageUrls : undefined,
        mediaType: isReel ? "reel" : isMixedCarousel ? "mixed-carousel" : isCarousel ? "carousel" : "image",
        videoUrl
      }
    }
  ];
  const unpublishable = platformInputs
    .filter(({ platform }) => !hasPublishableApproval(approvals, slot.slot, platform))
    .map(({ platform }) => platform);

  if (unpublishable.length > 0) {
    const forcedOnly = unpublishable.filter((platform) =>
      hasApprovedPost(approvals, slot.slot, platform)
    );
    if (forcedOnly.length > 0) {
      throw new Error(
        `Post ${date} slot ${slot.slot} has a forced approval for: ${forcedOnly.join(", ")}. Forced approval is not publishable consent.`
      );
    }
    throw new Error(
      `Post ${date} slot ${slot.slot} is not approved for: ${unpublishable.join(", ")}. Run approve-post before posting.`
    );
  }

  // A preflight is a check, so it reports the deferral without recording it.
  if (preflightOnly) {
    return platformInputs.map(({ platform, input }) => ({
      date,
      slot: slot.slot,
      platform,
      status: "pending" as const,
      dry_run: config.dryRun,
      attempts: 0,
      published_media_type: input.mediaType,
      video_status: resolvedMedia.videoDeferred
        ? ("VIDEO_DEFERRED" as const)
        : isReel || isMixedCarousel
          ? ("published" as const)
          : ("not_planned" as const),
      video_defer_kind: resolvedMedia.videoDeferKind,
      video_deferred_reason: resolvedMedia.videoDeferredReason,
      ...postedVideoShaFields(resolvedMedia.videoDeferred ? undefined : resolvedMedia.videoSha256),
      ...(abVariant ? { ab_variant: abVariant } : {}),
      created_at: new Date().toISOString()
    }));
  }

  if (resolvedMedia.videoDeferred) {
    await upsertVideoRepairQueue({
      source_date: date,
      source_slot: slot.slot,
      status: "VIDEO_DEFERRED",
      original_media_type: slot.media_type as "reel" | "mixed-carousel",
      fallback_media_type: resolvedMedia.mediaType as "image" | "carousel",
      defer_kind: resolvedMedia.videoDeferKind ?? "unexpected",
      dry_run: config.dryRun ? true : undefined,
      failure_reason: resolvedMedia.videoDeferredReason ?? "Unknown video validation failure.",
      detected_at: new Date().toISOString(),
      next_attempt: "next-production-cycle"
    }, root);
  }

  // A Facebook failure must not cost the Instagram post: the loop runs
  // facebook first, and rethrowing inside it meant the platform this account's
  // whole strategy lives on was never even attempted whenever Facebook had a
  // bad night. Every platform gets its attempt; the first failure is rethrown
  // afterwards so the run still reports failure and the catch-up retries.
  // Facebook slots pre-scheduled into Meta's own queue (schedule-ahead mode)
  // must not be published a second time here. Meta publishes the queued post
  // at slot time server-side; this run records that fact so the sentinel and
  // day-audit see the slot covered, then continues to Instagram, which has no
  // API scheduling and still publishes live from this machine.
  const { loadScheduledLog } = await import("./scheduleAhead");
  const scheduledRows = await loadScheduledLog(date, root).catch(error => {
    if (recovery.get("facebook")?.action === "manual") return [];
    throw error;
  });

  let firstFailure: unknown;
  // Posts that may be live without a posted-log row. These outrank every other
  // failure in what this run reports.
  const unrecordedMessages: string[] = [];
  platformLoop: for (const { platform, input } of platformInputs) {
    let decision = recovery.get(platform);
    const recoveryInput = recoveryInputs.get(platform)!;
    if (decision?.action === "manual") {
      const entry: PostLogEntry = { date, slot: slot.slot, platform, status: "uncertain", dry_run: false,
        attempts: 0, error: `needs_manual:${decision.record.reason}`, created_at: now.toISOString() };
      if (!existing.some(row => row.slot === slot.slot && row.platform === platform && !row.dry_run &&
        ["failed", "uncertain"].includes(row.status))) await appendPostLogDurably(entry, root);
      outputs.push(entry);
      firstFailure = firstFailure ?? new NonRetryableError(`needs_manual:${decision.record.reason}`);
      continue;
    }
    if (!decision && hasRecordedPost(existing, slot.slot, platform, config.dryRun)) {
      outputs.push({
        date,
        slot: slot.slot,
        platform,
        status: "skipped",
        dry_run: config.dryRun,
        attempts: 0,
        ...(abVariant ? { ab_variant: abVariant } : {}),
        created_at: new Date().toISOString()
      });
      continue;
    }

    const scheduledRow =
      platform === "facebook"
        ? scheduledRows.find((row) => row.slot === slot.slot)
        : undefined;
    if (scheduledRow && !config.dryRun) {
      if (decision?.action === "retry") {
        await markRecoveryManual(recoveryInput, decision.record, "facebook_schedule_exists");
        const error = "needs_manual:facebook_schedule_exists";
        outputs.push({ date, slot: slot.slot, platform, status: "uncertain", dry_run: false,
          attempts: 0, error, created_at: now.toISOString() });
        firstFailure = firstFailure ?? new NonRetryableError(error);
        continue;
      }
      // An unconfirmed schedule may or may not be in Meta's queue: record it
      // as uncertain (never published again from here), not as a success.
      const unconfirmed = scheduledRow.status === "uncertain";
      const entry: PostLogEntry = {
        date,
        slot: slot.slot,
        platform,
        status: unconfirmed ? "uncertain" : "success",
        ...(unconfirmed
          ? { error: `Facebook schedule unconfirmed (${scheduledRow.error ?? "no id"}); check the Page's scheduled posts` }
          : {}),
        dry_run: false,
        attempts: 0,
        published_media_type: scheduledRow.published_media_type,
        video_status:
          scheduledRow.published_media_type === "reel"
            ? "published"
            : resolvedMedia.videoDeferred
              ? "VIDEO_DEFERRED"
              : "not_planned",
        video_defer_kind: resolvedMedia.videoDeferred ? resolvedMedia.videoDeferKind : undefined,
        video_deferred_reason: resolvedMedia.videoDeferred ? resolvedMedia.videoDeferredReason : undefined,
        ...postedVideoShaFields(scheduledRow.video_sha256),
        ...(abVariant ? { ab_variant: abVariant } : {}),
        post_id: scheduledRow.scheduled_post_id || undefined,
        created_at: new Date().toISOString()
      };
      try {
        await appendPostLogDurably(entry, root);
        outputs.push(entry);
      } catch (logError) {
        // Nothing is published from here (Meta holds the queued post), so a
        // missing row only means the next run records it again. It must not
        // cost Instagram its attempt.
        firstFailure = firstFailure ?? logError;
      }
      continue;
    }

    let published: PostResult | undefined;
    // A first failure in the last sentinel run must not wait for another wake-up.
    // The only loop continuation is a newly read-back, unspent recovery decision.
    for (;;) {
    try {
      if (!config.dryRun) await verifyMedia();
      if (decision?.action === "retry") await claimRecoveryRetry(recoveryInput, decision);
      // The lock names this platform BEFORE Meta is called, so a run that dies
      // between Meta's accept and the log write leaves a lock no run reclaims.
      await markLockInFlight(platform);
      published = await postPlatform(platform, input, config, fetchImpl);
      break;
    } catch (error) {
      // A final readback/queue check stopped before transport. Preserve its
      // manual reason and unused retry budget; it is not a failed send.
      if (decision?.action === "retry" && decision.record.status === "needs_manual") {
        outputs.push({ date, slot: slot.slot, platform, status: "uncertain", dry_run: false,
          attempts: 0, error: `needs_manual:${decision.record.reason}`, created_at: now.toISOString() });
        firstFailure = firstFailure ?? error;
        continue platformLoop;
      }
      // A NonRetryableError from a commit point means the post may already be
      // live. Recording it as "failed" is what let the catch-up chain publish
      // the same slot again two hours later.
      const commitUncertain = error instanceof NonRetryableError;
      const entry: PostLogEntry = {
        date,
        slot: slot.slot,
        platform,
        status: commitUncertain ? "uncertain" : "failed",
        dry_run: config.dryRun,
        attempts: 1,
        published_media_type: input.mediaType,
        video_status: resolvedMedia.videoDeferred
          ? "VIDEO_DEFERRED"
          : isReel || isMixedCarousel
            ? "published"
            : "not_planned",
        video_defer_kind: resolvedMedia.videoDeferKind,
        video_deferred_reason: resolvedMedia.videoDeferredReason,
        ...postedVideoShaFields(
          resolvedMedia.videoDeferred || !commitUncertain ? undefined : resolvedMedia.videoSha256
        ),
        ...(abVariant ? { ab_variant: abVariant } : {}),
        error: error instanceof Error ? error.message : String(error),
        created_at: new Date().toISOString()
      };
      try {
        await appendPostLogDurably(entry, root);
        outputs.push(entry);
      } catch (logError) {
        if (commitUncertain && !config.dryRun) {
          // The post may be live and no row says so: keep the slot locked.
          unrecordedMessages.push(
            await pinUnrecordedPublish(platform, undefined, "may have published", logError)
          );
        } else {
          // Nothing went out, so a missing row only means the next run retries.
          const logReason = logError instanceof Error ? logError.message : String(logError);
          firstFailure =
            firstFailure ??
            new Error(`${entry.error ?? "publish failed"}; the posted log could not record this failure either: ${logReason}`);
        }
      }
      if (!commitUncertain) await clearLockInFlight();
      if (decision?.action === "retry") await markRecoveryManual(recoveryInput, decision.record, backfill ? "backfill_failed" : "retry_failed");
      else if (!config.dryRun) {
        const next = await preparePublicationRecovery(recoveryInput, error);
        if (next) {
          decision = next;
          recovery.set(platform, next);
          if (next.action === "retry") continue;
          if (next.action === "confirmed") {
            published = { platform, status: "success", dry_run: false, attempts: 0, post_id: next.postId };
            break;
          }
        }
      }
      firstFailure = firstFailure ?? error;
      continue platformLoop;
    }
    }

    // A post Meta accepted is never logged as "failed": catch-up reads "failed"
    // as "never went out" and publishes again.
    const entry = resultToLog(date, slot.slot, published, resolvedMedia, abVariant);
    try {
      await appendPostLogDurably(entry, root);
      if (decision) await finishRecovery(recoveryInput, decision, entry);
      outputs.push(entry);
    } catch (logError) {
      if (!config.dryRun && ["success", "posted", "uncertain"].includes(published.status)) {
        unrecordedMessages.push(
          await pinUnrecordedPublish(platform, published.post_id, "published", logError)
        );
      } else {
        firstFailure = firstFailure ?? logError;
      }
    }
  }
  if (unrecordedMessages.length > 0) throw new NonRetryableError(unrecordedMessages.join(" | "));
  if (firstFailure !== undefined) throw firstFailure;

  if (!config.dryRun && !resolvedMedia.videoDeferred && (isReel || isMixedCarousel)) {
    const completed = await loadPostLog(date, root);
    const bothPlatformsPublished = (["facebook", "instagram"] as const).every((platform) =>
      completed.some(
        (entry) =>
          entry.slot === slot.slot &&
          entry.platform === platform &&
          !entry.dry_run &&
          (entry.status === "success" || entry.status === "posted")
      )
    );
    if (bothPlatformsPublished) {
      const repairs = await loadVideoRepairQueue(root);
      for (const repair of repairs) {
        if (
          repair.status === "VIDEO_DEFERRED" &&
          repair.replacement_candidate_date === date &&
          repair.replacement_candidate_slot === slot.slot
        ) {
          await resolveVideoRepairQueue(repair.source_date, repair.source_slot, date, slot.slot, root);
        }
      }
    }
  }

  return outputs;
  } catch (error) {
    for (const [platform, decision] of recovery) {
      if (decision.record.status !== "resolved" && decision.record.status !== "needs_manual") {
        await markRecoveryManual(recoveryInputs.get(platform)!, decision.record, "publish_precondition_failed");
      }
    }
    throw error;
  } finally {
    if (releaseLock) await releaseLock();
  }
}

export function refuseTamperedPublish(date: string, reasons: string[]): void {
  const detail = reasons.length > 0 ? reasons.join("; ") : "content_checksum mismatch";
  const text = `今天 (${date}) 行事曆完整性失敗,已退封面不發布。${detail}`;
  console.warn(`CALENDAR_TAMPERED ${date}: ${detail}`);
  if (process.env.VITEST === "true") return;
  try {
    const escaped = text.replace(/'/g, "''");
    const script = [
      "try {",
      "  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "  $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
      "  $nodes = $template.GetElementsByTagName('text')",
      "  $nodes.Item(0).AppendChild($template.CreateTextNode('私享家發佈')) | Out-Null",
      `  $nodes.Item(1).AppendChild($template.CreateTextNode('${escaped}')) | Out-Null`,
      "  $toast = New-Object Windows.UI.Notifications.ToastNotification($template)",
      "  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('LaundryPostCurrentSlot').Show($toast)",
      "} catch {}"
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
    // Toast is best-effort; the warn line is the durable alarm.
  }
}

export async function postCurrentSlot(options: PostCurrentSlotOptions = {}): Promise<PostLogEntry[]> {
  // Explicit one-slot approval; neither an old date nor the off-schedule env
  // override may silently turn an automatic retry into an approved backfill.
  if (options.backfill && (!options.date || !/^\d{4}-\d{2}-\d{2}$/.test(options.date) ||
    !options.slot || !DAILY_SCHEDULE.some(schedule => schedule.slot === options.slot) || options.allDue)) {
    throw new NonRetryableError("--backfill requires an explicit --date and --slot, without --all-due");
  }
  const runtimeStartedAt = Date.now();
  const root = projectRoot(options.root);
  const baseConfig = getConfig();
  const config: AppConfig = {
    ...baseConfig,
    dryRun: options.dryRun ?? baseConfig.dryRun,
    verifyPublicImageUrl: options.verifyPublicImageUrl ?? baseConfig.verifyPublicImageUrl
  };
  assertPublicImageBaseUrl(config);
  assertLiveMetaConfig(config);

  const now = options.now ? new Date(options.now) : new Date();
  const date = options.date || getZonedDateParts(now, config.timezone).date;

  // A live run may only publish today's calendar: --date with any other day
  // plus --live used to sail straight through the slot-time window check and
  // publish an old package as new (luna, high). Deliberate repairs go through
  // ALLOW_OFF_SCHEDULE_PUBLISH, same as off-window publishing.
  const today = getZonedDateParts(now, config.timezone).date;
  if (!config.dryRun && !options.preflightOnly && !options.backfill && date !== today && process.env.ALLOW_OFF_SCHEDULE_PUBLISH !== "true") {
    throw new Error(
      `Refusing to live-publish ${date} on ${today}: live runs are same-day only. Set ALLOW_OFF_SCHEDULE_PUBLISH=true only for a deliberate manual repair.`
    );
  }

  let content = await loadDailyContent(date, root);
  if (!content) {
    await generateDailyContent({ date, root });
    content = await loadDailyContent(date, root);
  }
  if (!content) throw new Error(`No content calendar found for ${date}`);
  if (content.tampered) {
    const reasons = inspectDailyContentIntegrity(content, { root }).reasons;
    refuseTamperedPublish(date, reasons);
    return [];
  }

  const currentSchedule = options.slot
    ? findSlotByNumber(options.slot)
    : resolveCurrentSlot(now, config.timezone, 29, date, root);
  const targetSchedules = options.allDue
    ? DAILY_SCHEDULE.filter((item) => getSlotPublishTime(date, item.slot, root) <= getZonedDateParts(now, config.timezone).time)
    : currentSchedule
      ? [currentSchedule]
      : [];

  if (targetSchedules.length === 0) return [];

  const abDay = planForDate(await loadAbTestPlan(root), date);
  const results: PostLogEntry[] = [];
  // One slot's failure must not cost the other due slots their attempt. Every
  // failure is collected and reported together at the end, not printed as it
  // happens: a PowerShell 5.1 wrapper that merges stderr under
  // $ErrorActionPreference='Stop' aborts on the first stderr line while this
  // process is still publishing the next slot.
  const slotFailures: Array<{ slot: number; error: unknown }> = [];
  for (const schedule of targetSchedules) {
    if (calendarRetiredSlots(content).includes(schedule.slot)) continue;
    const retirement = slotRetirement(date, schedule.slot, root);
    if (retirement.retired) { console.log(`${date}: ${retirement.reason}; skipping`); continue; }
    const slot = content.slots.find((item) => item.slot === schedule.slot);
    const presence = classifyCalendarSlotPresence(schedule.slot, Boolean(slot));
    if (presence === "absent_skip") {
      // Distinct from a post failure: log only, no throw, no toast at CLI layer.
      console.log(
        `Content slot ${schedule.slot} is absent for ${date}; skipping (no file for this day).`
      );
      continue;
    }
    if (presence === "absent_fail" || !slot) {
      slotFailures.push({
        slot: schedule.slot,
        error: new Error(`Content slot ${schedule.slot} is missing for ${date}`)
      });
      continue;
    }
    const abVariant = planSlot(abDay, schedule.slot)?.variant;
    try {
      results.push(
        ...(await postOneSlot(
          slot,
          config,
          date,
          root,
          options.fetchImpl ?? fetch,
          options.preflightOnly,
          abVariant,
          now,
          options.recoverySender,
          runtimeStartedAt,
          options.backfill
        ))
      );
    } catch (error) {
      slotFailures.push({ slot: schedule.slot, error });
    }
  }

  // A single failure is rethrown unchanged (same type and message as before).
  if (slotFailures.length === 1) throw slotFailures[0]!.error;
  if (slotFailures.length > 1) {
    const message =
      `${slotFailures.length} slots failed for ${date}: ` +
      slotFailures
        .map(({ slot, error }) => `slot ${slot}: ${error instanceof Error ? error.message : String(error)}`)
        .join(" | ");
    throw slotFailures.some(({ error }) => error instanceof NonRetryableError)
      ? new NonRetryableError(message)
      : new Error(message);
  }
  return results;
}

export function parsePostCurrentSlotOptions(args: string[]): PostCurrentSlotOptions {
  return {
    now: getOption(args, "now"),
    date: getOption(args, "date"),
    slot: getNumberOption(args, "slot"),
    dryRun: getFlag(args, "live") ? false : getFlag(args, "dry-run") ? true : undefined,
    allDue: getFlag(args, "all-due"),
    backfill: getFlag(args, "backfill"),
    root: getOption(args, "root"),
    preflightOnly: getFlag(args, "preflight-only"),
    verifyPublicImageUrl: getFlag(args, "check-url")
      ? true
      : getFlag(args, "skip-url-check")
        ? false
        : undefined
  };
}

async function main(): Promise<void> {
  const results = await postCurrentSlot(parsePostCurrentSlotOptions(process.argv.slice(2)));

  console.log(JSON.stringify(results, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
