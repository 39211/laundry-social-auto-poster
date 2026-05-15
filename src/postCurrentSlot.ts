import { access } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { assertPublicImageBaseUrl, getConfig } from "./config";
import { generateDailyContent } from "./generateDailyContent";
import { verifyPublicImageUrl } from "./githubPages";
import { appendPostLog, hasRecordedPost, loadDailyContent, loadPostLog } from "./logging";
import { projectRoot } from "./paths";
import { postFacebookPhoto } from "./postFacebook";
import { postInstagramPhoto } from "./postInstagram";
import { withRetry } from "./retry";
import { DAILY_SCHEDULE, findSlotByNumber, getZonedDateParts, resolveCurrentSlot } from "./scheduler";
import type { AppConfig, DailySlot, Platform, PostInput, PostLogEntry, PostResult } from "./types";

export interface PostCurrentSlotOptions {
  now?: string | Date;
  date?: string;
  slot?: number;
  dryRun?: boolean;
  allDue?: boolean;
  root?: string;
  verifyPublicImageUrl?: boolean;
  fetchImpl?: typeof fetch;
}

async function assertLocalImageExists(slot: DailySlot, root: string): Promise<void> {
  const fullPath = join(root, ...slot.local_image_path.split("/"));
  try {
    await access(fullPath);
  } catch {
    throw new Error(
      `Image is missing for slot ${slot.slot}: ${slot.local_image_path}. Run the Codex imagegen automation first.`
    );
  }
}

function resultToLog(date: string, slot: number, result: PostResult): PostLogEntry {
  return {
    date,
    slot,
    platform: result.platform,
    status: result.status,
    dry_run: result.dry_run,
    attempts: result.attempts,
    post_id: result.post_id,
    created_at: new Date().toISOString()
  };
}

async function postPlatform(
  platform: Platform,
  input: PostInput,
  config: AppConfig,
  fetchImpl: typeof fetch
): Promise<PostResult> {
  const publish = platform === "facebook" ? postFacebookPhoto : postInstagramPhoto;
  const { value, attempts } = await withRetry(() => publish(input, config, fetchImpl), 3);
  return { ...value, attempts };
}

async function postOneSlot(
  slot: DailySlot,
  config: AppConfig,
  date: string,
  root: string,
  fetchImpl: typeof fetch
): Promise<PostLogEntry[]> {
  await assertLocalImageExists(slot, root);

  if (config.verifyPublicImageUrl) {
    await verifyPublicImageUrl(slot.public_image_url, fetchImpl);
  }

  const existing = await loadPostLog(date, root);
  const outputs: PostLogEntry[] = [];
  const platformInputs: Array<{ platform: Platform; input: PostInput }> = [
    {
      platform: "facebook",
      input: { date, slot: slot.slot, caption: slot.facebook_caption, imageUrl: slot.public_image_url }
    },
    {
      platform: "instagram",
      input: { date, slot: slot.slot, caption: slot.instagram_caption, imageUrl: slot.public_image_url }
    }
  ];

  for (const { platform, input } of platformInputs) {
    if (hasRecordedPost(existing, slot.slot, platform, config.dryRun)) {
      outputs.push({
        date,
        slot: slot.slot,
        platform,
        status: "skipped",
        dry_run: config.dryRun,
        attempts: 0,
        created_at: new Date().toISOString()
      });
      continue;
    }

    try {
      const result = await postPlatform(platform, input, config, fetchImpl);
      const entry = resultToLog(date, slot.slot, result);
      await appendPostLog(entry, root);
      outputs.push(entry);
    } catch (error) {
      const entry: PostLogEntry = {
        date,
        slot: slot.slot,
        platform,
        status: "failed",
        dry_run: config.dryRun,
        attempts: 3,
        error: error instanceof Error ? error.message : String(error),
        created_at: new Date().toISOString()
      };
      await appendPostLog(entry, root);
      outputs.push(entry);
      throw error;
    }
  }

  return outputs;
}

export async function postCurrentSlot(options: PostCurrentSlotOptions = {}): Promise<PostLogEntry[]> {
  const root = projectRoot(options.root);
  const baseConfig = getConfig();
  const config: AppConfig = {
    ...baseConfig,
    dryRun: options.dryRun ?? baseConfig.dryRun,
    verifyPublicImageUrl: options.verifyPublicImageUrl ?? baseConfig.verifyPublicImageUrl
  };
  assertPublicImageBaseUrl(config);

  const now = options.now ? new Date(options.now) : new Date();
  const date = options.date || getZonedDateParts(now, config.timezone).date;

  let content = await loadDailyContent(date, root);
  if (!content) {
    await generateDailyContent({ date, root });
    content = await loadDailyContent(date, root);
  }
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const currentSchedule = options.slot ? findSlotByNumber(options.slot) : resolveCurrentSlot(now, config.timezone);
  const targetSchedules = options.allDue
    ? DAILY_SCHEDULE.filter((item) => item.time <= getZonedDateParts(now, config.timezone).time)
    : currentSchedule
      ? [currentSchedule]
      : [];

  if (targetSchedules.length === 0) return [];

  const results: PostLogEntry[] = [];
  for (const schedule of targetSchedules) {
    const slot = content.slots.find((item) => item.slot === schedule.slot);
    if (!slot) throw new Error(`Content slot ${schedule.slot} is missing for ${date}`);
    results.push(...(await postOneSlot(slot, config, date, root, options.fetchImpl ?? fetch)));
  }

  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const results = await postCurrentSlot({
    now: getOption(args, "now"),
    date: getOption(args, "date"),
    slot: getNumberOption(args, "slot"),
    dryRun: getFlag(args, "live") ? false : getFlag(args, "dry-run") ? true : undefined,
    allDue: getFlag(args, "all-due"),
    root: getOption(args, "root"),
    verifyPublicImageUrl: getFlag(args, "check-url")
      ? true
      : getFlag(args, "skip-url-check")
        ? false
        : undefined
  });

  console.log(JSON.stringify(results, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
