import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { projectRoot } from "./paths";

// Reach as a percentage of followers is the wrong yardstick for a shop that only
// serves one city: the denominator counts people who could never become
// customers, and the number moves when the follower count moves rather than when
// the business does. These are absolute counts of things that precede a booking.

export interface LocalReachReport {
  generated_at: string;
  since: string;
  until: string;
  days: number;
  reach_total: number | null;
  reach_non_follower: number | null;
  reach_follower: number | null;
  accounts_engaged: number | null;
  profile_links_taps: number | null;
  followers_now: number | null;
  followers_gained: number | null;
  local_follower_share: number | null;
  data_gaps: string[];
}

interface GraphQuery {
  metric: string;
  period?: string;
  metricType?: string;
  breakdown?: string;
  since?: number;
  until?: number;
}

async function insights(
  igUserId: string,
  token: string,
  version: string,
  query: GraphQuery
): Promise<{ ok: boolean; body: Record<string, unknown>; error?: string }> {
  const url = new URL(`https://graph.facebook.com/${version}/${igUserId}/insights`);
  url.searchParams.set("metric", query.metric);
  url.searchParams.set("period", query.period ?? "day");
  if (query.metricType) url.searchParams.set("metric_type", query.metricType);
  if (query.breakdown) url.searchParams.set("breakdown", query.breakdown);
  if (query.since) url.searchParams.set("since", String(query.since));
  if (query.until) url.searchParams.set("until", String(query.until));

  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const body = (await response.json()) as Record<string, unknown>;
  const error = (body.error as { message?: string } | undefined)?.message;
  return { ok: response.ok && !error, body, error };
}

function totalValue(body: Record<string, unknown>): number | null {
  const data = body.data as Array<{ total_value?: { value?: number } }> | undefined;
  const value = data?.[0]?.total_value?.value;
  return typeof value === "number" ? value : null;
}

function breakdownValue(body: Record<string, unknown>, dimension: string): number | null {
  const data = body.data as
    | Array<{ total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> } }>
    | undefined;
  const results = data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  const hit = results.find((row) => row.dimension_values?.includes(dimension));
  return typeof hit?.value === "number" ? hit.value : null;
}

function daySeriesTotal(body: Record<string, unknown>): number | null {
  const data = body.data as Array<{ values?: Array<{ value?: number }> }> | undefined;
  const values = data?.[0]?.values;
  if (!values) return null;
  return values.reduce((sum, item) => sum + (typeof item.value === "number" ? item.value : 0), 0);
}

export async function buildLocalReachReport(
  options: { days?: number; root?: string } = {}
): Promise<LocalReachReport> {
  const config = getConfig();
  const token = config.metaAnalyticsAccessToken || config.metaAccessToken;
  const igUserId = config.instagramUserId;
  if (!token) throw new Error("META_ANALYTICS_ACCESS_TOKEN or META_ACCESS_TOKEN is required.");
  if (!igUserId) throw new Error("IG_USER_ID is required.");

  const days = options.days ?? 28;
  const until = Math.floor(Date.now() / 1000);
  const since = until - (days - 1) * 86_400;
  const gaps: string[] = [];

  const reach = await insights(igUserId, token, config.graphApiVersion, {
    metric: "reach",
    breakdown: "follow_type",
    metricType: "total_value",
    since,
    until
  });
  if (!reach.ok) gaps.push(`reach unavailable: ${reach.error}`);

  const engaged = await insights(igUserId, token, config.graphApiVersion, {
    metric: "accounts_engaged",
    metricType: "total_value",
    since,
    until
  });
  if (!engaged.ok) gaps.push(`accounts_engaged unavailable: ${engaged.error}`);

  const taps = await insights(igUserId, token, config.graphApiVersion, {
    metric: "profile_links_taps",
    metricType: "total_value",
    since,
    until
  });
  if (!taps.ok) gaps.push(`profile_links_taps unavailable: ${taps.error}`);

  const gained = await insights(igUserId, token, config.graphApiVersion, {
    metric: "follower_count",
    since,
    until
  });
  if (!gained.ok) gaps.push(`follower_count unavailable: ${gained.error}`);

  const profileUrl = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${igUserId}`);
  profileUrl.searchParams.set("fields", "followers_count");
  const profileResponse = await fetch(profileUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const profile = (await profileResponse.json()) as { followers_count?: number; error?: { message?: string } };
  if (profile.error) gaps.push(`followers_count unavailable: ${profile.error.message}`);

  const cities = await insights(igUserId, token, config.graphApiVersion, {
    metric: "follower_demographics",
    period: "lifetime",
    metricType: "total_value",
    breakdown: "city"
  });
  let localShare: number | null = null;
  if (!cities.ok) {
    gaps.push(`follower_demographics unavailable: ${cities.error}`);
  } else {
    const data = cities.body.data as
      | Array<{ total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> } }>
      | undefined;
    const rows = data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
    const taichung = rows
      .filter((row) => (row.dimension_values?.[0] ?? "").toLowerCase().includes("taichung"))
      .reduce((sum, row) => sum + (row.value ?? 0), 0);
    localShare = total > 0 ? Number((taichung / total).toFixed(4)) : null;
  }

  const toDate = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

  return {
    generated_at: new Date().toISOString(),
    since: toDate(since),
    until: toDate(until),
    days,
    reach_total: reach.ok ? totalValue(reach.body) : null,
    reach_non_follower: reach.ok ? breakdownValue(reach.body, "NON_FOLLOWER") : null,
    reach_follower: reach.ok ? breakdownValue(reach.body, "FOLLOWER") : null,
    accounts_engaged: engaged.ok ? totalValue(engaged.body) : null,
    profile_links_taps: taps.ok ? totalValue(taps.body) : null,
    followers_now: typeof profile.followers_count === "number" ? profile.followers_count : null,
    followers_gained: gained.ok ? daySeriesTotal(gained.body) : null,
    local_follower_share: localShare,
    data_gaps: gaps
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const report = await buildLocalReachReport({ days: getNumberOption(args, "days") });
  const output =
    getOption(args, "output") ?? join(projectRoot(getOption(args, "root")), "output", "operations", "local-reach.json");

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
