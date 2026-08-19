import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendApprovalLog,
  appendPostLog,
  loadApprovalLog,
  loadPostLog
} from "../src/logging";
import type { ApprovalLogEntry, PostLogEntry } from "../src/types";

describe("concurrent JSON log writes", () => {
  const roots: string[] = [];

  afterEach(async () => {
    // These tests deliberately contend for lock files, and Windows releases the
    // last handle a moment after the write resolves, so an immediate delete can
    // still hit ENOTEMPTY. Without retries the cleanup, not the code under test,
    // is what fails the suite.
    await Promise.all(
      roots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
    );
  });

  it("preserves approvals written by concurrent slot processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-approval-lock-"));
    roots.push(root);
    const date = "2026-07-27";
    const entries: ApprovalLogEntry[] = [
      { date, slot: 1, platform: "facebook", status: "approved", approved_by: "test", created_at: "1" },
      { date, slot: 1, platform: "instagram", status: "approved", approved_by: "test", created_at: "2" },
      { date, slot: 2, platform: "facebook", status: "approved", approved_by: "test", created_at: "3" },
      { date, slot: 2, platform: "instagram", status: "approved", approved_by: "test", created_at: "4" }
    ];

    await Promise.all(entries.map((entry) => appendApprovalLog(entry, root)));

    expect(await loadApprovalLog(date, root)).toHaveLength(4);
  });

  it("preserves publish evidence written concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-post-lock-"));
    roots.push(root);
    const date = "2026-07-27";
    const entries: PostLogEntry[] = Array.from({ length: 8 }, (_, index) => ({
      date,
      slot: index + 1,
      platform: index % 2 === 0 ? "facebook" : "instagram",
      status: "success",
      dry_run: false,
      attempts: 1,
      post_id: `post-${index + 1}`,
      created_at: String(index + 1)
    }));

    await Promise.all(entries.map((entry) => appendPostLog(entry, root)));

    const saved = await loadPostLog(date, root);
    expect(saved).toHaveLength(entries.length);
    expect(new Set(saved.map((entry) => entry.post_id))).toEqual(new Set(entries.map((entry) => entry.post_id)));
  });

  it("fails both stale publish-ledger rescuers without overwriting real evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-post-stale-lock-"));
    roots.push(root);
    const date = "2026-07-27";
    const ledgerPath = join(root, "data", "posted-log", `${date}.json`);
    const lockPath = `${ledgerPath}.lock`;
    const existing: PostLogEntry = {
      date,
      slot: 1,
      platform: "facebook",
      status: "success",
      dry_run: false,
      attempts: 1,
      post_id: "already-recorded",
      created_at: "existing"
    };
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(ledgerPath, `${JSON.stringify([existing])}\n`, "utf8");
    const exited = spawn(process.execPath, ["-e", "process.exit(0)"]);
    const exitedPid = exited.pid;
    if (!exitedPid) throw new Error("fixture child did not receive a PID");
    await once(exited, "exit");
    await writeFile(lockPath, `${exitedPid} 2026-08-19T00:00:00.000Z\n`, "utf8");
    const old = new Date(Date.now() - 2 * 60 * 1000);
    await utimes(lockPath, old, old);

    const contenders: PostLogEntry[] = [
      {
        ...existing,
        slot: 2,
        platform: "instagram",
        post_id: "must-not-overwrite-1",
        created_at: "contender-1"
      },
      {
        ...existing,
        slot: 3,
        platform: "facebook",
        post_id: "must-not-overwrite-2",
        created_at: "contender-2"
      }
    ];
    const attempts = await Promise.allSettled(contenders.map((entry) => appendPostLog(entry, root)));

    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.status).toBe("rejected");
      if (attempt.status === "rejected") {
        expect(String(attempt.reason)).toContain("manual recovery is required");
      }
    }
    expect(await loadPostLog(date, root)).toEqual([existing]);
    await expect(readFile(lockPath, "utf8")).resolves.toContain(String(exitedPid));
  });
});
