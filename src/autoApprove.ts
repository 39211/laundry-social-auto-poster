import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { approvePost } from "./approvePost";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { hasApprovedPost, loadApprovalLog, loadDailyContent, loadImageSources } from "./logging";
import { inspectDailyImageProvenance } from "./imageProvenance";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { Platform } from "./types";

// Unattended approval for the daily package. Every gate below is objective, and
// anything unproven stops the run instead of approving: an approval written here
// leads directly to a public post. The owner reviews published output rather
// than each package, so the run reports what it did and why.
//
// data/publishing-policy.json was previously only a rule for a human or agent to
// honour. Nothing unattended may rely on that, so it is enforced here.

const PLATFORMS: Platform[] = ["facebook", "instagram"];

interface PublishingPolicy {
  status?: string;
  start_date?: string;
  end_date?: string;
  platforms?: string[];
  slots?: Array<{ slot: number }>;
}

export interface AutoApproveResult {
  date: string;
  approved: boolean;
  already_approved: boolean;
  approved_slots: number[];
  blockers: string[];
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  // Reported, never gated: whether the day's images still carry the image
  // model's C2PA manifest decides whether Meta shows its "AI info" label, and
  // a resize can drop it without anyone choosing to. Visibility, not a verdict.
  ai_provenance: { with_manifest: number; without_manifest: number; consistent: boolean };
}

async function loadPolicy(root: string): Promise<PublishingPolicy | undefined> {
  try {
    return JSON.parse(await readFile(join(root, "data", "publishing-policy.json"), "utf8")) as PublishingPolicy;
  } catch {
    return undefined;
  }
}

export async function autoApprove(
  options: { date?: string; root?: string; approvedBy?: string; dryRun?: boolean } = {}
): Promise<AutoApproveResult> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const date = options.date || getZonedDateParts(new Date(), config.timezone).date;

  const checks: AutoApproveResult["checks"] = [];
  const blockers: string[] = [];
  // Detail is written to explain a failure, so attaching it to a passing check
  // would print "outside 2026-07-18..2026-10-08" next to an OK and read as broken.
  const record = (name: string, ok: boolean, failureDetail?: string) => {
    checks.push(ok ? { name, ok } : { name, ok, detail: failureDetail });
    if (!ok) blockers.push(failureDetail ? `${name}: ${failureDetail}` : name);
  };

  const policy = await loadPolicy(root);
  if (!policy) {
    record("publishing_policy", false, "data/publishing-policy.json is missing or unreadable.");
  } else {
    record("policy_active", policy.status === "active", `status=${policy.status ?? "unset"}`);
    const inWindow = Boolean(
      policy.start_date && policy.end_date && date >= policy.start_date && date <= policy.end_date
    );
    record("policy_covers_date", inWindow, `${date} outside ${policy.start_date}..${policy.end_date}`);
    record(
      "policy_covers_platforms",
      PLATFORMS.every((platform) => policy.platforms?.includes(platform)),
      `platforms=${policy.platforms?.join(",") ?? "none"}`
    );
  }

  const content = await loadDailyContent(date, root);
  // A calendar copied into the wrong date's path must not be approved as that
  // date: the file's own date field is the identity, not the filename (luna).
  if (content && (content as { date?: string }).date && (content as { date?: string }).date !== date) {
    record("daily_content_date", false, `calendar says ${(content as { date?: string }).date}, expected ${date}`);
    return {
      date,
      approved: false,
      already_approved: false,
      approved_slots: [],
      blockers,
      checks,
      ai_provenance: { with_manifest: 0, without_manifest: 0, consistent: true }
    };
  }
  if (!content) {
    record("daily_content", false, `No content calendar for ${date}.`);
    return {
      date,
      approved: false,
      already_approved: false,
      approved_slots: [],
      blockers,
      checks,
      ai_provenance: { with_manifest: 0, without_manifest: 0, consistent: true }
    };
  }
  record("daily_content", true);

  const provenance = await inspectDailyImageProvenance(date, root);
  const aiProvenance = {
    with_manifest: provenance.with_manifest,
    without_manifest: provenance.without_manifest,
    consistent: provenance.consistent
  };

  const policySlots = policy?.slots?.map((item) => item.slot) ?? [];
  for (const slot of content.slots) {
    record(
      `policy_covers_slot_${slot.slot}`,
      policySlots.includes(slot.slot),
      `slot ${slot.slot} not listed in policy`
    );
  }

  // Asset readiness is judged per slot. The day-level check made approval
  // all-or-nothing, and one broken slot then cost the whole day: on
  // 2026-08-01 a morning regeneration rewrote slot 1's carousel while slot 2
  // held a reviewed, published-ready Reel — and the Reel would have been
  // blocked by slot 1's missing slides. Policy gates above stay day-level:
  // no policy, nothing publishes. Asset gates below block only their slot.
  const slotBlockers = new Map<number, string[]>();
  const blockSlot = (slot: number, reason: string) => {
    slotBlockers.set(slot, [...(slotBlockers.get(slot) ?? []), reason]);
    // Recorded as a failing check but NOT through record(), which feeds the
    // day-level blockers list — that is exactly the all-or-nothing coupling
    // this rewrite removes.
    checks.push({ name: `slot_${slot}`, ok: false, detail: reason });
  };

  // The makeup-bag topic ran four times in five days (08-03, 08-04, 08-05,
  // 08-07) because the morning flow recycles its own earlier slot-1 packages;
  // the owner recognized the reused caption on sight. A slot-1 topic that
  // shares a three-character run (within the leading object phrase) with any
  // topic from the previous seven days is a rerun and must not publish.
  //
  // Template lead-in phrases must not count as "the object": on 2026-08-09
  // the gate matched 「先看懂」 -- a stylistic opener two unrelated topics
  // shared -- and blocked a legitimate day; slot 1 never published. Grams are
  // taken from the topic with lead-in wording stripped, so only object words
  // remain comparable.
  const TOPIC_LEAD_INS = /先看懂|怎麼判斷|怎麼辦|你可能|其實|今天|當天|門市檢查|最髒的|先看|再看/g;
  const objectHead = (topic: string): string =>
    topic.replace(/[（(].*?[)）]/g, "").replace(TOPIC_LEAD_INS, "").replace(/[：:，,。!？?\s]/g, "").slice(0, 8);
  const slot1 = content.slots.find((slot) => slot.slot === 1);
  if (slot1) {
    const head = objectHead(slot1.topic);
    repeatScan: for (let back = 1; back <= 7; back++) {
      const base = new Date(`${date}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() - back);
      const prevDate = base.toISOString().slice(0, 10);
      const prev = await loadDailyContent(prevDate, root);
      for (const prevSlot of prev?.slots ?? []) {
        const prevHead = objectHead(prevSlot.topic);
        for (let i = 0; i + 3 <= prevHead.length; i++) {
          const gram = prevHead.slice(i, i + 3);
          if (/^[一-鿿]{3}$/.test(gram) && head.includes(gram)) {
            blockSlot(1, `slot 1 主題與 ${prevDate} 重複(共用「${gram}」),七天內不得重複物件`);
            break repeatScan;
          }
        }
      }
    }
  }

  // The caption comes from the calendar; the images were generated for the
  // topic recorded in the image-prompts manifest. When the two disagree the
  // post is caption-over-wrong-photos, which is worse than not posting.
  if (slot1) {
    try {
      const manifestRaw = await readFile(join(root, "data", "image-prompts", `${date}.json`), "utf8");
      const manifest = JSON.parse(manifestRaw) as Array<{ slot?: number; topic?: string }>;
      const imageTopic = manifest.find((item) => item.slot === 1)?.topic;
      if (!imageTopic) {
        blockSlot(1, "slot 1 圖片 manifest 缺 slot 1 條目,無法證明圖文一致");
      } else if (imageTopic !== slot1.topic) {
        blockSlot(1, `slot 1 文不配圖:圖片為「${imageTopic.slice(0, 16)}」生成,文案是「${slot1.topic.slice(0, 16)}」`);
      }
    } catch {
      // Fail closed: a missing or unreadable manifest means consistency is
      // UNPROVEN, and unproven must not publish (luna, high). The old
      // "absence is not proof of mismatch" stance let a malformed manifest
      // waive the strongest gate.
      blockSlot(1, "slot 1 圖片 manifest 缺失或無法解析,圖文一致性未證明");
    }
  }

  const sources = await loadImageSources(date, root);
  for (const slot of content.slots) {
    for (const asset of imageAssetsForSlot(slot)) {
      const fullPath = join(root, ...asset.local_image_path.split("/"));
      let assetExists = false;
      try {
        assetExists = (await stat(fullPath)).size > 0;
      } catch {
        assetExists = false;
      }
      if (!assetExists) {
        blockSlot(slot.slot, `missing image ${asset.local_image_path}`);
        continue;
      }
      // Any non-empty file used to pass; a text file or corrupt download at
      // the right path could be approved and published (luna, high). All
      // pipeline images are PNG, so the signature is the cheapest real proof.
      if (asset.local_image_path.endsWith(".png")) {
        try {
          const { open } = await import("node:fs/promises");
          const handle = await open(fullPath, "r");
          const header = Buffer.alloc(8);
          await handle.read(header, 0, 8, 0);
          await handle.close();
          if (!header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
            blockSlot(slot.slot, `not a real PNG: ${asset.local_image_path}`);
            continue;
          }
        } catch {
          blockSlot(slot.slot, `unreadable image ${asset.local_image_path}`);
          continue;
        }
      }
      // A publishable image must also be a real generated asset, not a
      // placeholder that happens to sit at the right path.
      if (!sources.some((entry) => entry.image_path === asset.local_image_path && entry.source)) {
        blockSlot(slot.slot, `no source record for ${asset.local_image_path}`);
      }
    }
    if (!slotBlockers.has(slot.slot)) record(`slot_${slot.slot}`, true);
  }

  const approvals = await loadApprovalLog(date, root);
  const pending = content.slots.filter((slot) =>
    PLATFORMS.some((platform) => !hasApprovedPost(approvals, slot.slot, platform))
  );
  if (pending.length === 0) {
    return {
      date,
      approved: false,
      already_approved: true,
      approved_slots: [],
      blockers: [...blockers, ...[...slotBlockers.values()].flat()],
      checks,
      ai_provenance: aiProvenance
    };
  }

  // Day-level blockers (policy, calendar) refuse everything.
  if (blockers.length > 0) {
    return {
      date,
      approved: false,
      already_approved: false,
      approved_slots: [],
      blockers: [...blockers, ...[...slotBlockers.values()].flat()],
      checks,
      ai_provenance: aiProvenance
    };
  }

  // Approval is a judgment about specific content: the fingerprint sidecar
  // records the sha256 of each approved slot so publishing can refuse a
  // package rewritten after its approval (luna, high — the already_approved
  // short-circuit used to let any post-approval rewrite ride the old grant).
  const { createHash } = await import("node:crypto");
  const fingerprintPath = join(root, "data", "approved-log", `${date}.fingerprints.json`);
  const fingerprints: Record<string, string> = JSON.parse(
    await readFile(fingerprintPath, "utf8").catch(() => "{}")
  );

  const approvedSlots: number[] = [];
  for (const slot of pending) {
    if (slotBlockers.has(slot.slot)) continue;
    // A dry run evaluates every gate but must leave no trace: on 2026-08-07 a
    // gate test invoked with a then-nonexistent --dry-run flag silently wrote
    // real approvals for the next day.
    if (options.dryRun) {
      approvedSlots.push(slot.slot);
      continue;
    }
    await approvePost({
      date,
      slot: slot.slot,
      platforms: PLATFORMS,
      approvedBy: options.approvedBy ?? "auto-approve",
      note: "Unattended approval: publishing policy, content, publishable images and image sources all verified.",
      root
    });
    fingerprints[String(slot.slot)] = createHash("sha256").update(JSON.stringify(slot)).digest("hex");
    approvedSlots.push(slot.slot);
  }
  if (approvedSlots.length > 0) {
    const { writeFile: writeFp } = await import("node:fs/promises");
    await writeFp(fingerprintPath, JSON.stringify(fingerprints, null, 2), "utf8");
  }

  const remainingBlockers = [...slotBlockers.values()].flat();
  return {
    date,
    approved: approvedSlots.length > 0,
    already_approved: false,
    approved_slots: approvedSlots,
    blockers: remainingBlockers,
    checks,
    ai_provenance: aiProvenance
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));
  const dryRun = getFlag(args, "dry-run");
  const result = await autoApprove({
    date: getOption(args, "date"),
    root,
    approvedBy: getOption(args, "approved-by"),
    dryRun
  });

  console.log(JSON.stringify(dryRun ? { ...result, dry_run: true } : result, null, 2));
  if (dryRun) return;
  // The scheduled wrapper reads this file instead of scraping stdout: any npm
  // warning containing a brace shifted the substring parse, and a "successful"
  // parse into an object with a null .approved silently skipped the day.
  const { mkdir, writeFile } = await import("node:fs/promises");
  const reportDir = join(root, "output", "operations");
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, `auto-approve-${result.date}.json`), JSON.stringify(result, null, 2), "utf8");
  // Non-zero lets the scheduled task raise a notification when nothing was approved.
  if (!result.approved && !result.already_approved && !getFlag(args, "no-fail")) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
