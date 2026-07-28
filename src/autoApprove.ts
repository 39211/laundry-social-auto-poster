import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { approvePost } from "./approvePost";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { validatePublishableImages } from "./generateImage";
import { hasApprovedPost, loadApprovalLog, loadDailyContent, loadImageSources } from "./logging";
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
    return { date, approved: false, already_approved: false, approved_slots: [], blockers, checks };
  }
  record("daily_content", true);

  const policySlots = policy?.slots?.map((item) => item.slot) ?? [];
  for (const slot of content.slots) {
    record(
      `policy_covers_slot_${slot.slot}`,
      policySlots.includes(slot.slot),
      `slot ${slot.slot} not listed in policy`
    );
  }

  try {
    await validatePublishableImages(date, root);
    record("publishable_images", true);
  } catch (error) {
    record("publishable_images", false, error instanceof Error ? error.message : String(error));
  }

  // A publishable image must also be a real generated asset, not a placeholder
  // that happens to sit at the right path.
  const sources = await loadImageSources(date, root);
  for (const slot of content.slots) {
    const missing = imageAssetsForSlot(slot)
      .map((asset) => asset.local_image_path)
      .filter((path) => !sources.some((entry) => entry.image_path === path && entry.source));
    record(
      `image_source_slot_${slot.slot}`,
      missing.length === 0,
      missing.length ? `no source record for ${missing.join(", ")}` : undefined
    );
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
      blockers,
      checks
    };
  }

  if (blockers.length > 0) {
    return { date, approved: false, already_approved: false, approved_slots: [], blockers, checks };
  }

  const approvedSlots: number[] = [];
  for (const slot of pending) {
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

  return { date, approved: true, already_approved: false, approved_slots: approvedSlots, blockers, checks };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = await autoApprove({
    date: getOption(args, "date"),
    root: getOption(args, "root"),
    approvedBy: getOption(args, "approved-by")
  });

  console.log(JSON.stringify(result, null, 2));
  // Non-zero lets the scheduled task raise a notification when nothing was approved.
  if (!result.approved && !result.already_approved && !getFlag(args, "no-fail")) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
