import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stampDailyContentWrite } from "../src/contentPlan";
import { runYouTubeCli, scheduleYouTubeShort, uploadShort } from "../src/postYouTube";
import { recordVideoReview } from "../src/videoReviewGate";

const DATE = "2026-08-29";
const NOW_D3 = new Date("2026-08-26T21:40:00+08:00");
const PROMPT = "one action only";
const DRY_RUN_LINE = "YT dry-run，未上傳";

interface CapturedCall {
  url: string;
}

function fakeFetch(calls: CapturedCall[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push({ url });
    const respond = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("oauth2.googleapis.com/token")) return respond({ access_token: "yt-test-token" });
    if (url.includes("googleapis.com/upload/youtube")) return respond({ id: "yt-vid-1" });
    return new Response(JSON.stringify({ error: "unexpected url" }), { status: 500 });
  }) as typeof fetch;
}

function uploadCount(calls: CapturedCall[]): number {
  return calls.filter((call) => call.url.includes("/upload/youtube")).length;
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

async function seedCalendar(root: string, slots: Array<ReturnType<typeof slotShape>>): Promise<void> {
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

async function seedLiveReel(root: string, slot: number): Promise<void> {
  await mkdir(join(root, "data", "posted-log"), { recursive: true });
  await writeFile(
    join(root, "data", "posted-log", `${DATE}.json`),
    JSON.stringify([
      {
        date: DATE,
        slot,
        platform: "instagram",
        status: "success",
        dry_run: false,
        attempts: 1,
        published_media_type: "reel",
        created_at: NOW_D3.toISOString()
      }
    ]),
    "utf8"
  );
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out.sort();
}

async function ps1InvocationLines(): Promise<Array<{ file: string; line: number; text: string }>> {
  const roots = ["scripts", "test"];
  const files: string[] = [];
  for (const root of roots) {
    const found = await listFiles(root);
    files.push(...found.filter((file) => file.endsWith(".ps1")));
  }
  const hits: Array<{ file: string; line: number; text: string }> = [];
  const invocation = /npm\.cmd run (?:post-youtube|schedule-youtube)\b|"run (?:post-youtube|schedule-youtube)\b/;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    text.split(/\n/).forEach((line, index) => {
      if (invocation.test(line)) hits.push({ file, line: index + 1, text: line.trim() });
    });
  }
  return hits;
}

describe("YouTube live flag", () => {
  let root: string;
  let logs: string[];
  let spy: { mockRestore: () => void };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yt-live-flag-"));
    setTestCredentials();
    logs = [];
    spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logs.push(String(line));
    });
  });

  afterEach(() => {
    spy.mockRestore();
    restoreCredentials();
    vi.unstubAllEnvs();
  });

  it("does not upload or write status when --live is absent, even if DRY_RUN=false", async () => {
    vi.stubEnv("DRY_RUN", "false");
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedLiveReel(root, 2);
    const before = await listFiles(join(root, "data"));
    const calls: CapturedCall[] = [];
    const result = await uploadShort({ date: DATE, slot: 2, root, fetchImpl: fakeFetch(calls) });
    expect(result).toEqual({ status: "dry_run" });
    expect(uploadCount(calls)).toBe(0);
    expect(calls).toEqual([]);
    expect(logs).toEqual([DRY_RUN_LINE]);
    expect(await listFiles(join(root, "data"))).toEqual(before);
  });

  it("uploads once when live is requested", async () => {
    vi.stubEnv("DRY_RUN", "true");
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedLiveReel(root, 2);
    const calls: CapturedCall[] = [];
    const result = await uploadShort({
      date: DATE,
      slot: 2,
      root,
      fetchImpl: fakeFetch(calls),
      live: true
    });
    expect(uploadCount(calls)).toBe(1);
    expect("video_id" in result && result.video_id).toBe("yt-vid-1");
    expect(logs).not.toContain(DRY_RUN_LINE);
  });

  it("does not schedule an upload when live is absent", async () => {
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedApprovals(root, [2]);
    await recordVideoReview({ date: DATE, slot: 2, reviewRound: 1, root, now: NOW_D3 });
    const before = await listFiles(join(root, "data"));
    const calls: CapturedCall[] = [];
    const result = await scheduleYouTubeShort({
      date: DATE,
      slot: 2,
      root,
      now: NOW_D3,
      fetchImpl: fakeFetch(calls)
    });
    expect(result).toEqual({ status: "dry_run" });
    expect(uploadCount(calls)).toBe(0);
    expect(calls).toEqual([]);
    expect(logs).toEqual([DRY_RUN_LINE]);
    expect(await listFiles(join(root, "data"))).toEqual(before);
  });

  it("schedules one upload when live is requested", async () => {
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedApprovals(root, [2]);
    await recordVideoReview({ date: DATE, slot: 2, reviewRound: 1, root, now: NOW_D3 });
    const calls: CapturedCall[] = [];
    const result = await scheduleYouTubeShort({
      date: DATE,
      slot: 2,
      root,
      now: NOW_D3,
      fetchImpl: fakeFetch(calls),
      live: true
    });
    expect(result.status).toBe("scheduled");
    expect(uploadCount(calls)).toBe(1);
    expect(logs).not.toContain(DRY_RUN_LINE);
  });

  it("CLI without --live does not upload even when DRY_RUN=false", async () => {
    vi.stubEnv("DRY_RUN", "false");
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedLiveReel(root, 2);
    const before = await listFiles(join(root, "data"));
    const calls: CapturedCall[] = [];
    const result = await runYouTubeCli(["--date", DATE, "--slot", "2", "--root", root], {
      fetchImpl: fakeFetch(calls)
    });
    expect(result).toEqual({ status: "dry_run" });
    expect(uploadCount(calls)).toBe(0);
    expect(calls).toEqual([]);
    expect(logs).toEqual([DRY_RUN_LINE]);
    expect(await listFiles(join(root, "data"))).toEqual(before);
  });

  it("CLI --live uploads once even when DRY_RUN=true", async () => {
    vi.stubEnv("DRY_RUN", "true");
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedLiveReel(root, 2);
    const calls: CapturedCall[] = [];
    await runYouTubeCli(["--date", DATE, "--slot", "2", "--root", root, "--live"], {
      fetchImpl: fakeFetch(calls)
    });
    expect(uploadCount(calls)).toBe(1);
    expect(logs.join("\n")).not.toContain(DRY_RUN_LINE);
    expect(logs.join("\n")).toContain('"video_id"');
  });

  it("CLI schedule-ahead without --live does not upload even when DRY_RUN=false", async () => {
    vi.stubEnv("DRY_RUN", "false");
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedApprovals(root, [2]);
    await recordVideoReview({ date: DATE, slot: 2, reviewRound: 1, root, now: NOW_D3 });
    const before = await listFiles(join(root, "data"));
    const calls: CapturedCall[] = [];
    const result = await runYouTubeCli(
      ["--schedule-ahead", "--date", DATE, "--slot", "2", "--root", root],
      { fetchImpl: fakeFetch(calls), now: NOW_D3 }
    );
    expect(result).toEqual({ status: "dry_run" });
    expect(uploadCount(calls)).toBe(0);
    expect(calls).toEqual([]);
    expect(logs).toEqual([DRY_RUN_LINE]);
    expect(await listFiles(join(root, "data"))).toEqual(before);
  });

  it("CLI schedule-ahead --live uploads once even when DRY_RUN=true", async () => {
    vi.stubEnv("DRY_RUN", "true");
    await seedCalendar(root, [
      slotShape({ slot: 1, time: "11:30", mediaType: "image" }),
      slotShape({ slot: 2, time: "20:30", mediaType: "reel", video: true })
    ]);
    await seedApprovals(root, [2]);
    await recordVideoReview({ date: DATE, slot: 2, reviewRound: 1, root, now: NOW_D3 });
    const calls: CapturedCall[] = [];
    await runYouTubeCli(
      ["--schedule-ahead", "--date", DATE, "--slot", "2", "--root", root, "--live"],
      { fetchImpl: fakeFetch(calls), now: NOW_D3 }
    );
    expect(uploadCount(calls)).toBe(1);
    expect(logs.join("\n")).not.toContain(DRY_RUN_LINE);
    expect(logs.join("\n")).toContain('"video_id"');
  });

  it("requires --live on every ps1 line that runs post-youtube or schedule-youtube", async () => {
    const hits = await ps1InvocationLines();
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.text, `${hit.file}:${hit.line}`).toContain("--live");
    }
  });
});
