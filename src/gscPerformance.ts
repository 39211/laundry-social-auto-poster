import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getOption, isMain } from "./cli";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";

export interface GscMetricRow {
  key: string;
  clicks: number | null;
  impressions: number | null;
  ctr_percent: number | null;
  position: number | null;
}

export interface GscQueryPageRow extends GscMetricRow {
  query: string;
  page: string;
}

export type GscServiceCluster =
  | "brand"
  | "general_laundry"
  | "dry_cleaning"
  | "wet_cleaning"
  | "shirts_suits"
  | "bedding_down"
  | "shoes_bags"
  | "leather"
  | "other";

export interface GscThresholds {
  page_min_impressions: number;
  page_max_ctr_percent: number;
  page_max_position: number;
  query_min_impressions: number;
  query_max_position: number;
  low_sample_min_impressions: number;
  low_sample_min_clicks: number;
  min_post_change_observation_days: number;
}

export interface GscRecommendation {
  canonical_page: string;
  service_cluster: GscServiceCluster;
  status: "ready_for_bounded_change" | "wait_for_post_change_data" | "content_freshness_unknown";
  recommended_surface: "title_meta_business_identity" | "title_meta_faq_service_copy";
  evidence: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr_percent: number;
    position: number;
  }>;
  metrics: {
    clicks: number;
    impressions: number;
    ctr_percent: number;
    impression_weighted_position: number;
  };
  confidence: "low" | "medium" | "high";
  evidence_window: {
    data_through: string;
    page_content_lastmod: string | null;
    post_change_data_available: boolean | null;
    post_change_observation_days: number | null;
    minimum_observation_days: number;
  };
  action: string;
}

export interface GscPerformanceReport {
  version: 2;
  type: "gsc_performance_optimization";
  generated_at: string;
  status: "awaiting_query_page_data" | "low_sample_directional_only" | "ready_for_directional_optimization";
  source: {
    property: string;
    data_through: string;
    files: string[];
    filters: Record<string, string>;
    paired_query_page_file_loaded: boolean;
    canonical_aliases: Record<string, string>;
    page_content_lastmods: Record<string, string>;
  };
  thresholds: GscThresholds;
  page_row_totals: {
    clicks: number;
    impressions: number;
    ctr_percent: number;
    impression_weighted_position: number;
  };
  observations: {
    high_impression_low_ctr_pages: GscMetricRow[];
    high_ranking_zero_click_queries: Array<GscMetricRow & { service_cluster: GscServiceCluster }>;
  };
  recommendations: GscRecommendation[];
  data_quality: {
    query_rows: number;
    page_rows: number;
    paired_query_page_rows: number;
    canonical_page_rows: number;
    actionability: "blocked_without_query_page_dimension" | "directional_only" | "actionable_with_monitoring";
    aggregation_note: string;
    query_page_join_note: string;
    caution: string;
  };
}

const QUERY_FILE = "查詢.csv";
const PAGE_FILE = "網頁.csv";
const FILTER_FILE = "篩選器.csv";
const QUERY_PAGE_FILE = "查詢與網頁.csv";
const METRIC_HEADERS = ["點擊", "曝光", "點閱率", "排名"];
const CTR_ROUNDING_TOLERANCE = 0.02;

export const DEFAULT_CANONICAL_ALIASES: Record<string, string> = {
  "https://39211.github.io/laundry-social-auto-poster/": "https://39211.github.io/"
};

export const DEFAULT_PAGE_CONTENT_LASTMODS: Record<string, string> = {
  "https://39211.github.io/": "2026-08-08",
  "https://39211.github.io/local/qinghai-road-shoe-cleaning.html": "2026-08-08"
};

export const DEFAULT_GSC_THRESHOLDS: GscThresholds = {
  page_min_impressions: 50,
  page_max_ctr_percent: 3,
  page_max_position: 15,
  query_min_impressions: 5,
  query_max_position: 10,
  low_sample_min_impressions: 1000,
  low_sample_min_clicks: 30,
  min_post_change_observation_days: 7
};

export function parseCsv(raw: string): string[][] {
  const input = raw.replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;

  const finishCell = (): void => {
    row.push(cell);
    cell = "";
    afterQuote = false;
  };
  const finishRow = (): void => {
    finishCell();
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (afterQuote && character !== "," && character !== "\n" && character !== "\r") {
      throw new Error("Malformed CSV: unexpected character after quoted field.");
    }
    if (!afterQuote && character === '"') {
      if (cell.length > 0) throw new Error("Malformed CSV: quote inside unquoted field.");
      quoted = true;
      continue;
    }
    if (character === ",") {
      finishCell();
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRow();
      continue;
    }
    cell += character;
  }

  if (quoted) throw new Error("Malformed CSV: unterminated quoted field.");
  if (cell.length > 0 || row.length > 0 || afterQuote) finishRow();
  return rows;
}

function parseMetric(value: string, label: string, options: { percent?: boolean; integer?: boolean } = {}): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = options.percent ? trimmed.replace(/%$/u, "") : trimmed;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || (options.integer && !Number.isInteger(parsed))) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parseMetricColumns(columns: string[], offset: number): Omit<GscMetricRow, "key"> {
  return {
    clicks: parseMetric(columns[offset]!, "clicks", { integer: true }),
    impressions: parseMetric(columns[offset + 1]!, "impressions", { integer: true }),
    ctr_percent: parseMetric(columns[offset + 2]!, "CTR", { percent: true }),
    position: parseMetric(columns[offset + 3]!, "position")
  };
}

export function parseGscMetricCsv(raw: string, dimensionHeader: string): GscMetricRow[] {
  const rows = parseCsv(raw);
  const expected = [dimensionHeader, ...METRIC_HEADERS];
  const header = rows[0];
  if (!header || header.length !== expected.length || expected.some((value, index) => header[index]?.trim() !== value)) {
    throw new Error(`Invalid GSC CSV header for ${dimensionHeader}.`);
  }
  return rows.slice(1).map((columns, rowIndex) => {
    if (columns.length !== expected.length) {
      throw new Error(`Malformed ${dimensionHeader} CSV row ${rowIndex + 2}: expected 5 columns.`);
    }
    const key = columns[0]!.trim();
    if (!key) throw new Error(`Malformed ${dimensionHeader} CSV row ${rowIndex + 2}: missing dimension.`);
    return { key, ...parseMetricColumns(columns, 1) };
  });
}

export function parseGscQueryPageCsv(raw: string): GscQueryPageRow[] {
  const rows = parseCsv(raw);
  const expected = ["熱門查詢項目", "熱門網頁", ...METRIC_HEADERS];
  const header = rows[0];
  if (!header || header.length !== expected.length || expected.some((value, index) => header[index]?.trim() !== value)) {
    throw new Error("Invalid GSC query-page CSV header.");
  }
  return rows.slice(1).map((columns, rowIndex) => {
    if (columns.length !== expected.length) {
      throw new Error(`Malformed query-page CSV row ${rowIndex + 2}: expected 6 columns.`);
    }
    const query = columns[0]!.trim();
    const page = columns[1]!.trim();
    if (!query || !page) throw new Error(`Malformed query-page CSV row ${rowIndex + 2}: missing query or page.`);
    return { key: `${query}\u0000${page}`, query, page, ...parseMetricColumns(columns, 2) };
  });
}

export function parseGscFiltersCsv(raw: string): Record<string, string> {
  const rows = parseCsv(raw);
  const header = rows[0];
  if (!header || header.length !== 2 || header[0]?.trim() !== "篩選器" || header[1]?.trim() !== "值") {
    throw new Error("Invalid GSC filters CSV header.");
  }
  const filters: Record<string, string> = {};
  for (const [index, columns] of rows.slice(1).entries()) {
    const key = columns[0]?.trim();
    if (columns.length !== 2 || !key) throw new Error(`Malformed filters CSV row ${index + 2}.`);
    if (Object.hasOwn(filters, key)) throw new Error(`Duplicate GSC filter: ${key}.`);
    filters[key] = columns[1]?.trim() ?? "";
  }
  return filters;
}

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type CompleteMetricRow = GscMetricRow & {
  clicks: number;
  impressions: number;
  ctr_percent: number;
  position: number;
};

function validateMetricRows(rows: GscMetricRow[], label: string): asserts rows is CompleteMetricRow[] {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (seen.has(row.key)) throw new Error(`Duplicate ${label} row key at row ${index + 2}: ${row.key}`);
    seen.add(row.key);
    if (row.clicks === null || row.impressions === null || row.ctr_percent === null || row.position === null) {
      throw new Error(`Incomplete ${label} metrics at row ${index + 2}: ${row.key}`);
    }
    if (row.impressions <= 0) throw new Error(`Invalid ${label} impressions at row ${index + 2}: must be greater than zero.`);
    if (row.clicks > row.impressions) throw new Error(`Invalid ${label} metrics at row ${index + 2}: clicks exceed impressions.`);
    if (row.ctr_percent > 100) throw new Error(`Invalid ${label} CTR at row ${index + 2}: exceeds 100%.`);
    if (row.position <= 0) throw new Error(`Invalid ${label} position at row ${index + 2}: must be greater than zero.`);
    const expectedCtr = (row.clicks / row.impressions) * 100;
    if (Math.abs(row.ctr_percent - expectedCtr) > CTR_ROUNDING_TOLERANCE) {
      throw new Error(`Inconsistent ${label} CTR at row ${index + 2}: ${row.key}`);
    }
  }
}

function canonicalizePage(page: string, aliases: Record<string, string>): string {
  let current = page;
  const seen = new Set<string>();
  while (Object.hasOwn(aliases, current)) {
    if (seen.has(current)) throw new Error(`Canonical alias cycle detected at ${current}.`);
    seen.add(current);
    current = aliases[current]!;
  }
  return current;
}

function aggregateMetrics<T extends CompleteMetricRow>(rows: T[], key: string): CompleteMetricRow {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  return {
    key,
    clicks,
    impressions,
    ctr_percent: rounded((clicks / impressions) * 100),
    position: rounded(rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions)
  };
}

function collapseCanonicalPages(rows: CompleteMetricRow[], aliases: Record<string, string>): CompleteMetricRow[] {
  const groups = new Map<string, CompleteMetricRow[]>();
  for (const row of rows) {
    const canonical = canonicalizePage(row.key, aliases);
    groups.set(canonical, [...(groups.get(canonical) ?? []), row]);
  }
  return [...groups.entries()].map(([key, group]) => aggregateMetrics(group, key));
}

function byOpportunity(left: GscMetricRow, right: GscMetricRow): number {
  return (right.impressions ?? -1) - (left.impressions ?? -1) ||
    (left.position ?? Number.POSITIVE_INFINITY) - (right.position ?? Number.POSITIVE_INFINITY) ||
    left.key.localeCompare(right.key, "zh-Hant");
}

export function classifyServiceCluster(query: string): GscServiceCluster {
  const normalized = query.trim().toLowerCase();
  if (/私享家|私享|享家/u.test(normalized)) return "brand";
  if (/工作室|有限公司|企業社/u.test(normalized)) return "other";
  if (/皮衣|皮革/u.test(normalized)) return "leather";
  if (/床組|床單|寢具|棉被|羽絨|被子/u.test(normalized)) return "bedding_down";
  if (/襯衫|西裝/u.test(normalized)) return "shirts_suits";
  if (/洗鞋|鞋子|球鞋|白鞋|皮鞋|洗包|包包/u.test(normalized)) return "shoes_bags";
  if (/乾洗/u.test(normalized)) return "dry_cleaning";
  if (/水洗/u.test(normalized)) return "wet_cleaning";
  if (/洗衣|送洗|收送/u.test(normalized)) return "general_laundry";
  return "other";
}

function buildRecommendations(options: {
  pairedRows: Array<GscQueryPageRow & CompleteMetricRow>;
  pageOpportunities: CompleteMetricRow[];
  aliases: Record<string, string>;
  thresholds: GscThresholds;
  lowSample: boolean;
  dataThrough: string;
  pageContentLastmods: Record<string, string>;
}): GscRecommendation[] {
  const opportunityPages = new Set(options.pageOpportunities.map((row) => row.key));
  const groups = new Map<string, Array<GscQueryPageRow & CompleteMetricRow>>();
  for (const row of options.pairedRows) {
    const page = canonicalizePage(row.page, options.aliases);
    const cluster = classifyServiceCluster(row.query);
    if (cluster === "other" || !opportunityPages.has(page)) continue;
    const key = `${page}\u0000${cluster}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...row, page }]);
  }

  return [...groups.entries()].flatMap(([key, rows]) => {
    const separator = key.lastIndexOf("\u0000");
    const canonicalPage = key.slice(0, separator);
    const cluster = key.slice(separator + 1) as GscServiceCluster;
    const metrics = aggregateMetrics(rows, key);
    if (
      metrics.impressions < options.thresholds.query_min_impressions ||
      metrics.ctr_percent >= options.thresholds.page_max_ctr_percent ||
      metrics.position > options.thresholds.query_max_position
    ) return [];
    const confidence = options.lowSample || metrics.impressions < 100
      ? "low"
      : metrics.impressions < 500 ? "medium" : "high";
    const brand = cluster === "brand";
    const pageContentLastmod = options.pageContentLastmods[canonicalPage] ?? null;
    const postChangeObservationDays = pageContentLastmod === null
      ? null
      : Math.floor((Date.parse(`${options.dataThrough}T00:00:00Z`) - Date.parse(`${pageContentLastmod}T00:00:00Z`)) / 86_400_000);
    const postChangeDataAvailable = postChangeObservationDays === null
      ? null
      : postChangeObservationDays >= options.thresholds.min_post_change_observation_days;
    const status = pageContentLastmod === null
      ? "content_freshness_unknown"
      : postChangeDataAvailable ? "ready_for_bounded_change" : "wait_for_post_change_data";
    return [{
      canonical_page: canonicalPage,
      service_cluster: cluster,
      status,
      recommended_surface: brand ? "title_meta_business_identity" : "title_meta_faq_service_copy",
      evidence: [...rows].sort(byOpportunity).slice(0, 5).map((row) => ({
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr_percent: row.ctr_percent,
        position: row.position
      })),
      metrics: {
        clicks: metrics.clicks,
        impressions: metrics.impressions,
        ctr_percent: metrics.ctr_percent,
        impression_weighted_position: metrics.position
      },
      confidence,
      evidence_window: {
        data_through: options.dataThrough,
        page_content_lastmod: pageContentLastmod,
        post_change_data_available: postChangeDataAvailable,
        post_change_observation_days: postChangeObservationDays,
        minimum_observation_days: options.thresholds.min_post_change_observation_days
      },
      action: status === "wait_for_post_change_data"
        ? "Wait for Search Console data after the current page content lastmod before making another change."
        : status === "content_freshness_unknown"
          ? "Record the page content lastmod before deciding whether this evidence applies to the current page version."
          : brand
            ? "Review the title and meta description for exact business identity and location; do not replace proven service terms."
            : "Strengthen the title/meta description, FAQ, and service explanation only around the paired queries listed in evidence; preserve existing proven terms."
    } satisfies GscRecommendation];
  }).sort((left, right) => right.metrics.impressions - left.metrics.impressions || left.canonical_page.localeCompare(right.canonical_page));
}

export function buildGscPerformanceReport(options: {
  queryRows: GscMetricRow[];
  pageRows: GscMetricRow[];
  pairedRows?: GscQueryPageRow[];
  filters: Record<string, string>;
  generatedAt: string;
  dataThrough: string;
  property?: string;
  thresholds?: GscThresholds;
  canonicalAliases?: Record<string, string>;
  pageContentLastmods?: Record<string, string>;
}): GscPerformanceReport {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(options.dataThrough) ||
    Number.isNaN(Date.parse(`${options.dataThrough}T00:00:00Z`)) ||
    new Date(`${options.dataThrough}T00:00:00Z`).toISOString().slice(0, 10) !== options.dataThrough
  ) {
    throw new Error("dataThrough must be a valid YYYY-MM-DD date.");
  }
  if (Number.isNaN(Date.parse(options.generatedAt))) throw new Error("generatedAt must be a valid date-time.");
  if (options.queryRows.length === 0) throw new Error("GSC query export must contain at least one data row.");
  if (options.pageRows.length === 0) throw new Error("GSC page export must contain at least one data row.");
  validateMetricRows(options.queryRows, "query");
  validateMetricRows(options.pageRows, "page");
  const pairedRows = options.pairedRows ?? [];
  validateMetricRows(pairedRows, "query-page");

  const thresholds = options.thresholds ?? DEFAULT_GSC_THRESHOLDS;
  const aliases = { ...DEFAULT_CANONICAL_ALIASES, ...(options.canonicalAliases ?? {}) };
  for (const source of Object.keys(aliases)) canonicalizePage(source, aliases);
  const pageContentLastmods = { ...DEFAULT_PAGE_CONTENT_LASTMODS, ...(options.pageContentLastmods ?? {}) };
  for (const [page, lastmod] of Object.entries(pageContentLastmods)) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(lastmod) || new Date(`${lastmod}T00:00:00Z`).toISOString().slice(0, 10) !== lastmod) {
      throw new Error(`Invalid content lastmod for ${page}: ${lastmod}`);
    }
  }
  const canonicalPages = collapseCanonicalPages(options.pageRows, aliases);
  const clicks = options.pageRows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = options.pageRows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPosition = options.pageRows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions;
  const lowSample = impressions < thresholds.low_sample_min_impressions || clicks < thresholds.low_sample_min_clicks;
  const pageOpportunities = canonicalPages.filter((row) =>
    row.impressions >= thresholds.page_min_impressions &&
    row.ctr_percent < thresholds.page_max_ctr_percent &&
    row.position <= thresholds.page_max_position
  ).sort(byOpportunity);
  const recommendations = buildRecommendations({
    pairedRows: pairedRows as Array<GscQueryPageRow & CompleteMetricRow>,
    pageOpportunities,
    aliases,
    thresholds,
    lowSample,
    dataThrough: options.dataThrough,
    pageContentLastmods
  });
  const pairedLoaded = pairedRows.length > 0;
  const status = !pairedLoaded
    ? "awaiting_query_page_data"
    : lowSample ? "low_sample_directional_only" : "ready_for_directional_optimization";

  return {
    version: 2,
    type: "gsc_performance_optimization",
    generated_at: options.generatedAt,
    status,
    source: {
      property: options.property ?? "https://39211.github.io/",
      data_through: options.dataThrough,
      files: [QUERY_FILE, PAGE_FILE, FILTER_FILE, ...(pairedLoaded ? [QUERY_PAGE_FILE] : [])],
      filters: Object.fromEntries(Object.entries(options.filters).sort(([left], [right]) => left.localeCompare(right, "zh-Hant"))),
      paired_query_page_file_loaded: pairedLoaded,
      canonical_aliases: Object.fromEntries(Object.entries(aliases).sort(([left], [right]) => left.localeCompare(right))),
      page_content_lastmods: Object.fromEntries(Object.entries(pageContentLastmods).sort(([left], [right]) => left.localeCompare(right)))
    },
    thresholds,
    page_row_totals: {
      clicks,
      impressions,
      ctr_percent: rounded((clicks / impressions) * 100),
      impression_weighted_position: rounded(weightedPosition)
    },
    observations: {
      high_impression_low_ctr_pages: pageOpportunities,
      high_ranking_zero_click_queries: options.queryRows
        .filter((row) => row.impressions >= thresholds.query_min_impressions && row.clicks === 0 && row.position <= thresholds.query_max_position)
        .map((row) => ({ ...row, service_cluster: classifyServiceCluster(row.key) }))
        .sort(byOpportunity)
    },
    recommendations,
    data_quality: {
      query_rows: options.queryRows.length,
      page_rows: options.pageRows.length,
      paired_query_page_rows: pairedRows.length,
      canonical_page_rows: canonicalPages.length,
      actionability: !pairedLoaded ? "blocked_without_query_page_dimension" : lowSample ? "directional_only" : "actionable_with_monitoring",
      aggregation_note: "page_row_totals are sums of exported page-dimension rows, not the Search Console property headline totals; dimension totals can differ because of aggregation and privacy handling.",
      query_page_join_note: pairedLoaded
        ? "Recommendations use rows that contain both query and page dimensions; aggregate query and page tables are observations only."
        : `No ${QUERY_PAGE_FILE} was supplied. Aggregate query and page tables cannot attribute a query to a URL, so no page-edit recommendation is emitted.`,
      caution: lowSample
        ? `Directional only: page-row totals are below ${thresholds.low_sample_min_impressions} impressions or ${thresholds.low_sample_min_clicks} clicks. Preserve proven terms, change one surface at a time, and monitor before inferring uplift.`
        : "Recommendations still show association, not causality; change one surface at a time and monitor the same query-page segment."
    }
  };
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function analyzeGscExportDirectory(options: {
  inputDirectory: string;
  generatedAt: string;
  dataThrough: string;
  property?: string;
  canonicalAliases?: Record<string, string>;
  pageContentLastmods?: Record<string, string>;
}): Promise<GscPerformanceReport> {
  const [queryRaw, pageRaw, filterRaw, pairedRaw] = await Promise.all([
    readFile(join(options.inputDirectory, QUERY_FILE), "utf8"),
    readFile(join(options.inputDirectory, PAGE_FILE), "utf8"),
    readFile(join(options.inputDirectory, FILTER_FILE), "utf8"),
    readOptionalFile(join(options.inputDirectory, QUERY_PAGE_FILE))
  ]);
  return buildGscPerformanceReport({
    queryRows: parseGscMetricCsv(queryRaw, "熱門查詢項目"),
    pageRows: parseGscMetricCsv(pageRaw, "熱門網頁"),
    pairedRows: pairedRaw ? parseGscQueryPageCsv(pairedRaw) : undefined,
    filters: parseGscFiltersCsv(filterRaw),
    generatedAt: options.generatedAt,
    dataThrough: options.dataThrough,
    property: options.property,
    canonicalAliases: options.canonicalAliases,
    pageContentLastmods: options.pageContentLastmods
  });
}

export function gscPerformancePath(root: string): string {
  return join(root, "output", "operations", "gsc-performance-optimization.json");
}

function parseStringMap(raw: string, label: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/u, ""));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${label} must be a JSON object.`);
  const aliases: Record<string, string> = {};
  for (const [source, target] of Object.entries(parsed)) {
    if (!source || typeof target !== "string" || !target) throw new Error(`${label} keys and values must be non-empty strings.`);
    aliases[source] = target;
  }
  return aliases;
}

export async function runGscPerformanceCli(args = process.argv.slice(2)): Promise<GscPerformanceReport> {
  const root = projectRoot(getOption(args, "root"));
  const input = getOption(args, "input");
  const dataThrough = getOption(args, "data-through");
  if (!input) throw new Error("--input is required and must contain 查詢.csv, 網頁.csv and 篩選器.csv.");
  if (!dataThrough) throw new Error("--data-through YYYY-MM-DD is required.");
  const canonicalMapPath = getOption(args, "canonical-map");
  const canonicalAliases = canonicalMapPath
    ? parseStringMap(await readFile(resolve(root, canonicalMapPath), "utf8"), "Canonical map")
    : undefined;
  const pageLastmodsPath = getOption(args, "page-lastmods");
  const pageContentLastmods = pageLastmodsPath
    ? parseStringMap(await readFile(resolve(root, pageLastmodsPath), "utf8"), "Page lastmods map")
    : undefined;
  const report = await analyzeGscExportDirectory({
    inputDirectory: resolve(root, input),
    generatedAt: getOption(args, "generated-at") ?? new Date().toISOString(),
    dataThrough,
    property: getOption(args, "property"),
    canonicalAliases,
    pageContentLastmods
  });
  const outputPath = gscPerformancePath(root);
  await writeJsonAtomic(outputPath, report);
  console.log(JSON.stringify({ status: report.status, output_path: outputPath }, null, 2));
  return report;
}

if (isMain(import.meta.url)) {
  runGscPerformanceCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
