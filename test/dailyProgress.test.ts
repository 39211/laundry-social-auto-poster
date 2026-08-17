import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..");
const script = join(repoRoot, "scripts", "daily_progress.py");

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "daily-progress-"));
  mkdirSync(join(root, "reports"), { recursive: true });
  mkdirSync(join(root, "output", "day-reports"), { recursive: true });
  mkdirSync(join(root, "output", "operations"), { recursive: true });
  mkdirSync(join(root, "data", "insights", "instagram"), { recursive: true });
  return root;
}

function runPython(args: string[], root: string): string {
  return execFileSync("python", args, {
    cwd: repoRoot,
    env: { ...process.env, DAILY_PROGRESS_ROOT: root },
    encoding: "utf8"
  });
}

function runLedger(root: string, date: string): string {
  return runPython([script, date], root);
}

function metricsFor(root: string, date: string): Record<string, unknown> {
  const code = [
    "import json,sys",
    "sys.path.insert(0, r'scripts')",
    "from daily_progress import metrics_for",
    `print(json.dumps(metrics_for(${JSON.stringify(date)})))`
  ].join("; ");
  return JSON.parse(runPython(["-c", code], root));
}

describe("daily_progress ledger rewrite", () => {
  it("replaces only the rerun date and keeps a later date block", () => {
    const root = fixtureRoot();
    const ledger = join(root, "reports", "daily-progress.md");
    writeFileSync(
      ledger,
      [
        "# 每日進步帳",
        "",
        "## 2026-08-15(對照 2026-08-14)",
        "",
        "| 指標 | 前一天 | 當天 | 判定 |",
        "|---|---|---|---|",
        "| LINE 點擊(GA4) | 1 | 2 | ↑ |",
        "",
        "**結論:1 項進步、0 項退步**(null 表示未量測,不算 0、不算退步;generated old-15)",
        "",
        "## 2026-08-16(對照 2026-08-15)",
        "",
        "| 指標 | 前一天 | 當天 | 判定 |",
        "|---|---|---|---|",
        "| LINE 點擊(GA4) | 2 | 3 | ↑ |",
        "",
        "**結論:1 項進步、0 項退步**(null 表示未量測,不算 0、不算退步;generated old-16)",
        ""
      ].join("\n"),
      "utf8"
    );

    runLedger(root, "2026-08-15");

    const after = readFileSync(ledger, "utf8");
    expect(after).toContain("## 2026-08-15(");
    expect(after).toContain("## 2026-08-16(");
    expect(after).toContain("generated old-16");
    expect(after).not.toContain("generated old-15");
    const first = after.indexOf("## 2026-08-15(");
    const second = after.indexOf("## 2026-08-16(");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });
});

describe("daily_progress null vs measured zero", () => {
  it("keeps an all-zero IG row as measured zero, not null", () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, "data", "insights", "instagram", "export.json"),
      JSON.stringify({
        rows: [
          {
            date: "2026-08-15",
            metrics: { views: 0, ig_reels_avg_watch_time: 0 }
          }
        ]
      }),
      "utf8"
    );

    const metrics = metricsFor(root, "2026-08-15");
    expect(metrics.ig_posts_measured).toBe(1);
    expect(metrics.ig_views_sum).toBe(0);
    expect(metrics.ig_watch_avg_ms).toBe(0);
  });

  it("treats missing slots and missing audited as null, not 0/false", () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, "output", "day-reports", "2026-08-15.json"),
      JSON.stringify({ line_clicks: 4 }),
      "utf8"
    );
    writeFileSync(
      join(root, "output", "operations", "indexing-push-2026-08-15.json"),
      JSON.stringify({ submitted: 2, indexnow_status: "ok" }),
      "utf8"
    );

    const metrics = metricsFor(root, "2026-08-15");
    expect(metrics.published_all_slots).toBeNull();
    expect(metrics.pages_audited_ok).toBeNull();
    expect(metrics.line_clicks).toBe(4);
    expect(metrics.indexnow_submitted).toBe(2);
  });
});

describe("daily_progress writers", () => {
  it("uses temp-plus-replace for ledger and JSON", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("def atomic_write(");
    expect(source).toContain("os.replace(tmp, path)");
    expect(source).toContain("atomic_write(ledger, replace_day_block(existing, target, block))");
    expect(source).toMatch(/atomic_write\(\s*out_json/u);
  });
});
