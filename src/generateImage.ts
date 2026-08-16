import { access, mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import {
  contradictorySubject,
  TOPIC_LABEL_PREFIXES,
  TOPIC_LABEL_PREFIX_RE
} from "./contentPlan";
import { generateDailyContent } from "./generateDailyContent";
import { loadApprovedImageDigests, sha256 } from "./imageStamp";
import {
  loadApprovalLog,
  loadDailyContent,
  loadImageSources,
  loadPostLog,
  readJsonFile,
  writeJsonAtomic
} from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { imagePromptManifestPath, padSlot, projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { DailySlot, ImageSourceRecord, VisualRoute } from "./types";

interface ImagePromptManifestItem {
  slot: number;
  slide: number;
  topic: string;
  prompt: string;
  visual_route: VisualRoute;
  target_path: string;
  public_image_url: string;
}

// The boutique look was retired from the prompt code, but calendars written
// before that carry the old prompt text verbatim, and this manifest is built
// from the calendar -- so the look kept coming back on every pre-generated
// date. Those calendars cannot be regenerated (their slot 2 may hold a
// reviewed, scheduled Reel), so the stale styling is rewritten here, at the
// point every image prompt passes through.
//
// The wear line exists because "preserve original condition" on a rendered
// image means brand new: today's post about damp shoe linings went out with a
// spotless boutique product shot. A care shop photographs items customers
// actually brought in.
const RETIRED_STYLE =
  /Premium Taiwanese laundry[^.]*Apple-like spacing[^.]*\.|restrained Apple-like spacing[^.]*\./g;

const PHONE_REALISM_REWRITE =
  "Shot on a phone by shop staff inside an ordinary Taiwanese laundry shop, handheld with slight " +
  "natural camera shake and imperfect framing, tiled floor and metal racks visible, fluorescent " +
  "ceiling light mixed with window daylight. The featured item shows honest everyday use consistent " +
  "with the topic - dust, scuffs, creases or slight discolouration where the topic describes them - " +
  "and must not look brand new or freshly styled. Not cinematic, not studio lighting, not glossy, " +
  "no boutique or showroom interior, no stock-photo feel, no laundry basket as a featured object, " +
  "no fake logo, no readable text, no watermark.";

export function sanitizeImagePrompt(prompt: string): string {
  if (!RETIRED_STYLE.test(prompt)) {
    RETIRED_STYLE.lastIndex = 0;
    return prompt;
  }
  RETIRED_STYLE.lastIndex = 0;
  return `${prompt.replace(RETIRED_STYLE, "").replace(/\s+/g, " ").trim()} ${PHONE_REALISM_REWRITE}`;
}

export const STALE_PROMPT_AFTER_TOPIC_CHANGE = "改了題沒改 image_prompt";

/**
 * Strip only the playbook file-label prefix. A label is not an object: changing
 * 可收藏 to 先看懂 on the same item is not a topic change. Uses the canonical
 * regex from contentPlan; do not copy TOPIC_LABEL_PREFIXES into a second list.
 */
export function topicIdentity(topic: string): string {
  const expected = `^(${TOPIC_LABEL_PREFIXES.join("|")})：`;
  if (TOPIC_LABEL_PREFIX_RE.source !== expected) {
    throw new Error("TOPIC_LABEL_PREFIX_RE drifted from TOPIC_LABEL_PREFIXES");
  }
  return topic.replace(TOPIC_LABEL_PREFIX_RE, "").trim();
}

export function topicsShareIdentity(left: string, right: string): boolean {
  return topicIdentity(left) === topicIdentity(right);
}

export class StalePromptAfterTopicChangeError extends Error {
  readonly slot: number;

  constructor(slot: number, detail: string) {
    super(`${STALE_PROMPT_AFTER_TOPIC_CHANGE}: slot ${slot} ${detail}`);
    this.name = "StalePromptAfterTopicChangeError";
    this.slot = slot;
  }
}

export class PromptSubjectClashError extends Error {
  readonly slot: number;

  constructor(slot: number, expected: string, found: string) {
    super(`slot ${slot} contradictorySubject: 提示詞要的是「${found}」,文案講的是「${expected}」`);
    this.name = "PromptSubjectClashError";
    this.slot = slot;
  }
}

export interface MissingCalendarImage {
  slot: number;
  path: string;
  reason: "absent" | "empty" | "unproven" | "stale-topic";
}

export interface InvalidatedImageMove {
  slot: number;
  from: string;
  to: string;
}

export interface InvalidateReport {
  date: string;
  moved: InvalidatedImageMove[];
  skipped: Array<{ slot: number; reason: string }>;
  refused: Array<{ slot: number; reason: string }>;
}

export interface InvalidateSlotOptions {
  date: string;
  root: string;
  previous: DailySlot;
  next: DailySlot;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function absoluteFromRelative(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

function promptSha256(prompt: string): string {
  return sha256(sanitizeImagePrompt(prompt));
}

/** True when the topic changed but the calendar still asks for the old picture. */
export function promptStillMatchesOldStamp(
  nextPrompt: string,
  stampPromptSha256: string | undefined
): boolean {
  if (typeof stampPromptSha256 !== "string" || stampPromptSha256.length === 0) return false;
  return promptSha256(nextPrompt) === stampPromptSha256;
}

export function regenerationRefusal(
  previousTopic: string,
  nextTopic: string,
  nextPrompt: string,
  stampPromptSha256?: string
): { kind: "stale-prompt" | "subject-clash"; detail: string } | undefined {
  if (topicsShareIdentity(previousTopic, nextTopic)) return undefined;
  if (promptStillMatchesOldStamp(nextPrompt, stampPromptSha256)) {
    return { kind: "stale-prompt", detail: STALE_PROMPT_AFTER_TOPIC_CHANGE };
  }
  const clash = contradictorySubject(nextTopic, nextPrompt);
  if (clash) {
    return { kind: "subject-clash", detail: `${clash.expected} vs ${clash.found}` };
  }
  return undefined;
}

function throwIfRefused(
  slot: number,
  refusal: { kind: "stale-prompt" | "subject-clash"; detail: string } | undefined
): void {
  if (!refusal) return;
  if (refusal.kind === "stale-prompt") {
    throw new StalePromptAfterTopicChangeError(slot, refusal.detail);
  }
  const clash = refusal.detail.split(" vs ");
  throw new PromptSubjectClashError(slot, clash[0] ?? refusal.detail, clash[1] ?? refusal.detail);
}

async function isProtectedReel(slot: DailySlot, root: string): Promise<boolean> {
  if (slot.media_type !== "reel" || !slot.local_video_path) return false;
  return fileExists(absoluteFromRelative(root, slot.local_video_path));
}

async function loadDayLockSlot1Topic(date: string, root: string): Promise<string | undefined> {
  const lock = await readJsonFile<{ slot1?: { topic?: string } } | undefined>(
    join(root, "data", "day-locks", `${date}.json`),
    undefined
  );
  return typeof lock?.slot1?.topic === "string" ? lock.slot1.topic : undefined;
}

async function slotMoveBlockReason(date: string, root: string, slot: DailySlot): Promise<string | undefined> {
  const posts = await loadPostLog(date, root);
  if (posts.some((entry) => entry.slot === slot.slot && (entry.status === "posted" || entry.status === "success" || entry.status === "uncertain"))) {
    return "posted-log";
  }
  const approvals = await loadApprovalLog(date, root);
  if (approvals.some((entry) => entry.slot === slot.slot)) {
    return "approved-log";
  }
  const digests = await loadApprovedImageDigests(root, date);
  if (digests && Object.hasOwn(digests, String(slot.slot))) {
    return "image-digests";
  }
  if (slot.slot === 1) {
    const lockedTopic = await loadDayLockSlot1Topic(date, root);
    if (lockedTopic !== undefined && !topicsShareIdentity(lockedTopic, slot.topic)) {
      return "A3: day-lock topicIdentity differs from calendar";
    }
  }
  return undefined;
}

async function orphanSlidePaths(date: string, slot: DailySlot, root: string): Promise<string[]> {
  const dir = join(root, "docs", "assets", date);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const kept = new Set(imageAssetsForSlot(slot).map((asset) => basename(asset.local_image_path)));
  const prefix = `slot-${padSlot(slot.slot)}-slide-`;
  return names
    .filter((name) => name.startsWith(prefix) && name.toLowerCase().endsWith(".png"))
    .filter((name) => !kept.has(name))
    .map((name) => `docs/assets/${date}/${name}`);
}

function staleDirectory(date: string, oldTopic: string, root: string): string {
  return join(root, "docs", "assets", date, "_stale", sha256(topicIdentity(oldTopic)).slice(0, 12));
}

async function moveAssetToStale(
  root: string,
  relativePath: string,
  destDir: string
): Promise<string | undefined> {
  const source = absoluteFromRelative(root, relativePath);
  if (!(await fileExists(source))) return undefined;
  await mkdir(destDir, { recursive: true });
  const base = basename(relativePath);
  let dest = join(destDir, base);
  let suffix = 1;
  while (await fileExists(dest)) {
    dest = join(destDir, `${suffix}-${base}`);
    suffix += 1;
  }
  await rename(source, dest);
  return dest;
}

function stampForAsset(
  sources: ImageSourceRecord[],
  slot: number,
  imagePath: string
): ImageSourceRecord | undefined {
  return sources.find((entry) => entry.slot === slot && entry.image_path === imagePath);
}

function previousTopicForScan(slot: DailySlot, sources: ImageSourceRecord[]): string | undefined {
  const topics = imageAssetsForSlot(slot)
    .map((asset) => stampForAsset(sources, slot.slot, asset.local_image_path)?.topic)
    .filter((topic): topic is string => typeof topic === "string");
  // Any carousel slide whose stamp identity disagrees with the calendar
  // invalidates the whole slot. Looking only at slide 1 would leave a mixed
  // slot (new first slide, old later slide) in place.
  return topics.find((topic) => !topicsShareIdentity(topic, slot.topic)) ?? topics[0];
}

function refuseIfUnsafeToRegenerate(
  previousTopic: string,
  next: DailySlot,
  sources: ImageSourceRecord[]
): void {
  for (const asset of imageAssetsForSlot(next)) {
    const stamp = stampForAsset(sources, next.slot, asset.local_image_path);
    const fromTopic = typeof stamp?.topic === "string" ? stamp.topic : previousTopic;
    if (topicsShareIdentity(fromTopic, next.topic)) continue;
    throwIfRefused(
      next.slot,
      regenerationRefusal(fromTopic, next.topic, asset.image_prompt, stamp?.prompt_sha256)
    );
  }
}

async function moveSlotImagesToStale(
  date: string,
  root: string,
  slot: DailySlot,
  oldTopic: string,
  protectCover: boolean
): Promise<InvalidatedImageMove[]> {
  const destDir = staleDirectory(date, oldTopic, root);
  const moved: InvalidatedImageMove[] = [];
  const relatives = [
    ...imageAssetsForSlot(slot).map((asset) => asset.local_image_path),
    ...(await orphanSlidePaths(date, slot, root))
  ];
  const unique = [...new Set(relatives)];
  for (const relative of unique) {
    if (protectCover && relative === slot.local_image_path) continue;
    const dest = await moveAssetToStale(root, relative, destDir);
    if (!dest) continue;
    moved.push({ slot: slot.slot, from: relative, to: dest });
    console.log(`A7 invalidate: moved ${relative} -> ${dest}`);
  }
  return moved;
}

/**
 * Write-path invalidation: compare the slot about to be overwritten with the
 * slot that will replace it. scheduleReel should call this on the old slot
 * before it copies a new cover.
 */
export async function invalidateSlotImagesIfTopicChanged(
  options: InvalidateSlotOptions
): Promise<InvalidateReport> {
  const { date, root, previous, next } = options;
  const report: InvalidateReport = { date, moved: [], skipped: [], refused: [] };
  if (topicsShareIdentity(previous.topic, next.topic)) return report;

  const sources = await loadImageSources(date, root);
  refuseIfUnsafeToRegenerate(previous.topic, next, sources);

  const block = await slotMoveBlockReason(date, root, next);
  if (block) {
    report.skipped.push({ slot: next.slot, reason: block });
    console.log(`A7 invalidate: slot ${next.slot} skipped (${block})`);
    return report;
  }

  const protectCover =
    (await isProtectedReel(previous, root)) || (await isProtectedReel(next, root));
  if (protectCover) {
    report.skipped.push({ slot: next.slot, reason: "protected-reel" });
    console.log(`A7 invalidate: slot ${next.slot} cover kept (protected-reel)`);
  }

  report.moved.push(...(await moveSlotImagesToStale(date, root, previous, previous.topic, protectCover)));
  return report;
}

/**
 * Full-day scan against the calendar already on disk. Catches hand edits and
 * Codex writes that never went through generateDailyContent --force.
 */
export async function invalidateStaleImagesForDate(
  date: string,
  root = projectRoot()
): Promise<InvalidateReport> {
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const report: InvalidateReport = { date, moved: [], skipped: [], refused: [] };
  const sources = await loadImageSources(date, root);

  for (const slot of content.slots) {
    const stampedTopic = previousTopicForScan(slot, sources);
    if (stampedTopic === undefined) continue;
    if (topicsShareIdentity(stampedTopic, slot.topic)) continue;

    refuseIfUnsafeToRegenerate(stampedTopic, slot, sources);

    const block = await slotMoveBlockReason(date, root, slot);
    if (block) {
      report.skipped.push({ slot: slot.slot, reason: block });
      console.log(`A7 invalidate: slot ${slot.slot} skipped (${block})`);
      continue;
    }

    const protectCover = await isProtectedReel(slot, root);
    if (protectCover) {
      report.skipped.push({ slot: slot.slot, reason: "protected-reel" });
      console.log(`A7 invalidate: slot ${slot.slot} cover kept (protected-reel)`);
    }

    report.moved.push(...(await moveSlotImagesToStale(date, root, slot, stampedTopic, protectCover)));
  }

  return report;
}

/**
 * Inventory is the calendar, via imageAssetsForSlot. A complete-looking
 * image-prompts manifest is not proof the day has every picture the calendar
 * named -- that is the 2026-08-18 two-ruler shape.
 */
export async function listMissingCalendarImages(
  date: string,
  root = projectRoot()
): Promise<MissingCalendarImage[]> {
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const sources = await loadImageSources(date, root);
  const missing: MissingCalendarImage[] = [];

  for (const slot of content.slots) {
    for (const asset of imageAssetsForSlot(slot)) {
      const fullPath = absoluteFromRelative(root, asset.local_image_path);
      if (!(await fileExists(fullPath))) {
        missing.push({ slot: slot.slot, path: asset.local_image_path, reason: "absent" });
        continue;
      }
      const info = await stat(fullPath);
      if (info.size === 0) {
        missing.push({ slot: slot.slot, path: asset.local_image_path, reason: "empty" });
        continue;
      }
      const record = stampForAsset(sources, slot.slot, asset.local_image_path);
      if (!record || typeof record.topic !== "string") {
        missing.push({ slot: slot.slot, path: asset.local_image_path, reason: "unproven" });
        continue;
      }
      if (!topicsShareIdentity(record.topic, slot.topic)) {
        missing.push({ slot: slot.slot, path: asset.local_image_path, reason: "stale-topic" });
      }
    }
  }

  return missing;
}

export function summarizeMissingImages(date: string, missing: MissingCalendarImage[]): string {
  if (missing.length === 0) {
    return `Every image for ${date} was already present.`;
  }
  return `${missing.length} calendar image(s) missing for ${date}.`;
}

export async function writeImagePromptManifest(date: string, root = projectRoot()): Promise<string> {
  await generateDailyContent({ date, root });
  // Inserted between calendar-ensure and the rebuild so 06:30's
  // generate-image-manifest + generate-missing-images pair actually sees holes.
  await invalidateStaleImagesForDate(date, root);
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const manifest: ImagePromptManifestItem[] = content.slots.flatMap((slot) =>
    imageAssetsForSlot(slot).map((asset) => ({
      slot: slot.slot,
      slide: asset.slide,
      topic: slot.topic,
      prompt: sanitizeImagePrompt(asset.image_prompt),
      visual_route: slot.visual_route,
      target_path: asset.local_image_path,
      public_image_url: asset.public_image_url
    }))
  );

  const output = imagePromptManifestPath(date, root);
  await writeJsonAtomic(output, manifest);
  return output;
}

export async function validateImageAssets(date: string, root = projectRoot()): Promise<void> {
  const missing = await listMissingCalendarImages(date, root);
  if (missing.length === 0) return;
  throw new Error(
    `Missing image assets:\n${missing.map((item) => `- ${item.path} (${item.reason})`).join("\n")}`
  );
}

export async function validatePublishableImages(date: string, root = projectRoot()): Promise<void> {
  await validateImageAssets(date, root);
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const sources = await loadImageSources(date, root);
  const missingSources = content.slots.flatMap((slot) =>
    imageAssetsForSlot(slot)
      .filter(
        (asset) =>
        !sources.some(
          (source) =>
            source.slot === slot.slot &&
            source.source === "gpt-image-2" &&
            source.image_path === asset.local_image_path
        )
      )
      .map((asset) => `slot ${slot.slot} slide ${asset.slide}: ${asset.local_image_path}`)
  );

  if (missingSources.length > 0) {
    throw new Error(`Missing gpt-image-2 source records:\n${missingSources.map((item) => `- ${item}`).join("\n")}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "invalidate")) {
    const report = await invalidateStaleImagesForDate(date, root);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (getFlag(args, "list-missing")) {
    const missing = await listMissingCalendarImages(date, root);
    console.log(summarizeMissingImages(date, missing));
    for (const item of missing) {
      console.log(`- ${item.path} (${item.reason})`);
    }
    if (missing.length > 0) process.exitCode = 1;
    return;
  }

  if (getFlag(args, "validate") || getFlag(args, "validate-images")) {
    await validateImageAssets(date, root);
    console.log(`All image assets exist for ${date}.`);
    return;
  }

  if (getFlag(args, "validate-publishable")) {
    await validatePublishableImages(date, root);
    console.log(`All publishable image assets are ready for ${date}.`);
    return;
  }

  const output = await writeImagePromptManifest(date, root);
  console.log(`Image prompt manifest ready: ${output}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
