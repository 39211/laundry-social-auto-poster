import { assertLiveMetaConfig } from "./config";
import { NonRetryableError } from "./retry";
import type { AppConfig, PostInput, PostResult, RemotePublicationEvidence, RemoteReelEvidence } from "./types";

interface InstagramResponse {
  id?: string;
  status?: string;
  status_code?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  caption?: string;
  error?: { message?: string };
}

interface InstagramPollingOptions {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_POLL_ATTEMPTS = 10;
const DEFAULT_POLL_INTERVAL_MS = 5000;

function nonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isInstagramResponse(value: unknown): value is InstagramResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instagramErrorMessage(payload: InstagramResponse, fallback: string): string {
  const error = payload.error;
  const message = error && typeof error === "object" ? nonBlankString((error as { message?: unknown }).message) : undefined;
  return message ?? fallback;
}

function publicHttpsPermalink(value: unknown): string | undefined {
  const permalink = nonBlankString(value);
  if (!permalink) return undefined;
  try {
    const url = new URL(permalink);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !hostname ||
      (hostname !== "instagram.com" && !hostname.endsWith(".instagram.com"))
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function reelVerificationFailure(detail: string, cause?: unknown): NonRetryableError {
  return new NonRetryableError(
    `Instagram Reel may already be live, but remote verification failed: ${detail}. Not retrying.`,
    cause === undefined ? undefined : { cause }
  );
}

function publicationVerificationFailure(what: string, detail: string, cause?: unknown): NonRetryableError {
  return new NonRetryableError(
    `Instagram ${what} may already be live, but remote verification failed: ${detail}. Not retrying.`,
    cause === undefined ? undefined : { cause }
  );
}

async function postForm(
  endpoint: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<InstagramResponse> {
  // media_publish is the commit point: a lost response or a late error after
  // this call may leave the post LIVE, so retrying the whole flow would put a
  // duplicate on the account (luna, high). Container creation before it is
  // safely retryable.
  const isCommit = endpoint.endsWith("/media_publish");
  let response: Response;
  try {
    response = await fetchImpl(endpoint, { method: "POST", body });
  } catch (error) {
    if (isCommit) {
      throw new NonRetryableError(
        `Instagram media_publish response was lost; the post may already be live. Not retrying.`,
        { cause: error }
      );
    }
    throw error;
  }
  // Past the commit point the burden of proof flips: only an explicit success
  // may be retried-around, and everything else must be treated as possibly
  // live. The earlier shape had two holes the audit walked through. The body
  // read sat outside the try, so a connection dropped mid-body threw a plain
  // SyntaxError -- retryable -- for exactly the "response lost in transit"
  // case the guard was written for. And only status >= 500 was non-retryable,
  // although Meta can return an error envelope on a 200/4xx after the publish
  // has committed.
  let rawPayload: unknown;
  try {
    rawPayload = await response.json();
  } catch (error) {
    if (isCommit) {
      throw new NonRetryableError(
        `Instagram media_publish response could not be read; the post may already be live. Not retrying.`,
        { cause: error }
      );
    }
    throw error;
  }
  try {
    if (!isInstagramResponse(rawPayload)) {
      const message = `Instagram request returned an invalid response shape with ${response.status}`;
      if (isCommit) {
        throw new NonRetryableError(`${message} (media_publish did not confirm success; the post may already be live. Not retrying.)`);
      }
      throw new Error(message);
    }
    const payload = rawPayload;
    if (!response.ok || payload.error || !nonBlankString(payload.id)) {
      const message = instagramErrorMessage(payload, `Instagram request failed with ${response.status}`);
      if (isCommit) {
        throw new NonRetryableError(`${message} (media_publish did not confirm success; the post may already be live. Not retrying.)`);
      }
      throw new Error(message);
    }
    return payload;
  } catch (error) {
    if (!isCommit) throw error;
    if (error instanceof NonRetryableError) throw error;
    throw new NonRetryableError(
      "Instagram media_publish response could not be validated; the post may already be live. Not retrying.",
      { cause: error }
    );
  }
}

async function waitForPublishableContainer(
  containerId: string,
  config: AppConfig,
  fetchImpl: typeof fetch,
  options: InstagramPollingOptions
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_POLL_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const query = new URLSearchParams({
      fields: "status_code,status",
      access_token: config.metaAccessToken ?? ""
    });
    const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${containerId}?${query}`;
    const response = await fetchImpl(endpoint, { method: "GET" });
    const payload = (await response.json()) as InstagramResponse;

    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Instagram container status failed with ${response.status}`);
    }

    if (payload.status_code === "FINISHED") return;
    if (payload.status_code === "ERROR" || payload.status_code === "EXPIRED" || payload.status_code === "PUBLISHED") {
      throw new Error(
        `Instagram media container ${containerId} is not publishable: ${payload.status_code}${payload.status ? ` (${payload.status})` : ""}`
      );
    }
    if (payload.status_code !== "IN_PROGRESS") {
      throw new Error(`Instagram media container ${containerId} returned an unknown status: ${payload.status_code ?? "missing"}`);
    }

    if (attempt < maxAttempts) await sleep(intervalMs);
  }

  throw new Error(`Instagram media container ${containerId} was not publishable after ${maxAttempts} status checks`);
}

async function waitForPublishedReel(
  mediaId: string,
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch,
  options: InstagramPollingOptions
): Promise<RemoteReelEvidence> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_POLL_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  // media_publish has already committed by the time this runs.  A read-back
  // failure cannot be allowed to look like success, but it also must not feed
  // withRetry: retrying the whole publisher would create a second Reel.
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const query = new URLSearchParams({
      fields: "id,media_type,media_product_type,permalink,caption",
      access_token: config.metaAccessToken ?? ""
    });
    let permalink: string | undefined;
    let captionMatches = false;
    try {
      const response = await fetchImpl(
        `https://graph.facebook.com/${config.graphApiVersion}/${mediaId}?${query}`,
        { method: "GET" }
      );
      const rawPayload = await response.json();
      if (!isInstagramResponse(rawPayload)) {
        throw reelVerificationFailure("the remote Reel GET returned an invalid response shape");
      }
      const payload = rawPayload;
      if (!response.ok || payload.error) {
        throw reelVerificationFailure(
          instagramErrorMessage(payload, `the remote Reel GET returned ${response.status}`)
        );
      }

      const remoteId = nonBlankString(payload.id);
      if (!remoteId || remoteId !== mediaId) {
        throw reelVerificationFailure(`remote id did not match committed media id ${mediaId}`);
      }
      if (payload.media_type !== "VIDEO" || payload.media_product_type !== "REELS") {
        throw reelVerificationFailure("remote media is not a REELS video");
      }

      permalink = publicHttpsPermalink(payload.permalink);
      captionMatches = payload.caption === input.caption;
      if (permalink && captionMatches) {
        return {
          remote_id: remoteId,
          permalink,
          verified_at: new Date().toISOString(),
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
    const missing = [
      ...(permalink ? [] : ["a public permalink"]),
      ...(captionMatches ? [] : ["an exact caption match"])
    ];
    throw reelVerificationFailure(`remote Reel did not provide ${missing.join(" and ")}`);
  }

  throw reelVerificationFailure(`remote Reel ${mediaId} could not be verified`);
}

async function verifyInstagramPublication(
  mediaId: string,
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch,
  expectedMediaType: "IMAGE" | "CAROUSEL_ALBUM",
  what: string
): Promise<RemotePublicationEvidence> {
  const expectedId = nonBlankString(mediaId);
  if (!expectedId) throw publicationVerificationFailure(what, "the committed media id is missing");

  const query = new URLSearchParams({
    fields: "id,media_type,media_product_type,permalink,caption",
    access_token: config.metaAccessToken ?? ""
  });
  try {
    const response = await fetchImpl(
      `https://graph.facebook.com/${config.graphApiVersion}/${expectedId}?${query}`,
      { method: "GET" }
    );
    const rawPayload = await response.json();
    if (!isInstagramResponse(rawPayload)) {
      throw publicationVerificationFailure(what, "the remote GET returned an invalid response shape");
    }
    const payload = rawPayload;
    if (!response.ok || payload.error) {
      throw publicationVerificationFailure(what, instagramErrorMessage(payload, `the remote GET returned ${response.status}`));
    }

    const remoteId = nonBlankString(payload.id);
    if (!remoteId || remoteId !== expectedId) {
      throw publicationVerificationFailure(what, `remote id did not match committed media id ${expectedId}`);
    }
    if (payload.media_type !== expectedMediaType || payload.media_product_type !== "FEED") {
      throw publicationVerificationFailure(what, `remote media is not an available ${expectedMediaType} feed post`);
    }
    const permalink = publicHttpsPermalink(payload.permalink);
    if (!permalink) throw publicationVerificationFailure(what, "the remote object did not provide a public Instagram permalink");
    if (payload.caption !== input.caption) {
      throw publicationVerificationFailure(what, "remote caption did not exactly match the approved caption");
    }

    return {
      remote_id: remoteId,
      permalink,
      verified_at: new Date().toISOString(),
      remote_media_type: expectedMediaType === "IMAGE" ? "IMAGE" : "CAROUSEL",
      caption_exact_match: true
    };
  } catch (error) {
    if (error instanceof NonRetryableError) throw error;
    throw publicationVerificationFailure(what, "the remote GET could not be completed or had an invalid response shape", error);
  }
}

// A carousel carries its location on the parent container; the children are just
// the media. Meta rejects an id that is not a location page, so a wrong value
// fails loudly at container creation rather than publishing a mistagged post.
function withLocation(params: URLSearchParams, config: AppConfig): URLSearchParams {
  if (config.instagramLocationId) params.set("location_id", config.instagramLocationId);
  return params;
}

export async function postInstagramPhoto(
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
  pollingOptions: InstagramPollingOptions = {}
): Promise<PostResult> {
  if (config.dryRun) {
    return {
      platform: "instagram",
      status: "success",
      dry_run: true,
      attempts: 1,
      post_id: `dry-run-instagram-${input.date}-${input.slot}`
    };
  }

  assertLiveMetaConfig(config);

  const base = `https://graph.facebook.com/${config.graphApiVersion}/${config.instagramUserId}`;
  const media = await postForm(
    `${base}/media`,
    withLocation(
      new URLSearchParams({
        image_url: input.imageUrl,
        caption: input.caption,
        access_token: config.metaAccessToken ?? ""
      }),
      config
    ),
    fetchImpl
  );

  await waitForPublishableContainer(media.id ?? "", config, fetchImpl, pollingOptions);

  const published = await postForm(
    `${base}/media_publish`,
    new URLSearchParams({
      creation_id: media.id ?? "",
      access_token: config.metaAccessToken ?? ""
    }),
    fetchImpl
  );
  const remotePublicationEvidence = await verifyInstagramPublication(
    published.id ?? "",
    input,
    config,
    fetchImpl,
    "IMAGE",
    "photo"
  );

  return {
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: remotePublicationEvidence.remote_id,
    remote_publication_evidence: remotePublicationEvidence
  };
}

export async function postInstagramCarousel(
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
  pollingOptions: InstagramPollingOptions = {}
): Promise<PostResult> {
  const imageUrls = input.imageUrls ?? [];
  const mixed = input.mediaType === "mixed-carousel";
  const totalItems = imageUrls.length + (mixed ? 1 : 0);
  if (totalItems < 2 || totalItems > 10) {
    throw new Error("Instagram carousel requires 2-10 public media URLs.");
  }
  if (mixed && !input.videoUrl) {
    throw new Error("Instagram mixed carousel requires a public video URL.");
  }
  if (config.dryRun) {
    return {
      platform: "instagram",
      status: "success",
      dry_run: true,
      attempts: 1,
      post_id: `dry-run-instagram-carousel-${input.date}-${input.slot}`
    };
  }

  assertLiveMetaConfig(config);
  const base = `https://graph.facebook.com/${config.graphApiVersion}/${config.instagramUserId}`;
  const children: string[] = [];
  for (const imageUrl of imageUrls) {
    const child = await postForm(
      `${base}/media`,
      new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: "true",
        access_token: config.metaAccessToken ?? ""
      }),
      fetchImpl
    );
    await waitForPublishableContainer(child.id ?? "", config, fetchImpl, pollingOptions);
    children.push(child.id ?? "");
  }
  if (mixed) {
    // A carousel video child is VIDEO, not REELS: Meta documents that reels
    // cannot appear in carousels, so REELS here is rejected at container
    // creation. VIDEO stays correct for carousel children even though it is
    // deprecated for standalone video posts, which use REELS.
    const child = await postForm(
      `${base}/media`,
      new URLSearchParams({
        media_type: "VIDEO",
        video_url: input.videoUrl ?? "",
        is_carousel_item: "true",
        access_token: config.metaAccessToken ?? ""
      }),
      fetchImpl
    );
    await waitForPublishableContainer(child.id ?? "", config, fetchImpl, pollingOptions);
    children.push(child.id ?? "");
  }

  const parent = await postForm(
    `${base}/media`,
    withLocation(
      new URLSearchParams({
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: input.caption,
        access_token: config.metaAccessToken ?? ""
      }),
      config
    ),
    fetchImpl
  );
  await waitForPublishableContainer(parent.id ?? "", config, fetchImpl, pollingOptions);

  const published = await postForm(
    `${base}/media_publish`,
    new URLSearchParams({
      creation_id: parent.id ?? "",
      access_token: config.metaAccessToken ?? ""
    }),
    fetchImpl
  );
  const remotePublicationEvidence = await verifyInstagramPublication(
    published.id ?? "",
    input,
    config,
    fetchImpl,
    "CAROUSEL_ALBUM",
    "carousel"
  );

  return {
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: remotePublicationEvidence.remote_id,
    remote_publication_evidence: remotePublicationEvidence
  };
}

export async function postInstagramReel(
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
  pollingOptions: InstagramPollingOptions = {}
): Promise<PostResult> {
  if (config.dryRun) {
    return {
      platform: "instagram",
      status: "success",
      dry_run: true,
      attempts: 1,
      post_id: `dry-run-instagram-reel-${input.date}-${input.slot}`
    };
  }

  assertLiveMetaConfig(config);
  if (!input.videoUrl) throw new Error("Instagram Reel requires a public video URL.");

  const base = `https://graph.facebook.com/${config.graphApiVersion}/${config.instagramUserId}`;
  const media = await postForm(
    `${base}/media`,
    withLocation(
      new URLSearchParams({
        media_type: "REELS",
        video_url: input.videoUrl,
        caption: input.caption,
        share_to_feed: "true",
        access_token: config.metaAccessToken ?? ""
      }),
      config
    ),
    fetchImpl
  );

  await waitForPublishableContainer(media.id ?? "", config, fetchImpl, pollingOptions);

  const published = await postForm(
    `${base}/media_publish`,
    new URLSearchParams({
      creation_id: media.id ?? "",
      access_token: config.metaAccessToken ?? ""
    }),
    fetchImpl
  );

  const publishedId = nonBlankString(published.id);
  if (!publishedId) {
    throw reelVerificationFailure("media_publish did not return a usable id");
  }
  const remoteReelEvidence = await waitForPublishedReel(publishedId, input, config, fetchImpl, pollingOptions);

  return {
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: remoteReelEvidence.remote_id,
    remote_reel_evidence: remoteReelEvidence,
    remote_publication_evidence: remoteReelEvidence
  };
}
