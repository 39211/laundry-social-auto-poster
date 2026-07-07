import { getNumberOption, getOption, isMain } from "./cli";
import { appendApprovalLog, loadDailyContent } from "./logging";
import { projectRoot } from "./paths";
import type { ApprovalLogEntry, Platform } from "./types";

export interface ApprovePostOptions {
  date: string;
  slot: number;
  platforms: Platform[];
  approvedBy: string;
  note?: string;
  root?: string;
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
  const content = await loadDailyContent(options.date, root);
  if (!content) throw new Error(`No content calendar found for ${options.date}`);

  const slot = content.slots.find((item) => item.slot === options.slot);
  if (!slot) throw new Error(`Content slot ${options.slot} is missing for ${options.date}`);

  const entries: ApprovalLogEntry[] = [];
  for (const platform of options.platforms) {
    const entry: ApprovalLogEntry = {
      date: options.date,
      slot: options.slot,
      platform,
      status: "approved",
      approved_by: options.approvedBy,
      note: options.note,
      created_at: new Date().toISOString()
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
    root: getOption(args, "root")
  });

  console.log(JSON.stringify(entries, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
