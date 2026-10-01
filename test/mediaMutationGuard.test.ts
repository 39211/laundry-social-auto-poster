import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  parseMediaGuardOverride,
  SlotLockedError,
  type SlotLock
} from "../src/mediaMutationGuard";
import { loadDailyContent, writeDailyContent, writeVideoSources } from "../src/logging";
import { markImageSource } from "../src/markImageSource";
import { REEL_CONCEPTS, REEL_SCHEDULE } from "../src/reelConcepts";
import { healOneSlot, reelCoverSourceRel, restoreReelSlot, scheduleReel } from "../src/scheduleReel";
import type { DailySlot, VideoSourceRecord } from "../src/types";
import type { VideoMetadata } from "../src/videoMedia";

const DATE = "2026-09-24";
const SLOT = 2;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX_CLI = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const GUARD_CLI = fileURLToPath(new URL("../src/mediaGuardCli.ts", import.meta.url));
const SCHEDULE_CLI = fileURLToPath(new URL("../src/scheduleReel.ts", import.meta.url));
const CONCEPT_ID = "leather-bag-corner";
const EVENING_CONCEPT_ID = "handbag-handle";
const OVERRIDE = { reason: "owner approved this slot repair", actor: "test-owner" };
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

async function writeBytes(root: string, relativePath: string, bytes: Buffer | string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeCalendar(root: string, slots: DailySlot[], date = DATE): Promise<void> {
  await writeDailyContent({ date, timezone: "Asia/Taipei", generated_at: `${date}T00:00:00.000Z`, slots }, root);
}

function conceptHook(conceptId = CONCEPT_ID): string {
  const concept = REEL_CONCEPTS.find((item) => item.id === conceptId);
  if (!concept) throw new Error(`Missing test concept: ${conceptId}`);
  return concept.hook;
}

function outgoingReel(slot: number, topic = "舊 Reel X 的題目"): DailySlot {
  return {
    ...dailySlot(slot),
    topic,
    format: "reel",
    media_type: "reel",
    local_video_path: `docs/assets/${DATE}/slot-0${slot}.mp4`,
    public_video_url: `https://example.invalid/assets/${DATE}/slot-0${slot}.mp4`
  };
}

async function seedSourceReel(root: string, conceptId = CONCEPT_ID, variant: "10s" | "15s" = "10s") {
  // Derive RUN_DIR from the production cover helper. reelAssetName uses no
  // suffix for 10s and -15s for 15s; neither fixture reads the real output/.
  const runDir = dirname(dirname(reelCoverSourceRel(conceptId)));
  const name = variant === "15s" ? `${conceptId}-15s.mp4` : `${conceptId}.mp4`;
  const video = Buffer.from(`new reel ${conceptId} ${variant}`);
  await writeBytes(root, join(runDir, "reels", name), video);
  await writeJson(root, join(runDir, "reels", `${name}.audio.json`), { narration: false });
  await writeBytes(root, reelCoverSourceRel(conceptId), Buffer.concat([PNG_MAGIC, Buffer.from(`new ${conceptId} cover`)]));
  return video;
}

async function seedOutgoingReel(root: string): Promise<{ video: Buffer; cover: Buffer }> {
  await seedSourceReel(root);
  await writeCalendar(root, [dailySlot(1), outgoingReel(SLOT)]);
  const video = Buffer.from("original formal reel bytes");
  const cover = Buffer.concat([PNG_MAGIC, Buffer.from("original formal cover")]);
  await writeBytes(root, `docs/assets/${DATE}/slot-02.mp4`, video);
  await writeBytes(root, `docs/assets/${DATE}/slot-02.png`, cover);
  await writeJson(root, `data/video-runs/${DATE}/slot-02/run.json`, { status: "complete", ab_variant: "10s" });
  await markImageSource({ root, date: DATE, slot: SLOT, source: "gpt-image-2", imagePath: `docs/assets/${DATE}/slot-02.png` });
  await addScheduledLock(root);
  return { video, cover };
}

async function seedExistingVideo(root: string): Promise<{ video: Buffer; record: VideoSourceRecord }> {
  const video = Buffer.from("existing formal video bytes");
  const record: VideoSourceRecord = {
    date: DATE,
    slot: SLOT,
    source: "grok-imagine-video",
    model: "grok-imagine-video-test",
    video_path: `docs/assets/${DATE}/slot-02.mp4`,
    request_id: "synthetic-existing-request",
    source_route: "xai-api",
    source_reference: "synthetic-existing-request",
    duration_seconds: 10,
    width: 720,
    height: 1280,
    frame_rate: 30,
    video_codec: "h264",
    audio_codec: "aac",
    marked_at: `${DATE}T00:00:00.000Z`
  };
  await writeBytes(root, record.video_path, video);
  await writeVideoSources(DATE, [record], root);
  return { video, record };
}

async function seedRestore(root: string): Promise<{ video: Buffer; cover: Buffer; restoredCover: Buffer }> {
  const original = await seedOutgoingReel(root);
  await writeJson(root, `output/reel-backups/${DATE}/slot-02.slot.json`, {
    date: DATE,
    slot: dailySlot(SLOT),
    manifest_entries: [],
    image_sources: [],
    saved_at: `${DATE}T00:00:00.000Z`
  });
  const restoredCover = Buffer.concat([PNG_MAGIC, Buffer.from("pre-reel cover")]);
  await writeBytes(root, `output/reel-backups/${DATE}/slot-02.png`, restoredCover);
  // There is no backed-up mp4: an unguarded restore would delete the formal clip.
  return { ...original, restoredCover };
}

async function seedTwoSlotHeal(root: string): Promise<{ lockedVideo: Buffer; eveningVideo: Buffer }> {
  await seedSourceReel(root, CONCEPT_ID, "15s");
  const eveningVideo = await seedSourceReel(root, EVENING_CONCEPT_ID);
  await writeCalendar(root, [dailySlot(1), dailySlot(2), outgoingReel(3, conceptHook())]);
  const lockedVideo = Buffer.from("scheduled noon 10s reel");
  await writeBytes(root, `docs/assets/${DATE}/slot-03.mp4`, lockedVideo);
  for (const slot of [2, 3]) {
    await writeBytes(root, `docs/assets/${DATE}/slot-0${slot}.png`, Buffer.concat([PNG_MAGIC, Buffer.from(`old slot ${slot}`)]));
    await markImageSource({ root, date: DATE, slot, source: "gpt-image-2", imagePath: `docs/assets/${DATE}/slot-0${slot}.png` });
  }
  await writeJson(root, `data/video-runs/${DATE}/slot-03/run.json`, { status: "complete", ab_variant: "10s" });
  await addScheduledLock(root, 3);
  await writeJson(root, "data/ab-test-plan.json", [{
    date: DATE,
    noon: { conceptId: CONCEPT_ID, variant: "15s" },
    evening: { conceptId: EVENING_CONCEPT_ID, variant: "10s" }
  }]);
  return { lockedVideo, eveningVideo };
}

function runSchedule(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [TSX_CLI, SCHEDULE_CLI, "--root", root, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    env: {
      ...process.env,
      MEDIA_GUARD_OVERRIDE_REASON: "",
      PUBLIC_SITE_BASE_URL: "https://example.invalid",
      PUBLIC_IMAGE_BASE_URL: "https://example.invalid",
      ...env
    }
  });
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

describe("REGENGUARD-R2 restore and heal", () => {
  it("F1 restore refuses a scheduled slot before changing calendar, mp4 or png bytes", async () => {
    const root = await tempRoot();
    const before = await seedRestore(root);
    const calendarPath = join(root, "data", "content-calendar", `${DATE}.json`);
    const calendarBefore = await readFile(calendarPath);

    await expect(restoreReelSlot({ date: DATE, slotNumber: SLOT, root })).rejects.toBeInstanceOf(SlotLockedError);
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.mp4"))).resolves.toEqual(before.video);
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).resolves.toEqual(before.cover);
    await expect(readFile(calendarPath)).resolves.toEqual(calendarBefore);
    await expect(readFile(join(root, "data", "media-mutation-log", `${DATE}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("F1 --restore passes the explicit override and audits the restore operation", async () => {
    const root = await tempRoot();
    const before = await seedRestore(root);
    const result = runSchedule(root, ["--restore", "--date", DATE, "--slot", String(SLOT),
      "--force-regen-scheduled", "--reason", "approved restore"], { USERNAME: " " });

    expect(result.status, result.stderr).toBe(0);
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).resolves.toEqual(before.restoredCover);
    expect((await loadDailyContent(DATE, root))?.slots.find((slot) => slot.slot === SLOT)?.media_type).toBe("image");
    const audit = JSON.parse(await readFile(join(root, "data", "media-mutation-log", `${DATE}.json`), "utf8"));
    expect(audit).toEqual([expect.objectContaining({ operation: "restore reel slot", reason: "approved restore", actor: "unknown" })]);
  });

  it("F2 heal with an override still stops on approved-log and preserves the formal reel", async () => {
    const root = await tempRoot();
    const before = await seedOutgoingReel(root);
    await writeJson(root, `data/approved-log/${DATE}.json`, [{
      date: DATE, slot: SLOT, platform: "facebook", status: "approved", approved_by: "test-owner"
    }]);

    const result = await healOneSlot({ date: DATE, slotNumber: SLOT, conceptId: CONCEPT_ID, variant: "10s", root, mediaGuardOverride: OVERRIDE });

    expect(result).toMatchObject({ action: "stopped", stopReason: "approved-log" });
    expect(result.invalidate?.skipped).toContainEqual({ slot: SLOT, reason: "approved-log" });
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.mp4"))).resolves.toEqual(before.video);
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).resolves.toEqual(before.cover);
  });

  it("F2 heal with an override still stops on protected-reel and preserves its cover and clip", async () => {
    const root = await tempRoot();
    const before = await seedOutgoingReel(root);

    const result = await healOneSlot({ date: DATE, slotNumber: SLOT, conceptId: CONCEPT_ID, variant: "10s", root, mediaGuardOverride: OVERRIDE });

    expect(result).toMatchObject({ action: "stopped", stopReason: "protected-reel" });
    expect(result.invalidate?.skipped).toContainEqual({ slot: SLOT, reason: "protected-reel" });
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.mp4"))).resolves.toEqual(before.video);
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.png"))).resolves.toEqual(before.cover);
  });

  it("F2 heal with an override quarantines all old carousel slides and audits both operations", async () => {
    const root = await tempRoot();
    const newVideo = await seedSourceReel(root);
    const carousel: DailySlot = {
      ...dailySlot(SLOT),
      topic: "舊輪播：靠墊",
      image_prompt: "Carousel slide 1: old cushions",
      media_type: "carousel",
      format: "carousel-guide",
      carousel_items: [1, 2, 3].map((slide) => ({
        slide,
        image_prompt: `Carousel slide ${slide}: old cushions`,
        local_image_path: `docs/assets/${DATE}/slot-02${slide === 1 ? "" : `-slide-0${slide}`}.png`,
        public_image_url: `https://example.invalid/slide-${slide}.png`
      }))
    };
    await writeCalendar(root, [dailySlot(1), carousel]);
    const slides = carousel.carousel_items ?? [];
    for (const slide of slides) {
      await writeBytes(root, slide.local_image_path, Buffer.concat([PNG_MAGIC, Buffer.from(`old slide ${slide.slide}`)]));
      await markImageSource({ root, date: DATE, slot: SLOT, source: "gpt-image-2", imagePath: slide.local_image_path });
    }
    const oldBytes = await Promise.all(slides.map((slide) => readFile(join(root, slide.local_image_path))));
    await addScheduledLock(root);

    const result = await healOneSlot({ date: DATE, slotNumber: SLOT, conceptId: CONCEPT_ID, variant: "10s", root, mediaGuardOverride: OVERRIDE });

    expect(result.action).toBe("healed");
    expect(result.invalidate?.moved).toHaveLength(3);
    for (const [index, slide] of slides.entries()) {
      const moved = result.invalidate?.moved.find((entry) => entry.from === slide.local_image_path);
      expect(moved?.to).toContain("_stale");
      await expect(readFile(moved!.to)).resolves.toEqual(oldBytes[index]);
    }
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02-slide-02.png"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02-slide-03.png"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.mp4"))).resolves.toEqual(newVideo);
    const audit = JSON.parse(await readFile(join(root, "data", "media-mutation-log", `${DATE}.json`), "utf8")) as Array<{ operation: string }>;
    expect(audit.map((entry) => entry.operation)).toEqual(["move stale slot image", "schedule reel"]);
  });

  it("F3 heal returns media-locked for slot 3 and continues repairing unlocked slot 2", async () => {
    const root = await tempRoot();
    const before = await seedTwoSlotHeal(root);
    const results = [];
    for (const slotNumber of [3, 2]) {
      results.push(await healOneSlot({
        date: DATE, slotNumber,
        conceptId: slotNumber === 3 ? CONCEPT_ID : EVENING_CONCEPT_ID,
        variant: slotNumber === 3 ? "15s" : "10s", root
      }));
    }

    expect(results[0]).toMatchObject({ action: "stopped", stopReason: "media-locked", invalidate: { moved: [], skipped: [], refused: [] } });
    expect(results[1]).toMatchObject({ action: "healed", slotNumber: 2 });
    const content = await loadDailyContent(DATE, root);
    expect(content?.slots.find((slot) => slot.slot === 2)).toMatchObject({ media_type: "reel", topic: conceptHook(EVENING_CONCEPT_ID) });
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-03.mp4"))).resolves.toEqual(before.lockedVideo);
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.mp4"))).resolves.toEqual(before.eveningVideo);
  });

  it("F3 --heal keeps exit 0 and repairs the next plan half after a media-locked stop", async () => {
    const root = await tempRoot();
    const before = await seedTwoSlotHeal(root);
    const result = runSchedule(root, ["--heal", "--date", DATE]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("slot 3 heal stopped (media-locked)");
    expect(result.stdout).toContain("healed slot 2");
    expect((await loadDailyContent(DATE, root))?.slots.find((slot) => slot.slot === 2)?.media_type).toBe("reel");
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-03.mp4"))).resolves.toEqual(before.lockedVideo);
    await expect(readFile(join(root, "docs", "assets", DATE, "slot-02.mp4"))).resolves.toEqual(before.eveningVideo);
  });
});

describe("REGENGUARD-R2 PowerShell root and missing videos", () => {
  it.each(["generate-missing-images.ps1", "regenerate-boutique-images.ps1"])(
    'F4 %s pins media-guard to --root "$root" and preserves the UTF-8 BOM', async (script) => {
      const bytes = await readFile(join(REPO_ROOT, "scripts", script));
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
      // Doubled quotes are the literal cmd /c quotes inside a PowerShell string.
      expect(bytes.toString("utf8").replaceAll('""', '"')).toContain('media-guard -- --root "$root"');
    }
  );

  it.each([false, true])("S4 missing video with force=%s refuses a locked slot before any fetch", async (force) => {
    const root = await tempRoot();
    await writeCalendar(root, [dailySlot(1), { ...outgoingReel(SLOT), video_prompt: "A short synthetic Reel." }]);
    await addScheduledLock(root);
    const target = join(root, "docs", "assets", DATE, "slot-02.mp4");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    const fetchImpl = vi.fn(async () => { throw new Error("synthetic fetch must not be reached"); }) as unknown as typeof fetch;

    await expect(generateGrokVideos({
      date: DATE, slot: SLOT, root, live: true, force,
      env: { XAI_VIDEO_BILLING_ACK: "true", XAI_API_KEY: "synthetic-test-key" }, fetchImpl
    })).rejects.toBeInstanceOf(SlotLockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("S5 existing video without force returns its source under a scheduled lock without mutation", async () => {
    const root = await tempRoot();
    const { video, record } = await seedExistingVideo(root);
    await writeCalendar(root, [dailySlot(1), { ...outgoingReel(SLOT), video_prompt: "A short synthetic Reel." }]);
    await addScheduledLock(root);
    const fetchImpl = vi.fn(async () => { throw new Error("synthetic fetch must not be reached"); }) as unknown as typeof fetch;

    await expect(generateGrokVideos({
      date: DATE, slot: SLOT, root, live: true, force: false,
      env: { XAI_VIDEO_BILLING_ACK: "true", XAI_API_KEY: "synthetic-test-key" }, fetchImpl
    })).resolves.toEqual([record]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readFile(join(root, record.video_path))).resolves.toEqual(video);
    await expect(readFile(join(root, "data", "media-mutation-log", `${DATE}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("S6 --force refuses a locked existing video before backup or network", async () => {
    const root = await tempRoot();
    const { video, record } = await seedExistingVideo(root);
    await writeCalendar(root, [dailySlot(1), { ...outgoingReel(SLOT), video_prompt: "A short synthetic Reel." }]);
    await addScheduledLock(root);
    const target = join(root, record.video_path);
    const fetchImpl = vi.fn(async () => { throw new Error("synthetic fetch must not be reached"); }) as unknown as typeof fetch;

    await expect(generateGrokVideos({
      date: DATE, slot: SLOT, root, live: true, force: true,
      env: { XAI_VIDEO_BILLING_ACK: "true", XAI_API_KEY: "synthetic-test-key" }, fetchImpl
    })).rejects.toBeInstanceOf(SlotLockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readFile(target)).resolves.toEqual(video);
    await expect(readdir(dirname(target))).resolves.toEqual(["slot-02.mp4"]);
  });
});

describe("REGENGUARD-R2 shared override parser and plan scope", () => {
  it.each([
    { label: "flag and trimmed reason/actor", args: ["--force-regen-scheduled", "--reason", " repair "], env: { USERNAME: " owner ", MEDIA_GUARD_OVERRIDE_REASON: "ignored" }, expected: { reason: "repair", actor: "owner" } },
    { label: "flag without reason ignores the environment reason", args: ["--force-regen-scheduled"], env: { MEDIA_GUARD_OVERRIDE_REASON: "ignored" }, expected: undefined },
    { label: "environment reason without flag", args: [], env: { MEDIA_GUARD_OVERRIDE_REASON: " repair ", USERNAME: "owner" }, expected: { reason: "repair", actor: "owner" } },
    { label: "neither flag nor environment reason", args: ["--reason", "ignored"], env: {}, expected: undefined },
    { label: "blank CLI reason ignores environment fallback", args: ["--force-regen-scheduled", "--reason", " "], env: { MEDIA_GUARD_OVERRIDE_REASON: "ignored" }, expected: undefined },
    { label: "blank environment reason", args: [], env: { MEDIA_GUARD_OVERRIDE_REASON: " " }, expected: undefined },
    { label: "empty USERNAME becomes unknown", args: ["--force-regen-scheduled", "--reason", "repair"], env: { USERNAME: "" }, expected: { reason: "repair", actor: "unknown" } },
    { label: "whitespace USERNAME becomes unknown", args: [], env: { MEDIA_GUARD_OVERRIDE_REASON: "repair", USERNAME: " " }, expected: { reason: "repair", actor: "unknown" } }
  ])("R6 parser: $label", ({ args, env, expected }) => {
    expect(parseMediaGuardOverride(args, env)).toEqual(expected);
  });

  it("R6 mediaGuardCli accepts a whitespace USERNAME as unknown", async () => {
    const root = await tempRoot();
    await addScheduledLock(root);
    const result = spawnSync(process.execPath, [TSX_CLI, GUARD_CLI, "--root", root, "--date", DATE,
      "--slot", String(SLOT), "--operation", "CLI empty actor test"], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000,
      env: { ...process.env, USERNAME: " ", MEDIA_GUARD_OVERRIDE_REASON: " approved repair ",
        PUBLIC_SITE_BASE_URL: "https://example.invalid", PUBLIC_IMAGE_BASE_URL: "https://example.invalid" }
    });

    expect(result.status, result.stderr).toBe(0);
    const audit = JSON.parse(await readFile(join(root, "data", "media-mutation-log", `${DATE}.json`), "utf8"));
    expect(audit).toEqual([expect.objectContaining({ actor: "unknown", reason: "approved repair" })]);
  });

  it.each([
    { route: "explicit flag", args: ["--force-regen-scheduled", "--reason", "single slot only"], env: {} },
    { route: "environment", args: [], env: { MEDIA_GUARD_OVERRIDE_REASON: "single slot only" } }
  ])("R6 --plan never forwards the $route override into its multi-date schedule", async ({ args, env }) => {
    const root = await tempRoot();
    const entry = REEL_SCHEDULE[0];
    if (!entry) throw new Error("REEL_SCHEDULE has no first entry for the plan fixture");
    await seedSourceReel(root, entry.conceptId);
    const slot = { ...dailySlot(SLOT), local_image_path: `docs/assets/${entry.date}/slot-02.png` };
    await writeCalendar(root, [slot], entry.date);
    const oldVideo = Buffer.from("scheduled plan video");
    const oldCover = Buffer.concat([PNG_MAGIC, Buffer.from("scheduled plan cover")]);
    await writeBytes(root, `docs/assets/${entry.date}/slot-02.mp4`, oldVideo);
    await writeBytes(root, slot.local_image_path, oldCover);
    await writeJson(root, `data/scheduled-log/${entry.date}.json`, [{
      date: entry.date, slot: SLOT, platform: "facebook", scheduled_post_id: "plan-locked", status: "scheduled"
    }]);

    const result = runSchedule(root, ["--plan", ...args], { USERNAME: "test-owner", ...env });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("media is locked");
    expect(result.stderr).toContain("scheduled-log: plan-locked");
    await expect(readFile(join(root, "docs", "assets", entry.date, "slot-02.mp4"))).resolves.toEqual(oldVideo);
    await expect(readFile(join(root, slot.local_image_path))).resolves.toEqual(oldCover);
    await expect(readFile(join(root, "data", "media-mutation-log", `${entry.date}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
