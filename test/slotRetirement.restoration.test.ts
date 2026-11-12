import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config", async original => {
  const actual = await original<typeof import("../src/config")>();
  return { ...actual, getConfig: () => actual.getConfig({ DRY_RUN: "true", PUBLIC_SITE_BASE_URL: "https://example.invalid", PUBLIC_IMAGE_BASE_URL: "https://example.invalid", VERIFY_PUBLIC_IMAGE_URL: "false" }),
    assertLiveMetaConfig: () => undefined, assertPublicImageBaseUrl: () => undefined };
});
vi.mock("../src/mediaAssets", async original => ({ ...await original<typeof import("../src/mediaAssets")>(), imageAssetsForSlot: () => [] }));
vi.mock("../src/imageStamp", async original => ({ ...await original<typeof import("../src/imageStamp")>(), imageEvidenceFailures: async () => [], imagesChangedSinceStamp: async () => [], imagesDifferFromApproval: async () => [] }));
vi.mock("../src/postFacebook", async original => ({ ...await original<typeof import("../src/postFacebook")>(),
  postFacebookPhoto: vi.fn(async () => ({ platform: "facebook", status: "dry_run", dry_run: true, attempts: 0, post_id: "fixture-fb" })) }));
vi.mock("../src/postInstagram", async original => ({ ...await original<typeof import("../src/postInstagram")>(),
  postInstagramPhoto: vi.fn(async () => ({ platform: "instagram", status: "dry_run", dry_run: true, attempts: 0, post_id: "fixture-ig" })) }));

import { getConfig } from "../src/config";
import { buildDailyContent, inspectDailyContentIntegrity } from "../src/contentPlan";
import { detectAndRecordCalendarTamper, loadDailyContent, writeDailyContent, writeJsonAtomic } from "../src/logging";
import { assertSlotActive, slotRetirement } from "../src/slotRetirements";
import { postCurrentSlot } from "../src/postCurrentSlot";
import { postFacebookPhoto } from "../src/postFacebook";
import { postInstagramPhoto } from "../src/postInstagram";
import { generate72HourReview } from "../src/review72Hours";
import { fetchPostedFacebookInsights } from "../src/facebookInsights";
import { fetchPostedInstagramInsights } from "../src/instagramInsights";
import { calculateRollingPublishingSla, runPublishingSlaCheck } from "../src/publishingSla";
import { buildOperationsDashboard } from "../src/operationsDashboard";
import { buildAbTestReport } from "../src/abTestReport";
import { lockDay, healDay } from "../src/dayLock";
import { listMissingCalendarImages } from "../src/generateImage";
import { retirementRoot, retirementSlot, seedRetirementCalendar } from "./helpers/slotRetirementHarness";

const cwd = process.cwd(), date = "2026-11-20";
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
let root: string;
beforeEach(async () => {
  root = await retirementRoot();
  await mkdir(join(root, "output"), { recursive: true });
  vi.stubEnv("PROJECT_ROOT", root); vi.stubEnv("SXJ_OWNER_RULES", "off"); vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No network in restoration witnesses"); }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

async function restoreAfterWriting(): Promise<void> {
  await seedRetirementCalendar(root, date);
  await writeDailyContent({ date, timezone: "Asia/Taipei", generated_at: "2026-11-17T00:00:00Z", slots: [1, 2].map(slot => retirementSlot(slot, date)) }, root);
  const written = JSON.parse(await readFile(join(root, `data/content-calendar/${date}.json`), "utf8"));
  expect(written.slots.map((slot: { slot: number }) => slot.slot)).toEqual([1]);
  await writeJsonAtomic(join(root, "src/slot-retirements.json"), { version: 1, retirements: [] });
}
async function postedSlotOne(day = date): Promise<void> {
  await writeJsonAtomic(join(root, `data/posted-log/${day}.json`), ["facebook", "instagram"].map(platform => ({ date: day, slot: 1, platform,
    status: "success", dry_run: false, post_id: `fixture-${day}-${platform}`, created_at: `${day}T03:30:00Z` })));
}
function ps(code: string, env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", code],
    { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", timeout: 45000, windowsHide: true });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`).toBe(0);
  return result.stdout;
}

describe("F1 calendars survive retirement entry removal", () => {
  it("reads both active and as-aired calendars after removal without tamper/rebuild, and new generation restores slot 2", async () => {
    await restoreAfterWriting();
    for (const includeRetiredSlots of [false, true]) {
      const content = (await loadDailyContent(date, root, { today: "2026-11-17", includeRetiredSlots }))!;
      expect(content.slots.map(slot => slot.slot)).toEqual([1]);
      expect(inspectDailyContentIntegrity(content, { root, today: "2026-11-17" }).tampered).toBe(false);
    }
    expect(await detectAndRecordCalendarTamper(date, root, { today: "2026-11-17" })).toMatchObject({ tampered: false, shouldRebuild: false });
    expect(await listMissingCalendarImages(date, root)).toEqual([]);
    expect(await lockDay(date, root)).toMatch(/locked/);
    expect(await healDay(date, root)).toBe("intact");
    expect(buildDailyContent("2026-11-21", getConfig(), { root, abPlan: [] }).slots.map(slot => slot.slot)).toEqual([1, 2]);
    await writeDailyContent(buildDailyContent("2026-11-21", getConfig(), { root, abPlan: [] }), root);
    expect((await loadDailyContent("2026-11-21", root))?.slots.map(slot => slot.slot)).toEqual([1, 2]);
    // Re-stamping a previously omitted day must preserve its write-time evidence.
    await writeDailyContent((await loadDailyContent(date, root))!, root);
    expect((await loadDailyContent(date, root))?.slots.map(slot => slot.slot)).toEqual([1]);
  });
  it("the write-time omission is checksum-covered; a plain incomplete calendar cannot claim it", async () => {
    await restoreAfterWriting();
    const path = join(root, `data/content-calendar/${date}.json`);
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.retired_slots).toEqual([2]);
    await writeFile(path, JSON.stringify({ ...raw, retired_slots: [2, 3] }));
    expect((await loadDailyContent(date, root, { today: "2026-11-17" }))?.tampered).toBe(true);
    delete raw.retired_slots;
    await writeFile(path, JSON.stringify(raw));
    await expect(loadDailyContent(date, root, { today: "2026-11-17" })).rejects.toThrow(/Invalid daily content/);
  });
  it("all-due publishes only the saved slot 1 without missing-slot failure after removal", async () => {
    await restoreAfterWriting();
    await writeJsonAtomic(join(root, `data/approved-log/${date}.json`), ["facebook", "instagram"].map(platform => ({ date, slot: 1, platform, status: "approved", approved_by: "fixture", created_at: "2026-11-17T00:00:00Z" })));
    const rows = await postCurrentSlot({ root, date, allDue: true, now: `${date}T21:00:00+08:00`, dryRun: true, verifyPublicImageUrl: false });
    expect(rows.map(row => row.slot)).toEqual([1, 1]);
    expect(vi.mocked(postFacebookPhoto).mock.calls.map(call => call[0].slot)).toEqual([1]);
    expect(vi.mocked(postInstagramPhoto).mock.calls.map(call => call[0].slot)).toEqual([1]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("SLA, dashboard and AB audit retain the saved omission after removal", async () => {
    await restoreAfterWriting(); await postedSlotOne();
    expect((await calculateRollingPublishingSla(root, new Date(`${date}T23:00:00+08:00`))).due_slots).toBe(41);
    expect(await runPublishingSlaCheck({ root, now: new Date(`${date}T20:45:00+08:00`), slot: 2, mode: "overdue" }))
      .toMatchObject({ checkpoint_status: "pass", message: expect.stringContaining("omitted when this calendar was written") });
    const dashboard = await buildOperationsDashboard({ root, startDate: date, totalDays: 1, asOf: new Date(`${date}T23:00:00+08:00`) });
    expect(dashboard.slots.map(slot => slot.slot)).toEqual([1]);
    await writeJsonAtomic(join(root, "data/ab-test-plan.json"), [{ date, noon: { conceptId: "shirt-collar", variant: "10s" }, evening: { conceptId: "shirt-collar", variant: "15s" } }]);
    const ab = await buildAbTestReport({ root, asOf: date });
    expect(ab.data_gaps.some(gap => gap.includes("slot 2"))).toBe(false);
    expect(ab.data_gaps.some(gap => gap.includes("slot 3"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["review72Hours", "facebookInsights", "instagramInsights"])("%s visits the saved one-slot day and continues to the following date", async consumer => {
    await restoreAfterWriting(); await postedSlotOne();
    const nextDate = "2026-11-21";
    await writeDailyContent({ date: nextDate, timezone: "Asia/Taipei", generated_at: "2026-11-17T00:00:00Z", slots: [1, 2].map(slot => retirementSlot(slot, nextDate)) }, root);
    await postedSlotOne(nextDate);
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ id: "fixture", data: [], media_product_type: "FEED" }), { status: 200 }));
    const config = { ...getConfig(), metaAccessToken: "fixture-access-for-offline-tests" };
    const rows = consumer === "review72Hours"
      ? await generate72HourReview({ root, asOf: new Date("2026-11-25T00:00:00Z") })
      : consumer === "facebookInsights"
        ? (await fetchPostedFacebookInsights({ root, since: date, until: nextDate, config, fetchImpl: fakeFetch })).rows
        : (await fetchPostedInstagramInsights({ root, since: date, until: nextDate, config, fetchImpl: fakeFetch })).rows;
    expect(rows.map(row => row.date)).toEqual([date, nextDate]);
    expect(rows.map(row => row.topic)).toEqual(["fixture 1", "fixture 1"]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.runIf(process.platform === "win32")("PS missing-required, due/stale/rescue and catchup/watchdog assignments use the saved calendar after removal", async () => {
    await restoreAfterWriting();
    const output = ps(`. ${quote(join(cwd, "scripts/publish-slot-times.ps1"))};
      $root=${quote(root)}; $date='${date}'; $calendarSlots=Get-CalendarSlots -Root $root -Date $date;
      $times=Get-SlotTimes -Root $root -Date $date;
      $windows=Get-CatchupSlotWindows -NowTime ([TimeSpan]'21:00') -SlotTimes $times -CalendarSlots $calendarSlots;
      $result=[ordered]@{missing=@(Get-MissingRequiredCalendarSlots -CalendarSlots $calendarSlots -Root $root -Date $date);
        active=@(Get-EffectivePublishSlots -CalendarSlots $calendarSlots -Root $root -Date $date);due=@($windows.DueSlots);stale=@($windows.StaleSlots);
        rescue=(Test-NeedsPublishRescue -NowTime ([TimeSpan]'21:00') -SlotTimes $times -CalendarSlots $calendarSlots -PostedSlots @(1))};
      foreach($file in @('catchup-publish.ps1','watchdog-patrol.ps1')) {
        $tokens=$null; $errors=$null;
        $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path ${quote(join(cwd, "scripts"))} $file),[ref]$tokens,[ref]$errors);
        if(@($errors).Count){throw 'Production script parse error'};
        $assign=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$missingRequiredCalendarSlots'},$true));
        if($assign.Count -ne 1){throw 'Missing-required assignment changed'};
        . ([scriptblock]::Create($assign[0].Extent.Text)); $result[$file]=@($missingRequiredCalendarSlots);
      }; $result|ConvertTo-Json -Compress`);
    expect(JSON.parse(output)).toEqual({ missing: [], active: [1], due: [], stale: [1], rescue: false, "catchup-publish.ps1": [], "watchdog-patrol.ps1": [] });
  }, 45000);
  it.each(["sentinel", "time-gate"])("%s emits no missing-slot toast or rescue after removal", async consumer => {
    if (process.platform !== "win32") return;
    await restoreAfterWriting(); await postedSlotOne(); await mkdir(join(root, "scripts"), { recursive: true });
    const marker = join(root, "output/rescue-called"), toast = join(root, "output/toast");
    const fakeCatchup = join(root, "scripts/catchup-publish.ps1");
    await writeFile(fakeCatchup, `[IO.File]::WriteAllText(${quote(marker)},'called')`);
    const fakeCmd = join(root, "catchup.cmd");
    await writeFile(fakeCmd, `@echo off\r\necho called>"${marker}"\r\nexit /b 0\r\n`, "ascii");
    ps(consumer === "sentinel"
      ? `& ${quote(join(cwd, "scripts/publish-sentinel.ps1"))} -RootPath ${quote(root)}`
      : `function Get-CimInstance { [CmdletBinding()]param($ClassName); @() }; & ${quote(join(cwd, "scripts/publish-time-gate.ps1"))} -RootPath ${quote(root)}`,
    { PUBLISH_SENTINEL_DATE: date, PUBLISH_SENTINEL_TIME: "21:00", PUBLISH_SENTINEL_TOAST_FILE: toast,
      PUBLISH_GATE_DATE: date, PUBLISH_GATE_TIME: "21:00", PUBLISH_GATE_TOAST_FILE: toast, PUBLISH_GATE_CATCHUP_CMD: fakeCmd });
    expect(await readFile(marker, "utf8").catch(() => "")).toBe("");
    expect(await readFile(toast, "utf8").catch(() => "")).toBe("");
  }, 45000);
  it.runIf(process.platform === "win32")("day-audit accepts the saved one-slot day after removal", async () => {
    await restoreAfterWriting(); await postedSlotOne();
    await seedRetirementCalendar(root, "2026-11-21");
    await writeJsonAtomic(join(root, `data/first-comments/${date}.json`), [{ slot: 1, comment_id: "fixture-comment" }]);
    ps(`& ${quote(join(cwd, "scripts/day-audit.ps1"))} -RootPath ${quote(root)} -Date '${date}' -AuditOnly`);
    const report = JSON.parse((await readFile(join(root, `output/day-reports/${date}.json`), "utf8")).replace(/^\uFEFF/u, ""));
    expect(report.ok).toBe(true); expect(report.missing_posts).toEqual([]); expect(report.missing_comments).toEqual([]);
  }, 45000);
});

describe("F2 historical dates ignore missing or invalid policy", () => {
  it.each(["missing", "broken", "directory"])("does not block any historical slot or log a config error for %s", async kind => {
    const path = join(root, "src/slot-retirements.json");
    if (kind === "missing") await unlink(path);
    else if (kind === "directory") { await unlink(path); await mkdir(path); }
    else await writeFile(path, "{broken");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const day of ["1969-01-01", "2026-05-19", "2026-11-14", "2026-11-15", "2026-11-15T15:59:59Z"]) {
      for (const slot of [1, 2, 3]) expect(slotRetirement(day, slot, root)).toEqual({ retired: false });
    }
    expect(() => assertSlotActive("2026-05-19", 2, root)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    expect(slotRetirement("2026-11-16", 2, root)).toMatchObject({ retired: true, error: expect.stringContaining("fail closed") });
    expect(slotRetirement("2026-11-15T16:00:00Z", 2, root).retired).toBe(true);
    expect(slotRetirement("2026-11-16", 1, root).retired).toBe(true);
    expect(slotRetirement("2026-11-16", 3, root).retired).toBe(false);
  });
});
