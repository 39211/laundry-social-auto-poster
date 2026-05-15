import { assertLiveMetaConfig } from "./config";
import type { AppConfig, PostInput, PostResult } from "./types";

interface InstagramResponse {
  id?: string;
  error?: { message?: string };
}

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

export async function postInstagramPhoto(
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch
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
    new URLSearchParams({
      image_url: input.imageUrl,
      caption: input.caption,
      access_token: config.metaAccessToken ?? ""
    }),
    fetchImpl
  );

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
