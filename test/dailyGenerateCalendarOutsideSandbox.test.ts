import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Mutation runs select a real script copy, never a rewritten test constant.
const scriptPath = resolve(process.env.DGFIX_DAILY_GENERATE_SCRIPT || "scripts/daily-generate.ps1");
const quotePS = (value: string) => `'${value.replace(/'/g, "''")}'`;
const source = readFileSync(scriptPath, "utf8");
let fixture: string;

interface Scenario {
  name: string;
  hasCalendar: boolean;
  calls: { step: string; command: string; cwd: string }[];
  logs: string[];
  toasts: string[];
  output: string;
  restoredLocation: boolean;
}

interface HarnessResult {
  version: number;
  commands: { name: string; text: string; pipeline: string; offset: number }[];
  preflightEnd: number;
  codexOffset: number;
  imagesOnlyOffset: number;
  imagesOnlyGuard: string;
  imagesOnlyEndsWithExit: boolean;
  cases: Scenario[];
}

let result: HarnessResult;

function runPreflight(scriptPath: string, fixture: string): HarnessResult {
  // Parse the actual scheduler, then run only its calendar assignments and
  // preflight block. cmd/Test-Path/log/toast are local fakes; no script body,
  // real npm, Codex, scheduled task, image generator or publisher is executed.
  const harness = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(${quotePS(scriptPath)}, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw "Parse errors: $($errors.Count)" }
    $statements = @($ast.EndBlock.Statements)
    $calendarAssignment = @($statements | Where-Object {
      $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$calendar'
    })
    $imagesAssignment = @($statements | Where-Object {
      $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$imagesReady'
    })
    if ($calendarAssignment.Count -ne 1 -or $imagesAssignment.Count -ne 1) { throw 'Expected unique calendar/imagesReady assignments' }
    $preflight = @($statements | Where-Object {
      $_.Extent.StartOffset -ge $calendarAssignment[0].Extent.StartOffset -and
      $_.Extent.EndOffset -lt $imagesAssignment[0].Extent.StartOffset
    })
    $preflightText = ($preflight | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine
    $preflightAst = [scriptblock]::Create($preflightText).Ast
    $commands = @($preflightAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true))
    $allowed = @('Join-Path', 'Test-Path', 'Write-Log', 'Show-Toast', 'Push-Location', 'Pop-Location', 'cmd', 'Out-File')
    foreach ($command in $commands) {
      if ($command.GetCommandName() -notin $allowed) { throw 'Unsafe command in extracted preflight' }
    }
    $npmCommands = @($commands | Where-Object { $_.Extent.Text -match 'npm[.]cmd run generate(?:-context)? -- ' } | ForEach-Object {
      @{ name = $_.GetCommandName(); text = $_.Extent.Text; pipeline = $_.Parent.Extent.Text; offset = $_.Extent.StartOffset }
    })
    $codexCall = @($ast.FindAll({ param($n)
      $n -is [System.Management.Automation.Language.CommandAst] -and $n.Extent.Text -match '^& \\$codex exec '
    }, $true))
    $imagesOnly = @($statements | Where-Object {
      $_ -is [System.Management.Automation.Language.IfStatementAst] -and
      $_.Clauses[0].Item1.Extent.Text -eq '$hasCalendar' -and $_.Extent.Text -match 'generating images only'
    })
    if ($codexCall.Count -ne 1 -or $imagesOnly.Count -ne 1) { throw 'Expected original Codex fallback and images-only branch' }

    function Write-Log([string]$message) { $script:Logs.Add($message) }
    function Show-Toast([string]$text) { $script:Toasts.Add($text) }
    function Test-Path([string]$Path) {
      if ($Path -ne $script:ExpectedCalendar) { throw 'Unexpected path probe' }
      return $script:CalendarPresent
    }
    function cmd([string]$Mode, [string]$Command) {
      if ($Mode -ne '/c' -or $Command -notmatch '^npm[.]cmd run (generate-context|generate) -- --date 2026-10-25(?: --force)? 2>&1$') {
        throw 'Unexpected external command; no real command is allowed'
      }
      $step = $Matches[1]
      $script:Calls.Add(@{ step = $step; command = $Command; cwd = (Get-Location).Path })
      $global:LASTEXITCODE = if ($step -eq 'generate-context') { $script:Case.contextCode } else { $script:Case.generateCode }
      if ($step -eq 'generate' -and $script:Case.writesCalendar) { $script:CalendarPresent = $true }
      "fake $step output"
    }

    $cases = @(
      @{ name = 'existing'; exists = $true; contextCode = 0; generateCode = 0; writesCalendar = $true },
      @{ name = 'success'; exists = $false; contextCode = 0; generateCode = 0; writesCalendar = $true },
      @{ name = 'context-failed'; exists = $false; contextCode = 17; generateCode = 0; writesCalendar = $true },
      @{ name = 'generate-failed'; exists = $false; contextCode = 0; generateCode = 23; writesCalendar = $false },
      @{ name = 'generate-failed-after-write'; exists = $false; contextCode = 0; generateCode = 23; writesCalendar = $true },
      @{ name = 'missing-artifact'; exists = $false; contextCode = 0; generateCode = 0; writesCalendar = $false }
    )
    $results = @(foreach ($case in $cases) {
      $script:Case = $case
      $script:CalendarPresent = $case.exists
      $script:Calls = [System.Collections.Generic.List[object]]::new()
      $script:Logs = [System.Collections.Generic.List[string]]::new()
      $script:Toasts = [System.Collections.Generic.List[string]]::new()
      $root = ${quotePS(fixture)}
      $date = '2026-10-25'
      $script:ExpectedCalendar = Join-Path $root "data\\content-calendar\\$date.json"
      $logFile = Join-Path $root "$($case.name).log"
      $global:LASTEXITCODE = 0
      $before = (Get-Location).Path
      . ([scriptblock]::Create($preflightText))
      $output = if ([IO.File]::Exists($logFile)) { [IO.File]::ReadAllText($logFile) } else { '' }
      @{
        name = $case.name; hasCalendar = [bool]$hasCalendar
        calls = @($script:Calls.ToArray()); logs = @($script:Logs.ToArray()); toasts = @($script:Toasts.ToArray())
        output = $output; restoredLocation = ((Get-Location).Path -eq $before)
      }
    })
    @{
      version = $PSVersionTable.PSVersion.Major; commands = @($npmCommands)
      preflightEnd = $preflight[-1].Extent.EndOffset; codexOffset = $codexCall[0].Extent.StartOffset
      imagesOnlyOffset = $imagesOnly[0].Extent.StartOffset; imagesOnlyGuard = $imagesOnly[0].Clauses[0].Item1.Extent.Text
      imagesOnlyEndsWithExit = ($imagesOnly[0].Clauses[0].Item2.Statements[-1] -is [System.Management.Automation.Language.ExitStatementAst])
      cases = @($results)
    } | ConvertTo-Json -Depth 8 -Compress
  `;
  const output = execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(harness, "utf16le").toString("base64")
  ], { encoding: "utf8", timeout: 20_000, windowsHide: true });
  return JSON.parse(output.replace(/^\uFEFF/u, "").trim());
}

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "calendar outside sandbox-"));
  result = runPreflight(scriptPath, fixture);
}, 25_000);

afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

const scenario = (name: string) => result.cases.find((item) => item.name === name)!;

function assertProjectDirectory(calls: Scenario["calls"], expected: string): void {
  expect(calls.every((call) => realpathSync.native(call.cwd) === realpathSync.native(expected))).toBe(true);
}

describe("daily calendar generation outside the Codex sandbox", () => {
  it("calls both npm steps directly from PowerShell before the existing Codex fallback", () => {
    expect(result.version).toBe(5);
    expect(result.commands).toHaveLength(2);
    expect(result.commands.map((command) => command.name)).toEqual(["cmd", "cmd"]);
    expect(result.commands[0]!.text).toContain("npm.cmd run generate-context -- --date $date");
    expect(result.commands[1]!.text).toContain("npm.cmd run generate -- --date $date");
    for (const command of result.commands) {
      expect(command.pipeline).toContain("| Out-File -FilePath $logFile -Append -Encoding utf8");
      expect(command.text).not.toMatch(/codex/i);
    }
    expect(result.imagesOnlyOffset).toBeGreaterThan(result.preflightEnd);
    expect(result.codexOffset).toBeGreaterThan(result.imagesOnlyOffset);
    expect(source).toMatch(/2026-10-22:[\s\S]*?EPERM/);
    expect(source).toContain('-s workspace-write -c \'windows.sandbox="unelevated"\'');
  });

  it("never adds --force to either new npm command", () => {
    expect(result.commands).toHaveLength(2);
    for (const command of result.commands) expect(command.text).not.toContain("--force");
  });

  it("skips both new steps when the calendar already exists", () => {
    const actual = scenario("existing");
    expect(actual.calls).toEqual([]);
    expect(actual.hasCalendar).toBe(true);
    expect(actual.logs).toEqual([]);
    expect(actual.toasts).toEqual([]);
  });

  it("generates in the project directory, logs output, rechecks the artifact and takes the existing branch", () => {
    const actual = scenario("success");
    expect(actual.calls.map((call) => call.step)).toEqual(["generate-context", "generate"]);
    assertProjectDirectory(actual.calls, fixture);
    expect(actual.output).toContain("fake generate-context output");
    expect(actual.output).toContain("fake generate output");
    expect(actual.hasCalendar).toBe(true);
    expect(actual.toasts).toEqual([]);
    expect(result.imagesOnlyGuard).toBe("$hasCalendar");
    expect(result.imagesOnlyEndsWithExit).toBe(true);
  });

  it.each([
    ["context-failed", ["generate-context"], "generate-context=17"],
    ["generate-failed", ["generate-context", "generate"], "generate=23"],
    ["generate-failed-after-write", ["generate-context", "generate"], "generate=23"],
    ["missing-artifact", ["generate-context", "generate"], "calendar=False"]
  ])("logs and toasts before the original Codex fallback when %s", (name, steps, reason) => {
    const actual = scenario(name as string);
    expect(actual.calls.map((call) => call.step)).toEqual(steps);
    expect(actual.hasCalendar).toBe(false);
    expect(actual.logs.join("\n")).toContain(reason);
    expect(actual.logs.join("\n")).toMatch(/failed.*falling back to Codex/);
    expect(actual.toasts).toHaveLength(1);
    expect(actual.toasts[0]).toMatch(/失敗.*Codex.*備援/);
  });

  it("restores the caller's working directory for every success and failure case", () => {
    expect(result.cases.every((actual) => actual.restoredLocation)).toBe(true);
  });

  it("rejects a real preflight that enters another directory even under the fixture path", () => {
    const wrongDirectory = join(fixture, "wrong working directory");
    mkdirSync(wrongDirectory);
    const wrongSource = source.replace(
      /Push-Location \$root(?=\r?\n    cmd \/c "npm[.]cmd run generate-context)/u,
      `Push-Location ${quotePS(wrongDirectory)}`
    );
    if (wrongSource === source) throw new Error("Expected the actual preflight directory switch");
    const wrongScript = join(fixture, "wrong-cwd.ps1");
    writeFileSync(wrongScript, wrongSource, "utf8");
    const actual = runPreflight(wrongScript, fixture).cases.find((item) => item.name === "success")!;
    expect(actual.calls.map((call) => call.step)).toEqual(["generate-context", "generate"]);
    expect(actual.restoredLocation).toBe(true);
    assertProjectDirectory(actual.calls, wrongDirectory);
    expect(() => assertProjectDirectory(actual.calls, fixture)).toThrow();
  });
});
