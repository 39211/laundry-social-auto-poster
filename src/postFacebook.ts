import { assertLiveMetaConfig } from "./config";
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

  const response = await fetchImpl(endpoint, { method: "POST", body });
  const payload = await readFacebookResponse(response, "Facebook publish failed");

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
  const published = await readFacebookResponse(
    await fetchImpl(`https://graph.facebook.com/${config.graphApiVersion}/${config.facebookPageId}/feed`, {
      method: "POST",
      body
    }),
    "Facebook carousel publish failed"
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

  const finished = await readFacebookResponse(
    await fetchImpl(endpoint, {
      method: "POST",
      body: new URLSearchParams({
        access_token: config.metaAccessToken ?? "",
        video_id: started.video_id,
        upload_phase: "finish",
        video_state: "PUBLISHED",
        description: input.caption
      })
    }),
    "Facebook Reel publish failed"
  );
  if (finished.success !== true) throw new Error("Facebook Reel publish did not return success=true.");

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
