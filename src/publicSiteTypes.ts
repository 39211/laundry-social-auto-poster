/**
 * Shared public-site types. Kept in a leaf module so the catalog validator and
 * the generator can share a contract without a runtime circular import.
 */

export const PRODUCTION_PUBLIC_SITE_BASE_URL = "https://sixiangjialaundry.com";

export const KNOWN_SERVICE_SLUGS = [
  "shoe-bag-care",
  "white-shoe-cleaning",
  "fabric-storage",
  "taichung-xitun-laundry",
  "business-bulk-laundry",
  "taichung-citywide-laundry-pickup",
  "taichung-laundry-price-list"
] as const;

export type KnownServiceSlug = (typeof KNOWN_SERVICE_SLUGS)[number];

export type SupportPageCategory = "guide" | "local";

export interface SupportFaq {
  question: string;
  answer: string;
}

export interface SupportStep {
  name: string;
  text: string;
}

export interface SupportSection {
  heading: string;
  body: string;
}

/** Public page definition consumed by the generator. No catalog provenance. */
export interface SupportPageDefinition {
  slug: string;
  path: string;
  category: SupportPageCategory;
  title: string;
  description: string;
  h1: string;
  summary: string;
  keywords: string[];
  service_slug?: string;
  local_intent: string;
  /** Stable YYYY-MM-DD used for sitemap lastmod when content last intentionally changed. */
  content_lastmod?: string;
  steps: SupportStep[];
  /** Optional long-form sections; omitted pages keep the existing support-page shape. */
  sections?: SupportSection[];
  /** Standalone AEO first paragraph, at most 50 zh characters when set. */
  citation_answer?: string;
  faqs: SupportFaq[];
  /** Crawlable related guide slugs. Existing pages omit this and keep their HTML shape. */
  related_slugs?: string[];
  hub_group?: "shoes" | "bags" | "textiles" | "decisions" | "local";
}

export type GscEvidenceState =
  | "generated"
  | "submitted"
  | "crawled"
  | "indexed"
  | "discovered_not_indexed"
  | "unknown";

export function isKnownServiceSlug(slug: string | undefined): slug is KnownServiceSlug {
  return Boolean(slug && (KNOWN_SERVICE_SLUGS as readonly string[]).includes(slug));
}

export function assertProductionPublicSiteBaseUrl(url: string | undefined): asserts url is string {
  const normalized = url?.replace(/\/+$/u, "");
  if (normalized !== PRODUCTION_PUBLIC_SITE_BASE_URL) {
    throw new Error(
      `production public site base URL must be ${PRODUCTION_PUBLIC_SITE_BASE_URL}; received ${url ?? "(missing)"}`
    );
  }
}
