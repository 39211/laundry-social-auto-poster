import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAbTestPlan, type AbDayPlan, type AbVariant } from "./abTestPlan";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, readJsonFile } from "./logging";
import { projectRoot } from "./paths";
import {
  assertPostedLogMatchesDate,
  assertYouTubeLogEntries,
  isQualifiedInstagramReel,
  verifyYouTubeCompletionEvidence,
  type YouTubeCompletionSourceBinding,
  type YouTubeLogEntry
} from "./publishingReconciliation";
import { getZonedDateParts } from "./scheduler";
import type { PostLogEntry, RemoteReelEvidence } from "./types";

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

const POST_LOG_PLATFORMS = new Set(["facebook", "instagram"]);
const POST_LOG_STATUSES = new Set([
  "pending",
  "success",
  "dry_run",
  "posted",
  "failed",
  "skipped",
  "missed",
  "uncertain"
]);

/**
 * The shared assertion rejects wrong dates and missing dry_run fields. The A/B
 * report also has to reject arbitrary strings for platform/status: otherwise
 * `!entry.dry_run` can turn a corrupted record into a statistical sample.
 */
function assertAbPostedLogEntries(date: string, entries: unknown): asserts entries is readonly PostLogEntry[] {
  assertPostedLogMatchesDate(date, entries);
  entries.forEach((entry, index) => {
    if (!POST_LOG_PLATFORMS.has(entry.platform)) {
      throw new Error(`Invalid posted-log platform at index ${index} for ${date}: ${entry.platform}.`);
    }
    if (!POST_LOG_STATUSES.has(entry.status)) {
      throw new Error(`Invalid posted-log status at index ${index} for ${date}: ${entry.status}.`);
    }
  });
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
}

function normalizedSha256(value: unknown): string | undefined {
  return isSha256(value) ? value.toLowerCase() : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isFacebookPermalink(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "facebook.com" ||
        hostname.endsWith(".facebook.com") ||
        hostname === "fb.watch" ||
        hostname.endsWith(".fb.watch"))
    );
  } catch {
    return false;
  }
}

function hasVerifiedFacebookReelEvidence(
  value: unknown,
  postId: unknown
): value is RemoteReelEvidence {
  if (!value || typeof value !== "object" || typeof postId !== "string" || postId.trim().length === 0) {
    return false;
  }
  const evidence = value as Partial<RemoteReelEvidence>;
  return (
    evidence.remote_id === postId &&
    isFacebookPermalink(evidence.permalink) &&
    typeof evidence.verified_at === "string" &&
    !Number.isNaN(Date.parse(evidence.verified_at)) &&
    evidence.remote_media_type === "REELS" &&
    evidence.caption_exact_match === true
  );
}

function isQualifiedFacebookReel(entry: PostLogEntry): boolean {
  return (
    entry.platform === "facebook" &&
    !entry.dry_run &&
    (entry.status === "success" || entry.status === "posted") &&
    entry.published_media_type === "reel" &&
    entry.video_status === "published" &&
    isSha256(entry.video_sha256) &&
    hasVerifiedFacebookReelEvidence(entry.remote_reel_evidence, entry.post_id)
  );
}

interface QualifiedAbVideoDelivery {
  facebook: PostLogEntry;
  instagram: PostLogEntry;
}

/**
 * A/B samples represent a complete, auditable delivery of the same Reel, not
 * a plan row, one provider transport id, or a fallback image that happened to
 * have an A/B label. Both remote read-backs bind to the exact submitted bytes.
 */
function findQualifiedAbVideoDelivery(
  entries: readonly PostLogEntry[],
  date: string,
  slot: number
): QualifiedAbVideoDelivery | undefined {
  const sameSlot = entries.filter((entry) => entry.date === date && entry.slot === slot);
  const facebook = sameSlot.filter(isQualifiedFacebookReel);
  const instagram = sameSlot.filter(isQualifiedInstagramReel);
  if (facebook.length !== 1 || instagram.length !== 1) return undefined;
  const facebookEntry = facebook[0]!;
  const instagramEntry = instagram[0]!;
  return facebookEntry.video_sha256!.toLowerCase() === instagramEntry.video_sha256!.toLowerCase()
    ? { facebook: facebookEntry, instagram: instagramEntry }
    : undefined;
}

/**
 * The shared completion verifier intentionally takes a concrete source
 * binding. A/B reporting must build that binding from the already-qualified
 * same-day delivery rather than treating its own YouTube ledger as proof.
 */
async function sourceBindingForQualifiedAbVideoDelivery(input: {
  root: string;
  date: string;
  slot: number;
  delivery: QualifiedAbVideoDelivery;
}): Promise<{ source?: YouTubeCompletionSourceBinding; reason?: string }> {
  const instagramVideoSha256 = normalizedSha256(input.delivery.instagram.video_sha256);
  const instagramPostId = nonEmptyString(input.delivery.instagram.post_id);
  if (!instagramVideoSha256 || !instagramPostId) {
    return { reason: "qualified Instagram Reel has no usable source hash or post id" };
  }

  let content;
  try {
    content = await loadDailyContent(input.date, input.root);
  } catch (error) {
    return {
      reason: `calendar cannot be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (content?.tampered) {
    return { reason: "calendar integrity is marked tampered; approved local MP4 binding is unavailable" };
  }
  const slot = content?.slots.find((candidate) => candidate.slot === input.slot);
  if (!slot?.local_video_path) {
    return { reason: "calendar has no local MP4 for this slot" };
  }

  try {
    const bytes = await readFile(join(input.root, ...slot.local_video_path.split("/")));
    const localVideoSha256 = createHash("sha256").update(bytes).digest("hex");
    if (localVideoSha256 !== instagramVideoSha256) {
      return { reason: "calendar local MP4 SHA-256 no longer matches the qualified Instagram Reel" };
    }
    return {
      source: {
        local_video_path: slot.local_video_path,
        local_video_sha256: localVideoSha256,
        instagram_video_sha256: instagramVideoSha256,
        instagram_post_id: instagramPostId
      }
    };
  } catch (error) {
    return {
      reason: `calendar local MP4 cannot be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function isVerifiedAbYouTubeUpload(input: {
  root: string;
  date: string;
  slot: number;
  delivery: QualifiedAbVideoDelivery | undefined;
  entries: readonly YouTubeLogEntry[];
  ledgerValid: boolean;
}): Promise<{ uploaded: boolean; dataGap?: string }> {
  if (!input.delivery || !input.ledgerValid) return { uploaded: false };

  const crossDateSameSlot = input.entries.filter(
    (entry) => entry.slot === input.slot && entry.date !== input.date
  );
  if (crossDateSameSlot.length > 0) {
    return {
      uploaded: false,
      dataGap: `${input.date} slot ${input.slot}: ${crossDateSameSlot.length} cross-date YouTube ledger record(s) for this slot make completion ambiguous; upload is unverified.`
    };
  }
  const candidates = input.entries.filter((entry) => entry.date === input.date && entry.slot === input.slot);
  if (candidates.length === 0) {
    return {
      uploaded: false,
      dataGap: `${input.date} slot ${input.slot}: no same-date YouTube ledger record bound to the qualified Reel delivery.`
    };
  }
  if (candidates.length !== 1) {
    return {
      uploaded: false,
      dataGap: `${input.date} slot ${input.slot}: ${candidates.length} same-date YouTube ledger records make completion ambiguous; upload is unverified.`
    };
  }

  const binding = await sourceBindingForQualifiedAbVideoDelivery({
    root: input.root,
    date: input.date,
    slot: input.slot,
    delivery: input.delivery
  });
  if (!binding.source) {
    return {
      uploaded: false,
      dataGap: `${input.date} slot ${input.slot}: YouTube upload is unverified because the qualified Instagram source binding is unavailable (${binding.reason ?? "unknown reason"}).`
    };
  }

  const proof = await verifyYouTubeCompletionEvidence({
    date: input.date,
    slot: input.slot,
    root: input.root,
    entry: candidates[0]!,
    source: binding.source
  });
  if (!proof.verified) {
    return {
      uploaded: false,
      dataGap: `${input.date} slot ${input.slot}: YouTube upload is unverified (${proof.reason ?? "immutable completion proof missing"}).`
    };
  }
  return { uploaded: true };
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
    let posts: readonly PostLogEntry[] = [];
    let postedLogValid = true;
    try {
      const rawPosts = await readJsonFile<unknown>(
        join(root, "data", "posted-log", `${day.date}.json`),
        []
      );
      assertAbPostedLogEntries(day.date, rawPosts);
      posts = rawPosts;
    } catch (error) {
      postedLogValid = false;
      dataGaps.push(
        `${day.date}: posted-log is invalid; all delivery claims and metrics are suppressed (${error instanceof Error ? error.message : String(error)}).`
      );
    }
    let ytLog: readonly YouTubeLogEntry[] = [];
    let youtubeLedgerValid = true;
    try {
      const rawYouTubeLog = await readJsonFile<unknown>(
        join(root, "data", "youtube-log", `${day.date}.json`),
        []
      );
      // A file in the day directory is not evidence that an upload belongs to
      // that day. Reuse the publishing reconciliation contract so the A/B
      // report cannot turn a partial/stale ledger into a false success.
      assertYouTubeLogEntries(rawYouTubeLog);
      ytLog = rawYouTubeLog;
      const crossDateEntries = ytLog.filter((entry) => entry.date !== day.date);
      if (crossDateEntries.length > 0) {
        dataGaps.push(
          `${day.date}: youtube-log has ${crossDateEntries.length} cross-date record(s); only exact date and slot matches are counted.`
        );
      }
    } catch (error) {
      youtubeLedgerValid = false;
      // Do not allow one malformed record to leave any row marked uploaded.
      // The report remains usable for its other metrics but exposes the ledger
      // failure explicitly instead of treating it as an empty successful log.
      dataGaps.push(
        `${day.date}: youtube-log is invalid; upload claims suppressed (${error instanceof Error ? error.message : String(error)}).`
      );
    }

    for (const half of [
      { slot: 3, plan: day.noon },
      { slot: 2, plan: day.evening }
    ] as const) {
      // Variant attribution is only from posted-log.ab_variant — never inferred
      // from the plan. A missing field is unattributed contamination, not a free
      // fill from ab-test-plan.json.
      const liveEntries = posts.filter(
        (entry) =>
          entry.date === day.date &&
          entry.slot === half.slot &&
          !entry.dry_run &&
          ["success", "posted"].includes(entry.status)
      );
      const livePlatforms = (["facebook", "instagram"] as const).filter((platform) =>
        liveEntries.some((entry) => entry.platform === platform)
      );
      const delivery = findQualifiedAbVideoDelivery(posts, day.date, half.slot);
      const deliveryEntries = delivery ? [delivery.facebook, delivery.instagram] : [];

      let variant: ReportVariant = "unattributed";
      if (!postedLogValid) {
        dataGaps.push(
          `${day.date} slot ${half.slot}: posted-log is invalid; this row is excluded from delivery and metric samples.`
        );
      } else if (!delivery) {
        if (liveEntries.length === 0) {
          dataGaps.push(
            `${day.date} slot ${half.slot}: no live posted-log entry (plan said ${half.plan.variant}).`
          );
        } else {
          dataGaps.push(
            `${day.date} slot ${half.slot}: no qualified dual-platform Reel delivery; requires matching Facebook and Instagram live Reels, published video status, same SHA-256, and verified remote read-back.`
          );
        }
      } else {
        // Variant attribution is only from the complete delivery pair — never
        // from an image fallback or another partial record in the same slot.
        const attributed = deliveryEntries
          .map((entry) => entry.ab_variant)
          .filter((value): value is AbVariant => value === "10s" || value === "15s");
        if (attributed.length !== deliveryEntries.length) {
          variant = "unattributed";
          dataGaps.push(
            `${day.date} slot ${half.slot}: qualified delivery has a missing ab_variant or invalid ab_variant on one or more platforms; counted as unattributed.`
          );
        } else if (new Set(attributed).size !== 1) {
          variant = "unattributed";
          dataGaps.push(
            `${day.date} slot ${half.slot}: mixed ab_variant on qualified delivery (${[...new Set(attributed)].join(",")}); counted as unattributed.`
          );
        } else {
          variant = attributed[0]!;
        }
      }

      const hasQualifiedDelivery = delivery !== undefined;
      // A planned half without a complete, verified dual-platform Reel is a
      // missing observation. Keep its row below for investigation, but do not
      // let a fallback or stale insight rows contaminate variant totals.
      if (hasQualifiedDelivery) variants[variant].posts += 1;

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

      const reach = postedLogValid && reachParts.length > 0 ? reachParts.reduce((a, b) => a + b, 0) : null;
      const views = postedLogValid && viewParts.length > 0 ? viewParts.reduce((a, b) => a + b, 0) : null;
      const interactions =
        postedLogValid && interactionParts.length > 0 ? interactionParts.reduce((a, b) => a + b, 0) : null;

      if (reach === null) dataGaps.push(`${day.date} slot ${half.slot} (${variant}): reach missing in insights.`);
      if (views === null) dataGaps.push(`${day.date} slot ${half.slot} (${variant}): views missing in insights.`);
      if (interactions === null) {
        dataGaps.push(`${day.date} slot ${half.slot} (${variant}): interactions missing in insights.`);
      }

      if (hasQualifiedDelivery) {
        addSample(variants[variant], "reach", reach);
        addSample(variants[variant], "views", views);
        addSample(variants[variant], "interactions", interactions);
      }

      const youtube = await isVerifiedAbYouTubeUpload({
        root,
        date: day.date,
        slot: half.slot,
        delivery,
        entries: ytLog,
        ledgerValid: youtubeLedgerValid
      });
      if (youtube.dataGap) dataGaps.push(youtube.dataGap);

      reportRows.push({
        date: day.date,
        slot: half.slot,
        variant,
        conceptId: half.plan.conceptId,
        platforms_posted: livePlatforms,
        youtube_uploaded: youtube.uploaded,
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
