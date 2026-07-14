import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { buildGrowthPlaybook, flattenGrowthPlaybook } from "./growthPlaybook";
import { projectRoot } from "./paths";

function escapeCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  return text.replaceAll("\n", "<br>").replaceAll("|", "\\|");
}

function toMarkdown(playbook: ReturnType<typeof buildGrowthPlaybook>): string {
  const rows = flattenGrowthPlaybook(playbook);
  const header = [
    "# 私享家 90 天觀看數成長 Playbook",
    "",
    `- 品牌：${playbook.brand}`,
    `- 期間：${playbook.start_date} 到 ${playbook.end_date}`,
    `- 目標：${playbook.objective}`,
    `- 節奏：${playbook.cadence}`,
    "",
    "## 10 日複盤階梯",
    "",
    "| 天數 | daily views target | daily follower target | 複盤重點 |",
    "|---|---:|---:|---|",
    ...playbook.review_windows.map(
      (window) =>
        `| Day ${window.start_day}-${window.end_day} | ${window.daily_views_target} | ${window.daily_follower_target} | ${window.review_metric} |`
    ),
    "",
    "## 90 天內容母表",
    "",
    "| date | slot | topic | format | visual_route | traffic_route | views_target | follower_target | hook | follow_cta | caption | hashtags | image_or_reel_direction | SEO同步頁 | 10日複盤指標 |",
    "|---|---:|---|---|---|---|---:|---:|---|---|---|---|---|---|---|",
    ...rows.map((row) =>
      [
        row.date,
        row.slot,
        row.topic,
        row.format,
        row.visual_route,
        row.traffic_route,
        row.views_target,
        row.follower_target,
        row.hook,
        row.follow_cta,
        row.caption,
        row.hashtags,
        row.image_or_reel_direction,
        row.seo_sync_page,
        row.ten_day_review_metric
      ]
        .map(escapeCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |")
    )
  ];

  return `${header.join("\n")}\n`;
}

export async function generateGrowthPlaybook(options: { startDate?: string; days?: number; root?: string } = {}): Promise<string[]> {
  const root = projectRoot(options.root);
  const startDate = options.startDate ?? "2026-07-11";
  const totalDays = options.days ?? 90;
  const playbook = buildGrowthPlaybook(startDate, totalDays);
  const outputDir = join(root, "content-playbooks");
  await mkdir(outputDir, { recursive: true });

  const baseName = `${startDate}_90-day-view-growth-playbook`;
  const jsonPath = join(outputDir, `${baseName}.json`);
  const markdownPath = join(outputDir, `${baseName}.md`);

  await writeFile(jsonPath, `${JSON.stringify(playbook, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, toMarkdown(playbook), "utf8");

  return [jsonPath, markdownPath];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const paths = await generateGrowthPlaybook({
    startDate: getOption(args, "start-date"),
    days: getOption(args, "days") ? Number(getOption(args, "days")) : undefined,
    root: getOption(args, "root")
  });

  for (const filePath of paths) {
    console.log(`Growth playbook ready: ${filePath}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
