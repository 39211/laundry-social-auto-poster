import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPostLog, writeApprovalLog, writeDailyContent, writePostLog } from "../src/logging";
import { parsePostCurrentSlotOptions, postCurrentSlot, type PostCurrentSlotOptions } from "../src/postCurrentSlot";
import type { DailyContent, PostLogEntry } from "../src/types";

// Real platform adapter, recovery, readback, locks and journals; fake HTTP only.
vi.mock("../src/imageStamp", async original => ({
  ...await original<object>(), imagesChangedSinceStamp: async () => []
}));
const DATE = "2026-10-28";
const NOW = new Date("2026-11-08T16:00:00+08:00");
const row = (platform: "facebook" | "instagram", status: PostLogEntry["status"]): PostLogEntry => ({
  date: DATE, slot: 1, platform, status, dry_run: false, attempts: 1,
  error: status === "failed" ? "Missing or invalid image file" : undefined,
  published_media_type: "image", post_id: status === "success" ? "ig-original" : undefined,
  created_at: `${DATE}T03:30:00Z`
});
type State = "absent" | "published" | "later-published" | "pending" | "down" | "empty" | "blank" | "partial";

describe("OPS-L1-10b owner-approved backfill", () => {
  let root: string;
  let sends: string[];
  let notices: string[];
  let reads: string[];
  let rounds: number;
  let first: State;
  let second: State;
  let sendMode: "success" | "lost" | "no-id" | "rejected" | "unsent";
  let onFeed: ((round: number) => Promise<void>) | undefined;
  const receiptPath = () => join(root, "data/gates", `publish-recovery-${DATE}-slot1-facebook.json`);
  const receipt = async () => JSON.parse(await readFile(receiptPath(), "utf8"));
  const schedulePath = () => join(root, "data/scheduled-log", `${DATE}.json`);
  const schedule = async (rows: unknown[]) => writeFile(schedulePath(), JSON.stringify(rows));
  const prior = async (fields = {}) => writeFile(receiptPath(), JSON.stringify({
    date: DATE, slot: 1, platform: "facebook", status: "needs_manual", retry_attempts: 0,
    reason: "outside_same_day_window", notification: "delivered", checked_at: NOW.toISOString(), ...fields
  }));
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    if (init?.method === "POST") {
      expect(path).toMatch(/\/fb-fixture\/photos$/);
      sends.push(path);
      if (sendMode === "lost") throw new Error("synthetic response lost");
      if (sendMode === "unsent") throw new Error("synthetic refused", { cause: { code: "ECONNREFUSED" } });
      if (sendMode === "rejected") return new Response(JSON.stringify({ error: { message: "synthetic rejection" } }), { status: 400 });
      return new Response(JSON.stringify(sendMode === "no-id" ? {} : { post_id: "fb-backfill" }));
    }
    reads.push(path);
    const queued = path.endsWith("/scheduled_posts");
    if (queued) rounds++;
    else {
      expect(path).toMatch(/\/feed$/);
      // Includes the original publication day and every day through this run.
      expect(Number(parsed.searchParams.get("since"))).toBeLessThan(Date.parse(`${DATE}T00:00:00+08:00`) / 1000);
      await onFeed?.(rounds);
    }
    const state = rounds <= 1 ? first : second;
    if (state === "down") throw new Error("synthetic readback outage");
    const matching = { id: "fb-existing", message: "offline backfill caption 1",
      created_time: state === "later-published" ? NOW.toISOString() : `${DATE}T03:31:00Z` };
    const other = { id: "other", message: state === "blank" ? "" : "unrelated complete caption", created_time: NOW.toISOString() };
    const data = queued ? (state === "pending" ? [matching] : []) :
      state === "empty" ? [] : [state === "published" || state === "later-published" ? matching : other];
    return new Response(JSON.stringify({ data, ...(state === "partial" ? { paging: { next: "https://graph.facebook.com/next" } } : {}) }));
  }) as typeof fetch;
  const run = (options: Partial<PostCurrentSlotOptions> = {}) => postCurrentSlot({
    root, date: DATE, slot: 1, now: NOW, dryRun: false, backfill: true, verifyPublicImageUrl: false,
    fetchImpl: fakeFetch, recoverySender: async message => { notices.push(message); return true; }, ...options
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ops-l1-10b-"));
    sends = []; notices = []; reads = []; rounds = 0; first = "absent"; second = "absent";
    sendMode = "success"; onFeed = undefined;
    for (const [name, value] of Object.entries({ DRY_RUN: "false", TIMEZONE: "Asia/Taipei", META_ACCESS_TOKEN: "offline-fixture",
      FB_PAGE_ID: "fb-fixture", IG_USER_ID: "ig-fixture", PUBLIC_IMAGE_BASE_URL: "https://assets.invalid",
      VERIFY_PUBLIC_IMAGE_URL: "false", ALLOW_OFF_SCHEDULE_PUBLISH: "false" })) vi.stubEnv(name, value);
    const slots = [1, 2].map(slot => ({ slot, time: slot === 1 ? "11:30" : "20:30", category: "知識文", topic: `offline ${slot}`,
      media_type: "image", facebook_caption: `offline backfill caption ${slot}`, instagram_caption: `offline backfill caption ${slot}`,
      local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`, public_image_url: `https://assets.invalid/${slot}.png`,
      image_prompt: "fixture", status: "pending" }));
    await writeDailyContent({ date: DATE, timezone: "Asia/Taipei", slots, generated_at: `${DATE}T00:00:00Z` } as DailyContent, root);
    for (const directory of ["docs/assets/" + DATE, "data/gates", "data/scheduled-log"]) await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, "docs/assets", DATE, "slot-01.png"), "synthetic fixture");
    await writeApprovalLog(DATE, ["facebook", "instagram"].map(platform => ({ date: DATE, slot: 1, platform,
      status: "approved", approved_by: "offline", created_at: `${DATE}T00:00:00Z` })) as never, root);
    await writePostLog(DATE, [row("facebook", "failed"), row("instagram", "success")], root);
    await schedule([]);
    await prior();
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  it("B1: old failed row and manual receipt publish once after two complete Page and queue reads", async () => {
    // Match the actual wrapper, which already supplies this old override.
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
    await run(); await run();
    expect(sends).toHaveLength(1);
    expect(reads.filter(p => p.endsWith("/feed"))).toHaveLength(2);
    expect(reads.filter(p => p.endsWith("/scheduled_posts"))).toHaveLength(2);
    expect(await receipt()).toMatchObject({ status: "resolved", reason: "backfill_published", retry_attempts: 0, backfill_attempts: 1 });
    expect((await loadPostLog(DATE, root)).filter(r => r.platform === "facebook" && r.status === "success")).toHaveLength(1);
    expect(notices).toEqual([]);
  });
  it("B2: without the flag even the existing off-schedule override retains the automatic window", async () => {
    await rm(receiptPath());
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
    await expect(run({ backfill: false })).rejects.toThrow("needs_manual:outside_same_day_window");
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "outside_same_day_window" });
    expect(notices).toHaveLength(1);
  });
  it("B3: Page already has the original post, reconcile its ID without transport", async () => {
    first = "published";
    await run();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "resolved", reason: "platform_confirmed" });
    expect((await loadPostLog(DATE, root)).some(r => r.post_id === "fb-existing" && r.status === "success")).toBe(true);
  });
  it.each(["pending", "later-published"] as const)("B4: matching %s platform post prevents a new send", async state => {
    first = state;
    await expect(run()).rejects.toThrow("needs_manual:readback_pending");
    expect(sends).toEqual([]);
    expect(notices).toEqual([]);
  });
  it.each(["uncertain", "failed", "scheduled"])("B4: local FB schedule %s blocks the same slot", async status => {
    await schedule([{ slot: 1, platform: "facebook", status, scheduled_post_id: "" }]);
    await expect(run()).rejects.toThrow("needs_manual:facebook_schedule_exists");
    expect(sends).toEqual([]);
  });
  it.each(["lost", "no-id", "rejected", "unsent"] as const)("B5 B6: %s send outcome is manual, silent and never sent again", async mode => {
    await prior({ notification: "none" });
    sendMode = mode;
    await expect(run()).rejects.toThrow();
    expect(await receipt()).toMatchObject({ status: "needs_manual", reason: "backfill_failed", notification: "suppressed", backfill_attempts: 1 });
    await expect(run()).rejects.toThrow("needs_manual:backfill_already_attempted");
    expect(sends).toHaveLength(1);
    expect(notices).toEqual([]);
    expect((await loadPostLog(DATE, root)).filter(r => r.platform === "facebook" && r.status === "success")).toEqual([]);
  });
  it.each(["down", "empty", "blank", "partial"] as const)("B8: incomplete initial %s readback never authorizes transport", async state => {
    first = state;
    await expect(run()).rejects.toThrow("needs_manual:readback_unknown");
    expect(sends).toEqual([]);
    expect(notices).toEqual([]);
  });
  it.each(["published", "pending", "down"] as const)("B9: a final %s readback cancels the planned send", async state => {
    second = state;
    await expect(run()).rejects.toThrow("needs_manual:retry_readback_");
    expect(sends).toEqual([]);
    expect(notices).toEqual([]);
  });
  it("B10: a queue row appearing at the final boundary cancels transport", async () => {
    onFeed = async count => { if (count === 2) await schedule([{ slot: 1, platform: "facebook", status: "uncertain" }]); };
    await expect(run()).rejects.toThrow("needs_manual:facebook_schedule_exists");
    expect(sends).toEqual([]);
  });
  it("B11: no failed row still requires readback and reserves the one-shot budget", async () => {
    await writePostLog(DATE, [row("instagram", "success")], root);
    await rm(receiptPath());
    await run();
    expect(sends).toHaveLength(1);
    expect(reads.filter(p => p.endsWith("/feed"))).toHaveLength(2);
    expect(await receipt()).toMatchObject({ status: "resolved", backfill_attempts: 1 });
  });
  it("B12: a previously spent automatic retry does not consume the approved backfill", async () => {
    await prior({ retry_attempts: 1, reason: "retry_failed" });
    await run();
    expect(sends).toHaveLength(1);
    expect(await receipt()).toMatchObject({ status: "resolved", retry_attempts: 1, backfill_attempts: 1 });
  });
  it.each(["uncertain", "failed"] as const)("B13: historical %s response loss cannot be overridden", async status => {
    await writePostLog(DATE, [{ ...row("facebook", status), error: "HTTP 503; response lost" }, row("instagram", "success")], root);
    await expect(run()).rejects.toThrow("needs_manual:ambiguous_commit");
    expect(sends).toEqual([]);
  });
  it("B13: an unexplained historical failed request stays manual", async () => {
    await writePostLog(DATE, [{ ...row("facebook", "failed"), error: "unknown failure" }, row("instagram", "success")], root);
    await expect(run()).rejects.toThrow("needs_manual:non_retryable");
    expect(sends).toEqual([]);
  });
  it("B14: interrupted backfill reservation is not reclaimed", async () => {
    await prior({ status: "retry_claimed", backfill_attempts: 1, reason: "backfill_reserved_before_publish" });
    await expect(run()).rejects.toThrow("needs_manual:backfill_already_attempted");
    expect(sends).toEqual([]);
  });
  it("B14: interrupted automatic reservation stays ambiguous across explicit invocations", async () => {
    await prior({ status: "retry_claimed", retry_attempts: 1, reason: "retry_reserved_before_publish" });
    await expect(run()).rejects.toThrow("needs_manual:ambiguous_commit");
    await expect(run()).rejects.toThrow("needs_manual:ambiguous_commit");
    expect(sends).toEqual([]);
  });
  it("B14: missing evidence for a resolved receipt cannot become a fresh backfill", async () => {
    await prior({ status: "resolved", retry_attempts: 1, reason: "retry_published" });
    await expect(run()).rejects.toThrow("needs_manual:resolved_evidence_missing");
    await expect(run()).rejects.toThrow("needs_manual:resolved_evidence_missing");
    expect(sends).toEqual([]);
  });
  it.each(["ledger", "schedule"])("B15: unreadable %s fails closed", async file => {
    await writeFile(file === "ledger" ? receiptPath() : schedulePath(), "{");
    await expect(run()).rejects.toThrow("needs_manual:recovery_source_unreadable");
    expect(sends).toEqual([]);
    expect(notices).toEqual([]);
  });
  it("B15: repairing a damaged receipt as manual does not restore a possibly spent budget", async () => {
    await writeFile(receiptPath(), "{");
    await expect(run()).rejects.toThrow("needs_manual:recovery_source_unreadable");
    await expect(run()).rejects.toThrow("needs_manual:backfill_already_attempted");
    expect(sends).toEqual([]);
  });
  it("B16: missing approval never sends and is recorded silently", async () => {
    await writeApprovalLog(DATE, [], root);
    await expect(run()).rejects.toThrow();
    expect(sends).toEqual([]);
    expect(await receipt()).toMatchObject({ status: "needs_manual", notification: "suppressed" });
    expect(notices).toEqual([]);
  });
  it("B17: concurrent explicit callers send only once", async () => {
    const results = await Promise.allSettled([run(), run()]);
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    expect(sends).toHaveLength(1);
  });
  it("B18: a stale final readback does not inherit the window exemption", async () => {
    const base = Date.now();
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => base + elapsed);
    onFeed = async count => { if (count === 2) elapsed = 61_000; };
    try {
      await expect(run()).rejects.toThrow("needs_manual:evidence_or_window_expired");
      expect(sends).toEqual([]);
    } finally { clock.mockRestore(); }
  });
  it("B7: CLI parses the explicit flag, date and slot", () => {
    expect(parsePostCurrentSlotOptions(["--date", DATE, "--slot", "1", "--live", "--backfill"]))
      .toMatchObject({ backfill: true, date: DATE, slot: 1, dryRun: false });
    expect(parsePostCurrentSlotOptions(["--date", DATE, "--slot", "1", "--live"]).backfill).toBe(false);
  });
  it.each([{ date: undefined }, { slot: undefined }, { slot: 4 }, { allDue: true }])("B19: explicit one-slot scope is required: %j", async options => {
    await expect(run(options)).rejects.toThrow("--backfill requires");
    expect(reads).toEqual([]);
    expect(sends).toEqual([]);
  });
});
