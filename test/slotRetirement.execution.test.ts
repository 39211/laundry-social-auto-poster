import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); });
vi.mock("../src/config", async original => {
  const actual = await original<typeof import("../src/config")>();
  return { ...actual, getConfig: () => actual.getConfig({ DRY_RUN: "true", PUBLIC_SITE_BASE_URL: "https://example.invalid", PUBLIC_IMAGE_BASE_URL: "https://example.invalid", VERIFY_PUBLIC_IMAGE_URL: "false" }),
    assertLiveMetaConfig: () => undefined, assertPublicImageBaseUrl: () => undefined };
});
vi.mock("../src/mediaAssets", async original => ({ ...await original<typeof import("../src/mediaAssets")>(), imageAssetsForSlot: () => [] }));
vi.mock("../src/imageStamp", async original => ({ ...await original<typeof import("../src/imageStamp")>(), imageEvidenceFailures: async () => [], imagesChangedSinceStamp: async () => [], imagesDifferFromApproval: async () => [] }));
vi.mock("../src/postFacebook", async original => {
  const actual = await original<typeof import("../src/postFacebook")>();
  const stub = vi.fn(async () => ({ platform: "facebook", status: "dry_run", dry_run: true, attempts: 0, post_id: "fixture-fb" }));
  return { ...actual, postFacebookPhoto: stub, postFacebookCarousel: stub, postFacebookReel: stub };
});
vi.mock("../src/postInstagram", async original => {
  const actual = await original<typeof import("../src/postInstagram")>();
  const stub = vi.fn(async () => ({ platform: "instagram", status: "dry_run", dry_run: true, attempts: 0, post_id: "fixture-ig" }));
  return { ...actual, postInstagramPhoto: stub, postInstagramCarousel: stub, postInstagramReel: stub };
});

import { getConfig } from "../src/config";
import { autoApprove } from "../src/autoApprove";
import { approvePost } from "../src/approvePost";
import { loadApprovalLog, loadPostLog, writeJsonAtomic } from "../src/logging";
import { generateDailyContent } from "../src/generateDailyContent";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { postFacebookPhoto } from "../src/postFacebook";
import { postInstagramPhoto } from "../src/postInstagram";
import { scheduleAheadFacebook, reconcileUncertainRows } from "../src/scheduleAhead";
import { preparePublicationRecovery } from "../src/publishRecovery";
import { scheduleReel, healOneSlot, restoreReelSlot } from "../src/scheduleReel";
import { calculateRollingPublishingSla, runPublishingSlaCheck } from "../src/publishingSla";
import { buildAbTestReport } from "../src/abTestReport";
import { buildOperationsDashboard } from "../src/operationsDashboard";
import { deliverPendingFacebookAlerts } from "../src/facebookLostAlert";
import { generate72HourReview } from "../src/review72Hours";
import { retirementRoot, retirementSlot, seedRetirementCalendar } from "./helpers/slotRetirementHarness";
const date = "2026-11-16";
let root: string;
let noNetwork: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  root = await retirementRoot(); vi.stubEnv("PROJECT_ROOT", root); vi.stubEnv("SXJ_OWNER_RULES", "off");
  noNetwork = vi.fn(async () => { throw new Error("network disabled in retirement witness"); });
  vi.stubGlobal("fetch", noNetwork); vi.clearAllMocks();
  await seedRetirementCalendar(root, date);
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function approveFixture(): Promise<void> {
  await writeJsonAtomic(join(root, `data/approved-log/${date}.json`), [1, 2].flatMap(slot => ["facebook", "instagram"].map(platform => ({ date, slot, platform, status: "approved", approved_by: "fixture", created_at: "2026-11-10T00:00:00Z" }))));
}

describe("slot retirement execution gates (all paths isolated)", () => {
  it("auto-approves slot 1 from an old two-slot calendar and grants no slot 2 consent", async () => {
    await writeJsonAtomic(join(root, "data/publishing-policy.json"), { status: "active", start_date: "2026-01-01", end_date: "2027-12-31", platforms: ["facebook", "instagram"], slots: [{ slot: 1 }, { slot: 2 }] });
    const result = await autoApprove({ root, date });
    expect(result.approved_slots).toEqual([1]);
    expect((await loadApprovalLog(date, root)).map(row => row.slot)).toEqual([1, 1]);
    expect(noNetwork).not.toHaveBeenCalled();
  });
  it("manual approval including force explicitly refuses the retired slot before granting consent", async () => {
    await expect(approvePost({ root, date, slot: 2, platforms: ["facebook", "instagram"], approvedBy: "fixture", force: true })).rejects.toThrow(/retired from/);
    expect(await loadApprovalLog(date, root)).toEqual([]);
  });
  it.each([false, true])("all-due publishing cannot send old calendar slot 2 (bad config=%s)", async bad => {
    await approveFixture();
    if (bad) await unlink(join(root, "src/slot-retirements.json"));
    const results = await postCurrentSlot({ root, date, allDue: true, now: `${date}T21:00:00+08:00`, dryRun: true, verifyPublicImageUrl: false, fetchImpl: noNetwork as unknown as typeof fetch });
    expect(results.map(row => row.slot)).toEqual(bad ? [] : [1, 1]);
    expect(vi.mocked(postFacebookPhoto).mock.calls.map(call => call[0].slot)).toEqual(bad ? [] : [1]);
    expect(vi.mocked(postInstagramPhoto).mock.calls.map(call => call[0].slot)).toEqual(bad ? [] : [1]);
    expect((await loadPostLog(date, root)).every(row => row.slot === 1)).toBe(true);
    expect(noNetwork).not.toHaveBeenCalled();
  });
  it("explicit post and backfill requests never send a retired slot, even with an existing approval", async () => {
    await approveFixture();
    for (const backfill of [false, true]) expect(await postCurrentSlot({ root, date, slot: 2, backfill, dryRun: true, now: `${date}T21:00:00+08:00` })).toEqual([]);
    expect(postFacebookPhoto).not.toHaveBeenCalled(); expect(postInstagramPhoto).not.toHaveBeenCalled();
  });
  it("schedule-ahead schedules only slot 1 despite old slot 2 calendar and consent", async () => {
    await approveFixture();
    const preflight = vi.fn(async () => new Response(null, { headers: { "content-type": "image/jpeg" } }));
    const result = await scheduleAheadFacebook({ root, date, config: { ...getConfig(), dryRun: false }, now: new Date("2026-11-15T00:00:00+08:00"), fetchImpl: preflight as unknown as typeof fetch });
    expect(result.map(row => row.slot)).toEqual([1]);
    expect(vi.mocked(postFacebookPhoto).mock.calls.map(call => call[0].slot)).toEqual([1]);
    expect(noNetwork).not.toHaveBeenCalled();
  });
  it("uncertain slot 2 reconciliation is ignored before any Page read or reschedule", async () => {
    await writeJsonAtomic(join(root, `data/scheduled-log/${date}.json`), [{ date, slot: 2, platform: "facebook", status: "uncertain" }]);
    const result = await reconcileUncertainRows({ root, date, config: getConfig(), now: new Date(`${date}T21:00:00+08:00`), slots: [retirementSlot(2, date)], fetchImpl: noNetwork as unknown as typeof fetch });
    expect(result.handled.size).toBe(0); expect(result.rescheduled.size).toBe(0); expect(noNetwork).not.toHaveBeenCalled();
  });
  it.each(["facebook", "instagram"] as const)("recovery for %s refuses slot 2 before reading platform evidence", async platform => {
    await expect(preparePublicationRecovery({ root, date, platform, slot: retirementSlot(2, date), config: getConfig(), now: new Date(`${date}T21:00:00+08:00`), fetchImpl: noNetwork as unknown as typeof fetch })).rejects.toThrow(/retired from/);
    expect(noNetwork).not.toHaveBeenCalled();
  });
  it("manual scheduleReel and restore reject with the owner's reason; heal stops before asset work", async () => {
    await expect(scheduleReel({ root, date, conceptId: "shirt-collar", slot: 2, force: true })).rejects.toThrow(/retired from.*owner retirement/);
    await expect(restoreReelSlot({ root, date, slotNumber: 2 })).rejects.toThrow(/retired from/);
    expect(await healOneSlot({ root, date, slotNumber: 2, conceptId: "shirt-collar", variant: "10s" })).toMatchObject({ action: "stopped", stopReason: expect.stringContaining("retired from") });
  });
  it("force regeneration does not restore an existing reviewed slot 2 Reel", async () => {
    const path = join(root, `data/content-calendar/${date}.json`);
    const raw = JSON.parse(await readFile(path, "utf8")); raw.slots[1].media_type = "reel"; raw.slots[1].local_video_path = "old.mp4";
    // A valid pre-existing stamp is required; use the production stamping function only in this temporary root.
    const { stampDailyContentWrite } = await import("../src/contentPlan");
    await writeJsonAtomic(path, stampDailyContentWrite(raw, { root })); await writeFile(join(root, "old.mp4"), "fixture video");
    await generateDailyContent({ root, date, force: true });
    const generated = JSON.parse(await readFile(path, "utf8"));
    expect(generated.slots.map((s: { slot: number }) => s.slot)).toEqual([1]);
  });
  it("SLA skips retired checkpoints and subtracts only retired slot 2 from the rolling denominator", async () => {
    const report = await runPublishingSlaCheck({ root, now: new Date(`${date}T20:45:00+08:00`), slot: 2, mode: "overdue", fetchImpl: noNetwork as unknown as typeof fetch });
    expect(report).toMatchObject({ checkpoint_status: "pass", message: expect.stringContaining("retired from") });
    expect((await calculateRollingPublishingSla(root, new Date("2026-11-15T23:59:00+08:00"))).due_slots).toBe(42);
    expect((await calculateRollingPublishingSla(root, new Date(`${date}T23:59:00+08:00`))).due_slots).toBe(41);
    expect(noNetwork).not.toHaveBeenCalled();
  });
  it("AB reporting does not label a retired evening plan as missing publication", async () => {
    await writeJsonAtomic(join(root, "data/ab-test-plan.json"), [{ date, noon: { conceptId: "shirt-collar", variant: "10s" }, evening: { conceptId: "shirt-collar", variant: "15s" } }]);
    const report = await buildAbTestReport({ root, asOf: date });
    expect(report.data_gaps.some(gap => gap.includes("slot 2"))).toBe(false);
    expect(report.data_gaps.some(gap => gap.includes("slot 3"))).toBe(true);
  });
  it("operations dashboard omits retired planned slots instead of showing not-generated or overdue", async () => {
    const result = await buildOperationsDashboard({ root, startDate: date, totalDays: 1, asOf: new Date(`${date}T23:00:00+08:00`) });
    expect(result.slots.map(row => row.slot)).not.toContain(2);
    expect(result.slots.map(row => row.slot)).toContain(1);
    expect(noNetwork).not.toHaveBeenCalled();
  });
  it("pending FB_LOST notifications ignore retired slot 2 but still deliver slot 1", async () => {
    for (const slot of [1, 2]) await writeJsonAtomic(join(root, `output/alerts/fb-lost-${date}-slot${slot}.json`), { alert: "FB_LOST", date, slot });
    const sender = vi.fn(async (_message: string, _key: string) => true);
    expect(await deliverPendingFacebookAlerts({ root, date, sender })).toEqual({ delivered: 1, pending: 0 });
    expect(sender).toHaveBeenCalledTimes(1); expect(sender.mock.calls[0]?.[0]).toContain("第 1 槽");
  });
  it("read-only performance export retains metadata of any actual as-aired slot 2 ledger entry", async () => {
    await writeJsonAtomic(join(root, `data/posted-log/${date}.json`), ["facebook", "instagram"].map(platform => ({ date, slot: 2, platform, status: "success", dry_run: false, post_id: `fixture-${platform}`, created_at: `${date}T12:30:00Z` })));
    const rows = await generate72HourReview({ root, asOf: new Date("2026-11-20T00:00:00Z") });
    expect(rows.find(row => row.slot === 2)).toMatchObject({ topic: "fixture 2", slot: 2, date });
    expect(noNetwork).not.toHaveBeenCalled();
  });
});
