import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../src/logging";
import {
  buildStandingPolicyMetadata,
  collectDisplacedHistory,
  listFutureStandingPolicyBindings,
  recordOwnerVideoReview,
  STANDING_POLICY_METADATA_BY,
  STANDING_POLICY_REVIEWER
} from "../src/ownerVideoReview";
import { videoReviewsPath } from "../src/paths";
import { assertVideoReviewApproved } from "../src/videoReviewGate";
import { hashVideoPrompt } from "../src/videoRunFreshness";

const VIDEO_BYTES = "final-video";
const PROMPT = "one action only";
const DATE = "2026-09-01";

function shaOf(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixture(date = DATE): Promise<{ root: string; videoPath: string; prompt: string; date: string }> {
  const root = await mkdtemp(join(tmpdir(), "laundry-standing-policy-"));
  const videoPath = `docs/assets/${date}/slot-01.mp4`;
  await mkdir(dirname(join(root, ...videoPath.split("/"))), { recursive: true });
  await writeFile(join(root, ...videoPath.split("/")), VIDEO_BYTES, "utf8");
  await writeJsonAtomic(join(root, "data", "content-calendar", `${date}.json`), {
    date,
    generated_at: "2026-08-31T22:30:00.000Z",
    slots: [
      {
        slot: 1,
        scheduled_time: "11:30",
        topic: "鞋子",
        media_type: "mixed-carousel",
        caption: "caption",
        image_prompt: "prompt",
        local_image_path: `docs/assets/${date}/slot-01.png`,
        public_image_url: "https://example.com/slot-01.png",
        local_video_path: videoPath,
        public_video_url: "https://example.com/slot-01.mp4",
        video_prompt: PROMPT
      },
      {
        slot: 2,
        scheduled_time: "19:30",
        topic: "床組",
        media_type: "image",
        caption: "caption",
        image_prompt: "prompt",
        local_image_path: `docs/assets/${date}/slot-02.png`,
        public_image_url: "https://example.com/slot-02.png"
      }
    ]
  });
  return { root, videoPath, prompt: PROMPT, date };
}

function approvedStandingPolicyRecord(date: string, slot: number, videoPath: string) {
  return {
    date,
    slot,
    video_path: videoPath,
    video_sha256: shaOf(VIDEO_BYTES),
    prompt_hash: hashVideoPrompt(PROMPT),
    review_round: 1,
    full_decode: "pass",
    all_frame_physics_review: "pass",
    grok_review: "pass",
    sol_review: "pass",
    separate_zh_tw_tts_review: "pass",
    generated_clip_audio_used: false,
    status: "approved",
    reviewed_at: "2026-08-01T00:00:00.000Z",
    reviewed_by: STANDING_POLICY_REVIEWER
  };
}

describe("standing-policy is metadata, not a publish stamp", () => {
  it("refuses to let an unwatched standing-policy record satisfy the publish gate", async () => {
    const { root, videoPath, prompt, date } = await fixture();
    await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root,
      now: new Date("2026-08-31T23:00:00.000Z")
    });

    await expect(
      assertVideoReviewApproved({
        date,
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root
      })
    ).rejects.toThrow(/did not both pass|missing for slot/u);
  });

  it("writes schedule metadata and the asset sha without review pass fields", async () => {
    const { root, videoPath, date } = await fixture();
    const now = new Date("2026-08-31T23:00:00.000Z");
    const result = await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root,
      now
    });

    const records = JSON.parse(await readFile(videoReviewsPath(date, root), "utf8")) as Array<
      Record<string, unknown>
    >;
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw new Error("expected standing-policy metadata record");
    expect(record.date).toBe(date);
    expect(record.slot).toBe(1);
    expect(record.video_path).toBe(videoPath);
    expect(record.video_sha256).toBe(shaOf(VIDEO_BYTES));
    expect(record.prompt_hash).toBe(hashVideoPrompt(PROMPT));
    expect(record.recorded_at).toBe(now.toISOString());
    expect(record.recorded_by).toBe(STANDING_POLICY_METADATA_BY);
    expect(record.status).toBe("pending");
    expect(record.all_frame_physics_review).toBe("pending");
    expect(record.grok_review).toBe("pending");
    expect(record.sol_review).toBe("pending");
    expect(record.full_decode).toBe("pending");
    expect(record.separate_zh_tw_tts_review).toBe("pending");
    expect(record.reviewed_by).toBeUndefined();
    expect(result.record).toMatchObject(record);
  });

  it("keeps an approved standing-policy stamp's verdict, refreshing only schedule stamps", async () => {
    const { root, videoPath, date } = await fixture();
    const existing = approvedStandingPolicyRecord(date, 1, videoPath);
    await writeJsonAtomic(videoReviewsPath(date, root), [existing]);

    const now = new Date("2026-09-01T04:50:00.000Z");
    const result = await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root,
      now
    });

    expect(result.preserved_existing_approval).toBe(true);
    expect(result.preserved_existing_verdict).toBe(true);
    const records = JSON.parse(await readFile(videoReviewsPath(date, root), "utf8")) as Array<
      Record<string, unknown>
    >;
    expect(records).toEqual([
      {
        ...existing,
        recorded_at: now.toISOString(),
        recorded_by: STANDING_POLICY_METADATA_BY
      }
    ]);
  });

  it("lists future standing-policy stamps and ignores past stamps and pending metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-standing-inventory-"));
    await mkdir(join(root, "data", "video-reviews"), { recursive: true });
    await writeJsonAtomic(join(root, "data", "video-reviews", "2026-08-01.json"), [
      approvedStandingPolicyRecord("2026-08-01", 2, "docs/assets/2026-08-01/slot-02.mp4")
    ]);
    await writeJsonAtomic(join(root, "data", "video-reviews", "2026-09-10.json"), [
      approvedStandingPolicyRecord("2026-09-10", 3, "docs/assets/2026-09-10/slot-03.mp4")
    ]);
    await writeJsonAtomic(join(root, "data", "video-reviews", "2026-09-11.json"), [
      buildStandingPolicyMetadata({
        date: "2026-09-11",
        slot: 2,
        videoPath: "docs/assets/2026-09-11/slot-02.mp4",
        videoSha256: shaOf(VIDEO_BYTES),
        promptHash: hashVideoPrompt(PROMPT),
        recordedAt: "2026-09-01T00:00:00.000Z"
      })
    ]);

    const bindings = await listFutureStandingPolicyBindings({ root, asOfDate: "2026-09-01" });
    expect(bindings).toEqual([
      {
        date: "2026-09-10",
        slot: 3,
        video_path: "docs/assets/2026-09-10/slot-03.mp4",
        video_sha256: shaOf(VIDEO_BYTES),
        reviewed_by: STANDING_POLICY_REVIEWER,
        status: "approved",
        reviewed_at: "2026-08-01T00:00:00.000Z"
      }
    ]);
  });
});

// F29 (2026-08-21): produce-next-reel re-schedules a day after every
// schedule-reel call, and the metadata writer used replace semantics — a
// recorded two-seat REJECT (with its reject_reason) was silently reset to
// all-pending twice. The writer owns schedule stamps, never verdicts.
describe("F29: a re-schedule must not clobber a recorded verdict", () => {
  function rejectedTwoSeatRecord(input: {
    date: string;
    videoPath: string;
    videoSha256?: string;
    promptHash?: string;
  }) {
    return {
      date: input.date,
      slot: 1,
      video_path: input.videoPath,
      video_sha256: input.videoSha256 ?? shaOf(VIDEO_BYTES),
      prompt_hash: input.promptHash ?? hashVideoPrompt(PROMPT),
      review_round: 1,
      full_decode: "pass",
      all_frame_physics_review: "fail",
      grok_review: "fail",
      sol_review: "fail",
      separate_zh_tw_tts_review: "pass",
      generated_clip_audio_used: false,
      status: "rejected",
      reviewed_at: "2026-08-31T10:00:00.000Z",
      reviewed_by: "human-frames-review",
      reject_reason: "two-seat REJECT: middle act drifts the steam tool off the knee landmark",
      review_note: "commander frames eyeball + grok blind seat, both REJECT"
    };
  }

  async function readRecords(date: string, root: string): Promise<Array<Record<string, unknown>>> {
    return JSON.parse(await readFile(videoReviewsPath(date, root), "utf8")) as Array<
      Record<string, unknown>
    >;
  }

  it("preserves a rejection and its reject_reason when the same asset is re-scheduled", async () => {
    const { root, videoPath, date } = await fixture();
    const rejected = rejectedTwoSeatRecord({ date, videoPath });
    await writeJsonAtomic(videoReviewsPath(date, root), [rejected]);

    const now = new Date("2026-09-01T04:50:00.000Z");
    const result = await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root,
      now
    });

    const records = await readRecords(date, root);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      ...rejected,
      recorded_at: now.toISOString(),
      recorded_by: STANDING_POLICY_METADATA_BY
    });
    expect(result.preserved_existing_verdict).toBe(true);
    expect(result.preserved_existing_approval).toBeUndefined();

    // Fail-closed retained: the preserved rejection still blocks publishing.
    await expect(
      assertVideoReviewApproved({ date, slot: 1, videoPath, videoPrompt: PROMPT, root })
    ).rejects.toThrow(/did not both pass/u);
  });

  it("resets to pending for a genuinely new asset, moving the old verdict into superseded", async () => {
    const { root, videoPath, date } = await fixture();
    const rejected = rejectedTwoSeatRecord({
      date,
      videoPath,
      videoSha256: shaOf("superseded-earlier-cut")
    });
    await writeJsonAtomic(videoReviewsPath(date, root), [rejected]);

    const now = new Date("2026-09-01T04:50:00.000Z");
    const result = await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root,
      now
    });

    const records = await readRecords(date, root);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw new Error("expected a standing-policy metadata record");
    expect(record.status).toBe("pending");
    expect(record.grok_review).toBe("pending");
    expect(record.sol_review).toBe("pending");
    expect(record.video_sha256).toBe(shaOf(VIDEO_BYTES));
    expect(record.recorded_at).toBe(now.toISOString());
    expect(record.superseded).toEqual([rejected]);
    expect(result.superseded_previous_verdict).toBe(true);
    expect(result.preserved_existing_verdict).toBeUndefined();
  });

  it("supersedes on a prompt change even when the file bytes are unchanged", async () => {
    const { root, videoPath, date } = await fixture();
    const rejected = rejectedTwoSeatRecord({
      date,
      videoPath,
      promptHash: hashVideoPrompt("an earlier prompt")
    });
    await writeJsonAtomic(videoReviewsPath(date, root), [rejected]);

    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root });

    const records = await readRecords(date, root);
    const record = records[0];
    if (!record) throw new Error("expected a standing-policy metadata record");
    expect(record.status).toBe("pending");
    expect(record.prompt_hash).toBe(hashVideoPrompt(PROMPT));
    expect(record.superseded).toEqual([rejected]);
  });

  it("carries superseded history forward when pending metadata is re-stamped", async () => {
    const { root, videoPath, date } = await fixture();
    const rejected = rejectedTwoSeatRecord({
      date,
      videoPath,
      videoSha256: shaOf("superseded-earlier-cut")
    });
    await writeJsonAtomic(videoReviewsPath(date, root), [rejected]);

    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root });
    // The repeat run that used to wipe history along with everything else.
    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root });

    const records = await readRecords(date, root);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw new Error("expected a standing-policy metadata record");
    expect(record.status).toBe("pending");
    expect(record.superseded).toEqual([rejected]);
  });

  it("prefers the verdict over pending scaffolding when the slot has duplicate records", async () => {
    const { root, videoPath, date } = await fixture();
    const rejected = rejectedTwoSeatRecord({ date, videoPath });
    const pendingDuplicate = buildStandingPolicyMetadata({
      date,
      slot: 1,
      videoPath,
      videoSha256: shaOf(VIDEO_BYTES),
      promptHash: hashVideoPrompt(PROMPT),
      recordedAt: "2026-08-31T00:00:00.000Z"
    });
    // Hand appends and bad git merges can leave two records for one slot; the
    // pending one sits first, where a naive find() would land.
    await writeJsonAtomic(videoReviewsPath(date, root), [pendingDuplicate, rejected]);

    const now = new Date("2026-09-01T04:50:00.000Z");
    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root, now });

    const records = await readRecords(date, root);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      ...rejected,
      recorded_at: now.toISOString(),
      recorded_by: STANDING_POLICY_METADATA_BY
    });
  });

  it("keeps the verdict for the asset being scheduled when duplicate verdicts disagree on fingerprints", async () => {
    const { root, videoPath, date } = await fixture();
    const staleVerdict = {
      ...rejectedTwoSeatRecord({ date, videoPath, videoSha256: shaOf("superseded-earlier-cut") }),
      reject_reason: "stale verdict for the earlier cut"
    };
    const liveVerdict = rejectedTwoSeatRecord({ date, videoPath });
    // The stale-fingerprint verdict sits first, where a first-verdict pick
    // would land and demote the live verdict into history.
    await writeJsonAtomic(videoReviewsPath(date, root), [staleVerdict, liveVerdict]);

    const now = new Date("2026-09-01T04:50:00.000Z");
    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root, now });

    const records = await readRecords(date, root);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw new Error("expected the preserved live rejection");
    expect(record.status).toBe("rejected");
    expect(record.reject_reason).toBe(liveVerdict.reject_reason);
    expect(record.video_sha256).toBe(shaOf(VIDEO_BYTES));
    expect(record.superseded).toEqual([
      { ...staleVerdict, superseded: undefined }
    ].map(({ superseded: _drop, ...rest }) => rest));
  });

  it("lets the newest same-fingerprint verdict win, never silently outranked by an earlier approval", async () => {
    const { root, videoPath, date } = await fixture();
    const staleVerdict = {
      ...rejectedTwoSeatRecord({ date, videoPath, videoSha256: shaOf("superseded-earlier-cut") }),
      reject_reason: "stale verdict for the earlier cut"
    };
    const liveApproved = approvedStandingPolicyRecord(date, 1, videoPath);
    const liveRejected = {
      ...rejectedTwoSeatRecord({ date, videoPath }),
      reject_reason: "newest judgement: two-seat REJECT overturns the approval"
    };
    // Worst hand-append shape: picking the FIRST same-fingerprint verdict
    // would keep the approval current and bury this rejection where the
    // publish gate never looks.
    await writeJsonAtomic(videoReviewsPath(date, root), [staleVerdict, liveApproved, liveRejected]);

    const now = new Date("2026-09-01T04:50:00.000Z");
    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root, now });

    const records = await readRecords(date, root);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw new Error("expected the preserved newest rejection");
    expect(record.status).toBe("rejected");
    expect(record.reject_reason).toBe(liveRejected.reject_reason);
    const history = record.superseded as Array<Record<string, unknown>>;
    expect(history.map((entry) => entry.reject_reason ?? entry.status)).toEqual([
      "stale verdict for the earlier cut",
      "approved"
    ]);

    await expect(
      assertVideoReviewApproved({ date, slot: 1, videoPath, videoPrompt: PROMPT, root })
    ).rejects.toThrow(/did not both pass/u);
  });

  it("treats superseded null as no history, a conscious spec choice", async () => {
    const { root, videoPath, date } = await fixture();
    const rejected = {
      ...rejectedTwoSeatRecord({ date, videoPath }),
      superseded: null
    };
    await writeJsonAtomic(videoReviewsPath(date, root), [rejected]);

    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root });

    const records = await readRecords(date, root);
    const record = records[0];
    if (!record) throw new Error("expected the preserved rejection");
    expect(record.status).toBe("rejected");
    expect(record.reject_reason).toBe(rejected.reject_reason);
    // null carried no verdicts; the field folds to nothing rather than to [null].
    expect(record.superseded).toBeUndefined();
  });

  it("folds a record with an unrecognisable status into superseded instead of dropping it", async () => {
    const { root, videoPath, date } = await fixture();
    const dirty = {
      ...rejectedTwoSeatRecord({ date, videoPath }),
      status: "Rejected"
    };
    await writeJsonAtomic(videoReviewsPath(date, root), [dirty]);

    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root });

    const records = await readRecords(date, root);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw new Error("expected a standing-policy metadata record");
    expect(record.status).toBe("pending");
    expect(record.superseded).toEqual([dirty]);
  });

  it("keeps a corrupt non-array superseded value as history instead of discarding it", async () => {
    const { root, videoPath, date } = await fixture();
    const corruptHistory = { note: "hand-written history object, not an array" };
    const rejected = {
      ...rejectedTwoSeatRecord({ date, videoPath }),
      superseded: corruptHistory
    };
    await writeJsonAtomic(videoReviewsPath(date, root), [rejected]);

    await recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root });

    const records = await readRecords(date, root);
    const record = records[0];
    if (!record) throw new Error("expected the preserved rejection");
    expect(record.status).toBe("rejected");
    expect(record.superseded).toEqual([corruptHistory]);
  });

  it("supersedes an approved verdict when the asset changes, and the gate then refuses", async () => {
    const { root, videoPath, date } = await fixture();
    const approved = {
      ...approvedStandingPolicyRecord(date, 1, videoPath),
      video_sha256: shaOf("superseded-earlier-cut")
    };
    await writeJsonAtomic(videoReviewsPath(date, root), [approved]);

    const result = await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root
    });

    const records = await readRecords(date, root);
    const record = records[0];
    if (!record) throw new Error("expected a standing-policy metadata record");
    expect(record.status).toBe("pending");
    expect(record.superseded).toEqual([approved]);
    expect(result.superseded_previous_verdict).toBe(true);
    expect(result.preserved_existing_approval).toBeUndefined();

    await expect(
      assertVideoReviewApproved({ date, slot: 1, videoPath, videoPrompt: PROMPT, root })
    ).rejects.toThrow(/did not both pass/u);
  });

  it("fails loudly without touching the file when the scheduled video is missing", async () => {
    const { root, videoPath, date } = await fixture();
    const approved = approvedStandingPolicyRecord(date, 1, videoPath);
    await writeJsonAtomic(videoReviewsPath(date, root), [approved]);
    await rm(join(root, ...videoPath.split("/")));

    await expect(
      recordOwnerVideoReview({ date, slot: 1, watched: false, standingPolicy: true, root })
    ).rejects.toThrow(/ENOENT/u);

    const records = await readRecords(date, root);
    expect(records).toEqual([approved]);
  });
});

describe("F29: displaced-history folding shared by both write paths", () => {
  it("folds displaced verdicts and their history, dropping only pending scaffolding", () => {
    const olderVerdict = { slot: 1, status: "rejected", reject_reason: "first cut" };
    const rejected = {
      date: "2026-09-01",
      slot: 1,
      status: "rejected",
      reject_reason: "second cut",
      superseded: [olderVerdict]
    } as unknown as Parameters<typeof collectDisplacedHistory>[0][number];
    const pending = buildStandingPolicyMetadata({
      date: "2026-09-01",
      slot: 1,
      videoPath: "docs/assets/2026-09-01/slot-01.mp4",
      videoSha256: shaOf(VIDEO_BYTES),
      promptHash: hashVideoPrompt(PROMPT),
      recordedAt: "2026-09-01T00:00:00.000Z"
    });

    expect(collectDisplacedHistory([pending, rejected])).toEqual([
      olderVerdict,
      {
        date: "2026-09-01",
        slot: 1,
        status: "rejected",
        reject_reason: "second cut"
      }
    ]);
    // keep marks the record staying current: its history folds, itself does not.
    expect(collectDisplacedHistory([pending, rejected], rejected)).toEqual([olderVerdict]);
  });

  it("the owner-watched write path folds what it displaces via the same helper", () => {
    const src = readFileSync(join(__dirname, "../src/ownerVideoReview.ts"), "utf8");
    const watchedSection = src.slice(src.indexOf("await assertFullDecode"));
    expect(watchedSection).toContain("collectDisplacedHistory");
    expect(watchedSection).toContain("superseded: displaced");
  });
});

describe("standing-policy mutation locks", () => {
  it("buildStandingPolicyMetadata never emits a pass stamp", () => {
    const src = readFileSync(join(__dirname, "../src/ownerVideoReview.ts"), "utf8");
    const start = src.indexOf("export function buildStandingPolicyMetadata");
    expect(start).toBeGreaterThan(-1);
    const nextExport = src.indexOf("\nexport ", start + 1);
    const fn = src.slice(start, nextExport === -1 ? undefined : nextExport);
    expect(fn).not.toMatch(/:\s*"pass"/u);
    expect(fn).not.toMatch(/status:\s*"approved"/u);
    expect(fn).toMatch(/video_sha256:/u);
    expect(fn).toMatch(/recorded_at:/u);
    expect(fn).toMatch(/grok_review:\s*"pending"/u);
  });

  it("produce-next-reel still records standing-policy metadata after schedule-reel", () => {
    const src = readFileSync(join(__dirname, "../scripts/produce-next-reel.ps1"), "utf8");
    const calls = src.match(/npm\.cmd run owner-video-review -- --date .* --slot .* --standing-policy/g);
    expect(calls?.length).toBe(2);
    expect(src).toMatch(/Metadata only: schedule time \+ asset sha/u);
    expect(src).not.toMatch(/under the standing policy/u);
  });
});

const HISTORICAL_STANDING_POLICY_STAMPS = [
  { date: "2026-08-04", slot: 2 },
  { date: "2026-08-07", slot: 2 },
  { date: "2026-08-07", slot: 3 },
  { date: "2026-08-08", slot: 2 },
  { date: "2026-08-08", slot: 3 },
  { date: "2026-08-09", slot: 2 },
  { date: "2026-08-10", slot: 2 },
  { date: "2026-08-10", slot: 3 },
  { date: "2026-08-11", slot: 2 },
  { date: "2026-08-11", slot: 3 },
  { date: "2026-08-12", slot: 2 },
  { date: "2026-08-12", slot: 3 },
  { date: "2026-08-13", slot: 2 },
  { date: "2026-08-13", slot: 3 },
  { date: "2026-08-14", slot: 2 },
  { date: "2026-08-14", slot: 3 },
  { date: "2026-08-15", slot: 3 },
  { date: "2026-08-16", slot: 3 }
] as const;

describe("historical standing-policy grandfather contract", () => {
  it("keeps the 18 historical stamps publishable and refuses a new date", async () => {
    expect(HISTORICAL_STANDING_POLICY_STAMPS).toHaveLength(18);

    const reviewDir = join(__dirname, "../data/video-reviews");
    const found: Array<{ date: string; slot: number }> = [];
    for (const name of (await readdir(reviewDir)).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      const records = JSON.parse(await readFile(join(reviewDir, name), "utf8")) as Array<
        Record<string, unknown>
      >;
      for (const record of records) {
        if (record.reviewed_by !== STANDING_POLICY_REVIEWER || record.status !== "approved") continue;
        found.push({ date: String(record.date), slot: Number(record.slot) });
      }
    }
    found.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
    expect(found).toEqual([...HISTORICAL_STANDING_POLICY_STAMPS]);

    const root = await mkdtemp(join(tmpdir(), "laundry-standing-grandfather-"));
    for (const stamp of HISTORICAL_STANDING_POLICY_STAMPS) {
      const videoPath = `docs/assets/${stamp.date}/slot-0${stamp.slot}.mp4`;
      await mkdir(dirname(join(root, ...videoPath.split("/"))), { recursive: true });
      await writeFile(join(root, ...videoPath.split("/")), VIDEO_BYTES, "utf8");
      await writeJsonAtomic(videoReviewsPath(stamp.date, root), [
        approvedStandingPolicyRecord(stamp.date, stamp.slot, videoPath)
      ]);
      await expect(
        assertVideoReviewApproved({
          date: stamp.date,
          slot: stamp.slot,
          videoPath,
          videoPrompt: PROMPT,
          root
        })
      ).resolves.toBeUndefined();
    }

    const { root: newRoot, videoPath, prompt, date } = await fixture("2026-09-01");
    await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root: newRoot
    });
    await expect(
      assertVideoReviewApproved({
        date,
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root: newRoot
      })
    ).rejects.toThrow(/did not both pass|missing for slot/u);
  });
});
