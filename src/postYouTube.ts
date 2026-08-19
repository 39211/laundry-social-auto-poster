import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { loadAbTestPlan, planForDate, planSlot } from "./abTestPlan";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import {
  loadDailyContent,
  loadPostLog,
  readJsonFile,
  withJsonFileLock,
  writeJsonAtomic,
  type JsonFileLockOptions
} from "./logging";
import { projectRoot } from "./paths";
import {
  assertPostedLogMatchesDate,
  assertYouTubeLogEntries,
  isQualifiedInstagramReel,
  loadCanonicalYouTubeChannelId,
  verifyYouTubeCompletionEvidence,
  type YouTubeCompletionSourceBinding,
  type YouTubeLogEntry
} from "./publishingReconciliation";
import { assertCanonicalPublicPublicationApproval } from "./publicPublicationApproval";
import { getZonedDateParts } from "./scheduler";
import { NonRetryableError } from "./retry";
import { utmCampaign, utmTagged } from "./utm";

// Uploads the day's published Reel to YouTube as a Short. The owner asked for
// every Reel to reach YouTube as well; FB/IG stay the primary chain and this
// runs after them, off its own schedule, so a YouTube fault can never block
// the Meta publishing that the 90-day programme is measured on.
//
// Credentials are the owner's: a one-time OAuth consent via `youtube-auth`
// writes the refresh token straight into .env without it ever passing through
// chat. Every upload declares altered/synthetic content, matching the C2PA
// stance on the images — the account never pretends generated footage is
// camera footage.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status";
const VIDEO_LOOKUP_URL = "https://www.googleapis.com/youtube/v3/videos";
const CHANNEL_LOOKUP_URL = "https://www.googleapis.com/youtube/v3/channels";
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_UPLOAD_AND_READ_SCOPE = `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_READ_SCOPE}`;
type YouTubeLockTimingOptions = Pick<JsonFileLockOptions, "timeoutMs" | "staleMs">;

/**
 * An old lock might be a stalled process that already sent the irreversible
 * YouTube POST. Never reclaim it automatically: holding the work for manual
 * recovery is safer than sending a duplicate Short.
 */
function withYouTubeUploadLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  timingOptions?: YouTubeLockTimingOptions
): Promise<T> {
  return withJsonFileLock(filePath, operation, {
    ...timingOptions,
    stalePolicy: "fail"
  });
}

function credentials(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string; refreshToken: string } | undefined {
  const clientId = env.YT_CLIENT_ID;
  const clientSecret = env.YT_CLIENT_SECRET;
  const refreshToken = env.YT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return undefined;
  return { clientId, clientSecret, refreshToken };
}

async function accessToken(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const creds = credentials(env);
  if (!creds) throw new Error("YouTube credentials are not configured; run npm run youtube-auth first.");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`YouTube token refresh failed: ${payload.error_description ?? response.status}`);
  }
  return payload.access_token;
}

/** Title and description come from the day's own copy, not a new voice. */
export function buildShortMetadata(input: { topic: string; caption: string; date: string; slot?: number }): {
  title: string;
  description: string;
} {
  // YouTube titles cap at 100 characters; the hook is already short. #Shorts
  // in title or description is what routes the upload into the Shorts shelf.
  // The geo suffix is what YouTube/Google video search matches for "台中洗鞋"
  // queries — the bare hook alone carries no locality at all.
  const geoSuffix = /[鞋包靴]/.test(input.topic) ? "台中洗鞋洗包 免費收送" : "台中洗衣店 免費收送";
  const title = `${input.topic}`.slice(0, 70) + `｜${geoSuffix} #Shorts`;
  // AI answer engines quote YouTube descriptions, so the first line has to
  // stand alone as a fact rather than continue the video, and the link has to
  // land on the page that answers this topic. A generic home-page link gives a
  // reader nowhere to go and gives a crawler no topical connection.
  const campaign = utmCampaign(input.date, input.slot ?? 2, "reel");
  const tracking = { source: "youtube" as const, campaign };
  const deepLink = utmTagged(guideLinkFor(input.topic), tracking);
  const lineUrl = utmTagged(`${SITE}/go/line.html?source=yt`, tracking);
  const description = [
    `台中西屯的私享家洗衣店在處理${topicObject(input.topic)}時的判斷方式;台中市全區免費到府收送,清潔費另依物件判斷。`,
    input.caption.split("\n\n").slice(0, 3).join("\n\n"),
    priceLineFor(input.topic),
    "門市:台中市西屯區青海路二段365號(至善國中對面)｜LINE 傳照片先估:0968327653",
    `一鍵加 LINE:${lineUrl}`,
    "儲值優惠:滿1000送100、儲3000送400、儲6000送1000",
    `這個主題的完整說明:${deepLink}`,
    "#Shorts #台中洗衣店 #台中洗鞋 #西屯洗鞋 #逢甲洗鞋 #洗包"
  ]
    .filter(Boolean)
    .join("\n\n");
  return { title, description };
}

const SITE = "https://39211.github.io";

/** Public price for the topic's object family; empty when it is ambiguous. */
function priceLineFor(topic: string): string {
  const families = [/鞋|靴/, /包|袋/, /衣|裝|衫|服/, /被|床|寢|毯|枕/].filter((f) => f.test(topic));
  if (families.length !== 1) return "";
  if (/白鞋|球鞋|運動鞋|帆布/.test(topic)) return "參考價:一般運動鞋 $250、皮類運動鞋 $300(水洗價)";
  if (/皮鞋|靴/.test(topic)) return "參考價:皮鞋 $400、低靴 $350、高靴 $550(水洗價)";
  if (/書包|背包/.test(topic)) return "參考價:背包 $500(水洗價)";
  if (/包|袋/.test(topic)) return "參考價:一般包 $600、皮包 $1000、名牌包 $1500(水洗價)";
  if (/皮衣/.test(topic)) return "參考價:皮衣 $1200、特殊皮衣 $2000";
  if (/襯衫|制服/.test(topic)) return "參考價:襯衫 $70、整燙 $50(水洗價)";
  if (/西裝|大衣|外套/.test(topic)) return "參考價:長大衣 $300、羽絨外套 $280(水洗價,乾洗另計)";
  if (/被|床|寢|毯|枕/.test(topic)) return "參考價:棉被單人 $350、雙人 $500、羽絨羊毛被 $800(水洗價)";
  return "";
}

/** Deep link to the page that answers this topic, not the site root. */
export function guideLinkFor(topic: string): string {
  if (/白鞋|泛黃/.test(topic)) return `${SITE}/guides/white-shoe-yellowing.html`;
  if (/雨|淋濕|進水/.test(topic)) return `${SITE}/guides/rainy-shoe-care.html`;
  if (/鞋|靴/.test(topic)) return `${SITE}/services/white-shoe-cleaning.html`;
  if (/行李箱|行李/.test(topic)) return `${SITE}/guides/bag-handle-cleaning.html`;
  if (/包|提把|包角|背包/.test(topic)) return `${SITE}/guides/bag-handle-cleaning.html`;
  if (/皮衣|皮革|發霉/.test(topic)) return `${SITE}/guides/leather-jacket-care.html`;
  if (/羽絨/.test(topic)) return `${SITE}/guides/down-jacket-cleaning.html`;
  if (/西裝|襯衫|肩線|領口/.test(topic)) return `${SITE}/guides/shirt-suit-dry-cleaning.html`;
  if (/棉被|寢具|床組|被單|枕/.test(topic)) return `${SITE}/guides/bedding-duvet-cleaning.html`;
  if (/窗簾|沙發|布品|收納/.test(topic)) return `${SITE}/services/fabric-storage.html`;
  if (/娃娃|絨毛|玩偶/.test(topic)) return `${SITE}/guides/plush-doll-cleaning.html`;
  if (/乾洗/.test(topic)) return `${SITE}/guides/dry-cleaning-guide.html`;
  return `${SITE}/services/taichung-xitun-laundry.html`;
}

function topicObject(topic: string): string {
  const match = topic.match(/^[^，,。:：]{2,8}/);
  return match ? match[0] : "衣物";
}

/** Legacy date-array record written before per-slot remote claims existed. */
interface LegacyYouTubeUploadIntent {
  date: string;
  slot: number;
  state: "pending_remote_commit" | "remote_accepted_log_failed";
  created_at: string;
  remote_video_id?: string;
  error?: string;
}

export interface YouTubeRemoteClaim {
  version: 1;
  date: string;
  slot: number;
  claim_id: string;
  claimed_at: string;
  source: {
    local_video_path: string;
    local_video_sha256: string;
    instagram_post_id: string;
    instagram_video_sha256: string;
  };
  /** Bound by the same-token owner-channel preflight before any upload POST. */
  channel?: {
    expected_channel_id: string;
    authorized_channel_id: string;
  };
}

interface YouTubeUploadEvidence {
  version: 1;
  date: string;
  slot: number;
  claim_id: string;
  state:
    | "preflight_passed"
    | "remote_response_uncertain"
    | "remote_accepted_log_failed"
    | "completed"
    | "ledger_present_after_claim";
  recorded_at: string;
  remote_video_id?: string;
  /** Set only after the same-token videos.list identity/metadata/public read-back succeeds. */
  read_back_verified?: true;
  channel?: {
    expected_channel_id: string;
    authorized_channel_id: string;
  };
  error?: string;
}

function legacyUploadIntentPath(date: string, root: string): string {
  return join(root, "data", "youtube-upload-intents", `${date}.json`);
}

function slotRecordPath(directory: string, date: string, slot: number, root: string): string {
  return join(root, "data", directory, date, `slot-${String(slot).padStart(2, "0")}.json`);
}

function remoteClaimPath(date: string, slot: number, root: string): string {
  return slotRecordPath("youtube-upload-claims", date, slot, root);
}

function uploadEvidencePath(date: string, slot: number, root: string): string {
  return slotRecordPath("youtube-upload-evidence", date, slot, root);
}

function preflightEvidencePath(claim: YouTubeRemoteClaim, root: string): string {
  return join(
    root,
    "data",
    "youtube-upload-preflights",
    claim.date,
    `slot-${String(claim.slot).padStart(2, "0")}-${claim.claim_id}.json`
  );
}

function isLegacyYouTubeUploadIntent(value: unknown): value is LegacyYouTubeUploadIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<LegacyYouTubeUploadIntent>;
  return (
    typeof intent.date === "string" &&
    intent.date.trim().length > 0 &&
    typeof intent.slot === "number" &&
    Number.isInteger(intent.slot) &&
    intent.slot > 0 &&
    (intent.state === "pending_remote_commit" || intent.state === "remote_accepted_log_failed") &&
    typeof intent.created_at === "string" &&
    intent.created_at.trim().length > 0 &&
    (intent.remote_video_id === undefined || typeof intent.remote_video_id === "string") &&
    (intent.error === undefined || typeof intent.error === "string")
  );
}

async function assertNoLegacyYouTubeIntentForSlot(input: {
  date: string;
  slot: number;
  root: string;
}): Promise<void> {
  const raw = await readJsonFile<unknown | undefined>(legacyUploadIntentPath(input.date, input.root), undefined);
  if (raw === undefined) return;
  if (
    !Array.isArray(raw) ||
    raw.some((intent) => !isLegacyYouTubeUploadIntent(intent) || intent.date !== input.date)
  ) {
    throw new NonRetryableError(
      `Legacy date-scoped youtube-upload-intents for ${input.date} is malformed; automatic migration is refused.`
    );
  }
  const matching = raw.find((intent) => intent.slot === input.slot);
  if (matching) {
    const remote = matching.remote_video_id ? ` (remote video ${matching.remote_video_id})` : "";
    throw new NonRetryableError(
      `Legacy date-scoped YouTube intent exists for ${input.date} slot ${input.slot}${remote}; automatic migration and retry are blocked pending recovery.`
    );
  }
}

function isYouTubeRemoteClaim(value: unknown, date: string, slot: number): value is YouTubeRemoteClaim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Partial<YouTubeRemoteClaim>;
  const source = claim.source;
  return (
    claim.version === 1 &&
    claim.date === date &&
    claim.slot === slot &&
    typeof claim.claim_id === "string" &&
    claim.claim_id.trim().length > 0 &&
    typeof claim.claimed_at === "string" &&
    !Number.isNaN(Date.parse(claim.claimed_at)) &&
    !!source &&
    typeof source === "object" &&
    typeof source.local_video_path === "string" &&
    source.local_video_path.trim().length > 0 &&
    normalizedSha256(source.local_video_sha256) === source.local_video_sha256 &&
    typeof source.instagram_post_id === "string" &&
    source.instagram_post_id.trim().length > 0 &&
    normalizedSha256(source.instagram_video_sha256) === source.instagram_video_sha256
  );
}

async function loadYouTubeRemoteClaim(input: {
  date: string;
  slot: number;
  root: string;
}): Promise<YouTubeRemoteClaim | undefined> {
  const path = remoteClaimPath(input.date, input.slot, input.root);
  const raw = await readJsonFile<unknown | undefined>(path, undefined);
  if (raw === undefined) return undefined;
  if (!isYouTubeRemoteClaim(raw, input.date, input.slot)) {
    throw new NonRetryableError(
      `Immutable YouTube remote claim for ${input.date} slot ${input.slot} is malformed; automatic retry is blocked pending recovery.`
    );
  }
  return raw;
}

function buildYouTubeRemoteClaim(input: {
  date: string;
  slot: number;
  now: Date;
  localVideoPath: string;
  localVideoSha256: string;
  instagramPostId: string;
  instagramVideoSha256: string;
  expectedChannelId: string;
  authorizedChannelId: string;
}): YouTubeRemoteClaim {
  return {
    version: 1,
    date: input.date,
    slot: input.slot,
    claim_id: randomUUID(),
    claimed_at: input.now.toISOString(),
    source: {
      local_video_path: input.localVideoPath,
      local_video_sha256: input.localVideoSha256,
      instagram_post_id: input.instagramPostId,
      instagram_video_sha256: input.instagramVideoSha256
    },
    channel: {
      expected_channel_id: input.expectedChannelId,
      authorized_channel_id: input.authorizedChannelId
    }
  };
}

async function createYouTubeRemoteClaim(input: {
  root: string;
  claim: YouTubeRemoteClaim;
}): Promise<void> {
  const path = remoteClaimPath(input.claim.date, input.claim.slot, input.root);
  try {
    // This is the remote-side-effect authority. Do not substitute a JSON lock,
    // overwrite it, or clear it after success: any later automatic caller must
    // observe the same date+slot claim and make zero additional POSTs.
    await writeFile(path, `${JSON.stringify(input.claim, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new NonRetryableError(
        `Immutable YouTube remote claim already exists for ${input.claim.date} slot ${input.claim.slot}; automatic retry is blocked pending recovery.`
      );
    }
    throw error;
  }
}

/** Create the claim directory during preflight so `wx` is the last local step before POST. */
async function prepareYouTubeRemoteClaimDirectory(input: { root: string; date: string }): Promise<void> {
  await mkdir(join(input.root, "data", "youtube-upload-claims", input.date), { recursive: true });
}

async function recordYouTubeUploadEvidence(input: {
  claim: YouTubeRemoteClaim;
  state: YouTubeUploadEvidence["state"];
  now: Date;
  root: string;
  writeJson: typeof writeJsonAtomic;
  lockOptions?: YouTubeLockTimingOptions;
  remoteVideoId?: string;
  error?: unknown;
}): Promise<void> {
  const path = uploadEvidencePath(input.claim.date, input.claim.slot, input.root);
  const error = input.error instanceof Error ? input.error.message : input.error === undefined ? undefined : String(input.error);
  const evidence: YouTubeUploadEvidence = {
    version: 1,
    date: input.claim.date,
    slot: input.claim.slot,
    claim_id: input.claim.claim_id,
    state: input.state,
    recorded_at: input.now.toISOString(),
    ...(input.remoteVideoId ? { remote_video_id: input.remoteVideoId } : {}),
    ...(input.state === "completed" ? { read_back_verified: true as const } : {}),
    ...(input.claim.channel ? { channel: input.claim.channel } : {}),
    ...(error ? { error } : {})
  };
  // This short-lived lock only serializes mutable local evidence. The immutable
  // claim above remains the sole authority for whether a remote POST may occur.
  await withYouTubeUploadLock(path, async () => {
    await input.writeJson(path, evidence);
  }, input.lockOptions);
}

/**
 * Pre-claim evidence must not share the canonical slot evidence file: a losing
 * concurrent caller has a different claim id and must never overwrite the
 * winner's completed read-back proof.
 */
async function recordYouTubePreflightEvidence(input: {
  claim: YouTubeRemoteClaim;
  now: Date;
  root: string;
  writeJson: typeof writeJsonAtomic;
  lockOptions?: YouTubeLockTimingOptions;
}): Promise<void> {
  const path = preflightEvidencePath(input.claim, input.root);
  const evidence: YouTubeUploadEvidence = {
    version: 1,
    date: input.claim.date,
    slot: input.claim.slot,
    claim_id: input.claim.claim_id,
    state: "preflight_passed",
    recorded_at: input.now.toISOString(),
    ...(input.claim.channel ? { channel: input.claim.channel } : {})
  };
  await withYouTubeUploadLock(path, async () => {
    await input.writeJson(path, evidence);
  }, input.lockOptions);
}

async function appendCompletedYouTubeLog(input: {
  entry: YouTubeLogEntry;
  root: string;
  writeJson: typeof writeJsonAtomic;
  lockOptions?: YouTubeLockTimingOptions;
}): Promise<void> {
  const path = join(input.root, "data", "youtube-log", `${input.entry.date}.json`);
  await withYouTubeUploadLock(path, async () => {
    const entries = await readJsonFile<unknown>(path, []);
    assertYouTubeLogEntries(entries);
    if (entries.some((item) => item.date === input.entry.date && item.slot === input.entry.slot)) {
      throw new NonRetryableError(
        `YouTube log already has ${input.entry.date} slot ${input.entry.slot}; remote result requires manual reconciliation.`
      );
    }
    await input.writeJson(path, [...entries, input.entry]);
  }, input.lockOptions);
}

function asTrimmedNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function remoteErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0 ? message : undefined;
}

function normalizedSha256(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

/** Build the consent URL separately so the exact scope contract stays testable. */
export function buildYouTubeConsentUrl(input: { clientId: string; port: number }): URL {
  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("client_id", input.clientId);
  consent.searchParams.set("redirect_uri", `http://127.0.0.1:${input.port}`);
  consent.searchParams.set("response_type", "code");
  // A Short is only complete after videos.list verifies the remote object. The
  // existing upload-only refresh token cannot grant this new read scope; the
  // owner must complete a fresh consent before a production smoke is allowed.
  consent.searchParams.set("scope", YOUTUBE_UPLOAD_AND_READ_SCOPE);
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");
  return consent;
}

/**
 * The upload response only means Google accepted the multipart request. Before
 * the local ledger is allowed to call it complete, read the resource back with
 * the same OAuth token and bind its identity, owner channel, and public
 * metadata exactly.
 */
async function verifyUploadedVideoReadBack(input: {
  videoId: string;
  title: string;
  description: string;
  expectedChannelId: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const url = new URL(VIDEO_LOOKUP_URL);
  url.searchParams.set("part", "snippet,status");
  url.searchParams.set("id", input.videoId);

  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.token}` }
    });
    payload = await response.json();
  } catch (error) {
    throw new NonRetryableError(
      `YouTube read-back is uncertain for ${input.videoId}; automatic retry is blocked pending recovery.`,
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new NonRetryableError(
      `YouTube read-back response (${response.status}) is uncertain for ${input.videoId}; automatic retry is blocked pending recovery.`
    );
  }

  const items = payload && typeof payload === "object" ? (payload as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) {
    throw new NonRetryableError(
      `YouTube read-back for ${input.videoId} has no verifiable video item; automatic retry is blocked pending recovery.`
    );
  }

  const remote = items.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === input.videoId);
  if (!remote || typeof remote !== "object") {
    throw new NonRetryableError(
      `YouTube read-back did not return uploaded video ${input.videoId}; automatic retry is blocked pending recovery.`
    );
  }

  const snippet = (remote as { snippet?: unknown }).snippet;
  const status = (remote as { status?: unknown }).status;
  const remoteTitle = snippet && typeof snippet === "object" ? (snippet as { title?: unknown }).title : undefined;
  const remoteDescription = snippet && typeof snippet === "object" ? (snippet as { description?: unknown }).description : undefined;
  const remoteChannelId = snippet && typeof snippet === "object" ? asTrimmedNonEmptyString((snippet as { channelId?: unknown }).channelId) : undefined;
  const privacyStatus = status && typeof status === "object" ? (status as { privacyStatus?: unknown }).privacyStatus : undefined;
  if (
    remoteTitle !== input.title ||
    remoteDescription !== input.description ||
    privacyStatus !== "public"
  ) {
    throw new NonRetryableError(
      `YouTube read-back metadata or public visibility does not match ${input.videoId}; automatic retry is blocked pending recovery.`
    );
  }
  if (remoteChannelId !== input.expectedChannelId) {
    throw new NonRetryableError(
      `YouTube read-back channel does not match canonical business channel for ${input.videoId}; automatic retry is blocked pending recovery.`
    );
  }
}

/**
 * Prove that this refreshed token can make the read call required after upload
 * before creating the irreversible claim. `channels.list` formally supports
 * `mine=true`; `part=id&maxResults=1` deliberately reads only one owner channel
 * ID, rather than channel metadata, videos, comments, or media bytes.
 */
async function verifyYouTubeReadScopePreflight(input: {
  token: string;
  fetchImpl: typeof fetch;
  expectedChannelId: string;
}): Promise<string> {
  const url = new URL(CHANNEL_LOOKUP_URL);
  url.searchParams.set("part", "id");
  url.searchParams.set("mine", "true");
  url.searchParams.set("maxResults", "1");

  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.token}` }
    });
    payload = await response.json();
  } catch (error) {
    throw new NonRetryableError(
      "YouTube read-scope preflight is uncertain; no immutable claim or upload POST was made. Re-authorize with youtube.readonly before retrying.",
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new NonRetryableError(
      `YouTube read-scope preflight response (${response.status}) did not prove owner read access; no immutable claim or upload POST was made. Re-authorize with youtube.readonly before retrying.`
    );
  }

  const items = payload && typeof payload === "object" ? (payload as { items?: unknown }).items : undefined;
  const authorizedChannelId = Array.isArray(items)
    ? items
        .map((item) => (item && typeof item === "object" ? asTrimmedNonEmptyString((item as { id?: unknown }).id) : undefined))
        .find((id) => id === input.expectedChannelId)
    : undefined;
  if (!authorizedChannelId) {
    throw new NonRetryableError(
      `YouTube read-scope preflight did not include canonical business channel ${input.expectedChannelId}; no immutable claim or upload POST was made. Re-authorize the correct channel with youtube.readonly before retrying.`
    );
  }
  return authorizedChannelId;
}

async function assertExistingLedgerCompletion(input: {
  date: string;
  slot: number;
  root: string;
  entry: YouTubeLogEntry;
  source: YouTubeCompletionSourceBinding;
  expectedChannelId: string;
}): Promise<void> {
  const claim = await loadYouTubeRemoteClaim({ date: input.date, slot: input.slot, root: input.root });
  if (
    !claim?.channel ||
    claim.channel.expected_channel_id !== input.expectedChannelId ||
    claim.channel.authorized_channel_id !== input.expectedChannelId
  ) {
    throw unverifiedExistingLedgerError(
      input.date,
      input.slot,
      "immutable claim does not bind the canonical business YouTube channel"
    );
  }
  const proof = await verifyYouTubeCompletionEvidence(input);
  if (!proof.verified) {
    throw unverifiedExistingLedgerError(input.date, input.slot, proof.reason ?? "proof missing");
  }
}

function unverifiedExistingLedgerError(date: string, slot: number, reason: string): NonRetryableError {
  return new NonRetryableError(
    `YouTube ledger entry for ${date} slot ${slot} lacks immutable verified completion proof: ${reason}; it is a data gap, not an uploaded Short, and automatic reupload is blocked.`
  );
}

/**
 * YouTube is public release, not a best-effort copy of a posted-log row.
 *
 * The shared release gate binds the stamped calendar, one non-forced approval
 * on both primary platforms, the approved slot fingerprint and image digests,
 * plus the current Reel source/review SHA-256.  Keep this here (rather than
 * relying on a scheduler preflight) so direct CLI callers cannot bypass it.
 */
async function assertCanonicalYouTubePublicationApproval(input: {
  date: string;
  slot: number;
  root: string;
}): Promise<void> {
  try {
    await assertCanonicalPublicPublicationApproval(input.date, input.root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new NonRetryableError(
      `Canonical public approval is required for YouTube ${input.date} slot ${input.slot}: ${detail}. ` +
        "No OAuth refresh, immutable claim, or upload POST was made.",
      { cause: error }
    );
  }
}

/** Re-read the mutable source tuple immediately before the first OAuth request. */
async function assertYouTubeSourceBindingStillCurrent(input: {
  date: string;
  slot: number;
  root: string;
  source: YouTubeCompletionSourceBinding;
}): Promise<void> {
  await assertCanonicalYouTubePublicationApproval(input);

  const [content, posted] = await Promise.all([
    loadDailyContent(input.date, input.root),
    loadPostLog(input.date, input.root)
  ]);
  if (!content || content.tampered) {
    throw new NonRetryableError(
      `Calendar integrity for ${input.date} is unavailable or tampered before YouTube OAuth; no immutable claim or upload POST was made.`
    );
  }
  const slots = content.slots.filter((candidate) => candidate.slot === input.slot);
  if (slots.length !== 1 || slots[0]?.media_type !== "reel" || slots[0].local_video_path !== input.source.local_video_path) {
    throw new NonRetryableError(
      `Calendar Reel binding changed for ${input.date} slot ${input.slot} before YouTube OAuth; no immutable claim or upload POST was made.`
    );
  }
  const currentVideoSha256 = createHash("sha256")
    .update(await readFile(join(input.root, ...input.source.local_video_path.split("/"))))
    .digest("hex");
  if (currentVideoSha256 !== input.source.local_video_sha256) {
    throw new NonRetryableError(
      `Local Reel SHA-256 changed for ${input.date} slot ${input.slot} before YouTube OAuth; no immutable claim or upload POST was made.`
    );
  }

  assertPostedLogMatchesDate(input.date, posted);
  const qualifiedRows = posted.filter(
    (entry) => entry.slot === input.slot && isQualifiedInstagramReel(entry)
  );
  if (qualifiedRows.length !== 1) {
    throw new NonRetryableError(
      `Qualified Instagram Reel source changed or became ambiguous for ${input.date} slot ${input.slot}; no immutable claim or upload POST was made.`
    );
  }
  const current = qualifiedRows[0]!;
  if (
    normalizedSha256(current.video_sha256) !== input.source.instagram_video_sha256 ||
    asTrimmedNonEmptyString(current.post_id) !== input.source.instagram_post_id
  ) {
    throw new NonRetryableError(
      `Qualified Instagram Reel source binding changed for ${input.date} slot ${input.slot}; no immutable claim or upload POST was made.`
    );
  }
}

function singleCompletedLedgerEntryForTuple(input: {
  entries: readonly YouTubeLogEntry[];
  date: string;
  slot: number;
}): YouTubeLogEntry | undefined {
  const matching = input.entries.filter((entry) => entry.date === input.date && entry.slot === input.slot);
  if (matching.length > 1) {
    throw unverifiedExistingLedgerError(
      input.date,
      input.slot,
      "duplicate same-date same-slot ledger entries"
    );
  }
  return matching[0];
}

export async function uploadShort(input: {
  date: string;
  slot?: number;
  root?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  writeJson?: typeof writeJsonAtomic;
  /** Test-only timing seam; production always keeps the fail-closed stale policy. */
  lockOptions?: YouTubeLockTimingOptions;
  /** Test seam used to exercise the stale-read/claim race without real I/O delays. */
  beforeClaim?: () => Promise<void>;
  /** Read-only completion proof for the scheduler; it can never upload or claim. */
  verifyOnly?: boolean;
  /** Test-only dependency seam for failures after the irreversible remote POST. */
  loadAbTestPlan?: typeof loadAbTestPlan;
}): Promise<YouTubeLogEntry | { skipped: string }> {
  const root = projectRoot(input.root);
  const slotNumber = input.slot ?? 2;
  const fetchImpl = input.fetchImpl ?? fetch;
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const writeJson = input.writeJson ?? writeJsonAtomic;
  const loadAbPlan = input.loadAbTestPlan ?? loadAbTestPlan;

  const logPath = join(root, "data", "youtube-log", `${input.date}.json`);
  const existingRemoteClaim = await loadYouTubeRemoteClaim({ date: input.date, slot: slotNumber, root });
  const existing = await readJsonFile<unknown>(logPath, []);
  assertYouTubeLogEntries(existing);
  const completedExistingEntry = singleCompletedLedgerEntryForTuple({
    entries: existing,
    date: input.date,
    slot: slotNumber
  });
  const conflictingEntry = existing.find((entry) => entry.slot === slotNumber && entry.date !== input.date);
  if (conflictingEntry) {
    throw new Error(
      `YouTube log date mismatch for slot ${slotNumber}: expected ${input.date}, found ${String(conflictingEntry.date)}.`
    );
  }
  // The old date-array state is not safe idempotency authority. Check it even
  // when credentials or an IG source are absent, so a stale tuple is explicit
  // uncertainty rather than an innocuous-looking skip.
  await assertNoLegacyYouTubeIntentForSlot({ date: input.date, slot: slotNumber, root });
  // YouTube is a secondary shelf: never upload a Short before the same date+slot
  // Reel is live on Instagram. Dry-run and non-reel Meta posts do not open the gate.
  const posted = await loadPostLog(input.date, root);
  assertPostedLogMatchesDate(input.date, posted);

  // Run the single public-release authority before any existing row, source
  // branch, credential read, claim, or network step can look actionable.
  await assertCanonicalYouTubePublicationApproval({ date: input.date, slot: slotNumber, root });

  const content = await loadDailyContent(input.date, root);
  if (content?.tampered) {
    const reason = "calendar integrity is marked tampered; current local MP4 and metadata binding are unavailable";
    if (completedExistingEntry) {
      throw unverifiedExistingLedgerError(input.date, slotNumber, reason);
    }
    throw new NonRetryableError(
      `Calendar integrity for ${input.date} is marked tampered; current local MP4 and metadata binding are unavailable. No OAuth refresh, immutable claim, or upload POST was made. Rebuild the calendar before manual recovery.`
    );
  }
  if (!content) {
    if (completedExistingEntry) {
      throw unverifiedExistingLedgerError(input.date, slotNumber, "calendar local MP4 source binding is unavailable");
    }
    throw new NonRetryableError(
      `Calendar is missing for ${input.date} slot ${slotNumber}; no OAuth refresh, immutable claim, or upload POST was made.`
    );
  }
  const calendarSlots = content.slots.filter((item) => item.slot === slotNumber);
  if (calendarSlots.length !== 1 || calendarSlots[0]?.media_type !== "reel" || !calendarSlots[0].local_video_path) {
    if (completedExistingEntry) {
      throw unverifiedExistingLedgerError(
        input.date,
        slotNumber,
        "canonical calendar has no unique current Reel MP4 binding"
      );
    }
    throw new NonRetryableError(
      `Canonical calendar has no unique current Reel MP4 binding for ${input.date} slot ${slotNumber}; no OAuth refresh, immutable claim, or upload POST was made.`
    );
  }
  const slot = calendarSlots[0]!;
  const localVideoPath = slot.local_video_path;
  // The branch above proves this, but retaining a local non-optional binding
  // keeps every subsequent source/claim field tied to the same checked path.
  if (!localVideoPath) {
    throw new NonRetryableError(
      `Canonical calendar Reel MP4 path disappeared for ${input.date} slot ${slotNumber}; no OAuth refresh, immutable claim, or upload POST was made.`
    );
  }

  if (existingRemoteClaim && !completedExistingEntry) {
    throw new NonRetryableError(
      `Immutable YouTube remote claim ${existingRemoteClaim.claim_id} exists for ${input.date} slot ${slotNumber}; automatic retry is blocked pending recovery.`
    );
  }

  const qualifiedInstagramRows = posted.filter(
    (entry) => entry.slot === slotNumber && isQualifiedInstagramReel(entry)
  );
  if (qualifiedInstagramRows.length === 0) {
    if (completedExistingEntry) {
      throw unverifiedExistingLedgerError(
        input.date,
        slotNumber,
        "the qualified Instagram Reel source binding is unavailable"
      );
    }
    return {
      skipped: `no qualified IG Reel with verified video_sha256 for ${input.date} slot ${slotNumber}; YouTube waits for Instagram`
    };
  }
  if (qualifiedInstagramRows.length !== 1) {
    if (completedExistingEntry) {
      throw unverifiedExistingLedgerError(
        input.date,
        slotNumber,
        `expected exactly one qualified Instagram Reel source, found ${qualifiedInstagramRows.length}`
      );
    }
    throw new NonRetryableError(
      `Multiple qualified IG Reels exist for ${input.date} slot ${slotNumber}; YouTube cannot bind one approved video and will not upload.`
    );
  }
  const qualifiedInstagramRow = qualifiedInstagramRows[0];
  if (!qualifiedInstagramRow) {
    throw new NonRetryableError(
      `Qualified IG Reel selection failed for ${input.date} slot ${slotNumber}; YouTube will not upload.`
    );
  }

  const video = await readFile(join(root, ...localVideoPath.split("/")));
  const localVideoSha256 = createHash("sha256").update(video).digest("hex");
  const instagramVideoSha256 = normalizedSha256(qualifiedInstagramRow.video_sha256);
  if (!instagramVideoSha256) {
    throw new NonRetryableError(
      `Qualified IG Reel for ${input.date} slot ${slotNumber} has no usable video_sha256; YouTube will not upload.`
    );
  }
  if (instagramVideoSha256 !== localVideoSha256) {
    throw new NonRetryableError(
      `IG video_sha256 does not match calendar local MP4 for ${input.date} slot ${slotNumber}; YouTube will not upload.`
    );
  }
  const instagramPostId = asTrimmedNonEmptyString(qualifiedInstagramRow.post_id);
  if (!instagramPostId) {
    throw new NonRetryableError(
      `Qualified IG Reel for ${input.date} slot ${slotNumber} has no usable post_id; YouTube will not upload.`
    );
  }
  const { title, description } = buildShortMetadata({
    topic: slot.topic,
    caption: slot.instagram_caption ?? "",
    date: input.date,
    slot: slotNumber
  });
  const source: YouTubeCompletionSourceBinding = {
    local_video_path: localVideoPath,
    local_video_sha256: localVideoSha256,
    instagram_video_sha256: instagramVideoSha256,
    instagram_post_id: instagramPostId
  };
  const expectedChannelId = await loadCanonicalYouTubeChannelId(root);
  if (!expectedChannelId) {
    throw new NonRetryableError(
      "Canonical data/business-profile.json has no valid YouTube channel id; no immutable claim or upload POST was made."
    );
  }

  // A date/slot ledger is not idempotency authority by itself. It may be a
  // legacy row written before immutable claims and remote read-back existed.
  // Such a row is an explicit data gap: never call it green and never POST.
  if (completedExistingEntry) {
    await assertExistingLedgerCompletion({
      date: input.date,
      slot: slotNumber,
      root,
      entry: completedExistingEntry,
      source,
      expectedChannelId
    });
    return {
      skipped: input.verifyOnly
        ? `verified completed YouTube Short for ${input.date} slot ${slotNumber}`
        : `already uploaded for ${input.date} slot ${slotNumber}`
    };
  }

  if (input.verifyOnly) {
    throw new NonRetryableError(
      `No immutable completed YouTube ledger entry exists for ${input.date} slot ${slotNumber}; read-only verification will not claim or upload.`
    );
  }

  if (!credentials(env)) {
    return { skipped: "credentials not configured; run npm run youtube-auth" };
  }

  const metadata = {
    snippet: { title, description, categoryId: "22", defaultLanguage: "zh-Hant" },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
      // Generated footage is declared as altered content, the same honesty the
      // image pipeline keeps with C2PA. Never strip this to dodge the label.
      containsSyntheticMedia: true
    }
  };

  const boundary = `sixiangjia-${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([head, video, tail]);

  // A caller can have read an old empty ledger before another caller finished.
  // Recheck before all fallible remote preflight and the immutable claim.
  await input.beforeClaim?.();
  await assertYouTubeSourceBindingStillCurrent({ date: input.date, slot: slotNumber, root, source });
  const freshLogBeforeClaim = await readJsonFile<unknown>(logPath, []);
  assertYouTubeLogEntries(freshLogBeforeClaim);
  const completedFreshEntry = singleCompletedLedgerEntryForTuple({
    entries: freshLogBeforeClaim,
    date: input.date,
    slot: slotNumber
  });
  if (completedFreshEntry) {
    await assertExistingLedgerCompletion({
      date: input.date,
      slot: slotNumber,
      root,
      entry: completedFreshEntry,
      source,
      expectedChannelId
    });
    return {
      skipped: input.verifyOnly
        ? `verified completed YouTube Short for ${input.date} slot ${slotNumber}`
        : `already uploaded for ${input.date} slot ${slotNumber}`
    };
  }
  const token = await accessToken(fetchImpl, env);
  const authorizedChannelId = await verifyYouTubeReadScopePreflight({ token, fetchImpl, expectedChannelId });
  const remoteClaim = buildYouTubeRemoteClaim({
    date: input.date,
    slot: slotNumber,
    now,
    localVideoPath,
    localVideoSha256,
    instagramPostId,
    instagramVideoSha256,
    expectedChannelId,
    authorizedChannelId
  });
  // All ordinary fallible work happens before the immutable remote authority.
  // If token refresh, read permission, or evidence persistence fails, no tuple
  // is burned and no remote POST is attempted.
  await prepareYouTubeRemoteClaimDirectory({ root, date: input.date });
  await recordYouTubePreflightEvidence({
    claim: remoteClaim,
    now,
    root,
    writeJson,
    lockOptions: input.lockOptions
  });
  // `wx` is the one-way remote authority. Once it succeeds, immediately make
  // the upload request; do not insert another fallible pre-POST operation.
  await createYouTubeRemoteClaim({ root, claim: remoteClaim });

  let response: Response;
  let payload: unknown;
  try {
    response = await fetchImpl(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length)
      },
      body
    });
    payload = await response.json();
  } catch (error) {
    await recordYouTubeUploadEvidence({
      claim: remoteClaim,
      state: "remote_response_uncertain",
      now,
      root,
      writeJson,
      lockOptions: input.lockOptions,
      error
    }).catch(() => undefined);
    throw new NonRetryableError(
      `YouTube upload response is uncertain for ${input.date} slot ${slotNumber}; automatic retry is blocked pending recovery.`,
      { cause: error }
    );
  }
  if (!response.ok) {
    // A provider status cannot prove whether an upstream proxy or the service
    // persisted the upload. Retain every non-2xx intent and require explicit
    // recovery evidence instead of allowing an automatic second POST.
    const error = new NonRetryableError(
      `YouTube upload response (${response.status}${remoteErrorMessage(payload) ? `: ${remoteErrorMessage(payload)}` : ""}) is uncertain for ${input.date} slot ${slotNumber}; automatic retry is blocked pending recovery.`
    );
    await recordYouTubeUploadEvidence({
      claim: remoteClaim,
      state: "remote_response_uncertain",
      now,
      root,
      writeJson,
      lockOptions: input.lockOptions,
      error
    }).catch(() => undefined);
    throw error;
  }
  const remoteVideoId = asTrimmedNonEmptyString(
    payload && typeof payload === "object" ? (payload as { id?: unknown }).id : undefined
  );
  if (!remoteVideoId) {
    const error = new NonRetryableError(
      `YouTube returned success without a video id for ${input.date} slot ${slotNumber}; automatic retry is blocked pending recovery.`
    );
    await recordYouTubeUploadEvidence({
      claim: remoteClaim,
      state: "remote_response_uncertain",
      now,
      root,
      writeJson,
      lockOptions: input.lockOptions,
      error
    }).catch(() => undefined);
    throw error;
  }

  try {
    // Everything after a remote success stays inside this boundary. If either
    // the A/B lookup, local schema check, read-back, or ledger append fails,
    // persist the remote id in evidence; the immutable claim forbids re-upload.
    const abVariant = planSlot(planForDate(await loadAbPlan(root), input.date), slotNumber)?.variant;
    const entry: YouTubeLogEntry = {
      date: input.date,
      slot: slotNumber,
      video_id: remoteVideoId,
      title,
      uploaded_at: now.toISOString(),
      ...(abVariant ? { ab_variant: abVariant } : {})
    };
    assertYouTubeLogEntries([entry]);
    await verifyUploadedVideoReadBack({
      videoId: remoteVideoId,
      title,
      description,
      expectedChannelId,
      token,
      fetchImpl
    });
    await appendCompletedYouTubeLog({ entry, root, writeJson, lockOptions: input.lockOptions });
    await recordYouTubeUploadEvidence({
      claim: remoteClaim,
      state: "completed",
      now,
      root,
      writeJson,
      lockOptions: input.lockOptions,
      remoteVideoId
    });
    return entry;
  } catch (error) {
    // Preserve the remote id in separate mutable evidence. Even if this write
    // fails, the immutable claim still blocks every automatic re-upload.
    await recordYouTubeUploadEvidence({
      claim: remoteClaim,
      state: "remote_accepted_log_failed",
      now,
      root,
      writeJson,
      lockOptions: input.lockOptions,
      remoteVideoId,
      error
    }).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    throw new NonRetryableError(
      `YouTube accepted ${input.date} slot ${slotNumber} as ${remoteVideoId}, but post-acceptance verification or local ledger commit failed: ${detail}; automatic retry is blocked pending recovery.`,
      { cause: error }
    );
  }
}

/**
 * One-time OAuth consent. Runs a loopback listener, opens the consent URL,
 * exchanges the code and writes YT_REFRESH_TOKEN into .env directly — the
 * token never appears on stdout.
 */
async function runAuthFlow(root: string): Promise<void> {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Put YT_CLIENT_ID and YT_CLIENT_SECRET into .env first (Google Cloud Console -> OAuth client, type Desktop app, YouTube Data API v3 enabled)."
    );
  }

  const { code, port } = await new Promise<{ code: string; port: number }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const received = url.searchParams.get("code");
      response.end(received ? "授權完成，可以關閉這個分頁。" : "missing code");
      if (received) {
        const address = server.address();
        const boundPort = typeof address === "object" && address ? address.port : 0;
        server.close();
        resolve({ code: received, port: boundPort });
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const consent = buildYouTubeConsentUrl({ clientId, port });
      console.log("\n請用瀏覽器開啟以下網址完成授權：\n");
      console.log(consent.toString());
      console.log("\n(等待授權中……)");
    });
    setTimeout(() => reject(new Error("Authorization timed out after 10 minutes.")), 600_000).unref();
  });

  const exchange = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `http://127.0.0.1:${port}`
    })
  });
  const tokens = (await exchange.json()) as { refresh_token?: string; error_description?: string };
  if (!exchange.ok || !tokens.refresh_token) {
    throw new Error(`Token exchange failed: ${tokens.error_description ?? exchange.status}`);
  }

  // The token goes straight into .env; it is never printed.
  const envPath = join(root, ".env");
  const env = await readFile(envPath, "utf8");
  const line = `YT_REFRESH_TOKEN=${tokens.refresh_token}`;
  const next = env.includes("YT_REFRESH_TOKEN=")
    ? env.replace(/YT_REFRESH_TOKEN=[^\r\n]*/, line)
    : `${env.trimEnd()}\n${line}\n`;
  await writeFile(envPath, next, "utf8");
  console.log(
    "授權完成，refresh token 已寫入 .env(未顯示)，並含 upload + videos.list 唯讀驗證範圍。舊 refresh token 必須重跑 npm run youtube-auth；未重授權前，正式 YouTube smoke 維持 No-Go。"
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "auth")) {
    await runAuthFlow(root);
    return;
  }

  const config = getConfig();
  const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
  const slot = getNumberOption(args, "slot") ?? 2;
  const result = await uploadShort({ date, slot, root, verifyOnly: getFlag(args, "verify-completion") });
  console.log(JSON.stringify(result, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
