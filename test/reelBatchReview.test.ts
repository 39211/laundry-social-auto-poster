import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AbDayPlan } from "../src/abTestPlan";
import { saveAbTestPlan } from "../src/abTestPlan";
import { writeDailyContent, writePostLog, writeVideoSources } from "../src/logging";
import { instagramInsightsDirectory } from "../src/paths";
import { reviewBatch } from "../src/reelBatchReview";
import { REEL_CONCEPTS, REEL_SCHEDULE, type ReelConcept } from "../src/reelConcepts";
import type { DailyContent, DailySlot, PostLogEntry, VideoSourceRecord } from "../src/types";

// ERROR-BOOK F26: reviewBatch used to hardcode slot 2 as "the Reel slot".
// That was correct while production ran two Reels/day (noon=slot 3,
// evening=slot 2). From 2026-08-15 the evening half of ab-test-plan.json is
// paused, so production's one Reel/day can land at slot 2 or slot 3 -- and
// the hardcoded lookup silently started scoring whatever unrelated
// carousel/image happened to post at slot 2 instead, while the real Reel at
// slot 3 was never measured at all.

const TEST_CONCEPT: ReelConcept = {
  id: "fixture-reel-concept",
  object_type: "test-object",
  hook: "fixture hook line",
  close: "fixture close line",
  narration: "fixture narration long enough to stand in for a real one here.",
  before_subject: "a fixture object before state, worn at one spot",
  after_subject: "the same fixture object after state, that spot restored"
};

const TEST_DATE = "2030-06-01";
const AS_OF = "2030-06-05"; // 4 days later: every fixture post is > 72h mature.

function baseSlot(slot: number, mediaType: DailySlot["media_type"], topic: string): DailySlot {
  return {
    slot,
    time: slot === 3 ? "12:00" : "20:30",
    category: "情境文",
    topic,
    format: mediaType === "reel" ? "reel" : "image-post",
    media_type: mediaType,
    instagram_caption: "fixture caption",
    facebook_caption: "fixture caption",
    image_prompt: "fixture prompt",
    visual_route: "shop-inspection",
    traffic_route: "share-worthy-care",
    local_image_path: `docs/assets/${TEST_DATE}/slot-0${slot}.png`,
    public_image_url: "",
    ...(mediaType === "reel" ? { local_video_path: `docs/assets/${TEST_DATE}/slot-0${slot}.mp4` } : {}),
    status: "posted"
  };
}

function calendarWith(slots: DailySlot[]): DailyContent {
  return {
    date: TEST_DATE,
    timezone: "Asia/Taipei",
    generated_at: `${TEST_DATE}T00:00:00.000Z`,
    slots
  };
}

function reelPost(slot: number, createdAt: string): PostLogEntry {
  return {
    date: TEST_DATE,
    slot,
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    published_media_type: "reel",
    video_status: "published",
    post_id: `fixture-${TEST_DATE}-${slot}-reel`,
    created_at: createdAt
  };
}

function uncertainReelPost(slot: number, createdAt: string): PostLogEntry {
  return {
    date: TEST_DATE,
    slot,
    platform: "instagram",
    // "uncertain" is a commit-point ack failure: the publish call may have
    // actually gone through. logging.ts's isLiveAiredReelEntry already
    // treats it as live for exactly this reason.
    status: "uncertain",
    dry_run: false,
    attempts: 3,
    published_media_type: "reel",
    video_status: "published",
    post_id: `fixture-${TEST_DATE}-${slot}-uncertain-reel`,
    created_at: createdAt
  };
}

function carouselPost(slot: number, createdAt: string): PostLogEntry {
  return {
    date: TEST_DATE,
    slot,
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    published_media_type: "carousel",
    video_status: "VIDEO_DEFERRED",
    video_defer_kind: "expected",
    video_deferred_reason: `Video file is missing for slot ${slot}.`,
    post_id: `fixture-${TEST_DATE}-${slot}-carousel`,
    created_at: createdAt
  };
}

function videoSourceRecord(slot: number, sourceConceptId: string): VideoSourceRecord {
  return {
    date: TEST_DATE,
    slot,
    source: "grok-imagine-video",
    model: "grok-imagine-video-1.5",
    video_path: `docs/assets/${TEST_DATE}/slot-0${slot}.mp4`,
    request_id: "fixture-request-id",
    // scheduleReel.ts's own route, matching its fixed source_reference
    // template exactly: `copx:${RUN_DIR}/report-${concept.id}-before.json`.
    // Only this route is trusted for concept matching -- see
    // videoSourceConceptMatch's source_route check.
    source_route: "hermes-xai-oauth",
    source_reference: `copx:output/reels-run/2026-07-29/report-${sourceConceptId}-before.json`,
    duration_seconds: 6,
    width: 1080,
    height: 1920,
    frame_rate: 30,
    video_codec: "h264",
    marked_at: `${TEST_DATE}T05:30:00.000Z`
  };
}

async function writeVideoSourceRecord(root: string, slot: number, sourceConceptId: string): Promise<void> {
  await writeVideoSources(TEST_DATE, [videoSourceRecord(slot, sourceConceptId)], root);
}

async function writeInsights(
  root: string,
  rows: Array<{ slot: number; reach: number; engaged: number; saved: number; shares: number }>
): Promise<void> {
  const dir = instagramInsightsDirectory(root);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "sync-fixture.json"),
    JSON.stringify(
      {
        rows: rows.map((row) => ({
          date: TEST_DATE,
          slot: row.slot,
          insights_ok: true,
          metrics: {
            reach: row.reach,
            total_interactions: row.engaged,
            saved: row.saved,
            shares: row.shares
          }
        }))
      },
      null,
      2
    ),
    "utf8"
  );
}

let root: string;
let conceptsBaseline: number;
let scheduleBaseline: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "reel-batch-review-"));
  // reviewBatch mutates these shared arrays via loadExtensions; give it its
  // own fixture concept/date so the assertions never depend on a real
  // production concept or on today's REEL_SCHEDULE contents.
  conceptsBaseline = REEL_CONCEPTS.length;
  scheduleBaseline = REEL_SCHEDULE.length;
  REEL_CONCEPTS.push(TEST_CONCEPT);
  REEL_SCHEDULE.push({ date: TEST_DATE, conceptId: TEST_CONCEPT.id });
});

afterEach(async () => {
  REEL_CONCEPTS.length = conceptsBaseline;
  REEL_SCHEDULE.length = scheduleBaseline;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("reviewBatch finds the Reel wherever it actually published", () => {
  it("measures the real Reel at slot 3, not the unrelated carousel sitting at slot 2 (F26)", async () => {
    await writeDailyContent(
      calendarWith([
        baseSlot(2, "carousel", "unrelated carousel topic"),
        baseSlot(3, "reel", TEST_CONCEPT.hook)
      ]),
      root
    );
    await writePostLog(
      TEST_DATE,
      [
        // The real published_media_type: "reel" is at slot 3 -- exactly the
        // 2026-08-16 shape from ERROR-BOOK F26.
        reelPost(3, `${TEST_DATE}T05:30:00.000Z`),
        carouselPost(2, `${TEST_DATE}T13:30:00.000Z`)
      ],
      root
    );
    // Slot 3's real numbers clear every threshold; slot 2's unrelated
    // carousel (reach 47, mirroring the real down-jacket-cuff incident
    // number) would fail every one of them. The two profiles are picked to
    // be unmistakably different outcomes, not just different numbers.
    await writeInsights(root, [
      { slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 },
      { slot: 2, reach: 47, engaged: 1, saved: 0, shares: 0 }
    ]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.mature).toBe(true);
    expect(outcome!.reach).toBe(350);
    expect(outcome!.accounts_engaged).toBe(8);
    expect(outcome!.saves_plus_shares).toBe(6);
    expect(outcome!.verdict).toBe("pass");
  });

  it("still measures a Reel that published at slot 2 with nothing at slot 3 (pre-8/15 shape)", async () => {
    await writeDailyContent(
      calendarWith([baseSlot(1, "image", "slot 1 filler"), baseSlot(2, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(2, `${TEST_DATE}T13:30:00.000Z`)], root);
    await writeInsights(root, [{ slot: 2, reach: 400, engaged: 6, saved: 2, shares: 1 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(400);
    expect(outcome!.verdict).toBe("pass");
  });

  it("matches the ab-test-plan half by conceptId, not just by which half is unpaused", async () => {
    // ab-test-plan.json and REEL_SCHEDULE/the extension schedule are two
    // separately-edited files that have already drifted apart in production
    // (an unpaused half naming a concept other than the one REEL_SCHEDULE
    // tracks for that date). Noon (slot 3) is this row's own concept here;
    // evening (slot 2) is unpaused but is a *different* concept -- so a
    // fallback that only checks "is this half unpaused" (instead of matching
    // conceptId) would wrongly prefer evening, which is always its bottom
    // fallback slot too, making that mutation otherwise invisible.
    await writeDailyContent(
      calendarWith([baseSlot(2, "reel", "a different evening concept"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(
      TEST_DATE,
      [reelPost(3, `${TEST_DATE}T05:30:00.000Z`), reelPost(2, `${TEST_DATE}T13:30:00.000Z`)],
      root
    );
    // Slot 2's numbers are deliberately the "better" ones so a wrong pick
    // (the plan-blind fallback default) is unmistakable rather than a
    // coincidental match.
    await writeInsights(root, [
      { slot: 3, reach: 310, engaged: 6, saved: 2, shares: 1 },
      { slot: 2, reach: 999, engaged: 50, saved: 20, shares: 5 }
    ]);
    const plan: AbDayPlan = {
      date: TEST_DATE,
      noon: { conceptId: TEST_CONCEPT.id, variant: "15s" },
      evening: { conceptId: "a-different-evening-concept", variant: "15s" }
    };
    await saveAbTestPlan([plan], root);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.reach).toBe(310);
    expect(outcome!.accounts_engaged).toBe(6);
  });

  it("still measures a Reel whose publish ack came back uncertain, not just success/posted", async () => {
    await writeDailyContent(
      calendarWith([baseSlot(1, "image", "slot 1 filler"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [uncertainReelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    await writeInsights(root, [{ slot: 3, reach: 320, engaged: 6, saved: 2, shares: 1 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.verdict).not.toBe("not_published");
    expect(outcome!.reach).toBe(320);
  });

  it("does not credit a Reel that video-sources shows was actually a different, pulled-forward concept (2026-08-16 shape)", async () => {
    // Real production data: REEL_SCHEDULE/the extension schedule named
    // heel-tip-scuff for 2026-08-16, but data/video-sources/2026-08-16.json
    // and the calendar's own slot-3 topic both show the clip that aired that
    // day was white-shoe-yellowing's -- ab-test-plan.json's noon half pulled
    // a different concept forward, same as it always does. Finding the right
    // *slot* is not enough if the concept that aired there isn't this row's.
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", "a pulled-forward concept's hook")]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    await writeVideoSourceRecord(root, 3, "a-different-pulled-forward-concept");
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(false);
    expect(outcome!.verdict).toBe("not_published");
  });

  it("still credits the Reel when video-sources confirms it belongs to this concept", async () => {
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    await writeVideoSourceRecord(root, 3, TEST_CONCEPT.id);
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(350);
  });

  it("does not treat a differently-sourced video-sources record (xai-api/grok-web-manual) as a concept mismatch", async () => {
    // generateGrokVideo.ts and importGrokVideo.ts also write
    // data/video-sources/<date>.json, but with source_reference set to a
    // bare xAI request id or a caller-supplied reference rather than
    // scheduleReel.ts's report-<concept.id>-before.json path. That will never
    // contain this concept's id regardless of whether the Reel really is
    // this concept -- reading it as a mismatch would report not_published
    // for a Reel that actually published correctly under a different route.
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    const record: VideoSourceRecord = {
      date: TEST_DATE,
      slot: 3,
      source: "grok-imagine-video",
      model: "grok-imagine-video-1.5",
      video_path: `docs/assets/${TEST_DATE}/slot-03.mp4`,
      request_id: "req_abc123xyz",
      source_route: "xai-api",
      source_reference: "req_abc123xyz",
      duration_seconds: 6,
      width: 1080,
      height: 1920,
      frame_rate: 30,
      video_codec: "h264",
      marked_at: `${TEST_DATE}T05:30:00.000Z`
    };
    await writeVideoSources(TEST_DATE, [record], root);
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(350);
  });

  it("picks the video-sources-confirmed half of a dual-Reel day even with no ab-test-plan.json at all", async () => {
    // Proves confirmedIndex actually runs before -- and wins ahead of -- the
    // ab-test-plan fallback, rather than merely reaching the same slot the
    // plan-based branch would have picked anyway. No plan file exists here,
    // so if the video-sources priority check were skipped or removed, this
    // would fall through to the hardcoded ": 2" default and pick slot 2's
    // reach (999) instead of the confirmed slot 3 (310).
    await writeDailyContent(
      calendarWith([baseSlot(2, "reel", "a different evening concept"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(
      TEST_DATE,
      [reelPost(3, `${TEST_DATE}T05:30:00.000Z`), reelPost(2, `${TEST_DATE}T13:30:00.000Z`)],
      root
    );
    await writeVideoSourceRecord(root, 3, TEST_CONCEPT.id);
    await writeInsights(root, [
      { slot: 3, reach: 310, engaged: 6, saved: 2, shares: 1 },
      { slot: 2, reach: 999, engaged: 50, saved: 20, shares: 5 }
    ]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.reach).toBe(310);
    expect(outcome!.accounts_engaged).toBe(6);
  });

  it("does not treat an arbitrary-reference hermes-xai-oauth record (importGrokVideo.ts's --source-route) as a concept mismatch", async () => {
    // importGrokVideo.ts's --source-route flag lets a caller stamp
    // "hermes-xai-oauth" onto a record too (its sourceRoute CLI option), but
    // the source_reference is then whatever --source-reference string the
    // caller passed -- not scheduleReel.ts's own
    // report-<concept.id>-before.json template. Trusting the route alone
    // would read that arbitrary string as a confident "wrong concept" and
    // silently turn a real published Reel into not_published.
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    const record: VideoSourceRecord = {
      date: TEST_DATE,
      slot: 3,
      source: "grok-imagine-video",
      model: "grok-imagine-video-1.5",
      video_path: `docs/assets/${TEST_DATE}/slot-03.mp4`,
      request_id: "manual-import-ref-001",
      source_route: "hermes-xai-oauth",
      source_reference: "manual-import-ref-001",
      duration_seconds: 6,
      width: 1080,
      height: 1920,
      frame_rate: 30,
      video_codec: "h264",
      marked_at: `${TEST_DATE}T05:30:00.000Z`
    };
    await writeVideoSources(TEST_DATE, [record], root);
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(350);
  });

  it("does not credit either Reel when two live Reels both come back confirmed as a different concept (F26, one layer down)", async () => {
    // Two live Reels this day, video-sources confirms *both* belong to
    // concepts other than this row's own -- crediting either one anyway
    // would repeat F26's "right slot family, wrong post" mistake with an
    // extra candidate. The exclusion has to run before the dual-Reel
    // ab-test-plan tiebreak, not just in the single-candidate branch.
    await writeDailyContent(
      calendarWith([
        baseSlot(2, "reel", "a different evening concept"),
        baseSlot(3, "reel", "a different noon concept")
      ]),
      root
    );
    await writePostLog(
      TEST_DATE,
      [reelPost(3, `${TEST_DATE}T05:30:00.000Z`), reelPost(2, `${TEST_DATE}T13:30:00.000Z`)],
      root
    );
    await writeVideoSources(
      TEST_DATE,
      [videoSourceRecord(3, "a-different-noon-concept"), videoSourceRecord(2, "a-different-evening-concept")],
      root
    );
    await writeInsights(root, [
      { slot: 3, reach: 310, engaged: 6, saved: 2, shares: 1 },
      { slot: 2, reach: 999, engaged: 50, saved: 20, shares: 5 }
    ]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(false);
    expect(outcome!.verdict).toBe("not_published");
  });

  it("does not guess a slot when neither video-sources nor ab-test-plan can tell two live Reels apart", async () => {
    // No video-sources evidence for either candidate, and ab-test-plan.json
    // names a *different* concept in both halves -- there is no real
    // evidence left to prefer one slot over the other. The old hardcoded
    // ": 2" tiebreak default would silently credit slot 2's numbers to this
    // concept regardless of what the plan says; report not_published
    // instead of guessing.
    await writeDailyContent(
      calendarWith([
        baseSlot(2, "reel", "a different evening concept"),
        baseSlot(3, "reel", "a different noon concept")
      ]),
      root
    );
    await writePostLog(
      TEST_DATE,
      [reelPost(3, `${TEST_DATE}T05:30:00.000Z`), reelPost(2, `${TEST_DATE}T13:30:00.000Z`)],
      root
    );
    await writeInsights(root, [
      { slot: 3, reach: 310, engaged: 6, saved: 2, shares: 1 },
      { slot: 2, reach: 999, engaged: 50, saved: 20, shares: 5 }
    ]);
    const plan: AbDayPlan = {
      date: TEST_DATE,
      noon: { conceptId: "a-different-noon-concept", variant: "15s" },
      evening: { conceptId: "a-different-evening-concept", variant: "15s" }
    };
    await saveAbTestPlan([plan], root);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(false);
    expect(outcome!.verdict).toBe("not_published");
  });

  it("does not crash the whole batch when one date's video-sources file is malformed", async () => {
    // video-sources is a new dependency this fix introduced -- before F26,
    // reviewBatch never read it at all. One bad file for one date must not
    // take down every other date's review with it.
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);
    const { mkdir: mkdirFs, writeFile: writeFileFs } = await import("node:fs/promises");
    const { videoSourcesPath } = await import("../src/paths");
    const path = videoSourcesPath(TEST_DATE, root);
    await mkdirFs(join(path, ".."), { recursive: true });
    await writeFileFs(path, "{ this is not valid JSON", "utf8");

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(350);
  });

  it("does not credit the day's only live Reel when ab-test-plan names a different concept for its slot, even with no video-sources evidence at all (2026-08-16 shape without a video-sources record)", async () => {
    // This is the real 2026-08-16 shape one layer further than the existing
    // "pulled-forward concept" test: video-sources happened to catch that
    // one because a record existed. A day with genuinely *no* video-sources
    // record for its one live Reel (missing sync, or a route this tool
    // doesn't trust) still needs a second, independent check -- otherwise
    // the exact same "right slot, wrong concept" mistake goes uncaught
    // just because the file that would have caught it is absent.
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", "a pulled-forward concept's hook")]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);
    const plan: AbDayPlan = {
      date: TEST_DATE,
      noon: { conceptId: "a-different-pulled-forward-concept", variant: "15s" },
      evening: { conceptId: "some-other-evening-concept", variant: "15s" }
    };
    await saveAbTestPlan([plan], root);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(false);
    expect(outcome!.verdict).toBe("not_published");
  });

  it("excludes a video-sources-confirmed-different candidate and credits the sole survivor even with no other corroborating evidence", async () => {
    // Two live Reels; video-sources rules out slot 3 with a real "false"
    // match (not just absence of a record). If that exclusion were broken
    // (e.g. the filter predicate inverted), slot 3 would wrongly survive
    // alongside slot 2, leaving two candidates and reporting not_published
    // instead of crediting slot 2 -- so this fixture's outcome actually
    // depends on the exclusion firing, not just on a coincidental "zero or
    // many candidates all resolve to the same answer" shape.
    await writeDailyContent(
      calendarWith([baseSlot(2, "reel", TEST_CONCEPT.hook), baseSlot(3, "reel", "a different noon concept")]),
      root
    );
    await writePostLog(
      TEST_DATE,
      [reelPost(3, `${TEST_DATE}T05:30:00.000Z`), reelPost(2, `${TEST_DATE}T13:30:00.000Z`)],
      root
    );
    await writeVideoSourceRecord(root, 3, "a-different-noon-concept");
    await writeInsights(root, [
      { slot: 3, reach: 999, engaged: 50, saved: 20, shares: 5 },
      { slot: 2, reach: 320, engaged: 6, saved: 2, shares: 1 }
    ]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(320);
  });

  it("still excludes the sole video-sources survivor when ab-test-plan separately names a different concept for its slot", async () => {
    // Same shape as the previous test, but this time ab-test-plan also
    // contradicts the surviving candidate. If the ab-test-plan veto were
    // removed (trusting any video-sources survivor unconditionally), this
    // would wrongly credit slot 2 instead of reporting not_published.
    await writeDailyContent(
      calendarWith([baseSlot(2, "reel", "a different evening concept"), baseSlot(3, "reel", "a different noon concept")]),
      root
    );
    await writePostLog(
      TEST_DATE,
      [reelPost(3, `${TEST_DATE}T05:30:00.000Z`), reelPost(2, `${TEST_DATE}T13:30:00.000Z`)],
      root
    );
    await writeVideoSourceRecord(root, 3, "a-different-noon-concept");
    await writeInsights(root, [
      { slot: 3, reach: 999, engaged: 50, saved: 20, shares: 5 },
      { slot: 2, reach: 320, engaged: 6, saved: 2, shares: 1 }
    ]);
    const plan: AbDayPlan = {
      date: TEST_DATE,
      noon: { conceptId: "a-different-noon-concept", variant: "15s" },
      evening: { conceptId: "a-different-evening-concept", variant: "15s" }
    };
    await saveAbTestPlan([plan], root);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(false);
    expect(outcome!.verdict).toBe("not_published");
  });

  it("does not crash when video-sources is valid JSON but the wrong shape (not an array)", async () => {
    // Array.isArray guards against this specifically -- unlike a JSON
    // syntax error, JSON.parse succeeds here, so only the shape check (not
    // the try/catch alone) stands between this and a TypeError from
    // sources.find() propagating out of reviewBatch's per-entry loop.
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);
    const { mkdir: mkdirFs, writeFile: writeFileFs } = await import("node:fs/promises");
    const { videoSourcesPath } = await import("../src/paths");
    const path = videoSourcesPath(TEST_DATE, root);
    await mkdirFs(join(path, ".."), { recursive: true });
    await writeFileFs(path, JSON.stringify({ slot: 3 }), "utf8");

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(350);
  });

  it("does not crash when an insights sync file is malformed, and keeps scanning the rest", async () => {
    // loadReelMetrics scans every insights/instagram/*.json file for a
    // matching row. A truncated file among them must not crash the whole
    // batch (grok red-team finding, R2) -- it should be skipped like a
    // missing row, not propagate its parse error out of reviewBatch.
    // loadReelMetrics scans files.sort().reverse() (newest-looking name
    // first) and returns on the first match, so the broken file's name must
    // sort *after* "sync-fixture.json" (writeInsights' filename) for the
    // scan to actually reach it before finding the real row -- otherwise
    // this test would pass by luck without ever exercising the guard.
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", TEST_CONCEPT.hook)]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    const dir = instagramInsightsDirectory(root);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "sync-zzz-broken.json"), "{ not valid JSON", "utf8");
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.published).toBe(true);
    expect(outcome!.reach).toBe(350);
  });

  it("flags a data gap when a live Reel published but could not be confirmed as this concept, instead of looking identical to a true non-publish day", async () => {
    await writeDailyContent(
      calendarWith([baseSlot(2, "carousel", "unrelated carousel topic"), baseSlot(3, "reel", "a pulled-forward concept's hook")]),
      root
    );
    await writePostLog(TEST_DATE, [reelPost(3, `${TEST_DATE}T05:30:00.000Z`)], root);
    await writeVideoSourceRecord(root, 3, "a-different-pulled-forward-concept");
    await writeInsights(root, [{ slot: 3, reach: 350, engaged: 8, saved: 4, shares: 2 }]);

    const review = await reviewBatch({ asOf: AS_OF, root });
    const outcome = review.outcomes.find((item) => item.date === TEST_DATE);

    expect(outcome).toBeTruthy();
    expect(outcome!.verdict).toBe("not_published");
    expect(review.data_gaps.some((gap) => gap.includes(TEST_DATE) && gap.includes(TEST_CONCEPT.id))).toBe(true);
  });
});
