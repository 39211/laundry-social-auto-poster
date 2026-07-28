import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertReelRunFresh,
  assessReelRunFreshness,
  hashVideoPrompt,
  videoRunReportPath
} from "../src/videoRunFreshness";
import { validatePublishableMedia } from "../src/generateVideo";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("Reel run/prompt freshness", () => {
  it("hashes prompts with the same SHA-256 algorithm written into run.json", () => {
    const prompt = "Photorealistic premium 10-second vertical commercial.";
    expect(hashVideoPrompt(prompt)).toBe(createHash("sha256").update(prompt).digest("hex"));
  });

  it("accepts a complete run whose prompt_hash matches the current video_prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-reel-fresh-ok-"));
    roots.push(root);
    const date = "2026-07-16";
    const slot = 2;
    const targetPath = "docs/assets/2026-07-16/slot-02.mp4";
    const videoPrompt =
      "Photorealistic premium 10-second vertical commercial in a busy Taiwanese family entryway.";
    const promptHash = hashVideoPrompt(videoPrompt);

    await writeJson(videoRunReportPath(date, slot, root), {
      status: "complete",
      prompt_hash: promptHash,
      target_path: targetPath,
      completed_at: "2026-07-16T01:00:00.000Z"
    });

    const assessment = await assessReelRunFreshness({
      date,
      slot,
      videoPrompt,
      targetPath,
      root
    });

    expect(assessment).toMatchObject({
      ok: true,
      code: "fresh",
      expected_prompt_hash: promptHash,
      run_prompt_hash: promptHash,
      media_state: "就緒"
    });
    expect(() => assertReelRunFresh(assessment)).not.toThrow();
  });

  it("rejects a stale creative when run prompt_hash does not match the current video_prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-reel-fresh-stale-"));
    roots.push(root);
    const date = "2026-07-16";
    const slot = 2;
    const targetPath = "docs/assets/2026-07-16/slot-02.mp4";
    const currentPrompt =
      "Photorealistic premium 10-second vertical commercial in a busy Taiwanese family entryway.";
    const stalePrompt =
      "Photorealistic premium 10-second vertical commercial about office commute laundry bags.";
    const expectedHash = hashVideoPrompt(currentPrompt);
    const staleHash = hashVideoPrompt(stalePrompt);

    await writeJson(videoRunReportPath(date, slot, root), {
      status: "complete",
      prompt_hash: staleHash,
      target_path: targetPath,
      completed_at: "2026-07-15T15:59:24.050Z"
    });

    const assessment = await assessReelRunFreshness({
      date,
      slot,
      videoPrompt: currentPrompt,
      targetPath,
      root
    });

    expect(assessment).toMatchObject({
      ok: false,
      code: "prompt_mismatch",
      expected_prompt_hash: expectedHash,
      run_prompt_hash: staleHash,
      media_state: "Reel 創意已過期",
      next_action: "重新生成 Reel"
    });
    expect(assessment.message).toContain("prompt hash mismatch");
    expect(assessment.message).toContain("Stale creative/prompt mismatch");
    expect(() => assertReelRunFresh(assessment)).toThrow(/Stale creative\/prompt mismatch/);
  });

  it("blocks validatePublishableMedia on stale prompt before treating the old MP4 as publishable", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-validate-stale-reel-"));
    roots.push(root);
    const date = "2026-07-16";
    const currentPrompt = "Busy family laundry pickup reel prompt.";
    const staleHash = hashVideoPrompt("Office commute laundry reel prompt.");

    await writeJson(join(root, "data", "content-calendar", `${date}.json`), {
      date,
      timezone: "Asia/Taipei",
      generated_at: `${date}T00:00:00.000Z`,
      slots: [
        {
          slot: 1,
          time: "11:30",
          category: "知識文",
          topic: "slot-1",
          format: "image-post",
          media_type: "image",
          instagram_caption: "ig",
          facebook_caption: "fb",
          image_prompt: "img",
          visual_route: "shop-inspection",
          traffic_route: "object-proof",
          local_image_path: `docs/assets/${date}/slot-01.png`,
          public_image_url: `https://example.com/assets/${date}/slot-01.png`,
          status: "pending"
        },
        {
          slot: 2,
          time: "19:30",
          category: "情境文",
          topic: "忙碌家庭",
          format: "reel",
          media_type: "reel",
          instagram_caption: "ig",
          facebook_caption: "fb",
          image_prompt: "img",
          video_prompt: currentPrompt,
          visual_route: "customer-consultation",
          traffic_route: "value-prop-lead",
          local_image_path: `docs/assets/${date}/slot-02.png`,
          public_image_url: `https://example.com/assets/${date}/slot-02.png`,
          local_video_path: `docs/assets/${date}/slot-02.mp4`,
          public_video_url: `https://example.com/assets/${date}/slot-02.mp4`,
          status: "pending"
        }
      ]
    });

    for (const slot of [1, 2]) {
      const pad = String(slot).padStart(2, "0");
      await mkdir(join(root, "docs", "assets", date), { recursive: true });
      await writeFile(join(root, "docs", "assets", date, `slot-${pad}.png`), "png", "utf8");
    }
    await writeFile(join(root, "docs", "assets", date, "slot-02.mp4"), "mp4", "utf8");
    await writeJson(join(root, "data", "image-sources", `${date}.json`), [
      {
        date,
        slot: 1,
        source: "gpt-image-2",
        image_path: `docs/assets/${date}/slot-01.png`,
        marked_at: `${date}T01:00:00.000Z`
      },
      {
        date,
        slot: 2,
        source: "gpt-image-2",
        image_path: `docs/assets/${date}/slot-02.png`,
        marked_at: `${date}T01:00:00.000Z`
      }
    ]);
    await writeJson(join(root, "data", "video-sources", `${date}.json`), [
      {
        date,
        slot: 2,
        source: "grok-imagine-video",
        model: "grok-imagine-video",
        video_path: `docs/assets/${date}/slot-02.mp4`,
        request_id: "stale-request",
        duration_seconds: 10,
        width: 1080,
        height: 1920,
        frame_rate: 30,
        video_codec: "h264",
        marked_at: `${date}T01:10:00.000Z`
      }
    ]);
    await writeJson(videoRunReportPath(date, 2, root), {
      status: "complete",
      prompt_hash: staleHash,
      target_path: `docs/assets/${date}/slot-02.mp4`
    });

    await expect(validatePublishableMedia(date, root)).rejects.toThrow(/Stale creative\/prompt mismatch/);
  });
});
