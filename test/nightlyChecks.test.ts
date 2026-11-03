import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const repoRoot = join(__dirname, "..");
const script = join(repoRoot, "scripts", "nightly_optimize.py");

// The pure helpers live in scripts/nightly_checks_helpers.py. This file used to
// start one python process per assertion (six cold starts, each blocking the
// vitest worker), which on a loaded windows runner once blew vitest's 5s limit.
// Now every helper case is evaluated by ONE isolated, asynchronous python
// process in beforeAll; each test below only asserts on its slice of the result.
// The subprocess has its own explicit timeout (below vitest's 5s) so a hung
// python fails with its own message and stderr instead of an opaque test timeout.
// The helpers themselves are also covered by python unittest in
// test/py/test_nightly_checks_helpers.py, which CI runs as its own step.
const PYTHON_TIMEOUT_MS = 4000;

function cal(slots: Array<{ slot: number; instagram_caption: string }>) {
  return { slots };
}

const pickup = "台中市區免費到府收送。你住哪一區？ LINE 0968";
const noPickup = "看起來還好。直接點 https://x.test/go/line.html?source=post 加 LINE 0968";
const goodCal = cal([
  { slot: 1, instagram_caption: pickup },
  { slot: 2, instagram_caption: pickup }
]);
const badCal = cal([
  { slot: 1, instagram_caption: noPickup },
  { slot: 2, instagram_caption: noPickup },
  { slot: 3, instagram_caption: pickup }
]);

const readyKeys = [
  "Ready|True|2026-08-18 06:30:00",
  "MISSING||",
  "Ready|False|2026-08-18 06:30:00",
  "Ready|True|",
  ""
];

const captionCases: Array<[string, string, boolean]> = [
  ["提問", "直接點這裡問:https://39211.github.io/go/line.html?source=post", false],
  ["提問", "你現在最想處理掉的是哪一件？", true],
  ["提問", "還沒決定?", true],
  ["價格線索", "衣櫃塞到關不起來的朋友", false],
  ["價格線索", "看起來還好", false],
  ["價格線索", "參考價：運動鞋 $250", true],
  ["價格線索", "運動鞋兩百五、250元", true],
  ["價格線索", "運動鞋 250起", true],
  ["收送句", "台中市區到府收", true],
  ["收送句", "先拍一張再決定", false],
  ["聯絡方式", "加 LINE:0968327653", true]
];

type Results = {
  ready: Record<string, string[]>;
  image: { path: string; fix: string };
  captions: Array<[string, string, boolean, boolean]>;
  conversion: { quiet: string[]; hot: string[] };
  logSeverity: Record<string, string | null>;
};

const PROGRAM = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "import nightly_checks_helpers as n",
  "data = json.loads(sys.stdin.buffer.read().decode('utf-8'))",
  "good, bad = data['good'], data['bad']",
  "rows_quiet = n.conversion_generator_findings(bad, good, '2026-08-16', '2026-08-17')",
  "rows_hot = n.conversion_generator_findings(bad, bad, '2026-08-16', '2026-08-17')",
  "out = {",
  "  'ready': {k: n.ready_chain_breaks(k) for k in data['readyKeys']},",
  "  'image': {'path': n.today_image_path('2026-08-17', 1), 'fix': n.today_image_fix('2026-08-17')},",
  "  'captions': [[name, text, n.caption_has(name, text), expect] for name, text, expect in data['captionCases']],",
  "  'conversion': {'quiet': [r['what'] for r in rows_quiet], 'hot': [r['what'] for r in rows_hot]},",
  "  'logSeverity': {",
  "    'quiet': n.opt_log_severity(True, False, False),",
  "    'med_post': n.opt_log_severity(False, True, False),",
  "    'med_git': n.opt_log_severity(False, False, True),",
  "    'high': n.opt_log_severity(False, False, False),",
  "  },",
  "}",
  "sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode('utf-8'))"
].join("\n");

async function evaluateHelpers(): Promise<Results> {
  const dir = mkdtempSync(join(tmpdir(), "nightly-checks-"));
  const program = join(dir, "evaluate.py");
  writeFileSync(program, PROGRAM, "utf8");
  const input = JSON.stringify({ good: goodCal, bad: badCal, readyKeys, captionCases });
  try {
    // -I isolates from user site/env and cwd, -S skips site import (helpers need only
    // json + re), -X utf8 makes stdio UTF-8 without relying on PYTHONUTF8.
    const child = execFileAsync(
      "python",
      ["-I", "-S", "-X", "utf8", program, join(repoRoot, "scripts")],
      { cwd: repoRoot, encoding: "utf8", timeout: PYTHON_TIMEOUT_MS, maxBuffer: 1024 * 1024 }
    );
    child.child.stdin?.end(input, "utf8");
    const { stdout } = await child;
    return JSON.parse(stdout) as Results;
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    throw new Error(
      `nightly helper python subprocess failed (${e.killed ? `killed after ${PYTHON_TIMEOUT_MS}ms timeout` : e.code ?? "error"}): ${e.message}\n${e.stderr ?? ""}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let results: Results;

beforeAll(async () => {
  results = await evaluateHelpers();
});

describe("nightly 1a/1b/1c merge: 明日就緒鏈", () => {
  it("is quiet only when the Generate task is present, scheduled, and can wake", () => {
    const rows = results.ready;
    expect(rows["Ready|True|2026-08-18 06:30:00"]).toEqual([]);
    expect(rows["MISSING||"]).toEqual(["排程不在"]);
    expect(rows["Ready|False|2026-08-18 06:30:00"]).toEqual(["叫不醒"]);
    expect(rows["Ready|True|"]).toEqual(["觸發器沒有下次"]);
    expect(rows[""]).toEqual(["排程探測空"]);
  });

  it("no longer emits the three old 1a/1b/1c what-strings", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("明日就緒鏈");
    expect(source).toContain("ready_chain_breaks");
    expect(source).not.toContain("查不到 06:30 生成排程的狀態");
    expect(source).not.toContain("沒有行事曆,而且 06:30 生成排程不會再跑");
    expect(source).not.toContain("沒有行事曆,而 06:30 叫不醒睡著的機器");
  });
});

describe("nightly 1d rewrite: today's images, not tomorrow's", () => {
  it("builds the cover path and the W-A7B invalidate fix for the given day", () => {
    const got = results.image;
    expect(got.path).toBe("docs/assets/2026-08-17/slot-01.png");
    expect(got.fix).toContain("invalidate");
    expect(got.fix).toContain("--date 2026-08-17");
    expect(got.fix).toContain("generate-missing-images.ps1 -Date 2026-08-17");
    expect(got.fix).not.toContain("2026-08-18");
  });

  it("does not Test-Path tomorrow's slot PNG", () => {
    const source = readFileSync(script, "utf8");
    expect(source).not.toMatch(/docs\/assets\/\{ts\}\/slot/);
    expect(source).toContain("today_image_path(ds, n)");
    expect(source).toContain("today_image_fix(ds)");
  });
});

describe("nightly 5 rewrite: honest conversion fields, generator not draft", () => {
  it("does not treat a URL query ? or a bare 起 as a conversion hit", () => {
    for (const [name, text, actual, expected] of results.captions) {
      expect(actual, `${name} on ${text}`).toBe(expected);
    }
  });

  it("emits one 產生器沒寫收送 only when slot 1/2 miss pickup two days running", () => {
    const got = results.conversion;
    expect(got.quiet).not.toContain("產生器沒寫收送");
    expect(got.hot).toContain("產生器沒寫收送");
    expect(got.hot.filter((item) => item === "產生器沒寫收送")).toHaveLength(1);
  });

  it("does not scan tomorrow's draft path anymore", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("conversion_generator_findings");
    expect(source).not.toContain("slot {s.get('slot')} 文案缺");
    expect(source).not.toContain('("價格線索", r"\\$|元|參考價|起")');
    expect(source).not.toContain('("提問", r"[??]")');
  });
});

describe("nightly 6a rewrite and 6b drop", () => {
  it("keeps a missing log at MED when the day still posted or committed", () => {
    const got = results.logSeverity;
    expect(got.quiet).toBeNull();
    expect(got.med_post).toBe("MED");
    expect(got.med_git).toBe("MED");
    expect(got.high).toBe("HIGH");
  });

  it("deletes the always-true ERROR-BOOK check", () => {
    const source = readFileSync(script, "utf8");
    expect(source).not.toContain("今天沒有新增踩坑紀錄");
    expect(source).not.toContain("git log 未見 ERROR-BOOK.md 變更");
    expect(source).toContain("opt_log_severity");
  });
});
