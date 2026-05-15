import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadPostLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("postCurrentSlot dry-run integration", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("DRY_RUN", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes dry-run logs and remains idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const first = await postCurrentSlot({
      root,
      now: "2026-05-15T07:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    const second = await postCurrentSlot({
      root,
      now: "2026-05-15T07:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(first.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(second.map((entry) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(fetchImpl).not.toHaveBeenCalled();

    const log = await loadPostLog("2026-05-15", root);
    expect(log).toHaveLength(2);
  });

  it("prefers docs/content-calendar without requiring data/content-calendar", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-docs-"));
    const date = "2026-05-15";
    const content = buildDailyContent(
      date,
      getConfig({
        ...process.env,
        DRY_RUN: "true",
        PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
      })
    );

    await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(
      join(root, "docs", "content-calendar", `${date}.json`),
      `${JSON.stringify(content, null, 2)}\n`
    );
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    expect(await exists(join(root, "data", "content-calendar", `${date}.json`))).toBe(false);

    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T07:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(await exists(join(root, "data", "content-calendar", `${date}.json`))).toBe(false);
  });

  it("fails before posting when PUBLIC_IMAGE_BASE_URL is missing", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missing-base-"));
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T07:30:00+08:00",
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow("PUBLIC_IMAGE_BASE_URL is required");

    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("does not write success when the public image URL is unreadable", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-unreadable-url-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T07:30:00+08:00",
        dryRun: true,
        verifyPublicImageUrl: true,
        fetchImpl
      })
    ).rejects.toThrow("Public image URL is not reachable");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("keeps dry-run logs as success without calling Meta APIs", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-log-format-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    await postCurrentSlot({
      root,
      now: "2026-05-15T07:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    const raw = await readFile(join(root, "data", "posted-log", "2026-05-15.json"), "utf8");
    expect(raw).toContain('"status": "success"');
    expect(raw).toContain('"dry_run": true');
  });
});
