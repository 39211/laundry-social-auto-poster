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
  options: { date?: string; root?: string; approvedBy?: string } = {}
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
  const slot1 = content.slots.find((slot) => slot.slot === 1);
  if (slot1) {
    const head = slot1.topic.slice(0, 8);
    repeatScan: for (let back = 1; back <= 7; back++) {
      const base = new Date(`${date}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() - back);
      const prevDate = base.toISOString().slice(0, 10);
      const prev = await loadDailyContent(prevDate, root);
      for (const prevSlot of prev?.slots ?? []) {
        const prevHead = prevSlot.topic.slice(0, 8);
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
      if (imageTopic && imageTopic !== slot1.topic) {
        blockSlot(1, `slot 1 文不配圖:圖片為「${imageTopic.slice(0, 16)}」生成,文案是「${slot1.topic.slice(0, 16)}」`);
      }
    } catch {
      // No manifest means the image gates below decide; absence is not proof
      // of mismatch.
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

  const approvedSlots: number[] = [];
  for (const slot of pending) {
    if (slotBlockers.has(slot.slot)) continue;
    await approvePost({
      date,
      slot: slot.slot,
      platforms: PLATFORMS,
      approvedBy: options.approvedBy ?? "auto-approve",
      note: "Unattended approval: publishing policy, content, publishable images and image sources all verified.",
      root
    });
    approvedSlots.push(slot.slot);
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
  const result = await autoApprove({
    date: getOption(args, "date"),
    root,
    approvedBy: getOption(args, "approved-by")
  });

  console.log(JSON.stringify(result, null, 2));
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
