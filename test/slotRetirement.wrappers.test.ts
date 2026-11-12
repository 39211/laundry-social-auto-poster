import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubEnv("PUBLIC_SITE_BASE_URL", "https://example.invalid"); });
import { writeJsonAtomic } from "../src/logging";
import { retirementRoot, seedRetirementCalendar } from "./helpers/slotRetirementHarness";

const cwd = process.cwd();
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
let root: string;
function ps(code: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", code],
    { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", timeout: 45000, windowsHide: true });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`).toBe(0);
  return result.stdout;
}
// Parse the real production code, without evaluating a script's main workflow.
const parser = (file: string) => `
  $errors=$null; $tokens=$null;
  $ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(join(cwd, "scripts", file))},[ref]$tokens,[ref]$errors);
  if(@($errors).Count){throw 'Production script parse failed'};`;
const policy = () => `. ${quote(join(cwd, "scripts/slot-retirements.ps1"))}; $root=${quote(root)};`;
beforeEach(async () => {
  root = await retirementRoot();
  await mkdir(join(root, "output"), { recursive: true });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe.runIf(process.platform === "win32")("slot retirement wrapper behavior without external commands", () => {
  it("backfill dry-run skips an old retired queue entry before calendar or npm processing", async () => {
    const date = "2026-11-16";
    await seedRetirementCalendar(root, date);
    await writeJsonAtomic(join(root, "output/backfill/queue.json"), [{ date, slot: 2, status: "pending", note: "", attempted_at: null, result: null }]);
    const before = await readFile(join(root, "output/backfill/queue.json"), "utf8");
    const npm = join(root, "never-publish.cmd");
    await writeFile(npm, "@echo off\r\necho offline-backfill-stub\r\nexit /b 99\r\n", "ascii");
    const output = ps(`& ${quote(join(cwd, "scripts/backfill-publish.ps1"))} -RootPath ${quote(root)} -NpmCommand ${quote(npm)} -DryRun`);
    expect(output).toContain("Retired slot skipped");
    expect(output).not.toContain("DryRun action=publish");
    expect(await readFile(join(root, "output/backfill/queue.json"), "utf8")).toBe(before);
  }, 45000);

  it("catchup and watchdog report no missing-required slot 2 on a one-slot calendar", () => {
    for (const file of ["catchup-publish.ps1", "watchdog-patrol.ps1"]) {
      const output = ps(`${policy()} . ${quote(join(cwd, "scripts/publish-slot-times.ps1"))}; ${parser(file)}
        $assignment=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$missingRequiredCalendarSlots'},$true));
        if($assignment.Count -ne 1){throw 'Missing-slot assignment is not unique'};
        $root=${quote(root)}; $date='2026-11-16'; $calendarSlots=@(1);
        . ([scriptblock]::Create($assignment[0].Extent.Text));
        'MISSING='+(@($missingRequiredCalendarSlots)-join ',')`);
      expect(output.trim(), file).toBe("MISSING=");
    }
  }, 45000);

  it("rolling schedule wrapper ignores old uncertain slot 2 rows and schedules only slot 3 on YouTube", () => {
    const output = ps(`${policy()} ${parser("schedule-ahead-daily.ps1")}
      $date='2026-11-16';
      $filter=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$rows' -and $n.Extent.Text.Contains('Remove-RetiredPublishSlots')},$true));
      $loop=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.ForEachStatementAst] -and $n.Variable.Extent.Text -eq '$ytSlot'},$true));
      if($filter.Count -ne 1 -or $loop.Count -ne 1){throw 'Rolling schedule AST anchors changed'};
      $rows=@([pscustomobject]@{slot=1;status='scheduled';scheduled_post_id='fixture'},[pscustomobject]@{slot=2;status='uncertain'});
      . ([scriptblock]::Create($filter[0].Extent.Text));
      $logFile=Join-Path $root 'output/yt.log'; $script:calls=@();
      function cmd { $script:calls += ($args -join ' '); $global:LASTEXITCODE=0; 'offline-stub' };
      function Write-Log($message) {};
      . ([scriptblock]::Create($loop[0].Extent.Text));
      [pscustomobject]@{rows=@($rows|ForEach-Object{$_.slot});calls=@($script:calls)}|ConvertTo-Json -Compress`);
    const result = JSON.parse(output);
    expect(result.rows).toEqual([1]);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain("--slot 3");
  }, 45000);

  it("Reel production scheduling uses the real guarded plan branch and preserves optional slot 3", () => {
    const output = ps(`${policy()} ${parser("produce-next-reel.ps1")}
      $branch=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq '$windowDays.Count -gt 0'},$true));
      if($branch.Count -ne 1){throw 'Reel scheduling branch is not unique'};
      $windowDays=@([pscustomobject]@{date='2026-11-16';noon=[pscustomobject]@{conceptId='noon';variant='10s'};evening=[pscustomobject]@{conceptId='evening';variant='15s'}});
      $concept=$null; $logFile=Join-Path $root 'output/reel.log'; $script:calls=@(); $script:canon=@();
      function Set-CanonicalForDate {param($ForDate,$ConceptId,$Variant);$script:canon+=$ConceptId};
      function Get-ReelAssetPath {param($ConceptId,$Variant); if($ConceptId -eq 'noon'){return ${quote(join(root, "output"))}}; return ${quote(join(root, "no-evening-asset"))}};
      function Test-ConceptRejected {return $false}; function Write-Log($message) {};
      function cmd {$script:calls+=($args -join ' ');$global:LASTEXITCODE=0;'offline-stub'};
      . ([scriptblock]::Create($branch[0].Extent.Text));
      [pscustomobject]@{calls=@($script:calls);canon=@($script:canon)}|ConvertTo-Json -Compress`);
    const result = JSON.parse(output);
    expect(result.canon).toEqual(["noon"]);
    expect(result.calls.filter((call: string) => call.includes("schedule-reel"))).toEqual([
      expect.stringContaining("--slot 3")
    ]);
    expect(result.calls.some((call: string) => call.includes("--slot 2"))).toBe(false);
  }, 45000);
});
