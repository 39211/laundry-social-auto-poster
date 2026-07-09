import "dotenv/config";
import type { AppConfig } from "./types";

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

function hasUsableCredentialValue(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  return !/^(\[.*\]|<.*>|your[-_].*|example.*|xxx.*|changeme|todo|set|present|redacted|true|false|\*+)$/i.test(
    trimmed
  );
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dryRun = boolEnv(env.DRY_RUN, true);

  return {
    dryRun,
    timezone: env.TIMEZONE || "Asia/Taipei",
    graphApiVersion: env.META_GRAPH_API_VERSION || "v25.0",
    metaAccessToken: env.META_ACCESS_TOKEN,
    metaAnalyticsAccessToken: env.META_ANALYTICS_ACCESS_TOKEN,
    facebookPageId: env.FB_PAGE_ID,
    instagramUserId: env.IG_USER_ID,
    publicSiteBaseUrl: (env.PUBLIC_SITE_BASE_URL || env.PUBLIC_IMAGE_BASE_URL || "").replace(/\/+$/, ""),
    publicImageBaseUrl: (env.PUBLIC_IMAGE_BASE_URL || "").replace(/\/+$/, ""),
    publicRootPagesRepo: env.PUBLIC_ROOT_PAGES_REPO || "",
    verifyPublicImageUrl: boolEnv(env.VERIFY_PUBLIC_IMAGE_URL, !dryRun)
  };
}

export function hasUsablePublicImageBaseUrl(value: string | undefined): boolean {
  return Boolean(value && !value.includes("example.github.io") && /^https:\/\/[^/]+(?:\/.*)?$/.test(value));
}

export function assertPublicImageBaseUrl(config: AppConfig): void {
  if (!hasUsablePublicImageBaseUrl(config.publicImageBaseUrl)) {
    throw new Error(
      "PUBLIC_IMAGE_BASE_URL is required before post-current-slot. Set it to your public HTTPS asset base URL, for example https://your-site.netlify.app or https://<github-username>.github.io/laundry-social-auto-poster"
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
  ].filter(([, value]) => !hasUsableCredentialValue(value));

  if (missing.length > 0) {
    throw new Error(`Live posting is missing env vars: ${missing.map(([name]) => name).join(", ")}`);
  }
}
