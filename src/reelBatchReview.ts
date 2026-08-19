import { getNumberOption, getOption, isMain } from "./cli";
import { loadDailyContent, loadPostLog } from "./logging";
import { projectRoot } from "./paths";
import { findStrictLiveTransportEntry, isQualifiedInstagramReel } from "./publishingReconciliation";
import { REEL_CONCEPTS, REEL_SCHEDULE, loadExtensions } from "./reelConcepts";
import type { PostLogEntry } from "./types";

// Judges a published batch of Reels against the per-Reel thresholds in
// content-playbooks/reels-roadmap.md, so the next batch is built from what happened rather
// than from taste. Without this the second batch is just six more guesses.
//
// A Reel is measured 72 hours after it published, which is the window the
// algorithm does most of its testing in. Anything younger is reported as
// pending rather than counted as a failure.

const THRESHOLDS_72H = {
  reach: 300,
  non_follower_share: 0.6,
  accounts_engaged: 5,
  saves_plus_shares: 3
};

export interface ReelOutcome {
  date: string;
  concept_id: string;
  object_type: string;
  hook: string;
  published: boolean;
  hours_since_publish: number | null;
  mature: boolean;
  reach: number | null;
  non_follower_share: number | null;
  accounts_engaged: number | null;
  saves_plus_shares: number | null;
  verdict: "pass" | "fail" | "pending" | "not_published" | "data_gap";
  missed: string[];
}

export interface BatchReview {
  generated_at: string;
  batch: Array<{ date: string; concept_id: string }>;
  outcomes: ReelOutcome[];
  mature_count: number;
  pass_count: number;
  recommendation: string;
  keep: string[];
  drop: string[];
  data_gaps: string[];
}

interface InsightMetrics {
  views?: number | null;
  reach?: number | null;
  saved?: number | null;
  shares?: number | null;
  total_interactions?: number | null;
}

function successLookingInstagramClaim(entries: readonly PostLogEntry[], slot: number): boolean {
  return entries.some(
    (entry) =>
      entry.slot === slot &&
      entry.platform === "instagram" &&
      (entry.status === "success" || entry.status === "posted") &&
      entry.dry_run !== true
  );
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

async function loadReelMetrics(
  date: string,
  slot: number,
  root: string
): Promise<InsightMetrics | undefined> {
  // Insight files are written per sync window, so scan them rather than guess
  // which window a given date landed in.
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(root, "data", "insights", "instagram");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return undefined;
  }

  const { readJsonFile } = await import("./logging");
  for (const file of files.sort().reverse()) {
    const payload = await readJsonFile<{ rows?: Array<Record<string, unknown>> }>(join(dir, file), {});
    const row = payload.rows?.find((item) => item.date === date && item.slot === slot);
    if (row && row.insights_ok === true && row.metrics) return row.metrics as InsightMetrics;
  }
  return undefined;
}

export async function reviewBatch(options: { asOf?: string; root?: string } = {}): Promise<BatchReview> {
  const root = projectRoot(options.root);
  loadExtensions(root);
  const now = options.asOf ? new Date(`${options.asOf}T23:59:59+08:00`) : new Date();
  const gaps: string[] = [];
  const outcomes: ReelOutcome[] = [];

  for (const entry of REEL_SCHEDULE) {
    const concept = REEL_CONCEPTS.find((item) => item.id === entry.conceptId);
    const content = await loadDailyContent(entry.date, root);
    const matchingSlots = content?.slots.filter((item) => item.slot === 2) ?? [];
    const slot = matchingSlots.length === 1 ? matchingSlots[0] : undefined;
    const posts = await loadPostLog(entry.date, root);

    const base = {
      date: entry.date,
      concept_id: entry.conceptId,
      object_type: concept?.object_type ?? "unknown",
      hook: concept?.hook ?? slot?.topic ?? ""
    };

    const dataGap = (reason: string): void => {
      gaps.push(`${entry.date}: ${reason}`);
      outcomes.push({
        ...base,
        published: false,
        hours_since_publish: null,
        mature: false,
        reach: null,
        non_follower_share: null,
        accounts_engaged: null,
        saves_plus_shares: null,
        verdict: "data_gap",
        missed: []
      });
    };

    if (!content) {
      dataGap("content calendar missing; excluded from Reel strategy sample");
      continue;
    }
    if (content.tampered) {
      dataGap("content calendar integrity is tampered; excluded from Reel strategy sample");
      continue;
    }
    if (!slot) {
      dataGap("slot 2 is missing or ambiguous in the calendar; excluded from Reel strategy sample");
      continue;
    }
    if (slot.media_type !== "reel") {
      dataGap("calendar does not bind slot 2 to a Reel; image fallback is not a Reel strategy sample");
      continue;
    }

    const live = findStrictLiveTransportEntry(posts, { date: entry.date, slot: 2, platform: "instagram" });
    if (!live) {
      if (successLookingInstagramClaim(posts, 2)) {
        dataGap("Instagram live transport evidence is missing or ambiguous; excluded from Reel strategy sample");
        continue;
      }
      outcomes.push({
        ...base,
        published: false,
        hours_since_publish: null,
        mature: false,
        reach: null,
        non_follower_share: null,
        accounts_engaged: null,
        saves_plus_shares: null,
        verdict: "not_published",
        missed: []
      });
      continue;
    }

    if (!isQualifiedInstagramReel(live)) {
      dataGap("Instagram row lacks qualified Reel read-back evidence; fallback or VIDEO_DEFERRED is not a Reel strategy sample");
      continue;
    }
    if (!validTimestamp(live.created_at) || Date.parse(live.created_at) > now.getTime()) {
      dataGap("Instagram Reel timestamp is invalid or in the future; excluded from Reel strategy sample");
      continue;
    }

    const hours = (now.getTime() - Date.parse(live.created_at)) / 3_600_000;
    const mature = hours >= 72;
    const metrics = await loadReelMetrics(entry.date, 2, root);
    if (!metrics && mature) gaps.push(`${entry.date}: published but no Instagram insight row yet`);

    const reach = typeof metrics?.reach === "number" ? metrics.reach : null;
    const engaged = typeof metrics?.total_interactions === "number" ? metrics.total_interactions : null;
    const saves =
      typeof metrics?.saved === "number" || typeof metrics?.shares === "number"
        ? (metrics?.saved ?? 0) + (metrics?.shares ?? 0)
        : null;

    const missed: string[] = [];
    if (reach !== null && reach < THRESHOLDS_72H.reach) missed.push(`reach ${reach} < ${THRESHOLDS_72H.reach}`);
    if (engaged !== null && engaged < THRESHOLDS_72H.accounts_engaged) {
      missed.push(`engaged ${engaged} < ${THRESHOLDS_72H.accounts_engaged}`);
    }
    if (saves !== null && saves < THRESHOLDS_72H.saves_plus_shares) {
      missed.push(`saves+shares ${saves} < ${THRESHOLDS_72H.saves_plus_shares}`);
    }

    // A metric that was never collected is not a pass. Only a Reel old enough
    // to judge, with numbers to judge it by, gets a verdict.
    const measurable = reach !== null && engaged !== null;
    outcomes.push({
      ...base,
      published: true,
      hours_since_publish: Math.round(hours),
      mature,
      reach,
      non_follower_share: null,
      accounts_engaged: engaged,
      saves_plus_shares: saves,
      verdict: !mature || !measurable ? "pending" : missed.length === 0 ? "pass" : "fail",
      missed
    });
  }

  const matured = outcomes.filter((item) => item.verdict === "pass" || item.verdict === "fail");
  const passed = matured.filter((item) => item.verdict === "pass");

  let recommendation: string;
  if (matured.length === 0) {
    recommendation =
      "No Reel is 72 hours old with insights yet. Build batch two on the same structure and revisit once the first three have matured.";
  } else if (passed.length >= matured.length / 2) {
    recommendation = `${passed.length} of ${matured.length} cleared the bar. Keep the format; vary object type and hook in batch two.`;
  } else {
    recommendation = `Only ${passed.length} of ${matured.length} cleared the bar. Change one variable in batch two — hook wording first, since it decides the first two seconds — and hold everything else constant so the comparison means something.`;
  }

  return {
    generated_at: new Date().toISOString(),
    batch: REEL_SCHEDULE.map((entry) => ({ date: entry.date, concept_id: entry.conceptId })),
    outcomes,
    mature_count: matured.length,
    pass_count: passed.length,
    recommendation,
    keep: passed.map((item) => item.object_type),
    drop: matured.filter((item) => item.verdict === "fail").map((item) => item.object_type),
    data_gaps: gaps
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  void getNumberOption(args, "unused");
  const review = await reviewBatch({ asOf: getOption(args, "as-of"), root: getOption(args, "root") });
  console.log(JSON.stringify(review, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
