import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFeaturePostedLogRange, readFeatureReelYoutubeTitle } from "../src/featurePostedLog";

describe("feature posted log reader", () => {
  it("returns no rows when the feature log directory is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "feature-posted-log-missing-"));
    await expect(readFeaturePostedLogRange(root, "2026-11-01", "2026-11-03")).resolves.toEqual({
      dates: [],
      skippedFiles: 0
    });
  });

  it("reads only in-range date files and counts malformed JSON files", async () => {
    const root = await mkdtemp(join(tmpdir(), "feature-posted-log-range-"));
    const directory = join(root, "data", "feature-posted-log");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "2026-11-02.json"),
      JSON.stringify([{ platform: "youtube", slug: "feature-yt", status: "success", post_id: "yt-1" }]),
      "utf8"
    );
    await writeFile(join(directory, "2026-11-03.json"), "{not-json", "utf8");
    await writeFile(
      join(directory, "2026-11-04.json"),
      JSON.stringify([{ platform: "instagram", slug: "outside", status: "success", post_id: "ig-outside" }]),
      "utf8"
    );

    await expect(readFeaturePostedLogRange(root, "2026-11-02", "2026-11-03")).resolves.toEqual({
      dates: [
        {
          date: "2026-11-02",
          rows: [{ platform: "youtube", slug: "feature-yt", status: "success", post_id: "yt-1" }]
        }
      ],
      skippedFiles: 1
    });
  });

  it("reads a feature Reel YouTube title when present and falls back cleanly when absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "feature-reel-title-"));
    const directory = join(root, "data", "feature-reels");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "2026-11-02.json"), JSON.stringify({ youtube_title: "Feature title" }), "utf8");

    await expect(readFeatureReelYoutubeTitle(root, "2026-11-02")).resolves.toBe("Feature title");
    await expect(readFeatureReelYoutubeTitle(root, "2026-11-03")).resolves.toBeUndefined();
  });
});
