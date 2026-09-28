import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "produce-next-reel.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-picker-skip-paused.smoke.ps1");

function lastJsonObject(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const line = lines.at(-1);
  if (!line) throw new Error(`picker skip-paused smoke printed no JSON object\n${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

// Bug: output/reel-production-logs/2026-09-30.log (run of 2026-09-27 14:00)
// picked and built 15s for wool-coat-shoulder needed by plan day 2026-10-03
// evening, even though that half is paused in data/ab-test-plan.json (every
// half from 2026-09-19 on is paused; the owner retired 10s library reels on
// 2026-09-18). The "pick work: prefer missing 15s" loop checks variant and
// rejected concepts but never checks $half.paused, unlike the scheduling
// loop further down ("paused by plan (capacity 7->3); not scheduling").
describe("produce-next-reel picker respects plan.paused", () => {
  it("the missing-15s loop checks $half.paused, matching the scheduling loop's guard", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const start = source.indexOf("$windowDays = Get-PlanDaysInWindow $date 4");
    const end = source.indexOf("if ($missing15s.Count -gt 0) {");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pickBlock = source.slice(start, end);
    expect(pickBlock).toMatch(/\$half\.paused\s+-eq\s+\$true/u);
  });

  // The 10s fallback picker (the `$pending` filter right after the missing15s
  // block) does not walk plan days/halves at all -- it rotates through every
  // not-yet-built concept in data/reel-concepts-extension.json regardless of
  // the plan. There is no `$half` there to check, so it cannot have this same
  // "checks variant but forgets paused" shape. It can still spend a build on
  // a concept whose only plan appearance is a paused half, but that is a
  // different, pre-existing behavior and out of scope for this fix.
  it("the 10s fallback picker has no per-half loop (documents why it needs no paused guard)", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const pendingStart = source.indexOf("$pending = @($status.concepts | Where-Object {");
    const pendingEnd = source.indexOf("if ($pending.Count -eq 0) {");
    expect(pendingStart).toBeGreaterThan(-1);
    expect(pendingEnd).toBeGreaterThan(pendingStart);
    const pendingBlock = source.slice(pendingStart, pendingEnd);
    expect(pendingBlock).not.toMatch(/\$windowDays/u);
    expect(pendingBlock).not.toMatch(/\.paused/u);
  });

  it.runIf(process.platform === "win32")(
    "invokes the production missing-15s block: a paused 15s half is not a gap, an unpaused one still is",
    () => {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
        { encoding: "utf8", cwd: ROOT, timeout: 30000 }
      );
      const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
      expect(result.status, out).toBe(0);
      expect(out).toMatch(/EXTRACT_OK/u);
      expect(out).toMatch(/SMOKE_OK/u);
      expect(out).not.toMatch(/CASE_FAIL/u);
      expect(lastJsonObject(out)).toEqual({
        ok: true,
        missing15s_count: 2,
        ids: "suit-shoulder,heel-tip-scuff",
        paused_half_excluded: true,
        unpaused_half_kept: true,
        absent_paused_kept: true
      });
    },
    30000
  );
});
