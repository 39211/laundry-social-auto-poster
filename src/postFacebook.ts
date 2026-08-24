import { assertLiveMetaConfig } from "./config";
import { NonRetryableError } from "./retry";
import type { AppConfig, PostInput, PostResult } from "./types";

interface FacebookResponse {
  id?: string;
  post_id?: string;
  video_id?: string;
  upload_url?: string;
  success?: boolean;
  status?: { video_status?: string };
  error?: { message?: string };
}

interface ReelPollingOptions {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
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
  let payload: FacebookResponse;
  try {
    payload = (await response.json()) as FacebookResponse;
  } catch (error) {
    throw new NonRetryableError(
      `${what} response could not be read; the post may already be live. Not retrying.`,
      { cause: error }
    );
  }
  if (!response.ok || payload.error) {
    throw new NonRetryableError(
      `${payload.error?.message || `${what} failed with ${response.status}`} (commit point; the post may already be live. Not retrying.)`
    );
  }
  return payload;
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
    published: input.scheduledPublishTime ? "false" : "true",
    access_token: config.metaAccessToken ?? ""
  });
  if (input.scheduledPublishTime) {
    body.set("scheduled_publish_time", String(input.scheduledPublishTime));
  }

  const payload = await commitFacebookCall(
    () => fetchImpl(endpoint, { method: "POST", body }),
    input.scheduledPublishTime ? "Facebook photo schedule" : "Facebook photo publish"
  );

  return {
    platform: "facebook",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: payload.post_id || payload.id
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
    if (!uploaded.id) throw new Error("Facebook unpublished carousel photo did not return an id.");
    photoIds.push(uploaded.id);
  }

  const body = new URLSearchParams({
    message: input.caption,
    access_token: config.metaAccessToken ?? ""
  });
  photoIds.forEach((id, index) => {
    body.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id }));
  });
  if (input.scheduledPublishTime) {
    body.set("published", "false");
    body.set("scheduled_publish_time", String(input.scheduledPublishTime));
  }
  // The /feed POST is the carousel's commit point; the unpublished photo
  // uploads before it are safely retryable.
  const published = await commitFacebookCall(
    () => fetchImpl(`https://graph.facebook.com/${config.graphApiVersion}/${config.facebookPageId}/feed`, {
      method: "POST",
      body
    }),
    input.scheduledPublishTime ? "Facebook carousel schedule" : "Facebook carousel publish"
  );

  return {
    platform: "facebook",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: published.id
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
  if (!started.video_id || !started.upload_url) {
    throw new Error("Facebook Reel session did not return video_id and upload_url.");
  }
  const startedVideoId = started.video_id;

  const uploaded = await readFacebookResponse(
    await fetchImpl(started.upload_url, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${config.metaAccessToken ?? ""}`,
        file_url: input.videoUrl
      }
    }),
    "Facebook Reel upload failed"
  );
  if (uploaded.success !== true) throw new Error("Facebook Reel upload did not return success=true.");

  const finishBody = new URLSearchParams({
    access_token: config.metaAccessToken ?? "",
    video_id: startedVideoId,
    upload_phase: "finish",
    video_state: input.scheduledPublishTime ? "SCHEDULED" : "PUBLISHED",
    description: input.caption
  });
  if (input.scheduledPublishTime) {
    finishBody.set("scheduled_publish_time", String(input.scheduledPublishTime));
  }
  const finished = await commitFacebookCall(
    () => fetchImpl(endpoint, { method: "POST", body: finishBody }),
    input.scheduledPublishTime ? "Facebook Reel schedule" : "Facebook Reel publish"
  );
  if (finished.success !== true) {
    throw new NonRetryableError(
      "Facebook Reel publish did not return success=true (commit point; the Reel may already be live. Not retrying.)"
    );
  }

  // A scheduled Reel is queued server-side, not live; the transcode-status
  // polling below observes a live publish and reports "ready", which a
  // SCHEDULED video never reaches before its publish time.
  if (input.scheduledPublishTime) {
    return {
      platform: "facebook",
      status: "success",
      dry_run: false,
      attempts: 1,
      post_id: started.video_id
    };
  }

  // The finish call above is the commit point: the Reel is live on the Page
  // the moment it returns success. Everything after is observation, and it
  // must not throw on a timeout -- a throw here feeds withRetry, which reruns
  // the whole upload and publishes the same Reel again, up to three copies per
  // run. A transcode still in progress after the polling budget is a slow
  // transcode, not a failed publish; only a terminal error status is a fault.
  const maxAttempts = polling.maxAttempts ?? 12;
  const intervalMs = polling.intervalMs ?? 5_000;
  const sleep = polling.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let videoStatus = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const statusUrl = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${started.video_id}`);
    statusUrl.searchParams.set("fields", "status");
    statusUrl.searchParams.set("access_token", config.metaAccessToken ?? "");
    const statusPayload = await readFacebookResponse(
      await fetchImpl(statusUrl, { method: "GET" }),
      "Facebook Reel status check failed"
    );
    videoStatus = statusPayload.status?.video_status?.toLowerCase() ?? "unknown";
    if (videoStatus === "ready") break;
    if (["error", "expired"].includes(videoStatus)) {
      throw new Error(`Facebook Reel entered terminal status ${videoStatus}.`);
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  if (videoStatus !== "ready") {
    console.warn(
      `Facebook Reel ${started.video_id} is published but still transcoding after ` +
        `${maxAttempts} checks (last status: ${videoStatus}); not retrying a committed publish.`
    );
  }

  return {
    platform: "facebook",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: started.video_id
  };
}
