import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { loadConversionEvents } from "./conversionFunnel";
import { loadDailyContent, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { postedLogDirectory, projectRoot, review72HourPath } from "./paths";
import type { Platform, PostLogEntry } from "./types";

type MetricName = "reach" | "saved" | "shares";
type InsightRow = Record<string, unknown> & { date?: unknown; slot?: unknown; metrics?: unknown; insights?: unknown };

export interface Review72HourRow {
  date: string;
  slot: number;
  topic: string;
  media_type: string;
  published_at: string;
  eligible_at: string;
  metrics: Record<MetricName | "line_clicks" | "inquiries" | "bookings" | "revenue_twd", number | null>;
  data_quality: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numeric(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function metricFromRow(row: InsightRow | undefined, name: MetricName): number | undefined {
  if (!row) return undefined;
  const sources = [row.metrics, row.insights, row].filter(isRecord);
  const aliases: Record<MetricName, string[]> = {
    reach: ["reach", "post_impressions_unique", "impressions_unique"],
    saved: ["saved", "saves"],
    shares: ["shares", "share"]
  };
  for (const source of sources) {
    for (const alias of aliases[name]) {
      const entry = Object.entries(source).find(([key]) => key.toLowerCase() === alias);
      const value = entry ? numeric(entry[1]) : undefined;
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

async function loadInsightRows(root: string, platform: Platform): Promise<Map<string, InsightRow>> {
  const directory = join(root, "data", "insights", platform);
  const files = await readdir(directory).catch(() => [] as string[]);
  const map = new Map<string, { row: InsightRow; generatedAt: string }>();
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    const payload = await readJsonFile<{ generated_at?: unknown; rows?: unknown }>(join(directory, file), {});
    if (!Array.isArray(payload.rows)) continue;
    const generatedAt = typeof payload.generated_at === "string" ? payload.generated_at : file;
    for (const row of payload.rows.filter(isRecord) as InsightRow[]) {
      const date = typeof row.date === "string" ? row.date : "";
      const slot = numeric(row.slot);
      if (!date || !slot) continue;
      const key = `${date}:${slot}`;
      const previous = map.get(key);
      if (!previous || generatedAt >= previous.generatedAt) {
        map.set(key, { row, generatedAt });
      }
    }
  }
  return new Map([...map].map(([key, value]) => [key, value.row]));
}

function successfulLive(entries: PostLogEntry[], slot: number, platform: Platform): PostLogEntry | undefined {
  return entries
    .filter(
      (entry) =>
        entry.slot === slot &&
        entry.platform === platform &&
        !entry.dry_run &&
        ["success", "posted"].includes(entry.status)
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .at(-1);
}

export async function generate72HourReview(options: { root?: string; asOf?: Date } = {}): Promise<Review72HourRow[]> {
  const root = projectRoot(options.root);
  const asOf = options.asOf ?? new Date();
  const [files, instagram, facebook, conversions] = await Promise.all([
    readdir(postedLogDirectory(root)).catch(() => [] as string[]),
    loadInsightRows(root, "instagram"),
    loadInsightRows(root, "facebook"),
    loadConversionEvents(root)
  ]);
  const rows: Review72HourRow[] = [];

  for (const file of files.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()) {
    const date = file.slice(0, 10);
    const [posts, content] = await Promise.all([loadPostLog(date, root), loadDailyContent(date, root)]);
    for (const slot of [1, 2]) {
      const fb = successfulLive(posts, slot, "facebook");
      const ig = successfulLive(posts, slot, "instagram");
      if (!fb || !ig) continue;
      const publishedAt = [fb.created_at, ig.created_at].sort().at(-1)!;
      const eligibleAt = new Date(Date.parse(publishedAt) + 72 * 60 * 60 * 1000);
      if (eligibleAt > asOf) continue;

      const key = `${date}:${slot}`;
      const insightRows = [facebook.get(key), instagram.get(key)];
      const metric = (name: MetricName): number | null => {
        const values = insightRows.map((row) => metricFromRow(row, name)).filter((value): value is number => value !== undefined);
        return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
      };
      const attributed = conversions.filter((event) => event.content_date === date && event.slot === slot);
      const sumEvents = (eventType: string): number | null => {
        const matches = attributed.filter((event) => event.event_type === eventType);
        return matches.length > 0 ? matches.reduce((sum, event) => sum + event.count, 0) : null;
      };
      const revenueMatches = attributed.filter((event) => event.event_type === "revenue");
      const dataQuality: string[] = [];
      const reach = metric("reach");
      const saved = metric("saved");
      const shares = metric("shares");
      if (reach === null) dataQuality.push("reach unavailable: Meta insight permission or refresh missing");
      if (saved === null) dataQuality.push("saved unavailable: Meta insight permission or refresh missing");
      if (shares === null) dataQuality.push("shares unavailable: Meta insight permission or refresh missing");
      if (!attributed.some((event) => event.event_type === "line_click")) dataQuality.push("LINE clicks unavailable: GA4 export/backfill missing");
      if (!attributed.some((event) => event.event_type === "booking")) dataQuality.push("bookings unavailable: store backfill missing");

      const actual = content?.slots.find((item) => item.slot === slot);
      rows.push({
        date,
        slot,
        topic: actual?.topic ?? "",
        media_type: actual?.media_type ?? "image",
        published_at: publishedAt,
        eligible_at: eligibleAt.toISOString(),
        metrics: {
          reach,
          saved,
          shares,
          line_clicks: sumEvents("line_click"),
          inquiries: sumEvents("inquiry"),
          bookings: sumEvents("booking"),
          revenue_twd: revenueMatches.length > 0
            ? revenueMatches.reduce((sum, event) => sum + (event.revenue_twd ?? 0), 0)
            : null
        },
        data_quality: dataQuality
      });
    }
  }

  await writeJsonAtomic(review72HourPath(root), {
    generated_at: asOf.toISOString(),
    rule: "Only content with successful live FB and IG posts at least 72 hours old is included.",
    rows
  });
  return rows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rows = await generate72HourReview({
    root: getOption(args, "root"),
    asOf: getOption(args, "as-of") ? new Date(getOption(args, "as-of")!) : undefined
  });
  console.log(JSON.stringify({ reviewed_slots: rows.length, output: review72HourPath(projectRoot(getOption(args, "root"))) }, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
