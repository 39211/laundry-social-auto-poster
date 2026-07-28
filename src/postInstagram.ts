import { assertLiveMetaConfig } from "./config";
import type { AppConfig, PostInput, PostResult } from "./types";

interface InstagramResponse {
  id?: string;
  status?: string;
  status_code?: string;
  media_type?: string;
  media_product_type?: string;
  error?: { message?: string };
}

interface InstagramPollingOptions {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_POLL_ATTEMPTS = 10;
const DEFAULT_POLL_INTERVAL_MS = 5000;

async function postForm(
  endpoint: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<InstagramResponse> {
  const response = await fetchImpl(endpoint, { method: "POST", body });
  const payload = (await response.json()) as InstagramResponse;
  if (!response.ok || payload.error || !payload.id) {
    throw new Error(payload.error?.message || `Instagram request failed with ${response.status}`);
  }
  return payload;
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
  config: AppConfig,
  fetchImpl: typeof fetch,
  options: InstagramPollingOptions
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_POLL_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const query = new URLSearchParams({
      fields: "id,media_type,media_product_type",
      access_token: config.metaAccessToken ?? ""
    });
    const response = await fetchImpl(
      `https://graph.facebook.com/${config.graphApiVersion}/${mediaId}?${query}`,
      { method: "GET" }
    );
    const payload = (await response.json()) as InstagramResponse;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Instagram published Reel verification failed with ${response.status}`);
    }
    if (payload.media_type === "VIDEO" && payload.media_product_type === "REELS") return;
    if (attempt < maxAttempts) await sleep(intervalMs);
  }

  throw new Error(`Instagram published media ${mediaId} was not verified as a Reel.`);
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

  return {
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: published.id
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

  return {
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: published.id
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

  await waitForPublishedReel(published.id ?? "", config, fetchImpl, pollingOptions);

  return {
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: published.id
  };
}
