import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..");
const script = join(repoRoot, "scripts", "nightly_optimize.py");

function py(body: string): string {
  const src = readFileSync(script, "utf8");
  const start = src.indexOf("# --- nightly-check helpers ---");
  const end = src.indexOf("# --- end helpers ---");
  if (start < 0 || end < 0) {
    throw new Error("nightly-check helper markers missing");
  }
  const code = [
    "import json, re",
    "class n:",
    "    pass",
    src.slice(start, end),
    "for _name, _val in list(globals().items()):",
    "    setattr(n, _name, _val)",
    body
  ].join("\n");
  return execFileSync("python", ["-"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: code,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    }
  });
}

function callJson(body: string): unknown {
  return JSON.parse(py(body));
}

function cal(slots: Array<{ slot: number; instagram_caption: string }>) {
  return { slots };
}

describe("nightly 1a/1b/1c merge: 明日就緒鏈", () => {
  it("is quiet only when the Generate task is present, scheduled, and can wake", () => {
    const rows = callJson(
      "print(json.dumps({k: n.ready_chain_breaks(k) for k in [" +
        "'Ready|True|2026-08-18 06:30:00'," +
        "'MISSING||'," +
        "'Ready|False|2026-08-18 06:30:00'," +
        "'Ready|True|'," +
        "''," +
        "]}))"
    ) as Record<string, string[]>;
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
    const got = callJson(
      "print(json.dumps({" +
        "'path': n.today_image_path('2026-08-17', 1)," +
        "'fix': n.today_image_fix('2026-08-17')," +
        "}))"
    ) as { path: string; fix: string };
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
    const got = callJson(
      [
        "cases = [",
        "  ('提問', '直接點這裡問:https://39211.github.io/go/line.html?source=post', False),",
        "  ('提問', '你現在最想處理掉的是哪一件？', True),",
        "  ('提問', '還沒決定?', True),",
        "  ('價格線索', '衣櫃塞到關不起來的朋友', False),",
        "  ('價格線索', '看起來還好', False),",
        "  ('價格線索', '參考價：運動鞋 $250', True),",
        "  ('價格線索', '運動鞋兩百五、250元', True),",
        "  ('價格線索', '運動鞋 250起', True),",
        "  ('收送句', '台中市區到府收', True),",
        "  ('收送句', '先拍一張再決定', False),",
        "  ('聯絡方式', '加 LINE:0968327653', True),",
        "]",
        "print(json.dumps([[name, text, n.caption_has(name, text), expect] for name, text, expect in cases], ensure_ascii=False))"
      ].join("\n")
    ) as Array<[string, string, boolean, boolean]>;
    for (const [name, text, actual, expected] of got) {
      expect(actual, `${name} on ${text}`).toBe(expected);
    }
  });

  it("emits one 產生器沒寫收送 only when slot 1/2 miss pickup two days running", () => {
    const pickup = "台中市區免費到府收送。你住哪一區？ LINE 0968";
    const noPickup = "看起來還好。直接點 https://x.test/go/line.html?source=post 加 LINE 0968";
    const got = callJson(
      [
        `good = ${JSON.stringify(cal([
          { slot: 1, instagram_caption: pickup },
          { slot: 2, instagram_caption: pickup }
        ]))}`,
        `bad = ${JSON.stringify(cal([
          { slot: 1, instagram_caption: noPickup },
          { slot: 2, instagram_caption: noPickup },
          { slot: 3, instagram_caption: pickup }
        ]))}`,
        "rows_quiet = n.conversion_generator_findings(bad, good, '2026-08-16', '2026-08-17')",
        "rows_hot = n.conversion_generator_findings(bad, bad, '2026-08-16', '2026-08-17')",
        "print(json.dumps({'quiet': [r['what'] for r in rows_quiet], 'hot': [r['what'] for r in rows_hot]}, ensure_ascii=False))"
      ].join("\n")
    ) as { quiet: string[]; hot: string[] };
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
    const got = callJson(
      "print(json.dumps({" +
        "'quiet': n.opt_log_severity(True, False, False)," +
        "'med_post': n.opt_log_severity(False, True, False)," +
        "'med_git': n.opt_log_severity(False, False, True)," +
        "'high': n.opt_log_severity(False, False, False)," +
        "}))"
    ) as Record<string, string | null>;
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
