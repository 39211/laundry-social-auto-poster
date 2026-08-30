import { join } from "node:path";
import { topicIdentity } from "./generateImage";
import {
  hasApprovedPost,
  loadDailyContent,
  loadImageSources,
  loadPostLog,
  readJsonFile,
  writeJsonAtomic
} from "./logging";
import { projectRoot } from "./paths";
import type { ApprovalLogEntry, DailyContent, DailySlot, ImageSourceRecord, Platform, PostLogEntry } from "./types";

const PLATFORMS: Platform[] = ["facebook", "instagram"];

/** Custom domain for public pages. 39211.github.io is a leftover host, not a second site. */
export const CANONICAL_PUBLIC_ORIGIN = "https://sixiangjialaundry.com";

const LEGACY_SHOP_GITHUB_IO = /https:\/\/39211\.github\.io(?=\/|$)/g;

export interface PostedPackageFile {
  date: string;
  slots: DailySlot[];
}

export function postedPackagePath(date: string, root = projectRoot()): string {
  return join(root, "data", "posted-packages", `${date}.json`);
}

export function canonicalPublicOrigin(siteBaseUrl?: string): string {
  const configured = siteBaseUrl?.replace(/\/+$/, "") ?? "";
  if (configured && !configured.includes("39211.github.io")) return configured;
  return CANONICAL_PUBLIC_ORIGIN;
}

/** Rewrite leftover shop github.io URLs when emitting public pages. Does not touch private calendars. */
export function rewriteLegacyGithubIoUrls(text: string, siteBaseUrl?: string): string {
  if (!text.includes("39211.github.io")) return text;
  return text.replace(LEGACY_SHOP_GITHUB_IO, canonicalPublicOrigin(siteBaseUrl));
}

export function publicFacingSlot(slot: DailySlot, siteBaseUrl?: string): DailySlot {
  return {
    ...slot,
    instagram_caption: rewriteLegacyGithubIoUrls(slot.instagram_caption, siteBaseUrl),
    facebook_caption: rewriteLegacyGithubIoUrls(slot.facebook_caption, siteBaseUrl),
    public_image_url: rewriteLegacyGithubIoUrls(slot.public_image_url, siteBaseUrl),
    ...(slot.public_video_url
      ? { public_video_url: rewriteLegacyGithubIoUrls(slot.public_video_url, siteBaseUrl) }
      : {}),
    ...(slot.carousel_items
      ? {
          carousel_items: slot.carousel_items.map((item) => ({
            ...item,
            public_image_url: rewriteLegacyGithubIoUrls(item.public_image_url, siteBaseUrl)
          }))
        }
      : {})
  };
}

export function isLivePostedSlot(entries: PostLogEntry[], slot: number): boolean {
  return entries.some(
    (entry) =>
      entry.slot === slot &&
      !entry.dry_run &&
      (entry.status === "success" || entry.status === "posted" || entry.status === "uncertain")
  );
}

export function postedLogTopic(entries: PostLogEntry[], slot: number): string | undefined {
  const topics = entries
    .filter((entry) => entry.slot === slot && typeof entry.topic === "string" && entry.topic.trim())
    .map((entry) => entry.topic!.trim());
  return topics[0];
}

export function imageSourceTopic(sources: ImageSourceRecord[], slot: number): string | undefined {
  const topics = sources
    .filter((entry) => entry.slot === slot && typeof entry.topic === "string" && entry.topic.trim())
    .map((entry) => entry.topic!.trim());
  return topics[0];
}

export function topicsAgree(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return topicIdentity(left) === topicIdentity(right);
}

export function isSlotFullyApproved(approvals: ApprovalLogEntry[], slot: number): boolean {
  return PLATFORMS.every((platform) => hasApprovedPost(approvals, slot, platform));
}

/**
 * Prefer the package that actually went live over a later calendar draft.
 * posted-log + posted-package (approved calendar of that package) win.
 */
export function selectPublicSlots(input: {
  date: string;
  calendar: DailyContent | undefined;
  existingPublic: DailyContent | undefined;
  postedPackage: PostedPackageFile | undefined;
  posted: PostLogEntry[];
  approvals: ApprovalLogEntry[];
  imageSources: ImageSourceRecord[];
}): DailySlot[] {
  const slotNumbers = new Set<number>();
  for (const slot of input.calendar?.slots ?? []) slotNumbers.add(slot.slot);
  for (const slot of input.existingPublic?.slots ?? []) slotNumbers.add(slot.slot);
  for (const slot of input.postedPackage?.slots ?? []) slotNumbers.add(slot.slot);
  for (const entry of input.posted) {
    if (Number.isInteger(entry.slot) && entry.slot > 0) slotNumbers.add(entry.slot);
  }

  const selected: DailySlot[] = [];
  for (const slotNumber of [...slotNumbers].sort((left, right) => left - right)) {
    const calendarSlot = input.calendar?.slots.find((slot) => slot.slot === slotNumber);
    const postedPkgSlot = input.postedPackage?.slots.find((slot) => slot.slot === slotNumber);
    const existingSlot = input.existingPublic?.slots.find((slot) => slot.slot === slotNumber);
    const live = isLivePostedSlot(input.posted, slotNumber);
    const postedTopic =
      postedLogTopic(input.posted, slotNumber) ||
      postedPkgSlot?.topic ||
      imageSourceTopic(input.imageSources, slotNumber);
    const approved = isSlotFullyApproved(input.approvals, slotNumber);

    if (live) {
      if (postedPkgSlot && (!postedTopic || topicsAgree(postedPkgSlot.topic, postedTopic))) {
        selected.push(postedPkgSlot);
        continue;
      }
      if (calendarSlot && approved && (!postedTopic || topicsAgree(calendarSlot.topic, postedTopic))) {
        selected.push(calendarSlot);
        continue;
      }
      if (existingSlot && postedTopic && topicsAgree(existingSlot.topic, postedTopic)) {
        selected.push(existingSlot);
        continue;
      }
      // A later draft that disagrees with the aired package must not become the public post.
      continue;
    }

    if (calendarSlot && approved) {
      selected.push(calendarSlot);
    }
  }
  return selected;
}

export async function loadPostedPackage(date: string, root = projectRoot()): Promise<PostedPackageFile | undefined> {
  return readJsonFile<PostedPackageFile | undefined>(postedPackagePath(date, root), undefined);
}

export async function upsertPostedPackageSlot(date: string, slot: DailySlot, root = projectRoot()): Promise<void> {
  const existing = (await loadPostedPackage(date, root)) ?? { date, slots: [] };
  const slots = existing.slots.filter((item) => item.slot !== slot.slot);
  slots.push(slot);
  slots.sort((left, right) => left.slot - right.slot);
  await writeJsonAtomic(postedPackagePath(date, root), { date, slots });
}

export async function snapshotPostedCalendarSlot(input: {
  date: string;
  slot: number;
  root?: string;
}): Promise<void> {
  const root = projectRoot(input.root);
  try {
    const calendar = await loadDailyContent(input.date, root);
    const slot = calendar?.slots.find((item) => item.slot === input.slot);
    if (!slot) return;
    await upsertPostedPackageSlot(input.date, slot, root);
  } catch {
    return;
  }
}

export async function loadPublicSlotInputs(date: string, root: string): Promise<{
  posted: PostLogEntry[];
  imageSources: ImageSourceRecord[];
  postedPackage: PostedPackageFile | undefined;
}> {
  const [posted, imageSources, postedPackage] = await Promise.all([
    loadPostLog(date, root),
    loadImageSources(date, root),
    loadPostedPackage(date, root)
  ]);
  return { posted, imageSources, postedPackage };
}
