import { loadAbTestPlan, planForDate, planSlot } from "./abTestPlan";
import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { isLiveAiredReelEntry, loadDailyContent, loadPostLog, loadVideoSources } from "./logging";
import { projectRoot } from "./paths";
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
  verdict: "pass" | "fail" | "pending" | "not_published";
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

function isLiveInstagramReelPost(post: PostLogEntry): boolean {
  // isLiveAiredReelEntry already carries the dry_run/status/video_status
  // rules for "did this really air" (including "uncertain": a commit-point
  // ack failure whose post may still be live -- excluding it here would
  // silently drop a Reel that published but had a flaky success response).
  // published_media_type narrows its reel-or-mixed-carousel match to reel
  // only, since mixed-carousel is a different format this tool never judges.
  return post.platform === "instagram" && post.published_media_type === "reel" && isLiveAiredReelEntry(post);
}

/**
 * True when video-sources says this slot's clip was copied from this
 * concept's own report (scheduleReel.ts always writes
 * `source_reference: copx:<RUN_DIR>/report-<concept.id>-before.json`, so the
 * concept id is embedded verbatim). Undefined -- not false -- when there is
 * no record for that slot: a missing record is not evidence of a mismatch.
 */
async function videoSourceConceptMatch(
  date: string,
  slotNumber: number,
  conceptId: string,
  root: string
): Promise<boolean | undefined> {
  const sources = await loadVideoSources(date, root);
  const source = sources.find((item) => item.slot === slotNumber);
  // Only scheduleReel.ts's own route embeds the concept id in a parseable
  // way (`copx:<RUN_DIR>/report-<concept.id>-before.json`). generateGrokVideo.ts
  // and importGrokVideo.ts write the same file with source_reference set to a
  // bare xAI request id or a caller-supplied reference instead -- reading
  // that as a concept mismatch would report a confident "wrong concept" with
  // no real evidence behind it, for a Reel that never went through
  // scheduleReel.ts at all.
  if (source?.source_route !== "hermes-xai-oauth") return undefined;
  const reference = source.source_reference;
  if (typeof reference !== "string") return undefined;
  return reference.includes(`report-${conceptId}-before.json`);
}

/**
 * Which slot actually carries *this concept's* published Reel. Two things
 * drift out from under a hardcoded slot number:
 *
 * 1. Production ran two Reels/day (noon=slot 3, evening=slot 2) through
 *    2026-08-14; from 2026-08-15 the evening half of ab-test-plan.json is
 *    paused and the day's one Reel can land at either slot, so a hardcoded
 *    slot silently starts scoring whatever unrelated post happens to sit in
 *    the other one (ERROR-BOOK F26).
 * 2. Even once the right *slot* is found, the clip that actually aired there
 *    is not guaranteed to be this row's own concept: ab-test-plan.json's noon
 *    half pulls a *different*, re-aired concept forward, and REEL_SCHEDULE /
 *    the extension schedule is a separately-edited file that does not track
 *    that pull. Production has already done this for real: 2026-08-16's
 *    REEL_SCHEDULE row is heel-tip-scuff, but data/video-sources/2026-08-16.json
 *    and the calendar's own slot-3 topic both show the clip that aired that
 *    day was white-shoe-yellowing's, pulled forward as that day's noon half.
 *    Reading video-sources' source_reference (see videoSourceConceptMatch)
 *    is the most direct ground truth for "whose Reel is this," since it is
 *    written by the one function that ever schedules a Reel and is anchored
 *    to the concept's stable id rather than to its prose hook, which gets
 *    rewritten over time (ERROR-BOOK F27).
 */
async function findLiveReelSlot(
  date: string,
  conceptId: string,
  posts: PostLogEntry[],
  root: string
): Promise<{ slotNumber: number; post: PostLogEntry } | undefined> {
  const reelPosts = posts.filter(isLiveInstagramReelPost);
  if (reelPosts.length === 0) return undefined;

  const matches = await Promise.all(
    reelPosts.map((post) => videoSourceConceptMatch(date, post.slot, conceptId, root))
  );
  const confirmedIndex = matches.findIndex((match) => match === true);
  if (confirmedIndex >= 0) {
    const post = reelPosts[confirmedIndex]!;
    return { slotNumber: post.slot, post };
  }

  if (reelPosts.length === 1) {
    // The only live Reel that day has video-sources evidence naming a
    // *different* concept: it is not this row's Reel to measure, and
    // crediting it here is exactly the F26 mistake one level down (right
    // slot, wrong concept). No evidence either way (undefined) still counts
    // as this row's Reel, matching every pre-video-sources historical date.
    return matches[0] === false ? undefined : { slotNumber: reelPosts[0]!.slot, post: reelPosts[0]! };
  }

  // Two or more real Reels the same day, none confirmed by video-sources
  // (either no record at all, or every record points elsewhere) -- only
  // happened on the old dual-Reel schedule. ab-test-plan.json still answers
  // which half is this row's own concept, matching conceptId against the
  // half it names rather than just checking a half is unpaused -- an
  // unpaused half is not proof it is this concept's half, since the plan and
  // the REEL_SCHEDULE/extension schedule are two separately-edited files.
  const abPlan = planForDate(await loadAbTestPlan(root), date);
  const preferredSlot =
    planSlot(abPlan, 2)?.conceptId === conceptId ? 2 : planSlot(abPlan, 3)?.conceptId === conceptId ? 3 : 2;
  const chosen = reelPosts.find((post) => post.slot === preferredSlot) ?? reelPosts[0]!;
  return { slotNumber: chosen.slot, post: chosen };
}

export async function reviewBatch(options: { asOf?: string; root?: string } = {}): Promise<BatchReview> {
  const root = projectRoot(options.root);
  loadExtensions(root);
  const config = getConfig();
  const now = options.asOf ? new Date(`${options.asOf}T23:59:59+08:00`) : new Date();
  const gaps: string[] = [];
  const outcomes: ReelOutcome[] = [];

  for (const entry of REEL_SCHEDULE) {
    const concept = REEL_CONCEPTS.find((item) => item.id === entry.conceptId);
    const content = await loadDailyContent(entry.date, root);
    const posts = await loadPostLog(entry.date, root);
    const live = await findLiveReelSlot(entry.date, entry.conceptId, posts, root);
    // Only a real hit names a slot to look the cosmetic hook fallback up in;
    // guessing slot 2 here when nothing published would credit `base.hook`
    // with whatever unrelated topic happened to sit there.
    const slot = live ? content?.slots.find((item) => item.slot === live.slotNumber) : undefined;

    const base = {
      date: entry.date,
      concept_id: entry.conceptId,
      object_type: concept?.object_type ?? "unknown",
      hook: concept?.hook ?? slot?.topic ?? ""
    };

    if (!live) {
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

    const hours = (now.getTime() - Date.parse(live.post.created_at)) / 3_600_000;
    const mature = hours >= 72;
    const metrics = await loadReelMetrics(entry.date, live.slotNumber, root);
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
    data_gaps: gaps.length ? gaps : [`timezone ${config.timezone}`].slice(0, 0)
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
