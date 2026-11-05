// RP-3 regression: catchup-publish.ps1 posted-log handling under Windows
// PowerShell 5.1 (pwsh 7 enumerates JSON arrays and hides the bug).
// Hermetic: only catchup-publish.ps1 is real. The lock library, slot-time
// library and watchdog are stubs, so no Global\sxj-publish mutex, no scheduled
// task changes, no git, no network. npm resolves to a fake npm.cmd.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATE = "2026-01-05";
const onWindows = process.platform === "win32";

const LOCK_STUB = String.raw`
function Enter-PipelineMutex { param($Name, $TimeoutSec) return [pscustomobject]@{ test_lock = $true } }
function Exit-PipelineMutex { param($Mutex) }
function Remove-StaleGitLock { param($RepoRoot) }
`;

const SLOT_STUB = String.raw`
function Get-CalendarSlots {
    param([string]$Root, [string]$Date)
    $path = Join-Path $Root "data\content-calendar\$Date.json"
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $parsed = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($path))
    return ,([int[]]@(@($parsed.slots) | ForEach-Object { [int]$_.slot }))
}
function Get-EffectivePublishSlots { param($CalendarSlots) return [int[]]@($CalendarSlots) }
function Get-SlotTimes {
    param([string]$Root, [string]$Date, $WarningMessage)
    return @{ 1 = [TimeSpan]'11:30'; 2 = [TimeSpan]'20:30'; 3 = [TimeSpan]'12:30' }
}
function Get-CatchupSlotWindows {
    param($NowTime, $SlotTimes, $CalendarSlots, $RecoveryWindow)
    $due = [int[]]@($env:TEST_DUE_SLOTS -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ })
    return [pscustomobject]@{ DueSlots = $due; StaleSlots = [int[]]@() }
}
function Get-MissingRequiredCalendarSlots { param($CalendarSlots) }
`;

const FAKE_NPM = [
  "@echo off",
  '>>"%~dp0npm-calls.log" echo %*',
  'if /i "%2"=="post-current-slot" exit /b %FAKE_POST_EXIT%',
  "exit /b 0",
  "",
].join("\r\n");

type Row = Record<string, unknown>;
const CALENDAR: Row[] = [
  { slot: 1, media_type: "image" },
  { slot: 2, media_type: "image" },
  { slot: 3, media_type: "reel" },
];

function row(slot: number, platform: string, media = "image"): Row {
  return { date: DATE, slot, platform, status: "success", dry_run: false, published_media_type: media };
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function runCatchup(o: { postedRaw: string; time: string; due: string; postExit: number }) {
  const root = mkdtempSync(path.join(tmpdir(), "catchup-rp3-"));
  try {
    const scripts = path.join(root, "scripts");
    mkdirSync(scripts);
    copyFileSync(path.join(repoRoot, "scripts", "catchup-publish.ps1"), path.join(scripts, "catchup-publish.ps1"));
    writeFileSync(path.join(scripts, "_pipeline-lock.ps1"), LOCK_STUB.replace(/\n/g, "\r\n"), "utf8");
    writeFileSync(path.join(scripts, "publish-slot-times.ps1"), SLOT_STUB.replace(/\n/g, "\r\n"), "utf8");
    writeFileSync(path.join(scripts, "_watchdog.ps1"), "# test stub\r\n", "utf8");
    writeFileSync(path.join(root, "npm.cmd"), FAKE_NPM, "ascii");
    writeJson(path.join(root, "data", "content-calendar", `${DATE}.json`), { date: DATE, slots: CALENDAR });
    writeJson(
      path.join(root, "data", "approved-log", `${DATE}.json`),
      CALENDAR.map((s) => ({ date: DATE, slot: s.slot, approved: true })),
    );
    const postedFile = path.join(root, "data", "posted-log", `${DATE}.json`);
    mkdirSync(path.dirname(postedFile), { recursive: true });
    writeFileSync(postedFile, o.postedRaw, "utf8");
    writeJson(path.join(root, "output", "operations", `indexing-push-${DATE}.json`), { date: DATE });

    const toastFile = path.join(root, "toasts.txt");
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) {
      const u = k.toUpperCase();
      if (u === "CATCHUP_PUBLISH_PLAN_ONLY" || u === "NODEFAULTCURRENTDIRECTORYINEXEPATH") delete env[k];
    }
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = root + ";" + (env[pathKey] ?? "");
    Object.assign(env, {
      CATCHUP_PUBLISH_ROOT: root,
      CATCHUP_PUBLISH_DATE: DATE,
      CATCHUP_PUBLISH_TIME: o.time,
      CATCHUP_PUBLISH_TOAST_FILE: toastFile,
      FAKE_POST_EXIT: String(o.postExit),
      TEST_DUE_SLOTS: o.due,
    });

    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(scripts, "catchup-publish.ps1")],
      { cwd: root, env, encoding: "utf8", timeout: 120_000 },
    );
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").replace(/^\uFEFF/, "") : "");
    const alertRaw = read(path.join(root, "data", "publish-alerts", `${DATE}.json`));
    return {
      status: result.status,
      log: read(path.join(root, "output", "catch-up-logs", `${DATE}.log`)),
      toasts: read(toastFile),
      npmCalls: read(path.join(root, "npm-calls.log")),
      alert: alertRaw ? (JSON.parse(alertRaw) as { last_error?: string }) : null,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe.skipIf(!onWindows)("catchup-publish posted-log checks (Windows PowerShell 5.1)", () => {
  it("reconciles a non-zero exit against FB+IG success and leaves no stale alert reason", () => {
    const r = runCatchup({
      postedRaw: JSON.stringify([row(1, "facebook"), row(1, "instagram")]),
      time: "12:00", due: "1", postExit: 1,
    });
    expect(r.npmCalls).toMatch(/post-current-slot -- --slot 1 --date 2026-01-05/);
    expect(r.log).toMatch(/Slot 1 exited 1 but the posted-log records success on both platforms; treating as published\./);
    expect(r.log).not.toMatch(/Slot 1 failed with exit code/);
    expect(r.toasts).not.toMatch(/slot 1/);
    expect(r.alert?.last_error ?? "").toBe("");
    expect(r.status).toBe(0);
  }, 120_000);

  it("refuses a reel recorded as IMAGE success without a re-post-inviting toast", () => {
    const r = runCatchup({
      postedRaw: JSON.stringify([
        row(1, "facebook"), row(1, "instagram"),
        row(3, "facebook", "image"), row(3, "instagram", "image"),
      ]),
      time: "13:00", due: "1,3", postExit: 0,
    });
    expect(r.npmCalls).toMatch(/post-current-slot -- --slot 3 --date 2026-01-05/);
    expect(r.log).toMatch(/Slot 1 finished \(published or already recorded\)\./);
    expect(r.log).not.toMatch(/Slot 1 is a reel/);
    expect(r.log).toMatch(/Slot 3 is a reel but posted-log recorded IMAGE success; refusing to treat as published\./);
    expect(r.toasts).toMatch(/TOAST\|.*slot 3/);
    expect(r.toasts).toMatch(/請勿重發/);
    expect(r.toasts).not.toMatch(/補發失敗/);
    expect(r.status).toBe(1);
  }, 120_000);

  it("fails closed when the posted-log is unreadable after a reel slot exits 0", () => {
    const r = runCatchup({ postedRaw: '[{"date": "2026-01-05", "slot": 3,', time: "13:00", due: "3", postExit: 0 });
    expect(r.npmCalls).toMatch(/post-current-slot -- --slot 3 --date 2026-01-05/);
    expect(r.log).toMatch(/Slot 3 result unverified \(exit 0\)/);
    expect(r.log).not.toMatch(/Slot 3 finished/);
    expect(r.toasts).toMatch(/TOAST\|.*slot 3/);
    expect(r.toasts).not.toMatch(/補發失敗/);
    expect(r.status).toBe(1);
  }, 120_000);

  it("reports a non-zero exit with an unreadable posted-log as unverified, not failed", () => {
    const r = runCatchup({ postedRaw: "{ not json", time: "12:00", due: "1", postExit: 1 });
    expect(r.log).toMatch(/Slot 1 result unverified \(exit 1\)/);
    expect(r.log).not.toMatch(/Slot 1 failed with exit code/);
    expect(r.toasts).not.toMatch(/補發失敗/);
    expect(r.status).toBe(1);
  }, 120_000);

  it("a non-zero exit with only one platform recorded is a real failure", () => {
    const r = runCatchup({
      postedRaw: JSON.stringify([row(1, "facebook")]),
      time: "12:00", due: "1", postExit: 1,
    });
    expect(r.log).toMatch(/Slot 1 failed with exit code 1\./);
    expect(r.log).not.toMatch(/treating as published/);
    expect(r.toasts).toMatch(/補發失敗/);
    expect(r.status).toBe(1);
  }, 120_000);

  it("dry-run rows never count as published", () => {
    const dry = (platform: string): Row => ({ ...row(1, platform), dry_run: true });
    const r = runCatchup({
      postedRaw: JSON.stringify([dry("facebook"), dry("instagram")]),
      time: "12:00", due: "1", postExit: 1,
    });
    expect(r.log).toMatch(/Slot 1 failed with exit code 1\./);
    expect(r.log).not.toMatch(/treating as published/);
    expect(r.toasts).toMatch(/補發失敗/);
    expect(r.status).toBe(1);
  }, 120_000);
});
