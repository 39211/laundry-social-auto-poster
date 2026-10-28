import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stampDailyContentWrite } from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import { approvePost } from "../src/approvePost";
import {
  loadApprovalLog,
  loadDailyContent,
  loadPostLog,
  writeApprovalLog,
  writeJsonAtomic
} from "../src/logging";
import { scheduledLogPath } from "../src/paths";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { buildShortMetadata, scheduleYouTubeShort, uploadShort } from "../src/postYouTube";
import { getSlotPublishTime } from "../src/publishTimes";
import {
  extractPublishHashtags,
  publishListFilePath,
  readPublishList,
  recordSuccessfulPublish,
  type SuccessfulPublishInput
} from "../src/publishList";
import { recordVideoReview } from "../src/videoReviewGate";

const ROW_KEYS = ["topic", "platform", "published_at", "slot", "title", "hashtags", "link"];

function baseRecord(overrides: Partial<SuccessfulPublishInput> = {}): SuccessfulPublishInput {
  return {
    status: "success",
    root: overrides.root ?? "",
    date: "2026-10-06",
    slot: 1,
    topic: "白鞋泛黃",
    platform: "facebook",
    publishedAt: "2026-10-06T06:12:00.000Z",
    caption: "  第一行標題  \r\n第二行 #台中洗衣店 #西屯洗鞋。\n#私享家洗衣店 #台中洗衣店",
    dryRun: false,
    postId: "123456789012345_9876543210",
    mediaType: "image",
    ...overrides
  };
}

async function seedPublishTime(root: string, date: string, slot: number, time: string): Promise<void> {
  const file = join(root, "data", "publish-times", `${date}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ date, slots: [{ slot, time }] }, null, 2)}\n`,
    "utf8"
  );
}

describe("publish list row", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "publish-list-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("extracts hashtags from caption text without changing that text", () => {
    const caption = "  第一行標題  \r\n第二行 #台中洗衣店 #西屯洗鞋。\n#私享家洗衣店 #台中洗衣店";
    expect(extractPublishHashtags(caption)).toEqual(["#台中洗衣店", "#西屯洗鞋", "#私享家洗衣店"]);
    expect(caption).toBe("  第一行標題  \r\n第二行 #台中洗衣店 #西屯洗鞋。\n#私享家洗衣店 #台中洗衣店");
  });

  it("appends one live row whose slot time comes from getSlotPublishTime", async () => {
    await seedPublishTime(root, "2026-10-06", 1, "14:12");
    const caption = baseRecord().caption;
    await recordSuccessfulPublish(baseRecord({ root }));

    const rows = await readPublishList(root, false);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {})).toEqual(ROW_KEYS);
    expect(rows[0]).not.toHaveProperty("hook");
    expect(getSlotPublishTime("2026-10-06", 1, root)).toBe("14:12");
    expect(rows[0]).toEqual({
      topic: "白鞋泛黃",
      platform: "facebook",
      published_at: "2026-10-06T06:12:00.000Z",
      slot: "1 14:12",
      title: "第一行標題",
      hashtags: ["#台中洗衣店", "#西屯洗鞋", "#私享家洗衣店"],
      link: "https://www.facebook.com/123456789012345/posts/9876543210"
    });
    expect(rows[0]?.slot).not.toBe("1 11:30");
    expect(caption).toBe(baseRecord().caption);

    await recordSuccessfulPublish(
      baseRecord({
        root,
        platform: "instagram",
        caption: "IG 第一行\n#只在IG",
        postId: "17890000000000001",
        publishedAt: "2026-10-06T06:13:00.000Z"
      })
    );
    const raw = await readFile(publishListFilePath(root, false), "utf8");
    expect(() => JSON.parse(raw)).toThrow();
    const appended = await readPublishList(root, false);
    expect(appended).toHaveLength(2);
    expect(appended[0]?.platform).toBe("facebook");
    expect(appended[1]).toMatchObject({
      platform: "instagram",
      title: "IG 第一行",
      hashtags: ["#只在IG"],
      link: ""
    });
    expect(await readPublishList(root, true)).toEqual([]);
  });

  it("uses the YouTube title and builds a Shorts link only from a video id", async () => {
    await seedPublishTime(root, "2026-10-06", 2, "16:40");
    const caption = "描述第一行不是標題\n\n#白鞋測試標籤";
    await recordSuccessfulPublish(
      baseRecord({
        root,
        slot: 2,
        platform: "youtube",
        topic: "白鞋鞋邊泛灰",
        caption,
        youtubeTitle: "白鞋鞋邊泛灰｜台中洗鞋洗包 免費收送 #Shorts",
        postId: "abcdefghijk",
        mediaType: "reel",
        publishedAt: "2026-10-06T12:40:00.000Z"
      })
    );

    expect(await readPublishList(root, false)).toEqual([
      {
        topic: "白鞋鞋邊泛灰",
        platform: "youtube",
        published_at: "2026-10-06T12:40:00.000Z",
        slot: "2 16:40",
        title: "白鞋鞋邊泛灰｜台中洗鞋洗包 免費收送 #Shorts",
        hashtags: ["#白鞋測試標籤"],
        link: "https://www.youtube.com/shorts/abcdefghijk"
      }
    ]);
    expect(caption.startsWith("描述第一行不是標題")).toBe(true);
  });

  it("leaves the link empty when the id cannot form a public url", async () => {
    await recordSuccessfulPublish(baseRecord({ root, postId: "yt-vid-1", platform: "youtube", youtubeTitle: "標題", mediaType: "reel" }));
    await recordSuccessfulPublish(baseRecord({ root, postId: "99887766", platform: "facebook", mediaType: "image" }));
    await recordSuccessfulPublish(baseRecord({ root, postId: "dry-run-facebook-2026-10-06-1" }));
    await recordSuccessfulPublish(baseRecord({ root, postId: "  ", platform: "instagram" }));
    await recordSuccessfulPublish(baseRecord({ root, postId: undefined, platform: "instagram" }));

    const links = (await readPublishList(root, false)).map((row) => row.link);
    expect(links).toEqual(["", "", "", "", ""]);
  });

  it("builds a Facebook Reel url from a numeric video id", async () => {
    await recordSuccessfulPublish(
      baseRecord({ root, postId: "99887766", platform: "facebook", mediaType: "reel" })
    );
    expect((await readPublishList(root, false))[0]?.link).toBe("https://www.facebook.com/reel/99887766");
  });

  it("writes a dry-run success only under the temp folder", async () => {
    await recordSuccessfulPublish(baseRecord({ root, dryRun: true, postId: "dry-run-facebook-2026-10-06-1" }));
    const dryPath = publishListFilePath(root, true);
    const livePath = publishListFilePath(root, false);
    expect(dryPath.startsWith(tmpdir())).toBe(true);
    expect(dryPath.startsWith(root)).toBe(false);
    expect(livePath).toBe(join(root, "data", "publish-list.jsonl"));
    expect((await readPublishList(root, true)).map((row) => row.platform)).toEqual(["facebook"]);
    await expect(stat(livePath)).rejects.toThrow();
  });

  it("defaults an omitted dry-run flag to the temp folder", async () => {
    const input = baseRecord({ root });
    delete input.dryRun;
    await recordSuccessfulPublish(input);
    expect(await readPublishList(root, true)).toHaveLength(1);
    await expect(stat(publishListFilePath(root, false))).rejects.toThrow();
  });

  it("does not write uncertain, failed, skipped, or out-of-scope platforms", async () => {
    for (const status of ["uncertain", "failed", "skipped", "pending", "dry_run"]) {
      await recordSuccessfulPublish(baseRecord({ root, status }));
    }
    await recordSuccessfulPublish(baseRecord({ root, status: "scheduled", platform: "facebook" }));
    await recordSuccessfulPublish(baseRecord({ root, status: "success", platform: "tiktok" }));
    await recordSuccessfulPublish(baseRecord({ root, status: "success", platform: "x" }));
    await recordSuccessfulPublish(baseRecord({ root, status: "posted", platform: "instagram", postId: "1789" }));
    await recordSuccessfulPublish(
      baseRecord({
        root,
        status: "scheduled",
        platform: "youtube",
        youtubeTitle: "排程標題",
        postId: "abcdefghijk",
        mediaType: "reel"
      })
    );

    const rows = await readPublishList(root, false);
    expect(rows.map((row) => row.platform)).toEqual(["instagram", "youtube"]);
    expect(rows[0]?.title).toBe("第一行標題");
    expect(rows[0]).not.toHaveProperty("hook");
    expect(rows[1]?.title).toBe("排程標題");
    expect(rows[1]?.link).toBe("https://www.youtube.com/shorts/abcdefghijk");
  });

  it("logs one publish-list write failure and does not throw or retry", async () => {
    await mkdir(join(root, "data", "publish-list.jsonl"), { recursive: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const started = Date.now();
    await expect(recordSuccessfulPublish(baseRecord({ root }))).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(400);
    const listWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("publish-list"));
    expect(listWarnings).toHaveLength(1);
    expect((await stat(join(root, "data", "publish-list.jsonl"))).isDirectory()).toBe(true);
  });

  it("does not invent a slot time when getSlotPublishTime cannot answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(recordSuccessfulPublish(baseRecord({ root, slot: 9 }))).resolves.toBeUndefined();
    expect(await readPublishList(root, false)).toEqual([]);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("publish-list"))).toHaveLength(1);
  });

  it("does not read DAILY_SCHEDULE itself", async () => {
    const source = await readFile(new URL("../src/publishList.ts", import.meta.url), "utf8");
    expect(source).not.toContain("DAILY_SCHEDULE");
  });
});

const SLOT_DATE = "2026-05-15";

async function approveSlot(root: string, date: string, slot = 1): Promise<void> {
  await approvePost({
    date,
    slot,
    platforms: ["facebook", "instagram"],
    approvedBy: "Test",
    note: "Test approval",
    root,
    force: true
  });
  const entries = await loadApprovalLog(date, root);
  await writeApprovalLog(
    date,
    entries.map((entry) =>
      entry.slot === slot && entry.forced === true
        ? {
            date: entry.date,
            slot: entry.slot,
            platform: entry.platform,
            status: entry.status,
            approved_by: entry.approved_by,
            note: entry.note,
            created_at: entry.created_at
          }
        : entry
    ),
    root
  );
}

async function seedCurrentSlot(root: string): Promise<void> {
  await generateDailyContent({ date: SLOT_DATE, root, force: true });
  await mkdir(join(root, "docs", "assets", SLOT_DATE), { recursive: true });
  await writeFile(join(root, "docs", "assets", SLOT_DATE, "slot-01.png"), "fake image");
  await approveSlot(root, SLOT_DATE);
  await seedPublishTime(root, SLOT_DATE, 1, "14:12");
}

function liveMetaEnv(): void {
  vi.stubEnv("DRY_RUN", "false");
  vi.stubEnv("META_ACCESS_TOKEN", "EAAabcdefghijklmnopqrstuvwxyz1234567890");
  vi.stubEnv("FB_PAGE_ID", "123456789012345");
  vi.stubEnv("IG_USER_ID", "12345678901234567");
  vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function liveFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/photos")) {
      return jsonResponse({ post_id: "123456789012345_9876543210" });
    }
    if (url.endsWith("/media_publish")) return jsonResponse({ id: "17890000000000001" });
    if (url.includes("status_code")) return jsonResponse({ status_code: "FINISHED" });
    if (url.includes("/media")) return jsonResponse({ id: "ig-container-1" });
    return jsonResponse({ error: { message: `unexpected ${url}` } }, 500);
  }) as typeof fetch;
}

describe("postCurrentSlot publish list", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("DRY_RUN", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("appends dry-run rows only in temp and leaves posted-log format unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "publish-list-dry-"));
    await seedCurrentSlot(root);
    const calendarPath = join(root, "data", "content-calendar", `${SLOT_DATE}.json`);
    const calendarBefore = await readFile(calendarPath, "utf8");
    const content = await loadDailyContent(SLOT_DATE, root);
    const slot = content?.slots.find((item) => item.slot === 1);
    expect(slot?.time).toBe("11:30");
    expect(getSlotPublishTime(SLOT_DATE, 1, root)).toBe("14:12");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const first = await postCurrentSlot({
      root,
      date: SLOT_DATE,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    const second = await postCurrentSlot({
      root,
      date: SLOT_DATE,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });

    expect(first.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(second.map((entry) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(fetchImpl).not.toHaveBeenCalled();

    const postedRaw = await readFile(join(root, "data", "posted-log", `${SLOT_DATE}.json`), "utf8");
    expect(postedRaw.trimStart().startsWith("[")).toBe(true);
    const posted = JSON.parse(postedRaw) as Array<Record<string, unknown>>;
    expect(posted).toHaveLength(2);
    for (const entry of posted) {
      expect(entry.status).toBe("success");
      expect(entry.dry_run).toBe(true);
      expect(entry).not.toHaveProperty("topic");
      expect(entry).not.toHaveProperty("title");
      expect(entry).not.toHaveProperty("hashtags");
      expect(entry).not.toHaveProperty("link");
      expect(entry).not.toHaveProperty("published_at");
      expect(entry).not.toHaveProperty("hook");
    }

    const rows = await readPublishList(root, true);
    expect(rows.map((row) => row.platform)).toEqual(["facebook", "instagram"]);
    expect(rows.map((row) => row.slot)).toEqual(["1 14:12", "1 14:12"]);
    expect(rows.map((row) => row.topic)).toEqual([slot?.topic, slot?.topic]);
    expect(rows.map((row) => row.title)).toEqual([
      (slot?.facebook_caption.split(/\r?\n/u)[0] ?? "").trim(),
      (slot?.instagram_caption.split(/\r?\n/u)[0] ?? "").trim()
    ]);
    expect(rows[0]?.hashtags).toEqual(extractPublishHashtags(slot?.facebook_caption ?? ""));
    expect(rows[1]?.hashtags).toEqual(extractPublishHashtags(slot?.instagram_caption ?? ""));
    expect(rows[0]?.hashtags).toContain("#私享家洗衣店");
    expect(rows.every((row) => row.link === "")).toBe(true);
    expect(rows.every((row) => Object.keys(row).join(",") === ROW_KEYS.join(","))).toBe(true);
    expect(rows.map((row) => row.published_at)).toEqual(posted.map((entry) => entry.created_at));
    await expect(stat(publishListFilePath(root, false))).rejects.toThrow();
    expect(await readFile(calendarPath, "utf8")).toBe(calendarBefore);
    await rm(root, { recursive: true, force: true });
  });

  it("keeps a dry-run publish successful when the temp list cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "publish-list-dry-fail-"));
    await seedCurrentSlot(root);
    await mkdir(publishListFilePath(root, true), { recursive: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const started = Date.now();
    const results = await postCurrentSlot({
      root,
      date: SLOT_DATE,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await loadPostLog(SLOT_DATE, root)).map((entry) => entry.status)).toEqual(["success", "success"]);
    const listWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("publish-list"));
    expect(listWarnings).toHaveLength(2);
    await rm(root, { recursive: true, force: true });
  });

  it("writes live rows for a confirmed Facebook schedule and the Instagram publish", async () => {
    liveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "publish-list-live-"));
    await seedCurrentSlot(root);
    await writeJsonAtomic(scheduledLogPath(SLOT_DATE, root), [
      {
        date: SLOT_DATE,
        slot: 1,
        platform: "facebook",
        scheduled_post_id: "123456789012345_9876543210",
        scheduled_publish_time: 1,
        published_media_type: "image",
        created_at: "2026-05-15T00:00:00.000Z"
      }
    ]);
    const fetchImpl = vi.fn(liveFetch());
    const results = await postCurrentSlot({
      root,
      date: SLOT_DATE,
      slot: 1,
      now: "2026-05-15T14:12:00+08:00",
      dryRun: false,
      verifyPublicImageUrl: false,
      fetchImpl
    });
    expect(results.map((entry) => entry.status)).toEqual(["success", "success"]);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes("/photos"))).toBe(false);
    const rows = await readPublishList(root, false);
    expect(rows.map((row) => row.platform)).toEqual(["facebook", "instagram"]);
    expect(rows[0]?.link).toBe("https://www.facebook.com/123456789012345/posts/9876543210");
    expect(rows[0]?.slot).toBe("1 14:12");
    expect(rows[1]?.link).toBe("");
    expect(await readPublishList(root, true)).toEqual([]);
    const posted = await loadPostLog(SLOT_DATE, root);
    expect(posted.every((entry) => !("hashtags" in entry) && !("link" in entry))).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("does not list an uncertain Facebook schedule or a failed Instagram publish", async () => {
    liveMetaEnv();
    const root = await mkdtemp(join(tmpdir(), "publish-list-uncertain-"));
    await seedCurrentSlot(root);
    await writeJsonAtomic(scheduledLogPath(SLOT_DATE, root), [
      {
        date: SLOT_DATE,
        slot: 1,
        platform: "facebook",
        scheduled_post_id: "",
        scheduled_publish_time: 1,
        published_media_type: "image",
        status: "uncertain",
        error: "response lost",
        created_at: "2026-05-15T00:00:00.000Z"
      }
    ]);
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "nope" } }, 500)) as unknown as typeof fetch;
    await expect(
      postCurrentSlot({
        root,
        date: SLOT_DATE,
        slot: 1,
        now: "2026-05-15T14:12:00+08:00",
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    ).rejects.toThrow();
    const posted = await loadPostLog(SLOT_DATE, root);
    expect(posted.map((entry) => `${entry.platform}:${entry.status}`)).toEqual([
      "facebook:uncertain",
      "instagram:failed"
    ]);
    expect(await readPublishList(root, false)).toEqual([]);
    expect(await readPublishList(root, true)).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });
});

const YT_DATE = "2026-08-29";
const YT_NOW = new Date("2026-08-26T21:40:00+08:00");
const YT_PROMPT = "one action only";
const CRED_KEYS = ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"] as const;

function setYouTubeCredentials(): void {
  for (const key of CRED_KEYS) process.env[key] = `test-${key.toLowerCase()}`;
}

function youtubeMetadata(body: unknown): { snippet: { title: string; description: string } } {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
  const start = text.indexOf('{"snippet"');
  if (start < 0) throw new Error("missing youtube metadata");
  const end = text.indexOf("\r\n--", start);
  return JSON.parse(text.slice(start, end)) as { snippet: { title: string; description: string } };
}

async function seedYouTubeSlot(root: string, time = "20:30"): Promise<void> {
  const slot = {
    slot: 2,
    time,
    category: "情境文",
    topic: "白鞋鞋邊泛灰",
    format: "reel",
    media_type: "reel",
    instagram_caption: "文案第一行不是片名\n\n#白鞋測試標籤",
    facebook_caption: "文案第一行不是片名\n\n#白鞋測試標籤",
    image_prompt: "prompt",
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending",
    local_image_path: `docs/assets/${YT_DATE}/slot-02.png`,
    public_image_url: `https://sixiangjialaundry.com/assets/${YT_DATE}/slot-02.png`,
    local_video_path: `docs/assets/${YT_DATE}/slot-02.mp4`,
    public_video_url: `https://sixiangjialaundry.com/assets/${YT_DATE}/slot-02.mp4`,
    video_prompt: YT_PROMPT
  };
  await mkdir(join(root, "docs", "assets", YT_DATE), { recursive: true });
  await writeFile(join(root, "docs", "assets", YT_DATE, "slot-02.mp4"), "video-bytes", "utf8");
  await writeFile(join(root, "docs", "assets", YT_DATE, "slot-02.png"), "png-bytes", "utf8");
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${YT_DATE}.json`),
    `${JSON.stringify(
      stampDailyContentWrite(
        {
          date: YT_DATE,
          timezone: "Asia/Taipei",
          generated_at: "2026-08-26T00:00:00.000Z",
          slots: [slot, { ...slot, slot: 1, time: "11:30", media_type: "image", format: "image-post", local_video_path: undefined, public_video_url: undefined, video_prompt: undefined }]
        } as unknown as Parameters<typeof stampDailyContentWrite>[0],
        { root }
      ),
      null,
      2
    )}\n`,
    "utf8"
  );
}

describe("YouTube publish list", () => {
  let root: string;
  const saved: Partial<Record<(typeof CRED_KEYS)[number], string | undefined>> = {};

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "publish-list-yt-"));
    for (const key of CRED_KEYS) saved[key] = process.env[key];
    setYouTubeCredentials();
  });

  afterEach(async () => {
    for (const key of CRED_KEYS) {
      const previous = saved[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("does not write a list row for a YouTube dry-run", async () => {
    await seedYouTubeSlot(root);
    await writeJsonAtomic(join(root, "data", "posted-log", `${YT_DATE}.json`), [
      {
        date: YT_DATE,
        slot: 2,
        platform: "instagram",
        status: "success",
        dry_run: false,
        attempts: 1,
        published_media_type: "reel",
        created_at: YT_NOW.toISOString()
      }
    ]);
    const result = await uploadShort({ date: YT_DATE, slot: 2, root, fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(result).toEqual({ status: "dry_run" });
    expect(await readPublishList(root, false)).toEqual([]);
    expect(await readPublishList(root, true)).toEqual([]);
  });

  it("appends one live YouTube row from the uploaded title and description", async () => {
    await seedYouTubeSlot(root);
    await seedPublishTime(root, YT_DATE, 2, "16:40");
    await writeJsonAtomic(join(root, "data", "posted-log", `${YT_DATE}.json`), [
      {
        date: YT_DATE,
        slot: 2,
        platform: "instagram",
        status: "success",
        dry_run: false,
        attempts: 1,
        published_media_type: "reel",
        created_at: YT_NOW.toISOString()
      }
    ]);
    const calendarPath = join(root, "data", "content-calendar", `${YT_DATE}.json`);
    const calendarBefore = await readFile(calendarPath, "utf8");
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body });
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "yt-test-token" });
      if (url.includes("googleapis.com/upload/youtube")) return jsonResponse({ id: "abcdefghijk" });
      return jsonResponse({ error: "unexpected" }, 500);
    }) as typeof fetch;

    const result = await uploadShort({ date: YT_DATE, slot: 2, root, fetchImpl, live: true });
    const again = await uploadShort({ date: YT_DATE, slot: 2, root, fetchImpl, live: true });
    expect("video_id" in result && result.video_id).toBe("abcdefghijk");
    expect(again).toEqual({ skipped: `already uploaded for ${YT_DATE} slot 2` });
    expect(calls.filter((call) => call.url.includes("/upload/youtube"))).toHaveLength(1);

    const metadata = buildShortMetadata({
      topic: "白鞋鞋邊泛灰",
      caption: "文案第一行不是片名\n\n#白鞋測試標籤",
      date: YT_DATE,
      slot: 2
    });
    const uploaded = youtubeMetadata(calls.find((call) => call.url.includes("/upload/youtube"))?.body);
    expect(uploaded.snippet.description).toBe(metadata.description);
    expect(uploaded.snippet.description).toContain("#白鞋測試標籤");
    expect(uploaded.snippet.description).toContain("#Shorts");

    const youtubeLog = JSON.parse(
      await readFile(join(root, "data", "youtube-log", `${YT_DATE}.json`), "utf8")
    ) as Array<Record<string, unknown>>;
    expect(youtubeLog).toHaveLength(1);
    expect(youtubeLog[0]).not.toHaveProperty("hashtags");
    expect(youtubeLog[0]).not.toHaveProperty("topic");
    expect(youtubeLog[0]).not.toHaveProperty("link");
    expect(youtubeLog[0]).not.toHaveProperty("published_at");
    expect(youtubeLog[0]).not.toHaveProperty("hook");

    const rows = await readPublishList(root, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      topic: "白鞋鞋邊泛灰",
      platform: "youtube",
      published_at: youtubeLog[0]?.uploaded_at,
      slot: "2 16:40",
      title: metadata.title,
      hashtags: extractPublishHashtags(metadata.description),
      link: "https://www.youtube.com/shorts/abcdefghijk"
    });
    expect(rows[0]?.title).not.toBe("文案第一行不是片名");
    expect(rows[0]?.hashtags).toEqual(expect.arrayContaining(["#白鞋測試標籤", "#Shorts"]));
    expect(rows[0]?.slot).not.toBe("2 20:30");
    expect(await readFile(calendarPath, "utf8")).toBe(calendarBefore);
    expect(await readPublishList(root, true)).toEqual([]);
  });

  it("still returns the uploaded video when the list write fails", async () => {
    await seedYouTubeSlot(root);
    await writeJsonAtomic(join(root, "data", "posted-log", `${YT_DATE}.json`), [
      {
        date: YT_DATE,
        slot: 2,
        platform: "instagram",
        status: "success",
        dry_run: false,
        attempts: 1,
        published_media_type: "reel",
        created_at: YT_NOW.toISOString()
      }
    ]);
    await mkdir(join(root, "data", "publish-list.jsonl"), { recursive: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "yt-test-token" });
      if (url.includes("googleapis.com/upload/youtube")) return jsonResponse({ id: "abcdefghijk" });
      return jsonResponse({ error: "unexpected" }, 500);
    }) as typeof fetch;
    const result = await uploadShort({ date: YT_DATE, slot: 2, root, fetchImpl, live: true });
    expect("video_id" in result && result.video_id).toBe("abcdefghijk");
    expect(calls.filter((url) => url.includes("/upload/youtube"))).toHaveLength(1);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("publish-list"))).toHaveLength(1);
  });

  it("records a scheduled YouTube upload without moving its publishAt off the calendar time", async () => {
    await seedYouTubeSlot(root, "20:30");
    await seedPublishTime(root, YT_DATE, 2, "16:40");
    const approvals = [1, 2].flatMap((slot) =>
      (["facebook", "instagram"] as const).map((platform) => ({
        date: YT_DATE,
        slot,
        platform,
        status: "approved" as const,
        approved_by: "test",
        created_at: YT_NOW.toISOString()
      }))
    );
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await writeFile(join(root, "data", "approved-log", `${YT_DATE}.json`), JSON.stringify(approvals), "utf8");
    await recordVideoReview({ date: YT_DATE, slot: 2, reviewRound: 1, root, now: YT_NOW });
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body });
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "yt-test-token" });
      if (url.includes("googleapis.com/upload/youtube")) return jsonResponse({ id: "abcdefghijk" });
      return jsonResponse({ error: "unexpected" }, 500);
    }) as typeof fetch;

    const result = await scheduleYouTubeShort({
      date: YT_DATE,
      slot: 2,
      root,
      now: YT_NOW,
      fetchImpl,
      live: true
    });
    expect(result.status).toBe("scheduled");
    expect(result.scheduled_publish_at).toBe("2026-08-29T13:15:00Z");
    const uploaded = youtubeMetadata(calls.find((call) => call.url.includes("/upload/youtube"))?.body);
    expect(uploaded.snippet.description).toContain("#白鞋測試標籤");
    const rows = await readPublishList(root, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform).toBe("youtube");
    expect(rows[0]?.slot).toBe("2 16:40");
    expect(rows[0]?.title).toBe(uploaded.snippet.title);
    expect(rows[0]?.hashtags).toEqual(extractPublishHashtags(uploaded.snippet.description));
    expect(rows[0]?.link).toBe("https://www.youtube.com/shorts/abcdefghijk");
  });
});
