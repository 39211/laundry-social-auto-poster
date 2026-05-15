import "dotenv/config";
import type { AppConfig } from "./types";

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dryRun = boolEnv(env.DRY_RUN, true);

  return {
    dryRun,
    timezone: env.TIMEZONE || "Asia/Taipei",
    graphApiVersion: env.META_GRAPH_API_VERSION || "v25.0",
    metaAccessToken: env.META_ACCESS_TOKEN,
    facebookPageId: env.FB_PAGE_ID,
    instagramUserId: env.IG_USER_ID,
    publicImageBaseUrl: (env.PUBLIC_IMAGE_BASE_URL || "").replace(/\/+$/, ""),
    verifyPublicImageUrl: boolEnv(env.VERIFY_PUBLIC_IMAGE_URL, !dryRun)
  };
}

export function hasUsablePublicImageBaseUrl(value: string | undefined): boolean {
  return Boolean(value && !value.includes("example.github.io") && /^https:\/\/[^/]+\/.+/.test(value));
}

export function assertPublicImageBaseUrl(config: AppConfig): void {
  if (!hasUsablePublicImageBaseUrl(config.publicImageBaseUrl)) {
    throw new Error(
      "PUBLIC_IMAGE_BASE_URL is required before post-current-slot. Set it to your GitHub Pages URL, for example https://<github-username>.github.io/laundry-social-auto-poster"
    );
  }
}

export function assertLiveMetaConfig(config: AppConfig): void {
  if (config.dryRun) return;
  assertPublicImageBaseUrl(config);

  const missing = [
    ["META_ACCESS_TOKEN", config.metaAccessToken],
    ["FB_PAGE_ID", config.facebookPageId],
    ["IG_USER_ID", config.instagramUserId]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Live posting is missing env vars: ${missing.map(([name]) => name).join(", ")}`);
  }
}
