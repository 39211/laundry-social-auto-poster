import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SMOKE = join(ROOT, "test", "ps-publish-time-gate.smoke.ps1");

describe("publish-time gate", () => {
  it("uses a full normalized catch-up script path and never overlaps a running catch-up", async () => {
    const source = await readFile(join(ROOT, "scripts", "publish-time-gate.ps1"), "utf8");
    expect(source).toContain("Test-CatchupProcessRunning -Processes $processes -CatchupPath $catchupPath");
    expect(source).toContain("if ($catchupRunning)");
    expect(source).toContain("Catch-up process already running");
    expect(source).toContain("FromMinutes(30)");
    expect(source).toContain("FromHours(4)");
    expect(source).toContain("PUBLISH_GATE_CATCHUP_CMD");
  });

  it("keeps all changed PowerShell files UTF-8 with BOM", async () => {
    const files = [
      "scripts/publish-slot-times.ps1",
      "scripts/catchup-publish.ps1",
      "scripts/watchdog-patrol.ps1",
      "scripts/publish-sentinel.ps1",
      "scripts/publish-time-gate.ps1",
      "scripts/register-publish-time-gate-task.ps1",
      "test/ps-publish-sentinel-live-slots.smoke.ps1",
      "test/ps-catchup-publish-due-slots.smoke.ps1",
      "test/ps-watchdog-rescue-plan.smoke.ps1",
      "test/ps-publish-time-gate.smoke.ps1"
    ];
    for (const relative of files) {
      const bytes = await readFile(join(ROOT, relative));
      expect([...bytes.subarray(0, 3)], relative).toEqual([239, 187, 191]);
    }
  });

  it.runIf(process.platform === "win32")("covers due, posted, retry, process and task-registration gates in PowerShell", () => {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SMOKE],
      { cwd: ROOT, encoding: "utf8", timeout: 120000 }
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
    expect(result.status, output).toBe(0);
    for (const name of [
      "due-unposted-calls-once",
      "not-due-no-call",
      "instagram-posted-no-call",
      "instagram-dry-run-still-needs-publish",
      "second-trigger-waits-30m-third-blocked",
      "four-hour-window-is-exclusive-at-end",
      "calendar-missing-slot1-still-due-and-hard-fails",
      "exact-catchup-process-path-detection",
      "register-whatif-only-two-names"
    ]) {
      expect(output).toContain(`CASE_OK name=${name}`);
    }
    expect(output).toContain("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File");
    expect(output).toContain("SMOKE_OK");
    expect(output).not.toContain("CASE_FAIL");
  }, 120000);
});
