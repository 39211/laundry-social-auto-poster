import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../src/logging";
import { assertVideoReviewApproved, recordVideoReview, selectVideoReviewForSlot } from "../src/videoReviewGate";

async function fixture(): Promise<{ root: string; videoPath: string; prompt: string }> {
  const root = await mkdtemp(join(tmpdir(), "laundry-video-review-"));
  const videoPath = "docs/assets/2026-07-29/slot-01.mp4";
  const prompt = "one action only";
  await mkdir(dirname(join(root, ...videoPath.split("/"))), { recursive: true });
  await writeFile(join(root, ...videoPath.split("/")), "final-video", "utf8");
  await writeJsonAtomic(join(root, "data", "content-calendar", "2026-07-29.json"), {
    date: "2026-07-29",
    generated_at: "2026-07-28T22:30:00.000Z",
    slots: [
      {
        slot: 1,
        scheduled_time: "11:30",
        topic: "鞋子",
        media_type: "mixed-carousel",
        caption: "caption",
        image_prompt: "prompt",
        local_image_path: "docs/assets/2026-07-29/slot-01.png",
        public_image_url: "https://example.com/slot-01.png",
        local_video_path: videoPath,
        public_video_url: "https://example.com/slot-01.mp4",
        video_prompt: prompt
      },
      {
        slot: 2,
        scheduled_time: "19:30",
        topic: "床組",
        media_type: "image",
        caption: "caption",
        image_prompt: "prompt",
        local_image_path: "docs/assets/2026-07-29/slot-02.png",
        public_image_url: "https://example.com/slot-02.png"
      }
    ]
  });
  return { root, videoPath, prompt };
}

describe("video review gate", () => {
  it("binds dual review approval to the exact final video and prompt", async () => {
    const { root, videoPath, prompt } = await fixture();
    await recordVideoReview({
      date: "2026-07-29",
      slot: 1,
      reviewRound: 2,
      root,
      now: new Date("2026-07-28T23:00:00.000Z")
    });
    await expect(
      assertVideoReviewApproved({
        date: "2026-07-29",
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root
      })
    ).resolves.toBeUndefined();
  });

  it("F34: preserves the prior record as history instead of discarding it on a new round", async () => {
    const { root, videoPath, prompt } = await fixture();
    const first = await recordVideoReview({
      date: "2026-07-29",
      slot: 1,
      reviewRound: 1,
      root,
      now: new Date("2026-07-28T20:00:00.000Z")
    });
    await writeFile(join(root, ...videoPath.split("/")), "re-cut-video", "utf8");
    const second = await recordVideoReview({
      date: "2026-07-29",
      slot: 1,
      reviewRound: 2,
      root,
      now: new Date("2026-07-28T21:00:00.000Z")
    });
    expect(second.superseded).toHaveLength(1);
    expect(second.superseded?.[0]).toMatchObject({
      review_round: first.review_round,
      video_sha256: first.video_sha256,
      reviewed_at: first.reviewed_at
    });
  });

  it("rejects a video changed after review", async () => {
    const { root, videoPath, prompt } = await fixture();
    await recordVideoReview({ date: "2026-07-29", slot: 1, reviewRound: 1, root });
    await writeFile(join(root, ...videoPath.split("/")), "changed-video", "utf8");
    await expect(
      assertVideoReviewApproved({
        date: "2026-07-29",
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root
      })
    ).rejects.toThrow("changed after approval");
  });

  it("refuses to pick when two top-level records exist for the same slot (first approved, second pending)", async () => {
    const { root, videoPath, prompt } = await fixture();
    const now = new Date("2026-07-28T23:00:00.000Z");
    const firstRecord = await recordVideoReview({
      date: "2026-07-29",
      slot: 1,
      reviewRound: 1,
      root,
      now
    });
    // Manually construct a second top-level record with pending status
    const secondRecord = {
      date: "2026-07-29",
      slot: 1,
      video_path: videoPath,
      video_sha256: firstRecord.video_sha256,
      prompt_hash: firstRecord.prompt_hash,
      review_round: 2,
      full_decode: "pass" as const,
      all_frame_physics_review: "pass" as const,
      grok_review: "pass" as const,
      sol_review: "pass" as const,
      separate_zh_tw_tts_review: "pass" as const,
      generated_clip_audio_used: false as const,
      status: "pending" as const,
      reviewed_at: new Date("2026-07-28T23:30:00.000Z").toISOString()
    };
    // Overwrite the reviews file to have both records at top level
    await writeJsonAtomic(
      join(root, "data", "video-reviews", "2026-07-29.json"),
      [firstRecord, secondRecord]
    );
    await expect(
      assertVideoReviewApproved({
        date: "2026-07-29",
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root
      })
    ).rejects.toThrow("refusing to pick the first");
  });

  it("refuses to pick when two top-level records exist for the same slot (first pending, second approved)", async () => {
    const { root, videoPath, prompt } = await fixture();
    const now = new Date("2026-07-28T23:00:00.000Z");
    // Manually construct a pending record first
    const pendingRecord = {
      date: "2026-07-29",
      slot: 1,
      video_path: videoPath,
      video_sha256: "pending-sha256",
      prompt_hash: "pending-prompt-hash",
      review_round: 1,
      full_decode: "pass" as const,
      all_frame_physics_review: "pass" as const,
      grok_review: "pass" as const,
      sol_review: "pass" as const,
      separate_zh_tw_tts_review: "pass" as const,
      generated_clip_audio_used: false as const,
      status: "pending" as const,
      reviewed_at: new Date("2026-07-28T22:00:00.000Z").toISOString()
    };
    const approvedRecord = await recordVideoReview({
      date: "2026-07-29",
      slot: 1,
      reviewRound: 2,
      root,
      now
    });
    // Manually overwrite to have both at top level (bypass recordVideoReview's superseded logic)
    await writeJsonAtomic(
      join(root, "data", "video-reviews", "2026-07-29.json"),
      [pendingRecord, approvedRecord]
    );
    await expect(
      assertVideoReviewApproved({
        date: "2026-07-29",
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root
      })
    ).rejects.toThrow("refusing to pick the first");
  });

  it("accepts a record with superseded history nested inside (history does not count as duplicate)", async () => {
    const { root, videoPath, prompt } = await fixture();
    const first = await recordVideoReview({
      date: "2026-07-29",
      slot: 1,
      reviewRound: 1,
      root,
      now: new Date("2026-07-28T20:00:00.000Z")
    });
    await writeFile(join(root, ...videoPath.split("/")), "re-cut-video", "utf8");
    // Second call will automatically nest the first in superseded
    await recordVideoReview({
      date: "2026-07-29",
      slot: 1,
      reviewRound: 2,
      root,
      now: new Date("2026-07-28T21:00:00.000Z")
    });
    // This should succeed because superseded records are not counted as duplicates
    await expect(
      assertVideoReviewApproved({
        date: "2026-07-29",
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root
      })
    ).resolves.toBeUndefined();
  });

  it("rejects when no record exists for the given slot", async () => {
    const { root, videoPath, prompt } = await fixture();
    // Slot 1 has no record, try to approve it
    await expect(
      assertVideoReviewApproved({
        date: "2026-07-29",
        slot: 1,
        videoPath,
        videoPrompt: prompt,
        root
      })
    ).rejects.toThrow("Dual video review is missing for slot");
  });

  it("selectVideoReviewForSlot: returns undefined for empty array, single record, throws for duplicates", async () => {
    const records = [
      {
        slot: 1,
        status: "approved" as const
      },
      {
        slot: 2,
        status: "pending" as const
      }
    ];
    // 0 matches
    expect(selectVideoReviewForSlot(records, 99)).toBeUndefined();
    // 1 match
    expect(selectVideoReviewForSlot(records, 1)).toEqual({ slot: 1, status: "approved" });
    // 2 matches
    expect(() => selectVideoReviewForSlot([...records, { slot: 1, status: "pending" }], 1)).toThrow(
      "refusing to pick the first"
    );
  });
});
