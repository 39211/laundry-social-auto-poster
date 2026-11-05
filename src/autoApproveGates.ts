import { createHash } from "node:crypto";

// Pure helpers for src/autoApprove.ts, kept free of project imports so they can
// be tested without a fixture tree.

/** sha256 of a calendar slot, the formula stored in data/approved-log/<date>.fingerprints.json. */
export function slotFingerprint(slot: unknown): string {
  return createHash("sha256").update(JSON.stringify(slot)).digest("hex");
}

/**
 * True when an approved slot no longer matches what approval saw: the calendar
 * slot was rewritten, or an image's bytes differ from (or are missing in) the
 * approved digest snapshot, or the image can no longer be hashed.
 * A missing fingerprint or snapshot is not judged here (the caller's missing-
 * snapshot rule covers that).
 */
export async function changedSinceApproval(
  slot: unknown,
  imagePaths: readonly string[],
  storedFingerprint: string | undefined,
  storedDigests: Readonly<Record<string, string>> | undefined,
  hash: (path: string) => Promise<string | null | undefined>
): Promise<boolean> {
  if (storedFingerprint !== undefined && storedFingerprint !== slotFingerprint(slot)) return true;
  if (!storedDigests) return false;
  for (const path of imagePaths) {
    const current = await hash(path);
    if (!current || storedDigests[path] !== current) return true;
  }
  return false;
}
