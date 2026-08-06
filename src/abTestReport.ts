import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAbTestPlan, type AbDayPlan, type AbVariant } from "./abTestPlan";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadPostLog, readJsonFile } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

interface MetricBag {
  reach?: number | null;
  views?: number | null;
  video_views?: number | null;
  total_interactions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saved?: number | null;
}

interface InsightRow {
  date?: string;
  slot?: number;
  insights_ok?: boolean;
  metrics?: MetricBag;
  insights?: MetricBag;
}

interface VariantTotals {
  posts: number;
  reach: number | null;
  views: number | null;
  interactions: number | null;
  samples: {
    reach: number;
    views: number;
    interactions: number;
  };
}

export type ReportVariant = AbVariant | "unattributed";

export interface AbTestReport {
  generated_at: string;
  as_of: string;
  plan_days: number;
  variants: {
    "10s": VariantTotals;
    "15s": VariantTotals;
    unattributed: VariantTotals;
  };
  comparison: {
    reach_ratio_15s_over_10s: number | null;
    views_ratio_15s_over_10s: number | null;
    interactions_ratio_15s_over_10s: number | null;
  };
  data_gaps: string[];
  rows: Array<{
    date: string;
    slot: number;
    variant: ReportVariant;
    conceptId: string;
    platforms_posted: string[];
    youtube_uploaded: boolean;
    reach: number | null;
    views: number | null;
    interactions: number | null;
  }>;
}

function emptyTotals(): VariantTotals {
  return {
    posts: 0,
    reach: null,
    views: null,
    interactions: null,
    samples: { reach: 0, views: 0, interactions: 0 }
  };
}

function addSample(totals: VariantTotals, field: "reach" | "views" | "interactions", value: number | null): void {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  const current = totals[field];
  totals[field] = (current ?? 0) + value;
  totals.samples[field] += 1;
}

function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

async function loadInsightRows(dir: string): Promise<InsightRow[]> {
  try {
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
    const rows: InsightRow[] = [];
    for (const file of files) {
      const payload = await readJsonFile<{ rows?: InsightRow[] }>(join(dir, file), {});
      if (Array.isArray(payload.rows)) rows.push(...payload.rows);
    }
    return rows;
  } catch {
    return [];
  }
}

function pickMetrics(row: InsightRow | undefined): MetricBag {
  if (!row) return {};
  return row.metrics ?? row.insights ?? {};
}

function metricNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value;
}

export async function buildAbTestReport(options: {
  root?: string;
  asOf?: string;
} = {}): Promise<AbTestReport> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const asOf = options.asOf ?? getZonedDateParts(new Date(), config.timezone).date;
  const plan = await loadAbTestPlan(root);
  const dataGaps: string[] = [];

  if (plan.length === 0) {
    dataGaps.push("No ab-test-plan.json (or empty plan); nothing to compare.");
  }

  const igRows = await loadInsightRows(join(root, "data", "insights", "instagram"));
  const fbRows = await loadInsightRows(join(root, "data", "insights", "facebook"));
  if (igRows.length === 0) dataGaps.push("No Instagram insight rows under data/insights/instagram.");
  if (fbRows.length === 0) dataGaps.push("No Facebook insight rows under data/insights/facebook.");

  const variants = {
    "10s": emptyTotals(),
    "15s": emptyTotals(),
    unattributed: emptyTotals()
  };
  const reportRows: AbTestReport["rows"] = [];

  for (const day of plan) {
    if (day.date > asOf) continue;
    const posts = await loadPostLog(day.date, root);
    const ytLog = await readJsonFile<Array<{ slot: number; video_id?: string }>>(
      join(root, "data", "youtube-log", `${day.date}.json`),
      []
    );

    for (const half of [
      { slot: 3, plan: day.noon },
      { slot: 2, plan: day.evening }
    ] as const) {
      // Variant attribution is only from posted-log.ab_variant — never inferred
      // from the plan. A missing field is unattributed contamination, not a free
      // fill from ab-test-plan.json.
      const liveEntries = posts.filter(
        (entry) =>
          entry.slot === half.slot &&
          !entry.dry_run &&
          ["success", "posted"].includes(entry.status)
      );
      const livePlatforms = (["facebook", "instagram"] as const).filter((platform) =>
        liveEntries.some((entry) => entry.platform === platform)
      );

      let variant: ReportVariant = "unattributed";
      if (liveEntries.length === 0) {
        dataGaps.push(
          `${day.date} slot ${half.slot}: no live posted-log entry (plan said ${half.plan.variant}).`
        );
      } else {
        const attributed = liveEntries
          .map((entry) => entry.ab_variant)
          .filter((value): value is AbVariant => value === "10s" || value === "15s");
        if (attributed.length === 0) {
          variant = "unattributed";
          dataGaps.push(
            `${day.date} slot ${half.slot}: posted-log missing ab_variant; counted as unattributed.`
          );
        } else {
          // Prefer the first recorded live ab_variant; mixed values are a gap.
          variant = attributed[0]!;
          if (new Set(attributed).size > 1) {
            dataGaps.push(
              `${day.date} slot ${half.slot}: mixed ab_variant on live posts (${[...new Set(attributed)].join(",")}).`
            );
          }
        }
      }

      variants[variant].posts += 1;

      const ig = igRows.find((row) => row.date === day.date && row.slot === half.slot);
      const fb = fbRows.find((row) => row.date === day.date && row.slot === half.slot);
      const igM = pickMetrics(ig);
      const fbM = pickMetrics(fb);

      const reachParts = [metricNumber(igM.reach), metricNumber(fbM.reach)].filter((v): v is number => v !== null);
      const viewParts = [
        metricNumber(igM.views ?? igM.video_views),
        metricNumber(fbM.views ?? fbM.video_views)
      ].filter((v): v is number => v !== null);
      const interactionParts = [
        metricNumber(igM.total_interactions),
        metricNumber(fbM.total_interactions)
      ].filter((v): v is number => v !== null);

      const reach = reachParts.length > 0 ? reachParts.reduce((a, b) => a + b, 0) : null;
      const views = viewParts.length > 0 ? viewParts.reduce((a, b) => a + b, 0) : null;
      const interactions = interactionParts.length > 0 ? interactionParts.reduce((a, b) => a + b, 0) : null;

      if (reach === null) dataGaps.push(`${day.date} slot ${half.slot} (${variant}): reach missing in insights.`);
      if (views === null) dataGaps.push(`${day.date} slot ${half.slot} (${variant}): views missing in insights.`);
      if (interactions === null) {
        dataGaps.push(`${day.date} slot ${half.slot} (${variant}): interactions missing in insights.`);
      }

      addSample(variants[variant], "reach", reach);
      addSample(variants[variant], "views", views);
      addSample(variants[variant], "interactions", interactions);

      reportRows.push({
        date: day.date,
        slot: half.slot,
        variant,
        conceptId: half.plan.conceptId,
        platforms_posted: livePlatforms,
        youtube_uploaded: ytLog.some((entry) => entry.slot === half.slot && entry.video_id),
        reach,
        views,
        interactions
      });
    }
  }

  // Null out totals that never received a real sample so zeros are not faked.
  for (const variant of ["10s", "15s", "unattributed"] as const) {
    for (const field of ["reach", "views", "interactions"] as const) {
      if (variants[variant].samples[field] === 0) variants[variant][field] = null;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    as_of: asOf,
    plan_days: plan.filter((day: AbDayPlan) => day.date <= asOf).length,
    variants,
    comparison: {
      reach_ratio_15s_over_10s: ratio(variants["15s"].reach, variants["10s"].reach),
      views_ratio_15s_over_10s: ratio(variants["15s"].views, variants["10s"].views),
      interactions_ratio_15s_over_10s: ratio(variants["15s"].interactions, variants["10s"].interactions)
    },
    data_gaps: [...new Set(dataGaps)],
    rows: reportRows
  };
}

export async function writeAbTestReport(options: {
  root?: string;
  asOf?: string;
} = {}): Promise<{ path: string; report: AbTestReport }> {
  const root = projectRoot(options.root);
  const report = await buildAbTestReport(options);
  const outDir = join(root, "output", "reviews");
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `ab-report-${report.as_of}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { path, report };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { path, report } = await writeAbTestReport({
    root: getOption(args, "root"),
    asOf: getOption(args, "as-of") ?? getOption(args, "date")
  });
  console.log(JSON.stringify({ path, data_gaps: report.data_gaps.length, variants: report.variants }, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
