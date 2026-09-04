import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REEL_CONCEPTS, REEL_SCHEDULE, loadExtensions } from "../src/reelConcepts";
import {
  LIBRARY_NARRATION,
  UNKNOWN_CONCEPT_EXIT,
  buildReburnPlans,
  listVariantAssets,
  parseConceptIds
} from "../src/reelReburnPlan";

const ROOT = process.cwd();
const CONCEPTS_BASELINE = REEL_CONCEPTS.length;
const SCHEDULE_BASELINE = REEL_SCHEDULE.length;
const SCRIPT_PATH = join(ROOT, "scripts", "reburn-reel-narration.ps1");

afterEach(() => {
  REEL_CONCEPTS.length = CONCEPTS_BASELINE;
  REEL_SCHEDULE.length = SCHEDULE_BASELINE;
});

function runPlan(args: string[]) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npx, ["--no-install", "tsx", "src/reelReburnPlan.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    env: {
      ...process.env,
      PUBLIC_SITE_BASE_URL: process.env.PUBLIC_SITE_BASE_URL || "https://sixiangjialaundry.com",
      PUBLIC_IMAGE_BASE_URL: process.env.PUBLIC_IMAGE_BASE_URL || "https://sixiangjialaundry.com",
      META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "x",
      FB_PAGE_ID: process.env.FB_PAGE_ID || "x",
      IG_USER_ID: process.env.IG_USER_ID || "x"
    },
    timeout: 30_000
  });
}

function spawnDump(result: ReturnType<typeof spawnSync>): string {
  return `status=${result.status} error=${result.error ? String(result.error) : ""} stderr=${result.stderr ?? ""} stdout=${result.stdout ?? ""}`;
}

function lastJson(text: string): unknown {
  const start = text.indexOf("{") >= 0 && (text.indexOf("[") < 0 || text.indexOf("{") < text.indexOf("["))
    ? text.indexOf("{")
    : text.indexOf("[");
  const endBrace = text.lastIndexOf("}");
  const endBracket = text.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (start < 0 || end < start) throw new Error(`no JSON in:\n${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

describe("parseConceptIds", () => {
  it("accepts comma lists, repeated args, and skips --date/--run values", () => {
    expect(parseConceptIds(["down-jacket-cuff,wool-coat-shoulder", "--date", "2026-09-08"])).toEqual([
      "down-jacket-cuff",
      "wool-coat-shoulder"
    ]);
    expect(
      parseConceptIds(["white-shoe-yellowing", "--run", "output/reels-run/2026-07-29", "handbag-handle"])
    ).toEqual(["white-shoe-yellowing", "handbag-handle"]);
    expect(parseConceptIds(["--date=2026-09-08", "shirt-collar"])).toEqual(["shirt-collar"]);
  });
});

describe("buildReburnPlans", () => {
  it("prints hook/close/narration matching live REEL_CONCEPTS for a known id", () => {
    loadExtensions(ROOT);
    const builtin = REEL_CONCEPTS.find((concept) => concept.id === "white-shoe-yellowing");
    expect(builtin).toBeDefined();
    const { plans, unknown } = buildReburnPlans({
      ids: ["white-shoe-yellowing"],
      date: "2026-09-08",
      root: ROOT
    });
    expect(unknown).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe("white-shoe-yellowing");
    expect(plans[0]!.hook).toBe(builtin!.hook);
    expect(plans[0]!.close).toBe(builtin!.close);
    expect(plans[0]!.narration).toBe(builtin!.narration);
    expect(plans[0]!.voice).toEqual(LIBRARY_NARRATION);
  });

  it("loads extension ids such as down-jacket-cuff from live REEL_CONCEPTS", () => {
    loadExtensions(ROOT);
    const concept = REEL_CONCEPTS.find((entry) => entry.id === "down-jacket-cuff");
    expect(concept, "down-jacket-cuff should be admitted by loadExtensions").toBeDefined();
    const { plans } = buildReburnPlans({
      ids: ["down-jacket-cuff"],
      date: "2026-09-08",
      root: ROOT
    });
    expect(plans[0]!.narration).toBe(concept!.narration);
    expect(plans[0]!.hook).toBe(concept!.hook);
    expect(plans[0]!.close).toBe(concept!.close);
  });

  it("lists variant mp4 filenames from the run reels/ directory", () => {
    const run = mkdtempSync(join(tmpdir(), "reburn-run-"));
    mkdirSync(join(run, "reels"));
    writeFileSync(join(run, "reels", "white-shoe-yellowing.mp4"), "x");
    writeFileSync(join(run, "reels", "white-shoe-yellowing-15s.mp4"), "x");
    writeFileSync(join(run, "reels", "white-shoe-yellowing-15s-tA.mp4"), "x");
    writeFileSync(join(run, "reels", "handbag-handle.mp4"), "x");
    const { plans } = buildReburnPlans({
      ids: ["white-shoe-yellowing"],
      date: "2026-09-08",
      runDir: run,
      root: ROOT
    });
    expect(plans[0]!.variant_assets).toEqual([
      "white-shoe-yellowing-15s-tA.mp4",
      "white-shoe-yellowing-15s.mp4",
      "white-shoe-yellowing.mp4"
    ]);
    expect(listVariantAssets(join(run, "reels"), "handbag-handle")).toEqual(["handbag-handle.mp4"]);
  });

  it("returns unknown ids without inventing a plan", () => {
    const { plans, unknown, available } = buildReburnPlans({
      ids: ["not-a-real-concept"],
      date: "2026-09-08",
      root: ROOT
    });
    expect(plans).toEqual([]);
    expect(unknown).toEqual(["not-a-real-concept"]);
    expect(available).toContain("white-shoe-yellowing");
  });
});

describe("reel-reburn-plan CLI", () => {
  it("emits hook/close/narration for a known id", () => {
    const result = runPlan(["white-shoe-yellowing", "--date", "2026-09-08"]);
    expect(result.status, spawnDump(result)).toBe(0);
    const payload = lastJson(`${result.stdout ?? ""}`) as {
      id: string;
      hook: string;
      close: string;
      narration: string;
      voice: { engine: string; voice: string; rate: string; source: string };
    };
    loadExtensions(ROOT);
    const concept = REEL_CONCEPTS.find((entry) => entry.id === "white-shoe-yellowing")!;
    expect(payload.id).toBe("white-shoe-yellowing");
    expect(payload.hook).toBe(concept.hook);
    expect(payload.close).toBe(concept.close);
    expect(payload.narration).toBe(concept.narration);
    expect(payload.voice).toEqual(LIBRARY_NARRATION);
  });

  it("exits 2 for an unknown id and lists available ids", () => {
    const result = runPlan(["definitely-not-a-concept"]);
    expect(result.status, spawnDump(result)).toBe(UNKNOWN_CONCEPT_EXIT);
    expect(result.status).toBe(2);
    const err = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    expect(err).toMatch(/Unknown concept: definitely-not-a-concept/);
    expect(err).toMatch(/Known:/);
    expect(err).toContain("white-shoe-yellowing");
  });

  it("keeps library edge-tts voice when --date changes", () => {
    const a = runPlan(["white-shoe-yellowing", "--date", "2026-09-08"]);
    const b = runPlan(["white-shoe-yellowing", "--date", "2026-09-09"]);
    expect(a.status, spawnDump(a)).toBe(0);
    expect(b.status, spawnDump(b)).toBe(0);
    const voiceA = (lastJson(a.stdout ?? "") as { voice: typeof LIBRARY_NARRATION }).voice;
    const voiceB = (lastJson(b.stdout ?? "") as { voice: typeof LIBRARY_NARRATION }).voice;
    expect(voiceA).toEqual(LIBRARY_NARRATION);
    expect(voiceB).toEqual(LIBRARY_NARRATION);
    expect(voiceA.voice).toBe("zh-TW-YunJheNeural");
    expect(voiceA.rate).toBe("+8%");
    expect(voiceA.engine).toBe("edge-tts");
  });
});

type FileSnap = Record<string, { mtimeMs: number; size: number }>;

function walkSnapshot(root: string): FileSnap {
  const out: FileSnap = {};
  if (!existsSync(root)) return out;
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const key = rel ? `${rel}/${name}` : name;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, key);
      else out[key] = { mtimeMs: st.mtimeMs, size: st.size };
    }
  };
  walk(root, "");
  return out;
}

function normPath(p: string): string {
  try {
    if (existsSync(p)) {
      return realpathSync.native(p).replace(/\\/g, "/").toLowerCase();
    }
  } catch {
    // missing or unreadable: fall back to resolve
  }
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}

function queryWinShortPath(longPath: string): string | null {
  if (process.platform !== "win32") return null;
  const fold = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  const clean = (text: string): string | null => {
    const short = String(text)
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^"+|"+$/g, ""))
      .filter(Boolean)
      .pop();
    if (!short || fold(short) === fold(longPath) || !existsSync(short)) return null;
    return short;
  };
  const cmd = spawnSync("cmd.exe", ["/d", "/s", "/c", `for %I in ("${longPath}") do @echo %~sI`], {
    encoding: "utf8",
    windowsHide: true
  });
  const fromCmd = clean(cmd.stdout ?? "");
  if (fromCmd) return fromCmd;
  const fso = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Write-Output (New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:REBURN_LONG_PATH).ShortPath"
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, REBURN_LONG_PATH: longPath }
    }
  );
  return clean(fso.stdout ?? "");
}

function writeGetFileHashHider(dir: string): string {
  const launcher = join(dir, "hide-get-filehash.ps1");
  writeFileSync(
    launcher,
    [
      "function global:Throw-NoGetFileHash {",
      "    throw \"The term 'Get-FileHash' is not recognized as the name of a cmdlet, function, script file, or operable program.\"",
      "}",
      "Set-Alias -Name Get-FileHash -Value Throw-NoGetFileHash -Scope Global -Force -Option AllScope",
      "& $env:REBURN_REAL_SCRIPT @args",
      ""
    ].join("\r\n")
  );
  return launcher;
}

function parseJsonl(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, "").trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function asArgv(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value == null) return [];
  return [String(value)];
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function liveConcept(id: string) {
  loadExtensions(ROOT);
  const concept = REEL_CONCEPTS.find((entry) => entry.id === id);
  if (!concept) throw new Error(`live concept missing: ${id}`);
  return concept;
}

function withDifferentCase(path: string): string {
  const flipped = path.replace(/[A-Za-z]/g, (ch) =>
    ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
  );
  if (flipped === path) throw new Error(`cannot flip case of ${path}`);
  return flipped;
}

function assertNoInterpreterLaunch(text: string, label: string): void {
  expect(text, label).not.toMatch(/python\.exe/i);
  expect(text, label).not.toMatch(/node\.exe/i);
  expect(text, label).not.toMatch(/pythoncore/i);
  expect(text, label).not.toMatch(/\bpy\.exe\b/i);
  expect(text, label).not.toMatch(/(?:^|[\s"'=])(?:python|node|py)(?:\.exe)?\s/i);
  expect(text, label).not.toMatch(/python-stub\.py/i);
}

const scratches: string[] = [];

afterEach(() => {
  while (scratches.length > 0) {
    const dir = scratches.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

function writeStubs(stubDir: string): void {
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(
    join(stubDir, "python.cmd"),
    [
      "@echo off",
      "setlocal EnableDelayedExpansion",
      "REM C0: echo/copy only. Never launch an interpreter.",
      "echo %*| findstr /C:\"edge_tts\" >nul",
      "if not errorlevel 1 (",
      "  if defined REBURN_STUB_TTS_FAIL (",
      "    echo edge-tts stub fail",
      "    exit /b 3",
      "  )",
      "  call :write_media %*",
      "  exit /b 0",
      ")",
      "echo %*| findstr /C:\"measure-pair-gain\" >nul",
      "if not errorlevel 1 (",
      "  if defined REBURN_STUB_GAIN_FAIL (",
      "    echo ImportError: No module named 'cv2'",
      "    exit /b 2",
      "  )",
      "  if \"%REBURN_STUB_GAIN%\"==\"2.5\" (",
      "    echo before RGB: [10.0, 10.0, 10.0]",
      "    echo -GainR 2.5000 -GainG 2.5000 -GainB 2.5000",
      "    exit /b 0",
      "  )",
      "  echo before RGB: [10.0, 10.0, 10.0]",
      "  echo -GainR 1.2500 -GainG 1.1250 -GainB 1.0625",
      "  exit /b 0",
      ")",
      "echo unhandled stub argv",
      "exit /b 2",
      ":write_media",
      "if \"%~1\"==\"\" goto :eof",
      "if \"%~1\"==\"--write-media\" (",
      "  echo ID3stub>\"%~2\"",
      "  goto :eof",
      ")",
      "shift",
      "goto write_media",
      ""
    ].join("\r\n")
  );
  writeFileSync(
    join(stubDir, "python.ps1"),
    [
      "$ErrorActionPreference = 'Stop'",
      "if (-not $env:REBURN_STUB_LOG) { throw 'REBURN_STUB_LOG is required' }",
      "$utf8 = New-Object System.Text.UTF8Encoding $false",
      "$argvList = @($args)",
      "$record = @{ tool = 'python'; argv = $argvList }",
      "[IO.File]::AppendAllText($env:REBURN_STUB_LOG, (($record | ConvertTo-Json -Compress -Depth 6) + [Environment]::NewLine), $utf8)",
      "if ($argvList -contains 'edge_tts') {",
      "    if ($env:REBURN_STUB_TTS_FAIL) { Write-Output 'edge-tts stub fail'; exit 3 }",
      "    $idx = [array]::IndexOf($argvList, '--write-media')",
      "    if ($idx -ge 0 -and ($idx + 1) -lt $argvList.Count) {",
      "        $out = [string]$argvList[$idx + 1]",
      "        [IO.File]::WriteAllBytes($out, [Text.Encoding]::ASCII.GetBytes('ID3stub'))",
      "    }",
      "    exit 0",
      "}",
      "if (@($argvList | Where-Object { $_ -like '*measure-pair-gain.py*' }).Count -gt 0) {",
      "    if ($env:REBURN_STUB_GAIN_FAIL) { Write-Output \"ImportError: No module named 'cv2'\"; exit 2 }",
      "    if ($env:REBURN_STUB_GAIN -eq '2.5') {",
      "        Write-Output 'before RGB: [10.0, 10.0, 10.0]'",
      "        Write-Output '-GainR 2.5000 -GainG 2.5000 -GainB 2.5000'",
      "        exit 0",
      "    }",
      "    Write-Output 'before RGB: [10.0, 10.0, 10.0]'",
      "    Write-Output '-GainR 1.2500 -GainG 1.1250 -GainB 1.0625'",
      "    exit 0",
      "}",
      "Write-Output 'unhandled stub argv'",
      "exit 2",
      ""
    ].join("\r\n")
  );
  writeFileSync(
    join(stubDir, "assemble-reel.ps1"),
    [
      "param(",
      "    [Parameter(Mandatory = $true)][string]$ConceptId,",
      "    [Parameter(Mandatory = $true)][string]$Hook,",
      "    [Parameter(Mandatory = $true)][string]$Close,",
      "    [string]$Run = '',",
      "    [double]$Dissolve = 0.4,",
      "    [double]$GainR = 1.0,",
      "    [double]$GainG = 1.0,",
      "    [double]$GainB = 1.0,",
      "    [string]$NarrationFile = '',",
      "    [string]$NarrationText = '',",
      "    [string]$MiddleClip = ''",
      ")",
      "$record = @{",
      "    tool = 'assemble'",
      "    ConceptId = $ConceptId",
      "    Hook = $Hook",
      "    Close = $Close",
      "    Run = $Run",
      "    GainR = $GainR.ToString([Globalization.CultureInfo]::InvariantCulture)",
      "    GainG = $GainG.ToString([Globalization.CultureInfo]::InvariantCulture)",
      "    GainB = $GainB.ToString([Globalization.CultureInfo]::InvariantCulture)",
      "    NarrationFile = $NarrationFile",
      "    NarrationText = $NarrationText",
      "    MiddleClip = $MiddleClip",
      "    BoundGainR = [bool]$PSBoundParameters.ContainsKey('GainR')",
      "    BoundGainG = [bool]$PSBoundParameters.ContainsKey('GainG')",
      "    BoundGainB = [bool]$PSBoundParameters.ContainsKey('GainB')",
      "    BoundMiddleClip = [bool]$PSBoundParameters.ContainsKey('MiddleClip')",
      "}",
      "$utf8 = New-Object System.Text.UTF8Encoding $false",
      "[IO.File]::AppendAllText($env:REBURN_STUB_LOG, (($record | ConvertTo-Json -Compress) + [Environment]::NewLine), $utf8)",
      "if ($env:REBURN_STUB_ASSEMBLE_NO_OUTPUT) { return }",
      "$reels = Join-Path $Run 'reels'",
      "New-Item -ItemType Directory -Force -Path $reels | Out-Null",
      "$name = if ($MiddleClip) { \"$ConceptId-15s.mp4\" } else { \"$ConceptId.mp4\" }",
      "$out = Join-Path $reels $name",
      "[IO.File]::WriteAllBytes($out, [Text.Encoding]::ASCII.GetBytes('stub-mp4'))",
      "@{ source = 'stub'; narration = $true } | ConvertTo-Json | Set-Content -LiteralPath \"$out.audio.json\" -Encoding utf8",
      "$burned = $env:REBURN_STUB_BURNED -eq '1'",
      "$marker = @{ burned = $burned }",
      "if (-not $burned) { $marker.error = 'stub burn skipped' }",
      "$marker | ConvertTo-Json | Set-Content -LiteralPath \"$out.subs.json\" -Encoding utf8",
      ""
    ].join("\r\n")
  );
}

function makeFixture(opts: { id?: string; middle?: boolean; skipRaw?: boolean } = {}): {
  scratch: string;
  run: string;
  outDir: string;
  stubDir: string;
  logPath: string;
  id: string;
} {
  const scratch = mkdtempSync(join(tmpdir(), "reburn-fx-"));
  scratches.push(scratch);
  const id = opts.id ?? "white-shoe-yellowing";
  const run = join(scratch, "run");
  const outDir = join(scratch, "out");
  const stubDir = join(scratch, "stubs");
  const logPath = join(scratch, "calls.jsonl");
  mkdirSync(join(run, "raw"), { recursive: true });
  mkdirSync(join(run, "references"), { recursive: true });
  if (!opts.skipRaw) {
    writeFileSync(join(run, "raw", `${id}-before.mp4`), "before");
    writeFileSync(join(run, "raw", `${id}-after.mp4`), "after");
  }
  if (opts.middle) {
    writeFileSync(join(run, "raw", `${id}-middle-graded.mp4`), "middle");
  }
  writeFileSync(join(run, "references", `${id}-before.png`), "png");
  writeStubs(stubDir);
  return { scratch, run, outDir, stubDir, logPath, id };
}

function runReburn(
  args: string[],
  extra: { logPath?: string; timeout?: number; env?: NodeJS.ProcessEnv; scriptPath?: string } = {}
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PUBLIC_SITE_BASE_URL: process.env.PUBLIC_SITE_BASE_URL || "https://sixiangjialaundry.com",
    PUBLIC_IMAGE_BASE_URL: process.env.PUBLIC_IMAGE_BASE_URL || "https://sixiangjialaundry.com",
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "x",
    FB_PAGE_ID: process.env.FB_PAGE_ID || "x",
    IG_USER_ID: process.env.IG_USER_ID || "x",
    ...extra.env
  };
  if (extra.logPath) env.REBURN_STUB_LOG = extra.logPath;
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      extra.scriptPath ?? SCRIPT_PATH,
      ...args
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: extra.timeout ?? 60_000,
      env
    }
  );
}

function combinedText(result: ReturnType<typeof spawnSync>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

type ManifestItem = {
  id: string;
  burned: boolean;
  error: string | null;
  gain_r: number;
  gain_g: number;
  gain_b: number;
  gain_source: string;
  sha256: string | null;
  output_mp4: string;
  three_act: boolean;
  duration_sec: number | null;
};

function readManifest(outDir: string) {
  const manifestPath = join(outDir, "manifest.json");
  expect(existsSync(manifestPath)).toBe(true);
  return JSON.parse(readFileSync(manifestPath, "utf8")) as {
    engine: string;
    voice: string;
    rate: string;
    run_dir: string;
    items: ManifestItem[];
  };
}

describe("reburn-reel-narration.ps1 wiring", () => {
  const raw = readFileSync(SCRIPT_PATH);

  it("is UTF-8 with BOM so PS 5.1 can parse Chinese", () => {
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
    const text = raw.subarray(3).toString("utf8");
    expect(text).toMatch(/旁白|重燒|字幕/);
  });

  it("defaults OutDir under repo output\\reel-reburn and never npm run tts", () => {
    const text = raw.subarray(3).toString("utf8");
    expect(text).toMatch(/output\\reel-reburn\\/);
    expect(text).not.toMatch(/\$OutDir = Join-Path \$Run/);
    expect(text).not.toMatch(/Invoke-NpmSilent "tts"/);
    expect(text).toMatch(/-m", "edge_tts"/);
    expect(text).toMatch(/zh-TW-YunJheNeural/);
    expect(text).toMatch(/Alias\("DryRunStubs"\)/);
    expect(text).toMatch(/\$StubDir/);
    expect(text).toMatch(/AllowIdentityGain/);
    expect(text).toMatch(/middle-graded\.mp4/);
    expect(text).not.toMatch(/raw\\\$id-middle\.mp4/);
    expect(text).not.toMatch(/docs\\content-calendar/);
    expect(text).not.toMatch(/data\\video-reviews/);
    expect(text).not.toMatch(/function Find-PathTool/);
    expect(text).not.toMatch(/function Get-RecordedGain/);
    expect(text).not.toMatch(/function Find-GainInObject/);
    expect(text).toMatch(/Join-Path \$stagingRun "tts"/);
    expect(text).toMatch(/Ensure-OutputDirs/);
    expect(text).not.toMatch(/Get-FileHash/);
    expect(text).toMatch(/\[System\.Security\.Cryptography\.SHA256\]::Create\(\)/);
    expect(text).toMatch(/\[System\.IO\.File\]::OpenRead/);
  });

  it("C0 stubs never invoke python or node", () => {
    const fx = makeFixture();
    assertNoInterpreterLaunch(readFileSync(join(fx.stubDir, "python.cmd"), "utf8"), "python.cmd");
    assertNoInterpreterLaunch(readFileSync(join(fx.stubDir, "python.ps1"), "utf8"), "python.ps1");
    assertNoInterpreterLaunch(
      readFileSync(join(fx.stubDir, "assemble-reel.ps1"), "utf8"),
      "assemble-reel.ps1"
    );
  });

  it("WhatIf leaves OutDir absent and the run directory untouched", () => {
    const fx = makeFixture();
    const before = walkSnapshot(fx.run);
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-WhatIf",
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(0);
    expect(existsSync(fx.outDir), "WhatIf must not create OutDir").toBe(false);
    expect(walkSnapshot(fx.run)).toEqual(before);
    expect(`${result.stdout ?? ""}`).toMatch(/PLAN \| white-shoe-yellowing/);
    expect(`${result.stdout ?? ""}`).toMatch(/engine=edge-tts/);
    expect(`${result.stdout ?? ""}`).toMatch(/voice=zh-TW-YunJheNeural/);
    expect(`${result.stdout ?? ""}`).toMatch(/rate=\+8%/);
  }, 60_000);

  it("StubDir walks TTS + assemble and fails when burned=false", () => {
    const fx = makeFixture();
    const concept = liveConcept("white-shoe-yellowing");
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    const combined = combinedText(result);
    expect(combined).toMatch(/ERROR \| white-shoe-yellowing \| subtitles not burned:/);

    const calls = parseJsonl(readFileSync(fx.logPath, "utf8"));
    const pyCalls = calls.filter((row) => row.tool === "python");
    const tts = pyCalls.find((row) => asArgv(row.argv).includes("edge_tts"));
    expect(tts, "python stub must see edge_tts").toBeDefined();
    const ttsArgv = asArgv(tts!.argv);
    expect(ttsArgv).toContain("-m");
    expect(ttsArgv).toContain("edge_tts");
    expect(ttsArgv).toContain("zh-TW-YunJheNeural");
    expect(ttsArgv.some((arg) => arg === "--rate=+8%" || arg === "+8%")).toBe(true);
    const textIdx = ttsArgv.indexOf("--text");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(ttsArgv[textIdx + 1]).toBe(concept.narration);
    const writeMedia = ttsArgv[ttsArgv.indexOf("--write-media") + 1];
    expect(writeMedia).toBeTruthy();
    expect(normPath(writeMedia!)).toContain(normPath(join(fx.outDir, "run", "tts")));
    expect(writeMedia).not.toMatch(/npm run tts/);
    expect(existsSync(join(fx.outDir, "run", "tts"))).toBe(true);

    const measure = pyCalls.find((row) =>
      asArgv(row.argv).some((arg) => String(arg).includes("measure-pair-gain.py"))
    );
    expect(measure, "python stub must see measure-pair-gain.py").toBeDefined();

    const assemble = calls.find((row) => row.tool === "assemble") as
      | {
          Run: string;
          GainR: string;
          GainG: string;
          GainB: string;
          BoundGainR: boolean;
          BoundGainG: boolean;
          BoundGainB: boolean;
          NarrationFile: string;
          NarrationText: string;
          Hook: string;
          Close: string;
          MiddleClip: string;
        }
      | undefined;
    expect(assemble, "assemble stub must be invoked").toBeDefined();
    expect(normPath(assemble!.Run)).toBe(normPath(join(fx.outDir, "run")));
    expect(assemble!.BoundGainR).toBe(true);
    expect(assemble!.BoundGainG).toBe(true);
    expect(assemble!.BoundGainB).toBe(true);
    expect(Number(assemble!.GainR)).toBeCloseTo(1.25, 4);
    expect(Number(assemble!.GainG)).toBeCloseTo(1.125, 4);
    expect(Number(assemble!.GainB)).toBeCloseTo(1.0625, 4);
    expect(normPath(assemble!.NarrationFile)).toBe(normPath(writeMedia!));
    expect(assemble!.NarrationText).toBe(concept.narration);
    expect(assemble!.Hook).toBe(concept.hook);
    expect(assemble!.Close).toBe(concept.close);

    const manifest = readManifest(fx.outDir);
    expect(manifest.engine).toBe("edge-tts");
    expect(manifest.voice).toBe("zh-TW-YunJheNeural");
    expect(manifest.rate).toBe("+8%");
    expect(normPath(manifest.run_dir)).toBe(normPath(join(fx.outDir, "run")));
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]!.burned).toBe(false);
    expect(manifest.items[0]!.error).toMatch(/stub burn skipped/);
    expect(manifest.items[0]!.gain_r).toBeCloseTo(1.25, 4);
    expect(manifest.items[0]!.gain_source).toBe("measure-pair-gain.py");
    expect(manifest.items[0]!.three_act).toBe(false);
    expect(manifest.items[0]!.duration_sec).toBeNull();
    const outMp4 = join(fx.outDir, "run", "reels", "white-shoe-yellowing.mp4");
    expect(normPath(manifest.items[0]!.output_mp4)).toBe(normPath(outMp4));
    expect(existsSync(outMp4)).toBe(true);
    expect(manifest.items[0]!.sha256).toBe(fileSha256(outMp4));
  }, 60_000);

  it("edge-tts --text for an extension id matches live REEL_CONCEPTS narration", () => {
    const fx = makeFixture({ id: "down-jacket-cuff" });
    const concept = liveConcept("down-jacket-cuff");
    const result = runReburn(
      [
        "-ConceptIds",
        "down-jacket-cuff",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    const calls = parseJsonl(readFileSync(fx.logPath, "utf8"));
    const tts = calls.find((row) => row.tool === "python" && asArgv(row.argv).includes("edge_tts"));
    expect(tts).toBeDefined();
    const ttsArgv = asArgv(tts!.argv);
    expect(ttsArgv[ttsArgv.indexOf("--text") + 1]).toBe(concept.narration);
    const assemble = calls.find((row) => row.tool === "assemble") as
      | { NarrationText: string; Hook: string; Close: string }
      | undefined;
    expect(assemble).toBeDefined();
    expect(assemble!.NarrationText).toBe(concept.narration);
    expect(assemble!.Hook).toBe(concept.hook);
    expect(assemble!.Close).toBe(concept.close);
  }, 60_000);

  it("rejects OutDir under Run with exit 3 and zero writes", () => {
    const fx = makeFixture();
    const nested = join(fx.run, "inside-reburn");
    const before = walkSnapshot(fx.run);
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        nested,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(3);
    expect(existsSync(nested)).toBe(false);
    expect(walkSnapshot(fx.run)).toEqual(before);
    expect(existsSync(fx.outDir)).toBe(false);
  }, 60_000);

  it("rejects OutDir under Run when casing differs (exit 3)", () => {
    const fx = makeFixture();
    const runFlipped = withDifferentCase(fx.run);
    const nested = join(runFlipped, "reburn");
    const before = walkSnapshot(fx.run);
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        nested,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(3);
    expect(walkSnapshot(fx.run)).toEqual(before);
    expect(combinedText(result)).toMatch(/OutDir is under Run/);
  }, 60_000);

  it("throws when StubDir is missing", () => {
    const fx = makeFixture();
    const missing = join(fx.scratch, "no-such-stubs");
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        missing
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).not.toBe(0);
    expect(combinedText(result)).toMatch(/StubDir not found/);
  }, 60_000);

  it("identity gain failure prints WARN and exits 1", () => {
    const fx = makeFixture();
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      {
        logPath: fx.logPath,
        env: { REBURN_STUB_GAIN_FAIL: "1", REBURN_STUB_BURNED: "1" }
      }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    expect(combinedText(result)).toMatch(
      /WARN \| white-shoe-yellowing \| gain measurement failed \(.+\); assembling uncorrected/
    );
    const manifest = readManifest(fx.outDir);
    expect(manifest.items[0]!.gain_source).toBe("identity-fallback");
    expect(manifest.items[0]!.gain_r).toBe(1);
    expect(manifest.items[0]!.gain_g).toBe(1);
    expect(manifest.items[0]!.gain_b).toBe(1);
    expect(manifest.items[0]!.burned).toBe(true);
  }, 60_000);

  it("AllowIdentityGain keeps identity fallback at exit 0", () => {
    const fx = makeFixture();
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir,
        "-AllowIdentityGain"
      ],
      {
        logPath: fx.logPath,
        env: { REBURN_STUB_GAIN_FAIL: "1", REBURN_STUB_BURNED: "1" }
      }
    );
    expect(result.status, spawnDump(result)).toBe(0);
    expect(combinedText(result)).toMatch(
      /WARN \| white-shoe-yellowing \| gain measurement failed \(.+\); assembling uncorrected/
    );
    const manifest = readManifest(fx.outDir);
    expect(manifest.items[0]!.gain_source).toBe("identity-fallback");
    expect(manifest.items[0]!.burned).toBe(true);
  }, 60_000);

  it("unknown id exits 1 via powershell.exe -File", () => {
    const fx = makeFixture();
    const result = runReburn(
      [
        "-ConceptIds",
        "not-a-real-concept",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    expect(combinedText(result)).toMatch(/ERROR \| not-a-real-concept \|/);
  }, 60_000);

  it("missing raw clip exits 1 via powershell.exe -File", () => {
    const fx = makeFixture({ skipRaw: true });
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    expect(combinedText(result)).toMatch(/ERROR \| white-shoe-yellowing \| missing raw clips/);
  }, 60_000);

  it("edge-tts failure exits 1 via powershell.exe -File", () => {
    const fx = makeFixture();
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath, env: { REBURN_STUB_TTS_FAIL: "1" } }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    expect(combinedText(result)).toMatch(/ERROR \| white-shoe-yellowing \| edge-tts failed/);
  }, 60_000);

  it("assemble with no output exits 1 via powershell.exe -File", () => {
    const fx = makeFixture();
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath, env: { REBURN_STUB_ASSEMBLE_NO_OUTPUT: "1" } }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    expect(combinedText(result)).toMatch(/ERROR \| white-shoe-yellowing \| assemble-reel produced no /);
  }, 60_000);

  it("clamps stub gain 2.5 to 2.0 for manifest and assemble", () => {
    const fx = makeFixture();
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath, env: { REBURN_STUB_GAIN: "2.5" } }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    const assemble = parseJsonl(readFileSync(fx.logPath, "utf8")).find((row) => row.tool === "assemble") as
      | { GainR: string; GainG: string; GainB: string }
      | undefined;
    expect(assemble).toBeDefined();
    expect(Number(assemble!.GainR)).toBe(2);
    expect(Number(assemble!.GainG)).toBe(2);
    expect(Number(assemble!.GainB)).toBe(2);
    const manifest = readManifest(fx.outDir);
    expect(manifest.items[0]!.gain_r).toBe(2);
    expect(manifest.items[0]!.gain_g).toBe(2);
    expect(manifest.items[0]!.gain_b).toBe(2);
    expect(manifest.items[0]!.gain_source).toBe("measure-pair-gain.py");
  }, 60_000);

  it("three-act middle-graded clip is passed to assemble as -MiddleClip", () => {
    const fx = makeFixture({ middle: true });
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    const assemble = parseJsonl(readFileSync(fx.logPath, "utf8")).find((row) => row.tool === "assemble") as
      | { MiddleClip: string; BoundMiddleClip: boolean }
      | undefined;
    expect(assemble).toBeDefined();
    expect(assemble!.BoundMiddleClip).toBe(true);
    expect(normPath(assemble!.MiddleClip)).toBe(
      normPath(join(fx.outDir, "run", "raw", "white-shoe-yellowing-middle-graded.mp4"))
    );
    const outMp4 = join(fx.outDir, "run", "reels", "white-shoe-yellowing-15s.mp4");
    expect(existsSync(outMp4)).toBe(true);
    const manifest = readManifest(fx.outDir);
    expect(manifest.items[0]!.three_act).toBe(true);
    expect(normPath(manifest.items[0]!.output_mp4)).toBe(normPath(outMp4));
    expect(manifest.items[0]!.duration_sec).toBeNull();
    expect(manifest.items[0]!.sha256).toBe(fileSha256(outMp4));
  }, 60_000);

  it("sha256 is written without Get-FileHash when PSModulePath is empty", () => {
    const fx = makeFixture();
    const emptyMods = join(fx.scratch, "empty-ps-modules");
    mkdirSync(emptyMods);
    const launcher = writeGetFileHashHider(fx.scratch);
    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      {
        logPath: fx.logPath,
        scriptPath: launcher,
        env: {
          REBURN_STUB_BURNED: "1",
          PSModulePath: emptyMods,
          REBURN_REAL_SCRIPT: SCRIPT_PATH
        }
      }
    );
    expect(result.status, spawnDump(result)).toBe(0);
    const outMp4 = join(fx.outDir, "run", "reels", "white-shoe-yellowing.mp4");
    expect(existsSync(outMp4)).toBe(true);
    const manifest = readManifest(fx.outDir);
    expect(manifest.items[0]!.sha256).toBe(
      createHash("sha256").update(readFileSync(outMp4)).digest("hex")
    );
  }, 60_000);

  it("three-act MiddleClip matches when TEMP is an 8.3 short path", (ctx) => {
    const host = mkdtempSync(join(tmpdir(), "reburn-8dot3-host-"));
    scratches.push(host);
    const longTemp = join(host, "ReburnEightDotThreeTempDirectory");
    mkdirSync(longTemp);
    const shortTemp = queryWinShortPath(longTemp);
    if (!shortTemp) {
      const reason = `cmd %~sI did not yield a distinct 8.3 short name for ${longTemp}`;
      console.warn(`skip 8.3 three-act: ${reason}`);
      ctx.skip(reason);
      return;
    }

    const prevTemp = process.env.TEMP;
    const prevTmp = process.env.TMP;
    process.env.TEMP = shortTemp;
    process.env.TMP = shortTemp;
    let fx: ReturnType<typeof makeFixture>;
    try {
      fx = makeFixture({ middle: true });
    } finally {
      if (prevTemp === undefined) delete process.env.TEMP;
      else process.env.TEMP = prevTemp;
      if (prevTmp === undefined) delete process.env.TMP;
      else process.env.TMP = prevTmp;
    }

    const result = runReburn(
      [
        "-ConceptIds",
        "white-shoe-yellowing",
        "-Date",
        "2026-09-08",
        "-Run",
        fx.run,
        "-OutDir",
        fx.outDir,
        "-StubDir",
        fx.stubDir
      ],
      { logPath: fx.logPath, env: { TEMP: shortTemp, TMP: shortTemp } }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    const assemble = parseJsonl(readFileSync(fx.logPath, "utf8")).find((row) => row.tool === "assemble") as
      | { MiddleClip: string; BoundMiddleClip: boolean }
      | undefined;
    expect(assemble).toBeDefined();
    expect(assemble!.BoundMiddleClip).toBe(true);
    expect(normPath(assemble!.MiddleClip)).toBe(
      normPath(join(fx.outDir, "run", "raw", "white-shoe-yellowing-middle-graded.mp4"))
    );
    const outMp4 = join(fx.outDir, "run", "reels", "white-shoe-yellowing-15s.mp4");
    expect(existsSync(outMp4)).toBe(true);
    const manifest = readManifest(fx.outDir);
    expect(manifest.items[0]!.three_act).toBe(true);
    expect(normPath(manifest.items[0]!.output_mp4)).toBe(normPath(outMp4));
    expect(manifest.items[0]!.duration_sec).toBeNull();
    expect(manifest.items[0]!.sha256).toBe(fileSha256(outMp4));
  }, 60_000);
});
