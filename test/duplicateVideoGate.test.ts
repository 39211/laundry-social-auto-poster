import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePublishableReel } from "../src/generateVideo";
import {
  findDuplicateAiredReelVideo,
  isLiveAiredReelEntry,
  loadPostLog,
  loadRecentAiredReelVideoShas,
  loadVideoRepairQueue,
  writeApprovalLog,
  writeJsonAtomic,
  writePostLog
} from "../src/logging";
import { stampDailyContentWrite } from "../src/contentPlan";
import { CONCEPT_COOLDOWN_DAYS } from "../src/reelConcepts";
import { resolveSlotPublishMedia, postCurrentSlot } from "../src/postCurrentSlot";
import type { DailySlot, PostLogEntry } from "../src/types";

vi.mock("../src/generateVideo", () => ({
  validatePublishableReel: vi.fn(async () => undefined)
}));

const DATE = "2026-08-18";
const AIRED = "2026-08-14";
const HIST_DATE = "2026-08-16";
const HIST_SLOT = 3;
const VIDEO_BYTES = "same-mp4-bytes-across-days";
const OTHER_VIDEO_BYTES = "a-different-mp4";

function shaOf(bytes: string): string {
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

async function seedApprovals(root: string, date: string, slot: number): Promise<void> {
  await writeApprovalLog(
    date,
    [
      { date, slot, platform: "facebook", status: "approved", approved_by: "test", created_at: `${date}T00:00:00.000Z` },
      { date, slot, platform: "instagram", status: "approved", approved_by: "test", created_at: `${date}T00:00:00.000Z` }
    ],
    root
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

  it("refuses image fallback when the same mp4 already aired", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "今天換過的文案,同一支片子不該再發。");
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { video_sha256: shaOf(VIDEO_BYTES) })], root);

    await expect(resolveSlotPublishMedia(slot, DATE, root)).rejects.toThrow(
      /Refusing image fallback for reel slot 1: same video aired on 2026-08-14 slot 2/
    );
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
    await expect(resolveSlotPublishMedia(inside.slot, DATE, inside.root)).rejects.toThrow(
      new RegExp(`Refusing image fallback for reel slot 1: same video aired on ${insideDate} slot 1`)
    );

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

    await expect(resolveSlotPublishMedia(slot, DATE, root)).rejects.toThrow(
      /Refusing image fallback for reel slot 1: same video aired on 2026-08-18 slot 3/
    );
  });

  it("defers the 8/16 form: live posted-log without sha, review file supplies it", async () => {
    const { root, slot } = await prepare(VIDEO_BYTES, "8/16 已播,sha 只在 video-reviews。");
    await writePostLog(HIST_DATE, [liveReelEntry(HIST_DATE, HIST_SLOT)], root);
    await seedReviewSha(root, HIST_DATE, HIST_SLOT, shaOf(VIDEO_BYTES));

    await expect(resolveSlotPublishMedia(slot, DATE, root)).rejects.toThrow(
      /Refusing image fallback for reel slot 1: same video aired on 2026-08-16 slot 3/
    );
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
    await expect(resolveSlotPublishMedia(sameDay.slot, DATE, sameDay.root)).rejects.toThrow(
      /Refusing image fallback for reel slot 1: same video aired on 2026-08-18 slot 3/
    );

    const uncertain = await prepare(VIDEO_BYTES, "uncertain 也算已播。");
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { status: "uncertain" })], uncertain.root);
    await seedReviewSha(uncertain.root, AIRED, 2, shaOf(VIDEO_BYTES));
    await expect(resolveSlotPublishMedia(uncertain.slot, DATE, uncertain.root)).rejects.toThrow(
      /Refusing image fallback for reel slot 1: same video aired on 2026-08-14 slot 2/
    );
  });
});

describe("postCurrentSlot refuses image fallback for a reel gate fail", () => {
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
    await seedApprovals(root, DATE, 1);
    return root;
  }

  it("throws and writes no posted-log when the same mp4 already aired", async () => {
    const root = await seedPublishableDay(VIDEO_BYTES, "跨日同片,文案已經改寫過了。");
    await writePostLog(AIRED, [liveReelEntry(AIRED, 2, { video_sha256: shaOf(VIDEO_BYTES) })], root);

    await expect(
      postCurrentSlot({
        root,
        date: DATE,
        slot: 1,
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow(/Refusing image fallback for reel slot 1: same video aired on 2026-08-14 slot 2/);

    expect(await loadPostLog(DATE, root)).toEqual([]);
    expect(await loadVideoRepairQueue(root)).toEqual([]);
  });

  it("throws and writes no posted-log when dual video review is missing", async () => {
    vi.mocked(validatePublishableReel).mockRejectedValueOnce(
      new Error("Dual video review is missing for slot 1.")
    );
    const root = await seedPublishableDay(OTHER_VIDEO_BYTES, "review 缺席,封面仍要發出。");

    await expect(
      postCurrentSlot({
        root,
        date: DATE,
        slot: 1,
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow(/Refusing image fallback for reel slot 1: Dual video review is missing for slot 1/);

    expect(await loadPostLog(DATE, root)).toEqual([]);
  });

  it("throws and writes no posted-log when the 8/16 historical review sha matches", async () => {
    const root = await seedPublishableDay(VIDEO_BYTES, "8/16 已播,封面取代重播。");
    await writePostLog(HIST_DATE, [liveReelEntry(HIST_DATE, HIST_SLOT)], root);
    await seedReviewSha(root, HIST_DATE, HIST_SLOT, shaOf(VIDEO_BYTES));

    await expect(
      postCurrentSlot({
        root,
        date: DATE,
        slot: 1,
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow(/Refusing image fallback for reel slot 1: same video aired on 2026-08-16 slot 3/);

    expect(await loadPostLog(DATE, root)).toEqual([]);
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
