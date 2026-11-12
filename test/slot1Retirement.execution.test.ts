import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/config", async original => {
  const actual = await original<typeof import("../src/config")>();
  return { ...actual, getConfig: () => actual.getConfig({ DRY_RUN: "false", PUBLIC_SITE_BASE_URL: "https://example.invalid", PUBLIC_IMAGE_BASE_URL: "https://example.invalid", PUBLIC_GA4_MEASUREMENT_ID: "G-OFFLINE123", VERIFY_PUBLIC_IMAGE_URL: "false" }),
    assertLiveMetaConfig: () => undefined, assertPublicImageBaseUrl: () => undefined };
});
// Even a defeated retirement guard can only reach these local counters.
vi.mock("../src/postFacebook", async original => {
  const actual = await original<typeof import("../src/postFacebook")>();
  const stub = vi.fn(async () => ({ platform: "facebook", status: "dry_run", dry_run: true, attempts: 0, post_id: "offline" }));
  return { ...actual, postFacebookPhoto: stub, postFacebookCarousel: stub, postFacebookReel: stub };
});
vi.mock("../src/postInstagram", async original => {
  const actual = await original<typeof import("../src/postInstagram")>();
  const stub = vi.fn(async () => ({ platform: "instagram", status: "dry_run", dry_run: true, attempts: 0, post_id: "offline" }));
  return { ...actual, postInstagramPhoto: stub, postInstagramCarousel: stub, postInstagramReel: stub };
});
import { getConfig } from "../src/config";
import { autoApprove } from "../src/autoApprove";
import { approvePost } from "../src/approvePost";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadApprovalLog, loadDailyContent, loadPostLog, writeJsonAtomic } from "../src/logging";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { postFacebookPhoto } from "../src/postFacebook";
import { postInstagramPhoto } from "../src/postInstagram";
import { scheduleAheadFacebook, reconcileUncertainRows } from "../src/scheduleAhead";
import { preparePublicationRecovery } from "../src/publishRecovery";
import { scheduleReel, healOneSlot, restoreReelSlot } from "../src/scheduleReel";
import { shareLivePostsToStories } from "../src/postStory";
import { calculateRollingPublishingSla, runPublishingSlaCheck } from "../src/publishingSla";
import { generate72HourReview } from "../src/review72Hours";
import { buildOperationsDashboard } from "../src/operationsDashboard";
import { generatePublicSite } from "../src/generatePublicSite";
import { slot1Root, oldSlot1Calendar, slot1Date as date } from "./helpers/slot1RetirementHarness";
import { retirementSlot } from "./helpers/slotRetirementHarness";

let root: string;
beforeEach(async () => {
  root = await slot1Root(); vi.stubEnv("PROJECT_ROOT", root); vi.stubEnv("SXJ_OWNER_RULES", "off");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline network tripwire"); }));
  vi.clearAllMocks();
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function oldConsentAndPosts() {
  await oldSlot1Calendar(root);
  await writeJsonAtomic(join(root, `data/approved-log/${date}.json`), [1, 2].flatMap(slot => ["facebook", "instagram"].map(platform => ({ date, slot, platform, status: "approved", approved_by: "fixture", created_at: "2026-11-12T00:00:00Z" }))));
  await writeJsonAtomic(join(root, `data/posted-log/${date}.json`), [1, 2].flatMap(slot => ["facebook", "instagram"].map(platform => ({ date, slot, platform, status: "success", dry_run: false, post_id: "offline", created_at: `${date}T03:30:00Z` }))));
}

describe("slot 1 execution (isolated roots, disabled network)", () => {
  it("R3 zero-slot full TS flow succeeds with no warnings: generation, verification, approval, schedule, catchup, SLA and Stories", async () => {
    const warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    await generateDailyContent({ root, date });
    expect((await loadDailyContent(date, root))?.slots).toEqual([]);
    const approval = await autoApprove({ root, date });
    expect(approval).toMatchObject({ already_approved: true, approved_slots: [], blockers: [] });
    expect(approval.checks.every(check => check.ok)).toBe(true);
    expect(await loadApprovalLog(date, root)).toEqual([]);
    expect(await scheduleAheadFacebook({ root, date, config: getConfig(), now: new Date("2026-11-15T12:00:00+08:00"), fetchImpl: fetch })).toEqual([]);
    expect(await postCurrentSlot({ root, date, allDue: true, now: `${date}T21:00:00+08:00`, dryRun: false, fetchImpl: fetch })).toEqual([]);
    for (const slot of [1, 2] as const) expect(await runPublishingSlaCheck({ root, slot, now: new Date(`${date}T21:00:00+08:00`), mode: "overdue", fetchImpl: fetch })).toMatchObject({ checkpoint_status: "pass" });
    expect(await shareLivePostsToStories({ root, date })).toEqual([]);
    expect(await loadPostLog(date, root)).toEqual([]);
    expect(postFacebookPhoto).not.toHaveBeenCalled(); expect(postInstagramPhoto).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("R3 old slot 1 calendar/consent/live log cannot approve, pre-schedule, post, backfill, reconcile or share a Story", async () => {
    await oldConsentAndPosts();
    const result = await autoApprove({ root, date });
    expect(result).toMatchObject({ already_approved: true, approved_slots: [], blockers: [] });
    const approvalBytes = await readFile(join(root, `data/approved-log/${date}.json`), "utf8");
    await expect(approvePost({ root, date, slot: 1, platforms: ["facebook", "instagram"], approvedBy: "fixture", force: true })).rejects.toThrow(/slot 1 retired from/);
    expect(await readFile(join(root, `data/approved-log/${date}.json`), "utf8")).toBe(approvalBytes);
    await writeJsonAtomic(join(root, `data/scheduled-log/${date}.json`), [{ date, slot: 1, status: "uncertain" }]);
    expect((await reconcileUncertainRows({ root, date, slots: [retirementSlot(1, date)], config: getConfig(), now: new Date(`${date}T21:00:00+08:00`), fetchImpl: fetch })).handled.size).toBe(0);
    expect(await scheduleAheadFacebook({ root, date, config: getConfig(), fetchImpl: fetch })).toEqual([]);
    for (const backfill of [false, true]) expect(await postCurrentSlot({ root, date, slot: 1, backfill, now: `${date}T21:00:00+08:00`, dryRun: false, fetchImpl: fetch })).toEqual([]);
    expect(await shareLivePostsToStories({ root, date })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled(); expect(postFacebookPhoto).not.toHaveBeenCalled(); expect(postInstagramPhoto).not.toHaveBeenCalled();
  });
  it.each(["facebook", "instagram"] as const)("R3 %s recovery rejects retired slot 1 before any evidence/API work", async platform => {
    await expect(preparePublicationRecovery({ root, date, platform, slot: retirementSlot(1, date), config: getConfig(), now: new Date(`${date}T12:00:00+08:00`), fetchImpl: fetch })).rejects.toThrow(/slot 1 retired from/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("R3 manual Reel insertion and restore refuse slot 1 with owner reason; heal stops and force generation cannot restore it", async () => {
    await expect(scheduleReel({ root, date, conceptId: "shirt-collar", slot: 1, force: true })).rejects.toThrow(/slot 1 retired from.*店主決定停發/);
    await expect(restoreReelSlot({ root, date, slotNumber: 1 })).rejects.toThrow(/slot 1 retired from/);
    expect(await healOneSlot({ root, date, slotNumber: 1, conceptId: "shirt-collar", variant: "10s" })).toMatchObject({ action: "stopped", stopReason: expect.stringContaining("slot 1 retired") });
    await oldSlot1Calendar(root);
    await generateDailyContent({ root, date, force: true });
    expect((await loadDailyContent(date, root))?.slots).toEqual([]);
  });
  it("R4 zero daily slots preserve the 14:00 feature Reel in public-site output and keep empty performance export valid", async () => {
    // This date was generated/approved before deployment, but its daily slots
    // never aired. The site must still retain the independent feature Reel.
    await oldSlot1Calendar(root);
    await writeJsonAtomic(join(root, `data/approved-log/${date}.json`), [1, 2].flatMap(slot => ["facebook", "instagram"].map(platform => ({ date, slot, platform, status: "approved", approved_by: "fixture", created_at: "2026-11-12T00:00:00Z" }))));
    await writeFile(join(root, "data/business-profile.json"), await readFile("data/business-profile.json"));
    await writeJsonAtomic(join(root, `data/feature-reels/${date}.json`), { date, slug: "offline-feature", video_url: "https://example.invalid/feature.mp4", local_video_path: "feature.mp4", facebook_caption: "特輯鞋類工藝", instagram_caption: "特輯鞋類工藝", youtube_title: "14:00 特輯" });
    await writeFile(join(root, "feature.mp4"), "offline fixture");
    await writeJsonAtomic(join(root, `data/feature-posted-log/${date}.json`), [{ slug: "offline-feature", platform: "facebook", status: "success", at: `${date}T06:00:00Z`, post_id: "offline_feature" }]);
    const result = await generatePublicSite({ root, baseUrl: "https://example.invalid", now: `${date}T15:00:00+08:00` });
    const index = JSON.parse(await readFile(join(root, "docs/social-posts.json"), "utf8"));
    expect(index.posts.map((post: { slot: number }) => post.slot)).toEqual([0]);
    expect(index.posts[0]).toMatchObject({ category: "feature-reel", time: "14:00" });
    expect(await generate72HourReview({ root, asOf: new Date("2026-11-20T00:00:00Z") })).toEqual([]);
    const dashboard = await buildOperationsDashboard({ root, startDate: date, totalDays: 1, asOf: new Date(`${date}T23:00:00+08:00`) });
    expect(dashboard.slots).toEqual([]); expect(JSON.stringify(dashboard)).not.toMatch(/NaN|Infinity/);
    expect(result).toBeDefined(); expect(fetch).not.toHaveBeenCalled();
  }, 30000);
  it("R4 actual as-aired slot 1 metadata remains available to performance export", async () => {
    await oldConsentAndPosts();
    const rows = await generate72HourReview({ root, asOf: new Date("2026-11-20T00:00:00Z") });
    expect(rows.find(row => row.slot === 1)).toMatchObject({ topic: "fixture 1", date, slot: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("R3 fourteen zero-slot dates have no phantom noon SLA debt, zero denominator is null, and a real slot 3 still counts", async () => {
    for (let day = 16; day <= 29; day++) await generateDailyContent({ root, date: `2026-11-${day}` });
    const now = new Date("2026-11-29T23:00:00+08:00");
    expect(await calculateRollingPublishingSla(root, now)).toMatchObject({ due_slots: 0, fulfillment_rate: null, target_met: null });
    expect(await runPublishingSlaCheck({ root, now, slot: 3, mode: "overdue", fetchImpl: fetch })).toMatchObject({ checkpoint_status: "pass" });
    const { writeDailyContent } = await import("../src/logging");
    await writeDailyContent({ date: "2026-11-29", timezone: "Asia/Taipei", generated_at: now.toISOString(), slots: [retirementSlot(3, "2026-11-29")] }, root);
    expect((await calculateRollingPublishingSla(root, now)).due_slots).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
