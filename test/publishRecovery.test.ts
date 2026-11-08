import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { loadPostLog, writeApprovalLog, writeDailyContent, writePostLog } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { postFacebookPhoto } from "../src/postFacebook";
import { postInstagramPhoto } from "../src/postInstagram";
import { NonRetryableError } from "../src/retry";
import { readPublicationEvidence } from "../src/scheduleAhead";
import type { AppConfig, DailyContent, PostInput, PostLogEntry } from "../src/types";

vi.mock("../src/postFacebook", async (original) => ({ ...await original<object>(), postFacebookPhoto: vi.fn() }));
vi.mock("../src/postInstagram", async (original) => ({ ...await original<object>(), postInstagramPhoto: vi.fn() }));
// Image approval is outside this regression; keep publishing, locks, ledgers and recovery real.
vi.mock("../src/imageStamp", async (original) => ({
  ...await original<object>(), imagesChangedSinceStamp: async () => []
}));

const DATE = "2026-11-01";
const NOW = new Date(`${DATE}T11:50:00+08:00`);
describe("OPS-L1-10 same-day recovery (synthetic 11/01)", () => {
  let root: string;
  let sends: string[];
  let notices: string[];
  let noticeKeys: string[];
  let gets: string[];
  let mode: "absent" | "present" | "queued" | "prefix" | "down" | "partial" | "malformed" | "bad-paging";
  let clock: Date;
  let readbackOverride: typeof fetch | undefined;
  const row = (platform: "facebook" | "instagram", status: PostLogEntry["status"]): PostLogEntry => ({
    date: DATE, slot: 1, platform, status, dry_run: false, attempts: 1,
    error: status === "success" ? undefined : "Missing or invalid image file",
    post_id: status === "success" ? "ig-original" : undefined,
    published_media_type: "image", created_at: `${DATE}T03:30:00Z`
  });
  const receipt = async (platform = "facebook") => JSON.parse(await readFile(
    join(root, "data", "gates", `publish-recovery-${DATE}-slot1-${platform}.json`), "utf8"));
  const fetchImpl = (async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    gets.push(parsed.pathname);
    if (mode === "down") throw new Error("synthetic outage");
    const data = (mode === "present" || mode === "prefix" || (mode === "queued" && parsed.pathname.endsWith("/scheduled_posts"))) ? [{ id: "fb-already-live", message: mode === "prefix" ? "offline caption" : "offline caption 1", caption: "offline caption 1",
      created_time: `${DATE}T03:31:00Z`, timestamp: `${DATE}T03:31:00Z` }] :
      parsed.pathname.endsWith("/scheduled_posts") ? [] : [{ id: "unrelated-post", message: "a different complete post",
        caption: "a different complete post", created_time: `${DATE}T02:00:00Z`, timestamp: `${DATE}T02:00:00Z` }];
    return new Response(JSON.stringify(mode === "malformed" ? { data: [null] } : {
      data,
      ...(mode === "partial" ? { paging: { next: "https://graph.facebook.com/next" } } : {}),
      ...(mode === "bad-paging" ? { paging: "unreadable" } : {})
    }), { status: 200 });
  }) as typeof fetch;
  const run = (at = clock, observeManual = true) => {
    const options = { root, date: DATE, slot: 1, now: at, dryRun: false, verifyPublicImageUrl: false, fetchImpl: readbackOverride ?? fetchImpl,
      recoverySender: async (message: string, key: string) => { notices.push(message); noticeKeys.push(key); return true; } };
    return postCurrentSlot(options).catch(error => {
      if (observeManual && error instanceof NonRetryableError && error.message.startsWith("needs_manual:")) return [];
      throw error;
    });
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ops-l1-retry-"));
    sends = []; notices = []; noticeKeys = []; gets = []; mode = "absent"; clock = NOW; readbackOverride = undefined;
    for (const [name, value] of Object.entries({ DRY_RUN: "false", TIMEZONE: "Asia/Taipei",
      META_ACCESS_TOKEN: "offline-fixture", FB_PAGE_ID: "fb-fixture", IG_USER_ID: "ig-fixture",
      PUBLIC_IMAGE_BASE_URL: "https://assets.invalid", VERIFY_PUBLIC_IMAGE_URL: "false" })) vi.stubEnv(name, value);
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "false");
    const slots = [1, 2].map(n => ({ slot: n, time: n === 1 ? "11:30" : "20:30", category: "知識文",
      topic: `offline ${n}`, media_type: "image", facebook_caption: `offline caption ${n}`,
      instagram_caption: `offline caption ${n}`, local_image_path: `docs/assets/${DATE}/slot-0${n}.png`,
      public_image_url: `https://assets.invalid/${n}.png`, image_prompt: "fixture", status: "pending" }));
    await writeDailyContent({ date: DATE, timezone: "Asia/Taipei", slots, generated_at: `${DATE}T00:00:00Z` } as DailyContent, root);
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", DATE, "slot-01.png"), "synthetic image fixture");
    await writeApprovalLog(DATE, ["facebook", "instagram"].map(platform => ({ date: DATE, slot: 1,
      platform, status: "approved", approved_by: "offline", created_at: `${DATE}T00:00:00Z` })) as never, root);
    // Generic retry controls have a definite failed row and no FB schedule.
    // r3 separately covers the actual uncertain 11/01 case, which stays manual.
    await writePostLog(DATE, [row("facebook", "failed"), row("instagram", "success")], root);
    await mkdir(join(root, "data", "scheduled-log"), { recursive: true });
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), "[]");
    vi.mocked(postFacebookPhoto).mockImplementation(async (_input: PostInput) => {
      sends.push("facebook");
      return { platform: "facebook", status: "success", dry_run: false, attempts: 1, post_id: "fb-retry" };
    });
    vi.mocked(postInstagramPhoto).mockImplementation(async () => {
      sends.push("instagram");
      return { platform: "instagram", status: "success", dry_run: false, attempts: 1, post_id: "ig-retry" };
    });
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  it("known failed image: recovers FB once after complete Page readback, leaves successful IG alone", async () => {
    await run(); await run();
    expect(sends).toEqual(["facebook"]);
    expect(gets.some(p => p.endsWith("/scheduled_posts"))).toBe(true);
    expect(gets.some(p => p.endsWith("/feed"))).toBe(true);
    expect((await loadPostLog(DATE, root)).filter(r => r.platform === "facebook" && r.status === "success")).toHaveLength(1);
    expect((await receipt()).retry_attempts).toBe(1);
  });
  it("duplicate guard: unknown readback never resends, persists manual work and notifies once", async () => {
    mode = "down";
    await run(); await run();
    expect(sends).toEqual([]);
    expect((await receipt()).status).toBe("needs_manual");
    expect(notices).toHaveLength(1);
    expect((await receipt()).notification).toBe("delivered");
    expect(noticeKeys).toEqual([`sxj:fb-lost:${DATE}:slot1`]);
  });
  it("duplicate guard: a matching published post reconciles its ID without resending", async () => {
    mode = "present";
    await run();
    expect(sends).toEqual([]);
    expect((await loadPostLog(DATE, root)).some(r => r.post_id === "fb-already-live" && r.status === "success")).toBe(true);
    expect(notices).toEqual([]);
  });
  it("known failed image: retry failure remains visible and notifies; a third run never sends", async () => {
    vi.mocked(postFacebookPhoto).mockImplementation(async () => { sends.push("facebook"); throw new NonRetryableError("synthetic retry rejected"); });
    await run().catch(() => undefined); await run().catch(() => undefined);
    expect(sends).toEqual(["facebook"]);
    expect((await receipt()).status).toBe("needs_manual");
    expect(notices).toHaveLength(1);
  });
  it.each(["partial", "malformed", "bad-paging"] as const)("duplicate guard: %s Graph responses cannot prove absence", async value => {
    mode = value;
    await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
  });
  it("non-retryable permission rejection goes to a person", async () => {
    await writePostLog(DATE, [{ ...row("facebook", "failed"), error: "permission denied" }, row("instagram", "success")], root);
    // Posted failure is more recent than the scheduling failure.
    await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
  });
  it("expired four-hour window records manual work without overriding the window", async () => {
    await run(new Date(`${DATE}T15:30:00+08:00`)).catch(() => undefined);
    expect(sends).toEqual([]);
    expect((await receipt()).status).toBe("needs_manual");
    expect(notices).toHaveLength(1);
  });
  it("IG failure uses IG media readback and its own one-retry budget", async () => {
    await writePostLog(DATE, [row("facebook", "success"), { ...row("instagram", "failed"), error: "temporary server error" }], root);
    await run(); await run();
    expect(sends).toEqual(["instagram"]);
    expect(gets.some(p => p.endsWith("/media"))).toBe(true);
    expect((await receipt("instagram")).retry_attempts).toBe(1);
  });
  it.each(["queued", "prefix"] as const)("duplicate guard: %s matches block a second post", async value => {
    mode = value;
    await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
  });
  it("interrupted retry reservation is never reclaimed", async () => {
    await mkdir(join(root, "data", "gates"), { recursive: true });
    await writeFile(join(root, "data", "gates", `publish-recovery-${DATE}-slot1-facebook.json`), JSON.stringify({
      date: DATE, slot: 1, platform: "facebook", status: "retry_claimed", retry_attempts: 1,
      reason: "retry_reserved_before_publish", notification: "none"
    }));
    await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
  });
  it("a damaged retry ledger consumes the budget instead of granting another try", async () => {
    await mkdir(join(root, "data", "gates"), { recursive: true });
    await writeFile(join(root, "data", "gates", `publish-recovery-${DATE}-slot1-facebook.json`), "{");
    await run();
    expect(sends).toEqual([]);
    expect((await receipt()).retry_attempts).toBe(1);
    expect(notices).toHaveLength(1);
  });
  it("missing local media is manual work even when Graph proves absence", async () => {
    await rm(join(root, "docs", "assets", DATE, "slot-01.png"));
    await run().catch(() => undefined);
    expect(sends).toEqual([]);
    expect((await receipt()).reason).toBe("local_media_missing");
    expect(notices).toHaveLength(1);
  });
  it("an ordinary retry error does not hide three transport attempts", async () => {
    vi.mocked(postFacebookPhoto).mockImplementation(async () => { sends.push("facebook"); throw new Error("temporary server error"); });
    await run().catch(() => undefined); await run().catch(() => undefined);
    expect(sends).toEqual(["facebook"]);
    expect(notices).toHaveLength(1);
  });
  it("a fresh failure retries within the same invocation, with two total attempts", async () => {
    await writePostLog(DATE, [row("instagram", "success")], root);
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), "[]");
    vi.mocked(postFacebookPhoto).mockImplementation(async () => { sends.push("facebook"); throw new Error("temporary server error"); });
    await run().catch(() => undefined);
    expect(sends).toEqual(["facebook", "facebook"]);
    await run().catch(() => undefined); await run().catch(() => undefined);
    expect(sends).toEqual(["facebook", "facebook"]);
    expect((await receipt()).retry_attempts).toBe(1);
    expect(notices).toHaveLength(1);
  });
  it("off-schedule override cannot authorize a next-day recovery", async () => {
    vi.stubEnv("ALLOW_OFF_SCHEDULE_PUBLISH", "true");
    await run(new Date("2026-11-02T11:50:00+08:00")).catch(() => undefined);
    expect(sends).toEqual([]);
    expect((await receipt()).reason).toBe("outside_same_day_window");
    expect(notices).toHaveLength(1);
  });
  it("a video cannot be retried from negative Page readback", async () => {
    await writePostLog(DATE, [{ ...row("facebook", "uncertain"), published_media_type: "reel" }, row("instagram", "success")], root);
    await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
  });
  it("concurrent callers cannot consume a second retry", async () => {
    await Promise.allSettled([run(), run()]);
    expect(sends).toEqual(["facebook"]);
    expect((await receipt()).retry_attempts).toBe(1);
  });
  it("manual work does not return a successful publisher result", async () => {
    mode = "down";
    await expect(run(clock, false)).rejects.toThrow("needs_manual:");
  });
  it("time spent reading FB cannot let IG retry after its window closes", async () => {
    await writePostLog(DATE, [row("facebook", "uncertain"), { ...row("instagram", "failed"), error: "temporary server error" }], root);
    const base = Date.now();
    let elapsed = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => base + elapsed);
    readbackOverride = (async (url: string | URL | Request) => {
      const feed = String(url).includes("/feed");
      if (feed) elapsed = 120_000;
      return new Response(JSON.stringify({ data: feed ? [{ id: "fb-existing", message: "offline caption 1", created_time: `${DATE}T03:31:00Z` }] :
        String(url).includes("/media") ? [{ id: "ig-unrelated", caption: "a different complete post", timestamp: `${DATE}T02:00:00Z` }] : [] }));
    }) as typeof fetch;
    try {
      await run(new Date(`${DATE}T15:29:59+08:00`));
      expect(sends).toEqual([]);
      expect((await receipt("instagram")).reason).toBe("outside_same_day_window");
    } finally { nowSpy.mockRestore(); }
  });
  it("an ambiguous commit stays manual even when complete Page readback has no target", async () => {
    await writePostLog(DATE, [{ ...row("facebook", "uncertain"),
      error: "temporary server error (commit point; the post may already be live)" }, row("instagram", "success")], root);
    await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
  });
  it.each([
    ["response lost", "HTTP 503 Service Unavailable; response lost"],
    ["commit point", "temporarily unavailable at commit point"],
    ["may already be live", "HTTP 503; post may already be live"]
  ])("r2 a: uncertain %s with transient text stays manual without resending", async (_marker, error) => {
    await writePostLog(DATE, [{ ...row("facebook", "uncertain"), error }, row("instagram", "success")], root);
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), "[]");
    await run();
    expect(sends).toEqual([]);
    expect(postFacebookPhoto).not.toHaveBeenCalled();
    expect(postInstagramPhoto).not.toHaveBeenCalled();
    expect((await receipt())).toMatchObject({
      status: "needs_manual", reason: "ambiguous_commit", evidence: "absent", retry_attempts: 0
    });
    expect(gets.some(p => p.endsWith("/scheduled_posts"))).toBe(true);
    expect(gets.some(p => p.endsWith("/feed"))).toBe(true);
    expect(notices).toHaveLength(1);
  });
  it("r2 b: scheduled-only uncertain with transient text stays manual without resending", async () => {
    await writePostLog(DATE, [row("instagram", "success")], root);
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), JSON.stringify([{
      date: DATE, slot: 1, platform: "facebook", status: "uncertain", scheduled_post_id: "",
      scheduled_publish_time: Date.parse(`${DATE}T11:30:00+08:00`) / 1000, published_media_type: "image",
      error: "HTTP 503 temporarily unavailable", created_at: "2026-10-29T00:00:00Z"
    }]));
    expect((await loadPostLog(DATE, root)).filter(r => r.platform === "facebook")).toEqual([]);
    await run();
    expect(sends).toEqual([]);
    expect(postFacebookPhoto).not.toHaveBeenCalled();
    expect(postInstagramPhoto).not.toHaveBeenCalled();
    expect((await receipt())).toMatchObject({
      status: "needs_manual", reason: "ambiguous_commit", evidence: "absent", retry_attempts: 0
    });
    expect(gets.some(p => p.endsWith("/scheduled_posts"))).toBe(true);
    expect(gets.some(p => p.endsWith("/feed"))).toBe(true);
    expect(notices).toHaveLength(1);
  });
  it("r2 c: failed image rejection retries once inside the window after absent readback", async () => {
    await writePostLog(DATE, [row("facebook", "failed"), row("instagram", "success")], root);
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), "[]");
    await run(); await run();
    expect(sends).toEqual(["facebook"]);
    expect(postFacebookPhoto).toHaveBeenCalledTimes(1);
    expect(postInstagramPhoto).not.toHaveBeenCalled();
    expect((await receipt())).toMatchObject({
      status: "resolved", reason: "retry_published", evidence: "absent", retry_attempts: 1
    });
    expect((await loadPostLog(DATE, root)).filter(r => r.platform === "facebook" && r.post_id === "fb-retry")).toHaveLength(1);
    expect(notices).toEqual([]);
  });
  it("r2 regex: failed response lost with HTTP 503 stays manual without resending", async () => {
    await writePostLog(DATE, [{ ...row("facebook", "failed"), error: "HTTP 503; response lost" }, row("instagram", "success")], root);
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), "[]");
    await run();
    expect(sends).toEqual([]);
    expect(postFacebookPhoto).not.toHaveBeenCalled();
    expect(postInstagramPhoto).not.toHaveBeenCalled();
    expect((await receipt())).toMatchObject({
      status: "needs_manual", reason: "ambiguous_commit", evidence: "absent", retry_attempts: 0
    });
    expect(notices).toHaveLength(1);
  });
  it.each([null, false, 0, ""])("a scalar retry receipt %j cannot reset the daily budget", async value => {
    await mkdir(join(root, "data", "gates"), { recursive: true });
    await writeFile(join(root, "data", "gates", `publish-recovery-${DATE}-slot1-facebook.json`), JSON.stringify(value));
    await run();
    expect(sends).toEqual([]);
    expect((await receipt()).retry_attempts).toBe(1);
    expect(notices).toHaveLength(1);
  });
  it("a notification reservation left by a crash is retried with the same incident key", async () => {
    mode = "down";
    await mkdir(join(root, "data", "gates"), { recursive: true });
    await writeFile(join(root, "data", "gates", `publish-recovery-${DATE}-slot1-facebook.json`), JSON.stringify({
      date: DATE, slot: 1, platform: "facebook", status: "needs_manual", retry_attempts: 0,
      reason: "readback_unknown", notification: "reserved"
    }));
    await run(); await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
    expect((await receipt()).notification).toBe("delivered");
  });
  it("a formerly resolved receipt with missing publication evidence cannot authorize republishing", async () => {
    await mkdir(join(root, "data", "gates"), { recursive: true });
    await writeFile(join(root, "data", "gates", `publish-recovery-${DATE}-slot1-facebook.json`), JSON.stringify({
      date: DATE, slot: 1, platform: "facebook", status: "resolved", retry_attempts: 0,
      reason: "retry_published", notification: "none"
    }));
    await run();
    expect(sends).toEqual([]);
    expect(notices).toHaveLength(1);
  });
  it("the readback deadline includes a JSON body that never completes", async () => {
    let entered!: () => void;
    const bodyEntered = new Promise<void>(resolve => { entered = resolve; });
    const silentBody = (async () => ({ ok: true, status: 200,
      json: () => { entered(); return new Promise(() => undefined); }
    } as unknown as Response)) as typeof fetch;
    vi.useFakeTimers();
    try {
      const answer = readPublicationEvidence({ platform: "facebook", caption: "offline caption 1",
        slotTime: NOW.getTime() / 1000, fetchImpl: silentBody,
        config: { graphApiVersion: "v21.0", facebookPageId: "offline", metaAccessToken: "offline-fixture" } as AppConfig });
      await bodyEntered;
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await Promise.race([answer, Promise.resolve({ state: "still_pending" })])).toEqual({ state: "unknown" });
    } finally { vi.useRealTimers(); }
  });
  it("confirmed publication can be recorded after the retry window closes", async () => {
    mode = "present";
    await run(new Date(`${DATE}T15:30:00+08:00`)).catch(() => undefined);
    expect(sends).toEqual([]);
    expect((await loadPostLog(DATE, root)).some(row => row.post_id === "fb-already-live" && row.status === "success")).toBe(true);
    expect((await receipt()).status).toBe("resolved");
    expect(notices).toEqual([]);
  });
  it("confirmed publication does not require the original local image to remain available", async () => {
    mode = "present";
    await rm(join(root, "docs", "assets", DATE, "slot-01.png"));
    await run().catch(() => undefined);
    expect(sends).toEqual([]);
    expect((await loadPostLog(DATE, root)).some(row => row.post_id === "fb-already-live" && row.status === "success")).toBe(true);
    expect((await receipt()).status).toBe("resolved");
    expect(notices).toEqual([]);
  });
  it("a temporary DNS failure uses its never-sent evidence before one controlled retry", async () => {
    await writePostLog(DATE, [row("instagram", "success")], root);
    await writeFile(join(root, "data", "scheduled-log", `${DATE}.json`), "[]");
    vi.mocked(postFacebookPhoto).mockImplementation(async () => {
      sends.push("facebook");
      if (sends.length === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "EAI_AGAIN" } });
      return { platform: "facebook", status: "success", dry_run: false, attempts: 1, post_id: "fb-dns-retry" };
    });
    await run().catch(() => undefined);
    expect(sends).toEqual(["facebook", "facebook"]);
    expect((await loadPostLog(DATE, root)).some(row => row.post_id === "fb-dns-retry")).toBe(true);
    expect((await receipt()).retry_attempts).toBe(1);
    expect(notices).toEqual([]);
  });
});
