import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { type GscDayReport, type GscQueryRow } from "./gscSearchAnalytics";
import { type IndexInspectionReport, type UrlInspectionRow } from "./gscIndexInspection";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

// This is deliberately a candidate generator, not a content publisher. GSC
// observations can identify an opportunity, but cannot verify a service fact,
// price, photograph, or customer-facing wording. Those remain human-reviewed
// before any existing page is changed or deployed.
const POLICY_VERSION = "2026-09-01-draft-only-v1";
const MAX_INPUT_AGE_MS = 36 * 60 * 60 * 1000;
const PAGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TOTAL_IMPRESSIONS = 50;
const MIN_IMPRESSIONS = 20;

export const DRAFT_ONLY = "DRAFT_ONLY" as const;
export const FORBIDDEN_ACTIONS = [
  "no_content_generation",
  "no_public_site_write",
  "no_deploy",
  "no_gsc_index_request",
  "no_indexnow",
  "no_network_call",
  "no_backlink_or_listing_submission",
  "no_new_url"
] as const;

type CandidateCluster = "shoes_bags" | "clothing_bedding_pickup";
type CandidateStatus = "BLOCKED" | "NOOP" | "CANDIDATE";

export interface CandidateEvidence {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SeoCandidate {
  canonical_page: string;
  service_cluster: CandidateCluster;
  evidence: CandidateEvidence[];
  evidence_totals: { clicks: number; impressions: number; ctr: number; weighted_position: number };
  recommended_review: string;
  publication_status: typeof DRAFT_ONLY;
  forbidden_actions: readonly string[];
}

export interface GscSeoCandidateReport {
  type: "gsc_seo_candidate_autopilot";
  policy_version: string;
  generated_at: string;
  status: CandidateStatus;
  reason_codes: string[];
  inputs: {
    gsc_report_path: string | null;
    gsc_fetched_at: string | null;
    gsc_report_sha256: string | null;
    index_report_path: string | null;
    index_generated_at: string | null;
    index_report_sha256: string | null;
    sitemap_path: string;
    sitemap_sha256: string | null;
    input_fingerprint: string | null;
  };
  observed_totals: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null };
  candidate: SeoCandidate | null;
  forbidden_actions: readonly string[];
}

interface LocatedReport<T> {
  path: string;
  value: T;
}

interface EligiblePair extends CandidateEvidence {
  service_cluster: CandidateCluster;
}

type CandidateHistoryState = "clear" | "cooldown" | "malformed";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/u, "");
}

function parseSitemapUrls(xml: string): Set<string> {
  return new Set(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => normalizeUrl(match[1]!.trim()))
  );
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFresh(value: string | null | undefined, now: Date): boolean {
  const timestamp = parseTimestamp(value);
  return timestamp !== null && timestamp <= now.getTime() && now.getTime() - timestamp <= MAX_INPUT_AGE_MS;
}

async function newestJson<T>(directory: string): Promise<LocatedReport<T> | undefined> {
  let entries: string[];
  try {
    entries = (await readdir(directory)).filter((entry) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(entry)).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry);
    try {
      const value = await readJsonFile<T | undefined>(path, undefined);
      if (value !== undefined) return { path, value };
    } catch {
      // A malformed older operational artifact must not be used as evidence.
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isGscRow(value: unknown): value is GscQueryRow {
  return (
    isRecord(value) &&
    Array.isArray(value.keys) &&
    value.keys.every((key) => typeof key === "string") &&
    [value.clicks, value.impressions, value.ctr, value.position].every(isFiniteNumber)
  );
}

function isGscReport(value: unknown): value is GscDayReport {
  if (!isRecord(value) || typeof value.site_url !== "string" || typeof value.fetched_at !== "string") return false;
  if (!isRecord(value.totals) || !Array.isArray(value.top_queries) || !Array.isArray(value.top_pages)) return false;
  if (![value.totals.clicks, value.totals.impressions, value.totals.ctr, value.totals.position].every(isFiniteNumber)) {
    return false;
  }
  const queryPageRows = value.top_query_pages;
  return (
    value.top_queries.every(isGscRow) &&
    value.top_pages.every(isGscRow) &&
    (queryPageRows === undefined || (Array.isArray(queryPageRows) && queryPageRows.every(isGscRow)))
  );
}

function isIndexRow(value: unknown): value is UrlInspectionRow {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.verdict === "string" &&
    typeof value.coverage_state === "string" &&
    (typeof value.google_canonical === "string" || value.google_canonical === null) &&
    (typeof value.user_canonical === "string" || value.user_canonical === null)
  );
}

function isIndexReport(value: unknown): value is IndexInspectionReport {
  return (
    isRecord(value) &&
    typeof value.site_url === "string" &&
    typeof value.generated_at === "string" &&
    Array.isArray(value.rows) &&
    value.rows.every(isIndexRow)
  );
}

function sameTaipeiDate(timestamp: string, date: string): boolean {
  return getZonedDateParts(new Date(timestamp)).date === date;
}

function fingerprintGscReport(report: GscDayReport): Omit<GscDayReport, "fetched_at"> {
  const { fetched_at: _fetchedAt, ...stable } = report;
  return stable;
}

function fingerprintIndexReport(report: IndexInspectionReport): Omit<IndexInspectionReport, "generated_at"> {
  const { generated_at: _generatedAt, ...stable } = report;
  return stable;
}

function indexedCanonicalRows(report: IndexInspectionReport, sitemapUrls: Set<string>): Set<string> {
  return new Set(
    report.rows
      .filter((row: UrlInspectionRow) => {
        const url = normalizeUrl(row.url);
        return (
          sitemapUrls.has(url) &&
          row.verdict === "PASS" &&
          /^(submitted and indexed|indexed\b)/iu.test(row.coverage_state) &&
          normalizeUrl(row.google_canonical ?? "") === url &&
          normalizeUrl(row.user_canonical ?? "") === url
        );
      })
      .map((row) => normalizeUrl(row.url))
  );
}

function classifyQuery(query: string): CandidateCluster | undefined {
  if (/私享家|思想家|si\s*xiang/iu.test(query)) return undefined;
  if (/洗鞋|鞋子|球鞋|運動鞋|白鞋|鞋臭|鞋味|洗包|包包|皮包|精品包/iu.test(query)) return "shoes_bags";
  if (/洗衣|乾洗|送洗|收送|收衣|洗被|棉被|羽絨|床被|寢具/iu.test(query)) return "clothing_bedding_pickup";
  return undefined;
}

function asPair(row: GscQueryRow): EligiblePair | undefined {
  const query = row.keys?.[0]?.trim();
  const page = row.keys?.[1]?.trim();
  if (
    !query ||
    !page ||
    ![row.clicks, row.impressions, row.ctr, row.position].every(isFiniteNumber) ||
    row.clicks < 0 ||
    row.impressions < 0 ||
    row.ctr < 0 ||
    row.position < 0
  ) {
    return undefined;
  }
  const service_cluster = classifyQuery(query);
  if (!service_cluster) return undefined;
  return {
    query,
    page: normalizeUrl(page),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    service_cluster
  };
}

function candidateFromPairs(pairs: EligiblePair[], indexedPages: Set<string>): SeoCandidate | undefined {
  const grouped = new Map<string, EligiblePair[]>();
  for (const pair of pairs) {
    if (!indexedPages.has(pair.page)) continue;
    const key = `${pair.service_cluster}\u0000${pair.page}`;
    grouped.set(key, [...(grouped.get(key) ?? []), pair]);
  }

  const choices = [...grouped.entries()]
    .map(([key, evidence]) => {
      const [service_cluster, canonical_page] = key.split("\u0000") as [CandidateCluster, string];
      const impressions = evidence.reduce((sum, row) => sum + row.impressions, 0);
      const clicks = evidence.reduce((sum, row) => sum + row.clicks, 0);
      const weightedPosition = impressions
        ? evidence.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions
        : 0;
      return { service_cluster, canonical_page, evidence, impressions, clicks, weightedPosition };
    })
    .filter((choice) => choice.impressions >= MIN_IMPRESSIONS)
    .sort((left, right) => {
      const priority = (cluster: CandidateCluster) => (cluster === "shoes_bags" ? 0 : 1);
      return (
        priority(left.service_cluster) - priority(right.service_cluster) ||
        right.impressions - left.impressions ||
        left.weightedPosition - right.weightedPosition ||
        left.canonical_page.localeCompare(right.canonical_page)
      );
    });

  const selected = choices[0];
  if (!selected) return undefined;
  const evidence = selected.evidence.map(({ service_cluster: _cluster, ...row }) => row);
  const ctr = selected.impressions ? selected.clicks / selected.impressions : 0;
  return {
    canonical_page: selected.canonical_page,
    service_cluster: selected.service_cluster,
    evidence,
    evidence_totals: {
      clicks: selected.clicks,
      impressions: selected.impressions,
      ctr,
      weighted_position: selected.weightedPosition
    },
    recommended_review:
      "僅在既有頁面補可驗證的直接答案與預約資訊；服務範圍、價格、工期、照片與成效均須由店方資料確認，不能自動編造。",
    publication_status: DRAFT_ONLY,
    forbidden_actions: FORBIDDEN_ACTIONS
  };
}

export function assertDraftOnlyCandidate(candidate: SeoCandidate): void {
  if (candidate.publication_status !== DRAFT_ONLY) {
    throw new Error("SEO candidate is not DRAFT_ONLY.");
  }
  if (!candidate.forbidden_actions.includes("no_public_site_write") || !candidate.forbidden_actions.includes("no_deploy")) {
    throw new Error("SEO candidate is missing publication safety constraints.");
  }
}

function isCandidateHistoryReport(value: unknown): value is GscSeoCandidateReport {
  return (
    isRecord(value) &&
    typeof value.generated_at === "string" &&
    (value.status === "BLOCKED" || value.status === "NOOP" || value.status === "CANDIDATE") &&
    isRecord(value.inputs)
  );
}

async function candidateHistoryState(root: string, page: string, now: Date): Promise<CandidateHistoryState> {
  const directory = join(root, "output", "operations", "gsc-seo-candidates");
  let entries: string[];
  try {
    entries = (await readdir(directory)).filter((entry) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(entry));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "clear";
    throw error;
  }
  for (const entry of entries) {
    let report: GscSeoCandidateReport | undefined;
    try {
      report = await readJsonFile<GscSeoCandidateReport | undefined>(join(directory, entry), undefined);
    } catch {
      return "malformed";
    }
    if (!report || !isCandidateHistoryReport(report)) return "malformed";
    const generatedAt = parseTimestamp(report?.generated_at);
    if (
      report?.status === "CANDIDATE" &&
      report.candidate?.canonical_page === page &&
      generatedAt !== null &&
      now.getTime() - generatedAt >= 0 &&
      now.getTime() - generatedAt < PAGE_COOLDOWN_MS
    ) {
      return "cooldown";
    }
  }
  return "clear";
}

export function gscSeoCandidatePath(date: string, root = projectRoot()): string {
  return join(root, "output", "operations", "gsc-seo-candidates", `${date}.json`);
}

export async function createGscSeoCandidateReport(input: {
  root?: string;
  now?: Date;
  outputDate?: string;
} = {}): Promise<{ report: GscSeoCandidateReport; path: string }> {
  const root = projectRoot(input.root);
  const now = input.now ?? new Date();
  const outputDate = input.outputDate ?? getZonedDateParts(now).date;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(outputDate)) {
    throw new Error("--date must use YYYY-MM-DD and cannot name a path.");
  }
  const outputPath = gscSeoCandidatePath(outputDate, root);
  const sitemapPath = join(root, "docs", "sitemap.xml");
  const base: Omit<GscSeoCandidateReport, "status" | "reason_codes" | "candidate"> = {
    type: "gsc_seo_candidate_autopilot",
    policy_version: POLICY_VERSION,
    generated_at: now.toISOString(),
    inputs: {
      gsc_report_path: null,
      gsc_fetched_at: null,
      gsc_report_sha256: null,
      index_report_path: null,
      index_generated_at: null,
      index_report_sha256: null,
      sitemap_path: sitemapPath,
      sitemap_sha256: null,
      input_fingerprint: null
    },
    observed_totals: { clicks: null, impressions: null, ctr: null, position: null },
    forbidden_actions: FORBIDDEN_ACTIONS
  };

  let sitemap: string;
  try {
    sitemap = await readFile(sitemapPath, "utf8");
  } catch {
    const report: GscSeoCandidateReport = { ...base, status: "BLOCKED", reason_codes: ["sitemap_unavailable"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }

  const gsc = await newestJson<unknown>(join(root, "data", "insights", "gsc"));
  const index = await newestJson<unknown>(join(root, "data", "insights", "gsc-index"));
  const gscReport = gsc && isGscReport(gsc.value) ? gsc.value : undefined;
  const indexReport = index && isIndexReport(index.value) ? index.value : undefined;
  const inputs = {
    ...base.inputs,
    gsc_report_path: gsc?.path ?? null,
    gsc_fetched_at: gscReport?.fetched_at ?? null,
    gsc_report_sha256: gscReport ? sha256(JSON.stringify(gscReport)) : null,
    index_report_path: index?.path ?? null,
    index_generated_at: indexReport?.generated_at ?? null,
    index_report_sha256: indexReport ? sha256(JSON.stringify(indexReport)) : null,
    sitemap_sha256: sha256(sitemap),
    input_fingerprint:
      gscReport && indexReport
        ? sha256(
            JSON.stringify({
              policy: POLICY_VERSION,
              sitemap,
              gsc: fingerprintGscReport(gscReport),
              index: fingerprintIndexReport(indexReport)
            })
          )
        : null
  };
  const observed_totals = gscReport
    ? { ...gscReport.totals }
    : { clicks: null, impressions: null, ctr: null, position: null };
  const reportBase = { ...base, inputs, observed_totals };

  if (!gsc || !index) {
    const report: GscSeoCandidateReport = { ...reportBase, status: "BLOCKED", reason_codes: ["required_gsc_input_missing"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (!gscReport || !indexReport) {
    const report: GscSeoCandidateReport = { ...reportBase, status: "BLOCKED", reason_codes: ["required_gsc_input_malformed"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (!isFresh(gscReport.fetched_at, now) || !isFresh(indexReport.generated_at, now)) {
    const report: GscSeoCandidateReport = { ...reportBase, status: "BLOCKED", reason_codes: ["required_gsc_input_stale"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (!sameTaipeiDate(gscReport.fetched_at, outputDate) || !sameTaipeiDate(indexReport.generated_at, outputDate)) {
    const report: GscSeoCandidateReport = {
      ...reportBase,
      status: "BLOCKED",
      reason_codes: ["current_collection_cycle_missing"],
      candidate: null
    };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (gscReport.site_url !== indexReport.site_url) {
    const report: GscSeoCandidateReport = { ...reportBase, status: "BLOCKED", reason_codes: ["gsc_site_mismatch"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (gscReport.totals.impressions < MIN_TOTAL_IMPRESSIONS) {
    const report: GscSeoCandidateReport = {
      ...reportBase,
      status: "NOOP",
      reason_codes: ["insufficient_total_search_impressions"],
      candidate: null
    };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (!Array.isArray(gscReport.top_query_pages)) {
    const report: GscSeoCandidateReport = { ...reportBase, status: "NOOP", reason_codes: ["query_page_evidence_unavailable"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }

  const previous = await newestJson<GscSeoCandidateReport>(join(root, "output", "operations", "gsc-seo-candidates"));
  if (previous && !isCandidateHistoryReport(previous.value)) {
    const report: GscSeoCandidateReport = {
      ...reportBase,
      status: "BLOCKED",
      reason_codes: ["candidate_history_malformed"],
      candidate: null
    };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (previous?.value.inputs.input_fingerprint === inputs.input_fingerprint) {
    const report: GscSeoCandidateReport = { ...reportBase, status: "NOOP", reason_codes: ["identical_input_fingerprint"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }

  const sitemapUrls = parseSitemapUrls(sitemap);
  const candidate = candidateFromPairs(
    gscReport.top_query_pages.map(asPair).filter((pair): pair is EligiblePair => Boolean(pair)),
    indexedCanonicalRows(indexReport, sitemapUrls)
  );
  if (!candidate) {
    const report: GscSeoCandidateReport = { ...reportBase, status: "NOOP", reason_codes: ["no_eligible_query_page_evidence"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  const history = await candidateHistoryState(root, candidate.canonical_page, now);
  if (history === "malformed") {
    const report: GscSeoCandidateReport = {
      ...reportBase,
      status: "BLOCKED",
      reason_codes: ["candidate_history_malformed"],
      candidate: null
    };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }
  if (history === "cooldown") {
    const report: GscSeoCandidateReport = { ...reportBase, status: "NOOP", reason_codes: ["page_cooldown_active"], candidate: null };
    await writeJsonAtomic(outputPath, report);
    return { report, path: outputPath };
  }

  assertDraftOnlyCandidate(candidate);
  const report: GscSeoCandidateReport = { ...reportBase, status: "CANDIDATE", reason_codes: ["query_page_evidence_threshold_met"], candidate };
  await writeJsonAtomic(outputPath, report);
  return { report, path: outputPath };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = await createGscSeoCandidateReport({ root: getOption(args, "root"), outputDate: getOption(args, "date") });
  console.log(JSON.stringify({ status: result.report.status, reason_codes: result.report.reason_codes, path: result.path }, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
