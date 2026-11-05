import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { changedSinceApproval, slotFingerprint } from "../src/autoApproveGates";
import { generateDailyContent } from "../src/generateDailyContent";
import * as generateVideo from "../src/generateVideo";
import * as imageProvenance from "../src/imageProvenance";
import * as imageStamp from "../src/imageStamp";
import { loadApprovalLog, loadDailyContent, writeDailyContent, writeImageSources, writePostLog } from "../src/logging";
import * as mediaAssets from "../src/mediaAssets";
import type { PostLogEntry } from "../src/types";

const IMG = "output/images/2026-11-06/slot1.png";
const slot = { slot: 1, topic: "白鞋鞋面發黃", local_image_path: IMG, status: "pending" };

describe("autoApproveGates helpers", () => {
  it("the fingerprint formula is the one the sidecar and approvePost already use", () => {
    const legacy = createHash("sha256").update(JSON.stringify(slot)).digest("hex");
    expect(slotFingerprint(slot)).toBe(legacy);
  });

  it("an unchanged approved slot is not re-judged", async () => {
    const changed = await changedSinceApproval(slot, [IMG], slotFingerprint(slot), { [IMG]: "aaa" }, async () => "aaa");
    expect(changed).toBe(false);
  });

  it("a calendar slot rewritten after approval is re-judged", async () => {
    const rewritten = { ...slot, topic: "羽絨被結塊" };
    const changed = await changedSinceApproval(rewritten, [IMG], slotFingerprint(slot), { [IMG]: "aaa" }, async () => "aaa");
    expect(changed).toBe(true);
  });

  it("image bytes replaced after approval are re-judged", async () => {
    const changed = await changedSinceApproval(slot, [IMG], slotFingerprint(slot), { [IMG]: "aaa" }, async () => "bbb");
    expect(changed).toBe(true);
  });

  it("an image that can no longer be hashed is re-judged", async () => {
    const changed = await changedSinceApproval(slot, [IMG], slotFingerprint(slot), { [IMG]: "aaa" }, async () => undefined);
    expect(changed).toBe(true);
  });

  it("an empty digest snapshot does not count as a valid snapshot for an image slot", async () => {
    const changed = await changedSinceApproval(slot, [IMG], slotFingerprint(slot), {}, async () => "aaa");
    expect(changed).toBe(true);
  });

  it("a missing fingerprint or missing snapshot is left to the caller's missing-snapshot rule", async () => {
    expect(await changedSinceApproval(slot, [IMG], undefined, { [IMG]: "aaa" }, async () => "aaa")).toBe(false);
    expect(await changedSinceApproval(slot, [IMG], slotFingerprint(slot), undefined, async () => "zzz")).toBe(false);
  });

  it("a slot with no images only depends on the calendar fingerprint", async () => {
    const reel = { slot: 2, media_type: "reel", topic: "鞋子" };
    expect(await changedSinceApproval(reel, [], slotFingerprint(reel), {}, async () => undefined)).toBe(false);
    expect(await changedSinceApproval({ ...reel, topic: "包包" }, [], slotFingerprint(reel), {}, async () => undefined)).toBe(true);
  });
});

// A day in a temp root whose only open questions are the approval gates under
// test: the calendar comes from generateDailyContent, the policy covers it, and
// the image/video evidence gates are stubbed (a temp root holds no media).
async function prepareDay(date: string): Promise<{ root: string; slots: number[] }> {
  vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
  vi.stubEnv("SXJ_OWNER_RULES", "report");
  const root = await mkdtemp(join(tmpdir(), "laundry-autoappr-gates-"));
  await generateDailyContent({ date, root, force: true });
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error("fixture calendar missing");
  const slots = content.slots.map((item) => item.slot);
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(
    join(root, "data", "publishing-policy.json"),
    JSON.stringify({
      status: "active",
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      platforms: ["facebook", "instagram"],
      slots: slots.map((item) => ({ slot: item }))
    }),
    "utf8"
  );
  vi.spyOn(mediaAssets, "imageAssetsForSlot").mockReturnValue([]);
  vi.spyOn(imageStamp, "imageEvidenceFailures").mockResolvedValue([]);
  vi.spyOn(imageProvenance, "inspectDailyImageProvenance").mockResolvedValue({
    with_manifest: 0,
    without_manifest: 0,
    consistent: true
  } as unknown as Awaited<ReturnType<typeof imageProvenance.inspectDailyImageProvenance>>);
  vi.spyOn(generateVideo, "validatePublishableReel").mockResolvedValue(undefined);
  return { root, slots };
}

async function rewriteSlotCaption(date: string, root: string, slotNumber: number, suffix: string): Promise<void> {
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error("calendar missing");
  const target = content.slots.find((item) => item.slot === slotNumber);
  if (!target) throw new Error("slot missing");
  target.facebook_caption = `${target.facebook_caption}${suffix}`;
  await writeDailyContent(content, root);
}

async function storedFingerprints(date: string, root: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(root, "data", "approved-log", `${date}.fingerprints.json`), "utf8")) as Record<
    string,
    string
  >;
}

describe("autoApprove: empty calendar (H2 audit finding)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // The audit feared `"slots": []` would fall through to "already approved".
  // loadDailyContent already refuses a calendar with fewer than 2 slots, so
  // the run fails loudly (exit 1) instead; this pins that protection.
  it("a calendar with no slots fails the run, it never reads as 'already approved'", async () => {
    const date = "2026-05-26";
    const { root } = await prepareDay(date);
    const content = await loadDailyContent(date, root);
    if (!content) throw new Error("calendar missing");
    content.slots = [];
    await writeDailyContent(content, root);

    await expect(autoApprove({ date, root })).rejects.toThrow(/expected 2 or 3 slots/);
  });
});

describe("autoApprove: content changed after approval (H1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("an unchanged approved day stays quiet (already_approved)", async () => {
    const date = "2026-05-27";
    const { root, slots } = await prepareDay(date);
    const first = await autoApprove({ date, root });
    expect(first.approved).toBe(true);
    expect([...first.approved_slots].sort()).toEqual([...slots].sort());

    const second = await autoApprove({ date, root });
    expect(second.already_approved).toBe(true);
    expect(second.blockers).toEqual([]);
  });

  it("a slot rewritten after approval is judged again and re-approved with a fresh fingerprint", async () => {
    const date = "2026-05-28";
    const { root, slots } = await prepareDay(date);
    await autoApprove({ date, root });
    const before = await storedFingerprints(date, root);
    const target = slots[0] as number;

    await rewriteSlotCaption(date, root, target, "（重寫）");
    const result = await autoApprove({ date, root });

    expect(result.already_approved).toBe(false);
    expect(result.approved_slots).toEqual([target]);
    const after = await storedFingerprints(date, root);
    const rewritten = (await loadDailyContent(date, root))?.slots.find((item) => item.slot === target);
    expect(after[String(target)]).toBe(slotFingerprint(rewritten));
    expect(after[String(target)]).not.toBe(before[String(target)]);
    // the slot nobody touched keeps its approval untouched
    for (const other of slots.filter((n) => n !== target)) expect(after[String(other)]).toBe(before[String(other)]);
  });

  it("a rewritten slot that now fails a gate raises a blocker instead of a silent 'already approved'", async () => {
    const date = "2026-05-29";
    const { root, slots } = await prepareDay(date);
    await autoApprove({ date, root });
    const target = slots[0] as number;

    await rewriteSlotCaption(date, root, target, "（重寫）");
    vi.mocked(imageStamp.imageEvidenceFailures).mockResolvedValue(["images do not prove this caption"]);
    const result = await autoApprove({ date, root });

    expect(result.already_approved).toBe(false);
    expect(result.approved_slots).not.toContain(target);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("a slot that already went out on every platform is not re-judged when its files change", async () => {
    const date = "2026-05-30";
    const { root, slots } = await prepareDay(date);
    await autoApprove({ date, root });
    const live = (n: number, platform: "facebook" | "instagram"): PostLogEntry => ({
      date,
      slot: n,
      platform,
      status: "success",
      dry_run: false,
      attempts: 1,
      created_at: "2026-05-30T04:00:00.000Z"
    });
    await writePostLog(
      date,
      slots.flatMap((n) => [live(n, "facebook"), live(n, "instagram")]),
      root
    );

    await rewriteSlotCaption(date, root, slots[0] as number, "（發佈後改）");
    const result = await autoApprove({ date, root });

    expect(result.already_approved).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// One real (header-only) PNG for the first slot, with its source record, so the
// image gates and the digest snapshot run against bytes on disk.
async function addImageToFirstSlot(
  date: string,
  root: string,
  slotNumber: number
): Promise<{ relative: string; absolute: string }> {
  const relative = `output/images/${date}/slot${slotNumber}.png`;
  const absolute = join(root, ...relative.split("/"));
  await mkdir(join(root, "output", "images", date), { recursive: true });
  await writeFile(absolute, Buffer.concat([PNG_HEADER, Buffer.from("original-bytes")]));
  await writeImageSources(
    date,
    [{ date, slot: slotNumber, source: "gpt", image_path: relative, marked_at: "2026-05-01T00:00:00.000Z" }],
    root
  );
  vi.mocked(mediaAssets.imageAssetsForSlot).mockImplementation(((target: { slot: number }) =>
    target.slot === slotNumber
      ? [{ slide: 1, image_prompt: "p", local_image_path: relative, public_image_url: "https://example.test/x.png" }]
      : []) as unknown as typeof mediaAssets.imageAssetsForSlot);
  return { relative, absolute };
}

describe("autoApprove: image bytes (H1 / M3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("image bytes replaced after approval are judged again and the digest snapshot is rebuilt", async () => {
    const date = "2026-05-20";
    const { root, slots } = await prepareDay(date);
    const target = slots[0] as number;
    const { relative, absolute } = await addImageToFirstSlot(date, root, target);

    const first = await autoApprove({ date, root });
    expect(first.blockers).toEqual([]);
    expect(first.approved_slots).toContain(target);
    const digestBefore = (await imageStamp.loadApprovedImageDigests(root, date))?.[String(target)]?.[relative];
    expect(digestBefore).toBeTruthy();

    const quiet = await autoApprove({ date, root });
    expect(quiet.already_approved).toBe(true);

    await writeFile(absolute, Buffer.concat([PNG_HEADER, Buffer.from("regenerated-bytes")]));
    const result = await autoApprove({ date, root });

    expect(result.already_approved).toBe(false);
    expect(result.approved_slots).toEqual([target]);
    const digestAfter = (await imageStamp.loadApprovedImageDigests(root, date))?.[String(target)]?.[relative];
    expect(digestAfter).toBeTruthy();
    expect(digestAfter).not.toBe(digestBefore);
  });

  it("an image that cannot be hashed at approval is refused, never approved on an empty snapshot", async () => {
    const date = "2026-05-19";
    const { root, slots } = await prepareDay(date);
    const target = slots[0] as number;
    await addImageToFirstSlot(date, root, target);
    vi.spyOn(imageStamp, "hashImageFile").mockResolvedValue(undefined);

    const result = await autoApprove({ date, root });

    expect(result.approved_slots).not.toContain(target);
    expect(result.blockers.join(" | ")).toContain("could not hash image");
    const approvals = await loadApprovalLog(date, root);
    expect(approvals.filter((entry) => entry.slot === target)).toEqual([]);
  });
});

describe("autoApprove: image provenance is report-only (M4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("a provenance inspection error does not abort the run", async () => {
    const date = "2026-05-31";
    const { root, slots } = await prepareDay(date);
    vi.mocked(imageProvenance.inspectDailyImageProvenance).mockRejectedValue(new Error("bad manifest"));

    const result = await autoApprove({ date, root, dryRun: true });

    expect(result.approved).toBe(true);
    expect([...result.approved_slots].sort()).toEqual([...slots].sort());
    expect(result.ai_provenance.consistent).toBe(false);
    const note = result.checks.find((c) => c.name === "ai_provenance_inspection");
    expect(note?.ok).toBe(true);
    expect(note?.detail).toContain("bad manifest");
  });
});
