import { mkdtemp, rm } from "node:fs/promises";
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
});
