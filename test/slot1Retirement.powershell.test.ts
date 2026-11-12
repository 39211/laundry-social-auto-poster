import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import { writeJsonAtomic } from "../src/logging";
import { slot1Root, slot1Date as date, oldSlot1Calendar } from "./helpers/slot1RetirementHarness";

const cwd = process.cwd(), q = (s: string) => `'${s.replace(/'/g, "''")}'`;
let root: string;
function ps(code: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", code],
    { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", timeout: 50000, windowsHide: true });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}
const parse = (name: string) => `$e=$null;$t=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${q(join(cwd, "scripts", name))},[ref]$t,[ref]$e);if(@($e).Count){throw 'parse failed'};`;
beforeEach(async () => {
  root = await slot1Root(); vi.stubEnv("PROJECT_ROOT", root); vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid");
  await mkdir(join(root, "output"), { recursive: true }); await mkdir(join(root, "scripts"));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe.runIf(process.platform === "win32")("slot 1 PowerShell offline operating flow", () => {
  it("R3 zero-slot helpers, morning and afternoon sentinel, time gate and day-audit succeed without warnings, toast or rescue", async () => {
    for (const day of [date, "2026-11-17"]) await generateDailyContent({ root, date: day });
    const toast = join(root, "output/toast"), invoked = join(root, "output/rescue");
    await writeFile(join(root, "scripts/catchup-publish.ps1"), `[IO.File]::WriteAllText(${q(invoked)},'rescue')`);
    const stubCmd = join(root, "catchup.cmd");
    await writeFile(stubCmd, `@echo off\r\necho called>"${invoked}"\r\nexit /b 0\r\n`, "ascii");
    const helpers = JSON.parse(ps(`. ${q(join(cwd, "scripts/publish-slot-times.ps1"))};$root=${q(root)};$date='${date}';
      $s=Get-CalendarSlots -Root $root -Date $date; $w=$null; $times=Get-SlotTimes -Root $root -Date $date -WarningMessage ([ref]$w);
      $windows=Get-CatchupSlotWindows -NowTime ([TimeSpan]'21:00') -SlotTimes $times -CalendarSlots $s;
      [ordered]@{present=@($s);active=@(Get-EffectivePublishSlots -CalendarSlots $s -Root $root -Date $date);
      missing=@(Get-MissingRequiredCalendarSlots -CalendarSlots $s -Root $root -Date $date);due=@($windows.DueSlots);stale=@($windows.StaleSlots);warning=$w}|ConvertTo-Json -Compress`));
    expect(helpers).toEqual({ present: [], active: [], missing: [], due: [], stale: [], warning: null });
    for (const time of ["12:00", "16:00", "21:00"]) ps(`& ${q(join(cwd, "scripts/publish-sentinel.ps1"))} -RootPath ${q(root)}`,
      { PUBLISH_SENTINEL_DATE: date, PUBLISH_SENTINEL_TIME: time, PUBLISH_SENTINEL_TOAST_FILE: toast });
    ps(`function Get-CimInstance { [CmdletBinding()]param($ClassName); @() }; & ${q(join(cwd, "scripts/publish-time-gate.ps1"))} -RootPath ${q(root)}`,
      { PUBLISH_GATE_DATE: date, PUBLISH_GATE_TIME: "12:30", PUBLISH_GATE_TOAST_FILE: toast, PUBLISH_GATE_CATCHUP_CMD: stubCmd });
    ps(`& ${q(join(cwd, "scripts/day-audit.ps1"))} -RootPath ${q(root)} -Date '${date}' -AuditOnly`);
    const report = JSON.parse((await readFile(join(root, `output/day-reports/${date}.json`), "utf8")).replace(/^\uFEFF/u, ""));
    expect(report).toMatchObject({ ok: true, missing_posts: [], missing_comments: [], rescue_actions: [] });
    expect(await readFile(toast, "utf8").catch(() => "")).toBe(""); expect(await readFile(invoked, "utf8").catch(() => "")).toBe("");
  }, 50000);
  it("R3 catchup wrapper accepts zero slots without an approval-log and performs no post, network, warning or toast", async () => {
    await generateDailyContent({ root, date });
    for (const name of ["catchup-publish.ps1", "publish-slot-times.ps1"]) await copyFile(join(cwd, "scripts", name), join(root, "scripts", name));
    // Real bridge, with its dependencies explicitly pointed at this workspace.
    const bridge = (await readFile("scripts/slot-retirements.ps1", "utf8"))
      .replace("(Join-Path $PSScriptRoot '..\\src\\slotRetirements.ts')", q(join(cwd, "src/slotRetirements.ts")))
      .replace("(Join-Path $PSScriptRoot '..\\node_modules\\tsx\\dist\\loader.mjs')", q(join(cwd, "node_modules/tsx/dist/loader.mjs")));
    await writeFile(join(root, "scripts/slot-retirements.ps1"), "\uFEFF" + bridge.replace(/^\uFEFF/u, ""));
    await writeFile(join(root, "scripts/_pipeline-lock.ps1"), "function Enter-PipelineMutex {param($Name,$TimeoutSec);return 'offline'};function Exit-PipelineMutex {param($Mutex)};function Remove-StaleGitLock {param($RepoRoot)}");
    await writeFile(join(root, "scripts/_watchdog.ps1"), "# offline");
    const calls = join(root, "output/calls"), toast = join(root, "output/toast");
    ps(`function cmd { [IO.File]::AppendAllText(${q(calls)},($args -join ' ') + [Environment]::NewLine);$global:LASTEXITCODE=0;'offline'};
      & ${q(join(root, "scripts/catchup-publish.ps1"))}`,
      { CATCHUP_PUBLISH_ROOT: root, CATCHUP_PUBLISH_DATE: date, CATCHUP_PUBLISH_TIME: "12:30", CATCHUP_PUBLISH_TOAST_FILE: toast });
    expect(await readFile(toast, "utf8").catch(() => "")).toBe("");
    expect(await readFile(calls, "utf8")).not.toMatch(/run post\b|publish-pages|schedule-ahead/);
    expect(await readFile(join(root, `output/catch-up-logs/${date}.log`), "utf8")).not.toMatch(/unapproved|No approved-log|failed|unreadable|missing required/i);
  }, 50000);
  it("R3 rolling schedule production loop skips all zero-slot days before approval log checks or external commands", async () => {
    for (const day of [date, "2026-11-17", "2026-11-18"]) await generateDailyContent({ root, date: day });
    const output = ps(`. ${q(join(cwd, "scripts/slot-retirements.ps1"))}; ${parse("schedule-ahead-daily.ps1")}
      $loop=@($ast.FindAll({param($n)$n -is [System.Management.Automation.Language.ForEachStatementAst] -and $n.Variable.Extent.Text -eq '$offset'},$true));if($loop.Count -ne 1){throw 'loop anchor'};
      $root=${q(root)}; $now=[DateTime]'2026-11-15';$logFile=Join-Path $root 'output/schedule.log';$problems=@();$script:calls=@();$script:logs=@();
      function Enter-PipelineMutex {param($Name,$TimeoutSec,[switch]$NoExit);return 'offline'};function Exit-PipelineMutex {param($Mutex)};
      function cmd {$script:calls+=($args -join ' ');$global:LASTEXITCODE=0;'offline'};function Write-Log($message){$script:logs+=$message};
      . ([scriptblock]::Create($loop[0].Extent.Text));[ordered]@{calls=@($script:calls);problems=@($problems);logs=@($script:logs)}|ConvertTo-Json -Compress`);
    const result = JSON.parse(output); expect(result.calls).toEqual([]); expect(result.problems).toEqual([]);
    expect(result.logs.filter((log: string) => log.includes("no active social slots"))).toHaveLength(3);
  }, 50000);
  it("R3 daily generation planned-object lookup skips retired plans and reads them again after restoration", async () => {
    await writeJsonAtomic(join(root, "data/slot1-plan.json"), { [date]: "planned object" });
    const code = `. ${q(join(cwd, "scripts/slot-retirements.ps1"))}; ${parse("daily-generate.ps1")}
      $fn=@($ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-PlannedObject'},$true));
      . ([scriptblock]::Create($fn[0].Extent.Text)); 'OBJECT='+(Get-PlannedObject -Root ${q(root)} -Date '${date}')`;
    expect(ps(code).trim()).toBe("OBJECT=");
    await writeJsonAtomic(join(root, "src/slot-retirements.json"), { version: 1, retirements: [] });
    expect(ps(code).trim()).toBe("OBJECT=planned object");
  }, 50000);
  it("R2 bridge node launch failure preserves history and fails closed for both daily slots", () => {
    const output = ps(`. ${q(join(cwd, "scripts/slot-retirements.ps1"))};function Get-Command { [CmdletBinding()]param($Name);if($Name -eq 'node.exe'){throw 'offline node launch failure'};Microsoft.PowerShell.Core\\Get-Command @PSBoundParameters };
      $old=Get-SlotRetirementPolicy -Root ${q(root)} -Date '2026-11-15';$new=Get-SlotRetirementPolicy -Root ${q(root)} -Date '${date}';
      [ordered]@{old=@($old.retiredSlots);new=@($new.retiredSlots)}|ConvertTo-Json -Compress`);
    expect(output).toContain("fail closed"); expect(output).toContain('"old":[]'); expect(output).toContain('"new":[1,2]');
  }, 50000);
  it("R3 old slot 1 backfill queue is skipped before any npm or calendar side effects", async () => {
    await oldSlot1Calendar(root);
    await writeJsonAtomic(join(root, "output/backfill/queue.json"), [{ date, slot: 1, status: "pending", note: "", attempted_at: null, result: null }]);
    const never = join(root, "never.cmd"); await writeFile(never, "@exit /b 99\r\n", "ascii");
    expect(ps(`& ${q(join(cwd, "scripts/backfill-publish.ps1"))} -RootPath ${q(root)} -NpmCommand ${q(never)} -DryRun`)).toContain("Retired slot skipped");
  }, 50000);
});
