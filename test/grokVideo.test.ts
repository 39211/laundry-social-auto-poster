import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGrokVideoRequest, generateGrokVideos } from "../src/generateGrokVideo";
import type { VideoPromptManifestItem } from "../src/generateVideo";
import { synthesizeNarration } from "../src/tts";
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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("builds the official 10-second 720p vertical request", () => {
    expect(buildGrokVideoRequest(item)).toEqual({
      model: "grok-imagine-video",
      prompt: item.prompt,
      duration: 10,
      aspect_ratio: "9:16",
      resolution: "720p"
    });
  });

  it("rejects every raw XAI environment flag before any API call", async () => {
    vi.stubEnv("GROK_REELS_ENABLED", "true");
    vi.stubEnv("XAI_API_KEY", "raw-production-key");
    vi.stubEnv("XAI_VIDEO_BILLING_ACK", "true");
    vi.stubEnv("LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM", "allow-temp-production-runtime-shims-v1");
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://39211.github.io");
    const root = await mkdtemp(join(tmpdir(), "laundry-grok-safety-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      generateGrokVideos({
        date: "2026-07-16",
        slot: 2,
        root
      })
    ).rejects.toThrow("Direct Grok video generation is disabled by policy");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose raw direct paid aliases", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["generate-grok-videos"]).toBeUndefined();
    expect(packageJson.scripts?.tts).toBeUndefined();
  });

  it("contains no raw xAI credential or network route", async () => {
    const source = await readFile(join(process.cwd(), "src", "generateGrokVideo.ts"), "utf8");

    expect(source).not.toContain("XAI_API_KEY");
    expect(source).not.toContain("Authorization");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });

  it("rejects raw TTS flags before any fetch, and leaves no authorization or Python route", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "raw-production-key");
    vi.stubEnv("MINIMAX_BASE_URL", "https://untrusted.invalid/v1");
    vi.stubEnv("LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM", "allow-temp-production-runtime-shims-v1");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      synthesizeNarration({
        text: "測試旁白",
        outPath: "docs/assets/narration.mp3",
        date: "2026-07-16",
        slot: 2,
        root: process.cwd()
      })
    ).rejects.toThrow("Direct TTS execution is disabled by policy");
    expect(fetchImpl).not.toHaveBeenCalled();

    const source = await readFile(join(process.cwd(), "src", "tts.ts"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bspawn(?:Sync)?\s*\(/u);
    expect(source).not.toContain("Authorization");
    expect(source).not.toContain("MINIMAX_BASE_URL");
  });

  it("makes both raw tsx entrypoints exit with a policy refusal", () => {
    const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    for (const [entrypoint, refusal] of [
      ["src/generateGrokVideo.ts", "Direct Grok video generation is disabled by policy"],
      ["src/tts.ts", "Direct TTS execution is disabled by policy"]
    ] as const) {
      const result = spawnSync(process.execPath, [tsxCli, entrypoint], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          XAI_API_KEY: "raw-production-key",
          XAI_VIDEO_BILLING_ACK: "true",
          MINIMAX_API_KEY: "raw-production-key",
          MINIMAX_BASE_URL: "https://untrusted.invalid/v1"
        }
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(refusal);
    }
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
