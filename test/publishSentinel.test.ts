import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "publish-sentinel.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-publish-sentinel-live-slots.smoke.ps1");

function functionSlice(source: string, name: string): string {
  const start = source.search(new RegExp(`function ${name}\\b`, "u"));
  if (start < 0) throw new Error(`${name} not found`);
  const next = source.indexOf("\nfunction ", start + 1);
  const end = next < 0 ? source.indexOf("\nSet-Location ", start + 1) : next;
  return source.slice(start, end < 0 ? source.length : end);
}

function lastJsonObject(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const line = lines.at(-1);
  if (!line) throw new Error(`publish-sentinel smoke printed no JSON object\n${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("publish-sentinel F19 live-post predicate", () => {
  // R5 / R1-R2: Retain F19 and require pairs on the initial, sync and catchup reads.
  it("production uses live pairs on every posted-log read, not status-eq-success", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const live = functionSlice(source, "Test-LivePostedEntry");
    const slots = functionSlice(source, "Get-LivePostedSlots");
    const missingSlots = functionSlice(source, "Get-MissingDueSlots");
    const pairs = functionSlice(source, "Get-LivePostedPairs");
    const missing = functionSlice(source, "Get-MissingDuePairs");
    const due = functionSlice(source, "Get-DueSlots");
    const main = source.slice(source.indexOf("\nSet-Location "));
    expect(due).toContain('$Time -ge "11:45"');
    expect(due).toContain('$Time -ge "12:15"');
    expect(due).toContain('$Time -ge "20:45"');
    expect(live).toContain("if ($Entry.dry_run)");
    expect(live).toContain('@("success", "posted") -contains $status');
    expect(slots).toContain("Test-LivePostedEntry");
    expect(missingSlots).toContain("$posted -notcontains $_");
    expect(pairs).toContain("Test-LivePostedEntry $entry");
    expect(missing).toContain('@("facebook", "instagram")');
    expect(missing).toContain("$posted -notcontains $pair");
    expect(main.match(/\$posted = @\(Get-LivePostedPairs \$parsed\)/gu)).toHaveLength(2);
    expect(main).toContain("$posted2 = @(Get-LivePostedPairs $parsed2)");
    expect(main.match(/\$missing = @\(Get-MissingDuePairs \$due \$posted\b/gu)).toHaveLength(2);
    expect(main).toContain("$still = @(Get-MissingDuePairs $due $posted2");
    expect(main).not.toMatch(/Get-(?:LivePostedSlots|MissingDueSlots)\b/u);
    expect(source).not.toMatch(/\$_\.status\s*-eq\s*["']success["']/iu);
  });

  // R5 / R3: Uncertain pairs are excluded on every decision and never called recovered.
  it("excludes uncertain pairs from gaps and reports manual confirmation", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const uncertain = functionSlice(source, "Get-UncertainPairs");
    const notice = functionSlice(source, "Write-UncertainNotice");
    const main = source.slice(source.indexOf("\nSet-Location "));
    expect(uncertain).toContain("$entry.dry_run");
    expect(uncertain).toContain('$entry.status -ne "uncertain"');
    expect(main.match(/\$uncertain = @\(Get-UncertainPairs \$parsed\)/gu)).toHaveLength(2);
    expect(main).toContain("$uncertain2 = @(Get-UncertainPairs $parsed2)");
    expect(
      main.match(/\$missing = @\(Get-MissingDuePairs \$due \$posted \| Where-Object \{ \$uncertain -notcontains \$_ \}\)/gu)
    ).toHaveLength(2);
    expect(main).toContain(
      "$still = @(Get-MissingDuePairs $due $posted2 | Where-Object { $uncertain2 -notcontains $_ })"
    );
    expect(main).toContain("Write-UncertainNotice $uncertain $d");
    expect(main).toContain("$newUncertain = @($uncertain2 | Where-Object { $uncertain -notcontains $_ })");
    expect(main).toContain("Write-UncertainNotice $newUncertain $d");
    expect(main).toMatch(/\} elseif \(\$uncertain2\.Count -gt 0\) \{\r?\n\s+Write-Log "catchup finished; uncertain results require manual confirmation"/u);
    expect(main).toContain('} elseif ($uncertain.Count -gt 0) {');
    expect(notice).toContain('Write-Log ("UNCERTAIN: "');
    expect(notice).toContain('Show-Toast "發布結果不明:');
    expect(notice).toContain("去粉專/IG 看貼文有沒有上;有就不用管,沒有就把");
    expect(notice).toContain("data\\posted-log\\$Date.json 裡那一列刪掉再跑補發");
  });

  // R5 / R4: Inspect the flow without executing sync, catchup or notifications.
  it("syncs cloud-owned IG once before rechecking gaps and names platforms in notices", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const owned = functionSlice(source, "Get-CloudOwnedIgPairs");
    const main = source.slice(source.indexOf("\nSet-Location "));
    expect(owned).toContain('$parts[1] -eq "instagram"');
    expect(owned).toContain('data\\ig-cloud\\queue\\{0}-slot{1}.json');
    expect(owned).toContain("Test-Path -LiteralPath $queuePath");
    expect(main).toContain("$cloudMissing = @(Get-CloudOwnedIgPairs $missing $d $RootPath)");
    const syncCommand = "& npx.cmd tsx src/igCloud.ts --sync --date $d *>> $logFile";
    expect(main.split(syncCommand)).toHaveLength(2);
    const guard = main.indexOf("if ($cloudMissing.Count -gt 0)");
    const sync = main.indexOf(syncCommand);
    const readback = main.indexOf("$parsed = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json", sync);
    const liveReadback = main.indexOf("$posted = @(Get-LivePostedPairs $parsed)", readback);
    const recheck = main.indexOf("$missing = @(Get-MissingDuePairs $due $posted", liveReadback);
    const catchupGuard = main.indexOf("if ($missing.Count -gt 0)", recheck);
    expect(guard).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(guard);
    expect(readback).toBeGreaterThan(sync);
    expect(liveReadback).toBeGreaterThan(readback);
    expect(recheck).toBeGreaterThan(liveReadback);
    expect(catchupGuard).toBeGreaterThan(recheck);
    expect(main.slice(guard, sync)).toContain("try {");
    expect(main.slice(sync, readback)).toContain("$LASTEXITCODE -ne 0");
    expect(main.slice(sync, readback)).toMatch(/catch \{\r?\n\s+Write-Log \("IG cloud sync failed: "/u);
    expect(main).toContain("$list = Format-PublishPairs $missing");
    expect(main).toContain("$s = Format-PublishPairs $still");
    expect(main.match(/IG 由雲端發,還沒有結果。/gu)).toHaveLength(2);
  });

  // R6: PowerShell 5.1 must decode both scripts as UTF-8.
  it("keeps UTF-8 BOM on the production and smoke scripts", async () => {
    for (const script of [PROD_SCRIPT, SMOKE_SCRIPT]) {
      const bytes = await readFile(script);
      expect([...bytes.subarray(0, 3)], script).toEqual([239, 187, 191]);
    }
  });

  it.runIf(process.platform === "win32")(
    "invokes production helpers: dry_run success does not silence a due slot",
    () => {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
        { encoding: "utf8", cwd: ROOT, timeout: 30000 }
      );
      const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
      expect(result.status, out).toBe(0);
      expect(out).toMatch(/EXTRACT_OK name=Get-DueSlots/u);
      expect(out).toMatch(/EXTRACT_OK name=Test-LivePostedEntry/u);
      expect(out).toMatch(/EXTRACT_OK name=Get-LivePostedSlots/u);
      expect(out).toMatch(/EXTRACT_OK name=Get-MissingDueSlots/u);
      expect(out).toMatch(/EXTRACT_OK name=Get-LivePostedPairs/u);
      expect(out).toMatch(/EXTRACT_OK name=Get-MissingDuePairs/u);
      expect(out).toMatch(/EXTRACT_OK name=Get-UncertainPairs/u);
      expect(out).toMatch(/CASE_OK name=pairs-platform-isolation/u);
      expect(out).toMatch(/CASE_OK name=missing-per-platform/u);
      expect(out).toMatch(/CASE_OK name=uncertain-live-only/u);
      expect(out).toMatch(/CASE_OK name=live-dry-run-success/u);
      expect(out).toMatch(/CASE_OK name=missing-dry-run-silences-not/u);
      expect(out).toMatch(/SMOKE_OK/u);
      expect(out).not.toMatch(/CASE_FAIL/u);
      expect(lastJsonObject(out)).toEqual({
        ok: true,
        dry_run_counts: false,
        posted_alias: true,
        due_1145: "1",
        due_1215: "1,3",
        due_2045: "1,3,2",
        missing_dry_noon: "1,3",
        live_pairs: "1:facebook",
        normalized_pairs: "1:instagram,3:facebook",
        dry_pairs: "",
        empty_pairs: "",
        missing_pairs: "1:instagram,3:facebook,3:instagram",
        missing_dry_pairs: "1:facebook,1:instagram,3:facebook,3:instagram",
        no_missing_pairs: "",
        uncertain_pairs: "1:instagram",
        uncertain_normalized_pairs: "1:facebook,3:instagram",
        no_uncertain_pairs: "",
        pair_notice: "slot 1 的 IG、slot 3 的 FB"
      });
    },
    30000
  );
});
