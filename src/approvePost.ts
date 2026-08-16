import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import {
  hashImageFile,
  imageEvidenceFailures,
  loadApprovedImageDigests,
  writeApprovedImageDigests
} from "./imageStamp";
import { appendApprovalLog, loadDailyContent, loadImageSources } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { pauseMessage, readPause } from "./pause";
import { projectRoot } from "./paths";
import type { ApprovalLogEntry, Platform } from "./types";

export interface ApprovePostOptions {
  date: string;
  slot: number;
  platforms: Platform[];
  approvedBy: string;
  note?: string;
  root?: string;
  /** Approve despite unproven images. Recorded in the approval note. */
  force?: boolean;
}

function parsePlatforms(value: string | undefined): Platform[] {
  if (!value) throw new Error("--platform is required.");
  const platforms = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (platforms.length === 0) throw new Error("--platform must include at least one platform.");

  for (const platform of platforms) {
    if (platform !== "facebook" && platform !== "instagram") {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  return [...new Set(platforms)] as Platform[];
}

export async function approvePost(options: ApprovePostOptions): Promise<ApprovalLogEntry[]> {
  const root = projectRoot(options.root);

  // The owner's brake stops every consent path, including this manual one.
  // --force still overrides unproven image evidence; it does not override pause.
  const paused = await readPause(root);
  if (paused) {
    throw new Error(pauseMessage(paused));
  }

  const content = await loadDailyContent(options.date, root);
  if (!content) throw new Error(`No content calendar found for ${options.date}`);

  const slot = content.slots.find((item) => item.slot === options.slot);
  if (!slot) throw new Error(`Content slot ${options.slot} is missing for ${options.date}`);

  // Manual approval used to write consent with no image checks at all, which
  // made it a complete way around the gate that unattended approval spends all
  // its effort on. It asks the same question now. --force still exists, because
  // a human overriding a machine is legitimate, but it has to be deliberate and
  // it is written into the approval record where an audit can find it.
  const failures = await imageEvidenceFailures(
    root,
    options.date,
    slot,
    imageAssetsForSlot(slot),
    await loadImageSources(options.date, root)
  );
  if (failures.length > 0 && !options.force) {
    throw new Error(
      `Refusing to approve slot ${options.slot}: the images do not prove they belong to this caption.\n` +
        failures.map((line) => `  - ${line}`).join("\n") +
        `\nRegenerate the images, or pass --force if you have checked them yourself.`
    );
  }
  const forced = failures.length > 0;
  const forcedNote = forced
    ? `FORCED over ${failures.length} unproven image(s): ${failures.join(" | ")}`
    : undefined;

  // Snapshot first. Publishing treats a missing slot key as a pre-snapshot
  // day and falls back to the weaker check, so an approval log without a
  // snapshot is a silent downgrade. If this write fails the function throws
  // before any consent is recorded.
  const approvedDigests = (await loadApprovedImageDigests(root, options.date)) ?? {};
  const digests: Record<string, string> = {};
  for (const asset of imageAssetsForSlot(slot)) {
    const digest = await hashImageFile(root, asset.local_image_path);
    if (digest) digests[asset.local_image_path] = digest;
  }
  approvedDigests[String(options.slot)] = digests;
  await writeApprovedImageDigests(root, options.date, approvedDigests);

  const entries: ApprovalLogEntry[] = [];
  for (const platform of options.platforms) {
    const entry: ApprovalLogEntry = {
      date: options.date,
      slot: options.slot,
      platform,
      status: "approved",
      approved_by: options.approvedBy,
      note: [options.note, forcedNote].filter(Boolean).join(" — ") || undefined,
      created_at: new Date().toISOString(),
      // Machine-readable, so an audit can find these without parsing prose.
      ...(forced ? { forced: true as const, forced_reasons: failures } : {})
    };
    await appendApprovalLog(entry, root);
    entries.push(entry);
  }

  return entries;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot");
  const approvedBy = getOption(args, "approved-by");

  if (!date) throw new Error("--date is required.");
  if (!slot) throw new Error("--slot is required.");
  if (!approvedBy) throw new Error("--approved-by is required.");

  const entries = await approvePost({
    date,
    slot,
    platforms: parsePlatforms(getOption(args, "platform")),
    approvedBy,
    note: getOption(args, "note"),
    root: getOption(args, "root"),
    force: getFlag(args, "force")
  });

  console.log(JSON.stringify(entries, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
