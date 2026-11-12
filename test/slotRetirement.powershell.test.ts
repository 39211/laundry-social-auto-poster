import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); });
import { writeJsonAtomic } from "../src/logging";
import { retirementRoot, seedRetirementCalendar } from "./helpers/slotRetirementHarness";
const cwd = process.cwd();
let root: string;
const date = "2026-11-16";
function ps(code: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", code], { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: 45000, windowsHide: true });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`).toBe(0);
  return result.stdout;
}
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
beforeEach(async () => { root = await retirementRoot(); await mkdir(join(root, "output"), { recursive: true }); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe.runIf(process.platform === "win32")("slot retirement PowerShell operational paths", () => {
  it("shared due/missing helpers preserve November 15 and exclude November 16 including stale and absent-calendar fallbacks", () => {
    const output = ps(`. ${quote(join(cwd, "scripts/publish-slot-times.ps1"))};
      $r=${quote(root)};
      foreach($d in @('2026-11-15','2026-11-16')) {
        $t=Get-SlotTimes -Root $r -Date $d;
        $e=@(Get-EffectivePublishSlots -CalendarSlots @(1,2,3) -Root $r -Date $d);
        $m=@(Get-MissingRequiredCalendarSlots -CalendarSlots @(1) -Root $r -Date $d);
        $w=Get-CatchupSlotWindows -NowTime ([TimeSpan]'23:00') -SlotTimes $t -CalendarSlots @(1,2,3);
        [pscustomobject]@{date=$d;active=$e;missing=$m;due=@($w.DueSlots);stale=@($w.StaleSlots)}|ConvertTo-Json -Compress;
      }
      @(Get-EffectivePublishSlots -CalendarSlots $null -Root $r -Date '2026-11-16') -join ','`);
    expect(output).toContain('"active":[1,2,3]');
    expect(output).toContain('"active":[1,3]');
    expect(output).toContain('"missing":[2]');
    expect(output).toContain('"missing":[]');
    expect(output).toMatch(/1,3\s*$/);
  }, 45000);
  it("shared PS reader fails closed on missing and malformed config for both daily slots", async () => {
    await writeFile(join(root, "src/slot-retirements.json"), "broken");
    const output = ps(`. ${quote(join(cwd, "scripts/publish-slot-times.ps1"))}; $t=Get-SlotTimes -Root ${quote(root)} -Date '${date}'; 'ACTIVE='+(@($t.Keys|Sort-Object)-join ',')`);
    expect(output).toContain("fail closed"); expect(output).toContain("ACTIVE=3");
  }, 45000);
  it("sentinel with old slot 2 calendar/uncertain ledger emits no missed-slot toast and never invokes catchup", async () => {
    await seedRetirementCalendar(root, date);
    await mkdir(join(root, "scripts"), { recursive: true });
    const invoked = join(root, "output/catchup-called");
    await writeFile(join(root, "scripts/catchup-publish.ps1"), `[IO.File]::WriteAllText(${quote(invoked)},'called')`, "utf8");
    await writeJsonAtomic(join(root, `data/posted-log/${date}.json`), [
      ...["facebook", "instagram"].map(platform => ({ slot: 1, platform, dry_run: false, status: "success" })),
      ...["facebook", "instagram"].map(platform => ({ slot: 2, platform, dry_run: false, status: "uncertain" }))
    ]);
    const toast = join(root, "output/toast");
    ps(`& ${quote(join(cwd, "scripts/publish-sentinel.ps1"))} -RootPath ${quote(root)}`, { PUBLISH_SENTINEL_DATE: date, PUBLISH_SENTINEL_TIME: "21:00", PUBLISH_SENTINEL_TOAST_FILE: toast });
    expect(await readFile(invoked, "utf8").catch(() => "")).toBe("");
    expect(await readFile(toast, "utf8").catch(() => "")).toBe("");
    expect(await readFile(join(root, "output/publish-sentinel.log"), "utf8")).toContain("all due pairs posted");
  }, 45000);
  it("time gate with an old slot 2 calendar invokes no rescue for a retired slot", async () => {
    await seedRetirementCalendar(root, date);
    await writeJsonAtomic(join(root, `data/posted-log/${date}.json`), ["facebook", "instagram"].map(platform => ({ slot: 1, platform, dry_run: false, status: "success" })));
    // Process inventory and the only possible catchup command are local stubs.
    const toast = join(root, "output/gate-toast");
    const calls = join(root, "output/gate-called");
    const stub = join(root, "catchup.cmd");
    await writeFile(stub, `@echo off\r\necho called>"${calls}"\r\nexit /b 0\r\n`, "ascii");
    ps(`function Get-CimInstance { [CmdletBinding()]param($ClassName); @() }; & ${quote(join(cwd, "scripts/publish-time-gate.ps1"))} -RootPath ${quote(root)}`, { PUBLISH_GATE_DATE: date, PUBLISH_GATE_TIME: "21:00", PUBLISH_GATE_TOAST_FILE: toast, PUBLISH_GATE_CATCHUP_CMD: stub });
    expect(await readFile(calls, "utf8").catch(() => "")).toBe("");
    expect(await readFile(toast, "utf8").catch(() => "")).toBe("");
  }, 45000);
  it("day-audit accepts slot 1 only and ignores tomorrow's retired evening Reel in the plan", async () => {
    await seedRetirementCalendar(root, date);
    await seedRetirementCalendar(root, "2026-11-17", [1]);
    await writeJsonAtomic(join(root, `data/posted-log/${date}.json`), ["facebook", "instagram"].map(platform => ({ slot: 1, platform, dry_run: false, status: "success", published_media_type: "image" })));
    await writeJsonAtomic(join(root, `data/first-comments/${date}.json`), [{ slot: 1, comment_id: "fixture-comment" }]);
    await writeJsonAtomic(join(root, "data/ab-test-plan.json"), [{ date: "2026-11-17", evening: { conceptId: "not-built", variant: "10s" } }]);
    ps(`& ${quote(join(cwd, "scripts/day-audit.ps1"))} -RootPath ${quote(root)} -Date '${date}' -AuditOnly`);
    const report = JSON.parse((await readFile(join(root, `output/day-reports/${date}.json`), "utf8")).replace(/^\uFEFF/u, ""));
    expect(report.ok).toBe(true); expect(report.missing_posts).toEqual([]); expect(report.missing_comments).toEqual([]);
  }, 45000);
  it("all changed wrappers use the shared policy gate at their slot decisions", async () => {
    const patterns: Record<string, RegExp> = {
      "catchup-publish.ps1": /Get-MissingRequiredCalendarSlots -CalendarSlots \$calendarSlots -Root \$root -Date \$date/,
      "watchdog-patrol.ps1": /Get-MissingRequiredCalendarSlots -CalendarSlots \$calendarSlots -Root \$root -Date \$date/,
      "schedule-ahead-daily.ps1": /foreach \(\$ytSlot in @\(Remove-RetiredPublishSlots/,
      "backfill-publish.ps1": /Remove-RetiredPublishSlots -Slots @\(\[int\]\$entry.slot\)/,
      "produce-next-reel.ps1": /Remove-RetiredPublishSlots -Slots @\(\[int\]\$half.slot\)/
    };
    for (const [file, pattern] of Object.entries(patterns)) expect(await readFile(join(cwd, "scripts", file), "utf8"), file).toMatch(pattern);
  });
});
