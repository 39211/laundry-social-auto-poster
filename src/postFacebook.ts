import { assertLiveMetaConfig } from "./config";
import type { AppConfig, PostInput, PostResult } from "./types";

interface FacebookResponse {
  id?: string;
  post_id?: string;
  error?: { message?: string };
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
  const payload = (await response.json()) as FacebookResponse;

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Facebook publish failed with ${response.status}`);
  }

  return {
    platform: "facebook",
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: payload.post_id || payload.id
  };
}
