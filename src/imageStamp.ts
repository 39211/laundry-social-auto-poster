import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The evidence an image file carries about how it was made.
 *
 * Both the approval gate and the marking command need to compute the same three
 * things from the same inputs, and when those two computations lived in two
 * files they drifted -- the gate compared a topic the marker had never promised
 * to write. One module, one definition.
 */

export interface ManifestEntry {
  slot?: number;
  target_path?: string;
  topic?: string;
  prompt?: string;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashImageFile(root: string, imagePath: string): Promise<string | undefined> {
  try {
    return sha256(await readFile(join(root, ...imagePath.split("/"))));
  } catch {
    return undefined;
  }
}

export async function loadImagePromptManifest(
  root: string,
  date: string
): Promise<ManifestEntry[] | undefined> {
  try {
    const raw = await readFile(join(root, "data", "image-prompts", `${date}.json`), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManifestEntry[]) : undefined;
  } catch {
    // Unreadable is not "absent": both callers must treat it as unproven rather
    // than as permission to skip the check.
    return undefined;
  }
}

export function manifestEntryFor(
  manifest: ManifestEntry[] | undefined,
  imagePath: string
): ManifestEntry | undefined {
  // Matched per file, not per slot. A carousel has one entry per slide, and
  // matching by slot alone meant slides 2-4 were judged by slide 1's prompt.
  return manifest?.find((entry) => entry.target_path === imagePath);
}

export function promptHashFor(
  manifest: ManifestEntry[] | undefined,
  imagePath: string
): string | undefined {
  const prompt = manifestEntryFor(manifest, imagePath)?.prompt;
  return typeof prompt === "string" ? sha256(prompt) : undefined;
}
