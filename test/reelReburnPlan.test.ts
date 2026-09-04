import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
const REAL_PYTHON = "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe";

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
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}

function parseJsonl(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, "").trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
  const pyCmd = [
    "@echo off",
    `"${REAL_PYTHON.replace(/\//g, "\\")}" "%~dp0python-stub.py" %*`,
    "exit /b %ERRORLEVEL%"
  ].join("\r\n");
  writeFileSync(join(stubDir, "python.cmd"), pyCmd);
  writeFileSync(
    join(stubDir, "python-stub.py"),
    [
      "import json, os, sys",
      "log = os.environ.get('REBURN_STUB_LOG')",
      "if log:",
      "    with open(log, 'a', encoding='utf-8') as f:",
      "        f.write(json.dumps({'tool': 'python', 'argv': sys.argv[1:]}, ensure_ascii=False) + '\\n')",
      "args = sys.argv[1:]",
      "if '-m' in args and 'edge_tts' in args:",
      "    out = args[args.index('--write-media') + 1] if '--write-media' in args else None",
      "    if out:",
      "        parent = os.path.dirname(out)",
      "        if parent: os.makedirs(parent, exist_ok=True)",
      "        open(out, 'wb').write(b'ID3stub')",
      "    raise SystemExit(0)",
      "if any('measure-pair-gain.py' in a.replace(chr(92), '/') for a in args):",
      "    print('before RGB: [10.0, 10.0, 10.0]')",
      "    print('-GainR 1.2500 -GainG 1.1250 -GainB 1.0625')",
      "    raise SystemExit(0)",
      "raise SystemExit(2)",
      ""
    ].join("\n")
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
      "    Run = $Run",
      "    GainR = $GainR.ToString([Globalization.CultureInfo]::InvariantCulture)",
      "    GainG = $GainG.ToString([Globalization.CultureInfo]::InvariantCulture)",
      "    GainB = $GainB.ToString([Globalization.CultureInfo]::InvariantCulture)",
      "    NarrationFile = $NarrationFile",
      "    MiddleClip = $MiddleClip",
      "    BoundGainR = [bool]$PSBoundParameters.ContainsKey('GainR')",
      "    BoundGainG = [bool]$PSBoundParameters.ContainsKey('GainG')",
      "    BoundGainB = [bool]$PSBoundParameters.ContainsKey('GainB')",
      "}",
      "$utf8 = New-Object System.Text.UTF8Encoding $false",
      "[IO.File]::AppendAllText($env:REBURN_STUB_LOG, (($record | ConvertTo-Json -Compress) + [Environment]::NewLine), $utf8)",
      "$reels = Join-Path $Run 'reels'",
      "New-Item -ItemType Directory -Force -Path $reels | Out-Null",
      "$name = if ($MiddleClip) { \"$ConceptId-15s.mp4\" } else { \"$ConceptId.mp4\" }",
      "$out = Join-Path $reels $name",
      "[IO.File]::WriteAllBytes($out, [Text.Encoding]::ASCII.GetBytes('stub-mp4'))",
      "@{ source = 'stub'; narration = $true } | ConvertTo-Json | Set-Content -LiteralPath \"$out.audio.json\" -Encoding utf8",
      "@{ burned = $false; error = 'stub burn skipped' } | ConvertTo-Json | Set-Content -LiteralPath \"$out.subs.json\" -Encoding utf8",
      ""
    ].join("\r\n"),
    { encoding: "utf8" }
  );
}

function makeFixture(): { scratch: string; run: string; outDir: string; stubDir: string; logPath: string } {
  const scratch = mkdtempSync(join(tmpdir(), "reburn-fx-"));
  scratches.push(scratch);
  const run = join(scratch, "run");
  const outDir = join(scratch, "out");
  const stubDir = join(scratch, "stubs");
  const logPath = join(scratch, "calls.jsonl");
  mkdirSync(join(run, "raw"), { recursive: true });
  mkdirSync(join(run, "references"), { recursive: true });
  writeFileSync(join(run, "raw", "white-shoe-yellowing-before.mp4"), "before");
  writeFileSync(join(run, "raw", "white-shoe-yellowing-after.mp4"), "after");
  writeFileSync(join(run, "references", "white-shoe-yellowing-before.png"), "png");
  writeStubs(stubDir);
  return { scratch, run, outDir, stubDir, logPath };
}

function runReburn(args: string[], extra: { stubDir?: string; logPath?: string; timeout?: number } = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PUBLIC_SITE_BASE_URL: process.env.PUBLIC_SITE_BASE_URL || "https://sixiangjialaundry.com",
    PUBLIC_IMAGE_BASE_URL: process.env.PUBLIC_IMAGE_BASE_URL || "https://sixiangjialaundry.com",
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "x",
    FB_PAGE_ID: process.env.FB_PAGE_ID || "x",
    IG_USER_ID: process.env.IG_USER_ID || "x"
  };
  if (extra.stubDir) env.PATH = `${extra.stubDir};${process.env.PATH ?? ""}`;
  if (extra.logPath) env.REBURN_STUB_LOG = extra.logPath;
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH, ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: extra.timeout ?? 60_000,
      env
    }
  );
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
    expect(text).toMatch(/\[switch\]\$DryRunStubs/);
    expect(text).toMatch(/middle-graded\.mp4/);
    expect(text).not.toMatch(/raw\\\$id-middle\.mp4/);
    expect(text).not.toMatch(/docs\\content-calendar/);
    expect(text).not.toMatch(/data\\video-reviews/);
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
        "-DryRunStubs"
      ],
      { stubDir: fx.stubDir, logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(0);
    expect(existsSync(fx.outDir), "WhatIf must not create OutDir").toBe(false);
    expect(walkSnapshot(fx.run)).toEqual(before);
    expect(`${result.stdout ?? ""}`).toMatch(/PLAN \| white-shoe-yellowing/);
    expect(`${result.stdout ?? ""}`).toMatch(/engine=edge-tts/);
    expect(`${result.stdout ?? ""}`).toMatch(/voice=zh-TW-YunJheNeural/);
    expect(`${result.stdout ?? ""}`).toMatch(/rate=\+8%/);
  }, 60_000);

  it("DryRunStubs walks TTS + assemble and fails when burned=false", () => {
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
        "-DryRunStubs"
      ],
      { stubDir: fx.stubDir, logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(1);
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(combined).toMatch(/ERROR \| white-shoe-yellowing \| subtitles not burned:/);

    const calls = parseJsonl(readFileSync(fx.logPath, "utf8"));
    const pyCalls = calls.filter((row) => row.tool === "python");
    const tts = pyCalls.find((row) => Array.isArray(row.argv) && (row.argv as string[]).includes("edge_tts"));
    expect(tts, "python stub must see edge_tts").toBeDefined();
    const ttsArgv = tts!.argv as string[];
    expect(ttsArgv).toContain("-m");
    expect(ttsArgv).toContain("edge_tts");
    expect(ttsArgv).toContain("zh-TW-YunJheNeural");
    expect(ttsArgv.some((arg) => arg === "--rate=+8%" || arg === "+8%")).toBe(true);
    const writeMedia = ttsArgv[ttsArgv.indexOf("--write-media") + 1];
    expect(writeMedia).toBeTruthy();
    expect(normPath(writeMedia!)).toContain(normPath(join(fx.outDir, "run", "tts")));
    expect(writeMedia).not.toMatch(/npm run tts/);

    const measure = pyCalls.find(
      (row) => Array.isArray(row.argv) && (row.argv as string[]).some((arg) => String(arg).includes("measure-pair-gain.py"))
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

    const manifestPath = join(fx.outDir, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      engine: string;
      voice: string;
      rate: string;
      run_dir: string;
      items: Array<{
        id: string;
        burned: boolean;
        error: string;
        gain_r: number;
        gain_g: number;
        gain_b: number;
        gain_source: string;
      }>;
    };
    expect(manifest.engine).toBe("edge-tts");
    expect(manifest.voice).toBe("zh-TW-YunJheNeural");
    expect(manifest.rate).toBe("+8%");
    expect(normPath(manifest.run_dir)).toBe(normPath(join(fx.outDir, "run")));
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]!.burned).toBe(false);
    expect(manifest.items[0]!.error).toMatch(/stub burn skipped/);
    expect(manifest.items[0]!.gain_r).toBeCloseTo(1.25, 4);
    expect(manifest.items[0]!.gain_source).toBe("measure-pair-gain.py");
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
        "-DryRunStubs"
      ],
      { stubDir: fx.stubDir, logPath: fx.logPath }
    );
    expect(result.status, spawnDump(result)).toBe(3);
    expect(existsSync(nested)).toBe(false);
    expect(walkSnapshot(fx.run)).toEqual(before);
    expect(existsSync(fx.outDir)).toBe(false);
  }, 60_000);
});
