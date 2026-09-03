import { getFlag, getOption, isMain } from "./cli";
import { assertLiveMetaConfig, assertPublicImageBaseUrl, getConfig } from "./config";
import {
  buildGitHubPagesCarouselImageUrl,
  buildGitHubPagesImageUrl,
  buildGitHubPagesVideoUrl
} from "./githubPages";
import {
  hasPublishableApproval,
  loadApprovalLog,
  loadDailyContent,
  loadPostLog,
  readJsonFile,
  writeJsonAtomic
} from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot, scheduledLogPath } from "./paths";
import { postFacebookCarousel, postFacebookPhoto, postFacebookReel } from "./postFacebook";
import { resolveSlotPublishMedia } from "./postCurrentSlot";
import { pauseMessage, readPause } from "./pause";
import { DAILY_SCHEDULE } from "./scheduler";
import type { AppConfig, DailySlot, PostInput } from "./types";

// Pre-schedules a future day's Facebook posts into Meta's own queue
// (published=false / video_state=SCHEDULED), so the machine can be dead at
// slot time and the Page still publishes. Owner directive 2026-08-24: keep a
// rolling three-day scheduled buffer on the platforms themselves ("這個才叫
// 穩定發布"). Instagram's Graph API has no scheduling (containers expire in
// 24h), so Instagram stays on the local at-slot-time publisher; the interlock
// in postCurrentSlot keeps the two paths from double-posting Facebook.
//
// Every media byte is transferred to Meta at scheduling time (unpublished
// photo uploads, Reel file_url pull), so the public Pages site being up at
// publish time is NOT required either.

export interface ScheduledLogEntry {
  date: string;
  slot: number;
  platform: "facebook";
  scheduled_post_id: string;
  scheduled_publish_time: number;
  published_media_type: "image" | "carousel" | "reel";
  video_sha256?: string;
  created_at: string;
}

export async function loadScheduledLog(date: string, root = projectRoot()): Promise<ScheduledLogEntry[]> {
  return readJsonFile<ScheduledLogEntry[]>(scheduledLogPath(date, root), []);
}

// Only schedule-ahead writes this file, one run at a time from one machine,
// so a read-modify-write with the atomic writer is enough; no cross-process
// lock like posted-log needs (its writers race the sentinel).
async function appendScheduledLog(entry: ScheduledLogEntry, root = projectRoot()): Promise<void> {
  const filePath = scheduledLogPath(entry.date, root);
  const entries = await readJsonFile<ScheduledLogEntry[]>(filePath, []);
  entries.push(entry);
  await writeJsonAtomic(filePath, entries);
}

// The live path sends Facebook a REEL for a mixed-carousel slot whose video
// is publishable (postCurrentSlot's platformInputs: isReel || isMixedCarousel
// => "reel"). The first live schedule run queued a plain carousel for exactly
// that shape, silently dropping the approved video from the Facebook side --
// this mapping is the single source of truth for what gets queued, mirrored
// by a direct unit test so the parity cannot quietly drift again. A deferred
// mixed-carousel never reaches this mapping as "mixed-carousel": resolve
// already downgraded it to "carousel".
export function facebookScheduleKind(
  resolvedMediaType: string | undefined
): "image" | "carousel" | "reel" {
  if (resolvedMediaType === "reel" || resolvedMediaType === "mixed-carousel") return "reel";
  if (resolvedMediaType === "carousel") return "carousel";
  return "image";
}

function slotPublishUnixTime(date: string, slotNumber: number, timezoneOffset = "+08:00"): number {
  const schedule = DAILY_SCHEDULE.find((item) => item.slot === slotNumber);
  if (!schedule) throw new Error(`Unknown slot: ${slotNumber}`);
  return Math.floor(new Date(`${date}T${schedule.time}:00${timezoneOffset}`).getTime() / 1000);
}

// Same backstop postCurrentSlot runs: refuse a caption byte-identical to one
// that already published live in the last seven days (the 08-07..08-11
// four-duplicate incident). Scheduling ahead must not reintroduce it.
async function assertCaptionNotRepeated(slot: DailySlot, date: string, root: string): Promise<void> {
  const caption = (slot.instagram_caption ?? "").trim();
  if (!caption) return;
  const { createHash } = await import("node:crypto");
  const captionHash = createHash("sha256").update(caption).digest("hex");
  for (let back = 1; back <= 7; back += 1) {
    const past = new Date(`${date}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() - back);
    const pastDate = past.toISOString().slice(0, 10);
    const pastContent = await loadDailyContent(pastDate, root).catch(() => null);
    if (!pastContent) continue;
    const pastPosts = await loadPostLog(pastDate, root).catch(() => []);
    for (const pastSlot of pastContent.slots) {
      const pastCaption = (pastSlot.instagram_caption ?? "").trim();
      if (!pastCaption) continue;
      if (createHash("sha256").update(pastCaption).digest("hex") !== captionHash) continue;
      const wentLive = pastPosts.some(
        (post) =>
          post.slot === pastSlot.slot && !post.dry_run && ["success", "posted"].includes(post.status)
      );
      if (wentLive) {
        throw new Error(
          `Slot ${slot.slot} caption is byte-identical to ${pastDate} slot ${pastSlot.slot}, which published live. Refusing to schedule it.`
        );
      }
    }
  }
}

export interface ScheduleAheadResult {
  date: string;
  slot: number;
  action: "scheduled" | "skipped";
  reason?: string;
  scheduled_post_id?: string;
  scheduled_publish_time?: number;
}

export async function scheduleAheadFacebook(input: {
  date: string;
  root?: string;
  config?: AppConfig;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<ScheduleAheadResult[]> {
  const root = projectRoot(input.root);
  const config = input.config ?? getConfig();
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();

  const paused = await readPause(root);
  if (paused) {
    throw new Error(pauseMessage(paused));
  }

  if (!config.dryRun) {
    assertLiveMetaConfig(config);
    assertPublicImageBaseUrl(config);
  }

  const content = await loadDailyContent(input.date, root);
  if (!content) throw new Error(`No content calendar for ${input.date}; generate the day first.`);

  const approvals = await loadApprovalLog(input.date, root);
  const alreadyScheduled = await loadScheduledLog(input.date, root);
  const alreadyPosted = await loadPostLog(input.date, root);
  const results: ScheduleAheadResult[] = [];

  for (const slot of content.slots) {
    const publishAt = slotPublishUnixTime(input.date, slot.slot);
    const secondsOut = publishAt - Math.floor(now.getTime() / 1000);

    if (alreadyScheduled.some((entry) => entry.slot === slot.slot)) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "already scheduled" });
      continue;
    }
    if (alreadyPosted.some((entry) => entry.slot === slot.slot && entry.platform === "facebook" && !entry.dry_run)) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "already posted live" });
      continue;
    }
    // Meta's floor is 10 minutes; anything closer belongs to the live path.
    if (secondsOut < 15 * 60) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "publish time too close; live path owns it" });
      continue;
    }
    if (secondsOut > 29 * 24 * 3600) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "beyond Meta's 29-day window" });
      continue;
    }
    if (!hasPublishableApproval(approvals, slot.slot, "facebook")) {
      results.push({ date: input.date, slot: slot.slot, action: "skipped", reason: "no publishable facebook approval" });
      continue;
    }

    await assertCaptionNotRepeated(slot, input.date, root);
    const resolvedMedia = await resolveSlotPublishMedia(slot, input.date, root);

    const imageAssets = imageAssetsForSlot(slot);
    const imageUrls = imageAssets.map(
      (asset) =>
        asset.public_image_url ||
        buildGitHubPagesCarouselImageUrl(config.publicImageBaseUrl, input.date, slot.slot, asset.slide)
    );
    const imageUrl =
      imageUrls[0] || slot.public_image_url || buildGitHubPagesImageUrl(config.publicImageBaseUrl, input.date, slot.slot);
    const isReel = resolvedMedia.mediaType === "reel";
    const isMixedCarousel = resolvedMedia.mediaType === "mixed-carousel";
    const isCarousel = resolvedMedia.mediaType === "carousel" || isMixedCarousel;
    const videoUrl =
      isReel || isMixedCarousel
        ? slot.public_video_url || buildGitHubPagesVideoUrl(config.publicImageBaseUrl, input.date, slot.slot)
        : undefined;

    const postInput: PostInput = {
      date: input.date,
      slot: slot.slot,
      caption: slot.facebook_caption,
      imageUrl,
      imageUrls: isCarousel ? imageUrls : undefined,
      mediaType: isReel || isMixedCarousel ? "reel" : isCarousel ? "carousel" : "image",
      videoUrl,
      scheduledPublishTime: publishAt
    };

    // Companion video not ready => the carousel is what gets scheduled, same
    // fallback the live path takes. A Reel slot with no publishable video is
    // NOT downgraded silently at schedule time: skip and leave it to the live
    // path, where heal/catch-up still have hours to repair it.
    //
    // Judged on the CALENDAR's media_type, not resolvedMedia's: a deferred
    // reel comes back from resolveSlotPublishMedia already downgraded to
    // "image", so testing the resolved type let the first live run (8/25)
    // queue static images into two future Reel slots -- exactly the silent
    // downgrade this branch exists to refuse.
    if (slot.media_type === "reel" && resolvedMedia.videoDeferred) {
      results.push({
        date: input.date,
        slot: slot.slot,
        action: "skipped",
        reason: `reel video not publishable yet (${resolvedMedia.videoDeferredReason ?? "unknown"}); live path owns it`
      });
      continue;
    }

    const publishedMediaType = facebookScheduleKind(resolvedMedia.mediaType);

    if (config.dryRun) {
      results.push({
        date: input.date,
        slot: slot.slot,
        action: "scheduled",
        reason: "dry-run",
        scheduled_post_id: `dry-run-scheduled-${input.date}-${slot.slot}`,
        scheduled_publish_time: publishAt
      });
      continue;
    }

    const result =
      publishedMediaType === "reel"
        ? await postFacebookReel(postInput, config, fetchImpl)
        : publishedMediaType === "carousel"
          ? await postFacebookCarousel(postInput, config, fetchImpl)
          : await postFacebookPhoto(postInput, config, fetchImpl);
    if (!result.post_id) throw new Error(`Facebook scheduling for slot ${slot.slot} returned no post id.`);

    await appendScheduledLog(
      {
        date: input.date,
        slot: slot.slot,
        platform: "facebook",
        scheduled_post_id: result.post_id,
        scheduled_publish_time: publishAt,
        published_media_type: publishedMediaType,
        video_sha256: resolvedMedia.videoSha256,
        created_at: new Date().toISOString()
      },
      root
    );
    results.push({
      date: input.date,
      slot: slot.slot,
      action: "scheduled",
      scheduled_post_id: result.post_id,
      scheduled_publish_time: publishAt
    });
  }

  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  if (!date) throw new Error("--date YYYY-MM-DD is required.");
  if (!getFlag(args, "live")) {
    process.env.DRY_RUN = "true";
  }
  const results = await scheduleAheadFacebook({ date, root: getOption(args, "root") });
  console.log(JSON.stringify(results, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
