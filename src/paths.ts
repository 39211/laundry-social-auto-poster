import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { posix } from "node:path";

export function projectRoot(root = process.env.PROJECT_ROOT || process.cwd()): string {
  return resolve(root);
}

export function padSlot(slot: number): string {
  return String(slot).padStart(2, "0");
}

export function relativeAssetPath(date: string, slot: number): string {
  return posix.join("docs", "assets", date, `slot-${padSlot(slot)}.png`);
}

export function relativeCarouselAssetPath(date: string, slot: number, slide: number): string {
  if (slide === 1) return relativeAssetPath(date, slot);
  return posix.join("docs", "assets", date, `slot-${padSlot(slot)}-slide-${padSlot(slide)}.png`);
}

export function relativeVideoAssetPath(date: string, slot: number): string {
  return posix.join("docs", "assets", date, `slot-${padSlot(slot)}.mp4`);
}

export function publicAssetPath(date: string, slot: number): string {
  return posix.join("assets", date, `slot-${padSlot(slot)}.png`);
}

export function publicCarouselAssetPath(date: string, slot: number, slide: number): string {
  if (slide === 1) return publicAssetPath(date, slot);
  return posix.join("assets", date, `slot-${padSlot(slot)}-slide-${padSlot(slide)}.png`);
}

export function publicVideoAssetPath(date: string, slot: number): string {
  return posix.join("assets", date, `slot-${padSlot(slot)}.mp4`);
}

export function assetDirectory(date: string, root = projectRoot()): string {
  return join(root, "docs", "assets", date);
}

export function assetFilePath(date: string, slot: number, root = projectRoot()): string {
  return join(root, "docs", "assets", date, `slot-${padSlot(slot)}.png`);
}

export function videoAssetFilePath(date: string, slot: number, root = projectRoot()): string {
  return join(root, "docs", "assets", date, `slot-${padSlot(slot)}.mp4`);
}

export function contentCalendarPath(date: string, root = projectRoot()): string {
  return join(root, "data", "content-calendar", `${date}.json`);
}

export function docsContentCalendarPath(date: string, root = projectRoot()): string {
  return join(root, "docs", "content-calendar", `${date}.json`);
}

export function imagePromptManifestPath(date: string, root = projectRoot()): string {
  return join(root, "data", "image-prompts", `${date}.json`);
}

export function videoPromptManifestPath(date: string, root = projectRoot()): string {
  return join(root, "data", "video-prompts", `${date}.json`);
}

export function videoCandidateManifestPath(date: string, root = projectRoot()): string {
  return join(root, "data", "video-candidates", `${date}.json`);
}

export function dailyContextPath(date: string, root = projectRoot()): string {
  return join(root, "data", "daily-context", `${date}.json`);
}

export function imageSourcesPath(date: string, root = projectRoot()): string {
  return join(root, "data", "image-sources", `${date}.json`);
}

export function videoSourcesPath(date: string, root = projectRoot()): string {
  return join(root, "data", "video-sources", `${date}.json`);
}

export function videoReviewsPath(date: string, root = projectRoot()): string {
  return join(root, "data", "video-reviews", `${date}.json`);
}

export function rejectedConceptsPath(root = projectRoot()): string {
  return join(root, "data", "rejected-concepts.json");
}

export function videoRepairQueuePath(root = projectRoot()): string {
  return join(root, "data", "video-repair-queue", "queue.json");
}

export function postedLogPath(date: string, root = projectRoot()): string {
  return join(root, "data", "posted-log", `${date}.json`);
}

export function postedLogDirectory(root = projectRoot()): string {
  return join(root, "data", "posted-log");
}

export function approvedLogPath(date: string, root = projectRoot()): string {
  return join(root, "data", "approved-log", `${date}.json`);
}

export function instagramInsightsDirectory(root = projectRoot()): string {
  return join(root, "data", "insights", "instagram");
}

export function facebookInsightsDirectory(root = projectRoot()): string {
  return join(root, "data", "insights", "facebook");
}

export function instagramInsightsReportPath(since: string, until: string, root = projectRoot()): string {
  const fileName = since === until ? `${since}.json` : `${since}_to_${until}.json`;
  return join(instagramInsightsDirectory(root), fileName);
}

export function facebookInsightsReportPath(since: string, until: string, root = projectRoot()): string {
  const fileName = since === until ? `${since}.json` : `${since}_to_${until}.json`;
  return join(facebookInsightsDirectory(root), fileName);
}

export function conversionEventsPath(root = projectRoot()): string {
  return join(root, "data", "conversions", "events.json");
}

export function review72HourPath(root = projectRoot()): string {
  return join(root, "output", "operations", "72-hour-review.json");
}

export async function ensureProjectDirectories(date: string, root = projectRoot()): Promise<void> {
  await Promise.all([
    mkdir(assetDirectory(date, root), { recursive: true }),
    mkdir(join(root, "docs", "content-calendar"), { recursive: true }),
    mkdir(join(root, "data", "daily-context"), { recursive: true }),
    mkdir(join(root, "data", "content-calendar"), { recursive: true }),
    mkdir(join(root, "data", "image-prompts"), { recursive: true }),
    mkdir(join(root, "data", "image-sources"), { recursive: true }),
    mkdir(join(root, "data", "video-prompts"), { recursive: true }),
    mkdir(join(root, "data", "video-candidates"), { recursive: true }),
    mkdir(join(root, "data", "video-sources"), { recursive: true }),
    mkdir(join(root, "data", "video-reviews"), { recursive: true }),
    mkdir(join(root, "data", "video-repair-queue"), { recursive: true }),
    mkdir(join(root, "data", "approved-log"), { recursive: true }),
    mkdir(join(root, "data", "posted-log"), { recursive: true }),
    mkdir(facebookInsightsDirectory(root), { recursive: true }),
    mkdir(instagramInsightsDirectory(root), { recursive: true }),
    mkdir(join(root, "data", "conversions"), { recursive: true })
  ]);
}
