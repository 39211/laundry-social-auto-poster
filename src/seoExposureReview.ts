import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { type Ga4AiTrafficReport } from "./ga4AiTraffic";
import { type IndexInspectionReport } from "./gscIndexInspection";
import { type GscDayReport } from "./gscSearchAnalytics";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

// This report is the feedback loop for search work. It contains observations
// and predeclared decision timing only; it does not edit pages, submit URLs,
// call GSC, or turn a submitted sitemap into a claimed ranking result.
const POLICY_VERSION = "2026-09-01-exposure-review-v1";
const MAX_INPUT_AGE_MS = 36 * 60 * 60 * 1000;
const GA4_COLLECTION_TIME = "23:10";
const GSC_COLLECTION_TIME = "23:15";

type ReviewStatus = "MEASURED" | "BLOCKED";
type Decision = "PENDING" | "INCONCLUSIVE";

export interface SeoExposureReviewReport {
  type: "seo_exposure_review";
  policy_version: string;
  date: string;
  generated_at: string;
  status: ReviewStatus;
  reason_codes: string[];
  inputs: {
    gsc_report_path: string | null;
    gsc_fetched_at: string | null;
    index_report_path: string | null;
    index_generated_at: string | null;
    ga4_report_path: string | null;
    ga4_fetched_at: string | null;
    line_ledger_path: string | null;
    line_clicks_recorded_at: string | null;
    sitemap_semantic_sha256: string | null;
  };
  measurements: {
    indexed_urls: number | null;
    known_urls: number | null;
    discovered_not_indexed_urls: number | null;
    gsc_date: string | null;
    gsc_clicks: number | null;
    gsc_impressions: number | null;
    gsc_ctr: number | null;
    gsc_position: number | null;
    observed_nonbrand_top_query_impressions: number | null;
    ga4_date: string | null;
    ga4_sessions: number | null;
    ga4_google_organic_sessions: number | null;
    ga4_ai_sessions: number | null;
    ga4_ai_engaged_sessions: number | null;
    line_clicks: number | null;
    line_clicks_status: "measured" | "total_only" | "unmeasured" | null;
  };
  diagnosis:
    | "INDEXING_UNMEASURED"
    | "INDEXING_BLOCKED"
    | "INDEXED_WITHOUT_OBSERVED_SEARCH_DEMAND"
    | "INDEXED_WITH_LOW_OBSERVED_EXPOSURE";
  decision: {
    value: Decision;
    reason: string;
    day_7_rule: string;
    day_28_rule: string;
  };
  next_actions: string[];
  forbidden_actions: readonly string[];
}

const FORBIDDEN_ACTIONS = [
  "no_public_site_write",
  "no_deploy",
  "no_gsc_index_request",
  "no_indexnow",
  "no_network_call",
  "no_new_url"
] as const;

interface Located<T> {
  path: string;
  value: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFreshCurrentCycle(value: string | undefined, date: string, now: Date, earliestTime: string): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  const parts = Number.isFinite(timestamp) ? getZonedDateParts(new Date(timestamp)) : undefined;
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now.getTime() &&
    now.getTime() - timestamp <= MAX_INPUT_AGE_MS &&
    parts?.date === date &&
    parts.time >= earliestTime
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

async function latestJson<T>(directory: string): Promise<Located<T> | undefined> {
  let entries: string[];
  try {
    entries = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name)).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  for (const name of entries) {
    try {
      const path = join(directory, name);
      const value = await readJsonFile<T | undefined>(path, undefined);
      if (value !== undefined) return { path, value };
    } catch {
      // Any candidate for latest evidence that cannot parse is not usable.
    }
  }
  return undefined;
}

function isGscReport(value: unknown): value is GscDayReport {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    typeof value.fetched_at === "string" &&
    isRecord(value.totals) &&
    [value.totals.clicks, value.totals.impressions, value.totals.ctr, value.totals.position].every(isFiniteNumber) &&
    Array.isArray(value.top_queries)
  );
}

function isIndexReport(value: unknown): value is IndexInspectionReport {
  return (
    isRecord(value) &&
    typeof value.generated_at === "string" &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.indexed_count) &&
    Array.isArray(value.rows)
  );
}

function isGa4Report(value: unknown): value is Ga4AiTrafficReport {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    typeof value.fetched_at === "string" &&
    isRecord(value.totals) &&
    [
      value.totals.sessions,
      value.totals.ai_sessions,
      value.totals.google_organic_sessions,
      value.totals.ai_engaged_sessions
    ].every(isFiniteNumber)
  );
}

interface LineLedgerDay {
  line_clicks_total?: unknown;
  source_clicks_status?: unknown;
  line_clicks_recorded_at?: unknown;
}

interface LineLedgerFile {
  days?: Record<string, LineLedgerDay>;
}

interface LineLedgerEvidence {
  path: string;
  line_clicks: number | null;
  status: "measured" | "total_only" | "unmeasured" | null;
  recorded_at: string | null;
}

async function readLineLedger(root: string, date: string): Promise<LineLedgerEvidence | undefined> {
  const path = join(root, "data", "leads", `${date.slice(0, 7)}.json`);
  try {
    const ledger = await readJsonFile<LineLedgerFile>(path, {});
    const day = ledger.days?.[date];
    if (!day) return undefined;
    const status = day.source_clicks_status;
    return {
      path,
      line_clicks: isFiniteNumber(day.line_clicks_total) ? day.line_clicks_total : null,
      status: status === "measured" || status === "total_only" || status === "unmeasured" ? status : null,
      recorded_at: typeof day.line_clicks_recorded_at === "string" ? day.line_clicks_recorded_at : null
    };
  } catch {
    return undefined;
  }
}

function nonbrandTopQueryImpressions(report: GscDayReport): number {
  return report.top_queries.reduce((sum, row) => {
    const query = row.keys?.[0] ?? "";
    return /私享家|思想家|si\s*xiang/iu.test(query) ? sum : sum + (Number.isFinite(row.impressions) ? row.impressions : 0);
  }, 0);
}

function semanticSitemapHash(xml: string): string {
  const normalized = xml.replace(/^\uFEFF/u, "").replace(/\s+/gu, "");
  return createHash("sha256").update(normalized).digest("hex");
}

export function seoExposureReviewPath(date: string, root = projectRoot()): string {
  return join(root, "output", "operations", `seo-exposure-review-${date}.json`);
}

export async function createSeoExposureReview(input: {
  root?: string;
  now?: Date;
  date?: string;
  /** The scheduled collector failed this cycle; never reuse earlier fresh files as a pass. */
  forceBlock?: boolean;
} = {}): Promise<{ report: SeoExposureReviewReport; path: string }> {
  const root = projectRoot(input.root);
  const now = input.now ?? new Date();
  const date = input.date ?? getZonedDateParts(now).date;
  if (!isValidDate(date)) throw new Error("--date must use a real YYYY-MM-DD calendar date.");
  const path = seoExposureReviewPath(date, root);
  const [gsc, index, ga4, sitemap, lineLedger] = await Promise.all([
    latestJson<unknown>(join(root, "data", "insights", "gsc")),
    latestJson<unknown>(join(root, "data", "insights", "gsc-index")),
    latestJson<unknown>(join(root, "data", "insights", "ga4-traffic")),
    readFile(join(root, "docs", "sitemap.xml"), "utf8").catch(() => undefined),
    readLineLedger(root, date)
  ]);
  const gscReport = gsc && isGscReport(gsc.value) ? gsc.value : undefined;
  const indexReport = index && isIndexReport(index.value) ? index.value : undefined;
  const ga4Report = ga4 && isGa4Report(ga4.value) ? ga4.value : undefined;
  const gscFresh = Boolean(gscReport && isFreshCurrentCycle(gscReport.fetched_at, date, now, GSC_COLLECTION_TIME));
  const indexFresh = Boolean(indexReport && isFreshCurrentCycle(indexReport.generated_at, date, now, GSC_COLLECTION_TIME));
  const ga4Fresh = Boolean(
    ga4Report &&
      ga4Report.date === date &&
      isFreshCurrentCycle(ga4Report.fetched_at, date, now, GA4_COLLECTION_TIME)
  );
  const lineFresh = Boolean(
    lineLedger &&
      lineLedger.line_clicks !== null &&
      (lineLedger.status === "measured" || lineLedger.status === "total_only") &&
      isFreshCurrentCycle(lineLedger.recorded_at ?? undefined, date, now, GA4_COLLECTION_TIME)
  );
  const base: Omit<SeoExposureReviewReport, "status" | "reason_codes" | "diagnosis" | "decision" | "next_actions"> = {
    type: "seo_exposure_review",
    policy_version: POLICY_VERSION,
    date,
    generated_at: now.toISOString(),
    inputs: {
      gsc_report_path: gsc?.path ?? null,
      gsc_fetched_at: gscReport?.fetched_at ?? null,
      index_report_path: index?.path ?? null,
      index_generated_at: indexReport?.generated_at ?? null,
      ga4_report_path: ga4?.path ?? null,
      ga4_fetched_at: ga4Report?.fetched_at ?? null,
      line_ledger_path: lineLedger?.path ?? null,
      line_clicks_recorded_at: lineLedger?.recorded_at ?? null,
      sitemap_semantic_sha256: sitemap ? semanticSitemapHash(sitemap) : null
    },
    measurements: {
      indexed_urls: indexReport?.indexed_count ?? null,
      known_urls: indexReport?.total ?? null,
      discovered_not_indexed_urls: indexReport
        ? indexReport.rows.filter((row) => /discovered .*not indexed/iu.test(row.coverage_state)).length
        : null,
      gsc_date: gscReport?.date ?? null,
      gsc_clicks: gscReport?.totals.clicks ?? null,
      gsc_impressions: gscReport?.totals.impressions ?? null,
      gsc_ctr: gscReport?.totals.ctr ?? null,
      gsc_position: gscReport?.totals.position ?? null,
      observed_nonbrand_top_query_impressions: gscReport ? nonbrandTopQueryImpressions(gscReport) : null,
      ga4_date: ga4Report?.date ?? null,
      ga4_sessions: ga4Report?.totals.sessions ?? null,
      ga4_google_organic_sessions: ga4Report?.totals.google_organic_sessions ?? null,
      ga4_ai_sessions: ga4Report?.totals.ai_sessions ?? null,
      ga4_ai_engaged_sessions: ga4Report?.totals.ai_engaged_sessions ?? null,
      line_clicks: lineLedger?.line_clicks ?? null,
      line_clicks_status: lineLedger?.status ?? null
    },
    forbidden_actions: FORBIDDEN_ACTIONS
  };

  const missingCycles = [
    input.forceBlock && "gsc_collection_command_failed",
    !gscFresh && "current_gsc_collection_cycle_missing",
    !indexFresh && "current_index_collection_cycle_missing",
    !ga4Fresh && "current_ga4_collection_cycle_missing",
    !lineFresh && "current_line_click_collection_cycle_missing"
  ].filter((reason): reason is string => Boolean(reason));

  if (missingCycles.length > 0) {
    const report: SeoExposureReviewReport = {
      ...base,
      status: "BLOCKED",
      reason_codes: missingCycles,
      diagnosis: "INDEXING_UNMEASURED",
      decision: {
        value: "INCONCLUSIVE",
        reason: "未同時取得本次 23:10 GA4／LINE 與 23:15 GSC 成效／URL inspection，不能以舊快照或缺值判定改善。",
        day_7_rule: "有已驗證 treatment 後第 7 天，才比較 crawl／coverage 與非品牌曝光。",
        day_28_rule: "有完整 28 天資料後，才可判 ADOPT／RETEST／REJECT。"
      },
      next_actions: ["等待既有 23:10 與 23:15 排程完成；不得重送 sitemap 或要求索引。"]
    };
    await writeJsonAtomic(path, report);
    return { report, path };
  }

  // The cycle gate above establishes these inputs. Keep the invariant explicit
  // so a future change cannot turn an absent source into a false MEASURED run.
  if (!gscReport || !indexReport || !ga4Report || !lineLedger) {
    throw new Error("Exposure review invariant failed after current-cycle gate.");
  }

  const diagnosis =
    indexReport.indexed_count === 0
      ? "INDEXING_BLOCKED"
      : gscReport.totals.impressions === 0
        ? "INDEXED_WITHOUT_OBSERVED_SEARCH_DEMAND"
        : "INDEXED_WITH_LOW_OBSERVED_EXPOSURE";
  const report: SeoExposureReviewReport = {
    ...base,
    status: "MEASURED",
    reason_codes: ["current_ga4_gsc_line_collection_cycle_measured"],
    diagnosis,
    decision: {
      value: "PENDING",
      reason: "尚無具來源雜湊與 treatment 日期的已驗證頁面變更；資料只能描述基線，不能宣稱方法有效。",
      day_7_rule: "每個已驗證 treatment 第 7 天：只檢查 crawl／coverage 與非品牌 impressions，未達門檻維持 PENDING 或 RETEST。",
      day_28_rule: "每個已驗證 treatment 第 28 天：同時比較非品牌 GSC impressions/clicks、GA4 organic/AI sessions 與 LINE click；缺值一律 INCONCLUSIVE。"
    },
    next_actions: [
      "維持 URL 數量不變，先等待直接 query-page GSC 證據。",
      "只在有已驗證 treatment 時進行單變因修改；不要把 IndexNow 200 當成收錄或曝光成功。"
    ]
  };
  await writeJsonAtomic(path, report);
  return { report, path };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = await createSeoExposureReview({
    root: getOption(args, "root"),
    date: getOption(args, "date"),
    forceBlock: args.includes("--force-block")
  });
  console.log(JSON.stringify({ status: result.report.status, diagnosis: result.report.diagnosis, path: result.path }, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
