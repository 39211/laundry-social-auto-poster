import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SMOKE = join(ROOT, "test", "ps-catchup-publish-due-slots.smoke.ps1");
const POWERSHELL = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE];

describe("catchup-publish uses the assigned daily slot windows", () => {
  it("keeps calendar and assignment windows in the production due-slot selector", async () => {
    const source = await readFile(join(ROOT, "scripts", "catchup-publish.ps1"), "utf8");
    expect(source).toContain("Get-CalendarSlots -Root $root -Date $date");
    expect(source).toContain("Get-SlotTimes -Root $root -Date $date");
    expect(source).toContain("Get-CatchupSlotWindows -NowTime $now.TimeOfDay");
    expect(source).toContain("Calendar unreadable; falling back to slots 1, 2, 3.");
    expect(source).toContain("Get-MissingRequiredCalendarSlots -CalendarSlots $calendarSlots");
    expect(source).toContain("Invoke-CatchupEveningSteps");
    const smoke = await readFile(SMOKE, "utf8");
    expect(smoke).toContain("[IO.File]::Copy($productionSource, $production)");
    expect(smoke).toContain('"_watchdog.ps1"), "", [Text.UTF8Encoding]::new($true)');
    expect(smoke).not.toMatch(/-File\s+\$productionSource\b/u);
  });

  it.runIf(process.platform === "win32")("smokes the actual script with a command stub and isolated roots", () => {
    const result = spawnSync("powershell.exe", POWERSHELL, { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
    expect(result.status, output).toBe(0);
    expect(output).toMatch(/CASE_OK name=no-slot3-no-false-stale-toast/u);
    expect(output).toMatch(/CASE_OK name=assigned-1412-not-due/u);
    expect(output).toMatch(/CASE_OK name=assigned-1412-due/u);
    expect(output).toMatch(/CASE_OK name=invalid-daily-times-fallback/u);
    expect(output).toMatch(/CASE_OK name=calendar-read-error-fallback/u);
    expect(output).toMatch(/CASE_OK name=utf8-bom-daily-time-file/u);
    expect(output).toMatch(/CASE_OK name=duplicate-daily-time-slot-rejects-whole-file/u);
    expect(output).toMatch(/CASE_OK name=calendar-missing-slot1-still-due/u);
    expect(output).toMatch(/CASE_OK name=calendar-missing-required-slot-hard-fails/u);
    expect(output).toMatch(/CASE_OK name=late-assigned-no-due-runs-evening-closeout/u);
    expect(output).toMatch(/CASE_OK name=no-daily-time-file-keeps-default-evening-path/u);
    expect(output).toMatch(/SMOKE_OK/u);
    expect(output).not.toMatch(/CASE_FAIL/u);
  }, 120000);
});
