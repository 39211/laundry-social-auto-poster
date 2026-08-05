import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
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
  hasApprovedPost,
  hasRecordedPost,
  loadApprovalLog,
  loadDailyContent,
  loadPostLog,
  loadVideoRepairQueue,
  resolveVideoRepairQueue,
  upsertVideoRepairQueue
} from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot } from "./paths";
import { postFacebookCarousel, postFacebookPhoto, postFacebookReel } from "./postFacebook";
import { postInstagramCarousel, postInstagramPhoto, postInstagramReel } from "./postInstagram";
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

interface ManualImageQaFile {
  slots?: Array<{
    slot?: number;
    status?: string;
    decision?: string;
  }>;
  assets?: Array<{
    path?: string;
    sha256?: string;
  }>;
}

export async function assertManualImageQaAllowsPublishing(
  date: string,
  slot: DailySlot,
  root: string
): Promise<void> {
  const qaPath = join(root, "output", "operations", `${date}-image-manual-qa.json`);
  let raw: string;
  try {
    raw = await readFile(qaPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (imageAssetsForSlot(slot).length === 1) return;
      throw new Error(`Manual image QA is required for ${date} slot ${slot.slot}: ${qaPath}.`);
    }
    throw error;
  }

  let qa: ManualImageQaFile;
  try {
    qa = JSON.parse(raw) as ManualImageQaFile;
  } catch {
    throw new Error(`Manual image QA is invalid JSON for ${date}: ${qaPath}.`);
  }
  const record = qa.slots?.find((entry) => entry.slot === slot.slot);
  if (!record) {
    throw new Error(`Manual image QA has no slot ${slot.slot} decision for ${date}: ${qaPath}.`);
  }
  if (record.status !== "PASS") {
    const decision = record.decision ? ` (${record.decision})` : "";
    throw new Error(`Manual image QA blocks ${date} slot ${slot.slot}: ${record.status ?? "UNKNOWN"}${decision}.`);
  }

  for (const asset of imageAssetsForSlot(slot)) {
    const reviewed = qa.assets?.find((entry) => entry.path === asset.local_image_path);
    if (!reviewed?.sha256) {
      throw new Error(`Manual image QA has no hash for ${date} slot ${slot.slot}: ${asset.local_image_path}.`);
    }
    const bytes = await readFile(join(root, ...asset.local_image_path.split("/")));
    const actual = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    if (actual !== reviewed.sha256.toUpperCase()) {
      throw new Error(`Manual image QA hash mismatch for ${date} slot ${slot.slot}: ${asset.local_image_path}.`);
    }
  }
}

interface ResolvedPublishMedia {
  mediaType: MediaType;
  videoDeferred: boolean;
  videoDeferKind?: VideoDeferKind;
  videoDeferredReason?: string;
}

// A video that is not ready and a video check that crashed both have to fall back,
// because neither may cancel an approved image post. They must not look the same
// afterwards: the first is a pending gate, the second is a fault to go and fix.
// Validation gates raise a plain Error; programmer faults arrive as an Error
// subclass or a non-Error throw, and a filesystem error other than "not found"
// means the file check itself failed rather than the file being absent.
export function classifyVideoFailure(error: unknown): VideoDeferKind {
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
    return { mediaType: slot.media_type, videoDeferred: false };
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
  media: ResolvedPublishMedia
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
  const value = await publish(input, config, fetchImpl);
  return { ...value, attempts: 1 };
}

async function postOneSlot(
  slot: DailySlot,
  config: AppConfig,
  date: string,
  root: string,
  fetchImpl: typeof fetch,
  preflightOnly = false
): Promise<PostLogEntry[]> {
  const existing = await loadPostLog(date, root);
  const platforms: Platform[] = ["facebook", "instagram"];
  if (platforms.every((platform) => hasRecordedPost(existing, slot.slot, platform, config.dryRun))) {
    return platforms.map((platform) => ({
      date,
      slot: slot.slot,
      platform,
      status: "skipped",
      dry_run: config.dryRun,
      attempts: 0,
      created_at: new Date().toISOString()
    }));
  }

  const approvals = await loadApprovalLog(date, root);
  const missingApprovals = platforms.filter(
    (platform) =>
      !hasRecordedPost(existing, slot.slot, platform, config.dryRun) &&
      !hasApprovedPost(approvals, slot.slot, platform)
  );
  if (missingApprovals.length > 0) {
    throw new Error(
      `Post ${date} slot ${slot.slot} is not approved for: ${missingApprovals.join(", ")}. Run approve-post before posting.`
    );
  }

  await assertManualImageQaAllowsPublishing(date, slot, root);
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
  // A preflight is a check, so it reports the deferral without recording it.
  if (preflightOnly) {
    return platformInputs.map(({ platform, input }) => ({
      date,
      slot: slot.slot,
      platform,
      status: "pending",
      dry_run: config.dryRun,
      attempts: 0,
      published_media_type: input.mediaType,
      video_status: resolvedMedia.videoDeferred
        ? "VIDEO_DEFERRED"
        : isReel || isMixedCarousel
          ? "published"
          : "not_planned",
      video_defer_kind: resolvedMedia.videoDeferKind,
      video_deferred_reason: resolvedMedia.videoDeferredReason,
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

  // Meta writes are non-idempotent. Stop after the first failed platform so an
  // ambiguous response cannot trigger another write or a second-platform post.
  for (const { platform, input } of platformInputs) {
    if (hasRecordedPost(existing, slot.slot, platform, config.dryRun)) {
      outputs.push({
        date,
        slot: slot.slot,
        platform,
        status: "skipped",
        dry_run: config.dryRun,
        attempts: 0,
        created_at: new Date().toISOString()
      });
      continue;
    }

    try {
      const result = await postPlatform(platform, input, config, fetchImpl);
      const entry = resultToLog(date, slot.slot, result, resolvedMedia);
      await appendPostLog(entry, root);
      outputs.push(entry);
    } catch (error) {
      const entry: PostLogEntry = {
        date,
        slot: slot.slot,
        platform,
        status: "failed",
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
        error: error instanceof Error ? error.message : String(error),
        created_at: new Date().toISOString()
      };
      await appendPostLog(entry, root);
      outputs.push(entry);
      throw error;
    }
  }

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

  let content = await loadDailyContent(date, root);
  if (!content) {
    await generateDailyContent({ date, root });
    content = await loadDailyContent(date, root);
  }
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const currentSchedule = options.slot ? findSlotByNumber(options.slot) : resolveCurrentSlot(now, config.timezone);
  const targetSchedules = options.allDue
    ? DAILY_SCHEDULE.filter((item) => item.time <= getZonedDateParts(now, config.timezone).time)
    : currentSchedule
      ? [currentSchedule]
      : [];

  if (targetSchedules.length === 0) return [];

  const results: PostLogEntry[] = [];
  for (const schedule of targetSchedules) {
    const slot = content.slots.find((item) => item.slot === schedule.slot);
    if (!slot) throw new Error(`Content slot ${schedule.slot} is missing for ${date}`);
    results.push(...(await postOneSlot(slot, config, date, root, options.fetchImpl ?? fetch, options.preflightOnly)));
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
