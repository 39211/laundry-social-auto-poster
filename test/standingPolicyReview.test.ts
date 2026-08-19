import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../src/logging";
import {
  buildStandingPolicyMetadata,
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

  it("does not overwrite a historical approved standing-policy stamp", async () => {
    const { root, videoPath, date } = await fixture();
    const existing = approvedStandingPolicyRecord(date, 1, videoPath);
    await writeJsonAtomic(videoReviewsPath(date, root), [existing]);

    const result = await recordOwnerVideoReview({
      date,
      slot: 1,
      watched: false,
      standingPolicy: true,
      root
    });

    expect(result.preserved_existing_approval).toBe(true);
    const records = JSON.parse(await readFile(videoReviewsPath(date, root), "utf8")) as Array<
      Record<string, unknown>
    >;
    expect(records).toEqual([existing]);
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
    const calls = src.match(
      /Invoke-TrustedProductionNpm\s+-Root\s+\$root\s+run\s+owner-video-review\s+--\s+--date\s+\S+\s+--slot\s+\S+\s+--standing-policy\b/g
    );
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
