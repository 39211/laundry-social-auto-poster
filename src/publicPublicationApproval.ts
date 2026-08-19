import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { imagesDifferFromApproval, inspectApprovedImageDigestFile, isApprovedSlotDigestMap } from "./imageStamp";
import { hasPublishableApproval, loadApprovalLog, loadDailyContent, loadVideoSources, readJsonFile } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { videoReviewsPath } from "./paths";
import type { DailySlot, Platform } from "./types";
import { assertVideoReviewApproved } from "./videoReviewGate";

export interface CanonicalPublicPublicationApproval {
  ok: boolean;
  date: string;
  slots: number[];
  gaps: string[];
}

function fingerprint(slot: DailySlot): string {
  return createHash("sha256").update(JSON.stringify(slot)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDeferredVideoCandidate(slot: DailySlot): boolean {
  // A concept-ready candidate or an explicitly unpublished companion package
  // is not the effective media for this release. Their target paths are kept
  // so production can resume later, but they must not turn an image fallback
  // into a pretend Reel that needs a source/review it will not publish.
  return (
    (slot.video_candidate?.status === "concept_ready" && slot.video_candidate.fallback_media_type === "image") ||
    (slot.media_package?.status === "planned_unpublished" && slot.media_package.publish_authorized === false)
  );
}

function hasCompleteExplicitPublishableVideoTuple(slot: DailySlot): boolean {
  // Do not require HTTPS here: a nonblank but malformed explicit URL is still
  // publish intent and must reach the strict validator's actionable error.
  return (
    isNonBlankString(slot.local_video_path) &&
    isNonBlankString(slot.public_video_url) &&
    isNonBlankString(slot.video_prompt)
  );
}

function hasPublicVideo(slot: DailySlot): boolean {
  if (isDeferredVideoCandidate(slot)) return false;
  return (
    slot.media_type === "reel" ||
    slot.media_type === "mixed-carousel" ||
    hasCompleteExplicitPublishableVideoTuple(slot)
  );
}

async function inspectPublicVideoBinding(date: string, root: string, slot: DailySlot): Promise<string[]> {
  if (!hasPublicVideo(slot)) return [];

  const label = `slot ${slot.slot} public video`;
  if (!slot.local_video_path || !slot.video_prompt?.trim()) {
    return [`${label} is missing canonical local MP4 path or video prompt`];
  }
  if (!slot.public_video_url?.startsWith("https://")) {
    return [`${label} is missing a public HTTPS video URL`];
  }
  const expectedPublicPath = slot.local_video_path.replace(/^docs\//u, "");
  try {
    const publicPath = decodeURIComponent(new URL(slot.public_video_url).pathname).replace(/^\/+/, "");
    if (!publicPath.endsWith(expectedPublicPath)) {
      return [`${label} URL does not bind to ${expectedPublicPath}`];
    }
  } catch {
    return [`${label} URL is malformed`];
  }

  const sources = await loadVideoSources(date, root);
  const sourcesForSlot = sources.filter((entry) => entry.date === date && entry.slot === slot.slot);
  const matchingSources = sources.filter(
    (entry) =>
      entry.date === date &&
      entry.slot === slot.slot &&
      entry.source === "grok-imagine-video" &&
      entry.video_path === slot.local_video_path &&
      typeof entry.request_id === "string" &&
      entry.request_id.trim().length > 0
  );
  if (sourcesForSlot.length !== 1 || matchingSources.length !== 1) {
    return [`${label} requires exactly one canonical source record, found ${sourcesForSlot.length}`];
  }

  const reviews = await readJsonFile<Array<Record<string, unknown>>>(videoReviewsPath(date, root), []);
  const reviewsForSlot = Array.isArray(reviews)
    ? reviews.filter((entry) => entry?.date === date && entry.slot === slot.slot)
    : [];
  const matchingReviews = Array.isArray(reviews)
    ? reviews.filter(
        (entry) =>
          entry?.date === date &&
          entry.slot === slot.slot &&
          entry.video_path === slot.local_video_path &&
          typeof entry.video_sha256 === "string" &&
          /^[a-f0-9]{64}$/u.test(entry.video_sha256) &&
          typeof entry.reviewed_at === "string" &&
          !Number.isNaN(Date.parse(entry.reviewed_at))
  )
    : [];
  if (reviewsForSlot.length !== 1 || matchingReviews.length !== 1) {
    return [`${label} requires exactly one dated SHA-256 video review, found ${reviewsForSlot.length}`];
  }

  try {
    await assertVideoReviewApproved({
      date,
      slot: slot.slot,
      videoPath: slot.local_video_path,
      videoPrompt: slot.video_prompt,
      root
    });
  } catch (error) {
    return [`${label} review/source binding failed: ${error instanceof Error ? error.message : String(error)}`];
  }
  return [];
}

/**
 * The sole public-release gate for Pages and indexing effects.
 *
 * A calendar is only a plan. Public exposure additionally needs an unmodified
 * stamped calendar, exactly one non-forced approval for every slot/platform,
 * a matching immutable approval fingerprint, and the image bytes the reviewer
 * actually approved. This stays read-only so a failed check cannot create
 * evidence that looks like a release.
 */
export async function inspectCanonicalPublicPublicationApproval(
  date: string,
  root: string
): Promise<CanonicalPublicPublicationApproval> {
  const gaps: string[] = [];
  const slots: number[] = [];
  const fail = (message: string) => gaps.push(message);

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return { ok: false, date, slots, gaps: ["publication date must be YYYY-MM-DD"] };
  }

  try {
    const content = await loadDailyContent(date, root, { today: date });
    if (!content) {
      fail("current calendar is missing");
    } else if (content.tampered) {
      fail("current calendar failed canonical integrity/tamper inspection");
    } else if (content.date !== date) {
      fail("current calendar date does not match requested publication date");
    } else {
      const seen = new Set<number>();
      const validSlots: DailySlot[] = [];
      for (const slot of content.slots) {
        if (!Number.isSafeInteger(slot.slot) || slot.slot < 1) {
          fail("current calendar contains an invalid slot number");
          continue;
        }
        if (seen.has(slot.slot)) {
          fail(`current calendar contains duplicate slot ${slot.slot}`);
          continue;
        }
        seen.add(slot.slot);
        slots.push(slot.slot);
        validSlots.push(slot);
      }
      if (validSlots.length !== content.slots.length || validSlots.length === 0) {
        fail("current calendar has no unique valid slots");
      }

      const approvals = await loadApprovalLog(date, root);
      if (!Array.isArray(approvals)) {
        fail("approved-log must be a JSON array");
      }

      let fingerprints: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(
          await readFile(join(root, "data", "approved-log", `${date}.fingerprints.json`), "utf8")
        );
        if (!isRecord(parsed)) {
          fail("approval fingerprint sidecar is missing or unusable");
        } else {
          fingerprints = parsed;
        }
      } catch {
        fail("approval fingerprint sidecar is missing or unreadable");
      }

      const digestFile = await inspectApprovedImageDigestFile(root, date);
      if (digestFile.kind !== "ready") {
        fail("immutable approved image-digest sidecar is missing or unusable");
      }

      for (const slot of validSlots) {
        if (Array.isArray(approvals)) {
          for (const platform of ["facebook", "instagram"] as Platform[]) {
            const rows = approvals.filter((entry) => entry?.slot === slot.slot && entry?.platform === platform);
            const label = `slot ${slot.slot} ${platform}`;
            if (rows.length !== 1) {
              fail(`${label} requires exactly one approval tuple, found ${rows.length}`);
              continue;
            }
            const entry = rows[0]!;
            if (entry.date !== date) fail(`${label} has wrong approval date`);
            if (!hasPublishableApproval(rows, slot.slot, platform)) fail(`${label} is not a publishable non-forced approval`);
            if (
              typeof entry.approved_by !== "string" ||
              !entry.approved_by.trim() ||
              entry.approved_by !== entry.approved_by.trim()
            ) {
              fail(`${label} approved_by is missing or malformed`);
            }
            if (Number.isNaN(Date.parse(entry.created_at))) fail(`${label} created_at is missing or invalid`);
          }
        }

        if (fingerprints) {
          const expected = fingerprints[String(slot.slot)];
          if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected) || expected !== fingerprint(slot)) {
            fail(`slot ${slot.slot} content changed after approval (fingerprint mismatch)`);
          }
        }

        if (digestFile.kind === "ready") {
          const snapshot = digestFile.snapshot[String(slot.slot)];
          if (!isApprovedSlotDigestMap(snapshot)) {
            fail(`slot ${slot.slot} immutable approved image digest is missing or malformed`);
            continue;
          }
          const changed = await imagesDifferFromApproval(root, slot, imageAssetsForSlot(slot), digestFile.snapshot);
          for (const problem of changed) fail(problem);
        }

        for (const problem of await inspectPublicVideoBinding(date, root, slot)) fail(problem);
      }
    }
  } catch (error) {
    fail(`canonical public-approval inspection failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { ok: gaps.length === 0, date, slots, gaps };
}

export async function assertCanonicalPublicPublicationApproval(date: string, root: string): Promise<void> {
  const verdict = await inspectCanonicalPublicPublicationApproval(date, root);
  if (!verdict.ok) {
    throw new Error(`Canonical public approval is required for ${date}: ${verdict.gaps.join("; ")}`);
  }
}
