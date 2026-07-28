import { join } from "node:path";
import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import {
  fetchPostedFacebookInsights,
  writeFacebookPostedInsightsReport
} from "./facebookInsights";
import {
  fetchPostedInstagramInsights,
  writeInstagramPostedInsightsReport
} from "./instagramInsights";
import { writeJsonAtomic } from "./logging";
import { writeOperationsDashboardArtifact } from "./operationsDashboard";
import { writePerformanceOptimizationPlan } from "./performanceOptimization";
import { projectRoot, review72HourPath } from "./paths";
import { generate72HourReview } from "./review72Hours";

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export async function syncMetaInsightsCli(args = process.argv.slice(2)): Promise<void> {
  const root = projectRoot(getOption(args, "root"));
  const config = getConfig();
  const until = getOption(args, "until") ?? getOption(args, "date") ?? todayInTaipei();
  const lookbackDays = getNumberOption(args, "lookback-days") ?? 90;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
    throw new Error("--lookback-days must be an integer from 1 to 90.");
  }
  const since = getOption(args, "since") ?? subtractDays(until, lookbackDays - 1);

  const [instagram, facebook] = await Promise.all([
    fetchPostedInstagramInsights({ since, until, config, root }),
    fetchPostedFacebookInsights({ since, until, config, root })
  ]);
  const [instagramPath, facebookPath] = await Promise.all([
    writeInstagramPostedInsightsReport(instagram, root),
    writeFacebookPostedInsightsReport(facebook, root)
  ]);
  const reviewRows = await generate72HourReview({ root });
  const dashboard = await writeOperationsDashboardArtifact({ root });
  const optimization = await writePerformanceOptimizationPlan({
    root,
    reviewRows,
    summary: dashboard.result.summary
  });
  const statusPath = join(root, "output", "operations", "meta-insights-sync.json");
  const status = {
    status: "complete",
    generated_at: new Date().toISOString(),
    since,
    until,
    instagram: {
      output_path: instagramPath,
      posts: instagram.source.instagram_posts,
      rows: instagram.rows.length,
      successful_rows: instagram.rows.filter((row) => row.insights_ok).length
    },
    facebook: {
      output_path: facebookPath,
      posts: facebook.source.facebook_posts,
      rows: facebook.rows.length,
      successful_rows: facebook.rows.filter((row) => row.insights_ok).length
    },
    review_72h: {
      output_path: review72HourPath(root),
      eligible_slots: reviewRows.length
    },
    kpi: {
      output_path: dashboard.path,
      coverage: dashboard.result.summary.kpi_coverage,
      status: dashboard.result.artifact.snapshot.status
    },
    optimization: {
      output_path: optimization.path,
      status: optimization.plan.status
    }
  };
  await writeJsonAtomic(statusPath, status);
  console.log(JSON.stringify({ ...status, status_path: statusPath }, null, 2));
}

if (isMain(import.meta.url)) {
  syncMetaInsightsCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
