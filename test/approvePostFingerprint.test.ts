import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvePost } from "../src/approvePost";
import { generateDailyContent } from "../src/generateDailyContent";
import { loadApprovalLog, loadDailyContent, writeApprovalLog, writeDailyContent } from "../src/logging";
import { loadApprovedImageDigests } from "../src/imageStamp";
import { markImageSource } from "../src/markImageSource";
import { imageAssetsForSlot } from "../src/mediaAssets";
import { pausePath } from "../src/pause";
import { postCurrentSlot } from "../src/postCurrentSlot";
import type { ApprovalLogEntry, DailySlot } from "../src/types";

const DATE = "2026-10-09";
const NOW = new Date("2026-10-09T11:30:00+08:00");
const noNetwork = (() => { throw new Error("NETWORK_SENTINEL"); }) as typeof fetch;
const appendFailure = vi.hoisted(() => ({ enabled: false }));
vi.mock("../src/logging", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/logging")>();
  return {
    ...original,
    appendApprovalLog: async (...args: Parameters<typeof original.appendApprovalLog>) => {
      if (appendFailure.enabled) throw new Error("APPEND_SENTINEL");
      return original.appendApprovalLog(...args);
    }
  };
});

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

function logPath(root: string): string {
  return join(root, "data", "approved-log", `${DATE}.json`);
}

async function seedImageEvidence(root: string, slot: DailySlot): Promise<void> {
  const assets = imageAssetsForSlot(slot);
  await mkdir(join(root, "data", "image-prompts"), { recursive: true });
  await writeFile(join(root, "data", "image-prompts", `${DATE}.json`), JSON.stringify(
    assets.map((asset) => ({
      slot: slot.slot, target_path: asset.local_image_path, topic: slot.topic, prompt: asset.image_prompt
    }))
  ), "utf8");
  for (const asset of assets) {
    const image = join(root, ...asset.local_image_path.split("/"));
    await mkdir(join(image, ".."), { recursive: true });
    await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, slot.slot, asset.slide]));
    await markImageSource({ root, date: DATE, slot: slot.slot, source: "gpt-image-2", imagePath: asset.local_image_path });
  }
}

async function healthyFixture() {
  const data = await fixture();
  const slot = data.slots.find((item) => item.slot === 1)!;
  await seedImageEvidence(data.root, slot);
  await writeFile(fpPath(data.root), JSON.stringify({ "2": fingerprint(data.slots.find((item) => item.slot === 2)!) }), "utf8");
  return { ...data, slot };
}

async function rewriteCaption(root: string): Promise<DailySlot> {
  const content = await loadDailyContent(DATE, root);
  if (!content) throw new Error("missing calendar");
  const target = content.slots.find((item) => item.slot === 1)!;
  target.facebook_caption += " B";
  target.instagram_caption += " B";
  await writeDailyContent(content, root);
  const changed = await loadDailyContent(DATE, root);
  return changed!.slots.find((item) => item.slot === 1)!;
}

async function changedApprovedFixture() {
  const { root } = await healthyFixture();
  await approvePost({ date: DATE, slot: 1, platforms: ["facebook", "instagram"], approvedBy: "Owner", root });
  const changed = await rewriteCaption(root);
  return { root, changed };
}

async function approvalFiles(root: string): Promise<Buffer[]> {
  return Promise.all([fpPath(root), logPath(root), digestPath(root)].map((path) => readFile(path)));
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
  appendFailure.enabled = false;
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

  it("T4 refuses EISDIR fingerprint before consent or snapshot", async () => {
    const { root } = await fixture();
    await mkdir(fpPath(root));
    await expect(approve(root, 1)).rejects.toThrow(/2026-10-09\.fingerprints\.json/);
    expect(await exists(digestPath(root))).toBe(false);
    expect(await loadApprovalLog(DATE, root)).toEqual([]);
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

  it("T8 non-forced approval reaches the publish fetch", async () => {
    const { root, slot, slots } = await healthyFixture();
    const entries = await approvePost({ date: DATE, slot: 1, platforms: ["facebook", "instagram"], approvedBy: "Owner", root });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => !entry.forced)).toBe(true);
    expect(JSON.parse(await readFile(fpPath(root), "utf8"))).toEqual({
      "1": fingerprint(slot), "2": fingerprint(slots.find((item) => item.slot === 2)!)
    });
    vi.stubEnv("META_ACCESS_TOKEN", "ci-test-placeholder-token");
    vi.stubEnv("FB_PAGE_ID", "000000000000000");
    vi.stubEnv("IG_USER_ID", "000000000000000");
    vi.stubGlobal("fetch", noNetwork);
    await expect(postCurrentSlot({
      date: DATE, slot: 1, root, now: NOW, dryRun: false,
      verifyPublicImageUrl: true, fetchImpl: noNetwork
    })).rejects.toThrow(/NETWORK_SENTINEL/);
    // The Meta call wraps a transport error as an unknown publish outcome;
    // reaching that wrapper also proves both platform approval checks passed.
    await expect(postCurrentSlot({
      date: DATE, slot: 1, root, now: NOW, dryRun: false,
      verifyPublicImageUrl: false, fetchImpl: noNetwork
    })).rejects.toThrow(/Facebook photo publish response was lost/);
  });

  it("T9a rejects partial re-approval with changed fingerprint without writes", async () => {
    const { root } = await changedApprovedFixture();
    const before = await approvalFiles(root);
    await expect(approvePost({ date: DATE, slot: 1, platforms: ["facebook"], approvedBy: "Owner", root }))
      .rejects.toThrow(/re-approve every platform/);
    expect(await approvalFiles(root)).toEqual(before);
  });

  it("T9b rejects partial re-approval when this slot key is absent without writes", async () => {
    const { root } = await changedApprovedFixture();
    const map = JSON.parse(await readFile(fpPath(root), "utf8"));
    delete map["1"];
    await writeFile(fpPath(root), JSON.stringify(map), "utf8");
    const before = await approvalFiles(root);
    await expect(approvePost({ date: DATE, slot: 1, platforms: ["facebook"], approvedBy: "Owner", root }))
      .rejects.toThrow(/re-approve every platform/);
    expect(await approvalFiles(root)).toEqual(before);
  });

  it("T9c re-approves both platforms for changed content", async () => {
    const { root, changed } = await changedApprovedFixture();
    await approvePost({ date: DATE, slot: 1, platforms: ["facebook", "instagram"], approvedBy: "Owner", root });
    expect(JSON.parse(await readFile(fpPath(root), "utf8"))["1"]).toBe(fingerprint(changed));
  });

  it("T9d force cannot bypass partial re-approval protection", async () => {
    const { root } = await changedApprovedFixture();
    const before = await approvalFiles(root);
    await expect(approvePost({ date: DATE, slot: 1, platforms: ["facebook"], approvedBy: "Owner", root, force: true }))
      .rejects.toThrow(/re-approve every platform/);
    expect(await approvalFiles(root)).toEqual(before);
  });

  it("T9 ignores a forced approval on another platform", async () => {
    const { root } = await healthyFixture();
    await writeApprovalLog(DATE, [{ ...approval(1, "instagram"), forced: true }], root);
    await rewriteCaption(root);
    const entries = await approvePost({ date: DATE, slot: 1, platforms: ["facebook"], approvedBy: "Owner", root });
    expect(entries[0]!.forced).toBeUndefined();
  });

  it("T10 creates a fingerprint when other slots have only forced approval", async () => {
    const { root, slots } = await fixture();
    await writeApprovalLog(DATE, [{ ...approval(2, "instagram"), forced: true }], root);
    await approve(root, 1);
    expect(JSON.parse(await readFile(fpPath(root), "utf8"))).toEqual({ "1": fingerprint(slots.find((s) => s.slot === 1)!) });
  });

  it("T10 leaves a legacy day for another slot's non-forced approval", async () => {
    const { root } = await fixture();
    await writeApprovalLog(DATE, [approval(2, "instagram")], root);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    await approve(root, 1);
    expect(await exists(fpPath(root))).toBe(false);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("slots 2"));
  });

  it("T11 appending consent fails before the fingerprint is written", async () => {
    const { root, slots } = await fixture();
    const original = JSON.stringify({ "2": fingerprint(slots.find((s) => s.slot === 2)!) });
    await writeFile(fpPath(root), original, "utf8");
    appendFailure.enabled = true;
    await expect(approve(root, 1)).rejects.toThrow(/APPEND_SENTINEL/);
    expect(await readFile(fpPath(root), "utf8")).toBe(original);
  });
});
