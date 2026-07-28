import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { importGrokVideo } from "../src/importGrokVideo";
import type { VideoMetadata } from "../src/videoMedia";

const validMetadata: VideoMetadata = {
  duration_seconds: 10,
  width: 1080,
  height: 1920,
  frame_rate: 30,
  video_codec: "h264",
  audio_codec: "aac",
  audio_sample_rate: 48_000,
  format_name: "mov,mp4"
};

describe("manual Grok video import", () => {
  it("normalizes a human-downloaded Reel and writes auditable provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-manual-grok-import-"));
    const inputPath = join(root, "downloads", "rainy-original.mp4");
    await mkdir(dirname(inputPath), { recursive: true });
    await writeFile(inputPath, "manual-grok-video", "utf8");
    const normalize = vi.fn(async (input: string, output: string) => copyFile(input, output));
    const probe = vi.fn().mockResolvedValue(validMetadata);

    const record = await importGrokVideo({
      date: "2026-07-21",
      slot: 2,
      inputPath,
      sourceReference: "https://grok.com/imagine/project/test-reference",
      root,
      normalize,
      probe,
      now: new Date("2026-07-20T00:00:00.000Z")
    });

    expect(record).toMatchObject({
      source: "grok-imagine-video",
      source_route: "grok-web-manual",
      source_reference: "https://grok.com/imagine/project/test-reference",
      video_path: "docs/assets/2026-07-21/slot-02.mp4",
      width: 1080,
      height: 1920
    });
    expect(normalize).toHaveBeenCalledOnce();
    const run = JSON.parse(
      await readFile(join(root, "data", "video-runs", "2026-07-21", "slot-02", "run.json"), "utf8")
    ) as Record<string, unknown>;
    expect(run).toMatchObject({
      status: "complete",
      source_route: "grok-web-manual",
      target_path: "docs/assets/2026-07-21/slot-02.mp4"
    });
    expect(run.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a non-vertical source before writing a publishable Reel", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-manual-grok-reject-"));
    const inputPath = join(root, "rainy-landscape.mp4");
    await writeFile(inputPath, "landscape", "utf8");
    const probe = vi.fn().mockResolvedValue({ ...validMetadata, width: 1920, height: 1080 });
    const normalize = vi.fn();

    await expect(
      importGrokVideo({
        date: "2026-07-21",
        slot: 2,
        inputPath,
        sourceReference: "manual-test",
        root,
        normalize,
        probe
      })
    ).rejects.toThrow("must be a non-empty 9:16 video");
    expect(normalize).not.toHaveBeenCalled();
  });

  it("imports a Hermes OAuth companion video for a mixed-carousel slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-hermes-grok-import-"));
    const inputPath = join(root, "downloads", "shoe-final.mp4");
    await mkdir(dirname(inputPath), { recursive: true });
    await writeFile(inputPath, "hermes-grok-video", "utf8");
    const normalize = vi.fn(async (input: string, output: string) => copyFile(input, output));
    const probe = vi.fn().mockResolvedValue(validMetadata);

    const record = await importGrokVideo({
      date: "2026-07-29",
      slot: 1,
      inputPath,
      sourceReference: "hermes-run:test-2026-07-29-slot-01",
      sourceRoute: "hermes-xai-oauth",
      model: "grok-imagine-video-1.5",
      root,
      normalize,
      probe
    });

    expect(record).toMatchObject({
      source_route: "hermes-xai-oauth",
      model: "grok-imagine-video-1.5",
      video_path: "docs/assets/2026-07-29/slot-01.mp4"
    });
  });
});
