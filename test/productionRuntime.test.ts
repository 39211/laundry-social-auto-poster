import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGrokVideos } from "../src/generateGrokVideo";
import { writeJsonAtomic } from "../src/logging";
import { recordOwnerVideoReview } from "../src/ownerVideoReview";
import { TrustedProductionRuntimeError } from "../src/productionRuntime";
import { synthesizeNarration } from "../src/tts";
import { probeVideo, type VideoCommandRunner } from "../src/videoMedia";
import { burnCarouselCanaries } from "../src/visualQa";

const FFPROBE_PAYLOAD = JSON.stringify({
  format: { duration: "10", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000" }
  ]
});

function clearRuntimeTestEnvironment(): void {
  vi.stubEnv("LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM", "");
  vi.stubEnv("LAUNDRY_TRUSTED_FFMPEG_EXE", "");
  vi.stubEnv("LAUNDRY_TRUSTED_FFPROBE_EXE", "");
  vi.stubEnv("LAUNDRY_TRUSTED_PYTHON_EXE", "");
}

describe("immutable production media runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not execute a PATH-shadow ffprobe when no immutable allowlist entry exists", async () => {
    clearRuntimeTestEnvironment();
    const root = await mkdtemp(join(tmpdir(), "runtime-path-shadow-root-"));
    const shadow = join(root, "path-shadow", "ffprobe.exe");
    await mkdir(dirname(shadow), { recursive: true });
    await writeFile(shadow, "untrusted PATH shadow", "utf8");
    vi.stubEnv("PATH", `${dirname(shadow)};${process.env.PATH ?? ""}`);
    const run = vi.fn() as unknown as VideoCommandRunner;

    await expect(probeVideo(join(root, "candidate.mp4"), { root, execFile: run })).rejects.toBeInstanceOf(
      TrustedProductionRuntimeError
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts a hash-pinned allowlisted ffprobe fixture without consulting PATH", async () => {
    clearRuntimeTestEnvironment();
    const root = await mkdtemp(join(tmpdir(), "runtime-allowlist-root-"));
    const programFiles = await mkdtemp(join(tmpdir(), "runtime-program-files-"));
    const executable = join(programFiles, "FFmpeg", "bin", "ffprobe.exe");
    const bytes = Buffer.from("approved ffprobe fixture", "utf8");
    await mkdir(dirname(executable), { recursive: true });
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(executable, bytes);
    await writeFile(
      join(root, "scripts", "production-runtime-allowlist.json"),
      `${JSON.stringify({
        version: 1,
        executables: {
          ffprobe: {
            path: executable,
            sha256: createHash("sha256").update(bytes).digest("hex")
          }
        }
      })}\n`,
      "utf8"
    );
    vi.stubEnv("ProgramFiles", programFiles);
    vi.stubEnv("PATH", join(root, "path-shadow"));
    const run = vi.fn(async () => ({ stdout: FFPROBE_PAYLOAD, stderr: "" })) as unknown as VideoCommandRunner;

    await expect(probeVideo(join(root, "candidate.mp4"), { root, execFile: run })).resolves.toMatchObject({
      width: 1080,
      height: 1920,
      video_codec: "h264"
    });
    expect(run).toHaveBeenCalledWith(executable, expect.any(Array));
  });

  it("blocks raw Grok generation even when production environment flags claim approval", async () => {
    clearRuntimeTestEnvironment();
    vi.stubEnv("XAI_API_KEY", "raw-production-key");
    vi.stubEnv("XAI_VIDEO_BILLING_ACK", "true");
    vi.stubEnv("LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM", "allow-temp-production-runtime-shims-v1");
    const root = await mkdtemp(join(tmpdir(), "runtime-grok-direct-disabled-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      generateGrokVideos({ date: "2026-07-16", slot: 2, root })
    ).rejects.toThrow("Direct Grok video generation is disabled by policy");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks raw TTS before fetch or spawn, even with production environment flags", async () => {
    clearRuntimeTestEnvironment();
    vi.stubEnv("MINIMAX_API_KEY", "raw-production-key");
    vi.stubEnv("MINIMAX_BASE_URL", "https://untrusted.invalid/v1");
    vi.stubEnv("LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM", "allow-temp-production-runtime-shims-v1");
    const root = await mkdtemp(join(tmpdir(), "runtime-tts-direct-disabled-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      synthesizeNarration({
        text: "測試旁白",
        outPath: "docs/assets/narration.mp3",
        date: "2026-07-16",
        slot: 2,
        root
      })
    ).rejects.toThrow("Direct TTS execution is disabled by policy");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("contains no MiniMax authorization or Python spawn route for MINIMAX_BASE_URL to receive", async () => {
    const source = await readFile(join(process.cwd(), "src", "tts.ts"), "utf8");

    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bspawn(?:Sync)?\s*\(/u);
    expect(source).not.toContain("Authorization");
    expect(source).not.toContain("MINIMAX_BASE_URL");
  });

  it("blocks owner review before a PATH-shadow ffmpeg can run", async () => {
    clearRuntimeTestEnvironment();
    const root = await mkdtemp(join(tmpdir(), "runtime-owner-review-"));
    const date = "2026-09-01";
    const videoPath = `docs/assets/${date}/slot-01.mp4`;
    await mkdir(dirname(join(root, ...videoPath.split("/"))), { recursive: true });
    await writeFile(join(root, ...videoPath.split("/")), "not a real video", "utf8");
    await writeJsonAtomic(join(root, "data", "content-calendar", `${date}.json`), {
      date,
      generated_at: "2026-08-31T22:30:00.000Z",
      slots: [
        {
          slot: 1,
          scheduled_time: "11:30",
          topic: "runtime review fixture",
          media_type: "mixed-carousel",
          caption: "caption",
          image_prompt: "prompt",
          local_image_path: `docs/assets/${date}/slot-01.png`,
          public_image_url: "https://example.com/slot-01.png",
          local_video_path: videoPath,
          public_video_url: "https://example.com/slot-01.mp4",
          video_prompt: "one action"
        },
        {
          slot: 2,
          scheduled_time: "19:30",
          topic: "runtime review companion",
          media_type: "image",
          caption: "caption",
          image_prompt: "prompt",
          local_image_path: `docs/assets/${date}/slot-02.png`,
          public_image_url: "https://example.com/slot-02.png"
        }
      ]
    });
    const shadow = join(root, "path-shadow", "ffmpeg.exe");
    await mkdir(dirname(shadow), { recursive: true });
    await writeFile(shadow, "untrusted ffmpeg", "utf8");
    vi.stubEnv("PATH", `${dirname(shadow)};${process.env.PATH ?? ""}`);

    await expect(recordOwnerVideoReview({ date, slot: 1, watched: true, root })).rejects.toBeInstanceOf(
      TrustedProductionRuntimeError
    );
  });

  it("blocks visual-QA canary rendering before a PATH-shadow ffmpeg can run", async () => {
    clearRuntimeTestEnvironment();
    const root = await mkdtemp(join(tmpdir(), "runtime-visual-qa-"));
    const shadow = join(root, "path-shadow", "ffmpeg.exe");
    await mkdir(dirname(shadow), { recursive: true });
    await writeFile(shadow, "untrusted ffmpeg", "utf8");
    vi.stubEnv("PATH", `${dirname(shadow)};${process.env.PATH ?? ""}`);
    const run = vi.fn() as unknown as VideoCommandRunner;

    await expect(
      burnCarouselCanaries({
        root,
        sources: [join(root, "slide.png")],
        qaDir: join(root, "qa"),
        execFile: run
      })
    ).rejects.toBeInstanceOf(TrustedProductionRuntimeError);
    expect(run).not.toHaveBeenCalled();
  });
});
