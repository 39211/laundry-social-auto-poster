import { assertLiveMetaConfig } from "./config";
import { NonRetryableError } from "./retry";
import type { AppConfig, PostInput, PostResult, RemotePublicationEvidence, RemoteReelEvidence } from "./types";

interface FacebookResponse {
  id?: string;
  post_id?: string;
  video_id?: string;
  upload_url?: string;
  success?: boolean;
  status?: { video_status?: string };
  permalink_url?: unknown;
  description?: unknown;
  message?: unknown;
  attachments?: unknown;
  error?: { message?: string };
}

interface ReelPollingOptions {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isFacebookResponse(value: unknown): value is FacebookResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function facebookErrorMessage(payload: FacebookResponse, fallback: string): string {
  const error = payload.error;
  const message = error && typeof error === "object" ? nonBlankString((error as { message?: unknown }).message) : undefined;
  return message ?? fallback;
}

function requireCommittedFacebookPostId(payload: FacebookResponse, what: string): string {
  try {
    const postId = nonBlankString(payload.post_id) ?? nonBlankString(payload.id);
    if (postId) return postId;
  } catch (error) {
    throw new NonRetryableError(
      `${what} response id could not be validated; the post may already be live. Not retrying.`,
      { cause: error }
    );
  }
  throw new NonRetryableError(
    `${what} did not return a non-empty authoritative post_id or id (commit point; the post may already be live. Not retrying.)`
  );
}

function publicHttpsPermalink(value: unknown): string | undefined {
  const permalink = nonBlankString(value);
  if (!permalink) return undefined;
  try {
    const url = new URL(permalink);
    const hostname = url.hostname.toLowerCase();
    const isFacebookHost =
      hostname === "facebook.com" ||
      hostname.endsWith(".facebook.com") ||
      hostname === "fb.watch" ||
      hostname.endsWith(".fb.watch");
    if (url.protocol !== "https:" || !isFacebookHost) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function reelVerificationFailure(detail: string, cause?: unknown): NonRetryableError {
  return new NonRetryableError(
    `Facebook Reel may already be live, but remote verification failed: ${detail}. Not retrying.`,
    cause === undefined ? undefined : { cause }
  );
}

function publicationVerificationFailure(what: string, detail: string, cause?: unknown): NonRetryableError {
  return new NonRetryableError(
    `Facebook ${what} may already be live, but remote verification failed: ${detail}. Not retrying.`,
    cause === undefined ? undefined : { cause }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function facebookAttachments(payload: FacebookResponse): Array<Record<string, unknown>> {
  if (!isRecord(payload.attachments) || !Array.isArray(payload.attachments.data)) return [];
  return payload.attachments.data.filter(isRecord);
}

function facebookSubattachments(attachment: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!isRecord(attachment.subattachments) || !Array.isArray(attachment.subattachments.data)) return [];
  return attachment.subattachments.data.filter(isRecord);
}

function facebookAttachmentKind(attachment: Record<string, unknown>): string | undefined {
  return nonBlankString(attachment.media_type)?.toLowerCase() ?? nonBlankString(attachment.type)?.toLowerCase();
}

function isAvailableFacebookImage(attachment: Record<string, unknown>): boolean {
  const kind = facebookAttachmentKind(attachment);
  return (kind === "photo" || kind === "image") && (isRecord(attachment.media) || Boolean(nonBlankString(attachment.url)));
}

function hasAvailableFacebookCarousel(payload: FacebookResponse, expectedImageCount: number): boolean {
  return facebookAttachments(payload).some((attachment) => {
    const kind = facebookAttachmentKind(attachment);
    if (kind !== "album" && kind !== "carousel") return false;
    const children = facebookSubattachments(attachment);
    return children.length === expectedImageCount && children.every(isAvailableFacebookImage);
  });
}

function hasExactFacebookCaption(payload: FacebookResponse, caption: string): boolean {
  // Page-post readback exposes `message`; a photo-object fallback exposes
  // `description`. If the canonical endpoint provides `message`, it is the
  // authoritative caption field and must bind exactly.
  return payload.message === undefined ? payload.description === caption : payload.message === caption;
}

async function verifyFacebookPublication(
  postId: string,
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch,
  expectedMediaType: "IMAGE" | "CAROUSEL",
  expectedImageCount: number,
  what: string
): Promise<RemotePublicationEvidence> {
  const expectedId = nonBlankString(postId);
  if (!expectedId) throw publicationVerificationFailure(what, "the committed post id is missing");

  const endpoint = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${expectedId}`);
  endpoint.searchParams.set(
    "fields",
    "id,permalink_url,message,description,attachments{media_type,type,media,url,subattachments{media_type,type,media,url}}"
  );
  endpoint.searchParams.set("access_token", config.metaAccessToken ?? "");

  try {
    const response = await fetchImpl(endpoint, { method: "GET" });
    const rawPayload = (await response.json()) as unknown;
    if (!isFacebookResponse(rawPayload)) {
      throw publicationVerificationFailure(what, "the remote GET returned an invalid response shape");
    }
    const payload = rawPayload;
    if (!response.ok || payload.error) {
      throw publicationVerificationFailure(what, facebookErrorMessage(payload, `the remote GET returned ${response.status}`));
    }

    const remoteId = nonBlankString(payload.id);
    if (!remoteId || remoteId !== expectedId) {
      throw publicationVerificationFailure(what, `remote id did not match committed post id ${expectedId}`);
    }
    const permalink = publicHttpsPermalink(payload.permalink_url);
    if (!permalink) throw publicationVerificationFailure(what, "the remote object did not provide a public Facebook permalink");
    if (!hasExactFacebookCaption(payload, input.caption)) {
      throw publicationVerificationFailure(what, "remote caption/description did not exactly match the approved caption");
    }
    const mediaAvailable = expectedMediaType === "IMAGE"
      ? facebookAttachments(payload).some(isAvailableFacebookImage)
      : hasAvailableFacebookCarousel(payload, expectedImageCount);
    if (!mediaAvailable) {
      throw publicationVerificationFailure(what, `remote ${expectedMediaType.toLowerCase()} media was missing or unavailable`);
    }

    return {
      remote_id: remoteId,
      permalink,
      verified_at: new Date().toISOString(),
      remote_media_type: expectedMediaType,
      caption_exact_match: true
    };
  } catch (error) {
    if (error instanceof NonRetryableError) throw error;
    throw publicationVerificationFailure(what, "the remote GET could not be completed or had an invalid response shape", error);
  }
}

async function readFacebookResponse(response: Response, fallback: string): Promise<FacebookResponse> {
  const payload = (await response.json()) as FacebookResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `${fallback} with ${response.status}`);
  }
  return payload;
}

// The Facebook side had no commit protection at all: the photo POST with
// published:"true" and the Reel upload_phase:"finish" both create the post the
// moment the server acts, and both threw plain Errors on a lost response or a
// late 5xx -- which withRetry reran, republishing. The 2026-08-11 containment
// note names exactly this ("unsafe three-attempt publisher"). Same contract as
// Instagram's media_publish: at a commit point, only confirmed success is
// retryable-around; every other outcome must be assumed live.
async function commitFacebookCall(
  call: () => Promise<Response>,
  what: string
): Promise<FacebookResponse> {
  let response: Response;
  try {
    response = await call();
  } catch (error) {
    throw new NonRetryableError(
      `${what} response was lost; the post may already be live. Not retrying.`,
      { cause: error }
    );
  }
  try {
    const rawPayload = (await response.json()) as unknown;
    if (!isFacebookResponse(rawPayload)) {
      throw new NonRetryableError(
        `${what} returned an invalid response shape (commit point; the post may already be live. Not retrying.)`
      );
    }
    const payload = rawPayload;
    if (!response.ok || payload.error) {
      throw new NonRetryableError(
        `${facebookErrorMessage(payload, `${what} failed with ${response.status}`)} (commit point; the post may already be live. Not retrying.)`
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof NonRetryableError) throw error;
    throw new NonRetryableError(
      `${what} response could not be read or validated; the post may already be live. Not retrying.`,
      { cause: error }
    );
  }
}

/**
 * The Reel finish call is already an irreversible commit.  This read-back may
 * poll for eventual transcode completion, but every terminal outcome is
 * deliberately non-retryable so withRetry cannot upload the same video again.
 */
async function waitForVerifiedFacebookReel(
  videoId: string,
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch,
  polling: ReelPollingOptions
): Promise<RemoteReelEvidence> {
  const maxAttempts = polling.maxAttempts ?? 12;
  const intervalMs = polling.intervalMs ?? 5_000;
  const sleep = polling.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const expectedVideoId = nonBlankString(videoId);
  if (!expectedVideoId) throw reelVerificationFailure("the committed video id is missing");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const statusUrl = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${expectedVideoId}`);
    statusUrl.searchParams.set("fields", "id,status,permalink_url,description");
    statusUrl.searchParams.set("access_token", config.metaAccessToken ?? "");

    let videoStatus = "missing";
    try {
      const response = await fetchImpl(statusUrl, { method: "GET" });
      const rawPayload = (await response.json()) as unknown;
      if (!isFacebookResponse(rawPayload)) {
        throw reelVerificationFailure("the remote Reel GET returned an invalid response shape");
      }
      const payload = rawPayload;
      if (!response.ok || payload.error) {
        throw reelVerificationFailure(
          facebookErrorMessage(payload, `the remote Reel GET returned ${response.status}`)
        );
      }

      const remoteId = nonBlankString(payload.id);
      if (!remoteId || remoteId !== expectedVideoId) {
        throw reelVerificationFailure(`remote id did not match committed video id ${expectedVideoId}`);
      }
      const rawVideoStatus =
        payload.status && typeof payload.status === "object"
          ? (payload.status as { video_status?: unknown }).video_status
          : undefined;
      const normalizedStatus = nonBlankString(rawVideoStatus);
      if (!normalizedStatus) {
        throw reelVerificationFailure("remote Reel video status was missing or not a string");
      }
      videoStatus = normalizedStatus.toLowerCase();
      if (videoStatus === "error" || videoStatus === "expired") {
        throw reelVerificationFailure(`Facebook Reel entered terminal status ${videoStatus}`);
      }
      if (videoStatus === "ready") {
        const permalink = publicHttpsPermalink(payload.permalink_url);
        if (!permalink) throw reelVerificationFailure("remote Reel did not provide a public permalink");
        if (payload.description !== input.caption) {
          throw reelVerificationFailure("remote Reel description did not exactly match the approved caption");
        }
        return {
          remote_id: remoteId,
          permalink,
          verified_at: new Date().toISOString(),
          // The read-back belongs to the Reels publishing endpoint that created
          // this remote id; Facebook's video object does not expose a separate
          // stable REELS discriminator in this response.
          remote_media_type: "REELS",
          caption_exact_match: true
        };
      }
    } catch (error) {
      if (error instanceof NonRetryableError) throw error;
      throw reelVerificationFailure("the remote Reel GET could not be completed or had an invalid response shape", error);
    }

    if (attempt < maxAttempts) {
      try {
        await sleep(intervalMs);
      } catch (error) {
        throw reelVerificationFailure("remote evidence polling could not continue", error);
      }
      continue;
    }
    throw reelVerificationFailure(`Facebook Reel is not ready after ${maxAttempts} read-back checks (last status: ${videoStatus ?? "missing"})`);
  }

  throw reelVerificationFailure(`Facebook Reel ${expectedVideoId} could not be verified`);
}

export async function postFacebookPhoto(
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch
): Promise<PostResult> {
  if (config.dryRun) {
    return {
      platform: "facebook",
      status: "success",
      dry_run: true,
      attempts: 1,
      post_id: `dry-run-facebook-${input.date}-${input.slot}`
    };
  }

  assertLiveMetaConfig(config);

  const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${config.facebookPageId}/photos`;
  const body = new URLSearchParams({
    url: input.imageUrl,
    caption: input.caption,
    published: "true",
    access_token: config.metaAccessToken ?? ""
  });

  const payload = await commitFacebookCall(
    () => fetchImpl(endpoint, { method: "POST", body }),
    "Facebook photo publish"
  );
  const postId = requireCommittedFacebookPostId(payload, "Facebook photo publish");
  const remotePublicationEvidence = await verifyFacebookPublication(
    postId,
    input,
    config,
    fetchImpl,
    "IMAGE",
    1,
    "photo"
  );

  return {
    platform: "facebook",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: postId,
    remote_publication_evidence: remotePublicationEvidence
  };
}

export async function postFacebookCarousel(
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch
): Promise<PostResult> {
  const imageUrls = input.imageUrls ?? [];
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error("Facebook carousel requires 2-10 public image URLs.");
  }
  if (config.dryRun) {
    return {
      platform: "facebook",
      status: "success",
      dry_run: true,
      attempts: 1,
      post_id: `dry-run-facebook-carousel-${input.date}-${input.slot}`
    };
  }

  assertLiveMetaConfig(config);
  const photoEndpoint = `https://graph.facebook.com/${config.graphApiVersion}/${config.facebookPageId}/photos`;
  const photoIds: string[] = [];
  for (const url of imageUrls) {
    const uploaded = await readFacebookResponse(
      await fetchImpl(photoEndpoint, {
        method: "POST",
        body: new URLSearchParams({
          url,
          published: "false",
          access_token: config.metaAccessToken ?? ""
        })
      }),
      "Facebook unpublished carousel photo upload failed"
    );
    const photoId = nonBlankString(uploaded.id);
    if (!photoId) throw new Error("Facebook unpublished carousel photo did not return a non-empty string id.");
    photoIds.push(photoId);
  }

  const body = new URLSearchParams({
    message: input.caption,
    access_token: config.metaAccessToken ?? ""
  });
  photoIds.forEach((id, index) => {
    body.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id }));
  });
  // The /feed POST is the carousel's commit point; the unpublished photo
  // uploads before it are safely retryable.
  const published = await commitFacebookCall(
    () => fetchImpl(`https://graph.facebook.com/${config.graphApiVersion}/${config.facebookPageId}/feed`, {
      method: "POST",
      body
    }),
    "Facebook carousel publish"
  );
  const postId = requireCommittedFacebookPostId(published, "Facebook carousel publish");
  const remotePublicationEvidence = await verifyFacebookPublication(
    postId,
    input,
    config,
    fetchImpl,
    "CAROUSEL",
    imageUrls.length,
    "carousel"
  );

  return {
    platform: "facebook",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: postId,
    remote_publication_evidence: remotePublicationEvidence
  };
}

export async function postFacebookReel(
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
  polling: ReelPollingOptions = {}
): Promise<PostResult> {
  if (config.dryRun) {
    return {
      platform: "facebook",
      status: "success",
      dry_run: true,
      attempts: 1,
      post_id: `dry-run-facebook-reel-${input.date}-${input.slot}`
    };
  }

  assertLiveMetaConfig(config);
  if (!input.videoUrl) throw new Error("Facebook Reel requires a public video URL.");

  const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/me/video_reels`;
  const started = await readFacebookResponse(
    await fetchImpl(endpoint, {
      method: "POST",
      body: new URLSearchParams({
        access_token: config.metaAccessToken ?? "",
        upload_phase: "start"
      })
    }),
    "Facebook Reel session creation failed"
  );
  const startedVideoId = nonBlankString(started.video_id);
  const uploadUrl = nonBlankString(started.upload_url);
  if (!startedVideoId || !uploadUrl) {
    throw new Error("Facebook Reel session did not return non-empty string video_id and upload_url.");
  }

  const uploaded = await readFacebookResponse(
    await fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${config.metaAccessToken ?? ""}`,
        file_url: input.videoUrl
      }
    }),
    "Facebook Reel upload failed"
  );
  if (uploaded.success !== true) throw new Error("Facebook Reel upload did not return success=true.");

  const finished = await commitFacebookCall(
    () => fetchImpl(endpoint, {
      method: "POST",
      body: new URLSearchParams({
        access_token: config.metaAccessToken ?? "",
        video_id: startedVideoId,
        upload_phase: "finish",
        video_state: "PUBLISHED",
        description: input.caption
      })
    }),
    "Facebook Reel publish"
  );
  if (finished.success !== true) {
    throw new NonRetryableError(
      "Facebook Reel publish did not return success=true (commit point; the Reel may already be live. Not retrying.)"
    );
  }

  const remoteReelEvidence = await waitForVerifiedFacebookReel(
    startedVideoId,
    input,
    config,
    fetchImpl,
    polling
  );
  const postId = nonBlankString(remoteReelEvidence.remote_id);
  if (!postId) {
    throw reelVerificationFailure("remote Reel evidence did not provide a non-empty post_id");
  }

  return {
    platform: "facebook",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: postId,
    remote_reel_evidence: remoteReelEvidence,
    remote_publication_evidence: remoteReelEvidence
  };
}
