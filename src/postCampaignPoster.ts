/**
 * Campaign poster publisher (owner directive 2026-09-07: keep the three
 * template posters and upload one per day).
 *
 * Deliberately separate from the daily three-slot calendar: no HMAC calendar
 * entry, no image-source stamp, no day lock. The plan is data/campaign-posts.json;
 * one post per date; FB + IG photo posts by public URL, with a fallback URL on
 * the live branch's raw GitHub path in case the Pages mirror has not caught up.
 *
 * Idempotent per (date, platform): a success already in the campaign log is
 * never re-posted, so the retry trigger cannot double-post.
 *
 *   npx tsx src/postCampaignPoster.ts                # dry-run, today
 *   npx tsx src/postCampaignPoster.ts --date 2026-09-09 --live
 *   npx tsx src/postCampaignPoster.ts --live --force  # ignore the 17-21 window
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { verifyPublicImageUrl } from "./githubPages";
import { postFacebookPhoto } from "./postFacebook";
import { postInstagramPhoto } from "./postInstagram";
import type { AppConfig, PostInput, PostResult } from "./types";

export interface CampaignPost {
  id: string;
  date: string;
  image: string;
  caption_ig: string;
  caption_fb: string;
}

export interface CampaignPlan {
  campaign: string;
  publish_window: { start: string; end: string };
  image_base: string;
  image_base_fallback?: string;
  posts: CampaignPost[];
}

export interface CampaignLogEntry {
  id: string;
  platform: "facebook" | "instagram";
  status: "success" | "failed";
  post_id?: string;
  image_url?: string;
  error?: string;
  at: string;
}

export const CAMPAIGN_SLOT = 9;

export function selectPost(plan: CampaignPlan, date: string): CampaignPost | undefined {
  return plan.posts.find((post) => post.date === date);
}

export function taipeiNow(now = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: hour * 60 + Number(get("minute")) };
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function insideWindow(plan: CampaignPlan, minutes: number): boolean {
  return minutes >= toMinutes(plan.publish_window.start) && minutes < toMinutes(plan.publish_window.end);
}

export async function resolveImageUrl(
  plan: CampaignPlan,
  post: CampaignPost,
  verify: (url: string) => Promise<void>
): Promise<string> {
  const candidates = [plan.image_base, plan.image_base_fallback]
    .filter((base): base is string => Boolean(base))
    .map((base) => `${base.replace(/\/+$/, "")}/${post.image}`);
  const errors: string[] = [];
  for (const url of candidates) {
    try {
      await verify(url);
      return url;
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`no reachable public image URL for ${post.id}: ${errors.join(" | ")}`);
}

export function campaignLogPath(root: string, date: string): string {
  return join(root, "data", "campaign-posted-log", `${date}.json`);
}

export function readCampaignLog(root: string, date: string): CampaignLogEntry[] {
  const path = campaignLogPath(root, date);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as CampaignLogEntry[];
}

export function appendCampaignLog(root: string, date: string, entry: CampaignLogEntry): void {
  const path = campaignLogPath(root, date);
  mkdirSync(join(root, "data", "campaign-posted-log"), { recursive: true });
  const entries = readCampaignLog(root, date);
  entries.push(entry);
  writeFileSync(path, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

export interface RunOptions {
  root: string;
  date?: string;
  platforms?: Array<"facebook" | "instagram">;
  force?: boolean;
  now?: Date;
}

export interface RunDeps {
  config: AppConfig;
  plan?: CampaignPlan;
  verify?: (url: string) => Promise<void>;
  postFacebook?: (input: PostInput, config: AppConfig) => Promise<PostResult>;
  postInstagram?: (input: PostInput, config: AppConfig) => Promise<PostResult>;
  log?: (entry: CampaignLogEntry) => void;
  existing?: CampaignLogEntry[];
}

export interface RunOutcome {
  date: string;
  post?: string;
  skipped?: string;
  results: Array<{ platform: string; status: string; post_id?: string; error?: string; already?: boolean }>;
}

export async function runCampaignPost(options: RunOptions, deps: RunDeps): Promise<RunOutcome> {
  const { root } = options;
  const plan = deps.plan ?? (JSON.parse(readFileSync(join(root, "data", "campaign-posts.json"), "utf8")) as CampaignPlan);
  const clock = taipeiNow(options.now);
  const date = options.date ?? clock.date;
  const post = selectPost(plan, date);
  if (!post) return { date, skipped: `no campaign post planned for ${date}`, results: [] };
  if (!options.force && !insideWindow(plan, clock.minutes)) {
    return {
      date,
      post: post.id,
      skipped: `outside publish window ${plan.publish_window.start}-${plan.publish_window.end} (Taipei ${Math.floor(clock.minutes / 60)}:${String(clock.minutes % 60).padStart(2, "0")})`,
      results: []
    };
  }

  const config = deps.config;
  const verify = deps.verify ?? ((url: string) => verifyPublicImageUrl(url));
  const imageUrl = config.dryRun ? `${plan.image_base}/${post.image}` : await resolveImageUrl(plan, post, verify);
  const existing = deps.existing ?? readCampaignLog(root, date);
  const log = deps.log ?? ((entry: CampaignLogEntry) => appendCampaignLog(root, date, entry));
  const publishers = {
    facebook: deps.postFacebook ?? postFacebookPhoto,
    instagram: deps.postInstagram ?? postInstagramPhoto
  };
  const results: RunOutcome["results"] = [];

  for (const platform of options.platforms ?? ["facebook", "instagram"]) {
    const done = existing.find((e) => e.id === post.id && e.platform === platform && e.status === "success");
    if (done) {
      results.push({ platform, status: "success", post_id: done.post_id, already: true });
      continue;
    }
    const input: PostInput = {
      date,
      slot: CAMPAIGN_SLOT,
      caption: platform === "facebook" ? post.caption_fb : post.caption_ig,
      imageUrl
    };
    try {
      const result = await publishers[platform](input, config);
      results.push({ platform, status: result.status, post_id: result.post_id });
      if (!config.dryRun) {
        log({ id: post.id, platform, status: "success", post_id: result.post_id, image_url: imageUrl, at: new Date().toISOString() });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ platform, status: "failed", error: message });
      if (!config.dryRun) {
        log({ id: post.id, platform, status: "failed", image_url: imageUrl, error: message, at: new Date().toISOString() });
      }
    }
  }
  return { date, post: post.id, results };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = getFlag(args, "live");
  if (live) process.env.DRY_RUN = "false";
  const config = getConfig();
  const platformArg = getOption(args, "platform");
  const platforms =
    platformArg === "fb" ? (["facebook"] as const) : platformArg === "ig" ? (["instagram"] as const) : (["facebook", "instagram"] as const);
  const outcome = await runCampaignPost(
    { root: process.cwd(), date: getOption(args, "date"), platforms: [...platforms], force: getFlag(args, "force") },
    { config }
  );
  console.log(JSON.stringify({ dry_run: config.dryRun, ...outcome }, null, 2));
  if (outcome.results.some((r) => r.status === "failed")) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
