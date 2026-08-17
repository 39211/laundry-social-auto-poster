import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeVideoCandidateManifest, type VideoCandidateManifestItem } from "../src/generateVideoCandidate";
import { loadGenerationAuthorization } from "../src/generationAuthorization";

// generation_authorized used to be two contradictory lies: the manifest
// hardcoded true, the retired preproduction contract always said false, and
// neither read anything the owner controlled. These tests pin the replacement:
// the owner's paid_video_budget grant in data/publishing-policy.json is the
// only source, and every unproven condition refuses authorization.

let root: string;

const DATE = "2026-08-20";

function validBudget(): Record<string, unknown> {
  return {
    authorized_by: "owner",
    authorized_at: "2026-08-18T09:00:00+08:00",
    expires_at: "2026-08-31T23:59:59+08:00",
    max_calls: 4,
    batch_concept: "daily-companion-video",
    tripped: false
  };
}

async function writePolicy(budget?: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(
    join(root, "data", "publishing-policy.json"),
    JSON.stringify({
      status: "active",
      ...(budget ? { paid_video_budget: budget } : {})
    }),
    "utf8"
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "generation-authorization-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("loadGenerationAuthorization fails closed", () => {
  it("refuses when data/publishing-policy.json does not exist", async () => {
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("publishing-policy.json");
  });

  it("refuses when the policy file is unreadable JSON", async () => {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "publishing-policy.json"), "{not json", "utf8");
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
  });

  it("refuses the live policy shape that has no paid_video_budget block", async () => {
    await writePolicy(undefined);
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("paid_video_budget");
  });

  it("refuses while the brake is tripped", async () => {
    await writePolicy({ ...validBudget(), tripped: true });
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("tripped");
  });

  it("treats a missing tripped field as tripped, not as clear", async () => {
    const budget = validBudget();
    delete budget.tripped;
    await writePolicy(budget);
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
  });

  it("refuses an anonymous grant", async () => {
    await writePolicy({ ...validBudget(), authorized_by: "" });
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("authorized_by");
  });

  it("refuses a date after the grant expires", async () => {
    await writePolicy({ ...validBudget(), expires_at: "2026-08-19T23:59:59+08:00" });
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("expired");
  });

  it("refuses a grant with no expiry at all", async () => {
    const budget = validBudget();
    delete budget.expires_at;
    await writePolicy(budget);
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("expires_at");
  });

  it("refuses a date before the grant was given", async () => {
    await writePolicy({ ...validBudget(), authorized_at: "2026-08-21T09:00:00+08:00" });
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
  });

  it("refuses a zero-call budget", async () => {
    await writePolicy({ ...validBudget(), max_calls: 0 });
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("max_calls");
  });

  it("authorizes a complete, untripped, unexpired grant", async () => {
    await writePolicy(validBudget());
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.authorized).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.max_calls).toBe(4);
    expect(result.used_calls).toBe(0);
  });
});

describe("the ledger spends the budget", () => {
  it("counts a completed call as its start and end lines", async () => {
    await writePolicy({ ...validBudget(), max_calls: 2 });
    await writeFile(
      join(root, "data", "paid-video-ledger.jsonl"),
      `${JSON.stringify({ phase: "start" })}\n${JSON.stringify({ phase: "end" })}\n`,
      "utf8"
    );
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.used_calls).toBe(1);
    expect(result.authorized).toBe(true);
  });

  it("counts a crashed call (start line only) as spent budget", async () => {
    await writePolicy({ ...validBudget(), max_calls: 1 });
    await writeFile(join(root, "data", "paid-video-ledger.jsonl"), `${JSON.stringify({ phase: "start" })}\n`, "utf8");
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.used_calls).toBe(1);
    expect(result.authorized).toBe(false);
    expect(result.blockers.join(" ")).toContain("exhausted");
  });

  it("refuses once the ledger reaches max_calls", async () => {
    await writePolicy({ ...validBudget(), max_calls: 2 });
    const lines = ["start", "end", "start", "end"].map((phase) => JSON.stringify({ phase })).join("\n");
    await writeFile(join(root, "data", "paid-video-ledger.jsonl"), `${lines}\n`, "utf8");
    const result = await loadGenerationAuthorization(DATE, root);
    expect(result.used_calls).toBe(2);
    expect(result.authorized).toBe(false);
  });
});

describe("the video candidate manifest publishes the read, not an assertion", () => {
  // 2026-07-29 is a committed campaign day whose slots carry video candidates,
  // the same date pickupDeliveryCampaign.test.ts builds its manifests from.
  const MANIFEST_DATE = "2026-07-29";

  it("marks every item blocked when no budget grant exists", async () => {
    const output = await writeVideoCandidateManifest(MANIFEST_DATE, root);
    const manifest = JSON.parse(await readFile(output, "utf8")) as VideoCandidateManifestItem[];
    expect(manifest.length).toBeGreaterThan(0);
    for (const item of manifest) {
      expect(item.generation_authorized).toBe(false);
      expect(item.handoff_status).toBe("blocked_unauthorized");
      expect(item.generation_authorization_source).toBe("data/publishing-policy.json#paid_video_budget");
      expect(item.generation_blockers.length).toBeGreaterThan(0);
    }
  });

  it("marks every item generation_ready under a valid grant", async () => {
    await writePolicy({
      ...validBudget(),
      authorized_at: "2026-07-01T09:00:00+08:00",
      expires_at: "2026-12-31T23:59:59+08:00"
    });
    const output = await writeVideoCandidateManifest(MANIFEST_DATE, root);
    const manifest = JSON.parse(await readFile(output, "utf8")) as VideoCandidateManifestItem[];
    expect(manifest.length).toBeGreaterThan(0);
    for (const item of manifest) {
      expect(item.generation_authorized).toBe(true);
      expect(item.handoff_status).toBe("generation_ready");
      expect(item.generation_blockers).toEqual([]);
    }
  });

  it("flips the same day from ready to blocked when the brake trips", async () => {
    const grant = {
      ...validBudget(),
      authorized_at: "2026-07-01T09:00:00+08:00",
      expires_at: "2026-12-31T23:59:59+08:00"
    };
    await writePolicy(grant);
    const readyPath = await writeVideoCandidateManifest(MANIFEST_DATE, root);
    const ready = JSON.parse(await readFile(readyPath, "utf8")) as VideoCandidateManifestItem[];
    expect(ready.every((item) => item.generation_authorized)).toBe(true);

    await writePolicy({ ...grant, tripped: true });
    const blockedPath = await writeVideoCandidateManifest(MANIFEST_DATE, root);
    const blocked = JSON.parse(await readFile(blockedPath, "utf8")) as VideoCandidateManifestItem[];
    expect(blocked.every((item) => item.generation_authorized === false)).toBe(true);
    expect(blocked.every((item) => item.handoff_status === "blocked_unauthorized")).toBe(true);
  });
});
