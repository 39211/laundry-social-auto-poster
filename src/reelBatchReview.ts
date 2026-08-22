import { loadAbTestPlan, planForDate, planSlot } from "./abTestPlan";
import type { AbDayPlan } from "./abTestPlan";
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

// The roadmap also sets a 60% non-follower-share bar (content-playbooks/reels-roadmap.md,
// "Per-Reel thresholds"), but Instagram's media insights endpoint has no follow-type
// breakdown for individual posts -- only account-level aggregate reach supports
// breakdown=follow_type (see src/localReach.ts, confirmed against Meta's Graph API
// reference docs). There is no per-Reel number to enforce that bar against, so it is
// deliberately left out of THRESHOLDS_72H rather than compared against data that can't
// exist.
const THRESHOLDS_72H = {
  reach: 300,
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
  // Always null -- see the THRESHOLDS_72H comment: the API this tool reads from has no
  // per-Reel follow-type breakdown to populate it from.
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
    // One truncated sync file must not take every date's review down with
    // it -- same reasoning as the video-sources guard below: skip it and
    // keep scanning the rest, rather than let readJsonFile's rethrown
    // non-ENOENT error propagate out of reviewBatch's per-entry loop.
    let payload: { rows?: Array<Record<string, unknown>> };
    try {
      payload = await readJsonFile<{ rows?: Array<Record<string, unknown>> }>(join(dir, file), {});
    } catch {
      continue;
    }
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
  let sources: Awaited<ReturnType<typeof loadVideoSources>>;
  try {
    const loaded = await loadVideoSources(date, root);
    // A malformed video-sources file for one date is not evidence either
    // way, and must not crash every other date's review along with it --
    // readJsonFile rethrows non-ENOENT errors (e.g. truncated JSON), and
    // even valid JSON of the wrong shape (an object instead of an array)
    // would otherwise blow up the .find() call below.
    sources = Array.isArray(loaded) ? loaded : [];
  } catch {
    return undefined;
  }
  // A malformed *element* (e.g. a stray null from a botched manual edit) is
  // just as much "not evidence" as a malformed file -- ?. keeps one bad row
  // from crashing the .find() the same way the try/catch above keeps one
  // bad file from crashing the batch.
  const source = sources.find((item) => item?.slot === slotNumber);
  // generateGrokVideo.ts always writes source_route "xai-api", but
  // importGrokVideo.ts's --source-route flag lets a caller stamp
  // "hermes-xai-oauth" onto a record too (see its sourceRoute option), with
  // source_reference left as an arbitrary caller-supplied string. Trusting
  // the route alone would read that string as a confident "wrong concept"
  // for a Reel that never went through scheduleReel.ts, silently turning a
  // real published Reel into not_published -- so the reference must also be
  // shaped like scheduleReel.ts's own template
  // (`copx:<RUN_DIR>/report-<concept.id>-before.json`, RUN_DIR itself
  // varying) before it counts as evidence either way. A loose
  // .includes("-before.json") check is not enough: a caller-supplied
  // reference can coincidentally contain a real report-like substring (e.g.
  // a human-written note mentioning another concept's report filename)
  // without actually being scheduleReel.ts's output, so the match has to
  // anchor the whole reference to the template's shape and extract the
  // concept id from it, not just search for a substring.
  if (source?.source_route !== "hermes-xai-oauth") return undefined;
  const reference = source.source_reference;
  if (typeof reference !== "string") return undefined;
  const templateMatch = /^copx:.*\/report-([^/]+)-before\.json$/.exec(reference);
  if (!templateMatch) return undefined;
  return templateMatch[1] === conceptId;
}

/**
 * True when ab-test-plan.json's half for this slot names a *different*
 * concept than conceptId. Mirrors videoSourceConceptMatch's tri-state
 * contract (true/false/undefined) so both sources can veto a candidate the
 * same way: undefined when there's no plan for this date, or the half is
 * paused (planSlot already treats a paused half as no half at all), or the
 * date predates ab-test-plan.json entirely -- none of that is evidence
 * either way, only an absence of it.
 */
function abPlanConceptMatch(abPlan: AbDayPlan | undefined, slotNumber: number, conceptId: string): boolean | undefined {
  const half = planSlot(abPlan, slotNumber);
  if (!half) return undefined;
  return half.conceptId === conceptId;
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
 *    This is not only a dual-Reel-day problem: 2026-08-16 itself only
 *    published *one* live Reel, so a single-candidate day is not
 *    automatically safe either. video-sources' source_reference (see
 *    videoSourceConceptMatch) is the most direct ground truth, since it is
 *    written by the one function that ever schedules a Reel and is anchored
 *    to the concept's stable id rather than to its prose hook, which gets
 *    rewritten over time (ERROR-BOOK F27) -- but a day where video-sources
 *    is silent (missing record, or a route this tool doesn't trust) still
 *    needs a second, independent check, which is what ab-test-plan.json's
 *    per-slot conceptId provides.
 *
 * Both sources act as *vetoes*, not proof: a candidate survives only if
 * neither source positively names it as a different concept. Exactly one
 * survivor is credited; zero means both sources agree it isn't this
 * concept, and two or more means neither source can tell them apart -- both
 * report not_published rather than guessing (the old hardcoded ": 2"
 * default), which is how a right-slot-family, wrong-post mistake like F26
 * reappears one layer down.
 */
async function findLiveReelSlot(
  date: string,
  conceptId: string,
  posts: PostLogEntry[],
  root: string
): Promise<{ slotNumber: number; post: PostLogEntry } | undefined> {
  const reelPosts = posts.filter(isLiveInstagramReelPost);
  if (reelPosts.length === 0) return undefined;

  const videoMatches = await Promise.all(
    reelPosts.map((post) => videoSourceConceptMatch(date, post.slot, conceptId, root))
  );
  const confirmedIndex = videoMatches.findIndex((match) => match === true);
  if (confirmedIndex >= 0) {
    const post = reelPosts[confirmedIndex]!;
    return { slotNumber: post.slot, post };
  }

  const afterVideoSources = reelPosts.filter((_, index) => videoMatches[index] !== false);
  if (afterVideoSources.length === 0) return undefined;

  const abPlan = planForDate(await loadAbTestPlan(root), date);
  const candidates = afterVideoSources.filter((post) => abPlanConceptMatch(abPlan, post.slot, conceptId) !== false);
  if (candidates.length !== 1) return undefined;
  return { slotNumber: candidates[0]!.slot, post: candidates[0]! };
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
      // A live Reel this day that findLiveReelSlot vetoed (wrong concept,
      // or ambiguous between two candidates) looks identical to a day with
      // no Reel at all in the outcomes list -- exactly the kind of silent
      // drift F26 was about. Surface it as a gap so a future mismatch shows
      // up instead of blending into "genuinely didn't publish."
      if (posts.some(isLiveInstagramReelPost)) {
        gaps.push(`${entry.date}: a Reel published this day but could not be confirmed as ${entry.conceptId}'s own`);
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
