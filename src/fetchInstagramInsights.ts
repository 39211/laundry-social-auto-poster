import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import {
  fetchInstagramMediaInsights,
  fetchPostedInstagramInsights,
  writeInstagramPostedInsightsReport
} from "./instagramInsights";
import { projectRoot } from "./paths";

function parseMetrics(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((metric) => metric.trim())
    .filter(Boolean);
}

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export async function fetchInstagramInsightsCli(args = process.argv.slice(2)): Promise<void> {
  const config = getConfig();
  const metrics = parseMetrics(getOption(args, "metrics"));
  const postId = getOption(args, "post-id");

  if (postId) {
    const result = await fetchInstagramMediaInsights({
      postId,
      metrics,
      config
    });

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const root = projectRoot(getOption(args, "root"));
  const date = getOption(args, "date") ?? todayInTaipei();
  const since = getOption(args, "since") ?? date;
  const until = getOption(args, "until") ?? date;
  const report = await fetchPostedInstagramInsights({
    since,
    until,
    metrics,
    config,
    root
  });

  if (getFlag(args, "stdout")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const outputPath = await writeInstagramPostedInsightsReport(report, root, getOption(args, "output"));

  console.log(
    JSON.stringify(
      {
        output_path: outputPath,
        since: report.since,
        until: report.until,
        instagram_posts: report.source.instagram_posts,
        rows: report.rows.length,
        metrics: report.metrics
      },
      null,
      2
    )
  );
}

if (isMain(import.meta.url)) {
  fetchInstagramInsightsCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
