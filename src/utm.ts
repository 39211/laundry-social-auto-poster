export const UTM_SOURCES = ["facebook", "instagram", "youtube", "gbp"] as const;
export type UtmSource = (typeof UTM_SOURCES)[number];

export type UtmCampaignKind = "slot" | "reel";

export interface UtmTagInput {
  source: UtmSource;
  campaign: string;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

function isUtmSource(value: string): value is UtmSource {
  return (UTM_SOURCES as readonly string[]).includes(value);
}

/** `<date>-slot<N>` for feed posts; `<date>-reel` for Reels/Shorts. */
export function utmCampaign(date: string, slot: number, kind: UtmCampaignKind = "slot"): string {
  return kind === "reel" ? `${date}-reel` : `${date}-slot${slot}`;
}

/**
 * Single place that writes utm_source / utm_medium / utm_campaign.
 * Existing query keys stay; a URL that already carries any utm_* is left alone.
 */
export function utmTagged(url: string, input: UtmTagInput): string {
  if (!isUtmSource(input.source)) {
    throw new Error(`utmTagged source must be facebook|instagram|youtube|gbp, got: ${input.source}`);
  }
  if (!input.campaign.trim()) {
    throw new Error("utmTagged campaign is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`utmTagged requires an absolute URL, got: ${url}`);
  }

  if (UTM_KEYS.some((key) => parsed.searchParams.has(key))) {
    return url;
  }

  parsed.searchParams.set("utm_source", input.source);
  parsed.searchParams.set("utm_medium", "social");
  parsed.searchParams.set("utm_campaign", input.campaign);
  return parsed.toString();
}
