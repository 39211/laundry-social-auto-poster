import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadPostLog, writePostLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { approvePost } from "../src/approvePost";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function approveSlot(root: string, date: string, slot = 1): Promise<void> {
  await approvePost({
    date,
    slot,
    platforms: ["facebook", "instagram"],
    approvedBy: "Test",
    note: "Test approval",
    root
  });
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
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const first = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    const second = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
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
    await approveSlot(root, date);
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    expect(await exists(join(root, "data", "content-calendar", `${date}.json`))).toBe(false);

    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(await exists(join(root, "data", "content-calendar", `${date}.json`))).toBe(false);
  });

  it("uses the private data calendar when the public calendar only contains approved public slots", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-private-calendar-"));
    const date = "2026-05-15";
    const content = buildDailyContent(
      date,
      getConfig({
        ...process.env,
        DRY_RUN: "true",
        PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
      })
    );

    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "data", "content-calendar", `${date}.json`), `${JSON.stringify(content, null, 2)}\n`);
    await writeFile(
      join(root, "docs", "content-calendar", `${date}.json`),
      `${JSON.stringify({ ...content, slots: [content.slots[0]] }, null, 2)}\n`
    );
    await approveSlot(root, date, 2);
    await writeFile(join(root, "docs", "assets", date, "slot-02.png"), "fake image");

    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T19:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
  });

  it("builds the public image URL at publish time when the calendar URL is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-empty-url-"));
    const date = "2026-05-15";
    const content = buildDailyContent(
      date,
      getConfig({
        ...process.env,
        DRY_RUN: "true",
        PUBLIC_IMAGE_BASE_URL: ""
      })
    );

    await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(
      join(root, "docs", "content-calendar", `${date}.json`),
      `${JSON.stringify(content, null, 2)}\n`
    );
    await approveSlot(root, date);
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");

    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: true,
      fetchImpl
    });

    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://tester.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-01.png",
      { method: "HEAD" }
    );
  });

  it("fails before posting when PUBLIC_IMAGE_BASE_URL is missing", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missing-base-"));
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow("PUBLIC_IMAGE_BASE_URL is required");

    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("fails before writing a post log when live Meta env vars are missing", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "");
    vi.stubEnv("FB_PAGE_ID", "");
    vi.stubEnv("IG_USER_ID", "");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missing-meta-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow("Live posting is missing env vars: META_ACCESS_TOKEN, FB_PAGE_ID, IG_USER_ID");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("treats masked Meta env placeholders as missing in live mode", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "[REDACTED]");
    vi.stubEnv("FB_PAGE_ID", "present");
    vi.stubEnv("IG_USER_ID", "your_ig_user_id");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-placeholder-meta-"));

    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow("Live posting is missing env vars: META_ACCESS_TOKEN, FB_PAGE_ID, IG_USER_ID");

    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("runs live preflight without calling Meta APIs or writing posted logs", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-live-preflight-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: true,
      preflightOnly: true,
      fetchImpl
    });

    expect(results.map((entry) => entry.status)).toEqual(["pending", "pending"]);
    expect(results.every((entry) => entry.dry_run === false && entry.attempts === 0)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://tester.github.io/laundry-social-auto-poster/assets/2026-05-15/slot-01.png",
      { method: "HEAD" }
    );
    expect(await loadPostLog("2026-05-15", root)).toEqual([]);
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });

  it("does not write success when the public image URL is unreadable", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-unreadable-url-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
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
    await approveSlot(root, "2026-05-15");
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    const raw = await readFile(join(root, "data", "posted-log", "2026-05-15.json"), "utf8");
    expect(raw).toContain('"status": "success"');
    expect(raw).toContain('"dry_run": true');
  });

  it("treats missed live records as terminal and skips later publish attempts", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await mkdtemp(join(tmpdir(), "laundry-social-missed-"));
    const date = "2026-05-15";
    await generateDailyContent({ date, root, force: true });
    await approveSlot(root, date);
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    await writePostLog(
      date,
      [
        {
          date,
          slot: 1,
          platform: "facebook",
          status: "missed",
          dry_run: false,
          attempts: 0,
          error: "Past scheduled window; do not back-post.",
          created_at: "2026-05-15T12:30:00.000Z"
        },
        {
          date,
          slot: 1,
          platform: "instagram",
          status: "missed",
          dry_run: false,
          attempts: 0,
          error: "Past scheduled window; do not back-post.",
          created_at: "2026-05-15T12:30:00.000Z"
        }
      ],
      root
    );

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const results = await postCurrentSlot({
      root,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(results.map((entry) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await loadPostLog(date, root)).toHaveLength(2);
  });

  it("refuses to post without approval records", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-social-no-approval-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });
    await mkdir(join(root, "docs", "assets", "2026-05-15"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "2026-05-15", "slot-01.png"), "fake image");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        now: "2026-05-15T11:30:00+08:00",
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow("Run approve-post before posting");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(join(root, "data", "posted-log", "2026-05-15.json"))).toBe(false);
  });
});
