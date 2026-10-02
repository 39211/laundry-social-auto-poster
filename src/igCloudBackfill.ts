import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getConfig } from "./config";
import { buildGitHubPagesCarouselImageUrl, buildGitHubPagesImageUrl, buildGitHubPagesVideoUrl } from "./githubPages";
import {
  buildIgCloudSnapshot,
  igMediaTypeFor,
  pushIgCloudSnapshot,
  readIgCloudMarker,
  type IgCloudOptions
} from "./igCloud";
import { hasPublishableApproval, hasRecordedPost, loadApprovalLog, loadDailyContent, loadPostLog } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { assertSlotUnchangedSinceApproval, resolveSlotPublishMedia } from "./postCurrentSlot";
import { facebookScheduleKind, loadScheduledLog } from "./scheduleAhead";
import type { AppConfig } from "./types";

function taipeiDateOf(unixSeconds: number): string {
  return new Date((unixSeconds + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

/**
 * Hands Instagram to the cloud for a day whose Facebook posts were queued
 * before the cloud existed. A snapshot must be the version Facebook got, so a
 * slot is handed over only when it still passes everything the live publisher
 * checks and its media still matches what the Facebook queue recorded;
 * anything else stays on this PC.
 *
 * With publishAt it is a backfill: a slot Facebook already published but
 * Instagram never got, sent at publishAt instead of its own slot time. Every
 * gate still applies; only the "slot time is still ahead" check is replaced by
 * "publishAt is ahead and not before the slot's own date".
 */
export async function snapshotScheduledDay(input: {
  date: string;
  root: string;
  slot?: number;
  config?: AppConfig;
  igCloud?: IgCloudOptions;
  now?: Date;
  publishAt?: Date;
}): Promise<string[]> {
  const { date, root } = input;
  const config = input.config ?? getConfig();
  const nowUnix = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const lines: string[] = [];
  const content = await loadDailyContent(date, root);
  if (!content) return [`${date}: no content calendar; nothing handed to the cloud.`];
  const scheduled = await loadScheduledLog(date, root);
  const approvals = await loadApprovalLog(date, root);
  const posted = await loadPostLog(date, root);

  for (const row of scheduled) {
    if (row.platform !== "facebook") continue;
    if (input.slot !== undefined && row.slot !== input.slot) continue;
    const label = `${date} slot ${row.slot}`;
    const keep = (why: string) => lines.push(`${label}: stays on this PC (${why})`);

    // PR 134's merged rows add status outside ScheduledLogEntry, so read it locally.
    if (!row.scheduled_post_id?.trim() || (row as { status?: string }).status === "uncertain") {
      keep("Facebook schedule unconfirmed; nothing handed to the cloud");
      continue;
    }

    const backfillUnix = input.publishAt ? Math.floor(input.publishAt.getTime() / 1000) : undefined;
    if (backfillUnix === undefined) {
      if (row.scheduled_publish_time - nowUnix < 15 * 60) {
        keep("less than 15 minutes to slot time");
        continue;
      }
    } else {
      if (backfillUnix - nowUnix < 15 * 60) {
        keep("backfill time is less than 15 minutes away");
        continue;
      }
      if (taipeiDateOf(backfillUnix) < date) {
        keep(`backfill time ${taipeiDateOf(backfillUnix)} is before the slot's own date`);
        continue;
      }
    }
    if (await readIgCloudMarker(root, date, row.slot)) {
      lines.push(`${label}: already owned by the cloud`);
      continue;
    }
    if (hasRecordedPost(posted, row.slot, "instagram", false)) {
      keep("Instagram already recorded");
      continue;
    }
    const slot = content.slots.find((item) => item.slot === row.slot);
    if (!slot) {
      keep("slot missing from the calendar");
      continue;
    }
    if (!hasPublishableApproval(approvals, row.slot, "instagram")) {
      keep("no publishable Instagram approval");
      continue;
    }
    try {
      await assertSlotUnchangedSinceApproval(slot, date, root);
    } catch (error) {
      keep(error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error));
      continue;
    }
    let resolved: Awaited<ReturnType<typeof resolveSlotPublishMedia>>;
    try {
      resolved = await resolveSlotPublishMedia(slot, date, root);
    } catch (error) {
      keep(error instanceof Error ? error.message : String(error));
      continue;
    }
    // The queue recorded what Facebook got; anything different now means the
    // slot moved after scheduling and the cloud would publish another version.
    if (facebookScheduleKind(resolved.mediaType) !== row.published_media_type) {
      keep(`media type is ${resolved.mediaType} now, Facebook queued ${row.published_media_type}`);
      continue;
    }
    if ((row.video_sha256 ?? undefined) !== (resolved.videoSha256 ?? undefined)) {
      keep("video file differs from the one Facebook queued");
      continue;
    }

    const imageUrls = imageAssetsForSlot(slot).map(
      (asset) => asset.public_image_url || buildGitHubPagesCarouselImageUrl(config.publicImageBaseUrl, date, slot.slot, asset.slide)
    );
    const imageUrl = imageUrls[0] || slot.public_image_url || buildGitHubPagesImageUrl(config.publicImageBaseUrl, date, slot.slot);
    const isReel = resolved.mediaType === "reel";
    const isMixedCarousel = resolved.mediaType === "mixed-carousel";
    const isCarousel = resolved.mediaType === "carousel" || isMixedCarousel;
    const videoUrl = isReel || isMixedCarousel
      ? slot.public_video_url || buildGitHubPagesVideoUrl(config.publicImageBaseUrl, date, slot.slot)
      : undefined;
    const localVideo = videoUrl && slot.local_video_path ? join(root, ...slot.local_video_path.split("/")) : undefined;

    const snapshot = buildIgCloudSnapshot({
      date,
      slot,
      publishUnix: backfillUnix ?? row.scheduled_publish_time,
      igMediaType: igMediaTypeFor(resolved.mediaType),
      imageUrls: isCarousel ? imageUrls : [imageUrl],
      videoUrl,
      videoBytes: localVideo ? (await stat(localVideo)).size : undefined,
      videoSha256: resolved.videoSha256,
      config,
      fbScheduledPostId: row.scheduled_post_id,
      backfill: backfillUnix !== undefined
    });
    try {
      const outcome = await pushIgCloudSnapshot(snapshot, root, input.igCloud);
      lines.push(`${label}: ${outcome.reason}`);
    } catch (error) {
      lines.push(`${label}: push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (lines.length === 0) lines.push(`${date}: nothing queued on Facebook${input.slot ? ` for slot ${input.slot}` : ""}.`);
  return lines;
}
