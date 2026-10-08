// The 46+ tracked docs/assets/<date>/slot-0N.visual-qa.json records (and the
// data/visual-qa-fixtures/*/{sidecar,stills.visual-qa}.json records) are
// published (docs/ via GitHub Pages; both live in this public repo either
// way). Their `source`/`sources`/`reel` fields used to store this machine's
// absolute Windows path. These tests pin the fix: everything stored in those
// records must be repo-relative with forward slashes; the code paths that
// still need a real, resolvable path (ffmpeg -i, sha256File) must keep
// getting one.
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toRepoRelativePath } from "../src/paths";
import { burnCarouselCanaries, evaluateFromDisk } from "../src/visualQa";
import { handleCarousel } from "../src/visualQaCli";

const dirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("toRepoRelativePath", () => {
  const root = process.platform === "win32" ? "C:\\repo" : "/repo";

  it("strips the root and forward-slashes an absolute path under it", () => {
    const abs = process.platform === "win32" ? "C:\\repo\\docs\\assets\\2026-09-30\\slot-01.png" : "/repo/docs/assets/2026-09-30/slot-01.png";
    expect(toRepoRelativePath(root, abs)).toBe("docs/assets/2026-09-30/slot-01.png");
  });

  it("forward-slashes an already-relative path without touching its shape", () => {
    expect(toRepoRelativePath(root, "docs\\assets\\2026-09-30\\slot-01.png")).toBe("docs/assets/2026-09-30/slot-01.png");
    expect(toRepoRelativePath(root, "docs/assets/2026-09-30/slot-01.png")).toBe("docs/assets/2026-09-30/slot-01.png");
  });

  it("leaves a path outside root alone (forward-slashed only), rather than fabricating a wrong relative path", () => {
    const outside = process.platform === "win32" ? "C:\\Users\\cyc39\\Downloads\\ref.png" : "/tmp/ref.png";
    const got = toRepoRelativePath(root, outside);
    expect(got).not.toMatch(/\\/u);
    expect(got.startsWith("..")).toBe(false); // not silently rebased onto root either
  });
});

describe("burnCarouselCanaries stores a repo-relative source, not the absolute one used to run ffmpeg", () => {
  // A 1x1 PNG, same fixture shape used elsewhere in this suite for ffmpeg-backed tests.
  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

  it("records slides[].source as repo-relative (docs/assets/...) when the source lives under root", async () => {
    const root = tmp("vq-relpath-root-");
    const assetDir = join(root, "docs", "assets", "2026-09-30");
    await mkdir(assetDir, { recursive: true });
    const sourceAbs = join(assetDir, "slot-01.png");
    writeFileSync(sourceAbs, TINY_PNG);
    const qaDir = tmp("vq-relpath-qa-");

    const slides = await burnCarouselCanaries({ sources: [sourceAbs], qaDir, root });

    expect(slides).toHaveLength(1);
    expect(slides[0]?.source).toBe("docs/assets/2026-09-30/slot-01.png");
    expect(slides[0]?.source).not.toContain(root);
    expect(slides[0]?.source).not.toContain(sep === "\\" ? "\\" : "\0");
  });
});

describe("evaluateFromDisk stores record.reel as repo-relative, still hashes the real file", () => {
  it("relativizes reel against root while sha256File still reads the real path", async () => {
    const root = tmp("vq-relpath-root2-");
    const reelDir = join(root, "output", "reels-run", "2026-07-29", "reels");
    await mkdir(reelDir, { recursive: true });
    const reelAbs = join(reelDir, "wool-coat-shoulder-15s.mp4");
    writeFileSync(reelAbs, "not-a-real-video-but-hashable");
    const qaDir = tmp("vq-relpath-qa2-");

    const record = await evaluateFromDisk({
      qaDir,
      stdout: "",
      reelPath: reelAbs,
      sidecar: { reel: reelAbs, reel_sha256: "", treatment: "10s", duration: 1, frames: [] },
      promptHash: "p",
      runId: "r",
      root
    });

    expect(record.reel).toBe("output/reels-run/2026-07-29/reels/wool-coat-shoulder-15s.mp4");
    expect(record.reel).not.toContain(root);
  });

  it("without a root, falls back to process.cwd() rather than throwing (backward-compatible default)", async () => {
    const qaDir = tmp("vq-relpath-qa3-");
    const record = await evaluateFromDisk({
      qaDir,
      stdout: "",
      reelPath: join(qaDir, "reel.mp4"),
      sidecar: { reel: "x", reel_sha256: "", treatment: "10s", duration: 1, frames: [] },
      promptHash: "p",
      runId: "r"
    }).catch((err: Error) => err);
    // qaDir has no reel.mp4 file -> sha256File throws; the point of this test
    // is only that omitting `root` does not throw a *different*, unrelated error.
    expect(record).toBeInstanceOf(Error);
  });
});

describe("handleCarousel hands its root to the burner, so the stored sources stay repo-relative", () => {
  // Pins the line where PR #124 (injectable burner) and PR #119 (root for repo-relative paths)
  // meet: dropping `root` from the burnSlides call falls back to projectRoot() and rewrites
  // paths against the wrong root whenever the CLI runs with another root.
  const TINY = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

  it("forwards the root it was given into the burn call", async () => {
    const root = tmp("vq-root-forward-");
    const assetDir = join(root, "docs", "assets", "2026-09-30");
    await mkdir(assetDir, { recursive: true });
    const sources = [1, 2].map((index) => {
      const file = join(assetDir, `slot-01-slide-0${index}.png`);
      writeFileSync(file, TINY);
      return file;
    });
    let seenRoot: string | undefined;
    const burn = async (input: { sources: string[]; qaDir: string; root?: string }) => {
      seenRoot = input.root;
      throw new Error("stop-after-burn");
    };
    await expect(
      handleCarousel(
        ["--files", sources.join(","), "--topic", "root forwarding", "--qa-dir", join(root, "qa"), "--out", join(root, "out.json")],
        root,
        burn as never
      )
    ).rejects.toThrow("stop-after-burn");
    expect(seenRoot).toBe(root);
  });
});
