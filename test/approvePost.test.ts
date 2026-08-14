import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadApprovalLog } from "../src/logging";

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

    vi.unstubAllEnvs();
  });
});
