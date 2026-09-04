import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stampDailyContentWrite } from "../src/contentPlan";
import { getConfig } from "../src/config";
import { postFacebookCarousel, postFacebookPhoto, postFacebookReel } from "../src/postFacebook";
import { postCurrentSlot, resolveSlotPublishMedia } from "../src/postCurrentSlot";

// Partial mock: the resolver delegates to the real one unless a test overrides it.
vi.mock("../src/postCurrentSlot", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/postCurrentSlot")>();
  return {
    ...mod,
    resolveSlotPublishMedia: vi.fn((...args: Parameters<typeof mod.resolveSlotPublishMedia>) => mod.resolveSlotPublishMedia(...args))
  };
});
const actualPostCurrentSlot = await vi.importActual<typeof import("../src/postCurrentSlot")>("../src/postCurrentSlot");
// A queued mockRejectedValueOnce must never leak into the next test.
afterEach(() => {
  vi.mocked(resolveSlotPublishMedia).mockReset();
  vi.mocked(resolveSlotPublishMedia).mockImplementation(actualPostCurrentSlot.resolveSlotPublishMedia);
});
import { facebookScheduleKind, loadScheduledLog, scheduleAheadFacebook } from "../src/scheduleAhead";
import { loadPostLog } from "../src/logging";
import type { AppConfig, PostInput } from "../src/types";

const DATE = "2026-09-21";
const NOW_DAY_BEFORE = new Date("2026-09-20T21:00:00+08:00");
const IN_WINDOW = new Date(`${DATE}T11:35:00+08:00`);

function liveConfig(): AppConfig {
  return getConfig({
    ...process.env,
    DRY_RUN: "false",
    PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster",
    META_ACCESS_TOKEN: "test-token-value",
    FB_PAGE_ID: "111000111",
    IG_USER_ID: "222000222",
    VERIFY_PUBLIC_IMAGE_URL: "false"
  });
}

interface CapturedCall {
  url: string;
  body?: URLSearchParams;
}

function fakeFetch(calls: CapturedCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : undefined;
    calls.push({ url, body });
    const respond = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/video_reels") && body?.get("upload_phase") === "start") {
      return respond({ video_id: "vid-1", upload_url: "https://upload.test/vid-1" });
    }
    if (url.startsWith("https://upload.test/")) {
      return respond({ success: true });
    }
    if (url.includes("/video_reels") && body?.get("upload_phase") === "finish") {
      return respond({ success: true });
    }
    if (url.includes("status_code")) {
      return respond({ status_code: "FINISHED" });
    }
    if (url.includes("fields=status")) {
      return respond({ status: { video_status: "ready" } });
    }
    if (url.includes("/media_publish")) {
      return respond({ id: "ig-post-1" });
    }
    if (url.includes("/media")) {
      return respond({ id: "ig-container-1" });
    }
    return respond({ id: "fb-obj-1", post_id: "fb-post-1" });
  }) as typeof fetch;
}

function slotFixture(slot: number, mediaType: "image" | "carousel", caption: string) {
  const base = {
    slot,
    time: slot === 1 ? "11:30" : slot === 2 ? "20:30" : "12:00",
    topic: `排程測試主題 ${slot}`,
    format: "image-post",
    media_type: mediaType,
    instagram_caption: caption,
    facebook_caption: caption,
    local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`,
    public_image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${DATE}/slot-0${slot}.png`
  };
  if (mediaType === "carousel") {
    return {
      ...base,
      carousel_items: [1, 2].map((slide) => ({
        slide,
        image_prompt: "p",
        local_image_path: `docs/assets/${DATE}/slot-0${slot}${slide > 1 ? `-slide-0${slide}` : ""}.png`,
        public_image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${DATE}/slot-0${slot}${slide > 1 ? `-slide-0${slide}` : ""}.png`
      }))
    };
  }
  return base;
}

async function seedDay(root: string, slots: Array<ReturnType<typeof slotFixture>>): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  for (const slot of slots) {
    const assets = "carousel_items" in slot && Array.isArray(slot.carousel_items)
      ? slot.carousel_items.map((item) => item.local_image_path)
      : [slot.local_image_path];
    for (const rel of assets) {
      await writeFile(join(root, ...rel.split("/")), "png-bytes");
    }
  }
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    `${JSON.stringify(
      stampDailyContentWrite(
        {
          date: DATE,
          timezone: "Asia/Taipei",
          generated_at: new Date().toISOString(),
          slots
        } as Parameters<typeof stampDailyContentWrite>[0],
        { root }
      ),
      null,
      2
    )}\n`,
    "utf8"
  );
  const approvals = slots.flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date: DATE,
      slot: slot.slot,
      platform,
      status: "approved",
      approved_at: new Date().toISOString()
    }))
  );
  await writeFile(join(root, "data", "approved-log", `${DATE}.json`), JSON.stringify(approvals), "utf8");
}

describe("postFacebook scheduling parameters", () => {
  const input: PostInput = {
    date: DATE,
    slot: 1,
    caption: "cap",
    imageUrl: "https://img.test/a.png",
    scheduledPublishTime: 1_790_000_000
  };

  it("photo carries published=false and scheduled_publish_time only when scheduling", async () => {
    const calls: CapturedCall[] = [];
    await postFacebookPhoto(input, liveConfig(), fakeFetch(calls));
    const scheduled = calls.find((call) => call.url.includes("/photos"));
    expect(scheduled?.body?.get("published")).toBe("false");
    expect(scheduled?.body?.get("scheduled_publish_time")).toBe("1790000000");

    calls.length = 0;
    await postFacebookPhoto({ ...input, scheduledPublishTime: undefined }, liveConfig(), fakeFetch(calls));
    const live = calls.find((call) => call.url.includes("/photos"));
    expect(live?.body?.get("published")).toBe("true");
    expect(live?.body?.get("scheduled_publish_time")).toBeNull();
  });

  it("carousel /feed commit carries the scheduling fields", async () => {
    const calls: CapturedCall[] = [];
    await postFacebookCarousel(
      { ...input, imageUrls: ["https://img.test/a.png", "https://img.test/b.png"] },
      liveConfig(),
      fakeFetch(calls)
    );
    const feed = calls.find((call) => call.url.includes("/feed"));
    expect(feed?.body?.get("published")).toBe("false");
    expect(feed?.body?.get("scheduled_publish_time")).toBe("1790000000");
  });

  it("reel finish uses video_state=SCHEDULED and skips transcode polling", async () => {
    const calls: CapturedCall[] = [];
    await postFacebookReel({ ...input, videoUrl: "https://img.test/v.mp4" }, liveConfig(), fakeFetch(calls));
    const finish = calls.find((call) => call.body?.get("upload_phase") === "finish");
    expect(finish?.body?.get("video_state")).toBe("SCHEDULED");
    expect(finish?.body?.get("scheduled_publish_time")).toBe("1790000000");
    expect(calls.some((call) => call.url.includes("fields=status"))).toBe(false);
  });
});

describe("facebookScheduleKind live-path parity", () => {
  it("queues a mixed-carousel with publishable video as a REEL, matching postCurrentSlot", () => {
    // First live run (2026-08-25 01:30) queued a plain carousel for a
    // mixed-carousel slot, silently dropping the owner-approved video.
    expect(facebookScheduleKind("mixed-carousel")).toBe("reel");
    expect(facebookScheduleKind("reel")).toBe("reel");
    expect(facebookScheduleKind("carousel")).toBe("carousel");
    expect(facebookScheduleKind("image")).toBe("image");
    expect(facebookScheduleKind(undefined)).toBe("image");
  });
});

describe("scheduleAheadFacebook", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sched-ahead-"));
  });

  it("schedules an approved carousel slot at its slot time and records it", async () => {
    await seedDay(root, [
      slotFixture(1, "carousel", `排程輪播文案 ${DATE} 甲`),
      slotFixture(2, "image", `排程單圖文案 ${DATE} 乙`)
    ]);
    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch(calls),
      now: NOW_DAY_BEFORE
    });

    const carousel = results.find((row) => row.slot === 1);
    expect(carousel?.action).toBe("scheduled");
    expect(carousel?.scheduled_publish_time).toBe(
      Math.floor(new Date(`${DATE}T11:30:00+08:00`).getTime() / 1000)
    );
    const feed = calls.find((call) => call.url.includes("/feed"));
    expect(feed?.body?.get("scheduled_publish_time")).toBe(String(carousel?.scheduled_publish_time));

    const log = await loadScheduledLog(DATE, root);
    expect(log.map((row) => row.slot).sort()).toEqual([1, 2]);
    expect(log.every((row) => row.scheduled_post_id)).toBe(true);
  });

  it("skips slots already scheduled instead of double-scheduling", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `排程冪等文案 ${DATE} 丙`),
      slotFixture(2, "image", `排程冪等填充 ${DATE} 丙二`)
    ]);
    const calls: CapturedCall[] = [];
    const first = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch(calls),
      now: NOW_DAY_BEFORE
    });
    expect(first[0]?.action).toBe("scheduled");
    const callsAfterFirst = calls.length;

    const second = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch(calls),
      now: NOW_DAY_BEFORE
    });
    expect(second.every((row) => row.action === "skipped")).toBe(true);
    expect(second[0]?.reason).toContain("already scheduled");
    expect(calls.length).toBe(callsAfterFirst);
  });

  it("skips a reel slot whose video is deferred instead of downgrading it to an image post", async () => {
    const reelSlot = {
      ...slotFixture(3, "image", `排程Reel延期文案 ${DATE} 庚`),
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${DATE}/slot-03.mp4`,
      public_video_url: `https://tester.github.io/laundry-social-auto-poster/assets/${DATE}/slot-03.mp4`
    } as unknown as ReturnType<typeof slotFixture>;
    await seedDay(root, [slotFixture(1, "image", `排程Reel填充 ${DATE} 庚二`), reelSlot]);

    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch(calls),
      now: NOW_DAY_BEFORE
    });

    const reel = results.find((row) => row.slot === 3);
    expect(reel?.action).toBe("skipped");
    expect(reel?.reason).toContain("reel video not publishable");
    // The 2026-08-25 first live run scheduled static images into two future
    // Reel slots; no Facebook object may be created for a deferred reel.
    const log = await loadScheduledLog(DATE, root);
    expect(log.some((row) => row.slot === 3)).toBe(false);
  });

  it("still aborts the whole run when a Reel slot is missing its cover image", async () => {
    const reelSlot = {
      ...slotFixture(3, "image", `排程Reel缺圖文案 ${DATE} 辛`),
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${DATE}/slot-03.mp4`
    } as unknown as ReturnType<typeof slotFixture>;
    // Reel first: if this is mis-classified as a deferred-video skip, slot 1
    // would still be scheduled and the run would resolve instead of throw.
    await seedDay(root, [reelSlot, slotFixture(1, "image", `排程Reel缺圖填充 ${DATE} 辛二`)]);
    await rm(join(root, "docs", "assets", DATE, "slot-03.png"));

    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch([]), now: NOW_DAY_BEFORE })
    ).rejects.toThrow(/Image is missing for slot 3/u);
    expect(await loadScheduledLog(DATE, root)).toEqual([]);
  });

  it("does not convert Image-is-missing into a deferred-reel skip when wrapped under Refusing image fallback", async () => {
    const reelSlot = {
      ...slotFixture(3, "image", `排程Reel缺圖包裝文案 ${DATE} 寅`),
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${DATE}/slot-03.mp4`
    } as unknown as ReturnType<typeof slotFixture>;
    await seedDay(root, [reelSlot, slotFixture(1, "image", `排程Reel缺圖包裝填充 ${DATE} 寅二`)]);
    const missingImage = `Image is missing for slot 3: docs/assets/${DATE}/slot-03.png. Run the Codex imagegen automation first.`;
    vi.mocked(resolveSlotPublishMedia).mockImplementation(async (slot, ...rest) => {
      if (slot.slot === 3) {
        throw new Error(`Refusing image fallback for reel slot 3: ${missingImage}`);
      }
      return actualPostCurrentSlot.resolveSlotPublishMedia(slot, ...rest);
    });

    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch([]), now: NOW_DAY_BEFORE })
    ).rejects.toThrow(/Image is missing for slot 3/u);
    expect(await loadScheduledLog(DATE, root)).toEqual([]);
  });

  it("aborts when the deferred-reel path reports Image is missing instead of recording a skip", async () => {
    const reelSlot = {
      ...slotFixture(3, "image", `排程Reel缺圖延期文案 ${DATE} 卯`),
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${DATE}/slot-03.mp4`
    } as unknown as ReturnType<typeof slotFixture>;
    await seedDay(root, [reelSlot, slotFixture(1, "image", `排程Reel缺圖延期填充 ${DATE} 卯二`)]);
    vi.mocked(resolveSlotPublishMedia).mockImplementation(async (slot, ...rest) => {
      if (slot.slot === 3) {
        return {
          mediaType: "image",
          videoDeferred: true,
          videoDeferKind: "expected",
          videoDeferredReason: `Image is missing for slot 3: docs/assets/${DATE}/slot-03.png. Run the Codex imagegen automation first.`
        };
      }
      return actualPostCurrentSlot.resolveSlotPublishMedia(slot, ...rest);
    });

    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch([]), now: NOW_DAY_BEFORE })
    ).rejects.toThrow(/Image is missing for slot 3/u);
    expect(await loadScheduledLog(DATE, root)).toEqual([]);
  });

  it("rethrows an unexpected resolver error on a Reel slot instead of recording a skip", async () => {
    const reelSlot = {
      ...slotFixture(3, "image", `排程Reel故障文案 ${DATE} 壬`),
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${DATE}/slot-03.mp4`
    } as unknown as ReturnType<typeof slotFixture>;
    await seedDay(root, [slotFixture(1, "image", `排程Reel故障填充 ${DATE} 壬二`), reelSlot]);
    vi.mocked(resolveSlotPublishMedia).mockImplementation(async (slot, ...rest) => {
      if (slot.slot === 3) throw new TypeError("resolver exploded");
      return actualPostCurrentSlot.resolveSlotPublishMedia(slot, ...rest);
    });

    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch([]), now: NOW_DAY_BEFORE })
    ).rejects.toThrow("resolver exploded");
    const log = await loadScheduledLog(DATE, root);
    expect(log.some((row) => row.slot === 3)).toBe(false);
  });

  it("rethrows a refusal-shaped message that is not the resolver's own plain Error", async () => {
    const reelSlot = {
      ...slotFixture(3, "image", `排程Reel偽裝文案 ${DATE} 癸`),
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${DATE}/slot-03.mp4`
    } as unknown as ReturnType<typeof slotFixture>;
    await seedDay(root, [slotFixture(1, "image", `排程Reel偽裝填充 ${DATE} 癸二`), reelSlot]);
    vi.mocked(resolveSlotPublishMedia).mockImplementation(async (slot, ...rest) => {
      if (slot.slot === 3) throw new RangeError("Refusing image fallback for reel slot 3: not really the resolver");
      return actualPostCurrentSlot.resolveSlotPublishMedia(slot, ...rest);
    });

    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch([]), now: NOW_DAY_BEFORE })
    ).rejects.toThrow("not really the resolver");
  });

  it("aborts when a non-video slot is missing its image", async () => {
    await seedDay(root, [slotFixture(1, "image", `排程圖缺文案 ${DATE} 子`), slotFixture(2, "image", `排程圖缺填充 ${DATE} 子二`)]);
    await rm(join(root, "docs", "assets", DATE, "slot-01.png"));

    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch([]), now: NOW_DAY_BEFORE })
    ).rejects.toThrow(/Image is missing for slot 1/u);
    expect(await loadScheduledLog(DATE, root)).toEqual([]);
  });

  it("refuses a slot whose publish time is too close and one with no approval", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `排程界線文案 ${DATE} 丁`),
      slotFixture(2, "image", `排程界線填充 ${DATE} 丁二`)
    ]);
    const tooClose = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch([]),
      now: new Date(`${DATE}T11:25:00+08:00`)
    });
    expect(tooClose[0]?.action).toBe("skipped");
    expect(tooClose[0]?.reason).toContain("too close");

    await writeFile(join(root, "data", "approved-log", `${DATE}.json`), JSON.stringify([]), "utf8");
    const noApproval = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch([]),
      now: NOW_DAY_BEFORE
    });
    expect(noApproval[0]?.action).toBe("skipped");
    expect(noApproval[0]?.reason).toContain("approval");
  });
});

describe("postCurrentSlot interlock with schedule-ahead", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sched-interlock-"));
    process.env.DRY_RUN = "false";
    process.env.PUBLIC_IMAGE_BASE_URL = "https://tester.github.io/laundry-social-auto-poster";
    process.env.META_ACCESS_TOKEN ||= "test-token-value";
    process.env.FB_PAGE_ID = "111000111";
    process.env.IG_USER_ID = "222000222";
    process.env.VERIFY_PUBLIC_IMAGE_URL = "false";
  });

  afterEach(() => {
    process.env.DRY_RUN = "true";
  });

  it("does not publish Facebook again when the slot is already in Meta's scheduled queue", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `互鎖已排程文案 ${DATE} 戊`),
      slotFixture(2, "image", `互鎖已排程填充 ${DATE} 戊二`)
    ]);
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(
      join(root, "data", "scheduled-log", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 1,
          platform: "facebook",
          scheduled_post_id: "fb-scheduled-99",
          scheduled_publish_time: Math.floor(new Date(`${DATE}T11:30:00+08:00`).getTime() / 1000),
          published_media_type: "image",
          created_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );

    const calls: CapturedCall[] = [];
    await postCurrentSlot({ date: DATE, slot: 1, root, now: IN_WINDOW, fetchImpl: fakeFetch(calls) });

    expect(calls.some((call) => call.url.includes("/111000111/"))).toBe(false);
    expect(calls.some((call) => call.url.includes("/222000222/"))).toBe(true);

    const log = await loadPostLog(DATE, root);
    const fb = log.find((row) => row.platform === "facebook");
    expect(fb?.status).toBe("success");
    expect(fb?.post_id).toBe("fb-scheduled-99");
    expect(fb?.attempts).toBe(0);
    const ig = log.find((row) => row.platform === "instagram");
    expect(ig?.status).toBe("success");
  });

  it("still publishes Facebook live when no scheduled record exists (mutation guard)", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `互鎖未排程文案 ${DATE} 己`),
      slotFixture(2, "image", `互鎖未排程填充 ${DATE} 己二`)
    ]);
    const calls: CapturedCall[] = [];
    await postCurrentSlot({ date: DATE, slot: 1, root, now: IN_WINDOW, fetchImpl: fakeFetch(calls) });
    expect(calls.some((call) => call.url.includes("/111000111/photos"))).toBe(true);
  });
});
