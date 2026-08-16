import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadApprovedImageDigests } from "../src/imageStamp";
import { hasApprovedPost, hasPublishableApproval, loadApprovalLog } from "../src/logging";
import type { ApprovalLogEntry } from "../src/types";
import { pausePath } from "../src/pause";

describe("approvePost", () => {
  it("writes platform approval records without posting", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    const root = await mkdtemp(join(tmpdir(), "laundry-social-approval-"));
    await generateDailyContent({ date: "2026-05-15", root, force: true });

    const entries = await approvePost({
      date: "2026-05-15",
      slot: 1,
      platforms: ["facebook", "instagram"],
      approvedBy: "Codex-Auto",
      note: "Auto-reviewed medium-depth launch baseline",
      root,
      // No images exist in this fixture, and manual approval refuses unproven
      // images now. The override is what the second test below pins down.
      force: true
    });

    expect(entries.map((entry) => entry.platform)).toEqual(["facebook", "instagram"]);
    expect(entries.every((entry) => entry.status === "approved")).toBe(true);

    const log = await loadApprovalLog("2026-05-15", root);
    expect(log).toHaveLength(2);
    expect(log.map((entry) => entry.platform)).toEqual(["facebook", "instagram"]);
    expect(await readFile(join(root, "data", "approved-log", "2026-05-15.json"), "utf8")).toContain(
      "Auto-reviewed medium-depth launch baseline"
    );

    vi.unstubAllEnvs();
  });

  // Manual approval wrote consent with no image checks whatsoever, which made
  // it a complete way around the gate unattended approval exists to enforce.
  it("refuses unproven images, and records the override when forced", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    const root = await mkdtemp(join(tmpdir(), "laundry-approval-refuse-"));
    await generateDailyContent({ date: "2026-05-16", root, force: true });

    const attempt = approvePost({
      date: "2026-05-16",
      slot: 1,
      platforms: ["facebook"],
      approvedBy: "Owner",
      root
    });
    await expect(attempt).rejects.toThrow(/do not prove they belong to this caption/);
    // A refusal must leave nothing a later publish run could read as consent.
    expect(await loadApprovalLog("2026-05-16", root)).toHaveLength(0);
    expect(await loadApprovedImageDigests(root, "2026-05-16")).toBeUndefined();

    const forced = await approvePost({
      date: "2026-05-16",
      slot: 1,
      platforms: ["facebook"],
      approvedBy: "Owner",
      root,
      force: true
    });
    // An override that leaves no trace is indistinguishable from a clean pass,
    // and a trace only in prose is one no code can act on.
    expect(forced[0]?.note).toContain("FORCED");
    expect(forced[0]?.forced).toBe(true);
    expect(forced[0]?.forced_reasons?.length).toBeGreaterThan(0);
    expect(forced[0]?.status).toBe("approved");
    const log = await loadApprovalLog("2026-05-16", root);
    expect(hasApprovedPost(log, 1, "facebook")).toBe(true);
    expect(hasPublishableApproval(log, 1, "facebook")).toBe(false);

    vi.unstubAllEnvs();
  });

  it("hasApprovedPost still ignores forced; hasPublishableApproval does not", () => {
    const base = {
      date: "2026-05-16",
      slot: 1,
      platform: "facebook" as const,
      status: "approved" as const,
      approved_by: "Owner",
      created_at: "2026-05-16T00:00:00.000Z"
    };
    const clean: ApprovalLogEntry[] = [base];
    const forced: ApprovalLogEntry[] = [{ ...base, forced: true }];

    expect(hasApprovedPost(clean, 1, "facebook")).toBe(true);
    expect(hasApprovedPost(forced, 1, "facebook")).toBe(true);
    expect(hasPublishableApproval(clean, 1, "facebook")).toBe(true);
    expect(hasPublishableApproval(forced, 1, "facebook")).toBe(false);
  });

  it("refuses to write consent while paused, even when forced", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    const root = await mkdtemp(join(tmpdir(), "laundry-approval-paused-"));
    await generateDailyContent({ date: "2026-05-17", root, force: true });
    await writeFile(
      pausePath(root),
      JSON.stringify({ reason: "老闆說先停", since: "2026-05-17T01:00:00Z", paused_by: "owner" }),
      "utf8"
    );

    const attempt = approvePost({
      date: "2026-05-17",
      slot: 1,
      platforms: ["facebook"],
      approvedBy: "Owner",
      root,
      force: true
    });
    await expect(attempt).rejects.toThrow("發布已被暫停(2026-05-17T01:00:00Z 由 owner):老闆說先停");
    expect(await loadApprovalLog("2026-05-17", root)).toHaveLength(0);
    expect(await loadApprovedImageDigests(root, "2026-05-17")).toBeUndefined();

    vi.unstubAllEnvs();
  });

  it("writes an image-digest snapshot for the slot after a forced approval", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    const root = await mkdtemp(join(tmpdir(), "laundry-approval-digest-"));
    await generateDailyContent({ date: "2026-05-18", root, force: true });

    await approvePost({
      date: "2026-05-18",
      slot: 1,
      platforms: ["facebook"],
      approvedBy: "Owner",
      root,
      force: true
    });

    const snapshot = await loadApprovedImageDigests(root, "2026-05-18");
    expect(snapshot).toBeDefined();
    expect(snapshot).toHaveProperty("1");
    // No images exist in this fixture, but the slot key must still be present
    // so publish sees a snapshot instead of a pre-snapshot day.
    expect(snapshot!["1"]).toEqual({});

    vi.unstubAllEnvs();
  });

  it("merges a later slot into the day's digest map without wiping an earlier one", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    const root = await mkdtemp(join(tmpdir(), "laundry-approval-digest-merge-"));
    await generateDailyContent({ date: "2026-05-19", root, force: true });

    await approvePost({
      date: "2026-05-19",
      slot: 1,
      platforms: ["facebook"],
      approvedBy: "Owner",
      root,
      force: true
    });
    await approvePost({
      date: "2026-05-19",
      slot: 2,
      platforms: ["facebook"],
      approvedBy: "Owner",
      root,
      force: true
    });

    const snapshot = await loadApprovedImageDigests(root, "2026-05-19");
    expect(snapshot).toBeDefined();
    expect(snapshot).toHaveProperty("1");
    expect(snapshot).toHaveProperty("2");

    vi.unstubAllEnvs();
  });
});
