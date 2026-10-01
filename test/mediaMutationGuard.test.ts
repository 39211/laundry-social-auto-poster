import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import { generateGrokVideos } from "../src/generateGrokVideo";
import { slotMoveBlockReason } from "../src/generateImage";
import { importGrokVideo } from "../src/importGrokVideo";
import {
  assertSlotMediaMutable,
  findSlotLocks,
  SlotLockedError,
  type SlotLock
} from "../src/mediaMutationGuard";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import { scheduleReel } from "../src/scheduleReel";
import type { DailySlot } from "../src/types";
import type { VideoMetadata } from "../src/videoMedia";

const DATE = "2026-09-24";
const SLOT = 2;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX_CLI = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const GUARD_CLI = fileURLToPath(new URL("../src/mediaGuardCli.ts", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  const cleanup = roots.splice(0);
  await Promise.all(cleanup.map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
});

async function tempRoot(prefix = "media-mutation-guard-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function dailySlot(slot: number): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: "情境文",
    topic: "帆布包提把發黑",
    format: "image-post",
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "A used canvas bag on a shop counter.",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`,
    public_image_url: `https://example.invalid/assets/${DATE}/slot-0${slot}.png`,
    status: "pending"
  } as DailySlot;
}

async function addScheduledLock(root: string, slot = SLOT, detail = "scheduled-123"): Promise<void> {
  await writeJson(root, `data/scheduled-log/${DATE}.json`, [
    { date: DATE, slot, platform: "facebook", scheduled_post_id: detail, status: "scheduled" }
  ]);
}

describe("media mutation slot locks", () => {
  it("R1 finds one Facebook scheduled-log lock and uses scheduled_post_id", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([
      { source: "scheduled-log", detail: "scheduled-123" }
    ] satisfies SlotLock[]);
  });

  it("R1 treats a scheduled uncertain Facebook row as a lock", async () => {
    const root = await tempRoot();
    await writeJson(root, `data/scheduled-log/${DATE}.json`, [
      { date: DATE, slot: SLOT, platform: "facebook", status: "uncertain" }
    ]);

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([
      { source: "scheduled-log", detail: "uncertain" }
    ]);
  });

  it("R1 finds an IG cloud queue marker lock", async () => {
    const root = await tempRoot();
    const marker = join(root, "data", "ig-cloud", "queue", `${DATE}-slot${SLOT}.json`);
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, "{}", "utf8");

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([
      { source: "ig-cloud-queue", detail: "queued" }
    ]);
  });

  it("R1 finds a non-dry-run posted success lock with platform and status", async () => {
    const root = await tempRoot();
    await writeJson(root, `data/posted-log/${DATE}.json`, [
      { date: DATE, slot: SLOT, platform: "instagram", status: "success", dry_run: false }
    ]);

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([
      { source: "posted-log", detail: "instagram success" }
    ]);
  });

  it("R1 ignores posted-log dry runs", async () => {
    const root = await tempRoot();
    await writeJson(root, `data/posted-log/${DATE}.json`, [
      { date: DATE, slot: SLOT, platform: "facebook", status: "success", dry_run: true }
    ]);

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([]);
  });

  it("R1 ignores posted-log failed rows", async () => {
    const root = await tempRoot();
    await writeJson(root, `data/posted-log/${DATE}.json`, [
      { date: DATE, slot: SLOT, platform: "facebook", status: "failed", dry_run: false }
    ]);

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([]);
  });

  it("R1 treats non-dry-run posted uncertain rows as a lock", async () => {
    const root = await tempRoot();
    await writeJson(root, `data/posted-log/${DATE}.json`, [
      { date: DATE, slot: SLOT, platform: "facebook", status: "uncertain", dry_run: false }
    ]);

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([
      { source: "posted-log", detail: "facebook uncertain" }
    ]);
  });

  it("R1 fails closed on unreadable scheduled JSON", async () => {
    const root = await tempRoot();
    const path = join(root, "data", "scheduled-log", `${DATE}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{broken", "utf8");

    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([
      { source: "scheduled-log", detail: "unreadable" }
    ]);
  });

  it("R1 returns no locks when all three sources are absent", async () => {
    const root = await tempRoot();
    await expect(findSlotLocks(root, DATE, SLOT)).resolves.toEqual([]);
  });

  it("R1 assert succeeds for an unlocked slot", async () => {
    const root = await tempRoot();
    await expect(
      assertSlotMediaMutable({ root, date: DATE, slot: SLOT, operation: "test replacement" })
    ).resolves.toBeUndefined();
  });

  it("R1 assert throws SlotLockedError and names the source", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    await expect(
      assertSlotMediaMutable({ root, date: DATE, slot: SLOT, operation: "test replacement" })
    ).rejects.toMatchObject({
      name: "SlotLockedError",
      message: expect.stringContaining("scheduled-log: scheduled-123")
    });
  });

  it("R1 records a valid override with locks, reason, actor, and ISO time", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    await expect(
      assertSlotMediaMutable({
        root,
        date: DATE,
        slot: SLOT,
        operation: "replace test media",
        override: { reason: "owner corrected the media", actor: "shop-owner" }
      })
    ).resolves.toBeUndefined();

    const log = JSON.parse(
      await readFile(join(root, "data", "media-mutation-log", `${DATE}.json`), "utf8")
    ) as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      date: DATE,
      slot: SLOT,
      operation: "replace test media",
      reason: "owner corrected the media",
      actor: "shop-owner",
      locks: [{ source: "scheduled-log", detail: "scheduled-123" }]
    });
    expect(log[0]?.at).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/));
  });

  it("R1 treats an override with a blank reason as no override", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    await expect(
      assertSlotMediaMutable({
        root,
        date: DATE,
        slot: SLOT,
        operation: "test replacement",
        override: { reason: "  ", actor: "shop-owner" }
      })
    ).rejects.toBeInstanceOf(SlotLockedError);
  });
});

describe("R2 TypeScript entrypoint integration", () => {
  it("generateImage.slotMoveBlockReason returns scheduled-log", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    await expect(slotMoveBlockReason(DATE, root, dailySlot(SLOT))).resolves.toBe("scheduled-log");
  });

  it("generateImage.slotMoveBlockReason returns ig-cloud-queue", async () => {
    const root = await tempRoot();
    const marker = join(root, "data", "ig-cloud", "queue", `${DATE}-slot${SLOT}.json`);
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, "{}", "utf8");

    await expect(slotMoveBlockReason(DATE, root, dailySlot(SLOT))).resolves.toBe("ig-cloud-queue");
  });

  it("scheduleReel --force refuses a locked slot without changing formal media bytes", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);
    const videoPath = join(root, "docs", "assets", DATE, "slot-02.mp4");
    const coverPath = join(root, "docs", "assets", DATE, "slot-02.png");
    await mkdir(dirname(videoPath), { recursive: true });
    await writeFile(videoPath, Buffer.from("original video bytes"));
    await writeFile(coverPath, Buffer.from("original cover bytes"));
    const videoBefore = await readFile(videoPath);
    const coverBefore = await readFile(coverPath);

    await expect(
      scheduleReel({ date: DATE, conceptId: "leather-bag-corner", slot: SLOT, root, force: true })
    ).rejects.toBeInstanceOf(SlotLockedError);
    await expect(readFile(videoPath)).resolves.toEqual(videoBefore);
    await expect(readFile(coverPath)).resolves.toEqual(coverBefore);
  });

  it("importGrokVideo refuses a locked slot before normalize and leaves formal bytes untouched", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);
    const inputPath = join(root, "incoming.mp4");
    const targetPath = join(root, "docs", "assets", DATE, "slot-02.mp4");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(inputPath, Buffer.from("incoming video bytes"));
    await writeFile(targetPath, Buffer.from("formal video bytes"));
    const before = await readFile(targetPath);
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
    const normalize = vi.fn(async (input: string, output: string) => copyFile(input, output));
    const probe = vi.fn().mockResolvedValue(validMetadata);

    await expect(
      importGrokVideo({
        date: DATE,
        slot: SLOT,
        inputPath,
        sourceReference: "manual-test-reference",
        root,
        normalize,
        probe
      })
    ).rejects.toBeInstanceOf(SlotLockedError);
    expect(normalize).not.toHaveBeenCalled();
    await expect(readFile(targetPath)).resolves.toEqual(before);
  });

  it("generateGrokVideos --force refuses a locked slot before backup or network", async () => {
    const root = await tempRoot();
    await generateDailyContent({ date: DATE, root });
    const content = await loadDailyContent(DATE, root);
    const reel = content?.slots.find((item) => item.slot === SLOT);
    if (!content || !reel) throw new Error("test fixture did not create slot 2");
    reel.media_type = "reel";
    reel.format = "reel";
    reel.local_video_path = `docs/assets/${DATE}/slot-02.mp4`;
    reel.video_prompt = "A short test Reel without external calls.";
    await writeDailyContent(content, root);
    await addScheduledLock(root);
    const targetPath = join(root, "docs", "assets", DATE, "slot-02.mp4");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, Buffer.from("formal video bytes"));
    const before = await readFile(targetPath);
    const fetchImpl = vi.fn(async () => {
      throw new Error("network must not be reached by this test");
    }) as unknown as typeof fetch;

    await expect(
      generateGrokVideos({
        date: DATE,
        slot: SLOT,
        root,
        live: true,
        force: true,
        env: { XAI_VIDEO_BILLING_ACK: "true", XAI_API_KEY: "unit-test-key" },
        fetchImpl
      })
    ).rejects.toBeInstanceOf(SlotLockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readFile(targetPath)).resolves.toEqual(before);
  });
});

describe("R3 media guard CLI", () => {
  function runGuard(root: string, args: string[], environmentReason = "") {
    return spawnSync(
      process.execPath,
      [
        TSX_CLI,
        GUARD_CLI,
        "--root",
        root,
        "--date",
        DATE,
        "--slot",
        String(SLOT),
        "--operation",
        "CLI test replacement",
        ...args
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          MEDIA_GUARD_OVERRIDE_REASON: environmentReason,
          PUBLIC_SITE_BASE_URL: "https://example.invalid",
          PUBLIC_IMAGE_BASE_URL: "https://example.invalid"
        }
      }
    );
  }

  it("returns exit 3 and writes the lock message to stderr for a locked slot", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    const result = runGuard(root, []);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("locked");
    expect(result.stderr).toContain("scheduled-log");
  });

  it("returns exit 0 and MEDIA_GUARD ok for an unlocked slot", async () => {
    const root = await tempRoot();

    const result = runGuard(root, []);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MEDIA_GUARD| ok");
  });

  it("accepts the explicit CLI override only when its reason is present", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    const result = runGuard(root, ["--force-regen-scheduled", "--reason", "approved repair"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MEDIA_GUARD| ok");
    const log = JSON.parse(
      await readFile(join(root, "data", "media-mutation-log", `${DATE}.json`), "utf8")
    ) as Array<Record<string, unknown>>;
    expect(log[0]).toMatchObject({ reason: "approved repair", slot: SLOT });
    expect(log[0]?.actor).toBeTruthy();
  });

  it("accepts MEDIA_GUARD_OVERRIDE_REASON for PowerShell callers", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    const result = runGuard(root, [], "PowerShell approved repair");
    expect(result.status).toBe(0);
    const log = JSON.parse(
      await readFile(join(root, "data", "media-mutation-log", `${DATE}.json`), "utf8")
    ) as Array<Record<string, unknown>>;
    expect(log[0]?.reason).toBe("PowerShell approved repair");
  });

  it("treats --force-regen-scheduled without --reason as no override", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);

    const result = runGuard(root, ["--force-regen-scheduled"]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("locked");
  });
});
