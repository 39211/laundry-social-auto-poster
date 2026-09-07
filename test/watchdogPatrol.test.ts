import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PROD_SCRIPT = join(ROOT, "scripts", "watchdog-patrol.ps1");
const SMOKE_SCRIPT = join(ROOT, "test", "ps-watchdog-rescue-plan.smoke.ps1");

function functionSlice(source: string, name: string): string {
  const start = source.search(new RegExp(`function ${name}\\b`, "u"));
  if (start < 0) throw new Error(`${name} not found`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function lastJsonObject(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const line = lines.at(-1);
  if (!line) throw new Error(`watchdog rescue smoke printed no JSON object\n${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("watchdog-patrol F32 Enable-before-Start", () => {
  it("plans EnableFirst only when the task is Disabled, then logs Start failures", async () => {
    const source = await readFile(PROD_SCRIPT, "utf8");
    const plan = functionSlice(source, "Get-ScheduledTaskRescuePlan");
    const invokeStart = source.search(/function Invoke-ScheduledTaskRescue\b/u);
    const rootLine = source.indexOf("$root = Split-Path -Parent $PSScriptRoot", invokeStart);
    const invoke = source.slice(invokeStart, rootLine < 0 ? source.length : rootLine);
    expect(plan).toMatch(/\$enableFirst = \$true/u);
    expect(plan).toMatch(/"\$\(\$Task\.State\)" -eq "Disabled"/u);
    expect(invoke).toContain("if ($plan.EnableFirst)");
    expect(invoke).toContain("Start-ScheduledTask");
    expect(invoke).toContain("Start-ScheduledTask {1} failed");
    expect(invoke).toContain("Enable-ScheduledTask {1} failed");
    expect(source).toContain('Invoke-ScheduledTaskRescue -TaskName "Laundry-CatchUp-Publish"');
    expect(source).toContain('Invoke-ScheduledTaskRescue -TaskName "Laundry-YouTube-Upload"');
    expect(source).not.toMatch(
      /Start-ScheduledTask -TaskName "Laundry-CatchUp-Publish" -ErrorAction SilentlyContinue/u
    );
    expect(source).not.toMatch(
      /Start-ScheduledTask -TaskName "Laundry-YouTube-Upload" -ErrorAction SilentlyContinue/u
    );
  });

  it.runIf(process.platform === "win32")(
    "invokes production plan+rescue with mocks: Disabled enables then starts, Start throw is logged",
    () => {
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE_SCRIPT],
        { encoding: "utf8", cwd: ROOT, timeout: 30000 }
      );
      const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
      expect(result.status, out).toBe(0);
      expect(out).toMatch(/EXTRACT_OK name=Get-ScheduledTaskRescuePlan/u);
      expect(out).toMatch(/EXTRACT_OK name=Invoke-ScheduledTaskRescue/u);
      expect(out).toMatch(/PLAN_OK name=disabled/u);
      expect(out).toMatch(/PLAN_OK name=ready/u);
      expect(out).toMatch(/PLAN_OK name=missing/u);
      expect(out).toMatch(/INVOKE_OK name=disabled order=get,enable,start/u);
      expect(out).toMatch(/INVOKE_OK name=ready order=get,start/u);
      expect(out).toMatch(/INVOKE_OK name=start-fail logged/u);
      expect(out).toMatch(/SMOKE_OK/u);
      expect(out).not.toMatch(/PLAN_FAIL/u);
      expect(out).not.toMatch(/INVOKE_FAIL/u);
      expect(lastJsonObject(out)).toEqual({
        ok: true,
        disabled_enable: true,
        ready_enable: false,
        missing_enable: false,
        disabled_order: "get:Laundry-CatchUp-Publish,enable:Laundry-CatchUp-Publish,start:Laundry-CatchUp-Publish",
        start_fail_logged: true
      });
    },
    30000
  );
});
