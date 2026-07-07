import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { projectRoot } from "./paths";

type AuditMode = "public" | "local";

interface ImageReference {
  kind: string;
  file: string;
  src: string;
  url: string;
  alt: string | null;
}

interface OgImageReference {
  file: string;
  url: string;
}

interface SchemaImageReference {
  file: string;
  url: string;
  caption: string;
}

interface UrlStatus {
  url: string;
  status: number;
  ok: boolean;
  content_type: string;
  final_url?: string;
  error?: string;
}

interface NapStatus {
  docs_profile_matches_data: boolean;
  homepage_contains: Record<string, boolean>;
}

export interface PublicSiteAuditResult {
  generated_at: string;
  mode: AuditMode;
  site_base_url: string;
  html_file_count: number;
  json_file_count: number;
  image_reference_count: number;
  unique_image_url_count: number;
  img_tag_count: number;
  og_image_count: number;
  schema_image_count: number;
  alt_issues: Array<{ file: string; src: string; reason: string }>;
  schema_parse_errors: Array<{ file: string; error: string }>;
  broken_urls: UrlStatus[];
  non_image_content_types: UrlStatus[];
  nap: NapStatus;
}

export interface AuditPublicSiteOptions {
  root?: string;
  siteBaseUrl?: string;
  mode?: AuditMode;
  retries?: number;
  retryMs?: number;
  fetchImpl?: typeof fetch;
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const info = statSync(directory);
  if (info.isFile()) return [directory];
  if (!info.isDirectory()) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    walkFiles(join(directory, entry.name))
  );
}

function toSitePath(filePath: string, docsRoot: string): string {
  return relative(docsRoot, filePath).replaceAll("\\", "/");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeSiteBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveReferenceUrl(value: string, filePath: string, docsRoot: string, siteBaseUrl: string): string {
  if (!value || value.startsWith("data:") || value.startsWith("mailto:") || value.startsWith("#")) return "";
  if (/^https?:\/\//i.test(value)) return value;

  const base = new URL(toSitePath(filePath, docsRoot), `${normalizeSiteBaseUrl(siteBaseUrl)}/`);
  return new URL(value, base).href;
}

function collectJsonLdImages(value: unknown, file: string, references: SchemaImageReference[]): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;

    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }

    const record = item as Record<string, unknown>;
    if (record["@type"] === "ImageObject") {
      const url = record.contentUrl ?? record.url;
      if (typeof url === "string") {
        references.push({
          file,
          url,
          caption: typeof record.caption === "string" ? record.caption : ""
        });
      }
    }

    stack.push(...Object.values(record).filter((child) => child && typeof child === "object"));
  }
}

function collectJsonImages(value: unknown, file: string, references: ImageReference[]): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;

    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }

    const record = item as Record<string, unknown>;
    for (const key of ["image_url", "image"]) {
      const url = record[key];
      if (typeof url === "string") {
        references.push({ kind: `json-${key}`, file, src: url, url, alt: null });
      }
    }

    stack.push(...Object.values(record).filter((child) => child && typeof child === "object"));
  }
}

function collectReferences(docsRoot: string, siteBaseUrl: string): {
  htmlFiles: string[];
  jsonFiles: string[];
  imageReferences: ImageReference[];
  ogImageReferences: OgImageReference[];
  schemaImageReferences: SchemaImageReference[];
  altIssues: Array<{ file: string; src: string; reason: string }>;
  schemaParseErrors: Array<{ file: string; error: string }>;
} {
  const htmlFiles = walkFiles(docsRoot).filter((file) => file.endsWith(".html"));
  const jsonFiles = walkFiles(docsRoot).filter((file) => file.endsWith(".json") || file.endsWith(".jsonl"));
  const imageReferences: ImageReference[] = [];
  const ogImageReferences: OgImageReference[] = [];
  const schemaImageReferences: SchemaImageReference[] = [];
  const altIssues: Array<{ file: string; src: string; reason: string }> = [];
  const schemaParseErrors: Array<{ file: string; error: string }> = [];

  for (const filePath of htmlFiles) {
    const file = toSitePath(filePath, docsRoot);
    const html = readFileSync(filePath, "utf8");

    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? "";
      const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1];
      const url = resolveReferenceUrl(src, filePath, docsRoot, siteBaseUrl);
      if (!url) continue;

      imageReferences.push({ kind: "img", file, src, url, alt: alt ?? null });
      if (alt === undefined || alt.trim() === "") {
        altIssues.push({ file, src, reason: alt === undefined ? "missing-alt" : "empty-alt" });
      }
    }

    for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi)) {
      const content = match[0].match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? "";
      const url = resolveReferenceUrl(content, filePath, docsRoot, siteBaseUrl);
      if (url) ogImageReferences.push({ file, url });
    }

    for (const match of html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )) {
      try {
        const beforeCount = schemaImageReferences.length;
        collectJsonLdImages(JSON.parse(match[1] ?? ""), file, schemaImageReferences);
        for (const reference of schemaImageReferences.slice(beforeCount)) {
          reference.url = resolveReferenceUrl(reference.url, filePath, docsRoot, siteBaseUrl);
        }
      } catch (error) {
        schemaParseErrors.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  for (const filePath of jsonFiles) {
    const file = toSitePath(filePath, docsRoot);
    const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    if (filePath.endsWith(".jsonl")) {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        try {
          collectJsonImages(JSON.parse(line), file, imageReferences);
        } catch {
          // JSONL ingestion is best-effort for audits; invalid lines are covered by normal tests.
        }
      }
    } else {
      try {
        const parsed = JSON.parse(text);
        const beforeImageCount = imageReferences.length;
        const beforeSchemaCount = schemaImageReferences.length;
        collectJsonImages(parsed, file, imageReferences);
        collectJsonLdImages(parsed, file, schemaImageReferences);
        for (const reference of imageReferences.slice(beforeImageCount)) {
          reference.url = resolveReferenceUrl(reference.url, filePath, docsRoot, siteBaseUrl);
        }
        for (const reference of schemaImageReferences.slice(beforeSchemaCount)) {
          reference.url = resolveReferenceUrl(reference.url, filePath, docsRoot, siteBaseUrl);
        }
      } catch {
        // Invalid JSON files are outside this audit's scope and are covered by generator tests.
      }
    }
  }

  return {
    htmlFiles,
    jsonFiles,
    imageReferences,
    ogImageReferences,
    schemaImageReferences,
    altIssues,
    schemaParseErrors
  };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkUrl(url: string, fetchImpl: typeof fetch): Promise<UrlStatus> {
  try {
    let response = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
    if (!response.ok || response.status === 405) {
      response = await fetchImpl(url, { method: "GET", redirect: "follow" });
    }
    return {
      url,
      status: response.status,
      ok: response.ok,
      content_type: response.headers.get("content-type") ?? "",
      final_url: response.url
    };
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      content_type: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkUrlWithRetries(
  url: string,
  fetchImpl: typeof fetch,
  retries: number,
  retryMs: number
): Promise<UrlStatus> {
  let latest = await checkUrl(url, fetchImpl);
  for (let attempt = 0; !latest.ok && attempt < retries; attempt += 1) {
    await sleep(retryMs);
    latest = await checkUrl(url, fetchImpl);
  }
  return latest;
}

function auditNap(root: string, docsRoot: string): NapStatus {
  const profilePath = join(root, "data", "business-profile.json");
  const publicProfilePath = join(docsRoot, "business-profile.json");
  const homepagePath = join(docsRoot, "index.html");

  const profile = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>;
  const publicProfile = JSON.parse(readFileSync(publicProfilePath, "utf8")) as Record<string, unknown>;
  const homepage = existsSync(homepagePath) ? readFileSync(homepagePath, "utf8") : "";
  const address = profile.address as Record<string, unknown> | undefined;
  const openingHours = profile.opening_hours_text;
  const lineId = profile.line_id;
  const mobileOrLine = profile.mobile_or_line_local;

  return {
    docs_profile_matches_data: JSON.stringify(profile) === JSON.stringify(publicProfile),
    homepage_contains: {
      name: typeof profile.name === "string" && homepage.includes(profile.name),
      google_business_profile_name:
        typeof profile.google_business_profile_name === "string" &&
        homepage.includes(profile.google_business_profile_name),
      address_text: typeof profile.address_text === "string" && homepage.includes(profile.address_text),
      street_address: typeof address?.streetAddress === "string" && homepage.includes(address.streetAddress),
      telephone: typeof profile.telephone_local === "string" && homepage.includes(profile.telephone_local),
      line:
        (typeof lineId === "string" && homepage.includes(lineId)) ||
        (typeof mobileOrLine === "string" && homepage.includes(mobileOrLine)),
      opening_hours: typeof openingHours === "string" && homepage.includes(openingHours),
      weekday_hours: homepage.includes("10:00-20:00"),
      saturday_hours: homepage.includes("12:00-18:00")
    }
  };
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(url);
}

export async function auditPublicSite(options: AuditPublicSiteOptions = {}): Promise<PublicSiteAuditResult> {
  const root = projectRoot(options.root);
  const docsRoot = join(root, "docs");
  const siteBaseUrl = normalizeSiteBaseUrl(options.siteBaseUrl || "https://39211.github.io");
  const mode = options.mode ?? "public";
  const retries = options.retries ?? 1;
  const retryMs = options.retryMs ?? 30000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const collected = collectReferences(docsRoot, siteBaseUrl);
  const imageUrls = unique(
    [
      ...collected.imageReferences.map((reference) => reference.url),
      ...collected.ogImageReferences.map((reference) => reference.url),
      ...collected.schemaImageReferences.map((reference) => reference.url)
    ].filter(Boolean)
  );
  const statuses =
    mode === "public"
      ? await Promise.all(imageUrls.map((url) => checkUrlWithRetries(url, fetchImpl, retries, retryMs)))
      : [];
  const brokenUrls = statuses.filter((status) => !status.ok);
  const nonImageContentTypes = statuses.filter(
    (status) => status.ok && isImageUrl(status.url) && status.content_type && !/image/i.test(status.content_type)
  );

  return {
    generated_at: new Date().toISOString(),
    mode,
    site_base_url: siteBaseUrl,
    html_file_count: collected.htmlFiles.length,
    json_file_count: collected.jsonFiles.length,
    image_reference_count: collected.imageReferences.length,
    unique_image_url_count: imageUrls.length,
    img_tag_count: collected.imageReferences.filter((reference) => reference.kind === "img").length,
    og_image_count: collected.ogImageReferences.length,
    schema_image_count: collected.schemaImageReferences.length,
    alt_issues: collected.altIssues,
    schema_parse_errors: collected.schemaParseErrors,
    broken_urls: brokenUrls,
    non_image_content_types: nonImageContentTypes,
    nap: auditNap(root, docsRoot)
  };
}

export function publicSiteAuditFailures(result: PublicSiteAuditResult): string[] {
  const failures = [
    ...result.alt_issues.map((issue) => `Missing image alt in ${issue.file}: ${issue.src}`),
    ...result.schema_parse_errors.map((issue) => `Invalid JSON-LD in ${issue.file}: ${issue.error}`),
    ...result.broken_urls.map((issue) => `Broken image URL ${issue.status}: ${issue.url}`),
    ...result.non_image_content_types.map((issue) => `Non-image content type ${issue.content_type}: ${issue.url}`)
  ];
  if (!result.nap.docs_profile_matches_data) {
    failures.push("NAP mismatch: docs/business-profile.json differs from data/business-profile.json");
  }
  for (const [field, present] of Object.entries(result.nap.homepage_contains)) {
    if (!present) failures.push(`NAP missing from homepage: ${field}`);
  }
  return failures;
}

export function formatPublicSiteAudit(result: PublicSiteAuditResult): string {
  const failures = publicSiteAuditFailures(result);
  return [
    "Public site audit ready:",
    `- mode: ${result.mode}`,
    `- html files: ${result.html_file_count}`,
    `- json files: ${result.json_file_count}`,
    `- image references: ${result.image_reference_count}`,
    `- unique image URLs: ${result.unique_image_url_count}`,
    `- img tags: ${result.img_tag_count}`,
    `- missing alt: ${result.alt_issues.length}`,
    `- OG images: ${result.og_image_count}`,
    `- schema images: ${result.schema_image_count}`,
    `- broken URLs: ${result.broken_urls.length}`,
    `- non-image content types: ${result.non_image_content_types.length}`,
    `- NAP docs profile matches source: ${result.nap.docs_profile_matches_data ? "yes" : "no"}`,
    `- NAP homepage fields: ${Object.entries(result.nap.homepage_contains)
      .map(([field, present]) => `${field}=${present ? "yes" : "no"}`)
      .join(", ")}`,
    ...(failures.length > 0 ? ["", "Failures:", ...failures.map((failure) => `- ${failure}`)] : [])
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const modeOption = getOption(args, "mode");
  const mode: AuditMode = modeOption === "local" ? "local" : "public";
  const result = await auditPublicSite({
    root: projectRoot(getOption(args, "root")),
    siteBaseUrl: getOption(args, "site-base-url") || config.publicImageBaseUrl,
    mode,
    retries: getNumberOption(args, "retries") ?? 1,
    retryMs: getNumberOption(args, "retry-ms") ?? 30000
  });
  if (getFlag(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPublicSiteAudit(result));
  }
  const failures = publicSiteAuditFailures(result);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
