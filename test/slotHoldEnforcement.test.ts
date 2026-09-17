import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { autoApprove } from "../src/autoApprove";
import { stampDailyContentWrite } from "../src/contentPlan";
import { generatePublicSite } from "../src/generatePublicSite";
import { markImageSource } from "../src/markImageSource";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { shareLivePostsToStories } from "../src/postStory";
import { scheduleYouTubeShort, uploadShort } from "../src/postYouTube";
import { scheduleAheadFacebook } from "../src/scheduleAhead";
import { buildSlotImagePlan } from "../src/slotImagePlan";
import { getConfig } from "../src/config";
import { writeApprovalLog, writeJsonAtomic } from "../src/logging";
import { enableSlotHolds, sampleHold, writeSlotHoldsRequired } from "./helpers/slotHoldsFixture";
import type { AppConfig } from "../src/types";

const execFileAsync = promisify(execFile);
const DATE = "2026-10-01";
const png = (): Buffer =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot-hold-enf-"));
  roots.push(root);
  return root;
}

function sha(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function captureErr(fn: () => Promise<unknown>): Promise<string> {
  const err: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } catch {
    // callers assert on the error separately when needed
  } finally {
    console.error = error;
  }
  return err.join("\n");
}

const promptFor = (path: string) => `photorealistic laundry shop photo for ${path}`;

function imageSlot(slot: 1 | 2 | 3, topic: string) {
  const path = `docs/assets/${DATE}/slot-0${slot}.png`;
  return {
    slot,
    time: slot === 1 ? "11:30" : slot === 3 ? "12:00" : "20:30",
    category: slot === 1 ? "知識文" : "情境文",
    topic,
    format: "image-post",
    media_type: "image" as const,
    instagram_caption: "caption 參考價 $250 LINE 傳照片 收送到府 0968327653",
    facebook_caption: "caption",
    image_prompt: promptFor(path),
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: path,
    public_image_url: `https://sixiangjialaundry.com/assets/${DATE}/slot-0${slot}.png`,
    status: "pending" as const
  };
}

async function seedHealthyImageDay(root: string, slots: Array<ReturnType<typeof imageSlot>>): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify(
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
    ),
    "utf8"
  );
  await writeFile(
    join(root, "data", "publishing-policy.json"),
    JSON.stringify({
      status: "active",
      start_date: "2026-08-01",
      end_date: "2026-12-31",
      platforms: ["facebook", "instagram"],
      slots: slots.map((slot) => ({ slot: slot.slot })),
      same_day_catch_up: true
    }),
    "utf8"
  );
  await mkdir(join(root, "data", "image-prompts"), { recursive: true });
  await writeFile(
    join(root, "data", "image-prompts", `${DATE}.json`),
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
  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  for (const slot of slots) {
    await writeFile(join(root, ...slot.local_image_path.split("/")), png());
    await markImageSource({
      root,
      date: DATE,
      slot: slot.slot,
      source: "gpt-image-2",
      imagePath: slot.local_image_path
    });
  }
}

async function seedApprovals(root: string, slots: number[]): Promise<void> {
  await writeApprovalLog(
    DATE,
    slots.flatMap((slot) =>
      (["facebook", "instagram"] as const).map((platform) => ({
        date: DATE,
        slot,
        platform,
        status: "approved" as const,
        approved_by: "test",
        created_at: new Date().toISOString()
      }))
    ),
    root
  );
}

function liveConfig(): AppConfig {
  return getConfig({
    ...process.env,
    DRY_RUN: "false",
    PUBLIC_IMAGE_BASE_URL: "https://sixiangjialaundry.com",
    META_ACCESS_TOKEN: "test-token-value",
    FB_PAGE_ID: "111000111",
    IG_USER_ID: "222000222",
    VERIFY_PUBLIC_IMAGE_URL: "false"
  });
}

function countingFetch(): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const respond = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("oauth2.googleapis.com/token")) return respond({ access_token: "yt-test-token" });
    if (url.includes("googleapis.com/upload/youtube")) return respond({ id: "yt-vid-1" });
    if (url.includes("/media_publish")) return respond({ id: "ig-post-1" });
    if (url.includes("/media")) return respond({ id: "ig-container-1" });
    return respond({ id: "fb-obj-1", post_id: "fb-post-1" });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const FAULTS = [
  ["missing", async (root: string) => {
    await writeSlotHoldsRequired(root);
  }],
  ["empty", async (root: string) => {
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "", "utf8");
  }],
  ["bad-json", async (root: string) => {
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "{ nope", "utf8");
  }],
  ["wrong-version", async (root: string) => {
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), JSON.stringify({ version: 2, holds: [] }), "utf8");
  }],
  ["missing-field", async (root: string) => {
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "slot-holds.json"),
      JSON.stringify({ version: 1, holds: [{ date: DATE, slot: 1, set_by: "o", set_at: "2026-09-17T03:00:00.000Z" }] }),
      "utf8"
    );
  }],
  ["slot-4", async (root: string) => {
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "slot-holds.json"),
      JSON.stringify({ version: 1, holds: [{ ...sampleHold({ date: DATE }), slot: 4 as unknown as 1 }] }),
      "utf8"
    );
  }],
  ["bad-date", async (root: string) => {
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "slot-holds.json"),
      JSON.stringify({ version: 1, holds: [{ ...sampleHold(), date: "10/01/2026" }] }),
      "utf8"
    );
  }],
  ["duplicate", async (root: string) => {
    await writeSlotHoldsRequired(root);
    const hold = sampleHold({ date: DATE });
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), JSON.stringify({ version: 1, holds: [hold, hold] }), "utf8");
  }],
  ["truncated", async (root: string) => {
    await writeSlotHoldsRequired(root);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), '{"version":1,"holds":[', "utf8");
  }]
] as const;

async function docsFingerprint(root: string): Promise<Map<string, string>> {
  const docs = join(root, "docs");
  const map = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const info = await stat(full);
      if (info.isDirectory()) await walk(full);
      else map.set(full, sha(await readFile(full)));
    }
  }
  await walk(docs);
  return map;
}

describe("S3-1 autoApprove", () => {
  it("does not approve a held slot; other slots still approve", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1, reason: "luxury visual undecided" })]);
    const printed = await captureErr(async () => {
      const result = await autoApprove({ date: DATE, root });
      expect(result.approved_slots).toEqual([2]);
      expect(result.blockers.join("\n")).toContain("SLOT HELD 2026-10-01 slot 1");
      expect(result.approved_slots).not.toContain(1);
    });
    expect(printed).toContain("SLOT HELD 2026-10-01 slot 1:");
  });

  it("lists an already-approved held slot in blockers", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await seedApprovals(root, [1, 2]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    const result = await autoApprove({ date: DATE, root });
    expect(result.blockers.join("\n")).toContain("SLOT HELD 2026-10-01 slot 1");
  });

  it("invalid holds return early with SLOT-HOLDS INVALID and CLI-style nonzero", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await writeSlotHoldsRequired(root);
    const result = await autoApprove({ date: DATE, root });
    expect(result.approved).toBe(false);
    expect(result.already_approved).toBe(false);
    expect(result.blockers.some((line) => line.includes("SLOT-HOLDS INVALID"))).toBe(true);
    const cli = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/autoApprove.ts", "--date", DATE, "--root", root, "--dry-run"],
      { encoding: "utf8", cwd: process.cwd() }
    ).then(
      (ok) => ({ status: 0, stdout: ok.stdout, stderr: ok.stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        status: error.code ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? ""
      })
    );
    expect(cli.status).not.toBe(0);
    expect(`${cli.stdout}\n${cli.stderr}`).toContain("SLOT-HOLDS INVALID:");
  });
});

describe("S3-2 approvePost", () => {
  it("refuses a held slot even with --force", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    await expect(
      approvePost({ date: DATE, slot: 1, platforms: ["facebook"], approvedBy: "owner", root, force: true })
    ).rejects.toThrow(/SLOT HELD 2026-10-01 slot 1/);
    const cli = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/approvePost.ts",
        "--date",
        DATE,
        "--slot",
        "1",
        "--platform",
        "facebook",
        "--approved-by",
        "owner",
        "--force",
        "--root",
        root
      ],
      { encoding: "utf8", cwd: process.cwd() }
    ).then(
      () => ({ status: 0, stdout: "", stderr: "" }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        status: error.code ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? ""
      })
    );
    expect(cli.status).not.toBe(0);
    expect(`${cli.stdout}\n${cli.stderr}`).toMatch(/SLOT HELD 2026-10-01 slot 1|SLOT-HOLDS INVALID/);
  });
});

describe("S3-3 publish and schedule paths", () => {
  beforeEach(() => {
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
  });

  it("postCurrentSlot does not post a held slot even if already posted/scheduled", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await seedApprovals(root, [1, 2]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeJsonAtomic(join(root, "data", "posted-log", `${DATE}.json`), [
      {
        date: DATE,
        slot: 1,
        platform: "facebook",
        status: "success",
        dry_run: false,
        attempts: 1,
        created_at: new Date().toISOString()
      }
    ]);
    await writeJsonAtomic(join(root, "data", "scheduled-log", `${DATE}.json`), [
      {
        date: DATE,
        slot: 1,
        platform: "facebook",
        scheduled_post_id: "fb-queued-1",
        scheduled_publish_time: 1,
        published_media_type: "image",
        created_at: new Date().toISOString()
      }
    ]);
    const { fetchImpl, calls } = countingFetch();
    const printed = await captureErr(() =>
      postCurrentSlot({
        date: DATE,
        slot: 1,
        root,
        now: `${DATE}T11:35:00+08:00`,
        dryRun: false,
        verifyPublicImageUrl: false,
        fetchImpl
      })
    );
    expect(calls).toEqual([]);
    expect(printed).toContain("SLOT HELD 2026-10-01 slot 1:");
    expect(printed).toContain("HELD_BUT_QUEUED 2026-10-01 slot 1 facebook");
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
  });

  it("scheduleAhead does not queue a held slot and still schedules the other", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await seedApprovals(root, [1, 2]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    const { fetchImpl, calls } = countingFetch();
    const results = await scheduleAheadFacebook({
      date: DATE,
      root,
      config: liveConfig(),
      fetchImpl,
      now: new Date("2026-09-28T21:00:00+08:00")
    });
    expect(results.find((row) => row.slot === 1)?.action).toBe("skipped");
    expect(results.find((row) => row.slot === 2)?.action).toBe("scheduled");
    expect(calls.some((url) => url.includes("facebook") || url.includes("graph"))).toBe(true);
    const heldCalls = calls.filter((url) => url.includes("slot-01"));
    expect(heldCalls).toEqual([]);
  });

  it("YouTube schedule-ahead and uploadShort do not call the network for a held slot", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 2 })]);
    await mkdir(join(root, "data", "youtube-log"), { recursive: true });
    await writeJsonAtomic(join(root, "data", "youtube-log", `${DATE}.json`), [
      { date: DATE, slot: 2, video_id: "already-yt", title: "prior", uploaded_at: new Date().toISOString() }
    ]);
    const { fetchImpl, calls } = countingFetch();
    await expect(uploadShort({ date: DATE, slot: 2, root, fetchImpl })).rejects.toThrow(/SLOT HELD/);
    await expect(
      scheduleYouTubeShort({ date: DATE, slot: 2, root, now: new Date("2026-09-28T21:00:00+08:00"), fetchImpl })
    ).rejects.toThrow(/SLOT HELD/);
    expect(calls).toEqual([]);
  });

  it("shareLivePostsToStories skips a held slot before already-shared", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    await mkdir(join(root, "data", "stories"), { recursive: true });
    await writeJsonAtomic(join(root, "data", "stories", `${DATE}.json`), [
      { date: DATE, slot: 1, story_id: "already", created_at: new Date().toISOString() }
    ]);
    await writeJsonAtomic(join(root, "data", "posted-log", `${DATE}.json`), [
      {
        date: DATE,
        slot: 1,
        platform: "instagram",
        status: "success",
        dry_run: false,
        attempts: 1,
        post_id: "ig-1",
        created_at: new Date().toISOString()
      }
    ]);
    const { fetchImpl, calls } = countingFetch();
    const results = await shareLivePostsToStories({ date: DATE, root, fetchImpl });
    expect(results.find((row) => row.slot === 1)?.skipped).toMatch(/SLOT HELD/);
    expect(calls).toEqual([]);
  });

  it("generatePublicSite omits held slots from pages and sitemap", async () => {
    const root = await tempRoot();
    const profile = await readFile(join(process.cwd(), "data", "business-profile.json"), "utf8");
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "business-profile.json"), profile, "utf8");
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await seedApprovals(root, [1, 2]);
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    vi.stubEnv("PUBLIC_GA4_MEASUREMENT_ID", "G-TEST123456");
    vi.stubEnv("DRY_RUN", "true");
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
    expect(sitemap).not.toContain(`${DATE}-slot-01`);
  });
});

describe("S3-4 image list paths", () => {
  it("slotImagePlan omits held slots and empties the plan when invalid", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await rm(join(root, "docs", "assets", DATE, "slot-01.png"));
    await rm(join(root, "docs", "assets", DATE, "slot-02.png"));
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.items.every((item) => item.slot !== 1)).toBe(true);
    expect(plan.items.some((item) => item.slot === 2)).toBe(true);

    await writeFile(join(root, "data", "slot-holds.json"), "{ nope", "utf8");
    const invalid = await buildSlotImagePlan(DATE, root);
    expect(invalid.items).toEqual([]);
    expect(invalid.blockers.some((line) => line.startsWith("SLOT-HOLDS INVALID:"))).toBe(true);
  });

  it("generateImage --list-missing filters held slots and on invalid prints SLOT-HOLDS INVALID without inventory phrases", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await rm(join(root, "docs", "assets", DATE, "slot-01.png"));
    await enableSlotHolds(root, [sampleHold({ date: DATE, slot: 1 })]);
    const held = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/generateImage.ts", "--list-missing", "--date", DATE, "--root", root],
      { encoding: "utf8", cwd: process.cwd() }
    );
    expect(held.stdout).toContain("already present");
    expect(held.stdout).not.toContain("slot-01.png");

    await writeFile(join(root, "data", "slot-holds.json"), "{ nope", "utf8");
    const invalid = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/generateImage.ts", "--list-missing", "--date", DATE, "--root", root],
      { encoding: "utf8", cwd: process.cwd() }
    ).then(
      (ok) => ({ status: 0, stdout: ok.stdout, stderr: ok.stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        status: error.code ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? ""
      })
    );
    expect(invalid.status).not.toBe(0);
    const text = `${invalid.stdout}\n${invalid.stderr}`;
    expect(text).toContain("SLOT-HOLDS INVALID:");
    expect(text).not.toContain("already present");
    expect(text).not.toContain("calendar image(s) missing");
  });
});

describe("S5-1 fault injection matrix", () => {
  it.each(FAULTS)("fault %s closes every S3 enforcement point", async (_label, applyFault) => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await seedApprovals(root, [1, 2]);
    await applyFault(root);
    await mkdir(join(root, "docs", "keep"), { recursive: true });
    await writeFile(join(root, "docs", "keep", "marker.txt"), "do-not-touch", "utf8");
    const before = await docsFingerprint(root);

    const approve = await autoApprove({ date: DATE, root });
    expect(approve.approved).toBe(false);
    expect(approve.already_approved).toBe(false);
    expect(approve.blockers.some((line) => line.includes("SLOT-HOLDS INVALID"))).toBe(true);

    await expect(
      approvePost({ date: DATE, slot: 1, platforms: ["facebook"], approvedBy: "owner", root, force: true })
    ).rejects.toThrow(/SLOT-HOLDS INVALID/);

    const { fetchImpl, calls } = countingFetch();
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://sixiangjialaundry.com");
    vi.stubEnv("META_ACCESS_TOKEN", "test-token-value");
    vi.stubEnv("FB_PAGE_ID", "111000111");
    vi.stubEnv("IG_USER_ID", "222000222");
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
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
    ).rejects.toThrow(/SLOT-HOLDS INVALID/);
    await expect(
      scheduleAheadFacebook({ date: DATE, root, config: liveConfig(), fetchImpl, now: new Date("2026-09-28T21:00:00+08:00") })
    ).rejects.toThrow(/SLOT-HOLDS INVALID/);
    await expect(uploadShort({ date: DATE, slot: 2, root, fetchImpl })).rejects.toThrow(/SLOT-HOLDS INVALID/);
    await expect(
      scheduleYouTubeShort({ date: DATE, slot: 2, root, now: new Date("2026-09-28T21:00:00+08:00"), fetchImpl })
    ).rejects.toThrow(/SLOT-HOLDS INVALID/);
    await expect(shareLivePostsToStories({ date: DATE, root, fetchImpl })).rejects.toThrow(/SLOT-HOLDS INVALID/);
    expect(calls).toEqual([]);

    await expect(
      generatePublicSite({ root, baseUrl: "https://sixiangjialaundry.com", now: `${DATE}T01:00:00.000Z` })
    ).rejects.toThrow(/SLOT-HOLDS INVALID/);
    expect(await docsFingerprint(root)).toEqual(before);

    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.items).toEqual([]);
    expect(plan.blockers.some((line) => line.startsWith("SLOT-HOLDS INVALID:"))).toBe(true);

    const missing = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/generateImage.ts", "--list-missing", "--date", DATE, "--root", root],
      { encoding: "utf8", cwd: process.cwd() }
    ).then(
      (ok) => ({ status: 0, stdout: ok.stdout, stderr: ok.stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        status: error.code ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? ""
      })
    );
    expect(missing.status).not.toBe(0);
    const text = `${missing.stdout}\n${missing.stderr}`;
    expect(text).toContain("SLOT-HOLDS INVALID:");
    expect(text).not.toContain("already present");
    expect(text).not.toContain("calendar image(s) missing");
  });

  it("disabled + missing file does not close the line", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    const result = await autoApprove({ date: DATE, root });
    expect(result.blockers.join("\n")).not.toContain("SLOT-HOLDS INVALID");
    expect(result.approved_slots.sort()).toEqual([1, 2]);
  });

  it("disabled + bad file still closes the line", async () => {
    const root = await tempRoot();
    await seedHealthyImageDay(root, [imageSlot(1, "白鞋鞋邊泛灰前的檢查"), imageSlot(2, "精品包邊角磨損的三個階段")]);
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "slot-holds.json"), "{ nope", "utf8");
    const result = await autoApprove({ date: DATE, root });
    expect(result.approved).toBe(false);
    expect(result.blockers.some((line) => line.includes("SLOT-HOLDS INVALID"))).toBe(true);
  });
});
