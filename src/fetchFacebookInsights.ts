import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import {
  fetchPostedFacebookInsights,
  writeFacebookPostedInsightsReport
} from "./facebookInsights";
import { projectRoot } from "./paths";

function parseMetrics(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((metric) => metric.trim()).filter(Boolean);
}

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export async function fetchFacebookInsightsCli(args = process.argv.slice(2)): Promise<void> {
  const config = getConfig();
  const root = projectRoot(getOption(args, "root"));
  const date = getOption(args, "date") ?? todayInTaipei();
  const since = getOption(args, "since") ?? date;
  const until = getOption(args, "until") ?? date;
  const report = await fetchPostedFacebookInsights({
    since,
    until,
    metrics: parseMetrics(getOption(args, "metrics")),
    config,
    root
  });
  const outputPath = await writeFacebookPostedInsightsReport(report, root, getOption(args, "output"));
  console.log(JSON.stringify({
    output_path: outputPath,
    since: report.since,
    until: report.until,
    facebook_posts: report.source.facebook_posts,
    rows: report.rows.length,
    metrics: report.metrics
  }, null, 2));
}

if (isMain(import.meta.url)) {
  fetchFacebookInsightsCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
