import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
  hasRecordedPost,
  loadDailyContent,
  loadPostLog,
  loadRecentAiredReelVideoShas,
  loadVideoRepairQueue,
  postedVideoShaFields,
  upsertVideoRepairQueue
} from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { pauseMessage, readPause } from "./pause";
import { projectRoot } from "./paths";
import { isTrustedProductionRuntimeError } from "./productionRuntime";
import { postFacebookCarousel, postFacebookPhoto, postFacebookReel } from "./postFacebook";
import { postInstagramCarousel, postInstagramPhoto, postInstagramReel } from "./postInstagram";
import { NonRetryableError, withRetry } from "./retry";
import { loadAbTestPlan, planForDate, planSlot, type AbVariant } from "./abTestPlan";
import { assertPostedLogMatchesDate, resolveQualifiedDualPlatformReelReplacement } from "./publishingReconciliation";
import { CONCEPT_COOLDOWN_DAYS } from "./reelConcepts";
import { assertCanonicalPublicPublicationApproval } from "./publicPublicationApproval";
import { DAILY_SCHEDULE, findSlotByNumber, getZonedDateParts, resolveCurrentSlot } from "./scheduler";
import type {
  AppConfig,
  DailySlot,
  MediaType,
  Platform,
  PostInput,
  PostLogEntry,
  PostResult,
  RemotePublicationEvidence,
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
    // A missing or replaced immutable media runtime is not a normal asset
    // deferral. Falling back to the cover image would turn a PATH-shadow
    // attempt into a live Graph post. Stop before public-asset/Graph work;
    // ordinary missing, review, and quality failures still use VIDEO_DEFERRED.
    if (isTrustedProductionRuntimeError(error)) throw error;
    return {
      mediaType: slot.media_type === "mixed-carousel" ? "carousel" : "image",
      videoDeferred: true,
      videoDeferKind: classifyVideoFailure(error),
      videoDeferredReason: error instanceof Error ? error.message : String(error)
    };
  }
}

function normalizedPostId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasTrimmedRemotePostId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function expectedRemoteMediaType(platform: Platform, mediaType: MediaType): RemotePublicationEvidence["remote_media_type"] {
  if (mediaType === "reel") return "REELS";
  if (mediaType === "mixed-carousel") return platform === "facebook" ? "REELS" : "CAROUSEL";
  return mediaType === "carousel" ? "CAROUSEL" : "IMAGE";
}

function isPlatformPermalink(value: unknown, platform: Platform): boolean {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const expectedHost = platform === "facebook"
      ? hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "fb.watch" || hostname.endsWith(".fb.watch")
      : hostname === "instagram.com" || hostname.endsWith(".instagram.com");
    return url.protocol === "https:" && expectedHost;
  } catch {
    return false;
  }
}

function hasVerifiedRemotePublicationEvidence(
  value: unknown,
  postId: unknown,
  platform: Platform,
  mediaType: MediaType
): value is RemotePublicationEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Partial<RemotePublicationEvidence>;
  return (
    hasTrimmedRemotePostId(postId) &&
    evidence.remote_id === postId &&
    isPlatformPermalink(evidence.permalink, platform) &&
    typeof evidence.verified_at === "string" &&
    !Number.isNaN(Date.parse(evidence.verified_at)) &&
    evidence.remote_media_type === expectedRemoteMediaType(platform, mediaType) &&
    evidence.caption_exact_match === true
  );
}

function assertRemoteSuccessHasVerifiedEvidence(result: PostResult, media: ResolvedPublishMedia): void {
  if (
    !result.dry_run &&
    (result.status === "success" || result.status === "posted") &&
    !hasVerifiedRemotePublicationEvidence(
      result.remote_publication_evidence,
      result.post_id,
      result.platform,
      media.mediaType
    )
  ) {
    throw new NonRetryableError(
      `Meta ${result.platform} returned a non-dry success without verified remote read-back evidence; ` +
        "treating the remote outcome as uncertain and refusing a success receipt or posted-log entry."
    );
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
    post_id: normalizedPostId(result.post_id),
    ...(result.remote_reel_evidence ? { remote_reel_evidence: result.remote_reel_evidence } : {}),
    ...(result.remote_publication_evidence ? { remote_publication_evidence: result.remote_publication_evidence } : {}),
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

const POST_LOG_STATUSES = new Set([
  "pending",
  "success",
  "dry_run",
  "posted",
  "failed",
  "skipped",
  "missed",
  "uncertain"
]);

function isStrictPostLogEntry(value: unknown, date: string): value is PostLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PostLogEntry>;
  return (
    entry.date === date &&
    typeof entry.slot === "number" &&
    Number.isInteger(entry.slot) &&
    entry.slot > 0 &&
    (entry.platform === "facebook" || entry.platform === "instagram") &&
    typeof entry.status === "string" &&
    POST_LOG_STATUSES.has(entry.status) &&
    typeof entry.dry_run === "boolean" &&
    // A live success without the immutable remote identity cannot prove what
    // committed. Treat it as malformed rather than letting a later run call
    // it a completed post (or synthesize a success receipt from it).
    (entry.dry_run ||
      (entry.status !== "success" && entry.status !== "posted") ||
      hasTrimmedRemotePostId(entry.post_id))
  );
}

async function loadVerifiedPostLog(date: string, root: string): Promise<PostLogEntry[]> {
  let entries: PostLogEntry[];
  try {
    entries = await loadPostLog(date, root);
    assertPostedLogMatchesDate(date, entries);
    if (entries.some((entry) => !isStrictPostLogEntry(entry, date))) {
      throw new Error(`posted-log for ${date} contains an unsupported platform or status.`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new NonRetryableError(
      `posted-log for ${date} is malformed or ambiguous; treating publication state as uncertain and refusing Meta requests: ${detail}`,
      { cause: error }
    );
  }
  return entries;
}

function hasCompletedLivePost(entries: PostLogEntry[], slot: number, platform: Platform): boolean {
  return entries.some(
    (entry) =>
      entry.slot === slot &&
      entry.platform === platform &&
      !entry.dry_run &&
      (entry.status === "success" || entry.status === "posted") &&
      hasTrimmedRemotePostId(entry.post_id)
  );
}

interface LegacyMetaPublishIntent {
  date: string;
  slot: number;
  platform: Platform;
  state: "pending_remote_commit" | "remote_accepted_log_failed";
  created_at: string;
  remote_entry?: PostLogEntry;
  error?: string;
}

interface MetaPostSourceBinding {
  slot_sha256: string;
  source_binding_sha256: string;
  media_type: MediaType;
  caption_sha256: string;
  image_sha256: string[];
  image_url: string;
  image_urls?: string[];
  video_url?: string;
  video_sha256?: string;
}

interface MetaRemotePostClaim {
  schema_version: 1;
  claim_id: string;
  date: string;
  slot: number;
  platform: Platform;
  created_at: string;
  source: MetaPostSourceBinding;
}

interface MetaRemotePostReceipt {
  schema_version: 1;
  claim_id: string;
  date: string;
  slot: number;
  platform: Platform;
  state: "remote_accepted" | "remote_outcome_unknown";
  recorded_at: string;
  source_binding_sha256: string;
  remote_entry?: PostLogEntry;
  error?: string;
}

function legacyMetaPublishIntentPath(date: string, root: string): string {
  return join(root, "data", "meta-publish-intents", `${date}.json`);
}

function metaPostClaimPath(date: string, slot: number, platform: Platform, root: string): string {
  return join(root, "data", "meta-publish-claims", `${date}-slot${slot}-${platform}.json`);
}

function metaPostReceiptPath(date: string, slot: number, platform: Platform, root: string): string {
  return `${metaPostClaimPath(date, slot, platform, root)}.receipt.json`;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isMediaType(value: unknown): value is MediaType {
  return value === "image" || value === "carousel" || value === "reel" || value === "mixed-carousel";
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMetaPostSourceBinding(value: unknown): value is MetaPostSourceBinding {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<MetaPostSourceBinding>;
  return (
    isSha256(source.slot_sha256) &&
    isSha256(source.source_binding_sha256) &&
    isMediaType(source.media_type) &&
    isSha256(source.caption_sha256) &&
    Array.isArray(source.image_sha256) &&
    source.image_sha256.length > 0 &&
    source.image_sha256.every((sha) => isSha256(sha)) &&
    isNonBlankString(source.image_url) &&
    (source.image_urls === undefined ||
      (Array.isArray(source.image_urls) && source.image_urls.every((url) => isNonBlankString(url)))) &&
    (source.video_url === undefined || isNonBlankString(source.video_url)) &&
    (source.video_sha256 === undefined || isSha256(source.video_sha256))
  );
}

function isLegacyMetaPublishIntent(value: unknown, date: string): value is LegacyMetaPublishIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<LegacyMetaPublishIntent>;
  if (
    intent.date !== date ||
    typeof intent.slot !== "number" ||
    !Number.isInteger(intent.slot) ||
    intent.slot <= 0 ||
    (intent.platform !== "facebook" && intent.platform !== "instagram") ||
    (intent.state !== "pending_remote_commit" && intent.state !== "remote_accepted_log_failed") ||
    typeof intent.created_at !== "string" ||
    intent.created_at.trim().length === 0 ||
    (intent.error !== undefined && typeof intent.error !== "string")
  ) {
    return false;
  }
  if (intent.state === "pending_remote_commit") return intent.remote_entry === undefined;
  return (
    isStrictPostLogEntry(intent.remote_entry, date) &&
    intent.remote_entry.slot === intent.slot &&
    intent.remote_entry.platform === intent.platform &&
    !intent.remote_entry.dry_run &&
    (intent.remote_entry.status === "success" || intent.remote_entry.status === "posted")
  );
}

function isMetaRemotePostClaim(value: unknown, date: string, slot: number, platform: Platform): value is MetaRemotePostClaim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Partial<MetaRemotePostClaim>;
  return (
    claim.schema_version === 1 &&
    isNonBlankString(claim.claim_id) &&
    claim.date === date &&
    claim.slot === slot &&
    claim.platform === platform &&
    isNonBlankString(claim.created_at) &&
    isMetaPostSourceBinding(claim.source)
  );
}

function isMetaRemotePostReceipt(value: unknown, claim: MetaRemotePostClaim): value is MetaRemotePostReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<MetaRemotePostReceipt>;
  if (
    receipt.schema_version !== 1 ||
    receipt.claim_id !== claim.claim_id ||
    receipt.date !== claim.date ||
    receipt.slot !== claim.slot ||
    receipt.platform !== claim.platform ||
    !isNonBlankString(receipt.recorded_at) ||
    receipt.source_binding_sha256 !== claim.source.source_binding_sha256 ||
    (receipt.state !== "remote_accepted" && receipt.state !== "remote_outcome_unknown")
  ) {
    return false;
  }
  if (receipt.state === "remote_accepted") {
    return (
      isStrictPostLogEntry(receipt.remote_entry, claim.date) &&
      receipt.remote_entry.slot === claim.slot &&
      receipt.remote_entry.platform === claim.platform &&
      !receipt.remote_entry.dry_run &&
      (receipt.remote_entry.status === "success" || receipt.remote_entry.status === "posted") &&
      hasVerifiedRemotePublicationEvidence(
        receipt.remote_entry.remote_publication_evidence,
        receipt.remote_entry.post_id,
        receipt.remote_entry.platform,
        claim.source.media_type
      )
    );
  }
  return isNonBlankString(receipt.error) &&
    (receipt.remote_entry === undefined || isStrictPostLogEntry(receipt.remote_entry, claim.date));
}

async function buildMetaPostSourceBinding(
  slot: DailySlot,
  input: PostInput,
  media: ResolvedPublishMedia,
  root: string
): Promise<MetaPostSourceBinding> {
  const imageSha256 = await Promise.all(
    imageAssetsForSlot(slot).map(async (asset) =>
      createHash("sha256")
        .update(await readFile(join(root, ...asset.local_image_path.split("/"))))
        .digest("hex")
    )
  );
  const binding = {
    slot_sha256: createHash("sha256").update(JSON.stringify(slot)).digest("hex"),
    media_type: input.mediaType ?? "image",
    caption_sha256: createHash("sha256").update(input.caption).digest("hex"),
    image_sha256: imageSha256,
    image_url: input.imageUrl,
    ...(input.imageUrls?.length ? { image_urls: input.imageUrls } : {}),
    ...(input.videoUrl ? { video_url: input.videoUrl } : {}),
    ...(media.videoSha256 ? { video_sha256: media.videoSha256 } : {})
  };
  return {
    ...binding,
    source_binding_sha256: createHash("sha256").update(JSON.stringify(binding)).digest("hex")
  };
}

async function loadLegacyMetaPublishIntents(date: string, root: string): Promise<LegacyMetaPublishIntent[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(legacyMetaPublishIntentPath(date, root), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    const detail = error instanceof Error ? error.message : String(error);
    throw new NonRetryableError(
      `legacy meta-publish-intents for ${date} cannot be read; automatic publish is blocked pending recovery: ${detail}`,
      { cause: error }
    );
  }
  if (!Array.isArray(raw) || raw.some((intent) => !isLegacyMetaPublishIntent(intent, date))) {
    throw new NonRetryableError(
      `legacy meta-publish-intents for ${date} is malformed; automatic publish is blocked pending recovery.`
    );
  }
  return raw;
}

async function assertNoLegacyPublishLock(date: string, slot: number, root: string): Promise<void> {
  const path = join(root, "data", "publish-locks", `${date}-slot${slot}.lock`);
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    const detail = error instanceof Error ? error.message : String(error);
    throw new NonRetryableError(
      `legacy publish lock for ${date} slot ${slot} cannot be inspected; automatic publish is blocked pending recovery: ${detail}`,
      { cause: error }
    );
  }
  throw new NonRetryableError(
    `A legacy publish lock exists for ${date} slot ${slot}; automatic publish is blocked. ` +
      `Manual recovery required: verify Facebook and Instagram for a prior post, then remove ${path} only after that verification. No Meta request was made.`
  );
}

async function assertNoMatchingLegacyMetaPublishIntent(input: {
  date: string;
  slot: number;
  platform: Platform;
  root: string;
}): Promise<void> {
  const existing = (await loadLegacyMetaPublishIntents(input.date, input.root)).find(
    (intent) => intent.slot === input.slot && intent.platform === input.platform
  );
  if (!existing) return;
  const evidence = existing.remote_entry?.post_id ? ` (remote post ${existing.remote_entry.post_id})` : "";
  throw new NonRetryableError(
    `Legacy Meta publish intent for ${input.date} slot ${input.slot} ${input.platform} is ${existing.state}${evidence}; automatic retry is blocked pending recovery.`
  );
}

async function loadMetaRemotePostClaim(input: {
  date: string;
  slot: number;
  platform: Platform;
  root: string;
}): Promise<MetaRemotePostClaim | undefined> {
  const path = metaPostClaimPath(input.date, input.slot, input.platform, input.root);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    const detail = error instanceof Error ? error.message : String(error);
    throw new NonRetryableError(
      `Meta remote POST claim for ${input.date} slot ${input.slot} ${input.platform} cannot be read; automatic publish is blocked pending recovery: ${detail}`,
      { cause: error }
    );
  }
  if (!isMetaRemotePostClaim(raw, input.date, input.slot, input.platform)) {
    throw new NonRetryableError(
      `Meta remote POST claim for ${input.date} slot ${input.slot} ${input.platform} is malformed or mismatched; automatic publish is blocked pending recovery.`
    );
  }
  return raw;
}

async function claimMetaRemotePost(input: {
  date: string;
  slot: number;
  platform: Platform;
  root: string;
  source: MetaPostSourceBinding;
}): Promise<MetaRemotePostClaim> {
  await assertNoMatchingLegacyMetaPublishIntent(input);
  const path = metaPostClaimPath(input.date, input.slot, input.platform, input.root);
  await mkdir(join(input.root, "data", "meta-publish-claims"), { recursive: true });
  const claim: MetaRemotePostClaim = {
    schema_version: 1,
    claim_id: randomUUID(),
    date: input.date,
    slot: input.slot,
    platform: input.platform,
    created_at: new Date().toISOString(),
    source: input.source
  };
  try {
    // `wx` is the remote authority: only one process can obtain a tuple claim
    // before it reaches a potentially irreversible Meta POST. Claims are never
    // renamed, cleared, or reclaimed by automation.
    await writeFile(path, `${JSON.stringify(claim, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await loadMetaRemotePostClaim(input);
    const detail = existing ? ` claim ${existing.claim_id} from ${existing.created_at}` : "";
    throw new NonRetryableError(
      `Meta remote POST claim already exists for ${input.date} slot ${input.slot} ${input.platform}${detail}; automatic retry is blocked pending recovery. No Meta request was made.`
    );
  }
  return claim;
}

async function writeMetaRemotePostReceipt(input: {
  claim: MetaRemotePostClaim;
  root: string;
  state: MetaRemotePostReceipt["state"];
  remoteEntry?: PostLogEntry;
  error?: unknown;
}): Promise<void> {
  const path = metaPostReceiptPath(input.claim.date, input.claim.slot, input.claim.platform, input.root);
  const receipt: MetaRemotePostReceipt = {
    schema_version: 1,
    claim_id: input.claim.claim_id,
    date: input.claim.date,
    slot: input.claim.slot,
    platform: input.claim.platform,
    state: input.state,
    recorded_at: new Date().toISOString(),
    source_binding_sha256: input.claim.source.source_binding_sha256,
    ...(input.remoteEntry ? { remote_entry: input.remoteEntry } : {}),
    ...(input.error === undefined
      ? {}
      : { error: input.error instanceof Error ? input.error.message : String(input.error) })
  };
  if (!isMetaRemotePostReceipt(receipt, input.claim)) {
    throw new NonRetryableError(
      `Meta remote POST receipt for ${input.claim.date} slot ${input.claim.slot} ${input.claim.platform} ` +
        "has no valid remote identity or is otherwise malformed; automatic recovery is blocked."
    );
  }
  try {
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let existing: unknown;
    try {
      existing = JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (readError) {
      const detail = readError instanceof Error ? readError.message : String(readError);
      throw new NonRetryableError(
        `Meta remote POST receipt for ${input.claim.date} slot ${input.claim.slot} ${input.claim.platform} cannot be read; automatic recovery is blocked: ${detail}`,
        { cause: readError }
      );
    }
    if (!isMetaRemotePostReceipt(existing, input.claim)) {
      throw new NonRetryableError(
        `Meta remote POST receipt for ${input.claim.date} slot ${input.claim.slot} ${input.claim.platform} is malformed or mismatched; automatic recovery is blocked.`
      );
    }
  }
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
  // Pre-claim `publish-locks` are historical coarse slot markers, not a safe
  // compare-and-swap authority for an irreversible remote commit. Never ignore
  // one: only a human who verified both platforms may clear it. New publishes
  // use immutable per-platform claims below instead.
  if (!config.dryRun && !preflightOnly) {
    await assertNoLegacyPublishLock(date, slot.slot, root);
  }
  // Every live Meta request is bound to the complete canonical release
  // decision: exact non-forced FB/IG approval tuples, immutable fingerprints
  // and image digests, video evidence, and an untampered calendar. There is no
  // legacy-day fallback -- absent proof is a refusal before URL or Graph fetch.
  const existing = await loadVerifiedPostLog(date, root);
  if (!config.dryRun && !preflightOnly) {
    await assertCanonicalPublicPublicationApproval(date, root);
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
        const pastPosts = await loadVerifiedPostLog(pastDate, root);
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
  // afterwards so the run still reports failure. Its immutable tuple claim
  // prevents any later scheduler run from retrying an uncertain remote effect.
  let firstFailure: unknown;
  for (const { platform, input } of platformInputs) {
    const alreadyRecorded = hasRecordedPost(existing, slot.slot, platform, config.dryRun);
    if (alreadyRecorded) {
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

    let claim: MetaRemotePostClaim | undefined;
    if (!config.dryRun) {
      try {
        // Re-read the whole immutable approval package immediately before this
        // platform's irreversible claim. The earlier gate keeps bad evidence
        // from reaching public-asset fetches; this one closes the time-of-check
        // gap before each Graph POST.
        await assertCanonicalPublicPublicationApproval(date, root);
        claim = await loadMetaRemotePostClaim({ date, slot: slot.slot, platform, root });
        if (claim) {
          // Another caller may have finished the remote effect after this
          // invocation loaded its initial ledger. Re-read only to recognize a
          // completed matching record; any incomplete or uncertain claim stays
          // a per-platform manual-recovery refusal.
          const refreshed = await loadVerifiedPostLog(date, root);
          if (hasCompletedLivePost(refreshed, slot.slot, platform)) {
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
          throw new NonRetryableError(
            `Meta remote POST claim ${claim.claim_id} already exists for ${date} slot ${slot.slot} ${platform}; ` +
              `automatic retry is blocked pending recovery. No Meta request was made.`
          );
        }
        claim = await claimMetaRemotePost({
          date,
          slot: slot.slot,
          platform,
          root,
          source: await buildMetaPostSourceBinding(slot, input, resolvedMedia, root)
        });
      } catch (error) {
        // Claim/legacy checks happen before any remote request. Preserve the
        // refusal for the final caller result, but do not manufacture a
        // failed/uncertain local outcome or prevent the other platform from
        // making its independent attempt.
        firstFailure = firstFailure ?? error;
        continue;
      }
    }

    let result: PostResult;
    try {
      // The `wx` tuple claim was committed immediately before this call. A
      // crash here must remain a manual-recovery state, because even a request
      // that appears not to have returned can have committed remotely.
      result = await postPlatform(platform, input, config, fetchImpl);
      assertRemoteSuccessHasVerifiedEvidence(result, resolvedMedia);
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
      let receiptError: unknown;
      if (claim) {
        try {
          await writeMetaRemotePostReceipt({
            claim,
            root,
            state: "remote_outcome_unknown",
            remoteEntry: entry,
            error
          });
        } catch (receiptFailure) {
          receiptError = receiptFailure;
        }
      }
      try {
        await appendPostLog(entry, root);
      } catch (logFailure) {
        const receiptDetail = receiptError
          ? ` Remote receipt also failed: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}.`
          : "";
        firstFailure = firstFailure ?? new NonRetryableError(
          `Meta outcome for ${date} slot ${slot.slot} ${platform} is uncertain and local posted-log commit failed: ` +
            `${logFailure instanceof Error ? logFailure.message : String(logFailure)}.${receiptDetail} Automatic retry is blocked pending recovery.`,
          { cause: logFailure }
        );
        continue;
      }
      outputs.push(entry);
      firstFailure = firstFailure ?? error;
      continue;
    }

    const entry = resultToLog(date, slot.slot, result, resolvedMedia, abVariant);
    let receiptError: unknown;
    if (claim) {
      try {
        // Store remote read-back evidence before touching the local ledger. If
        // the ledger write fails or this process crashes immediately after it,
        // the claim and receipt still prevent a second remote POST.
        await writeMetaRemotePostReceipt({ claim, root, state: "remote_accepted", remoteEntry: entry });
      } catch (receiptFailure) {
        receiptError = receiptFailure;
      }
    }
    try {
      await appendPostLog(entry, root);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const receiptDetail = receiptError
        ? ` Remote receipt also failed: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}.`
        : "";
      firstFailure = firstFailure ?? new NonRetryableError(
        `Meta accepted ${date} slot ${slot.slot} ${platform}, but local posted-log commit failed: ${detail}.${receiptDetail} Automatic retry is blocked pending recovery.`,
        { cause: error }
      );
      continue;
    }

    outputs.push(entry);
    if (receiptError) {
      firstFailure = firstFailure ?? new NonRetryableError(
        `Meta accepted ${date} slot ${slot.slot} ${platform}, but its immutable remote receipt could not be written: ` +
          `${receiptError instanceof Error ? receiptError.message : String(receiptError)}. Automatic retry is blocked pending recovery.`,
        { cause: receiptError }
      );
    }
  }
  if (firstFailure !== undefined) throw firstFailure;

  if (!config.dryRun && !resolvedMedia.videoDeferred && isReel) {
    const repairs = await loadVideoRepairQueue(root);
    for (const repair of repairs) {
      if (
        repair.status !== "VIDEO_DEFERRED" ||
        repair.replacement_candidate_date !== date ||
        repair.replacement_candidate_slot !== slot.slot
      ) {
        continue;
      }
      const resolution = await resolveQualifiedDualPlatformReelReplacement({
        sourceDate: repair.source_date,
        sourceSlot: repair.source_slot,
        replacementDate: date,
        replacementSlot: slot.slot,
        root
      });
      if (!resolution.qualified) continue;
    }
  }

  return outputs;
}

export function refuseTamperedPublish(date: string, reasons: string[]): void {
  const detail = reasons.length > 0 ? reasons.join("; ") : "content_checksum mismatch";
  console.warn(`CALENDAR_TAMPERED ${date}: ${detail}`);
  // TypeScript is not a trusted launcher for a PATH-resolved PowerShell
  // process. Scheduled PowerShell wrappers may render a notification from the
  // durable warning, but a tamper refusal itself stays side-effect free.
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
