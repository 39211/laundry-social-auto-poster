import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("scheduler safety boundaries", () => {
  it("never re-enables disabled Laundry tasks automatically", () => {
    const daily = read("scripts/daily-generate.ps1");
    const watchdog = read("scripts/_watchdog.ps1");
    expect(daily).not.toMatch(/Enable-ScheduledTask/);
    expect(watchdog).not.toMatch(/Enable-ScheduledTask/);
    expect(daily).toMatch(/BLOCKED: disabled Laundry task/);
    expect(watchdog).toMatch(/BLOCKED: disabled task requires manual recovery/);
  });

  it("does not let patrol re-register tasks from ambiguous scheduler state", () => {
    const patrol = read("scripts/watchdog-patrol.ps1");
    expect(patrol).toMatch(/manual registration required/);
    expect(patrol).not.toMatch(/register-catchup-task\.ps1/);
  });

  it("does not stash production edits from an unattended run", () => {
    const daily = read("scripts/daily-generate.ps1");
    expect(daily).not.toMatch(/git stash/);
    expect(daily).toMatch(/BLOCKED: uncommitted production-code/);
  });

  it("registers tasks with the current PowerShell executable, not PATH", () => {
    const register = read("scripts/register-catchup-task.ps1");
    expect(register).toMatch(/Join-Path \$PSHOME \"powershell\.exe\"/);
    expect(register).not.toMatch(/-Execute \"powershell\.exe\"/);
  });

  it("keeps the publish sentinel read-only and evidence-based", () => {
    const sentinel = read("scripts/publish-sentinel.ps1");
    expect(sentinel).toMatch(/\.date -eq \$d/);
    expect(sentinel).toMatch(/\.dry_run -eq \$false/);
    expect(sentinel).toMatch(/\.post_id -is \[string\]/);
    expect(sentinel).toMatch(/no automatic catchup/);
    expect(sentinel).not.toMatch(/firing catchup/);
    expect(sentinel).not.toMatch(/& powershell /i);
  });

  it("does not claim Story or GBP success from a POST alone", () => {
    const story = read("src/postStory.ts");
    const gbp = read("src/gbpPost.ts");
    expect(story).toMatch(/loadApprovalLog/);
    expect(story).toMatch(/hasPublishableApproval/);
    expect(story).toMatch(/Story remote read-back/);
    expect(gbp).toMatch(/GBP localPosts read-back/);
    expect(gbp).toMatch(/remoteSummary !== composition\.summary/);
  });
});
