import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePublishableReel } from "../src/generateVideo";
import {
  findDuplicateAiredReelVideo,
  isLiveAiredReelEntry,
  loadDailyContent,
  loadPostLog,
  loadRecentAiredReelVideoShas,
  loadVideoRepairQueue,
  upsertVideoRepairQueue,
  writeApprovalLog,
  writeJsonAtomic,
  writePostLog,
  writeVideoSources
} from "../src/logging";
import { stampDailyContentWrite } from "../src/contentPlan";
import { CONCEPT_COOLDOWN_DAYS } from "../src/reelConcepts";
import { resolveSlotPublishMedia, postCurrentSlot } from "../src/postCurrentSlot";
import type { DailySlot, PostLogEntry } from "../src/types";
import { hashVideoPrompt } from "../src/videoRunFreshness";

vi.mock("../src/generateVideo", () => ({
  validatePublishableReel: vi.fn(async () => undefined)
}));

const DATE = "2026-08-18";
const AIRED = "2026-08-14";
const HIST_DATE = "2026-08-16";
const HIST_SLOT = 3;
const VIDEO_BYTES = "same-mp4-bytes-across-days";
const OTHER_VIDEO_BYTES = "a-different-mp4";

function shaOf(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function daysBefore(date: string, days: number): string {
  const past = new Date(`${date}T00:00:00Z`);
  past.setUTCDate(past.getUTCDate() - days);
  return past.toISOString().slice(0, 10);
}

function reelSlot(date: string, slot: number, caption: string): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: slot === 1 ? "知識文" : "情境文",
    topic: "白鞋泛黃",
    format: "reel",
    media_type: "reel",
    instagram_caption: caption,
    facebook_caption: caption,
    image_prompt: "cover",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${date}/slot-0${slot}.png`,
    public_image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${date}/slot-0${slot}.png`,
    local_video_path: `docs/assets/${date}/slot-0${slot}.mp4`,
    public_video_url: `https://tester.github.io/laundry-social-auto-poster/assets/${date}/slot-0${slot}.mp4`,
    video_prompt: `fixture Reel motion for ${date} slot ${slot}`,
    status: "pending"
  };
}

function liveReelEntry(
  date: string,
  slot: number,
  extras: Partial<PostLogEntry> & { video_sha256?: string } = {}
): PostLogEntry & { video_sha256?: string } {
  return {
    date,
    slot,
    platform: "instagram",
    status: "success",
    dry_run: false,
    attempts: 1,
    published_media_type: "reel",
    video_status: "published",
    created_at: `${date}T04:00:00.000Z`,
    ...extras
  };
}

async function seedCalendar(root: string, date: string, slots: DailySlot[]): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    `${JSON.stringify(
      stampDailyContentWrite(
        { date, timezone: "Asia/Taipei", generated_at: `${date}T00:00:00.000Z`, slots },
        { root }
      ),
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function seedAssets(root: string, date: string, slot: number, videoBytes: string): Promise<void> {
  const dir = join(root, "docs", "assets", date);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `slot-0${slot}.png`), `cover ${date} ${slot}`, "utf8");
  await writeFile(join(dir, `slot-0${slot}.mp4`), videoBytes, "utf8");
}

async function seedReviewSha(root: string, date: string, slot: number, sha: string): Promise<void> {
  await writeJsonAtomic(join(root, "data", "video-reviews", `${date}.json`), [
    { date, slot, video_sha256: sha }
  ]);
}

async function seedCanonicalRelease(root: string, date: string): Promise<void> {
  const content = await loadDailyContent(date, root, { today: date });
  if (!content || content.tampered) throw new Error(`canonical fixture calendar unavailable for ${date}`);
  const approvalDir = join(root, "data", "approved-log");
  const digests: Record<string, Record<string, string>> = {};
  for (const slot of content.slots) {
    const imageBytes = await readFile(join(root, ...slot.local_image_path.split("/")));
    digests[String(slot.slot)] = {
      [slot.local_image_path]: shaOf(imageBytes)
    };
  }

  await writeApprovalLog(
    date,
    content.slots.flatMap((slot) =>
      (["facebook", "instagram"] as const).map((platform) => ({
        date,
        slot: slot.slot,
        platform,
        status: "approved" as const,
        approved_by: "test",
        created_at: `${date}T00:00:00.000Z`
      }))
    ),
    root
  );
  await writeFile(
    join(approvalDir, `${date}.fingerprints.json`),
    `${JSON.stringify(
      Object.fromEntries(
        content.slots.map((slot) => [String(slot.slot), shaOf(JSON.stringify(slot))])
      )
    )}\n`,
    "utf8"
  );
  await writeFile(join(approvalDir, `${date}.image-digests.json`), `${JSON.stringify(digests)}\n`, "utf8");

  await writeVideoSources(
    date,
    content.slots.map((slot) => ({
      date,
      slot: slot.slot,
      source: "grok-imagine-video" as const,
      model: "fixture-grok-imagine-video",
      video_path: slot.local_video_path ?? "",
      request_id: `fixture-request-${slot.slot}`,
      duration_seconds: 10,
      width: 1080,
      height: 1920,
      frame_rate: 30,
      video_codec: "h264",
      marked_at: `${date}T00:00:00.000Z`
    })),
    root
  );
  await writeJsonAtomic(
    join(root, "data", "video-reviews", `${date}.json`),
    await Promise.all(
      content.slots.map(async (slot) => ({
        date,
        slot: slot.slot,
        video_path: slot.local_video_path ?? "",
        video_sha256: shaOf(await readFile(join(root, ...(slot.local_video_path ?? "").split("/")))),
        prompt_hash: hashVideoPrompt(slot.video_prompt ?? ""),
        review_round: 1,
        full_decode: "pass" as const,
        all_frame_physics_review: "pass" as const,
        grok_review: "pass" as const,
        sol_review: "pass" as const,
        separate_zh_tw_tts_review: "pass" as const,
        generated_clip_audio_used: false,
        status: "approved" as const,
        reviewed_at: `${date}T00:00:00.000Z`
      }))
    )
  );
}

describe("posted-log video sha inventory", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
    );
  });

  async function freshRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "dup-video-log-"));
    roots.push(root);
    return root;
  }

  it("treats a missing sha as an empty window, not a fabricated hash", async () => {
    const root = await freshRoot();
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2)], root);

    await expect(loadRecentAiredReelVideoShas(DATE, root, CONCEPT_COOLDOWN_DAYS)).resolves.toEqual([]);
  });

  it("lists only live aired reels that already carry video_sha256", async () => {
    const root = await freshRoot();
    const sha = shaOf(VIDEO_BYTES);
    await writePostLog(
      AIRED,
      [
        liveReelEntry(AIRED, 2, { video_sha256: sha }),
        liveReelEntry(AIRED, 2, { platform: "facebook", video_sha256: sha }),
        liveReelEntry(AIRED, 1, { published_media_type: "carousel", video_status: "VIDEO_DEFERRED", video_sha256: sha }),
        liveReelEntry(AIRED, 3, { dry_run: true, video_sha256: sha }),
        liveReelEntry(AIRED, 3, { slot: 3, status: "failed", video_sha256: sha })
      ],
      root
    );

    await expect(loadRecentAiredReelVideoShas(DATE, root, CONCEPT_COOLDOWN_DAYS)).resolves.toEqual([
      { date: AIRED, slot: 2, video_sha256: sha }
    ]);
  });

  it("uses CONCEPT_COOLDOWN_DAYS as the inclusive recent window", async () => {
    const root = await freshRoot();
    const sha = shaOf(VIDEO_BYTES);
    const inside = daysBefore(DATE, CONCEPT_COOLDOWN_DAYS - 1);
    const edge = daysBefore(DATE, CONCEPT_COOLDOWN_DAYS);
    await writePostLog(inside, [liveReelEntry(inside, 1, { video_sha256: sha })], root);
    await writePostLog(edge, [liveReelEntry(edge, 1, { video_sha256: shaOf("old") })], root);

    const aired = await loadRecentAiredReelVideoShas(DATE, root, CONCEPT_COOLDOWN_DAYS);
    expect(aired.map((item) => item.date)).toEqual([inside]);
    expect(findDuplicateAiredReelVideo(sha, aired, DATE, 1)).toEqual({
      date: inside,
      slot: 1,
      video_sha256: sha
    });
    expect(findDuplicateAiredReelVideo(shaOf("old"), aired, DATE, 1)).toBeUndefined();
  });

  it("does not treat a cover fallback or a dry run as an aired reel", () => {
    expect(
      isLiveAiredReelEntry(
        liveReelEntry(AIRED, 1, { published_media_type: "image", video_status: "VIDEO_DEFERRED", video_sha256: "abc" })
      )
    ).toBe(false);
    expect(isLiveAiredReelEntry(liveReelEntry(AIRED, 1, { dry_run: true, video_sha256: "abc" }))).toBe(false);
    expect(isLiveAiredReelEntry(liveReelEntry(AIRED, 1))).toBe(true);
  });

  it("fills a historical posted-log hole from video-reviews when that date+slot actually aired (8/16 form)", async () => {
    const root = await freshRoot();
    const sha = shaOf(VIDEO_BYTES);
    await writePostLog(HIST_DATE, [liveReelEntry(HIST_DATE, HIST_SLOT)], root);
    await seedReviewSha(root, HIST_DATE, HIST_SLOT, sha);

    const aired = await loadRecentAiredReelVideoShas(DATE, root, CONCEPT_COOLDOWN_DAYS);
    expect(aired).toEqual([{ date: HIST_DATE, slot: HIST_SLOT, video_sha256: sha }]);
    expect(findDuplicateAiredReelVideo(sha, aired, DATE, 1)).toEqual({
      date: HIST_DATE,
      slot: HIST_SLOT,
      video_sha256: sha
    });
  });

  it("does not list a reviewed file that never aired", async () => {
    const root = await freshRoot();
    const sha = shaOf(VIDEO_BYTES);
    await seedReviewSha(root, HIST_DATE, HIST_SLOT, sha);
    await writePostLog(
      HIST_DATE,
      [
        liveReelEntry(HIST_DATE, 1, {
          published_media_type: "carousel",
          video_status: "VIDEO_DEFERRED"
        })
      ],
      root
    );

    await expect(loadRecentAiredReelVideoShas(DATE, root, CONCEPT_COOLDOWN_DAYS)).resolves.toEqual([]);
  });

  it("covers same-day different slot and uncertain status from the review sha", async () => {
    const root = await freshRoot();
    const sameDaySha = shaOf(VIDEO_BYTES);
    const uncertainSha = shaOf(OTHER_VIDEO_BYTES);
    await writePostLog(DATE, [liveReelEntry(DATE, 3)], root);
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { status: "uncertain" })], root);
    await seedReviewSha(root, DATE, 3, sameDaySha);
    await seedReviewSha(root, AIRED, 2, uncertainSha);

    const aired = await loadRecentAiredReelVideoShas(DATE, root, CONCEPT_COOLDOWN_DAYS);
    expect(aired).toEqual([
      { date: DATE, slot: 3, video_sha256: sameDaySha },
      { date: AIRED, slot: 2, video_sha256: uncertainSha }
    ]);
    expect(findDuplicateAiredReelVideo(sameDaySha, aired, DATE, 1)).toEqual({
      date: DATE,
      slot: 3,
      video_sha256: sameDaySha
    });
    expect(findDuplicateAiredReelVideo(sameDaySha, aired, DATE, 3)).toBeUndefined();
    expect(findDuplicateAiredReelVideo(uncertainSha, aired, DATE, 1)).toEqual({
      date: AIRED,
      slot: 2,
      video_sha256: uncertainSha
    });
  });
});

describe("resolveSlotPublishMedia duplicate video gate", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
    );
  });

  async function prepare(videoBytes: string, caption: string): Promise<{ root: string; slot: DailySlot }> {
    const root = await mkdtemp(join(tmpdir(), "dup-video-resolve-"));
    roots.push(root);
    const slot = reelSlot(DATE, 1, caption);
    await seedAssets(root, DATE, 1, videoBytes);
    return { root, slot };
  }

  it("defers the same mp4 when only the caption changed", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "今天換過的文案,同一支片子不該再發。");
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { video_sha256: shaOf(VIDEO_BYTES) })], root);

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved.videoDeferred).toBe(true);
    expect(resolved.mediaType).toBe("image");
    expect(resolved.videoDeferKind).toBe("expected");
    expect(resolved.videoDeferredReason).toBe(`same video aired on ${AIRED} slot 2`);
    expect(resolved.videoSha256).toBeUndefined();
  });

  it("lets the same mp4 through when history has no sha field", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "歷史空窗,沒有 sha 就不能擋。");
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2)], root);

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved).toMatchObject({
      mediaType: "reel",
      videoDeferred: false,
      videoSha256: shaOf(VIDEO_BYTES)
    });
  });

  it("does not defer a new file just because the caption matches an old airing", async () => {
    const caption = "同一句文案,但片子是新的。";
    const { root, slot } = await prepare(OTHER_VIDEO_BYTES, caption);
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { video_sha256: shaOf(VIDEO_BYTES) })], root);

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved.videoDeferred).toBe(false);
    expect(resolved.mediaType).toBe("reel");
    expect(resolved.videoSha256).toBe(shaOf(OTHER_VIDEO_BYTES));
  });

  it("still defers a match CONCEPT_COOLDOWN_DAYS - 1 days ago and allows one at the cooldown edge", async () => {
    const caption = "窗邊界只跟影片 sha 有關。";
    const insideDate = daysBefore(DATE, CONCEPT_COOLDOWN_DAYS - 1);
    const edgeDate = daysBefore(DATE, CONCEPT_COOLDOWN_DAYS);

    const inside = await prepare(VIDEO_BYTES, caption);
    await writePostLog(insideDate, [liveReelEntry(insideDate, 1, { video_sha256: shaOf(VIDEO_BYTES) })], inside.root);
    const blocked = await resolveSlotPublishMedia(inside.slot, DATE, inside.root);
    expect(blocked.videoDeferred).toBe(true);
    expect(blocked.videoDeferredReason).toBe(`same video aired on ${insideDate} slot 1`);

    const edge = await prepare(VIDEO_BYTES, caption);
    await writePostLog(edgeDate, [liveReelEntry(edgeDate, 1, { video_sha256: shaOf(VIDEO_BYTES) })], edge.root);
    const allowed = await resolveSlotPublishMedia(edge.slot, DATE, edge.root);
    expect(allowed.videoDeferred).toBe(false);
    expect(allowed.mediaType).toBe("reel");
  });

  it("does not defer a retry of the same date and slot", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "同槽補發第二平台,不能把自己擋下來。");
    await writePostLog(DATE, [liveReelEntry(DATE, 1, { platform: "facebook", video_sha256: shaOf(VIDEO_BYTES) })], root);

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved.videoDeferred).toBe(false);
    expect(resolved.mediaType).toBe("reel");
  });

  it("defers when another slot on the same day already aired the file", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "中午發過的片子晚上不能再發。");
    await writePostLog(DATE, [liveReelEntry(DATE, 3, { video_sha256: shaOf(VIDEO_BYTES) })], root);

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved.videoDeferred).toBe(true);
    expect(resolved.videoDeferredReason).toBe(`same video aired on ${DATE} slot 3`);
  });

  it("defers the 8/16 form: live posted-log without sha, review file supplies it", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "8/16 已播,sha 只在 video-reviews。");
    await writePostLog(HIST_DATE, [liveReelEntry(HIST_DATE, HIST_SLOT)], root);
    await seedReviewSha(root, HIST_DATE, HIST_SLOT, shaOf(VIDEO_BYTES));

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved.videoDeferred).toBe(true);
    expect(resolved.videoDeferKind).toBe("expected");
    expect(resolved.videoDeferredReason).toBe(`same video aired on ${HIST_DATE} slot ${HIST_SLOT}`);
  });

  it("does not defer a file that was reviewed but never aired", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "有審核沒發出,不能誤擋。");
    await seedReviewSha(root, HIST_DATE, HIST_SLOT, shaOf(VIDEO_BYTES));
    await writePostLog(
      HIST_DATE,
      [
        liveReelEntry(HIST_DATE, 1, {
          published_media_type: "carousel",
          video_status: "VIDEO_DEFERRED"
        })
      ],
      root
    );

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved).toMatchObject({
      mediaType: "reel",
      videoDeferred: false,
      videoSha256: shaOf(VIDEO_BYTES)
    });
  });

  it("defers a same-day different slot and an uncertain airing filled from reviews", async () => {
    const sameDay = await prepare(VIDEO_BYTES, "同日不同槽,sha 在 reviews。");
    await writePostLog(DATE, [liveReelEntry(DATE, 3)], sameDay.root);
    await seedReviewSha(sameDay.root, DATE, 3, shaOf(VIDEO_BYTES));
    const blockedSameDay = await resolveSlotPublishMedia(sameDay.slot, DATE, sameDay.root);
    expect(blockedSameDay.videoDeferred).toBe(true);
    expect(blockedSameDay.videoDeferredReason).toBe(`same video aired on ${DATE} slot 3`);

    const uncertain = await prepare(VIDEO_BYTES, "uncertain 也算已播。");
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { status: "uncertain" })], uncertain.root);
    await seedReviewSha(uncertain.root, AIRED, 2, shaOf(VIDEO_BYTES));
    const blockedUncertain = await resolveSlotPublishMedia(uncertain.slot, DATE, uncertain.root);
    expect(blockedUncertain.videoDeferred).toBe(true);
    expect(blockedUncertain.videoDeferredReason).toBe(`same video aired on ${AIRED} slot 2`);
  });
});

describe("postCurrentSlot never stops the slot on a duplicate video", () => {
  const roots: string[] = [];

  beforeEach(() => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("DRY_RUN", "true");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
    );
  });

  async function seedPublishableDay(
    videoBytes: string,
    caption: string
  ): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "dup-video-post-"));
    roots.push(root);
    const slots = [reelSlot(DATE, 1, caption), reelSlot(DATE, 2, "填充檔位,與閘無關。")];
    await seedCalendar(root, DATE, slots);
    await seedAssets(root, DATE, 1, videoBytes);
    await seedAssets(root, DATE, 2, "filler-video");
    await seedCanonicalRelease(root, DATE);
    return root;
  }

  it("publishes the cover and records VIDEO_DEFERRED instead of throwing", async () => {
    const root = await seedPublishableDay(VIDEO_BYTES, "跨日同片,文案已經改寫過了。");
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { video_sha256: shaOf(VIDEO_BYTES) })], root);

    const results = await postCurrentSlot({
      root,
      date: DATE,
      slot: 1,
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.status === "success")).toBe(true);
    expect(results.every((entry) => entry.published_media_type === "image")).toBe(true);
    expect(results.every((entry) => entry.video_status === "VIDEO_DEFERRED")).toBe(true);
    expect(results.every((entry) => entry.video_defer_kind === "expected")).toBe(true);
    expect(results.every((entry) => entry.video_deferred_reason === `same video aired on ${AIRED} slot 2`)).toBe(
      true
    );
    expect(results.every((entry) => (entry as { video_sha256?: string }).video_sha256 === undefined)).toBe(true);

    const repairs = await loadVideoRepairQueue(root);
    expect(repairs).toEqual([
      expect.objectContaining({
        source_date: DATE,
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        original_media_type: "reel",
        fallback_media_type: "image",
        defer_kind: "expected",
        failure_reason: `same video aired on ${AIRED} slot 2`
      })
    ]);
  });

  it("publishes the cover when dual video review is missing", async () => {
    vi.mocked(validatePublishableReel).mockRejectedValueOnce(
      new Error("Dual video review is missing for slot 1.")
    );
    const root = await seedPublishableDay(OTHER_VIDEO_BYTES, "review 缺席,封面仍要發出。");

    const results = await postCurrentSlot({
      root,
      date: DATE,
      slot: 1,
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.status === "success")).toBe(true);
    expect(results.every((entry) => entry.published_media_type === "image")).toBe(true);
    expect(results.every((entry) => entry.video_status === "VIDEO_DEFERRED")).toBe(true);
    expect(results.every((entry) => entry.video_defer_kind === "expected")).toBe(true);
    expect(
      results.every((entry) => entry.video_deferred_reason === "Dual video review is missing for slot 1.")
    ).toBe(true);

    const log = await loadPostLog(DATE, root);
    const persisted = log.filter((entry) => entry.slot === 1);
    expect(persisted).toHaveLength(2);
    expect(persisted.every((entry) => entry.published_media_type === "image")).toBe(true);
    expect(persisted.every((entry) => entry.video_status === "VIDEO_DEFERRED")).toBe(true);
  });

  it("publishes the cover when the 8/16 historical review sha matches", async () => {
    const root = await seedPublishableDay(VIDEO_BYTES, "8/16 已播,封面取代重播。");
    await writePostLog(HIST_DATE, [liveReelEntry(HIST_DATE, HIST_SLOT)], root);
    await seedReviewSha(root, HIST_DATE, HIST_SLOT, shaOf(VIDEO_BYTES));

    const results = await postCurrentSlot({
      root,
      date: DATE,
      slot: 1,
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.every((entry) => entry.status === "success")).toBe(true);
    expect(results.every((entry) => entry.published_media_type === "image")).toBe(true);
    expect(results.every((entry) => entry.video_status === "VIDEO_DEFERRED")).toBe(true);
    expect(
      results.every((entry) => entry.video_deferred_reason === `same video aired on ${HIST_DATE} slot ${HIST_SLOT}`)
    ).toBe(true);
  });

  it("writes video_sha256 when a new reel actually publishes", async () => {
    const root = await seedPublishableDay(OTHER_VIDEO_BYTES, "新片子,應該留下 sha。");

    const results = await postCurrentSlot({
      root,
      date: DATE,
      slot: 1,
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(results.every((entry) => entry.video_status === "published")).toBe(true);
    expect(results.every((entry) => entry.published_media_type === "reel")).toBe(true);
    expect(results.every((entry) => (entry as { video_sha256?: string }).video_sha256 === shaOf(OTHER_VIDEO_BYTES))).toBe(
      true
    );

    const log = await loadPostLog(DATE, root);
    const persisted = log.filter((entry) => entry.slot === 1);
    expect(persisted).toHaveLength(2);
    expect(persisted.every((entry) => (entry as { video_sha256?: string }).video_sha256 === shaOf(OTHER_VIDEO_BYTES))).toBe(
      true
    );
  });

  it("resolves a queued defer automatically only after the exact dual-platform Reel proof is persisted", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const caption = "同槽補片的雙平台遠端證據要完整才可解除 deferred。";
    const root = await seedPublishableDay(OTHER_VIDEO_BYTES, caption);
    await upsertVideoRepairQueue(
      {
        source_date: DATE,
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        original_media_type: "reel",
        fallback_media_type: "image",
        defer_kind: "expected",
        failure_reason: "waiting for exact dual-platform replacement proof",
        detected_at: "2026-08-18T02:00:00.000Z",
        next_attempt: "next-production-cycle",
        replacement_candidate_date: DATE,
        replacement_candidate_slot: 1
      },
      root
    );
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      switch (call) {
        case 1:
          return json({ video_id: "fb-repair-1", upload_url: "https://rupload.test/fb-repair-1" });
        case 2:
        case 3:
          return json({ success: true });
        case 4:
          return json({
            id: "fb-repair-1",
            status: { video_status: "ready" },
            permalink_url: "https://www.facebook.com/reel/fb-repair-1",
            description: caption
          });
        case 5:
          return json({ id: "ig-container-repair-1" });
        case 6:
          return json({ id: "ig-container-repair-1", status_code: "FINISHED" });
        case 7:
          return json({ id: "ig-repair-1" });
        case 8:
          return json({
            id: "ig-repair-1",
            media_type: "VIDEO",
            media_product_type: "REELS",
            permalink: "https://www.instagram.com/reel/ig-repair-1/",
            caption
          });
        default:
          throw new Error(`unexpected Meta fetch ${call}`);
      }
    }) as unknown as typeof fetch;

    const results = await postCurrentSlot({
      root,
      date: DATE,
      slot: 1,
      now: `${DATE}T11:30:00+08:00`,
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.published_media_type === "reel")).toBe(true);
    expect(results.every((entry) => entry.video_status === "published")).toBe(true);
    expect(results.every((entry) => entry.remote_reel_evidence?.caption_exact_match === true)).toBe(true);
    expect(await loadVideoRepairQueue(root)).toEqual([
      expect.objectContaining({
        source_date: DATE,
        source_slot: 1,
        status: "RESOLVED",
        replacement_date: DATE,
        replacement_slot: 1
      })
    ]);
  });

  it("does not auto-resolve a queued defer from an already-recorded image fallback", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await seedPublishableDay(OTHER_VIDEO_BYTES, "封面成功不能當作 Reel 修復完成。");
    await writePostLog(
      DATE,
      [
        liveReelEntry(DATE, 1, {
          platform: "facebook",
          post_id: "fb-image-fallback-1",
          published_media_type: "image",
          video_status: "VIDEO_DEFERRED"
        }),
        liveReelEntry(DATE, 1, {
          platform: "instagram",
          post_id: "ig-image-fallback-1",
          published_media_type: "image",
          video_status: "VIDEO_DEFERRED"
        })
      ],
      root
    );
    await upsertVideoRepairQueue(
      {
        source_date: DATE,
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        original_media_type: "reel",
        fallback_media_type: "image",
        defer_kind: "expected",
        failure_reason: "waiting for exact dual-platform replacement proof",
        detected_at: "2026-08-18T02:00:00.000Z",
        next_attempt: "next-production-cycle",
        replacement_candidate_date: DATE,
        replacement_candidate_slot: 1
      },
      root
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      postCurrentSlot({
        root,
        date: DATE,
        slot: 1,
        now: `${DATE}T11:30:00+08:00`,
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).resolves.toMatchObject([
      { platform: "facebook", status: "skipped" },
      { platform: "instagram", status: "skipped" }
    ]);

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(loadVideoRepairQueue(root)).resolves.toEqual([
      expect.objectContaining({ status: "VIDEO_DEFERRED" })
    ]);
  });

  it("keeps an invalid queued source date deferred without turning an already-posted Reel into a scheduler failure", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const root = await seedPublishableDay(OTHER_VIDEO_BYTES, "壞日期 queue 只能資料缺口，不能讓已發 Reel 失敗。");
    const videoSha256 = shaOf(OTHER_VIDEO_BYTES);
    await writePostLog(
      DATE,
      [
        liveReelEntry(DATE, 1, {
          platform: "facebook",
          video_sha256: videoSha256,
          post_id: "fb-invalid-source-date-1",
          remote_reel_evidence: {
            remote_id: "fb-invalid-source-date-1",
            permalink: "https://www.facebook.com/reel/fb-invalid-source-date-1",
            verified_at: "2026-08-18T04:00:00.000Z",
            remote_media_type: "REELS",
            caption_exact_match: true
          }
        }),
        liveReelEntry(DATE, 1, {
          platform: "instagram",
          video_sha256: videoSha256,
          post_id: "ig-invalid-source-date-1",
          remote_reel_evidence: {
            remote_id: "ig-invalid-source-date-1",
            permalink: "https://www.instagram.com/reel/ig-invalid-source-date-1/",
            verified_at: "2026-08-18T04:00:00.000Z",
            remote_media_type: "REELS",
            caption_exact_match: true
          }
        })
      ],
      root
    );
    await upsertVideoRepairQueue(
      {
        source_date: "2026-99-01",
        source_slot: 1,
        status: "VIDEO_DEFERRED",
        original_media_type: "reel",
        fallback_media_type: "image",
        defer_kind: "expected",
        failure_reason: "invalid source date must remain a data gap",
        detected_at: "2026-08-18T02:00:00.000Z",
        next_attempt: "next-production-cycle",
        replacement_candidate_date: DATE,
        replacement_candidate_slot: 1
      },
      root
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      postCurrentSlot({
        root,
        date: DATE,
        slot: 1,
        now: `${DATE}T11:30:00+08:00`,
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).resolves.toMatchObject([
      { platform: "facebook", status: "skipped" },
      { platform: "instagram", status: "skipped" }
    ]);

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(loadVideoRepairQueue(root)).resolves.toEqual([
      expect.objectContaining({ source_date: "2026-99-01", status: "VIDEO_DEFERRED" })
    ]);
  });

  it("never re-POSTs either verified Reel when both remote commits succeed but the local post ledger fails", async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");

    const caption = "兩平台遠端都驗證成功,本機帳本故障時絕不能重送。";
    const root = await seedPublishableDay(OTHER_VIDEO_BYTES, caption);
    const ledgerPath = join(root, "data", "posted-log", `${DATE}.json`);
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 4) {
        // Facebook's finish and read-back already completed. Turn the ledger
        // target into a directory only now, so both platform requests are real
        // mocked remote successes while every appendPostLog attempt fails.
        await mkdir(ledgerPath, { recursive: true });
      }
      switch (call) {
        case 1:
          return json({ video_id: "fb-reel-1", upload_url: "https://rupload.test/fb-reel-1" });
        case 2:
          return json({ success: true });
        case 3:
          return json({ success: true });
        case 4:
          return json({
            id: "fb-reel-1",
            status: { video_status: "ready" },
            permalink_url: "https://www.facebook.com/reel/fb-reel-1",
            description: caption
          });
        case 5:
          return json({ id: "ig-container-1" });
        case 6:
          return json({ id: "ig-container-1", status_code: "FINISHED" });
        case 7:
          return json({ id: "ig-reel-1" });
        case 8:
          return json({
            id: "ig-reel-1",
            media_type: "VIDEO",
            media_product_type: "REELS",
            permalink: "https://www.instagram.com/reel/ig-reel-1/",
            caption
          });
        default:
          throw new Error(`unexpected Meta fetch ${call}`);
      }
    }) as unknown as typeof fetch;
    const options = {
      root,
      date: DATE,
      slot: 1,
      now: `${DATE}T11:30:00+08:00`,
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    };

    await expect(postCurrentSlot(options)).rejects.toThrow(/local posted-log commit failed/);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    const postCalls = () =>
      vi.mocked(fetchImpl).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST").length;
    expect(postCalls()).toBe(5);

    const claimDir = join(root, "data", "meta-publish-claims");
    const facebookClaim = JSON.parse(
      await readFile(join(claimDir, `${DATE}-slot1-facebook.json`), "utf8")
    ) as { claim_id: string; platform: string; source: { media_type: string; image_sha256: string[]; video_sha256?: string } };
    const instagramClaim = JSON.parse(
      await readFile(join(claimDir, `${DATE}-slot1-instagram.json`), "utf8")
    ) as { claim_id: string; platform: string; source: { media_type: string; image_sha256: string[]; video_sha256?: string } };
    const facebookReceipt = JSON.parse(
      await readFile(join(claimDir, `${DATE}-slot1-facebook.json.receipt.json`), "utf8")
    ) as { claim_id: string; state: string; remote_entry?: PostLogEntry };
    const instagramReceipt = JSON.parse(
      await readFile(join(claimDir, `${DATE}-slot1-instagram.json.receipt.json`), "utf8")
    ) as { claim_id: string; state: string; remote_entry?: PostLogEntry };
    expect(facebookClaim).toMatchObject({
      platform: "facebook",
      source: {
        media_type: "reel",
        image_sha256: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        video_sha256: shaOf(OTHER_VIDEO_BYTES)
      }
    });
    expect(instagramClaim).toMatchObject({
      platform: "instagram",
      source: {
        media_type: "reel",
        image_sha256: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        video_sha256: shaOf(OTHER_VIDEO_BYTES)
      }
    });
    expect(facebookReceipt).toMatchObject({
      claim_id: facebookClaim.claim_id,
      state: "remote_accepted",
      remote_entry: expect.objectContaining({
        post_id: "fb-reel-1",
        remote_reel_evidence: expect.objectContaining({ caption_exact_match: true })
      })
    });
    expect(instagramReceipt).toMatchObject({
      claim_id: instagramClaim.claim_id,
      state: "remote_accepted",
      remote_entry: expect.objectContaining({
        post_id: "ig-reel-1",
        remote_reel_evidence: expect.objectContaining({ caption_exact_match: true })
      })
    });

    // The broken ledger itself is enough to stop the next invocation before any
    // Meta call; the immutable per-platform claims remain on disk as evidence.
    await expect(postCurrentSlot(options)).rejects.toThrow(/posted-log.*uncertain/);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(postCalls()).toBe(5);

    // Restore only an empty ledger fixture, never invent a posted-log row. The
    // immutable per-platform claims and their receipts still block every POST.
    await rm(ledgerPath, { recursive: true, force: true });
    await writeFile(ledgerPath, "[]\n", "utf8");
    await expect(postCurrentSlot(options)).rejects.toThrow(/automatic retry is blocked pending recovery/);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(postCalls()).toBe(5);
  });
});

describe("duplicate video gate wiring", () => {
  it("imports CONCEPT_COOLDOWN_DAYS and does not keep a second window number", async () => {
    const src = await readFile(new URL("../src/postCurrentSlot.ts", import.meta.url), "utf8");
    expect(src).toMatch(/import\s*\{[^}]*CONCEPT_COOLDOWN_DAYS[^}]*\}\s*from\s*["']\.\/reelConcepts["']/);
    expect(src).toContain("loadRecentAiredReelVideoShas(date, root, CONCEPT_COOLDOWN_DAYS)");
    expect(src).toContain("same video aired on ${duplicate.date} slot ${duplicate.slot}");
    expect(src).not.toMatch(/loadRecentAiredReelVideoShas\([^)]*,\s*21\s*\)/);
  });
});
