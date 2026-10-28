import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readScript(name: string): string {
  return readFileSync(join(root, "scripts", name), "utf8").replace(/^\uFEFF/, "");
}

function dateAssignmentLine(src: string): string {
  const line = src.split(/\r?\n/).find((entry) => /^\s*\$date\s*=/.test(entry));
  if (!line) throw new Error("no $date assignment found");
  return line.trim();
}

function parseNamedOutputs(out: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    result[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  return result;
}

function evalDateParamBind(paramBlock: string, assignment: string): Record<string, string> {
  const script = [
    "function Invoke-TargetDate {",
    paramBlock,
    "$now = [datetime]'2026-08-20'",
    assignment,
    "Write-Output $date",
    "}",
    "Write-Output ('DEFAULT=' + (Invoke-TargetDate))",
    "Write-Output ('OVERRIDE=' + (Invoke-TargetDate -Date '2026-08-21'))",
    "Write-Output ('DPLUS2=' + (Invoke-TargetDate -Date '2026-08-22'))"
  ].join("\n");
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8" }
  ).trim();
  return parseNamedOutputs(out);
}

function evalDateCases(
  assignment: string,
  cases: Array<{ name: string; now: string; Date?: string }>
): Record<string, string> {
  const script = cases
    .map((entry) => {
      const dateParam = entry.Date === undefined ? "$Date = ''" : `$Date = '${entry.Date}'`;
      return `$now = [datetime]'${entry.now}'; ${dateParam}; ${assignment}; Write-Output ('${entry.name}=' + $date)`;
    })
    .join("; ");
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8" }
  ).trim();
  return parseNamedOutputs(out);
}

function parsePsErrors(scriptPath: string): string[] {
  const escaped = scriptPath.replace(/'/g, "''");
  const parserScript =
    "$errs = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('" +
    escaped +
    "', [ref]$null, [ref]$errs); if ($errs) { $errs | ForEach-Object { $_.ToString() } } else { Write-Output 'PARSE_OK' }";
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", parserScript],
    { encoding: "utf8" }
  ).trim();
  if (out === "PARSE_OK" || out === "") return [];
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

describe("W-LEADTIME D+3 generation default", { timeout: 20000 }, () => {
  it("daily-generate defaults to Taipei now+3 and honors -Date", () => {
    const src = readScript("daily-generate.ps1");
    expect(src).toMatch(/param\(\s*\[string\]\$Date\s*=\s*""\s*\)/s);
    const assignment = dateAssignmentLine(src);
    expect(assignment).toBe(
      '$date = if ($Date) { $Date } else { $now.AddDays(3).ToString("yyyy-MM-dd") }'
    );

    const got = evalDateCases(assignment, [
      { name: "DEFAULT", now: "2026-08-20" },
      { name: "ROLLOVER", now: "2026-08-30" },
      { name: "OVERRIDE", now: "2026-08-20", Date: "2026-07-01" },
      { name: "TODAY", now: "2026-08-20", Date: "2026-08-20" }
    ]);
    expect(got).toEqual({
      DEFAULT: "2026-08-23",
      ROLLOVER: "2026-09-02",
      OVERRIDE: "2026-07-01",
      TODAY: "2026-08-20"
    });
  });

  it("reverting daily-generate default to today yields today, proving AddDays(3) is the discriminator", () => {
    const src = readScript("daily-generate.ps1");
    const live = dateAssignmentLine(src);
    const reverted = live.replace("$now.AddDays(3).ToString", "$now.ToString");
    expect(reverted).not.toBe(live);
    const liveGot = evalDateCases(live, [{ name: "LIVE", now: "2026-08-20" }]);
    const revertedGot = evalDateCases(reverted, [
      { name: "REVERTED", now: "2026-08-20" },
      { name: "OVERRIDE", now: "2026-08-20", Date: "2026-07-01" }
    ]);
    expect(liveGot.LIVE).toBe("2026-08-23");
    expect(revertedGot.REVERTED).toBe("2026-08-20");
    expect(revertedGot.OVERRIDE).toBe("2026-07-01");
  });

  it("produce-next-reel defaults to now+3 and honors -Date", () => {
    const src = readScript("produce-next-reel.ps1");
    const paramBlock = src.match(/param\(\s*[\s\S]*?\n\)/)?.[0] ?? "";
    expect(paramBlock).toMatch(/\[string\]\$Date\s*=\s*""/);
    expect(paramBlock).toContain("[switch]$MidTestDryRun");
    expect(paramBlock).not.toMatch(/\$ForDate\b/);
    const assignment = dateAssignmentLine(src);
    expect(assignment).toBe(
      '$date = if ($Date) { $Date } else { $now.AddDays(3).ToString("yyyy-MM-dd") }'
    );
    const got = evalDateCases(assignment, [
      { name: "REEL", now: "2026-08-20" },
      { name: "ROLLOVER", now: "2026-08-30" },
      { name: "OVERRIDE", now: "2026-08-20", Date: "2026-08-21" },
      { name: "DPLUS2", now: "2026-08-20", Date: "2026-08-22" }
    ]);
    expect(got).toEqual({
      REEL: "2026-08-23",
      ROLLOVER: "2026-09-02",
      OVERRIDE: "2026-08-21",
      DPLUS2: "2026-08-22"
    });
    const bound = evalDateParamBind(paramBlock, assignment);
    expect(bound).toEqual({
      DEFAULT: "2026-08-23",
      OVERRIDE: "2026-08-21",
      DPLUS2: "2026-08-22"
    });
    expect(bound.OVERRIDE).not.toBe(bound.DEFAULT);
  });

  it("reverting produce-next-reel default to today still honors -Date, proving AddDays(3) is the discriminator", () => {
    const src = readScript("produce-next-reel.ps1");
    const live = dateAssignmentLine(src);
    const reverted = live.replace("$now.AddDays(3).ToString", "$now.ToString");
    expect(reverted).not.toBe(live);
    const liveGot = evalDateCases(live, [
      { name: "LIVE", now: "2026-08-20" },
      { name: "OVERRIDE", now: "2026-08-20", Date: "2026-08-21" }
    ]);
    const revertedGot = evalDateCases(reverted, [
      { name: "REVERTED", now: "2026-08-20" },
      { name: "OVERRIDE", now: "2026-08-20", Date: "2026-08-21" }
    ]);
    expect(liveGot.LIVE).toBe("2026-08-23");
    expect(liveGot.OVERRIDE).toBe("2026-08-21");
    expect(revertedGot.REVERTED).toBe("2026-08-20");
    expect(revertedGot.OVERRIDE).toBe("2026-08-21");
  });

  it("produce-next-reel plan window and mid-treatment fallback share $date, not wall-clock today", () => {
    const src = readScript("produce-next-reel.ps1");
    expect(src).toMatch(/Get-PlanDaysInWindow \$date 4/);
    expect(src).not.toMatch(/Get-PlanDaysInWindow \$now\.Date/);
    expect(src).toMatch(/\$todayStr = \$date/);
    expect(src).not.toMatch(/\$todayStr = \$now\.ToString\("yyyy-MM-dd"\)/);
    const midCall = src.indexOf("Get-MidTreatment $date");
    const todayStr = src.indexOf("$todayStr = $date");
    const todayTreatment = src.indexOf("Get-MidTreatment $todayStr");
    expect(midCall).toBeGreaterThan(-1);
    expect(todayStr).toBeGreaterThan(midCall);
    expect(todayTreatment).toBeGreaterThan(todayStr);
  });

  it("daily-generate toasts name 目標日, not 今天, when interpolating $date", () => {
    const generate = readScript("daily-generate.ps1");
    // 4 since 2026-10-22: the calendar pre-generation failure toast also names the target day
    expect(generate.match(/目標日 \(\$date\)/g)?.length).toBe(4);
    expect(generate).not.toMatch(/今天 \(\$date\)/);
  });

  it("dayLock standalone fallback stays today and tells callers to pass --date", () => {
    const src = readFileSync(join(root, "src", "dayLock.ts"), "utf8");
    expect(src).toMatch(/standalone fallback=today,由呼叫方負責傳日期/);
    expect(src).toContain(
      'getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date'
    );
    const generate = readScript("daily-generate.ps1");
    const approve = readScript("daily-approve.ps1");
    const catchup = readScript("catchup-publish.ps1");
    expect(generate.match(/npm\.cmd run day-lock -- --date \$date/g)?.length).toBe(2);
    expect(approve).toMatch(/npm\.cmd run day-lock -- --date \$date --heal/);
    expect(catchup.match(/npm\.cmd run day-lock -- --date \$date/g)?.length).toBe(2);
    expect(generate).not.toMatch(/npm\.cmd run day-lock(?! -- --date)/);
    expect(approve).not.toMatch(/npm\.cmd run day-lock(?! -- --date)/);
    expect(catchup).not.toMatch(/npm\.cmd run day-lock(?! -- --date)/);
  });

  it("approve / catchup / sentinel still target today, not D+3", () => {
    const approve = readScript("daily-approve.ps1");
    const catchup = readScript("catchup-publish.ps1");
    const sentinel = readScript("publish-sentinel.ps1");
    expect(dateAssignmentLine(approve)).toBe('$date = $now.ToString("yyyy-MM-dd")');
    expect(dateAssignmentLine(catchup)).toBe('$date = $now.ToString("yyyy-MM-dd")');
    const sentinelDateLine = sentinel.split(/\r?\n/).find((entry) => /^\s*\$d\s*=/.test(entry));
    if (!sentinelDateLine) throw new Error("no sentinel $d assignment found");
    const sentinelAssignment = sentinelDateLine.trim()
      .replace("$d", "$date")
      .replace(/\$env:PUBLISH_SENTINEL_DATE/g, "$Date")
      .replace("$taipeiNow", "$now");
    const sentinelDates = evalDateCases(sentinelAssignment, [
      { name: "TODAY", now: "2026-08-20" },
      { name: "OVERRIDE", now: "2026-08-20", Date: "2026-08-21" }
    ]);
    expect(sentinelDates).toEqual({ TODAY: "2026-08-20", OVERRIDE: "2026-08-21" });
    expect(approve).not.toContain("AddDays(3)");
    expect(catchup).not.toContain("AddDays(3)");
    expect(sentinel).not.toContain("AddDays(3)");
  });

  it("daily-generate children consume $date / -Date instead of recomputing $now", () => {
    const generate = readScript("daily-generate.ps1");
    const missing = readScript("generate-missing-images.ps1");
    expect(generate).toMatch(/generate-missing-images\.ps1"\) -Date \$date -LogFile \$logFile -QaOnly/);
    expect(generate).toMatch(/generate-missing-images\.ps1"\) -Date \$date -LogFile \$logFile(?:\s|$)/);
    expect(generate.match(/npm\.cmd run day-lock -- --date \$date/g)?.length).toBe(2);
    expect(generate).not.toMatch(/heal-reel-slot/);
    expect(missing).toMatch(/\[Parameter\(Mandatory\s*=\s*\$true\)\]\[string\]\$Date/);
    expect(missing).not.toMatch(/\$now\.ToString\("yyyy-MM-dd"\)/);
    expect(missing).not.toMatch(/AddDays\(/);
  });

  it("changed PowerShell scripts still parse", () => {
    expect(parsePsErrors(join(root, "scripts", "daily-generate.ps1"))).toEqual([]);
    expect(parsePsErrors(join(root, "scripts", "produce-next-reel.ps1"))).toEqual([]);
  });
});

// Replace the former fail-open source/fragment assertions with the authorized
// fail-closed contract, exercised against the complete copied production script.
function runCatchup(step: string, code: number) {
  const root = mkdtempSync(join(tmpdir(), "catchup-site-fail-"));
  const scripts = join(root, "scripts");
  const date = "2026-10-28";
  try {
    for (const path of [scripts, "data/content-calendar", "data/approved-log", "output/operations", `docs/assets/${date}`]) {
      mkdirSync(path === scripts ? path : join(root, path), { recursive: true });
    }
    for (const file of ["catchup-publish.ps1", "publish-slot-times.ps1"]) copyFileSync(join(process.cwd(), "scripts", file), join(scripts, file));
    copyFileSync(join(process.cwd(), "test", "ps-catchup-site-failure.harness.ps1"), join(scripts, "harness.ps1"));
    writeFileSync(join(scripts, "_watchdog.ps1"), "");
    writeFileSync(join(root, `data/content-calendar/${date}.json`), JSON.stringify({ date, slots: [{ slot: 1, media_type: "image" }, { slot: 2, media_type: "image" }] }));
    writeFileSync(join(root, `data/approved-log/${date}.json`), '[{"slot":1},{"slot":2}]');
    writeFileSync(join(root, `output/operations/indexing-push-${date}.json`), '{}');
    writeFileSync(join(root, `docs/assets/${date}/slot-01.png`), 'synthetic presence marker');
    const log = join(root, "commands.log");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(scripts, "harness.ps1")], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000,
      env: { ...process.env, CATCHUP_PUBLISH_ROOT: root, CATCHUP_PUBLISH_DATE: date, CATCHUP_PUBLISH_TIME: "12:00", CATCHUP_PUBLISH_TOAST_FILE: join(root, "toasts.log"), CATCHUP_PUBLISH_PLAN_ONLY: "false", CATCHUP_COMMAND_LOG: log, CATCHUP_FAIL_STEP: step, CATCHUP_FAIL_EXIT: String(code) }
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}${result.error ?? ""}`, commands: readFileSync(log, "utf8").trim().split(/\r?\n/u) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe.runIf(process.platform === "win32")("catchup public site failure", () => {
  it.each([{ step: "generate-public-site", code: 7 }, { step: "publish-pages", code: 9 }])("stops immediately after $step fails", ({ step, code }) => {
    const result = runCatchup(step, code);
    const detail = JSON.stringify(result, null, 2);
    expect(result.status, detail).toBe(code);
    expect(result.commands.at(-1), detail).toContain(`npm.cmd run ${step}`);
    expect(result.commands.filter((call) => call.includes("post-current-slot")), detail).toHaveLength(0);
    expect(result.commands.some((call) => /first-comment|share-story/u.test(call)), detail).toBe(false);
    if (step === "generate-public-site") expect(result.commands.some((call) => call.includes("publish-pages")), detail).toBe(false);
  });

  it("keeps the successful generate/publish/post order", () => {
    const result = runCatchup("never-fail", 0);
    const detail = JSON.stringify(result, null, 2);
    expect(result.status, detail).toBe(0);
    const steps = result.commands.map((call) => call.split(" ")[2]);
    expect(steps, detail).toEqual(["day-lock", "day-lock", "heal-reel-slot", "generate-public-site", "publish-pages", "post-current-slot", "first-comment", "share-story"]);
  });
});
