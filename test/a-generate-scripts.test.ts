// RP-2 / A-GENERATE regression tests. Windows-only: they run the real
// scripts/*.ps1 under powershell.exe (5.1) inside a throw-away sandbox.
// Stubbed: npm/git/tsx/codex (.cmd fakes), _pipeline-lock.ps1 (no Global\sxj-publish),
// Get-/Enable-ScheduledTask, and Show-Toast (sandbox copies log toasts to a file
// instead of popping them on the desktop). No network, no real data.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const winIt = it.skipIf(process.platform !== "win32");
const DATE = "2026-11-06";
const TIMEOUT = 240_000;
const crlf = (lines: string[]) => lines.join("\r\n") + "\r\n";

const STUB_LOCK = crlf([
  "function Remove-StaleGitLock { param([string]$RepoRoot) }",
  "function Write-StubEvent([string]$Line) {",
  '    [IO.File]::AppendAllText($env:FAKE_EVENT_LOG, "$Line`r`n", [Text.UTF8Encoding]::new($false))',
  "}",
  "function Enter-PipelineMutex {",
  "    param([string]$Name = 'sxj-publish', [int]$TimeoutSec = 600, [switch]$NoExit)",
  "    if ($env:FAKE_MUTEX_BUSY -eq '1') {",
  '        Write-StubEvent "LOCK-BUSY $Name"',
  "        if ($NoExit) { return $null }",
  "        exit 75",
  "    }",
  '    Write-StubEvent "LOCK-ENTER $Name"',
  "    return [pscustomobject]@{ Name = $Name }",
  "}",
  "function Exit-PipelineMutex {",
  "    param($Mutex)",
  '    if ($null -ne $Mutex) { Write-StubEvent "LOCK-EXIT $($Mutex.Name)" }',
  "}",
]);

const STUB_IMAGES = crlf(["param([string]$Date, [string]$LogFile, [switch]$QaOnly)", "exit 0"]);

const FAKE_NPM = crlf([
  "@echo off",
  '>>"%FAKE_EVENT_LOG%" echo npm %*',
  "if not defined FAKE_NPM_FAIL exit /b 0",
  'echo %* | findstr /C:"%FAKE_NPM_FAIL%" >nul',
  "if errorlevel 1 exit /b 0",
  "exit /b 1",
]);

const FAKE_TSX = crlf([
  "@echo off",
  '>>"%FAKE_EVENT_LOG%" echo tsx %*',
  'if "%FAKE_TSX_EXIT%"=="2" (',
  '  echo {"shouldRebuild":true}',
  "  exit /b 2",
  ")",
  'echo {"shouldRebuild":false}',
  "exit /b 0",
]);

const FAKE_CODEX_CMD = crlf(["@echo off", '"%FAKE_NODE%" "%~dp0fake-codex.cjs" %*', "exit /b 0"]);

const FAKE_CODEX_JS = [
  'const fs = require("fs");',
  'let input = "";',
  'try { input = fs.readFileSync(0, "utf8"); } catch (e) { input = ""; }',
  'fs.writeFileSync(process.env.FAKE_CODEX_STDIN, input, "utf8");',
  'fs.writeFileSync(process.env.FAKE_CODEX_ARGS, JSON.stringify(process.argv.slice(2)), "utf8");',
  "",
].join("\n");

const RUNNER = crlf([
  "param([Parameter(Mandatory = $true)][string]$Target, [string]$Date = '')",
  "function global:Get-ScheduledTask { @() }",
  "function global:Enable-ScheduledTask { param([string]$TaskName) }",
  "$global:LASTEXITCODE = 99",
  "if ($Date) { & $Target -Date $Date } else { & $Target }",
  "exit $LASTEXITCODE",
]);

const LOCK_PROBE = crlf([
  "$ErrorActionPreference = 'Stop'",
  ". $env:LOCK_LIB",
  "$name = $env:TEST_MUTEX_NAME",
  "$ready = [Threading.ManualResetEvent]::new($false)",
  "$release = [Threading.ManualResetEvent]::new($false)",
  "$holder = [PowerShell]::Create()",
  "[void]$holder.AddScript({",
  "    param($n, $ready, $release)",
  "    $m = [Threading.Mutex]::new($false, 'Global\\' + $n)",
  "    [void]$m.WaitOne()",
  "    [void]$ready.Set()",
  "    [void]$release.WaitOne(10000)",
  "    $m.ReleaseMutex()",
  "    $m.Dispose()",
  "}).AddArgument($name).AddArgument($ready).AddArgument($release)",
  "$handle = $holder.BeginInvoke()",
  "if (-not $ready.WaitOne(15000)) { 'holder-not-ready'; exit 4 }",
  "try {",
  "    $got = Enter-PipelineMutex -Name $name -TimeoutSec 1 -NoExit",
  "} catch {",
  "    'binding-error'",
  "    exit 3",
  "}",
  "if ($null -eq $got) { 'noexit-null' } else { 'noexit-acquired'; exit 5 }",
  "Enter-PipelineMutex -Name $name -TimeoutSec 1 | Out-Null",
  "'unreachable'",
  "exit 0",
]);

const TOAST_ANCHOR = "function Show-Toast([string]$text) {";
const TOAST_STUB =
  '\r\n    [IO.File]::AppendAllText($env:FAKE_EVENT_LOG, "TOAST $text`r`n", [Text.UTF8Encoding]::new($false)); return';

function copyScript(name: string, dir: string): void {
  let text = readFileSync(join(repoRoot, "scripts", name), "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.indexOf(TOAST_ANCHOR);
  if (first < 0 || text.indexOf(TOAST_ANCHOR, first + 1) >= 0) throw new Error(`Show-Toast anchor not unique in ${name}`);
  text = text.replace(TOAST_ANCHOR, () => TOAST_ANCHOR + TOAST_STUB);
  // BOM so PS 5.1 parses the CJK text as UTF-8 regardless of the production file's encoding.
  writeFileSync(join(dir, "scripts", name), "\uFEFF" + text, "utf8");
}

function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "rp2-"));
  for (const sub of ["scripts", "bin", join("node_modules", ".bin"), join("data", "content-calendar"), join("appdata", "npm")]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  copyScript("daily-generate.ps1", dir);
  copyScript("schedule-ahead-daily.ps1", dir);
  writeFileSync(join(dir, "scripts", "_pipeline-lock.ps1"), STUB_LOCK);
  writeFileSync(join(dir, "scripts", "_watchdog.ps1"), "\r\n");
  writeFileSync(join(dir, "scripts", "generate-missing-images.ps1"), STUB_IMAGES);
  writeFileSync(join(dir, "bin", "npm.cmd"), FAKE_NPM);
  writeFileSync(join(dir, "bin", "git.cmd"), "@exit /b 0\r\n");
  writeFileSync(join(dir, "node_modules", ".bin", "tsx.cmd"), FAKE_TSX);
  writeFileSync(join(dir, "runner.ps1"), RUNNER);
  return dir;
}

function setEnv(env: NodeJS.ProcessEnv, name: string, value: string | undefined): void {
  for (const key of Object.keys(env)) if (key.toLowerCase() === name.toLowerCase()) delete env[key];
  if (value !== undefined) env[name] = value;
}

function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["FAKE_NPM_FAIL", "FAKE_TSX_EXIT", "FAKE_MUTEX_BUSY", "FAKE_CODEX_STDIN", "FAKE_CODEX_ARGS", "LAUNDRY_CODEX_MODEL"]) {
    setEnv(env, name, undefined);
  }
  for (const [k, v] of Object.entries(extra)) setEnv(env, k, v);
  return env;
}

function runScript(dir: string, script: string, opts: { date?: string; env?: Record<string, string> } = {}) {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path");
  const basePath = pathKey ? process.env[pathKey] ?? "" : "";
  const env = baseEnv({
    Path: `${join(dir, "bin")};${basePath}`,
    APPDATA: join(dir, "appdata"),
    FAKE_EVENT_LOG: join(dir, "events.log"),
    FAKE_NODE: process.execPath,
    ...(opts.env ?? {}),
  });
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, "runner.ps1"), "-Target", join(dir, "scripts", script)];
  if (opts.date) args.push("-Date", opts.date);
  const r = spawnSync("powershell.exe", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000, windowsHide: true });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function events(dir: string): string[] {
  const p = join(dir, "events.log");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function withSandbox(fn: (dir: string) => void): void {
  const dir = makeSandbox();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("H1 schedule-ahead-daily pipeline mutex", () => {
  winIt("every npm step runs under sxj-publish, released between audit and each date", () => {
    withSandbox((dir) => {
      const r = runScript(dir, "schedule-ahead-daily.ps1");
      const ev = events(dir).filter((l) => /^(LOCK-|npm )/.test(l));
      expect(ev.some((l) => l.startsWith("npm ")), r.output).toBe(true);
      let held = false;
      let enters = 0;
      let exits = 0;
      for (const line of ev) {
        if (line.startsWith("LOCK-ENTER")) {
          expect(line).toBe("LOCK-ENTER sxj-publish");
          expect(held, "nested lock").toBe(false);
          held = true;
          enters++;
        } else if (line.startsWith("LOCK-EXIT")) {
          expect(held).toBe(true);
          held = false;
          exits++;
        } else {
          expect(held, `npm ran without the pipeline mutex: ${line}\n${r.output}`).toBe(true);
        }
      }
      expect(held).toBe(false);
      expect(enters).toBe(4); // audit + D+1..D+3, never one lock for the whole job
      expect(exits).toBe(4);
    });
  }, TIMEOUT);

  winIt("a busy mutex skips every step, toasts and exits 1 (no silent exit 75)", () => {
    withSandbox((dir) => {
      const r = runScript(dir, "schedule-ahead-daily.ps1", { env: { FAKE_MUTEX_BUSY: "1" } });
      const ev = events(dir);
      expect(ev.filter((l) => l.startsWith("npm ")), r.output).toEqual([]);
      expect(ev.filter((l) => l === "LOCK-BUSY sxj-publish").length).toBe(4);
      expect(ev.some((l) => l.startsWith("TOAST ") && l.includes("pipeline-busy")), ev.join("\n")).toBe(true);
      expect(r.status).toBe(1);
    });
  }, TIMEOUT);
});

describe("H2 tamper rebuild in daily-generate", () => {
  winIt("a failed rebuild quarantines the calendar, never locks, never claims success, exits 1", () => {
    withSandbox((dir) => {
      const cal = join(dir, "data", "content-calendar", `${DATE}.json`);
      writeFileSync(cal, '{"tampered":true}');
      // A Codex fallback is available but must never be started for this day.
      writeFileSync(join(dir, "appdata", "npm", "codex.cmd"), FAKE_CODEX_CMD);
      writeFileSync(join(dir, "appdata", "npm", "fake-codex.cjs"), FAKE_CODEX_JS);
      const codexArgs = join(dir, "codex-args.json");
      const r = runScript(dir, "daily-generate.ps1", {
        date: DATE,
        env: {
          FAKE_TSX_EXIT: "2",
          FAKE_NPM_FAIL: "--force",
          FAKE_CODEX_STDIN: join(dir, "codex-stdin.txt"),
          FAKE_CODEX_ARGS: codexArgs,
        },
      });
      const ev = events(dir);
      expect(existsSync(codexArgs), "Codex regenerated a day whose tamper rebuild failed").toBe(false);
      expect(ev).toContain(`npm run generate -- --date ${DATE} --force`);
      expect(ev.some((l) => /^npm run day-lock\b/.test(l)), ev.join("\n")).toBe(false);
      expect(ev.some((l) => /^npm run validate-publishable-images\b/.test(l))).toBe(false);
      expect(existsSync(cal), "tampered calendar still in data\\content-calendar").toBe(false);
      const opsDir = join(dir, "output", "operations");
      const quarantined = existsSync(opsDir)
        ? readdirSync(opsDir).filter((f) => new RegExp(`^calendar-quarantine-${DATE}-\\d{8}T\\d{6}Z\\.json$`).test(f))
        : [];
      expect(quarantined.length, r.output).toBe(1);
      expect(readFileSync(join(opsDir, quarantined[0]), "utf8")).toBe('{"tampered":true}');
      const toasts = ev.filter((l) => l.startsWith("TOAST "));
      expect(toasts.some((t) => t.includes(`calendar-quarantine-${DATE}-`))).toBe(true);
      expect(toasts.some((t) => t.includes(`calendar-tamper-${DATE}.json`)), "false 'rebuilt' toast").toBe(false);
      expect(r.status).toBe(1);
    });
  }, TIMEOUT);

  winIt("a successful rebuild reports it only after the rebuild ran, then locks and exits 0", () => {
    withSandbox((dir) => {
      writeFileSync(join(dir, "data", "content-calendar", `${DATE}.json`), '{"tampered":true}');
      const r = runScript(dir, "daily-generate.ps1", { date: DATE, env: { FAKE_TSX_EXIT: "2" } });
      const ev = events(dir);
      const rebuildAt = ev.indexOf(`npm run generate -- --date ${DATE} --force`);
      const toastAt = ev.findIndex((l) => l.startsWith("TOAST ") && l.includes(`calendar-tamper-${DATE}.json`));
      expect(rebuildAt, r.output).toBeGreaterThanOrEqual(0);
      expect(toastAt, "rebuilt toast fired before the rebuild ran").toBeGreaterThan(rebuildAt);
      expect(ev.some((l) => /^npm run day-lock -- --date 2026-11-06$/.test(l))).toBe(true);
      expect(r.status).toBe(0);
    });
  }, TIMEOUT);
});

describe("H3 Codex fallback prompt", () => {
  winIt("arrives intact (multi-line, UTF-8) on stdin and not in argv", () => {
    withSandbox((dir) => {
      writeFileSync(join(dir, "data", "slot1-plan.json"), JSON.stringify({ [DATE]: "帆布托特包 canvas-tote" }), "utf8");
      writeFileSync(join(dir, "appdata", "npm", "codex.cmd"), FAKE_CODEX_CMD);
      writeFileSync(join(dir, "appdata", "npm", "fake-codex.cjs"), FAKE_CODEX_JS);
      const stdinFile = join(dir, "codex-stdin.txt");
      const argsFile = join(dir, "codex-args.json");
      const r = runScript(dir, "daily-generate.ps1", {
        date: DATE,
        env: { FAKE_NPM_FAIL: "generate-context", FAKE_CODEX_STDIN: stdinFile, FAKE_CODEX_ARGS: argsFile },
      });
      expect(existsSync(argsFile), `Codex was never invoked\n${r.output}`).toBe(true);
      const received = readFileSync(stdinFile, "utf8");
      expect(received).toContain(`Run the 06:30 daily generation for ${DATE}`);
      expect(received).toContain("帆布托特包 canvas-tote");
      expect(received).toContain("Do not approve posts");
      const args: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
      expect(args[args.length - 1]).toBe("-");
      expect(args.some((a) => a.includes("Do not approve"))).toBe(false);
      expect(r.status).toBe(1); // the fake Codex writes no calendar
    });
  }, TIMEOUT);
});

describe("_pipeline-lock.ps1 -NoExit", () => {
  winIt("returns $null on timeout with -NoExit and still exits 75 without it", () => {
    const dir = mkdtempSync(join(tmpdir(), "rp2-lock-"));
    try {
      const probe = join(dir, "probe.ps1");
      writeFileSync(probe, LOCK_PROBE);
      const env = baseEnv({
        LOCK_LIB: join(repoRoot, "scripts", "_pipeline-lock.ps1"),
        TEST_MUTEX_NAME: `sxj-test-${process.pid}-${Date.now()}`,
      });
      const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", probe], {
        env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, windowsHide: true,
      });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(out).not.toContain("binding-error");
      expect(out).toContain("noexit-null");
      expect(out).not.toContain("unreachable");
      expect(r.status, out).toBe(75);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);
});
