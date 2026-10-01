import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "schedule-ahead-daily.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-schedule-ahead-daily.smoke.ps1");

function section(source: string, start: string, end: string): string {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  if (begin < 0 || finish < 0) throw new Error("Missing production section: " + start);
  return source.slice(begin, finish);
}

function lastJsonObject(stdout: string): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => /^\{.*\}$/u.test(value))
    .at(-1);
  if (!line) throw new Error("schedule-ahead smoke printed no JSON object\n" + stdout);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("schedule-ahead-daily wrapper R1-R4", () => {
  // R1: Capturing later could lose the native command's exit code.
  it("R1 captures LASTEXITCODE immediately after schedule-ahead", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    expect(source).toMatch(
      /\$out = cmd \/c "npm\.cmd run schedule-ahead -- --date \$date --live 2>&1"\r?\n\s*\$scheduleExitCode = \$LASTEXITCODE/u
    );
  });

  it("R1 reports nonzero exits and repeats the last five output lines without aborting dates", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const command = section(source, '$out = cmd /c "npm.cmd run schedule-ahead', "$scheduledLog = Join-Path");
    expect(command).toMatch(
      /if \(\$scheduleExitCode -ne 0\) \{\s+Write-Log "SCHEDULE-AHEAD EXIT \$scheduleExitCode \$\{date\}"\s+\$problems \+= "\$date schedule-ahead-exit-\$scheduleExitCode"\s+@\(\$out\) \| Select-Object -Last 5 \| ForEach-Object \{ Write-Log \(\[string\]\$_\) \}\s+\}/u
    );
    expect(command).not.toMatch(/^\s*(?:continue|break|exit|throw)\b/mu);
  });

  // R3: A function definition alone does not prove that queued uses it.
  it("R3 queues only Confirmed from Get-ScheduledRowSummary, never a raw row count", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const scheduled = section(source, "$scheduledLog = Join-Path", "# R7: YouTube");
    expect(source).toContain("function Get-ScheduledRowSummary($Rows)");
    expect(scheduled).toMatch(
      /\$summary = Get-ScheduledRowSummary \$rows\s+\$queued \+= "\{0\}x\{1\}" -f \$date, \$summary\.Confirmed/u
    );
    expect(source).not.toMatch(/\$queued\s*\+=\s*[^\r\n]*@\(\$rows\)\.Count/u);
  });

  it("R3 logs every uncertain row with Page verification and conditional deletion instructions", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const scheduled = section(source, "$scheduledLog = Join-Path", "# R7: YouTube");
    expect(scheduled).toMatch(
      /if \(\$summary\.Uncertain -gt 0\) \{\s+\$problems \+= "\$date uncertain-\$\(\$summary\.Uncertain\)"\s+foreach \(\$row in @\(\$summary\.UncertainRows\)\) \{/u
    );
    expect(scheduled).toContain(
      'Write-Log "UNCERTAIN ${date} slot $($row.slot) $($row.platform): $($row.error) -- check the Page; if the post is NOT queued there, delete this row from data\\scheduled-log\\$date.json and rerun"'
    );
  });

  it("R3 notes an existing scheduled-log with zero confirmed rows", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const scheduled = section(source, "if (Test-Path -LiteralPath $scheduledLog)", "# R7: YouTube");
    expect(scheduled).toMatch(
      /if \(\$summary\.Confirmed -eq 0\) \{\s+Write-Log "NOTE \$\{date\}: scheduled-log exists but nothing confirmed"\s+\}/u
    );
  });

  it("R3 carries problems into the final log and notification", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const final = source.slice(source.indexOf('Pop-Location'));
    expect(final).toContain('if ($problems.Count) { $summary += " / problems: " + ($problems -join ", ") }');
    expect(final).toContain("Write-Log $summary");
    expect(final).toContain("if ($problems.Count) { Show-Toast $summary }");
  });

  it("R2 exits nonzero only after the final summary and toast", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    expect(source).toContain("if ($problems.Count) { exit 1 }");
    expect(source).toMatch(
      /Pop-Location[\s\S]*Write-Log \$summary\s+if \(\$problems\.Count\) \{ Show-Toast \$summary \}\s+if \(\$problems\.Count\) \{ exit 1 \}\s+exit 0\s*$/u
    );
  });

  // R5: Windows PowerShell 5.1 needs a BOM for the Chinese script text.
  it("R5 preserves UTF-8 BOM in both PowerShell scripts", async () => {
    for (const file of [PROD_SCRIPT, SMOKE_SCRIPT]) {
      const bytes = await readFile(file);
      expect(Array.from(bytes.subarray(0, 3)), file).toEqual([239, 187, 191]);
    }
  });

  // R4: The smoke extracts only the pure production function via AST.
  it.runIf(process.platform === "win32")(
    "R2/R4 invokes production classification for mixed, single, null and uncertain-with-id rows",
    () => {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
        { encoding: "utf8", cwd: ROOT, timeout: 30000 }
      );
      const out = (result.stdout ?? "") + "\n" + (result.stderr ?? "") + (result.error ? String(result.error) : "");
      expect(result.status, out).toBe(0);
      expect(out).toContain("EXTRACT_OK name=Get-ScheduledRowSummary");
      for (const name of ["mixed", "single-object", "null", "uncertain-with-id", "empty-array", "missing-empty-id"]) {
        expect(out).toContain("CASE_OK name=" + name + " ");
      }
      for (const name of ["exit-code-immediate", "exit-report-tail", "queued-confirmed", "uncertain-actions", "zero-confirmed-note", "problems-notification"]) {
        expect(out).toContain("CASE_OK name=" + name);
      }
      for (const name of ["problem-exit-1", "later-dates-youtube", "clean-exit-0"]) {
        expect(out).toContain("CASE_OK name=" + name);
      }
      expect(out).not.toContain("CASE_FAIL");
      expect(out).toContain("SMOKE_OK");
      expect(lastJsonObject(out)).toEqual({
        ok: true,
        cases: 12,
        mixed_confirmed: 2,
        mixed_uncertain: 1,
        mixed_rows: 1,
        single_confirmed: 1,
        null_confirmed: 0,
        null_uncertain: 0,
        uncertain_id_confirmed: 0,
        uncertain_id_uncertain: 1
      });
    },
    30000
  );
});
