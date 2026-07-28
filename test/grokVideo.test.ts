import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGrokVideoRequest, generateGrokVideos, resolveXaiApiKey } from "../src/generateGrokVideo";
import type { VideoPromptManifestItem } from "../src/generateVideo";
import { assertMetaReelMetadata } from "../src/videoMedia";

const item: VideoPromptManifestItem = {
  date: "2026-07-16",
  slot: 2,
  topic: "洗衣籃不用再陪你一起下班",
  prompt: "Photorealistic premium 10-second vertical commercial.",
  model: "grok-imagine-video",
  duration_seconds: 10,
  aspect_ratio: "9:16",
  resolution: "720p",
  target_path: "docs/assets/2026-07-16/slot-02.mp4",
  public_video_url: "https://39211.github.io/assets/2026-07-16/slot-02.mp4",
  status: "generation_pending"
};

describe("official Grok video workflow", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("builds the official 10-second 720p vertical request", () => {
    expect(buildGrokVideoRequest(item)).toEqual({
      model: "grok-imagine-video",
      prompt: item.prompt,
      duration: 10,
      aspect_ratio: "9:16",
      resolution: "720p"
    });
  });

  it("requires explicit paid billing acknowledgement before any API call", async () => {
    vi.stubEnv("GROK_REELS_ENABLED", "true");
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://39211.github.io");
    const root = await mkdtemp(join(tmpdir(), "laundry-grok-safety-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      generateGrokVideos({
        date: "2026-07-16",
        slot: 2,
        root,
        live: true,
        env: { XAI_API_KEY: "test-key", XAI_VIDEO_BILLING_ACK: "false" },
        fetchImpl
      })
    ).rejects.toThrow("XAI_VIDEO_BILLING_ACK=true");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reuses a trusted project env without copying or exposing its xAI key", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-shared-xai-env-"));
    const sharedEnv = join(root, "shared.env");
    await writeFile(sharedEnv, "XAI_API_KEY=shared-test-key\n", "utf8");

    await expect(resolveXaiApiKey({ XAI_CREDENTIAL_ENV_FILE: sharedEnv })).resolves.toBe("shared-test-key");
    await expect(
      resolveXaiApiKey({ XAI_API_KEY: "direct-test-key", XAI_CREDENTIAL_ENV_FILE: sharedEnv })
    ).resolves.toBe("direct-test-key");
  });

  it("accepts normalized Meta Reel metadata and rejects wrong aspect ratios", () => {
    expect(() =>
      assertMetaReelMetadata({
        duration_seconds: 10,
        width: 1080,
        height: 1920,
        frame_rate: 30,
        video_codec: "h264",
        audio_codec: "aac",
        audio_sample_rate: 48_000,
        format_name: "mov,mp4,m4a,3gp,3g2,mj2"
      })
    ).not.toThrow();

    expect(() =>
      assertMetaReelMetadata({
        duration_seconds: 10,
        width: 1920,
        height: 1080,
        frame_rate: 30,
        video_codec: "h264",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2"
      })
    ).toThrow("must be 9:16");
  });
});
