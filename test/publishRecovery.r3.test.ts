import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPostLog, writeApprovalLog, writeDailyContent, writePostLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { NonRetryableError } from "../src/retry";
import { readPublicationEvidence } from "../src/scheduleAhead";
import type { AppConfig, DailyContent, PostLogEntry } from "../src/types";

// Keep real recovery, Page parsing, publishing, locks and journals. Only image
// approval and the external HTTP/notification boundaries use synthetic fixtures.
vi.mock("../src/imageStamp", async original => ({
  ...await original<object>(), imagesChangedSinceStamp: async () => []
}));

const DATE = "2026-11-01";
const NOW = new Date(`${DATE}T11:50:00+08:00`);
const SLOT_TIME = Date.parse(`${DATE}T11:30:00+08:00`) / 1000;
const CONFIG = { graphApiVersion: "v21.0", facebookPageId: "fb-fixture", instagramUserId: "ig-fixture",
  metaAccessToken: "offline-fixture" } as AppConfig;
const other = () => ({ id: "fb-other", message: "a different complete post", caption: "a different complete post",
  created_time: `${DATE}T02:00:00Z`, timestamp: `${DATE}T02:00:00Z` });
const matching = () => ({ ...other(), id: "fb-already-live", message: "offline caption 1", caption: "offline caption 1",
  created_time: `${DATE}T03:31:00Z`, timestamp: `${DATE}T03:31:00Z` });
const row = (status: PostLogEntry["status"] = "failed", error = "Missing or invalid image file"): PostLogEntry => ({
  date: DATE, slot: 1, platform: "facebook", status, error, dry_run: false, attempts: 1,
  published_media_type: "image", created_at: `${DATE}T03:30:00Z`
});

describe("OPS-L1-10-r3 fail-closed publication recovery", () => {
  let root: string;
  let sends: string[];
  let notices: string[];
  let feedReads: number;
  let rounds: number;
  let atSend: number[];
  type Readback = "absent" | "published" | "pending" | "down" | "empty" | "blank" | "missing-time";
  let second: Readback;
  let first: Readback;
  let onFeed: ((read: number) => Promise<void>) | undefined;
  let rejectImage: boolean;
  const schedulePath = () => join(root, "data/scheduled-log", `${DATE}.json`);
  const scheduleRow = () => ({ date: DATE, slot: 1, platform: "facebook", scheduled_post_id: "",
    scheduled_publish_time: SLOT_TIME, published_media_type: "image", created_at: `${DATE}T00:00:00Z` });
  const schedule = async (rows: unknown[]) => writeFile(schedulePath(), JSON.stringify(rows));
  const posted = async (entry: PostLogEntry | undefined) => writePostLog(DATE, [
    ...(entry ? [entry] : []), { ...row("success"), platform: "instagram", error: undefined, post_id: "ig-original" }
  ], root);
  const receipt = async () => JSON.parse(await readFile(join(root, "data/gates", `publish-recovery-${DATE}-slot1-facebook.json`), "utf8"));
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST") {
      if (!path.endsWith("/photos")) throw new Error("Unexpected publish endpoint in offline fixture");
      sends.push("facebook");
      atSend.push(feedReads);
      return new Response(JSON.stringify(rejectImage ? { error: { code: 324, type: "OAuthException",
        message: "Missing or invalid image file" } } : { post_id: "fb-retry" }), { status: rejectImage ? 400 : 200 });
    }
    if (path.endsWith("/scheduled_posts")) rounds++;
    const state = rounds <= 1 ? first : second;
    if (state === "down") throw new Error("synthetic readback outage");
    const queued = path.endsWith("/scheduled_posts");
    if (!queued) {
      feedReads++;
      await onFeed?.(feedReads);
    }
    const data = queued ? (state === "pending" ? [matching()] : []) :
      state === "empty" ? [] : state === "published" ? [matching()] :
      state === "blank" ? [{ ...other(), message: "", caption: "" }] :
      state === "missing-time" ? [{ id: "hidden-time", message: "a different complete post" }] : [other()];
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
  const run = () => postCurrentSlot({ root, date: DATE, slot: 1, now: NOW, dryRun: false,
    verifyPublicImageUrl: false, fetchImpl: fakeFetch,
    recoverySender: async message => { notices.push(message); return true; }
  }).catch(error => {
    if (error instanceof NonRetryableError) return [];
    throw error;
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ops-l1-r3-"));
    sends = []; notices = []; atSend = []; feedReads = 0; rounds = 0;
    first = "absent"; second = "absent"; onFeed = undefined; rejectImage = false;
    for (const [name, value] of Object.entries({ DRY_RUN: "false", TIMEZONE: "Asia/Taipei", META_ACCESS_TOKEN: "offline-fixture",
      FB_PAGE_ID: "fb-fixture", IG_USER_ID: "ig-fixture", PUBLIC_IMAGE_BASE_URL: "https://assets.invalid",
      VERIFY_PUBLIC_IMAGE_URL: "false", ALLOW_OFF_SCHEDULE_PUBLISH: "false" })) vi.stubEnv(name, value);
    const slots = [1, 2].map(slot => ({ slot, time: slot === 1 ? "11:30" : "20:30", category: "知識文", topic: `offline ${slot}`,
      media_type: "image", facebook_caption: `offline caption ${slot}`, instagram_caption: `offline caption ${slot}`,
      local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`, public_image_url: `https://assets.invalid/${slot}.png`,
      image_prompt: "fixture", status: "pending" }));
    await writeDailyContent({ date: DATE, timezone: "Asia/Taipei", slots, generated_at: `${DATE}T00:00:00Z` } as DailyContent, root);
    await mkdir(join(root, "docs/assets", DATE), { recursive: true });
    await writeFile(join(root, "docs/assets", DATE, "slot-01.png"), "synthetic image fixture");
    await writeApprovalLog(DATE, ["facebook", "instagram"].map(platform => ({ date: DATE, slot: 1, platform,
      status: "approved", approved_by: "offline", created_at: `${DATE}T00:00:00Z` })) as never, root);
    await mkdir(join(root, "data/scheduled-log"), { recursive: true });
    await schedule([]);
    await posted(row());
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  it.each([
    ["uncertain rejection", "uncertain", "Missing or invalid image file"],
    ["uncertain response lost", "uncertain", "Missing or invalid image file; response lost"],
    ["failed commit point", "failed", "Missing or invalid image file (commit point)"],
    ["failed possibly live", "failed", "Missing or invalid image file; post may already be live"],
    ["failed response lost", "failed", "Missing or invalid image file; response lost"]
  ] as const)("r3 F1: %s cannot use image text to clear commit uncertainty", async (_label, status, error) => {
    await posted(row(status, error));
    await run(); await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "ambiguous_commit", retry_attempts: 0, evidence: "absent" });
    expect(notices).toHaveLength(1);
  });
  it("r3 F1: a new FB code 324 rejection remains manual when only error text is persisted", async () => {
    await posted(undefined);
    rejectImage = true;
    await run(); await run();
    expect(sends).toEqual(["facebook"]); // Initial attempt only, never a retry.
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "ambiguous_commit", retry_attempts: 0 });
    expect(notices).toHaveLength(1);
    expect((await loadPostLog(DATE, root)).filter(entry => entry.platform === "facebook" && entry.status === "success")).toEqual([]);
  });
  it("r3 F1: synthetic 11/01 uncertain schedule with image text notifies without publishing", async () => {
    await posted(row("uncertain"));
    await schedule([{ ...scheduleRow(), status: "uncertain", error: "Missing or invalid image file" }]);
    await run(); await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", retry_attempts: 0 });
    expect(notices).toHaveLength(1);
  });

  it.each([
    ["published", "published"], ["pending", "pending"], ["down", "unknown"],
    ["empty", "unknown"], ["blank", "unknown"], ["missing-time", "unknown"]
  ] as const)("r3 F2: absent then %s on final readback prevents the retry", async (state, evidence) => {
    second = state;
    await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: `retry_readback_${evidence}`, evidence, retry_attempts: 0 });
    expect(notices).toHaveLength(1);
    expect(rounds).toBe(2);
  });
  it("r3 F2: two complete absent readbacks allow exactly one retry at the transport boundary", async () => {
    await run(); await run();
    expect(sends).toEqual(["facebook"]);
    expect(atSend).toEqual([2]);
    expect(await receipt()).toMatchObject({ status: "resolved", reason: "retry_published", retry_attempts: 1 });
    expect(notices).toEqual([]);
  });
  it("r3 F2: final readback cannot extend the same-day retry window", async () => {
    const base = Date.now();
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => base + elapsed);
    onFeed = async count => { if (count === 2) elapsed = 4 * 3600_000; };
    try {
      await run();
      expect(sends).toEqual([]);
      expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "evidence_or_window_expired", retry_attempts: 0 });
      expect(notices).toHaveLength(1);
    } finally { clock.mockRestore(); }
  });

  it.each(["empty", "blank", "missing-time"] as const)("r3 F3: %s initial platform data goes to manual without transport", async state => {
    first = state;
    await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "readback_unknown", retry_attempts: 0, evidence: "unknown" });
    expect(notices).toHaveLength(1);
  });

  it.each([
    ["uncertain/no id", { status: "uncertain" }], ["uncertain/with id", { status: "uncertain", scheduled_post_id: "queued-id" }],
    ["no status/no id", {}], ["no status/missing id", { scheduled_post_id: undefined }],
    ["no status/with id", { scheduled_post_id: "queued-id" }], ["failed/no id", { status: "failed" }],
    ["missing platform/no id", { platform: undefined }]
  ])("r3 F4: existing FB schedule %s blocks direct retry regardless of status or id", async (_label, fields) => {
    await schedule([{ ...scheduleRow(), ...fields as object }]);
    await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", retry_attempts: 0 });
    expect(notices).toHaveLength(1);
  });
  it("r3 F4: an FB schedule added during final readback blocks the retry", async () => {
    onFeed = async count => { if (count === 2) await schedule([{ ...scheduleRow(), status: "uncertain" }]); };
    await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "facebook_schedule_exists", retry_attempts: 0 });
    expect(notices).toHaveLength(1);
  });
  it("r3 F4: unreadable FB schedules at the final boundary cannot authorize transport", async () => {
    onFeed = async count => { if (count === 2) await writeFile(schedulePath(), "{"); };
    await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "recovery_source_unreadable", retry_attempts: 0 });
    expect(notices).toHaveLength(1);
  });
  it("r3 F4: another slot's FB schedule does not consume this slot's retry", async () => {
    await schedule([{ ...scheduleRow(), slot: 2, status: "uncertain" }]);
    await run(); await run();
    expect(sends).toEqual(["facebook"]);
    expect(await receipt()).toMatchObject({ status: "resolved", retry_attempts: 1 });
    expect(notices).toEqual([]);
  });
});

describe("OPS-L1-10-r3 negative Page evidence", () => {
  it.each(["facebook", "instagram"] as const)("r3 F3: %s empty, blank or incomplete lists are unknown", async platform => {
    const incomplete = [
      [], [{ ...other(), message: "", caption: "" }], [{ ...other(), message: " \r\n\t ", caption: " \t " }],
      [{ id: "no-caption", created_time: `${DATE}T03:31:00Z`, timestamp: `${DATE}T03:31:00Z` }],
      [{ id: "no-time", message: "a different complete post", caption: "a different complete post" }],
      [{ ...other(), created_time: "invalid", timestamp: "invalid" }],
      [matching(), { ...other(), message: "", caption: "" }],
      [matching(), { id: "hidden-time", message: "a different complete post", caption: "a different complete post" }]
    ];
    for (const data of incomplete) {
      const fetchImpl = (async (url: string | URL | Request) => new Response(JSON.stringify({
        data: String(url).includes("/scheduled_posts") ? [] : data
      }))) as typeof fetch;
      expect(await readPublicationEvidence({ platform, config: CONFIG, caption: "offline caption 1", slotTime: SLOT_TIME, fetchImpl }),
        JSON.stringify(data)).toEqual({ state: "unknown" });
    }
  });
  it.each(["facebook", "instagram"] as const)("r3 F3: %s complete nonmatching posts prove absence", async platform => {
    const fetchImpl = (async (url: string | URL | Request) => new Response(JSON.stringify({
      data: String(url).includes("/scheduled_posts") ? [] : [other()]
    }))) as typeof fetch;
    expect(await readPublicationEvidence({ platform, config: CONFIG, caption: "offline caption 1", slotTime: SLOT_TIME, fetchImpl }))
      .toEqual({ state: "absent" });
  });
  it.each(["facebook", "instagram"] as const)("r3 F3: %s complete matching post confirms its id", async platform => {
    const fetchImpl = (async (url: string | URL | Request) => new Response(JSON.stringify({
      data: String(url).includes("/scheduled_posts") ? [] : [matching()]
    }))) as typeof fetch;
    expect(await readPublicationEvidence({ platform, config: CONFIG, caption: "offline caption 1", slotTime: SLOT_TIME, fetchImpl }))
      .toEqual({ state: "published", postId: "fb-already-live" });
  });
});
