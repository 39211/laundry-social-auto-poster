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
      root
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
});
