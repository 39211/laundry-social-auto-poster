import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    expect(generate.match(/目標日 \(\$date\)/g)?.length).toBe(3);
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
    expect(sentinel).toMatch(/\$d = \(Get-Date\)\.ToString\("yyyy-MM-dd"\)/);
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

function extractLastExitGuardsWithToast(src: string): string[] {
  const needle = "if ($LASTEXITCODE -ne 0)";
  const guards: string[] = [];
  let from = 0;
  while (from < src.length) {
    const start = src.indexOf(needle, from);
    if (start < 0) break;
    const brace = src.indexOf("{", start);
    if (brace < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = brace; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    const block = src.slice(start, end + 1);
    if (block.includes("Show-Toast")) guards.push(block);
    from = end + 1;
  }
  return guards;
}

const GUARD_TERMINATOR_RE = /(^|;)\s*(exit|return|throw)\b/m;
const FLAG_TERMINATOR_RE = /(^|;)\s*(exit|return|throw|break|continue)\b/m;
const EXIT_TWO_RE = /(^|;)\s*exit\s+2\b/m;
const CATCHUP_FINISHED_MARK = "Catch-up run finished";
const EARLY_FLAG_LOG =
  'Write-Log "public-site repush failed earlier; posting continues, poster validates image URLs itself"';
const END_FLAG_IF =
  'if ($script:publicSiteRepushFailed) { Write-Log "public-site repush failed earlier; exiting 2 so Task Scheduler records it"; exit 2 }';

function assertPublicSiteRepushGuards(src: string): string[] {
  const guards = extractLastExitGuardsWithToast(src);
  if (guards.length !== 2) {
    throw new Error(`expected 2 LASTEXITCODE toast guards, got ${guards.length}`);
  }
  for (const guard of guards) {
    if (!guard.includes("Show-Toast")) throw new Error("guard missing Show-Toast");
    if (!guard.includes("Pop-Location")) throw new Error("guard missing Pop-Location");
    if (GUARD_TERMINATOR_RE.test(guard)) throw new Error("guard contains exit");
  }
  return guards;
}

function extractBraceBlock(src: string, openBrace: number): { end: number; block: string } | null {
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { end: i, block: src.slice(openBrace, i + 1) };
    }
  }
  return null;
}

function ifBlocksWhoseConditionContains(
  src: string,
  needle: string
): Array<{ header: string; body: string; start: number }> {
  const blocks: Array<{ header: string; body: string; start: number }> = [];
  const ifRe = /if\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = ifRe.exec(src))) {
    const condOpen = match.index + match[0].length - 1;
    let depth = 0;
    let condClose = -1;
    for (let i = condOpen; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          condClose = i;
          break;
        }
      }
    }
    if (condClose < 0) continue;
    const header = src.slice(match.index, condClose + 1);
    if (!header.includes(needle)) continue;
    let brace = -1;
    for (let i = condClose + 1; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") {
        brace = i;
        break;
      }
      if (ch === "\n") {
        const rest = src.slice(condClose + 1, i);
        if (rest.trim() !== "") break;
      }
    }
    if (brace < 0) continue;
    const extracted = extractBraceBlock(src, brace);
    if (!extracted) continue;
    blocks.push({ header, body: extracted.block, start: match.index });
  }
  return blocks;
}

function assertPublicSiteRepushDoesNotGatePosting(src: string): void {
  if (src.includes("$needsLiveImageUrl")) {
    throw new Error("needsLiveImageUrl gating still present");
  }
  for (const line of src.split(/\r?\n/)) {
    if (!line.includes("publicSiteRepushFailed")) continue;
    const assign = /\$script:publicSiteRepushFailed\s*=/.test(line);
    const check = /if\s*\(\s*\$script:publicSiteRepushFailed\s*\)/.test(line);
    const log = /Write-Log/.test(line);
    if (!assign && !check && !log) {
      throw new Error(`publicSiteRepushFailed not in assign/check/Write-Log: ${line.trim()}`);
    }
    if (/post-current-slot/.test(line) && /if\s*\(/.test(line)) {
      throw new Error("publicSiteRepushFailed in post-current-slot if condition");
    }
  }
  const finishedAt = src.indexOf(CATCHUP_FINISHED_MARK);
  if (finishedAt < 0) {
    throw new Error("missing Catch-up run finished");
  }
  const flagIfs = ifBlocksWhoseConditionContains(src, "publicSiteRepushFailed");
  const earlyFlagIfs = flagIfs.filter((block) => block.start < finishedAt);
  if (earlyFlagIfs.length === 0) {
    throw new Error("missing publicSiteRepushFailed flag check");
  }
  for (const block of flagIfs) {
    if (block.body.includes("post-current-slot")) {
      throw new Error("post-current-slot is inside publicSiteRepushFailed if");
    }
    if (!block.body.includes("Write-Log")) {
      throw new Error("publicSiteRepushFailed check missing Write-Log");
    }
  }
  for (const block of earlyFlagIfs) {
    if (FLAG_TERMINATOR_RE.test(block.body)) {
      throw new Error("publicSiteRepushFailed block contains terminator");
    }
  }
  if (!/npm\.cmd run post-current-slot/.test(src)) {
    throw new Error("post-current-slot invocation missing");
  }
}

function assertPublicSiteRepushEndSignal(src: string): void {
  const finishedAt = src.indexOf(CATCHUP_FINISHED_MARK);
  if (finishedAt < 0) {
    throw new Error("missing Catch-up run finished");
  }
  const before = src.slice(0, finishedAt);
  const after = src.slice(finishedAt);
  if (EXIT_TWO_RE.test(before)) {
    throw new Error("exit 2 appears before Catch-up run finished");
  }
  if (!EXIT_TWO_RE.test(after)) {
    throw new Error("exit 2 missing after Catch-up run finished");
  }
  const flagIfs = ifBlocksWhoseConditionContains(src, "publicSiteRepushFailed");
  const earlyFlagIfs = flagIfs.filter((block) => block.start < finishedAt);
  const lateFlagIfs = flagIfs.filter((block) => block.start > finishedAt);
  for (const block of earlyFlagIfs) {
    if (FLAG_TERMINATOR_RE.test(block.body)) {
      throw new Error("flag if before Catch-up run finished contains terminator");
    }
  }
  const late = lateFlagIfs[0];
  if (lateFlagIfs.length !== 1 || !late) {
    throw new Error(`expected 1 trailing publicSiteRepushFailed if, got ${lateFlagIfs.length}`);
  }
  if (!late.body.includes("Write-Log")) {
    throw new Error("trailing flag if missing Write-Log");
  }
  if (!EXIT_TWO_RE.test(late.body)) {
    throw new Error("trailing flag if missing exit 2");
  }
}

function runPublicSiteEndFragment(failed: boolean): { code: number; out: string } {
  const src = readScript("catchup-publish.ps1");
  const marker = 'Write-Log "Catch-up run finished."';
  const idx = src.indexOf(marker);
  if (idx < 0) throw new Error("missing finished log for fragment");
  const snippet = src.slice(idx);
  const script = [
    `$script:publicSiteRepushFailed = $${failed}`,
    "function Write-Log([string]$message) { Write-Output $message }",
    "foreach ($slot in 1, 2, 3) { Write-Output ('POST_RAN ' + $slot) }",
    "Write-Output 'SCRIPT_END_REACHED'",
    snippet
  ].join("\n");
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8" }
    );
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    return { code: typeof e.status === "number" ? e.status : -1, out: String(e.stdout ?? "") };
  }
}

describe("catch-up public-site repush failure stays in-section", () => {
  it("both LASTEXITCODE guards toast and pop without exiting the script", () => {
    const src = readScript("catchup-publish.ps1");
    const guards = assertPublicSiteRepushGuards(src);
    expect(guards[0]).toContain("generate-public-site failed");
    expect(guards[1]).toContain("publish-pages failed");
    expect(guards[0]).toContain("Show-Toast");
    expect(guards[0]).toContain("Pop-Location");
    expect(guards[1]).toContain("Show-Toast");
    expect(guards[1]).toContain("Pop-Location");
    for (const guard of guards) {
      expect(guard).not.toMatch(GUARD_TERMINATOR_RE);
    }

    const mutated = src.replace("$script:publicSiteRepushFailed = $true", () => {
      return "exit 1\n            $script:publicSiteRepushFailed = $true";
    });
    expect(mutated).not.toBe(src);
    expect(() => assertPublicSiteRepushGuards(mutated)).toThrow(/guard contains exit/);

    const sameLine = src.replace(
      "$script:publicSiteRepushFailed = $true",
      "$script:publicSiteRepushFailed = $true; exit 1"
    );
    expect(sameLine).not.toBe(src);
    expect(() => assertPublicSiteRepushGuards(sameLine)).toThrow(/guard contains exit/);
    expect(() => assertPublicSiteRepushGuards(src)).not.toThrow();
  });

  it("publicSiteRepushFailed does not gate post-current-slot", () => {
    const src = readScript("catchup-publish.ps1");
    assertPublicSiteRepushDoesNotGatePosting(src);

    const mutated = src.replace(
      'Write-Log "Running post-current-slot --slot $slot"',
      `if ($script:publicSiteRepushFailed) {
        $needsLiveImageUrl = $true
        if ($needsLiveImageUrl) {
            Write-Log "Public-site repush failed; skipping slot $slot (needs live image URL)."
            continue
        }
    }
    Write-Log "Running post-current-slot --slot $slot"`
    );
    expect(mutated).not.toBe(src);
    expect(() => assertPublicSiteRepushDoesNotGatePosting(mutated)).toThrow(
      /needsLiveImageUrl gating still present|publicSiteRepushFailed block contains terminator|post-current-slot is inside/
    );

    const exitMutated = src.replace(EARLY_FLAG_LOG, `${EARLY_FLAG_LOG}; exit 1`);
    expect(exitMutated).not.toBe(src);
    expect(() => assertPublicSiteRepushDoesNotGatePosting(exitMutated)).toThrow(
      /publicSiteRepushFailed block contains terminator/
    );

    const returnMutated = src.replace(EARLY_FLAG_LOG, `${EARLY_FLAG_LOG}; return`);
    expect(returnMutated).not.toBe(src);
    expect(() => assertPublicSiteRepushDoesNotGatePosting(returnMutated)).toThrow(
      /publicSiteRepushFailed block contains terminator/
    );
    expect(() => assertPublicSiteRepushDoesNotGatePosting(src)).not.toThrow();
  });

  it("after Catch-up run finished, failed flag exits 2 for Task Scheduler", () => {
    const src = readScript("catchup-publish.ps1");
    assertPublicSiteRepushEndSignal(src);
    expect(src).toContain(END_FLAG_IF);

    const moved = src.replace(END_FLAG_IF, "").replace(
      'Write-Log "Catch-up run finished."',
      `${END_FLAG_IF}\nWrite-Log "Catch-up run finished."`
    );
    expect(moved).not.toBe(src);
    expect(moved.indexOf("exit 2")).toBeLessThan(moved.indexOf(CATCHUP_FINISHED_MARK));
    expect(() => assertPublicSiteRepushEndSignal(moved)).toThrow(
      /exit 2 appears before Catch-up run finished/
    );
    expect(() => assertPublicSiteRepushEndSignal(src)).not.toThrow();
  });

  it("fragment: failed flag still posts then exits 2", { timeout: 20000 }, () => {
    const result = runPublicSiteEndFragment(true);
    expect(result.out).toMatch(/POST_RAN 1/);
    expect(result.out).toMatch(/POST_RAN 2/);
    expect(result.out).toMatch(/POST_RAN 3/);
    expect(result.out).toMatch(/SCRIPT_END_REACHED/);
    const post1 = result.out.indexOf("POST_RAN 1");
    const post2 = result.out.indexOf("POST_RAN 2");
    const post3 = result.out.indexOf("POST_RAN 3");
    const reached = result.out.indexOf("SCRIPT_END_REACHED");
    expect(post1).toBeGreaterThanOrEqual(0);
    expect(post2).toBeGreaterThan(post1);
    expect(post3).toBeGreaterThan(post2);
    expect(reached).toBeGreaterThan(post3);
    expect(result.code).toBe(2);
  });

  it("fragment: clear flag exits 0", { timeout: 20000 }, () => {
    const result = runPublicSiteEndFragment(false);
    expect(result.out).toMatch(/POST_RAN 1/);
    expect(result.out).toMatch(/POST_RAN 2/);
    expect(result.out).toMatch(/POST_RAN 3/);
    expect(result.out).toMatch(/SCRIPT_END_REACHED/);
    expect(result.code).toBe(0);
  });
});
