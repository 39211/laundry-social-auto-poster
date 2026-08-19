import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { validatePublishableReel } from "./generateVideo";
import { loadDailyContent, loadPostLog, readJsonFile, withJsonFileLock, writeJsonAtomic } from "./logging";
import { projectRoot, videoRepairQueuePath } from "./paths";
import type { DailySlot, Platform, PostLogEntry, RemoteReelEvidence, VideoRepairQueueEntry } from "./types";
import { warnVisualQaForPublish } from "./visualQa";

/** A successfully uploaded YouTube Short, bound to the source publishing slot. */
export interface YouTubeLogEntry {
  date: string;
  slot: number;
  video_id: string;
  title: string;
  uploaded_at: string;
  ab_variant?: "10s" | "15s";
}

export interface ReelShortReconciliation {
  expected_reel_slots: number[];
  uploaded_reel_slots: number[];
  missing_reel_slots: number[];
  unexpected_youtube_slots: number[];
  /** Well-formed ledger rows that lack immutable claim + verified completion proof. */
  unverified_youtube_slots: number[];
}

export interface YouTubeCompletionSourceBinding {
  local_video_path: string;
  local_video_sha256: string;
  instagram_video_sha256: string;
  instagram_post_id: string;
}

export interface YouTubeCompletionVerification {
  verified: boolean;
  reason?: string;
}

/**
 * Read-only proof used before a deferred video can be marked resolved.  This
 * deliberately describes proof rather than intent: a replacement is not a
 * resolution until both remote Reel records bind to the exact local bytes.
 */
export interface QualifiedDualPlatformReelVerification {
  qualified: boolean;
  reason?: string;
  video_sha256?: string;
}

export interface PlannedReelReadiness {
  status: "ready" | "blocked" | "not_planned" | "calendar_missing";
  required_reel_slots: number[];
  ready_reel_slots: number[];
  blocked_reels: Array<{ slot: number; reason: string }>;
}

export interface StrictTransportExpectation {
  date: string;
  slot: number;
  platform: Platform;
}

function hasTrimmedNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

/**
 * A follow-up side effect (comment, Story, or catch-up acknowledgement) may
 * only use an unambiguous, same-tuple live transport record.  Do not coerce
 * missing booleans or identifiers: an ambiguous ledger is a no-POST state.
 */
export function findStrictLiveTransportEntry(
  entries: readonly unknown[],
  expected: StrictTransportExpectation
): (PostLogEntry & { dry_run: false; status: "success" | "posted"; post_id: string }) | undefined {
  if (
    typeof expected.date !== "string" ||
    expected.date.trim().length === 0 ||
    !Number.isInteger(expected.slot) ||
    expected.slot <= 0 ||
    (expected.platform !== "facebook" && expected.platform !== "instagram")
  ) {
    return undefined;
  }

  // Include a cross-day row for the same slot/platform in the ambiguity set.
  // Picking the other valid-looking row would turn a corrupted date ledger into
  // permission to perform a remote side effect.
  const tupleRows = entries.filter((value): value is Partial<PostLogEntry> => {
    if (!value || typeof value !== "object") return false;
    const entry = value as Partial<PostLogEntry>;
    return entry.slot === expected.slot && entry.platform === expected.platform;
  });
  if (tupleRows.length !== 1) return undefined;

  const entry = tupleRows[0];
  if (!entry) return undefined;
  return entry.date === expected.date &&
    entry.slot === expected.slot &&
    entry.platform === expected.platform &&
    entry.dry_run === false &&
    (entry.status === "success" || entry.status === "posted") &&
    hasTrimmedNonEmptyString(entry.post_id)
    ? (entry as PostLogEntry & { dry_run: false; status: "success" | "posted"; post_id: string })
    : undefined;
}

/**
 * The YouTube contract is deliberately narrower than a generic "video aired"
 * check: a Short is opened only by the same slot's successful live Instagram
 * Reel. A carousel, an image fallback, a dry run, and an uncertain commit do
 * not qualify.
 */
function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
}

function normalizedSha256(value: unknown): string | undefined {
  return isSha256(value) ? value.toLowerCase() : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Parse the public business profile once for every consumer of YouTube proof. */
export function expectedYouTubeChannelIdFromBusinessProfile(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const youtubeUrl = (value as { youtube_url?: unknown }).youtube_url;
  if (typeof youtubeUrl !== "string" || youtubeUrl.trim().length === 0) return undefined;
  try {
    const url = new URL(youtubeUrl);
    if (url.protocol !== "https:" || (url.hostname !== "youtube.com" && url.hostname !== "www.youtube.com")) {
      return undefined;
    }
    const match = /^\/channel\/([^/]+)\/?$/.exec(url.pathname);
    const channelId = match ? nonEmptyString(match[1]) : undefined;
    return channelId && /^UC[A-Za-z0-9_-]{20,}$/.test(channelId) ? channelId : undefined;
  } catch {
    return undefined;
  }
}

/** The profile, not an arbitrary OAuth account, defines the authorized channel. */
export async function loadCanonicalYouTubeChannelId(root: string): Promise<string | undefined> {
  const profile = await readJsonFile<unknown | undefined>(join(root, "data", "business-profile.json"), undefined);
  return expectedYouTubeChannelIdFromBusinessProfile(profile);
}

function slotRecordPath(directory: string, date: string, slot: number, root: string): string {
  return join(root, "data", directory, date, `slot-${String(slot).padStart(2, "0")}.json`);
}

type ChannelBindingRecord = {
  expected_channel_id?: unknown;
  authorized_channel_id?: unknown;
};

type RemoteClaimRecord = {
  version?: unknown;
  date?: unknown;
  slot?: unknown;
  claim_id?: unknown;
  claimed_at?: unknown;
  source?: {
    local_video_path?: unknown;
    local_video_sha256?: unknown;
    instagram_post_id?: unknown;
    instagram_video_sha256?: unknown;
  };
  channel?: ChannelBindingRecord;
};

type CompletionEvidenceRecord = {
  version?: unknown;
  date?: unknown;
  slot?: unknown;
  claim_id?: unknown;
  state?: unknown;
  recorded_at?: unknown;
  remote_video_id?: unknown;
  read_back_verified?: unknown;
  channel?: ChannelBindingRecord;
};

function isBoundToCanonicalYouTubeChannel(value: { channel?: ChannelBindingRecord }, expectedChannelId: string): boolean {
  const channel = value.channel;
  return (
    !!channel &&
    channel.expected_channel_id === expectedChannelId &&
    channel.authorized_channel_id === expectedChannelId
  );
}

function isClaimBoundToSource(
  value: unknown,
  input: { date: string; slot: number; source: YouTubeCompletionSourceBinding }
): value is Required<Pick<RemoteClaimRecord, "claim_id">> & RemoteClaimRecord {
  if (!value || typeof value !== "object") return false;
  const claim = value as RemoteClaimRecord;
  const source = claim.source;
  return (
    claim.version === 1 &&
    claim.date === input.date &&
    claim.slot === input.slot &&
    !!nonEmptyString(claim.claim_id) &&
    typeof claim.claimed_at === "string" &&
    !Number.isNaN(Date.parse(claim.claimed_at)) &&
    !!source &&
    nonEmptyString(source.local_video_path) === input.source.local_video_path &&
    normalizedSha256(source.local_video_sha256) === input.source.local_video_sha256 &&
    normalizedSha256(source.instagram_video_sha256) === input.source.instagram_video_sha256 &&
    nonEmptyString(source.instagram_post_id) === input.source.instagram_post_id
  );
}

function isCompletedEvidenceBoundToLedger(
  value: unknown,
  input: { date: string; slot: number; claimId: string; videoId: string; expectedChannelId: string }
): boolean {
  if (!value || typeof value !== "object") return false;
  const evidence = value as CompletionEvidenceRecord;
  return (
    evidence.version === 1 &&
    evidence.date === input.date &&
    evidence.slot === input.slot &&
    evidence.claim_id === input.claimId &&
    evidence.state === "completed" &&
    evidence.remote_video_id === input.videoId &&
    evidence.read_back_verified === true &&
    isBoundToCanonicalYouTubeChannel(evidence, input.expectedChannelId) &&
    typeof evidence.recorded_at === "string" &&
    !Number.isNaN(Date.parse(evidence.recorded_at))
  );
}

/**
 * A syntactically valid ledger row is not completion evidence. It qualifies
 * only when the immutable source claim and read-back-confirmed completion
 * evidence bind it to the current IG Reel and its exact local MP4 bytes.
 */
export async function verifyYouTubeCompletionEvidence(input: {
  date: string;
  slot: number;
  root: string;
  entry: YouTubeLogEntry;
  source: YouTubeCompletionSourceBinding;
}): Promise<YouTubeCompletionVerification> {
  if (
    input.entry.date !== input.date ||
    input.entry.slot !== input.slot ||
    !isYouTubeUploadCandidate(input.entry)
  ) {
    return { verified: false, reason: "ledger date, slot, or schema does not match the requested completion" };
  }
  try {
    const [expectedChannelId, claim, evidence] = await Promise.all([
      loadCanonicalYouTubeChannelId(input.root),
      readJsonFile<unknown | undefined>(slotRecordPath("youtube-upload-claims", input.date, input.slot, input.root), undefined),
      readJsonFile<unknown | undefined>(slotRecordPath("youtube-upload-evidence", input.date, input.slot, input.root), undefined)
    ]);
    if (!expectedChannelId) {
      return { verified: false, reason: "canonical business profile has no valid YouTube channel id" };
    }
    if (!isClaimBoundToSource(claim, input)) {
      return { verified: false, reason: "immutable claim is missing, malformed, or not bound to this local MP4 and IG post" };
    }
    if (!isBoundToCanonicalYouTubeChannel(claim, expectedChannelId)) {
      return { verified: false, reason: "immutable claim is not bound to the canonical business YouTube channel" };
    }
    const claimId = nonEmptyString(claim.claim_id);
    if (!claimId || !isCompletedEvidenceBoundToLedger(evidence, {
      date: input.date,
      slot: input.slot,
      claimId,
      videoId: input.entry.video_id,
      expectedChannelId
    })) {
      return { verified: false, reason: "completed read-back evidence is missing or does not bind this ledger video id and canonical business channel" };
    }
    return { verified: true };
  } catch (error) {
    return {
      verified: false,
      reason: `completion proof cannot be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function isInstagramPermalink(value: unknown): value is string {
  if (!hasTrimmedNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "instagram.com" || hostname.endsWith(".instagram.com"))
    );
  } catch {
    return false;
  }
}

function isFacebookPermalink(value: unknown): value is string {
  if (!hasTrimmedNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "facebook.com" ||
        hostname.endsWith(".facebook.com") ||
        hostname === "fb.watch" ||
        hostname.endsWith(".fb.watch"))
    );
  } catch {
    return false;
  }
}

function isVerifiedRemoteReelEvidence(
  value: unknown,
  postId: unknown
): value is RemoteReelEvidence {
  if (!value || typeof value !== "object" || !hasTrimmedNonEmptyString(postId)) return false;
  const evidence = value as Partial<RemoteReelEvidence>;
  return (
    evidence.remote_id === postId &&
    isInstagramPermalink(evidence.permalink) &&
    typeof evidence.verified_at === "string" &&
    !Number.isNaN(Date.parse(evidence.verified_at)) &&
    evidence.remote_media_type === "REELS" &&
    evidence.caption_exact_match === true
  );
}

function isVerifiedFacebookReelEvidence(
  value: unknown,
  postId: unknown
): value is RemoteReelEvidence {
  if (!value || typeof value !== "object" || !hasTrimmedNonEmptyString(postId)) return false;
  const evidence = value as Partial<RemoteReelEvidence>;
  return (
    evidence.remote_id === postId &&
    isFacebookPermalink(evidence.permalink) &&
    typeof evidence.verified_at === "string" &&
    !Number.isNaN(Date.parse(evidence.verified_at)) &&
    evidence.remote_media_type === "REELS" &&
    evidence.caption_exact_match === true
  );
}

export function isQualifiedInstagramReel(
  entry: Pick<
    PostLogEntry,
    | "platform"
    | "dry_run"
    | "status"
    | "published_media_type"
    | "video_status"
    | "video_sha256"
    | "post_id"
    | "remote_reel_evidence"
  >
): boolean {
  return (
    entry.platform === "instagram" &&
    entry.dry_run === false &&
    (entry.status === "success" || entry.status === "posted") &&
    entry.published_media_type === "reel" &&
    entry.video_status === "published" &&
    isSha256(entry.video_sha256) &&
    isVerifiedRemoteReelEvidence(entry.remote_reel_evidence, entry.post_id)
  );
}

/** A Facebook row qualifies only after its own Reel read-back is present. */
export function isQualifiedFacebookReel(
  entry: Pick<
    PostLogEntry,
    | "platform"
    | "dry_run"
    | "status"
    | "published_media_type"
    | "video_status"
    | "video_sha256"
    | "post_id"
    | "remote_reel_evidence"
  >
): boolean {
  return (
    entry.platform === "facebook" &&
    entry.dry_run === false &&
    (entry.status === "success" || entry.status === "posted") &&
    entry.published_media_type === "reel" &&
    entry.video_status === "published" &&
    isSha256(entry.video_sha256) &&
    isVerifiedFacebookReelEvidence(entry.remote_reel_evidence, entry.post_id)
  );
}

function uniqueCalendarSlot(content: { slots: readonly DailySlot[] }, slot: number): DailySlot | undefined {
  const matches = content.slots.filter((candidate) => candidate.slot === slot);
  return matches.length === 1 ? matches[0] : undefined;
}

function isCalendarDate(value: unknown): value is string {
  if (!hasTrimmedNonEmptyString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function safeProjectRelativePath(root: string, localPath: string): string | undefined {
  if (isAbsolute(localPath)) return undefined;
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, ...localPath.split("/"));
  const pathFromRoot = relative(resolvedRoot, resolvedPath);
  return pathFromRoot.length > 0 && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot)
    ? resolvedPath
    : undefined;
}

/**
 * The VIDEO_DEFERRED queue is an audit record, not a retry queue.  It may be
 * resolved only by an exact replacement date+slot with one Facebook and one
 * Instagram Reel, both read back, both bound to the same current local MP4,
 * and both carrying the original slot's exact topic.  Any gap is intentionally
 * returned as unqualified rather than inferred from a successful transport.
 */
export async function verifyQualifiedDualPlatformReelReplacement(input: {
  sourceDate: string;
  sourceSlot: number;
  replacementDate: string;
  replacementSlot: number;
  root?: string;
}): Promise<QualifiedDualPlatformReelVerification> {
  if (
    !isCalendarDate(input.sourceDate) ||
    !isValidSlot(input.sourceSlot) ||
    !isCalendarDate(input.replacementDate) ||
    !isValidSlot(input.replacementSlot)
  ) {
    return { qualified: false, reason: "source and replacement date+slot must be explicit and valid" };
  }

  const root = projectRoot(input.root);
  let sourceContent;
  let replacementContent;
  try {
    if (input.sourceDate === input.replacementDate) {
      sourceContent = await loadDailyContent(input.sourceDate, root);
      replacementContent = sourceContent;
    } else {
      [sourceContent, replacementContent] = await Promise.all([
        loadDailyContent(input.sourceDate, root),
        loadDailyContent(input.replacementDate, root)
      ]);
    }
  } catch (error) {
    return {
      qualified: false,
      reason: `calendar cannot be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (!sourceContent || !replacementContent) {
    return { qualified: false, reason: "source or replacement calendar is missing" };
  }
  if (sourceContent.tampered || replacementContent.tampered) {
    return { qualified: false, reason: "source or replacement calendar integrity is marked tampered" };
  }

  const sourceSlot = uniqueCalendarSlot(sourceContent, input.sourceSlot);
  const replacementSlot = uniqueCalendarSlot(replacementContent, input.replacementSlot);
  if (!sourceSlot || !replacementSlot) {
    return { qualified: false, reason: "source or replacement calendar slot is missing or ambiguous" };
  }
  const sourceTopic = nonEmptyString(sourceSlot.topic);
  const replacementTopic = nonEmptyString(replacementSlot.topic);
  if (!sourceTopic || !replacementTopic || sourceSlot.topic !== replacementSlot.topic) {
    return { qualified: false, reason: "source and replacement topics do not exactly match" };
  }
  if (replacementSlot.media_type !== "reel" || !hasTrimmedNonEmptyString(replacementSlot.local_video_path)) {
    return { qualified: false, reason: "replacement calendar does not bind this slot to a local Reel MP4" };
  }

  const localVideoPath = safeProjectRelativePath(root, replacementSlot.local_video_path);
  if (!localVideoPath) {
    return { qualified: false, reason: "replacement local MP4 path escapes the project root" };
  }

  let localVideoSha256: string;
  try {
    const bytes = await readFile(localVideoPath);
    localVideoSha256 = createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    return {
      qualified: false,
      reason: `replacement local MP4 cannot be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  let posted: PostLogEntry[];
  try {
    posted = await loadPostLog(input.replacementDate, root);
    assertPostedLogMatchesDate(input.replacementDate, posted);
  } catch (error) {
    return {
      qualified: false,
      reason: `replacement posted-log is malformed or cross-date ambiguous: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const exactTuple = posted.filter(
    (entry) => entry.date === input.replacementDate && entry.slot === input.replacementSlot
  );
  if (exactTuple.length !== 2) {
    return {
      qualified: false,
      reason: `expected exactly two Facebook+Instagram rows for replacement tuple, found ${exactTuple.length}`
    };
  }
  const facebook = exactTuple.filter(isQualifiedFacebookReel);
  const instagram = exactTuple.filter(isQualifiedInstagramReel);
  if (facebook.length !== 1 || instagram.length !== 1) {
    return {
      qualified: false,
      reason: "replacement tuple lacks exactly one qualified Facebook Reel and one qualified Instagram Reel"
    };
  }

  const facebookSha256 = normalizedSha256(facebook[0]?.video_sha256);
  const instagramSha256 = normalizedSha256(instagram[0]?.video_sha256);
  if (!facebookSha256 || !instagramSha256 || facebookSha256 !== instagramSha256 || facebookSha256 !== localVideoSha256) {
    return {
      qualified: false,
      reason: "Facebook, Instagram, and the current replacement local MP4 do not share one valid SHA-256"
    };
  }

  return { qualified: true, video_sha256: localVideoSha256 };
}

/**
 * The only state transition that may close VIDEO_DEFERRED.  Keep it beside
 * the proof builder so a future caller cannot import a generic queue writer
 * and turn a planned replacement into a completed one without remote proof.
 * The queue is rechecked under its lock after proof to bind that proof to the
 * still-current candidate and preserve RESOLVED as a terminal state.
 */
export async function resolveQualifiedDualPlatformReelReplacement(input: {
  sourceDate: string;
  sourceSlot: number;
  replacementDate: string;
  replacementSlot: number;
  root?: string;
}): Promise<QualifiedDualPlatformReelVerification> {
  const verification = await verifyQualifiedDualPlatformReelReplacement(input);
  if (!verification.qualified) return verification;

  const root = projectRoot(input.root);
  const filePath = videoRepairQueuePath(root);
  await withJsonFileLock(filePath, async () => {
    const entries = await readJsonFile<VideoRepairQueueEntry[]>(filePath, []);
    const matches = entries.filter(
      (item) => item.source_date === input.sourceDate && item.source_slot === input.sourceSlot
    );
    if (matches.length === 0) {
      throw new Error(`Video repair item not found: ${input.sourceDate} slot ${input.sourceSlot}.`);
    }
    if (matches.length !== 1) {
      throw new Error(
        `Video repair item is ambiguous: ${input.sourceDate} slot ${input.sourceSlot} has ${matches.length} queue rows.`
      );
    }
    const repair = matches[0]!;
    if (repair.status !== "VIDEO_DEFERRED") {
      throw new Error(
        `Video repair item is not eligible for resolution: ${input.sourceDate} slot ${input.sourceSlot} is ${repair.status}.`
      );
    }
    if (
      repair.replacement_candidate_date !== input.replacementDate ||
      repair.replacement_candidate_slot !== input.replacementSlot
    ) {
      throw new Error(
        `Video repair item has no matching ready replacement candidate: ${input.sourceDate} slot ${input.sourceSlot} -> ` +
          `${input.replacementDate} slot ${input.replacementSlot}.`
      );
    }
    repair.status = "RESOLVED";
    repair.resolved_at = new Date().toISOString();
    repair.replacement_date = input.replacementDate;
    repair.replacement_slot = input.replacementSlot;
    await writeJsonAtomic(filePath, entries);
  });
  return verification;
}

function isValidSlot(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isYouTubeUploadCandidate(value: unknown): value is {
  date: string;
  slot: number;
  video_id: string;
} {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<YouTubeLogEntry>;
  return (
    typeof entry.date === "string" &&
    entry.date.trim().length > 0 &&
    isValidSlot(entry.slot) &&
    typeof entry.video_id === "string" &&
    entry.video_id.trim().length > 0 &&
    typeof entry.title === "string" &&
    entry.title.trim().length > 0 &&
    typeof entry.uploaded_at === "string" &&
    entry.uploaded_at.trim().length > 0
  );
}

/** Reject corrupted source logs instead of allowing their file location to imply the date. */
export function assertPostedLogMatchesDate(date: string, entries: unknown): asserts entries is readonly PostLogEntry[] {
  if (!Array.isArray(entries)) throw new Error(`posted-log for ${date} must be a JSON array.`);
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid posted-log entry at index ${index} for ${date}.`);
    }
    const record = entry as Partial<PostLogEntry>;
    if (record.date !== date) {
      throw new Error(
        `posted-log date mismatch at index ${index}: expected ${date}, found ${String(record.date)}.`
      );
    }
    if (!isValidSlot(record.slot) || typeof record.platform !== "string" || typeof record.status !== "string") {
      throw new Error(`Invalid posted-log entry at index ${index} for ${date}.`);
    }
    if (typeof record.dry_run !== "boolean") {
      throw new Error(`Invalid posted-log entry at index ${index} for ${date}: dry_run must be boolean.`);
    }
  });
}

/** A malformed YouTube ledger is an audit failure, never an empty success state. */
export function assertYouTubeLogEntries(entries: unknown): asserts entries is readonly YouTubeLogEntry[] {
  if (!Array.isArray(entries)) throw new Error("youtube-log must be a JSON array.");
  entries.forEach((entry, index) => {
    if (!isYouTubeUploadCandidate(entry)) {
      throw new Error(
        `Invalid youtube-log entry at index ${index}: date, positive slot, video_id, title, and uploaded_at are required.`
      );
    }
  });
}

function uniqueSorted(slots: Iterable<number>): number[] {
  return [...new Set(slots)].sort((left, right) => left - right);
}

function duplicateYouTubeLedgerSlots(date: string, youtubeLog: readonly unknown[]): number[] {
  const counts = new Map<number, number>();
  for (const entry of youtubeLog) {
    if (!isYouTubeUploadCandidate(entry) || entry.date !== date) continue;
    counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([slot]) => slot)
    .sort((left, right) => left - right);
}

/**
 * Reconcile source Reels and uploaded Shorts by slot, never by total count.
 * A completed upload for another slot must not hide a missing expected Short.
 */
export function reconcileReelShorts(
  date: string,
  posted: readonly PostLogEntry[],
  youtubeLog: readonly unknown[],
  verifiedYouTubeLog: readonly YouTubeLogEntry[] = []
): ReelShortReconciliation {
  assertPostedLogMatchesDate(date, posted);
  assertYouTubeLogEntries(youtubeLog);
  const expectedReelSlots = uniqueSorted(
    posted.filter(isQualifiedInstagramReel).map((entry) => entry.slot).filter(isValidSlot)
  );
  const expected = new Set(expectedReelSlots);
  const uploadCandidates = youtubeLog;
  const duplicateSlots = new Set(duplicateYouTubeLedgerSlots(date, youtubeLog));
  const verifiedKeys = new Set(
    verifiedYouTubeLog
      .filter(isYouTubeUploadCandidate)
      .map((entry) => `${entry.date}:${entry.slot}:${entry.video_id}`)
  );
  const uploadedReelSlots = uniqueSorted(
    uploadCandidates
      .filter(
        (entry) =>
          entry.date === date &&
          expected.has(entry.slot) &&
          !duplicateSlots.has(entry.slot) &&
          verifiedKeys.has(`${entry.date}:${entry.slot}:${entry.video_id}`)
      )
      .map((entry) => entry.slot)
  );
  const unexpectedYouTubeSlots = uniqueSorted(
    uploadCandidates
      .filter((entry) => entry.date !== date || !expected.has(entry.slot))
      .map((entry) => entry.slot)
  );
  const unverifiedYouTubeSlots = uniqueSorted(
    uploadCandidates
      .filter(
        (entry) =>
          entry.date === date &&
          (duplicateSlots.has(entry.slot) || !verifiedKeys.has(`${entry.date}:${entry.slot}:${entry.video_id}`))
      )
      .map((entry) => entry.slot)
  );

  return {
    expected_reel_slots: expectedReelSlots,
    uploaded_reel_slots: uploadedReelSlots,
    missing_reel_slots: expectedReelSlots.filter((slot) => !uploadedReelSlots.includes(slot)),
    unexpected_youtube_slots: unexpectedYouTubeSlots,
    unverified_youtube_slots: unverifiedYouTubeSlots
  };
}

async function sourceBindingForQualifiedInstagramReel(input: {
  date: string;
  slot: number;
  root: string;
  posted: readonly PostLogEntry[];
}): Promise<{ source?: YouTubeCompletionSourceBinding; reason?: string }> {
  const rows = input.posted.filter((entry) => entry.slot === input.slot && isQualifiedInstagramReel(entry));
  if (rows.length !== 1) {
    return { reason: `expected exactly one qualified Instagram Reel, found ${rows.length}` };
  }
  const row = rows[0];
  if (!row) return { reason: "qualified Instagram Reel selection failed" };
  const instagramVideoSha256 = normalizedSha256(row.video_sha256);
  const instagramPostId = nonEmptyString(row.post_id);
  if (!instagramVideoSha256 || !instagramPostId) {
    return { reason: "qualified Instagram Reel has no usable source hash or post id" };
  }
  const content = await loadDailyContent(input.date, input.root).catch(() => undefined);
  if (content?.tampered) {
    return { reason: "calendar integrity is marked tampered; current local MP4 and metadata binding are unavailable" };
  }
  const slot = content?.slots.find((candidate) => candidate.slot === input.slot);
  if (!slot?.local_video_path) {
    return { reason: "calendar has no local MP4 for this slot" };
  }
  try {
    const bytes = await readFile(join(input.root, ...slot.local_video_path.split("/")));
    const localVideoSha256 = createHash("sha256").update(bytes).digest("hex");
    if (localVideoSha256 !== instagramVideoSha256) {
      return { reason: "calendar local MP4 SHA-256 no longer matches the qualified Instagram Reel" };
    }
    return {
      source: {
        local_video_path: slot.local_video_path,
        local_video_sha256: localVideoSha256,
        instagram_video_sha256: instagramVideoSha256,
        instagram_post_id: instagramPostId
      }
    };
  } catch (error) {
    return {
      reason: `calendar local MP4 cannot be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/** Read-only on-disk reconciliation for scheduled monitors and human checks. */
export async function inspectReelShortReconciliation(input: {
  date: string;
  root?: string;
}): Promise<ReelShortReconciliation> {
  const root = projectRoot(input.root);
  const [rawPosted, rawYouTubeLog] = await Promise.all([
    readJsonFile<unknown>(join(root, "data", "posted-log", `${input.date}.json`), []),
    readJsonFile<unknown>(join(root, "data", "youtube-log", `${input.date}.json`), [])
  ]);
  assertPostedLogMatchesDate(input.date, rawPosted);
  assertYouTubeLogEntries(rawYouTubeLog);
  const duplicateSlots = duplicateYouTubeLedgerSlots(input.date, rawYouTubeLog);
  if (duplicateSlots.length > 0) {
    throw new Error(
      `Unverified YouTube ledger entries for ${input.date} slots ${duplicateSlots.join(", ")}: duplicate same-date same-slot ledger entries; it is a data gap, not an uploaded Short, and automatic reupload is blocked.`
    );
  }
  const verified: YouTubeLogEntry[] = [];
  for (const entry of rawYouTubeLog) {
    if (entry.date !== input.date) continue;
    const binding = await sourceBindingForQualifiedInstagramReel({
      date: input.date,
      slot: entry.slot,
      root,
      posted: rawPosted
    });
    if (!binding.source) {
      throw new Error(
        `Unverified YouTube ledger entry for ${input.date} slot ${entry.slot}: ${binding.reason ?? "source binding missing"}; it is a data gap, not an uploaded Short, and automatic reupload is blocked.`
      );
    }
    const proof = await verifyYouTubeCompletionEvidence({
      date: input.date,
      slot: entry.slot,
      root,
      entry,
      source: binding.source
    });
    if (!proof.verified) {
      throw new Error(
        `Unverified YouTube ledger entry for ${input.date} slot ${entry.slot}: ${proof.reason ?? "immutable completion proof missing"}; it is a data gap, not an uploaded Short, and automatic reupload is blocked.`
      );
    }
    verified.push(entry);
  }
  return reconcileReelShorts(input.date, rawPosted, rawYouTubeLog, verified);
}

/**
 * Assess only slots whose calendar explicitly promises a Reel. Mixed carousels
 * may legally fall back to images, so counting them here would manufacture a
 * video obligation that the publishing contract does not make.
 */
export async function assessPlannedReelReadiness(input: {
  date: string;
  root: string;
  slots: readonly DailySlot[];
  validateReel?: typeof validatePublishableReel;
  inspectVisualQa?: typeof warnVisualQaForPublish;
}): Promise<PlannedReelReadiness> {
  const required = input.slots.filter((slot) => slot.media_type === "reel");
  if (required.length === 0) {
    return { status: "not_planned", required_reel_slots: [], ready_reel_slots: [], blocked_reels: [] };
  }

  const validateReel = input.validateReel ?? validatePublishableReel;
  const inspectVisualQa = input.inspectVisualQa ?? warnVisualQaForPublish;
  const ready: number[] = [];
  const blocked: Array<{ slot: number; reason: string }> = [];
  for (const slot of required) {
    try {
      await validateReel(slot, input.date, input.root);
      // Publishing remains in calibrated warning mode, but a future-day
      // readiness signal must not call a missing/failed visual review "ready".
      // This turns the warning into an explicit gate only at the planning edge.
      const visualQa = await inspectVisualQa({
        date: input.date,
        slot: slot.slot,
        videoPath: slot.local_video_path ?? "",
        root: input.root
      });
      if (!visualQa.ok) {
        throw new Error(`Visual QA gate is not passed for slot ${slot.slot}: ${visualQa.reason}`);
      }
      ready.push(slot.slot);
    } catch (error) {
      blocked.push({ slot: slot.slot, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    status: blocked.length === 0 ? "ready" : "blocked",
    required_reel_slots: uniqueSorted(required.map((slot) => slot.slot)),
    ready_reel_slots: uniqueSorted(ready),
    blocked_reels: blocked.sort((left, right) => left.slot - right.slot)
  };
}

/** Read-only future-day Reel readiness. It runs the same publish gate, not a file-exists approximation. */
export async function inspectPlannedReelReadiness(input: {
  date: string;
  root?: string;
}): Promise<PlannedReelReadiness> {
  const root = projectRoot(input.root);
  const content = await loadDailyContent(input.date, root).catch(() => null);
  if (!content) {
    return { status: "calendar_missing", required_reel_slots: [], ready_reel_slots: [], blocked_reels: [] };
  }
  if (content.tampered) {
    const required = uniqueSorted(
      content.slots.filter((slot) => slot.media_type === "reel").map((slot) => slot.slot)
    );
    const reason = "calendar integrity is marked tampered; planned Reel readiness is blocked before media and visual QA";
    return {
      status: "blocked",
      required_reel_slots: required,
      ready_reel_slots: [],
      blocked_reels: required.map((slot) => ({ slot, reason }))
    };
  }
  return assessPlannedReelReadiness({ date: input.date, root, slots: content.slots });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  if (!date) throw new Error("--date is required.");
  const root = getOption(args, "root");
  const result = getFlag(args, "reel-readiness")
    ? await inspectPlannedReelReadiness({ date, root })
    : await inspectReelShortReconciliation({ date, root });
  console.log(JSON.stringify(result));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
