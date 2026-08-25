import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stampDailyContentWrite } from "../src/contentPlan";
import { writeJsonAtomic } from "../src/logging";
import { scheduleYouTubeShort, uploadShort } from "../src/postYouTube";
import { recordVideoReview } from "../src/videoReviewGate";

const DATE = "2026-08-29";
const NOW_D3 = new Date("2026-08-26T21:40:00+08:00");
const PROMPT = "one action only";

interface CapturedCall {
  url: string;
  body?: unknown;
}

function fakeFetch(calls: CapturedCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body });
    const respond = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("oauth2.googleapis.com/token")) {
      return respond({ access_token: "yt-test-token" });
    }
    if (url.includes("googleapis.com/upload/youtube")) {
      return respond({ id: "yt-vid-1" });
    }
    return new Response(JSON.stringify({ error: "unexpected url" }), { status: 500 });
  }) as typeof fetch;
}

function metadataFromUpload(calls: CapturedCall[]): {
  snippet: { title: string; description: string };
  status: {
    privacyStatus?: string;
    publishAt?: string;
    selfDeclaredMadeForKids?: boolean;
    containsSyntheticMedia?: boolean;
  };
} {
  const upload = calls.find((call) => String(call.url).includes("/upload/youtube"));
  expect(upload, "expected a YouTube upload HTTP call").toBeDefined();
  const raw = upload!.body;
  const text = Buffer.isBuffer(raw)
    ? raw.toString("utf8")
    : typeof raw === "string"
      ? raw
      : Buffer.from(raw as ArrayBuffer).toString("utf8");
  const start = text.indexOf("\r\n\r\n") + 4;
  const end = text.indexOf("\r\n--", start);
  return JSON.parse(text.slice(start, end)) as ReturnType<typeof metadataFromUpload>;
}

function httpCount(calls: CapturedCall[]): number {
  return calls.length;
}

const CRED_KEYS = ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"] as const;
const savedCreds: Partial<Record<(typeof CRED_KEYS)[number], string | undefined>> = {};

function setTestCredentials(): void {
  for (const key of CRED_KEYS) {
    savedCreds[key] = process.env[key];
    process.env[key] = `test-${key.toLowerCase()}`;
  }
}

function restoreCredentials(): void {
  for (const key of CRED_KEYS) {
    const previous = savedCreds[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

function slotShape(input: {
  slot: number;
  time: string;
  mediaType: "reel" | "mixed-carousel" | "image";
  video?: boolean;
}): Record<string, unknown> {
  const padded = String(input.slot).padStart(2, "0");
  return {
    slot: input.slot,
    time: input.time,
    category: "情境文",
    topic: "白鞋鞋邊泛灰",
    format: input.mediaType === "image" ? "image-post" : "reel",
    media_type: input.mediaType,
    instagram_caption: `測試 Reel 文案 ${DATE} slot ${input.slot}`,
    facebook_caption: `測試 Reel 文案 ${DATE} slot ${input.slot}`,
    image_prompt: "prompt",
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending",
    local_image_path: `docs/assets/${DATE}/slot-${padded}.png`,
    public_image_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-${padded}.png`,
    ...(input.video
      ? {
          local_video_path: `docs/assets/${DATE}/slot-${padded}.mp4`,
          public_video_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-${padded}.mp4`,
          video_prompt: PROMPT
        }
      : {})
  };
}

async function seedCalendar(
  root: string,
  slots: Array<ReturnType<typeof slotShape>>
): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  for (const slot of slots) {
    const videoRel = slot.local_video_path;
    if (typeof videoRel === "string") {
      await writeFile(join(root, ...videoRel.split("/")), `video-bytes-${slot.slot}`, "utf8");
    }
    const imageRel = slot.local_image_path;
    if (typeof imageRel === "string") {
      await writeFile(join(root, ...imageRel.split("/")), "png-bytes", "utf8");
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
        } as unknown as Parameters<typeof stampDailyContentWrite>[0],
        { root }
      ),
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function seedApprovals(root: string, slots: number[]): Promise<void> {
  const approvals = slots.flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date: DATE,
      slot,
      platform,
      status: "approved",
      approved_by: "test",
      created_at: new Date().toISOString()
    }))
  );
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  await writeFile(join(root, "data", "approved-log", `${DATE}.json`), JSON.stringify(approvals), "utf8");
}

async function seedReview(root: string, slot: number): Promise<void> {
  await recordVideoReview({
    date: DATE,
    slot,
    reviewRound: 1,
    root,
    now: NOW_D3
  });
}

describe("scheduleYouTubeShort", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yt-sched-ahead-"));
    setTestCredentials();
  });

  afterEach(() => {
    restoreCredentials();
  });

  it("R9-1: ahead body is private and pins Taipei 11:30 + 45min as 2026-08-29T04:15:00Z", async () => {
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "reel", video: true }),
      slotShape({ slot: 2, time: "20:30", mediaType: "image" })
    ]);
    await seedApprovals(root, [1, 2]);
    await seedReview(root, 1);
    const calls: CapturedCall[] = [];
    const result = await scheduleYouTubeShort({
      date: DATE,
      slot: 1,
      root,
      now: NOW_D3,
      fetchImpl: fakeFetch(calls)
    });
    expect(result.status).toBe("scheduled");
    expect(result.scheduled_publish_at).toBe("2026-08-29T04:15:00Z");
    const metadata = metadataFromUpload(calls);
    expect(metadata.status.privacyStatus).toBe("private");
    expect(metadata.status.publishAt).toBe("2026-08-29T04:15:00Z");
    expect(metadata.status.selfDeclaredMadeForKids).toBe(false);
    expect(metadata.status.containsSyntheticMedia).toBe(true);
    expect(metadata.status).toEqual({
      privacyStatus: "private",
      publishAt: "2026-08-29T04:15:00Z",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true
    });
  });

  it("R9-2: live public path has no publishAt", async () => {
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "reel", video: true }),
      slotShape({ slot: 2, time: "20:30", mediaType: "image" })
    ]);
    await writeJsonAtomic(join(root, "data", "posted-log", `${DATE}.json`), [
      {
        date: DATE,
        slot: 1,
        platform: "instagram",
        status: "success",
        dry_run: false,
        attempts: 1,
        published_media_type: "reel",
        created_at: NOW_D3.toISOString()
      }
    ]);
    const calls: CapturedCall[] = [];
    const result = await uploadShort({
      date: DATE,
      slot: 1,
      root,
      fetchImpl: fakeFetch(calls)
    });
    expect("skipped" in result).toBe(false);
    const metadata = metadataFromUpload(calls);
    expect(metadata.status.privacyStatus).toBe("public");
    expect(metadata.status.publishAt).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(metadata.status, "publishAt")).toBe(false);
    expect(metadata.status.containsSyntheticMedia).toBe(true);
  });

  it("R9-3: existing youtube-log entry makes zero HTTP calls", async () => {
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "reel", video: true }),
      slotShape({ slot: 2, time: "20:30", mediaType: "image" })
    ]);
    await seedApprovals(root, [1, 2]);
    await seedReview(root, 1);
    await writeJsonAtomic(join(root, "data", "youtube-log", `${DATE}.json`), [
      {
        date: DATE,
        slot: 1,
        video_id: "already-there",
        title: "prior",
        uploaded_at: NOW_D3.toISOString(),
        scheduled_publish_at: "2026-08-29T04:15:00Z",
        video_status: "scheduled"
      }
    ]);
    const calls: CapturedCall[] = [];
    const result = await scheduleYouTubeShort({
      date: DATE,
      slot: 1,
      root,
      now: NOW_D3,
      fetchImpl: fakeFetch(calls)
    });
    expect(result).toEqual({ status: "skipped", reason: "already uploaded or scheduled" });
    expect(httpCount(calls)).toBe(0);
  });

  it("R9-4: missing video review skips and makes zero HTTP calls", async () => {
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "reel", video: true }),
      slotShape({ slot: 2, time: "20:30", mediaType: "image" })
    ]);
    await seedApprovals(root, [1, 2]);
    const calls: CapturedCall[] = [];
    const result = await scheduleYouTubeShort({
      date: DATE,
      slot: 1,
      root,
      now: NOW_D3,
      fetchImpl: fakeFetch(calls)
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/video review/i);
    expect(httpCount(calls)).toBe(0);
  });

  it("R9-5: Taipei 11:30 and 20:30 convert to exact UTC publishAt", async () => {
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "reel", video: true }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedApprovals(root, [1, 2]);
    await seedReview(root, 1);
    await seedReview(root, 2);

    const morningCalls: CapturedCall[] = [];
    const morning = await scheduleYouTubeShort({
      date: DATE,
      slot: 1,
      root,
      now: NOW_D3,
      fetchImpl: fakeFetch(morningCalls)
    });
    expect(morning.status).toBe("scheduled");
    expect(morning.scheduled_publish_at).toBe("2026-08-29T04:15:00Z");
    expect(metadataFromUpload(morningCalls).status.publishAt).toBe("2026-08-29T04:15:00Z");

    const eveningCalls: CapturedCall[] = [];
    const evening = await scheduleYouTubeShort({
      date: DATE,
      slot: 2,
      root,
      now: NOW_D3,
      fetchImpl: fakeFetch(eveningCalls)
    });
    expect(evening.status).toBe("scheduled");
    expect(evening.scheduled_publish_at).toBe("2026-08-29T13:15:00Z");
    expect(metadataFromUpload(eveningCalls).status.publishAt).toBe("2026-08-29T13:15:00Z");
  });
});
