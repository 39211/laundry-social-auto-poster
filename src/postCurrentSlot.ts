import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectDailyContentIntegrity } from "./contentPlan";
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
import { loadAbTestPlan, planForDate, planSlot, type AbVariant } from "./abTestPlan";
import { CONCEPT_COOLDOWN_DAYS } from "./reelConcepts";
import { DAILY_SCHEDULE, findSlotByNumber, getZonedDateParts, resolveCurrentSlot } from "./scheduler";
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

// A video that is not ready and a video check that crashed both have to fall back,
// because neither may cancel an approved image post. They must not look the same
// afterwards: the first is a pending gate, the second is a fault to go and fix.
// Validation gates raise a plain Error; programmer faults arrive as an Error
// subclass or a non-Error throw, and a filesystem error other than "not found"
// means the file check itself failed rather than the file being absent.
// A retired-line absence reason outranks its wrapper: recording it as a fault
// would escalate a production line that no longer exists on every review round.
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
  const { value, attempts } = await withRetry(() => publish(input, config, fetchImpl), 3);
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
  now: Date = new Date()
): void {
  if (process.env.ALLOW_OFF_SCHEDULE_PUBLISH === "true") return;
  const schedule = findSlotByNumber(slotNumber);
  if (!schedule) return;
  const { time } = getZonedDateParts(now, config.timezone);
  const [nowH = 0, nowM = 0] = time.split(":").map(Number);
  const [slotH = 0, slotM = 0] = schedule.time.split(":").map(Number);
  const minutesNow = nowH * 60 + nowM;
  const minutesSlot = slotH * 60 + slotM;
  if (minutesNow < minutesSlot || minutesNow > minutesSlot + 240) {
    throw new Error(
      `Refusing to live-publish slot ${slotNumber} at ${time}: its window is ${schedule.time} to four hours after. ` +
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
  now: Date = new Date()
): Promise<PostLogEntry[]> {
  // The brake comes before the publish window, the lock, and every other
  // check: whatever else is true, a paused line does not put anything in front
  // of a customer. Dry runs and preflights are allowed through, since they
  // publish nothing and are how you inspect a paused day.
  if (!config.dryRun && !preflightOnly) {
    const paused = await readPause(root);
    if (paused) throw new NonRetryableError(pauseMessage(paused));
  }
  if (!config.dryRun && !preflightOnly) assertInsidePublishWindow(slot.slot, config, now);
  // Single-flight per date+slot: scheduler retries, the patrol and a manual
  // run can overlap; two publishers that both read "no success yet" would
  // both post to Meta and both succeed (luna, high). flag wx makes the
  // check-and-claim atomic; a stale lock (>30 min) is treated as a crashed
  // run and reclaimed.
  let releaseLock: (() => Promise<void>) | undefined;
  if (!config.dryRun && !preflightOnly) {
    const { mkdir, writeFile, stat: statFile, unlink } = await import("node:fs/promises");
    const lockDir = join(root, "data", "publish-locks");
    await mkdir(lockDir, { recursive: true });
    const lockFile = join(lockDir, `${date}-slot${slot.slot}.lock`);
    try {
      await writeFile(lockFile, new Date().toISOString(), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const age = Date.now() - (await statFile(lockFile)).mtimeMs;
        if (age < 30 * 60 * 1000) {
          throw new Error(`Another publisher holds the lock for ${date} slot ${slot.slot} (${Math.round(age / 1000)}s old); refusing to double-publish.`);
        }
        await unlink(lockFile);
        await writeFile(lockFile, new Date().toISOString(), { flag: "wx" });
      } else {
        throw error;
      }
    }
    releaseLock = async () => {
      try {
        await unlink(lockFile);
      } catch {
        // A missing lock file at release is harmless.
      }
    };
  }
  try {
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

  if (config.verifyPublicImageUrl) {
    if (isReel) await verifyPublicAssetUrl(publicMediaUrl, fetchImpl);
    else {
      for (const url of imageUrls) await verifyPublicImageUrl(url, fetchImpl);
      if (isMixedCarousel && videoUrl) await verifyPublicAssetUrl(videoUrl, fetchImpl);
    }
  }

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
  let firstFailure: unknown;
  for (const { platform, input } of platformInputs) {
    if (hasRecordedPost(existing, slot.slot, platform, config.dryRun)) {
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

    try {
      const result = await postPlatform(platform, input, config, fetchImpl);
      const entry = resultToLog(date, slot.slot, result, resolvedMedia, abVariant);
      await appendPostLog(entry, root);
      outputs.push(entry);
    } catch (error) {
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
        attempts: 3,
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
      await appendPostLog(entry, root);
      outputs.push(entry);
      firstFailure = firstFailure ?? error;
    }
  }
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
  if (!config.dryRun && !options.preflightOnly && date !== today && process.env.ALLOW_OFF_SCHEDULE_PUBLISH !== "true") {
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

  const currentSchedule = options.slot ? findSlotByNumber(options.slot) : resolveCurrentSlot(now, config.timezone);
  const targetSchedules = options.allDue
    ? DAILY_SCHEDULE.filter((item) => item.time <= getZonedDateParts(now, config.timezone).time)
    : currentSchedule
      ? [currentSchedule]
      : [];

  if (targetSchedules.length === 0) return [];

  const abDay = planForDate(await loadAbTestPlan(root), date);
  const results: PostLogEntry[] = [];
  for (const schedule of targetSchedules) {
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
      throw new Error(`Content slot ${schedule.slot} is missing for ${date}`);
    }
    const abVariant = planSlot(abDay, schedule.slot)?.variant;
    results.push(
      ...(await postOneSlot(
        slot,
        config,
        date,
        root,
        options.fetchImpl ?? fetch,
        options.preflightOnly,
        abVariant,
        now
      ))
    );
  }

  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const results = await postCurrentSlot({
    now: getOption(args, "now"),
    date: getOption(args, "date"),
    slot: getNumberOption(args, "slot"),
    dryRun: getFlag(args, "live") ? false : getFlag(args, "dry-run") ? true : undefined,
    allDue: getFlag(args, "all-due"),
    root: getOption(args, "root"),
    preflightOnly: getFlag(args, "preflight-only"),
    verifyPublicImageUrl: getFlag(args, "check-url")
      ? true
      : getFlag(args, "skip-url-check")
        ? false
        : undefined
  });

  console.log(JSON.stringify(results, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
