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
  it("production uses the live helpers on both posted-log reads, not status-eq-success", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const live = functionSlice(source, "Test-LivePostedEntry");
    const slots = functionSlice(source, "Get-LivePostedSlots");
    const missing = functionSlice(source, "Get-MissingDueSlots");
    const due = functionSlice(source, "Get-DueSlots");
    expect(due).toContain('$Time -ge "11:45"');
    expect(due).toContain('$Time -ge "12:15"');
    expect(due).toContain('$Time -ge "20:45"');
    expect(live).toContain("if ($Entry.dry_run)");
    expect(live).toContain('@("success", "posted") -contains $status');
    expect(slots).toContain("Test-LivePostedEntry");
    expect(missing).toContain("$posted -notcontains $_");
    expect(source).toContain("$posted = @(Get-LivePostedSlots $parsed)");
    expect(source).toContain("$posted2 = @(Get-LivePostedSlots $parsed2)");
    expect(source).toContain("$missing = @(Get-MissingDueSlots $due $posted)");
    expect(source).toContain("$still = @(Get-MissingDueSlots $due $posted2)");
    expect(source).not.toMatch(/Where-Object\s*\{\s*\$_\.status\s*-eq\s*"success"\s*\}/u);
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
        missing_dry_noon: "1,3"
      });
    },
    30000
  );
});
