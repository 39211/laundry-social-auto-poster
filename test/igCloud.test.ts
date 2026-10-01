import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { getConfig } from "../src/config";
import { stampDailyContentWrite } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  IG_CLOUD_SCHEMA,
  buildIgCloudSnapshot,
  igCloudDeps,
  igCloudMarkerPath,
  pauseIgCloud,
  pushIgCloudSnapshot,
  readIgCloudMarker,
  releaseIgCloudSnapshots,
  resumeIgCloud,
  syncIgCloudResult,
  type GhResult,
  type GhRunner,
  type IgCloudSnapshot
} from "../src/igCloud";
import { snapshotScheduledDay } from "../src/igCloudBackfill";
import { loadApprovalLog, loadPostLog, writeApprovalLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { loadScheduledLog, scheduleAheadFacebook } from "../src/scheduleAhead";
import type { AppConfig, DailySlot } from "../src/types";

const REPO = "tester/ig-cloud";

function ok(stdout = ""): GhResult {
  return { code: 0, stdout, stderr: "" };
}
function notFound(): GhResult {
  return { code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
}

/** A fake gh CLI over an in-memory repo; records every call. */
function fakeGh(state: { mode?: string; files: Map<string, string>; failPut?: boolean; landOnFailedPut?: boolean }) {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    if (args[0] === "variable" && args[1] === "get") return state.mode === undefined ? notFound() : ok(`${state.mode}\n`);
    if (args[0] === "variable" && args[1] === "set") {
      state.mode = args[args.indexOf("--body") + 1];
      return ok();
    }
    if (args[0] !== "api") return { code: 1, stdout: "", stderr: "unexpected gh call" };
    const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
    const target = args.find((arg) => arg.startsWith(`repos/${REPO}/contents/`)) ?? "";
    const path = target.slice(`repos/${REPO}/contents/`.length);
    const field = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    if (method === "GET") {
      const text = state.files.get(path);
      if (text === undefined) return notFound();
      return ok(JSON.stringify({ sha: `sha-${path}`, content: Buffer.from(text, "utf8").toString("base64") }));
    }
    if (method === "PUT") {
      if (state.failPut) {
        if (state.landOnFailedPut) state.files.set(path, Buffer.from(field("content") ?? "", "base64").toString("utf8"));
        return { code: 1, stdout: "", stderr: "gh: connection reset" };
      }
      state.files.set(path, Buffer.from(field("content") ?? "", "base64").toString("utf8"));
      return ok("{}");
    }
    if (method === "DELETE") {
      state.files.delete(path);
      return ok("{}");
    }
    return { code: 1, stdout: "", stderr: "unexpected method" };
  };
  return { gh, calls };
}

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

async function installCloud(root: string): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "ig-cloud.json"), JSON.stringify({ repo: REPO }), "utf8");
}

function slotFixture(): DailySlot {
  return {
    slot: 2,
    time: "20:30",
    topic: "名牌包發霉,先別自己硬擦",
    format: "image-post",
    media_type: "carousel",
    instagram_caption: "IG 版文案,私訊我們",
    facebook_caption: "FB 版文案,傳 LINE 給我們",
    local_image_path: "docs/assets/2026-10-02/slot-02.png",
    public_image_url: "https://tester.github.io/a/slot-02.png"
  } as unknown as DailySlot;
}

function sampleSnapshot(overrides: Partial<IgCloudSnapshot> = {}): IgCloudSnapshot {
  return {
    ...buildIgCloudSnapshot({
      date: "2026-10-02",
      slot: slotFixture(),
      publishUnix: Math.floor(Date.parse("2026-10-02T20:30:00+08:00") / 1000),
      igMediaType: "carousel",
      imageUrls: ["https://tester.github.io/a/slot-02.png", "https://tester.github.io/a/slot-02-slide-02.png"],
      config: liveConfig(),
      fbScheduledPostId: "fb-sched-9",
      now: new Date("2026-09-29T13:40:00Z")
    }),
    ...overrides
  };
}

afterEach(() => {
  igCloudDeps.gh = async () => ({ code: 1, stdout: "", stderr: "gh not stubbed in this test" });
});

describe("buildIgCloudSnapshot", () => {
  it("carries the Facebook caption, the Facebook queue id and a first comment", () => {
    const snapshot = sampleSnapshot();
    expect(snapshot.schema).toBe(IG_CLOUD_SCHEMA);
    expect(snapshot.caption).toBe("FB 版文案,傳 LINE 給我們");
    expect(snapshot.fb_scheduled_post_id).toBe("fb-sched-9");
    expect(snapshot.first_comment).toContain("go/line.html?source=ig-comment");
    expect(snapshot.video_url).toBeNull();
    expect(snapshot.facebook_page_id).toBe("111000111");
  });

  it("drops image urls for a reel and keeps the video identity", () => {
    const reel = buildIgCloudSnapshot({
      date: "2026-10-02",
      slot: slotFixture(),
      publishUnix: 1,
      igMediaType: "reel",
      imageUrls: ["https://tester.github.io/a/cover.png"],
      videoUrl: "https://tester.github.io/a/slot-02.mp4",
      videoBytes: 50_639_276,
      videoSha256: "8351d117",
      config: liveConfig(),
      fbScheduledPostId: "fb-sched-9"
    });
    expect(reel.image_urls).toEqual([]);
    expect(reel.video_url).toBe("https://tester.github.io/a/slot-02.mp4");
    expect(reel.video_bytes).toBe(50_639_276);
    expect(reel.video_sha256).toBe("8351d117");
  });
});

describe("pushIgCloudSnapshot", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-push-"));
  });

  it("does nothing and calls nothing when the integration is not installed", async () => {
    const { gh, calls } = fakeGh({ mode: "live", files: new Map() });
    const outcome = await pushIgCloudSnapshot(sampleSnapshot(), root, { gh });
    expect(outcome.pushed).toBe(false);
    expect(calls).toEqual([]);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("keeps Instagram on this PC unless the cloud is live", async () => {
    await installCloud(root);
    for (const mode of ["shadow", "off", undefined]) {
      const state = { mode, files: new Map<string, string>() };
      const { gh } = fakeGh(state);
      const outcome = await pushIgCloudSnapshot(sampleSnapshot(), root, { gh });
      expect(outcome.pushed).toBe(false);
      expect(state.files.size).toBe(0);
      expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
    }
  });

  it("pushes the exact snapshot and claims the slot when the cloud is live", async () => {
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>() };
    const { gh } = fakeGh(state);
    const snapshot = sampleSnapshot();
    const outcome = await pushIgCloudSnapshot(snapshot, root, { gh });
    expect(outcome.pushed).toBe(true);
    expect(JSON.parse(state.files.get("queue/2026-10-02-slot2.json") ?? "{}")).toEqual(snapshot);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toEqual(snapshot);
  });

  it("gives the slot back to this PC when the push provably did not land", async () => {
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>(), failPut: true };
    const { gh } = fakeGh(state);
    await expect(pushIgCloudSnapshot(sampleSnapshot(), root, { gh })).rejects.toThrow(/PUT/);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("keeps the slot with the cloud when a failed push actually landed", async () => {
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>(), failPut: true, landOnFailedPut: true };
    const { gh } = fakeGh(state);
    const outcome = await pushIgCloudSnapshot(sampleSnapshot(), root, { gh });
    expect(outcome.pushed).toBe(true);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeDefined();
  });
});

describe("syncIgCloudResult and release", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-sync-"));
    await installCloud(root);
    const { gh } = fakeGh({ mode: "live", files: new Map() });
    await pushIgCloudSnapshot(sampleSnapshot(), root, { gh });
  });

  it("records a published cloud result once, with its first comment", async () => {
    const files = new Map<string, string>([
      [
        "results/2026-10-02-slot2.json",
        JSON.stringify({ date: "2026-10-02", slot: 2, mode: "live", status: "published", post_id: "ig-77", comment_id: "c-9" })
      ]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    const entry = await syncIgCloudResult(root, "2026-10-02", 2, { gh });
    expect(entry).toMatchObject({ platform: "instagram", status: "success", post_id: "ig-77", published_media_type: "carousel" });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh })).toBeUndefined();
    const log = await loadPostLog("2026-10-02", root);
    expect(log.filter((row) => row.platform === "instagram")).toHaveLength(1);
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", "2026-10-02.json"), "utf8"));
    expect(comments).toEqual([expect.objectContaining({ slot: 2, media_id: "ig-77", comment_id: "c-9" })]);
  });

  it("ignores shadow results and missing results", async () => {
    const { gh: missing } = fakeGh({ mode: "live", files: new Map() });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh: missing })).toBeUndefined();
    const files = new Map([
      ["results/2026-10-02-slot2.json", JSON.stringify({ date: "2026-10-02", slot: 2, mode: "shadow", status: "shadow_ok" })]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh })).toBeUndefined();
    // Only a live run's result may count as published, whatever it claims.
    const mislabelled = new Map([
      [
        "results/2026-10-02-slot2.json",
        JSON.stringify({ date: "2026-10-02", slot: 2, mode: "shadow", status: "published", post_id: "not-real" })
      ]
    ]);
    const { gh: shadowGh } = fakeGh({ mode: "live", files: mislabelled });
    expect(await syncIgCloudResult(root, "2026-10-02", 2, { gh: shadowGh })).toBeUndefined();
    expect(await loadPostLog("2026-10-02", root)).toEqual([]);
  });

  it("marks the first comment as the cloud's even before the cloud reports one", async () => {
    // The cloud commits the post first and the comment seconds later. A sync in
    // between must still stop the local first-comment step from adding a second.
    const files = new Map([
      ["results/2026-10-02-slot2.json", JSON.stringify({ date: "2026-10-02", slot: 2, mode: "live", status: "published", post_id: "ig-78" })]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    await syncIgCloudResult(root, "2026-10-02", 2, { gh });
    const comments = JSON.parse(await readFile(join(root, "data", "first-comments", "2026-10-02.json"), "utf8"));
    expect(comments).toEqual([expect.objectContaining({ slot: 2, media_id: "ig-78", comment_id: "cloud" })]);
  });

  it("records an uncertain cloud publish so nothing here posts it again", async () => {
    const files = new Map([
      ["results/2026-10-02-slot2.json", JSON.stringify({ date: "2026-10-02", slot: 2, mode: "live", status: "uncertain", error: "lost" })]
    ]);
    const { gh } = fakeGh({ mode: "live", files });
    const entry = await syncIgCloudResult(root, "2026-10-02", 2, { gh });
    expect(entry?.status).toBe("uncertain");
  });

  it("release hands future slots back and deletes them from the cloud queue", async () => {
    const state = { mode: "live", files: new Map<string, string>([["queue/2026-10-02-slot2.json", "{}"]]) };
    const { gh } = fakeGh(state);
    const { released, failed } = await releaseIgCloudSnapshots(root, { gh, now: new Date("2026-10-01T12:00:00Z") });
    expect(released).toEqual(["2026-10-02-slot2.json"]);
    expect(failed).toEqual([]);
    expect(state.files.has("queue/2026-10-02-slot2.json")).toBe(false);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeUndefined();
  });

  it("release leaves slots whose time has passed", async () => {
    const { gh } = fakeGh({ mode: "live", files: new Map() });
    const { released } = await releaseIgCloudSnapshots(root, { gh, now: new Date("2026-10-03T00:00:00Z") });
    expect(released).toEqual([]);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeDefined();
  });
});

describe("the pause brake reaches the cloud", () => {
  const state = { reason: "老闆看片中", since: "2026-10-01T12:00:00.000Z", paused_by: "owner" };
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ig-cloud-pause-"));
  });

  it("writes PAUSED to the cloud repo and moves no slot", async () => {
    await installCloud(root);
    const { gh } = fakeGh({ mode: "live", files: new Map() });
    await pushIgCloudSnapshot(sampleSnapshot(), root, { gh });
    const repo = { mode: "live", files: new Map<string, string>([["queue/2026-10-02-slot2.json", "{}"]]) };
    const { gh: pauseGh } = fakeGh(repo);
    await pauseIgCloud(root, state, { gh: pauseGh });
    expect(JSON.parse(repo.files.get("PAUSED") ?? "null")).toEqual(state);
    expect(repo.mode).toBe("live");
    expect(repo.files.has("queue/2026-10-02-slot2.json")).toBe(true);
    expect(await readIgCloudMarker(root, "2026-10-02", 2)).toBeDefined();

    await resumeIgCloud(root, { gh: pauseGh });
    expect(repo.files.has("PAUSED")).toBe(false);
    expect(repo.mode).toBe("live");
  });

  it("falls back to switching the cloud off when PAUSED cannot be written", async () => {
    await installCloud(root);
    const repo = { mode: "live", files: new Map<string, string>(), failPut: true };
    const { gh } = fakeGh(repo);
    const message = await pauseIgCloud(root, state, { gh });
    expect(repo.mode).toBe("off");
    expect(message).toContain("CLOUD_MODE");
  });

  it("calls nothing when the integration is not installed", async () => {
    const { gh, calls } = fakeGh({ mode: "live", files: new Map() });
    await pauseIgCloud(root, state, { gh });
    await resumeIgCloud(root, { gh });
    expect(calls).toEqual([]);
  });
});

describe("live publisher with a cloud-owned slot", () => {
  const date = "2026-05-15";
  let root: string;

  beforeEach(async () => {
    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
    vi.stubEnv("FB_PAGE_ID", "123456789012345");
    vi.stubEnv("IG_USER_ID", "12345678901234567");
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
    root = await mkdtemp(join(tmpdir(), "ig-cloud-live-"));
    await generateDailyContent({ date, root, force: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "fake image");
    await approvePost({ date, slot: 1, platforms: ["facebook", "instagram"], approvedBy: "Test", note: "t", root, force: true });
    const entries = await loadApprovalLog(date, root);
    await writeApprovalLog(
      date,
      entries.map((entry) => {
        const { forced: _forced, forced_reasons: _reasons, ...rest } = entry as typeof entry & { forced_reasons?: unknown };
        return rest;
      }),
      root
    );
    // Facebook for slot 1 was queued ahead in Meta; the live run only records it.
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(
      join(root, "data", "scheduled-log", `${date}.json`),
      JSON.stringify([
        {
          date,
          slot: 1,
          platform: "facebook",
          scheduled_post_id: "fb-sched-1",
          scheduled_publish_time: Math.floor(Date.parse(`${date}T11:30:00+08:00`) / 1000),
          published_media_type: "carousel",
          created_at: "2026-05-12T13:40:00.000Z"
        }
      ]),
      "utf8"
    );
    await installCloud(root);
    await mkdir(join(root, "data", "ig-cloud", "queue"), { recursive: true });
    await writeFile(
      igCloudMarkerPath(root, date, 1),
      JSON.stringify(sampleSnapshot({ date, slot: 1, ig_media_type: "carousel" })),
      "utf8"
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never posts Instagram itself while the cloud has not reported", async () => {
    igCloudDeps.gh = fakeGh({ mode: "live", files: new Map() }).gh;
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const results = await postCurrentSlot({ root, date, slot: 1, now: `${date}T11:31:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const instagram = results.find((entry) => entry.platform === "instagram");
    expect(instagram).toMatchObject({ status: "skipped", note: expect.stringContaining("cloud owns Instagram") });
    const log = await loadPostLog(date, root);
    expect(log.map((row) => `${row.platform}:${row.status}`)).toEqual(["facebook:success"]);
  });

  it("records the cloud's post instead of publishing again", async () => {
    const files = new Map([
      [`results/${date}-slot1.json`, JSON.stringify({ date, slot: 1, mode: "live", status: "published", post_id: "ig-cloud-1" })]
    ]);
    igCloudDeps.gh = fakeGh({ mode: "live", files }).gh;
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await postCurrentSlot({ root, date, slot: 1, now: `${date}T11:40:00+08:00`, dryRun: false, verifyPublicImageUrl: false, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const log = await loadPostLog(date, root);
    expect(log.find((row) => row.platform === "instagram")).toMatchObject({ status: "success", post_id: "ig-cloud-1" });
  });
});

describe("schedule-ahead hands Instagram to a live cloud", () => {
  const DATE = "2026-09-21";
  // One day, two image slots, both approved: what schedule-ahead needs.
  async function writeTwoSlotDay(root: string) {
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", DATE, "slot-01.png"), "png-bytes");
    await writeFile(join(root, "docs", "assets", DATE, "slot-02.png"), "png-bytes");
    const slot = {
      slot: 1,
      time: "11:30",
      topic: "排程測試主題 1",
      format: "image-post",
      media_type: "image",
      instagram_caption: "IG caption",
      facebook_caption: "FB caption",
      local_image_path: `docs/assets/${DATE}/slot-01.png`,
      public_image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${DATE}/slot-01.png`
    };
    const slot2 = {
      ...slot,
      slot: 2,
      time: "20:30",
      topic: "排程測試主題 2",
      instagram_caption: "IG caption 2",
      facebook_caption: "FB caption 2",
      local_image_path: `docs/assets/${DATE}/slot-02.png`,
      public_image_url: `https://tester.github.io/laundry-social-auto-poster/assets/${DATE}/slot-02.png`
    };
    await writeFile(
      join(root, "data", "content-calendar", `${DATE}.json`),
      `${JSON.stringify(
        stampDailyContentWrite(
          { date: DATE, timezone: "Asia/Taipei", generated_at: new Date().toISOString(), slots: [slot, slot2] } as Parameters<
            typeof stampDailyContentWrite
          >[0],
          { root }
        ),
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      join(root, "data", "approved-log", `${DATE}.json`),
      JSON.stringify(
        [1, 2].flatMap((n) =>
          (["facebook", "instagram"] as const).map((platform) => ({ date: DATE, slot: n, platform, status: "approved", approved_at: new Date().toISOString() }))
        )
      ),
      "utf8"
    );
    return slot;
  }
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ id: "fb-obj-1", post_id: "fb-post-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

  it("queues Facebook, then pushes the same version for Instagram", async () => {
    const root = await mkdtemp(join(tmpdir(), "ig-cloud-sched-"));
    const slot = await writeTwoSlotDay(root);
    await installCloud(root);
    const state = { mode: "live", files: new Map<string, string>() };
    const { gh } = fakeGh(state);
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl,
      now: new Date("2026-09-20T21:00:00+08:00"),
      igCloud: { gh }
    });
    expect(results).toEqual([
      expect.objectContaining({ slot: 1, action: "scheduled" }),
      expect.objectContaining({ slot: 2, action: "scheduled" })
    ]);
    expect(state.files.has(`queue/${DATE}-slot2.json`)).toBe(true);
    const scheduled = (await loadScheduledLog(DATE, root)).find((row) => row.slot === 1);
    const pushed = JSON.parse(state.files.get(`queue/${DATE}-slot1.json`) ?? "{}") as IgCloudSnapshot;
    expect(pushed).toMatchObject({
      date: DATE,
      slot: 1,
      ig_media_type: "image",
      caption: "FB caption",
      publish_unix: scheduled?.scheduled_publish_time,
      fb_scheduled_post_id: scheduled?.scheduled_post_id,
      image_urls: [slot.public_image_url]
    });
    expect(pushed.backfill).toBeUndefined();
    expect(await readIgCloudMarker(root, DATE, 1)).toEqual(pushed);
  });

  it("backfills a slot Facebook already published, at the given time and never before its own day", async () => {
    const root = await mkdtemp(join(tmpdir(), "ig-cloud-backfill-"));
    await writeTwoSlotDay(root);
    await installCloud(root);
    // The day went into the Facebook queue before the cloud was live.
    const off = { mode: "off", files: new Map<string, string>() };
    await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl,
      now: new Date("2026-09-20T21:00:00+08:00"),
      igCloud: { gh: fakeGh(off).gh }
    });
    expect(off.files.size).toBe(0);

    const repo = { mode: "live", files: new Map<string, string>() };
    const { gh } = fakeGh(repo);
    const after = new Date("2026-09-22T09:00:00+08:00");
    const day = { date: DATE, root, slot: 1, config: liveConfig(), igCloud: { gh } };
    // Slot time has passed: without a backfill time the slot stays here.
    expect(await snapshotScheduledDay({ ...day, now: after })).toEqual([expect.stringContaining("stays on this PC")]);
    // A backfill may not go out before the content's own day.
    expect(
      await snapshotScheduledDay({ ...day, now: new Date("2026-09-20T09:00:00+08:00"), publishAt: new Date("2026-09-20T12:00:00+08:00") })
    ).toEqual([expect.stringContaining("before the slot's own date")]);
    expect(repo.files.size).toBe(0);

    const publishAt = new Date("2026-09-23T12:00:00+08:00");
    expect(await snapshotScheduledDay({ ...day, now: after, publishAt })).toEqual([expect.stringContaining("cloud owns Instagram")]);
    const pushed = JSON.parse(repo.files.get(`queue/${DATE}-slot1.json`) ?? "{}") as IgCloudSnapshot;
    expect(pushed).toMatchObject({ date: DATE, slot: 1, backfill: true, publish_unix: publishAt.getTime() / 1000, caption: "FB caption" });
    expect(await readIgCloudMarker(root, DATE, 1)).toEqual(pushed);
  });
});
