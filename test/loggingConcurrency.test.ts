import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
import {
  appendApprovalLog,
  appendPostLog,
  loadApprovalLog,
  loadPostLog
} from "../src/logging";
import type { ApprovalLogEntry, PostLogEntry } from "../src/types";

describe("concurrent JSON log writes", () => {
  const roots: string[] = [];

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockReset().mockImplementation(actual.open);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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
  it("waits through a transient Windows EPERM before writing publish evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-eperm-lock-"));
    roots.push(root);
    vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error("lock delete pending"), { code: "EPERM" }));
    const date = "2026-11-01";
    await appendPostLog({ date, slot: 1, platform: "facebook", status: "success", dry_run: false,
      attempts: 1, post_id: "offline-post", created_at: "2026-11-01T03:30:00Z" }, root);
    expect((await loadPostLog(date, root)).map(row => row.post_id)).toEqual(["offline-post"]);
  });
  it("never writes without the lock when Windows EPERM persists", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-denied-lock-"));
    roots.push(root);
    vi.mocked(open).mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EPERM" }));
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValue(10_200);
    const date = "2026-11-01";
    await expect(appendPostLog({ date, slot: 1, platform: "facebook", status: "success", dry_run: false,
      attempts: 1, post_id: "never-written", created_at: "2026-11-01T03:30:00Z" }, root)).rejects.toThrow("Timed out waiting for JSON log lock");
    expect(await loadPostLog(date, root)).toEqual([]);
  });
});
