import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface Aeo325Item {
  id: string;
  slug: string;
  draft_url: string;
  [key: string]: unknown;
}

export interface Aeo325Approval {
  ID: string;
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  page_mapping: string | null;
  index_eligible: boolean;
}

export interface Aeo325PublicOutput {
  path: string;
  contents: string;
}

export interface Aeo325SitemapCandidate {
  ID: string;
  url: string;
  canonical: string;
  noindex: boolean;
  redirect: boolean;
}

export interface Aeo325GuardrailConfig {
  items: Aeo325Item[];
  approvals: Aeo325Approval[];
  preExistingSlugs: string[];
}

export type Aeo325OutputChannel = "html" | "service-jsonld" | "faq-jsonld" | "ai-data" | "feed" | "internal-link";

const EXPECTED_ITEM_COUNT = 325;
const APPROVAL_FIELDS = ["ID", "approved", "approved_by", "approved_at", "page_mapping", "index_eligible"] as const;
const STRUCTURED_TEXT_EXTENSIONS = new Set([".html", ".json", ".jsonl", ".xml", ".txt", ".webmanifest", ".md"]);
const BINARY_OUTPUT_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".mp4", ".mov", ".webm", ".mp3", ".wav", ".m4a",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".pdf", ".zip", ".gz", ".br", ".wasm"
]);
const ALLOWED_PRE_EXISTING_SLUGS = ["down-vest-cleaning", "gore-tex-jacket-cleaning"] as const;

function itemId(item: Aeo325Item): string {
  return typeof item.id === "string" ? item.id : "";
}

function absoluteHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  return parsed.href;
}

function approvalIndex(approvals: readonly Aeo325Approval[]): Map<string, Aeo325Approval> {
  return new Map(approvals.map((approval) => [approval.ID, approval]));
}

export function validateAeo325Approvals(items: readonly Aeo325Item[], approvals: readonly Aeo325Approval[]): void {
  const itemsById = new Map<string, Aeo325Item>();
  const slugSet = new Set<string>();
  for (const item of items) {
    const id = itemId(item);
    if (!id) throw new Error("AEO325 item is missing id");
    if (itemsById.has(id)) throw new Error(`duplicate AEO325 item ID: ${id}`);
    if (!item.slug || typeof item.slug !== "string") throw new Error(`AEO325 item ${id} is missing slug`);
    if (slugSet.has(item.slug)) throw new Error(`duplicate AEO325 slug: ${item.slug}`);
    if (typeof item.draft_url !== "string" || !item.draft_url) throw new Error(`AEO325 item ${id} is missing draft_url`);
    itemsById.set(id, item);
    slugSet.add(item.slug);
  }

  const approvalById = new Map<string, Aeo325Approval>();
  for (const row of approvals) {
    if (!row || typeof row !== "object") throw new Error("AEO325 approval row must be an object");
    const keys = Object.keys(row);
    const unexpected = keys.filter((key) => !(APPROVAL_FIELDS as readonly string[]).includes(key));
    if (unexpected.length > 0) throw new Error(`AEO325 approval ${String(row.ID)} has unexpected fields: ${unexpected.join(", ")}`);
    if (typeof row.ID !== "string" || !row.ID) throw new Error("AEO325 approval row is missing ID");
    if (approvalById.has(row.ID)) throw new Error(`duplicate AEO325 approval ID: ${row.ID}`);
    if (!itemsById.has(row.ID)) throw new Error(`unknown AEO325 approval ID: ${row.ID}`);
    if (typeof row.approved !== "boolean") throw new Error(`AEO325 approval ${row.ID} approved must be boolean`);
    if (typeof row.index_eligible !== "boolean") throw new Error(`AEO325 approval ${row.ID} index_eligible must be explicit boolean`);
    if (row.page_mapping !== null && typeof row.page_mapping !== "string") {
      throw new Error(`AEO325 approval ${row.ID} page_mapping must be URL or null`);
    }
    if (row.approved) {
      if (typeof row.approved_by !== "string" || !row.approved_by.trim()) {
        throw new Error(`AEO325 approval ${row.ID} approved_by is required when approved=true`);
      }
      if (typeof row.approved_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(row.approved_at) || Number.isNaN(Date.parse(row.approved_at))) {
        throw new Error(`AEO325 approval ${row.ID} approved_at must be an ISO 8601 timestamp`);
      }
      if (row.page_mapping === null) throw new Error(`AEO325 approval ${row.ID} page_mapping is required when approved=true`);
      absoluteHttpsUrl(row.page_mapping, `AEO325 approval ${row.ID} page_mapping`);
    } else if (row.approved_by !== null || row.approved_at !== null || row.page_mapping !== null || row.index_eligible) {
      throw new Error(`unapproved AEO325 approval ${row.ID} must keep approver, timestamp, mapping, and index eligibility empty`);
    }
    if (row.index_eligible && (!row.approved || row.page_mapping === null)) {
      throw new Error(`AEO325 approval ${row.ID} cannot be index eligible without approval and page_mapping`);
    }
    approvalById.set(row.ID, row);
  }

  for (const id of itemsById.keys()) {
    if (!approvalById.has(id)) throw new Error(`missing AEO325 approval ID: ${id}`);
  }
}

export async function loadAeo325Guardrail(root: string): Promise<Aeo325GuardrailConfig> {
  const configRoot = join(root, "config", "aeo325");
  const itemDocument = JSON.parse(await readFile(join(configRoot, "items.json"), "utf8")) as {
    count?: number;
    items?: Aeo325Item[];
  };
  const approvals = JSON.parse(await readFile(join(configRoot, "approvals.json"), "utf8")) as Aeo325Approval[];
  if (!Array.isArray(itemDocument.items) || itemDocument.items.length !== EXPECTED_ITEM_COUNT || itemDocument.count !== EXPECTED_ITEM_COUNT) {
    throw new Error(`AEO325 items.json must contain ${EXPECTED_ITEM_COUNT} items`);
  }
  if (!Array.isArray(approvals)) throw new Error("AEO325 approvals.json must be an array");
  validateAeo325Approvals(itemDocument.items, approvals);

  const baselinePath = join(configRoot, "public-url-baseline.json");
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as {
    pre_existing_slugs?: Array<{ slug?: string; reason?: string }>;
  };
  const preExistingSlugs = baseline.pre_existing_slugs;
  if (!Array.isArray(preExistingSlugs) || preExistingSlugs.some((entry) =>
    !entry ||
    typeof entry.slug !== "string" ||
    typeof entry.reason !== "string" ||
    !entry.reason.trim()
  )) {
    throw new Error("AEO325 public URL baseline has invalid pre_existing_slugs");
  }
  const slugs = preExistingSlugs.map((entry) => entry.slug as string);
  if (
    slugs.length !== ALLOWED_PRE_EXISTING_SLUGS.length ||
    new Set(slugs).size !== slugs.length ||
    [...slugs].sort().some((slug, index) => slug !== [...ALLOWED_PRE_EXISTING_SLUGS].sort()[index])
  ) {
    throw new Error("AEO325 public URL baseline pre_existing_slugs must contain only the two established legacy slugs");
  }
  return { items: itemDocument.items, approvals, preExistingSlugs: slugs };
}

export function filterAeo325OutputRecords<T extends { ID: string }>(
  items: readonly Aeo325Item[],
  approvals: readonly Aeo325Approval[],
  records: readonly T[],
  _channel: Aeo325OutputChannel
): T[] {
  validateAeo325Approvals(items, approvals);
  const byId = approvalIndex(approvals);
  const knownIds = new Set(items.map(itemId));
  return records.filter((record) => {
    if (!knownIds.has(record.ID)) throw new Error(`unknown AEO325 output ID: ${record.ID}`);
    const approval = byId.get(record.ID);
    return Boolean(approval?.approved && approval.page_mapping);
  });
}

export function filterAeo325SitemapCandidates<T extends Aeo325SitemapCandidate>(
  items: readonly Aeo325Item[],
  approvals: readonly Aeo325Approval[],
  candidates: readonly T[]
): T[] {
  validateAeo325Approvals(items, approvals);
  const byId = approvalIndex(approvals);
  const knownIds = new Set(items.map(itemId));
  return candidates.filter((candidate) => {
    if (!knownIds.has(candidate.ID)) throw new Error(`unknown AEO325 sitemap candidate ID: ${candidate.ID}`);
    const approval = byId.get(candidate.ID);
    if (!approval?.approved || !approval.index_eligible || !approval.page_mapping || candidate.noindex || candidate.redirect) return false;
    const mapping = absoluteHttpsUrl(approval.page_mapping, `AEO325 approval ${candidate.ID} page_mapping`);
    const url = absoluteHttpsUrl(candidate.url, `AEO325 sitemap candidate ${candidate.ID} url`);
    const canonical = absoluteHttpsUrl(candidate.canonical, `AEO325 sitemap candidate ${candidate.ID} canonical`);
    return url === mapping && canonical === mapping;
  });
}

export function assertNoUnapprovedAeo325Slugs(
  items: readonly Aeo325Item[],
  approvals: readonly Aeo325Approval[],
  outputs: readonly Aeo325PublicOutput[],
  preExistingSlugs: readonly string[] = []
): void {
  validateAeo325Approvals(items, approvals);
  const approvedIds = new Set(approvals.filter((row) => row.approved).map((row) => row.ID));
  const preExistingSlugSet = new Set(preExistingSlugs.map((slug) => slug.toLowerCase()));
  const unapprovedBySlug = new Map(
    items.filter((item) => !approvedIds.has(item.id)).map((item) => [item.slug.toLowerCase(), item.slug])
  );
  const slugAlternation = [...unapprovedBySlug.keys()]
    .map((slug) => slug.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  const htmlSlugUrl = slugAlternation ? new RegExp(`(?:^|[^a-z0-9-])(${slugAlternation})\\.html?`, "gu") : undefined;
  const pathSlugUrl = slugAlternation ? new RegExp(`/(${slugAlternation})(?![a-z0-9_-])`, "gu") : undefined;
  const slugTokens = /[a-z0-9_-]+/giu;
  const normalizeForMatching = (value: string): string => value
    .toLowerCase()
    .replaceAll("%2f", "/")
    .replaceAll("%3a", ":")
    .replaceAll("\\/", "/")
    .replaceAll("\\\\", "/");

  for (const output of outputs) {
    const normalizedPath = output.path.replace(/\\/gu, "/");
    const matchingPath = normalizeForMatching(normalizedPath);
    const normalizedContents = normalizeForMatching(output.contents);
    const source = `${matchingPath}\n${normalizedContents}`;
    const basename = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
    const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")).toLowerCase() : "";
    const structuredText = STRUCTURED_TEXT_EXTENSIONS.has(extension);
    const rejectIfUnapproved = (matchedSlug: string): void => {
      const slug = unapprovedBySlug.get(matchedSlug.toLowerCase());
      if (!slug || preExistingSlugSet.has(slug.toLowerCase())) return;
      throw new Error(`unapproved AEO325 slug ${slug} appears in public output ${normalizedPath}`);
    };
    for (const match of matchingPath.matchAll(slugTokens)) rejectIfUnapproved(match[0]);
    if (structuredText) {
      for (const match of normalizedContents.matchAll(slugTokens)) rejectIfUnapproved(match[0]);
      continue;
    }
    for (const pattern of [htmlSlugUrl, pathSlugUrl]) {
      if (!pattern) continue;
      for (const match of source.matchAll(pattern)) rejectIfUnapproved(match[1] ?? "");
    }
  }
}

async function listPublicOutputs(docsRoot: string): Promise<Aeo325PublicOutput[]> {
  const output: Aeo325PublicOutput[] = [];
  const visitedDirectories = new Set<string>();
  async function walk(directory: string): Promise<void> {
    const canonicalDirectory = await realpath(directory);
    if (visitedDirectories.has(canonicalDirectory)) return;
    visitedDirectories.add(canonicalDirectory);

    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const entryStat = await stat(absolutePath);
      if (entryStat.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const path = relative(docsRoot, absolutePath).split(sep).join("/");
      const basename = path.slice(path.lastIndexOf("/") + 1);
      const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")).toLowerCase() : "";
      const contents = BINARY_OUTPUT_EXTENSIONS.has(extension) ? "" : await readFile(absolutePath, "utf8");
      output.push({ path: `docs/${path}`, contents });
    }
  }
  await walk(docsRoot);
  return output;
}

export async function assertAeo325PublicOutputSafety(root: string, configRoot = root): Promise<void> {
  const config = await loadAeo325Guardrail(configRoot);
  const outputs = await listPublicOutputs(join(root, "docs"));
  assertNoUnapprovedAeo325Slugs(config.items, config.approvals, outputs, config.preExistingSlugs);
}
