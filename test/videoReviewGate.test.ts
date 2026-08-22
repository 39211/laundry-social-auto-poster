import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../src/logging";
import { assertVideoReviewApproved, recordVideoReview } from "../src/videoReviewGate";

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
});
