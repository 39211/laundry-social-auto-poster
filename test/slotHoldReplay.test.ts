import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { stampDailyContentWrite } from "../src/contentPlan";
import { generatePublicSite } from "../src/generatePublicSite";
import { markImageSource } from "../src/markImageSource";
import { loadApprovalLog, writeJsonAtomic } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { shareLivePostsToStories } from "../src/postStory";
import { scheduleYouTubeShort, uploadShort } from "../src/postYouTube";
import { getConfig } from "../src/config";
import { runSlotHoldCli } from "../src/slotHoldCli";
import { scheduleAheadFacebook } from "../src/scheduleAhead";
import { recordVideoReview } from "../src/videoReviewGate";
import { hashVideoPrompt } from "../src/videoRunFreshness";
import { enableSlotHolds, sampleHold } from "./helpers/slotHoldsFixture";
import type { AppConfig } from "../src/types";

const DATE = "2026-10-01";
const VIDEO_PROMPT = "one action only, heel tip scuff close-up";
const REEL_SRC = join(process.cwd(), "output", "reels-run", "2026-07-29", "reels", "backpack-base-15s.mp4");
const png = (): Buffer =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

let root: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

function promptFor(path: string): string {
  return `photorealistic laundry shop photo for ${path}`;
}

function liveConfig(): AppConfig {
  return getConfig({
    ...process.env,
    DRY_RUN: "false",
    PUBLIC_IMAGE_BASE_URL: "https://sixiangjialaundry.com",
    META_ACCESS_TOKEN: "test-token-value",
    FB_PAGE_ID: "111000111",
    IG_USER_ID: "222000222",
    VERIFY_PUBLIC_IMAGE_URL: "false",
    YT_CLIENT_ID: "test-yt-client",
    YT_CLIENT_SECRET: "test-yt-secret",
    YT_REFRESH_TOKEN: "test-yt-refresh"
  });
}

function replayFetch(calls: Array<{ url: string; method: string }>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    const body = init?.body instanceof URLSearchParams ? init.body : undefined;
    const json = (payload: unknown, contentType = "application/json") =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": contentType } });
    if (url.includes("sixiangjialaundry.com") || url.includes("/assets/")) {
      return new Response("ok", { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "yt-test-token" });
    if (url.includes("googleapis.com/upload/youtube")) return json({ id: `yt-${calls.length}` });
    if (url.includes("/video_reels") && body?.get("upload_phase") === "start") {
      return json({ video_id: "vid-1", upload_url: "https://upload.test/vid-1" });
    }
    if (url.startsWith("https://upload.test/")) return json({ success: true });
    if (url.includes("/video_reels") && body?.get("upload_phase") === "finish") return json({ success: true });
    if (url.includes("status_code")) return json({ status_code: "FINISHED" });
    if (url.includes("fields=status")) return json({ status: { video_status: "ready" } });
    if (url.includes("/media_publish")) return json({ id: "ig-post-1" });
    if (url.includes("/media")) return json({ id: "ig-container-1" });
    return json({ id: "fb-obj-1", post_id: "fb-post-1" });
  }) as typeof fetch;
}

async function seedReplayDay(target: string, holdSlot: 1 | 2 | 3 | null): Promise<void> {
  const slots = [
    {
      slot: 1,
      time: "11:30",
      category: "知識文",
      topic: "白鞋鞋邊泛灰前的檢查",
      format: "image-post",
      media_type: "image",
      instagram_caption: "slot1 參考價 $250 LINE 傳照片 收送到府 0968327653",
      facebook_caption: "slot1",
      image_prompt: promptFor(`docs/assets/${DATE}/slot-01.png`),
      visual_route: "macro-detail",
      traffic_route: "object-proof",
      local_image_path: `docs/assets/${DATE}/slot-01.png`,
      public_image_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-01.png`,
      status: "pending"
    },
    {
      slot: 2,
      time: "20:30",
      category: "情境文",
      topic: "精品包邊角磨損的三個階段",
      format: "image-post",
      media_type: "image",
      instagram_caption: "slot2 參考價 $250 LINE 傳照片 收送到府 0968327653",
      facebook_caption: "slot2",
      image_prompt: promptFor(`docs/assets/${DATE}/slot-02.png`),
      visual_route: "macro-detail",
      traffic_route: "object-proof",
      local_image_path: `docs/assets/${DATE}/slot-02.png`,
      public_image_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-02.png`,
      status: "pending"
    },
    {
      slot: 3,
      time: "12:00",
      category: "情境文",
      topic: "背包肩帶壓痕怎麼看",
      format: "reel",
      media_type: "reel",
      instagram_caption: "slot3 參考價 $250 LINE 傳照片 收送到府 0968327653",
      facebook_caption: "slot3",
      image_prompt: promptFor(`docs/assets/${DATE}/slot-03.png`),
      video_prompt: VIDEO_PROMPT,
      visual_route: "shop-inspection",
      traffic_route: "object-proof",
      local_image_path: `docs/assets/${DATE}/slot-03.png`,
      public_image_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-03.png`,
      local_video_path: `docs/assets/${DATE}/slot-03.mp4`,
      public_video_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-03.mp4`,
      status: "pending"
    }
  ];
  await mkdir(join(target, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(target, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify(
      stampDailyContentWrite(
        { date: DATE, timezone: "Asia/Taipei", generated_at: new Date().toISOString(), slots } as Parameters<
          typeof stampDailyContentWrite
        >[0],
        { root: target }
      ),
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(target, "data", "publishing-policy.json"),
    JSON.stringify({
      status: "active",
      start_date: "2026-08-01",
      end_date: "2026-12-31",
      platforms: ["facebook", "instagram"],
      slots: [{ slot: 1 }, { slot: 2 }, { slot: 3 }],
      same_day_catch_up: true
    }),
    "utf8"
  );
  await mkdir(join(target, "data", "image-prompts"), { recursive: true });
  await writeFile(
    join(target, "data", "image-prompts", `${DATE}.json`),
    JSON.stringify(
      slots.map((slot) => ({
        slot: slot.slot,
        target_path: slot.local_image_path,
        topic: slot.topic,
        prompt: promptFor(slot.local_image_path)
      }))
    ),
    "utf8"
  );
  await mkdir(join(target, "docs", "assets", DATE), { recursive: true });
  for (const slot of slots) {
    await writeFile(join(target, ...slot.local_image_path.split("/")), png());
    await markImageSource({
      root: target,
      date: DATE,
      slot: slot.slot,
      source: "gpt-image-2",
      imagePath: slot.local_image_path
    });
  }
  await copyFile(REEL_SRC, join(target, "docs", "assets", DATE, "slot-03.mp4"));
  await mkdir(join(target, "data", "video-sources"), { recursive: true });
  await writeJsonAtomic(join(target, "data", "video-sources", `${DATE}.json`), [
    {
      date: DATE,
      slot: 3,
      source: "grok-imagine-video",
      model: "grok-imagine",
      video_path: `docs/assets/${DATE}/slot-03.mp4`,
      request_id: "replay-1",
      duration_seconds: 15,
      width: 1080,
      height: 1920,
      frame_rate: 24,
      video_codec: "h264",
      marked_at: new Date().toISOString()
    }
  ]);
  await mkdir(join(target, "data", "video-runs", DATE, "slot-03"), { recursive: true });
  await writeFile(
    join(target, "data", "video-runs", DATE, "slot-03", "run.json"),
    JSON.stringify({
      status: "complete",
      prompt_hash: hashVideoPrompt(VIDEO_PROMPT),
      target_path: `docs/assets/${DATE}/slot-03.mp4`
    }),
    "utf8"
  );
  await recordVideoReview({ date: DATE, slot: 3, reviewRound: 1, root: target, now: new Date(`${DATE}T00:00:00+08:00`) });
  const profile = await readFile(join(process.cwd(), "data", "business-profile.json"), "utf8");
  await writeFile(join(target, "data", "business-profile.json"), profile, "utf8");
  if (holdSlot) {
    await enableSlotHolds(target, [sampleHold({ date: DATE, slot: holdSlot, reason: "replay hold" })]);
  } else {
    await enableSlotHolds(target, []);
  }
}

describe("S5-2 full pipeline replay", () => {
  it("blocks the held slot at every step and lets the other two finish, then recovers after remove", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://sixiangjialaundry.com");
    vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://sixiangjialaundry.com");
    vi.stubEnv("META_ACCESS_TOKEN", "test-token-value");
    vi.stubEnv("FB_PAGE_ID", "111000111");
    vi.stubEnv("IG_USER_ID", "222000222");
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("VERIFY_PUBLIC_IMAGE_URL", "false");
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
    vi.stubEnv("YT_CLIENT_ID", "test-yt-client");
    vi.stubEnv("YT_CLIENT_SECRET", "test-yt-secret");
    vi.stubEnv("YT_REFRESH_TOKEN", "test-yt-refresh");
    vi.stubEnv("PUBLIC_GA4_MEASUREMENT_ID", "G-TEST123456");

    root = await mkdtemp(join(tmpdir(), "slot-hold-replay-"));
    await seedReplayDay(root, 1);
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = replayFetch(calls);
    const config = liveConfig();
    const nowAhead = new Date("2026-09-28T21:00:00+08:00");

    const approval = await autoApprove({ date: DATE, root, approvedBy: "replay" });
    expect(approval.approved_slots).toContain(2);
    expect(approval.approved_slots).toContain(3);
    expect(approval.approved_slots).not.toContain(1);
    const approvedLog = await loadApprovalLog(DATE, root);
    expect(approvedLog.some((row) => row.slot === 1)).toBe(false);
    expect(approvedLog.some((row) => row.slot === 2)).toBe(true);
    expect(approvedLog.some((row) => row.slot === 3)).toBe(true);

    const scheduled = await scheduleAheadFacebook({ date: DATE, root, config, fetchImpl, now: nowAhead });
    expect(scheduled.find((row) => row.slot === 1)?.action).toBe("skipped");
    expect(scheduled.find((row) => row.slot === 2)?.action).toBe("scheduled");
    expect(scheduled.find((row) => row.slot === 3)?.action).toBe("scheduled");
    const afterSchedule = calls.length;
    expect(afterSchedule).toBeGreaterThan(0);

    await expect(
      postCurrentSlot({
        date: DATE,
        slot: 1,
        root,
        now: `${DATE}T11:35:00+08:00`,
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow(/SLOT HELD/);
    expect(calls.length).toBe(afterSchedule);

    await postCurrentSlot({
      date: DATE,
      slot: 2,
      root,
      now: `${DATE}T20:35:00+08:00`,
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    const afterSlot2 = calls.length;
    expect(afterSlot2).toBeGreaterThan(afterSchedule);

    await postCurrentSlot({
      date: DATE,
      slot: 3,
      root,
      now: `${DATE}T12:05:00+08:00`,
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    const afterSlot3 = calls.length;
    expect(afterSlot3).toBeGreaterThan(afterSlot2);

    await expect(
      scheduleYouTubeShort({ date: DATE, slot: 1, root, now: nowAhead, fetchImpl })
    ).rejects.toThrow(/SLOT HELD/);
    expect(calls.length).toBe(afterSlot3);
    const ytAhead = await scheduleYouTubeShort({ date: DATE, slot: 3, root, now: nowAhead, fetchImpl });
    expect(ytAhead.status).toBe("scheduled");
    expect(calls.some((call) => call.url.includes("googleapis.com/upload/youtube"))).toBe(true);
    const afterYtAhead = calls.length;
    expect(afterYtAhead).toBeGreaterThan(afterSlot3);

    await expect(uploadShort({ date: DATE, slot: 1, root, fetchImpl })).rejects.toThrow(/SLOT HELD/);
    expect(calls.length).toBe(afterYtAhead);

    const stories = await shareLivePostsToStories({ date: DATE, root, fetchImpl });
    expect(stories.find((row) => row.slot === 1)?.skipped).toMatch(/SLOT HELD/);
    expect(stories.find((row) => row.slot === 2)?.story_id).toBeTruthy();

    await generatePublicSite({
      root,
      baseUrl: "https://sixiangjialaundry.com",
      now: `${DATE}T01:00:00.000Z`
    });
    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8")) as {
      posts: Array<{ slot: number; date: string }>;
    };
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    expect(index.posts.some((post) => post.date === DATE && post.slot === 1)).toBe(false);
    expect(index.posts.some((post) => post.date === DATE && post.slot === 2)).toBe(true);
    expect(index.posts.some((post) => post.date === DATE && post.slot === 3)).toBe(true);
    expect(sitemap).not.toContain(`${DATE}-slot-01`);

    process.exitCode = 0;
    await runSlotHoldCli(["remove", "--root", root, "--date", DATE, "--slot", "1", "--reason", "replay hold"]);
    const recovered = await autoApprove({ date: DATE, root, approvedBy: "replay" });
    expect(recovered.approved_slots).toContain(1);
    const recoveredLog = await loadApprovalLog(DATE, root);
    expect(recoveredLog.some((row) => row.slot === 1)).toBe(true);
  }, 60_000);
});
