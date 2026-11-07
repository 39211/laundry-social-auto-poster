import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { readPublishTimes } from "../src/publishTimes";
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
  method?: string;
}

function fakeFetch(calls: CapturedCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : undefined;
    calls.push({ url, body, method: init?.method ?? "GET" });
    // A7-3 image preflight: public image URLs are served as images.
    if (init?.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-type": "image/png" } });
    }
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

  it("uses the assigned daily publish time for Meta scheduled_publish_time", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `指定時間排程文案 ${DATE}`),
      slotFixture(2, "image", `晚間指定時間填充 ${DATE}`)
    ]);
    await mkdir(join(root, "data", "publish-times"), { recursive: true });
    await writeFile(
      join(root, "data", "publish-times", `${DATE}.json`),
      JSON.stringify({
        date: DATE,
        experiment: "afternoon-vs-usual-2026-10",
        assigned_at: "2026-10-03T13:40:12.345Z",
        slots: [{ slot: 1, time: "14:12", arm: "afternoon" }]
      }),
      "utf8"
    );
    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch(calls),
      now: NOW_DAY_BEFORE
    });
    const expected = Math.floor(new Date(`${DATE}T14:12:00+08:00`).getTime() / 1000);
    expect(results.find((row) => row.slot === 1)?.scheduled_publish_time).toBe(expected);
    expect(calls.find((call) => call.url.includes("/photos"))?.body?.get("scheduled_publish_time")).toBe(String(expected));
  });

  it("creates the experiment assignment before scheduling and sends its exact time to Meta", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `整合抽籤排程文案 ${DATE}`),
      slotFixture(2, "image", `整合抽籤填充文案 ${DATE}`)
    ]);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "publish-time-experiment.json"), JSON.stringify({
      name: "afternoon-vs-usual-2026-10",
      start_date: DATE,
      end_date: DATE,
      slots: [1],
      probability_afternoon: 1,
      afternoon_window: { start: "14:12", end: "14:12" },
      min_gap_minutes: 0,
      preregistered: {
        primary_metric: "Instagram reach",
        secondary_metric: "Facebook distribution",
        decision_rule: "compare arms"
      }
    }), "utf8");

    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch(calls),
      now: NOW_DAY_BEFORE
    });
    const publishTimesPath = join(root, "data", "publish-times", `${DATE}.json`);
    const publishTimes = JSON.parse(await readFile(publishTimesPath, "utf8")) as {
      slots: Array<{ slot: number; time: string }>;
    };
    const slot1Time = publishTimes.slots.find((slot) => slot.slot === 1)?.time;
    const expected = Math.floor(new Date(`${DATE}T${slot1Time}:00+08:00`).getTime() / 1000);

    expect(slot1Time).toBe("14:12");
    expect(results.find((row) => row.slot === 1)?.scheduled_publish_time).toBe(expected);
    expect(calls.find((call) => call.url.includes("/photos"))?.body?.get("scheduled_publish_time")).toBe(String(expected));
  });

  it("creates a per-slot early-evening assignment and schedules slot 2 at its exact Taiwan time", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `各格視窗排程文案 ${DATE} 甲`),
      slotFixture(2, "image", `各格晚間排程文案 ${DATE} 乙`)
    ]);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "publish-time-experiment.json"), JSON.stringify({
      name: "slot-windows-vs-usual-2026-10",
      start_date: DATE,
      end_date: DATE,
      slots: [1, 2],
      probability_afternoon: 1,
      windows: {
        "1": { start: "14:12", end: "14:12", arm: "afternoon" },
        "2": { start: "19:07", end: "19:07", arm: "early-evening" }
      },
      min_gap_minutes: 60,
      preregistered: {
        primary_metric: "Instagram reach",
        secondary_metric: "Instagram views",
        analysis_unit: "per slot",
        decision_rule: "compare each slot"
      }
    }), "utf8");

    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch(calls),
      now: NOW_DAY_BEFORE
    });
    const publishTimesPath = join(root, "data", "publish-times", `${DATE}.json`);
    const publishTimes = JSON.parse(await readFile(publishTimesPath, "utf8")) as {
      slots: Array<{ slot: number; time: string; arm?: string }>;
    };
    const slot2 = publishTimes.slots.find((slot) => slot.slot === 2);
    const slot2CallTime = Math.floor(new Date(`${DATE}T${slot2?.time}:00+08:00`).getTime() / 1000);
    const expected = Math.floor(new Date(`${DATE}T19:07:00+08:00`).getTime() / 1000);

    expect(slot2).toMatchObject({ time: "19:07", arm: "early-evening" });
    expect(slot2CallTime).toBe(expected);
    expect(results.find((row) => row.slot === 2)?.scheduled_publish_time).toBe(expected);
    expect(calls.find((call) => call.url.includes("/photos") && call.body?.get("scheduled_publish_time") === String(expected))?.body?.get("scheduled_publish_time")).toBe(String(expected));
  });

  it("does not create an experiment assignment after a slot is already scheduled", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `已排程不抽籤文案 ${DATE}`),
      slotFixture(2, "image", `已排程不抽籤填充 ${DATE}`)
    ]);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "publish-time-experiment.json"), JSON.stringify({
      name: "afternoon-vs-usual-2026-10",
      start_date: DATE,
      end_date: DATE,
      slots: [1],
      probability_afternoon: 1,
      afternoon_window: { start: "14:12", end: "14:12" },
      min_gap_minutes: 0,
      preregistered: {
        primary_metric: "Instagram reach",
        secondary_metric: "Facebook distribution",
        decision_rule: "compare arms"
      }
    }), "utf8");
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), JSON.stringify([
      { date: DATE, slot: 1, platform: "facebook", scheduled_post_id: "existing-fb-1" }
    ]), "utf8");

    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: fakeFetch([]),
      now: NOW_DAY_BEFORE
    });

    expect(results.find((row) => row.slot === 1)).toMatchObject({ action: "skipped", reason: "already scheduled" });
    expect(await readPublishTimes(DATE, root)).toBeNull();
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
    await seedDay(root, [slotFixture(1, "image", `排程Reel缺圖填充 ${DATE} 辛二`), reelSlot]);
    await rm(join(root, "docs", "assets", DATE, "slot-03.png"));

    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch([]), now: NOW_DAY_BEFORE })
    ).rejects.toThrow(/Image is missing for slot 3/u);
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

describe("an unconfirmed Facebook schedule is recorded, never sent again", () => {
  let root: string;
  const slot1At = String(Math.floor(new Date(`${DATE}T11:30:00+08:00`).getTime() / 1000));

  /** fakeFetch, except slot 1's schedule commit (the /photos POST carrying its time) answers with `onCommit`. */
  function commitFails(calls: CapturedCall[], onCommit: () => Promise<Response>): { fetchImpl: typeof fetch; commits: () => number } {
    let commits = 0;
    const normal = fakeFetch(calls);
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body instanceof URLSearchParams ? init.body : undefined;
      if (String(input).includes("/photos") && body?.get("scheduled_publish_time") === slot1At) {
        commits += 1;
        calls.push({ url: String(input), body });
        return onCommit();
      }
      return normal(input, init);
    }) as typeof fetch;
    return { fetchImpl, commits: () => commits };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sched-uncertain-"));
    await seedDay(root, [
      slotFixture(1, "image", `排程未確認文案 ${DATE} 壬`),
      slotFixture(2, "image", `排程未確認填充 ${DATE} 壬二`)
    ]);
  });

  it("records a schedule whose reply was lost as uncertain and never queues it again", async () => {
    const calls: CapturedCall[] = [];
    const { fetchImpl, commits } = commitFails(calls, () => Promise.reject(new TypeError("fetch failed")));
    const first = await scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now: NOW_DAY_BEFORE });
    expect(first.find((row) => row.slot === 1)).toMatchObject({ action: "uncertain" });
    expect(first.find((row) => row.slot === 2)?.action).toBe("scheduled");
    const log = await loadScheduledLog(DATE, root);
    expect(log.find((row) => row.slot === 1)).toMatchObject({ status: "uncertain", scheduled_post_id: "" });

    // A7-3: the second run now asks the Page about the uncertain row first.
    // fakeFetch answers the Graph lookup with no post list, so the lookup is
    // unavailable: the row stays as it was and nothing is sent again.
    const second = await scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now: NOW_DAY_BEFORE });
    expect(second.find((row) => row.slot === 1)).toMatchObject({ action: "uncertain", reason: "reconcile_unavailable" });
    expect((await loadScheduledLog(DATE, root)).find((row) => row.slot === 1)).toMatchObject({ status: "uncertain" });
    expect(commits()).toBe(1);
  });

  it("an offline run (no DNS) aborts without a row, and the next run schedules the slot", async () => {
    // The request never left this machine, so nothing is in Meta's queue:
    // an uncertain row here would block the slot for good.
    const calls: CapturedCall[] = [];
    const { fetchImpl, commits } = commitFails(calls, () =>
      Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))
    );
    await expect(scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now: NOW_DAY_BEFORE })).rejects.toThrow(
      "fetch failed"
    );
    expect(commits()).toBe(1);
    expect(await loadScheduledLog(DATE, root)).toEqual([]);
    const second = await scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: fakeFetch(calls), now: NOW_DAY_BEFORE });
    expect(second.map((row) => row.action)).toEqual(["scheduled", "scheduled"]);
  });

  it("records a schedule answered without an id as uncertain", async () => {
    const calls: CapturedCall[] = [];
    const { fetchImpl } = commitFails(calls, async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const results = await scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now: NOW_DAY_BEFORE });
    expect(results.find((row) => row.slot === 1)).toMatchObject({ action: "uncertain" });
    expect((await loadScheduledLog(DATE, root)).find((row) => row.slot === 1)?.status).toBe("uncertain");
  });

  it("still stops without a row when the failure comes before the commit point", async () => {
    await seedDay(root, [
      slotFixture(1, "carousel", `排程提交前失敗文案 ${DATE} 癸`),
      slotFixture(2, "image", `排程提交前失敗填充 ${DATE} 癸二`)
    ]);
    const calls: CapturedCall[] = [];
    const normal = fakeFetch(calls);
    // The carousel's unpublished photo uploads come before its /feed commit.
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body instanceof URLSearchParams ? init.body : undefined;
      if (String(input).includes("/photos") && !body?.get("scheduled_publish_time")) {
        return new Response(JSON.stringify({ error: { message: "upload failed" } }), { status: 500 });
      }
      return normal(input, init);
    }) as typeof fetch;
    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now: NOW_DAY_BEFORE })
    ).rejects.toThrow("upload failed");
    expect((await loadScheduledLog(DATE, root)).some((row) => row.slot === 1)).toBe(false);
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

  it("records an unconfirmed schedule as uncertain and does not publish Facebook again", async () => {
    await seedDay(root, [
      slotFixture(1, "image", `互鎖未確認文案 ${DATE} 庚`),
      slotFixture(2, "image", `互鎖未確認填充 ${DATE} 庚二`)
    ]);
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(
      join(root, "data", "scheduled-log", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 1,
          platform: "facebook",
          scheduled_post_id: "",
          scheduled_publish_time: Math.floor(new Date(`${DATE}T11:30:00+08:00`).getTime() / 1000),
          published_media_type: "image",
          status: "uncertain",
          error: "Facebook photo schedule response was lost",
          created_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );

    const calls: CapturedCall[] = [];
    await expect(postCurrentSlot({ date: DATE, slot: 1, root, now: IN_WINDOW, fetchImpl: fakeFetch(calls) }))
      .rejects.toThrow("needs_manual:");

    expect(calls.some((call) => call.url.includes("/111000111/") && call.method === "POST")).toBe(false);
    const log = await loadPostLog(DATE, root);
    const fb = log.find((row) => row.platform === "facebook");
    expect(fb).toMatchObject({ status: "uncertain", attempts: 0 });
    expect(fb?.post_id).toBeUndefined();
    expect(log.find((row) => row.platform === "instagram")?.status).toBe("success");
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

describe("A7-3 image preflight before the commit point", () => {
  let root: string;
  const slot1At = String(Math.floor(new Date(`${DATE}T11:30:00+08:00`).getTime() / 1000));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sched-preflight-"));
    await seedDay(root, [
      slotFixture(1, "image", `預檢文案 ${DATE} 甲`),
      slotFixture(2, "image", `預檢填充文案 ${DATE} 乙`)
    ]);
  });

  /** fakeFetch, except requests to the public image host answer with `onImage`. */
  function imageFetch(
    calls: CapturedCall[],
    onImage: (url: string, init?: RequestInit) => Response | Promise<Response>
  ): typeof fetch {
    const normal = fakeFetch(calls);
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://tester.github.io/")) {
        calls.push({ url, method: init?.method ?? "GET" });
        return onImage(url, init);
      }
      return normal(input, init);
    }) as typeof fetch;
  }

  const graphCalls = (calls: CapturedCall[]) => calls.filter((call) => call.url.startsWith("https://graph.facebook.com/"));

  it("defers on a 404 image and never calls the Facebook API", async () => {
    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: imageFetch(calls, () => new Response(null, { status: 404, headers: { "content-type": "text/html" } })),
      now: NOW_DAY_BEFORE
    });
    expect(results.map((row) => row.action)).toEqual(["deferred", "deferred"]);
    expect(results[0]?.reason).toMatch(/^image_not_public: 404/u);
    expect(graphCalls(calls)).toEqual([]);
    // Deferred is not written as uncertain: the next run tries again.
    expect(await loadScheduledLog(DATE, root)).toEqual([]);
  });

  it("schedules after a 200 image/* preflight, which runs before the commit", async () => {
    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: imageFetch(calls, () => new Response(null, { status: 200, headers: { "content-type": "image/png" } })),
      now: NOW_DAY_BEFORE
    });
    expect(results.map((row) => row.action)).toEqual(["scheduled", "scheduled"]);
    const headIndex = calls.findIndex((call) => call.method === "HEAD" && call.url.endsWith("/slot-01.png"));
    const commitIndex = calls.findIndex(
      (call) => call.url.includes("/photos") && call.body?.get("scheduled_publish_time") === slot1At
    );
    expect(headIndex).toBeGreaterThanOrEqual(0);
    expect(commitIndex).toBeGreaterThan(headIndex);
  });

  it("defers when the URL answers 200 but not with an image content type", async () => {
    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: imageFetch(calls, () => new Response(null, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })),
      now: NOW_DAY_BEFORE
    });
    expect(results.map((row) => row.action)).toEqual(["deferred", "deferred"]);
    expect(results[0]?.reason).toMatch(/^image_not_public: content-type text\/html/u);
    expect(graphCalls(calls)).toEqual([]);
  });

  it("falls back to a ranged GET when HEAD is not allowed", async () => {
    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: imageFetch(calls, (_url, init) => {
        if (init?.method === "HEAD") return new Response(null, { status: 405 });
        if (new Headers(init?.headers).get("range") === "bytes=0-0") {
          return new Response("x", { status: 206, headers: { "content-type": "image/png" } });
        }
        return new Response(null, { status: 500 });
      }),
      now: NOW_DAY_BEFORE
    });
    expect(results.map((row) => row.action)).toEqual(["scheduled", "scheduled"]);
  });

  it("defers on a preflight timeout", async () => {
    const calls: CapturedCall[] = [];
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl: imageFetch(calls, () => new Promise<Response>(() => undefined)),
      now: NOW_DAY_BEFORE,
      preflightTimeoutMs: 20
    });
    expect(results.map((row) => row.action)).toEqual(["deferred", "deferred"]);
    expect(results[0]?.reason).toMatch(/^image_not_public: timeout/u);
    expect(graphCalls(calls)).toEqual([]);
  });
});

describe("A7-3 reconcile uncertain rows against the Page", () => {
  let root: string;
  const slot1At = Math.floor(new Date(`${DATE}T11:30:00+08:00`).getTime() / 1000);
  const AFTER_SLOT_1 = new Date(`${DATE}T12:00:00+08:00`);
  const caption1 = `對帳測試文案：本週末烘衣機全面保養，請提前預約時段，謝謝大家的支持與耐心 ${DATE} 甲`;
  const uncertainRow = {
    date: DATE,
    slot: 1,
    platform: "facebook",
    scheduled_post_id: "",
    scheduled_publish_time: slot1At,
    published_media_type: "image",
    status: "uncertain",
    error: "Missing or invalid image file (commit point; the post may already be live. Not retrying.)",
    created_at: "2026-09-20T13:40:00.000Z"
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sched-reconcile-"));
    await seedDay(root, [slotFixture(1, "image", caption1), slotFixture(2, "image", `對帳填充文案 ${DATE} 乙`)]);
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), JSON.stringify([uncertainRow]), "utf8");
  });

  function pageFetch(
    calls: CapturedCall[],
    page: { scheduled?: unknown[]; feed?: unknown[]; fail?: boolean }
  ): typeof fetch {
    const normal = fakeFetch(calls);
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const isLookup =
        method === "GET" && (url.includes("/111000111/scheduled_posts") || url.includes("/111000111/feed"));
      if (!isLookup) return normal(input, init);
      calls.push({ url, method });
      const headers = { "content-type": "application/json" };
      if (page.fail) {
        return new Response(JSON.stringify({ error: { message: "Invalid OAuth access token test-token-value" } }), {
          status: 400,
          headers
        });
      }
      const data = url.includes("/scheduled_posts") ? page.scheduled ?? [] : page.feed ?? [];
      return new Response(JSON.stringify({ data }), { status: 200, headers });
    }) as typeof fetch;
  }

  const run = (fetchImpl: typeof fetch, now: Date) =>
    scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now });

  /** Any Facebook post/schedule call carrying slot 1's caption. */
  const slot1PostCalls = (calls: CapturedCall[]) =>
    calls.filter(
      (call) =>
        call.method === "POST" &&
        call.url.startsWith("https://graph.facebook.com/") &&
        (call.body?.get("caption") === caption1 || call.body?.get("message") === caption1)
    );

  it("confirms the row when the Page's scheduled posts contain it", async () => {
    const calls: CapturedCall[] = [];
    const results = await run(
      pageFetch(calls, {
        scheduled: [
          {
            id: "111000111_777",
            scheduled_publish_time: slot1At,
            created_time: "2026-09-20T13:40:05+0000",
            message: `${caption1}\n#洗衣`
          }
        ]
      }),
      NOW_DAY_BEFORE
    );
    expect(results.filter((row) => row.slot === 1)).toEqual([
      expect.objectContaining({ action: "reconciled", scheduled_post_id: "111000111_777" })
    ]);
    expect(results.find((row) => row.slot === 2)?.action).toBe("scheduled");
    expect(slot1PostCalls(calls)).toEqual([]);
    const row = (await loadScheduledLog(DATE, root)).find((entry) => entry.slot === 1);
    expect(row?.status).toBeUndefined();
    expect(row?.error).toBeUndefined();
    expect(row?.scheduled_post_id).toBe("111000111_777");
  });

  it("confirms a published post from the feed by created_time within 20 minutes, even after the slot", async () => {
    const calls: CapturedCall[] = [];
    const results = await run(
      pageFetch(calls, { feed: [{ id: "111000111_888", created_time: "2026-09-21T03:35:00+0000", message: caption1 }] }),
      AFTER_SLOT_1
    );
    expect(results.find((row) => row.slot === 1)).toMatchObject({ action: "reconciled", scheduled_post_id: "111000111_888" });
    expect(slot1PostCalls(calls)).toEqual([]);
  });

  it("reschedules exactly once when not on the Page and the slot is still in the future", async () => {
    const calls: CapturedCall[] = [];
    // Same time, different caption: must not count as found.
    const fetchImpl = pageFetch(calls, {
      scheduled: [{ id: "111000111_999", scheduled_publish_time: slot1At, message: "完全不同的另一篇貼文內容" }]
    });
    const first = await run(fetchImpl, NOW_DAY_BEFORE);
    expect(first.filter((row) => row.slot === 1)).toEqual([
      expect.objectContaining({ action: "scheduled", scheduled_post_id: "fb-post-1" })
    ]);
    expect(first.find((row) => row.slot === 1)?.reason).toMatch(/rescheduled/u);
    const log = await loadScheduledLog(DATE, root);
    expect(log.filter((row) => row.slot === 1)).toHaveLength(1);
    expect(log.find((row) => row.slot === 1)).toMatchObject({ scheduled_post_id: "fb-post-1" });
    expect(log.find((row) => row.slot === 1)?.status).toBeUndefined();

    const second = await run(fetchImpl, NOW_DAY_BEFORE);
    expect(second.find((row) => row.slot === 1)).toMatchObject({ action: "skipped", reason: "already scheduled" });
    expect(slot1PostCalls(calls)).toHaveLength(1);
  });

  it("marks a past slot lost, prints an ALERT, writes the alert file and never posts it", async () => {
    const calls: CapturedCall[] = [];
    const printed: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
    let results;
    try {
      results = await run(pageFetch(calls, {}), AFTER_SLOT_1);
    } finally {
      errorSpy.mockRestore();
    }
    expect(results.find((row) => row.slot === 1)?.action).toBe("lost");
    expect(results.find((row) => row.slot === 2)?.action).toBe("scheduled");
    expect(printed.some((line) => line.startsWith(`ALERT FB_LOST ${DATE} slot 1`))).toBe(true);
    expect(slot1PostCalls(calls)).toEqual([]);

    const alertText = await readFile(join(root, "output", "alerts", `fb-lost-${DATE}-slot1.json`), "utf8");
    expect(JSON.parse(alertText)).toMatchObject({ date: DATE, slot: 1, scheduled_publish_time: slot1At });
    expect(alertText).not.toContain(caption1.slice(0, 12));
    expect(alertText).not.toContain("test-token-value");
    expect((await loadScheduledLog(DATE, root)).find((row) => row.slot === 1)).toEqual(uncertainRow);
  });

  it("keeps the row unchanged when the Graph lookup fails", async () => {
    const calls: CapturedCall[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let results;
    try {
      results = await run(pageFetch(calls, { fail: true }), NOW_DAY_BEFORE);
    } finally {
      warnSpy.mockRestore();
    }
    expect(results.filter((row) => row.slot === 1)).toEqual([
      expect.objectContaining({ action: "uncertain", reason: "reconcile_unavailable" })
    ]);
    expect(slot1PostCalls(calls)).toEqual([]);
    expect((await loadScheduledLog(DATE, root)).find((row) => row.slot === 1)).toEqual(uncertainRow);
  });

  it("never prints or writes the access token", async () => {
    const printed: string[] = [];
    const capture = (...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    };
    const spies = [
      vi.spyOn(console, "log").mockImplementation(capture),
      vi.spyOn(console, "error").mockImplementation(capture),
      vi.spyOn(console, "warn").mockImplementation(capture)
    ];
    try {
      const calls: CapturedCall[] = [];
      const unavailable = await run(pageFetch(calls, { fail: true }), AFTER_SLOT_1);
      const lost = await run(pageFetch(calls, {}), AFTER_SLOT_1);
      printed.push(JSON.stringify(unavailable), JSON.stringify(lost));
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    expect(printed.some((line) => line.startsWith(`ALERT FB_UNCONFIRMED ${DATE} slot 1`))).toBe(true);
    expect(printed.some((line) => line.startsWith(`ALERT FB_LOST ${DATE} slot 1`))).toBe(true);

    const alertDir = join(root, "output", "alerts");
    const files = await readdir(alertDir);
    expect(files).toContain(`fb-lost-${DATE}-slot1.json`);
    const written = await Promise.all([
      ...files.map((file) => readFile(join(alertDir, file), "utf8")),
      readFile(join(root, "data", "scheduled-log", `${DATE}.json`), "utf8")
    ]);
    for (const text of [...printed, ...written]) {
      expect(text).not.toContain("test-token-value");
    }
  });
});


describe("A7-4 current-day audit never publishes", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "a74-audit-")); });
  afterEach(async () => { if (root && root.includes("a74-audit-")) await rm(root, { recursive: true, force: true }); });
  async function uncertain() {
    await seedDay(root, [slotFixture(1, "image", "A74 unique caption"), slotFixture(2, "image", "A74 unused slot")]);
    const dir = join(root, "data", "scheduled-log");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${DATE}.json`), JSON.stringify([{ date: DATE, slot: 1, platform: "facebook", status: "uncertain", scheduled_publish_time: Math.floor(new Date(`${DATE}T11:30:00+08:00`).getTime()/1000), created_at: NOW_DAY_BEFORE.toISOString() }]));
  }
  function readOnlyFetch() {
    return vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
  }
  it("checks today's elapsed uncertain row and raises a lost alert without POST", async () => {
    await uncertain();
    const results = await scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: readOnlyFetch(), now: new Date(`${DATE}T21:40:00+08:00`), auditOnly: true });
    expect(results.some(row => row.action === "lost")).toBe(true);
    expect((await loadScheduledLog(DATE, root))[0]?.status).toBe("uncertain");
    expect(JSON.parse(await readFile(join(root, "output", "alerts", `fb-lost-${DATE}-slot1.json`), "utf8")).alert).toBe("FB_LOST");
  });
  it("keeps a future uncertain row instead of deleting and rebooking it", async () => {
    await uncertain();
    const results = await scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl: readOnlyFetch(), now: new Date(`${DATE}T07:00:00+08:00`), auditOnly: true });
    expect(results[0]?.action).toBe("uncertain");
    expect(results[0]?.reason).toBe("audit_only_not_confirmed_yet");
    expect((await loadScheduledLog(DATE, root))).toHaveLength(1);
  });
  it("does not enter the ordinary posting path when no audit rows exist", async () => {
    await seedDay(root, [slotFixture(1, "image", "A74 no scheduled rows"), slotFixture(2, "image", "A74 unused slot")]);
    const fetchImpl = readOnlyFetch();
    const results = await scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now: NOW_DAY_BEFORE, auditOnly: true });
    expect(results).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
