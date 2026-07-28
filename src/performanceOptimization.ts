import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { readJsonFile, writeJsonAtomic } from "./logging";
import type { OperationsSummary } from "./operationsDashboard";
import { projectRoot, review72HourPath } from "./paths";
import type { Review72HourRow } from "./review72Hours";

type Confidence = "low" | "medium" | "high";

interface PerformanceOptimizationInput {
  reviewRows: Review72HourRow[];
  summary: OperationsSummary;
  generatedAt?: string;
}

interface ClusterDefinition {
  id: string;
  label: string;
  query: string;
  page_action: string;
  pattern: RegExp;
}

const CLUSTERS: ClusterDefinition[] = [
  {
    id: "business_bulk",
    label: "店家／公司大量送洗",
    query: "台中 店家 公司 大量衣物 送洗 收送",
    page_action: "建立單一深度服務頁，回答適用品項、台中市免費收送、LINE 詢問方式與不承諾事項。",
    pattern: /店家|公司|大量/u
  },
  {
    id: "white_shoes",
    label: "白鞋清潔",
    query: "台中 白鞋清潔 鞋邊泛灰 泛黃",
    page_action: "持續補強既有白鞋服務頁的真實案例、材質判斷與可改善邊界。",
    pattern: /白鞋|白色.*鞋|鞋邊/u
  },
  {
    id: "shirt_care",
    label: "白襯衫與衣物泛黃",
    query: "台中 白襯衫 領口 腋下 泛黃 送洗",
    page_action: "把白襯衫輪播內容整理成可讀指南，連回衣物洗護與免費收送頁。",
    pattern: /白襯衫|襯衫|領口|腋下/u
  },
  {
    id: "pickup_delivery",
    label: "台中免費收送",
    query: "台中 洗衣 免費收送 LINE 預約",
    page_action: "維持單一台中全市免費收送主頁，補充通勤、鞋包與大量衣物的內部連結。",
    pattern: /收送|到府|門口|不用再|不方便到店/u
  },
  {
    id: "shoe_bag",
    label: "鞋包清潔",
    query: "逢甲 西屯 洗鞋 洗包 雨痕",
    page_action: "補強鞋包頁的雨痕、鞋底、包角與材質判斷段落。",
    pattern: /鞋|鞋包|皮鞋|包包/u
  },
  {
    id: "bedding",
    label: "床組與寢具",
    query: "台中 床組 寢具 被套 送洗",
    page_action: "累積足夠社群樣本後，再決定是否擴充既有寢具指南。",
    pattern: /床組|寢具|被套|棉被|床包/u
  },
  {
    id: "other",
    label: "其他衣物與布品",
    query: "台中 衣物 布品 送洗",
    page_action: "保留為探索題材，不因單篇波動新增搜尋頁。",
    pattern: /.*/u
  }
];

function numeric(values: Array<number | null>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null;
}

function rounded(value: number | null, digits = 1): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function confidenceForSamples(samples: number): Confidence {
  if (samples >= 6) return "high";
  if (samples >= 2) return "medium";
  return "low";
}

function clusterForTopic(topic: string): ClusterDefinition {
  return CLUSTERS.find((cluster) => cluster.pattern.test(topic)) ?? CLUSTERS.at(-1)!;
}

function groupRows(
  rows: Review72HourRow[],
  key: (row: Review72HourRow) => string
): Array<Record<string, string | number | null>> {
  const groups = new Map<string, Review72HourRow[]>();
  for (const row of rows) {
    const group = key(row);
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([group, members]) => {
      const reach = numeric(members.map((row) => row.metrics.reach));
      return {
        group,
        samples: members.length,
        reach_samples: reach.length,
        average_reach: rounded(average(reach)),
        median_reach: rounded(median(reach)),
        max_reach: reach.length > 0 ? Math.max(...reach) : null,
        saves: numeric(members.map((row) => row.metrics.saved)).reduce((sum, value) => sum + value, 0),
        shares: numeric(members.map((row) => row.metrics.shares)).reduce((sum, value) => sum + value, 0)
      };
    })
    .sort((a, b) => (Number(b.average_reach) || -1) - (Number(a.average_reach) || -1));
}

function topicClusters(rows: Review72HourRow[]): Array<Record<string, unknown>> {
  const groups = new Map<string, { definition: ClusterDefinition; rows: Review72HourRow[] }>();
  for (const row of rows) {
    const definition = clusterForTopic(row.topic);
    const current = groups.get(definition.id) ?? { definition, rows: [] };
    current.rows.push(row);
    groups.set(definition.id, current);
  }
  return [...groups.values()]
    .map(({ definition, rows: members }) => {
      const reach = numeric(members.map((row) => row.metrics.reach));
      return {
        id: definition.id,
        label: definition.label,
        samples: members.length,
        reach_samples: reach.length,
        average_reach: rounded(average(reach)),
        max_reach: reach.length > 0 ? Math.max(...reach) : null,
        confidence: confidenceForSamples(members.length),
        query: definition.query,
        page_action: definition.page_action,
        example_topics: members
          .sort((a, b) => (b.metrics.reach ?? -1) - (a.metrics.reach ?? -1))
          .slice(0, 3)
          .map((row) => ({ date: row.date, slot: row.slot, topic: row.topic, reach: row.metrics.reach }))
      };
    })
    .sort((a, b) => (Number(b.max_reach) || -1) - (Number(a.max_reach) || -1));
}

function coverage(rows: Review72HourRow[], field: "line_clicks" | "inquiries" | "bookings" | "revenue_twd"): number {
  if (rows.length === 0) return 0;
  return rows.filter((row) => row.metrics[field] !== null).length / rows.length;
}

export function buildPerformanceOptimizationPlan(input: PerformanceOptimizationInput): Record<string, unknown> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rows = input.reviewRows;
  const reach = numeric(rows.map((row) => row.metrics.reach));
  const reachMedian = median(reach);
  const reachP75 = percentile(reach, 0.75);
  const nextMedianTarget =
    reachMedian !== null && reachP75 !== null ? Math.ceil((reachMedian + reachP75) / 2) : null;
  const clusters = topicClusters(rows);
  const conversionCoverage = {
    line_clicks: coverage(rows, "line_clicks"),
    inquiries: coverage(rows, "inquiries"),
    bookings: coverage(rows, "bookings"),
    revenue_twd: coverage(rows, "revenue_twd")
  };
  const missingConversionSource = Object.values(conversionCoverage).some((value) => value < 0.8);

  return {
    version: 1,
    type: "sixiangjia_90_day_performance_optimization",
    generated_at: generatedAt,
    status:
      input.summary.kpi_coverage < 0.8 || missingConversionSource ? "partial_measurement_ready_for_directional_decisions" : "ready",
    source_window: {
      eligible_72h_slots: rows.length,
      first_content_date: rows.map((row) => row.date).sort()[0] ?? null,
      last_content_date: rows.map((row) => row.date).sort().at(-1) ?? null,
      rule: "Only posts published successfully to both Facebook and Instagram and aged at least 72 hours are analyzed."
    },
    measurement: {
      reach: {
        samples: reach.length,
        average: rounded(average(reach)),
        median: rounded(reachMedian),
        p75: rounded(reachP75),
        minimum: reach.length > 0 ? Math.min(...reach) : null,
        maximum: reach.length > 0 ? Math.max(...reach) : null,
        next_30_day_median_target: nextMedianTarget,
        target_method: "Move the current median halfway toward the current p75; provisional until another 30 eligible slots."
      },
      meaningful_interactions: {
        saves_total: numeric(rows.map((row) => row.metrics.saved)).reduce((sum, value) => sum + value, 0),
        shares_total: numeric(rows.map((row) => row.metrics.shares)).reduce((sum, value) => sum + value, 0),
        note: "Low saves or shares are observed values, not proof that a topic cannot convert."
      },
      exact_views: {
        published_platform_posts: input.summary.published_platform_posts,
        exact_view_rows: input.summary.platform_view_rows,
        coverage: input.summary.kpi_coverage,
        decision_rule: "Diagnostic only while Facebook returns empty views; missing values stay null and never become zero."
      },
      conversion_source_coverage: conversionCoverage,
      by_slot: groupRows(rows, (row) => `slot_${row.slot}`),
      by_media_type: groupRows(rows, (row) => row.media_type)
    },
    evidence_led_content_clusters: clusters,
    decisions: [
      {
        priority: 1,
        lane: "content",
        action: "Use a 70/20/10 mix for the next 30 days: proven clusters / adjacent variants / controlled experiments.",
        evidence: `Current 72-hour reach median is ${rounded(reachMedian) ?? "unavailable"} and p75 is ${rounded(reachP75) ?? "unavailable"} across ${reach.length} measured slots.`,
        confidence: reach.length >= 20 ? "medium" : "low"
      },
      {
        priority: 2,
        lane: "format",
        action: "Do not declare carousel or Reel a winner yet; collect at least 4 eligible samples per format while changing only one creative variable at a time.",
        evidence: "The current eligible set contains one carousel and no Reel sample.",
        confidence: "high"
      },
      {
        priority: 3,
        lane: "conversion",
        action: "Keep reach as the directional content signal, but do not scale a CTA based on reach alone until LINE click, inquiry and booking coverage each reach 80%.",
        evidence: `Current conversion coverage: LINE ${rounded(conversionCoverage.line_clicks * 100)}%, inquiry ${rounded(conversionCoverage.inquiries * 100)}%, booking ${rounded(conversionCoverage.bookings * 100)}%.`,
        confidence: "high"
      }
    ],
    plan_90_days: {
      operating_model: {
        cadence: "Two daily slots remain; approval, validated media and live publishing gates remain separate.",
        allocation: { proven: 0.7, adjacent: 0.2, experiment: 0.1 },
        review_cycle: "Review each item at 72 hours; make portfolio changes weekly, not from one post."
      },
      phases: [
        {
          days: "1-30",
          objective: "Confirm repeatable topic signals and repair measurement.",
          actions: [
            "Repeat the strongest topic clusters with different objects and situations rather than paraphrasing the same post.",
            "Collect at least 4 eligible carousel samples and 4 eligible Reel samples before comparing formats.",
            "Raise dual-platform publishing SLA toward 95% and keep missing metrics as null.",
            "Backfill trackable LINE, inquiry and booking events until each source reaches 80% coverage."
          ]
        },
        {
          days: "31-60",
          objective: "Turn proven demand into series and searchable service journeys.",
          actions: [
            "Convert repeat winners into object-specific short videos, practical carousels and one canonical service or guide page per real intent.",
            "Link approved social case pages to the relevant service page and LINE action.",
            "Maintain at least 3 validated true Reels per week only when the video gate passes."
          ]
        },
        {
          days: "61-90",
          objective: "Optimize for qualified LINE conversations and bookings.",
          actions: [
            "Use content-to-LINE-to-inquiry-to-booking conversion once coverage is sufficient.",
            "Keep the best service clusters, retire weak variants only after adequate samples, and preserve one exploration lane.",
            "Review Search Console and conversion data together; do not use rank or impressions alone as business success."
          ]
        }
      ]
    },
    kpi_framework: {
      primary: [
        {
          metric: "72-hour median combined reach",
          baseline: rounded(reachMedian),
          next_30_day_target: nextMedianTarget,
          source: "output/operations/72-hour-review.json"
        },
        {
          metric: "Dual-platform publishing SLA",
          baseline: input.summary.publish_rate,
          target: 0.95,
          source: "output/operations/90-day-kpi.artifact.json"
        },
        {
          metric: "Bookings attributed to content",
          baseline: null,
          target: null,
          activation_gate: "Set a numeric target only after booking source coverage reaches 80%."
        }
      ],
      drivers: [
        "72-hour p75 reach",
        "saves and shares",
        "LINE clicks and inquiries",
        "Search Console impressions, clicks and CTR by canonical landing page"
      ],
      guardrails: [
        "Missing data remains null, never zero.",
        "No publishing, approval or posted-log write is authorized by this plan.",
        "One post or one format sample cannot justify a portfolio-wide change.",
        "Public SEO/AIO/GEO pages use approved facts and visible helpful content, not private KPI claims."
      ]
    },
    seo_aio_geo: {
      principle:
        "Use one helpful canonical page per real customer intent. Google AI features use normal Search eligibility; no special AI schema or mass-generated query pages are required.",
      priorities: clusters.slice(0, 5),
      implementation_rules: [
        "Keep the page crawlable, internally linked and text-first.",
        "Make structured data match visible page content exactly.",
        "Use truthful lastmod only when page content changes.",
        "Keep LocalBusiness identity, address, hours and service area consistent.",
        "Use approved social cases as supporting evidence, not as ranking guarantees.",
        "Avoid creating separate thin pages for every keyword variation."
      ],
      official_sources: [
        "https://developers.google.com/search/docs/appearance/ai-features",
        "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
        "https://developers.google.com/search/docs/appearance/structured-data/local-business",
        "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview"
      ]
    }
  };
}

export function performanceOptimizationPath(root: string): string {
  return join(root, "output", "operations", "90-day-optimization-plan.json");
}

export async function writePerformanceOptimizationPlan(options: {
  root?: string;
  reviewRows: Review72HourRow[];
  summary: OperationsSummary;
  generatedAt?: string;
}): Promise<{ path: string; plan: Record<string, unknown> }> {
  const root = projectRoot(options.root);
  const path = performanceOptimizationPath(root);
  const plan = buildPerformanceOptimizationPlan({
    reviewRows: options.reviewRows,
    summary: options.summary,
    generatedAt: options.generatedAt
  });
  await writeJsonAtomic(path, plan);
  return { path, plan };
}

async function cli(args = process.argv.slice(2)): Promise<void> {
  const root = projectRoot(getOption(args, "root"));
  const review = await readJsonFile<{ rows?: Review72HourRow[] }>(review72HourPath(root), {});
  const dashboard = await readJsonFile<{
    snapshot?: { datasets?: { summary?: OperationsSummary[] } };
  }>(join(root, "output", "operations", "90-day-kpi.artifact.json"), {});
  const summary = dashboard.snapshot?.datasets?.summary?.[0];
  if (!summary) throw new Error("90-day KPI summary is missing. Run generate-operations-dashboard first.");
  const result = await writePerformanceOptimizationPlan({
    root,
    reviewRows: Array.isArray(review.rows) ? review.rows : [],
    summary
  });
  console.log(JSON.stringify({ status: result.plan.status, output_path: result.path }, null, 2));
}

if (isMain(import.meta.url)) {
  cli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
