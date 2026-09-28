import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadApprovalLog, loadDailyContent, writeApprovalLog } from "../src/logging";
import { loadApprovedImageDigests } from "../src/imageStamp";
import { pausePath } from "../src/pause";
import { postCurrentSlot } from "../src/postCurrentSlot";
import type { ApprovalLogEntry, DailySlot } from "../src/types";

const DATE = "2026-10-09";
const NOW = new Date("2026-10-09T11:30:00+08:00");
const noNetwork = (() => { throw new Error("NETWORK_SENTINEL"); }) as typeof fetch;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "approve-fingerprint-"));
  await generateDailyContent({ date: DATE, root, force: true });
  const content = await loadDailyContent(DATE, root);
  if (!content || content.slots.length < 2) throw new Error("fixture needs two slots");
  return { root, slots: content.slots };
}

function fingerprint(slot: DailySlot): string {
  return createHash("sha256").update(JSON.stringify(slot)).digest("hex");
}

function fpPath(root: string): string {
  return join(root, "data", "approved-log", `${DATE}.fingerprints.json`);
}

function digestPath(root: string): string {
  return join(root, "data", "approved-log", `${DATE}.image-digests.json`);
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function approval(slot: number, platform: "facebook" | "instagram"): ApprovalLogEntry {
  return {
    date: DATE, slot, platform, status: "approved", approved_by: "fixture",
    created_at: "2026-10-06T13:40:00.000Z"
  };
}

async function approve(root: string, slot: number, platforms: Array<"facebook" | "instagram"> = ["facebook"]) {
  return approvePost({ date: DATE, slot, platforms, approvedBy: "Owner", root, force: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("approvePost fingerprints", () => {
  it("T1 adds manual morning approval to an existing evening fingerprint and passes that publish gate", async () => {
    const { root, slots } = await fixture();
    const morning = slots.find((item) => item.slot === 1)!;
    const evening = slots.find((item) => item.slot === 2)!;
    const eveningHash = fingerprint(evening);
    await writeFile(fpPath(root), JSON.stringify({ "2": eveningHash }), "utf8");
    await writeApprovalLog(DATE, [approval(2, "facebook"), approval(2, "instagram")], root);

    vi.stubEnv("DRY_RUN", "false");
    vi.stubEnv("META_ACCESS_TOKEN", "ci-test-placeholder-token");
    vi.stubEnv("FB_PAGE_ID", "000000000000000");
    vi.stubEnv("IG_USER_ID", "000000000000000");
    vi.stubEnv("VERIFY_PUBLIC_IMAGE_URL", "false");
    vi.stubGlobal("fetch", noNetwork);
    const post = () => postCurrentSlot({ date: DATE, slot: 1, root, now: NOW, fetchImpl: noNetwork });
    await expect(post()).rejects.toThrow(/no approval fingerprint/);

    await approve(root, 1);
    let rejection: unknown;
    try { await post(); } catch (error) { rejection = error; }
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).not.toMatch(/approval fingerprint|fingerprint mismatch/);
    expect((rejection as Error).message).toMatch(/images changed after approval/);
    const map = JSON.parse(await readFile(fpPath(root), "utf8")) as Record<string, string>;
    expect(map).toEqual({ "1": fingerprint(morning), "2": eveningHash });
  });

  it("T2 creates only the approved slot fingerprint on a new day", async () => {
    const { root, slots } = await fixture();
    await approve(root, 1);
    expect(JSON.parse(await readFile(fpPath(root), "utf8"))).toEqual({ "1": fingerprint(slots.find((s) => s.slot === 1)!) });
  });

  it("T3 leaves a legacy day without a fingerprint but still writes consent and image digests", async () => {
    const { root } = await fixture();
    await writeApprovalLog(DATE, [approval(2, "facebook")], root);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    await approve(root, 1);
    expect(await exists(fpPath(root))).toBe(false);
    expect(stderr).toHaveBeenCalledWith(
      `approve-post: ${DATE} has approvals without a fingerprint file (slots 2); leaving it as a legacy day so those slots stay publishable.`
    );
    expect((await loadApprovalLog(DATE, root)).map((e) => e.slot)).toEqual([1, 2]);
    expect((await loadApprovedImageDigests(root, DATE))?.["1"]).toEqual({});
  });

  it.each(["[]", "{壞掉的 json"])("T4 refuses malformed fingerprint %s before any write", async (raw) => {
    const { root } = await fixture();
    await writeFile(fpPath(root), raw, "utf8");
    const beforeLog = await loadApprovalLog(DATE, root);
    const beforeDigest = await exists(digestPath(root));
    await expect(approve(root, 1)).rejects.toThrow(/2026-10-09\.fingerprints\.json/);
    expect(await readFile(fpPath(root), "utf8")).toBe(raw);
    expect(await loadApprovalLog(DATE, root)).toEqual(beforeLog);
    expect(await exists(digestPath(root))).toBe(beforeDigest);
  });

  it("T5 merges approvals made in slot 2 then slot 1 order", async () => {
    const { root, slots } = await fixture();
    await approve(root, 2);
    await approve(root, 1);
    expect(JSON.parse(await readFile(fpPath(root), "utf8"))).toEqual({
      "1": fingerprint(slots.find((s) => s.slot === 1)!),
      "2": fingerprint(slots.find((s) => s.slot === 2)!)
    });
  });

  it("T6 keeps one fingerprint when two platforms approve the same slot separately", async () => {
    const { root, slots } = await fixture();
    await approve(root, 1, ["facebook"]);
    const before = await readFile(fpPath(root), "utf8");
    await approve(root, 1, ["instagram"]);
    expect(await readFile(fpPath(root), "utf8")).toBe(before);
    expect(JSON.parse(before)).toEqual({ "1": fingerprint(slots.find((s) => s.slot === 1)!) });
  });

  it("T7 pause rejects before creating or changing fingerprints", async () => {
    const { root } = await fixture();
    await writeFile(pausePath(root), JSON.stringify({ reason: "停", since: "2026-10-09T00:00:00Z", paused_by: "owner" }), "utf8");
    await expect(approve(root, 1)).rejects.toThrow(/發布已被暫停/);
    expect(await exists(fpPath(root))).toBe(false);
    const original = '{"2":"preserve"}';
    await writeFile(fpPath(root), original, "utf8");
    await expect(approve(root, 1)).rejects.toThrow(/發布已被暫停/);
    expect(await readFile(fpPath(root), "utf8")).toBe(original);
    expect(await loadApprovalLog(DATE, root)).toEqual([]);
    expect(await exists(digestPath(root))).toBe(false);
  });
});
